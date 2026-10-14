-- =============================================================================
-- 0131 · Mr. Pilo: «Mis notas», la conexión de solo lectura con Génesis.
--
-- Un estudiante con cuenta de Pilo conecta Génesis (el portal del estudiante)
-- con su propio código y contraseña, y la función pilo-genesis le muestra su
-- histórico de notas. La función es un puente sin estado: no guarda la
-- contraseña, el permiso ni las notas. Lo único que necesita de la base es
-- saber A DÓNDE llamar, y eso lo decide la administración, nunca el navegador.
--
-- Génesis no es un solo portal: hay uno por sede (Bucaramanga, Cúcuta,
-- Valledupar, Bogotá, TEC y los que vengan). Por eso lo que se guarda es una
-- lista, y el estudiante entra al de su sede.
--
--   pilo_spaces               suma genesis_on y genesis_portals, en la ficha de
--                             «ensenanza» (como moodle_on y moodle_url, 0116).
--                             genesis_portals es una lista de hasta 12 portales:
--                               [{ "id": "bucaramanga", "name": "Bucaramanga",
--                                  "url": "https://sitio.udes.edu.co:81" }, …]
--                             · id: corto y estable (minúsculas, números y
--                               guiones); es lo único que manda el navegador,
--                               y queda amarrado al permiso del estudiante;
--                             · name: el nombre que ve el estudiante. No está
--                               fijado aquí: lo escribe la administración;
--                             · url: la dirección de entrada de ese portal.
--                             Nace apagada y sin portales: mientras siga así,
--                             la app dice que Mis notas aún no está disponible.
--                             No salen en la configuración pública.
--                             genesis_advice es el interruptor de las
--                             recomendaciones con IA de «Mi evolución» (función
--                             pilo-ia, acción «evolucion»): apagado de partida.
--                             Encendido, cuando un estudiante las pide —y solo
--                             entonces— su dispositivo envía a la IA un resumen
--                             de sus notas sin nombre ni código. No se guarda.
--   pilo_genesis_portals_ok(lista)
--                             lo que la restricción revisa de la lista: su
--                             forma, el tope, los ids y los nombres sin
--                             repetir, y cada dirección.
--
-- Cada dirección solo puede ser https, con el host en minúsculas, sin usuario,
-- ruta, consulta ni ancla, y —a diferencia de la de Moodle— puede llevar un
-- puerto: Génesis atiende en uno propio. La función revisa además que sea un
-- dominio público y que no resuelva a una red interna.
--
-- Aquí no hay ningún secreto: Génesis no usa un token de la universidad, cada
-- estudiante entra con lo suyo. La firma del permiso usa un secreto de la
-- función (PILO_GENESIS_SECRET), que no vive en la base.
--
-- Quién la cambia: la política de pilo_spaces (0113) ya deja la ficha solo a
-- la administración; para las personas del portal esta migración no abre
-- ningún permiso nuevo. La función del servidor (rol de servicio) la lee, y
-- eso se deja dicho aquí en vez de fiarse de los permisos de partida del
-- proyecto. No la cambia.
--
-- Requiere 0113. Idempotente. Sin DELETE. Solo toca una fila si antes se aplicó el
-- borrador de una sola dirección: la pasa a portal o, si no sirve, apaga la conexión
-- (los dos UPDATE llevan WHERE).
-- =============================================================================

-- Lo que debe cumplir la lista de portales. Inmutable: la usa una restricción.
create or replace function public.pilo_genesis_portals_ok(p_portals jsonb)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_item jsonb;
  v_id text;
  v_name text;
  v_url text;
  v_ids text[] := '{}';
  v_names text[] := '{}';
