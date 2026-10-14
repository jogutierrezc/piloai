-- =============================================================================
-- 0114 · Mr. Pilo en Enseñanza: los documentos de la memoria.
--
-- La administración sube DOCX, XLSX, CSV y PDF desde la intranet. El navegador
-- los lee y los parte en pasajes; aquí queda el archivo (bucket privado), su
-- ficha y sus pasajes, que son filas de pilo_memory como las de siempre: la
-- búsqueda por palabras, la búsqueda por significado y pilo_embed_pending los
-- toman sin cambio, dentro de su espacio.
--
--   pilo-docs                 bucket privado (25 MB; docx, xlsx, csv, pdf). Ruta
--                             <espacio>/<id del documento>/<nombre>. Solo la
--                             administración; la función usa la clave de servicio.
--   pilo_docs                 la ficha de cada documento (o curso de Moodle, 0116).
--                             La administración la lee; se escribe por función.
--   pilo_memory.doc_id        de qué documento es el pasaje. La llave va con el
--                             espacio (doc_id, space) → pilo_docs (id, space): un
--                             documento no puede tener pasajes en otro espacio.
--                             Borrar el documento borra sus pasajes.
--
--   pilo_doc_save(espacio, ficha)      crea la ficha o actualiza la que ya está
--                                      (mismo id, mismo archivo o mismo curso).
--   pilo_doc_replace(doc, filas)       deja los pasajes del documento iguales a
--                                      lo que llega. Como pilo_memory_replace:
--                                      solo el pasaje que cambió estrena fecha,
--                                      así los vectores, las marcas del mapa y
--                                      las respuestas guardadas de los demás
--                                      siguen valiendo.
--   pilo_doc_update(doc, cambios)      cambia la ficha y lleva título, colección
--                                      y visibilidad a sus pasajes. Inactivo =
--                                      pasajes «oculto».
--   pilo_doc_delete(doc)               borra el documento, sus pasajes, las
--                                      respuestas guardadas que lo citan, sus
--                                      nodos y relaciones, y los temas y
--                                      referencias que quedan sin relación.
--   pilo_map_prune(espacio)            borra temas y referencias sin relación.
--   pilo_doc_owns(doc, id)             ¿ese id de la malla es del documento?
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0113.
-- Idempotente. No toca ninguna fila existente: doc_id nace vacío.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Bucket privado pilo-docs. Donde no hay storage (o no hay permiso) se avisa y
-- la migración sigue, igual que en 0101.
-- -----------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'pilo-docs', 'pilo-docs', false, 26214400,
    array[
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/pdf', 'text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'
    ]
  )
  on conflict (id) do update set public = false, file_size_limit = 26214400, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists pilo_docs_lectura on storage.objects';
  execute $pol$
    create policy pilo_docs_lectura on storage.objects
      for select to authenticated
      using (bucket_id = 'pilo-docs' and public.has_role_at_least('admin'))
  $pol$;

  execute 'drop policy if exists pilo_docs_escritura on storage.objects';
  execute $pol$
    create policy pilo_docs_escritura on storage.objects
      for insert to authenticated
      with check (bucket_id = 'pilo-docs' and public.has_role_at_least('admin'))
  $pol$;

  execute 'drop policy if exists pilo_docs_cambio on storage.objects';
  execute $pol$
    create policy pilo_docs_cambio on storage.objects
      for update to authenticated
      using (bucket_id = 'pilo-docs' and public.has_role_at_least('admin'))
      with check (bucket_id = 'pilo-docs' and public.has_role_at_least('admin'))
  $pol$;

  execute 'drop policy if exists pilo_docs_borrado on storage.objects';
  execute $pol$
    create policy pilo_docs_borrado on storage.objects
      for delete to authenticated
      using (bucket_id = 'pilo-docs' and public.has_role_at_least('admin'))
  $pol$;
exception
  when insufficient_privilege or undefined_table or invalid_schema_name then
    raise warning
      'No se pudo preparar el bucket "pilo-docs" (%). Créelo a mano desde Storage: privado, 25 MB por archivo, docx/xlsx/csv/pdf; y con acceso solo para la administración.',
      sqlerrm;
