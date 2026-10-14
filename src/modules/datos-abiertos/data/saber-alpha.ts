/* =============================================================================
   Datos Abiertos · Motor Alpha: el plano de valor agregado (0037).

   Segunda forma de leer el mismo conjunto Saber 11 → Saber TyT. El Motor Beta
   compara posiciones (percentiles); el Motor Alpha estima lo que se esperaba
   de cada estudiante y mide la distancia con lo que obtuvo.

   El modelo viene de una investigación publicada, y la ficha la cita:
     León FJ., Tobar Sánchez JA., González Calderón W., Suárez Arias RE.
     «Analysis of generic competencies using a Linear Regression Model: A case
     study in short-cycle programs». Innovaciencia 2025; 13(1): e4589.
     http://dx.doi.org/10.15649/2346075X.4589 · CC BY-NC 4.0

     Y = β0 + β1·Matemáticas + β2·Lectura crítica + β3·Ciencias naturales
           + β4·Sociales y ciudadanas + β5·Inglés + ε

   Y es el puntaje real en una competencia del Saber TyT y los predictores son
   los del Saber 11 del mismo estudiante. VA = Y − Ŷ.

   Dos ajustes por competencia, porque las ciencias naturales solo están en
   parte de los registros: "completo" (los cinco predictores del artículo) y
   "ampliado" (sin ciencias naturales, que cubre a muchos más estudiantes).
   ========================================================================== */

import type { TytCompetency } from "./saber-tyt";

/** Predictores del Saber 11, en el orden de la ecuación publicada. */
export type AlphaPredictor = "m" | "lc" | "cn" | "sc" | "ing";

export const ALPHA_PREDICTORS: { key: AlphaPredictor; label: string }[] = [
  { key: "m", label: "Matemáticas" },
  { key: "lc", label: "Lectura crítica" },
  { key: "cn", label: "Ciencias naturales" },
  { key: "sc", label: "Sociales y ciudadanas" },
  { key: "ing", label: "Inglés" },
];

/** Qué ajuste se usa: el del artículo o el que deja fuera ciencias naturales. */
export type AlphaFit = "completo" | "ampliado";

export const ALPHA_FIT_LABEL: Record<AlphaFit, string> = {
  completo: "Modelo del artículo · cinco competencias",
  ampliado: "Sin ciencias naturales · más estudiantes",
};

export const ALPHA_CITATION = {
  authors: "León FJ., Tobar Sánchez JA., González Calderón W., Suárez Arias RE.",
  title: "Analysis of generic competencies using a Linear Regression Model: A case study in short-cycle programs",
  journal: "Innovaciencia 2025; 13(1): e4589",
  doi: "http://dx.doi.org/10.15649/2346075X.4589",
  license: "CC BY-NC 4.0",
  institution: "Universidad Autónoma de Bucaramanga",
};

export interface AlphaModel {
  coef: { intercepto: number } & Partial<Record<AlphaPredictor, number>>;
  /** Cuánto de la variación del resultado explica el modelo, de 0 a 1. */
  r2: number;
  /** Estudiantes con los que se ajustó. */
  n: number;
  /** Error típico, en puntos de la prueba de salida. */
  rmse: number;
}

export interface AlphaData {
  /** Promedios nacionales de referencia para los cuadrantes. */
  nacional: {
    saber11: Partial<Record<AlphaPredictor | "global", number>>;
    tyt: Partial<Record<TytCompetency, number>>;
  };
  modelos: Partial<Record<TytCompetency, Partial<Record<AlphaFit, AlphaModel>>>>;
}

/**
 * Promedios nacionales publicados en el artículo (Saber 11 2014-2020 y Saber
 * TyT 2016-2023). Son el punto de corte de los cuadrantes mientras la
 * institución no cargue los suyos; la intranet los deja cambiar.
 */
export const ALPHA_NATIONAL: AlphaData["nacional"] = {
  saber11: { m: 57, lc: 58, sc: 55, cn: 56, ing: 61, global: 285 },
  tyt: { ce: 94, rc: 90, lc: 97, cc: 96, ing: 100, global: 95 },
};

export const emptyAlpha = (): AlphaData => ({ nacional: ALPHA_NATIONAL, modelos: {} });

/* --- Ajuste por mínimos cuadrados --------------------------------------------------- */

