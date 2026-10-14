-- =============================================================================
-- 0121 · Mr. Pilo: un solo cerebro, varios portales (pasos 1, 2 y 3).
--
-- Hasta aquí había dos memorias separadas por una pared: un CHECK ataba cada
-- fuente a su espacio y cada búsqueda filtraba por `space`. Desde aquí hay una
-- sola memoria y cada portal es una VISTA sobre ella. La separación deja de ser
-- una pared y pasa a ser una regla de filtro, así que la regla vive en un solo
-- sitio de la base (pilo_scope) y todas las búsquedas la usan.
--
--   pilo_sources              el catálogo de fuentes: de qué ámbito es cada una
--                             (su casa), cómo se llama, si la llenan los
--                             portales, los documentos o Moodle, si pide sesión
--                             de la intranet (Impacto) y si no sale de su casa
--                             (Moodle). Una fuente nueva es una fila.
--   pilo_portals              una fila por portal («planeacion», «ensenanza»):
--                             su ámbito de casa, para quién fue escrito lo suyo
--                             («preparado para…») y la MATRIZ: por cada fuente,
--                             «casa», «visita» o «no». Es el único lugar que dice
--                             qué lee cada portal.
--                             No absorbe pilo_spaces ni pilo_ai_settings: la
--                             persona, el tono por rol, los cupos, el chat
--                             emergente y Moodle siguen donde están. Lo único
--                             que estaba repetido —`memory_sources`— queda como
--                             ESPEJO de la matriz (dos disparadores lo mantienen
--                             en los dos sentidos), para que la función y la
--                             intranet de antes sigan funcionando.
--   pilo_scope(portal, sesión, cuenta)
--                             qué fuentes puede leer ese portal para esa persona
--                             y con qué visibilidad. En orden: visibilidad del
--                             pasaje, matriz, quién pregunta, fuentes que no
--                             salen de casa.
--   pilo_portal_update(portal, cambios)
--                             cambia la matriz o el «preparado para…» y devuelve
--                             el efecto de cada celda. Solo la administración.
--   pilo_memory_readable(refs, portal, solo público, cuenta)
--                             de unos pasajes, los que ese portal y esa persona
--                             pueden leer (para las respuestas guardadas).
--
-- LA MATRIZ NACE CON LO DE HOY: cada portal lee solo sus fuentes encendidas y
-- nada del otro ámbito. La lectura «de visita» existe como valor y pilo_scope
-- la devuelve aparte, pero ninguna búsqueda la usa todavía y
-- pilo_portal_update no deja marcarla: se enciende en una entrega posterior.
--
-- Cambian (se BORRA la firma vieja y se crea la nueva; todo parámetro nuevo
-- tiene valor de partida, así la función pilo-ia desplegada antes de esta
-- migración sigue llamando igual):
--
--   pilo_memory_search, pilo_memory_semantic, pilo_answer_candidates,
--   pilo_graph_neighbors      + p_member; filtran por pilo_scope.
--   pilo_graph_around         + p_public_only, p_member; filtra por pilo_scope
--                             (la administración sigue viendo la malla entera
--                             de su ámbito).
--   `p_space` es ahora el PORTAL que pregunta (los ids coinciden con los de hoy).
--
-- Sin cambio: pilo_graph_overview (solo administración: es el mapa completo de
-- un ámbito, no una búsqueda), el catálogo, la bandeja y la bitácora (siguen
-- siendo por portal y por rol), pilo_facts_* (las cifras en vivo las pide la
-- función solo si la vista del portal trae «cifras»).
--
-- Se quitan los CHECK fuente ↔ espacio de pilo_memory, pilo_nodes y pilo_edges
-- y el de las colecciones de pilo_docs. `space` queda como PROCEDENCIA: el
-- ámbito del pasaje. Que un pasaje lleve el ámbito de su fuente lo garantiza
-- ahora una llave a pilo_sources (dato, no esquema).
--
-- Documentos para el Pilo general: pilo_docs acepta el ámbito «planeacion» con
-- tres colecciones propias («institucional», «normativa», «lineamientos»), que
-- nacen en «no». El mapa sin IA, los vectores y «comprender» sirven igual. Los
-- temas y referencias («tema:…», «ref:…») pasan a ser nodos COMUNES: cada
-- ámbito conserva sus relaciones (pilo_edges.space) y los vecinos siguen sin
-- cruzar de ámbito.
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0113–0120.
-- Idempotente. Sin pgvector (PGlite) pilo_memory_semantic existe y falla solo
-- al llamarla, igual que en 0108 y 0113. Conviene aplicarla de una sola vez.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- El catálogo de fuentes.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_sources (
  id          text primary key,
  scope       text not null,
  name        text not null,
  kind        text not null default 'portal',
  staff_only  boolean not null default false,
  stays_home  boolean not null default false,
  sort        integer not null default 100,
  constraint pilo_sources_id check (id ~ '^[a-z]{3,30}$' and id <> 'mapa'),
  constraint pilo_sources_scope check (scope in ('planeacion', 'ensenanza')),
  constraint pilo_sources_kind check (kind in ('portal', 'documentos', 'moodle')),
  constraint pilo_sources_name check (length(name) between 1 and 80),
  constraint pilo_sources_id_scope unique (id, scope)
);

