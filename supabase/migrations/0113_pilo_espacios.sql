-- =============================================================================
-- 0113 · Mr. Pilo: espacios (el segundo Pilo, «Enseñanza»).
--
-- Hasta aquí había un solo Pilo: el de Planeación. Ahora hay espacios, y cada
-- uno tiene su memoria, su catálogo, sus respuestas guardadas, su bandeja, su
-- malla y su bitácora. Nunca se mezclan:
--
--   space   en pilo_memory, pilo_answers, pilo_catalog, pilo_inbox, pilo_nodes,
--           pilo_edges y pilo_ai_log. Valor de partida «planeacion»: todo lo
--           que existe hoy queda en el Pilo actual sin tocar una fila.
--   vis     en pilo_memory: «publico», «sesion» (solo con sesión) u «oculto».
--   rol     en pilo_answers, pilo_catalog, pilo_inbox y pilo_ai_log: para quién
--           («estudiante», «profesor» o vacío = cualquiera).
--
--   Un CHECK ata la fuente al espacio en pilo_memory, pilo_nodes y pilo_edges:
--   las cinco fuentes de hoy son de «planeacion»; «innovacion», «politicas»,
--   «global» y «moodle» son de «ensenanza» (la malla admite además «mapa»).
--
--   pilo_spaces               la ficha de cada espacio nuevo: apertura, persona,
--                             roles, fuentes, cupos y chat emergente. Solo la
--                             administración la lee y la cambia. La conexión,
--                             los modelos, las claves y la voz siguen saliendo
--                             de pilo_ai_settings / pilo_ai_secret.
--   pilo_space_usage(space)   el uso de hoy de un espacio, repartido por rol.
--   pilo_ai_public_config()   suma «spaces» (sin enfoque, tono, estilo de voz
--                             ni cupos).
--   pilo_ai_key_status()      «today» y «today_voice» cuentan solo «planeacion».
--
-- Las funciones que ganan p_space / p_rol / p_public_only se BORRAN con su
-- firma vieja y se crean con la nueva (un «create or replace» con más
-- parámetros dejaría dos sobrecargas y PostgREST no sabría cuál llamar). Todos
-- los parámetros nuevos tienen valor de partida: quien llame como hoy recibe lo
-- de hoy y solo ve filas de «planeacion».
--
--   pilo_memory_search, pilo_memory_semantic, pilo_answer_candidates,
--   pilo_catalog_active, pilo_catalog_import, pilo_catalog_semantic,
--   pilo_catalog_near, pilo_graph_around, pilo_graph_overview,
--   pilo_embed_status, pilo_embed_pending, pilo_inbox_add
--
-- Sin cambio: pilo_memory_replace, pilo_graph_replace (solo aceptan las cinco
-- fuentes de «planeacion»), pilo_embed_save, pilo_catalog_hit, pilo_facts_*,
-- pilo_visitor_hit. Las cifras en vivo (pilo_facts) son solo de «planeacion».
--
-- Requiere 0089–0112. Idempotente. Sin pgvector (PGlite) las funciones de
-- vectores existen y fallan solo al llamarlas, igual que en 0108, 0109 y 0112.
-- Conviene aplicarla de una sola vez (una transacción): así no hay un instante
-- en que una función no exista.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Las columnas. Con valor de partida constante no se reescribe ninguna tabla.
-- -----------------------------------------------------------------------------

alter table public.pilo_memory add column if not exists space text not null default 'planeacion';
alter table public.pilo_memory add column if not exists vis text not null default 'publico';

alter table public.pilo_answers add column if not exists space text not null default 'planeacion';
alter table public.pilo_answers add column if not exists rol text not null default '';

alter table public.pilo_catalog add column if not exists space text not null default 'planeacion';
alter table public.pilo_catalog add column if not exists rol text not null default '';

alter table public.pilo_inbox add column if not exists space text not null default 'planeacion';
alter table public.pilo_inbox add column if not exists rol text not null default '';

alter table public.pilo_nodes add column if not exists space text not null default 'planeacion';
alter table public.pilo_edges add column if not exists space text not null default 'planeacion';

alter table public.pilo_ai_log add column if not exists space text not null default 'planeacion';
alter table public.pilo_ai_log add column if not exists rol text not null default '';

comment on column public.pilo_memory.space is 'A qué Pilo pertenece el pasaje: «planeacion» (el de siempre) o «ensenanza».';
comment on column public.pilo_memory.vis is 'Quién puede recibir el pasaje: «publico», «sesion» (solo con sesión) u «oculto» (nadie).';
comment on column public.pilo_answers.rol is 'Para quién se redactó la respuesta guardada: «estudiante», «profesor» o vacío.';
comment on column public.pilo_catalog.rol is 'Para quién es la entrada: «estudiante», «profesor» o vacío (cualquiera).';

