-- =============================================================================
-- pilo_0146 · El personal administrativo de Pilo, con roles por espacio.
--
-- Hasta aquí administraba a Pilo quien era `admin` en PDI (`profiles`). Pilo
-- tiene ahora su propio personal, sin perfil de PDI, y cada persona trabaja en
-- su espacio. El contrato de roles vive en src/lib/pilo-staff.ts:
--
--   docencia        carga documental solo del espacio «ensenanza»
--   institucional   carga documental solo del espacio «planeacion»
--   ambos           los dos
--   admin           todo: conexión, voz, claves, usuarios, portales y personal
--
-- Un admin de PDI (`profiles.role = 'admin'` y activo) sigue siendo admin de
-- Pilo SIN fila en pilo_staff. Si tiene una fila activa, la fila manda (es lo
-- que hace effectiveStaffRole en el contrato).
--
--   pilo_staff                  una fila por persona del personal de Pilo. Cada
--                               persona lee la suya; el admin lee y escribe todo.
--   pilo_staff_role()           el rol efectivo de quien llama (o null).
--   pilo_can_space(espacio)     ¿ese rol trabaja en ese espacio?
--   pilo_is_admin()             ¿es admin de Pilo? (el de PDI o el de pilo_staff)
--   pilo_service_or_space(esp)  la función de Pilo (clave de servicio) o pilo_can_space.
--   pilo_service_or_doc(doc)    lo mismo, con el espacio del documento.
--   pilo_can_catalog_key(clave) lo mismo, con el espacio de la entrada del catálogo.
--   pilo_staff_list/_set/_touch las pantallas del personal (solo admin; _touch, cada quien).
--
-- Qué cambia en lo que ya existía (nada se vuelve más abierto):
--
--   · Por ESPACIO (pilo_can_space): el bucket pilo-docs (por el primer segmento
--     de la ruta <espacio>/<id>/<nombre>); las tablas pilo_docs, pilo_memory,
--     pilo_nodes, pilo_edges, pilo_catalog, pilo_inbox, pilo_readings, pilo_sources
--     y pilo_catalog_premises; y las funciones pilo_doc_save, pilo_doc_replace,
--     pilo_doc_update, pilo_doc_delete, pilo_doc_outline, pilo_map_prune,
--     pilo_map_pending, pilo_map_status, pilo_map_topics, pilo_map_save,
--     pilo_graph_overview, pilo_catalog_import (pilo_catalog_share queda solo admin),
--     pilo_premise_save, pilo_premise_clear, pilo_inbox_close,
--     pilo_reading_decide, pilo_space_usage y pilo_collection_create/rename/delete.
--     Antes todas pedían admin; un admin sigue pasando por todas.
--
--   · Todo lo demás de Pilo (conexión, claves, voz, usuarios de Pilo, portales,
--     Moodle, puentes, navegador, bitácora y respuestas guardadas) sigue
--     exigiendo admin, pero ahora vale también el admin de pilo_staff:
--     `has_role_at_least('admin')` pasa a `pilo_is_admin()` y
--     `pilo_is_service_or_admin()` acepta a la función de Pilo o a pilo_is_admin().
--
--   · Las columnas «quién lo hizo» de las tablas pilo_* (created_by, updated_by,
--     resolved_by, decided_by, reviewed_by, loaded_by, run_by) apuntaban a
--     profiles(id); una persona de pilo_staff no tiene perfil y esas llaves
--     rechazarían su firma. Pasan a apuntar a auth.users(id) con el mismo
--     ON DELETE SET NULL. (pilo_ai_log.profile_id no se toca: solo lo escribe
--     la función del servidor.)
--
--   · handle_new_user: quien nace con pilo_staff='true' en sus metadatos no
--     recibe perfil de PDI (como ya pasa con pilo='true', 0120). Falsificar la
--     marca solo sirve para NO recibir perfil: nunca concede nada, porque el
--     rol sale de pilo_staff y esa tabla solo la escribe el admin o la función
--     pilo-staff con la clave de servicio.
--
-- Las funciones que cambian de compuerta no se copian aquí: se leen de la base
-- (pg_get_functiondef), se cambia SOLO el chequeo y se vuelven a crear. Así se
-- parte de la versión que de verdad está instalada (varias se redefinieron en
-- 0115, 0118, 0121 y 0122) y se conservan sus permisos. Se puede correr otra vez:
-- lo ya cambiado no se toca.
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095).
-- Idempotente. Requiere 0113, 0114, 0120, 0121, 0125, 0127 y 0130.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- La tabla del personal.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_staff (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text not null default '',
  role         text not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz,
  created_by   uuid references auth.users (id) on delete set null,
  constraint pilo_staff_role_check check (role in ('docencia', 'institucional', 'ambos', 'admin')),
  constraint pilo_staff_email_check check (email = lower(email) and char_length(email) between 5 and 160),
  constraint pilo_staff_name_check check (char_length(full_name) <= 120)
);

