-- =============================================================================
-- 0115 · Mr. Pilo en Enseñanza: el mapa de conexiones.
--
-- Reutiliza la malla de 0097 (pilo_nodes / pilo_edges) dentro del espacio. Los
-- nodos del mapa llevan source «mapa»:
--
--   fuente:<colección>        innovacion, politicas, global, moodle
--   doc:<uuid>                el documento
--   doc:<uuid>#<sección>      una sección del documento
--   tema:<slug>               un tema (lo pone la IA al «comprender»)
--   ref:<slug>                una referencia (Ley 30, ODS 4, UNESCO…)
--
-- y los pasajes (ref «doc:<uuid>:<n>», en pilo_memory) son extremos de
-- relación sin nodo propio. Dos relaciones nuevas:
--
--   trata   pasaje → tema
--   cita    pasaje → referencia
--
--   pilo_edges.origin         quién puso la relación: «reglas» (la estructura y
--                             las referencias que se sacan sin IA) o «ia». Así
--                             rehacer una parte no borra la otra.
--   pilo_memory.mapped_at     cuándo se comprendió el pasaje. Pendiente = sin
--                             fecha o anterior a su último cambio.
--
--   pilo_doc_outline(doc, nodos, relaciones)   la estructura de un documento,
--                                              sin IA. Reemplaza la anterior.
--   pilo_map_pending(espacio, doc, n)          pasajes por comprender.
--   pilo_map_status(espacio, doc)              cuántos hay y cuántos faltan.
--   pilo_map_topics(espacio, n)                temas y referencias que ya hay,
--                                              para reutilizarlos.
--   pilo_map_save(espacio, filas)              guarda los temas y referencias
--                                              de unos pasajes: reemplaza lo
--                                              que la IA había puesto en cada uno.
--   pilo_graph_neighbors(refs, espacio, fuentes, solo público, n)
--                                              pasajes vecinos por el mapa: los
--                                              que comparten tema o referencia.
--                                              Mismos filtros de espacio y de
--                                              visibilidad que la búsqueda.
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0114.
-- Idempotente. La restricción de relaciones solo se amplía: todas las filas de
-- hoy la cumplen.
-- =============================================================================

alter table public.pilo_edges drop constraint if exists pilo_edges_rel;
alter table public.pilo_edges add constraint pilo_edges_rel
  check (rel in ('contiene', 'vincula', 'incluye', 'mide', 'trata', 'cita'));

alter table public.pilo_edges add column if not exists origin text not null default 'reglas';
alter table public.pilo_edges drop constraint if exists pilo_edges_origin;
alter table public.pilo_edges add constraint pilo_edges_origin check (origin in ('reglas', 'ia'));

alter table public.pilo_memory add column if not exists mapped_at timestamptz;

comment on column public.pilo_edges.origin is 'Quién puso la relación: «reglas» (estructura, referencias sin IA) o «ia» (comprender).';
comment on column public.pilo_memory.mapped_at is 'Cuándo se comprendió el pasaje para el mapa. Pendiente si está vacío o es anterior a updated_at.';

create index if not exists pilo_edges_space_rel_idx on public.pilo_edges (space, rel);

