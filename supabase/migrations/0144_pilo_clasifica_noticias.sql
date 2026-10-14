-- =============================================================================
-- 0144 · Mr. Pilo lee y clasifica las noticias del recolector (0143).
--
-- El léxico de `noticias-ods` sigue siendo el primer filtro, sin IA: una nota
-- con alguna coincidencia queda en la fila de Pilo (ai_status = 'pendiente');
-- una sin ninguna va a «no» sin gastar IA. La función `noticias-pilo` toma unas
-- pocas notas por llamada, se las da al proveedor de Mr. Pilo (el mismo de
-- pilo-ia, leído de pilo_ai_settings / pilo_ai_secret) y guarda su propuesta.
--
--   news_items   + ai_status   'none' (no se le pide a Pilo) | 'pendiente' |
--                              'hecho' | 'error'
--                + ai_decision 'aprobar' | 'revisar' | 'descartar'
--                + ai_summary  extracto fiel de ≤ 40 palabras que escribió Pilo
--                + ai_confidence 0 a 100 (la de la decisión)
--                + ai_error    por qué falló la lectura (sin claves ni detalles)
--                + ai_at       cuándo la leyó
--                + decided_by  quién dejó el estado: 'persona' | 'pilo' | null
--   news_ods     + indicator   el indicador de THE que Pilo reconoce (p. ej. «13.2»)
--                + by_ai       la fila la propuso Pilo
--   news_settings una sola fila: pilo_aprueba (por defecto false) y umbral
--                (por defecto 85). Con pilo_aprueba, Pilo aprueba (o descarta)
--                lo claro con confianza ≥ umbral; lo demás queda «pending».
--
-- Lo que decide una persona nunca lo pisa Pilo: el disparador marca
-- decided_by = 'persona' cuando alguien con sesión cambia el estado (y lo deja
-- en null si lo devuelve a «pending»); la función solo cambia el estado de
-- notas sin reviewed_by y en «pending» o decididas por Pilo. Los ODS que
-- agregó una persona (manual = true) no se tocan.
--
-- Quién puede qué:
--   · Planeación y la administración leen y escriben news_settings; el
--     público, nada.
--   · El público (anon) sigue leyendo de news_items solo la lista cerrada de
--     columnas de 0143: ninguna columna ai_* ni decided_by.
-- Todo UPDATE y DELETE lleva WHERE (safeupdate, ver 0095). Idempotente.
-- Requiere 0143.
-- =============================================================================

alter table public.news_items add column if not exists ai_status     text not null default 'none';
alter table public.news_items add column if not exists ai_decision   text;
alter table public.news_items add column if not exists ai_summary    text;
alter table public.news_items add column if not exists ai_confidence smallint;
alter table public.news_items add column if not exists ai_error      text;
alter table public.news_items add column if not exists ai_at         timestamptz;
alter table public.news_items add column if not exists decided_by    text;

alter table public.news_items drop constraint if exists news_items_ai_status;
alter table public.news_items add constraint news_items_ai_status check (ai_status in ('none', 'pendiente', 'hecho', 'error'));
alter table public.news_items drop constraint if exists news_items_ai_decision;
alter table public.news_items add constraint news_items_ai_decision check (ai_decision is null or ai_decision in ('aprobar', 'revisar', 'descartar'));
alter table public.news_items drop constraint if exists news_items_ai_confidence;
alter table public.news_items add constraint news_items_ai_confidence check (ai_confidence is null or ai_confidence between 0 and 100);
alter table public.news_items drop constraint if exists news_items_decided_by;
alter table public.news_items add constraint news_items_decided_by check (decided_by is null or decided_by in ('persona', 'pilo'));

create index if not exists news_items_ai_status_idx on public.news_items (ai_status, created_at);

alter table public.news_ods add column if not exists indicator text;
alter table public.news_ods add column if not exists by_ai     boolean not null default false;
alter table public.news_ods drop constraint if exists news_ods_indicator;
alter table public.news_ods add constraint news_ods_indicator check (indicator is null or indicator ~ '^[0-9]{1,2}\.[0-9a-z]{1,3}$');

-- Lo ya decidido antes de 0144: lo que tiene reviewed_by lo decidió una persona.
update public.news_items set decided_by = 'persona'
  where decided_by is null and reviewed_by is not null and state <> 'pending';

comment on column public.news_items.ai_status is
  'Lectura de Mr. Pilo (0144): none (no se le pide), pendiente, hecho o error.';
comment on column public.news_items.decided_by is
  'Quién dejó el estado actual: persona, pilo o null (nadie aún). Lo de una persona Pilo no lo cambia.';

-- Quién decidió --------------------------------------------------------------------
-- Con sesión (auth.uid() no nulo) es una persona; la función escribe con la clave
-- de servicio, sin sesión, y pone decided_by por su cuenta.
create or replace function public.news_items_decided_by()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.state is distinct from old.state and auth.uid() is not null then
    new.decided_by := case when new.state = 'pending' then null else 'persona' end;
  end if;
  return new;
end;
$$;

drop trigger if exists news_items_decided_by on public.news_items;
create trigger news_items_decided_by before update of state on public.news_items
  for each row execute function public.news_items_decided_by();

-- Ajustes ----------------------------------------------------------------------------
create table if not exists public.news_settings (
  id           smallint primary key default 1,
  pilo_aprueba boolean not null default false,
  umbral       smallint not null default 85,
  updated_by   uuid references public.profiles (id) on delete set null,
  updated_at   timestamptz not null default now(),
  constraint news_settings_single check (id = 1),
  constraint news_settings_umbral check (umbral between 50 and 100)
);

insert into public.news_settings (id) values (1) on conflict (id) do nothing;

comment on table public.news_settings is
  'Recolector de noticias (0144): si Mr. Pilo aprueba lo claro y desde qué confianza. Solo Planeación y la administración.';

alter table public.news_settings enable row level security;

drop policy if exists news_settings_planeacion on public.news_settings;
create policy news_settings_planeacion on public.news_settings for all to authenticated
  using (public.has_role_at_least('planeacion')) with check (public.has_role_at_least('planeacion'));

revoke all on public.news_settings from public, anon;
grant select, update on public.news_settings to authenticated;
grant all on public.news_settings to service_role;

-- El público: la misma lista cerrada de 0143, sin las columnas nuevas.
revoke select on public.news_items from anon;
grant select (id, url, title, excerpt, image_url, published_on, section, campus, state) on public.news_items to anon;
