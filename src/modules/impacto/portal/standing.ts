/* =============================================================================
   Portal de Impacto · el cumplimiento por indicador.

   Cómo va cada indicador que eligió un programa frente a su meta 2026, y
   cómo se suman esos estados en una facultad y en una vicerrectoría.

   - La unidad es programa × indicador. Con una sede elegida, solo esa sede;
     sin sede, la cifra del programa es el promedio simple de la última cifra
     de cada sede, y su meta, el promedio de las metas que fijó por sede (si
     no fijó ninguna, la de la ficha).
   - Avance = cifra ÷ meta (se invierte en lo que debe bajar). Cumplida desde
     el 100 %, en camino desde el 70 %, rezagada por debajo.
   - Sin cifra no es cero: se cuenta aparte. Una meta sin número tampoco
     entra en el avance.
   - Al sumar se usa la mediana, no el promedio: un programa muy alto no tapa
     a los demás.
   ========================================================================== */

import { STAGES, progress } from "../model";
import type { Stage, SubstantiveFunction } from "../model";
import type { PortalData, PortalIndicator, PortalValue } from "./data";
import type { PiloNote, PortalProgram } from "./analysis";

export type Standing = "rezagada" | "sin_cifra" | "en_camino" | "cumplida" | "sin_meta";

/** En orden de atención: primero lo que necesita que alguien actúe. */
export const STANDINGS: Standing[] = ["rezagada", "sin_cifra", "en_camino", "cumplida", "sin_meta"];

export const STANDING_LABEL: Record<Standing, string> = {
  cumplida: "Cumplida",
  en_camino: "En camino",
  rezagada: "Rezagada",
  sin_cifra: "Sin cifra",
  sin_meta: "Meta sin número",
};

/** Ningún estado se dice solo con color: cada uno lleva su signo. */
export const STANDING_GLYPH: Record<Standing, string> = {
  cumplida: "✓",
  en_camino: "◐",
  rezagada: "▲",
  sin_cifra: "○",
  sin_meta: "–",
};

/** Por debajo de este avance (en %), el indicador va rezagado. */
export const LAGGING_BELOW = 70;

export function standingOf(pct: number | null, hasTarget: boolean): Standing {
  if (!hasTarget) return "sin_meta";
  if (pct === null) return "sin_cifra";
  if (pct >= 100) return "cumplida";
  return pct >= LAGGING_BELOW ? "en_camino" : "rezagada";
}

/* --- Cuentas pequeñas ------------------------------------------------------------------ */

const mean = (xs: number[]) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);

/** El valor en la posición p (0–1) de una lista ordenada, interpolando. */
function at(sorted: number[], p: number) {
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  return at([...xs].sort((a, b) => a - b), 0.5);
}

export interface Box {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
}

/** La caja de un reparto: extremos, cuartiles y mediana. */
export function boxOf(xs: number[]): Box | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return { min: s[0], q1: at(s, 0.25), median: at(s, 0.5), q3: at(s, 0.75), max: s[s.length - 1] };
}

export type StandingCounts = Record<Standing, number>;

export function countStandings(rows: { standing: Standing }[]): StandingCounts {
  const out: StandingCounts = { rezagada: 0, sin_cifra: 0, en_camino: 0, cumplida: 0, sin_meta: 0 };
  for (const r of rows) out[r.standing] += 1;
  return out;
}

/** Cuántos tienen meta con número (los únicos que pueden cumplirse). */
export const withTarget = (c: StandingCounts) => c.rezagada + c.sin_cifra + c.en_camino + c.cumplida;
/** Cuántos tienen cifra frente a una meta con número. */
export const measured = (c: StandingCounts) => c.rezagada + c.en_camino + c.cumplida;
export const totalOf = (c: StandingCounts) => withTarget(c) + c.sin_meta;
/** % de las metas con número que ya se cumplen (null si no hay ninguna). */
export const metShare = (c: StandingCounts) => (withTarget(c) ? Math.round((c.cumplida / withTarget(c)) * 100) : null);

