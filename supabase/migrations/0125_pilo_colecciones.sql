-- =============================================================================
-- 0125 · Mr. Pilo: colecciones de documentos propias.
--
-- Hasta aquí las colecciones de documentos eran las que la migración 0121
-- sembró (tres en Planeación, tres en Enseñanza). Ahora la administración crea
-- las suyas —«Reglamentos 2026», «Guías de laboratorio»…— en cualquiera de los
-- dos Pilos, las renombra y, cuando están vacías, las borra.
--
-- No hace falta un esquema nuevo: una colección ya era una fila de
-- `pilo_sources` con kind = 'documentos', y todo lo demás cuelga de ella por
-- datos (la llave de pilo_docs y pilo_memory, la matriz de pilo_portals y
-- pilo_scope). Esta migración solo agrega:
--
--   pilo_sources.custom        true en las que crea la administración; las de
--                              partida (las 12 de 0121) quedan en false y no se
--                              renombran ni se borran.
--   pilo_collection_create     crea una colección en un Pilo. Su id sale del
--                              nombre (solo letras, como pide pilo_sources_id).
--                              Nace en «no» en la matriz: un documento subido no
--                              entra en las respuestas hasta que se encienda,
--                              salvo que se pida leerla desde ya (p_read).
--   pilo_collection_rename     cambia el nombre de una colección propia (y el de
--                              su nodo en el mapa).
--   pilo_collection_delete     borra una colección propia VACÍA: sin documentos
--                              ni pasajes. Quita su celda de la matriz y su
--                              nodo del mapa.
--
-- Solo la administración. Todo UPDATE y DELETE lleva WHERE (safeupdate, ver
-- 0095). Requiere 0121. Idempotente.
-- =============================================================================

alter table public.pilo_sources add column if not exists custom boolean not null default false;

comment on column public.pilo_sources.custom is
  'true = colección creada por la administración (pilo_collection_create): se puede renombrar y, vacía, borrar. false = las de partida.';

-- El id de una colección sale de su nombre: sin tildes, en minúsculas y solo
-- letras (los dígitos pasan a letras: 0→a … 9→j), con tope de 30.
create or replace function public.pilo_collection_slug(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select left(
    translate(
      regexp_replace(
        lower(translate(coalesce(p_name, ''), 'áàäâãéèëêíìïîóòöôõúùüûñçÁÀÄÂÃÉÈËÊÍÌÏÎÓÒÖÔÕÚÙÜÛÑÇ', 'aaaaaeeeeiiiiooooouuuuncAAAAAEEEEIIIIOOOOOUUUUNC')),
        '[^a-z0-9]', '', 'g'
      ),
      '0123456789', 'abcdefghij'
    ),
    30
  )
$$;

revoke all on function public.pilo_collection_slug(text) from public, anon;
grant execute on function public.pilo_collection_slug(text) to authenticated, service_role;

create or replace function public.pilo_collection_name(p_name text)
returns text
language sql
immutable
set search_path = public
as $$
  select left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 80)
$$;

revoke all on function public.pilo_collection_name(text) from public, anon;
grant execute on function public.pilo_collection_name(text) to authenticated, service_role;