create unique index if not exists pilo_staff_email_idx on public.pilo_staff (email);
create index if not exists pilo_staff_role_idx on public.pilo_staff (role, active);

comment on table public.pilo_staff is
  'Mr. Pilo: el personal administrativo de Pilo (docencia, institucional, ambos, admin). Aparte de profiles: no tienen perfil de PDI. Cada persona lee su fila; el admin lee y escribe todo. Las altas las hace la función pilo-staff.';
comment on column public.pilo_staff.role is
  'docencia = documentos de «ensenanza»; institucional = de «planeacion»; ambos = los dos; admin = todo.';

-- -----------------------------------------------------------------------------
-- Quién es quien llama. Estas funciones son las únicas que traducen rol a
-- espacio; las políticas y las funciones de abajo preguntan por ellas.
-- -----------------------------------------------------------------------------

-- El rol efectivo de auth.uid(): la fila ACTIVA de pilo_staff; sin ella, 'admin'
-- si es admin activo de PDI; si no, null.
create or replace function public.pilo_staff_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select s.role from public.pilo_staff s where s.user_id = auth.uid() and s.active),
    case when public.has_role_at_least('admin') then 'admin' end
  )
$$;

revoke all on function public.pilo_staff_role() from public, anon;
grant execute on function public.pilo_staff_role() to authenticated, service_role;

-- ¿Es admin de Pilo? El de PDI sin fila o el de pilo_staff.
create or replace function public.pilo_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.pilo_staff_role() = 'admin', false)
$$;

revoke all on function public.pilo_is_admin() from public, anon;
grant execute on function public.pilo_is_admin() to authenticated, service_role;

-- ¿Su rol trabaja en ese espacio? (admin: todos).
create or replace function public.pilo_can_space(p_space text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case public.pilo_staff_role()
      when 'admin' then true
      when 'ambos' then p_space in ('planeacion', 'ensenanza')
      when 'docencia' then p_space = 'ensenanza'
      when 'institucional' then p_space = 'planeacion'
      else false
    end,
    false
  )
$$;

revoke all on function public.pilo_can_space(text) from public, anon;
grant execute on function public.pilo_can_space(text) to authenticated, service_role;

-- ¿Llama la función de Pilo (rol de servicio)? Es el mismo chequeo que traía
-- pilo_is_service_or_admin (0094), aparte.
create or replace function public.pilo_is_service()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user = 'service_role'
$$;

revoke all on function public.pilo_is_service() from public, anon;
grant execute on function public.pilo_is_service() to authenticated, service_role;

