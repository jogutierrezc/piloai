-- =============================================================================
-- 0090 · Mr. Pilo con IA: Mistral y una conexión de voz aparte.
--
-- Dos conexiones, las dos con el formato de OpenAI:
--   texto (resumir, sintetizar, explicar): Mistral, Free.ai u otro compatible,
--     por /chat/completions;
--   voz (leer en voz alta): Free.ai u otro con /audio/speech, con su propia
--     dirección y clave (vacías: las de texto). Sin ella, Pilo lee con la voz
--     del navegador.
-- Idempotente: se puede aplicar sobre cualquier versión de 0089.
-- =============================================================================

alter table public.pilo_ai_settings add column if not exists provider text not null default 'mistral';
alter table public.pilo_ai_settings add column if not exists speech_provider text not null default 'navegador';
alter table public.pilo_ai_settings add column if not exists speech_base_url text not null default '';

alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_provider;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_provider check (provider in ('mistral', 'freeai', 'otro'));
alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_speech_provider;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_speech_provider check (speech_provider in ('freeai', 'otro', 'navegador'));
alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_speech_url;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_speech_url check (speech_base_url = '' or speech_base_url ~* '^https://');

-- Mistral de entrada: si aún no hay conexión, se deja lista para pegar la clave.
alter table public.pilo_ai_settings alter column base_url set default 'https://api.mistral.ai/v1';
alter table public.pilo_ai_settings alter column text_model set default 'mistral-small-latest';
alter table public.pilo_ai_settings alter column voice_engine set default 'navegador';
update public.pilo_ai_settings
set base_url = 'https://api.mistral.ai/v1', text_model = 'mistral-small-latest', voice_engine = 'navegador'
where id = 1 and base_url = '' and text_model = '';

alter table public.pilo_ai_secret add column if not exists speech_key text not null default '';

-- -----------------------------------------------------------------------------
-- La configuración pública dice también si hay voz avanzada.
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
    -- La voz avanzada solo si hay con qué: si no, el portal usa la del navegador.
    'speech_ready', s.voice_engine = 'proveedor' and s.speech_provider <> 'navegador'
      and coalesce(nullif(s.speech_base_url, ''), s.base_url) <> ''
      and coalesce(nullif(k.speech_key, ''), k.api_key) <> '' and s.speech_model <> '',
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

-- -----------------------------------------------------------------------------
-- Dos claves: la de texto y la de voz.
-- -----------------------------------------------------------------------------

drop function if exists public.pilo_ai_set_key(text);
create or replace function public.pilo_ai_set_key(p_key text, p_which text default 'texto')
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
  if p_which = 'voz' then
    update public.pilo_ai_secret set speech_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
  elsif p_which = 'texto' then
    update public.pilo_ai_secret set api_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
  else
    raise exception 'La clave es de «texto» o de «voz».';
  end if;
  return case when clean = '' then '' else right(clean, 4) end;
end;
$$;

revoke all on function public.pilo_ai_set_key(text, text) from public;
grant execute on function public.pilo_ai_set_key(text, text) to authenticated;

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
    'has_speech_key', secret.speech_key <> '',
    'speech_last4', case when secret.speech_key = '' then '' else right(secret.speech_key, 4) end,
    'updated_at', secret.updated_at,
    'today', (select count(*) from public.pilo_ai_log where created_at >= date_trunc('day', now()) and not cached)
  );
end;
$$;

revoke all on function public.pilo_ai_key_status() from public;
grant execute on function public.pilo_ai_key_status() to authenticated;

-- Que la API vea las columnas nuevas sin esperar.
notify pgrst, 'reload schema';
