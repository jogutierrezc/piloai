-- =============================================================================
-- 0116 · Mr. Pilo en Enseñanza: los cursos de Moodle.
--
-- La función pilo-ia lee cursos de Moodle por su API (servicios web, REST) con
-- un token de un usuario técnico de solo lectura. El token es un secreto: se
-- guarda aparte, igual que las claves de la IA (pilo_ai_secret, 0089).
--
--   pilo_space_secret         el token de Moodle de cada espacio. RLS sin
--                             políticas y sin permisos para nadie del portal:
--                             solo lo lee el rol de servicio (la función).
--   pilo_space_set_secret(espacio, cuál, valor)
--                             guarda el token; devuelve solo sus 4 últimos
--                             caracteres. Solo la administración.
--   pilo_space_secret_status(espacio)
--                             si hay token, sus 4 últimos y cuándo se cambió.
--
--   pilo_spaces               suma moodle_on, moodle_url (solo https),
--                             moodle_site (lo que respondió el sitio al probar)
--                             y moodle_checked_at. No salen en la configuración
--                             pública.
--
--   pilo_moodle_courses       los cursos que se vieron en Moodle. Cada curso
--                             elegido es un documento (pilo_docs: origen
--                             «moodle», clase «curso», colección «moodle») y sus
--                             pasajes heredan su visibilidad: «sesion» de
--                             partida. La administración la lee; se escribe por
--                             función.
--   pilo_moodle_courses_save(espacio, filas)
--                             anota los cursos que devolvió Moodle, sin tocar
--                             lo elegido ni la visibilidad.
--   pilo_moodle_course_set(espacio, curso, cambios)
--                             elige o suelta un curso, cambia su visibilidad o
--                             anota su lectura; la visibilidad y el «elegido»
--                             llegan a su documento y a sus pasajes (un curso
--                             que no está elegido deja sus pasajes ocultos).
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0114.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El secreto.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_space_secret (
  space         text primary key references public.pilo_spaces (id) on delete cascade,
  moodle_token  text not null default '',
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint pilo_space_secret_len check (length(moodle_token) <= 200)
);

comment on table public.pilo_space_secret is
  'Mr. Pilo: secretos de cada espacio (token de Moodle). Nadie los lee desde el portal: solo la función del servidor, con el rol de servicio.';

insert into public.pilo_space_secret (space)
select sp.id from public.pilo_spaces sp
on conflict (space) do nothing;

alter table public.pilo_space_secret enable row level security;
revoke all on public.pilo_space_secret from public, anon, authenticated;
grant select on public.pilo_space_secret to service_role;

create or replace function public.pilo_space_set_secret(p_space text, p_which text, p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := regexp_replace(coalesce(p_value, ''), '\s', '', 'g');
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración guarda los secretos de Pilo.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pilo_spaces sp where sp.id = p_space) then
    raise exception 'Espacio desconocido: %', p_space using errcode = '22023';
  end if;
  if coalesce(p_which, '') not in ('moodle', 'moodle_token') then
    raise exception 'El secreto es «moodle».' using errcode = '22023';
  end if;
  if length(clean) > 200 then
    raise exception 'El token es demasiado largo.' using errcode = '22023';
  end if;
  insert into public.pilo_space_secret as k (space, moodle_token, updated_by, updated_at)
  values (p_space, clean, auth.uid(), now())
  on conflict (space) do update set moodle_token = excluded.moodle_token, updated_by = excluded.updated_by, updated_at = now();
  return case when clean = '' then '' else right(clean, 4) end;
end;
$$;

revoke all on function public.pilo_space_set_secret(text, text, text) from public, anon;
grant execute on function public.pilo_space_set_secret(text, text, text) to authenticated;