-- -----------------------------------------------------------------------------
-- La estructura de un documento: colección › documento › sección, y las
-- referencias que se reconocen por reglas. Reemplaza la estructura anterior de
-- ese documento y nada más: no toca lo que puso la IA ni lo de otro documento.
--
-- Nodos que acepta: los del documento («doc:<id>», «doc:<id>#…»), la colección
-- del documento («fuente:<colección>») y temas o referencias («tema:…»,
-- «ref:…»). Relaciones: «contiene», «cita», «trata» o «vincula», con al menos
-- un extremo del documento (su nodo, una sección o un pasaje) y el otro del
-- documento, su colección, un tema o una referencia. Lo demás se cuenta en
-- «rejected».
-- -----------------------------------------------------------------------------

create or replace function public.pilo_doc_outline(p_doc uuid, p_nodes jsonb, p_edges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_doc public.pilo_docs;
  v_node text;
  v_root text;
  v_nodes integer := 0;
  v_shared integer := 0;
  v_edges integer := 0;
  v_removed integer := 0;
  v_rejected integer := 0;
  v_n integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración arman el mapa.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_nodes, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_edges, '[]'::jsonb)) <> 'array' then
    raise exception 'Los nodos y las relaciones deben ser listas.' using errcode = '22023';
  end if;
  select * into v_doc from public.pilo_docs where id = p_doc for update;
  if not found then
    raise exception 'Ese documento no existe.' using errcode = '22023';
  end if;
  v_node := 'doc:' || p_doc::text;
  v_root := 'fuente:' || v_doc.source;

  -- Los nodos del documento que ya no llegan.
  delete from public.pilo_nodes n
  where n.space = v_doc.space and (n.id = v_node or starts_with(n.id, v_node || '#'))
    and not exists (select 1 from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) r where r->>'id' = n.id);
  get diagnostics v_removed = row_count;

  -- Los del documento se actualizan.
  insert into public.pilo_nodes as n (id, source, type, code, label, path, props, updated_at, space)
  select distinct on (r->>'id')
    r->>'id', 'mapa', case when r->>'id' = v_node then 'documento' else 'seccion' end, left(coalesce(r->>'code', ''), 20),
    left(coalesce(nullif(btrim(r->>'label'), ''), case when r->>'id' = v_node then v_doc.title else r->>'id' end), 300),
    left(coalesce(r->>'path', ''), 300),
    (case when jsonb_typeof(r->'props') = 'object' then r->'props' else '{}'::jsonb end)
      || jsonb_build_object('kind', case when r->>'id' = v_node then 'documento' else 'seccion' end, 'doc', p_doc),
    now(), v_doc.space
  from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) r
  where length(coalesce(r->>'id', '')) between 3 and 300
    and (r->>'id' = v_node or starts_with(r->>'id', v_node || '#'))
  on conflict (id) do update set
    type = excluded.type, code = excluded.code, label = excluded.label, path = excluded.path, props = excluded.props, updated_at = now()
  where n.space = excluded.space;
  get diagnostics v_nodes = row_count;

  -- La colección, los temas y las referencias son de todos los documentos: se
  -- crean si faltan y, si ya están, se dejan como están.
  insert into public.pilo_nodes as n (id, source, type, code, label, path, props, updated_at, space)
  select distinct on (r->>'id')
    r->>'id', 'mapa',
    case when r->>'id' = v_root then 'fuente' when starts_with(r->>'id', 'tema:') then 'tema' else 'referencia' end,
    left(coalesce(r->>'code', ''), 20),
    left(coalesce(nullif(btrim(r->>'label'), ''), r->>'id'), 300), left(coalesce(r->>'path', ''), 300),
    (case when jsonb_typeof(r->'props') = 'object' then r->'props' else '{}'::jsonb end)
      || jsonb_build_object('kind', case when r->>'id' = v_root then 'fuente' when starts_with(r->>'id', 'tema:') then 'tema' else 'referencia' end),
    now(), v_doc.space
  from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) r
  where length(coalesce(r->>'id', '')) between 5 and 300
    and (r->>'id' = v_root or starts_with(r->>'id', 'tema:') or starts_with(r->>'id', 'ref:'))
  on conflict (id) do nothing;
  get diagnostics v_shared = row_count;

  select count(*) into v_n
  from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) r
  where not (
    length(coalesce(r->>'id', '')) between 3 and 300
    and (r->>'id' = v_node or starts_with(r->>'id', v_node || '#') or r->>'id' = v_root
         or starts_with(r->>'id', 'tema:') or starts_with(r->>'id', 'ref:'))
  );
  v_rejected := v_n;

  -- Las relaciones «de reglas» del documento se rehacen.
  delete from public.pilo_edges e
  where e.space = v_doc.space and e.origin = 'reglas'
    and (public.pilo_doc_owns(p_doc, e.from_id) or public.pilo_doc_owns(p_doc, e.to_id));

  insert into public.pilo_edges as e (from_id, to_id, rel, source, space, origin)
  select distinct r->>'from', r->>'to', coalesce(nullif(r->>'rel', ''), 'contiene'), 'mapa', v_doc.space, 'reglas'
  from jsonb_array_elements(coalesce(p_edges, '[]'::jsonb)) r
  where coalesce(r->>'from', '') <> '' and coalesce(r->>'to', '') <> '' and r->>'from' <> r->>'to'
    and length(r->>'from') <= 300 and length(r->>'to') <= 300
    and coalesce(nullif(r->>'rel', ''), 'contiene') in ('contiene', 'cita', 'trata', 'vincula')
    and (public.pilo_doc_owns(p_doc, r->>'from') or public.pilo_doc_owns(p_doc, r->>'to'))
    and (public.pilo_doc_owns(p_doc, r->>'from') or r->>'from' = v_root or starts_with(r->>'from', 'tema:') or starts_with(r->>'from', 'ref:'))
    and (public.pilo_doc_owns(p_doc, r->>'to') or r->>'to' = v_root or starts_with(r->>'to', 'tema:') or starts_with(r->>'to', 'ref:'))
  on conflict (from_id, to_id, rel) do update set origin = 'reglas'
  where e.space = excluded.space;
  get diagnostics v_edges = row_count;

  select count(*) into v_n from jsonb_array_elements(coalesce(p_edges, '[]'::jsonb)) r;
  v_rejected := v_rejected + greatest(0, v_n - v_edges);

  perform public.pilo_map_prune(v_doc.space);

  update public.pilo_docs set
    status = case when status in ('leido', 'en_pasajes') then 'en_mapa' else status end,
    updated_at = now()
  where id = p_doc;

  return jsonb_build_object('doc', p_doc, 'nodes', v_nodes + v_shared, 'edges', v_edges, 'removed', v_removed, 'rejected', v_rejected);
