/* =============================================================================
   Mr. Pilo · el mapa global: lo que se lee.

   Solo administración: las mismas funciones de siempre, una vez por espacio, y
   desde 0122 los puentes guardados.

     pilo_graph_overview(null)                       la malla de Pregúntele a Pilo (0097)
     pilo_graph_overview(['mapa'], 'ensenanza')      el mapa de Pilo en Enseñanza (0113, 0115)
     pilo_docs (id, origin)                          qué documentos son cursos de Moodle (0114)
     pilo_map_status('ensenanza')                    cuánto se ha comprendido (0115)
     pilo_bridges_list()                             los puentes, con su origen y su estado (0122)

   Cada lado dice por su cuenta si le falta una migración: el otro se dibuja igual.
   Sin 0122 los puentes se calculan al dibujar, como antes.

   Lo único que se escribe desde aquí son los puentes, y siempre por la base:
     pilo_bridge_set(id, estado)                     aprobar o rechazar UNO (solo administración)
     pilo-ia «puentes»                               recalcular los de reglas y pedirle a la IA
                                                     que proponga (entran como propuesta)
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MeshEdge } from "../../../../components/pilo/ai/logic";
import { supabase } from "../../../../lib/supabase";
import type { ViewNode } from "../mesh-view";
import type { RawEdge, RawNode } from "../../pilo-ensenanza/memoria/map";
import { StepError, faultFrom } from "../../pilo-ensenanza/memoria/flow";
import { parseBridges } from "./global";
import type { StoredBridge } from "./global";

export interface SideState<T> {
  /** Lo leído; null si no se pudo. */
  data: T | null;
  /** La migración que falta, si es eso. */
  missing: string | null;
  /** Otro error, en palabras. */
  error: string | null;
}

export interface GlobalStatus {
  total: number;
  mapped: number;
  pending: number;
  topics: number;
  refs: number;
}

export interface GlobalData {
  planeacion: SideState<{ nodes: ViewNode[]; edges: MeshEdge[] }>;
  ensenanza: SideState<{ nodes: RawNode[]; edges: RawEdge[]; courses: string[]; status: GlobalStatus | null }>;
  /** Los puentes guardados (0122). Sin esa migración, `data` es null y `missing` lo dice: se calculan al dibujar. */
  bridges: SideState<StoredBridge[]>;
}

interface DbError {
  code?: string;
  message?: string;
}

const GONE = ["PGRST202", "PGRST205", "PGRST204", "42P01", "42883", "42703"];

/** ¿El error dice «eso no existe»? Entonces falta una migración. */
export const isMissing = (error: DbError | null | undefined) =>
  Boolean(error) && (GONE.includes(error!.code ?? "") || /could not find the (table|function)|does not exist/i.test(error!.message ?? ""));

const fail = <T,>(error: DbError, migration: string): SideState<T> =>
  isMissing(error) ? { data: null, missing: migration, error: null } : { data: null, missing: null, error: error.code === "42501" ? "Solo la administración ve el mapa." : error.message || "No se pudo leer." };

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function readPlaneacion(): Promise<GlobalData["planeacion"]> {
  // Las cinco fuentes de portal, por su nombre: el mapa de los documentos del Pilo general (0121) aún no se dibuja aquí.
  const { data, error } = await supabase.rpc("pilo_graph_overview" as never, { p_sources: ["cifras", "boletines", "pdi", "observatorio", "impacto"] } as never);
  if (error) return fail(error, "0097");
  const m = (data ?? {}) as { nodes?: unknown; edges?: unknown };
  return { data: { nodes: list<ViewNode>(m.nodes), edges: list<MeshEdge>(m.edges) }, missing: null, error: null };
}

async function readEnsenanza(): Promise<GlobalData["ensenanza"]> {
  const mesh = await supabase.rpc("pilo_graph_overview" as never, { p_sources: ["mapa"], p_space: "ensenanza" } as never);
  if (mesh.error) return fail(mesh.error, "0113");
  const m = (mesh.data ?? {}) as { nodes?: unknown; edges?: unknown };
  // Los cursos y el estado son un adorno del mapa: si no se pueden leer, el mapa se dibuja igual.
  const docs = await supabase.from("pilo_docs").select("id, origin").eq("space", "ensenanza").eq("origin", "moodle").limit(2000);
  const status = await supabase.rpc("pilo_map_status" as never, { p_space: "ensenanza" } as never);
  const s = (status.data ?? null) as Record<string, unknown> | null;
  return {
    data: {
      nodes: list<RawNode>(m.nodes),
      edges: list<RawEdge>(m.edges),
      courses: list<{ id: string }>(docs.data).map((d) => `doc:${String(d.id).toLowerCase()}`),
      status: status.error || !s ? null : { total: num(s.total), mapped: num(s.mapped), pending: num(s.pending), topics: num(s.topics), refs: num(s.refs) },
    },
    missing: status.error && isMissing(status.error) ? "0115" : null,
    error: null,
  };
}

