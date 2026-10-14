/* =============================================================================
   Intranet · Mr. Pilo con IA · cómo razona Pilo (0130).

   Tres piezas, cada una con su interruptor y apagadas de partida:
   - las relaciones que ya hay en la base van en el pedido ([RELACIONES]);
   - cada capciosa lleva, revisado por la administración, qué da por cierto la
     pregunta y qué es cierto; la IA lo propone y solo lo aprobado se usa;
   - el análisis antes de responder, que nunca llega a quien pregunta.

   Aquí: los ajustes de un Pilo (pilo_ai_settings para el de siempre,
   pilo_spaces para los otros, con los mismos nombres) y las premisas de las
   capciosas (pilo_catalog_premises). Se aplican al momento, como el catálogo.
   Sin la migración 0130 no hay columnas ni tabla: `needs0130` apaga los
   controles y nada se manda a la base.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readFunctionError, supabase } from "../../../lib/supabase";
import { DEFAULT_SPACE, isDefaultSpace, spaceKey } from "./space";
import type { PiloSpace } from "./space";
import type { Tone } from "./ui";

/* --- Los ajustes ---------------------------------------------------------------------- */

/** Partida y margen de cada tope: los mismos de las restricciones pilo_ai_settings_reason y pilo_spaces_reason. */
export const REASON_LIMITS = {
  ask_relations_lines: { def: 12, min: 1, max: 40, whole: true },
  ask_relations_chars: { def: 1200, min: 200, max: 4000, whole: true },
  tricky_near_min: { def: 0.7, min: 0.5, max: 0.99, whole: false },
} as const;

export type ReasonLimitKey = keyof typeof REASON_LIMITS;

export interface ReasonValues {
  ask_relations: boolean;
  ask_relations_lines: number;
  ask_relations_chars: number;
  tricky_near: boolean;
  tricky_near_min: number;
  ask_analysis: boolean;
  /** La base aún no tiene la migración 0130 (relaciones, premisas y análisis). */
  needs0130?: boolean;
}

/** El valor dentro del margen (y entero si hace falta); lo que no es número vuelve a la partida. */
export function clampReason(key: ReasonLimitKey, value: unknown): number {
  const { def, min, max, whole } = REASON_LIMITS[key];
  const n = value === null || value === undefined || value === "" || typeof value === "boolean" ? NaN : Number(value);
  if (!Number.isFinite(n)) return def;
  const v = Math.min(max, Math.max(min, n));
  return whole ? Math.round(v) : Math.round(v * 100) / 100;
}

/**
 * La fila tal como venga, con los valores de partida para lo que falte: una
 * base sin 0130 no rompe la pantalla, y un interruptor solo está encendido si
 * la base dice `true`.
 */
export function normalizeReason(raw: Record<string, unknown> | null | undefined): ReasonValues {
  const r = raw ?? {};
  return {
    ask_relations: r.ask_relations === true,
    ask_relations_lines: clampReason("ask_relations_lines", r.ask_relations_lines),
    ask_relations_chars: clampReason("ask_relations_chars", r.ask_relations_chars),
    tricky_near: r.tricky_near === true,
    tricky_near_min: clampReason("tricky_near_min", r.tricky_near_min),
    ask_analysis: r.ask_analysis === true,
    needs0130: !("ask_relations" in r),
  };
}

/** Lo que se manda a la base: solo las columnas de 0130 y, sin esa migración, nada. */
export function reasonPatch(values: ReasonValues): Record<string, unknown> | null {
  if (values.needs0130) return null;
  const { needs0130: _needs, ...columns } = normalizeReason(values as unknown as Record<string, unknown>);
  return columns;
}

/** Lo que hace Pilo con esos interruptores, dicho en una línea. */
export function reasonSummary(v: ReasonValues): string {
  const on = [v.ask_relations ? "relaciones en el pedido" : "", v.tricky_near ? "capciosas cercanas" : "", v.ask_analysis ? "análisis antes de responder" : ""].filter(Boolean);
  if (!on.length) return "Todo apagado: Pilo pide y responde como siempre.";
  return `Encendido: ${on.join(", ")}.`;
}

const reasonKey = (space: PiloSpace) => ["pilo-ia", "razonamiento", ...spaceKey(space)] as const;

/** La tabla y la fila donde vive la configuración de ese Pilo. */
const homeOf = (space: PiloSpace) => (isDefaultSpace(space) ? { table: "pilo_ai_settings", id: 1 as number | string } : { table: "pilo_spaces", id: space as number | string });

