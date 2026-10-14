/* =============================================================================
   Indicadores de Impacto · el modelo en la aplicación.

   Tipos de lo que guarda la base (0078) y las cuentas que la pantalla hace
   sobre ellos: el avance frente a una meta, el estado que se deduce de lo
   reportado y si la ficha o el reporte de un programa están completos.

   Nada de esto decide permisos: eso lo hace la base (RLS). Aquí solo se
   calcula lo que se ve.
   ========================================================================== */

export type SubstantiveFunction = "investigacion" | "ensenanza" | "extension";
export type Stage = "insumos" | "procesos" | "productos" | "impacto";
export type Measure = "numero" | "porcentaje" | "proporcion" | "dual" | "pesos" | "texto";
export type Direction = "sube" | "baja";
export type IndicatorStatus = "borrador" | "publicado" | "retirado";

export const FUNCTIONS: SubstantiveFunction[] = ["investigacion", "ensenanza", "extension"];
export const STAGES: Stage[] = ["insumos", "procesos", "productos", "impacto"];

export const FUNCTION_LABEL: Record<SubstantiveFunction, string> = {
  investigacion: "Investigación",
  ensenanza: "Enseñanza",
  extension: "Extensión",
};

/** El color de cada función ya existe en el sistema: las series del portal. */
export const FUNCTION_TONE: Record<SubstantiveFunction, string> = {
  investigacion: "var(--od-series-1)",
  ensenanza: "var(--od-series-3)",
  extension: "var(--od-series-2)",
};

export const STAGE_LABEL: Record<Stage, string> = {
  insumos: "Insumos",
  procesos: "Procesos",
  productos: "Productos",
  impacto: "Impacto real",
};

export const MEASURE_LABEL: Record<Measure, string> = {
  numero: "Número",
  porcentaje: "Porcentaje",
  proporcion: "Proporción",
  dual: "Número y proporción",
  pesos: "Pesos",
  texto: "Categoría o texto",
};

export const STATUS_LABEL: Record<IndicatorStatus, string> = {
  borrador: "Borrador",
  publicado: "Publicada",
  retirado: "Retirada",
};

/** Años que se capturan. La línea base suele ser 2023; las metas, 2026 y 2028. */
export const YEARS = [2022, 2023, 2024, 2025, 2026, 2027, 2028];
export const TARGET_YEARS = [2026, 2028] as const;

export interface Dimension {
  id: string;
  fn: SubstantiveFunction;
  name: string;
  position: number;
}

export interface Targets {
  baselineYear: number;
  baselineText: string;
  baselineNum: number | null;
  target2026: string;
  target2026Num: number | null;
  target2028: string;
  target2028Num: number | null;
}

export interface Indicator extends Targets {
  id: string;
  code: string;
  fn: SubstantiveFunction;
  stage: Stage;
  suggested: boolean;
  dimensionId: string | null;
  ownerUnitId: string;
  name: string;
  description: string;
  unitLabel: string;
  measure: Measure;
  numerator: string;
  denominator: string;
  direction: Direction;
  source: string;
  responsible: string;
  projectsText: string;
  cesu: string[];
  sheet: Record<string, unknown>;
  programReports: boolean;
  status: IndicatorStatus;
  position: number;
  updatedAt: string;
  /** Indicador propio de un programa en una sede (0084); null en las fichas institucionales. */
  programId: string | null;
  campusId: string | null;
  /** Ficha institucional con la que se relaciona un indicador de programa. */
  parentId: string | null;
  /** La vicerrectoría la pide a todos los programas (0085). */
  mandatory: boolean;
  /** Id en la hoja de la herramienta anterior, si vino de ella. */
  legacyId: string | null;
}

export interface IndicatorRef {
  indicatorId: string;
  dimensionId: string;
  stage: Stage;
  note: string;
}

export interface Adoption extends Targets {
  id: string;
  indicatorId: string;
  programId: string;
  campusId: string;
  active: boolean;
  updatedAt: string;
}

export interface Value {
  id: string;
  indicatorId: string;
  year: number;
  programId: string | null;
  campusId: string | null;
  valueNum: number | null;
  numerator: number | null;
  denominator: number | null;
  valueText: string;
  notApplicable: boolean;
  evidenceUrl: string;
  note: string;
  updatedAt: string;
}

