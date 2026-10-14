-- =============================================================================
-- 0133 · Mr. Pilo en Enseñanza: varios sitios de Moodle.
--
-- La universidad no tiene un solo Moodle: hay varios servidores. Hasta aquí la
-- conexión era una (pilo_spaces.moodle_url y un token en pilo_space_secret,
-- 0116). Desde aquí es una lista de sitios, cada uno con su dirección, su
-- token, su interruptor y sus cursos.
--
--   pilo_moodle_sites         un sitio de Moodle de un espacio: id corto y
--                             estable (minúsculas, números y guiones), el
--                             nombre que ve la gente, la dirección (solo
--                             https), si está encendido, lo que respondió al
--                             probarlo y cuándo. Hasta 12 por espacio. La
--                             administración la lee; se escribe por función.
--                             Un sitio encendido es también uno de los que la
--                             app ofrece en «Mis clases» (función pilo-clases).
--   pilo_moodle_site_secret   el token de cada sitio. RLS sin políticas y sin
--                             permisos para nadie del portal: solo lo lee el
--                             rol de servicio (la función).
--   pilo_moodle_site_save(espacio, sitio, cambios)
--                             crea el sitio o lo cambia: name, url, enabled.
--                             Cambiar la dirección borra la prueba anterior.
--   pilo_moodle_site_set_token(espacio, sitio, valor)
--                             guarda el token; devuelve solo sus 4 últimos.
--   pilo_moodle_sites_status(espacio)
--                             por sitio: si hay token, sus 4 últimos y cuándo.
--   pilo_moodle_site_delete(espacio, sitio)
--                             quita el sitio con su token, sus cursos y los
--                             documentos de esos cursos (y sus pasajes).
--
--   pilo_moodle_courses       suma `site`: un curso es de un sitio, y el mismo
--                             número de curso puede existir en dos sitios.
--   pilo_moodle_courses_save(espacio, sitio, filas)
--   pilo_moodle_course_set(espacio, sitio, curso, cambios)
--                             las de 0116, ahora con el sitio. Las firmas
--                             viejas se retiran.
--   pilo_docs.external_id     de un curso pasa de «42» a «sitio:42».
--
-- Lo que ya había: la conexión de 0116 pasa a ser el sitio «principal», con su
-- dirección, su token, su prueba y sus cursos. Las columnas moodle_* de
-- pilo_spaces y pilo_space_secret.moodle_token quedan vacías y ya no se leen.
--
-- Va junto con las funciones pilo-ia y pilo-clases de esta misma entrega: las
-- anteriores llaman las firmas viejas y dejan de leer Moodle hasta desplegar.
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0116 y
-- 0121. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Los sitios.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_moodle_sites (
  space       text not null references public.pilo_spaces (id) on delete cascade,
  id          text not null,
  name        text not null,
  url         text not null default '',
  enabled     boolean not null default false,
  site        jsonb not null default '{}'::jsonb,
  checked_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (space, id),
  constraint pilo_moodle_sites_id check (id ~ '^[a-z][a-z0-9-]{1,23}$'),
  constraint pilo_moodle_sites_name check (length(name) between 1 and 60 and name = btrim(name) and name !~ '[[:cntrl:]]'),
  constraint pilo_moodle_sites_url check (url = '' or (url ~ '^https://[^\s/?#@]+' and url !~ '\s' and length(url) <= 300)),
  constraint pilo_moodle_sites_site check (jsonb_typeof(site) = 'object'),
  constraint pilo_moodle_sites_enabled check (not enabled or url <> '')
);

create unique index if not exists pilo_moodle_sites_name_idx on public.pilo_moodle_sites (space, lower(name));

comment on table public.pilo_moodle_sites is
  'Mr. Pilo: los sitios de Moodle de un espacio (0133). El token va aparte, en pilo_moodle_site_secret. La administración la lee; se escribe por pilo_moodle_site_save y pilo_moodle_site_delete.';

alter table public.pilo_moodle_sites enable row level security;

drop policy if exists pilo_moodle_sites_admin on public.pilo_moodle_sites;
create policy pilo_moodle_sites_admin on public.pilo_moodle_sites
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_moodle_sites from public, anon, authenticated;
grant select on public.pilo_moodle_sites to authenticated;
-- La función anota lo que respondió el sitio al probarlo.
grant select, update on public.pilo_moodle_sites to service_role;