/** Resuelve (XᵀX)b = Xᵀy por eliminación de Gauss con pivoteo parcial. */
function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, i) => [...row, vector[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    if (Math.abs(a[pivot][col]) < 1e-10) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col] / a[col][col];
      for (let k = col; k <= n; k += 1) a[row][k] -= factor * a[col][k];
    }
  }
  return a.map((row, i) => row[n] / row[i]);
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Ajusta Y = β0 + Σ βi·Xi sobre los casos completos. Sin datos suficientes, null. */
export function fitLinear(rows: { x: number[]; y: number }[], predictors: AlphaPredictor[]): AlphaModel | null {
  const k = predictors.length + 1;
  if (rows.length < k * 5) return null;
  const xtx = Array.from({ length: k }, () => new Array(k).fill(0));
  const xty = new Array(k).fill(0);
  for (const row of rows) {
    const x = [1, ...row.x];
    for (let i = 0; i < k; i += 1) {
      xty[i] += x[i] * row.y;
      for (let j = 0; j < k; j += 1) xtx[i][j] += x[i] * x[j];
    }
  }
  const beta = solve(xtx, xty);
  if (!beta) return null;
  const mean = rows.reduce((sum, r) => sum + r.y, 0) / rows.length;
  let ssr = 0;
  let sst = 0;
  for (const row of rows) {
    const predicted = beta[0] + row.x.reduce((sum, value, i) => sum + value * beta[i + 1], 0);
    ssr += (row.y - predicted) ** 2;
    sst += (row.y - mean) ** 2;
  }
  const coef: AlphaModel["coef"] = { intercepto: round3(beta[0]) };
  predictors.forEach((key, i) => {
    coef[key] = round3(beta[i + 1]);
  });
  return { coef, r2: sst === 0 ? 0 : round3(1 - ssr / sst), n: rows.length, rmse: round2(Math.sqrt(ssr / rows.length)) };
}

/** Qué predictores usa cada ajuste. */
export const fitPredictors = (fit: AlphaFit): AlphaPredictor[] =>
  fit === "completo" ? ["m", "lc", "cn", "sc", "ing"] : ["m", "lc", "sc", "ing"];

/** Puntaje esperado de un estudiante; null si le falta algún predictor del ajuste. */
export function expectedOf(model: AlphaModel | undefined, fit: AlphaFit, entry: Partial<Record<AlphaPredictor, number | null>>): number | null {
  if (!model) return null;
  let value = model.coef.intercepto;
  for (const key of fitPredictors(fit)) {
    const score = entry[key];
    const beta = model.coef[key];
    if (score === null || score === undefined || beta === undefined) return null;
    value += beta * score;
  }
  return round2(value);
}

/**
 * Cuadrante frente a los promedios nacionales, como en el artículo:
 * 1 alto en las dos pruebas · 2 alto solo en la de salida ·
 * 3 bajo en las dos · 4 alto solo en el Saber 11.
 */
export function quadrantOf(entry: number, exit: number, entryMean: number, exitMean: number): "1" | "2" | "3" | "4" {
  const overEntry = entry >= entryMean;
  const overExit = exit >= exitMean;
  if (overEntry && overExit) return "1";
  if (!overEntry && overExit) return "2";
  if (!overEntry && !overExit) return "3";
  return "4";
}

export const QUADRANT_LABEL: Record<string, string> = {
  "1": "Sobre el país en las dos pruebas",
  "2": "Sobre el país solo al salir",
  "3": "Bajo el país en las dos",
  "4": "Sobre el país solo al entrar",
};

/** La competencia del Saber 11 que da el eje de entrada de una competencia de salida. */
export const entryAxisOf = (competency: TytCompetency): AlphaPredictor | null =>
  competency === "rc" ? "m" : competency === "cc" ? "sc" : competency === "lc" ? "lc" : competency === "ing" ? "ing" : null;

/* --- Lo que se guarda por año, programa y competencia --------------------------------- */

export interface AlphaFigures {
  alphaN: number | null;
  alphaExpected: number | null;
  alphaActual: number | null;
  alphaVa: number | null;
  alphaPositive: number | null;
  /** Nube esperado|real en celdas de 5 puntos. */
  plane: Record<string, number>;
  quadrants: Record<string, number>;
  /**
   * Nube Saber 11|Saber TyT en celdas de 5 puntos: la que dibuja el plano de
   * cuadrantes. Los cuatro conteos de `quadrants` dicen cuántos cayeron en cada
   * uno, pero no dónde, y sin eso el plano no se puede dibujar.
   */
  quadPlane: Record<string, number>;
}

export const emptyFigures = (): AlphaFigures => ({
  alphaN: null,
  alphaExpected: null,
  alphaActual: null,
  alphaVa: null,
  alphaPositive: null,
  quadPlane: {},
  plane: {},
  quadrants: {},
});

/** Celda de 5 puntos para el plano. */
export const planeCell = (expected: number, actual: number) => `${Math.floor(expected / 5) * 5}|${Math.floor(actual / 5) * 5}`;

/** Nube de una rejilla «x|y» en celdas de 5 puntos, lista para dibujar. */
export function cellPoints(cloud: Record<string, number>) {
  return Object.entries(cloud)
    .map(([cell, count]) => {
      const [x, y] = cell.split("|").map(Number);
      return { x, y, count };
    })
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .sort((a, b) => a.count - b.count);
}

/** Puntos del plano, listos para dibujar. */
export function planePoints(plane: Record<string, number>) {
  return Object.entries(plane)
    .map(([cell, count]) => {
      const [expected, actual] = cell.split("|").map(Number);
      return { expected, actual, count, above: actual > expected };
    })
    .filter((p) => Number.isFinite(p.expected) && Number.isFinite(p.actual))
    .sort((a, b) => a.count - b.count);
}
