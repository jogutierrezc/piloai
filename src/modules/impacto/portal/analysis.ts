/* =============================================================================
   Portal de Impacto · las cuentas.

   Todo lo que el portal dibuja y todo lo que Mr. Pilo dice sale de aquí, de
   la misma foto de la base. Son funciones puras: así Pilo nunca afirma algo
   que la gráfica de al lado no muestre, y las pruebas las cubren sin base.

   - La matriz de cadena de valor: dimensiones × eslabones de una función.
   - El río: cuántos indicadores hay en cada eslabón y cuántos tienen cifra.
   - Los lazos entre funciones: pilares y ODS que comparten sus indicadores.
   - La cadena de un programa: qué eslabones cubre en cada función.
   - Los resultados: la última cifra frente a la meta 2026.
   ========================================================================== */

import { FUNCTIONS, FUNCTION_LABEL, STAGES, STAGE_LABEL, progress } from "../model";
import type { Stage, SubstantiveFunction } from "../model";
import type { PortalData, PortalIndicator, PortalUnit, PortalValue } from "./data";

export const FN_SHORT: Record<SubstantiveFunction, string> = { investigacion: "INV", ensenanza: "ENS", extension: "EXT" };
export const FN_SLUG: Record<SubstantiveFunction, string> = {
  investigacion: "investigacion",
  ensenanza: "ensenanza",
  extension: "extension",
};
export const isFunction = (value: string | undefined): value is SubstantiveFunction =>
  FUNCTIONS.includes(value as SubstantiveFunction);

const stageList = (stages: Stage[]) => stages.map((s) => STAGE_LABEL[s].toLowerCase()).join(", ").replace(/, ([^,]*)$/, " y $1");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* --- Estructura ---------------------------------------------------------------- */

export interface PortalProgram {
  id: string;
  name: string;
  slug: string;
  faculty: PortalUnit | null;
  campusIds: string[];
}

