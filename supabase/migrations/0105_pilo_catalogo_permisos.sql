-- =============================================================================
-- 0105 · Permisos directos para el catálogo de Pilo.
--
-- Permite a la administración insertar y actualizar entradas en pilo_catalog
-- directamente desde la intranet y desde Pregúntele a Pilo.
-- =============================================================================

grant insert, update on public.pilo_catalog to authenticated;

notify pgrst, 'reload schema';
