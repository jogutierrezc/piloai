-- =============================================================================
-- 0145 · Informes ODS con Pilo: el informe de cada ODS por edición, armado con
-- las noticias aprobadas del recolector (0143, 0144).
--
-- La función `pilo-rankingsod` (clave de servicio) propone el plan, redacta los
-- párrafos con la cita literal de cada nota, elige la evidencia de cada
-- indicador de THE y propone pie, texto alternativo y crédito de las fotos.
-- Planeación revisa, corrige y publica en /admin/rankings.
--
--   ods_reports           un informe por ODS y edición: estado (borrador |
--                         revision | publicado) y ajustes {tone, person, plan}.
--   ods_report_blocks     los párrafos por sección, con quién los escribió
--                         (pilo | persona | editado), el texto original de Pilo,
--                         sus fuentes [{news_id, quote}], sus cifras, el aviso
--                         para quien revisa, si está activo y si es de reserva.
--   ods_report_photos     las fotos de las notas usadas: ranura, pie, alt,
--                         crédito, si es pieza gráfica, si aparecen menores, si
--                         se confirmó la autorización y el recorte.
--   ods_report_indicators la nota elegida como evidencia de cada indicador de
--                         THE, las candidatas, las frases literales (page_es),
--                         el texto en inglés y si una persona la aprobó.
--
-- Lo de una persona no lo pisa Pilo: si alguien con sesión cambia el texto de
-- un párrafo de Pilo, el disparador lo marca «editado» (y nunca vuelve a
-- «pilo»); la función no reescribe párrafos «persona» ni «editado» ni
-- elecciones aprobadas.
--
-- Quién puede qué:
--   · Planeación y la administración leen y escriben todo.
--   · El público (anon) lee solo lo de informes publicados: párrafos activos y
--     no de reserva, fotos en uso que se pueden publicar (sin menores o con
--     autorización) y elecciones aprobadas. Nunca orig, warn, updated_by,
--     candidates ni ask (grants de columna).
--   · La página de evidencia lee `ods_evidencia(ods, indicador)`.
--   · La función escribe con la clave de servicio.
-- Todo UPDATE y DELETE lleva WHERE (safeupdate, ver 0095). Idempotente.
-- Requiere 0143 y 0144.
-- =============================================================================

create table if not exists public.ods_reports (
  id         uuid primary key default gen_random_uuid(),
  ods        smallint not null,
  edition    int not null,
  state      text not null default 'borrador',
  settings   jsonb not null default '{"tone":"cercano","person":"nosotros"}'::jsonb,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint ods_reports_ods check (ods between 1 and 17),
  constraint ods_reports_edition check (edition between 2020 and 2100),
  constraint ods_reports_state check (state in ('borrador', 'revision', 'publicado')),
  constraint ods_reports_unique unique (ods, edition)
);

create table if not exists public.ods_report_blocks (
  id         uuid primary key default gen_random_uuid(),
  report_id  uuid not null references public.ods_reports (id) on delete cascade,
  sec        text not null,
  pos        int not null default 0,
  origin     text not null default 'persona',
  text       text not null default '',
  orig       text not null default '',
  sources    jsonb not null default '[]'::jsonb,
  figs       jsonb not null default '[]'::jsonb,
  warn       text,
  enabled    boolean not null default true,
  spare      boolean not null default false,
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint ods_report_blocks_sec check (sec in ('tesis', 'cifras', 'hicimos', 'proyectos', 'viene')),
  constraint ods_report_blocks_origin check (origin in ('pilo', 'persona', 'editado')),
  constraint ods_report_blocks_sources check (jsonb_typeof(sources) = 'array'),
  constraint ods_report_blocks_figs check (jsonb_typeof(figs) = 'array'),
  constraint ods_report_blocks_text check (length(text) <= 6000)
);

create index if not exists ods_report_blocks_report_idx on public.ods_report_blocks (report_id, sec, pos);

create table if not exists public.ods_report_photos (
  report_id uuid not null references public.ods_reports (id) on delete cascade,
  news_id   uuid not null references public.news_items (id) on delete cascade,
  use       boolean not null default false,
  slot      text not null default 'galeria',
  caption   text not null default '',
  alt       text not null default '',
  credit    text not null default '',
  kind      text not null default 'foto',
  minors    boolean not null default false,
  cleared   boolean not null default false,
  crop      jsonb not null default '{"fx":0.5,"fy":0.4,"ratio":"16:9"}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (report_id, news_id),
  constraint ods_report_photos_slot check (slot in ('portada', 'n1', 'n2', 'galeria')),
  constraint ods_report_photos_kind check (kind in ('foto', 'grafica')),
  constraint ods_report_photos_crop check (jsonb_typeof(crop) = 'object')
);

create table if not exists public.ods_report_indicators (
  report_id  uuid not null references public.ods_reports (id) on delete cascade,
  indicator  text not null,
  news_id    uuid references public.news_items (id) on delete set null,
  candidates jsonb not null default '[]'::jsonb,
  ask        jsonb not null default '{}'::jsonb,
  page_es    jsonb not null default '[]'::jsonb,
  page_en    text not null default '',
  approved   boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (report_id, indicator),
  constraint ods_report_indicators_indicator check (indicator ~ '^[0-9]{1,2}(\.[0-9a-z]{1,3}){1,3}$'),
  constraint ods_report_indicators_page_es check (jsonb_typeof(page_es) = 'array'),
  constraint ods_report_indicators_candidates check (jsonb_typeof(candidates) = 'array')
);

