-- =============================================================================
-- 0108 · Pregúntele a Pilo: búsqueda por significado.
--
-- Cada pasaje de la memoria (0094) y cada indicador de las cifras en vivo
-- (0107) guardan un vector de 1024 dimensiones (embedding) que dice de qué
-- habla. La función pilo-ia convierte la pregunta en otro vector y busca los
-- más cercanos; luego los funde con la búsqueda por palabras. Así «¿cuántos
-- se fueron de la universidad?» encuentra «tasa de deserción».
--
--   embedding, embed_model, embedded_at   en pilo_memory y pilo_facts. Un
--        vector está vencido si no hay, si es de otro modelo o si el texto
--        cambió después (updated_at > embedded_at).
--   pilo_embed_status(model)      cuántos hay y cuántos están al día.
--   pilo_embed_pending(model, n)  los siguientes textos por convertir.
--   pilo_embed_save(model, rows)  guarda los vectores.
--   pilo_memory_semantic(...)     los pasajes más cercanos a un vector.
--   pilo_facts_semantic(...)      los indicadores más cercanos a un vector.
--
-- Los vectores los calcula la función pilo-ia con la clave del proveedor
-- (NVIDIA o Mistral); la administración la llama desde «Actualizar la memoria».
-- Requiere 0094 y 0107. Idempotente.
-- =============================================================================

alter table public.pilo_memory
  add column if not exists embed_model text,
  add column if not exists embedded_at timestamptz;

alter table public.pilo_facts
  add column if not exists embed_model text,
  add column if not exists embedded_at timestamptz;

-- pgvector está en Supabase. Donde no está (el Postgres en memoria de las
-- pruebas), la migración sigue sin los vectores: las funciones de abajo se
-- crean igual y solo fallarían si se llamaran.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'vector') then
    create extension if not exists vector with schema extensions;
    alter table public.pilo_memory add column if not exists embedding extensions.vector(1024);
    alter table public.pilo_facts add column if not exists embedding extensions.vector(1024);
    create index if not exists pilo_memory_embedding_idx on public.pilo_memory using hnsw (embedding extensions.vector_cosine_ops);
    create index if not exists pilo_facts_embedding_idx on public.pilo_facts using hnsw (embedding extensions.vector_cosine_ops);
  else
    raise notice 'pgvector no está disponible: Pilo busca solo por palabras.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- El texto que se convierte en vector: lo mismo que lee quien pregunta.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_embed_text_memory(m public.pilo_memory)
returns text
language sql
immutable
as $$
  select left(concat_ws('. ', nullif(m.title, ''), nullif(m.section, ''), m.body), 2000)
$$;

create or replace function public.pilo_embed_text_fact(f public.pilo_facts)
returns text
language sql
immutable
as $$
  select left(concat_ws('. ', f.label, nullif('Informe ' || f.report, 'Informe '), nullif(f.unit, ''), nullif(f.definition, '')), 2000)
$$;

-- -----------------------------------------------------------------------------
-- Estado: cuántos pasajes e indicadores tienen su vector al día con ese modelo.
-- -----------------------------------------------------------------------------

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
                   where f.embedding is not null and f.embed_model = p_model and f.embedded_at >= f.updated_at)
  ) into v;
  return v;
end;
$$;

revoke all on function public.pilo_embed_status(text) from public, anon;
grant execute on function public.pilo_embed_status(text) to authenticated, service_role;

-- Los siguientes textos sin vector al día. kind: 'memoria' o 'cifra'.
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

revoke all on function public.pilo_embed_pending(text, integer) from public, anon;
grant execute on function public.pilo_embed_pending(text, integer) to authenticated, service_role;

-- Guarda los vectores: [{kind, ref, embedding: "[0.1,…]"}].
create or replace function public.pilo_embed_save(p_model text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_mem integer := 0;
  v_fact integer := 0;
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

  return v_mem + v_fact;
end;
$$;

revoke all on function public.pilo_embed_save(text, jsonb) from public, anon;
grant execute on function public.pilo_embed_save(text, jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Buscar por significado. Solo vectores del mismo modelo que la pregunta, y
-- solo los que se parecen al menos p_min (coseno, de 0 a 1).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_memory_semantic(p_embedding text, p_model text, p_sources text[] default null, p_limit integer default 8, p_min real default 0.3)
returns table (ref text, source text, title text, section text, body text, path text, cut text, office text, updated_at timestamptz, sim real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
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
        and (p_sources is null or m.source = any (p_sources))
      order by m.embedding <=> q.v
      limit greatest(1, least(coalesce(p_limit, 8), 20))
    ) near
    where near.sim >= coalesce(p_min, 0.3);
end;
$$;

revoke all on function public.pilo_memory_semantic(text, text, text[], integer, real) from public, anon;
grant execute on function public.pilo_memory_semantic(text, text, text[], integer, real) to authenticated, service_role;

create or replace function public.pilo_facts_semantic(p_embedding text, p_model text, p_limit integer default 3, p_min real default 0.3)
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

revoke all on function public.pilo_facts_semantic(text, text, integer, real) from public, anon;
grant execute on function public.pilo_facts_semantic(text, text, integer, real) to authenticated, service_role;