end;
$$;

-- -----------------------------------------------------------------------------
-- La ficha de cada documento.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_docs (
  id             uuid primary key default gen_random_uuid(),
  space          text not null references public.pilo_spaces (id),
  origin         text not null default 'archivo',
  kind           text not null,
  source         text not null,
  title          text not null,
  file_path      text not null default '',
  file_name      text not null default '',
  file_size      bigint not null default 0,
  file_hash      text not null default '',
  external_id    text not null default '',
  vis            text not null default 'sesion',
  active         boolean not null default true,
  status         text not null default 'leido',
  status_detail  text not null default '',
  pages          integer not null default 0,
  passages       integer not null default 0,
  content_hash   text not null default '',
  understood_at  timestamptz,
  synced_at      timestamptz,
  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pilo_docs_id_space unique (id, space),
  constraint pilo_docs_origin check (origin in ('archivo', 'moodle')),
  constraint pilo_docs_kind check (kind in ('docx', 'xlsx', 'csv', 'pdf', 'curso')),
  constraint pilo_docs_source check (source in ('innovacion', 'politicas', 'global', 'moodle')),
  constraint pilo_docs_moodle check ((origin = 'moodle') = (kind = 'curso') and (origin = 'moodle') = (source = 'moodle')),
  constraint pilo_docs_vis check (vis in ('publico', 'sesion')),
  constraint pilo_docs_status check (status in ('leido', 'en_pasajes', 'entendido', 'en_mapa', 'escaneado', 'error')),
  constraint pilo_docs_len check (
    length(title) between 1 and 300 and length(file_path) <= 500 and length(file_name) <= 300
    and length(file_hash) <= 128 and length(external_id) <= 120 and length(status_detail) <= 600 and length(content_hash) <= 128
  ),
  constraint pilo_docs_numbers check (file_size between 0 and 26214400 and pages >= 0 and passages >= 0),
  constraint pilo_docs_path check (file_path = '' or left(file_path, length(space) + 38) = space || '/' || id::text || '/')
);

create unique index if not exists pilo_docs_hash_idx on public.pilo_docs (space, file_hash) where origin = 'archivo' and file_hash <> '';
create unique index if not exists pilo_docs_external_idx on public.pilo_docs (space, origin, external_id) where external_id <> '';
create index if not exists pilo_docs_space_idx on public.pilo_docs (space, source, created_at desc);

comment on table public.pilo_docs is
  'Mr. Pilo: los documentos (y cursos de Moodle) de la memoria de un espacio. Sus pasajes están en pilo_memory (doc_id). La administración la lee; se escribe por pilo_doc_save, pilo_doc_replace, pilo_doc_update y pilo_doc_delete.';
comment on column public.pilo_docs.vis is 'Quién puede recibir sus pasajes: «publico» o «sesion» (solo con sesión). Inactivo = nadie.';
comment on column public.pilo_docs.file_path is 'Ruta en el bucket pilo-docs: <espacio>/<id>/<nombre>.';

alter table public.pilo_docs enable row level security;

drop policy if exists pilo_docs_admin on public.pilo_docs;
create policy pilo_docs_admin on public.pilo_docs
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_docs from public, anon, authenticated;
grant select on public.pilo_docs to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- El pasaje sabe de qué documento es. La llave lleva el espacio: un documento
-- de un espacio no puede tener pasajes en otro. Ninguna fila de hoy tiene
-- doc_id, así que la llave se añade sin revisar nada.
-- -----------------------------------------------------------------------------

alter table public.pilo_memory add column if not exists doc_id uuid;

comment on column public.pilo_memory.doc_id is 'El documento (pilo_docs) del que salió el pasaje. Vacío en los pasajes de los portales.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pilo_memory_doc' and conrelid = 'public.pilo_memory'::regclass
  ) then
    alter table public.pilo_memory
      add constraint pilo_memory_doc foreign key (doc_id, space) references public.pilo_docs (id, space) on delete cascade;
  end if;
end $$;

create index if not exists pilo_memory_doc_idx on public.pilo_memory (doc_id) where doc_id is not null;