comment on table public.pilo_sources is
  'Mr. Pilo: el catálogo de fuentes de la memoria. «scope» es el ámbito de casa (la procedencia de sus pasajes); «kind», quién la llena; «staff_only», que pide sesión de la intranet en cualquier portal; «stays_home», que nunca se lee desde otro portal.';

insert into public.pilo_sources (id, scope, name, kind, staff_only, stays_home, sort) values
  ('cifras',        'planeacion', 'UDES en Cifras',            'portal',     false, false, 1),
  ('boletines',     'planeacion', 'Boletines',                 'portal',     false, false, 2),
  ('pdi',           'planeacion', 'Plan de Desarrollo',        'portal',     false, false, 3),
  ('observatorio',  'planeacion', 'Observatorio',              'portal',     false, false, 4),
  ('impacto',       'planeacion', 'Portal de Impacto',         'portal',     true,  false, 5),
  ('institucional', 'planeacion', 'Documentos institucionales', 'documentos', false, false, 6),
  ('normativa',     'planeacion', 'Normativa',                 'documentos', false, false, 7),
  ('lineamientos',  'planeacion', 'Lineamientos y guías',      'documentos', false, false, 8),
  ('innovacion',    'ensenanza',  'Innovación educativa',      'documentos', false, false, 11),
  ('politicas',     'ensenanza',  'Políticas institucionales', 'documentos', false, false, 12),
  ('global',        'ensenanza',  'Mirada global',             'documentos', false, false, 13),
  ('moodle',        'ensenanza',  'Cursos de Moodle',          'moodle',     false, true,  14)
on conflict (id) do nothing;

alter table public.pilo_sources enable row level security;

