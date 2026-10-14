-- =============================================================================
-- 0106 · Mr. Pilo con IA: expresiones emocionales y microexpresiones orales.
--
-- Permite que Pilo hable con naturalidad, entonaciones y microexpresiones
-- orales según el estado de ánimo de la respuesta (emocionado, atento,
-- atrevido, cuidado, pensar).
--
--   voice_expressions  boolean (activa o desactiva las microexpresiones al hablar)
--   voice_modulation   boolean (modula sutilmente velocidad y tono según la emoción)
--   voice_patterns     jsonb con listas de frases de apertura por emoción
--
-- Requiere 0102 y 0105. Idempotente.
-- =============================================================================

alter table public.pilo_ai_settings add column if not exists voice_expressions boolean not null default true;
alter table public.pilo_ai_settings add column if not exists voice_modulation boolean not null default true;
alter table public.pilo_ai_settings add column if not exists voice_patterns jsonb not null default '{
  "emocionado": ["¡Claro que sí!", "¡Qué buena pregunta!", "¡Mira este dato interesante!", "¡Con mucho gusto te cuento!"],
  "atento": ["Veamos lo que tenemos registrado...", "Revisemos con atención las cifras oficiales...", "Según los registros de Planeación..."],
  "atrevido": ["¡Jeje, esa es buena!", "¡Ojo con esa pregunta!", "¡Ah, qué curioso detalle!"],
  "cuidado": ["Atención a este detalle...", "Es importante aclarar que...", "Fíjate bien en esto..."],
  "pensar": ["Hmm, déjame revisar...", "Consultando los reportes...", "A ver, veamos qué encontramos..."]
}'::jsonb;

-- -----------------------------------------------------------------------------
-- Actualiza pilo_ai_public_config para incluir la configuración de expresiones
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
    )
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;
