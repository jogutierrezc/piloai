-- =============================================================================
-- PDI · 0083 · Impacto: sincronizar la hoja de Apps Script y Mr. Pilo Bot
-- =============================================================================
-- La herramienta anterior (HTML + Apps Script sobre la hoja
-- «SeguimientoImpacto_UDES») sigue capturando mientras la intranet la
-- reemplaza. La administración trae lo que haya en la hoja con una revisión
-- previa: la pantalla calcula qué cambia y qué no reconoce, y lo aprobado
-- entra aquí de una sola vez, en una transacción.
--
--   · imp_sync_settings    la dirección de la hoja (una fila).
--   · imp_legacy_programs  «BAC-VLL» → programa × sede, recordado entre corridas.
--   · imp_sync_runs        el historial: quién, cuándo y cuánto.
--   · imp_sync_apply()     aplica un lote ya revisado. Solo administración.
--
-- La hoja «Programas» trae una columna «clave» con contraseñas: no hay dónde
-- guardarla aquí, a propósito.
--
-- Mr. Pilo Bot recomienda indicadores a un programa según lo que siguen
-- programas parecidos. Un programa no lee las adopciones de otros (RLS), así
-- que imp_peer_adoptions() entrega solo conteos, nunca quién.
--
-- Requiere 0078. Idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Dónde está la hoja
-- -----------------------------------------------------------------------------

create table if not exists public.imp_sync_settings (
  id          smallint primary key default 1,
  source_url  text not null default '',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint imp_sync_settings_single check (id = 1),
  constraint imp_sync_settings_url check (source_url = '' or source_url ~* '^https://script\.google(usercontent)?\.com/')
);

comment on table public.imp_sync_settings is
  'La implementación de Apps Script de la herramienta anterior. Una sola fila. Solo administración.';

insert into public.imp_sync_settings (id, source_url)
values (1, 'https://script.google.com/macros/s/AKfycbzt3ppkbH2Qj5Ly_otck0zyfirv2fn7dnE9GO1kcAejhvXXryk4tO9TTFCmwWHuvZ73CA/exec')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 2. Los programas de la hoja
-- -----------------------------------------------------------------------------

create table if not exists public.imp_legacy_programs (
  code        text primary key,
  program_id  uuid not null references public.units (id) on delete cascade,
  campus_id   uuid not null references public.campuses (id) on delete cascade,
  name        text not null default '',
  updated_at  timestamptz not null default now()
);

comment on table public.imp_legacy_programs is
  'Código de programa en la hoja anterior («BAC-VLL») y el programa × sede que le corresponde en la intranet.';

-- -----------------------------------------------------------------------------
-- 3. El historial
-- -----------------------------------------------------------------------------

create table if not exists public.imp_sync_runs (
  id          uuid primary key default gen_random_uuid(),
  source_url  text not null default '',
  summary     jsonb not null default '{}'::jsonb,
  run_by      uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now()
);

comment on table public.imp_sync_runs is
  'Cada sincronización aplicada: cuántas fichas, adopciones y cifras entraron, y qué se omitió.';

create index if not exists imp_sync_runs_created_idx on public.imp_sync_runs (created_at desc);

-- -----------------------------------------------------------------------------
-- 4. Permisos: todo esto es de la administración
-- -----------------------------------------------------------------------------

alter table public.imp_sync_settings enable row level security;
alter table public.imp_legacy_programs enable row level security;
alter table public.imp_sync_runs enable row level security;

drop policy if exists imp_sync_settings_admin on public.imp_sync_settings;
create policy imp_sync_settings_admin on public.imp_sync_settings
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

drop policy if exists imp_legacy_programs_admin on public.imp_legacy_programs;
create policy imp_legacy_programs_admin on public.imp_legacy_programs
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

drop policy if exists imp_sync_runs_admin on public.imp_sync_runs;
create policy imp_sync_runs_admin on public.imp_sync_runs
  for select to authenticated
  using (public.has_role_at_least('admin'));

-- Se escribe solo desde imp_sync_apply, que corre con los permisos de quien llama.
drop policy if exists imp_sync_runs_admin_insert on public.imp_sync_runs;
create policy imp_sync_runs_admin_insert on public.imp_sync_runs
  for insert to authenticated
  with check (public.has_role_at_least('admin'));

