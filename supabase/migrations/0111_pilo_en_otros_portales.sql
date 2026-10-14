-- =============================================================================
-- 0111 · Mr. Pilo con IA: el chat emergente en otros portales.
--
-- public/pilo.js pone en otra página un marco hacia /pilo-embed. Desde la
-- intranet (Mr. Pilo con IA › Dónde aparece) se decide si otros portales
-- pueden mostrarlo y cuáles:
--
--   widget_on       boolean  (apagado: solo se ve dentro de este portal)
--   widget_origins  text[]   (los portales autorizados, como origen:
--                             «https://www.udes.edu.co»)
--
-- La página /pilo-embed lee ambos con pilo_ai_public_config() y, si quien la
-- aloja no está en la lista, no pinta nada. Quién puede preguntar sigue siendo
-- lo que diga Pregúntele a Pilo.
--
-- Requiere 0106. Idempotente.
-- =============================================================================

alter table public.pilo_ai_settings add column if not exists widget_on boolean not null default false;
alter table public.pilo_ai_settings add column if not exists widget_origins text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pilo_ai_settings_widget') then
    alter table public.pilo_ai_settings
      add constraint pilo_ai_settings_widget check (coalesce(cardinality(widget_origins), 0) <= 50);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- pilo_ai_public_config: lo de 0106, más el chat emergente.
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
    'voice_expressions', s.voice_expressions,
    'voice_modulation', s.voice_modulation,
    'voice_patterns', s.voice_patterns,
    'pregunta', jsonb_build_object(
      'on', coalesce((s.portals->'pregunta'->>'on')::boolean, false),
      'aud', coalesce(s.portals->'pregunta'->>'aud', 'publico'),
      'welcome', s.pregunta_welcome,
      'ai', s.enabled and s.base_url <> '' and u.text_key <> '' and coalesce((s.functions->>'preguntar')::boolean, true)
    ),
    'widget', jsonb_build_object(
      'on', s.widget_on,
      'origins', to_jsonb(s.widget_origins)
    )
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;