/** La facultad de una unidad: sube por los padres hasta encontrarla. */
export function facultyOf(units: PortalUnit[], unitId: string): PortalUnit | null {
  const byId = new Map(units.map((u) => [u.id, u]));
  let current = byId.get(unitId);
  for (let guard = 0; current && guard < 12; guard++) {
    if (current.kind === "facultad") return current;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return null;
}

export function programsOf(data: PortalData): PortalProgram[] {
  const sites = new Map<string, string[]>();
  for (const o of data.offer) sites.set(o.programId, [...(sites.get(o.programId) ?? []), o.campusId]);
  return data.units
    .filter((u) => u.kind === "programa")
    .map((u) => ({ id: u.id, name: u.name, slug: u.slug, faculty: facultyOf(data.units, u.id), campusIds: sites.get(u.id) ?? [] }))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export const facultiesOf = (data: PortalData) =>
  data.units.filter((u) => u.kind === "facultad").sort((a, b) => a.name.localeCompare(b.name, "es"));

/* --- La matriz de cadena de valor ------------------------------------------------- */

export interface MatrixCell {
  stage: Stage;
  /** Indicadores de la dimensión en este eslabón. */
  count: number;
  /** Indicadores de otra dimensión que la matriz declara como antecedente aquí. */
  refs: number;
  codes: string[];
}

export interface MatrixRow {
  dimensionId: string | null;
  name: string;
  cells: MatrixCell[];
  missing: Stage[];
  complete: boolean;
  total: number;
  /** Indicadores sin dimensión: no forman cadena, solo se cuentan. */
  unassigned: boolean;
}

export function valueMatrix(data: PortalData, fn: SubstantiveFunction): MatrixRow[] {
  const dims = data.dimensions.filter((d) => d.fn === fn).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"));
  const indicators = data.indicators.filter((i) => i.fn === fn);

  const build = (dimensionId: string | null, name: string): MatrixRow => {
    const own = indicators.filter((i) => i.dimensionId === dimensionId);
    const cells = STAGES.map((stage) => {
      const here = own.filter((i) => i.stage === stage);
      const refs = dimensionId
        ? data.refs.filter((r) => r.dimensionId === dimensionId && r.stage === stage && !here.some((i) => i.id === r.indicatorId)).length
        : 0;
      return { stage, count: here.length, refs, codes: here.map((i) => i.code) };
    });
    const missing = cells.filter((c) => c.count + c.refs === 0).map((c) => c.stage);
    return {
      dimensionId,
      name,
      cells,
      missing,
      complete: missing.length === 0,
      total: own.length,
      unassigned: dimensionId === null,
    };
  };

  const rows = dims.map((d) => build(d.id, d.name)).filter((r) => r.total > 0 || r.cells.some((c) => c.refs > 0));
  const known = new Set(dims.map((d) => d.id));
  const orphans = indicators.filter((i) => !i.dimensionId || !known.has(i.dimensionId));
  if (orphans.length) {
    rows.push({
      dimensionId: null,
      name: "Sin dimensión asignada",
      cells: STAGES.map((stage) => {
        const here = orphans.filter((i) => i.stage === stage);
        return { stage, count: here.length, refs: 0, codes: here.map((i) => i.code) };
      }),
      missing: [],
      complete: false,
      total: orphans.length,
      unassigned: true,
    });
  }
  return rows;
}

/** Cuántas dimensiones con cadena hay y cuántas están completas, en toda la universidad. */
export function chainSummary(data: PortalData) {
  const rows = FUNCTIONS.flatMap((fn) => valueMatrix(data, fn)).filter((r) => !r.unassigned);
  return { dimensions: rows.length, complete: rows.filter((r) => r.complete).length };
}

/* --- El río ------------------------------------------------------------------------ */

export type RiverCounts = Record<SubstantiveFunction, Record<Stage, { total: number; data: number }>>;

const hasFigure = (v: PortalValue) => !v.notApplicable && (v.valueNum !== null || v.hasText);

/** Las fichas con alguna cifra en el alcance que se mira (sin alcance: cualquier cifra). */
export function indicatorsWithData(data: PortalData, programIds?: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const v of data.values) {
    if (!hasFigure(v)) continue;
    if (programIds && !(v.programId && programIds.has(v.programId))) continue;
    ids.add(v.indicatorId);
  }
  return ids;
}

export function riverCounts(data: PortalData, only?: Set<string>, withData = indicatorsWithData(data)): RiverCounts {
  const counts = Object.fromEntries(
    FUNCTIONS.map((f) => [f, Object.fromEntries(STAGES.map((s) => [s, { total: 0, data: 0 }]))]),
  ) as RiverCounts;
  for (const i of data.indicators) {
    if (only && !only.has(i.id)) continue;
    const cell = counts[i.fn][i.stage];
    cell.total += 1;
    if (withData.has(i.id)) cell.data += 1;
  }
  return counts;
}

/* --- Lazos entre funciones --------------------------------------------------------- */

export interface FunctionLink {
  a: SubstantiveFunction;
  b: SubstantiveFunction;
  /** Suma de coincidencias: por cada pilar u ODS, el menor de los dos conteos. */
  score: number;
  shared: { label: string; count: number }[];
}

export function functionLinks(data: PortalData): FunctionLink[] {
  const fnOf = new Map(data.indicators.map((i) => [i.id, i.fn]));
  const pillarName = new Map(data.pillars.map((p) => [p.id, `Pilar ${p.numeral} ${p.name}`.replace(/\s+/g, " ").trim()]));
  const tally = new Map<string, Map<SubstantiveFunction, Set<string>>>();
  for (const a of data.alignments) {
    const fn = fnOf.get(a.indicatorId);
    if (!fn) continue;
    const key = a.target === "ods" ? `ODS ${a.sdg}` : pillarName.get(a.pillarId ?? "") ?? "Pilar";
    const byFn = tally.get(key) ?? new Map<SubstantiveFunction, Set<string>>();
    byFn.set(fn, (byFn.get(fn) ?? new Set()).add(a.indicatorId));
    tally.set(key, byFn);
  }
  const pairs: [SubstantiveFunction, SubstantiveFunction][] = [
    ["investigacion", "extension"],
    ["investigacion", "ensenanza"],
    ["ensenanza", "extension"],
  ];
  return pairs
    .map(([a, b]) => {
      const shared = [...tally.entries()]
        .map(([label, byFn]) => ({ label, count: Math.min(byFn.get(a)?.size ?? 0, byFn.get(b)?.size ?? 0) }))
        .filter((s) => s.count > 0)
        .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label, "es"));
      return { a, b, score: shared.reduce((t, s) => t + s.count, 0), shared };
    })
    .sort((x, y) => y.score - x.score);
}