-- -----------------------------------------------------------------------------
-- Las restricciones. Todas las filas de hoy las cumplen: son de «planeacion»,
-- públicas, sin rol y con una de las cinco fuentes de siempre.
-- -----------------------------------------------------------------------------

alter table public.pilo_memory drop constraint if exists pilo_memory_space;
alter table public.pilo_memory add constraint pilo_memory_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_memory drop constraint if exists pilo_memory_vis;
alter table public.pilo_memory add constraint pilo_memory_vis check (vis in ('publico', 'sesion', 'oculto'));

alter table public.pilo_answers drop constraint if exists pilo_answers_space;
alter table public.pilo_answers add constraint pilo_answers_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_answers drop constraint if exists pilo_answers_rol;
alter table public.pilo_answers add constraint pilo_answers_rol check (rol in ('', 'estudiante', 'profesor'));

alter table public.pilo_catalog drop constraint if exists pilo_catalog_space;
alter table public.pilo_catalog add constraint pilo_catalog_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_catalog drop constraint if exists pilo_catalog_rol;
alter table public.pilo_catalog add constraint pilo_catalog_rol check (rol in ('', 'estudiante', 'profesor'));

alter table public.pilo_inbox drop constraint if exists pilo_inbox_space;
alter table public.pilo_inbox add constraint pilo_inbox_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_inbox drop constraint if exists pilo_inbox_rol;
alter table public.pilo_inbox add constraint pilo_inbox_rol check (rol in ('', 'estudiante', 'profesor'));

alter table public.pilo_nodes drop constraint if exists pilo_nodes_space;
alter table public.pilo_nodes add constraint pilo_nodes_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_edges drop constraint if exists pilo_edges_space;
alter table public.pilo_edges add constraint pilo_edges_space check (space in ('planeacion', 'ensenanza'));

alter table public.pilo_ai_log drop constraint if exists pilo_ai_log_space;
alter table public.pilo_ai_log add constraint pilo_ai_log_space check (space in ('planeacion', 'ensenanza'));
alter table public.pilo_ai_log drop constraint if exists pilo_ai_log_rol;
alter table public.pilo_ai_log add constraint pilo_ai_log_rol check (rol in ('', 'estudiante', 'profesor'));

