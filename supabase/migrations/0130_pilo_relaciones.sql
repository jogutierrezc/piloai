-- =============================================================================
-- 0130 · Mr. Pilo: relaciones en el pedido, premisas de las capciosas y
--        análisis antes de responder.
--
-- Tres piezas, cada una con su interruptor y las tres APAGADAS de partida: sin
-- encenderlas, Pilo pide y responde exactamente como hasta 0129.
--
--   1. Relaciones en el pedido
--        Un bloque más para el modelo, [RELACIONES], con las conexiones que YA
--        existen en la base para las fuentes de esa pregunta (pilo_edges, los
--        puentes aprobados, el catálogo). No se guarda nada nuevo: aquí solo
--        van su interruptor y sus topes.
--
--   2. Las premisas de las capciosas
--        El razonamiento pesado se hace antes, una vez, y queda guardado y
--        revisado: para cada capciosa del catálogo, la premisa que la pregunta
--        da por cierta y lo que es cierto. La IA lo PROPONE; la administración
--        lo edita y lo APRUEBA. Solo lo aprobado llega al pedido.
--
--        pilo_catalog_premises      una fila por capciosa. Tabla aparte, no
--                                   columnas de pilo_catalog: así editar una
--                                   premisa no toca `updated_at` (el vector de
--                                   la entrada sigue vigente), no dispara el
--                                   paso del catálogo a la memoria (0126) y un
--                                   libro de Excel importado no la pisa.
--        pilo_premises_pending      las capciosas activas de un Pilo que aún no
--                                   tienen fila (lo que la IA debe revisar).
--        pilo_premises_propose      la función pilo-ia deja lo que propuso la
--                                   IA. Nunca pisa una fila que ya existe.
--        pilo_premise_save          la administración la escribe, la corrige o
--                                   la aprueba.
--        pilo_premise_clear         la administración la borra (la IA puede
--                                   volver a proponerla).
--        pilo_premises_active       lo APROBADO que un Pilo puede usar: las de
--                                   sus capciosas activas y las de las
--                                   compartidas (0126), ni una más. Es la misma
--                                   regla de pilo_catalog_active: no abre
--                                   ningún camino nuevo entre ámbitos.
--        pilo_premises_status       cuántas hay, propuestas y aprobadas.
--
--        Si la capciosa cambia (su tema, sus disparadores o su respuesta), lo
--        aprobado vuelve a «propuesta»: hay que mirarlo otra vez.
--
--   3. Análisis antes de responder
--        Solo su interruptor. El análisis no se guarda en ninguna tabla.
--
-- Los interruptores y los topes van en pilo_ai_settings (el Pilo de siempre) y
-- en pilo_spaces (cada uno de los otros), con los mismos nombres.
--
-- Todo UPDATE y DELETE lleva WHERE (safeupdate, ver 0095). Requiere 0126.
-- Idempotente. No toca ninguna fila existente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Los interruptores y los topes, por Pilo. Todo nace apagado.
-- -----------------------------------------------------------------------------

alter table public.pilo_ai_settings add column if not exists ask_relations boolean not null default false;
alter table public.pilo_ai_settings add column if not exists ask_relations_lines integer not null default 12;
alter table public.pilo_ai_settings add column if not exists ask_relations_chars integer not null default 1200;
alter table public.pilo_ai_settings add column if not exists tricky_near boolean not null default false;
alter table public.pilo_ai_settings add column if not exists tricky_near_min real not null default 0.7;
alter table public.pilo_ai_settings add column if not exists ask_analysis boolean not null default false;

comment on column public.pilo_ai_settings.ask_relations is 'Preguntar (0130): el pedido lleva el bloque [RELACIONES] con las conexiones que ya hay en la base para las fuentes de esa pregunta.';
comment on column public.pilo_ai_settings.ask_relations_lines is 'Preguntar (0130): cuántas líneas caben, como mucho, en [RELACIONES].';
comment on column public.pilo_ai_settings.ask_relations_chars is 'Preguntar (0130): cuántos caracteres caben, como mucho, en [RELACIONES]. Se descuentan del contexto.';
comment on column public.pilo_ai_settings.tricky_near is 'Preguntar (0130): una pregunta que se parece por significado a una capciosa, sin dispararla, va al modelo con esa capciosa como regla.';
comment on column public.pilo_ai_settings.tricky_near_min is 'Preguntar (0130): desde qué parecido (coseno) una pregunta cuenta como casi capciosa.';
comment on column public.pilo_ai_settings.ask_analysis is 'Preguntar (0130): cuando hay señales y ninguna relación aprobada, el modelo analiza en tres frases antes de responder. El análisis no llega a quien pregunta.';

alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_reason;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_reason check (
  ask_relations_lines between 1 and 40
  and ask_relations_chars between 200 and 4000
  and tricky_near_min between 0.5 and 0.99
);

alter table public.pilo_spaces add column if not exists ask_relations boolean not null default false;
alter table public.pilo_spaces add column if not exists ask_relations_lines integer not null default 12;
alter table public.pilo_spaces add column if not exists ask_relations_chars integer not null default 1200;
alter table public.pilo_spaces add column if not exists tricky_near boolean not null default false;
alter table public.pilo_spaces add column if not exists tricky_near_min real not null default 0.7;
alter table public.pilo_spaces add column if not exists ask_analysis boolean not null default false;

comment on column public.pilo_spaces.ask_relations is 'Como pilo_ai_settings.ask_relations (0130), para este Pilo.';
comment on column public.pilo_spaces.tricky_near is 'Como pilo_ai_settings.tricky_near (0130), para este Pilo.';
comment on column public.pilo_spaces.ask_analysis is 'Como pilo_ai_settings.ask_analysis (0130), para este Pilo.';

alter table public.pilo_spaces drop constraint if exists pilo_spaces_reason;
alter table public.pilo_spaces add constraint pilo_spaces_reason check (
  ask_relations_lines between 1 and 40
  and ask_relations_chars between 200 and 4000
  and tricky_near_min between 0.5 and 0.99
);

-- -----------------------------------------------------------------------------
-- Las premisas de las capciosas.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_catalog_premises (
  key          text primary key references public.pilo_catalog (key) on update cascade on delete cascade,
  premise      text not null default '',
  truth        text not null default '',
  status       text not null default 'propuesta',
  origin       text not null default 'ia',
  proposed_at  timestamptz not null default now(),
  reviewed_by  uuid references public.profiles (id) on delete set null,
  reviewed_at  timestamptz,
  updated_at   timestamptz not null default now(),
  constraint pilo_catalog_premises_status check (status in ('propuesta', 'aprobada')),
  constraint pilo_catalog_premises_origin check (origin in ('ia', 'admin')),
  constraint pilo_catalog_premises_len check (length(premise) <= 400 and length(truth) <= 600),
  constraint pilo_catalog_premises_approved check (
    status <> 'aprobada' or (length(btrim(premise)) >= 8 and length(btrim(truth)) >= 8 and reviewed_at is not null)
  )
);

create index if not exists pilo_catalog_premises_status_idx on public.pilo_catalog_premises (status);

comment on table public.pilo_catalog_premises is
  'Mr. Pilo: lo que cada capciosa del catálogo da por cierto y lo que es cierto (0130). Lo propone la IA y lo aprueba la administración; solo lo aprobado llega al pedido. Es del Pilo dueño de la capciosa. Se escribe por pilo_premises_propose, pilo_premise_save y pilo_premise_clear.';
comment on column public.pilo_catalog_premises.premise is 'La premisa que la pregunta capciosa da por cierta.';
comment on column public.pilo_catalog_premises.truth is 'Lo que es cierto: la corrección de esa premisa.';
comment on column public.pilo_catalog_premises.status is '«propuesta» (de la IA o a medio escribir) o «aprobada» (revisada por la administración). Solo la aprobada se usa al responder.';
comment on column public.pilo_catalog_premises.origin is 'Quién escribió el texto que hay: «ia» o «admin».';

alter table public.pilo_catalog_premises enable row level security;