export function useReason(space: PiloSpace = DEFAULT_SPACE) {
  return useQuery({
    queryKey: reasonKey(space),
    queryFn: async (): Promise<ReasonValues> => {
      const home = homeOf(space);
      // «*»: sin 0130 las columnas no existen y pedirlas por nombre fallaría.
      const { data, error } = await supabase.from(home.table as never).select("*").eq("id", home.id as never).maybeSingle();
      if (error || !data) return normalizeReason(null);
      return normalizeReason(data as Record<string, unknown>);
    },
  });
}

export function useSaveReason(space: PiloSpace = DEFAULT_SPACE) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (values: ReasonValues) => {
      const patch = reasonPatch(values);
      if (!patch) throw new Error("Falta aplicar la migración 0130 en la base.");
      const home = homeOf(space);
      const { error } = await supabase.from(home.table as never).update(patch as never).eq("id", home.id as never);
      if (error) throw new Error(error.message);
      return values;
    },
    // Se ve al momento; si la base lo rechaza, vuelve lo que ella tiene.
    onMutate: (values) => client.setQueryData(reasonKey(space), values),
    onError: () => client.invalidateQueries({ queryKey: reasonKey(space) }),
  });
}

/* --- Las premisas de las capciosas ------------------------------------------------------ */

export type PremiseStatus = "propuesta" | "aprobada";

export interface PremiseRow {
  key: string;
  /** Lo que la pregunta da por cierto. */
  premise: string;
  /** Lo que es cierto. */
  truth: string;
  status: PremiseStatus;
  /** Quién escribió el texto que hay. */
  origin: "ia" | "admin";
  reviewed_at: string | null;
}

/** Los márgenes de la base (pilo_catalog_premises_len y _approved). */
export const PREMISE_MAX = 400;
export const TRUTH_MAX = 600;
export const PREMISE_MIN = 8;

/** Una fila leída con cuidado; null si no trae clave. */
export function normalizePremise(raw: unknown): PremiseRow | null {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  if (typeof r.key !== "string" || !r.key) return null;
  return {
    key: r.key,
    premise: typeof r.premise === "string" ? r.premise : "",
    truth: typeof r.truth === "string" ? r.truth : "",
    status: r.status === "aprobada" ? "aprobada" : "propuesta",
    origin: r.origin === "admin" ? "admin" : "ia",
    reviewed_at: typeof r.reviewed_at === "string" ? r.reviewed_at : null,
  };
}

/** En qué va la premisa de una capciosa, con glifo y palabra. Solo la aprobada se usa al responder. */
export function premiseState(row: PremiseRow | null | undefined): { tone: Tone; label: string } {
  if (!row) return { tone: "off", label: "Sin premisa" };
  if (row.status === "aprobada") return { tone: "ok", label: "Premisa aprobada" };
  if (!row.premise.trim() && !row.truth.trim()) return { tone: "off", label: row.origin === "ia" ? "La IA no halló premisa" : "Sin premisa" };
  return { tone: "warn", label: row.origin === "ia" ? "Propuesta por la IA, sin aprobar" : "Sin aprobar" };
}

/** Por qué no se puede guardar (o aprobar) lo escrito; null si se puede. */
export function premiseProblem(premise: string, truth: string, approve: boolean): string | null {
  const p = premise.replace(/\s+/g, " ").trim();
  const t = truth.replace(/\s+/g, " ").trim();
  if (p.length > PREMISE_MAX) return `La premisa tiene ${p.length} caracteres (el máximo es ${PREMISE_MAX}).`;
  if (t.length > TRUTH_MAX) return `Lo cierto tiene ${t.length} caracteres (el máximo es ${TRUTH_MAX}).`;
  if (approve && (p.length < PREMISE_MIN || t.length < PREMISE_MIN)) return "Para aprobar hacen falta las dos frases: la premisa y lo que es cierto.";
  if (/\$\s?\d|\bpesos\b|\bcop\b|millones de pesos/i.test(`${p} ${t}`)) return "No se escriben cifras de dinero en las premisas.";
  return null;
}

/** Cuántas capciosas activas de un catálogo tienen premisa, propuesta o aprobada. */
export function premiseCounts(active: string[], premises: Record<string, PremiseRow>): { total: number; pending: number; proposed: number; approved: number } {
  const rows = active.map((key) => premises[key]);
  return {
    total: active.length,
    pending: rows.filter((r) => !r).length,
    proposed: rows.filter((r) => r?.status === "propuesta").length,
    approved: rows.filter((r) => r?.status === "aprobada").length,
  };
}

