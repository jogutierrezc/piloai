-- =============================================================================
-- 0120 · Usuarios de Pilo: cuentas que solo sirven para Mr. Pilo.
--
-- Estudiantes, profesores y administrativos se registran con su correo de la
-- UDES para usar a Pilo (guardar respuestas, personalizar cómo les habla). Son
-- cuentas APARTE de la intranet:
--
--   · viven en `pilo_users`, no en `profiles`;
--   · al crearse no reciben perfil de intranet (antes, todo usuario nuevo de
--     auth caía en `profiles` con rol «consulta»): el disparador se salta a
--     quien nace marcado como usuario de Pilo;
--   · ninguna política de la intranet las reconoce: `has_role_at_least()` mira
--     `profiles`, donde no están.
--
-- El alta la hace la función `pilo-cuentas` con la clave de servicio, que es
-- la que valida el correo (solo dominios de la UDES), el perfil que ese correo
-- admite y el nombre de usuario. Aquí queda una segunda reja: las mismas
-- reglas como restricciones de la tabla.
--
-- Idempotente. Requiere 0001 y 0002.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El disparador de auth.users: un usuario de Pilo no recibe perfil de intranet.
-- La marca viaja en los metadatos de la persona. Falsificarla solo sirve para
-- NO recibir perfil: nunca concede nada.
-- -----------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.raw_user_meta_data ->> 'pilo', '') = 'true' then
    return new;
  end if;
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    -- Un valor inesperado en los metadatos no debe impedir el alta ni, peor,
    -- conceder un rol que nadie pidió: cualquier cosa rara cae en 'consulta'.
    case new.raw_user_meta_data ->> 'role'
      when 'admin' then 'admin'::public.app_role
      when 'planeacion' then 'planeacion'::public.app_role
      when 'responsable' then 'responsable'::public.app_role
      else 'consulta'::public.app_role
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Qué correo se acepta y qué perfiles admite.
--   @mail.udes.edu.co                      estudiante o profesor; la sede se pregunta
--   @udes.edu.co                           administrativo o profesor; la sede se pregunta
--   @bucaramanga|cucuta|valledupar.udes…   administrativo o profesor; la sede es la del dominio
-- Devuelve null si el correo no es de la UDES.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_email_rule(p_email text)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case
    when lower(coalesce(p_email, '')) !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+$' then null
    else case split_part(lower(p_email), '@', 2)
      when 'mail.udes.edu.co' then jsonb_build_object('roles', jsonb_build_array('estudiante', 'profesor'), 'campus', '')
      when 'udes.edu.co' then jsonb_build_object('roles', jsonb_build_array('administrativo', 'profesor'), 'campus', '')
      when 'bucaramanga.udes.edu.co' then jsonb_build_object('roles', jsonb_build_array('administrativo', 'profesor'), 'campus', 'bucaramanga')
      when 'cucuta.udes.edu.co' then jsonb_build_object('roles', jsonb_build_array('administrativo', 'profesor'), 'campus', 'cucuta')
      when 'valledupar.udes.edu.co' then jsonb_build_object('roles', jsonb_build_array('administrativo', 'profesor'), 'campus', 'valledupar')
      else null
    end
  end;
$$;

