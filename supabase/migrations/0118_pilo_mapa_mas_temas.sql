-- =============================================================================
-- 0118 · El mapa de conexiones de Mr. Pilo comprende más de cada pasaje.
--
-- «Comprender» (función pilo-ia) ahora pide hasta 6 temas y 5 referencias por
-- pasaje (antes 4 y 3), en lotes de 36 pasajes y con 200 temas conocidos a la
-- vista. Los lotes y los temas conocidos ya caben en 0115 (pilo_map_pending
-- acepta hasta 60 y pilo_map_topics hasta 300). Lo único que la base recortaba
-- era cuánto se guarda por pasaje: pilo_map_save se quedaba con los 4 primeros
-- temas y las 3 primeras referencias. Esta migración sube ese tope a 6 y 5.
--
-- Es la misma función de 0115, sin otro cambio: mismos permisos, mismas
-- validaciones de etiquetas y de espacio, mismo valor devuelto. Sin esta
-- migración nada falla: la función de Pilo sigue trabajando y la base guarda
-- 4 temas y 3 referencias por pasaje, como antes.
--
-- Depende de 0115. No toca datos: lo ya comprendido queda como está; para que
-- un pasaje gane los temas nuevos hay que volver a comprenderlo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Guardar lo que la IA comprendió de unos pasajes. Filas:
--   [{ "ref": "doc:<uuid>:<n>",
--      "topics": [{"id": "tema:<slug>", "label": "…"}, …],     hasta 6
--      "refs":   [{"id": "ref:<slug>",  "label": "…"}, …] }]   hasta 5
-- -----------------------------------------------------------------------------

create or replace function public.pilo_map_save(p_space text, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_saved integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la función de Pilo y la administración arman el mapa.' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_rows, 'null'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.pilo_spaces sp where sp.id = p_space) then
    raise exception 'Espacio desconocido: %', p_space using errcode = '22023';
  end if;

  create temporary table if not exists pilo_map_rows (ref text primary key, doc_id uuid, topics jsonb, refs jsonb) on commit drop;
  create temporary table if not exists pilo_map_links (ref text, rel text, id text, label text, primary key (ref, rel, id)) on commit drop;
  delete from pilo_map_rows where true;
  delete from pilo_map_links where true;

  -- Solo pasajes de documentos de este espacio.
  insert into pilo_map_rows (ref, doc_id, topics, refs)
  select distinct on (m.ref) m.ref, m.doc_id,
    case when jsonb_typeof(r->'topics') = 'array' then r->'topics' else '[]'::jsonb end,
    case when jsonb_typeof(r->'refs') = 'array' then r->'refs' else '[]'::jsonb end
  from jsonb_array_elements(p_rows) r
  join public.pilo_memory m on m.ref = r->>'ref'
  where m.space = p_space and m.doc_id is not null;
  get diagnostics v_saved = row_count;

  insert into pilo_map_links (ref, rel, id, label)
  select distinct on (y.ref, y.rel, y.id) y.ref, y.rel, y.id, y.label
  from (
    select x.ref, x.rel, x.label, x.ord,
      case
        when x.given ~ ('^' || x.prefix || '[a-z0-9]+(-[a-z0-9]+)*$') and length(x.given) <= 80 then x.given
        else x.prefix || left(btrim(regexp_replace(replace(public.pilo_fold(x.label), 'ñ', 'n'), '[^a-z0-9]+', '-', 'g'), '-'), 70)
      end as id
    from (
      select w.ref, 'trata'::text as rel, 'tema:'::text as prefix, t.ord,
        btrim(case jsonb_typeof(t.item) when 'string' then t.item #>> '{}' else coalesce(t.item->>'label', '') end) as label,
        case jsonb_typeof(t.item) when 'object' then coalesce(t.item->>'id', '') else '' end as given
      from pilo_map_rows w, jsonb_array_elements(w.topics) with ordinality as t (item, ord)
      where t.ord <= 6
      union all
      select w.ref, 'cita'::text, 'ref:'::text, t.ord,
        btrim(case jsonb_typeof(t.item) when 'string' then t.item #>> '{}' else coalesce(t.item->>'label', '') end),
        case jsonb_typeof(t.item) when 'object' then coalesce(t.item->>'id', '') else '' end
      from pilo_map_rows w, jsonb_array_elements(w.refs) with ordinality as t (item, ord)
      where t.ord <= 5
    ) x
    where length(x.label) between 3 and 60
      and x.label !~* '(https?:|www\.|://|<<<|>>>)'
      -- La marca del pedido va en mayúsculas («<<<DATOS»): un tema como «Análisis de datos» sí entra.
      and x.label !~ 'DATOS'
  ) y
  where length(y.id) between 6 and 80 and y.id ~ '^(tema|ref):[a-z0-9]+(-[a-z0-9]+)*$'
  order by y.ref, y.rel, y.id, y.ord;

  -- Fuera lo que la IA había puesto en esos pasajes.
  delete from public.pilo_edges e
  where e.space = p_space and e.origin = 'ia' and e.rel in ('trata', 'cita')
    and exists (select 1 from pilo_map_rows w where w.ref = e.from_id);

  insert into public.pilo_nodes (id, source, type, label, props, space)
  select distinct on (l.id) l.id, 'mapa', case l.rel when 'trata' then 'tema' else 'referencia' end, l.label,
    jsonb_build_object('kind', case l.rel when 'trata' then 'tema' else 'referencia' end), p_space
  from pilo_map_links l
  order by l.id, l.ref
  on conflict (id) do nothing;

  -- Solo hacia nodos de este espacio.
  insert into public.pilo_edges (from_id, to_id, rel, source, space, origin)
  select l.ref, l.id, l.rel, 'mapa', p_space, 'ia'
  from pilo_map_links l
  join public.pilo_nodes n on n.id = l.id
  where n.space = p_space
  on conflict do nothing;

  update public.pilo_memory m set mapped_at = now()
  where m.space = p_space and exists (select 1 from pilo_map_rows w where w.ref = m.ref);

  perform public.pilo_map_prune(p_space);

  -- El documento queda «entendido» cuando no le falta ningún pasaje.
  update public.pilo_docs d set status = 'entendido', understood_at = now(), updated_at = now()
  where d.space = p_space
    and d.status in ('en_pasajes', 'en_mapa', 'entendido')
    and exists (select 1 from pilo_map_rows w where w.doc_id = d.id)
    and not exists (
      select 1 from public.pilo_memory m
      where m.doc_id = d.id and (m.mapped_at is null or m.mapped_at < m.updated_at)
    );

  return v_saved;
end;
$$;

revoke all on function public.pilo_map_save(text, jsonb) from public, anon;
grant execute on function public.pilo_map_save(text, jsonb) to authenticated, service_role;