-- La fuente va atada al espacio: un pasaje de «politicas» no puede quedar en
-- «planeacion», ni uno de «cifras» en «ensenanza».
alter table public.pilo_memory drop constraint if exists pilo_memory_source;
alter table public.pilo_memory add constraint pilo_memory_source check (
  (space = 'planeacion' and source in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto'))
  or (space = 'ensenanza' and source in ('innovacion', 'politicas', 'global', 'moodle'))
);

alter table public.pilo_nodes drop constraint if exists pilo_nodes_source;
alter table public.pilo_nodes add constraint pilo_nodes_source check (
  (space = 'planeacion' and source in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto'))
  or (space = 'ensenanza' and source in ('innovacion', 'politicas', 'global', 'moodle', 'mapa'))
);

alter table public.pilo_edges drop constraint if exists pilo_edges_source;
alter table public.pilo_edges add constraint pilo_edges_source check (
  (space = 'planeacion' and source in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto'))
  or (space = 'ensenanza' and source in ('innovacion', 'politicas', 'global', 'moodle', 'mapa'))
);

-- -----------------------------------------------------------------------------
-- Los índices.
-- -----------------------------------------------------------------------------

create index if not exists pilo_memory_space_idx on public.pilo_memory (space, source);
create index if not exists pilo_answers_space_idx on public.pilo_answers (space, created_at desc);
create index if not exists pilo_catalog_space_idx on public.pilo_catalog (space, kind, active);
create index if not exists pilo_ai_log_space_idx on public.pilo_ai_log (space, created_at desc);

-- La bandeja: la misma pregunta pendiente es única por espacio. El índice de
-- 0109 era más estricto (sin espacio), así que el nuevo no puede fallar con lo
-- que ya hay. pilo_inbox_add (abajo) usa el mismo «on conflict».
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'pilo_inbox_pending_idx'
      and indexdef like '%(space, qnorm, reason)%'
  ) then
    drop index if exists public.pilo_inbox_pending_idx;
    create unique index pilo_inbox_pending_idx on public.pilo_inbox (space, qnorm, reason) where status = 'pendiente';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- pilo_spaces: la ficha de cada espacio nuevo. «planeacion» no tiene fila: lo
-- suyo sigue en pilo_ai_settings.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_spaces (
  id                      text primary key,
  name                    text not null default '',
  "on"                    boolean not null default false,
  aud                     text not null default 'admin',
  ai                      boolean not null default true,
  welcome                 boolean not null default true,
  intro                   text not null default 'la Inteligencia Artificial de la Universidad de Santander',
  focus                   text not null default '',
  greeting                text not null default '',
  ask_rol                 boolean not null default true,
  roles                   jsonb not null default '{
    "estudiante": {"tone": "", "suggestions": [], "voice_style": "", "expression": "feliz", "mood": "emocionado"},
    "profesor": {"tone": "", "suggestions": [], "voice_style": "", "expression": "graduado", "mood": "atento"}
  }'::jsonb,
  memory_sources          jsonb not null default '{"innovacion": true, "politicas": true, "global": true, "moodle": true}'::jsonb,
  memory_indexed_at       timestamptz,
  daily_limit             integer not null default 200,
  visitor_limit           integer not null default 20,
  visitor_window_seconds  integer not null default 600,
  widget_on               boolean not null default false,
  widget_origins          text[] not null default '{}',
  updated_by              uuid references public.profiles (id) on delete set null,
  updated_at              timestamptz not null default now(),
  constraint pilo_spaces_id check (id ~ '^[a-z]{3,20}$' and id <> 'planeacion'),
  constraint pilo_spaces_aud check (aud in ('admin', 'sesion', 'publico')),
  constraint pilo_spaces_len check (length(name) <= 120 and length(intro) <= 300 and length(focus) <= 600 and length(greeting) <= 300),
  constraint pilo_spaces_json check (jsonb_typeof(roles) = 'object' and jsonb_typeof(memory_sources) = 'object'),
  constraint pilo_spaces_limits check (
    daily_limit between 0 and 100000
    and visitor_limit between 0 and 1000
    and visitor_window_seconds between 30 and 86400
  ),
  constraint pilo_spaces_widget check (coalesce(cardinality(widget_origins), 0) <= 50)
);

comment on table public.pilo_spaces is
  'Mr. Pilo: la ficha de cada espacio distinto de «planeacion» (apertura, persona, roles, fuentes, cupos, chat emergente). Solo la administración la lee y la cambia.';

alter table public.pilo_spaces enable row level security;

drop policy if exists pilo_spaces_admin on public.pilo_spaces;
create policy pilo_spaces_admin on public.pilo_spaces
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

revoke all on public.pilo_spaces from anon;
grant select, update on public.pilo_spaces to authenticated;

-- Nace apagado y solo para la administración.
insert into public.pilo_spaces (id, name) values ('ensenanza', 'Mr. Pilo en Enseñanza')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Buscar en la memoria (0094) dentro de un espacio.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_memory_search(text, text[], integer);

create or replace function public.pilo_memory_search(
  p_q text,
  p_sources text[] default null,
  p_limit integer default 6,
  p_space text default 'planeacion',
  p_public_only boolean default false
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, rank real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_q))::text, ' & ', ' | ');
  v_space text := coalesce(p_space, 'planeacion');
  v_public boolean := coalesce(p_public_only, false);
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
    where m.fts @@ words::tsquery
      and m.space = v_space
      and m.vis <> 'oculto'
      and (not v_public or m.vis = 'publico')
      and (p_sources is null or m.source = any (p_sources))
    order by rank desc, m.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 6), 20));
end;
$$;