revoke all on function public.pilo_email_rule(text) from public;
grant execute on function public.pilo_email_rule(text) to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Los usuarios
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_users (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  full_name text not null,
  email text not null,
  rol text not null,
  campus text not null default '',
  status text not null default 'activa',
  -- Cómo le habla y le responde Pilo.
  nick text not null default '',
  tone text not null default 'cercano',
  length text not null default 'normal',
  about text not null default '',
  program text not null default '',
  -- Intentos fallidos de ingreso seguidos y hasta cuándo queda bloqueado el ingreso.
  failed_logins integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.pilo_users drop constraint if exists pilo_users_username;
alter table public.pilo_users add constraint pilo_users_username check (username ~ '^[a-z0-9._]{4,20}$');
alter table public.pilo_users drop constraint if exists pilo_users_rol;
alter table public.pilo_users add constraint pilo_users_rol check (rol in ('estudiante', 'profesor', 'administrativo'));
alter table public.pilo_users drop constraint if exists pilo_users_campus;
alter table public.pilo_users add constraint pilo_users_campus check (campus in ('', 'bucaramanga', 'cucuta', 'valledupar', 'bogota'));
alter table public.pilo_users drop constraint if exists pilo_users_status;
alter table public.pilo_users add constraint pilo_users_status check (status in ('activa', 'suspendida'));
alter table public.pilo_users drop constraint if exists pilo_users_prefs;
alter table public.pilo_users add constraint pilo_users_prefs
  check (tone in ('cercano', 'formal', 'directo') and length in ('corta', 'normal', 'detallada')
    and char_length(nick) <= 40 and char_length(about) <= 400 and char_length(program) <= 120 and char_length(full_name) between 3 and 120);
-- El correo es de la UDES y admite ese perfil: la misma regla de la función, como segunda reja.
alter table public.pilo_users drop constraint if exists pilo_users_email;
alter table public.pilo_users add constraint pilo_users_email
  check (email = lower(email) and public.pilo_email_rule(email) is not null and (public.pilo_email_rule(email) -> 'roles') ? rol);

create unique index if not exists pilo_users_username_idx on public.pilo_users (username);
create unique index if not exists pilo_users_email_idx on public.pilo_users (email);
create index if not exists pilo_users_rol_idx on public.pilo_users (rol, created_at desc);

comment on table public.pilo_users is
  'Usuarios de Pilo: cuentas que solo sirven para Mr. Pilo. No son usuarios de la intranet y no tienen fila en profiles.';

alter table public.pilo_users enable row level security;

-- Cada quien lee su fila; la administración, todas. Nadie escribe directo salvo la administración.
drop policy if exists pilo_users_read on public.pilo_users;
create policy pilo_users_read on public.pilo_users
  for select using (id = auth.uid() or public.has_role_at_least('admin'));

drop policy if exists pilo_users_admin on public.pilo_users;
create policy pilo_users_admin on public.pilo_users
  for update
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

drop policy if exists pilo_users_admin_delete on public.pilo_users;
create policy pilo_users_admin_delete on public.pilo_users
  for delete using (public.has_role_at_least('admin'));

revoke all on public.pilo_users from anon;
grant select, update, delete on public.pilo_users to authenticated;

-- ¿Quien llama es un usuario de Pilo con la cuenta activa?
create or replace function public.pilo_is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.pilo_users u where u.id = auth.uid() and u.status = 'activa');
$$;

revoke all on function public.pilo_is_member() from public, anon;
grant execute on function public.pilo_is_member() to authenticated, service_role;

-- Lo que la persona puede cambiar de su cuenta: cómo la llama Pilo, el tono, la
-- extensión, lo que Pilo debe saber de ella, su programa y su sede (si el correo
-- no la fija). El perfil, el usuario y el correo no se cambian desde aquí.
create or replace function public.pilo_user_update_prefs(p_patch jsonb)
returns public.pilo_users
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_users;
  v_fixed text;
begin
  select * into v_row from public.pilo_users where id = auth.uid() and status = 'activa';
  if not found then
    raise exception 'No hay una cuenta de Pilo activa para esta sesión.' using errcode = '42501';
  end if;
  v_fixed := public.pilo_email_rule(v_row.email) ->> 'campus';
  update public.pilo_users u set
    nick = case when p_patch ? 'nick' then left(btrim(regexp_replace(p_patch ->> 'nick', '\s+', ' ', 'g')), 40) else u.nick end,
    tone = case when p_patch ? 'tone' then p_patch ->> 'tone' else u.tone end,
    length = case when p_patch ? 'length' then p_patch ->> 'length' else u.length end,
    about = case when p_patch ? 'about' then left(btrim(p_patch ->> 'about'), 400) else u.about end,
    program = case when p_patch ? 'program' then left(btrim(regexp_replace(p_patch ->> 'program', '\s+', ' ', 'g')), 120) else u.program end,
    -- La sede solo se elige cuando el dominio del correo no la dice.
    campus = case when p_patch ? 'campus' and coalesce(v_fixed, '') = '' then p_patch ->> 'campus' else u.campus end
  where u.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.pilo_user_update_prefs(jsonb) from public, anon;
