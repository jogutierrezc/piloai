-- =============================================================================
-- 0128 · Mr. Pilo: la respuesta que se recoge después.
--
-- Un parlante (la skill de Alexa) espera la respuesta 8 segundos, y a Pilo
-- redactar le toma más. Con esta migración quien pregunta puede dejar un
-- tiquete (`espera`, un uuid que él mismo inventa), irse, y volver por la
-- respuesta: la función pilo-ia sigue redactando aunque el pedido se cierre,
-- deja aquí lo que respondió y lo entrega con la acción «recoger».
--
-- El tiquete es el secreto: quien lo tiene recoge la respuesta, y nadie más.
-- La fila no guarda quién preguntó ni la pregunta; solo lo que se le habría
-- dicho. Vive una hora.
--
--   pilo_waits                 una fila por tiquete. Solo se lee y se escribe
--                              por función, con la clave de servicio.
--   pilo_wait_open(tiquete, portal)
--                              abre la espera. `false` si el tiquete ya existía
--                              (un tiquete sirve una sola vez). De paso borra
--                              las esperas de más de una hora.
--   pilo_wait_close(tiquete, estado, respuesta)
--                              deja la respuesta («lista») o el error («error»).
--   pilo_wait_read(tiquete)    { status, payload }, o null si no existe.
--
-- Todo DELETE y UPDATE lleva WHERE (safeupdate, ver 0095).
-- Idempotente. No toca ninguna fila existente.
-- =============================================================================

create table if not exists public.pilo_waits (
  ticket      uuid primary key,
  created_at  timestamptz not null default now(),
  done_at     timestamptz,
  portal      text not null default '',
  status      text not null default 'pendiente' check (status in ('pendiente', 'lista', 'error')),
  payload     jsonb
);

create index if not exists pilo_waits_created_idx on public.pilo_waits (created_at);

comment on table public.pilo_waits is
  'Mr. Pilo: respuestas que quien preguntó recoge después (0128), para quien no puede esperar con el pedido abierto (la skill de Alexa). Una fila por tiquete; vive una hora. Se lee y se escribe por pilo_wait_open, pilo_wait_close y pilo_wait_read.';
comment on column public.pilo_waits.ticket is 'El tiquete que inventó quien pregunta. Es el secreto con que se recoge la respuesta.';
comment on column public.pilo_waits.payload is 'Lo que se le habría dicho: { kind, text, asked, sources } o { message } si falló.';

alter table public.pilo_waits enable row level security;

revoke all on public.pilo_waits from public, anon, authenticated;
grant select, insert, update, delete on public.pilo_waits to service_role;

-- -----------------------------------------------------------------------------
-- Abrir una espera.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_wait_open(p_ticket uuid, p_portal text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new integer;
begin
  if p_ticket is null then
    return false;
  end if;
  delete from public.pilo_waits w where w.created_at < now() - interval '1 hour';
  insert into public.pilo_waits (ticket, portal)
  values (p_ticket, left(coalesce(p_portal, ''), 60))
  on conflict (ticket) do nothing;
  get diagnostics v_new = row_count;
  return v_new > 0;
end;
$$;

revoke all on function public.pilo_wait_open(uuid, text) from public, anon, authenticated;
grant execute on function public.pilo_wait_open(uuid, text) to service_role;

-- -----------------------------------------------------------------------------
-- Dejar la respuesta. Solo sobre una espera abierta: lo ya dejado no se pisa.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_wait_close(p_ticket uuid, p_status text, p_payload jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.pilo_waits w
     set status = case when p_status = 'lista' then 'lista' else 'error' end,
         payload = p_payload,
         done_at = now()
   where w.ticket = p_ticket
     and w.status = 'pendiente';
end;
$$;

revoke all on function public.pilo_wait_close(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.pilo_wait_close(uuid, text, jsonb) to service_role;

-- -----------------------------------------------------------------------------
-- Leer una espera.
-- -----------------------------------------------------------------------------

create or replace function public.pilo_wait_read(p_ticket uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('status', w.status, 'payload', w.payload)
    from public.pilo_waits w
   where w.ticket = p_ticket
     and w.created_at >= now() - interval '1 hour';
$$;

revoke all on function public.pilo_wait_read(uuid) from public, anon, authenticated;
grant execute on function public.pilo_wait_read(uuid) to service_role;