drop policy if exists pilo_catalog_premises_admin on public.pilo_catalog_premises;
create policy pilo_catalog_premises_admin on public.pilo_catalog_premises
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_catalog_premises from public, anon, authenticated;
grant select on public.pilo_catalog_premises to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Si la capciosa cambia, lo aprobado se revisa otra vez. Si deja de ser
-- capciosa, su premisa sobra.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_catalog_premises_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind <> 'capciosa' then
    delete from public.pilo_catalog_premises x where x.key = new.key;
  elsif (old.question, old.triggers, old.answer) is distinct from (new.question, new.triggers, new.answer) then
    update public.pilo_catalog_premises x
    set status = 'propuesta', reviewed_by = null, reviewed_at = null, updated_at = now()
    where x.key = new.key and x.status = 'aprobada';
  end if;
  return null;
end;
$$;

revoke all on function public.pilo_catalog_premises_trigger() from public, anon, authenticated;

drop trigger if exists pilo_catalog_premises_review on public.pilo_catalog;
create trigger pilo_catalog_premises_review
  after update of kind, question, triggers, answer on public.pilo_catalog
  for each row execute function public.pilo_catalog_premises_trigger();

-- -----------------------------------------------------------------------------
-- Lo que falta por revisar: las capciosas activas de ESE Pilo sin fila. Las
-- compartidas por otro Pilo no: su premisa es del Pilo que las escribió.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_premises_pending(p_space text default 'planeacion', p_limit integer default 8)
returns table (key text, question text, triggers text[], answer text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración revisan las capciosas.' using errcode = '42501';
  end if;
  return query
    select c.key, c.question, c.triggers, c.answer
    from public.pilo_catalog c
    where c.kind = 'capciosa' and c.active and c.space = coalesce(p_space, 'planeacion')
      and not exists (select 1 from public.pilo_catalog_premises x where x.key = c.key)
    order by c.key
    limit greatest(1, least(coalesce(p_limit, 8), 40));
end;
$$;

revoke all on function public.pilo_premises_pending(text, integer) from public, anon;
grant execute on function public.pilo_premises_pending(text, integer) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Lo que propuso la IA. La llama la función pilo-ia con la clave de servicio,
-- después de comprobar que quien lo pidió es de la administración. Cada fila es
-- { key, premise, truth }; una capciosa en la que la IA no halló premisa llega
-- con los dos textos vacíos y queda anotada igual, para no preguntarla otra vez.
-- Solo capciosas de ese Pilo, y nunca sobre una fila que ya existe: lo que la
-- administración escribió o aprobó no se pisa.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_premises_propose(p_space text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_space, 'planeacion');
  v_added integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo anota lo que la IA propone para las capciosas.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;

  with incoming as (
    select distinct on (btrim(r->>'key'))
      btrim(r->>'key') as key,
      left(btrim(coalesce(r->>'premise', '')), 400) as premise,
      left(btrim(coalesce(r->>'truth', '')), 600) as truth
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where jsonb_typeof(r) = 'object' and btrim(coalesce(r->>'key', '')) <> ''
  ),
  written as (
    insert into public.pilo_catalog_premises (key, premise, truth, status, origin)
    select i.key,
           case when i.premise <> '' and i.truth <> '' then i.premise else '' end,
           case when i.premise <> '' and i.truth <> '' then i.truth else '' end,
           'propuesta', 'ia'
    from incoming i
    join public.pilo_catalog c on c.key = i.key and c.kind = 'capciosa' and c.space = v_space
    on conflict (key) do nothing
    returning 1
  )
  select count(*) into v_added from written;
  return v_added;
end;
$$;

revoke all on function public.pilo_premises_propose(text, jsonb) from public, anon, authenticated;
grant execute on function public.pilo_premises_propose(text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- La administración la escribe, la corrige o la aprueba. Aprobar pide los dos
-- textos. Guardar sin aprobar la deja (o la devuelve) en «propuesta».
-- -----------------------------------------------------------------------------

create or replace function public.pilo_premise_save(p_key text, p_premise text, p_truth text, p_approve boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_key text := btrim(coalesce(p_key, ''));
  v_premise text := btrim(regexp_replace(coalesce(p_premise, ''), '\s+', ' ', 'g'));
  v_truth text := btrim(regexp_replace(coalesce(p_truth, ''), '\s+', ' ', 'g'));
  v_approve boolean := coalesce(p_approve, false);
  v_kind text;
  v_row public.pilo_catalog_premises;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración revisa las capciosas de Pilo.' using errcode = '42501';
  end if;
  select c.kind into v_kind from public.pilo_catalog c where c.key = v_key;
  if v_kind is null then
    raise exception 'Esa entrada del catálogo no existe.' using errcode = '22023';
  end if;
  if v_kind <> 'capciosa' then
    raise exception 'La entrada % no es una capciosa.', v_key using errcode = '22023';
  end if;
  if length(v_premise) > 400 or length(v_truth) > 600 then
    raise exception 'La premisa admite 400 caracteres y lo cierto, 600.' using errcode = '22023';
  end if;
  if v_approve and (length(v_premise) < 8 or length(v_truth) < 8) then
    raise exception 'Para aprobar hacen falta la premisa y lo que es cierto.' using errcode = '22023';
  end if;

  insert into public.pilo_catalog_premises as x (key, premise, truth, status, origin, reviewed_by, reviewed_at, updated_at)
  values (
    v_key, v_premise, v_truth,
    case when v_approve then 'aprobada' else 'propuesta' end,
    'admin',
    case when v_approve then auth.uid() end,
    case when v_approve then now() end,
    now()
  )
  on conflict (key) do update set
    premise = excluded.premise,
    truth = excluded.truth,
    status = excluded.status,
    -- Aprobar tal cual lo que propuso la IA no cambia quién lo escribió.
    origin = case when (x.premise, x.truth) is distinct from (excluded.premise, excluded.truth) then 'admin' else x.origin end,
    reviewed_by = excluded.reviewed_by,
    reviewed_at = excluded.reviewed_at,
    updated_at = now()
  returning * into v_row;
  return jsonb_build_object('key', v_row.key, 'status', v_row.status, 'origin', v_row.origin);
end;
$$;

revoke all on function public.pilo_premise_save(text, text, text, boolean) from public, anon;
grant execute on function public.pilo_premise_save(text, text, text, boolean) to authenticated;

create or replace function public.pilo_premise_clear(p_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración revisa las capciosas de Pilo.' using errcode = '42501';
  end if;
  delete from public.pilo_catalog_premises x where x.key = btrim(coalesce(p_key, ''));
end;
$$;

revoke all on function public.pilo_premise_clear(text) from public, anon;
grant execute on function public.pilo_premise_clear(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Lo que se usa al responder: solo lo APROBADO, y solo de las capciosas que ese
-- Pilo ya lee (las suyas activas y las compartidas, como pilo_catalog_active).
-- -----------------------------------------------------------------------------

create or replace function public.pilo_premises_active(p_space text default 'planeacion')
returns table (key text, premise text, truth text)
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
    select x.key, x.premise, x.truth
    from public.pilo_catalog_premises x
    join public.pilo_catalog c on c.key = x.key
    where x.status = 'aprobada' and c.kind = 'capciosa' and c.active
      and (c.space = coalesce(p_space, 'planeacion') or c.shared)
    order by x.key;
end;
$$;

revoke all on function public.pilo_premises_active(text) from public, anon;
grant execute on function public.pilo_premises_active(text) to authenticated, service_role;

create or replace function public.pilo_premises_status(p_space text default 'planeacion')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_out jsonb;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración revisan las capciosas.' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'total', count(*),
    'pending', count(*) filter (where x.key is null),
    'proposed', count(*) filter (where x.status = 'propuesta'),
    'approved', count(*) filter (where x.status = 'aprobada')
  )
  into v_out
  from public.pilo_catalog c
  left join public.pilo_catalog_premises x on x.key = c.key
  where c.kind = 'capciosa' and c.active and c.space = coalesce(p_space, 'planeacion');
  return v_out;
end;
$$;

revoke all on function public.pilo_premises_status(text) from public, anon;
grant execute on function public.pilo_premises_status(text) to authenticated, service_role;

notify pgrst, 'reload schema';