begin
  if p_portals is null or jsonb_typeof(p_portals) <> 'array' or jsonb_array_length(p_portals) > 12 then
    return false;
  end if;
  for v_item in select * from jsonb_array_elements(p_portals) loop
    if jsonb_typeof(v_item) <> 'object'
      or jsonb_typeof(v_item->'id') is distinct from 'string'
      or jsonb_typeof(v_item->'name') is distinct from 'string'
      or jsonb_typeof(v_item->'url') is distinct from 'string' then
      return false;
    end if;
    v_id := v_item->>'id';
    v_name := v_item->>'name';
    v_url := v_item->>'url';
    -- Solo estas tres llaves: nada más se guarda de un portal.
    if (v_item - 'id' - 'name' - 'url') <> '{}'::jsonb then
      return false;
    end if;
    if v_id !~ '^[a-z][a-z0-9-]{1,23}$' then
      return false;
    end if;
    if length(v_name) > 60 or v_name <> btrim(v_name) or v_name = '' or v_name ~ '[[:cntrl:]]' then
      return false;
    end if;
    if length(v_url) > 300 or v_url !~ '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$' then
      return false;
    end if;
    if v_id = any (v_ids) or lower(v_name) = any (v_names) then
      return false;
    end if;
    v_ids := v_ids || v_id;
    v_names := v_names || lower(v_name);
  end loop;
  return true;
end;
$$;

revoke all on function public.pilo_genesis_portals_ok(jsonb) from public, anon;
grant execute on function public.pilo_genesis_portals_ok(jsonb) to authenticated, service_role;

alter table public.pilo_spaces add column if not exists genesis_on boolean not null default false;
alter table public.pilo_spaces add column if not exists genesis_portals jsonb not null default '[]'::jsonb;
alter table public.pilo_spaces add column if not exists genesis_advice boolean not null default false;

-- Un borrador de esta migración guardaba una sola dirección: si llegó a aplicarse en algún sitio, se retira.
alter table public.pilo_spaces drop constraint if exists pilo_spaces_genesis_url;
alter table public.pilo_spaces drop constraint if exists pilo_spaces_genesis_on;

-- Antes de retirarla, la dirección que alguien ya había guardado pasa a ser el primer
-- portal («Principal»), si es válida: así no se pierde y Mis notas sigue encendida.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'pilo_spaces' and column_name = 'genesis_url'
  ) then
    execute $sql$
      update public.pilo_spaces s
      set genesis_portals = jsonb_build_array(jsonb_build_object('id', 'principal', 'name', 'Principal', 'url', btrim(s.genesis_url)))
      where coalesce(btrim(s.genesis_url), '') <> ''
        and jsonb_array_length(s.genesis_portals) = 0
        and public.pilo_genesis_portals_ok(jsonb_build_array(jsonb_build_object('id', 'principal', 'name', 'Principal', 'url', btrim(s.genesis_url))))
    $sql$;
  end if;
end $$;

alter table public.pilo_spaces drop column if exists genesis_url;

-- Encendida y sin ningún portal (el borrador se encendió con una dirección que ya no está, o
-- que no era válida): se apaga. La administración la enciende de nuevo al escribir los portales.
update public.pilo_spaces s
set genesis_on = false
where s.genesis_on and jsonb_array_length(s.genesis_portals) = 0;

alter table public.pilo_spaces drop constraint if exists pilo_spaces_genesis_portals;
alter table public.pilo_spaces add constraint pilo_spaces_genesis_portals check (public.pilo_genesis_portals_ok(genesis_portals));

-- Encendida, tiene que haber al menos un portal a dónde llamar.
alter table public.pilo_spaces add constraint pilo_spaces_genesis_on check (not genesis_on or jsonb_array_length(genesis_portals) > 0);

-- La función pilo-genesis (y pilo-clases, para lo de Moodle) lee la ficha con el rol de servicio.
grant select on public.pilo_spaces to service_role;

comment on column public.pilo_spaces.genesis_on is 'Mis notas (0131): si los estudiantes pueden conectar Génesis desde la app. Apagada de partida.';
comment on column public.pilo_spaces.genesis_advice is 'Mis notas (0131): si los estudiantes pueden pedir recomendaciones con IA sobre sus notas. Apagado de partida; el resumen que se envía no lleva datos personales ni se guarda.';
comment on column public.pilo_spaces.genesis_portals is 'Los portales de Génesis, uno por sede: [{id, name, url}] (hasta 12; solo https, puede llevar puerto). Los lee la función pilo-genesis; el navegador solo manda el id.';

notify pgrst, 'reload schema';