/* --- Un programa ------------------------------------------------------------------------ */

export interface IndicatorStanding {
  indicator: PortalIndicator;
  programId: string;
  value: number | null;
  year: number | null;
  target: number | null;
  pct: number | null;
  standing: Standing;
  /** Un punto por año: el promedio de las sedes con cifra ese año. */
  trend: { year: number; value: number }[];
  /** Sedes donde lo eligió, y cuántas tienen cifra. */
  campuses: number;
  reportedCampuses: number;
}

/** Los indicadores de la matriz que eligió el programa, con su estado. */
export function programStandings(data: PortalData, programId: string, campusId: string | null = null): IndicatorStanding[] {
  const byId = new Map(data.indicators.map((i) => [i.id, i]));
  const adoptions = new Map<string, typeof data.adoptions>();
  for (const a of data.adoptions) {
    if (a.programId !== programId || (campusId && a.campusId !== campusId)) continue;
    adoptions.set(a.indicatorId, [...(adoptions.get(a.indicatorId) ?? []), a]);
  }
  const values = new Map<string, PortalValue[]>();
  for (const v of data.values) {
    if (v.programId !== programId || v.notApplicable || v.valueNum === null) continue;
    if (campusId && v.campusId !== campusId) continue;
    values.set(v.indicatorId, [...(values.get(v.indicatorId) ?? []), v]);
  }

  const out: IndicatorStanding[] = [];
  for (const [indicatorId, list] of adoptions) {
    const indicator = byId.get(indicatorId);
    if (!indicator) continue;
    const mine = values.get(indicatorId) ?? [];
    const last = new Map<string, PortalValue>();
    for (const v of mine) {
      const key = v.campusId ?? "";
      const prev = last.get(key);
      if (!prev || v.year > prev.year) last.set(key, v);
    }
    const latest = [...last.values()];
    const value = mean(latest.map((v) => v.valueNum as number));
    const targets = list.map((a) => a.target2026Num).filter((t): t is number => t !== null);
    const target = targets.length ? (mean(targets) as number) : indicator.target2026Num;
    const pct = progress(value, target, indicator.direction);
    const years = [...new Set(mine.map((v) => v.year))].sort((a, b) => a - b);
    out.push({
      indicator,
      programId,
      value,
      year: latest.length ? Math.max(...latest.map((v) => v.year)) : null,
      target,
      pct,
      standing: standingOf(pct, target !== null),
      trend: years.map((year) => ({ year, value: mean(mine.filter((v) => v.year === year).map((v) => v.valueNum as number)) as number })),
      campuses: new Set(list.map((a) => a.campusId)).size,
      reportedCampuses: latest.length,
    });
  }
  return sortByAttention(out);
}

/**
 * Los indicadores propios del programa (van aparte de las fichas): el mismo
 * estado, con la meta que el programa les puso en su sede.
 */
export function ownStandings(data: PortalData, programId: string, campusId: string | null = null): IndicatorStanding[] {
  const out: IndicatorStanding[] = [];
  for (const indicator of data.programIndicators) {
    if (indicator.programId !== programId || (campusId && indicator.campusId !== campusId)) continue;
    const mine = data.values.filter((v) => v.indicatorId === indicator.id && !v.notApplicable && v.valueNum !== null);
    const last = mine.reduce<PortalValue | undefined>((best, v) => (!best || v.year > best.year ? v : best), undefined);
    const value = last ? (last.valueNum as number) : null;
    const target = indicator.target2026Num;
    const pct = progress(value, target, indicator.direction);
    const years = [...new Set(mine.map((v) => v.year))].sort((a, b) => a - b);
    out.push({
      indicator,
      programId,
      value,
      year: last?.year ?? null,
      target,
      pct,
      standing: standingOf(pct, target !== null),
      trend: years.map((year) => ({ year, value: mean(mine.filter((v) => v.year === year).map((v) => v.valueNum as number)) as number })),
      campuses: 1,
      reportedCampuses: last ? 1 : 0,
    });
  }
  return sortByAttention(out);
}