drop policy if exists pilo_sources_admin on public.pilo_sources;
create policy pilo_sources_admin on public.pilo_sources
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_sources from public, anon, authenticated;
grant select on public.pilo_sources to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Los portales y su matriz.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_matrix_ok(p_matrix jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select jsonb_typeof(p_matrix) = 'object'
     and not exists (
       select 1 from jsonb_each(p_matrix) e
       where jsonb_typeof(e.value) <> 'string' or (e.value #>> '{}') not in ('casa', 'visita', 'no')
     )
$$;

revoke all on function public.pilo_matrix_ok(jsonb) from public, anon;
grant execute on function public.pilo_matrix_ok(jsonb) to authenticated, service_role;

create table if not exists public.pilo_portals (
  id           text primary key,
  scope        text not null,
  name         text not null default '',
  written_for  text not null default '',
  matrix       jsonb not null default '{}'::jsonb,
  sort         integer not null default 100,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint pilo_portals_id check (id ~ '^[a-z]{3,20}$'),
  constraint pilo_portals_scope check (scope in ('planeacion', 'ensenanza')),
  constraint pilo_portals_len check (length(name) <= 120 and length(written_for) <= 200),
  constraint pilo_portals_matrix check (public.pilo_matrix_ok(matrix))
);

comment on table public.pilo_portals is
  'Mr. Pilo: cada portal es una vista de la memoria. «scope» es su ámbito de casa; «matrix», qué lee de cada fuente («casa», «visita» o «no»; lo que no está es «no»); «written_for», para quién fue escrito lo de su ámbito. La administración la lee; se cambia por pilo_portal_update.';
comment on column public.pilo_portals.matrix is
  'Por fuente (pilo_sources.id): «casa» (se busca siempre), «visita» (de otro ámbito; todavía no se busca) o «no».';

-- La matriz nace con lo de hoy. Planeación: sus cinco fuentes de portal,
-- encendidas salvo que `memory_sources` diga false (así las leía la función).
-- Enseñanza: sus cuatro, solo las que `memory_sources` tiene en true. Nada del
-- otro ámbito y, en Planeación, las colecciones de documentos nuevas en «no».
insert into public.pilo_portals (id, scope, name, written_for, sort, matrix)
select 'planeacion', 'planeacion', 'Pilo de la Universidad', 'la dirección de la universidad y la Oficina de Planeación', 1,
  coalesce((
    select jsonb_object_agg(s.id, case
      when s.scope = 'planeacion' and s.kind = 'portal'
        and (select st.memory_sources -> s.id from public.pilo_ai_settings st where st.id = 1) is distinct from 'false'::jsonb
      then 'casa' else 'no' end)
    from public.pilo_sources s
  ), '{}'::jsonb)
on conflict (id) do nothing;

insert into public.pilo_portals (id, scope, name, written_for, sort, matrix)
select 'ensenanza', 'ensenanza', 'Pilo en Enseñanza', 'profesores y estudiantes', 2,
  coalesce((
    select jsonb_object_agg(s.id, case
      when s.scope = 'ensenanza'
        and (select sp.memory_sources -> s.id from public.pilo_spaces sp where sp.id = 'ensenanza') = 'true'::jsonb
      then 'casa' else 'no' end)
    from public.pilo_sources s
  ), '{}'::jsonb)
on conflict (id) do nothing;

alter table public.pilo_portals enable row level security;

drop policy if exists pilo_portals_admin on public.pilo_portals;
create policy pilo_portals_admin on public.pilo_portals
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_portals from public, anon, authenticated;
grant select on public.pilo_portals to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- El filtro. Una sola función dice qué puede leer un portal para una persona.
--
--   p_session   quien pregunta tiene sesión de la INTRANET (personal).
--   p_member    quien pregunta tiene una cuenta de Pilo (0120). Una cuenta de
--               Pilo nunca cuenta como personal, aunque p_session llegue en
--               true: no ve pasajes «con sesión» ni fuentes que la piden.
--
-- Devuelve una fila por fuente que el portal puede leer:
--   mode  «casa»    la fuente es del ámbito del portal y su celda dice «casa».
--         «visita»  la fuente es de OTRO ámbito, su celda dice «visita» y la
--                   fuente puede salir de su casa. Hoy ninguna búsqueda usa
--                   estas filas: se comportan como «no».
--   vis   las visibilidades de pasaje que esa persona puede recibir: siempre
--         «publico»; «sesion» solo el personal. «oculto» nunca está.
--
-- En orden: 1) visibilidad del pasaje, 2) la matriz del portal, 3) quién
-- pregunta (staff_only: Impacto pide sesión de la intranet en cualquier
-- portal), 4) lo que no sale de casa (stays_home: Moodle). Una celda «casa»
-- sobre una fuente de otro ámbito no vale: no devuelve nada.
-- Un portal que no existe no lee nada.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_scope(
  p_portal text,
  p_session boolean default false,
  p_member boolean default false
)
returns table (source text, space text, mode text, vis text[], name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff boolean := coalesce(p_session, false) and not coalesce(p_member, false);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración consultan qué lee cada portal.' using errcode = '42501';
  end if;
  return query
    select s.id, s.scope, c.cell,
           case when v_staff then array['publico', 'sesion'] else array['publico'] end,
           s.name
    from public.pilo_portals p
    cross join public.pilo_sources s
    cross join lateral (select coalesce(p.matrix ->> s.id, 'no') as cell) c
    where p.id = coalesce(p_portal, 'planeacion')
      and (
        (c.cell = 'casa' and s.scope = p.scope)
        or (c.cell = 'visita' and s.scope <> p.scope and not s.stays_home)
      )
      and (not s.staff_only or v_staff)
    order by s.sort, s.id;
end;
$$;

comment on function public.pilo_scope(text, boolean, boolean) is
  'Mr. Pilo: qué fuentes puede leer un portal para una persona y con qué visibilidad. Es el único filtro de la memoria: todas las búsquedas lo usan. Solo la función del servidor y la administración.';

revoke all on function public.pilo_scope(text, boolean, boolean) from public, anon;
grant execute on function public.pilo_scope(text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Cambiar un portal. «cambios»: { "matrix": { fuente: valor, … },
-- "written_for": "…", "name": "…" }. Cada celda se revisa:
--   · «casa» solo en fuentes del ámbito del propio portal;
--   · «visita» todavía no se puede marcar (llega con la lectura de visita);
--   · «no» siempre.
-- Devuelve la fila y, por cada celda que cambió, su efecto: cuántos pasajes
-- tiene esa fuente y cuántas respuestas guardadas de ese portal la citan.
-- -----------------------------------------------------------------------------

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
  v_matrix jsonb;
  v_src public.pilo_sources;
  v_key text;
  v_value text;
  v_old text;
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
  v_matrix := v_row.matrix;

  for v_key, v_value in select e.key, e.value #>> '{}' from jsonb_each(v_cells) e order by e.key loop
    select * into v_src from public.pilo_sources where id = v_key;
    if not found then
      raise exception 'Fuente desconocida: %', v_key using errcode = '22023';
    end if;
    if v_value is null or v_value not in ('casa', 'visita', 'no') then
      raise exception 'Cada fuente es «casa», «visita» o «no».' using errcode = '22023';
    end if;
    if v_value = 'visita' then
      raise exception 'La lectura «de visita» todavía no está disponible: por ahora cada portal lee solo lo de su casa.' using errcode = '22023';
    end if;
    if v_value = 'casa' and v_src.scope <> v_row.scope then
      raise exception '«De casa» es solo para las fuentes del propio portal: «%» es de otro ámbito.', v_src.name using errcode = '22023';
    end if;
    v_old := coalesce(v_matrix ->> v_key, 'no');
    if v_old <> v_value then
      v_effects := v_effects || jsonb_build_object(
        'source', v_key, 'name', v_src.name, 'from', v_old, 'to', v_value,
        'passages', (select count(*) from public.pilo_memory m where m.source = v_key and m.vis <> 'oculto'),
        'answers', (select count(*) from public.pilo_answers a
                    where a.space = v_row.id and not a.hidden
                      and exists (select 1 from unnest(a.refs) r join public.pilo_memory m on m.ref = r where m.source = v_key))
      );
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
-- El espejo. `memory_sources` (pilo_ai_settings para Planeación, pilo_spaces
-- para los demás) repite las celdas de casa de la matriz como interruptores.
-- La verdad es la matriz: es lo que leen las búsquedas. El espejo existe para
-- la función pilo-ia y la intranet desplegadas antes de esta migración, y para
-- la configuración pública de cada espacio.
--   matriz → espejo   al cambiar la matriz.
--   espejo → matriz   al cambiar `memory_sources` (los interruptores de siempre):
--                     solo las llaves que vienen y son true/false; lo demás no
--                     se toca. Nunca escribe «visita» ni toca otro ámbito.
-- Los dos comparan antes de escribir: no se llaman en círculo.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_portals_mirror()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_flags jsonb;
begin
  select coalesce(jsonb_object_agg(s.id, coalesce(new.matrix ->> s.id, 'no') = 'casa'), '{}'::jsonb) into v_flags
  from public.pilo_sources s
  where s.scope = new.scope;
  if new.id = 'planeacion' then
    update public.pilo_ai_settings st set memory_sources = st.memory_sources || v_flags
    where st.id = 1 and (st.memory_sources || v_flags) is distinct from st.memory_sources;
  else
    update public.pilo_spaces sp set memory_sources = sp.memory_sources || v_flags
    where sp.id = new.id and (sp.memory_sources || v_flags) is distinct from sp.memory_sources;
  end if;
  return null;
end;
$$;

create or replace function public.pilo_settings_sources_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb;
begin
  if new.id <> 1 or new.memory_sources is not distinct from old.memory_sources then
    return null;
  end if;
  select coalesce(jsonb_object_agg(s.id, case when new.memory_sources -> s.id = 'true'::jsonb then 'casa' else 'no' end), '{}'::jsonb) into v_patch
  from public.pilo_sources s
  join public.pilo_portals p on p.id = 'planeacion' and p.scope = s.scope
  where jsonb_typeof(new.memory_sources -> s.id) = 'boolean';
  update public.pilo_portals p set matrix = p.matrix || v_patch, updated_at = now()
  where p.id = 'planeacion' and (p.matrix || v_patch) is distinct from p.matrix;
  return null;
end;
$$;

create or replace function public.pilo_spaces_sources_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_patch jsonb;
begin
  if new.memory_sources is not distinct from old.memory_sources then
    return null;
  end if;
  select coalesce(jsonb_object_agg(s.id, case when new.memory_sources -> s.id = 'true'::jsonb then 'casa' else 'no' end), '{}'::jsonb) into v_patch
  from public.pilo_sources s
  join public.pilo_portals p on p.id = new.id and p.scope = s.scope
  where jsonb_typeof(new.memory_sources -> s.id) = 'boolean';
  update public.pilo_portals p set matrix = p.matrix || v_patch, updated_at = now()
  where p.id = new.id and (p.matrix || v_patch) is distinct from p.matrix;
  return null;
end;
$$;

revoke all on function public.pilo_portals_mirror() from public, anon, authenticated;
revoke all on function public.pilo_settings_sources_sync() from public, anon, authenticated;
revoke all on function public.pilo_spaces_sources_sync() from public, anon, authenticated;

-- Después de sembrar: la migración no toca ninguna fila de pilo_ai_settings ni de pilo_spaces.
drop trigger if exists pilo_portals_mirror on public.pilo_portals;
create trigger pilo_portals_mirror
  after insert or update of matrix on public.pilo_portals
  for each row execute function public.pilo_portals_mirror();

drop trigger if exists pilo_settings_sources_sync on public.pilo_ai_settings;
create trigger pilo_settings_sources_sync
  after update of memory_sources on public.pilo_ai_settings
  for each row execute function public.pilo_settings_sources_sync();

drop trigger if exists pilo_spaces_sources_sync on public.pilo_spaces;
create trigger pilo_spaces_sources_sync
  after update of memory_sources on public.pilo_spaces
  for each row execute function public.pilo_spaces_sources_sync();

-- -----------------------------------------------------------------------------
-- Fuera los CHECK fuente ↔ espacio. `space` es la procedencia del pasaje; que
-- sea la de su fuente lo garantiza la llave a pilo_sources. La malla
-- (pilo_nodes, pilo_edges) queda sin atadura: admite «mapa» en cualquier ámbito.
-- -----------------------------------------------------------------------------

alter table public.pilo_memory drop constraint if exists pilo_memory_source;
alter table public.pilo_nodes drop constraint if exists pilo_nodes_source;
alter table public.pilo_edges drop constraint if exists pilo_edges_source;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pilo_memory_source_fk' and conrelid = 'public.pilo_memory'::regclass
  ) then
    alter table public.pilo_memory
      add constraint pilo_memory_source_fk foreign key (source, space) references public.pilo_sources (id, scope);
  end if;
end $$;

comment on column public.pilo_memory.space is
  'La procedencia del pasaje: el ámbito de su fuente («planeacion» o «ensenanza»). Quién lo lee lo decide pilo_scope, no esta columna.';

-- -----------------------------------------------------------------------------
-- pilo_docs acepta cualquier ámbito que tenga colecciones de documentos. Ya no
-- cuelga de pilo_spaces (Planeación no tiene fila ahí) ni de una lista fija de
-- colecciones: su colección tiene que ser una fuente de documentos (o Moodle)
-- de su mismo ámbito.
-- -----------------------------------------------------------------------------

do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname from pg_constraint c
    where c.conrelid = 'public.pilo_docs'::regclass and c.contype = 'f' and c.confrelid = 'public.pilo_spaces'::regclass
  loop
    execute format('alter table public.pilo_docs drop constraint %I', v_name);
  end loop;
end $$;

alter table public.pilo_docs drop constraint if exists pilo_docs_source;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pilo_docs_source_fk' and conrelid = 'public.pilo_docs'::regclass
  ) then
    alter table public.pilo_docs
      add constraint pilo_docs_source_fk foreign key (source, space) references public.pilo_sources (id, scope);
  end if;