create table if not exists public.pilo_moodle_site_secret (
  space       text not null,
  site        text not null,
  token       text not null default '',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (space, site),
  constraint pilo_moodle_site_secret_site foreign key (space, site) references public.pilo_moodle_sites (space, id) on delete cascade,
  constraint pilo_moodle_site_secret_len check (length(token) <= 200)
);

comment on table public.pilo_moodle_site_secret is
  'Mr. Pilo: el token de cada sitio de Moodle (0133). Nadie lo lee desde el portal: solo la función del servidor, con el rol de servicio.';

alter table public.pilo_moodle_site_secret enable row level security;
revoke all on public.pilo_moodle_site_secret from public, anon, authenticated;
grant select on public.pilo_moodle_site_secret to service_role;

-- -----------------------------------------------------------------------------
-- Lo que ya había pasa a ser el sitio «principal».
-- -----------------------------------------------------------------------------

alter table public.pilo_moodle_courses add column if not exists site text not null default 'principal';

insert into public.pilo_moodle_sites (space, id, name, url, enabled, site, checked_at)
select sp.id, 'principal', 'Principal', sp.moodle_url, sp.moodle_on and sp.moodle_url <> '', sp.moodle_site, sp.moodle_checked_at
from public.pilo_spaces sp
where (
    sp.moodle_url <> ''
    or exists (select 1 from public.pilo_space_secret k where k.space = sp.id and k.moodle_token <> '')
    or exists (select 1 from public.pilo_moodle_courses c where c.space = sp.id and c.site = 'principal')
  )
on conflict (space, id) do nothing;

insert into public.pilo_moodle_site_secret (space, site, token, updated_by, updated_at)
select k.space, 'principal', k.moodle_token, k.updated_by, k.updated_at
from public.pilo_space_secret k
where k.moodle_token <> ''
  and exists (select 1 from public.pilo_moodle_sites s where s.space = k.space and s.id = 'principal')
on conflict (space, site) do nothing;

-- Un secreto no vive en dos sitios: el que ya se copió se borra de donde estaba.
update public.pilo_space_secret k
set moodle_token = ''
where k.moodle_token <> ''
  and exists (select 1 from public.pilo_moodle_site_secret s where s.space = k.space and s.site = 'principal' and s.token = k.moodle_token);

update public.pilo_spaces sp
set moodle_on = false, moodle_url = '', moodle_site = '{}'::jsonb, moodle_checked_at = null
where (sp.moodle_on or sp.moodle_url <> '' or sp.moodle_site <> '{}'::jsonb or sp.moodle_checked_at is not null)
  and exists (select 1 from public.pilo_moodle_sites s where s.space = sp.id and s.id = 'principal');

comment on column public.pilo_spaces.moodle_url is 'Retirada (0133): los sitios de Moodle están en pilo_moodle_sites. Ya no se lee.';
comment on column public.pilo_spaces.moodle_on is 'Retirada (0133): cada sitio de pilo_moodle_sites tiene su interruptor. Ya no se lee.';

-- Los cursos son de un sitio.
alter table public.pilo_moodle_courses alter column site drop default;
alter table public.pilo_moodle_courses drop constraint if exists pilo_moodle_courses_pkey;
alter table public.pilo_moodle_courses add primary key (space, site, course_id);
alter table public.pilo_moodle_courses drop constraint if exists pilo_moodle_courses_site;
alter table public.pilo_moodle_courses add constraint pilo_moodle_courses_site
  foreign key (space, site) references public.pilo_moodle_sites (space, id) on delete cascade;

-- El documento de un curso se reconoce por «sitio:curso».
update public.pilo_docs d
set external_id = 'principal:' || d.external_id
where d.origin = 'moodle' and d.external_id ~ '^[0-9]+$';

