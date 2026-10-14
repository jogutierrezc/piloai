-- =============================================================================
-- 0141 · Mr. Pilo: perfil de la persona (para el carnet digital) y «Mis límites».
--
-- 1. pilo_user_perfil: los datos que alimentan el carnet, por perfil de la cuenta
--    de Pilo (0120): estudiante (programa, semestre, jornada), profesor
--    (facultad, vinculación), administrativo (dependencia, cargo), más el código
--    (opcional), el tipo de sangre y el contacto de emergencia (opcionales).
--    El código y el RH solo se muestran en el carnet si la persona lo decide
--    (show_codigo, show_rh); nunca viajan en el QR, en Google Wallet ni en la
--    verificación para terceros.
--    · Cada persona lee y escribe SOLO su fila y solo con la cuenta activa. `anon`
--      no tiene nada. La administración NO la lee: como las respuestas guardadas
--      (0120), son datos de la persona (el RH y el contacto son sensibles).
--    · El rol sale de pilo_users: un disparador descarta lo que no corresponde
--      al perfil y limpia los textos. Las restricciones validan los valores.
--    · `suspendido_en` (carnet suspendido por pérdida) NO se escribe desde el
--      navegador: sin permiso de columna. Lo cambia la función `pilo-carnet`
--      con la clave de servicio.
--
-- 2. pilo_my_limits(): de solo lectura. Lo que la administración configuró y
--    aplica a la cuenta de quien llama (límite de preguntas por ventana, análisis
--    de archivos, código, extensión de las respuestas). Lo USADO no sale de aquí:
--    los contadores (pilo_visitor_hits) guardan una huella con sal y no se pueden
--    atribuir desde SQL; los lee la función `pilo-carnet` (acción «limites»).
--
-- Idempotente. Requiere 0110, 0113, 0119 y 0120. Ningún UPDATE/DELETE sin WHERE.
-- =============================================================================