export interface Alignment {
  id: string;
  indicatorId: string;
  target: "pilar" | "ods";
  pillarId: string | null;
  sdg: number | null;
  origin: "motor" | "matriz" | "manual";
  confirmed: boolean;
  score: number | null;
  matchedTerms: string[];
}

export interface CriterionRow {
  id: string;
  target: "pilar" | "ods";
  pillarId: string | null;
  sdg: number | null;
  term: string;
  weight: number;
}

export interface Pillar {
  id: string;
  position: number;
  numeral: string;
  name: string;
}

export interface ImpactUnit {
  id: string;
  parentId: string | null;
  kind: "vicerrectoria" | "facultad" | "programa" | "oficina" | "otra";
  code: string;
  name: string;
}

/** Un programa en una sede: la unidad con la que trabaja un programa. */
export interface ProgramSite {
  programId: string;
  campusId: string;
  programName: string;
  campusName: string;
  /** "fisioterapia:bucaramanga", para la dirección. */
  key: string;
}

/** Dónde vive una cifra: la global de la unidad dueña o la de un programa en una sede. */
export type Scope = { kind: "global" } | { kind: "sitio"; programId: string; campusId: string };

export const scopeKey = (scope: Scope) => (scope.kind === "global" ? "global" : `${scope.programId}|${scope.campusId}`);
export const valueScopeKey = (v: Pick<Value, "programId" | "campusId">) =>
  v.programId && v.campusId ? `${v.programId}|${v.campusId}` : v.campusId ? `sede|${v.campusId}` : "global";

/** ¿Es una ficha institucional (no un indicador propio de un programa)? */
export const isInstitutional = (i: Pick<Indicator, "programId">) => !i.programId;

/* --- Cifras -------------------------------------------------------------------- */

/**
 * Lee lo que alguien escribió como cifra: "78", "78,5", "78%", "$ 1.500.000".
 * Devuelve null si no es un número, para que el texto vaya a `value_text`.
 */
