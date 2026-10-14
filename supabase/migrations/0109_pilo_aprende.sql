-- =============================================================================
-- 0109 · Pregúntele a Pilo aprende.
--
-- Lo que Pilo no supo responder llega a una bandeja de la administración:
--   - «sin_respuesta»: no encontró nada en lo publicado;
--   - «no_sirvio»:     quien preguntó marcó «No me sirvió»;
--   - «revisar»:       la IA redactó con una cifra que no está en las fuentes.
-- La misma pregunta (normalizada) suma veces en vez de repetirse. Planeación
-- la responde y la respuesta entra al catálogo (0096): desde ese momento Pilo
-- la da primero, sin IA. Y como el catálogo también se indexa por significado
-- (0108), Pilo la reconoce aunque la pregunten con otras palabras.
--
--   pilo_inbox                    la bandeja.
--   pilo_inbox_add(...)           la función pilo-ia anota (servicio).
--   pilo_inbox_close(id, status, key)  la administración la resuelve o la
--                                 descarta; al resolverla, la respuesta
--                                 guardada que no sirvió se oculta.
--   pilo_catalog_vectors          el vector de cada respuesta del catálogo.
--   pilo_catalog_semantic(...)    la respuesta del catálogo más cercana.
--   pilo_embed_status/pending/save  ahora incluyen el catálogo.
--   pilo_ai_settings.embed_model  otro modelo de embeddings, si el de
--                                 partida se retira (vacío = el de partida).
--
-- Requiere 0094, 0096, 0107 y 0108. Idempotente.
-- =============================================================================

alter table public.pilo_ai_settings add column if not exists embed_model text not null default '';

-- -----------------------------------------------------------------------------
-- La bandeja
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_inbox (
  id           bigint generated always as identity primary key,
  question     text not null,
  qnorm        text not null,
  reason       text not null,
  kind         text not null default '',
  answer       text not null default '',
  answer_id    bigint references public.pilo_answers (id) on delete set null,
  times        integer not null default 1,
  first_at     timestamptz not null default now(),
  last_at      timestamptz not null default now(),
  status       text not null default 'pendiente',
  catalog_key  text,
  resolved_at  timestamptz,
  resolved_by  uuid references public.profiles (id) on delete set null,
  constraint pilo_inbox_reason check (reason in ('sin_respuesta', 'no_sirvio', 'revisar')),
  constraint pilo_inbox_status check (status in ('pendiente', 'resuelta', 'descartada')),
  constraint pilo_inbox_len check (length(question) between 2 and 600 and length(answer) <= 6000)
);

create unique index if not exists pilo_inbox_pending_idx on public.pilo_inbox (qnorm, reason) where status = 'pendiente';
create index if not exists pilo_inbox_status_idx on public.pilo_inbox (status, last_at desc);

comment on table public.pilo_inbox is
  'Pregúntele a Pilo: lo que no supo responder, lo que no sirvió y lo que la IA dijo sin fuente. Planeación lo responde en el catálogo.';

alter table public.pilo_inbox enable row level security;

drop policy if exists pilo_inbox_admin_read on public.pilo_inbox;
create policy pilo_inbox_admin_read on public.pilo_inbox
  for select to authenticated using (public.has_role_at_least('admin'));
drop policy if exists pilo_inbox_admin_delete on public.pilo_inbox;
create policy pilo_inbox_admin_delete on public.pilo_inbox
  for delete to authenticated using (public.has_role_at_least('admin'));

revoke all on public.pilo_inbox from anon;
grant select, delete on public.pilo_inbox to authenticated;

-- La función pilo-ia anota. La misma pregunta pendiente suma una vez más.
create or replace function public.pilo_inbox_add(p_question text, p_qnorm text, p_reason text, p_kind text default '', p_answer text default '', p_answer_id bigint default null)
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
  insert into public.pilo_inbox as b (question, qnorm, reason, kind, answer, answer_id)
  values (left(trim(p_question), 600), left(p_qnorm, 600), p_reason, left(coalesce(p_kind, ''), 20), left(coalesce(p_answer, ''), 6000), p_answer_id)
  on conflict (qnorm, reason) where status = 'pendiente' do update
    set times = b.times + 1, last_at = now(),
        question = excluded.question, kind = excluded.kind, answer = excluded.answer,
        answer_id = coalesce(excluded.answer_id, b.answer_id);
end;
$$;

revoke all on function public.pilo_inbox_add(text, text, text, text, text, bigint) from public, anon;
grant execute on function public.pilo_inbox_add(text, text, text, text, text, bigint) to authenticated, service_role;

