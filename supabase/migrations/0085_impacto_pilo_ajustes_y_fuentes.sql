-- =============================================================================
-- PDI · 0085 · Mr. Pilo: pesos ajustables, fichas obligatorias y fuentes de
--               datos (P1P2P3)
-- =============================================================================
-- 1. imp_pilo_settings: los pesos con que Mr. Pilo puntúa cada ficha (meta por
--    nombre, por dimensión, condiciones CESU/CNA, programas parecidos, cifras
--    ya disponibles…) y qué fichas alimenta cada fuente de datos. Planeación
--    los ajusta sin tocar código; la pantalla los lee al abrir la guía.
--    Los escribe la administración.
--
-- 2. imp_indicators.mandatory: la vicerrectoría marca una ficha como
--    obligatoria y Mr. Pilo la incluye siempre en la propuesta a los
--    programas, sin poder quitarla.
--
-- 3. imp_source_figures: cifras AGREGADAS por programa, sede y periodo que
--    vienen de fuentes institucionales, empezando por los reportes P1P2P3 de
--    notas. El Excel se lee en el navegador y aquí solo llegan conteos y
--    tasas: nunca nombres ni códigos de estudiantes. Mr. Pilo las usa para
--    proponer primero lo que el programa ya puede reportar.
--
-- Requiere 0078 y 0084. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Pesos de Mr. Pilo
-- -----------------------------------------------------------------------------

create table if not exists public.imp_pilo_settings (
  id          smallint primary key default 1,
  weights     jsonb not null default '{}'::jsonb,
  source_map  jsonb not null default '{}'::jsonb,
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint imp_pilo_settings_single check (id = 1)
);

comment on table public.imp_pilo_settings is
  'Pesos del motor de Mr. Pilo y fichas que alimenta cada fuente de datos. Una fila; vacío = los valores de fábrica.';
comment on column public.imp_pilo_settings.source_map is
  'Por fuente, los códigos de ficha que alimenta: {"p1p2p3": ["E04", "E05"]}.';

insert into public.imp_pilo_settings (id, weights, source_map)
values (1, '{}'::jsonb, '{"p1p2p3": ["E03", "E04", "E05", "E10", "E28"]}'::jsonb)
on conflict (id) do nothing;

alter table public.imp_pilo_settings enable row level security;

drop policy if exists imp_pilo_settings_read on public.imp_pilo_settings;
create policy imp_pilo_settings_read on public.imp_pilo_settings
  for select to authenticated using (true);

drop policy if exists imp_pilo_settings_write on public.imp_pilo_settings;
create policy imp_pilo_settings_write on public.imp_pilo_settings
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

grant select, insert, update on public.imp_pilo_settings to authenticated;

drop trigger if exists imp_pilo_settings_set_updated_at on public.imp_pilo_settings;
create trigger imp_pilo_settings_set_updated_at before update on public.imp_pilo_settings
  for each row execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- 2. Fichas obligatorias
-- -----------------------------------------------------------------------------

alter table public.imp_indicators add column if not exists mandatory boolean not null default false;

comment on column public.imp_indicators.mandatory is
  'La vicerrectoría la pide a todos los programas: Mr. Pilo la incluye siempre. Solo fichas institucionales.';

alter table public.imp_indicators drop constraint if exists imp_indicators_mandatory_scope;
alter table public.imp_indicators add constraint imp_indicators_mandatory_scope check (not mandatory or program_id is null);

-- -----------------------------------------------------------------------------
-- 3. Cifras agregadas de fuentes institucionales
-- -----------------------------------------------------------------------------

create table if not exists public.imp_source_figures (
  id             uuid primary key default gen_random_uuid(),
  source         text not null,
  period         text not null,
  year           smallint not null,
  program_id     uuid not null references public.units (id) on delete cascade,
  campus_id      uuid not null references public.campuses (id) on delete cascade,
  students       integer not null default 0,
  enrollments    integer not null default 0,
  approved_rate  numeric,
  average_grade  numeric,
  at_risk_rate   numeric,
  loaded_by      uuid references public.profiles (id) on delete set null,
  loaded_at      timestamptz not null default now(),
  constraint imp_source_figures_unique unique (source, period, program_id, campus_id),
  constraint imp_source_figures_source check (source in ('p1p2p3')),
  constraint imp_source_figures_period check (period ~ '^[0-9]{4}-[12]$'),
  constraint imp_source_figures_rates check (
    (approved_rate is null or approved_rate between 0 and 100)
    and (at_risk_rate is null or at_risk_rate between 0 and 100)
    and (average_grade is null or average_grade between 0 and 5)
  )
);

comment on table public.imp_source_figures is
  'Agregados por programa, sede y periodo de fuentes institucionales (P1P2P3). Sin datos personales: solo conteos y tasas.';
comment on column public.imp_source_figures.approved_rate is
  'Porcentaje de notas acumuladas ≥ 3,0 sobre las que tienen nota.';
comment on column public.imp_source_figures.at_risk_rate is
  'Porcentaje de estudiantes con al menos una materia con P1 < 3,0.';

create index if not exists imp_source_figures_site_idx on public.imp_source_figures (program_id, campus_id);

alter table public.imp_source_figures enable row level security;

-- Las lee el programa en su sede, Planeación y las vicerrectorías (unidades con función).
drop policy if exists imp_source_figures_read on public.imp_source_figures;
create policy imp_source_figures_read on public.imp_source_figures
  for select to authenticated
  using (
    public.imp_can_view_program(program_id, campus_id)
    or public.imp_fn_member('ensenanza', 'visor')
    or public.imp_fn_member('investigacion', 'visor')
    or public.imp_fn_member('extension', 'visor')
  );

drop policy if exists imp_source_figures_write on public.imp_source_figures;
create policy imp_source_figures_write on public.imp_source_figures
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

grant select, insert, update, delete on public.imp_source_figures to authenticated;

notify pgrst, 'reload schema';
