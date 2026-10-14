-- =============================================================================
-- 0107 · Pregúntele a Pilo: las cifras en vivo.
--
-- La memoria (0094) guarda de cada indicador de UDES en Cifras su última
-- cifra. Aquí se guarda la serie entera de cada indicador: año, periodo (1, 2
-- o el año) y sede, con el mismo cálculo del portal (totales que salen de las
-- sedes, cifra del año a partir de los periodos). Así Pilo responde la cifra
-- exacta que se pide: «matriculados en Cúcuta en 2023-2».
--
--   pilo_facts               un indicador por fila; `series` es la lista de
--                            cifras [{y, t, c, v}] (t null = el año; c "" =
--                            toda la UDES). Sin cifras de dinero.
--   pilo_facts_replace(rows) la deja igual a lo que se envía (lo escribe la
--                            administración al «Actualizar la memoria»).
--   pilo_facts_search(q)     los indicadores más cercanos a una pregunta.
--   pilo_facts_campuses()    las sedes que aparecen en las series.
--
-- Solo la función pilo-ia y la administración leen y escriben.
-- Requiere 0094 (pilo_fold, pilo_is_service_or_admin). Idempotente.
-- =============================================================================

create table if not exists public.pilo_facts (
  ref           text primary key,
  report        text not null default '',
  label         text not null,
  unit          text not null default '',
  format        text not null default 'entero',
  definition    text not null default '',
  office        text not null default '',
  path          text not null default '',
  period        text not null default '',
  illustrative  boolean not null default false,
  series        jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  fts           tsvector generated always as (
    setweight(to_tsvector('spanish', public.pilo_fold(label)), 'A')
    || setweight(to_tsvector('spanish', public.pilo_fold(report)), 'B')
    || setweight(to_tsvector('spanish', public.pilo_fold(definition)), 'C')
  ) stored,
  constraint pilo_facts_ref check (length(ref) between 3 and 300),
  constraint pilo_facts_series check (jsonb_typeof(series) = 'array'),
  constraint pilo_facts_format check (format in ('entero', 'porcentaje', 'decimal'))
);

create index if not exists pilo_facts_fts_idx on public.pilo_facts using gin (fts);

comment on table public.pilo_facts is
  'Pregúntele a Pilo: la serie completa de cada indicador publicado de UDES en Cifras (año, periodo, sede), con el cálculo del portal. La escribe la administración al actualizar la memoria; la lee la función pilo-ia.';

alter table public.pilo_facts enable row level security;

drop policy if exists pilo_facts_admin on public.pilo_facts;
create policy pilo_facts_admin on public.pilo_facts
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_facts from anon;
grant select on public.pilo_facts to authenticated;

-- -----------------------------------------------------------------------------
-- Reemplazar todas las series. Una lista vacía no se acepta: borraría lo que
-- Pilo sabe de las cifras.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_facts_replace(p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
  v_total integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración actualiza las cifras de Pilo.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Las series deben ser una lista con al menos un indicador.' using errcode = '22023';
  end if;

  create temporary table if not exists pilo_facts_incoming (
    ref text primary key, report text, label text, unit text, format text, definition text,
    office text, path text, period text, illustrative boolean, series jsonb
  ) on commit drop;
  delete from pilo_facts_incoming where true;

  insert into pilo_facts_incoming
  select distinct on (r->>'ref')
    left(r->>'ref', 300), left(coalesce(r->>'report', ''), 300), left(r->>'label', 300),
    left(coalesce(r->>'unit', ''), 60),
    case when r->>'format' in ('entero', 'porcentaje', 'decimal') then r->>'format' else 'entero' end,
    left(coalesce(r->>'definition', ''), 1200), left(coalesce(r->>'office', ''), 200),
    left(coalesce(r->>'path', ''), 300), left(coalesce(r->>'period', ''), 60),
    coalesce((r->>'illustrative')::boolean, false),
    case when jsonb_typeof(r->'series') = 'array' then r->'series' else '[]'::jsonb end
  from jsonb_array_elements(p_rows) r
  where coalesce(r->>'ref', '') <> '' and coalesce(r->>'label', '') <> '';

  delete from public.pilo_facts f where not exists (select 1 from pilo_facts_incoming i where i.ref = f.ref);
  get diagnostics v_removed = row_count;

  insert into public.pilo_facts (ref, report, label, unit, format, definition, office, path, period, illustrative, series, updated_at)
  select i.ref, i.report, i.label, i.unit, i.format, i.definition, i.office, i.path, i.period, i.illustrative, i.series, now()
  from pilo_facts_incoming i
  on conflict (ref) do update set
    report = excluded.report, label = excluded.label, unit = excluded.unit, format = excluded.format,
    definition = excluded.definition, office = excluded.office, path = excluded.path, period = excluded.period,
    illustrative = excluded.illustrative, series = excluded.series,
    updated_at = case
      when (pilo_facts.report, pilo_facts.label, pilo_facts.unit, pilo_facts.format, pilo_facts.definition, pilo_facts.series)
           is distinct from (excluded.report, excluded.label, excluded.unit, excluded.format, excluded.definition, excluded.series)
      then now() else pilo_facts.updated_at end;

  select count(*) into v_total from public.pilo_facts;
  return jsonb_build_object('total', v_total, 'removed', v_removed);
end;
$$;

revoke all on function public.pilo_facts_replace(jsonb) from public, anon;
grant execute on function public.pilo_facts_replace(jsonb) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Buscar indicadores: como la memoria, las palabras se unen con «o» y el
-- orden lo da ts_rank_cd normalizado.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_facts_search(p_q text, p_limit integer default 3)
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
  return query
    select f.ref, f.report, f.label, f.unit, f.format, f.definition, f.office, f.path, f.period, f.illustrative, f.series,
           ts_rank_cd(f.fts, words::tsquery, 32)::real as rank
    from public.pilo_facts f
    where f.fts @@ words::tsquery
    order by rank desc, f.label
    limit greatest(1, least(coalesce(p_limit, 3), 10));
end;
$$;

revoke all on function public.pilo_facts_search(text, integer) from public, anon;
grant execute on function public.pilo_facts_search(text, integer) to authenticated, service_role;

create or replace function public.pilo_facts_campuses()
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text[];
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración leen las cifras.' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct e->>'c' order by e->>'c'), '{}')
  into v
  from public.pilo_facts f, jsonb_array_elements(f.series) e
  where coalesce(e->>'c', '') <> '';
  return v;
end;
$$;

revoke all on function public.pilo_facts_campuses() from public, anon;
grant execute on function public.pilo_facts_campuses() to authenticated, service_role;
