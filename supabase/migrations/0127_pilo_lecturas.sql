-- =============================================================================
-- 0127 · Mr. Pilo: lo que lee en otros portales.
--
-- El chat de Pilo puesto en otra página (0111, 0113) puede leer la página que
-- lo aloja, si la línea que lo carga lo pide (data-leer="si"). Lo leído sirve
-- para responder en ese momento y, aparte, llega aquí: a la BANDEJA DE
-- LECTURAS del Pilo que la leyó. No entra sola a la memoria. La administración
-- la revisa y decide: guardarla como un documento de una colección de ese
-- ámbito (y desde ahí la búsqueda por palabras, la búsqueda por significado y
-- «comprender» la toman como a cualquier documento), o descartarla.
--
-- Un solo cerebro, dos Pilos: cada lectura es del ámbito del Pilo que la hizo
-- (`space`) y solo se guarda en una colección de ese ámbito. Quién más la lee
-- lo sigue diciendo la matriz de pilo_portals (0121), y hacia el otro ámbito
-- solo pasa por «visita» o por un puente aprobado (0122). Aquí no se abre
-- ningún camino nuevo de lectura.
--
--   pilo_readings              una fila por página y versión de su contenido.
--                              Solo la administración la lee; se escribe por
--                              función. Al guardarla o descartarla se borra su
--                              texto: lo guardado ya vive en pilo_memory.
--   pilo_docs                  acepta el origen y la clase «web»: la página
--                              guardada. Su `external_id` es la huella de la
--                              dirección: una página, un documento por ámbito.
--   pilo_reading_capture(espacio, lectura)
--                              la función pilo-ia anota una lectura. Devuelve
--                              «nueva», «vista», «guardada», «descartada» o
--                              «llena» (la bandeja tiene tope).
--   pilo_reading_decide(id, estado, documento)
--                              la administración la marca «guardada» (con el
--                              documento que quedó en la memoria) o
--                              «descartada».
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095). Requiere 0121.
-- Idempotente. No toca ninguna fila existente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Los documentos aceptan páginas web.
-- -----------------------------------------------------------------------------

alter table public.pilo_docs drop constraint if exists pilo_docs_origin;
alter table public.pilo_docs add constraint pilo_docs_origin check (origin in ('archivo', 'moodle', 'web'));

alter table public.pilo_docs drop constraint if exists pilo_docs_kind;
alter table public.pilo_docs add constraint pilo_docs_kind check (kind in ('docx', 'xlsx', 'csv', 'pdf', 'curso', 'web'));

alter table public.pilo_docs drop constraint if exists pilo_docs_web;
alter table public.pilo_docs add constraint pilo_docs_web check ((origin = 'web') = (kind = 'web'));

-- -----------------------------------------------------------------------------
-- La bandeja de lecturas.
-- -----------------------------------------------------------------------------

create table if not exists public.pilo_readings (
  id            uuid primary key default gen_random_uuid(),
  space         text not null,
  url           text not null,
  url_hash      text not null,
  host          text not null,
  title         text not null default '',
  body          text not null default '',
  chars         integer not null default 0,
  sections      integer not null default 0,
  omitted       integer not null default 0,
  content_hash  text not null,
  seen          integer not null default 1,
  status        text not null default 'pendiente',
  doc_id        uuid references public.pilo_docs (id) on delete set null,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  decided_by    uuid references public.profiles (id) on delete set null,
  decided_at    timestamptz,
  constraint pilo_readings_version unique (space, url_hash, content_hash),
  constraint pilo_readings_status check (status in ('pendiente', 'guardada', 'descartada')),
  constraint pilo_readings_space check (space in ('planeacion', 'ensenanza')),
  constraint pilo_readings_url check (url ~ '^https?://' and length(url) <= 300),
  constraint pilo_readings_len check (
    length(title) <= 300 and length(host) between 1 and 255 and length(body) <= 60000
    and length(url_hash) = 64 and length(content_hash) = 64
  ),
  constraint pilo_readings_numbers check (chars >= 0 and sections >= 0 and omitted >= 0 and seen >= 1)
);

create index if not exists pilo_readings_space_idx on public.pilo_readings (space, status, last_seen desc);

comment on table public.pilo_readings is
  'Mr. Pilo: las páginas que leyó su chat en otros portales (0127), a la espera de que la administración las guarde en la memoria o las descarte. Una fila por página y versión de su contenido. Se escribe por pilo_reading_capture y pilo_reading_decide.';
comment on column public.pilo_readings.space is 'El ámbito del Pilo que la leyó: solo se guarda en una colección de ese ámbito.';
comment on column public.pilo_readings.body is 'El texto de la página, ya sin correos, teléfonos ni documentos. Se borra al guardarla o descartarla.';
comment on column public.pilo_readings.seen is 'Cuántas veces la mandó el chat con este mismo contenido.';

alter table public.pilo_readings enable row level security;

drop policy if exists pilo_readings_admin on public.pilo_readings;
create policy pilo_readings_admin on public.pilo_readings
  for select to authenticated
  using (public.has_role_at_least('admin'));

