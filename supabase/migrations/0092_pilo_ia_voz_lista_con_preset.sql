-- =============================================================================
-- 0092 · Mr. Pilo con IA: la voz de Free.ai cuenta como lista sin modelo escrito.
--
-- La configuración dice «Modelo de voz (vacío: kokoro)» y la función pilo-ia
-- usa kokoro/em_alex cuando el campo está vacío, pero pilo_ai_public_config()
-- exigía speech_model <> ''. Con el campo vacío, speech_ready salía en falso y
-- los portales nunca pedían la voz de IA: leían con la del navegador. La
-- muestra de la administración sí sonaba porque se salta esa comprobación.
--
-- Ahora, con Free.ai (preset: dirección y modelo puestos) basta la clave; con
-- «otro» se siguen exigiendo dirección y modelo. Requiere 0091. Idempotente.
-- =============================================================================

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
        or (s.speech_provider = 'otro' and coalesce(nullif(s.speech_base_url, ''), s.base_url) <> '' and s.speech_model <> '')
      ),
    'functions', s.functions,
    'portals', s.portals,
    'voice_engine', s.voice_engine,
    'voice_rate', s.voice_rate,
    'voice_pitch', s.voice_pitch
  )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_keys_in_use() u
  where s.id = 1;
$$;

notify pgrst, 'reload schema';