end $$;

-- La colección de un documento es de documentos (o Moodle): nunca una fuente
-- que llenan los portales, porque «Actualizar la memoria» la rehace entera.
create or replace function public.pilo_docs_source_kind()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.pilo_sources s
    where s.id = new.source and s.scope = new.space and s.kind in ('documentos', 'moodle')
  ) then
    raise exception 'Esa colección no recibe documentos en este Pilo.' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.pilo_docs_source_kind() from public, anon, authenticated;

drop trigger if exists pilo_docs_source_kind on public.pilo_docs;
create trigger pilo_docs_source_kind
  before insert or update of source, space on public.pilo_docs
  for each row execute function public.pilo_docs_source_kind();

comment on table public.pilo_docs is
  'Mr. Pilo: los documentos (y cursos de Moodle) de la memoria de un ámbito. Sus pasajes están en pilo_memory (doc_id). La administración la lee; se escribe por pilo_doc_save, pilo_doc_replace, pilo_doc_update y pilo_doc_delete.';

-- -----------------------------------------------------------------------------
-- Buscar en la memoria (0094, 0113) con la vista del portal.
-- `p_space` es el portal que pregunta; `p_public_only`, que quien pregunta no
-- es personal con sesión. Quien llame como antes recibe lo de antes.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_memory_search(text, text[], integer, text, boolean);

