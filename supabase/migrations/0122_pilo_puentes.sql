-- =============================================================================
-- 0122 · Mr. Pilo: puentes entre ámbitos y lectura «de visita» (pasos 4, 5 y 6
-- de «un solo cerebro, varios portales»).
--
-- Con 0121 hay una sola memoria y cada portal lee solo lo de su casa. Aquí la
-- memoria de un ámbito empieza a poder leerse desde otro portal, y SOLO así:
--
--   1. la administración marca la celda «De visita» (nace apagada: esta
--      migración no cambia ninguna celda);
--   2. lo de visita entra por dos caminos y ninguno más:
--        pilo_memory_visit      cuando lo de casa no alcanza (lo decide la
--                               función pilo-ia; la base decide QUÉ se puede leer);
--        pilo_bridge_neighbors  como vecino traído por un PUENTE APROBADO desde
--                               un pasaje de casa;
--   3. la visibilidad viaja con el pasaje: lo «oculto» nunca; lo «con sesión»
--      solo para el personal de la intranet; Impacto sigue pidiendo sesión;
--      Moodle no sale de su portal aunque la celda o un puente digan otra cosa.
--
-- Las búsquedas de siempre (pilo_memory_search, _semantic, pilo_graph_neighbors,
-- pilo_graph_around, pilo_answer_candidates, pilo_memory_readable) NO cambian:
-- siguen leyendo solo lo «de casa». Por eso una respuesta guardada que citara
-- un pasaje de visita nunca estaría fresca, y la función no las guarda.
--
--   pilo_bridges              los puentes: una relación entre dos ámbitos, con su
--                             origen («reglas», «ia», «admin») y su estado
--                             («propuesta», «aprobada», «rechazada»). Tabla
--                             propia y no columnas en pilo_edges: las búsquedas
--                             recorren pilo_edges, y una relación entre ámbitos
--                             no debe poder seguirse por accidente. Aquí solo
--                             existe como puente con estado.
--   pilo_bridges_sync()       calcula y guarda los puentes por reglas: la misma
--                             referencia (un ODS, una norma con su número) o el
--                             mismo nombre de un punto del Plan de Desarrollo.
--                             Se aprueban solos. Un tema que los dos ámbitos
--                             comparten entra como PROPUESTA (lo puso la IA).
--   pilo_bridges_list(), pilo_bridges_status(), pilo_bridge_set(id, estado)
--                             leerlos, contarlos y aprobarlos o rechazarlos UNO
--                             POR UNO (solo administración).
--   pilo_bridge_candidates(), pilo_bridge_targets(), pilo_bridges_propose()
--                             los puentes que propone la IA: qué puntos faltan
--                             por revisar, contra qué se comparan y cómo se
--                             guardan las propuestas (lo rechazado no vuelve).
--   pilo_portal_update        deja marcar «De visita» (solo en fuentes de otro
--                             ámbito que puedan salir de su casa) y acepta
--                             «expect»: si la celda ya no está como la vio quien
--                             la cambia (otra pestaña), no escribe.
--   pilo_portal_preview       el efecto de un cambio, antes de hacerlo.
--   pilo_facts_search, pilo_facts_semantic
--                             + quién lee: las cifras en vivo también pasan por
--                             pilo_scope (si la celda «cifras» de ese portal
--                             dice «no», no hay cifras).
--   pilo_map_pending, _status, _save, _prune
--                             «comprender» corre también sobre los pasajes de
--                             portal (no solo los de documentos): Planeación
--                             reutiliza los temas que ya existen.
--   pilo_portals.audience     el público de cada ámbito, para saber cuándo decir
--                             «fue preparado para…».
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0121.
-- Idempotente. No volver a aplicar 0121 después de esta (devolvería sus
-- funciones a como eran); si pasa, aplicar esta otra vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El público de cada ámbito. Lo «de visita» se presenta con «fue preparado
-- para…» cuando quien pregunta no es de ese público.
-- -----------------------------------------------------------------------------

alter table public.pilo_portals add column if not exists audience text[] not null default '{}'::text[];

alter table public.pilo_portals drop constraint if exists pilo_portals_audience;
alter table public.pilo_portals add constraint pilo_portals_audience
  check (audience <@ array['visitante', 'estudiante', 'profesor', 'administrativo', 'personal']::text[]);

update public.pilo_portals set audience = array['estudiante', 'profesor'] where id = 'ensenanza' and audience = '{}'::text[];
update public.pilo_portals set audience = array['personal'] where id = 'planeacion' and audience = '{}'::text[];

comment on column public.pilo_portals.audience is
  'Para quién fue escrito lo de este ámbito: «visitante», «estudiante», «profesor», «administrativo» (cuentas de Pilo) o «personal» (sesión de la intranet). Si quien pregunta no está aquí, lo de este ámbito leído de visita se presenta con «fue preparado para…».';
comment on column public.pilo_portals.matrix is
  'Por fuente (pilo_sources.id): «casa» (del ámbito del portal: se busca siempre), «visita» (de otro ámbito: entra solo si lo de casa no alcanza o por un puente aprobado, con su procedencia) o «no».';

-- -----------------------------------------------------------------------------
-- Los puentes.
--   a_scope < b_scope   el par se guarda siempre en el mismo orden: no hay dos
--                       filas para la misma relación, ni un puente dentro de un
--                       mismo ámbito.
--   a_id, b_id          un punto de la malla de ese ámbito: un nodo (en
--                       Planeación, además, el ref de su pasaje), un documento
--                       («doc:<uuid>») o un tema o referencia que ese ámbito usa.
--   kind                «referencia» (nombran la misma norma u ODS), «nombre»
--                       (se llaman igual), «tema» (comparten un tema) o
--                       «relacion» (lo propuso la IA, con su porqué).
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_bridges (
  id          bigint generated always as identity primary key,
  a_scope     text not null,
  a_id        text not null,
  a_label     text not null default '',
  b_scope     text not null,
  b_id        text not null,
  b_label     text not null default '',
  kind        text not null default 'referencia',
  key         text not null default '',
  why         text not null default '',
  origin      text not null default 'reglas',
  status      text not null default 'propuesta',
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  uuid references public.profiles (id) on delete set null,
  constraint pilo_bridges_scopes check (a_scope in ('planeacion', 'ensenanza') and b_scope in ('planeacion', 'ensenanza') and a_scope < b_scope),
  constraint pilo_bridges_kind check (kind in ('referencia', 'nombre', 'tema', 'relacion')),
  constraint pilo_bridges_origin check (origin in ('reglas', 'ia', 'admin')),
  constraint pilo_bridges_status check (status in ('propuesta', 'aprobada', 'rechazada')),
  constraint pilo_bridges_len check (length(a_id) between 3 and 300 and length(b_id) between 3 and 300 and length(why) <= 300 and length(key) <= 200 and length(a_label) <= 300 and length(b_label) <= 300),
  constraint pilo_bridges_pair unique (a_scope, a_id, b_scope, b_id)
);