/* --- La cadena de un programa ------------------------------------------------------- */

export type ProgramChain = Record<SubstantiveFunction, Record<Stage, string[]>>;

const emptyChain = (): ProgramChain =>
  Object.fromEntries(FUNCTIONS.map((f) => [f, Object.fromEntries(STAGES.map((s) => [s, [] as string[]]))])) as ProgramChain;

/** Qué eslabones cubre un programa, en una sede o en todas: lo adoptado más lo propio. */
export function programChain(data: PortalData, programId: string, campusId?: string | null): ProgramChain {
  const chain = emptyChain();
  const byId = new Map(data.indicators.map((i) => [i.id, i]));
  const add = (fn: SubstantiveFunction, stage: Stage, code: string) => {
    if (!chain[fn][stage].includes(code)) chain[fn][stage].push(code);
  };
  for (const a of data.adoptions) {
    if (a.programId !== programId || (campusId && a.campusId !== campusId)) continue;
    const i = byId.get(a.indicatorId);
    if (i) add(i.fn, i.stage, i.code);
  }
  for (const p of data.programIndicators) {
    if (p.programId !== programId || (campusId && p.campusId && p.campusId !== campusId)) continue;
    add(p.fn, p.stage, p.code);
  }
  for (const f of FUNCTIONS) for (const s of STAGES) chain[f][s].sort();
  return chain;
}

export function chainCoverage(chain: ProgramChain, fn: SubstantiveFunction) {
  const covered = STAGES.filter((s) => chain[fn][s].length > 0);
  return { covered: covered.length, missing: STAGES.filter((s) => chain[fn][s].length === 0), connected: covered.length > 0 };
}

/* --- Resultados --------------------------------------------------------------------- */

/** La cifra más reciente que cumple la condición. */
export function latest(values: PortalValue[], where: (v: PortalValue) => boolean): PortalValue | undefined {
  let best: PortalValue | undefined;
  for (const v of values) {
    if (v.notApplicable || v.valueNum === null || !where(v)) continue;
    if (!best || v.year > best.year) best = v;
  }
  return best;
}

/** La cifra de la universidad (sin programa ni sede). */
export const globalFigure = (data: PortalData, indicatorId: string) =>
  latest(data.values, (v) => v.indicatorId === indicatorId && !v.programId && !v.campusId);

export type GoalState = "cumplida" | "en_camino" | "sin_cifra" | "sin_meta";

export const GOAL_LABEL: Record<GoalState, string> = {
  cumplida: "Cumplidas",
  en_camino: "En camino",
  sin_cifra: "Sin cifra",
  sin_meta: "Meta sin número",
};

export function goalState(data: PortalData, i: PortalIndicator): { state: GoalState; pct: number | null; value: PortalValue | undefined } {
  const value = globalFigure(data, i.id);
  if (i.target2026Num === null) return { state: "sin_meta", pct: null, value };
  if (!value) return { state: "sin_cifra", pct: null, value };
  const pct = progress(value.valueNum, i.target2026Num, i.direction);
  return { state: pct !== null && pct >= 100 ? "cumplida" : "en_camino", pct, value };
}

export function goalStates(data: PortalData, indicators = data.indicators): Record<GoalState, number> {
  const out: Record<GoalState, number> = { cumplida: 0, en_camino: 0, sin_cifra: 0, sin_meta: 0 };
  for (const i of indicators) out[goalState(data, i).state] += 1;
  return out;
}

/**
 * La cifra de un indicador en cada sede: la de la sede si la reportó la
 * vicerrectoría; si no, el promedio simple de lo que reportan sus programas
 * (solo los del alcance, si se pasa).
 */