-- La administración resuelve (con la clave del catálogo) o descarta. Al
-- resolver, la respuesta guardada que no sirvió deja de darse: ahora manda el catálogo.
create or replace function public.pilo_inbox_close(p_id bigint, p_status text, p_key text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_answer bigint;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cierra la bandeja de Pilo.' using errcode = '42501';
  end if;
  if p_status not in ('resuelta', 'descartada', 'pendiente') then
    raise exception 'Estado desconocido: %', p_status using errcode = '22023';
  end if;
  update public.pilo_inbox
  set status = p_status,
      catalog_key = case when p_status = 'resuelta' then nullif(trim(p_key), '') else null end,
      resolved_at = case when p_status = 'pendiente' then null else now() end,
      resolved_by = case when p_status = 'pendiente' then null else auth.uid() end
  where id = p_id
  returning answer_id into v_answer;
  if p_status = 'resuelta' and v_answer is not null then
    update public.pilo_answers set hidden = true where id = v_answer;
  end if;
end;
$$;

revoke all on function public.pilo_inbox_close(bigint, text, text) from public, anon;
grant execute on function public.pilo_inbox_close(bigint, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- El catálogo por significado: un vector por respuesta oficial activa.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_catalog_vectors (
  key          text primary key references public.pilo_catalog (key) on delete cascade on update cascade,
  embed_model  text,
  embedded_at  timestamptz
);

alter table public.pilo_catalog_vectors enable row level security;
revoke all on public.pilo_catalog_vectors from anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    create extension if not exists vector with schema extensions;
    alter table public.pilo_catalog_vectors add column if not exists embedding extensions.vector(1024);
  else
    raise notice 'pgvector no está disponible: el catálogo se reconoce solo por palabras.';
  end if;
end;
$$;

-- Lo que se convierte en vector: la pregunta y sus variantes.
create or replace function public.pilo_embed_text_catalog(c public.pilo_catalog)
returns text
language sql
immutable
as $$
  select left(concat_ws('. ', c.question, nullif(array_to_string(c.variants, '. '), '')), 2000)
$$;

create or replace function public.pilo_embed_status(p_model text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v jsonb;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración ven el índice.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'model', p_model,
    'memory_total', (select count(*) from public.pilo_memory),
    'memory_done', (select count(*) from public.pilo_memory m
                    where m.embedding is not null and m.embed_model = p_model and m.embedded_at >= m.updated_at),
    'facts_total', (select count(*) from public.pilo_facts),
    'facts_done', (select count(*) from public.pilo_facts f
                   where f.embedding is not null and f.embed_model = p_model and f.embedded_at >= f.updated_at),
    'catalog_total', (select count(*) from public.pilo_catalog c where c.kind = 'respuesta' and c.active),
    'catalog_done', (select count(*) from public.pilo_catalog c join public.pilo_catalog_vectors cv on cv.key = c.key
                     where c.kind = 'respuesta' and c.active and cv.embedding is not null
                       and cv.embed_model = p_model and cv.embedded_at >= c.updated_at)
  ) into v;
  return v;
end;
$$;

create or replace function public.pilo_embed_pending(p_model text, p_limit integer default 64)
returns table (kind text, ref text, body text)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo indexa la memoria.' using errcode = '42501';
  end if;
  return query
    (select 'catalogo'::text, c.key, public.pilo_embed_text_catalog(c)
     from public.pilo_catalog c
     left join public.pilo_catalog_vectors cv on cv.key = c.key
     where c.kind = 'respuesta' and c.active
       and (cv.key is null or cv.embedding is null or cv.embed_model is distinct from p_model or cv.embedded_at < c.updated_at)
     order by c.key)
    union all
    (select 'memoria'::text, m.ref, public.pilo_embed_text_memory(m)
     from public.pilo_memory m
     where m.embedding is null or m.embed_model is distinct from p_model or m.embedded_at < m.updated_at
     order by m.ref)
    union all
    (select 'cifra'::text, f.ref, public.pilo_embed_text_fact(f)
     from public.pilo_facts f
     where f.embedding is null or f.embed_model is distinct from p_model or f.embedded_at < f.updated_at
     order by f.ref)
    limit greatest(1, least(coalesce(p_limit, 64), 256));
end;
$$;

create or replace function public.pilo_embed_save(p_model text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mem integer := 0;
  v_fact integer := 0;
  v_cat integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo indexa la memoria.' using errcode = '42501';
  end if;
  if coalesce(p_model, '') = '' or jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Falta el modelo o la lista de vectores.' using errcode = '22023';
  end if;

  update public.pilo_memory m
  set embedding = (r->>'embedding')::extensions.vector, embed_model = p_model, embedded_at = now()
  from jsonb_array_elements(p_rows) r
  where r->>'kind' = 'memoria' and m.ref = r->>'ref';
  get diagnostics v_mem = row_count;

  update public.pilo_facts f
  set embedding = (r->>'embedding')::extensions.vector, embed_model = p_model, embedded_at = now()
  from jsonb_array_elements(p_rows) r
  where r->>'kind' = 'cifra' and f.ref = r->>'ref';
  get diagnostics v_fact = row_count;

  insert into public.pilo_catalog_vectors (key, embedding, embed_model, embedded_at)
  select r->>'ref', (r->>'embedding')::extensions.vector, p_model, now()
  from jsonb_array_elements(p_rows) r
  where r->>'kind' = 'catalogo' and exists (select 1 from public.pilo_catalog c where c.key = r->>'ref')
  on conflict (key) do update set embedding = excluded.embedding, embed_model = excluded.embed_model, embedded_at = excluded.embedded_at;
  get diagnostics v_cat = row_count;

  return v_mem + v_fact + v_cat;
end;
$$;

-- La respuesta oficial más cercana a la pregunta, si se parece al menos p_min.
create or replace function public.pilo_catalog_semantic(p_embedding text, p_model text, p_min real default 0.8)
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
      where c.kind = 'respuesta' and c.active and cv.embedding is not null
        and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
      order by cv.embedding <=> q.v
      limit 1
    ) near
    where near.sim >= coalesce(p_min, 0.8);
end;
$$;

revoke all on function public.pilo_catalog_semantic(text, text, real) from public, anon;
grant execute on function public.pilo_catalog_semantic(text, text, real) to authenticated, service_role;