-- La función de Pilo, o quien trabaja en ese espacio.
create or replace function public.pilo_service_or_space(p_space text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pilo_is_service() or public.pilo_can_space(p_space)
$$;

revoke all on function public.pilo_service_or_space(text) from public, anon;
grant execute on function public.pilo_service_or_space(text) to authenticated, service_role;

-- La función de Pilo, o quien trabaja en el espacio de ese documento. Un admin
-- pasa aunque el documento no exista (la función dirá «no existe»).
create or replace function public.pilo_service_or_doc(p_doc uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pilo_is_service()
      or public.pilo_is_admin()
      or exists (select 1 from public.pilo_docs d where d.id = p_doc and public.pilo_can_space(d.space))
$$;

revoke all on function public.pilo_service_or_doc(uuid) from public, anon;
grant execute on function public.pilo_service_or_doc(uuid) to authenticated, service_role;

-- ¿Trabaja en el espacio de esa entrada del catálogo? (admin: todas, exista o no).
create or replace function public.pilo_can_catalog_key(p_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.pilo_is_admin()
      or exists (
        select 1 from public.pilo_catalog c
        where c.key = btrim(coalesce(p_key, '')) and public.pilo_can_space(c.space)
      )
$$;

revoke all on function public.pilo_can_catalog_key(text) from public, anon;
grant execute on function public.pilo_can_catalog_key(text) to authenticated, service_role;

-- «La función de Pilo o la administración» (0094) ahora incluye al admin de
-- pilo_staff. Para todo lo que no se abre por espacio, la semántica es la misma.
create or replace function public.pilo_is_service_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user = 'service_role' or public.pilo_is_admin()
$$;

revoke all on function public.pilo_is_service_or_admin() from public, anon;

-- -----------------------------------------------------------------------------
-- Cuántos admins quedan aparte de esta persona: los activos de pilo_staff y los
-- admins activos de PDI que no tengan una fila activa que los rebaje. Para que
-- el último admin no se quite a sí mismo.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_staff_other_admins(p_exclude uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer from (
    select s.user_id as id from public.pilo_staff s
    where s.active and s.role = 'admin' and s.user_id is distinct from p_exclude
    union
    select p.id from public.profiles p
    where p.role = 'admin' and p.is_active and p.id is distinct from p_exclude
      and not exists (select 1 from public.pilo_staff s2 where s2.user_id = p.id and s2.active)
  ) x
$$;

revoke all on function public.pilo_staff_other_admins(uuid) from public, anon, authenticated;
grant execute on function public.pilo_staff_other_admins(uuid) to service_role;

-- Un admin no se quita a sí mismo (ni se desactiva ni se borra) si es el último,
-- tampoco escribiendo directo en la tabla. La clave de servicio (sin sesión) pasa.
create or replace function public.pilo_staff_keep_admin()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and old.user_id = auth.uid() and old.active and old.role = 'admin' then
    -- Un solo cambio de admins a la vez: dos últimos admins no se quitan en paralelo.
    perform pg_advisory_xact_lock(hashtext('pilo_staff_admins'));
  end if;
  if auth.uid() is not null and old.user_id = auth.uid() and old.active and old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and public.pilo_staff_other_admins(old.user_id) = 0 then
    raise exception 'Usted es el último administrador activo de Pilo: nómbre a otro antes de dejar de serlo.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.pilo_staff_keep_admin() from public, anon, authenticated;

drop trigger if exists pilo_staff_keep_admin on public.pilo_staff;
create trigger pilo_staff_keep_admin
  before update or delete on public.pilo_staff
  for each row execute function public.pilo_staff_keep_admin();

-- -----------------------------------------------------------------------------
-- RLS de pilo_staff: cada persona lee la suya; el admin lee y escribe todo.
-- -----------------------------------------------------------------------------

alter table public.pilo_staff enable row level security;

drop policy if exists pilo_staff_own on public.pilo_staff;
create policy pilo_staff_own on public.pilo_staff
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists pilo_staff_admin on public.pilo_staff;
create policy pilo_staff_admin on public.pilo_staff
  for all to authenticated
  using (public.pilo_is_admin())
  with check (public.pilo_is_admin());

revoke all on public.pilo_staff from public, anon, authenticated;
grant select, insert, update, delete on public.pilo_staff to authenticated;
grant all on public.pilo_staff to service_role;

-- -----------------------------------------------------------------------------
-- Las llaves «quién lo hizo» ya no exigen un perfil de PDI. Apuntan a
-- auth.users (donde están los perfiles de PDI Y el personal de Pilo), con el
-- mismo nombre y el mismo ON DELETE SET NULL. Cubre, entre otras,
-- pilo_docs.created_by, pilo_catalog.updated_by, pilo_inbox.resolved_by,
-- pilo_readings.decided_by, pilo_catalog_premises.reviewed_by y
-- pilo_portals.updated_by, que las funciones de abajo llenan con auth.uid().
-- Solo tablas pilo_*; las de Impacto y las de PDI no se tocan. Lo existente
-- sigue siendo válido: todo perfil es un usuario de auth.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass::text as tbl, c.conname, a.attname as col
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and cardinality(c.conkey) = 1
      and n.nspname = 'public'
      and t.relname like 'pilo\_%'
      and t.relname <> 'pilo_ai_log'
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references auth.users (id) on delete set null', r.tbl, r.conname, r.col);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- El disparador de auth.users: el personal de Pilo no recibe perfil de PDI.
-- No se copia la función (PDI puede haberla cambiado): se lee la instalada y se
-- le añade, junto a la condición pilo='true' (0120), la de pilo_staff='true'.
-- Si no encuentra esa condición, avisa y NO la reemplaza.
-- -----------------------------------------------------------------------------

do $$
declare
  v_oid regprocedure := to_regprocedure('public.handle_new_user()');
  v_def text;
  v_anchor constant text := 'coalesce(new.raw_user_meta_data ->> ''pilo'', '''') = ''true''';
begin
  if v_oid is null then
    raise warning 'pilo_0146: no existe public.handle_new_user(): el personal de Pilo recibiría perfil de PDI.';
    return;
  end if;
  v_def := pg_get_functiondef(v_oid);
  if position('pilo_staff' in v_def) > 0 then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise warning 'pilo_0146: handle_new_user no trae la condición pilo=''true'' esperada: NO se reemplazó. Añádale a mano: or coalesce(new.raw_user_meta_data ->> ''pilo_staff'', '''') = ''true''.';
    return;
  end if;
  execute replace(v_def, v_anchor, v_anchor || ' or coalesce(new.raw_user_meta_data ->> ''pilo_staff'', '''') = ''true''');
end $$;

-- -----------------------------------------------------------------------------
-- Altas en pilo_staff: la cuenta existe en auth, el correo es el de esa cuenta
-- y no es un Usuario de Pilo (pilo_users). Vale para la clave de servicio y
-- para el admin. Una cuenta de PDI (con perfil) SÍ puede recibir un rol de
-- Pilo: es el flujo «dar rol a una cuenta de PDI» que hace un admin.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_staff_check_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from auth.users a where a.id = new.user_id and lower(a.email) = new.email) then
    raise exception 'Esa cuenta no existe o su correo no coincide.' using errcode = '23514';
  end if;
  if exists (select 1 from public.pilo_users u where u.id = new.user_id) then
    raise exception 'Esa cuenta es un Usuario de Pilo: no puede ser personal.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.pilo_staff_check_insert() from public, anon, authenticated;

drop trigger if exists pilo_staff_check_insert on public.pilo_staff;
create trigger pilo_staff_check_insert
  before insert on public.pilo_staff
  for each row execute function public.pilo_staff_check_insert();

-- Quitar la fila de una persona (lo usa la función pilo-staff, solo con clave de
-- servicio). Toma el mismo cerrojo que pilo_staff_set y el disparador, y se
-- niega a dejar a Pilo sin admin activo.
create or replace function public.pilo_staff_remove_row(p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_staff;
begin
  if not public.pilo_is_service() then
    raise exception 'Solo la función de Pilo quita personal.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtext('pilo_staff_admins'));
  select * into v_row from public.pilo_staff where user_id = p_user for update;
  if not found then
    raise exception 'Esa persona no está en el personal de Pilo.' using errcode = '22023';
  end if;
  if v_row.active and v_row.role = 'admin' and public.pilo_staff_other_admins(p_user) = 0 then
    raise exception 'Es el último administrador activo de Pilo.' using errcode = '23514';
  end if;
  delete from public.pilo_staff where user_id = p_user;
  return jsonb_build_object('user_id', v_row.user_id, 'created_by', v_row.created_by, 'role', v_row.role);
end;
$$;

revoke all on function public.pilo_staff_remove_row(uuid) from public, anon, authenticated;
grant execute on function public.pilo_staff_remove_row(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- El alcance de una entrada del catálogo no lo ensancha el personal de un
-- espacio: `shared` (la lee también el otro Pilo) solo lo pone el admin y
-- `space` no cambia. Cubre la escritura directa (la política es «for all») y
-- pilo_catalog_import. pilo_catalog_share quedó solo para admin (no está en la
-- lista de arriba: pasa a pilo_is_admin() con el bloque general). La función de
-- Pilo (sin sesión) y el admin no tienen límite.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_catalog_scope_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or public.pilo_is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.shared then
      raise exception 'Solo la administración comparte entradas del catálogo con el otro Pilo.' using errcode = '42501';
    end if;
  else
    if new.shared is distinct from old.shared then
      raise exception 'Solo la administración comparte entradas del catálogo con el otro Pilo.' using errcode = '42501';
    end if;
    if new.space is distinct from old.space then
      raise exception 'Una entrada del catálogo no cambia de Pilo.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.pilo_catalog_scope_guard() from public, anon, authenticated;

drop trigger if exists pilo_catalog_scope_guard on public.pilo_catalog;
create trigger pilo_catalog_scope_guard
  before insert or update on public.pilo_catalog
  for each row execute function public.pilo_catalog_scope_guard();

-- -----------------------------------------------------------------------------
-- El bucket pilo-docs: por espacio. La ruta es <espacio>/<id>/<nombre>, así que
-- el espacio es el primer segmento. Donde no hay storage (o no hay permiso) se
-- avisa y la migración sigue, igual que en 0114.
-- -----------------------------------------------------------------------------

do $$
begin
  execute 'drop policy if exists pilo_docs_lectura on storage.objects';
  execute $pol$
    create policy pilo_docs_lectura on storage.objects
      for select to authenticated
      using (bucket_id = 'pilo-docs' and public.pilo_can_space(split_part(name, '/', 1)))
  $pol$;

  execute 'drop policy if exists pilo_docs_escritura on storage.objects';
  execute $pol$
    create policy pilo_docs_escritura on storage.objects
      for insert to authenticated
      with check (bucket_id = 'pilo-docs' and public.pilo_can_space(split_part(name, '/', 1)))
  $pol$;

  execute 'drop policy if exists pilo_docs_cambio on storage.objects';
  execute $pol$
    create policy pilo_docs_cambio on storage.objects
      for update to authenticated
      using (bucket_id = 'pilo-docs' and public.pilo_can_space(split_part(name, '/', 1)))
      with check (bucket_id = 'pilo-docs' and public.pilo_can_space(split_part(name, '/', 1)))
  $pol$;

  execute 'drop policy if exists pilo_docs_borrado on storage.objects';
  execute $pol$
    create policy pilo_docs_borrado on storage.objects
      for delete to authenticated
      using (bucket_id = 'pilo-docs' and public.pilo_can_space(split_part(name, '/', 1)))
  $pol$;
exception
  when insufficient_privilege or undefined_table or invalid_schema_name then
    raise warning
      'No se pudieron cambiar las políticas del bucket "pilo-docs" (%). Cámbielas a mano en Storage: acceso por espacio, el primer segmento de la ruta, con public.pilo_can_space().',
      sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- Las tablas que el personal lee por espacio. Se leen con la sesión de la
-- persona; se escriben solo por las funciones de abajo (salvo el catálogo, que
-- ya permitía activar y borrar directo: ahora solo en el espacio de la persona).
-- -----------------------------------------------------------------------------

drop policy if exists pilo_docs_admin on public.pilo_docs;
create policy pilo_docs_admin on public.pilo_docs
  for select to authenticated
  using (public.pilo_can_space(space));

drop policy if exists pilo_memory_admin on public.pilo_memory;
create policy pilo_memory_admin on public.pilo_memory
  for select to authenticated
  using (public.pilo_can_space(space));

drop policy if exists pilo_nodes_admin on public.pilo_nodes;
create policy pilo_nodes_admin on public.pilo_nodes
  for select to authenticated
  using (public.pilo_can_space(space));

drop policy if exists pilo_edges_admin on public.pilo_edges;
create policy pilo_edges_admin on public.pilo_edges
  for select to authenticated
  using (public.pilo_can_space(space));

drop policy if exists pilo_catalog_admin on public.pilo_catalog;
create policy pilo_catalog_admin on public.pilo_catalog
  for all to authenticated
  using (public.pilo_can_space(space))
  with check (public.pilo_can_space(space));

drop policy if exists pilo_inbox_admin_read on public.pilo_inbox;
create policy pilo_inbox_admin_read on public.pilo_inbox
  for select to authenticated
  using (public.pilo_can_space(space));

drop policy if exists pilo_inbox_admin_delete on public.pilo_inbox;
create policy pilo_inbox_admin_delete on public.pilo_inbox
  for delete to authenticated
  using (public.pilo_can_space(space));

drop policy if exists pilo_readings_admin on public.pilo_readings;
create policy pilo_readings_admin on public.pilo_readings
  for select to authenticated
  using (public.pilo_can_space(space));

-- Las colecciones de documentos: cada persona ve las de su espacio (para elegir
-- en cuál guarda). Los portales (pilo_portals) siguen siendo solo del admin.
drop policy if exists pilo_sources_admin on public.pilo_sources;
create policy pilo_sources_admin on public.pilo_sources
  for select to authenticated
  using (public.pilo_can_space(scope));

drop policy if exists pilo_catalog_premises_admin on public.pilo_catalog_premises;
create policy pilo_catalog_premises_admin on public.pilo_catalog_premises
  for select to authenticated
  using (public.pilo_can_catalog_key(key));

-- La ficha del espacio: el admin la lee y la cambia (pilo_spaces_admin, intacta);
-- el personal del espacio solo la LEE. No lleva claves: están en pilo_space_secret.
drop policy if exists pilo_spaces_staff on public.pilo_spaces;
create policy pilo_spaces_staff on public.pilo_spaces
  for select to authenticated
  using (public.pilo_can_space(id));

-- -----------------------------------------------------------------------------
-- Las funciones que cambian de compuerta, por espacio. Cada fila: la función,
-- el chequeo de hoy y el nuevo. Si la función ya tiene el nuevo y no el viejo,
-- se salta; si no tiene ninguno de los dos, avisa y sigue (así se ve qué falta).
-- Los chequeos nuevos solo usan los parámetros de la propia función.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
  v_oid regprocedure;
  v_def text;
begin
  for r in
    select * from (values
      -- Documentos: la ficha, sus pasajes y su lugar en el mapa.
      ($q$public.pilo_doc_save(text,jsonb)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_space(p_space)$q$),
      ($q$public.pilo_doc_replace(uuid,jsonb)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_doc(p_doc)$q$),
      ($q$public.pilo_doc_update(uuid,jsonb)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_doc(p_doc)$q$),
      ($q$public.pilo_doc_delete(uuid)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_doc(p_doc)$q$),
      ($q$public.pilo_doc_outline(uuid,jsonb,jsonb)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_doc(p_doc)$q$),
      -- El mapa de un espacio.
      ($q$public.pilo_map_prune(text)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_space(p_space)$q$),
      ($q$public.pilo_map_pending(text,uuid,integer)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_space(p_space)$q$),
      ($q$public.pilo_map_status(text,uuid)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_space(p_space)$q$),
      ($q$public.pilo_map_topics(text,integer)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_space(p_space)$q$),
      ($q$public.pilo_map_save(text,jsonb)$q$,
       $q$public.pilo_is_service_or_admin()$q$, $q$public.pilo_service_or_space(p_space)$q$),
      ($q$public.pilo_graph_overview(text[],text)$q$,
       $q$public.has_role_at_least('admin')$q$, $q$public.pilo_can_space(coalesce(p_space, 'planeacion'))$q$),
      -- El catálogo de respuestas oficiales y lo que cuelga de él.
      ($q$public.pilo_catalog_import(text,jsonb,boolean,text)$q$,
       $q$public.has_role_at_least('admin')$q$, $q$public.pilo_can_space(coalesce(p_space, 'planeacion'))$q$),
      ($q$public.pilo_premise_save(text,text,text,boolean)$q$,
       $q$public.has_role_at_least('admin')$q$, $q$public.pilo_can_catalog_key(p_key)$q$),
      ($q$public.pilo_premise_clear(text)$q$,
       $q$public.has_role_at_least('admin')$q$, $q$public.pilo_can_catalog_key(p_key)$q$),
      ($q$public.pilo_inbox_close(bigint,text,text)$q$,
       $q$public.has_role_at_least('admin')$q$,
       $q$public.pilo_can_space(coalesce((select i.space from public.pilo_inbox i where i.id = p_id), ''))$q$),
      -- Lecturas de portales que se guardan como documento, y el uso del espacio.
      ($q$public.pilo_reading_decide(uuid,text,uuid)$q$,
       $q$public.has_role_at_least('admin')$q$,
       $q$public.pilo_can_space(coalesce((select x.space from public.pilo_readings x where x.id = p_id), ''))$q$),
      ($q$public.pilo_space_usage(text)$q$,
       $q$public.has_role_at_least('admin')$q$, $q$public.pilo_can_space(v_space)$q$),
      -- Las colecciones donde se guardan los documentos.
      ($q$public.pilo_collection_create(text,text,boolean)$q$,
       $q$public.has_role_at_least('admin')$q$, $q$public.pilo_can_space(coalesce(p_scope, ''))$q$),
      ($q$public.pilo_collection_rename(text,text)$q$,
       $q$public.has_role_at_least('admin')$q$,
       $q$public.pilo_can_space(coalesce((select s.scope from public.pilo_sources s where s.id = p_id), ''))$q$),
      ($q$public.pilo_collection_delete(text)$q$,
       $q$public.has_role_at_least('admin')$q$,
       $q$public.pilo_can_space(coalesce((select s.scope from public.pilo_sources s where s.id = p_id), ''))$q$)
    ) as t(sig, gate, repl)
  loop
    v_oid := to_regprocedure(r.sig);
    if v_oid is null then
      raise warning 'pilo_0146: no existe %: no se cambió su compuerta.', r.sig;
      continue;
    end if;
    v_def := pg_get_functiondef(v_oid);
    if position(r.gate in v_def) = 0 then
      if position(r.repl in v_def) = 0 then
        raise warning 'pilo_0146: % no trae el chequeo esperado (%): revíselo a mano.', r.sig, r.gate;
      end if;
      continue;
    end if;
    execute replace(v_def, r.gate, r.repl);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Todo lo demás de Pilo sigue exigiendo admin, pero ahora vale también el admin
-- de pilo_staff: en las funciones pilo_*, el chequeo directo
-- `has_role_at_least('admin')` pasa a `pilo_is_admin()` (misma semántica: solo
-- cambia de dónde sale el admin). Quedan excluidas pilo_staff_role (que lo usa a
-- propósito) y todo lo que no empiece por pilo_ (Impacto y PDI no se tocan).
-- Va DESPUÉS del bloque anterior: lo que ya se abrió por espacio no lo trae.
-- -----------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname like 'pilo\_%'
      and p.proname <> 'pilo_staff_role'
      and p.prosrc like '%public.has_role_at_least(''admin'')%'
  loop
    execute replace(r.def, 'public.has_role_at_least(''admin'')', 'public.pilo_is_admin()');
  end loop;
end $$;

-- Lo mismo en las políticas: las de tablas pilo_* (y las del bucket pilo-voz)
-- que todavía pregunten por has_role_at_least('admin') preguntan por
-- pilo_is_admin(). Las de por espacio de arriba ya no la traen. Solo cambia la
-- expresión: el comando, los roles y los permisos de cada política quedan.
do $$
declare
  r record;
  v_pat constant text := '(public\.)?has_role_at_least\(''admin''(::(public\.)?app_role)?\)';
  v_sql text;
begin
  for r in
    select pol.polname, n.nspname, c.relname,
           pg_get_expr(pol.polqual, pol.polrelid) as q,
           pg_get_expr(pol.polwithcheck, pol.polrelid) as w
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where ((n.nspname = 'public' and c.relname like 'pilo\_%' and c.relname <> 'pilo_staff')
        or (n.nspname = 'storage' and c.relname = 'objects' and pol.polname like 'pilo\_%'))
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') ~ v_pat
        or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') ~ v_pat)
  loop
    v_sql := format('alter policy %I on %I.%I', r.polname, r.nspname, r.relname);
    if r.q is not null then
      v_sql := v_sql || ' using (' || regexp_replace(r.q, v_pat, 'public.pilo_is_admin()', 'g') || ')';
    end if;
    if r.w is not null then
      v_sql := v_sql || ' with check (' || regexp_replace(r.w, v_pat, 'public.pilo_is_admin()', 'g') || ')';
    end if;
    begin
      execute v_sql;
    exception
      when insufficient_privilege then
        raise warning 'pilo_0146: no se pudo cambiar la política % de %.%: cámbiela a mano por public.pilo_is_admin().', r.polname, r.nspname, r.relname;
    end;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Las pantallas del personal. Solo el admin (salvo pilo_staff_touch, cada quien).
-- -----------------------------------------------------------------------------

-- Todo el personal, con si confirmó su correo. Las filas son las de PiloStaffRow
-- (src/lib/pilo-staff.ts) más `confirmed`.
create or replace function public.pilo_staff_list()
returns table (
  user_id uuid,
  email text,
  full_name text,
  role text,
  active boolean,
  created_at timestamptz,
  last_seen_at timestamptz,
  confirmed boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_admin() then
    raise exception 'Solo la administración ve el personal de Pilo.' using errcode = '42501';
  end if;
  return query
    select s.user_id, s.email, s.full_name, s.role, s.active, s.created_at, s.last_seen_at,
           (a.email_confirmed_at is not null) as confirmed
    from public.pilo_staff s
    left join auth.users a on a.id = s.user_id
    order by s.active desc, s.full_name, s.email;
end;
$$;

revoke all on function public.pilo_staff_list() from public, anon;
grant execute on function public.pilo_staff_list() to authenticated;

-- Cambia el rol y/o activa o desactiva a una persona del personal. Un parámetro
-- en null no se cambia. El último admin activo no se rebaja ni se desactiva a
-- sí mismo. Devuelve la fila resultante.
create or replace function public.pilo_staff_set(p_user uuid, p_role text default null, p_active boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_staff;
  v_role text;
  v_active boolean;
begin
  if not public.pilo_is_admin() then
    raise exception 'Solo la administración cambia el personal de Pilo.' using errcode = '42501';
  end if;
  if p_user is null then
    raise exception 'Falta la persona.' using errcode = '22023';
  end if;
  if p_role is not null and p_role not in ('docencia', 'institucional', 'ambos', 'admin') then
    raise exception 'Rol desconocido: %', p_role using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('pilo_staff_admins'));
  select * into v_row from public.pilo_staff where user_id = p_user for update;
  if not found then
    raise exception 'Esa persona no está en el personal de Pilo.' using errcode = '22023';
  end if;
  v_role := coalesce(p_role, v_row.role);
  v_active := coalesce(p_active, v_row.active);

  if p_user = auth.uid() and v_row.active and v_row.role = 'admin' and (v_role <> 'admin' or not v_active)
     and public.pilo_staff_other_admins(p_user) = 0 then
    raise exception 'Usted es el último administrador activo de Pilo: nómbre a otro antes de dejar de serlo.' using errcode = '42501';
  end if;

  update public.pilo_staff set role = v_role, active = v_active
  where user_id = p_user
  returning * into v_row;
  return to_jsonb(v_row);
end;
$$;

revoke all on function public.pilo_staff_set(uuid, text, boolean) from public, anon;
grant execute on function public.pilo_staff_set(uuid, text, boolean) to authenticated;

-- La persona anota su último ingreso. Si no está en el personal (o está
-- desactivada) no hace nada.
create or replace function public.pilo_staff_touch()
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.pilo_staff set last_seen_at = now()
  where user_id = auth.uid() and active
$$;

revoke all on function public.pilo_staff_touch() from public, anon;
grant execute on function public.pilo_staff_touch() to authenticated;

notify pgrst, 'reload schema';
