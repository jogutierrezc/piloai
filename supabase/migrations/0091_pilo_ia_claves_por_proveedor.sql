-- =============================================================================
-- 0091 · Mr. Pilo con IA: una clave por proveedor.
--
-- Antes había una sola clave de texto: al pasar de Mistral a Free.ai se
-- reemplazaba. Ahora cada proveedor guarda la suya (mistral, freeai, otro) y
-- la voz puede tener una propia; se usa la del proveedor elegido. La clave
-- que ya estaba se pasa al proveedor que estaba en uso.
-- Requiere 0089 y 0090. Idempotente.
-- =============================================================================

alter table public.pilo_ai_secret add column if not exists mistral_key text not null default '';
alter table public.pilo_ai_secret add column if not exists freeai_key text not null default '';
alter table public.pilo_ai_secret add column if not exists otro_key text not null default '';

-- La clave de antes, al proveedor que estaba elegido (solo si aún no tiene una).
update public.pilo_ai_secret k
set mistral_key = case when s.provider = 'mistral' and k.mistral_key = '' then k.api_key else k.mistral_key end,
    freeai_key = case when s.provider = 'freeai' and k.freeai_key = '' then k.api_key else k.freeai_key end,
    otro_key = case when s.provider = 'otro' and k.otro_key = '' then k.api_key else k.otro_key end
from public.pilo_ai_settings s
where k.id = 1 and s.id = 1 and k.api_key <> '';

comment on column public.pilo_ai_secret.api_key is 'En desuso desde 0091: cada proveedor tiene su columna (mistral_key, freeai_key, otro_key).';

-- La clave de texto en uso y la de voz, según lo elegido.
create or replace function public.pilo_ai_keys_in_use(out text_key text, out speech_key text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case s.provider when 'mistral' then k.mistral_key when 'freeai' then k.freeai_key else k.otro_key end,
    coalesce(
      nullif(k.speech_key, ''),
      nullif(case s.speech_provider when 'freeai' then k.freeai_key when 'otro' then k.otro_key else '' end, ''),
      case s.provider when 'mistral' then k.mistral_key when 'freeai' then k.freeai_key else k.otro_key end
    )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_secret k
  where s.id = 1 and k.id = 1;
$$;

revoke all on function public.pilo_ai_keys_in_use() from public, anon, authenticated;

create or replace function public.pilo_ai_public_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', s.enabled and s.base_url <> '' and u.text_key <> '',
    'speech_ready', s.voice_engine = 'proveedor' and s.speech_provider <> 'navegador'
      and coalesce(nullif(s.speech_base_url, ''), s.base_url) <> '' and u.speech_key <> '' and s.speech_model <> '',
    'functions', s.functions,
    'portals', s.portals,
    'voice_engine', s.voice_engine,
    'voice_rate', s.voice_rate,
    'voice_pitch', s.voice_pitch
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;

drop function if exists public.pilo_ai_set_key(text);
create or replace function public.pilo_ai_set_key(p_key text, p_which text default 'texto')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(p_key, ''));
  which text := p_which;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cambia la clave de Mr. Pilo.' using errcode = '42501';
  end if;
  -- «texto» es la del proveedor elegido.
  if which = 'texto' then
    select provider into which from public.pilo_ai_settings where id = 1;
  end if;
  case which
    when 'mistral' then update public.pilo_ai_secret set mistral_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'freeai' then update public.pilo_ai_secret set freeai_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'otro' then update public.pilo_ai_secret set otro_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'voz' then update public.pilo_ai_secret set speech_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    else raise exception 'La clave es de mistral, freeai, otro o voz.';
  end case;
  return case when clean = '' then '' else right(clean, 4) end;
end;
$$;

revoke all on function public.pilo_ai_set_key(text, text) from public;
grant execute on function public.pilo_ai_set_key(text, text) to authenticated;

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
      'otro', jsonb_build_object('has', k.otro_key <> '', 'last4', right(k.otro_key, 4)),
      'voz', jsonb_build_object('has', k.speech_key <> '', 'last4', right(k.speech_key, 4))
    ),
    -- La clave de texto en uso, como antes.
    'has_key', u.text_key <> '',
    'last4', right(u.text_key, 4),
    'has_speech_key', k.speech_key <> '',
    'speech_last4', right(k.speech_key, 4),
    'updated_at', k.updated_at,
    'today', (select count(*) from public.pilo_ai_log where created_at >= date_trunc('day', now()) and not cached)
  );
end;
$$;

revoke all on function public.pilo_ai_key_status() from public;
grant execute on function public.pilo_ai_key_status() to authenticated;

notify pgrst, 'reload schema';
