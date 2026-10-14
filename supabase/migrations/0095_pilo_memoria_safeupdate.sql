-- =============================================================================
-- 0095 · Pregúntele a Pilo: «Actualizar la memoria» fallaba con
--        «DELETE requires a WHERE clause».
--
-- Supabase tiene activa la extensión safeupdate para los pedidos que llegan
-- por la API: rechaza todo DELETE o UPDATE sin WHERE, aunque sea dentro de
-- una función. pilo_memory_replace vaciaba su tabla temporal con un DELETE
-- a secas. Es la misma función de 0094 con ese vaciado escrito con WHERE.
-- Requiere 0094. Idempotente.
-- =============================================================================

create or replace function public.pilo_memory_replace(p_source text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_removed integer := 0;
  v_added integer := 0;
  v_changed integer := 0;
  v_total integer := 0;
begin
  if not public.pilo_is_service_or_admin() then
    raise exception 'Solo la administración actualiza la memoria de Pilo.' using errcode = '42501';
  end if;
  if p_source not in ('cifras', 'boletines', 'pdi', 'observatorio', 'impacto') then
    raise exception 'Fuente desconocida: %', p_source using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'Las filas deben ser una lista.' using errcode = '22023';
  end if;

  create temporary table if not exists pilo_incoming (
    ref text primary key, title text, section text, body text, path text, cut text, office text
  ) on commit drop;
  delete from pilo_incoming where true;

  insert into pilo_incoming (ref, title, section, body, path, cut, office)
  select distinct on (r->>'ref')
    left(r->>'ref', 300), left(coalesce(r->>'title', ''), 300), left(coalesce(r->>'section', ''), 300),
    left(coalesce(r->>'body', ''), 8000), left(coalesce(r->>'path', ''), 300),
    left(coalesce(r->>'cut', ''), 60), left(coalesce(r->>'office', ''), 200)
  from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
  where coalesce(r->>'ref', '') <> '' and coalesce(r->>'title', '') <> '' and length(coalesce(r->>'body', '')) >= 10;

  delete from public.pilo_memory m
  where m.source = p_source and not exists (select 1 from pilo_incoming i where i.ref = m.ref);
  get diagnostics v_removed = row_count;

  select count(*) into v_added from pilo_incoming i where not exists (select 1 from public.pilo_memory m where m.ref = i.ref);
  select count(*) into v_changed
  from pilo_incoming i join public.pilo_memory m on m.ref = i.ref
  where (m.title, m.section, m.body, m.path, m.cut, m.office, m.source)
        is distinct from (i.title, i.section, i.body, i.path, i.cut, i.office, p_source);

  insert into public.pilo_memory (ref, source, title, section, body, path, cut, office, updated_at)
  select i.ref, p_source, i.title, i.section, i.body, i.path, i.cut, i.office, now() from pilo_incoming i
  on conflict (ref) do update set
    source = excluded.source, title = excluded.title, section = excluded.section, body = excluded.body,
    path = excluded.path, cut = excluded.cut, office = excluded.office,
    updated_at = case
      when (pilo_memory.title, pilo_memory.section, pilo_memory.body, pilo_memory.path, pilo_memory.cut, pilo_memory.office, pilo_memory.source)
           is distinct from (excluded.title, excluded.section, excluded.body, excluded.path, excluded.cut, excluded.office, excluded.source)
      then now() else pilo_memory.updated_at end;

  select count(*) into v_total from public.pilo_memory where source = p_source;
  update public.pilo_ai_settings set memory_indexed_at = now() where id = 1;

  return jsonb_build_object('source', p_source, 'added', v_added, 'changed', v_changed, 'removed', v_removed, 'total', v_total);
end;
$$;

revoke all on function public.pilo_memory_replace(text, jsonb) from public, anon;
grant execute on function public.pilo_memory_replace(text, jsonb) to authenticated, service_role;

notify pgrst, 'reload schema';