end;
$$;

revoke all on function public.pilo_doc_outline(uuid, jsonb, jsonb) from public, anon;
grant execute on function public.pilo_doc_outline(uuid, jsonb, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Los pasajes por comprender: de documentos activos, sin marca o con la marca
-- anterior a su último cambio. En orden de documento y de pasaje.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_map_pending(p_space text, p_doc uuid default null, p_limit integer default 18)
returns table (ref text, doc_id uuid, source text, title text, section text, body text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración arman el mapa.' using errcode = '42501';
  end if;
  return query
    select m.ref, m.doc_id, m.source, m.title, m.section, m.body
    from public.pilo_memory m
    where m.space = p_space and m.doc_id is not null and m.vis <> 'oculto'
      and (p_doc is null or m.doc_id = p_doc)
      and (m.mapped_at is null or m.mapped_at < m.updated_at)
    order by m.doc_id, length(m.ref), m.ref
    limit greatest(1, least(coalesce(p_limit, 18), 60));
end;
$$;

revoke all on function public.pilo_map_pending(text, uuid, integer) from public, anon;
grant execute on function public.pilo_map_pending(text, uuid, integer) to authenticated, service_role;

-- Cuántos pasajes de documentos hay, cuántos están comprendidos y cuántos faltan.
create or replace function public.pilo_map_status(p_space text, p_doc uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración ven el mapa.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'space', p_space,
    'total', count(*),
    'mapped', count(*) filter (where m.mapped_at is not null and m.mapped_at >= m.updated_at),
    'pending', count(*) filter (where m.mapped_at is null or m.mapped_at < m.updated_at),
    'topics', (select count(*) from public.pilo_nodes n where n.space = p_space and n.source = 'mapa' and starts_with(n.id, 'tema:')),
    'refs', (select count(*) from public.pilo_nodes n where n.space = p_space and n.source = 'mapa' and starts_with(n.id, 'ref:'))
  ) into v
  from public.pilo_memory m
  where m.space = p_space and m.doc_id is not null and m.vis <> 'oculto'
    and (p_doc is null or m.doc_id = p_doc);
  return v;
end;
$$;

revoke all on function public.pilo_map_status(text, uuid) from public, anon;
grant execute on function public.pilo_map_status(text, uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Los temas y referencias que ya hay en el espacio, los más usados primero:
-- la IA los recibe para reutilizarlos en vez de inventar otros parecidos.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_map_topics(p_space text, p_limit integer default 80)
returns table (id text, label text, kind text, uses integer)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración ven el mapa.' using errcode = '42501';
  end if;
  return query
    select n.id, n.label, case when starts_with(n.id, 'tema:') then 'tema' else 'referencia' end,
           (select count(*) from public.pilo_edges e where e.space = p_space and e.to_id = n.id)::integer as uses
    from public.pilo_nodes n
    where n.space = p_space and n.source = 'mapa' and (starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:'))
    order by uses desc, n.label, n.id
    limit greatest(1, least(coalesce(p_limit, 80), 300));
end;
$$;

revoke all on function public.pilo_map_topics(text, integer) from public, anon;
grant execute on function public.pilo_map_topics(text, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Guardar lo que la IA comprendió de unos pasajes. Filas:
--   [{ "ref": "doc:<uuid>:<n>",
--      "topics": [{"id": "tema:<slug>", "label": "…"}, …],     hasta 4
--      "refs":   [{"id": "ref:<slug>",  "label": "…"}, …] }]   hasta 3
-- (un tema o referencia puede llegar también como texto: la etiqueta.) Sin id
-- válido, el id sale de la etiqueta. Etiquetas de 3 a 60 caracteres, sin
-- direcciones ni marcas del pedido; lo que no cumple se descarta.
--
-- Por cada pasaje —que tiene que ser de un documento de ese espacio— se borran
-- las relaciones que la IA le había puesto y entran las nuevas; las de reglas
-- no se tocan. Un tema que ya existe conserva su etiqueta. El pasaje queda
-- marcado como comprendido aunque no traiga nada. Devuelve cuántos pasajes
-- guardó.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_map_save(p_space text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración arman el mapa.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pilo_spaces sp where sp.id = p_space) then
    raise exception 'Espacio desconocido: %', p_space using errcode = '22023';
  end if;

  create temporary table if not exists pilo_map_rows (ref text primary key, doc_id uuid, topics jsonb, refs jsonb) on commit drop;
  create temporary table if not exists pilo_map_links (ref text, rel text, id text, label text, primary key (ref, rel, id)) on commit drop;
  delete from pilo_map_rows where true;
  delete from pilo_map_links where true;

  -- Solo pasajes de documentos de este espacio.
  insert into pilo_map_rows (ref, doc_id, topics, refs)
  select distinct on (m.ref) m.ref, m.doc_id,
    case when jsonb_typeof(r->'topics') = 'array' then r->'topics' else '[]'::jsonb end,
    case when jsonb_typeof(r->'refs') = 'array' then r->'refs' else '[]'::jsonb end
  from jsonb_array_elements(p_rows) r
  join public.pilo_memory m on m.ref = r->>'ref'
  where m.space = p_space and m.doc_id is not null;
  get diagnostics v_saved = row_count;

  insert into pilo_map_links (ref, rel, id, label)
  select distinct on (y.ref, y.rel, y.id) y.ref, y.rel, y.id, y.label
  from (
    select x.ref, x.rel, x.label, x.ord,
      case
        when x.given ~ ('^' || x.prefix || '[a-z0-9]+(-[a-z0-9]+)*$') and length(x.given) <= 80 then x.given
        else x.prefix || left(btrim(regexp_replace(replace(public.pilo_fold(x.label), 'ñ', 'n'), '[^a-z0-9]+', '-', 'g'), '-'), 70)
      end as id
    from (
      select w.ref, 'trata'::text as rel, 'tema:'::text as prefix, t.ord,
        btrim(case jsonb_typeof(t.item) when 'string' then t.item #>> '{}' else coalesce(t.item->>'label', '') end) as label,
        case jsonb_typeof(t.item) when 'object' then coalesce(t.item->>'id', '') else '' end as given
      from pilo_map_rows w, jsonb_array_elements(w.topics) with ordinality as t (item, ord)
      where t.ord <= 4
      union all
      select w.ref, 'cita'::text, 'ref:'::text, t.ord,
        btrim(case jsonb_typeof(t.item) when 'string' then t.item #>> '{}' else coalesce(t.item->>'label', '') end),
        case jsonb_typeof(t.item) when 'object' then coalesce(t.item->>'id', '') else '' end
      from pilo_map_rows w, jsonb_array_elements(w.refs) with ordinality as t (item, ord)
      where t.ord <= 3
    ) x
    where length(x.label) between 3 and 60
      and x.label !~* '(https?:|www\.|://|<<<|>>>)'
      -- La marca del pedido va en mayúsculas («<<<DATOS»): un tema como «Análisis de datos» sí entra.
      and x.label !~ 'DATOS'
  ) y
  where length(y.id) between 6 and 80 and y.id ~ '^(tema|ref):[a-z0-9]+(-[a-z0-9]+)*$'
  order by y.ref, y.rel, y.id, y.ord;

  -- Fuera lo que la IA había puesto en esos pasajes.
  delete from public.pilo_edges e
  where e.space = p_space and e.origin = 'ia' and e.rel in ('trata', 'cita')
    and exists (select 1 from pilo_map_rows w where w.ref = e.from_id);

  insert into public.pilo_nodes (id, source, type, label, props, space)
  select distinct on (l.id) l.id, 'mapa', case l.rel when 'trata' then 'tema' else 'referencia' end, l.label,
    jsonb_build_object('kind', case l.rel when 'trata' then 'tema' else 'referencia' end), p_space
  from pilo_map_links l
  order by l.id, l.ref
  on conflict (id) do nothing;

  -- Solo hacia nodos de este espacio.
  insert into public.pilo_edges (from_id, to_id, rel, source, space, origin)
  select l.ref, l.id, l.rel, 'mapa', p_space, 'ia'
  from pilo_map_links l
  join public.pilo_nodes n on n.id = l.id
  where n.space = p_space
  on conflict do nothing;

  update public.pilo_memory m set mapped_at = now()
  where m.space = p_space and exists (select 1 from pilo_map_rows w where w.ref = m.ref);

  perform public.pilo_map_prune(p_space);

  -- El documento queda «entendido» cuando no le falta ningún pasaje.
  update public.pilo_docs d set status = 'entendido', understood_at = now(), updated_at = now()
  where d.space = p_space
    and d.status in ('en_pasajes', 'en_mapa', 'entendido')
    and exists (select 1 from pilo_map_rows w where w.doc_id = d.id)
    and not exists (
      select 1 from public.pilo_memory m
      where m.doc_id = d.id and (m.mapped_at is null or m.mapped_at < m.updated_at)
    );

  return v_saved;
end;
$$;

revoke all on function public.pilo_map_save(text, jsonb) from public, anon;
grant execute on function public.pilo_map_save(text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Vecinos por el mapa: pasajes que comparten tema o referencia con los que ya
-- se encontraron. Los mismos filtros que pilo_memory_search: del espacio, nunca
-- lo oculto y, sin sesión, solo lo público. Nunca devuelve los pasajes de
-- entrada. Mira a lo sumo 20 pasajes de entrada y devuelve a lo sumo 10.
-- «via» es el tema o referencia que los une; «shared», cuántos comparten.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_graph_neighbors(
  p_refs text[],
  p_space text,
  p_sources text[] default null,
  p_public_only boolean default false,
  p_limit integer default 3
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, via text, shared integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
  v_public boolean := coalesce(p_public_only, false);
  v_refs text[] := (coalesce(p_refs, '{}'::text[]))[1:20];
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen la malla.' using errcode = '42501';
  end if;
  if cardinality(v_refs) = 0 then
    return;
  end if;
  return query
    with hubs as (
      select distinct e.to_id as hub
      from public.pilo_edges e
      where e.space = v_space and e.rel in ('trata', 'cita') and e.from_id = any (v_refs)
    ),
    near as (
      select e.from_id as near_ref, count(distinct e.to_id)::integer as near_shared, min(e.to_id) as near_hub
      from public.pilo_edges e
      join hubs h on h.hub = e.to_id
      where e.space = v_space and e.rel in ('trata', 'cita') and e.from_id <> all (v_refs)
      group by e.from_id
    )
    select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.updated_at,
           coalesce(n.label, '') as via, near.near_shared
    from near
    join public.pilo_memory m on m.ref = near.near_ref
    left join public.pilo_nodes n on n.id = near.near_hub and n.space = v_space
    where m.space = v_space
      and m.vis <> 'oculto'
      and (not v_public or m.vis = 'publico')
      and (p_sources is null or m.source = any (p_sources))
    order by near.near_shared desc, m.updated_at desc, m.ref
    limit greatest(1, least(coalesce(p_limit, 3), 10));
end;
$$;

revoke all on function public.pilo_graph_neighbors(text[], text, text[], boolean, integer) from public, anon;
grant execute on function public.pilo_graph_neighbors(text[], text, text[], boolean, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