create or replace function public.pilo_collection_create(p_scope text, p_name text, p_read boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.pilo_collection_name(p_name);
  v_id text;
  v_sort integer;
  v_twin text;
  v_src public.pilo_sources;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración crea colecciones de Pilo.' using errcode = '42501';
  end if;
  if p_scope is null or p_scope not in ('planeacion', 'ensenanza') then
    raise exception 'Ese Pilo no existe: %', coalesce(p_scope, '(vacío)') using errcode = '22023';
  end if;
  v_id := public.pilo_collection_slug(v_name);
  if length(v_name) < 3 or length(v_id) < 3 then
    raise exception 'El nombre de la colección necesita al menos tres letras o números.' using errcode = '22023';
  end if;
  if v_id in ('mapa', 'tema', 'ref', 'doc', 'fuente') then
    raise exception 'Ese nombre está reservado: elija otro.' using errcode = '22023';
  end if;
  if (select count(*) from public.pilo_sources s where s.custom and s.scope = p_scope) >= 30 then
    raise exception 'Cada Pilo admite hasta 30 colecciones propias.' using errcode = '22023';
  end if;
  select s.name into v_twin from public.pilo_sources s
  where s.scope = p_scope and (s.id = v_id or lower(s.name) = lower(v_name))
  limit 1;
  if found then
    raise exception 'Ya existe una colección con ese nombre o muy parecido: «%».', v_twin using errcode = '23505';
  end if;
  -- El id es único entre los dos Pilos: si el otro ya usa ese nombre, se distingue por el ámbito.
  if exists (select 1 from public.pilo_sources s where s.id = v_id) then
    v_id := left(v_id, 27) || case p_scope when 'ensenanza' then 'ens' else 'pla' end;
    if exists (select 1 from public.pilo_sources s where s.id = v_id) then
      raise exception 'Ya existe una colección con ese nombre o muy parecido.' using errcode = '23505';
    end if;
  end if;

  select coalesce(max(s.sort), 99) + 1 into v_sort from public.pilo_sources s where s.custom;
  insert into public.pilo_sources (id, scope, name, kind, staff_only, stays_home, sort, custom)
  values (v_id, p_scope, v_name, 'documentos', false, false, v_sort, true)
  returning * into v_src;

  -- Nace en «no» (una celda ausente es «no»); solo se enciende si se pidió.
  if coalesce(p_read, false) then
    update public.pilo_portals p
    set matrix = p.matrix || jsonb_build_object(v_id, 'casa'), updated_by = auth.uid(), updated_at = now()
    where p.id = p_scope and p.scope = p_scope;
  end if;

  return jsonb_build_object('id', v_src.id, 'scope', v_src.scope, 'name', v_src.name, 'kind', v_src.kind, 'sort', v_src.sort, 'custom', true, 'read', coalesce(p_read, false));
end;
$$;

revoke all on function public.pilo_collection_create(text, text, boolean) from public, anon;
grant execute on function public.pilo_collection_create(text, text, boolean) to authenticated;

create or replace function public.pilo_collection_rename(p_id text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := public.pilo_collection_name(p_name);
  v_src public.pilo_sources;
  v_twin text;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración renombra colecciones de Pilo.' using errcode = '42501';
  end if;
  select * into v_src from public.pilo_sources s where s.id = p_id for update;
  if not found then
    raise exception 'Esa colección no existe.' using errcode = '22023';
  end if;
  if not v_src.custom then
    raise exception 'La colección «%» es de partida: no se renombra.', v_src.name using errcode = '22023';
  end if;
  if length(v_name) < 3 then
    raise exception 'El nombre de la colección necesita al menos tres letras o números.' using errcode = '22023';
  end if;
  select s.name into v_twin from public.pilo_sources s
  where s.id <> v_src.id and s.scope = v_src.scope and lower(s.name) = lower(v_name)
  limit 1;
  if found then
    raise exception 'Ya existe una colección con ese nombre: «%».', v_twin using errcode = '23505';
  end if;

  update public.pilo_sources s set name = v_name where s.id = v_src.id;
  -- El nodo de la colección en el mapa lleva su nombre.
  update public.pilo_nodes n set label = v_name, updated_at = now() where n.id = 'fuente:' || v_src.id and n.type = 'fuente';

  return jsonb_build_object('id', v_src.id, 'scope', v_src.scope, 'name', v_name);
end;
$$;

revoke all on function public.pilo_collection_rename(text, text) from public, anon;
grant execute on function public.pilo_collection_rename(text, text) to authenticated;

create or replace function public.pilo_collection_delete(p_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_src public.pilo_sources;
  v_docs bigint;
  v_passages bigint;
begin
  if not public.has_role_at_least('admin') then
    raise exception 'Solo la administración borra colecciones de Pilo.' using errcode = '42501';
  end if;
  select * into v_src from public.pilo_sources s where s.id = p_id for update;
  if not found then
    raise exception 'Esa colección no existe.' using errcode = '22023';
  end if;
  if not v_src.custom then
    raise exception 'La colección «%» es de partida: no se borra.', v_src.name using errcode = '22023';
  end if;
  select count(*) into v_docs from public.pilo_docs d where d.source = v_src.id;
  select count(*) into v_passages from public.pilo_memory m where m.source = v_src.id;
  if v_docs > 0 or v_passages > 0 then
    raise exception 'La colección «%» todavía tiene % y %: muévalos a otra colección o bórrelos antes.',
      v_src.name,
      case when v_docs = 1 then '1 documento' else v_docs || ' documentos' end,
      case when v_passages = 1 then '1 pasaje' else v_passages || ' pasajes' end
      using errcode = '23503';
  end if;

  -- Primero la fuente: así el espejo de la matriz ya no la vuelve a escribir.
  delete from public.pilo_edges e where e.from_id = 'fuente:' || v_src.id or e.to_id = 'fuente:' || v_src.id;
  delete from public.pilo_nodes n where n.id = 'fuente:' || v_src.id and n.type = 'fuente';
  delete from public.pilo_sources s where s.id = v_src.id;
  update public.pilo_portals p set matrix = p.matrix - v_src.id, updated_at = now() where p.matrix ? v_src.id;
  update public.pilo_ai_settings st set memory_sources = st.memory_sources - v_src.id where st.memory_sources ? v_src.id;
  update public.pilo_spaces sp set memory_sources = sp.memory_sources - v_src.id where sp.memory_sources ? v_src.id;

  return jsonb_build_object('id', v_src.id, 'scope', v_src.scope, 'name', v_src.name);
end;
$$;

revoke all on function public.pilo_collection_delete(text) from public, anon;
grant execute on function public.pilo_collection_delete(text) to authenticated;

notify pgrst, 'reload schema';
