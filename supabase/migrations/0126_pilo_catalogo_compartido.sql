-- =============================================================================
-- 0126 · Mr. Pilo: el catálogo, compartido entre los Pilos y dentro de la memoria.
--
-- Hasta aquí cada entrada del catálogo servía a un solo Pilo (pilo_catalog.space)
-- y el catálogo vivía aparte de la memoria: tenía vectores propios, pero no era
-- un pasaje, ni un punto de la malla, así que ningún puente lo unía con un
-- documento y el otro Pilo no podía leerlo.
--
--   1. «Para todos los Pilos»
--        pilo_catalog.shared        true = la entrada sirve además a los demás
--                                   Pilos. Sigue siendo del Pilo que la escribió
--                                   (se edita y se cuenta allí). Solo las que
--                                   son para todos los roles (rol = ''): una
--                                   entrada «para profesores» no sale de su Pilo.
--        pilo_catalog_active,       leen lo del espacio y lo compartido. La
--        _semantic y _near          función pilo-ia no cambia: llama igual.
--        pilo_catalog_share         la administración la comparte o la deja de
--                                   compartir.
--
--   2. Las respuestas oficiales, dentro de la memoria
--        pilo_sources.kind          admite «catalogo»: dos fuentes que nacen con la
--                                   primera respuesta de cada Pilo,
--                                   «respuestasplan» (Planeación) y
--                                   «respuestasens» (Enseñanza). Nacen en «no» en
--                                   la matriz: se encienden «de visita» en
--                                   «Qué lee cada portal».
--        pilo_catalog_memory_sync   mantiene, por cada RESPUESTA activa y sin rol,
--                                   un pasaje «catalogo:<clave>» en pilo_memory y
--                                   su punto en la malla (pilo_nodes). Así entra
--                                   solo en la indexación por significado, en los
--                                   puentes por reglas y en los que propone la IA,
--                                   y en la lectura de visita. Las capciosas no
--                                   (son microexpresiones, no conocimiento).
--        pilo_bridge_targets        suma las respuestas oficiales de los otros
--                                   ámbitos a lo que la IA compara.
--
-- En casa nada cambia: el catálogo sigue respondiendo por su propio camino
-- (disparadores y significado, como base obligatoria del modelo) y estas fuentes
-- nacen apagadas.
--
-- Todo UPDATE y DELETE lleva WHERE (safeupdate, ver 0095). Requiere 0122.
-- Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Para todos los Pilos.
-- -----------------------------------------------------------------------------

alter table public.pilo_catalog add column if not exists shared boolean not null default false;

alter table public.pilo_catalog drop constraint if exists pilo_catalog_shared;
alter table public.pilo_catalog add constraint pilo_catalog_shared check (not shared or rol = '');

comment on column public.pilo_catalog.shared is
  'true = la entrada sirve además a los demás Pilos (sigue siendo del Pilo que la escribió). Solo con rol vacío.';

create or replace function public.pilo_catalog_active(p_space text default 'planeacion')
returns setof public.pilo_catalog
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo lee el catálogo.' using errcode = '42501';
  end if;
  return query
    select c.* from public.pilo_catalog c
    where c.active and (c.space = coalesce(p_space, 'planeacion') or c.shared)
    order by c.kind, c.key;
end;
$$;

revoke all on function public.pilo_catalog_active(text) from public, anon;
grant execute on function public.pilo_catalog_active(text) to authenticated, service_role;