revoke all on function public.pilo_memory_search(text, text[], integer, text, boolean) from public, anon;
grant execute on function public.pilo_memory_search(text, text[], integer, text, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Buscar por significado (0108) dentro de un espacio.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_memory_semantic(text, text, text[], integer, real);

create or replace function public.pilo_memory_semantic(
  p_embedding text,
  p_model text,
  p_sources text[] default null,
  p_limit integer default 8,
  p_min real default 0.3,
  p_space text default 'planeacion',
  p_public_only boolean default false
)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, sim real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
  v_public boolean := coalesce(p_public_only, false);
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración buscan en la memoria.' using errcode = '42501';
  end if;
  return query
    select * from (
      select m.ref, m.source, m.title, m.section, m.body, m.path, m.cut, m.office, m.updated_at,
             (1 - (m.embedding <=> q.v))::real as sim
      from public.pilo_memory m, (select p_embedding::extensions.vector as v) q
      where m.embedding is not null and m.embed_model = p_model
        and m.space = v_space
        and m.vis <> 'oculto'
        and (not v_public or m.vis = 'publico')
        and (p_sources is null or m.source = any (p_sources))
      order by m.embedding <=> q.v
      limit greatest(1, least(coalesce(p_limit, 8), 20))
    ) near
    where near.sim >= coalesce(p_min, 0.3);
end;
$$;

revoke all on function public.pilo_memory_semantic(text, text, text[], integer, real, text, boolean) from public, anon;
grant execute on function public.pilo_memory_semantic(text, text, text[], integer, real, text, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Respuestas guardadas (0094): las del mismo espacio y el mismo rol. Deja de
-- estar fresca si un pasaje citado cambió, ya no existe, es de otro espacio,
-- está oculto o —cuando quien pregunta no tiene sesión— no es público.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_answer_candidates(text);

create or replace function public.pilo_answer_candidates(
  p_qnorm text,
  p_space text default 'planeacion',
  p_rol text default '',
  p_public_only boolean default false
)
returns table (id bigint, question text, qnorm text, kind text, answer text, refs text[], created_at timestamptz, fresh boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_qnorm))::text, ' & ', ' | ');
  v_space text := coalesce(p_space, 'planeacion');
  v_rol text := case when p_rol in ('estudiante', 'profesor') then p_rol else '' end;
  v_public boolean := coalesce(p_public_only, false);
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
           or m.space <> v_space or m.vis = 'oculto'
           or (v_public and m.vis <> 'publico')
      ) as fresh
    from public.pilo_answers a
    where a.space = v_space and a.rol = v_rol
      and not a.hidden and a.down < greatest(2, a.up) and a.fts @@ words::tsquery
    order by ts_rank_cd(a.fts, words::tsquery, 32) desc, a.created_at desc
    limit 12;
end;
$$;

revoke all on function public.pilo_answer_candidates(text, text, text, boolean) from public, anon;
grant execute on function public.pilo_answer_candidates(text, text, text, boolean) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- El catálogo (0096). La clave sigue siendo global: Enseñanza usa los prefijos
-- ER- (respuestas) y EC- (capciosas). Importar no pisa una clave que es de otro
-- espacio: la deja como está y la cuenta en «rejected».
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_catalog_import(text, jsonb, boolean);

create or replace function public.pilo_catalog_import(
  p_kind text,
  p_rows jsonb,
  p_replace boolean default false,
  p_space text default 'planeacion'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
  v_added integer := 0;
  v_updated integer := 0;
  v_rejected integer := 0;
  v_rejected_keys text[] := '{}';
  v_removed integer := 0;
  v_total integer := 0;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración importa el catálogo de Pilo.' using errcode = '42501';
  end if;
  if p_kind not in ('respuesta', 'capciosa') then
    raise exception 'Clase desconocida: %', p_kind using errcode = '22023';
  end if;
  if v_space not in ('planeacion', 'ensenanza') then
    raise exception 'Espacio desconocido: %', v_space using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;

  with incoming as (
    select distinct on (upper(btrim(r->>'key')))
      upper(btrim(r->>'key')) as key,
      left(btrim(coalesce(r->>'question', '')), 500) as question,
      coalesce(array(select left(btrim(v), 300) from jsonb_array_elements_text(coalesce(r->'variants', '[]'::jsonb)) v where btrim(v) <> ''), '{}') as variants,
      coalesce(array(select left(btrim(v), 200) from jsonb_array_elements_text(coalesce(r->'triggers', '[]'::jsonb)) v where btrim(v) <> ''), '{}') as triggers,
      left(btrim(coalesce(r->>'answer', '')), 2000) as answer,
      coalesce(nullif(r->>'mood', ''), case when p_kind = 'capciosa' then 'atrevido' else 'emocionado' end) as mood,
      left(btrim(coalesce(r->>'source_title', '')), 300) as source_title,
      left(btrim(coalesce(r->>'source_path', '')), 300) as source_path,
      left(btrim(coalesce(r->>'cut', '')), 60) as cut,
      left(btrim(coalesce(r->>'office', '')), 200) as office,
      coalesce((r->>'active')::boolean, true) as active,
      case when r->>'rol' in ('estudiante', 'profesor') then r->>'rol' else '' end as rol
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where btrim(coalesce(r->>'key', '')) <> ''
  ),
  counted as (
    select
      count(*) filter (where not exists (select 1 from public.pilo_catalog c where c.key = i.key)) as added,
      count(*) filter (where exists (select 1 from public.pilo_catalog c where c.key = i.key and c.space = v_space)) as updated,
      count(*) filter (where exists (select 1 from public.pilo_catalog c where c.key = i.key and c.space <> v_space)) as rejected,
      coalesce(array_agg(i.key order by i.key) filter (where exists (select 1 from public.pilo_catalog c where c.key = i.key and c.space <> v_space)), '{}') as rejected_keys
    from incoming i
  ),
  written as (
    insert into public.pilo_catalog as c (key, kind, question, variants, triggers, answer, mood, source_title, source_path, cut, office, active, updated_at, updated_by, space, rol)
    select i.key, p_kind, i.question, i.variants, i.triggers, i.answer, i.mood, i.source_title, i.source_path, i.cut, i.office, i.active, now(), auth.uid(), v_space, i.rol
    from incoming i
    on conflict (key) do update set
      kind = excluded.kind, question = excluded.question, variants = excluded.variants, triggers = excluded.triggers,
      answer = excluded.answer, mood = excluded.mood, source_title = excluded.source_title, source_path = excluded.source_path,
      cut = excluded.cut, office = excluded.office, active = excluded.active, rol = excluded.rol,
      updated_at = now(), updated_by = auth.uid()
    where c.space = v_space
    returning c.key
  )
  select counted.added, counted.updated, counted.rejected, counted.rejected_keys
  into v_added, v_updated, v_rejected, v_rejected_keys
  from counted, (select count(*) from written) w;

  if p_replace then
    delete from public.pilo_catalog c
    where c.kind = p_kind
      and c.space = v_space
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
        where upper(btrim(r->>'key')) = c.key
      );
    get diagnostics v_removed = row_count;
  end if;

  select count(*) into v_total from public.pilo_catalog c where c.kind = p_kind and c.space = v_space;
  return jsonb_build_object(
    'kind', p_kind, 'space', v_space, 'added', v_added, 'updated', v_updated, 'removed', v_removed, 'total', v_total,
    'rejected', v_rejected, 'rejected_keys', to_jsonb(v_rejected_keys[1:50])
  );