/** Primero lo rezagado, luego lo que no tiene cifra; dentro de cada grupo, el avance más bajo. */
export function sortByAttention<T extends { standing: Standing; pct: number | null; indicator: { code: string } }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      STANDINGS.indexOf(a.standing) - STANDINGS.indexOf(b.standing) ||
      (a.pct ?? 0) - (b.pct ?? 0) ||
      a.indicator.code.localeCompare(b.indicator.code),
  );
}

/** Cuántos indicadores elegidos tiene el programa en cada función y eslabón. */
export function stageCounts(rows: IndicatorStanding[]): Record<SubstantiveFunction, Record<Stage, number>> {
  const blank = () => Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  const out = { investigacion: blank(), ensenanza: blank(), extension: blank() };
  for (const r of rows) out[r.indicator.fn][r.indicator.stage] += 1;
  return out;
}

/** El año de corte: la cifra más reciente que se ve. */
export const cutYear = (rows: { year: number | null }[]) => {
  const years = rows.map((r) => r.year).filter((y): y is number => y !== null);
  return years.length ? Math.max(...years) : null;
};

/* --- Varios programas ------------------------------------------------------------------- */

export type StandingsByProgram = Map<string, IndicatorStanding[]>;

export function standingsOf(data: PortalData, programs: PortalProgram[], campusId: string | null = null): StandingsByProgram {
  return new Map(programs.map((p) => [p.id, programStandings(data, p.id, campusId)]));
}

export interface Spread {
  indicator: PortalIndicator;
  /** Programas que lo eligieron, con cifra y que ya cumplen. */
  adopters: number;
  reported: number;
  met: number;
  withTarget: number;
  box: Box | null;
  points: { programId: string; name: string; pct: number; standing: Standing }[];
}

/** El reparto de cada indicador entre los programas que lo eligieron, del más elegido al menos. */
export function spreads(standings: StandingsByProgram, names: Map<string, string>, only?: (i: PortalIndicator) => boolean): Spread[] {
  const byIndicator = new Map<string, IndicatorStanding[]>();
  for (const rows of standings.values()) {
    for (const r of rows) {
      if (only && !only(r.indicator)) continue;
      byIndicator.set(r.indicator.id, [...(byIndicator.get(r.indicator.id) ?? []), r]);
    }
  }
  return [...byIndicator.values()]
    .map((rows) => {
      const points = rows
        .filter((r) => r.pct !== null)
        .map((r) => ({ programId: r.programId, name: names.get(r.programId) ?? "", pct: r.pct as number, standing: r.standing }));
      const counts = countStandings(rows);
      return {
        indicator: rows[0].indicator,
        adopters: rows.length,
        reported: points.length,
        met: counts.cumplida,
        withTarget: withTarget(counts),
        box: boxOf(points.map((p) => p.pct)),
        points,
      };
    })
    .sort((a, b) => b.adopters - a.adopters || a.indicator.code.localeCompare(b.indicator.code));
}

export type GridCell = { adopted: false } | { adopted: true; pct: number | null };

/**
 * Filas × indicadores: en cada cruce, el avance mediano de los programas de
 * la fila; «no lo eligió» y «sin cifra» se distinguen.
 */
export function gridOf(rowsOf: IndicatorStanding[], indicatorIds: string[]): GridCell[] {
  return indicatorIds.map((id) => {
    const mine = rowsOf.filter((r) => r.indicator.id === id);
    if (!mine.length) return { adopted: false };
    const pct = median(mine.map((r) => r.pct).filter((p): p is number => p !== null));
    return { adopted: true, pct: pct === null ? null : Math.round(pct) };
  });
}

/* --- Lo que dice Mr. Pilo ---------------------------------------------------------------- */

const pctText = (n: number) => `${Math.round(n)} %`;
const joinY = (xs: string[]) => xs.join(", ").replace(/, ([^,]*)$/, " y $1");