grant execute on function public.pilo_user_update_prefs(jsonb) to authenticated;

-- La tabla de la intranet: cada cuenta con si confirmó su correo y su último ingreso.
-- Solo administración.
create or replace function public.pilo_users_admin()
returns table (
  id uuid,
  username text,
  full_name text,
  email text,
  rol text,
  campus text,
  status text,
  confirmed boolean,
  created_at timestamptz,
  last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve los usuarios de Pilo.' using errcode = '42501';
  end if;
  return query
    select u.id, u.username, u.full_name, u.email, u.rol, u.campus, u.status,
           (a.email_confirmed_at is not null) as confirmed, u.created_at, u.last_seen_at
    from public.pilo_users u
    join auth.users a on a.id = u.id
    order by u.created_at desc;
end;
$$;

revoke all on function public.pilo_users_admin() from public, anon;
grant execute on function public.pilo_users_admin() to authenticated;

-- -----------------------------------------------------------------------------
-- Respuestas guardadas: lo que cada persona guarda de Pilo, en su cuenta.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_user_saved (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.pilo_users (id) on delete cascade,
  space text not null default 'planeacion',
  question text not null,
  answer text not null,
  sources jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.pilo_user_saved drop constraint if exists pilo_user_saved_shape;
alter table public.pilo_user_saved add constraint pilo_user_saved_shape
  check (space in ('planeacion', 'ensenanza') and char_length(question) between 1 and 600 and char_length(answer) between 1 and 12000
    and jsonb_typeof(sources) = 'array' and pg_column_size(sources) <= 16000);

create index if not exists pilo_user_saved_user_idx on public.pilo_user_saved (user_id, created_at desc);

alter table public.pilo_user_saved enable row level security;

-- Solo su dueño, y solo con la cuenta activa. La administración no lee lo que cada quien guarda.
drop policy if exists pilo_user_saved_own on public.pilo_user_saved;
create policy pilo_user_saved_own on public.pilo_user_saved
  for all
  using (user_id = auth.uid() and public.pilo_is_member())
  with check (user_id = auth.uid() and public.pilo_is_member());

revoke all on public.pilo_user_saved from anon;
grant select, insert, delete on public.pilo_user_saved to authenticated;

-- Hasta 300 guardadas por persona: una cuenta no llena la base.
create or replace function public.pilo_user_saved_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.pilo_user_saved s where s.user_id = new.user_id) >= 300 then
    raise exception 'Ya tiene 300 respuestas guardadas: quite alguna para guardar otra.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists pilo_user_saved_cap on public.pilo_user_saved;
create trigger pilo_user_saved_cap
  before insert on public.pilo_user_saved
  for each row execute function public.pilo_user_saved_cap();

-- -----------------------------------------------------------------------------
-- Más Pilo para quien tiene cuenta: su límite por persona se multiplica y sus
-- respuestas pueden extenderse más. Lo fija la administración, por cada Pilo,
-- junto a las funciones ampliadas (0119). Si esa migración no está, no hay nada
-- que ampliar y este bloque no hace nada.
-- -----------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.pilo_extras') is not null then
    alter table public.pilo_extras add column if not exists member_factor integer not null default 3;
    alter table public.pilo_extras add column if not exists member_max_tokens integer not null default 1200;
    alter table public.pilo_extras drop constraint if exists pilo_extras_member;
    alter table public.pilo_extras add constraint pilo_extras_member check (member_factor between 1 and 20 and member_max_tokens between 400 and 4000);
  end if;
end $$;