grant select, insert, update, delete on public.imp_sync_settings, public.imp_legacy_programs to authenticated;
grant select, insert on public.imp_sync_runs to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Aplicar un lote revisado
-- -----------------------------------------------------------------------------
-- p_batch = {
--   source_url, summary,
--   programs:   [{code, program_id, campus_id, name}],
--   indicators: [{code, baseline_text, baseline_num, target_2026, target_2026_num, target_2028, target_2028_num}],
--   adoptions:  [{indicator_code, program_id, campus_id, baseline_text, baseline_num, target_2026, …}],
--   values:     [{indicator_code, year, program_id, campus_id, value_num, value_text, not_applicable, note}]
-- }
-- En fichas y adopciones, un campo que no viene se conserva. Una cifra que
-- viene se escribe entera (la revisión ya decidió que la hoja gana).

create or replace function public.imp_sync_apply(p_batch jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  r jsonb;
  v_ind uuid;
  v_base boolean;
  v_t26 boolean;
  v_t28 boolean;
  n_programs integer := 0;
  n_indicators integer := 0;
  n_adoptions integer := 0;
  n_values integer := 0;
  v_run uuid;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración sincroniza con la hoja anterior.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_batch, '{}'::jsonb)) <> 'object' then
    raise exception 'El lote debe ser un objeto.' using errcode = '22023';
  end if;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'programs', '[]'::jsonb)) loop
    insert into public.imp_legacy_programs (code, program_id, campus_id, name, updated_at)
    values (upper(trim(r ->> 'code')), (r ->> 'program_id')::uuid, (r ->> 'campus_id')::uuid, coalesce(r ->> 'name', ''), now())
    on conflict (code) do update
      set program_id = excluded.program_id, campus_id = excluded.campus_id, name = excluded.name, updated_at = now();
    n_programs := n_programs + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'indicators', '[]'::jsonb)) loop
    update public.imp_indicators i
       set baseline_text   = case when r ? 'baseline_text' then coalesce(r ->> 'baseline_text', '') else i.baseline_text end,
           baseline_num    = case when r ? 'baseline_text' then (r ->> 'baseline_num')::numeric else i.baseline_num end,
           target_2026     = case when r ? 'target_2026' then coalesce(r ->> 'target_2026', '') else i.target_2026 end,
           target_2026_num = case when r ? 'target_2026' then (r ->> 'target_2026_num')::numeric else i.target_2026_num end,
           target_2028     = case when r ? 'target_2028' then coalesce(r ->> 'target_2028', '') else i.target_2028 end,
           target_2028_num = case when r ? 'target_2028' then (r ->> 'target_2028_num')::numeric else i.target_2028_num end
     where i.code = r ->> 'code';
    if found then
      n_indicators := n_indicators + 1;
    end if;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'adoptions', '[]'::jsonb)) loop
    select id into v_ind from public.imp_indicators where code = r ->> 'indicator_code';
    if v_ind is null then
      raise exception 'La ficha % no existe.', r ->> 'indicator_code' using errcode = '23503';
    end if;
    v_base := r ? 'baseline_text';
    v_t26 := r ? 'target_2026';
    v_t28 := r ? 'target_2028';
    update public.imp_adoptions a
       set active          = true,
           baseline_text   = case when v_base then coalesce(r ->> 'baseline_text', '') else a.baseline_text end,
           baseline_num    = case when v_base then (r ->> 'baseline_num')::numeric else a.baseline_num end,
           target_2026     = case when v_t26 then coalesce(r ->> 'target_2026', '') else a.target_2026 end,
           target_2026_num = case when v_t26 then (r ->> 'target_2026_num')::numeric else a.target_2026_num end,
           target_2028     = case when v_t28 then coalesce(r ->> 'target_2028', '') else a.target_2028 end,
           target_2028_num = case when v_t28 then (r ->> 'target_2028_num')::numeric else a.target_2028_num end
     where a.indicator_id = v_ind
       and a.program_id = (r ->> 'program_id')::uuid
       and a.campus_id = (r ->> 'campus_id')::uuid;
    if not found then
      insert into public.imp_adoptions (indicator_id, program_id, campus_id, active,
                                        baseline_text, baseline_num, target_2026, target_2026_num, target_2028, target_2028_num)
      values (v_ind, (r ->> 'program_id')::uuid, (r ->> 'campus_id')::uuid, true,
              coalesce(r ->> 'baseline_text', ''), (r ->> 'baseline_num')::numeric,
              coalesce(r ->> 'target_2026', ''), (r ->> 'target_2026_num')::numeric,
              coalesce(r ->> 'target_2028', ''), (r ->> 'target_2028_num')::numeric);
    end if;
    n_adoptions := n_adoptions + 1;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_batch -> 'values', '[]'::jsonb)) loop
    select id into v_ind from public.imp_indicators where code = r ->> 'indicator_code';
    if v_ind is null then
      raise exception 'La ficha % no existe.', r ->> 'indicator_code' using errcode = '23503';
    end if;
    insert into public.imp_values as v (indicator_id, year, program_id, campus_id, value_num, value_text, not_applicable, note)
    values (v_ind, (r ->> 'year')::smallint, nullif(r ->> 'program_id', '')::uuid, nullif(r ->> 'campus_id', '')::uuid,
            (r ->> 'value_num')::numeric, coalesce(r ->> 'value_text', ''),
            coalesce((r ->> 'not_applicable')::boolean, false), coalesce(r ->> 'note', ''))
    on conflict (indicator_id, year,
                 coalesce(program_id, '00000000-0000-0000-0000-000000000000'::uuid),
                 coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set value_num = excluded.value_num,
                  numerator = null,
                  denominator = null,
                  value_text = excluded.value_text,
                  not_applicable = excluded.not_applicable,
                  note = case when excluded.note = '' then v.note else excluded.note end;
    n_values := n_values + 1;
  end loop;

  insert into public.imp_sync_runs (source_url, summary, run_by)
  values (
    coalesce(p_batch ->> 'source_url', ''),
    coalesce(p_batch -> 'summary', '{}'::jsonb)
      || jsonb_build_object('programas', n_programs, 'fichas', n_indicators, 'adopciones', n_adoptions, 'cifras', n_values),
    auth.uid()
  )
  returning id into v_run;

  return jsonb_build_object('run', v_run, 'programas', n_programs, 'fichas', n_indicators, 'adopciones', n_adoptions, 'cifras', n_values);
end;
$$;

comment on function public.imp_sync_apply(jsonb) is
  'Aplica un lote revisado de la hoja de Apps Script (programas, fichas, adopciones y cifras) y lo anota en imp_sync_runs. Solo administración.';

revoke all on function public.imp_sync_apply(jsonb) from public;
grant execute on function public.imp_sync_apply(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Lo que siguen programas parecidos, en conteos
-- -----------------------------------------------------------------------------
-- «Parecidos»: los de la misma unidad madre (la facultad). Cuenta programa ×
-- sede con al menos una adopción activa, sin contar el que pregunta.

create or replace function public.imp_peer_adoptions(p_program uuid, p_campus uuid)
returns table (indicator_id uuid, peers_faculty integer, total_faculty integer, peers_all integer, total_all integer)
language sql
stable
security definer
set search_path = public
as $$
  with parent as (
    select u.parent_id from public.units u where u.id = p_program
  ),
  sites as (
    select distinct a.program_id, a.campus_id,
           (u.parent_id is not distinct from (select parent_id from parent) and (select parent_id from parent) is not null) as same_faculty
      from public.imp_adoptions a
      join public.units u on u.id = a.program_id
     where a.active
       and not (a.program_id = p_program and a.campus_id = p_campus)
  ),
  totals as (
    select count(*) filter (where same_faculty)::integer as faculty, count(*)::integer as everyone from sites
  )
  select a.indicator_id,
         count(distinct (a.program_id, a.campus_id)) filter (where s.same_faculty)::integer,
         (select faculty from totals),
         count(distinct (a.program_id, a.campus_id))::integer,
         (select everyone from totals)
    from public.imp_adoptions a
    join sites s on s.program_id = a.program_id and s.campus_id = a.campus_id
   where a.active
   group by a.indicator_id;
$$;

comment on function public.imp_peer_adoptions(uuid, uuid) is
  'Para Mr. Pilo Bot: cuántos programas × sede de la misma facultad (y de toda la UDES) siguen cada indicador. Solo conteos.';

revoke all on function public.imp_peer_adoptions(uuid, uuid) from public;
grant execute on function public.imp_peer_adoptions(uuid, uuid) to authenticated;

notify pgrst, 'reload schema';
