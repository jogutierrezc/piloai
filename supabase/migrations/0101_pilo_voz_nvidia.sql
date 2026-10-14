-- =============================================================================
-- 0101 · Mr. Pilo con IA: la voz de Pilo con NVIDIA (Magpie TTS Zeroshot).
--
-- Magpie Zeroshot clona una voz a partir de una muestra de 3 a 10 segundos.
-- La administración sube una o varias muestras (cada una es un «estilo»:
-- cercano, formal…) al bucket privado pilo-voz; la función pilo-ia las lee con
-- la clave de servicio y llama a NVIDIA por gRPC con la clave de NVIDIA
-- (nvidia_key, 0098) y el function-id del modelo.
--
--   speech_provider      ahora también 'nvidia'.
--   speech_function_id   el function-id de Magpie TTS Zeroshot en build.nvidia.com.
--   voice_language       el idioma que lee (es-US: español).
--   voice_quality        1–40: más alto, más parecida a la muestra y más lenta.
--   voice_styles         [{id, name, path, seconds}]: las muestras subidas.
--   voice_style          el estilo de siempre.
--   voice_portal_styles  {portal: estilo}: otro estilo en un portal (p. ej. pregunta).
--
-- El audio ya leído se guarda en pilo-voz/cache/ (por el texto y la
-- configuración): repetir una frase no vuelve a llamar a NVIDIA.
-- Requiere 0094 y 0098. Idempotente.
-- =============================================================================

alter table public.pilo_ai_settings add column if not exists speech_function_id text not null default '';
alter table public.pilo_ai_settings add column if not exists voice_language text not null default 'es-US';
alter table public.pilo_ai_settings add column if not exists voice_quality integer not null default 20;
alter table public.pilo_ai_settings add column if not exists voice_styles jsonb not null default '[]'::jsonb;
alter table public.pilo_ai_settings add column if not exists voice_style text not null default '';
alter table public.pilo_ai_settings add column if not exists voice_portal_styles jsonb not null default '{}'::jsonb;

alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_speech_provider;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_speech_provider check (speech_provider in ('freeai', 'nvidia', 'otro', 'navegador'));
alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_voice_quality;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_voice_quality check (voice_quality between 1 and 40);
alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_function_id;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_function_id
  check (speech_function_id = '' or speech_function_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_voice_styles;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_voice_styles
  check (jsonb_typeof(voice_styles) = 'array' and jsonb_array_length(voice_styles) <= 12 and jsonb_typeof(voice_portal_styles) = 'object');

-- -----------------------------------------------------------------------------
-- La clave de la voz: con NVIDIA, la de NVIDIA.
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
      nullif(case s.speech_provider when 'freeai' then k.freeai_key when 'nvidia' then k.nvidia_key when 'otro' then k.otro_key else '' end, ''),
      case s.provider when 'mistral' then k.mistral_key when 'freeai' then k.freeai_key when 'nvidia' then k.nvidia_key else k.otro_key end
    )
  from public.pilo_ai_settings s
  cross join public.pilo_ai_secret k
  where s.id = 1 and k.id = 1;
$$;

revoke all on function public.pilo_ai_keys_in_use() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- La voz de NVIDIA está lista con clave, function-id y al menos una muestra.
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
-- Bucket privado pilo-voz: muestras (muestras/) y audio ya leído (cache/).
-- Solo la administración lo toca desde el portal; la función usa la clave de servicio.
-- -----------------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('pilo-voz', 'pilo-voz', false, 20971520, array['audio/wav', 'audio/x-wav', 'audio/wave'])
  on conflict (id) do update set public = false, file_size_limit = 20971520, allowed_mime_types = excluded.allowed_mime_types;

  execute 'drop policy if exists pilo_voz_lectura on storage.objects';
  execute $pol$
    create policy pilo_voz_lectura on storage.objects
      for select to authenticated
      using (bucket_id = 'pilo-voz' and public.has_role_at_least('admin'))
  $pol$;

  execute 'drop policy if exists pilo_voz_escritura on storage.objects';
  execute $pol$
    create policy pilo_voz_escritura on storage.objects
      for insert to authenticated
      with check (bucket_id = 'pilo-voz' and public.has_role_at_least('admin'))
  $pol$;

  execute 'drop policy if exists pilo_voz_cambio on storage.objects';
  execute $pol$
    create policy pilo_voz_cambio on storage.objects
      for update to authenticated
      using (bucket_id = 'pilo-voz' and public.has_role_at_least('admin'))
  $pol$;

  execute 'drop policy if exists pilo_voz_borrado on storage.objects';
  execute $pol$
    create policy pilo_voz_borrado on storage.objects
      for delete to authenticated
      using (bucket_id = 'pilo-voz' and public.has_role_at_least('admin'))
  $pol$;
exception
  when insufficient_privilege or undefined_table then
    raise warning
      'No se pudo preparar el bucket "pilo-voz" (%). Créelo a mano desde Storage: privado, 20 MB por archivo, audio/wav; y con acceso solo para la administración.',
      sqlerrm;
end;
$$;

notify pgrst, 'reload schema';
