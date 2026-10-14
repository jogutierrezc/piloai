/* =============================================================================
   Datos Abiertos · Motor Beta: Saber 11 → Saber TyT (0035).

   El segundo modelo de análisis del portal. El de Saber PRO mira una prueba
   contra el promedio del país; este mira dos pruebas de la misma persona y
   mide lo que la universidad agregó entre la entrada y la salida.

   1. Rango percentil. Los puntajes crudos no se comparan entre pruebas (Saber
      11 califica cada módulo de 0 a 100 y su global de 0 a 500; Saber TyT, de
      0 a 200). Cada puntaje se convierte en su percentil dentro de la cohorte
      histórica de la universidad en esa prueba y esa competencia. La curva que
      traduce puntaje a percentil viaja con el conjunto (`benchmarks`), así que
      la lectura es reproducible y se rehace cuando llega un año nuevo.
   2. Homologación de nodos: matemáticas ↔ razonamiento cuantitativo, sociales
      y ciudadanas ↔ competencias ciudadanas, lectura crítica e inglés con su
      par, y el global con el global.
   3. Valor agregado (VAI): percentil de salida menos percentil de entrada.
   4. Tránsito: de qué cuarto de la distribución de entrada a qué cuarto de la
      de salida pasó cada quien, y la nube entrada × salida en celdas de 5
      percentiles, para dibujarla con su diagonal sin guardar a nadie.
   ========================================================================== */

import { emptyAlpha, expectedOf, fitLinear, fitPredictors, planeCell, quadrantOf } from "./saber-alpha";
import type { AlphaData, AlphaFigures, AlphaFit, AlphaPredictor } from "./saber-alpha";

export type TytCompetency = "global" | "lc" | "rc" | "cc" | "ce" | "ing" | "cn";
export type TytLevel = "tecnologico" | "tecnico_profesional" | "universitario";

export const TYT_LEVEL_LABEL: Record<TytLevel, string> = {
  tecnologico: "Tecnológico",
  tecnico_profesional: "Técnico profesional",
  universitario: "Universitario",
};

export interface TytCompetencyInfo {
  key: TytCompetency;
  label: string;
  /** Dos letras del tablero. */
  code: string;
  /** Cómo se llama en la prueba de entrada; vacío si no existe allí. */
  entry: string;
  /** Cómo se llama en la prueba de salida; vacío si no existe allí. */
  exit: string;
}

/** Orden fijo: primero el global, luego las competencias con pareja. */
export const TYT_COMPETENCIES: TytCompetencyInfo[] = [
  { key: "global", label: "Puntaje global", code: "PG", entry: "Puntaje global Saber 11", exit: "Puntaje global Saber TyT" },
  { key: "lc", label: "Lectura crítica", code: "LC", entry: "Lectura crítica", exit: "Lectura crítica" },
  { key: "rc", label: "Razonamiento cuantitativo", code: "RC", entry: "Matemáticas", exit: "Razonamiento cuantitativo" },
  { key: "cc", label: "Competencias ciudadanas", code: "CC", entry: "Sociales y ciudadanas", exit: "Competencias ciudadanas" },
  { key: "ing", label: "Inglés", code: "IN", entry: "Inglés", exit: "Inglés" },
  { key: "ce", label: "Comunicación escrita", code: "CE", entry: "", exit: "Comunicación escrita" },
  { key: "cn", label: "Ciencias naturales", code: "CN", entry: "Ciencias naturales", exit: "" },
];

export const tytInfo = (key: TytCompetency) => TYT_COMPETENCIES.find((c) => c.key === key)!;
/** Las que se pueden seguir de la entrada a la salida. */
export const isPaired = (key: TytCompetency) => Boolean(tytInfo(key).entry && tytInfo(key).exit);

/* --- Rango percentil ------------------------------------------------------------- */

/** Puntaje crudo en cada percentil, de 5 en 5 (21 valores, de 0 a 100). */
export interface TytBenchmark {
  entrada: number[];
  salida: number[];
}
export type TytBenchmarks = Partial<Record<TytCompetency, TytBenchmark>>;

