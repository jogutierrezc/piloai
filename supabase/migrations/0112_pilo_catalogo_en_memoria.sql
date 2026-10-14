-- =============================================================================
-- 0112 · Mr. Pilo con IA: todo el catálogo entra en la memoria de Pilo.
--
-- Hasta 0109 solo las respuestas oficiales tenían vector; las capciosas se
-- reconocían nada más por las palabras de su disparador. Desde que todo lo
-- redacta el modelo, el catálogo entero (respuestas y capciosas) es
-- conocimiento que Pilo consulta por significado:
--
--   pilo_embed_text_catalog   el texto que se convierte en vector: la pregunta,
--                             sus variantes y los disparadores.
--   pilo_embed_status         cuenta todas las entradas activas.
--   pilo_embed_pending        pide el vector de todas las activas.
--   pilo_catalog_semantic     la entrada más cercana, de cualquier clase.
--   pilo_catalog_near         las más cercanas con su parecido, sin umbral:
--                             es lo que usa «Probar el catálogo» en la intranet.
--
-- Requiere 0109. Idempotente. Sin pgvector (PGlite) las funciones existen y
-- fallan solo al llamarlas, igual que en 0109.
-- =============================================================================

create or replace function public.pilo_embed_text_catalog(c public.pilo_catalog)
returns text
language sql
immutable
as $$
  select left(
    concat_ws('. ',
      nullif(btrim(c.question), ''),
      nullif(array_to_string(c.variants, '. '), ''),
      nullif(array_to_string(c.triggers, '. '), '')),
    2000)
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
    'catalog_total', (select count(*) from public.pilo_catalog c where c.active),
    'catalog_done', (select count(*) from public.pilo_catalog c join public.pilo_catalog_vectors cv on cv.key = c.key
                     where c.active and cv.embedding is not null
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
     where c.active
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

-- La entrada del catálogo más cercana a la pregunta, si se parece al menos p_min.
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
      where c.active and cv.embedding is not null
        and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
      order by cv.embedding <=> q.v
      limit 1
    ) near
    where near.sim >= coalesce(p_min, 0.8);
end;
$$;

-- Las entradas más cercanas, con su parecido y sin umbral: para probar el catálogo.
create or replace function public.pilo_catalog_near(p_embedding text, p_model text, p_limit integer default 5)
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
    where c.active and cv.embedding is not null
      and cv.embed_model = p_model and cv.embedded_at >= c.updated_at
    order by cv.embedding <=> q.v
    limit greatest(1, least(coalesce(p_limit, 5), 20));
end;
$$;

revoke all on function public.pilo_catalog_semantic(text, text, real) from public, anon;
grant execute on function public.pilo_catalog_semantic(text, text, real) to authenticated, service_role;
revoke all on function public.pilo_catalog_near(text, text, integer) from public, anon;
grant execute on function public.pilo_catalog_near(text, text, integer) to authenticated, service_role;