create index if not exists pilo_bridges_status_idx on public.pilo_bridges (status);
create index if not exists pilo_bridges_b_idx on public.pilo_bridges (b_scope, b_id);

comment on table public.pilo_bridges is
  'Mr. Pilo: los puentes entre ámbitos. Una relación entre dos ámbitos solo existe aquí, con su origen y su estado; la búsqueda solo sigue los «aprobada», y solo hacia fuentes que la matriz del portal permite «de visita». La administración los lee; se escriben por pilo_bridges_sync, pilo_bridges_propose y pilo_bridge_set.';

alter table public.pilo_bridges enable row level security;

drop policy if exists pilo_bridges_admin on public.pilo_bridges;
create policy pilo_bridges_admin on public.pilo_bridges
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_bridges from public, anon, authenticated;
grant select on public.pilo_bridges to authenticated, service_role;

-- Qué puntos ya revisó la IA al proponer puentes (con el nombre que tenían).
create table if not exists public.pilo_bridge_scan (
  scope       text not null,
  node_id     text not null,
  label       text not null default '',
  scanned_at  timestamptz not null default now(),
  primary key (scope, node_id)
);

alter table public.pilo_bridge_scan enable row level security;

drop policy if exists pilo_bridge_scan_admin on public.pilo_bridge_scan;
create policy pilo_bridge_scan_admin on public.pilo_bridge_scan
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_bridge_scan from public, anon, authenticated;
grant select on public.pilo_bridge_scan to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Las reglas, dichas una vez. Son las que el mapa global calculaba al dibujar.
--   pilo_bridge_norm   una etiqueta sin tildes ni signos, para comparar.
--   pilo_bridge_keys   las referencias que una etiqueta nombra: un ODS (1 a 17)
--                      o una norma con su número («Ley 30 de 1992»). `base` es
--                      la referencia sin el año; dos normas casan si tienen la
--                      misma base y el mismo año, o si una no dice el año.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_bridge_norm(p_label text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(regexp_replace(replace(public.pilo_fold(coalesce(p_label, '')), 'ñ', 'n'), '[^a-z0-9 ]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

create or replace function public.pilo_bridge_keys(p_label text)
returns table (base text, yr text, say text)
language sql
immutable
set search_path = public
as $$
  select 'ods:' || (m[1])::integer, '', 'ODS ' || (m[1])::integer
  from regexp_matches(public.pilo_bridge_norm(p_label), '\m(?:ods|objetivos? de desarrollo sostenible) ?(?:numero |no |n )?(\d{1,2})\M', 'g') m
  where (m[1])::integer between 1 and 17
  union
  select 'norma:' || m[1] || ':' || (m[2])::integer, coalesce(m[3], ''),
         (case m[1] when 'ley' then 'Ley' when 'decreto' then 'Decreto' when 'resolucion' then 'Resolución' when 'acuerdo' then 'Acuerdo' when 'circular' then 'Circular' else 'Directiva' end)
           || ' ' || (m[2])::integer || coalesce(' de ' || m[3], '')
  from regexp_matches(public.pilo_bridge_norm(p_label), '\m(ley|decreto|resolucion|acuerdo|circular|directiva) (?:numero |no |n )?(\d{1,5})(?: del? (\d{4})\M)?', 'g') m
$$;

revoke all on function public.pilo_bridge_norm(text) from public, anon;
revoke all on function public.pilo_bridge_keys(text) from public, anon;
grant execute on function public.pilo_bridge_norm(text) to authenticated, service_role;
grant execute on function public.pilo_bridge_keys(text) to authenticated, service_role;

-- ¿Ese punto existe en la malla de ese ámbito? Un nodo propio del ámbito, o un
-- tema o referencia (comunes) que ese ámbito usa. Nunca una raíz de fuente.
create or replace function public.pilo_bridge_end_ok(p_scope text, p_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.pilo_portals p where p.scope = p_scope)
     and exists (
       select 1 from public.pilo_nodes n
       where n.id = p_id and n.type <> 'fuente' and not starts_with(n.id, 'fuente:')
         and case
               when starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:')
                 then n.source = 'mapa' and exists (
                   select 1 from public.pilo_edges e
                   where e.to_id = n.id and e.space = p_scope and e.rel in ('trata', 'cita'))
               else n.space = p_scope
             end
     )
$$;

revoke all on function public.pilo_bridge_end_ok(text, text) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Calcular y guardar los puentes por reglas. Sin IA y sin parámetros: quien la
-- llama no decide qué se une. Lo que ya está (aprobado, propuesto o rechazado)
-- no se toca: un puente rechazado no vuelve. Lo que las reglas ya no dan se
-- quita si nadie lo decidió a mano.
--
--   se aprueban solos   la misma norma u ODS nombrados en los dos ámbitos; un
--                       punto del Plan de Desarrollo y un punto de otro ámbito
--                       que se llaman igual.
--   quedan propuestos   un tema que los dos ámbitos comparten, y una referencia
--                       compartida que no es una norma ni un ODS (los puso la
--                       IA al comprender: los revisa la administración).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_bridges_sync()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer := 0;
  v_removed integer := 0;
  v_found integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración calculan los puentes.' using errcode = '42501';
  end if;

  create temporary table if not exists pilo_bridge_ends (scope text, id text, label text, source text, hub boolean, norm text) on commit drop;
  create temporary table if not exists pilo_bridge_keyed (scope text, id text, label text, base text, yr text, say text) on commit drop;
  create temporary table if not exists pilo_bridge_found (
    a_scope text, a_id text, a_label text, b_scope text, b_id text, b_label text,
    kind text, key text, why text, origin text, status text, prio integer
  ) on commit drop;
  delete from pilo_bridge_ends where true;
  delete from pilo_bridge_keyed where true;
  delete from pilo_bridge_found where true;

  -- Los puntos de cada ámbito: sus nodos (sin raíces de fuente ni secciones de
  -- documento) y los temas y referencias que usa.
  insert into pilo_bridge_ends (scope, id, label, source, hub, norm)
  select n.space, n.id, n.label, n.source, false, public.pilo_bridge_norm(n.label)
  from public.pilo_nodes n
  where n.type <> 'fuente' and not starts_with(n.id, 'fuente:')
    and not starts_with(n.id, 'tema:') and not starts_with(n.id, 'ref:')
    and not (starts_with(n.id, 'doc:') and position('#' in n.id) > 0)
    and exists (select 1 from public.pilo_portals p where p.scope = n.space)
  union
  select e.space, n.id, n.label, n.source, true, public.pilo_bridge_norm(n.label)
  from public.pilo_nodes n
  join public.pilo_edges e on e.to_id = n.id and e.rel in ('trata', 'cita')
  where n.source = 'mapa' and (starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:'))
    and exists (select 1 from public.pilo_portals p where p.scope = e.space);

  insert into pilo_bridge_keyed (scope, id, label, base, yr, say)
  select x.scope, x.id, x.label, k.base, k.yr, k.say
  from pilo_bridge_ends x
  cross join lateral public.pilo_bridge_keys(x.label) k;

  -- 1. El mismo tema o la misma referencia, usados por los dos ámbitos.
  insert into pilo_bridge_found
  select a.scope, a.id, a.label, b.scope, b.id, b.label,
         case when starts_with(a.id, 'ref:') then 'referencia' else 'tema' end,
         a.id,
         (case when starts_with(a.id, 'ref:') then 'Los dos ámbitos citan «' else 'Los dos ámbitos tratan «' end) || left(a.label, 200) || '»',
         case when ruled.yes then 'reglas' else 'ia' end,
         case when ruled.yes then 'aprobada' else 'propuesta' end,
         case when ruled.yes then 1 else 4 end
  from pilo_bridge_ends a
  join pilo_bridge_ends b on b.id = a.id and a.scope < b.scope and b.hub
  cross join lateral (
    select starts_with(a.id, 'ref:') and exists (select 1 from pilo_bridge_keyed k where k.scope = a.scope and k.id = a.id) as yes
  ) ruled
  where a.hub;

  -- 2. La misma norma o el mismo ODS, nombrados por dos puntos de ámbitos distintos.
  insert into pilo_bridge_found
  select a.scope, a.id, a.label, b.scope, b.id, b.label, 'referencia',
         a.base || case when a.yr <> '' then ':' || a.yr when b.yr <> '' then ':' || b.yr else '' end,
         'Los dos nombran ' || case when a.yr <> '' or b.yr = '' then a.say else b.say end,
         'reglas', 'aprobada', 2
  from pilo_bridge_keyed a
  join pilo_bridge_keyed b on b.base = a.base and a.scope < b.scope and (a.yr = b.yr or a.yr = '' or b.yr = '');

  -- 3. Un punto del Plan de Desarrollo (un pilar, un proyecto…) y un punto de otro ámbito que se llaman igual.
  insert into pilo_bridge_found
  select case when p.scope < o.scope then p.scope else o.scope end,
         case when p.scope < o.scope then p.id else o.id end,
         case when p.scope < o.scope then p.label else o.label end,
         case when p.scope < o.scope then o.scope else p.scope end,
         case when p.scope < o.scope then o.id else p.id end,
         case when p.scope < o.scope then o.label else p.label end,
         'nombre', 'nombre:' || left(o.norm, 180), 'Se llaman igual: «' || left(p.label, 200) || '»', 'reglas', 'aprobada', 3
  from pilo_bridge_ends p
  cross join lateral (select regexp_replace(p.norm, '^(pilar|eje)( [0-9]{1,2})? (de |del )?', '') as bare) x
  join pilo_bridge_ends o on o.scope <> p.scope and (o.norm = p.norm or o.norm = x.bare)
  where p.source = 'pdi' and not p.hub
    and length(o.norm) >= 6 and o.norm !~ '^[0-9 ]+$';

  select count(*) into v_found from (select distinct a_scope, a_id, b_scope, b_id from pilo_bridge_found) f;

  insert into public.pilo_bridges (a_scope, a_id, a_label, b_scope, b_id, b_label, kind, key, why, origin, status, decided_at)
  select distinct on (f.a_scope, f.a_id, f.b_scope, f.b_id)
         f.a_scope, f.a_id, left(f.a_label, 300), f.b_scope, f.b_id, left(f.b_label, 300), f.kind, left(f.key, 200), left(f.why, 300), f.origin, f.status,
         case when f.status = 'aprobada' then now() end
  from pilo_bridge_found f
  where length(f.a_id) between 3 and 300 and length(f.b_id) between 3 and 300
  order by f.a_scope, f.a_id, f.b_scope, f.b_id, f.prio
  on conflict (a_scope, a_id, b_scope, b_id) do nothing;
  get diagnostics v_added = row_count;

  -- Lo que las reglas ya no dan: fuera, salvo lo que alguien decidió a mano y lo que propuso la IA con su porqué.
  delete from public.pilo_bridges b
  where ((b.origin = 'reglas' and b.status = 'aprobada' and b.decided_by is null) or (b.status = 'propuesta' and b.kind <> 'relacion'))
    and not exists (
      select 1 from pilo_bridge_found f
      where f.a_scope = b.a_scope and f.a_id = b.a_id and f.b_scope = b.b_scope and f.b_id = b.b_id
    );
  get diagnostics v_removed = row_count;

  return jsonb_build_object(
    'found', v_found, 'added', v_added, 'removed', v_removed,
    'total', (select count(*) from public.pilo_bridges),
    'aprobadas', (select count(*) from public.pilo_bridges where status = 'aprobada'),
    'propuestas', (select count(*) from public.pilo_bridges where status = 'propuesta'),
    'rechazadas', (select count(*) from public.pilo_bridges where status = 'rechazada')
  );
end;
$$;

revoke all on function public.pilo_bridges_sync() from public, anon;
grant execute on function public.pilo_bridges_sync() to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Leerlos, contarlos y decidirlos.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_bridges_list(p_status text default null, p_limit integer default 800)
returns table (
  id bigint, a_scope text, a_id text, a_label text, b_scope text, b_id text, b_label text,
  kind text, key text, why text, origin text, status text, created_at timestamptz, decided_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración ven los puentes.' using errcode = '42501';
  end if;
  return query
    select b.id, b.a_scope, b.a_id, b.a_label, b.b_scope, b.b_id, b.b_label, b.kind, b.key, b.why, b.origin, b.status, b.created_at, b.decided_at
    from public.pilo_bridges b
    where p_status is null or b.status = p_status
    order by case b.status when 'propuesta' then 0 when 'aprobada' then 1 else 2 end, b.created_at desc, b.id desc
    limit greatest(1, least(coalesce(p_limit, 800), 2000));
end;
$$;

revoke all on function public.pilo_bridges_list(text, integer) from public, anon;
grant execute on function public.pilo_bridges_list(text, integer) to authenticated, service_role;

-- Un puente a la vez, y solo la administración: ni la función del servidor los aprueba.
create or replace function public.pilo_bridge_set(p_id bigint, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_bridges;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración aprueba o rechaza un puente.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('aprobada', 'rechazada') then
    raise exception 'Un puente se aprueba o se rechaza.' using errcode = '22023';
  end if;
  update public.pilo_bridges set status = p_status, decided_by = auth.uid(), decided_at = now()
  where id = p_id
  returning * into v_row;
  if not found then
    raise exception 'Ese puente no existe.' using errcode = '22023';
  end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status, 'origin', v_row.origin, 'kind', v_row.kind);
end;
$$;

revoke all on function public.pilo_bridge_set(bigint, text) from public, anon;
grant execute on function public.pilo_bridge_set(bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Los puentes que propone la IA (con revisión).
--   pilo_bridge_candidates   los puntos de un ámbito que la IA aún no revisó
--                            (o que cambiaron de nombre desde entonces).
--   pilo_bridge_targets      contra qué se comparan: los documentos y los temas
--                            y referencias de los OTROS ámbitos, los más usados
--                            primero.
--   pilo_bridges_propose     guarda las propuestas («propuesta», origen «ia»)
--                            y anota lo revisado. Cada extremo tiene que existir
--                            en su ámbito y los ámbitos tienen que ser distintos.
--                            Lo que ya existe —aprobado, propuesto o rechazado—
--                            no se toca.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_bridge_candidates(p_scope text default 'planeacion', p_limit integer default 12)
returns table (scope text, id text, label text, type text, source text)
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
    select n.space, n.id, n.label, n.type, n.source
    from public.pilo_nodes n
    where n.space = p_scope and n.type <> 'fuente' and not starts_with(n.id, 'fuente:')
      and not starts_with(n.id, 'tema:') and not starts_with(n.id, 'ref:')
      and not (starts_with(n.id, 'doc:') and position('#' in n.id) > 0)
      and length(btrim(n.label)) >= 6
      and not exists (
        select 1 from public.pilo_bridge_scan s
        where s.scope = n.space and s.node_id = n.id and s.label = n.label
      )
    order by n.source, n.id
    limit greatest(1, least(coalesce(p_limit, 12), 40));
end;
$$;

revoke all on function public.pilo_bridge_candidates(text, integer) from public, anon;
grant execute on function public.pilo_bridge_candidates(text, integer) to authenticated, service_role;

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
    ) t
    where t.uses > 0 and exists (select 1 from public.pilo_portals p where p.scope = t.scope)
    order by t.uses desc, t.label, t.id
    limit greatest(1, least(coalesce(p_limit, 60), 120));
end;
$$;

revoke all on function public.pilo_bridge_targets(text, integer) from public, anon;
grant execute on function public.pilo_bridge_targets(text, integer) to authenticated, service_role;

create or replace function public.pilo_bridges_propose(p_rows jsonb, p_scanned jsonb default '[]'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_given integer := 0;
  v_added integer := 0;
  v_scanned integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración proponen puentes.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_scanned, 'null'::jsonb)) <> 'array' then
    raise exception 'Las propuestas y lo revisado deben ser listas.' using errcode = '22023';
  end if;
  v_given := jsonb_array_length(p_rows);

  insert into public.pilo_bridges (a_scope, a_id, a_label, b_scope, b_id, b_label, kind, key, why, origin, status)
  select distinct on (x.s1, x.i1, x.s2, x.i2)
         x.s1, x.i1, left(coalesce((select n.label from public.pilo_nodes n where n.id = x.i1), ''), 300),
         x.s2, x.i2, left(coalesce((select n.label from public.pilo_nodes n where n.id = x.i2), ''), 300),
         'relacion', '', x.why, 'ia', 'propuesta'
  from (
    select case when r->>'a_scope' < r->>'b_scope' then r->>'a_scope' else r->>'b_scope' end as s1,
           case when r->>'a_scope' < r->>'b_scope' then r->>'a_id' else r->>'b_id' end as i1,
           case when r->>'a_scope' < r->>'b_scope' then r->>'b_scope' else r->>'a_scope' end as s2,
           case when r->>'a_scope' < r->>'b_scope' then r->>'b_id' else r->>'a_id' end as i2,
           btrim(regexp_replace(coalesce(r->>'why', ''), '\s+', ' ', 'g')) as why
    from jsonb_array_elements(p_rows) r
    where jsonb_typeof(r) = 'object'
  ) x
  where x.s1 is not null and x.s2 is not null and x.s1 <> x.s2
    and length(coalesce(x.i1, '')) between 3 and 300 and length(coalesce(x.i2, '')) between 3 and 300
    and length(x.why) between 8 and 200
    and x.why !~* '(https?:|www\.|://|<<<|>>>|@)' and x.why !~ 'DATOS'
    and public.pilo_bridge_end_ok(x.s1, x.i1) and public.pilo_bridge_end_ok(x.s2, x.i2)
  order by x.s1, x.i1, x.s2, x.i2
  on conflict (a_scope, a_id, b_scope, b_id) do nothing;
  get diagnostics v_added = row_count;

  insert into public.pilo_bridge_scan as s (scope, node_id, label, scanned_at)
  select distinct on (r->>'scope', r->>'id') r->>'scope', r->>'id', n.label, now()
  from jsonb_array_elements(p_scanned) r
  join public.pilo_nodes n on n.id = r->>'id' and n.space = r->>'scope'
  where jsonb_typeof(r) = 'object'
  on conflict (scope, node_id) do update set label = excluded.label, scanned_at = excluded.scanned_at;
  get diagnostics v_scanned = row_count;

  return jsonb_build_object('given', v_given, 'added', v_added, 'scanned', v_scanned);
end;
$$;

revoke all on function public.pilo_bridges_propose(jsonb, jsonb) from public, anon;
grant execute on function public.pilo_bridges_propose(jsonb, jsonb) to authenticated, service_role;

create or replace function public.pilo_bridges_status(p_scope text default 'planeacion')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración ven los puentes.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'total', (select count(*) from public.pilo_bridges),
    'aprobadas', (select count(*) from public.pilo_bridges where status = 'aprobada'),
    'propuestas', (select count(*) from public.pilo_bridges where status = 'propuesta'),
    'rechazadas', (select count(*) from public.pilo_bridges where status = 'rechazada'),
    'reglas', (select count(*) from public.pilo_bridges where origin = 'reglas'),
    'ia', (select count(*) from public.pilo_bridges where origin = 'ia'),
    'pending', (select count(*) from public.pilo_nodes n
                where n.space = p_scope and n.type <> 'fuente' and not starts_with(n.id, 'fuente:')
                  and not starts_with(n.id, 'tema:') and not starts_with(n.id, 'ref:')
                  and not (starts_with(n.id, 'doc:') and position('#' in n.id) > 0)
                  and length(btrim(n.label)) >= 6
                  and not exists (select 1 from public.pilo_bridge_scan s where s.scope = n.space and s.node_id = n.id and s.label = n.label)),
    'scanned', (select count(*) from public.pilo_bridge_scan s where s.scope = p_scope),
    'targets', (select count(*) from public.pilo_bridge_targets(p_scope, 120))
  );
end;
$$;

revoke all on function public.pilo_bridges_status(text) from public, anon;
grant execute on function public.pilo_bridges_status(text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- LA LECTURA DE VISITA. Dos funciones nuevas y ninguna más lee lo de otro
-- ámbito. Las dos pasan por pilo_scope, que ya dice:
--   · «visita» solo es una fuente de OTRO ámbito, con la celda en «visita»;
--   · sin lo que no sale de casa (Moodle), diga lo que diga la celda;
--   · una fuente que pide sesión (Impacto), solo para el personal;
--   · `vis`: «publico» siempre; «sesion» solo el personal de la intranet. Una
--     cuenta de Pilo no es personal.
-- Cada pasaje vuelve con su procedencia: su ámbito, el nombre de su fuente, el
-- nombre del portal de ese ámbito, para quién fue escrito y su público.
-- Leer de visita no eleva permisos: es el mismo filtro, con otra celda.
-- -----------------------------------------------------------------------------

-- Por palabras, en lo «de visita». La función pilo-ia la llama solo cuando lo
-- de casa no alcanza. Sin sesión de la intranet de partida (p_public_only).
create or replace function public.pilo_memory_visit(
  p_q text,
  p_limit integer default 4,
  p_space text default 'planeacion',
  p_public_only boolean default true,
  p_member boolean default false
)
returns table (
  ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, rank real,
  space text, source_name text, home_name text, written_for text, audience text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_q))::text, ' & ', ' | ');
  v_portal text := coalesce(p_space, 'planeacion');
  v_session boolean := not coalesce(p_public_only, true);
  v_member boolean := coalesce(p_member, false);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración buscan en la memoria.' using errcode = '42501';
  end if;
  if coalesce(words, '') = '' then
    return;
  end if;
  return query
    select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.updated_at,
           ts_rank_cd(m.fts, words::tsquery, 32)::real as rank,
           m.space, sc.name, coalesce(hp.name, ''), coalesce(hp.written_for, ''), coalesce(hp.audience, '{}'::text[])
    from public.pilo_memory m
    join public.pilo_scope(v_portal, v_session, v_member) sc on sc.source = m.source and sc.space = m.space
    left join lateral (
      select p.name, p.written_for, p.audience from public.pilo_portals p where p.scope = m.space order by p.sort, p.id limit 1
    ) hp on true
    where m.fts @@ words::tsquery
      and sc.mode = 'visita'
      and m.vis <> 'oculto'
      and m.vis = any (sc.vis)
    order by rank desc, m.updated_at desc, m.ref
    limit greatest(1, least(coalesce(p_limit, 4), 8));
end;
$$;

revoke all on function public.pilo_memory_visit(text, integer, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_memory_visit(text, integer, text, boolean, boolean) to authenticated, service_role;

-- Los vecinos de otro ámbito que un puente APROBADO trae desde unos pasajes de
-- casa. Un pasaje «toca» un puente si es su extremo, si es de su documento o si
-- trata o cita su tema o referencia (en el ámbito de casa). Del otro lado, lo
-- mismo: el pasaje, los del documento, o los que tratan ese tema en SU ámbito.
-- Los pasajes de entrada que este portal no lee de casa para esta persona no
-- cuentan. A lo sumo 4.
create or replace function public.pilo_bridge_neighbors(
  p_refs text[],
  p_space text,
  p_public_only boolean default true,
  p_member boolean default false,
  p_limit integer default 2
)
returns table (
  ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz,
  space text, source_name text, home_name text, written_for text, audience text[],
  bridge bigint, why text, origin text, kind text, shared integer
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_portal text := coalesce(p_space, 'planeacion');
  v_scope text;
  v_session boolean := not coalesce(p_public_only, true);
  v_member boolean := coalesce(p_member, false);
  v_refs text[] := (coalesce(p_refs, '{}'::text[]))[1:20];
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración siguen los puentes.' using errcode = '42501';
  end if;
  if cardinality(v_refs) = 0 then
    return;
  end if;
  select p.scope into v_scope from public.pilo_portals p where p.id = v_portal;
  if v_scope is null then
    return;
  end if;
  return query
    with mine as (
      select m.ref, m.doc_id
      from public.pilo_memory m
      join public.pilo_scope(v_portal, v_session, v_member) sc on sc.source = m.source and sc.space = m.space
      where m.ref = any (v_refs) and sc.mode = 'casa' and m.vis <> 'oculto' and m.vis = any (sc.vis)
    ),
    home as (
      select mine.ref as end_id from mine
      union
      select 'doc:' || mine.doc_id::text from mine where mine.doc_id is not null
      union
      select e.to_id from public.pilo_edges e join mine on mine.ref = e.from_id
      where e.space = v_scope and e.rel in ('trata', 'cita')
    ),
    hits as (
      select b.id, b.b_scope as o_scope, b.b_id as o_id
      from public.pilo_bridges b
      where b.status = 'aprobada' and b.a_scope = v_scope and b.a_id in (select h.end_id from home h)
      union
      select b.id, b.a_scope, b.a_id
      from public.pilo_bridges b
      where b.status = 'aprobada' and b.b_scope = v_scope and b.b_id in (select h.end_id from home h)
    ),
    far as (
      select h.id, m.ref as far_ref
      from hits h join public.pilo_memory m on m.ref = h.o_id and m.space = h.o_scope
      union
      select h.id, m.ref
      from hits h join public.pilo_memory m on m.space = h.o_scope and m.doc_id is not null and h.o_id = 'doc:' || m.doc_id::text
      union
      select h.id, m.ref
      from hits h
      join public.pilo_edges e on e.to_id = h.o_id and e.space = h.o_scope and e.rel in ('trata', 'cita')
      join public.pilo_memory m on m.ref = e.from_id and m.space = h.o_scope
    ),
    best as (
      select f.far_ref, count(distinct f.id)::integer as n, min(f.id) as first_bridge
      from far f
      group by f.far_ref
    )
    select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.updated_at,
           m.space, sc.name, coalesce(hp.name, ''), coalesce(hp.written_for, ''), coalesce(hp.audience, '{}'::text[]),
           b.id, b.why, b.origin, b.kind, best.n
    from best
    join public.pilo_memory m on m.ref = best.far_ref
    join public.pilo_scope(v_portal, v_session, v_member) sc on sc.source = m.source and sc.space = m.space
    join public.pilo_bridges b on b.id = best.first_bridge
    left join lateral (
      select p.name, p.written_for, p.audience from public.pilo_portals p where p.scope = m.space order by p.sort, p.id limit 1
    ) hp on true
    where sc.mode = 'visita'
      and m.vis <> 'oculto'
      and m.vis = any (sc.vis)
      and m.ref <> all (v_refs)
    order by best.n desc, m.updated_at desc, m.ref
    limit greatest(1, least(coalesce(p_limit, 2), 4));
end;
$$;

revoke all on function public.pilo_bridge_neighbors(text[], text, boolean, boolean, integer) from public, anon;
grant execute on function public.pilo_bridge_neighbors(text[], text, boolean, boolean, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Las cifras en vivo (0107, 0108) también pasan por el filtro: se dan solo si la
-- celda «cifras» de ese portal las deja leer a esa persona, de casa o de visita.
-- Quien llame como antes (sin decir quién lee) pregunta por el portal de siempre.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_facts_search(text, integer);

create or replace function public.pilo_facts_search(
  p_q text,
  p_limit integer default 3,
  p_space text default 'planeacion',
  p_public_only boolean default false,
  p_member boolean default false
)
returns table (ref text, report text, label text, unit text, format text, definition text, office text, path text, period text, illustrative boolean, series jsonb, rank real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_q))::text, ' & ', ' | ');
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración buscan en las cifras.' using errcode = '42501';
  end if;
  if coalesce(words, '') = '' then
    return;
  end if;
  if not exists (
    select 1 from public.pilo_scope(coalesce(p_space, 'planeacion'), not coalesce(p_public_only, false), coalesce(p_member, false)) sc
    where sc.source = 'cifras'
  ) then
    return;
  end if;
  return query
    select f.ref, f.report, f.label, f.unit, f.format, f.definition, f.office, f.path, f.period, f.illustrative, f.series,
           ts_rank_cd(f.fts, words::tsquery, 32)::real as rank
    from public.pilo_facts f
    where f.fts @@ words::tsquery
    order by rank desc, f.label
    limit greatest(1, least(coalesce(p_limit, 3), 10));
end;
$$;

revoke all on function public.pilo_facts_search(text, integer, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_facts_search(text, integer, text, boolean, boolean) to authenticated, service_role;

drop function if exists public.pilo_facts_semantic(text, text, integer, real);

create or replace function public.pilo_facts_semantic(
  p_embedding text,
  p_model text,
  p_limit integer default 3,
  p_min real default 0.3,
  p_space text default 'planeacion',
  p_public_only boolean default false,
  p_member boolean default false
)
returns table (ref text, report text, label text, unit text, format text, definition text, office text, path text, period text, illustrative boolean, series jsonb, sim real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración buscan en las cifras.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.pilo_scope(coalesce(p_space, 'planeacion'), not coalesce(p_public_only, false), coalesce(p_member, false)) sc
    where sc.source = 'cifras'
  ) then
    return;
  end if;
  return query
    select * from (
      select f.ref, f.report, f.label, f.unit, f.format, f.definition, f.office, f.path, f.period, f.illustrative, f.series,
             (1 - (f.embedding <=> q.v))::real as sim
      from public.pilo_facts f, (select p_embedding::extensions.vector as v) q
      where f.embedding is not null and f.embed_model = p_model
      order by f.embedding <=> q.v
      limit greatest(1, least(coalesce(p_limit, 3), 10))
    ) near
    where near.sim >= coalesce(p_min, 0.3);
end;
$$;

revoke all on function public.pilo_facts_semantic(text, text, integer, real, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_facts_semantic(text, text, integer, real, text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Cambiar un portal: ahora deja marcar «De visita».
--   · «casa»    solo en fuentes del ámbito del propio portal;
--   · «visita»  solo en fuentes de OTRO ámbito que puedan salir de su casa
--               (nunca los cursos de Moodle);
--   · «no»      siempre.
-- pilo_cell_effect revisa una celda y cuenta su efecto: cuántos pasajes tiene
-- esa fuente (públicos y «con sesión»), cuántas guardadas del portal la citan y
-- cuántos puentes aprobados hay entre los dos ámbitos. pilo_portal_preview lo
-- devuelve sin cambiar nada, para decirlo ANTES de confirmar.
-- «expect» ({fuente: valor}) es lo que veía quien cambia: si la celda ya no
-- está así (otra pestaña la cambió), no se escribe nada.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_cell_effect(p_portal text, p_source text, p_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pilo_portals;
  v_src public.pilo_sources;
  v_old text;
  v_home public.pilo_portals;
begin
  select * into v_row from public.pilo_portals where id = p_portal;
  if not found then
    raise exception 'Portal desconocido: %', p_portal using errcode = '22023';
  end if;
  select * into v_src from public.pilo_sources where id = p_source;
  if not found then
    raise exception 'Fuente desconocida: %', p_source using errcode = '22023';
  end if;
  if p_value is null or p_value not in ('casa', 'visita', 'no') then
    raise exception 'Cada fuente es «casa», «visita» o «no».' using errcode = '22023';
  end if;
  if p_value = 'casa' and v_src.scope <> v_row.scope then
    raise exception '«De casa» es solo para las fuentes del propio portal: «%» es de otro ámbito.', v_src.name using errcode = '22023';
  end if;
  if p_value = 'visita' and v_src.scope = v_row.scope then
    raise exception '«De visita» es solo para las fuentes de otro ámbito: «%» es de la casa de este portal.', v_src.name using errcode = '22023';
  end if;
  if p_value = 'visita' and v_src.stays_home then
    raise exception '«%» no sale de su portal: no se puede leer de visita.', v_src.name using errcode = '22023';
  end if;
  v_old := coalesce(v_row.matrix ->> p_source, 'no');
  select * into v_home from public.pilo_portals p where p.scope = v_src.scope order by p.sort, p.id limit 1;
  return jsonb_build_object(
    'source', p_source, 'name', v_src.name, 'from', v_old, 'to', p_value,
    'passages', (select count(*) from public.pilo_memory m where m.source = p_source and m.vis <> 'oculto'),
    'public', (select count(*) from public.pilo_memory m where m.source = p_source and m.vis = 'publico'),
    'session', (select count(*) from public.pilo_memory m where m.source = p_source and m.vis = 'sesion'),
    'answers', (select count(*) from public.pilo_answers a
                where a.space = v_row.id and not a.hidden
                  and exists (select 1 from unnest(a.refs) r join public.pilo_memory m on m.ref = r where m.source = p_source)),
    'bridges', (select count(*) from public.pilo_bridges b
                where b.status = 'aprobada' and v_src.scope <> v_row.scope
                  and ((b.a_scope = v_row.scope and b.b_scope = v_src.scope) or (b.b_scope = v_row.scope and b.a_scope = v_src.scope))),
    'staff_only', v_src.staff_only,
    'home', coalesce(v_home.name, ''),
    'written_for', coalesce(v_home.written_for, '')
  );
end;
$$;

revoke all on function public.pilo_cell_effect(text, text, text) from public, anon, authenticated;

create or replace function public.pilo_portal_preview(p_portal text, p_source text, p_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cambia qué lee cada portal de Pilo.' using errcode = '42501';
  end if;
  return public.pilo_cell_effect(p_portal, p_source, p_value);
end;
$$;

revoke all on function public.pilo_portal_preview(text, text, text) from public, anon;
grant execute on function public.pilo_portal_preview(text, text, text) to authenticated;

create or replace function public.pilo_portal_update(p_portal text, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_portals;
  v_patch jsonb := coalesce(p_patch, '{}'::jsonb);
  v_cells jsonb;
  v_expect jsonb;
  v_matrix jsonb;
  v_key text;
  v_value text;
  v_effect jsonb;
  v_effects jsonb := '[]'::jsonb;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cambia qué lee cada portal de Pilo.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_patch) <> 'object' then
    raise exception 'Los cambios deben ser un objeto.' using errcode = '22023';
  end if;
  select * into v_row from public.pilo_portals where id = p_portal for update;
  if not found then
    raise exception 'Portal desconocido: %', p_portal using errcode = '22023';
  end if;
  v_cells := case when v_patch ? 'matrix' then v_patch -> 'matrix' else '{}'::jsonb end;
  if jsonb_typeof(v_cells) <> 'object' then
    raise exception 'La matriz debe ser un objeto: fuente y valor.' using errcode = '22023';
  end if;
  v_expect := case when v_patch ? 'expect' then v_patch -> 'expect' else '{}'::jsonb end;
  if jsonb_typeof(v_expect) <> 'object' then
    raise exception 'Lo esperado debe ser un objeto: fuente y valor.' using errcode = '22023';
  end if;
  -- ¿La matriz sigue como la veía quien la cambia? Si otra pestaña movió esa celda, no se escribe.
  for v_key, v_value in select e.key, e.value #>> '{}' from jsonb_each(v_expect) e order by e.key loop
    if coalesce(v_row.matrix ->> v_key, 'no') is distinct from v_value then
      raise exception 'Esa celda cambió mientras tanto (ahora dice «%»): no se aplicó nada. Revise la matriz y confirme de nuevo.', coalesce(v_row.matrix ->> v_key, 'no')
        using errcode = '40001';
    end if;
  end loop;
  v_matrix := v_row.matrix;

  for v_key, v_value in select e.key, e.value #>> '{}' from jsonb_each(v_cells) e order by e.key loop
    v_effect := public.pilo_cell_effect(p_portal, v_key, v_value);
    if v_effect ->> 'from' <> v_value then
      v_effects := v_effects || v_effect;
    end if;
    v_matrix := v_matrix || jsonb_build_object(v_key, v_value);
  end loop;

  update public.pilo_portals set
    matrix = v_matrix,
    written_for = case when v_patch ? 'written_for' then left(btrim(regexp_replace(coalesce(v_patch ->> 'written_for', ''), '\s+', ' ', 'g')), 200) else written_for end,
    name = case when btrim(coalesce(v_patch ->> 'name', '')) <> '' then left(btrim(v_patch ->> 'name'), 120) else name end,
    updated_by = auth.uid(),
    updated_at = now()
  where id = p_portal
  returning * into v_row;

  return jsonb_build_object('portal', v_row.id, 'scope', v_row.scope, 'matrix', v_row.matrix, 'written_for', v_row.written_for, 'name', v_row.name, 'effects', v_effects);
end;
$$;

revoke all on function public.pilo_portal_update(text, jsonb) from public, anon;
grant execute on function public.pilo_portal_update(text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- «Comprender» también sobre los pasajes de portal (paso 4). Son las funciones
-- de 0121 sin la condición «solo pasajes de documentos»: en Enseñanza nada
-- cambia (todos sus pasajes son de documentos o de cursos); en Planeación
-- entran además los pasajes de sus portales, que reutilizan los temas que ya
-- existen. Los de documentos van primero.
--   pilo_map_prune   además quita las relaciones de «comprender» de un pasaje de
--                    portal que ya no existe («Actualizar la memoria» lo borró).
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
    where m.space = p_space and m.vis <> 'oculto'
      and (p_doc is null or m.doc_id = p_doc)
      and (m.mapped_at is null or m.mapped_at < m.updated_at)
    order by m.doc_id, length(m.ref), m.ref
    limit greatest(1, least(coalesce(p_limit, 18), 60));
end;
$$;

revoke all on function public.pilo_map_pending(text, uuid, integer) from public, anon;
grant execute on function public.pilo_map_pending(text, uuid, integer) to authenticated, service_role;

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
    'topics', (select count(*) from public.pilo_nodes n
               where n.source = 'mapa' and starts_with(n.id, 'tema:')
                 and (n.space = p_space or exists (select 1 from public.pilo_edges e where e.space = p_space and e.to_id = n.id))),
    'refs', (select count(*) from public.pilo_nodes n
             where n.source = 'mapa' and starts_with(n.id, 'ref:')
               and (n.space = p_space or exists (select 1 from public.pilo_edges e where e.space = p_space and e.to_id = n.id)))
  ) into v
  from public.pilo_memory m
  where m.space = p_space and m.vis <> 'oculto'
    and (p_doc is null or m.doc_id = p_doc);
  return v;
end;
$$;

revoke all on function public.pilo_map_status(text, uuid) from public, anon;
grant execute on function public.pilo_map_status(text, uuid) to authenticated, service_role;

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
  -- Lo que «comprender» dijo de un pasaje de portal que ya no existe.
  delete from public.pilo_edges e
  where e.source = 'mapa' and e.origin = 'ia' and e.rel in ('trata', 'cita')
    and not starts_with(e.from_id, 'doc:')
    and not exists (select 1 from public.pilo_memory m where m.ref = e.from_id);
  delete from public.pilo_nodes n
  where n.source = 'mapa'
    and (starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:'))
    and not exists (
      select 1 from public.pilo_edges e
      where e.from_id = n.id or e.to_id = n.id
    );
  get diagnostics v_removed = row_count;
  return v_removed;
end;
$$;

revoke all on function public.pilo_map_prune(text) from public, anon;
grant execute on function public.pilo_map_prune(text) to authenticated, service_role;

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
  if not exists (select 1 from public.pilo_portals p where p.scope = p_space) then
    raise exception 'Espacio desconocido: %', p_space using errcode = '22023';
  end if;

  create temporary table if not exists pilo_map_rows (ref text primary key, doc_id uuid, topics jsonb, refs jsonb) on commit drop;
  create temporary table if not exists pilo_map_links (ref text, rel text, id text, label text, primary key (ref, rel, id)) on commit drop;
  delete from pilo_map_rows where true;
  delete from pilo_map_links where true;

  -- Solo pasajes de este ámbito (de documentos o de sus portales), nunca uno oculto.
  insert into pilo_map_rows (ref, doc_id, topics, refs)
  select distinct on (m.ref) m.ref, m.doc_id,
    case when jsonb_typeof(r->'topics') = 'array' then r->'topics' else '[]'::jsonb end,
    case when jsonb_typeof(r->'refs') = 'array' then r->'refs' else '[]'::jsonb end
  from jsonb_array_elements(p_rows) r
  join public.pilo_memory m on m.ref = r->>'ref'
  where m.space = p_space and (m.doc_id is not null or m.vis <> 'oculto');
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
      where t.ord <= 6
      union all
      select w.ref, 'cita'::text, 'ref:'::text, t.ord,
        btrim(case jsonb_typeof(t.item) when 'string' then t.item #>> '{}' else coalesce(t.item->>'label', '') end),
        case jsonb_typeof(t.item) when 'object' then coalesce(t.item->>'id', '') else '' end
      from pilo_map_rows w, jsonb_array_elements(w.refs) with ordinality as t (item, ord)
      where t.ord <= 5
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

  -- Un tema que ya existe —lo haya creado el ámbito que sea— conserva su etiqueta.
  insert into public.pilo_nodes (id, source, type, label, props, space)
  select distinct on (l.id) l.id, 'mapa', case l.rel when 'trata' then 'tema' else 'referencia' end, l.label,
    jsonb_build_object('kind', case l.rel when 'trata' then 'tema' else 'referencia' end), p_space
  from pilo_map_links l
  order by l.id, l.ref
  on conflict (id) do nothing;

  -- La relación es de este ámbito; el tema o la referencia es común.
  insert into public.pilo_edges (from_id, to_id, rel, source, space, origin)
  select l.ref, l.id, l.rel, 'mapa', p_space, 'ia'
  from pilo_map_links l
  join public.pilo_nodes n on n.id = l.id
  where n.source = 'mapa'
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

notify pgrst, 'reload schema';