export const PERCENTILE_STEP = 5;

const round2 = (n: number) => Math.round(n * 100) / 100;

const quantile = (sorted: number[], q: number) => {
  const at = (sorted.length - 1) * q;
  const low = Math.floor(at);
  const high = Math.ceil(at);
  return round2(sorted[low] + (sorted[high] - sorted[low]) * (at - low));
};

/** La curva de una prueba: el puntaje que deja por debajo a cada 5 % del grupo. */
export function buildCurve(scores: number[]): number[] | null {
  const sorted = scores.filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  if (sorted.length < 8) return null;
  return Array.from({ length: 100 / PERCENTILE_STEP + 1 }, (_, i) => quantile(sorted, (i * PERCENTILE_STEP) / 100));
}

/** Percentil (0-100) de un puntaje dentro de su curva, interpolando entre los cortes. */
export function percentileOf(curve: number[] | undefined, score: number | null): number | null {
  if (!curve || curve.length < 2 || score === null || !Number.isFinite(score)) return null;
  if (score <= curve[0]) return 0;
  if (score >= curve[curve.length - 1]) return 100;
  for (let i = 1; i < curve.length; i += 1) {
    if (score <= curve[i]) {
      const span = curve[i] - curve[i - 1];
      const within = span === 0 ? 0 : (score - curve[i - 1]) / span;
      return round2((i - 1 + within) * PERCENTILE_STEP);
    }
  }
  return 100;
}

/** En qué cuarto de la distribución cae un percentil: "1" el más bajo, "4" el más alto. */
export const quarterOf = (percentile: number) => String(Math.min(4, Math.floor(percentile / 25) + 1));

export const QUARTER_LABEL: Record<string, string> = {
  "1": "Cuarto bajo",
  "2": "Cuarto medio bajo",
  "3": "Cuarto medio alto",
  "4": "Cuarto alto",
};

/* --- Lo que guarda la base --------------------------------------------------------- */

export interface TytResult {
  year: number;
  level: TytLevel;
  /** "" es todo el nivel. */
  program: string;
  competency: TytCompetency;
  evaluated: number | null;
  /** Percentil medio de salida. */
  meanExit: number | null;
  paired: number | null;
  /** Percentil medio de entrada de los pareados. */
  meanEntry: number | null;
  /** Valor agregado: salida menos entrada, en puntos de percentil. */
  meanDelta: number | null;
  improved: number | null;
  rawEntry: number | null;
  rawExit: number | null;
  transitions: Record<string, Record<string, number>>;
  /** VAI en tramos de 5 puntos: "-5" es [-5, 0). */
  histogram: Record<string, number>;
  /** Nube entrada × salida en celdas de 5 percentiles: "30|55". */
  scatter: Record<string, number>;
  /** Motor Alpha: esperado, real, valor agregado, plano y cuadrantes (0037). */
  alphaN: number | null;
  alphaExpected: number | null;
  alphaActual: number | null;
  alphaVa: number | null;
  alphaPositive: number | null;
  plane: Record<string, number>;
  quadrants: Record<string, number>;
  /** Nube Saber 11|Saber TyT en celdas de 5 puntos: el plano de cuadrantes. */
  quadPlane: Record<string, number>;
}

export interface SaberTytData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  note: string;
  source: string;
  officeId?: string | null;
  benchmarks: TytBenchmarks;
  /** Motor Alpha: coeficientes por competencia y promedios nacionales. */
  alpha: AlphaData;
  results: TytResult[];
}

export interface TytFilter {
  program?: string;
  level?: TytLevel;
}

export interface TytFigure {
  year: number | null;
  evaluated: number;
  meanExit: number | null;
  paired: number;
  meanEntry: number | null;
  /** Valor agregado del corte. */
  meanDelta: number | null;
  improved: number;
  /** % de los pareados que subió de percentil. */
  improvedShare: number | null;
  rawEntry: number | null;
  rawExit: number | null;
  transitions: Record<string, Record<string, number>>;
  histogram: Record<string, number>;
  scatter: Record<string, number>;
  alpha: AlphaFigures;
}

