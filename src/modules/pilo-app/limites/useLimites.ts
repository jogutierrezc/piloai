/* =============================================================================
   Mr. Pilo · «Mis límites» · el gancho.

   Lee lo configurado y lo gastado desde la función `pilo-carnet` (acción
   «limites»). Si la función no responde, cae a la consulta de solo lectura
   `pilo_my_limits()`: entonces se ven los topes pero no cuánto lleva usado.
   Nunca inventa un contador: sin uso conocido, no hay barra.

   `refreshKey` vuelve a leer cuando cambia (por ejemplo, el número de turnos
   del chat): así el aviso se actualiza después de cada pregunta.
   ========================================================================== */

import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import type { AccountState } from "../account/useAccount";
import { fetchLimitsUse } from "../carnet/api";
import type { LimitsConfig, LimitsUse } from "../carnet/api";
import { limitsView } from "./logic";
import type { SpaceView } from "./logic";

export const limitesKey = (userId: string | undefined) => ["pilo-limites", userId ?? "nadie"];

export interface Limites {
  /** Un bloque por Pilo, con sus renglones. Vacío mientras carga o si no se pudo. */
  spaces: SpaceView[];
  loading: boolean;
  /** Se leyeron los topes pero no el uso (la función no respondió). */
  noUsage: boolean;
  /** No se pudo leer nada. */
  failed: boolean;
  refresh: () => Promise<void>;
}

async function read(): Promise<{ config: LimitsConfig; uso: LimitsUse["uso"] | null }> {
  try {
    const out = await fetchLimitsUse();
    if (out?.config?.espacios) return { config: out.config, uso: out.uso ?? null };
  } catch {
    /* sin la función: solo lo configurado */
  }
  const { data, error } = await supabase.rpc("pilo_my_limits");
  if (error || !data?.espacios) throw new Error("limites");
  return { config: data as LimitsConfig, uso: null };
}

export function useLimites(state: AccountState, refreshKey: number | string = 0): Limites {
  const client = useQueryClient();
  const userId = state.account?.id;
  const enabled = state.member && Boolean(userId);
  const query = useQuery({ queryKey: limitesKey(userId), enabled, staleTime: 30_000, retry: false, queryFn: read });

  useEffect(() => {
    if (enabled) void client.invalidateQueries({ queryKey: limitesKey(userId) });
  }, [refreshKey, enabled, userId, client]);

  return {
    spaces: limitsView(query.data?.config ?? null, query.data?.uso ?? null),
    loading: enabled && query.isPending,
    noUsage: Boolean(query.data) && !query.data?.uso,
    failed: enabled && query.isError,
    refresh: () => client.invalidateQueries({ queryKey: limitesKey(userId) }),
  };
}
