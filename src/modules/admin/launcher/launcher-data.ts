/* =============================================================================
   Inicio de la administración · lectura de datos.

   Dos lecturas, ambas opcionales: si fallan (migración sin aplicar, permiso,
   red) el inicio se muestra igual, sin cifra, y ofrece reintentar. Nunca se
   lanza un error hacia la pantalla.
     · fichas de pilo_docs de los espacios que el rol trabaja (se cuentan aquí:
       documentos, pasajes, último cargado, con error y los pendientes).
     · personal activo (pilo_staff), solo si el rol abre «personal».
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import type { PiloSpaceId } from "../../../lib/pilo-staff";
import type { DocLite } from "./launcher-logic";

const DOC_COLUMNS = "space,status,passages,active,created_at,updated_at";
const DOC_LIMIT = 5000;

/** Las fichas de los espacios dados. La RLS ya recorta lo que la persona puede leer. */
export function useLauncherDocs(spaces: readonly PiloSpaceId[]) {
  return useQuery({
    queryKey: ["admin-launcher", "docs", [...spaces].sort().join(",")],
    enabled: spaces.length > 0,
    staleTime: 60_000,
    retry: 1,
    queryFn: async (): Promise<DocLite[]> => {
      const { data, error } = await supabase.from("pilo_docs").select(DOC_COLUMNS).in("space", [...spaces]).limit(DOC_LIMIT);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as DocLite[];
    },
  });
}

/** Cuántas personas activas administran Pilo. */
export function useActiveStaffCount(enabled: boolean) {
  return useQuery({
    queryKey: ["admin-launcher", "staff-count"],
    enabled,
    staleTime: 60_000,
    retry: 0,
    queryFn: async (): Promise<number> => {
      const { count, error } = await supabase.from("pilo_staff").select("user_id", { count: "exact", head: true }).eq("active", true);
      if (error || count === null) throw new Error(error?.message ?? "sin conteo");
      return count;
    },
  });
}
