-- =============================================================================
-- 0110 · Pregúntele a Pilo con IA siempre.
--
-- La función pilo-ia responde ahora siempre con el modelo (con el catálogo,
-- las respuestas guardadas, las cifras y la memoria por delante) y por partes
-- (streaming). Esta migración le da lo que eso necesita en la base:
--
--   pilo_ai_settings  ajustes de «preguntar»: temperatura, tope de palabras
--                     de la respuesta, contexto, turnos de conversación, si
--                     el modelo acepta el rol `system`, si se responde por
--                     partes; el cupo diario de la voz (aparte del de texto)
--                     y el límite por visitante de la página pública.
--   pilo_visitor_hits el contador del límite por visitante. De quien pregunta
--                     solo se guarda una huella (hash con sal que cambia cada
--                     día), nunca la dirección IP. Nadie la lee desde el
--                     cliente: la escribe la función del servidor.
--   pilo_visitor_hit(huella, ventana)   suma un pedido y devuelve cuántos van.
--   pilo_visitor_cleanup()              borra las ventanas de más de un día.
--   pilo_inbox        motivo nuevo «general»: la IA respondió de conocimiento
--                     general, sin fuente institucional.
--   pilo_ai_key_status()  «today» cuenta solo el texto; «today_voice», la voz.
--
-- La función pilo-ia trabaja igual sin esta migración (usa los valores de
-- partida, no limita por visitante y no anota el motivo «general»).
-- Requiere 0089, 0094, 0102 y 0109. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Los ajustes
-- -----------------------------------------------------------------------------

alter table public.pilo_ai_settings
  add column if not exists ask_temperature        numeric not null default 0.3,
  add column if not exists ask_max_tokens         integer not null default 800,
  add column if not exists ask_context_tokens     integer not null default 3500,
  add column if not exists ask_history_turns      integer not null default 6,
  add column if not exists system_role            text    not null default 'auto',
  add column if not exists ask_stream             boolean not null default true,
  add column if not exists voice_daily_limit      integer not null default 1500,
  add column if not exists visitor_limit          integer not null default 20,
  add column if not exists visitor_window_seconds integer not null default 600;

comment on column public.pilo_ai_settings.ask_temperature is 'Pregúntele a Pilo: temperatura de la redacción (0 a 1).';
comment on column public.pilo_ai_settings.ask_max_tokens is 'Pregúntele a Pilo: tope de tokens de la respuesta.';
comment on column public.pilo_ai_settings.ask_context_tokens is 'Pregúntele a Pilo: cuánto contexto (catálogo, cifras, pasajes) cabe en el pedido, en tokens aproximados.';
comment on column public.pilo_ai_settings.ask_history_turns is 'Pregúntele a Pilo: cuántos turnos anteriores de la conversación pasan al modelo (0 a 6).';
comment on column public.pilo_ai_settings.system_role is 'Cómo va la persona de Pilo: «auto» (con rol system y, si el modelo lo rechaza, dentro del primer mensaje), «system» o «user».';
comment on column public.pilo_ai_settings.ask_stream is 'Pregúntele a Pilo: responder por partes (streaming) cuando la página lo pide.';
comment on column public.pilo_ai_settings.voice_daily_limit is 'Lecturas con la voz del servicio por día. Aparte de daily_limit, que es el cupo de texto.';
comment on column public.pilo_ai_settings.visitor_limit is 'Página pública: preguntas por visitante en cada ventana. 0 = sin límite.';
comment on column public.pilo_ai_settings.visitor_window_seconds is 'Página pública: cuánto dura la ventana del límite por visitante, en segundos.';

alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_ask;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_ask check (
  ask_temperature between 0 and 1
  and ask_max_tokens between 100 and 2000
  and ask_context_tokens between 800 and 8000
  and ask_history_turns between 0 and 6
  and system_role in ('auto', 'system', 'user')
  and voice_daily_limit between 0 and 100000
  and visitor_limit between 0 and 1000
  and visitor_window_seconds between 30 and 86400
);

-- -----------------------------------------------------------------------------
-- El límite por visitante
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_visitor_hits (
  visitor       text not null,
  window_start  timestamptz not null,
  hits          integer not null default 0,
  primary key (visitor, window_start),
  constraint pilo_visitor_hits_len check (length(visitor) between 16 and 64)
);

create index if not exists pilo_visitor_hits_window_idx on public.pilo_visitor_hits (window_start);