create table if not exists public.pilo_user_perfil (
  user_id uuid primary key references public.pilo_users (id) on delete cascade,
  -- estudiante
  programa text,
  semestre smallint,
  jornada text,
  -- profesor
  facultad text,
  vinculacion text,
  -- administrativo
  dependencia text,
  cargo text,
  -- comunes y opcionales
  codigo text,
  rh text,
  contacto text,
  show_codigo boolean not null default false,
  show_rh boolean not null default false,
  -- Carnet suspendido por pérdida o robo (solo lo escribe la función pilo-carnet).
  suspendido_en timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.pilo_user_perfil drop constraint if exists pilo_user_perfil_valores;
alter table public.pilo_user_perfil add constraint pilo_user_perfil_valores check (
  (semestre is null or semestre between 1 and 12)
  and (jornada is null or jornada in ('diurna', 'nocturna'))
  and (vinculacion is null or vinculacion in ('planta', 'ocasional', 'catedra'))
  and (rh is null or rh in ('O+', 'O-', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-'))
  and (codigo is null or codigo ~ '^[0-9A-Za-z-]{3,20}$')
  and (programa is null or char_length(programa) between 2 and 120)
  and (facultad is null or char_length(facultad) between 2 and 120)
  and (dependencia is null or char_length(dependencia) between 2 and 120)
  and (cargo is null or char_length(cargo) between 2 and 120)
  and (contacto is null or char_length(contacto) between 3 and 120)
);

-- Limpia y ajusta al perfil de la cuenta: lo que no es de su perfil se descarta.
create or replace function public.pilo_user_perfil_prepare()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  select u.rol into v_rol from public.pilo_users u where u.id = new.user_id;
  if v_rol is null then
    raise exception 'No hay una cuenta de Pilo para este perfil.' using errcode = '23503';
  end if;
  new.programa := nullif(left(btrim(regexp_replace(coalesce(new.programa, ''), '\s+', ' ', 'g')), 120), '');
  new.facultad := nullif(left(btrim(regexp_replace(coalesce(new.facultad, ''), '\s+', ' ', 'g')), 120), '');
  new.dependencia := nullif(left(btrim(regexp_replace(coalesce(new.dependencia, ''), '\s+', ' ', 'g')), 120), '');
  new.cargo := nullif(left(btrim(regexp_replace(coalesce(new.cargo, ''), '\s+', ' ', 'g')), 120), '');
  new.contacto := nullif(left(btrim(regexp_replace(coalesce(new.contacto, ''), '\s+', ' ', 'g')), 120), '');
  new.codigo := nullif(btrim(coalesce(new.codigo, '')), '');
  new.rh := nullif(btrim(coalesce(new.rh, '')), '');
  if v_rol <> 'estudiante' then
    new.programa := null;
    new.semestre := null;
    new.jornada := null;
  end if;
  if v_rol <> 'profesor' then
    new.facultad := null;
    new.vinculacion := null;
  end if;
  if v_rol <> 'administrativo' then
    new.dependencia := null;
    new.cargo := null;
  end if;
  -- Sin el dato no hay nada que mostrar.
  if new.codigo is null then new.show_codigo := false; end if;
  if new.rh is null then new.show_rh := false; end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pilo_user_perfil_prepare on public.pilo_user_perfil;
create trigger pilo_user_perfil_prepare
  before insert or update on public.pilo_user_perfil
  for each row execute function public.pilo_user_perfil_prepare();

alter table public.pilo_user_perfil enable row level security;

drop policy if exists pilo_user_perfil_own on public.pilo_user_perfil;
create policy pilo_user_perfil_own on public.pilo_user_perfil
  for all
  using (user_id = auth.uid() and public.pilo_is_member())
  with check (user_id = auth.uid() and public.pilo_is_member());

revoke all on public.pilo_user_perfil from anon, authenticated;
-- Lectura de toda la fila (incluye si el carnet está suspendido); escritura solo de los datos de la persona.
grant select on public.pilo_user_perfil to authenticated;
grant insert (user_id, programa, semestre, jornada, facultad, vinculacion, dependencia, cargo, codigo, rh, contacto, show_codigo, show_rh)
  on public.pilo_user_perfil to authenticated;
grant update (programa, semestre, jornada, facultad, vinculacion, dependencia, cargo, codigo, rh, contacto, show_codigo, show_rh)
  on public.pilo_user_perfil to authenticated;
grant delete on public.pilo_user_perfil to authenticated;

comment on table public.pilo_user_perfil is
  'Datos del carnet digital de cada cuenta de Pilo. Solo su dueña los lee y escribe; el código y el RH se muestran únicamente si ella lo decide.';

-- -----------------------------------------------------------------------------
-- Mis límites de Pilo (solo lectura): lo configurado para esta cuenta.
-- Lee las filas como JSON para tolerar columnas que una migración anterior no haya puesto.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_my_limits()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user public.pilo_users;
  v_out jsonb := '{}'::jsonb;
  v_space text;
  v_ask jsonb;
  v_extra jsonb;
  v_limit integer;
  v_window integer;
  v_factor integer;
  v_aud_files text;
  v_aud_code text;
begin
  select * into v_user from public.pilo_users where id = auth.uid() and status = 'activa';
  if not found then
    raise exception 'No hay una cuenta de Pilo activa para esta sesión.' using errcode = '42501';
  end if;

  foreach v_space in array array['planeacion', 'ensenanza'] loop
    v_ask := null;
    v_extra := null;
    if v_space = 'planeacion' then
      if to_regclass('public.pilo_ai_settings') is not null then
        execute 'select to_jsonb(s) from public.pilo_ai_settings s where s.id = 1' into v_ask;
      end if;
    elsif to_regclass('public.pilo_spaces') is not null then
      execute 'select to_jsonb(s) from public.pilo_spaces s where s.id = $1' into v_ask using v_space;
    end if;
    if to_regclass('public.pilo_extras') is not null then
      execute 'select to_jsonb(e) from public.pilo_extras e where e.space = $1' into v_extra using v_space;
    end if;
    v_ask := coalesce(v_ask, '{}'::jsonb);
    v_extra := coalesce(v_extra, '{}'::jsonb);

    -- Los mismos valores de partida que usa pilo-ia cuando falta la fila o la columna.
    v_limit := coalesce((v_ask ->> 'visitor_limit')::integer, 20);
    v_window := coalesce((v_ask ->> 'visitor_window_seconds')::integer, 600);
    v_factor := coalesce((v_extra ->> 'member_factor')::integer, 3);
    v_aud_files := coalesce(v_extra ->> 'files_aud', 'nadie');
    v_aud_code := coalesce(v_extra ->> 'code_aud', 'nadie');

    v_out := v_out || jsonb_build_object(v_space, jsonb_build_object(
      -- Preguntas por ventana de tiempo (no por día). 0 = sin tope.
      'preguntas_max', case when v_limit <= 0 then 0 else v_limit * v_factor end,
      'ventana_s', v_window,
      'respuesta_tokens', coalesce((v_extra ->> 'member_max_tokens')::integer, 1200),
      -- Para una cuenta de Pilo cuentan «sesion» y «publico»; «admin» y «nadie», no.
      'archivos', v_aud_files in ('sesion', 'publico'),
      'archivo_mb', coalesce((v_extra ->> 'file_max_mb')::integer, 10),
      'archivos_dia', coalesce((v_extra ->> 'file_daily')::integer, 5),
      'codigo', v_aud_code in ('sesion', 'publico'),
      'codigo_tokens', coalesce((v_extra ->> 'code_max_tokens')::integer, 2000)
    ));
  end loop;

  return jsonb_build_object('rol', v_user.rol, 'campus', v_user.campus, 'espacios', v_out);
end;
$$;

revoke all on function public.pilo_my_limits() from public, anon;
grant execute on function public.pilo_my_limits() to authenticated;