comment on table public.ods_reports is
  'Informes ODS con Pilo (0145): un informe por ODS y edición. El público solo lee los publicados.';
comment on column public.ods_report_blocks.origin is
  'pilo (lo redactó Pilo), persona (lo escribió una persona) o editado (de Pilo, cambiado por una persona). Nunca vuelve a pilo desde una sesión.';

-- Quién escribió el párrafo ---------------------------------------------------------
-- Con sesión (auth.uid() no nulo) es una persona. La función escribe sin sesión
-- (clave de servicio) y pone origin por su cuenta.
create or replace function public.ods_report_blocks_origin()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      if new.origin = 'pilo' then new.origin := 'persona'; end if;
    else
      if new.origin = 'pilo' and old.origin <> 'pilo' then
        new.origin := old.origin;
      end if;
      if old.origin = 'pilo' and new.text is distinct from old.text then
        new.origin := 'editado';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists ods_report_blocks_origin on public.ods_report_blocks;
create trigger ods_report_blocks_origin before insert or update on public.ods_report_blocks
  for each row execute function public.ods_report_blocks_origin();

create or replace function public.ods_reports_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists ods_reports_touch on public.ods_reports;
create trigger ods_reports_touch before update on public.ods_reports
  for each row execute function public.ods_reports_touch();
drop trigger if exists ods_report_photos_touch on public.ods_report_photos;
create trigger ods_report_photos_touch before update on public.ods_report_photos
  for each row execute function public.ods_reports_touch();
drop trigger if exists ods_report_indicators_touch on public.ods_report_indicators;
create trigger ods_report_indicators_touch before update on public.ods_report_indicators
  for each row execute function public.ods_reports_touch();

-- RLS --------------------------------------------------------------------------------
alter table public.ods_reports           enable row level security;
alter table public.ods_report_blocks     enable row level security;
alter table public.ods_report_photos     enable row level security;
alter table public.ods_report_indicators enable row level security;

do $$
declare t text;
begin
  foreach t in array array['ods_reports','ods_report_blocks','ods_report_photos','ods_report_indicators'] loop
    execute format('drop policy if exists %I on public.%I', t || '_planeacion', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (public.has_role_at_least('planeacion')) with check (public.has_role_at_least('planeacion'))$p$, t || '_planeacion', t);
    execute format('revoke all on public.%I from public, anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end $$;

-- El público: solo lo de informes publicados.
drop policy if exists ods_reports_publico on public.ods_reports;
create policy ods_reports_publico on public.ods_reports for select to anon, authenticated
  using (state = 'publicado');

drop policy if exists ods_report_blocks_publico on public.ods_report_blocks;
create policy ods_report_blocks_publico on public.ods_report_blocks for select to anon, authenticated
  using (enabled and not spare and exists (select 1 from public.ods_reports r where r.id = report_id and r.state = 'publicado'));

drop policy if exists ods_report_photos_publico on public.ods_report_photos;
create policy ods_report_photos_publico on public.ods_report_photos for select to anon, authenticated
  using (use and (not minors or cleared) and exists (select 1 from public.ods_reports r where r.id = report_id and r.state = 'publicado'));

drop policy if exists ods_report_indicators_publico on public.ods_report_indicators;
create policy ods_report_indicators_publico on public.ods_report_indicators for select to anon, authenticated
  using (approved and exists (select 1 from public.ods_reports r where r.id = report_id and r.state = 'publicado'));

-- Columnas que ve el público: nunca orig, warn, updated_by, candidates, ask ni settings.
grant select (id, ods, edition, state, updated_at) on public.ods_reports to anon;
grant select (id, report_id, sec, pos, origin, text, sources, figs, enabled, spare, updated_at) on public.ods_report_blocks to anon;
grant select (report_id, news_id, use, slot, caption, alt, credit, kind, minors, cleared, crop) on public.ods_report_photos to anon;
grant select (report_id, indicator, news_id, page_es, page_en, approved, updated_at) on public.ods_report_indicators to anon;

-- La página de evidencia -------------------------------------------------------------
-- Una fila: la nota elegida para el indicador en el informe publicado más
-- reciente del ODS, con sus frases y su texto en inglés. La imagen, solo si la
-- foto está en uso y se puede publicar (sin menores o con autorización).
-- 0146 cambia lo que devuelve: se borra antes para poder volver a aplicar esta migración.
drop function if exists public.ods_evidencia(int, text);
create or replace function public.ods_evidencia(p_ods int, p_indicator text)
returns table (
  indicator    text,
  ods          int,
  edition      int,
  title        text,
  published_on date,
  section      text,
  campus       text,
  image_url    text,
  url          text,
  page_es      jsonb,
  page_en      text
)
language sql
stable
security definer
set search_path = public
as $$
  select e.indicator, r.ods::int, r.edition, n.title, n.published_on, n.section, n.campus,
         case when exists (
           select 1 from public.ods_report_photos f
            where f.report_id = r.id and f.news_id = n.id and f.use and (not f.minors or f.cleared)
         ) then n.image_url else null end,
         n.url, e.page_es, e.page_en
    from public.ods_report_indicators e
    join public.ods_reports r on r.id = e.report_id
    join public.news_items n on n.id = e.news_id
   where r.ods = p_ods
     and r.state = 'publicado'
     and e.indicator = p_indicator
     and e.approved
     and n.state = 'ok'
   order by r.edition desc
   limit 1;
$$;

revoke all on function public.ods_evidencia(int, text) from public;
grant execute on function public.ods_evidencia(int, text) to anon, authenticated, service_role;