comment on table public.pilo_visitor_hits is
  'Pregúntele a Pilo: cuántos pedidos lleva cada visitante en la ventana actual. «visitor» es una huella (hash con sal diaria), no una dirección IP.';

-- Sin políticas y sin permisos: solo el rol de servicio (la función pilo-ia).
alter table public.pilo_visitor_hits enable row level security;
revoke all on public.pilo_visitor_hits from anon, authenticated;

-- Suma un pedido a la huella en su ventana y devuelve cuántos lleva. De vez en
-- cuando (uno de cada cincuenta pedidos) borra las ventanas viejas: la tabla
-- se mantiene pequeña sin depender de una tarea programada.
create or replace function public.pilo_visitor_hit(p_visitor text, p_window_start timestamptz)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo cuenta los pedidos por visitante.' using errcode = '42501';
  end if;
  if coalesce(length(p_visitor), 0) not between 16 and 64 or p_window_start is null then
    raise exception 'Falta la huella del visitante o su ventana.' using errcode = '22023';
  end if;
  insert into public.pilo_visitor_hits as h (visitor, window_start, hits)
  values (p_visitor, p_window_start, 1)
  on conflict (visitor, window_start) do update set hits = h.hits + 1
  returning h.hits into v_hits;
  if random() < 0.02 then
    delete from public.pilo_visitor_hits where window_start < now() - interval '1 day';
  end if;
  return v_hits;
end;
$$;

revoke all on function public.pilo_visitor_hit(text, timestamptz) from public, anon;
grant execute on function public.pilo_visitor_hit(text, timestamptz) to authenticated, service_role;

-- La limpieza completa, por si se quiere programar (pg_cron) o correr a mano.
create or replace function public.pilo_visitor_cleanup()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gone integer;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración limpian el contador.' using errcode = '42501';
  end if;
  delete from public.pilo_visitor_hits where window_start < now() - interval '1 day';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;

revoke all on function public.pilo_visitor_cleanup() from public, anon;
grant execute on function public.pilo_visitor_cleanup() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- La bandeja: el motivo «general»
-- -----------------------------------------------------------------------------

alter table public.pilo_inbox drop constraint if exists pilo_inbox_reason;
alter table public.pilo_inbox add constraint pilo_inbox_reason
  check (reason in ('sin_respuesta', 'no_sirvio', 'revisar', 'general'));

comment on table public.pilo_inbox is
  'Pregúntele a Pilo: lo que no supo responder, lo que no sirvió, lo que la IA dijo sin fuente y lo que respondió de conocimiento general. Planeación lo responde en el catálogo.';

-- -----------------------------------------------------------------------------
-- El uso de hoy: el texto y la voz se cuentan aparte.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_ai_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k public.pilo_ai_secret;
  u record;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve el estado de las claves.' using errcode = '42501';
  end if;
  select * into k from public.pilo_ai_secret where id = 1;
  select * into u from public.pilo_ai_keys_in_use();
  return jsonb_build_object(
    'keys', jsonb_build_object(
      'mistral', jsonb_build_object('has', k.mistral_key <> '', 'last4', right(k.mistral_key, 4)),
      'freeai', jsonb_build_object('has', k.freeai_key <> '', 'last4', right(k.freeai_key, 4)),
      'nvidia', jsonb_build_object('has', k.nvidia_key <> '', 'last4', right(k.nvidia_key, 4)),
      'fishaudio', jsonb_build_object('has', k.fishaudio_key <> '', 'last4', right(k.fishaudio_key, 4)),
      'otro', jsonb_build_object('has', k.otro_key <> '', 'last4', right(k.otro_key, 4)),
      'voz', jsonb_build_object('has', k.speech_key <> '', 'last4', right(k.speech_key, 4))
    ),
    'has_key', u.text_key <> '',
    'last4', right(u.text_key, 4),
    'has_speech_key', k.speech_key <> '',
    'speech_last4', right(k.speech_key, 4),
    'updated_at', k.updated_at,
    'today', (select count(*) from public.pilo_ai_log l
              where l.created_at >= date_trunc('day', now()) and not l.cached and l.action <> 'voz'),
    'today_voice', (select count(*) from public.pilo_ai_log l
                    where l.created_at >= date_trunc('day', now()) and not l.cached and l.action = 'voz')
  );
end;
$$;

revoke all on function public.pilo_ai_key_status() from public;
grant execute on function public.pilo_ai_key_status() to authenticated;