create or replace function public.pilo_catalog_semantic(
  p_embedding text,
  p_model text,
  p_min real default 0.8,
  p_space text default 'planeacion'
)
returns table (key text, sim real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo lee el catálogo.' using errcode = '42501';
  end if;
  return query
    select * from (
      select c.key, (1 - (cv.embedding <=> q.v))::real as sim
      from public.pilo_catalog c
      join public.pilo_catalog_vectors cv on cv.key = c.key,
           (select p_embedding::extensions.vector as v) q
      where c.active and (c.space = coalesce(p_space, 'planeacion') or c.shared) and cv.embedding is not null
        and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
      order by cv.embedding <=> q.v
      limit 1
    ) near
    where near.sim >= coalesce(p_min, 0.8);
end;
$$;

revoke all on function public.pilo_catalog_semantic(text, text, real, text) from public, anon;
grant execute on function public.pilo_catalog_semantic(text, text, real, text) to authenticated, service_role;

create or replace function public.pilo_catalog_near(
  p_embedding text,
  p_model text,
  p_limit integer default 5,
  p_space text default 'planeacion'
)
returns table (key text, sim real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo lee el catálogo.' using errcode = '42501';
  end if;
  return query
    select c.key, (1 - (cv.embedding <=> q.v))::real as sim
    from public.pilo_catalog c
    join public.pilo_catalog_vectors cv on cv.key = c.key,
         (select p_embedding::extensions.vector as v) q
    where c.active and (c.space = coalesce(p_space, 'planeacion') or c.shared) and cv.embedding is not null
      and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
    order by cv.embedding <=> q.v
    limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$$;

revoke all on function public.pilo_catalog_near(text, text, integer, text) from public, anon;
grant execute on function public.pilo_catalog_near(text, text, integer, text) to authenticated, service_role;

-- Compartir (o dejar de compartir) una entrada. No toca `updated_at`: el vector
-- sigue vigente, lo que cambia es quién la lee.
create or replace function public.pilo_catalog_share(p_key text, p_shared boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_catalog;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración comparte el catálogo de Pilo.' using errcode = '42501';
  end if;
  select * into v_row from public.pilo_catalog c where c.key = p_key for update;
  if not found then
    raise exception 'Esa entrada del catálogo no existe.' using errcode = '22023';
  end if;
  if coalesce(p_shared, false) and v_row.rol <> '' then
    raise exception 'La entrada % es solo para un rol (%): se comparten las que son para todos.', v_row.key, v_row.rol using errcode = '22023';
  end if;
  update public.pilo_catalog c set shared = coalesce(p_shared, false) where c.key = v_row.key returning * into v_row;
  return jsonb_build_object('key', v_row.key, 'space', v_row.space, 'shared', v_row.shared);
end;
$$;

revoke all on function public.pilo_catalog_share(text, boolean) from public, anon;
grant execute on function public.pilo_catalog_share(text, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Las respuestas oficiales, dentro de la memoria.
-- -----------------------------------------------------------------------------

alter table public.pilo_sources drop constraint if exists pilo_sources_kind;
alter table public.pilo_sources add constraint pilo_sources_kind check (kind in ('portal', 'documentos', 'moodle', 'catalogo'));

-- Deja el catálogo y la memoria de acuerdo para UNA clave: la respuesta activa y
-- sin rol es un pasaje y un punto de la malla; cualquier otra cosa (capciosa,
-- inactiva, para un rol, borrada) no deja nada. La fuente de cada Pilo
-- («respuestasplan», «respuestasens») nace con su primera respuesta, y en «no»
-- en la matriz: no cambia nada hasta que se encienda «de visita».
create or replace function public.pilo_catalog_memory_sync(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.pilo_catalog;
  v_ref text := 'catalogo:' || p_key;
  v_source text;
begin
  select * into c from public.pilo_catalog x where x.key = p_key;
  if not found or c.kind <> 'respuesta' or not c.active or c.rol <> '' or btrim(c.question) = '' or btrim(c.answer) = '' then
    delete from public.pilo_memory m where m.ref = v_ref;
    delete from public.pilo_nodes n where n.id = v_ref;
    delete from public.pilo_bridge_scan s where s.node_id = v_ref;
    delete from public.pilo_bridges b where b.a_id = v_ref or b.b_id = v_ref;
    return;
  end if;
  v_source := case c.space when 'ensenanza' then 'respuestasens' else 'respuestasplan' end;

  insert into public.pilo_sources (id, scope, name, kind, staff_only, stays_home, sort)
  values (v_source, c.space, case c.space when 'ensenanza' then 'Respuestas oficiales de Enseñanza' else 'Respuestas oficiales de Planeación' end, 'catalogo', false, false, case c.space when 'ensenanza' then 15 else 9 end)
  on conflict (id) do nothing;

  -- Si la entrada cambió de Pilo, el pasaje y el punto pasan a su fuente nueva.
  insert into public.pilo_memory as m (ref, source, title, section, body, path, cut, office, space, vis, updated_at)
  values (v_ref, v_source, left(btrim(c.question), 300), 'Respuesta oficial', left(btrim(c.answer), 8000), left(c.source_path, 300), left(c.cut, 60), left(c.office, 200), c.space, 'publico', now())
  on conflict (ref) do update set
    source = excluded.source, title = excluded.title, section = excluded.section, body = excluded.body,
    path = excluded.path, cut = excluded.cut, office = excluded.office, space = excluded.space,
    updated_at = case
      when (m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.space)
           is distinct from (excluded.source, excluded.title, excluded.section, excluded.body, excluded.path, excluded.cut, excluded.office, excluded.space)
      then now() else m.updated_at end;

  insert into public.pilo_nodes as n (id, source, type, label, space, updated_at)
  values (v_ref, v_source, 'respuesta', left(btrim(c.question), 300), c.space, now())
  on conflict (id) do update set
    source = excluded.source, label = excluded.label, space = excluded.space,
    updated_at = case
      when (n.source, n.label, n.space) is distinct from (excluded.source, excluded.label, excluded.space) then now() else n.updated_at end;
end;
$$;

revoke all on function public.pilo_catalog_memory_sync(text) from public, anon, authenticated;

create or replace function public.pilo_catalog_memory_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.pilo_catalog_memory_sync(case when tg_op = 'DELETE' then old.key else new.key end);
  return null;
end;
$$;

revoke all on function public.pilo_catalog_memory_trigger() from public, anon, authenticated;

-- Las veces que sirvió una entrada (`hits`) no pasan por aquí: no la tocan.
drop trigger if exists pilo_catalog_memory on public.pilo_catalog;
create trigger pilo_catalog_memory
  after insert or delete or update of key, kind, question, answer, source_title, source_path, cut, office, active, rol, space on public.pilo_catalog
  for each row execute function public.pilo_catalog_memory_trigger();

-- Lo que ya hay.
do $$
declare
  r record;
begin
  for r in select c.key from public.pilo_catalog c where c.kind = 'respuesta' loop
    perform public.pilo_catalog_memory_sync(r.key);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- Los puentes que propone la IA comparan también las respuestas oficiales de los
-- otros ámbitos (0122 solo comparaba documentos, temas y referencias).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_bridge_targets(p_scope text default 'planeacion', p_limit integer default 60)
returns table (scope text, id text, label text, type text, uses integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración proponen puentes.' using errcode = '42501';
  end if;
  return query
    select t.scope, t.id, t.label, t.type, t.uses from (
      -- Los documentos de los otros ámbitos que tienen pasajes a la vista.
      select n.space as scope, n.id, n.label, 'documento'::text as type,
             (select count(*) from public.pilo_memory m where m.space = n.space and m.doc_id::text = substr(n.id, 5) and m.vis <> 'oculto')::integer as uses
      from public.pilo_nodes n
      where n.space <> p_scope and n.source = 'mapa' and starts_with(n.id, 'doc:') and position('#' in n.id) = 0
      union all
      -- Sus temas y referencias.
      select u.space, n.id, n.label, case when starts_with(n.id, 'tema:') then 'tema' else 'referencia' end, u.uses
      from (
        select e.space, e.to_id, count(*)::integer as uses
        from public.pilo_edges e
        where e.space <> p_scope and e.rel in ('trata', 'cita')
        group by e.space, e.to_id
      ) u
      join public.pilo_nodes n on n.id = u.to_id and n.source = 'mapa' and (starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:'))
      union all
      -- Sus respuestas oficiales (0126).
      select n.space, n.id, n.label, 'respuesta'::text, 1
      from public.pilo_nodes n
      where n.space <> p_scope and starts_with(n.id, 'catalogo:')
        and exists (select 1 from public.pilo_memory m where m.ref = n.id and m.vis <> 'oculto')
    ) t
    where t.uses > 0 and exists (select 1 from public.pilo_portals p where p.scope = t.scope)
    order by t.uses desc, t.label, t.id
    limit greatest(1, least(coalesce(p_limit, 60), 120));
end;
$$;

revoke all on function public.pilo_bridge_targets(text, integer) from public, anon;
grant execute on function public.pilo_bridge_targets(text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