-- -----------------------------------------------------------------------------
-- Crear o cambiar un sitio.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_moodle_site_save(p_space text, p_site text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_old public.pilo_moodle_sites;
  v_new public.pilo_moodle_sites;
  v_name text;
  v_url text;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cambia los sitios de Moodle.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Los cambios deben ser un objeto.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pilo_spaces sp where sp.id = p_space) then
    raise exception 'Espacio desconocido: %', p_space using errcode = '22023';
  end if;
  v_name := case when v_patch ? 'name' then btrim(regexp_replace(coalesce(v_patch->>'name', ''), '\s+', ' ', 'g')) else null end;
  v_url := case when v_patch ? 'url' then regexp_replace(btrim(coalesce(v_patch->>'url', '')), '/+$', '') else null end;

  select * into v_old from public.pilo_moodle_sites s where s.space = p_space and s.id = p_site for update;
  if not found then
    if coalesce(v_name, '') = '' then
      raise exception 'Un sitio nuevo necesita un nombre.' using errcode = '22023';
    end if;
    if (select count(*) from public.pilo_moodle_sites s where s.space = p_space) >= 12 then
      raise exception 'Ya hay 12 sitios de Moodle: quite uno antes de agregar otro.' using errcode = '22023';
    end if;
    insert into public.pilo_moodle_sites (space, id, name, url, enabled)
    values (p_space, p_site, v_name, coalesce(v_url, ''), coalesce((v_patch->>'enabled')::boolean, false))
    returning * into v_new;
    return to_jsonb(v_new);
  end if;

  update public.pilo_moodle_sites s set
    name = coalesce(nullif(v_name, ''), s.name),
    url = coalesce(v_url, s.url),
    enabled = case when jsonb_typeof(v_patch->'enabled') = 'boolean' then (v_patch->>'enabled')::boolean else s.enabled end,
    -- Otra dirección es otro sitio: lo que respondió el anterior ya no vale.
    site = case when v_url is not null and v_url <> s.url then '{}'::jsonb else s.site end,
    checked_at = case when v_url is not null and v_url <> s.url then null else s.checked_at end,
    updated_at = now()
  where s.space = p_space and s.id = p_site
  returning s.* into v_new;
  return to_jsonb(v_new);
end;
$$;

