/* =============================================================================
   Lectura de un modelo de regresión logística publicado (0046).

   Lo comparten la ficha (PredictiveModel) y el boletín (boletin/model-sheets):
   la probabilidad de un perfil, lo que aporta cada factor, cómo se dice una
   razón de probabilidades en palabras y la calidad de la clasificación.
   ========================================================================== */

import type { ModelSpec, ModelTerm, ModelVariable } from "./types";

/** Elección de un perfil: por variable, el índice del nivel o -1 (la referencia). */
export type Profile = Record<string, number>;

const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const two = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const one = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const fmtOr = (v: number) => two.format(v);
export const fmtB = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${two.format(Math.abs(v))}`;
export const fmtPct = (v: number) => `${one.format(v)} %`;
export const fmtPctRound = (v: number) => `${integer.format(Math.round(v))} %`;
export const fmtP = (p: number) => (p < 0.001 ? "< 0,001" : p.toLocaleString("es-CO", { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

export const logistic = (logit: number) => 1 / (1 + Math.exp(-logit));

/** El perfil de referencia: todas las variables en su categoría de comparación. */
export const referenceProfile = (spec: ModelSpec): Profile => Object.fromEntries(spec.variables.map((v) => [v.key, -1]));

/** El término elegido de una variable en un perfil, o null si está en su referencia. */
export function chosenTerm(variable: ModelVariable, profile: Profile): ModelTerm | null {
  const i = profile[variable.key] ?? -1;
  return i >= 0 ? variable.levels[i]?.term ?? null : null;
}

/** Log-odds y probabilidad del perfil, con lo que aporta cada variable. */
export function predict(spec: ModelSpec, profile: Profile) {
  const parts = spec.variables.map((v) => {
    const term = chosenTerm(v, profile);
    const i = profile[v.key] ?? -1;
    return { variable: v, label: i >= 0 ? v.levels[i].label : v.reference, b: term?.b ?? 0, reference: i < 0 };
  });
  const logit = spec.intercept.b + parts.reduce((s, p) => s + p.b, 0);
  return { logit, probability: logistic(logit), parts };
}

/** El perfil que el modelo ve como el más (o el menos) probable: el mejor (o peor) nivel de cada variable. */
export function extremeProfile(spec: ModelSpec, best: boolean): Profile {
  return Object.fromEntries(
    spec.variables.map((v) => {
      let pick = -1;
      let value = 0;
      v.levels.forEach((l, i) => {
        if (best ? l.term.b > value : l.term.b < value) {
          value = l.term.b;
          pick = i;
        }
      });
      return [v.key, pick];
    }),
  );
}

export const significant = (term: ModelTerm, alpha = 0.05) => term.sig < alpha;

/** Una razón de probabilidades dicha en palabras, frente a su referencia. */
export function readOr(spec: ModelSpec, variable: ModelVariable, level: string, term: ModelTerm): string {
  const outcome = `terminar con ${spec.response.label.toLowerCase()} de ${spec.response.positive}`;
  const times = term.or >= 1 ? term.or : 1 / term.or;
  const base = `Frente a ${variable.reference}, ${level} ${term.or >= 1 ? "multiplica" : "divide"} por ${one.format(times)} las posibilidades de ${outcome}`;
  const ci = `IC 95 %: ${fmtOr(term.lo)} a ${fmtOr(term.hi)}`;
  return significant(term, spec.fit.significance)
    ? `${base} (${ci}).`
    : `${base}, pero la diferencia no es significativa al 5 % (p = ${fmtP(term.sig)}; ${ci}).`;
}

/**
 * La categoría de referencia dicha en palabras. No es un dato que falte: es
 * el punto de comparación de su variable, y por eso su Exp(B) vale 1.
 */
export function readReference(spec: ModelSpec, variable: ModelVariable): string {
  const others = variable.levels.map((l) => l.label).join(" y ");
  const base = `${variable.reference} es la categoría de referencia de ${variable.label.toLowerCase()}: ${others} se ${variable.levels.length > 1 ? "comparan" : "compara"} con ella, por eso su razón de probabilidades es 1.`;
  if (!variable.overall) return base;
  const joint = variable.overall.sig < spec.fit.significance ? "sí se asocia" : "no se asocia";
  return `${base} En conjunto, ${variable.label.toLowerCase()} ${joint} con el promedio (Wald ${variable.overall.wald.toLocaleString("es-CO")}, ${variable.overall.df} gl; p = ${fmtP(variable.overall.sig)}).`;
}

/** Filas de un bosque o una tabla: la referencia primero y luego cada nivel. i = -1 es la referencia. */
export function termRows(spec: ModelSpec) {
  return spec.variables.flatMap((v) => [
    { v, i: -1, label: v.reference, term: null as ModelTerm | null },
    ...v.levels.map((l, i) => ({ v, i, label: l.label, term: l.term as ModelTerm | null })),
  ]);
}

/** La tabla de clasificación leída: aciertos por grupo y global. */
export function classificationOf(spec: ModelSpec) {
  const c = spec.classification;
  const negTotal = c.negative.negative + c.negative.positive;
  const posTotal = c.positive.negative + c.positive.positive;
  const total = negTotal + posTotal;
  return {
    total,
    negTotal,
    posTotal,
    negCorrect: (c.negative.negative / negTotal) * 100,
    posCorrect: (c.positive.positive / posTotal) * 100,
    overall: ((c.negative.negative + c.positive.positive) / total) * 100,
  };
}
