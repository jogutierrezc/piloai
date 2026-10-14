-- =============================================================================
-- 0094 · Pregúntele a Pilo: la memoria, las respuestas guardadas y la página.
--
-- Una página pública (/pregunta) donde cualquiera le pregunta a Mr. Pilo por
-- la Planeación Institucional. Para gastar lo menos posible de IA, cada
-- pregunta pasa por capas y se queda en la primera que responde:
--
--   reglas (en la función)  saludos, dinero, datos de personas, años futuros
--   pilo_answers            preguntas ya respondidas, mientras sus pasajes
--                           sigan iguales
--   pilo_memory             lo que muestran los portales públicos, en pasajes
--                           con su procedencia; búsqueda de texto en español
--   IA                      solo si hace falta, con los mejores pasajes
--
-- Nada de esto lo lee el público directamente: pregunta a la función del
-- servidor `pilo-ia`, que usa el rol de servicio. La administración ve y
-- cura la memoria y las respuestas desde la intranet.
--
--   pilo_fold(text)                    minúsculas y sin tildes (inmutable)
--   pilo_memory_search(q, fuentes, n)  los pasajes más cercanos a una pregunta
--   pilo_memory_replace(fuente, filas) reemplaza los pasajes de una fuente
--   pilo_answer_candidates(q)          respuestas guardadas parecidas
--   pilo_answer_vote(id, voto)         «me sirvió» / «no me sirvió»
--
-- Requiere 0089–0092. Idempotente.
-- =============================================================================