end;
$$;

revoke all on function public.pilo_catalog_import(text, jsonb, boolean, text) from public, anon;
grant execute on function public.pilo_catalog_import(text, jsonb, boolean, text) to authenticated;

-- Lo activo de un espacio, para la función del servidor y la administración.
drop function if exists public.pilo_catalog_active();

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
    where c.active and c.space = coalesce(p_space, 'planeacion')
    order by c.kind, c.key;
end;
$$;

revoke all on function public.pilo_catalog_active(text) from public, anon;
grant execute on function public.pilo_catalog_active(text) to authenticated, service_role;

-- La entrada del catálogo más cercana a la pregunta (0112), dentro del espacio.
drop function if exists public.pilo_catalog_semantic(text, text, real);

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
      where c.active and c.space = coalesce(p_space, 'planeacion') and cv.embedding is not null
        and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
      order by cv.embedding <=> q.v
      limit 1
    ) near
    where near.sim >= coalesce(p_min, 0.8);
end;
$$;

revoke all on function public.pilo_catalog_semantic(text, text, real, text) from public, anon;
grant execute on function public.pilo_catalog_semantic(text, text, real, text) to authenticated, service_role;

-- Las entradas más cercanas, sin umbral (0112): «Probar el catálogo».
drop function if exists public.pilo_catalog_near(text, text, integer);

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
    where c.active and c.space = coalesce(p_space, 'planeacion') and cv.embedding is not null
      and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
    order by cv.embedding <=> q.v
    limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$$;

revoke all on function public.pilo_catalog_near(text, text, integer, text) from public, anon;
grant execute on function public.pilo_catalog_near(text, text, integer, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- La malla (0097) dentro de un espacio: ni los nodos ni las relaciones de otro
-- espacio se recorren ni se devuelven.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_graph_around(text[], text[], integer, integer, integer);

create or replace function public.pilo_graph_around(
  p_ids text[],
  p_sources text[] default null,
  p_up integer default 6,
  p_down integer default 1,
  p_limit integer default 80,
  p_space text default 'planeacion'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_space text := coalesce(p_space, 'planeacion');
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen la malla.' using errcode = '42501';
  end if;
  with recursive up as (
    select n.id, 0 as d from public.pilo_nodes n where n.id = any (p_ids) and n.space = v_space
    union
    select e.from_id, up.d + 1 from public.pilo_edges e join up on e.to_id = up.id
    where e.rel = 'contiene' and e.space = v_space and up.d < greatest(0, least(coalesce(p_up, 6), 10))
  ),
  down as (
    select n.id, 0 as d from public.pilo_nodes n where n.id = any (p_ids) and n.space = v_space
    union
    select e.to_id, down.d + 1 from public.pilo_edges e join down on e.from_id = down.id
    where e.rel in ('contiene', 'incluye', 'mide') and e.space = v_space and down.d < greatest(0, least(coalesce(p_down, 1), 4))
  ),
  picked as (
    select distinct n.id
    from (select id from up union select id from down) ids
    join public.pilo_nodes n on n.id = ids.id
    where n.space = v_space and (p_sources is null or n.source = any (p_sources))
    limit greatest(1, least(coalesce(p_limit, 80), 400))
  )
  select jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'source', n.source, 'type', n.type, 'code', n.code, 'label', n.label, 'path', n.path, 'props', n.props))
                       from public.pilo_nodes n where n.space = v_space and n.id in (select id from picked)), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_id, 'to', e.to_id, 'rel', e.rel))
                       from public.pilo_edges e where e.space = v_space and e.from_id in (select id from picked) and e.to_id in (select id from picked)), '[]'::jsonb)
  ) into result;
  return result;
