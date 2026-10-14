-- =============================================================================
-- 0098 · Mr. Pilo con IA: NVIDIA como servicio de texto con nombre propio.
--
-- NVIDIA (integrate.api.nvidia.com, formato de OpenAI) se elige como Mistral o
-- Free.ai: la dirección y el modelo vienen puestos y guarda su propia clave
-- (nvidia_key), sin tocar la de los demás.
-- Requiere 0091 y 0094. Idempotente.
-- =============================================================================

alter table public.pilo_ai_secret add column if not exists nvidia_key text not null default '';

alter table public.pilo_ai_settings drop constraint if exists pilo_ai_settings_provider;
alter table public.pilo_ai_settings add constraint pilo_ai_settings_provider check (provider in ('mistral', 'freeai', 'nvidia', 'otro'));

comment on column public.pilo_ai_secret.api_key is 'En desuso desde 0091: cada proveedor tiene su columna (mistral_key, freeai_key, nvidia_key, otro_key).';

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
      nullif(case s.speech_provider when 'freeai' then k.freeai_key when 'otro' then k.otro_key else '' end, ''),
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
    when 'otro' then update public.pilo_ai_secret set otro_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    when 'voz' then update public.pilo_ai_secret set speech_key = clean, updated_by = auth.uid(), updated_at = now() where id = 1;
    else raise exception 'La clave es de mistral, freeai, nvidia, otro o voz.';
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

notify pgrst, 'reload schema';