-- Sin tildes y en minúsculas. translate() y lower() son inmutables, así que
-- sirve en columnas generadas (unaccent no lo es).
create or replace function public.pilo_fold(t text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(lower(coalesce(t, '')), 'áéíóúüàèìòùâêîôûäëïö', 'aeiouuaeiouaeiouaeio')
$$;

-- -----------------------------------------------------------------------------
-- La memoria: un pasaje por cosa que un portal público muestra.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_memory (
  ref         text primary key,
  source      text not null,
  title       text not null,
  section     text not null default '',
  body        text not null,
  path        text not null default '',
  cut         text not null default '',
  office      text not null default '',
  updated_at  timestamptz not null default now(),
  fts         tsvector generated always as (
    setweight(to_tsvector('spanish', public.pilo_fold(title)), 'A')
    || setweight(to_tsvector('spanish', public.pilo_fold(section)), 'B')
    || setweight(to_tsvector('spanish', public.pilo_fold(body)), 'C')
  ) stored,
  constraint pilo_memory_source check (source in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto')),
  constraint pilo_memory_ref check (length(ref) between 3 and 300)
);

create index if not exists pilo_memory_fts_idx on public.pilo_memory using gin (fts);
create index if not exists pilo_memory_source_idx on public.pilo_memory (source);

comment on table public.pilo_memory is
  'Pregúntele a Pilo: pasajes de lo que muestran los portales públicos, con ruta, corte y oficina. Los escribe la administración al actualizar la memoria; los lee la función pilo-ia.';

alter table public.pilo_memory enable row level security;

drop policy if exists pilo_memory_admin on public.pilo_memory;
create policy pilo_memory_admin on public.pilo_memory
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_memory from anon;
grant select on public.pilo_memory to authenticated;

-- -----------------------------------------------------------------------------
-- Respuestas guardadas: lo que ya se respondió con IA (o con los pasajes tal
-- cual) y se puede volver a dar sin gastar, mientras sus pasajes no cambien.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_answers (
  id           bigint generated always as identity primary key,
  question     text not null,
  qnorm        text not null,
  kind         text not null,
  answer       text not null,
  refs         text[] not null default '{}',
  created_at   timestamptz not null default now(),
  last_hit_at  timestamptz,
  hits         integer not null default 0,
  up           integer not null default 0,
  down         integer not null default 0,
  hidden       boolean not null default false,
  fts          tsvector generated always as (to_tsvector('spanish', qnorm)) stored,
  constraint pilo_answers_kind check (kind in ('ia', 'extracto')),
  constraint pilo_answers_len check (length(question) <= 600 and length(answer) <= 6000)
);

create index if not exists pilo_answers_fts_idx on public.pilo_answers using gin (fts);
create index if not exists pilo_answers_created_idx on public.pilo_answers (created_at desc);

comment on table public.pilo_answers is
  'Pregúntele a Pilo: respuestas ya dadas, para repetirlas sin IA. La administración puede ocultarlas o borrarlas.';

alter table public.pilo_answers enable row level security;

drop policy if exists pilo_answers_admin_read on public.pilo_answers;
create policy pilo_answers_admin_read on public.pilo_answers
  for select to authenticated using (public.has_role_at_least('admin'));
drop policy if exists pilo_answers_admin_update on public.pilo_answers;
create policy pilo_answers_admin_update on public.pilo_answers
  for update to authenticated using (public.has_role_at_least('admin')) with check (public.has_role_at_least('admin'));
drop policy if exists pilo_answers_admin_delete on public.pilo_answers;
create policy pilo_answers_admin_delete on public.pilo_answers
  for delete to authenticated using (public.has_role_at_least('admin'));

revoke all on public.pilo_answers from anon;
grant select, update (hidden), delete on public.pilo_answers to authenticated;

-- -----------------------------------------------------------------------------
-- La configuración de la página: se abre desde «Mr. Pilo con IA».
-- -----------------------------------------------------------------------------

alter table public.pilo_ai_settings
  add column if not exists memory_sources jsonb not null
    default '{"cifras": true, "boletines": true, "pdi": true, "observatorio": true, "impacto": true}'::jsonb,
  add column if not exists pregunta_welcome boolean not null default true,
  add column if not exists memory_indexed_at timestamptz;

update public.pilo_ai_settings
set portals = portals || '{"pregunta": {"on": false, "aud": "publico", "fns": ["preguntar"]}}'::jsonb
where id = 1 and not (portals ? 'pregunta');

update public.pilo_ai_settings
set functions = functions || '{"preguntar": true}'::jsonb
where id = 1 and not (functions ? 'preguntar');

-- ¿Quién llama? La función del servidor (rol de servicio) o la administración.
create or replace function public.pilo_is_service_or_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.role(), '') = 'service_role' or current_user = 'service_role' or public.has_role_at_least('admin')
$$;

revoke all on function public.pilo_is_service_or_admin() from public, anon;

-- -----------------------------------------------------------------------------
-- Buscar en la memoria. Las palabras de la pregunta se unen con «o», no con
-- «y»: una pregunta en lenguaje natural casi nunca repite todas las palabras
-- del pasaje. El orden lo da ts_rank_cd normalizado (0 a 1).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_memory_search(p_q text, p_sources text[] default null, p_limit integer default 6)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, rank real)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_q))::text, ' & ', ' | ');
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
      and (p_sources is null or m.source = any (p_sources))
    order by rank desc, m.updated_at desc
    limit greatest(1, least(coalesce(p_limit, 6), 20));
end;
$$;

