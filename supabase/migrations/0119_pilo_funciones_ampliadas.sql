-- =============================================================================
-- 0119 · Mr. Pilo: funciones ampliadas (analizar archivos y generar código).
--
-- La administración decide, por cada Pilo, quién puede adjuntar un archivo
-- para que Pilo lo analice y quién puede pedirle código:
--
--   nadie     apagado
--   admin     solo la administración
--   sesion    quien tiene sesión
--   publico   todos
--
-- El archivo se lee en el dispositivo de la persona y nunca se guarda: aquí
-- solo viven el permiso y los topes. Las dos funciones nacen apagadas.
--
-- Idempotente. Requiere 0113 (los espacios).
-- =============================================================================

create table if not exists public.pilo_extras (
  space text primary key,
  files_aud text not null default 'nadie',
  code_aud text not null default 'nadie',
  -- Tamaño máximo del archivo que la página acepta leer, en MB.
  file_max_mb integer not null default 10,
  -- Análisis de archivos por persona al día (0 = sin tope).
  file_daily integer not null default 5,
  -- Extensión máxima de una respuesta con código, en tokens.
  code_max_tokens integer not null default 2000,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

alter table public.pilo_extras drop constraint if exists pilo_extras_space;
alter table public.pilo_extras add constraint pilo_extras_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_extras drop constraint if exists pilo_extras_files_aud;
alter table public.pilo_extras add constraint pilo_extras_files_aud check (files_aud in ('nadie', 'admin', 'sesion', 'publico'));
alter table public.pilo_extras drop constraint if exists pilo_extras_code_aud;
alter table public.pilo_extras add constraint pilo_extras_code_aud check (code_aud in ('nadie', 'admin', 'sesion', 'publico'));
alter table public.pilo_extras drop constraint if exists pilo_extras_limits;
alter table public.pilo_extras add constraint pilo_extras_limits
  check (file_max_mb between 1 and 25 and file_daily between 0 and 200 and code_max_tokens between 400 and 4000);

insert into public.pilo_extras (space) values ('planeacion'), ('ensenanza') on conflict (space) do nothing;

alter table public.pilo_extras enable row level security;

drop policy if exists pilo_extras_admin on public.pilo_extras;
create policy pilo_extras_admin on public.pilo_extras
  for all
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

revoke all on public.pilo_extras from anon;
grant select, update on public.pilo_extras to authenticated;

-- Lo que la página necesita saber para pintar o no el clip: quién puede y
-- hasta qué tamaño. No expone los topes diarios ni la extensión del código.
create or replace function public.pilo_extras_public()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(e.space, jsonb_build_object('files_aud', e.files_aud, 'code_aud', e.code_aud, 'file_max_mb', e.file_max_mb)),
    '{}'::jsonb
  )
  from public.pilo_extras e;
$$;

revoke all on function public.pilo_extras_public() from public;
grant execute on function public.pilo_extras_public() to anon, authenticated, service_role;