export function campusFigures(data: PortalData, indicatorId: string, programIds?: Set<string>) {
  return data.campuses
    .map((c) => {
      const own = programIds ? undefined : latest(data.values, (v) => v.indicatorId === indicatorId && !v.programId && v.campusId === c.id);
      if (own) return { campus: c, value: own.valueNum, year: own.year, from: "sede" as const, programs: 0 };
      const byProgram = new Map<string, PortalValue>();
      for (const v of data.values) {
        if (v.indicatorId !== indicatorId || v.campusId !== c.id || !v.programId || v.notApplicable || v.valueNum === null) continue;
        if (programIds && !programIds.has(v.programId)) continue;
        const prev = byProgram.get(v.programId);
        if (!prev || v.year > prev.year) byProgram.set(v.programId, v);
      }
      const list = [...byProgram.values()];
      if (!list.length) return { campus: c, value: null, year: null, from: "nada" as const, programs: 0 };
      const value = list.reduce((t, v) => t + (v.valueNum ?? 0), 0) / list.length;
      return { campus: c, value, year: Math.max(...list.map((v) => v.year)), from: "programas" as const, programs: list.length };
    })
    .filter((f) => !programIds || f.value !== null || data.offer.some((o) => o.campusId === f.campus.id && programIds.has(o.programId)));
}

/** Los indicadores más adoptados por un conjunto de programas. */
export function mostAdopted(data: PortalData, programIds: Set<string>, limit = 5) {
  const count = new Map<string, Set<string>>();
  for (const a of data.adoptions) {
    if (!programIds.has(a.programId)) continue;
    count.set(a.indicatorId, (count.get(a.indicatorId) ?? new Set()).add(a.programId));
  }
  const byId = new Map(data.indicators.map((i) => [i.id, i]));
  return [...count.entries()]
    .map(([id, programs]) => ({ indicator: byId.get(id)!, programs: programs.size }))
    .filter((r) => r.indicator)
    .sort((a, b) => b.programs - a.programs || a.indicator.code.localeCompare(b.indicator.code))
    .slice(0, limit);
}

/** Hacia qué función apuntan las adopciones de un conjunto de programas. */
export function adoptionsByFunction(data: PortalData, programIds: Set<string>): Record<SubstantiveFunction, number> {
  const fnOf = new Map(data.indicators.map((i) => [i.id, i.fn]));
  const out: Record<SubstantiveFunction, number> = { investigacion: 0, ensenanza: 0, extension: 0 };
  for (const a of data.adoptions) {
    if (!programIds.has(a.programId)) continue;
    const fn = fnOf.get(a.indicatorId);
    if (fn) out[fn] += 1;
  }
  for (const p of data.programIndicators) if (programIds.has(p.programId)) out[p.fn] += 1;
  return out;
}

/* --- Lo que dice Mr. Pilo ------------------------------------------------------------- */

export type PiloTone = "idea" | "cuidado" | "excelente" | "duda";
export interface PiloNote {
  mood: PiloTone;
  title: string;
  lines: string[];
}

/** La brecha más seria de la matriz de una función, o la buena noticia si no hay. */
export function matrixNote(rows: MatrixRow[], fn: SubstantiveFunction): PiloNote {
  const chains = rows.filter((r) => !r.unassigned);
  if (!chains.length) {
    return { mood: "duda", title: "Aún no hay dimensiones", lines: [`${FUNCTION_LABEL[fn]} todavía no tiene fichas publicadas con dimensión.`] };
  }
  const broken = chains.filter((r) => !r.complete).sort((a, b) => b.missing.length - a.missing.length || b.total - a.total);
  const orphan = rows.find((r) => r.unassigned);
  const orphanLine = orphan ? `${plural(orphan.total, "indicador no tiene", "indicadores no tienen")} dimensión todavía: no forman cadena.` : null;
  if (!broken.length) {
    return {
      mood: "excelente",
      title: "Todas las cadenas completas",
      lines: [`Las ${chains.length} dimensiones de ${FUNCTION_LABEL[fn]} van de los insumos al impacto real.`, orphanLine].filter(Boolean) as string[],
    };
  }
  const worst = broken[0];
  const start = worst.missing[0] === "insumos" ? " Está rota al comienzo: ¿con qué recursos se logra?" : "";
  return {
    mood: "cuidado",
    title: `${broken.length} de ${chains.length} cadenas incompletas`,
    lines: [
      `${worst.name} no tiene ${stageList(worst.missing)}.${start}`,
      ...(broken.length > 1 ? [`También: ${broken.slice(1, 3).map((r) => r.name).join(" y ")}.`] : []),
      ...(orphanLine ? [orphanLine] : []),
    ],
  };
}