revoke all on function public.pilo_memory_search(text, text[], integer) from public, anon;
grant execute on function public.pilo_memory_search(text, text[], integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Reemplazar los pasajes de una fuente: lo que ya no está se borra, lo nuevo
-- entra y lo que cambió estrena fecha (así las respuestas guardadas que lo
-- citaban dejan de servirse).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_memory_replace(p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
  v_added integer := 0;
  v_changed integer := 0;
  v_total integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración actualiza la memoria de Pilo.' using errcode = '42501';
  end if;
  if p_source not in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto') then
    raise exception 'Fuente desconocida: %', p_source using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;

  create temporary table if not exists pilo_incoming (
    ref text primary key, title text, section text, body text, path text, cut text, office text
  ) on commit drop;
  delete from pilo_incoming where true;

  insert into pilo_incoming (ref, title, section, body, path, cut, office)
  select distinct on (r->>'ref')
    left(r->>'ref', 300), left(coalesce(r->>'title', ''), 300), left(coalesce(r->>'section', ''), 300),
    left(coalesce(r->>'body', ''), 8000), left(coalesce(r->>'path', ''), 300),
    left(coalesce(r->>'cut', ''), 60), left(coalesce(r->>'office', ''), 200)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where coalesce(r->>'ref', '') <> '' and coalesce(r->>'title', '') <> '' and length(coalesce(r->>'body', '')) >= 10;

  delete from public.pilo_memory m
  where m.source = p_source and not exists (select 1 from pilo_incoming i where i.ref = m.ref);
  get diagnostics v_removed = row_count;

  select count(*) into v_added from pilo_incoming i where not exists (select 1 from public.pilo_memory m where m.ref = i.ref);
  select count(*) into v_changed
  from pilo_incoming i join public.pilo_memory m on m.ref = i.ref
  where (m.title, m.section, m.body, m.path, m.cut, m.office, m.source)
        is distinct from (i.title, i.section, i.body, i.path, i.cut, i.office, p_source);

  insert into public.pilo_memory (ref, source, title, section, body, path, cut, office, updated_at)
  select i.ref, p_source, i.title, i.section, i.body, i.path, i.cut, i.office, now() from pilo_incoming i
  on conflict (ref) do update set
    source = excluded.source, title = excluded.title, section = excluded.section, body = excluded.body,
    path = excluded.path, cut = excluded.cut, office = excluded.office,
    updated_at = case
      when (pilo_memory.title, pilo_memory.section, pilo_memory.body, pilo_memory.path, pilo_memory.cut, pilo_memory.office, pilo_memory.source)
           is distinct from (excluded.title, excluded.section, excluded.body, excluded.path, excluded.cut, excluded.office, excluded.source)
      then now() else pilo_memory.updated_at end;

  select count(*) into v_total from public.pilo_memory where source = p_source;
  update public.pilo_ai_settings set memory_indexed_at = now() where id = 1;

  return jsonb_build_object('source', p_source, 'added', v_added, 'changed', v_changed, 'removed', v_removed, 'total', v_total);
end;
$$;

revoke all on function public.pilo_memory_replace(text, jsonb) from public, anon;
grant execute on function public.pilo_memory_replace(text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Respuestas guardadas parecidas a una pregunta (ya normalizada). La función
-- del servidor mide el parecido fino y revisa que los pasajes no hayan
-- cambiado desde que se respondió.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_answer_candidates(p_qnorm text)
returns table (id bigint, question text, qnorm text, kind text, answer text, refs text[], created_at timestamptz, fresh boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  words text := replace(plainto_tsquery('spanish', public.pilo_fold(p_qnorm))::text, ' & ', ' | ');
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
      ) as fresh
    from public.pilo_answers a
    where not a.hidden and a.down < greatest(2, a.up) and a.fts @@ words::tsquery
    order by ts_rank_cd(a.fts, words::tsquery, 32) desc, a.created_at desc
    limit 12;
end;
$$;

revoke all on function public.pilo_answer_candidates(text) from public, anon;
grant execute on function public.pilo_answer_candidates(text) to authenticated, service_role;

-- «Me sirvió» / «No me sirvió» sobre una respuesta guardada.
create or replace function public.pilo_answer_vote(p_id bigint, p_vote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo registra los votos.' using errcode = '42501';
  end if;
  update public.pilo_answers
  set up = up + case when p_vote = 'up' then 1 else 0 end,
      down = down + case when p_vote = 'down' then 1 else 0 end
  where id = p_id;
end;
$$;

revoke all on function public.pilo_answer_vote(bigint, text) from public, anon;
grant execute on function public.pilo_answer_vote(bigint, text) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lo que la página necesita saber, sin secretos. «pregunta» no depende de que
-- la IA esté conectada: sin IA, Pilo responde de memoria.
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
        or (s.speech_provider = 'otro' and coalesce(nullif(s.speech_base_url, ''), s.base_url) <> '' and s.speech_model <> '')
      ),
    'functions', s.functions,
    'portals', s.portals,
    'voice_engine', s.voice_engine,
    'voice_rate', s.voice_rate,
    'voice_pitch', s.voice_pitch,
    'pregunta', jsonb_build_object(
      'on', coalesce((s.portals->'pregunta'->>'on')::boolean, false),
      'aud', coalesce(s.portals->'pregunta'->>'aud', 'publico'),
      'welcome', s.pregunta_welcome,
      'ai', s.enabled and s.base_url <> '' and u.text_key <> '' and coalesce((s.functions->>'preguntar')::boolean, true)
    )
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;

notify pgrst, 'reload schema';