async function readBridges(): Promise<GlobalData["bridges"]> {
  const { data, error } = await supabase.rpc("pilo_bridges_list" as never, {} as never);
  if (error) return fail(error, "0122");
  return { data: parseBridges(data), missing: null, error: null };
}

export const GLOBAL_MAP_KEY = ["pilo-ia", "memoria", "mapa-global"] as const;

/** Las dos mallas, leídas a la vez. */
export function useGlobalMap(enabled = true) {
  return useQuery({
    queryKey: GLOBAL_MAP_KEY,
    enabled,
    staleTime: 30_000,
    queryFn: async (): Promise<GlobalData> => {
      const [planeacion, ensenanza, bridges] = await Promise.all([readPlaneacion(), readEnsenanza(), readBridges()]);
      return { planeacion, ensenanza, bridges };
    },
  });
}

/** Los pasajes de un documento de Enseñanza, en orden. Solo lectura, dentro de su espacio. */
export function useDocRefs(doc: string | null) {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "mapa-global", "pasajes-de", doc],
    enabled: Boolean(doc),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("pilo_memory").select("ref, section").eq("space", "ensenanza").eq("doc_id", doc!).limit(450);
      if (error) throw error;
      const seq = (ref: string) => Number(ref.slice(ref.lastIndexOf(":") + 1)) || 0;
      return ((data ?? []) as { ref: string; section: string }[]).map((r) => ({ ref: r.ref, section: r.section, seq: seq(r.ref) })).sort((a, b) => a.seq - b.seq);
    },
  });
}

/* --- Los puentes: decidir, recalcular y proponer (0122) ------------------------------------- */

/** Aprobar o rechazar UN puente. La base lo hace solo si quien llama es de la administración. */
export function useBridgeSet() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: "aprobada" | "rechazada" }) => {
      const { error } = await supabase.rpc("pilo_bridge_set" as never, { p_id: id, p_status: status } as never);
      if (error) throw new Error(isMissing(error) ? "Falta aplicar la migración 0122 en la base." : error.code === "42501" ? "Solo la administración aprueba o rechaza un puente." : error.message || "No se pudo guardar la decisión.");
    },
    onSettled: () => void client.invalidateQueries({ queryKey: GLOBAL_MAP_KEY }),
  });
}

export interface BridgeCounts {
  total: number;
  aprobadas: number;
  propuestas: number;
  rechazadas: number;
  /** Puntos de Planeación que la IA aún no revisó. */
  pending: number;
  /** Contra cuántos documentos, temas y referencias del otro ámbito se comparan. */
  targets: number;
}

export interface BridgeStepResult {
  ok?: boolean;
  /** ¿Hay IA para proponer? Sin ella, los puentes por reglas siguen funcionando. */
  ai?: boolean;
  note?: string;
  /** «lote»: cuántos puntos se revisaron, cuántos puentes se propusieron y cuántos descartó la base. */
  asked?: number;
  proposed?: number;
  discarded?: number;
  calls?: number;
  done?: boolean;
  stopped?: string;
  cut?: string;
  /** «reglas»: lo que calculó la base. */
  rules?: { found?: number; added?: number; removed?: number };
  status?: Partial<BridgeCounts>;
}

/** Un paso de «puentes» en la función pilo-ia: «estado», «reglas» (sin IA) o «lote» (la IA propone). */
export async function bridgeStep(step: "estado" | "reglas" | "lote"): Promise<BridgeStepResult> {
  const { data, error } = await supabase.functions.invoke<BridgeStepResult>("pilo-ia", { body: { action: "puentes", step } });
  if (!error) return (data ?? {}) as BridgeStepResult;
  const response = (error as { context?: Response }).context;
  let parsed: { error?: unknown; advice?: unknown; code?: unknown } | null = null;
  let status = 0;
  if (response && typeof response.json === "function") {
    status = response.status;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
  }
  throw new StepError(faultFrom(status, parsed));
}

export const BRIDGE_STATE_KEY = [...GLOBAL_MAP_KEY, "puentes", "estado"] as const;

/** ¿Hay IA para proponer puentes, y cuánto falta por revisar? */
export function useBridgeState(enabled = true) {
  return useQuery({ queryKey: BRIDGE_STATE_KEY, enabled, retry: false, staleTime: 30_000, queryFn: () => bridgeStep("estado") });
}

const whole = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

/** Los contadores de un paso, leídos con cuidado. */
export const bridgeCountsOf = (s: Partial<BridgeCounts> | null | undefined): BridgeCounts => ({
  total: whole(s?.total),
  aprobadas: whole(s?.aprobadas),
  propuestas: whole(s?.propuestas),
  rechazadas: whole(s?.rechazadas),
  pending: whole(s?.pending),
  targets: whole(s?.targets),
});