revoke all on function public.pilo_moodle_site_save(text, text, jsonb) from public, anon;
grant execute on function public.pilo_moodle_site_save(text, text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- El token de un sitio.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_moodle_site_set_token(p_space text, p_site text, p_value text)
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
  if not exists (select 1 from public.pilo_moodle_sites s where s.space = p_space and s.id = p_site) then
    raise exception 'Ese sitio de Moodle no existe en este espacio.' using errcode = '22023';
  end if;
  if length(clean) > 200 then
    raise exception 'El token es demasiado largo.' using errcode = '22023';
  end if;
  insert into public.pilo_moodle_site_secret as k (space, site, token, updated_by, updated_at)
  values (p_space, p_site, clean, auth.uid(), now())
  on conflict (space, site) do update set token = excluded.token, updated_by = excluded.updated_by, updated_at = now();
  return case when clean = '' then '' else right(clean, 4) end;
end;
$$;

revoke all on function public.pilo_moodle_site_set_token(text, text, text) from public, anon;
grant execute on function public.pilo_moodle_site_set_token(text, text, text) to authenticated;

create or replace function public.pilo_moodle_sites_status(p_space text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración ve el estado de los secretos de Pilo.' using errcode = '42501';
  end if;
  return coalesce(
    (
      select jsonb_object_agg(s.id, jsonb_build_object('has', coalesce(k.token, '') <> '', 'last4', right(coalesce(k.token, ''), 4), 'updated_at', k.updated_at))
      from public.pilo_moodle_sites s
      left join public.pilo_moodle_site_secret k on k.space = s.space and k.site = s.id
      where s.space = p_space
    ),
    '{}'::jsonb
  );
end;
$$;

revoke all on function public.pilo_moodle_sites_status(text) from public, anon;
grant execute on function public.pilo_moodle_sites_status(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Quitar un sitio, con sus cursos y lo que Pilo leyó de ellos.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_moodle_site_delete(p_space text, p_site text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc uuid;
  v_docs integer := 0;
  v_courses integer := 0;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración quita los sitios de Moodle.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.pilo_moodle_sites s where s.space = p_space and s.id = p_site) then
    raise exception 'Ese sitio de Moodle no existe en este espacio.' using errcode = '22023';
  end if;
  for v_doc in
    select d.id from public.pilo_docs d
    where d.space = p_space and d.origin = 'moodle' and starts_with(d.external_id, p_site || ':')
  loop
    perform public.pilo_doc_delete(v_doc);
    v_docs := v_docs + 1;
  end loop;
  select count(*) into v_courses from public.pilo_moodle_courses c where c.space = p_space and c.site = p_site;
  delete from public.pilo_moodle_sites s where s.space = p_space and s.id = p_site;
  return jsonb_build_object('site', p_site, 'courses', v_courses, 'docs', v_docs);
end;
$$;

revoke all on function public.pilo_moodle_site_delete(text, text) from public, anon;
grant execute on function public.pilo_moodle_site_delete(text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Los cursos, con su sitio. Las firmas de 0116 se retiran.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_moodle_courses_save(text, jsonb);
drop function if exists public.pilo_moodle_course_set(text, bigint, jsonb);

-- Anotar los cursos que devolvió un sitio. No cambia «selected» ni «vis».
create or replace function public.pilo_moodle_courses_save(p_space text, p_site text, p_rows jsonb)
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
  if not exists (select 1 from public.pilo_moodle_sites s where s.space = p_space and s.id = p_site) then
    raise exception 'Ese sitio de Moodle no existe en este espacio.' using errcode = '22023';
  end if;

  insert into public.pilo_moodle_courses as c (space, site, course_id, category_id, category_name, shortname, fullname, time_modified, updated_at)
  select distinct on (coalesce(r->>'course_id', r->>'id'))
    p_space, p_site, coalesce(r->>'course_id', r->>'id')::bigint,
    case when coalesce(r->>'category_id', '') ~ '^[0-9]{1,15}$' then (r->>'category_id')::bigint else null end,
    left(coalesce(r->>'category_name', ''), 300), left(coalesce(r->>'shortname', ''), 300), left(coalesce(r->>'fullname', ''), 300),
    case when coalesce(r->>'time_modified', '') ~ '^[0-9]{1,15}$' then (r->>'time_modified')::bigint else null end,
    now()
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'course_id', r->>'id', '') ~ '^[0-9]{1,15}$'
  on conflict (space, site, course_id) do update set
    category_id = coalesce(excluded.category_id, c.category_id),
    category_name = case when excluded.category_name <> '' then excluded.category_name else c.category_name end,
    shortname = excluded.shortname, fullname = excluded.fullname,
    time_modified = coalesce(excluded.time_modified, c.time_modified),
    updated_at = now();
  get diagnostics v_saved = row_count;
  return v_saved;
end;
$$;

revoke all on function public.pilo_moodle_courses_save(text, text, jsonb) from public, anon;
grant execute on function public.pilo_moodle_courses_save(text, text, jsonb) to authenticated, service_role;

-- Cambiar un curso. «cambios» admite lo mismo que en 0116. El documento de un
-- curso es el de ese sitio y ese curso («sitio:curso»), nunca el de otro.
create or replace function public.pilo_moodle_course_set(p_space text, p_site text, p_course bigint, p_patch jsonb)
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
  if not exists (select 1 from public.pilo_moodle_courses c where c.space = p_space and c.site = p_site and c.course_id = p_course) then
    raise exception 'Ese curso no está anotado en este sitio.' using errcode = '22023';
  end if;

  if coalesce(v_patch->>'doc_id', '') <> '' then
    v_doc := (v_patch->>'doc_id')::uuid;
    if not exists (
      select 1 from public.pilo_docs d
      where d.id = v_doc and d.space = p_space and d.origin = 'moodle' and d.external_id = p_site || ':' || p_course::text
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
  where c.space = p_space and c.site = p_site and c.course_id = p_course
  returning c.* into v_new;

  if v_new.doc_id is not null then
    perform public.pilo_doc_update(v_new.doc_id, jsonb_build_object('vis', v_new.vis, 'active', v_new.selected));
  end if;

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.pilo_moodle_course_set(text, text, bigint, jsonb) from public, anon;
grant execute on function public.pilo_moodle_course_set(text, text, bigint, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