create or replace function public.pilo_memory_search(
  p_q text,
  p_sources text[] default null,
  p_limit integer default 6,
  p_space text default 'planeacion',
  p_public_only boolean default false,
  p_member boolean default false
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, rank real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_q))::text, ' & ', ' | ');
  v_portal text := coalesce(p_space, 'planeacion');
  v_session boolean := not coalesce(p_public_only, false);
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
           ts_rank_cd(m.fts, words::tsquery, 32)::real as rank
    from public.pilo_memory m
    join public.pilo_scope(v_portal, v_session, v_member) sc on sc.source = m.source and sc.space = m.space
    where m.fts @@ words::tsquery
      and sc.mode = 'casa'
      and m.vis <> 'oculto'
      and m.vis = any (sc.vis)
      and (p_sources is null or m.source = any (p_sources))
    order by rank desc, m.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 6), 20));
end;
$$;

revoke all on function public.pilo_memory_search(text, text[], integer, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_memory_search(text, text[], integer, text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Buscar por significado (0108, 0113) con la vista del portal.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_memory_semantic(text, text, text[], integer, real, text, boolean);

create or replace function public.pilo_memory_semantic(
  p_embedding text,
  p_model text,
  p_sources text[] default null,
  p_limit integer default 8,
  p_min real default 0.3,
  p_space text default 'planeacion',
  p_public_only boolean default false,
  p_member boolean default false
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, sim real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_portal text := coalesce(p_space, 'planeacion');
  v_session boolean := not coalesce(p_public_only, false);
  v_member boolean := coalesce(p_member, false);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración buscan en la memoria.' using errcode = '42501';
  end if;
  return query
    select * from (
      select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.updated_at,
             (1 - (m.embedding <=> q.v))::real as sim
      from public.pilo_memory m
      join public.pilo_scope(v_portal, v_session, v_member) sc on sc.source = m.source and sc.space = m.space,
           (select p_embedding::extensions.vector as v) q
      where m.embedding is not null and m.embed_model = p_model
        and sc.mode = 'casa'
        and m.vis <> 'oculto'
        and m.vis = any (sc.vis)
        and (p_sources is null or m.source = any (p_sources))
      order by m.embedding <=> q.v
      limit greatest(1, least(coalesce(p_limit, 8), 20))
    ) near
    where near.sim >= coalesce(p_min, 0.3);
end;
$$;

revoke all on function public.pilo_memory_semantic(text, text, text[], integer, real, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_memory_semantic(text, text, text[], integer, real, text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- De unos pasajes, los que ese portal y esa persona pueden leer. La función
-- pilo-ia la usa para los pasajes de una respuesta guardada y para saber si lo
-- citado es público, en vez de filtrar ella la tabla. Mira a lo sumo 40.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_memory_readable(
  p_refs text[],
  p_space text default 'planeacion',
  p_public_only boolean default false,
  p_member boolean default false
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, vis text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_refs text[] := (coalesce(p_refs, '{}'::text[]))[1:40];
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen la memoria.' using errcode = '42501';
  end if;
  if cardinality(v_refs) = 0 then
    return;
  end if;
  return query
    select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.vis
    from public.pilo_memory m
    join public.pilo_scope(coalesce(p_space, 'planeacion'), not coalesce(p_public_only, false), coalesce(p_member, false)) sc
      on sc.source = m.source and sc.space = m.space
    where m.ref = any (v_refs)
      and sc.mode = 'casa'
      and m.vis <> 'oculto'
      and m.vis = any (sc.vis);
end;
$$;

revoke all on function public.pilo_memory_readable(text[], text, boolean, boolean) from public, anon;
grant execute on function public.pilo_memory_readable(text[], text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Respuestas guardadas (0094, 0113): las del mismo portal y el mismo rol. Deja
-- de estar fresca si un pasaje citado cambió, ya no existe, está oculto o ESE
-- portal y ESA persona ya no pueden leerlo (la celda pasó a «no», el pasaje es
-- «con sesión» y quien pregunta no es personal, la fuente pide sesión…).
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_answer_candidates(text, text, text, boolean);

create or replace function public.pilo_answer_candidates(
  p_qnorm text,
  p_space text default 'planeacion',
  p_rol text default '',
  p_public_only boolean default false,
  p_member boolean default false
)
returns table (id bigint, question text, qnorm text, kind text, answer text, refs text[], created_at timestamptz, fresh boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_qnorm))::text, ' & ', ' | ');
  v_portal text := coalesce(p_space, 'planeacion');
  v_rol text := case when p_rol in ('estudiante', 'profesor') then p_rol else '' end;
  v_session boolean := not coalesce(p_public_only, false);
  v_member boolean := coalesce(p_member, false);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo consulta las respuestas guardadas.' using errcode = '42501';
  end if;
  if coalesce(words, '') = '' then
    return;
  end if;
  return query
    select a.id, a.question, a.qnorm, a.kind, a.answer, a.refs, a.created_at,
      cardinality(a.refs) > 0
      and not exists (
        select 1 from unnest(a.refs) r
        left join public.pilo_memory m on m.ref = r
        where m.ref is null or m.updated_at > a.created_at
           or m.vis = 'oculto'
           or not exists (
             select 1 from public.pilo_scope(v_portal, v_session, v_member) sc
             where sc.source = m.source and sc.space = m.space and sc.mode = 'casa' and m.vis = any (sc.vis)
           )
      ) as fresh
    from public.pilo_answers a
    where a.space = v_portal and a.rol = v_rol
      and not a.hidden and a.down < greatest(2, a.up) and a.fts @@ words::tsquery
    order by ts_rank_cd(a.fts, words::tsquery, 32) desc, a.created_at desc
    limit 12;
end;
$$;

revoke all on function public.pilo_answer_candidates(text, text, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_answer_candidates(text, text, text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- La malla alrededor de unos pasajes (0097, 0113). Se recorre dentro del
-- ámbito de casa del portal. Para la función del servidor, solo los nodos de
-- las fuentes que ese portal lee «de casa» para esa persona (y los del mapa de
-- documentos, si se piden). La administración ve la malla entera de su ámbito.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_graph_around(text[], text[], integer, integer, integer, text);

create or replace function public.pilo_graph_around(
  p_ids text[],
  p_sources text[] default null,
  p_up integer default 6,
  p_down integer default 1,
  p_limit integer default 80,
  p_space text default 'planeacion',
  p_public_only boolean default false,
  p_member boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_portal text := coalesce(p_space, 'planeacion');
  v_scope text;
  v_admin boolean := public.has_role_at_least('admin');
  v_session boolean := not coalesce(p_public_only, false);
  v_member boolean := coalesce(p_member, false);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen la malla.' using errcode = '42501';
  end if;
  select p.scope into v_scope from public.pilo_portals p where p.id = v_portal;
  v_scope := coalesce(v_scope, v_portal);
  with recursive up as (
    select n.id, 0 as d from public.pilo_nodes n where n.id = any (p_ids) and n.space = v_scope
    union
    select e.from_id, up.d + 1 from public.pilo_edges e join up on e.to_id = up.id
    where e.rel = 'contiene' and e.space = v_scope and up.d < greatest(0, least(coalesce(p_up, 6), 10))
  ),
  down as (
    select n.id, 0 as d from public.pilo_nodes n where n.id = any (p_ids) and n.space = v_scope
    union
    select e.to_id, down.d + 1 from public.pilo_edges e join down on e.from_id = down.id
    where e.rel in ('contiene', 'incluye', 'mide') and e.space = v_scope and down.d < greatest(0, least(coalesce(p_down, 1), 4))
  ),
  picked as (
    select distinct n.id
    from (select id from up union select id from down) ids
    join public.pilo_nodes n on n.id = ids.id
    where n.space = v_scope
      and (p_sources is null or n.source = any (p_sources))
      and (
        v_admin
        or n.source = 'mapa'
        or exists (
          select 1 from public.pilo_scope(v_portal, v_session, v_member) sc
          where sc.source = n.source and sc.space = n.space and sc.mode = 'casa'
        )
      )
    limit greatest(1, least(coalesce(p_limit, 80), 400))
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'source', n.source, 'type', n.type, 'code', n.code, 'label', n.label, 'path', n.path, 'props', n.props))
                       from public.pilo_nodes n where n.space = v_scope and n.id in (select id from picked)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_id, 'to', e.to_id, 'rel', e.rel))
                       from public.pilo_edges e where e.space = v_scope and e.from_id in (select id from picked) and e.to_id in (select id from picked)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.pilo_graph_around(text[], text[], integer, integer, integer, text, boolean, boolean) from public, anon;
grant execute on function public.pilo_graph_around(text[], text[], integer, integer, integer, text, boolean, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Vecinos por el mapa (0115) con la vista del portal. Las relaciones que se
-- recorren son las del ámbito de casa del portal: los vecinos no cruzan de
-- ámbito (los puentes llegan en una entrega posterior). Los pasajes que
-- vuelven pasan por pilo_scope, igual que en la búsqueda. El tema o la
-- referencia que los une es un nodo común: su etiqueta se lee sin mirar de qué
-- ámbito es.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_graph_neighbors(text[], text, text[], boolean, integer);

create or replace function public.pilo_graph_neighbors(
  p_refs text[],
  p_space text,
  p_sources text[] default null,
  p_public_only boolean default false,
  p_limit integer default 3,
  p_member boolean default false
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, via text, shared integer)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_portal text := coalesce(p_space, 'planeacion');
  v_scope text;
  v_session boolean := not coalesce(p_public_only, false);
  v_member boolean := coalesce(p_member, false);
  v_refs text[] := (coalesce(p_refs, '{}'::text[]))[1:20];
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen la malla.' using errcode = '42501';
  end if;
  if cardinality(v_refs) = 0 then
    return;
  end if;
  select p.scope into v_scope from public.pilo_portals p where p.id = v_portal;
  v_scope := coalesce(v_scope, v_portal);
  return query
    with hubs as (
      select distinct e.to_id as hub
      from public.pilo_edges e
      where e.space = v_scope and e.rel in ('trata', 'cita') and e.from_id = any (v_refs)
    ),
    near as (
      select e.from_id as near_ref, count(distinct e.to_id)::integer as near_shared, min(e.to_id) as near_hub
      from public.pilo_edges e
      join hubs h on h.hub = e.to_id
      where e.space = v_scope and e.rel in ('trata', 'cita') and e.from_id <> all (v_refs)
      group by e.from_id
    )
    select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.updated_at,
           coalesce(n.label, '') as via, near.near_shared
    from near
    join public.pilo_memory m on m.ref = near.near_ref
    join public.pilo_scope(v_portal, v_session, v_member) sc on sc.source = m.source and sc.space = m.space
    left join public.pilo_nodes n on n.id = near.near_hub and n.source = 'mapa'
    where m.space = v_scope
      and sc.mode = 'casa'
      and m.vis <> 'oculto'
      and m.vis = any (sc.vis)
      and (p_sources is null or m.source = any (p_sources))
    order by near.near_shared desc, m.updated_at desc, m.ref
    limit greatest(1, least(coalesce(p_limit, 3), 10));
end;
$$;

revoke all on function public.pilo_graph_neighbors(text[], text, text[], boolean, integer, boolean) from public, anon;
grant execute on function public.pilo_graph_neighbors(text[], text, text[], boolean, integer, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Documentos en cualquier ámbito (0114). Las tres funciones son las de 0114
-- con lo que asumía que solo Enseñanza tiene documentos:
--   pilo_map_prune     los temas y referencias son comunes: se borra el que no
--                      tiene NINGUNA relación, en ningún ámbito.
--   pilo_doc_save      el ámbito tiene que ser el de casa de algún portal.
--   pilo_doc_replace   anota «actualizada» donde vive la ficha de ese ámbito.
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
  if not exists (select 1 from public.pilo_portals p where p.scope = v_space) then
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
  -- «Actualizada»: en la ficha de ese ámbito (Planeación la tiene en pilo_ai_settings).
  if v_doc.space = 'planeacion' then
    update public.pilo_ai_settings set memory_indexed_at = now() where id = 1;
  else
    update public.pilo_spaces set memory_indexed_at = now() where id = v_doc.space;
  end if;

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
-- El mapa en cualquier ámbito (0115, 0118). Los temas y las referencias son
-- nodos comunes: el primero que los nombra los crea y los demás los reutilizan.
-- Las relaciones siguen siendo de cada ámbito (pilo_edges.space), así que los
-- vecinos no cruzan.
--   pilo_map_status   cuenta los temas y referencias que ESE ámbito usa.
--   pilo_map_topics   los que ese ámbito ya usa (o creó), para reutilizarlos.
--   pilo_map_save     la de 0118; el ámbito tiene que ser el de casa de algún
--                     portal y la relación va al tema aunque lo haya creado
--                     otro ámbito.
-- -----------------------------------------------------------------------------

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
  where m.space = p_space and m.doc_id is not null and m.vis <> 'oculto'
    and (p_doc is null or m.doc_id = p_doc);
  return v;
end;
$$;

revoke all on function public.pilo_map_status(text, uuid) from public, anon;
grant execute on function public.pilo_map_status(text, uuid) to authenticated, service_role;

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
    where n.source = 'mapa' and (starts_with(n.id, 'tema:') or starts_with(n.id, 'ref:'))
      and (n.space = p_space or exists (select 1 from public.pilo_edges e where e.space = p_space and e.to_id = n.id))
    order by uses desc, n.label, n.id
    limit greatest(1, least(coalesce(p_limit, 80), 300));
end;
$$;

revoke all on function public.pilo_map_topics(text, integer) from public, anon;
grant execute on function public.pilo_map_topics(text, integer) to authenticated, service_role;

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

  -- Solo pasajes de documentos de este ámbito.
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
