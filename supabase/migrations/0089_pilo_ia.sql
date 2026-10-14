-- =============================================================================
-- 0089 · Mr. Pilo con IA: voz avanzada, resumir y sintetizar.
--
-- La administración configura la conexión con el proveedor (Free.ai, con el
-- formato de OpenAI: /chat/completions y /audio/speech), qué funciones hay y
-- en qué portal aparece Mr. Pilo y para quién. Las llamadas al proveedor las
-- hace la función del servidor `pilo-ia`; el navegador nunca ve la clave.
-- (0090 agrega Mistral y separa la conexión de voz.)
--
--   pilo_ai_settings  una sola fila: conexión, funciones, portales, voz, límites
--   pilo_ai_secret    la clave del proveedor; nadie la lee desde el cliente
--   pilo_ai_log       bitácora de pedidos (la escribe la función del servidor)
--   pilo_ai_cache     resúmenes guardados mientras las cifras no cambien
--
--   pilo_ai_public_config()  lo mínimo para pintar a Pilo: sin URL ni modelos
--   pilo_ai_set_key(text)    guarda la clave; devuelve sus 4 últimos caracteres
--   pilo_ai_key_status()     si hay clave y cuándo se cambió
-- =============================================================================

create table if not exists public.pilo_ai_settings (
  id            smallint primary key default 1,
  enabled       boolean not null default false,
  base_url      text not null default '',
  chat_path     text not null default '/chat/completions',
  speech_path   text not null default '/audio/speech',
  text_model    text not null default '',
  speech_model  text not null default '',
  speech_voice  text not null default '',
  voice_engine  text not null default 'proveedor',
  voice_rate    numeric not null default 1,
  voice_pitch   numeric not null default 1,
  functions     jsonb not null default '{"leer": true, "resumir": true, "sintetizar": true, "explicar": true}'::jsonb,
  portals       jsonb not null default '{
    "cifras": {"on": true, "aud": "admin", "fns": ["leer", "resumir", "sintetizar", "explicar"]},
    "pdi": {"on": false, "aud": "admin", "fns": ["leer", "resumir"]},
    "observatorio": {"on": false, "aud": "admin", "fns": ["leer", "resumir"]},
    "impacto": {"on": false, "aud": "admin", "fns": ["leer", "sintetizar", "explicar"]}
  }'::jsonb,
  daily_limit   integer not null default 200,
  max_rows      integer not null default 500,
  cache_days    integer not null default 30,
  updated_by    uuid references public.profiles (id) on delete set null,
  updated_at    timestamptz not null default now(),
  constraint pilo_ai_settings_single check (id = 1),
  constraint pilo_ai_settings_engine check (voice_engine in ('proveedor', 'navegador')),
  constraint pilo_ai_settings_url check (base_url = '' or base_url ~* '^https://'),
  constraint pilo_ai_settings_rate check (voice_rate between 0.5 and 2),
  constraint pilo_ai_settings_pitch check (voice_pitch between 0.3 and 1.5),
  constraint pilo_ai_settings_limits check (daily_limit between 0 and 100000 and max_rows between 10 and 5000 and cache_days between 0 and 365)
);

insert into public.pilo_ai_settings (id) values (1) on conflict (id) do nothing;

comment on table public.pilo_ai_settings is
  'Mr. Pilo con IA: conexión con el proveedor, funciones, portales y audiencia, voz y límites. Solo la administración la lee y la cambia.';

alter table public.pilo_ai_settings enable row level security;

drop policy if exists pilo_ai_settings_admin on public.pilo_ai_settings;
create policy pilo_ai_settings_admin on public.pilo_ai_settings
  for all to authenticated
  using (public.has_role_at_least('admin'))
  with check (public.has_role_at_least('admin'));

grant select, update on public.pilo_ai_settings to authenticated;

-- La clave: sin políticas, así que solo la ven las funciones definer y el
-- rol de servicio (la función del servidor).
create table if not exists public.pilo_ai_secret (
  id          smallint primary key default 1,
  api_key     text not null default '',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint pilo_ai_secret_single check (id = 1)
);

insert into public.pilo_ai_secret (id) values (1) on conflict (id) do nothing;
alter table public.pilo_ai_secret enable row level security;
revoke all on public.pilo_ai_secret from anon, authenticated;

create table if not exists public.pilo_ai_log (
  id          bigint generated always as identity primary key,
  created_at  timestamptz not null default now(),
  profile_id  uuid references public.profiles (id) on delete set null,
  portal      text not null default '',
  action      text not null,
  subject     text not null default '',
  status      text not null,
  cached      boolean not null default false,
  ms          integer
);

create index if not exists pilo_ai_log_created_idx on public.pilo_ai_log (created_at desc);

alter table public.pilo_ai_log enable row level security;

drop policy if exists pilo_ai_log_admin on public.pilo_ai_log;
create policy pilo_ai_log_admin on public.pilo_ai_log
  for select to authenticated
  using (public.has_role_at_least('admin'));

grant select on public.pilo_ai_log to authenticated;

create table if not exists public.pilo_ai_cache (
  key         text primary key,
  result      jsonb not null,
  created_at  timestamptz not null default now()
);

alter table public.pilo_ai_cache enable row level security;
revoke all on public.pilo_ai_cache from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Lo que el portal necesita para decidir si pinta a Mr. Pilo.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_ai_public_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', s.enabled and s.base_url <> '' and k.api_key <> '',
    'functions', s.functions,
    'portals', s.portals,
    'voice_engine', s.voice_engine,
    'voice_rate', s.voice_rate,
    'voice_pitch', s.voice_pitch
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_secret k
  where s.id = 1 and k.id = 1;
$$;

comment on function public.pilo_ai_public_config() is
  'Mr. Pilo con IA: si está encendido y dónde. No devuelve la URL, los modelos ni la clave.';

revoke all on function public.pilo_ai_public_config() from public;
grant execute on function public.pilo_ai_public_config() to anon, authenticated;

create or replace function public.pilo_ai_set_key(p_key text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(p_key, ''));
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cambia la clave de Mr. Pilo.' using errcode = '42501';
  end if;
  update public.pilo_ai_secret set api_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
  return case when clean = '' then '' else right(clean, 4) end;
end;
$$;

revoke all on function public.pilo_ai_set_key(text) from public;
grant execute on function public.pilo_ai_set_key(text) to authenticated;

create or replace function public.pilo_ai_key_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  secret public.pilo_ai_secret;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve el estado de la clave.' using errcode = '42501';
  end if;
  select * into secret from public.pilo_ai_secret where id = 1;
  return jsonb_build_object(
    'has_key', secret.api_key <> '',
    'last4', case when secret.api_key = '' then '' else right(secret.api_key, 4) end,
    'updated_at', secret.updated_at,
    'today', (select count(*) from public.pilo_ai_log where created_at >= date_trunc('day', now()) and not cached)
  );
end;
$$;

revoke all on function public.pilo_ai_key_status() from public;
grant execute on function public.pilo_ai_key_status() to authenticated;
