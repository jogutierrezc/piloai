-- =============================================================================
-- 0097 · Pregúntele a Pilo: la malla de la memoria.
--
-- Los pasajes (0094) dicen qué hay; la malla dice cómo se relaciona: el Plan
-- de Desarrollo como Pilar › Área estratégica › Línea de acción › Proyecto
-- (con la misma numeración del Mapa numerado: P1, AE3, LA12, PR4), UDES en
-- Cifras como informe › indicador, el Observatorio como tema › tabla, y cada
-- fuente como raíz de lo suyo. El id de cada nodo es el ref de su pasaje:
-- la búsqueda de texto encuentra el pasaje y la malla le da su lugar.
--
--   pilo_nodes / pilo_edges              la malla; solo la administración y
--                                        la función del servidor la leen
--   pilo_graph_replace(fuente, nodos, relaciones)
--                                        deja la malla de una fuente igual
--                                        a lo que llega (como pilo_memory_replace)
--   pilo_graph_around(ids, fuentes, arriba, abajo, límite)
--                                        un trozo de malla alrededor de unos
--                                        nodos: su ruta hacia arriba y lo que
--                                        contienen hacia abajo
--   pilo_graph_overview(fuentes)         toda la malla, para verla en la intranet
--
-- Todo DELETE lleva WHERE (safeupdate, ver 0095). Requiere 0094. Idempotente.
-- =============================================================================

create table if not exists public.pilo_nodes (
  id          text primary key,
  source      text not null,
  type        text not null,
  code        text not null default '',
  label       text not null,
  path        text not null default '',
  props       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  constraint pilo_nodes_source check (source in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto')),
  constraint pilo_nodes_id check (length(id) between 3 and 300)
);

create index if not exists pilo_nodes_source_idx on public.pilo_nodes (source);

-- Sin llaves foráneas: una relación puede cruzar fuentes (un boletín que
-- incluye un informe) y cada fuente se rehace por su cuenta. Los extremos que
-- no existen simplemente no se dibujan.
create table if not exists public.pilo_edges (
  from_id  text not null,
  to_id    text not null,
  rel      text not null,
  source   text not null,
  primary key (from_id, to_id, rel),
  constraint pilo_edges_rel check (rel in ('contiene', 'vincula', 'incluye', 'mide')),
  constraint pilo_edges_source check (source in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto'))
);

create index if not exists pilo_edges_to_idx on public.pilo_edges (to_id);
create index if not exists pilo_edges_source_idx on public.pilo_edges (source);

comment on table public.pilo_nodes is 'Pregúntele a Pilo: nodos de la malla de la memoria. El id es el ref del pasaje que lo describe.';
comment on table public.pilo_edges is 'Pregúntele a Pilo: relaciones de la malla. «contiene» va de padre a hijo.';

alter table public.pilo_nodes enable row level security;
alter table public.pilo_edges enable row level security;

drop policy if exists pilo_nodes_admin on public.pilo_nodes;
create policy pilo_nodes_admin on public.pilo_nodes for select to authenticated using (public.has_role_at_least('admin'));
drop policy if exists pilo_edges_admin on public.pilo_edges;
create policy pilo_edges_admin on public.pilo_edges for select to authenticated using (public.has_role_at_least('admin'));

revoke all on public.pilo_nodes, public.pilo_edges from anon;
grant select on public.pilo_nodes, public.pilo_edges to authenticated;

-- -----------------------------------------------------------------------------
-- Rehacer la malla de una fuente.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_graph_replace(p_source text, p_nodes jsonb, p_edges jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nodes integer := 0;
  v_edges integer := 0;
  v_removed integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración actualiza la malla de Pilo.' using errcode = '42501';
  end if;
  if p_source not in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto') then
    raise exception 'Fuente desconocida: %', p_source using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_nodes, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_edges, '[]'::jsonb)) <> 'array' then
    raise exception 'Los nodos y las relaciones deben ser listas.' using errcode = '22023';
  end if;

  delete from public.pilo_nodes n
  where n.source = p_source
    and not exists (select 1 from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) r where r->>'id' = n.id);
  get diagnostics v_removed = row_count;

  insert into public.pilo_nodes as n (id, source, type, code, label, path, props, updated_at)
  select distinct on (r->>'id')
    left(r->>'id', 300), p_source, left(coalesce(r->>'type', 'nodo'), 40), left(coalesce(r->>'code', ''), 20),
    left(coalesce(nullif(r->>'label', ''), r->>'id'), 300), left(coalesce(r->>'path', ''), 300),
    case when jsonb_typeof(r->'props') = 'object' then r->'props' else '{}'::jsonb end, now()
  from jsonb_array_elements(coalesce(p_nodes, '[]'::jsonb)) r
  where length(coalesce(r->>'id', '')) between 3 and 300
  on conflict (id) do update set
    source = excluded.source, type = excluded.type, code = excluded.code, label = excluded.label,
    path = excluded.path, props = excluded.props, updated_at = now();
  get diagnostics v_nodes = row_count;

  delete from public.pilo_edges e where e.source = p_source;

  insert into public.pilo_edges (from_id, to_id, rel, source)
  select distinct r->>'from', r->>'to', coalesce(nullif(r->>'rel', ''), 'contiene'), p_source
  from jsonb_array_elements(coalesce(p_edges, '[]'::jsonb)) r
  where coalesce(r->>'from', '') <> '' and coalesce(r->>'to', '') <> '' and r->>'from' <> r->>'to'
    and coalesce(nullif(r->>'rel', ''), 'contiene') in ('contiene', 'vincula', 'incluye', 'mide')
  on conflict do nothing;
  get diagnostics v_edges = row_count;

  return jsonb_build_object('source', p_source, 'nodes', v_nodes, 'edges', v_edges, 'removed', v_removed);