export function linksNote(links: FunctionLink[]): PiloNote {
  const withLinks = links.filter((l) => l.score > 0);
  if (!withLinks.length) {
    return { mood: "duda", title: "Sin vínculos todavía", lines: ["Las fichas aún no tienen pilares ni ODS confirmados; sin eso no puedo medir los lazos."] };
  }
  const strong = withLinks[0];
  const weak = withLinks[withLinks.length - 1];
  const top = (l: FunctionLink) => l.shared.slice(0, 2).map((s) => s.label).join(" y ");
  return {
    mood: "idea",
    title: "Cómo leer los lazos",
    lines: [
      "El círculo es cuántos indicadores tiene cada función; el grosor del lazo, cuántos pilares y ODS comparten.",
      `El lazo más fuerte es ${FUNCTION_LABEL[strong.a]}–${FUNCTION_LABEL[strong.b]} (${strong.score}), por ${top(strong)}.`,
      ...(weak !== strong ? [`El más delgado, ${FUNCTION_LABEL[weak.a]}–${FUNCTION_LABEL[weak.b]} (${weak.score}): ahí hay espacio para trabajo conjunto.`] : []),
    ],
  };
}

export function riverNote(counts: RiverCounts): PiloNote {
  const lines = ["Cada cauce es una función; el ancho en cada estación, cuántos indicadores tiene; el hilo intenso, cuántos ya tienen cifra."];
  const thin = FUNCTIONS.filter((f) => counts[f].insumos.total > 0 && counts[f].insumos.total <= 2);
  if (thin.length) lines.push(`${thin.map((f) => FUNCTION_LABEL[f]).join(" y ")} ${thin.length === 1 ? "empieza" : "empiezan"} con muy pocos insumos: mucho impacto con poca base declarada.`);
  const total = FUNCTIONS.reduce((t, f) => t + STAGES.reduce((s, st) => s + counts[f][st].total, 0), 0);
  const data = FUNCTIONS.reduce((t, f) => t + STAGES.reduce((s, st) => s + counts[f][st].data, 0), 0);
  lines.push(total ? `${data} de ${total} indicadores tienen alguna cifra.` : "Aún no hay fichas publicadas.");
  return { mood: "idea", title: "El río de la cadena de valor", lines };
}

export function goalsNote(states: Record<GoalState, number>): PiloNote {
  const measured = states.cumplida + states.en_camino;
  if (!measured) {
    return { mood: "duda", title: "Todavía sin cifras frente a meta", lines: ["Cuando las vicerrectorías registren la cifra de la UDES en Captura, aquí verá cuántas metas 2026 se cumplen."] };
  }
  return {
    mood: states.cumplida >= states.en_camino ? "excelente" : "idea",
    title: "Metas 2026",
    lines: [
      `De ${plural(measured, "meta con cifra", "metas con cifra")}, ${states.cumplida} ya se ${states.cumplida === 1 ? "cumple" : "cumplen"}.`,
      ...(states.sin_cifra ? [`${plural(states.sin_cifra, "ficha tiene", "fichas tienen")} meta pero aún no su cifra.`] : []),
      ...(states.sin_meta ? [`${plural(states.sin_meta, "meta está escrita", "metas están escritas")} sin número («+2 pp vs LB»): su avance no se calcula solo.`] : []),
    ],
  };
}

export function programNote(name: string, chain: ProgramChain): PiloNote {
  const gaps = FUNCTIONS.map((fn) => ({ fn, ...chainCoverage(chain, fn) }));
  const disconnected = gaps.filter((g) => !g.connected);
  const partial = gaps.filter((g) => g.connected && g.missing.length);
  if (!disconnected.length && !partial.length) {
    return { mood: "excelente", title: "Cadena completa", lines: [`${name} va de los insumos al impacto real en las tres funciones.`] };
  }
  const lines: string[] = [];
  if (partial.length) lines.push(`En ${FUNCTION_LABEL[partial[0].fn]} le falta ${stageList(partial[0].missing)}.`);
  if (disconnected.length) lines.push(`No se conecta con ${disconnected.map((g) => FUNCTION_LABEL[g.fn]).join(" ni con ")}.`);
  lines.push("En la intranet, Elegir le propone el eslabón que usan programas parecidos.");
  return { mood: "cuidado", title: `A ${name} le faltan eslabones`, lines };
}