export function parseFigure(raw: string): number | null {
  const text = raw.trim().replace(/[$%\s]/g, "");
  if (!text) return null;
  if (!/^-?[0-9.,]+$/.test(text)) return null;
  let normalized = text;
  if (text.includes(",")) normalized = text.replace(/\./g, "").replace(",", ".");
  else if (/^-?[0-9]{1,3}(\.[0-9]{3})+$/.test(text)) normalized = text.replace(/\./g, "");
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

/**
 * El número de una meta escrita como texto, si lo tiene sin ambigüedad:
 * "72%" → 72, "≥ 80%" → 80, "0,22" → 0.22. "+2 pp vs LB" o "Reducir 2%"
 * dependen de otra cifra y no dan número: su avance no se calcula solo.
 */
export function parseTarget(text: string): number | null {
  return parseFigure(text.replace(/^\s*(≥|≤|>=|<=|>|<)\s*/, ""));
}

const NUMBER = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** La cifra como se lee, con la unidad que pide su forma de medir. */
export function formatFigure(value: number | null | undefined, measure: Measure): string {
  if (value === null || value === undefined) return "";
  if (measure === "pesos") return `$${NUMBER.format(value)}`;
  if (measure === "porcentaje") return `${NUMBER.format(value)}%`;
  return NUMBER.format(value);
}

/** Lo que muestra una celda: la cifra, el texto, "N/A" o nada. */
export function displayValue(value: Value | undefined, measure: Measure): string {
  if (!value) return "";
  if (value.notApplicable) return "N/A";
  if (value.valueNum !== null) return formatFigure(value.valueNum, measure);
  return value.valueText;
}

/**
 * Cuánto va de la meta, en porcentaje (0–∞). Solo si la meta es un número.
 * Para lo que debe bajar (deserción), llegar a la meta es 100 % y quedarse
 * por encima de ella es menos.
 */
export function progress(value: number | null, target: number | null, direction: Direction = "sube"): number | null {
  if (value === null || target === null) return null;
  if (direction === "sube") return target === 0 ? null : Math.round((value / target) * 100);
  if (value === 0) return 100;
  return Math.round((target / value) * 100);
}

export type ReportState = "sin_dato" | "sin_iniciar" | "en_proceso" | "cumplida" | "completo" | "no_aplica";

export const REPORT_STATE_LABEL: Record<ReportState, string> = {
  sin_dato: "Sin dato",
  sin_iniciar: "Sin iniciar",
  en_proceso: "En proceso",
  cumplida: "Cumplida",
  completo: "Completo",
  no_aplica: "No aplica",
};

/** El estado de una cifra frente a su meta en un año. */
export function stateAgainstTarget(value: Value | undefined, target: number | null, direction: Direction): ReportState {
  if (!value) return "sin_dato";
  if (value.notApplicable) return "no_aplica";
  if (value.valueNum === null && !value.valueText) return "sin_dato";
  const pct = progress(value.valueNum, target, direction);
  if (pct !== null && pct >= 100) return "cumplida";
  return "en_proceso";
}

/** El último año con cifra, para mostrar "la cifra de la UDES". */
export function latestValue(values: Value[]): Value | undefined {
  return [...values]
    .filter((v) => !v.notApplicable && (v.valueNum !== null || v.valueText))
    .sort((a, b) => b.year - a.year)[0];
}

/* --- Reporte de un programa ----------------------------------------------------- */

/** Año de corte que exige "Completo": por ahora 2026, como la herramienta anterior. */
export const COMPLETE_YEAR = 2026;

/**
 * Qué le falta a un programa para dejar un indicador completo: línea base,
 * metas 2026 y 2028, la cifra del año de corte y un enlace de evidencia.
 */
export function missingForComplete(adoption: Adoption, values: Value[]): string[] {
  const missing: string[] = [];
  if (!adoption.baselineText && adoption.baselineNum === null) missing.push("Línea base");
  if (!adoption.target2026 && adoption.target2026Num === null) missing.push("Meta 2026");
  if (!adoption.target2028 && adoption.target2028Num === null) missing.push("Meta 2028");
  const cut = values.find((v) => v.year === COMPLETE_YEAR);
  if (!cut || (!cut.notApplicable && cut.valueNum === null && !cut.valueText)) missing.push(`Cifra ${COMPLETE_YEAR}`);
  if (!values.some((v) => /^https?:\/\//i.test(v.evidenceUrl))) missing.push("Evidencia (enlace)");
  return missing;
}

/** El estado de lo que reporta un programa sobre un indicador que adoptó. */
export function programState(adoption: Adoption, values: Value[]): ReportState {
  if (missingForComplete(adoption, values).length === 0) return "completo";
  const reported = values.some((v) => !v.notApplicable && (v.valueNum !== null || v.valueText));
  return reported ? "en_proceso" : "sin_iniciar";
}

/* --- La ficha ------------------------------------------------------------------- */

/** Lo que le falta a una ficha para considerarse completa. */
export function missingInSheet(indicator: Indicator): string[] {
  const missing: string[] = [];
  if (!indicator.description.trim()) missing.push("Qué mide");
  if (!indicator.unitLabel.trim()) missing.push("Unidad de medida");
  if (!indicator.dimensionId) missing.push("Dimensión");
  if (!indicator.baselineText && indicator.baselineNum === null) missing.push("Línea base");
  if (!indicator.target2026) missing.push("Meta 2026");
  if (!indicator.target2028) missing.push("Meta 2028");
  if (!indicator.source.trim()) missing.push("Fuente");
  return missing;
}

/** El siguiente código libre de una función: E30 después de E29. */
export function nextCode(fn: SubstantiveFunction, indicators: Pick<Indicator, "code">[]): string {
  const prefix = fn === "investigacion" ? "I" : fn === "ensenanza" ? "E" : "X";
  const used = indicators
    .map((i) => i.code.match(new RegExp(`^${prefix}(\\d+)$`)))
    .filter(Boolean)
    .map((m) => Number(m![1]));
  const next = (used.length ? Math.max(...used) : 0) + 1;
  return `${prefix}${String(next).padStart(2, "0")}`;
}

/** Orden de la cadena: eslabón, luego posición, luego código. */
export function byChain(a: Indicator, b: Indicator): number {
  return STAGES.indexOf(a.stage) - STAGES.indexOf(b.stage) || a.position - b.position || a.code.localeCompare(b.code);
}

/**
 * El mensaje de un error para la pantalla: el amable y, si la base dijo otra
 * cosa, sus palabras exactas entre paréntesis, para poder diagnosticar.
 */
export function errorText(error: unknown): string {
  if (!error) return "";
  const e = error as { message?: string; original?: string };
  const message = e.message ?? String(error);
  return e.original && e.original !== message ? `${message} (${e.original})` : message;
}