end;
$$;

revoke all on function public.pilo_graph_around(text[], text[], integer, integer, integer, text) from public, anon;
grant execute on function public.pilo_graph_around(text[], text[], integer, integer, integer, text) to authenticated, service_role;

drop function if exists public.pilo_graph_overview(text[]);

create or replace function public.pilo_graph_overview(p_sources text[] default null, p_space text default 'planeacion')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve la malla completa.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'nodes', coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'source', n.source, 'type', n.type, 'code', n.code, 'label', n.label, 'path', n.path, 'props', n.props) order by n.source, n.type, n.code, n.label)
                       from public.pilo_nodes n where n.space = v_space and (p_sources is null or n.source = any (p_sources))), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', e.from_id, 'to', e.to_id, 'rel', e.rel))
                       from public.pilo_edges e where e.space = v_space and (p_sources is null or e.source = any (p_sources))), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.pilo_graph_overview(text[], text) from public, anon;
grant execute on function public.pilo_graph_overview(text[], text) to authenticated;

-- -----------------------------------------------------------------------------
-- El índice de vectores (0112) por espacio. Las cifras en vivo son solo de
-- «planeacion»: en otro espacio no se cuentan ni se piden.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_embed_status(text);

create or replace function public.pilo_embed_status(p_model text, p_space text default 'planeacion')
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
  v_space text := coalesce(p_space, 'planeacion');
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración ven el índice.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'model', p_model,
    'memory_total', (select count(*) from public.pilo_memory m where m.space = v_space),
    'memory_done', (select count(*) from public.pilo_memory m
                    where m.space = v_space and m.embedding is not null and m.embed_model = p_model and m.embedded_at >= m.updated_at),
    'facts_total', (select count(*) from public.pilo_facts f where v_space = 'planeacion'),
    'facts_done', (select count(*) from public.pilo_facts f
                   where v_space = 'planeacion' and f.embedding is not null and f.embed_model = p_model and f.embedded_at >= f.updated_at),
    'catalog_total', (select count(*) from public.pilo_catalog c where c.active and c.space = v_space),
    'catalog_done', (select count(*) from public.pilo_catalog c join public.pilo_catalog_vectors cv on cv.key = c.key
                     where c.active and c.space = v_space and cv.embedding is not null
                       and cv.embed_model = p_model and cv.embedded_at >= c.updated_at)
  ) into v;
  return v;
end;
$$;

revoke all on function public.pilo_embed_status(text, text) from public, anon;
grant execute on function public.pilo_embed_status(text, text) to authenticated, service_role;

drop function if exists public.pilo_embed_pending(text, integer);