end;
$$;

revoke all on function public.pilo_graph_replace(text, jsonb, jsonb) from public, anon;
grant execute on function public.pilo_graph_replace(text, jsonb, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Un trozo de malla alrededor de unos nodos: hacia arriba por «contiene» (su
-- ruta hasta la raíz) y hacia abajo lo que contienen, hasta cierta profundidad.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_graph_around(
  p_ids text[],
  p_sources text[] default null,
  p_up integer default 6,
  p_down integer default 1,
  p_limit integer default 80
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen la malla.' using errcode = '42501';
  end if;
  with recursive up as (
    select n.id, 0 as d from public.pilo_nodes n where n.id = any (p_ids)
    union
    select e.from_id, up.d + 1 from public.pilo_edges e join up on e.to_id = up.id
    where e.rel = 'contiene' and up.d < greatest(0, least(coalesce(p_up, 6), 10))
  ),
  down as (
    select n.id, 0 as d from public.pilo_nodes n where n.id = any (p_ids)
    union
    select e.to_id, down.d + 1 from public.pilo_edges e join down on e.from_id = down.id
    where e.rel in ('contiene', 'incluye', 'mide') and down.d < greatest(0, least(coalesce(p_down, 1), 4))
  ),
  picked as (
    select distinct n.id
    from (select id from up union select id from down) ids
    join public.pilo_nodes n on n.id = ids.id
    where p_sources is null or n.source = any (p_sources)
    limit greatest(1, least(coalesce(p_limit, 80), 400))
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'source', n.source, 'type', n.type, 'code', n.code, 'label', n.label, 'path', n.path, 'props', n.props))
                       from public.pilo_nodes n where n.id in (select id from picked)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_id, 'to', e.to_id, 'rel', e.rel))
                       from public.pilo_edges e where e.from_id in (select id from picked) and e.to_id in (select id from picked)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.pilo_graph_around(text[], text[], integer, integer, integer) from public, anon;
grant execute on function public.pilo_graph_around(text[], text[], integer, integer, integer) to authenticated, service_role;

-- Toda la malla (o la de unas fuentes), para verla en la intranet.
create or replace function public.pilo_graph_overview(p_sources text[] default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve la malla completa.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'source', n.source, 'type', n.type, 'code', n.code, 'label', n.label, 'path', n.path, 'props', n.props) order by n.source, n.type, n.code, n.label)
                       from public.pilo_nodes n where p_sources is null or n.source = any (p_sources)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_id, 'to', e.to_id, 'rel', e.rel))
                       from public.pilo_edges e where p_sources is null or e.source = any (p_sources)), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pilo_graph_overview(text[]) from public, anon;
grant execute on function public.pilo_graph_overview(text[]) to authenticated;

notify pgrst, 'reload schema';