create or replace function public.pilo_space_secret_status(p_space text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := '';
  v_at timestamptz;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración ve el estado de los secretos de Pilo.' using errcode = '42501';
  end if;
  select k.moodle_token, k.updated_at into v_token, v_at from public.pilo_space_secret k where k.space = p_space;
  return jsonb_build_object(
    'space', p_space,
    'moodle', jsonb_build_object('has', coalesce(v_token, '') <> '', 'last4', right(coalesce(v_token, ''), 4)),
    'updated_at', v_at
  );
end;
$$;

revoke all on function public.pilo_space_secret_status(text) from public, anon;
grant execute on function public.pilo_space_secret_status(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- La conexión con Moodle, en la ficha del espacio. La dirección solo puede ser
-- https (la función revisa además que no sea una dirección interna).
-- -----------------------------------------------------------------------------

alter table public.pilo_spaces add column if not exists moodle_on boolean not null default false;
alter table public.pilo_spaces add column if not exists moodle_url text not null default '';
alter table public.pilo_spaces add column if not exists moodle_site jsonb not null default '{}'::jsonb;
alter table public.pilo_spaces add column if not exists moodle_checked_at timestamptz;

alter table public.pilo_spaces drop constraint if exists pilo_spaces_moodle_url;
alter table public.pilo_spaces add constraint pilo_spaces_moodle_url
  check (moodle_url = '' or (moodle_url ~ '^https://[^\s/?#@]+' and moodle_url !~ '\s' and length(moodle_url) <= 300));
alter table public.pilo_spaces drop constraint if exists pilo_spaces_moodle_site;
alter table public.pilo_spaces add constraint pilo_spaces_moodle_site check (jsonb_typeof(moodle_site) = 'object');

comment on column public.pilo_spaces.moodle_url is 'La dirección del Moodle (solo https). El token va aparte, en pilo_space_secret.';

-- -----------------------------------------------------------------------------
-- Los cursos.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_moodle_courses (
  space          text not null references public.pilo_spaces (id) on delete cascade,
  course_id      bigint not null,
  category_id    bigint,
  category_name  text not null default '',
  shortname      text not null default '',
  fullname       text not null default '',
  selected       boolean not null default false,
  vis            text not null default 'sesion',
  doc_id         uuid references public.pilo_docs (id) on delete set null,
  time_modified  bigint,
  synced_at      timestamptz,
  content_hash   text not null default '',
  status         text not null default '',
  error          text not null default '',
  updated_at     timestamptz not null default now(),
  primary key (space, course_id),
  constraint pilo_moodle_courses_vis check (vis in ('publico', 'sesion')),
  constraint pilo_moodle_courses_len check (
    length(category_name) <= 300 and length(shortname) <= 300 and length(fullname) <= 300
    and length(content_hash) <= 128 and length(status) <= 40 and length(error) <= 600
  )
);

create index if not exists pilo_moodle_courses_doc_idx on public.pilo_moodle_courses (doc_id) where doc_id is not null;

comment on table public.pilo_moodle_courses is
  'Mr. Pilo: los cursos de Moodle que se vieron por la API. Los elegidos se leen y quedan como documentos (pilo_docs). La administración la lee; se escribe por pilo_moodle_courses_save y pilo_moodle_course_set.';

alter table public.pilo_moodle_courses enable row level security;

drop policy if exists pilo_moodle_courses_admin on public.pilo_moodle_courses;
create policy pilo_moodle_courses_admin on public.pilo_moodle_courses
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_moodle_courses from public, anon, authenticated;
grant select on public.pilo_moodle_courses to authenticated, service_role;

-- Anotar los cursos que devolvió Moodle. No cambia «selected» ni «vis».
create or replace function public.pilo_moodle_courses_save(p_space text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración anotan los cursos de Moodle.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pilo_spaces sp where sp.id = p_space) then
    raise exception 'Espacio desconocido: %', p_space using errcode = '22023';
  end if;

  insert into public.pilo_moodle_courses as c (space, course_id, category_id, category_name, shortname, fullname, time_modified, updated_at)
  select distinct on (coalesce(r->>'course_id', r->>'id'))
    p_space, coalesce(r->>'course_id', r->>'id')::bigint,
    case when coalesce(r->>'category_id', '') ~ '^[0-9]{1,15}$' then (r->>'category_id')::bigint else null end,
    left(coalesce(r->>'category_name', ''), 300), left(coalesce(r->>'shortname', ''), 300), left(coalesce(r->>'fullname', ''), 300),
    case when coalesce(r->>'time_modified', '') ~ '^[0-9]{1,15}$' then (r->>'time_modified')::bigint else null end,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'course_id', r->>'id', '') ~ '^[0-9]{1,15}$'
  on conflict (space, course_id) do update set
    category_id = coalesce(excluded.category_id, c.category_id),
    category_name = case when excluded.category_name <> '' then excluded.category_name else c.category_name end,
    shortname = excluded.shortname, fullname = excluded.fullname,
    time_modified = coalesce(excluded.time_modified, c.time_modified),
    updated_at = now();
  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

revoke all on function public.pilo_moodle_courses_save(text, jsonb) from public, anon;
grant execute on function public.pilo_moodle_courses_save(text, jsonb) to authenticated, service_role;

-- Cambiar un curso. «cambios» admite: selected, vis, doc_id, status, error,
-- content_hash, time_modified y synced (true = se acaba de leer). Si el curso
-- tiene documento, su visibilidad y si está elegido llegan al documento y de
-- ahí a sus pasajes: un curso suelto deja sus pasajes ocultos.
create or replace function public.pilo_moodle_course_set(p_space text, p_course bigint, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_new public.pilo_moodle_courses;
  v_doc uuid;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración cambian los cursos de Moodle.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Los cambios deben ser un objeto.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pilo_moodle_courses c where c.space = p_space and c.course_id = p_course) then
    raise exception 'Ese curso no está anotado en este espacio.' using errcode = '22023';
  end if;

  if coalesce(v_patch->>'doc_id', '') <> '' then
    v_doc := (v_patch->>'doc_id')::uuid;
    if not exists (
      select 1 from public.pilo_docs d
      where d.id = v_doc and d.space = p_space and d.origin = 'moodle' and d.external_id = p_course::text
    ) then
      raise exception 'Ese documento no es el de este curso.' using errcode = '22023';
    end if;
  end if;

  update public.pilo_moodle_courses c set
    selected = case when jsonb_typeof(v_patch->'selected') = 'boolean' then (v_patch->>'selected')::boolean else c.selected end,
    vis = coalesce(nullif(v_patch->>'vis', ''), c.vis),
    doc_id = coalesce(v_doc, c.doc_id),
    status = case when v_patch ? 'status' then left(coalesce(v_patch->>'status', ''), 40) else c.status end,
    error = case when v_patch ? 'error' then left(coalesce(v_patch->>'error', ''), 600) else c.error end,
    content_hash = case when v_patch ? 'content_hash' then left(coalesce(v_patch->>'content_hash', ''), 128) else c.content_hash end,
    time_modified = case when jsonb_typeof(v_patch->'time_modified') = 'number' then (v_patch->>'time_modified')::bigint else c.time_modified end,
    synced_at = case when v_patch->>'synced' = 'true' then now() else c.synced_at end,
    updated_at = now()
  where c.space = p_space and c.course_id = p_course
  returning c.* into v_new;

  if v_new.doc_id is not null then
    perform public.pilo_doc_update(v_new.doc_id, jsonb_build_object('vis', v_new.vis, 'active', v_new.selected));
  end if;

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.pilo_moodle_course_set(text, bigint, jsonb) from public, anon;
grant execute on function public.pilo_moodle_course_set(text, bigint, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