create or replace function public.pilo_embed_pending(p_model text, p_limit integer default 64, p_space text default 'planeacion')
returns table (kind text, ref text, body text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo indexa la memoria.' using errcode = '42501';
  end if;
  return query
    (select 'catalogo'::text, c.key, public.pilo_embed_text_catalog(c)
     from public.pilo_catalog c
     left join public.pilo_catalog_vectors cv on cv.key = c.key
     where c.active and c.space = v_space
       and (cv.key is null or cv.embedding is null or cv.embed_model is distinct from p_model or cv.embedded_at < c.updated_at)
     order by c.key)
    union all
    (select 'memoria'::text, m.ref, public.pilo_embed_text_memory(m)
     from public.pilo_memory m
     where m.space = v_space
       and (m.embedding is null or m.embed_model is distinct from p_model or m.embedded_at < m.updated_at)
     order by m.ref)
    union all
    (select 'cifra'::text, f.ref, public.pilo_embed_text_fact(f)
     from public.pilo_facts f
     where v_space = 'planeacion'
       and (f.embedding is null or f.embed_model is distinct from p_model or f.embedded_at < f.updated_at)
     order by f.ref)
    limit greatest(1, least(coalesce(p_limit, 64), 256));
end;
$$;

revoke all on function public.pilo_embed_pending(text, integer, text) from public, anon;
grant execute on function public.pilo_embed_pending(text, integer, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- La bandeja (0109): cada espacio tiene la suya, y anota para quién era.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_inbox_add(text, text, text, text, text, bigint);

create or replace function public.pilo_inbox_add(
  p_question text,
  p_qnorm text,
  p_reason text,
  p_kind text default '',
  p_answer text default '',
  p_answer_id bigint default null,
  p_space text default 'planeacion',
  p_rol text default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo anota en la bandeja.' using errcode = '42501';
  end if;
  if coalesce(length(trim(p_question)), 0) < 2 or coalesce(p_qnorm, '') = '' then
    return;
  end if;
  insert into public.pilo_inbox as b (question, qnorm, reason, kind, answer, answer_id, space, rol)
  values (
    left(trim(p_question), 600), left(p_qnorm, 600), p_reason, left(coalesce(p_kind, ''), 20), left(coalesce(p_answer, ''), 6000), p_answer_id,
    coalesce(p_space, 'planeacion'), case when p_rol in ('estudiante', 'profesor') then p_rol else '' end
  )
  on conflict (space, qnorm, reason) where status = 'pendiente' do update
    set times = b.times + 1, last_at = now(),
        question = excluded.question, kind = excluded.kind, answer = excluded.answer,
        answer_id = coalesce(excluded.answer_id, b.answer_id), rol = excluded.rol;
end;
$$;

revoke all on function public.pilo_inbox_add(text, text, text, text, text, bigint, text, text) from public, anon;
grant execute on function public.pilo_inbox_add(text, text, text, text, text, bigint, text, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- El uso de hoy (0110): el del Pilo de siempre cuenta solo su espacio.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_ai_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k public.pilo_ai_secret;
  u record;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve el estado de las claves.' using errcode = '42501';
  end if;
  select * into k from public.pilo_ai_secret where id = 1;
  select * into u from public.pilo_ai_keys_in_use();
  return jsonb_build_object(
    'keys', jsonb_build_object(
      'mistral', jsonb_build_object('has', k.mistral_key <> '', 'last4', right(k.mistral_key, 4)),
      'freeai', jsonb_build_object('has', k.freeai_key <> '', 'last4', right(k.freeai_key, 4)),
      'nvidia', jsonb_build_object('has', k.nvidia_key <> '', 'last4', right(k.nvidia_key, 4)),
      'fishaudio', jsonb_build_object('has', k.fishaudio_key <> '', 'last4', right(k.fishaudio_key, 4)),
      'otro', jsonb_build_object('has', k.otro_key <> '', 'last4', right(k.otro_key, 4)),
      'voz', jsonb_build_object('has', k.speech_key <> '', 'last4', right(k.speech_key, 4))
    ),
    'has_key', u.text_key <> '',
    'last4', right(u.text_key, 4),
    'has_speech_key', k.speech_key <> '',
    'speech_last4', right(k.speech_key, 4),
    'updated_at', k.updated_at,
    'today', (select count(*) from public.pilo_ai_log l
              where l.space = 'planeacion' and l.created_at >= date_trunc('day', now()) and not l.cached and l.action <> 'voz'),
    'today_voice', (select count(*) from public.pilo_ai_log l
                    where l.space = 'planeacion' and l.created_at >= date_trunc('day', now()) and not l.cached and l.action = 'voz')
  );
end;
$$;

revoke all on function public.pilo_ai_key_status() from public;
grant execute on function public.pilo_ai_key_status() to authenticated;

-- El uso de hoy de un espacio. En «planeacion» el texto es todo lo que no es
-- voz (como en pilo_ai_key_status); en los demás, solo «preguntar», que es lo
-- único que gasta su cupo. «by_rol» reparte ese mismo conteo.
create or replace function public.pilo_space_usage(p_space text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
  v_limit integer;
  v jsonb;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve el uso de Pilo.' using errcode = '42501';
  end if;
  if v_space = 'planeacion' then
    select s.daily_limit into v_limit from public.pilo_ai_settings s where s.id = 1;
  else
    select sp.daily_limit into v_limit from public.pilo_spaces sp where sp.id = v_space;
    if not found then
      raise exception 'Espacio desconocido: %', v_space using errcode = '22023';
    end if;
  end if;

  with hoy as (
    select l.rol, l.action
    from public.pilo_ai_log l
    where l.space = v_space and l.created_at >= date_trunc('day', now()) and not l.cached
  ),
  texto as (
    select hoy.rol from hoy
    where case when v_space = 'planeacion' then hoy.action <> 'voz' else hoy.action = 'preguntar' end
  )
  select jsonb_build_object(
    'space', v_space,
    'today', (select count(*) from texto),
    'limit', v_limit,
    'by_rol', jsonb_build_object(
      'estudiante', (select count(*) from texto where texto.rol = 'estudiante'),
      'profesor', (select count(*) from texto where texto.rol = 'profesor'),
      '', (select count(*) from texto where texto.rol = '')
    ),
    'today_voice', (select count(*) from hoy where hoy.action = 'voz')
  ) into v;
  return v;
end;
$$;

comment on function public.pilo_space_usage(text) is
  'Mr. Pilo: pedidos de hoy de un espacio (sin lo atendido desde lo guardado), su cupo, el reparto por rol y la voz. Solo la administración.';

revoke all on function public.pilo_space_usage(text) from public, anon;
grant execute on function public.pilo_space_usage(text) to authenticated;

-- -----------------------------------------------------------------------------
-- pilo_ai_public_config: lo de 0111, más «spaces». De cada espacio sale solo lo
-- que la página necesita para pintarse: ni el enfoque, ni el tono, ni el estilo
-- de voz, ni los cupos, ni la presentación que va al modelo.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_ai_public_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', s.enabled and s.base_url <> '' and u.text_key <> '',
    'speech_ready', s.voice_engine = 'proveedor' and u.speech_key <> ''
      and (
        s.speech_provider = 'freeai'
        or (s.speech_provider = 'nvidia' and s.speech_function_id <> '' and jsonb_array_length(s.voice_styles) > 0)
        or (s.speech_provider = 'fishaudio' and exists (select 1 from jsonb_array_elements(s.voice_styles) e where coalesce(e->>'fish_id', '') <> ''))
        or (s.speech_provider = 'otro' and coalesce(nullif(s.speech_base_url, ''), s.base_url) <> '' and s.speech_model <> '')
      ),
    'functions', s.functions,
    'portals', s.portals,
    'voice_engine', s.voice_engine,
    'voice_rate', s.voice_rate,
    'voice_pitch', s.voice_pitch,
    'voice_expressions', s.voice_expressions,
    'voice_modulation', s.voice_modulation,
    'voice_patterns', s.voice_patterns,
    'pregunta', jsonb_build_object(
      'on', coalesce((s.portals->'pregunta'->>'on')::boolean, false),
      'aud', coalesce(s.portals->'pregunta'->>'aud', 'publico'),
      'welcome', s.pregunta_welcome,
      'ai', s.enabled and s.base_url <> '' and u.text_key <> '' and coalesce((s.functions->>'preguntar')::boolean, true)
    ),
    'widget', jsonb_build_object(
      'on', s.widget_on,
      'origins', to_jsonb(s.widget_origins)
    ),
    'spaces', coalesce((
      select jsonb_object_agg(sp.id, jsonb_build_object(
        'on', sp."on",
        'aud', sp.aud,
        'welcome', sp.welcome,
        'ai', sp.ai and s.enabled and s.base_url <> '' and u.text_key <> '' and coalesce((s.functions->>'preguntar')::boolean, true),
        'name', sp.name,
        'greeting', sp.greeting,
        'ask_rol', sp.ask_rol,
        'roles', jsonb_build_object(
          'estudiante', jsonb_build_object(
            'suggestions', case when jsonb_typeof(sp.roles->'estudiante'->'suggestions') = 'array' then sp.roles->'estudiante'->'suggestions' else '[]'::jsonb end,
            'expression', coalesce(sp.roles->'estudiante'->>'expression', 'feliz'),
            'mood', coalesce(sp.roles->'estudiante'->>'mood', 'emocionado')
          ),
          'profesor', jsonb_build_object(
            'suggestions', case when jsonb_typeof(sp.roles->'profesor'->'suggestions') = 'array' then sp.roles->'profesor'->'suggestions' else '[]'::jsonb end,
            'expression', coalesce(sp.roles->'profesor'->>'expression', 'graduado'),
            'mood', coalesce(sp.roles->'profesor'->>'mood', 'atento')
          )
        ),
        'sources', sp.memory_sources,
        'widget', jsonb_build_object('on', sp.widget_on, 'origins', to_jsonb(sp.widget_origins))
      ))
      from public.pilo_spaces sp
    ), '{}'::jsonb)
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;

revoke all on function public.pilo_ai_public_config() from public;
grant execute on function public.pilo_ai_public_config() to anon, authenticated;

notify pgrst, 'reload schema';
