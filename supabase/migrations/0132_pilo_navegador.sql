-- =============================================================================
-- 0132 · Mr. Pilo: el navegador para leer páginas web.
--
-- La función pilo-ia lee una página web descargando su HTML, sin ejecutar su
-- JavaScript (0129). Para las páginas que arman su contenido al cargar, o lo
-- guardan detrás de pestañas y botones «ver más», la administración puede
-- conectar un servicio aparte (navegador/, en la raíz del repositorio) que las
-- abre en un navegador de verdad y devuelve el HTML ya armado.
--
-- Aquí va solo la conexión con ese servicio: su dirección, su interruptor y su
-- clave. Es UNA para todo el portal (no por espacio): el servicio no guarda ni
-- lee nada de ningún Pilo. Nace APAGADA: sin encenderla, Pilo lee las páginas
-- exactamente como hasta 0131.
--
--   pilo_browser              la dirección (solo https) y el interruptor. Una
--                             sola fila. La administración la lee; se escribe
--                             por función.
--   pilo_browser_secret       la clave del servicio. RLS sin políticas y sin
--                             permisos para nadie del portal: solo la lee el
--                             rol de servicio (la función), igual que las
--                             claves de la IA (0089) y el token de Moodle (0116).
--   pilo_browser_save(encendido, dirección)
--                             guarda la conexión. Solo la administración. No
--                             se deja encender sin dirección o sin clave.
--   pilo_browser_set_key(valor)
--                             guarda la clave; devuelve solo sus 4 últimos
--                             caracteres. Vaciarla la quita y apaga el servicio.
--   pilo_browser_status()     la conexión y si hay clave (con sus 4 últimos).
--                             Nunca la clave.
--
-- Todo UPDATE y DELETE lleva WHERE (safeupdate, ver 0095). Requiere 0094.
-- Idempotente. No toca ninguna fila existente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- La conexión. La dirección solo puede ser https (la función revisa además que
-- sea un nombre público y que no lleve a una red interna).
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_browser (
  id          smallint primary key default 1,
  enabled     boolean not null default false,
  url         text not null default '',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint pilo_browser_single check (id = 1),
  constraint pilo_browser_url check (url = '' or (url ~ '^https://[^\s/?#@]+' and url !~ '[\s?#@]' and length(url) <= 300)),
  constraint pilo_browser_enabled check (not enabled or url <> '')
);

comment on table public.pilo_browser is
  'Mr. Pilo: la conexión con el servicio de navegador que abre páginas web con JavaScript (navegador/). Una fila. La clave va aparte, en pilo_browser_secret.';

insert into public.pilo_browser (id) values (1) on conflict (id) do nothing;

alter table public.pilo_browser enable row level security;

drop policy if exists pilo_browser_admin on public.pilo_browser;
create policy pilo_browser_admin on public.pilo_browser
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_browser from public, anon, authenticated;
grant select on public.pilo_browser to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- El secreto.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_browser_secret (
  id          smallint primary key default 1,
  key         text not null default '',
  updated_by  uuid references public.profiles (id) on delete set null,
  updated_at  timestamptz not null default now(),
  constraint pilo_browser_secret_single check (id = 1),
  constraint pilo_browser_secret_len check (length(key) <= 200)
);

comment on table public.pilo_browser_secret is
  'Mr. Pilo: la clave del servicio de navegador. Nadie la lee desde el portal: solo la función del servidor, con el rol de servicio.';

insert into public.pilo_browser_secret (id) values (1) on conflict (id) do nothing;

alter table public.pilo_browser_secret enable row level security;
revoke all on public.pilo_browser_secret from public, anon, authenticated;
grant select on public.pilo_browser_secret to service_role;

-- -----------------------------------------------------------------------------
-- Guardar la clave. Devuelve solo sus cuatro últimos caracteres. Sin clave no
-- hay servicio: quitarla lo apaga.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_browser_set_key(p_value text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  clean text := regexp_replace(coalesce(p_value, ''), '\s', '', 'g');
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración guarda la clave del navegador de Pilo.' using errcode = '42501';
  end if;
  if clean <> '' and length(clean) < 24 then
    raise exception 'La clave del navegador debe tener al menos 24 caracteres.' using errcode = '22023';
  end if;
  if length(clean) > 200 then
    raise exception 'La clave es demasiado larga.' using errcode = '22023';
  end if;
  insert into public.pilo_browser_secret as k (id, key, updated_by, updated_at)
  values (1, clean, auth.uid(), now())
  on conflict (id) do update set key = excluded.key, updated_by = excluded.updated_by, updated_at = now();
  if clean = '' then
    update public.pilo_browser b set enabled = false, updated_by = auth.uid(), updated_at = now() where b.id = 1 and b.enabled;
  end if;
  return case when clean = '' then '' else right(clean, 4) end;
end;
$$;

revoke all on function public.pilo_browser_set_key(text) from public, anon;
grant execute on function public.pilo_browser_set_key(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Guardar la conexión. Un valor nulo deja lo que había. No se enciende sin
-- dirección o sin clave.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_browser_save(p_enabled boolean, p_url text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now public.pilo_browser;
  v_url text;
  v_enabled boolean;
  v_key text := '';
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración configura el navegador de Pilo.' using errcode = '42501';
  end if;
  select b.* into v_now from public.pilo_browser b where b.id = 1;
  v_url := regexp_replace(btrim(coalesce(p_url, v_now.url, '')), '/+$', '');
  v_enabled := coalesce(p_enabled, v_now.enabled, false);
  if v_url <> '' and (v_url !~ '^https://[^\s/?#@]+' or v_url ~ '[\s?#@]' or length(v_url) > 300) then
    raise exception 'La dirección del navegador debe empezar por https:// y no llevar usuario, consulta ni ancla.' using errcode = '22023';
  end if;
  select k.key into v_key from public.pilo_browser_secret k where k.id = 1;
  if v_enabled and (v_url = '' or coalesce(v_key, '') = '') then
    raise exception 'Guarde la dirección y la clave del navegador antes de encenderlo.' using errcode = '22023';
  end if;
  insert into public.pilo_browser as b (id, enabled, url, updated_by, updated_at)
  values (1, v_enabled, v_url, auth.uid(), now())
  on conflict (id) do update set enabled = excluded.enabled, url = excluded.url, updated_by = excluded.updated_by, updated_at = now();
  return public.pilo_browser_status();
end;
$$;

revoke all on function public.pilo_browser_save(boolean, text) from public, anon;
grant execute on function public.pilo_browser_save(boolean, text) to authenticated;

-- -----------------------------------------------------------------------------
-- El estado: la conexión y si hay clave. Nunca la clave.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_browser_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.pilo_browser;
  v_key text := '';
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración ve la conexión con el navegador de Pilo.' using errcode = '42501';
  end if;
  select b.* into v_row from public.pilo_browser b where b.id = 1;
  select k.key into v_key from public.pilo_browser_secret k where k.id = 1;
  return jsonb_build_object(
    'enabled', coalesce(v_row.enabled, false),
    'url', coalesce(v_row.url, ''),
    'key', jsonb_build_object('has', coalesce(v_key, '') <> '', 'last4', right(coalesce(v_key, ''), 4)),
    'ready', coalesce(v_row.enabled, false) and coalesce(v_row.url, '') <> '' and coalesce(v_key, '') <> '',
    'updated_at', v_row.updated_at
  );
end;
$$;

revoke all on function public.pilo_browser_status() from public, anon;
grant execute on function public.pilo_browser_status() to authenticated, service_role;

notify pgrst, 'reload schema';
