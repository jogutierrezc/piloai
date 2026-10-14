-- =============================================================================
-- 0096 · Pregúntele a Pilo: el catálogo que escribe Planeación.
--
-- Dos clases de entradas, escritas en Excel (plantillas en la intranet) e
-- importadas desde «Mr. Pilo con IA»:
--
--   respuesta  una pregunta con la respuesta oficial de Planeación, otras
--              formas de preguntarla (variantes) y, si se quiere, su fuente.
--   capciosa   una microexpresión: una respuesta corta y rápida que se dispara
--              cuando la pregunta trae ciertas palabras (disparadores), con la
--              emoción con la que Pilo la dice.
--
-- La función pilo-ia revisa el catálogo antes que todo lo demás y sin IA.
-- Cada entrada se identifica por su clave (R-001, C-001…): importar de nuevo
-- la misma clave la actualiza.
--
--   pilo_catalog_import(clase, filas, reemplazar)  admin: carga un libro
--   pilo_catalog_active()                          la función: lo activo
--
-- Requiere 0094. Idempotente.
-- =============================================================================

create table if not exists public.pilo_catalog (
  key           text primary key,
  kind          text not null,
  question      text not null default '',
  variants      text[] not null default '{}',
  triggers      text[] not null default '{}',
  answer        text not null,
  mood          text not null default 'emocionado',
  source_title  text not null default '',
  source_path   text not null default '',
  cut           text not null default '',
  office        text not null default '',
  active        boolean not null default true,
  hits          integer not null default 0,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references public.profiles (id) on delete set null,
  constraint pilo_catalog_kind check (kind in ('respuesta', 'capciosa')),
  constraint pilo_catalog_mood check (mood in ('emocionado', 'atrevido', 'loco', 'pensar')),
  constraint pilo_catalog_key check (key ~ '^[A-Za-z0-9._-]{1,40}$'),
  constraint pilo_catalog_len check (length(answer) between 2 and 2000),
  constraint pilo_catalog_needs check (
    (kind = 'respuesta' and length(question) >= 3)
    or (kind = 'capciosa' and cardinality(triggers) >= 1)
  )
);

create index if not exists pilo_catalog_kind_idx on public.pilo_catalog (kind, active);

comment on table public.pilo_catalog is
  'Pregúntele a Pilo: respuestas oficiales y microexpresiones para preguntas capciosas, escritas por Planeación en Excel. Pilo las revisa antes que todo, sin IA.';

alter table public.pilo_catalog enable row level security;

drop policy if exists pilo_catalog_admin on public.pilo_catalog;
create policy pilo_catalog_admin on public.pilo_catalog
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

revoke all on public.pilo_catalog from anon;
grant select, update (active), delete on public.pilo_catalog to authenticated;

-- -----------------------------------------------------------------------------
-- Importar un libro. Las filas llegan ya revisadas por la intranet; aquí se
-- vuelven a limpiar y se guardan por clave. Con «reemplazar», las entradas de
-- esa clase que no vienen en el libro se borran (el libro manda).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_catalog_import(p_kind text, p_rows jsonb, p_replace boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_added integer := 0;
  v_updated integer := 0;
  v_removed integer := 0;
  v_total integer := 0;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración importa el catálogo de Pilo.' using errcode = '42501';
  end if;
  if p_kind not in ('respuesta', 'capciosa') then
    raise exception 'Clase desconocida: %', p_kind using errcode = '22023';
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
      coalesce((r->>'active')::boolean, true) as active
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where btrim(coalesce(r->>'key', '')) <> ''
  ),
  counted as (
    select
      count(*) filter (where not exists (select 1 from public.pilo_catalog c where c.key = i.key)) as added,
      count(*) filter (where exists (select 1 from public.pilo_catalog c where c.key = i.key)) as updated
    from incoming i
  ),
  written as (
    insert into public.pilo_catalog as c (key, kind, question, variants, triggers, answer, mood, source_title, source_path, cut, office, active, updated_at, updated_by)
    select i.key, p_kind, i.question, i.variants, i.triggers, i.answer, i.mood, i.source_title, i.source_path, i.cut, i.office, i.active, now(), auth.uid()
    from incoming i
    on conflict (key) do update set
      kind = excluded.kind, question = excluded.question, variants = excluded.variants, triggers = excluded.triggers,
      answer = excluded.answer, mood = excluded.mood, source_title = excluded.source_title, source_path = excluded.source_path,
      cut = excluded.cut, office = excluded.office, active = excluded.active, updated_at = now(), updated_by = auth.uid()
    returning c.key
  )
  select counted.added, counted.updated into v_added, v_updated from counted, (select count(*) from written) w;

  if p_replace then
    delete from public.pilo_catalog c
    where c.kind = p_kind
      and not exists (
        select 1 from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
        where upper(btrim(r->>'key')) = c.key
      );
    get diagnostics v_removed = row_count;
  end if;

  select count(*) into v_total from public.pilo_catalog where kind = p_kind;
  return jsonb_build_object('kind', p_kind, 'added', v_added, 'updated', v_updated, 'removed', v_removed, 'total', v_total);
end;
$$;

revoke all on function public.pilo_catalog_import(text, jsonb, boolean) from public, anon;
grant execute on function public.pilo_catalog_import(text, jsonb, boolean) to authenticated;

-- Lo activo, para la función del servidor (rol de servicio) y la administración.
create or replace function public.pilo_catalog_active()
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
  return query select * from public.pilo_catalog where active order by kind, key;
end;
$$;

revoke all on function public.pilo_catalog_active() from public, anon;
grant execute on function public.pilo_catalog_active() to authenticated, service_role;

-- Cuántas veces sirvió cada entrada (lo suma la función del servidor).
create or replace function public.pilo_catalog_hit(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo cuenta los usos.' using errcode = '42501';
  end if;
  update public.pilo_catalog set hits = hits + 1 where key = p_key;
end;
$$;

revoke all on function public.pilo_catalog_hit(text) from public, anon;
grant execute on function public.pilo_catalog_hit(text) to authenticated, service_role;

notify pgrst, 'reload schema';
