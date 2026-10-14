-- =============================================================================
-- 0102 · Mr. Pilo con IA: la voz de Pilo con Fish Audio.
--
-- Fish Audio clona la voz a partir de las mismas muestras de 0101: con un
-- botón, cada estilo crea su voz en Fish Audio y guarda su id (fish_id, dentro
-- de voice_styles) y su tono («calm», «excited»…), que Fish Audio entiende
-- como etiqueta al empezar cada frase.
--
--   speech_provider   ahora también 'fishaudio'.
--   fish_model        el modelo de Fish Audio (s2.1-pro-free: gratis hasta
--                     el 30 de noviembre de 2026, con uso razonable).
--   fishaudio_key     su clave, aparte de las demás.
--
-- Lo ya leído se guarda en MP3 en pilo-voz/cache/. Requiere 0101. Idempotente.
-- =============================================================================

alter table public.pilo_ai_secret add column if not exists fishaudio_key text not null default '';
alter table public.pilo_ai_settings add column if not exists fish_model text not null default 's2.1-pro-free';

alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_speech_provider;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_speech_provider
  check (speech_provider in ('freeai', 'nvidia', 'fishaudio', 'otro', 'navegador'));
alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_fish_model;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_fish_model check (fish_model ~ '^[a-z0-9][a-z0-9.-]{0,39}$');

comment on column public.pilo_ai_secret.api_key is 'En desuso desde 0091: cada proveedor tiene su columna (mistral_key, freeai_key, nvidia_key, fishaudio_key, otro_key).';

-- -----------------------------------------------------------------------------
-- La clave de la voz: con Fish Audio, la de Fish Audio.
-- -----------------------------------------------------------------------------
create or replace function public.pilo_ai_keys_in_use(out text_key text, out speech_key text)
language sql
stable
security definer
set search_path = public
as $$
  select
    case s.provider when 'mistral' then k.mistral_key when 'freeai' then k.freeai_key when 'nvidia' then k.nvidia_key else k.otro_key end,
    coalesce(
      nullif(k.speech_key, ''),
      nullif(
        case s.speech_provider
          when 'freeai' then k.freeai_key
          when 'nvidia' then k.nvidia_key
          when 'fishaudio' then k.fishaudio_key
          when 'otro' then k.otro_key
          else ''
        end,
        ''
      ),
      case s.provider when 'mistral' then k.mistral_key when 'freeai' then k.freeai_key when 'nvidia' then k.nvidia_key else k.otro_key end
    )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_secret k
  where s.id = 1 and k.id = 1;
$$;

revoke all on function public.pilo_ai_keys_in_use() from public, anon, authenticated;

create or replace function public.pilo_ai_set_key(p_key text, p_which text default 'texto')
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := btrim(coalesce(p_key, ''));
  which text := p_which;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración cambia la clave de Mr. Pilo.' using errcode = '42501';
  end if;
  -- «texto» es la del proveedor elegido.
  if which = 'texto' then
    select provider into which from public.pilo_ai_settings where id = 1;
  end if;
  case which
    when 'mistral' then update public.pilo_ai_secret set mistral_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'freeai' then update public.pilo_ai_secret set freeai_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'nvidia' then update public.pilo_ai_secret set nvidia_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'fishaudio' then update public.pilo_ai_secret set fishaudio_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'otro' then update public.pilo_ai_secret set otro_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'voz' then update public.pilo_ai_secret set speech_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    else raise exception 'La clave es de mistral, freeai, nvidia, fishaudio, otro o voz.';
  end case;
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
  k public.pilo_ai_secret;
  u record;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración ve el estado de las claves.' using errcode = '42501';
  end if;
  select * into k from public.pilo_ai_secret where id = 1;
  select * into u from public.pilo_ai_keys_in_use();
  return jsonb_build_object(
    'keys', jsonb_build_object(
      'mistral', jsonb_build_object('has', k.mistral_key <> '', 'last4', right(k.mistral_key, 4)),
      'freeai', jsonb_build_object('has', k.freeai_key <> '', 'last4', right(k.freeai_key, 4)),
      'nvidia', jsonb_build_object('has', k.nvidia_key <> '', 'last4', right(k.nvidia_key, 4)),
      'fishaudio', jsonb_build_object('has', k.fishaudio_key <> '', 'last4', right(k.fishaudio_key, 4)),
      'otro', jsonb_build_object('has', k.otro_key <> '', 'last4', right(k.otro_key, 4)),
      'voz', jsonb_build_object('has', k.speech_key <> '', 'last4', right(k.speech_key, 4))
    ),
    'has_key', u.text_key <> '',
    'last4', right(u.text_key, 4),
    'has_speech_key', k.speech_key <> '',
    'speech_last4', right(k.speech_key, 4),
    'updated_at', k.updated_at,
    'today', (select count(*) from public.pilo_ai_log where created_at >= date_trunc('day', now()) and not cached)
  );
end;
$$;

revoke all on function public.pilo_ai_key_status() from public;
grant execute on function public.pilo_ai_key_status() to authenticated;

-- -----------------------------------------------------------------------------
-- Fish Audio está lista con su clave y al menos un estilo con voz creada.
-- -----------------------------------------------------------------------------
create or replace function public.pilo_ai_public_config()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'enabled', s.enabled and s.base_url <> '' and u.text_key <> '',
    'speech_ready', s.voice_engine = 'proveedor' and u.speech_key <> ''
      and (
        s.speech_provider = 'freeai'
        or (s.speech_provider = 'nvidia' and s.speech_function_id <> '' and jsonb_array_length(s.voice_styles) > 0)
        or (s.speech_provider = 'fishaudio' and exists (select 1 from jsonb_array_elements(s.voice_styles) e where coalesce(e->>'fish_id', '') <> ''))
        or (s.speech_provider = 'otro' and coalesce(nullif(s.speech_base_url, ''), s.base_url) <> '' and s.speech_model <> '')
      ),
    'functions', s.functions,
    'portals', s.portals,
    'voice_engine', s.voice_engine,
    'voice_rate', s.voice_rate,
    'voice_pitch', s.voice_pitch,
    'pregunta', jsonb_build_object(
      'on', coalesce((s.portals->'pregunta'->>'on')::boolean, false),
      'aud', coalesce(s.portals->'pregunta'->>'aud', 'publico'),
      'welcome', s.pregunta_welcome,
      'ai', s.enabled and s.base_url <> '' and u.text_key <> '' and coalesce((s.functions->>'preguntar')::boolean, true)
    )
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;

-- -----------------------------------------------------------------------------
-- El audio de Fish Audio se guarda en MP3.
-- -----------------------------------------------------------------------------
do $$
begin
  update storage.buckets
  set allowed_mime_types = array['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/mpeg']
  where id = 'pilo-voz';
exception
  when insufficient_privilege or undefined_table then
    raise warning 'No se pudo abrir el bucket "pilo-voz" al MP3 (%). Agréguele audio/mpeg a mano desde Storage.', sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