export function programStandingNote(name: string, rows: IndicatorStanding[]): PiloNote {
  if (!rows.length) {
    return { mood: "duda", title: "Aún sin indicadores", lines: [`${name} todavía no ha elegido indicadores de la matriz.`] };
  }
  const c = countStandings(rows);
  const lag = rows.filter((r) => r.standing === "rezagada");
  const lines = [`${name} cumple ${c.cumplida} de sus ${withTarget(c)} metas con número.`];
  if (lag.length) lines.push(`Lo que más preocupa: ${joinY(lag.slice(0, 2).map((r) => `${r.indicator.name.toLowerCase()} (${pctText(r.pct as number)})`))}.`);
  else if (measured(c)) lines.push(`Ninguno va por debajo del ${LAGGING_BELOW} % de su meta.`);
  const missing = rows.filter((r) => r.standing === "sin_cifra");
  if (missing.length) lines.push(`Falta la cifra de ${joinY(missing.slice(0, 2).map((r) => r.indicator.name.toLowerCase()))}${missing.length > 2 ? ` y ${missing.length - 2} más` : ""}.`);
  const partial = rows.find((r) => r.reportedCampuses > 0 && r.reportedCampuses < r.campuses);
  if (partial) lines.push(`${partial.indicator.name} tiene cifra en ${partial.reportedCampuses} de ${partial.campuses} sedes: el promedio solo mira esas.`);
  return { mood: lag.length ? "cuidado" : c.cumplida >= measured(c) / 2 && c.cumplida > 0 ? "excelente" : "idea", title: "Cómo va el programa", lines };
}

/** Para una facultad o una vicerrectoría: dónde más se separan los programas y quién no reporta. */
export function groupStandingNote(spreadRows: Spread[], perGroup: { name: string; counts: StandingCounts }[], unit: string): PiloNote {
  const all = perGroup.reduce((t, g) => t + totalOf(g.counts), 0);
  if (!all) return { mood: "duda", title: "Aún sin indicadores", lines: [`Los programas de ${unit} todavía no han elegido indicadores de la matriz.`] };
  const lines: string[] = [];
  const wide = spreadRows
    .filter((s) => s.points.length >= 2)
    .map((s) => {
      const sorted = [...s.points].sort((a, b) => a.pct - b.pct);
      return { s, low: sorted[0], high: sorted[sorted.length - 1] };
    })
    .sort((a, b) => b.high.pct - b.low.pct - (a.high.pct - a.low.pct))[0];
  if (wide) {
    lines.push(
      `Donde más se separan es en ${wide.s.indicator.name.toLowerCase()}: ${wide.high.name} va en ${pctText(wide.high.pct)} y ${wide.low.name} en ${pctText(wide.low.pct)}.`,
    );
  }
  const missing = perGroup.reduce((t, g) => t + g.counts.sin_cifra, 0);
  if (missing) {
    const worst = [...perGroup].sort((a, b) => b.counts.sin_cifra - a.counts.sin_cifra).filter((g) => g.counts.sin_cifra > 0).slice(0, 2);
    const theirs = worst.reduce((t, g) => t + g.counts.sin_cifra, 0);
    lines.push(`${joinY(worst.map((g) => g.name))} ${worst.length === 1 ? "tiene" : "concentran"} ${theirs} de los ${missing} indicadores sin cifra: antes de comparar, falta que reporten.`);
  }
  const lagging = spreadRows.filter((s) => s.withTarget >= 3).sort((a, b) => a.met / a.withTarget - b.met / b.withTarget)[0];
  if (lagging && lagging.met / lagging.withTarget < 0.5) {
    lines.push(`${lagging.indicator.name}: solo ${lagging.met} de ${lagging.withTarget} programas con meta la cumplen.`);
  }
  if (!lines.length) lines.push("Todavía hay pocas cifras para comparar programas entre sí.");
  return { mood: missing || lagging ? "cuidado" : "idea", title: `Cómo va ${unit}`, lines };
}