-- -----------------------------------------------------------------------------
-- ¿Ese id de la malla (o ese ref de pasaje) es del documento? Son suyos su
-- nodo «doc:<id>», sus secciones «doc:<id>#…» y sus pasajes «doc:<id>:<n>».
-- -----------------------------------------------------------------------------

create or replace function public.pilo_doc_owns(p_doc uuid, p_id text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_id = 'doc:' || p_doc::text
      or starts_with(p_id, 'doc:' || p_doc::text || '#')
      or starts_with(p_id, 'doc:' || p_doc::text || ':')
$$;

revoke all on function public.pilo_doc_owns(uuid, text) from public, anon;
grant execute on function public.pilo_doc_owns(uuid, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Temas y referencias que se quedaron sin ninguna relación en su espacio.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_map_prune(p_space text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración limpian el mapa.' using errcode = '42501';
  end if;
  delete from public.pilo_nodes n
  where n.space = p_space and n.space <> 'planeacion' and n.source = 'mapa'
    and (starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:'))
    and not exists (
      select 1 from public.pilo_edges e
      where e.space = p_space and (e.from_id = n.id or e.to_id = n.id)
    );
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.pilo_map_prune(text) from public, anon;
grant execute on function public.pilo_map_prune(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Cambiar la ficha. Lo que toca a los pasajes se lleva a los pasajes:
--   título      los pasajes que llevaban el título del documento lo cambian y
--               estrenan fecha (el título es parte de lo que se busca).
--   colección   cambia en los pasajes y en su lugar del mapa.
--   vis/active  la visibilidad de los pasajes: la del documento, u «oculto» si
--               está inactivo. No estrena fecha: los vectores siguen valiendo.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_doc_update(p_doc uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old public.pilo_docs;
  v_new public.pilo_docs;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración cambian los documentos de la memoria.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Los cambios deben ser un objeto.' using errcode = '22023';
  end if;
  select * into v_old from public.pilo_docs where id = p_doc for update;
  if not found then
    raise exception 'Ese documento no existe.' using errcode = '22023';
  end if;

  update public.pilo_docs set
    title = case when btrim(coalesce(v_patch->>'title', '')) <> '' then left(btrim(v_patch->>'title'), 300) else title end,
    source = coalesce(nullif(v_patch->>'source', ''), source),
    vis = coalesce(nullif(v_patch->>'vis', ''), vis),
    active = case when jsonb_typeof(v_patch->'active') = 'boolean' then (v_patch->>'active')::boolean else active end,
    status = coalesce(nullif(v_patch->>'status', ''), status),
    status_detail = case when v_patch ? 'status_detail' then left(coalesce(v_patch->>'status_detail', ''), 600) else status_detail end,
    pages = case when jsonb_typeof(v_patch->'pages') = 'number' then greatest(0, (v_patch->>'pages')::integer) else pages end,
    file_path = case when v_patch ? 'file_path' then left(coalesce(v_patch->>'file_path', ''), 500) else file_path end,
    file_name = case when v_patch ? 'file_name' then left(coalesce(v_patch->>'file_name', ''), 300) else file_name end,
    file_size = case when jsonb_typeof(v_patch->'file_size') = 'number' then (v_patch->>'file_size')::bigint else file_size end,
    file_hash = case when v_patch ? 'file_hash' then left(coalesce(v_patch->>'file_hash', ''), 128) else file_hash end,
    content_hash = case when v_patch ? 'content_hash' then left(coalesce(v_patch->>'content_hash', ''), 128) else content_hash end,
    understood_at = case when v_patch->>'understood' = 'true' then now() when v_patch->>'understood' = 'false' then null else understood_at end,
    synced_at = case when v_patch->>'synced' = 'true' then now() else synced_at end,
    updated_at = now()
  where id = p_doc
  returning * into v_new;

  if (v_new.title, v_new.source, v_new.vis, v_new.active) is distinct from (v_old.title, v_old.source, v_old.vis, v_old.active) then
    update public.pilo_memory m set
      source = v_new.source,
      vis = case when v_new.active then v_new.vis else 'oculto' end,
      title = case when m.title = v_old.title then v_new.title else m.title end,
      updated_at = case when m.title = v_old.title and v_new.title <> v_old.title then now() else m.updated_at end
    where m.doc_id = p_doc;
  end if;

  if v_new.title <> v_old.title then
    update public.pilo_nodes n set label = v_new.title, updated_at = now()
    where n.space = v_new.space and n.id = 'doc:' || p_doc::text;
  end if;

  -- Cambió de colección: su nodo cuelga ahora de la otra.
  if v_new.source <> v_old.source and exists (select 1 from public.pilo_nodes n where n.space = v_new.space and n.id = 'doc:' || p_doc::text) then
    delete from public.pilo_edges e
    where e.space = v_new.space and e.rel = 'contiene' and e.from_id = 'fuente:' || v_old.source and e.to_id = 'doc:' || p_doc::text;
    insert into public.pilo_nodes (id, source, type, label, props, space)
    values ('fuente:' || v_new.source, 'mapa', 'fuente', v_new.source, jsonb_build_object('kind', 'fuente'), v_new.space)
    on conflict (id) do nothing;
    insert into public.pilo_edges (from_id, to_id, rel, source, space)
    values ('fuente:' || v_new.source, 'doc:' || p_doc::text, 'contiene', 'mapa', v_new.space)
    on conflict do nothing;
  end if;

  return to_jsonb(v_new);
end;
$$;

revoke all on function public.pilo_doc_update(uuid, jsonb) from public, anon;
grant execute on function public.pilo_doc_update(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guardar la ficha. Si ya está —por su id, por ser el mismo curso de Moodle o
-- por ser el mismo archivo (file_hash) en el espacio— se actualiza y se
-- devuelve el id que ya tenía. Si llegó por el mismo archivo pero con otro id,
-- la ruta y el nombre del archivo guardado no se tocan: quien llama ve que el
-- id devuelto no es el suyo y descarta lo que acaba de subir.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_doc_save(p_space text, p_doc jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_space, '');
  v_in jsonb := coalesce(p_doc, 'null'::jsonb);
  v_given uuid;
  v_id uuid;
  v_found_space text;
  v_origin text;
  v_hash text;
  v_ext text;
  v_patch jsonb;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración guardan documentos en la memoria.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    raise exception 'La ficha del documento debe ser un objeto.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pilo_spaces sp where sp.id = v_space) then
    raise exception 'Espacio desconocido: %', v_space using errcode = '22023';
  end if;

  v_given := nullif(v_in->>'id', '')::uuid;
  v_origin := coalesce(nullif(v_in->>'origin', ''), 'archivo');
  v_hash := left(coalesce(v_in->>'file_hash', ''), 128);
  v_ext := left(coalesce(v_in->>'external_id', ''), 120);

  if v_given is not null then
    select d.id, d.space into v_id, v_found_space from public.pilo_docs d where d.id = v_given;
    if v_id is not null and v_found_space <> v_space then
      raise exception 'Ese documento es de otro espacio.' using errcode = '42501';
    end if;
  end if;
  if v_id is null and v_origin = 'moodle' and v_ext <> '' then
    select d.id into v_id from public.pilo_docs d where d.space = v_space and d.origin = 'moodle' and d.external_id = v_ext;
  end if;
  if v_id is null and v_origin = 'archivo' and v_hash <> '' then
    select d.id into v_id from public.pilo_docs d where d.space = v_space and d.origin = 'archivo' and d.file_hash = v_hash;
  end if;

  if v_id is null then
    insert into public.pilo_docs (
      id, space, origin, kind, source, title, file_path, file_name, file_size, file_hash, external_id,
      vis, active, status, status_detail, pages, content_hash, synced_at, created_by
    ) values (
      coalesce(v_given, gen_random_uuid()), v_space, v_origin,
      coalesce(v_in->>'kind', ''), coalesce(v_in->>'source', ''), left(btrim(coalesce(v_in->>'title', '')), 300),
      left(coalesce(v_in->>'file_path', ''), 500), left(coalesce(v_in->>'file_name', ''), 300),
      case when jsonb_typeof(v_in->'file_size') = 'number' then (v_in->>'file_size')::bigint else 0 end,
      v_hash, v_ext,
      coalesce(nullif(v_in->>'vis', ''), 'sesion'),
      case when jsonb_typeof(v_in->'active') = 'boolean' then (v_in->>'active')::boolean else true end,
      coalesce(nullif(v_in->>'status', ''), 'leido'), left(coalesce(v_in->>'status_detail', ''), 600),
      case when jsonb_typeof(v_in->'pages') = 'number' then greatest(0, (v_in->>'pages')::integer) else 0 end,
      left(coalesce(v_in->>'content_hash', ''), 128),
      case when v_origin = 'moodle' then now() else null end,
      auth.uid()
    )
    returning id into v_id;
    return v_id;
  end if;

  -- Ya estaba: el origen, la clase y el espacio no cambian.
  v_patch := v_in - 'id' - 'origin' - 'kind' - 'space' - 'external_id';
  if v_given is not null and v_given <> v_id then
    v_patch := v_patch - 'file_path' - 'file_name' - 'file_size' - 'file_hash';
  end if;
  if v_origin = 'moodle' then
    v_patch := v_patch || jsonb_build_object('synced', true);
  end if;
  perform public.pilo_doc_update(v_id, v_patch);
  return v_id;
end;
$$;

revoke all on function public.pilo_doc_save(text, jsonb) from public, anon;
grant execute on function public.pilo_doc_save(text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Dejar los pasajes de un documento iguales a lo que llega. El ref es
-- «doc:<id>:<seq>»; el espacio, la colección y la visibilidad son los del
-- documento, no los que diga quien llama. Lo que ya no está se borra (con sus
-- relaciones en el mapa), lo nuevo entra y solo lo que cambió estrena fecha.
-- Máximo 400 pasajes por documento: lo que pase de ahí se cuenta en «skipped».
-- -----------------------------------------------------------------------------

create or replace function public.pilo_doc_replace(p_doc uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.pilo_docs;
  v_prefix text;
  v_vis text;
  v_valid integer := 0;
  v_removed integer := 0;
  v_added integer := 0;
  v_changed integer := 0;
  v_total integer := 0;
  v_edges integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración actualizan la memoria de Pilo.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;
  select * into v_doc from public.pilo_docs where id = p_doc for update;
  if not found then
    raise exception 'Ese documento no existe.' using errcode = '22023';
  end if;
  v_prefix := 'doc:' || p_doc::text || ':';
  v_vis := case when v_doc.active then v_doc.vis else 'oculto' end;

  create temporary table if not exists pilo_doc_incoming (
    seq integer primary key, ref text, title text, section text, body text, path text, cut text
  ) on commit drop;
  delete from pilo_doc_incoming where true;

  select count(distinct (r->>'seq')::integer) into v_valid
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where coalesce(r->>'seq', '') ~ '^[0-9]{1,6}$' and length(coalesce(r->>'body', '')) >= 10;

  insert into pilo_doc_incoming (seq, ref, title, section, body, path, cut)
  select * from (
    select distinct on ((r->>'seq')::integer)
      (r->>'seq')::integer as seq, v_prefix || ((r->>'seq')::integer)::text as ref,
      left(coalesce(nullif(btrim(r->>'title'), ''), v_doc.title), 300) as title, left(coalesce(r->>'section', ''), 300) as section,
      left(r->>'body', 8000) as body, left(coalesce(r->>'path', ''), 300) as path, left(coalesce(r->>'cut', ''), 60) as cut
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where coalesce(r->>'seq', '') ~ '^[0-9]{1,6}$' and length(coalesce(r->>'body', '')) >= 10
    order by (r->>'seq')::integer
  ) x
  order by x.seq
  limit 400;

  -- Lo que sale: sus relaciones en el mapa y el pasaje.
  delete from public.pilo_edges e
  where e.space = v_doc.space and starts_with(e.from_id, v_prefix)
    and not exists (select 1 from pilo_doc_incoming i where i.ref = e.from_id);
  get diagnostics v_edges = row_count;

  delete from public.pilo_memory m
  where m.doc_id = p_doc and not exists (select 1 from pilo_doc_incoming i where i.ref = m.ref);
  get diagnostics v_removed = row_count;

  select count(*) into v_added from pilo_doc_incoming i where not exists (select 1 from public.pilo_memory m where m.ref = i.ref);
  select count(*) into v_changed
  from pilo_doc_incoming i join public.pilo_memory m on m.ref = i.ref
  where m.doc_id = p_doc
    and (m.title, m.section, m.body, m.path, m.cut) is distinct from (i.title, i.section, i.body, i.path, i.cut);

  insert into public.pilo_memory (ref, source, title, section, body, path, cut, office, updated_at, space, vis, doc_id)
  select i.ref, v_doc.source, i.title, i.section, i.body, i.path, i.cut, '', now(), v_doc.space, v_vis, p_doc
  from pilo_doc_incoming i
  on conflict (ref) do update set
    source = excluded.source, vis = excluded.vis,
    title = excluded.title, section = excluded.section, body = excluded.body, path = excluded.path, cut = excluded.cut,
    updated_at = case
      when (pilo_memory.title, pilo_memory.section, pilo_memory.body, pilo_memory.path, pilo_memory.cut)
           is distinct from (excluded.title, excluded.section, excluded.body, excluded.path, excluded.cut)
      then now() else pilo_memory.updated_at end
  where pilo_memory.doc_id = p_doc;

  select count(*) into v_total from public.pilo_memory m where m.doc_id = p_doc;

  update public.pilo_docs set
    passages = v_total,
    status = case when v_total > 0 and (v_added + v_changed + v_removed > 0 or status in ('leido', 'error')) then 'en_pasajes' else status end,
    updated_at = now()
  where id = p_doc;
  update public.pilo_spaces set memory_indexed_at = now() where id = v_doc.space;

  if v_edges > 0 then
    perform public.pilo_map_prune(v_doc.space);
  end if;

  return jsonb_build_object(
    'doc', p_doc, 'added', v_added, 'changed', v_changed, 'removed', v_removed, 'total', v_total,
    'skipped', greatest(0, v_valid - 400)
  );
end;
$$;

revoke all on function public.pilo_doc_replace(uuid, jsonb) from public, anon;
grant execute on function public.pilo_doc_replace(uuid, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Borrar un documento con todo lo suyo. Devuelve cuánto se borró y la ruta del
-- archivo, para que quien llama lo quite del bucket.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_doc_delete(p_doc uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.pilo_docs;
  v_prefix text;
  v_passages integer := 0;
  v_answers integer := 0;
  v_nodes integer := 0;
  v_edges integer := 0;
  v_topics integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración borran documentos de la memoria.' using errcode = '42501';
  end if;
  select * into v_doc from public.pilo_docs where id = p_doc for update;
  if not found then
    raise exception 'Ese documento no existe.' using errcode = '22023';
  end if;
  v_prefix := 'doc:' || p_doc::text || ':';

  delete from public.pilo_answers a
  where a.space = v_doc.space
    and exists (select 1 from unnest(a.refs) r where starts_with(r, v_prefix));
  get diagnostics v_answers = row_count;

  delete from public.pilo_edges e
  where e.space = v_doc.space and (public.pilo_doc_owns(p_doc, e.from_id) or public.pilo_doc_owns(p_doc, e.to_id));
  get diagnostics v_edges = row_count;

  delete from public.pilo_nodes n
  where n.space = v_doc.space and public.pilo_doc_owns(p_doc, n.id);
  get diagnostics v_nodes = row_count;

  select count(*) into v_passages from public.pilo_memory m where m.doc_id = p_doc;
  delete from public.pilo_docs where id = p_doc;

  v_topics := public.pilo_map_prune(v_doc.space);

  return jsonb_build_object(
    'doc', p_doc, 'space', v_doc.space, 'file_path', v_doc.file_path,
    'passages', v_passages, 'answers', v_answers, 'nodes', v_nodes, 'edges', v_edges, 'topics', v_topics
  );
end;
$$;

revoke all on function public.pilo_doc_delete(uuid) from public, anon;
grant execute on function public.pilo_doc_delete(uuid) to authenticated, service_role;

notify pgrst, 'reload schema';
