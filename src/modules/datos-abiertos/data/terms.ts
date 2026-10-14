/* =============================================================================
   Datos Abiertos · periodos académicos 1 y 2.

   Cada año tiene dos periodos académicos y los indicadores se reportan por
   periodo. En la base se guardan como A y B; en pantalla y en papel se
   numeran: 2024-1 y 2024-2 (ver termLabel y periodText). La cifra del año no
   se guarda: sale de los dos periodos según la regla anual del indicador. Esta es la única implementación de esa regla; la usan el
   catálogo del portal y la rejilla de captura de la intranet, así que lo que
   Planeación ve al cargar es lo que el público ve al consultar.
   ========================================================================== */

export type Term = "A" | "B";
export const TERMS: Term[] = ["A", "B"];

/** Número visible del periodo: A es el 1, B es el 2. */
export const termLabel = (term: Term): string => (term === "A" ? "1" : "2");

/**
 * Rótulo visible de un periodo guardado como texto ("2020-A", "2014-B a
 * 2023-A"): los periodos se numeran. Deja igual lo que no es un periodo.
 */
export const periodText = (text: string | number): string =>
  String(text).replace(/\b(\d{4})-([AB])(?![A-Za-z0-9])/g, (_, year: string, term: Term) => `${year}-${termLabel(term)}`);

export type AnnualRule = "suma" | "ultimo" | "promedio" | "reportado";

export const ANNUAL_RULE_LABEL: Record<AnnualRule, string> = {
  suma: "Suma de los periodos 1 y 2",
  ultimo: "Último periodo reportado",
  promedio: "Promedio de los periodos 1 y 2",
  reportado: "Se reporta aparte",
};

/** Para qué sirve cada regla, en una línea (formulario del indicador). */
export const ANNUAL_RULE_HINT: Record<AnnualRule, string> = {
  suma: "Flujos del año: graduados, admitidos, eventos.",
  ultimo: "Existencias al cierre: matrícula, docentes, programas. Si falta el periodo 2, se toma el 1.",
  promedio: "Tasas y promedios: retención, deserción, relación estudiantes por docente.",
  reportado: "La cifra del año no se deduce de los periodos 1 y 2: se captura en su propia columna.",
};

export interface AnnualFigure {
  value: number | null;
  /** Periodo del que salió la cifra cuando la regla toma uno solo. */
  from?: Term;
}

// Evita arrastrar errores de coma flotante (0,1 + 0,2) a la cifra publicada.
const clean = (value: number) => Math.round(value * 1e6) / 1e6;

export function annualFigure(rule: AnnualRule, a: number | null, b: number | null, reported: number | null): AnnualFigure {
  switch (rule) {
    case "suma":
      return { value: a !== null && b !== null ? clean(a + b) : null };
    case "promedio":
      return { value: a !== null && b !== null ? clean((a + b) / 2) : null };
    case "ultimo":
      if (b !== null) return { value: b, from: "B" };
      if (a !== null) return { value: a, from: "A" };
      return { value: null };
    case "reportado":
      return { value: reported };
  }
}

/**
 * Un corte como número, para las gráficas que ordenan y eligen por número:
 * 2024 es el año; 20241 y 20242 son sus periodos 1 y 2.
 */
export function cutCode(year: number, term: Term | null | undefined): number {
  return term ? year * 10 + (term === "A" ? 1 : 2) : year;
}

export function fromCutCode(code: number): { year: number; term: Term | null } {
  return code > 9999 ? { year: Math.floor(code / 10), term: code % 10 === 1 ? "A" : "B" } : { year: code, term: null };
}

export const cutCodeLabel = (code: number): string => {
  const { year, term } = fromCutCode(code);
  return cutLabel(year, term);
};

/**
 * Corte "todo el periodo": no es un año. El catálogo guarda en esta clave las
 * cifras agrupadas de todos los años (ver `withPeriodView` en open-data.ts),
 * así cada bloque la lee como un corte más. Es el corte por defecto.
 */
export const ALL_YEARS = 0;

// Rótulo del periodo ("2020–2025"): lo fija el catálogo al cargarse.
let periodSpan = "todo el periodo";
export function setPeriodSpan(first: number, last: number) {
  periodSpan = first === last ? String(first) : `${first}–${last}`;
}

/** "2024", "2024-1" o, para todo el periodo, "2020–2025". */
export function cutLabel(year: number, term: Term | null | undefined): string {
  if (year === ALL_YEARS) return periodSpan;
  return term ? `${year}-${termLabel(term)}` : String(year);
}

/** El corte anterior comparable: el año anterior, o el mismo periodo del año anterior. */
export function previousCutLabel(year: number, term: Term | null | undefined): string {
  return cutLabel(year - 1, term);
}

/** Qué hay detrás de una cifra anual, dicho para el boleto: "periodos 1 + 2", "periodo 2". */
export function annualBasis(rule: AnnualRule | undefined, from: Term | undefined): string | null {
  if (!rule) return null;
  if (rule === "suma") return "periodos 1 + 2";
  if (rule === "promedio") return "promedio de los periodos 1 y 2";
  if (rule === "ultimo") return from ? `periodo ${termLabel(from)}` : null;
  return null;
}

/** Cómo llega la cifra: por periodo académico (A y B) o una sola cifra por año. */
export type Reporting = "periodo" | "anual";

export const REPORTING_LABEL: Record<Reporting, string> = {
  periodo: "Por periodo (1 y 2)",
  anual: "Por año",
};

export const REPORTING_HINT: Record<Reporting, string> = {
  periodo: "Se capturan los periodos 1 y 2; la cifra del año sale de la regla.",
  anual: "Se captura una sola cifra por año, sin periodos 1 y 2.",
};