revoke all on public.pilo_readings from public, anon, authenticated;
grant select on public.pilo_readings to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Anotar una lectura. La llama la función pilo-ia con la clave de servicio,
-- después de comprobar que la página es de un portal autorizado y de tapar los
-- datos personales. Las huellas (de la dirección y del contenido) se calculan
-- aquí, no se reciben.
--
--   · la misma página con el mismo contenido: suma una vista;
--   · la misma página con otro contenido: la versión pendiente anterior se
--     descarta y queda la nueva (en la bandeja hay una sola versión por página);
--   · ya guardada en la memoria con ese contenido: «guardada», sin fila nueva;
--   · más de 200 pendientes en ese ámbito: «llena», sin fila nueva.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_reading_capture(p_scope text, p_reading jsonb)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space text := coalesce(p_scope, '');
  v_in jsonb := coalesce(p_reading, 'null'::jsonb);
  v_url text;
  v_body text;
  v_url_hash text;
  v_hash text;
  v_status text;
  v_int integer;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo anota lo que lee en otros portales.' using errcode = '42501';
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    raise exception 'La lectura debe ser un objeto.' using errcode = '22023';
  end if;
  -- Los ámbitos son los de los portales (0121): el de siempre no tiene fila en pilo_spaces.
  if not exists (select 1 from public.pilo_portals p where p.scope = v_space) then
    raise exception 'Espacio desconocido: %', v_space using errcode = '22023';
  end if;

  v_url := btrim(coalesce(v_in->>'url', ''));
  v_body := coalesce(v_in->>'body', '');
  if v_url !~ '^https?://[^/?#[:space:]]+' or length(v_url) > 300 then
    raise exception 'La dirección de la página no es válida.' using errcode = '22023';
  end if;
  if length(v_body) < 200 or length(v_body) > 60000 then
    raise exception 'El texto de la página no tiene un tamaño válido.' using errcode = '22023';
  end if;

  v_url_hash := encode(sha256(convert_to(v_url, 'UTF8')), 'hex');
  v_hash := encode(sha256(convert_to(v_body, 'UTF8')), 'hex');

  -- Ya está en la memoria, con este mismo contenido.
  if exists (
    select 1 from public.pilo_docs d
    where d.space = v_space and d.origin = 'web' and d.external_id = v_url_hash and d.content_hash = v_hash
  ) then
    return 'guardada';
  end if;

  update public.pilo_readings r
  set seen = r.seen + 1, last_seen = now()
  where r.space = v_space and r.url_hash = v_url_hash and r.content_hash = v_hash
  returning r.status into v_status;
  if found then
    return case when v_status = 'pendiente' then 'vista' else v_status end;
  end if;

  select count(*) into v_int from public.pilo_readings r where r.space = v_space and r.status = 'pendiente';
  if v_int >= 200 then
    return 'llena';
  end if;

  -- La página cambió: de ella queda pendiente solo la versión nueva.
  update public.pilo_readings r
  set status = 'descartada', body = '', decided_at = now()
  where r.space = v_space and r.url_hash = v_url_hash and r.status = 'pendiente';

  insert into public.pilo_readings (space, url, url_hash, host, title, body, chars, sections, omitted, content_hash)
  values (
    v_space, v_url, v_url_hash,
    left(lower(substring(v_url from '^https?://([^/?#]+)')), 255),
    left(btrim(coalesce(v_in->>'title', '')), 300),
    v_body, length(v_body),
    case when jsonb_typeof(v_in->'sections') = 'number' then greatest(0, (v_in->>'sections')::integer) else 0 end,
    case when jsonb_typeof(v_in->'omitted') = 'number' then greatest(0, (v_in->>'omitted')::integer) else 0 end,
    v_hash
  );
  return 'nueva';
end;
$$;

revoke all on function public.pilo_reading_capture(text, jsonb) from public, anon, authenticated;
grant execute on function public.pilo_reading_capture(text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Decidir una lectura. «guardada» pide el documento web que quedó en la
-- memoria, y debe ser del mismo ámbito que la lectura. En los dos casos el
-- texto se borra de la bandeja.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_reading_decide(p_id uuid, p_status text, p_doc uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.pilo_readings;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración decide qué lecturas de Pilo entran a la memoria.' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('guardada', 'descartada') then
    raise exception 'Una lectura se guarda o se descarta.' using errcode = '22023';
  end if;
  select * into v_row from public.pilo_readings where id = p_id for update;
  if not found then
    raise exception 'Esa lectura no existe.' using errcode = '22023';
  end if;
  if p_status = 'guardada' and not exists (
    select 1 from public.pilo_docs d
    where d.id = p_doc and d.space = v_row.space and d.origin = 'web' and d.external_id = v_row.url_hash
  ) then
    raise exception 'El documento no es la página de esa lectura, o es de otro ámbito de Pilo.' using errcode = '42501';
  end if;

  update public.pilo_readings r
  set status = p_status,
      doc_id = case when p_status = 'guardada' then p_doc else null end,
      body = '',
      decided_by = auth.uid(),
      decided_at = now()
  where r.id = p_id;
end;
$$;

revoke all on function public.pilo_reading_decide(uuid, text, uuid) from public, anon;
grant execute on function public.pilo_reading_decide(uuid, text, uuid) to authenticated, service_role;