/** Cuelga de ["pilo-ia", "catalogo"]: al guardar una capciosa (que puede devolver su premisa a revisión) se lee de nuevo. */
const premisesKey = ["pilo-ia", "catalogo", "premisas"] as const;

const missing0130 = (message: string | undefined) => /could not find|does not exist|schema cache/i.test(message ?? "");

/** Las premisas, por clave. Sin 0130 (la tabla no existe), null. */
export async function fetchPremises(): Promise<Record<string, PremiseRow> | null> {
  const { data, error } = await supabase.from("pilo_catalog_premises" as never).select("key, premise, truth, status, origin, reviewed_at");
  if (error) return null;
  const out: Record<string, PremiseRow> = {};
  for (const raw of (data ?? []) as unknown[]) {
    const row = normalizePremise(raw);
    if (row) out[row.key] = row;
  }
  return out;
}

export function usePremises(enabled = true) {
  return useQuery({ queryKey: premisesKey, enabled, queryFn: fetchPremises });
}

/** Guardar lo escrito y, con `approve`, aprobarlo. Sin aprobar queda (o vuelve) en «propuesta» y deja de usarse. */
export function useSavePremise() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, premise, truth, approve }: { key: string; premise: string; truth: string; approve: boolean }) => {
      const problem = premiseProblem(premise, truth, approve);
      if (problem) throw new Error(problem);
      const { error } = await supabase.rpc("pilo_premise_save" as never, { p_key: key, p_premise: premise, p_truth: truth, p_approve: approve } as never);
      if (error) throw new Error(missing0130(error.message) ? "Falta aplicar la migración 0130 en la base." : error.message);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: premisesKey }),
  });
}

/** Borrar la premisa de una capciosa: la IA puede volver a proponerla. */
export function useClearPremise() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (key: string) => {
      const { error } = await supabase.rpc("pilo_premise_clear" as never, { p_key: key } as never);
      if (error) throw new Error(missing0130(error.message) ? "Falta aplicar la migración 0130 en la base." : error.message);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: premisesKey }),
  });
}

/** Lo que devuelve la función pilo-ia en cada lote de «premisas». */
export interface PremiseStep {
  ok?: boolean;
  ai?: boolean;
  asked?: number;
  proposed?: number;
  empty?: number;
  done?: boolean;
  stopped?: string;
  note?: string;
}

export interface PremiseRun {
  asked: number;
  proposed: number;
  empty: number;
  /** Por qué se detuvo antes de terminar, dicho por la función; vacío si terminó. */
  note: string;
}

/** A lo sumo, cuántos lotes seguidos pide la página (8 capciosas cada uno). */
export const PREMISE_ROUNDS = 25;

/** Suma un lote a la cuenta y dice si hay que pedir otro. */
export function premiseNext(run: PremiseRun, step: PremiseStep): { run: PremiseRun; more: boolean } {
  const asked = Number(step.asked ?? 0);
  const next = { asked: run.asked + asked, proposed: run.proposed + Number(step.proposed ?? 0), empty: run.empty + Number(step.empty ?? 0), note: step.note ?? "" };
  // Se detiene si la función lo dice, si ya no queda nada o si un lote no avanzó.
  return { run: next, more: !step.stopped && step.ai !== false && step.done !== true && asked > 0 };
}

/** «Proponer con la IA»: pide lotes a la función hasta revisar todas las capciosas de ese Pilo. */
export function useProposePremises(space: PiloSpace = DEFAULT_SPACE) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (onProgress?: (run: PremiseRun) => void): Promise<PremiseRun> => {
      let run: PremiseRun = { asked: 0, proposed: 0, empty: 0, note: "" };
      for (let i = 0; i < PREMISE_ROUNDS; i++) {
        // El espacio va siempre: es mantenimiento de un catálogo, y la función pide que se nombre.
        const { data, error } = await supabase.functions.invoke<PremiseStep>("pilo-ia", { body: { action: "premisas", space, step: "lote" } });
        if (error) throw new Error((await readFunctionError(error)) ?? "No pude hablar con Mr. Pilo ahora.");
        const next = premiseNext(run, data ?? {});
        run = next.run;
        onProgress?.(run);
        if (!next.more) break;
      }
      return run;
    },
    onSettled: () => client.invalidateQueries({ queryKey: premisesKey }),
  });
}