export const tytYears = (data: SaberTytData): number[] => Array.from(new Set(data.results.map((r) => r.year))).sort((a, b) => a - b);

export const tytLevels = (data: SaberTytData): TytLevel[] =>
  (["tecnico_profesional", "tecnologico", "universitario"] as TytLevel[]).filter((l) => data.results.some((r) => r.level === l && r.program !== ""));

/** Programas con resultados, en orden alfabético. */
export function tytPrograms(data: SaberTytData, level?: TytLevel): { name: string; level: TytLevel }[] {
  const seen = new Map<string, TytLevel>();
  for (const r of data.results) {
    if (!r.program || (level && r.level !== level)) continue;
    if (!seen.has(r.program)) seen.set(r.program, r.level);
  }
  return Array.from(seen.entries())
    .map(([name, at]) => ({ name, level: at }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

const matches = (r: TytResult, filter: TytFilter) =>
  r.program !== "" && (!filter.program || r.program === filter.program) && (!filter.level || r.level === filter.level);

/**
 * Cifra de un corte; `year` en null agrupa todos los años. Los percentiles se
 * ponderan por evaluados: el de salida por los presentados, el de entrada y el
 * valor agregado por los que tienen las dos pruebas.
 */
export function tytFigure(data: SaberTytData, competency: TytCompetency, year: number | null, filter: TytFilter = {}): TytFigure | null {
  const parts = data.results.filter((r) => r.competency === competency && (year === null || r.year === year) && matches(r, filter));
  if (!parts.length) return null;

  let evaluated = 0;
  let paired = 0;
  let improved = 0;
  const sums = { exit: 0, exitW: 0, entry: 0, entryW: 0, delta: 0, deltaW: 0, rawEntry: 0, rawEntryW: 0, rawExit: 0, rawExitW: 0 };
  const transitions: Record<string, Record<string, number>> = {};
  const histogram: Record<string, number> = {};
  const scatter: Record<string, number> = {};
  const plane: Record<string, number> = {};
  const quadrants: Record<string, number> = {};
  const quadPlane: Record<string, number> = {};
  let alphaN = 0;
  let alphaPositive = 0;
  const alphaSums = { expected: 0, actual: 0, va: 0 };
  for (const part of parts) {
    const n = part.evaluated ?? 0;
    const pair = part.paired ?? 0;
    evaluated += n;
    paired += pair;
    improved += part.improved ?? 0;
    if (part.meanExit !== null && n > 0) {
      sums.exit += part.meanExit * n;
      sums.exitW += n;
    }
    if (part.rawExit !== null && n > 0) {
      sums.rawExit += part.rawExit * n;
      sums.rawExitW += n;
    }
    if (part.meanEntry !== null && pair > 0) {
      sums.entry += part.meanEntry * pair;
      sums.entryW += pair;
    }
    if (part.rawEntry !== null && pair > 0) {
      sums.rawEntry += part.rawEntry * pair;
      sums.rawEntryW += pair;
    }
    if (part.meanDelta !== null && pair > 0) {
      sums.delta += part.meanDelta * pair;
      sums.deltaW += pair;
    }
    for (const [from, row] of Object.entries(part.transitions)) {
      const at = (transitions[from] ??= {});
      for (const [to, count] of Object.entries(row)) at[to] = (at[to] ?? 0) + count;
    }
    for (const [bin, count] of Object.entries(part.histogram)) histogram[bin] = (histogram[bin] ?? 0) + count;
    for (const [cell, count] of Object.entries(part.scatter)) scatter[cell] = (scatter[cell] ?? 0) + count;
    for (const [cell, count] of Object.entries(part.plane)) plane[cell] = (plane[cell] ?? 0) + count;
    for (const [q, count] of Object.entries(part.quadrants)) quadrants[q] = (quadrants[q] ?? 0) + count;
    for (const [cell, count] of Object.entries(part.quadPlane ?? {})) quadPlane[cell] = (quadPlane[cell] ?? 0) + count;
    const an = part.alphaN ?? 0;
    if (an > 0) {
      alphaN += an;
      alphaPositive += part.alphaPositive ?? 0;
      if (part.alphaExpected !== null) alphaSums.expected += part.alphaExpected * an;
      if (part.alphaActual !== null) alphaSums.actual += part.alphaActual * an;
      if (part.alphaVa !== null) alphaSums.va += part.alphaVa * an;
    }
  }
  return {
    year,
    evaluated,
    paired,
    improved,
    meanExit: sums.exitW ? round2(sums.exit / sums.exitW) : null,
    meanEntry: sums.entryW ? round2(sums.entry / sums.entryW) : null,
    meanDelta: sums.deltaW ? round2(sums.delta / sums.deltaW) : null,
    improvedShare: paired ? round2((improved / paired) * 100) : null,
    rawEntry: sums.rawEntryW ? round2(sums.rawEntry / sums.rawEntryW) : null,
    rawExit: sums.rawExitW ? round2(sums.rawExit / sums.rawExitW) : null,
    transitions,
    histogram,
    scatter,
    alpha: {
      alphaN: alphaN || null,
      alphaExpected: alphaN ? round2(alphaSums.expected / alphaN) : null,
      alphaActual: alphaN ? round2(alphaSums.actual / alphaN) : null,
      alphaVa: alphaN ? round2(alphaSums.va / alphaN) : null,
      alphaPositive: alphaN ? alphaPositive : null,
      plane,
      quadrants,
      quadPlane,
    },
  };
}

/** El tránsito en porcentaje: de cada cuarto de entrada, a dónde salieron. */
export function transitionShares(figure: TytFigure) {
  return ["1", "2", "3", "4"].map((from) => {
    const row = figure.transitions[from] ?? {};
    const total = Object.values(row).reduce((a, b) => a + b, 0);
    return {
      from,
      total,
      to: ["1", "2", "3", "4"].map((to) => ({ to, count: row[to] ?? 0, share: total ? ((row[to] ?? 0) / total) * 100 : null })),
    };
  });
}

/** Puntos de la nube: entrada, salida y cuántos hay en esa celda. */
export function scatterPoints(figure: TytFigure) {
  return Object.entries(figure.scatter)
    .map(([cell, count]) => {
      const [entry, exit] = cell.split("|").map(Number);
      return { entry, exit, count, above: exit > entry };
    })
    .filter((p) => Number.isFinite(p.entry) && Number.isFinite(p.exit))
    .sort((a, b) => a.count - b.count);
}

/* --- Importación desde los resultados individuales ----------------------------- */

/** Un evaluado con sus dos pruebas, ya leído del Excel. Nunca sale del navegador. */
export interface TytRecord {
  year: number;
  level: TytLevel;
  program: string;
  /** Puntajes crudos del Saber 11. */
  entry: Partial<Record<TytCompetency, number | null>>;
  /** Puntajes crudos de la prueba de salida. */
  exit: Partial<Record<TytCompetency, number | null>>;
}

const cell = (value: number) => Math.min(95, Math.floor(value / PERCENTILE_STEP) * PERCENTILE_STEP);

/**
 * Resultados individuales → curvas de percentil y filas por año, nivel,
 * programa y competencia. Las curvas se calculan sobre toda la cohorte, no año
 * por año: con treinta evaluados en un año no dirían nada.
 */
export function aggregateTytRecords(records: TytRecord[], fit: AlphaFit = "ampliado"): { results: TytResult[]; benchmarks: TytBenchmarks; alpha: AlphaData } {
  const alpha = fitAlpha(records);
  const predictors = fitPredictors(fit);
  const benchmarks: TytBenchmarks = {};
  for (const { key } of TYT_COMPETENCIES) {
    const entrada = buildCurve(records.map((r) => r.entry[key]).filter((v): v is number => v !== null && v !== undefined));
    const salida = buildCurve(records.map((r) => r.exit[key]).filter((v): v is number => v !== null && v !== undefined));
    if (entrada || salida) benchmarks[key] = { entrada: entrada ?? [], salida: salida ?? [] };
  }

  interface Bucket extends TytResult {
    exitSum: number;
    entrySum: number;
    deltaSum: number;
    rawEntrySum: number;
    rawExitSum: number;
    alphaExpectedSum: number;
    alphaActualSum: number;
    alphaVaSum: number;
  }
  const groups = new Map<string, Bucket>();
  for (const record of records) {
    for (const { key } of TYT_COMPETENCIES) {
      const rawExit = record.exit[key] ?? null;
      const rawEntry = record.entry[key] ?? null;
      if (rawExit === null && rawEntry === null) continue;
      const curve = benchmarks[key];
      const exit = percentileOf(curve?.salida, rawExit);
      const entry = percentileOf(curve?.entrada, rawEntry);
      const id = [record.year, record.level, record.program, key].join("|");
      const group =
        groups.get(id) ??
        ({
          year: record.year,
          level: record.level,
          program: record.program,
          competency: key,
          evaluated: 0,
          meanExit: null,
          paired: 0,
          meanEntry: null,
          meanDelta: null,
          improved: 0,
          rawEntry: null,
          rawExit: null,
          transitions: {},
          histogram: {},
          scatter: {},
          alphaN: null,
          alphaExpected: null,
          alphaActual: null,
          alphaVa: null,
          alphaPositive: null,
          plane: {},
          quadrants: {},
          quadPlane: {},
          exitSum: 0,
          entrySum: 0,
          deltaSum: 0,
          rawEntrySum: 0,
          rawExitSum: 0,
          alphaExpectedSum: 0,
          alphaActualSum: 0,
          alphaVaSum: 0,
        } as Bucket);

      if (exit !== null && rawExit !== null) {
        group.evaluated = (group.evaluated ?? 0) + 1;
        group.exitSum += exit;
        group.rawExitSum += rawExit;
      }
      // Ciencias naturales solo existe en el Saber 11: cuenta como entrada suelta.
      const countsAsPair = entry !== null && (exit !== null || !isPaired(key));
      if (countsAsPair && rawEntry !== null) {
        group.paired = (group.paired ?? 0) + 1;
        group.entrySum += entry!;
        group.rawEntrySum += rawEntry;
      }
      if (entry !== null && exit !== null) {
        const delta = exit - entry;
        group.deltaSum += delta;
        if (delta > 0) group.improved = (group.improved ?? 0) + 1;
        const bin = String(Math.floor(delta / 5) * 5);
        group.histogram[bin] = (group.histogram[bin] ?? 0) + 1;
        const from = quarterOf(entry);
        const to = quarterOf(exit);
        const row = (group.transitions[from] ??= {});
        row[to] = (row[to] ?? 0) + 1;
        const at = `${cell(entry)}|${cell(exit)}`;
        group.scatter[at] = (group.scatter[at] ?? 0) + 1;
      }

      // Motor Alpha: lo que el modelo esperaba de este estudiante y lo que obtuvo.
      const model = alpha.modelos[key]?.[fit];
      const expected = model ? expectedOf(model, fit, alphaEntry(record)) : null;
      if (expected !== null && rawExit !== null) {
        const va = round2(rawExit - expected);
        group.alphaN = (group.alphaN ?? 0) + 1;
        group.alphaExpectedSum += expected;
        group.alphaActualSum += rawExit;
        group.alphaVaSum += va;
        // Con evaluados, «ninguno superó lo esperado» es un cero, no un vacío: si
        // se quedara en null, la ficha lo dibujaría como sin reportar.
        group.alphaPositive = (group.alphaPositive ?? 0) + (va > 0 ? 1 : 0);
        const spot = planeCell(expected, rawExit);
        group.plane[spot] = (group.plane[spot] ?? 0) + 1;
        const axis = entryAxis(key);
        const entryScore = axis ? alphaEntry(record)[axis] ?? null : record.entry.global ?? null;
        const entryMean = axis ? alpha.nacional.saber11[axis] : alpha.nacional.saber11.global;
        const exitMean = alpha.nacional.tyt[key];
        if (entryScore !== null) {
          // La nube no necesita los promedios del país; la clasificación sí. Se
          // guarda igual, para que el plano se dibuje aunque falte una referencia.
          const cell = planeCell(entryScore, rawExit);
          group.quadPlane[cell] = (group.quadPlane[cell] ?? 0) + 1;
          if (entryMean !== undefined && exitMean !== undefined) {
            const q = quadrantOf(entryScore, rawExit, entryMean, exitMean);
            group.quadrants[q] = (group.quadrants[q] ?? 0) + 1;
          }
        }
      }
      groups.set(id, group);
    }
  }

  const results = Array.from(groups.values()).map(({ exitSum, entrySum, deltaSum, rawEntrySum, rawExitSum, alphaExpectedSum, alphaActualSum, alphaVaSum, ...row }) => {
    const pairedBoth = Object.values(row.transitions).reduce((sum, at) => sum + Object.values(at).reduce((a, b) => a + b, 0), 0);
    return {
      ...row,
      meanExit: row.evaluated ? round2(exitSum / row.evaluated) : null,
      meanEntry: row.paired ? round2(entrySum / row.paired) : null,
      meanDelta: pairedBoth ? round2(deltaSum / pairedBoth) : null,
      rawEntry: row.paired ? round2(rawEntrySum / row.paired) : null,
      rawExit: row.evaluated ? round2(rawExitSum / row.evaluated) : null,
      alphaExpected: row.alphaN ? round2(alphaExpectedSum / row.alphaN) : null,
      alphaActual: row.alphaN ? round2(alphaActualSum / row.alphaN) : null,
      alphaVa: row.alphaN ? round2(alphaVaSum / row.alphaN) : null,
    };
  });
  return { results, benchmarks, alpha };
}

/* --- Motor Alpha: el ajuste sobre toda la cohorte -------------------------------------- */

/** Los puntajes del Saber 11 con los nombres que usa la ecuación publicada. */
const alphaEntry = (record: TytRecord): Partial<Record<AlphaPredictor, number | null>> => ({
  m: record.entry.rc ?? null,
  lc: record.entry.lc ?? null,
  cn: record.entry.cn ?? null,
  sc: record.entry.cc ?? null,
  ing: record.entry.ing ?? null,
});

/** Qué competencia del Saber 11 hace de eje de entrada en los cuadrantes. */
const entryAxis = (competency: TytCompetency): AlphaPredictor | null =>
  competency === "rc" ? "m" : competency === "cc" ? "sc" : competency === "lc" ? "lc" : competency === "ing" ? "ing" : null;

/**
 * Ajusta la regresión de cada competencia de salida sobre las del Saber 11,
 * en sus dos versiones: la del artículo y la que deja fuera ciencias
 * naturales, que cubre a muchos más estudiantes.
 */
export function fitAlpha(records: TytRecord[]): AlphaData {
  const alpha = emptyAlpha();
  for (const { key } of TYT_COMPETENCIES) {
    if (key === "cn") continue;
    for (const fit of ["completo", "ampliado"] as AlphaFit[]) {
      const predictors = fitPredictors(fit);
      const rows = records
        .map((record) => {
          const y = record.exit[key] ?? null;
          const entry = alphaEntry(record);
          const x = predictors.map((p) => entry[p] ?? null);
          return y !== null && x.every((v): v is number => v !== null) ? { x: x as number[], y } : null;
        })
        .filter((row): row is { x: number[]; y: number } => row !== null);
      const model = fitLinear(rows, predictors);
      if (model) {
        alpha.modelos[key] = { ...(alpha.modelos[key] ?? {}), [fit]: model };
      }
    }
  }
  return alpha;
}
