/* =============================================================================
   Pregúntele a Pilo · la memoria.

   Convierte lo que muestran los portales en pasajes: textos cortos, cada uno
   con su título, la ruta exacta donde se ve, el corte y la oficina que lo
   reporta. Se leen con las mismas consultas del portal público, así que solo
   entra lo publicado; ninguna cifra de dinero entra (regla del producto).

   - UDES en Cifras: cada informe y cada indicador con su última cifra, por
     campus y frente al año anterior.
   - Boletines: la presentación de cada boletín y cada edición en PDF.
   - Plan de Desarrollo: cada pilar publicado y sus proyectos, con su avance.
   - Observatorio: cada tema publicado y sus tablas (las primeras filas). Las
     tablas de ejemplo (`sample`) no entran.
   - Portal de Impacto: lo que Pilo ya dice en ese portal (sus notas) por
     programa y en conjunto. Ese portal pide sesión, así que la función del
     servidor solo lo usa con quien la tiene.

   Los datos de la base no siempre traen la forma que dice su tipo: años donde
   se espera texto, nulos, objetos, cifras que no son número. Cada armador lee
   todo con `clean` y `numberOrNull`, y `finalize` deja cada pasaje listo para
   `pilo_memory_replace`: sin «undefined», «null» ni «[object Object]», sin
   frases con cifras de dinero, con los topes de la base y sin los que no
   llegan a 10 caracteres (la base los descartaría en silencio).

   `pilo_memory_replace` recibe los pasajes de una fuente y deja la tabla
   igual a ellos: lo que cambió estrena fecha y las respuestas guardadas que
   lo citaban dejan de servirse. Por eso una fuente que falla o que llega
   vacía no se envía: una lista vacía borraría lo que ya sabe Pilo.

   Tamaño: cada pasaje va recortado a BODY_MAX caracteres y cada fuente viaja
   en una sola llamada. Una fuente que pase de MAX_ROWS pasajes o de
   MAX_PAYLOAD_BYTES no se envía (la llamada borra lo que no viene, así que
   partirla en trozos exigiría otra función en la base).
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { readFunctionError, supabase } from "../../../lib/supabase";
import { usePillars, useProjects, useStructure } from "../../../data/queries";
import { formatValue, useOpenDataCatalog, valueOf } from "../../datos-abiertos/data/open-data";
import { ALL_CAMPUSES } from "../../datos-abiertos/data/types";
import { ALL_YEARS, ANNUAL_RULE_LABEL } from "../../datos-abiertos/data/terms";
import type { Term } from "../../datos-abiertos/data/terms";
import type { Indicator, OpenDataCatalog, ValueFormat } from "../../datos-abiertos/data/types";
import { OBS_TOPICS } from "../../datos-abiertos/observatorio/data";
import { summarize, useObservatoryLive } from "../../datos-abiertos/observatorio/live";
import type { LiveSummary, LiveTopic } from "../../datos-abiertos/observatorio/live";
import type { ObsColumn, ObsDataset } from "../observatorio/model";
import { bulletinFileUrl, usePublicBulletins } from "../../boletin/data";
import { defaultTexts } from "../../boletin/model";
import type { BulletinTexts } from "../../boletin/model";
import { usePortalData } from "../../impacto/portal/data";
import type { PortalData } from "../../impacto/portal/data";
import { functionLinks, goalStates, goalsNote, linksNote, programChain, programNote, programsOf, riverCounts, riverNote } from "../../impacto/portal/analysis";
import { programStandingNote, programStandings } from "../../impacto/portal/standing";
import type { ProjectWithLinks } from "../../../types/database";
import type { PillarWithProgress } from "../../../data/queries";
import { meshFromRows, pdiMesh } from "./mesh";
import type { MeshPayload } from "./mesh";
import { DEFAULT_SPACE, isDefaultSpace, readInSpace, spaceArgs, spaceBody, spaceKey } from "./space";
import type { PiloSpace } from "./space";

export type MemorySource = "cifras" | "boletines" | "pdi" | "observatorio" | "impacto";

export const MEMORY_SOURCES: { id: MemorySource; code: string; name: string; desc: string; line: number; session?: boolean }[] = [
  { id: "cifras", code: "CI", name: "UDES en Cifras", desc: "Informes e indicadores con su última cifra", line: 1 },
  { id: "boletines", code: "BO", name: "Boletines", desc: "Presentación de cada boletín y ediciones en PDF", line: 3 },
  { id: "pdi", code: "PD", name: "Plan de Desarrollo", desc: "Pilares y proyectos con su avance", line: 6 },
  { id: "observatorio", code: "OB", name: "Observatorio", desc: "Temas publicados y sus tablas", line: 2 },
  { id: "impacto", code: "IM", name: "Portal de Impacto", desc: "Cumplimiento y cadena de valor por programa", line: 8, session: true },
];

export interface MemoryRow {
  ref: string;
  title: string;
  section: string;
  body: string;
  path: string;
  cut: string;
  office: string;
}

/* --- Topes ------------------------------------------------------------------------------ */

/** La base descarta los pasajes de menos de 10 caracteres. */
export const MIN_BODY = 10;
/** La base guarda hasta 8000; a la mitad, el pasaje sigue siendo legible y la llamada liviana. */
export const BODY_MAX = 4000;
/** Más pasajes que esto en una fuente es señal de que algo se repite: no se envía. */
export const MAX_ROWS = 5000;
/** Una sola llamada a PostgREST: se queda muy por debajo de lo que acepta la API. */
export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const LIMITS = { ref: 300, title: 300, section: 300, path: 300, cut: 60, office: 200 } as const;
const PLANNING = "Oficina de Planeación Institucional";

/* --- Texto a prueba de datos reales ---------------------------------------------------------- */

const MONEY = /dinero|peso|\$|cop\b|millones|presupuest/i;
/** Lo que se cuela cuando un dato no era texto. Última defensa: `clean` ya lo evita. */
const JUNK = /\[object Object\]|\bundefined\b|\bnull\b|\bNaN\b/g;

/** Texto limpio de lo que venga: los datos de la base no siempre traen texto (años, nulos, objetos). */
export const clean = (s: unknown): string =>
  (typeof s === "string" ? s : typeof s === "number" && Number.isFinite(s) ? String(s) : "").replace(/\s+/g, " ").trim();

/** ¿Habla de dinero? Para nombres, unidades y títulos: si sí, no entra. */
const isMoney = (s: unknown) => MONEY.test(clean(s));

/** Quita las frases que dan una cifra de dinero (palabra de dinero y un número en la misma frase). */
export function noMoney(text: string): string {
  if (!MONEY.test(text)) return text;
  return text
    .split(/(?<=[.!?…;])\s+/)
    .filter((part) => !(MONEY.test(part) && /\d/.test(part)))
    .join(" ");
}

/** Una frase con su punto final; vacía si no hay texto. */
export const sentence = (s: unknown): string => {
  const t = noMoney(clean(s));
  return !t ? "" : /[.!?…]$/.test(t) ? t : `${t}.`;
};

/** Número de lo que venga ("12,5" no: la base manda punto). */
export const numberOrNull = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const arrayOf = <T>(v: unknown): T[] => (Array.isArray(v) ? (v.filter((x) => x !== null && x !== undefined) as T[]) : []);

const pct = (n: number) => `${formatValue(n, "decimal")} %`;

/** "2026-12-31" → "31 de diciembre de 2026"; otra cosa, tal cual. */
function dateText(v: unknown): string {
  const t = clean(v);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return t;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return Number.isNaN(d.getTime()) ? t : new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(d);
}

/** Recorta en la última frase completa que quepa. */
function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, max - 1);
  const stop = head.lastIndexOf(". ");
  return `${stop > max * 0.6 ? head.slice(0, stop + 1) : head.trimEnd()}…`;
}

const tidy = (s: unknown, max: number) => clip(clean(clean(s).replace(JUNK, "")), max);

/**
 * Deja los pasajes como los recibe la base: campos en texto y con sus topes,
 * cuerpo sin cifras de dinero, sin los que no tienen referencia, título o
 * cuerpo suficiente, y sin referencias repetidas (gana la primera).
 */
export function finalize(rows: Partial<Record<keyof MemoryRow, unknown>>[]): MemoryRow[] {
  const seen = new Set<string>();
  const out: MemoryRow[] = [];
  for (const r of rows) {
    const ref = clean(r.ref).slice(0, LIMITS.ref);
    const title = tidy(r.title, LIMITS.title);
    const body = clip(clean(noMoney(clean(r.body).replace(JUNK, ""))), BODY_MAX);
    if (ref.length < 3 || !title || body.length < MIN_BODY || seen.has(ref)) continue;
    seen.add(ref);
    out.push({
      ref,
      title,
      section: tidy(r.section, LIMITS.section),
      body,
      path: clean(r.path).slice(0, LIMITS.path),
      cut: tidy(r.cut, LIMITS.cut),
      office: tidy(r.office, LIMITS.office),
    });
  }
  return out;
}

/* --- UDES en Cifras ------------------------------------------------------------------ */

/** Cifra del corte, o null si no la hay o no es un número (la base puede traer cualquier cosa). */
function figureOf(indicator: Indicator, year: number, campus: string, term?: Term): number | null {
  try {
    return numberOrNull(valueOf(indicator, year, campus, term));
  } catch {
    return null;
  }
}

function figure(indicator: Indicator, value: number) {
  const f = formatValue(value, indicator.format);
  const unit = clean(indicator.unit);
  return indicator.format === "porcentaje" || unit === "%" ? `${f} %` : `${f} ${unit}`.trim();
}

/**
 * Lo que la memoria dice de un indicador. Si se reporta por periodo, manda el
 * periodo más reciente con cifra, comparado con el anterior y con el mismo del
 * año anterior; la cifra del año va después y diciendo cómo la calcula el
 * portal. Si solo se reporta por año, va su cifra del año, como siempre.
 */
function indicatorBody(indicator: Indicator, catalog: OpenDataCatalog, label: string): { body: string; cut: string } {
  const years = arrayOf<unknown>(catalog.years)
    .filter((y): y is number => typeof y === "number" && Number.isFinite(y) && y !== ALL_YEARS)
    .sort((a, b) => b - a);
  const campuses = arrayOf<{ id?: unknown; name?: unknown }>(catalog.campuses).filter((c) => typeof c.id === "string" && c.id !== ALL_CAMPUSES && clean(c.name));
  const byCampus = (year: number, term?: Term) =>
    campuses
      .map((c) => [clean(c.name), figureOf(indicator, year, c.id as string, term)] as const)
      .filter(([, v]) => v !== null)
      .map(([name, v]) => `${name} ${figure(indicator, v!)}`);
  const year = years.find((y) => figureOf(indicator, y, ALL_CAMPUSES) !== null);
  const parts: string[] = [];
  let cut = "";
  // Los periodos, del más reciente al más antiguo: 2025-2, 2025-1, 2024-2…
  const terms = indicator.terms && typeof indicator.terms === "object" ? years.flatMap((y) => (["B", "A"] as const).map((t) => ({ y, t }))) : [];
  const termCut = (c: { y: number; t: Term }) => `${c.y}-${c.t === "A" ? 1 : 2}`;
  const head = terms.findIndex((c) => figureOf(indicator, c.y, ALL_CAMPUSES, c.t) !== null);
  if (head >= 0) {
    const now = terms[head];
    cut = termCut(now);
    parts.push(`${label}: ${figure(indicator, figureOf(indicator, now.y, ALL_CAMPUSES, now.t)!)} en ${cut}, el periodo más reciente con cifra, en toda la UDES.`);
    const campus = byCampus(now.y, now.t);
    if (campus.length) parts.push(`Por campus en ${cut}: ${campus.join("; ")}.`);
    const back = (steps: number, what: string) => {
      const before = terms[head + steps];
      const v = before ? figureOf(indicator, before.y, ALL_CAMPUSES, before.t) : null;
      if (before && v !== null) parts.push(`En ${termCut(before)}, ${what}, fue ${figure(indicator, v)}.`);
    };
    back(1, "el periodo anterior");
    back(2, "el mismo periodo del año anterior");
    if (year !== undefined) {
      const rule = indicator.annualRule ? ANNUAL_RULE_LABEL[indicator.annualRule] : "";
      parts.push(`Cifra del año ${year}${rule ? ` (${rule.charAt(0).toLowerCase()}${rule.slice(1)})` : ""}: ${figure(indicator, figureOf(indicator, year, ALL_CAMPUSES)!)}.`);
    }
  } else if (year !== undefined) {
    cut = String(year);
    parts.push(`${label}: ${figure(indicator, figureOf(indicator, year, ALL_CAMPUSES)!)} en ${year}, en toda la UDES.`);
    const campus = byCampus(year);
    if (campus.length) parts.push(`Por campus en ${year}: ${campus.join("; ")}.`);
    const prev = years.find((y) => y < year && figureOf(indicator, y, ALL_CAMPUSES) !== null);
    if (prev !== undefined) parts.push(`En ${prev} fue ${figure(indicator, figureOf(indicator, prev, ALL_CAMPUSES)!)}.`);
  } else {
    parts.push(`${label}: sin cifra reportada todavía. Un dato sin reportar no es un cero.`);
  }
  const definition = sentence(indicator.definition);
  if (definition) parts.push(`Qué mide: ${definition}`);
  const source = sentence(indicator.source);
  if (source) parts.push(`Lo reporta ${source}`);
  if (catalog.illustrative) parts.push("Estas cifras están marcadas como dato ilustrativo en el portal.");
  return { body: parts.join(" "), cut: catalog.illustrative && cut ? `${cut} · ilustrativo` : cut };
}

/** Cómo sale la cifra del año de los periodos (la regla anual del portal), para decirlo al darla. */
export type AnnualBasis = "suma" | "promedio" | "p1" | "p2";

/** La serie completa de un indicador, para `pilo_facts_replace` (0107). */
export interface FactRow {
  ref: string;
  report: string;
  label: string;
  unit: string;
  format: ValueFormat;
  definition: string;
  office: string;
  path: string;
  period: string;
  illustrative: boolean;
  /** `k` solo va en la cifra del año de un indicador que se reporta por periodo: dice de dónde salió. */
  series: { y: number; t: "A" | "B" | null; c: string; v: number; k?: AnnualBasis }[];
}

/**
 * Las cifras en vivo de Pilo: cada indicador publicado con todas sus cifras
 * (año, periodo 1 y 2, cada sede y toda la UDES), tal como las calcula el
 * portal. El total de la UDES va con sede "". Sin dinero, como la memoria.
 *
 * La cifra del año no se calcula aquí ni en la función: es la del portal, y
 * lleva en `k` su regla (suma, promedio o el periodo del que salió) para que
 * Pilo diga qué es. Un indicador que se reporta por año no lleva periodos ni `k`.
 */
export function factRows(catalog: OpenDataCatalog | null | undefined): FactRow[] {
  if (!catalog) return [];
  const period = clean(catalog.period?.label);
  const years = arrayOf<unknown>(catalog.years).filter((y): y is number => typeof y === "number" && Number.isFinite(y) && y !== ALL_YEARS);
  const campusName = new Map<string, string>([[ALL_CAMPUSES, ""]]);
  for (const c of arrayOf<{ id?: unknown; name?: unknown }>(catalog.campuses)) {
    if (typeof c.id === "string" && c.id !== ALL_CAMPUSES && clean(c.name)) campusName.set(c.id, clean(c.name));
  }
  const out: FactRow[] = [];
  for (const report of arrayOf<OpenDataCatalog["reports"][number]>(catalog.reports)) {
    const slug = clean(report.slug);
    const name = clean(report.name);
    if (!slug || !name || isMoney(name)) continue;
    for (const indicator of arrayOf<Indicator>(report.indicators)) {
      const label = clean(indicator.label);
      const id = clean(indicator.id);
      if (!label || !id || isMoney(indicator.unit) || isMoney(label)) continue;
      const series: FactRow["series"] = [];
      const basis = (y: number, key: string): AnnualBasis | undefined => {
        if (!indicator.terms) return undefined;
        if (indicator.annualRule === "suma" || indicator.annualRule === "promedio") return indicator.annualRule;
        if (indicator.annualRule !== "ultimo") return undefined;
        const from = indicator.annualFrom?.[y]?.[key];
        return from === "A" ? "p1" : from === "B" ? "p2" : undefined;
      };
      const add = (y: number, t: "A" | "B" | null, cells: Partial<Record<string, number | null>> | undefined) => {
        for (const [key, raw] of Object.entries(cells ?? {})) {
          const v = numberOrNull(raw);
          const c = campusName.get(key);
          if (v === null || c === undefined) continue;
          const k = t === null ? basis(y, key) : undefined;
          series.push(k ? { y, t, c, v, k } : { y, t, c, v });
        }
      };
      for (const y of years) {
        if (indicator.years && !indicator.years.includes(y)) continue;
        add(y, null, indicator.values?.[y]);
        add(y, "A", indicator.terms?.[y]?.A);
        add(y, "B", indicator.terms?.[y]?.B);
      }
      if (!series.length) continue;
      out.push({
        ref: `cifras:${slug}:${id}`.slice(0, LIMITS.ref),
        report: clip(name, 300),
        label: clip(label, 300),
        unit: clip(clean(indicator.unit), 60),
        format: indicator.format === "porcentaje" || indicator.format === "decimal" ? indicator.format : "entero",
        definition: clip(noMoney(clean(indicator.definition)), 1200),
        office: clip(clean(indicator.source), LIMITS.office),
        path: `/datos-abiertos/${slug}`,
        period,
        illustrative: Boolean(catalog.illustrative),
        series,
      });
    }
  }
  return out;
}

export function cifrasRows(catalog: OpenDataCatalog | null | undefined): MemoryRow[] {
  if (!catalog) return [];
  const out: Partial<MemoryRow>[] = [];
  const period = clean(catalog.period?.label);
  for (const report of arrayOf<OpenDataCatalog["reports"][number]>(catalog.reports)) {
    const slug = clean(report.slug);
    const name = clean(report.name);
    if (!slug || !name || isMoney(name)) continue;
    const path = `/datos-abiertos/${slug}`;
    // Sin dinero: ni el indicador cuya unidad o nombre lo es, ni su lista.
    const indicators = arrayOf<Indicator>(report.indicators).filter((i) => clean(i.label) && clean(i.id) && !isMoney(i.unit) && !isMoney(i.label));
    out.push({
      ref: `cifras:${slug}`,
      title: `Informe ${name}`,
      section: "UDES en Cifras",
      body: [
        sentence(report.summary),
        sentence(report.description),
        indicators.length ? `Indicadores: ${indicators.map((i) => clean(i.label)).join(", ")}.` : "",
        catalog.illustrative ? "Sus cifras están marcadas como dato ilustrativo en el portal." : "",
      ]
        .filter(Boolean)
        .join(" "),
      path,
      cut: period,
      office: PLANNING,
    });
    for (const indicator of indicators) {
      const label = clean(indicator.label);
      const b = indicatorBody(indicator, catalog, label);
      out.push({ ref: `cifras:${slug}:${clean(indicator.id)}`, title: label, section: `Informe ${name}`, body: b.body, path, cut: b.cut, office: clean(indicator.source) });
    }
  }
  return finalize(out);
}

/* --- Boletines ----------------------------------------------------------------------- */

interface BulletinLike {
  id: unknown;
  slug: unknown;
  title: unknown;
  settings: unknown;
}
interface EditionLike {
  id: unknown;
  title: unknown;
  period_label: unknown;
  cut_label?: unknown;
  note?: unknown;
  file_path: unknown;
}

export interface BulletinContext {
  /** Rótulo del periodo publicado: lo usan los textos por defecto y el corte «todos los años». */
  periodLabel?: string | null;
  /** Años del catálogo: un corte fuera de ellos se lee como todo el periodo, como en el portal. */
  years?: number[] | null;
}

const BULLETIN_TEXT_KEYS: (keyof BulletinTexts)[] = ["coverTitle", "coverSubtitle", "presentationTitle", "presentation", "backNote"];

export function bulletinRows(bundle: { bulletins?: BulletinLike[] | null; editions?: EditionLike[] | null } | null | undefined, context: BulletinContext = {}): MemoryRow[] {
  if (!bundle) return [];
  const out: Partial<MemoryRow>[] = [];
  const periodLabel = clean(context.periodLabel);
  const years = arrayOf<unknown>(context.years).filter((y): y is number => typeof y === "number");
  for (const b of arrayOf<BulletinLike>(bundle.bulletins)) {
    const key = clean(b.slug) || clean(b.id);
    if (!key) continue;
    const title = clean(b.title) || "Boletín UDES en Cifras";
    const settings = isRecord(b.settings) ? b.settings : {};
    // Lo que no guardó la plantilla lo pone el boletín por defecto (normalizeSettings hace lo mismo).
    const defaults = defaultTexts(periodLabel, settings.format === "ejecutivo" ? "ejecutivo" : "completo");
    const saved = isRecord(settings.texts) ? settings.texts : {};
    const text = (k: keyof BulletinTexts) => {
      const v = saved[k];
      return typeof v === "string" || typeof v === "number" ? clean(v) : clean(defaults[k]);
    };
    const body = BULLETIN_TEXT_KEYS.map((k) => sentence(text(k))).filter(Boolean).join(" ");
    // El corte del boletín es un año; 0 (o un año que el periodo no tiene) es todo el periodo.
    const cut = typeof settings.cut === "number" && settings.cut > 0 && (!years.length || years.includes(settings.cut)) ? String(settings.cut) : periodLabel;
    out.push({
      ref: `boletines:${key}`,
      title,
      section: "Boletín en línea",
      body: body.length >= MIN_BODY ? body : `${title}: boletín estadístico de UDES en Cifras, se lee en línea y se imprime.`,
      path: `/datos-abiertos/boletines/${key}`,
      cut,
      office: text("coverOffice") || PLANNING,
    });
  }
  for (const e of arrayOf<EditionLike>(bundle.editions)) {
    const id = clean(e.id);
    const file = clean(e.file_path);
    // Sin archivo no hay a dónde mandar a quien pregunta.
    if (!id || !file) continue;
    const title = clean(e.title) || "Boletín UDES en Cifras";
    const period = clean(e.period_label);
    const cutLabel = clean(e.cut_label);
    out.push({
      ref: `boletines:edicion:${id}`,
      title,
      section: "Edición en PDF",
      body: [period ? `${title}, edición en PDF del periodo ${period}.` : `${title}, edición en PDF.`, cutLabel ? `Corte: ${cutLabel}.` : "", sentence(e.note)].filter(Boolean).join(" "),
      path: bulletinFileUrl(file),
      cut: cutLabel || period,
      office: PLANNING,
    });
  }
  return finalize(out);
}

/* --- Plan de Desarrollo ---------------------------------------------------------------- */

/**
 * Con sesión de intranet, RLS deja ver los pilares en borrador y sus
 * proyectos: aquí solo entra lo publicado, como lo ve el público.
 */
export function pdiRows(pillars: PillarWithProgress[] | null | undefined, projects: ProjectWithLinks[] | null | undefined): MemoryRow[] {
  const out: Partial<MemoryRow>[] = [];
  const year = String(new Date().getFullYear());
  const published = arrayOf<PillarWithProgress>(pillars).filter((p) => p.status === "publicado" && clean(p.slug) && clean(p.name) && !isMoney(p.name));
  const byId = new Map(published.map((p) => [p.id, p]));
  for (const p of published) {
    const name = clean(p.name);
    const numeral = clean(p.numeral);
    const progress = numberOrNull(p.progress?.progress);
    out.push({
      ref: `pdi:pilar:${clean(p.slug)}`,
      title: numeral ? `Pilar ${numeral} · ${name}` : `Pilar ${name}`,
      section: "Plan de Desarrollo Institucional 2024-2028",
      body: [
        progress !== null
          ? `El pilar ${numeral ? `${numeral}, ` : ""}${name}, lleva un avance de ${pct(progress)}.`
          : `El pilar ${numeral ? `${numeral}, ` : ""}${name}, todavía no tiene avance reportado.`,
        sentence(p.description),
        clean(p.focus) ? `Se enfoca en: ${sentence(p.focus)}` : "",
        clean(p.impulsor) ? `Impulsor: ${sentence(p.impulsor)}` : "",
        clean(p.contributes) ? `Aporta a: ${sentence(p.contributes)}` : "",
        clean(p.management_owner) ? `Lo gestiona ${sentence(p.management_owner)}` : "",
        clean(p.insight) ? `Lectura de Planeación: ${sentence(p.insight)}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      path: `/implementacion/pilar/${clean(p.slug)}`,
      cut: year,
      office: clean(p.management_owner),
    });
  }
  for (const pr of arrayOf<ProjectWithLinks>(projects)) {
    const pillar = byId.get(pr.pillar_id);
    const name = clean(pr.name);
    const id = clean(pr.id);
    // El proyecto de un pilar sin publicar tampoco se publica; el que nombra dinero no entra.
    if (!pillar || !name || !id || isMoney(name)) continue;
    const progress = numberOrNull(pr.progress);
    const owner = clean(pr.owner);
    const end = dateText(pr.end_date ?? pr.due_date);
    out.push({
      ref: `pdi:proyecto:${id}`,
      title: name,
      section: `Proyecto del pilar ${clean(pillar.numeral)} · ${clean(pillar.name)}`,
      body: [
        progress !== null ? `El proyecto ${name} lleva un avance de ${pct(progress)}.` : `El proyecto ${name} todavía no tiene avance reportado.`,
        sentence(pr.description),
        sentence(pr.detail),
        owner ? `Responsable: ${sentence(owner)}` : "",
        end ? `Termina el ${end}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      path: `/implementacion/pilar/${clean(pillar.slug)}`,
      cut: year,
      office: owner,
    });
  }
  return finalize(out);
}

/* --- Observatorio ---------------------------------------------------------------------- */

const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 2 });

/** Una casilla como texto: número en es-CO, texto tal cual, lo demás (objetos, nulos) vacío. */
function cellText(cell: unknown): string {
  if (typeof cell === "number") return Number.isFinite(cell) ? (Number.isInteger(cell) ? integer : decimals).format(cell) : "";
  if (typeof cell === "boolean") return cell ? "sí" : "no";
  return clean(cell);
}

function summaryText(summary: LiveSummary | null): string {
  if (!summary || isMoney(summary.label) || isMoney(summary.unit)) return "";
  const label = clean(summary.label);
  const value = numberOrNull(summary.value);
  if (!label || value === null) return "";
  const format: ValueFormat = summary.format ?? "decimal";
  const unit = clean(summary.unit);
  return `${label}: ${formatValue(value, format)}${format === "porcentaje" ? " %" : unit ? ` ${unit}` : ""}.`;
}

function datasetBody(d: ObsDataset): string {
  const columns = arrayOf<ObsColumn>(d.columns).filter((c) => clean(c.key) && clean(c.label) && !isMoney(c.label) && !isMoney(c.unit));
  const rows = arrayOf<Record<string, unknown>>(d.rows)
    .filter((r) => isRecord(r) && r.kind !== "grupo")
    .map((r) => {
      const cells = isRecord(r.cells) ? r.cells : {};
      const values = columns.map((c) => cellText(cells[c.key]));
      if (values.every((v) => !v)) return "";
      return [clean(r.year), clean(r.label), ...values.map((v) => v || "—")].filter(Boolean).join(" | ");
    })
    .filter(Boolean)
    .slice(0, 30);
  return [
    sentence(d.description),
    columns.length ? `Columnas: ${columns.map((c) => clean(c.label)).join(", ")}.` : "",
    rows.length ? `Filas: ${rows.join("; ")}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function observatoryRows(live: Map<string, LiveTopic> | null | undefined): MemoryRow[] {
  const out: Partial<MemoryRow>[] = [];
  for (const topic of OBS_TOPICS) {
    const published = live?.get(topic.slug);
    // Sin datos publicados el tema muestra datos de ejemplo: no entran.
    if (!published) continue;
    // Tampoco las tablas de ejemplo que se hayan publicado, ni los visores que las dibujan.
    const real = new Map<string, ObsDataset>();
    const all = published.datasets instanceof Map ? [...published.datasets.values()] : [];
    for (const d of all) if (d && !d.sample && clean(d.id)) real.set(d.id, d);
    const views = arrayOf<LiveTopic["views"][number]>(published.views).filter((v) => real.has(v.datasetId));
    if (!views.length) continue;
    const used = [...new Set(views.map((v) => v.datasetId))].map((id) => real.get(id)!);
    let summary: LiveSummary | null = null;
    try {
      summary = summarize({ ...published, datasets: real, views });
    } catch {
      summary = null;
    }
    const sources = [...new Set(used.map((d) => clean(d.source)).filter(Boolean))];
    const updatedAt = used.map((d) => clean(d.updatedAt)).filter(Boolean).sort().pop() ?? "";
    const path = `/datos-abiertos/observatorio/${topic.slug}`;
    out.push({
      ref: `observatorio:${topic.slug}`,
      title: topic.name,
      section: "Observatorio de Analítica Académica",
      body: [sentence(topic.summary), `Responde: ${clean(topic.question)}`, summaryText(summary), sources.length ? `Fuentes: ${sources.join(", ")}.` : ""].filter(Boolean).join(" "),
      path,
      cut: updatedAt.slice(0, 10),
      office: topic.source,
    });
    for (const d of real.values()) {
      const title = clean(d.title);
      if (!title || isMoney(title)) continue;
      out.push({
        ref: `observatorio:${topic.slug}:${clean(d.id)}`,
        title,
        section: topic.name,
        body: datasetBody(d),
        path,
        cut: clean(d.periodLabel),
        office: clean(d.source) || topic.source,
      });
    }
  }
  return finalize(out);
}

/* --- Portal de Impacto ----------------------------------------------------------------- */

const noteText = (n: { title?: unknown; lines?: unknown } | null | undefined) =>
  n ? [sentence(n.title), ...arrayOf<unknown>(n.lines).map(sentence)].filter(Boolean).join(" ") : "";

/** Una nota que no se deja armar con datos raros no tumba la fuente: queda vacía. */
function safely(make: () => string): string {
  try {
    return make();
  } catch {
    return "";
  }
}

/** El portal sin los indicadores de dinero: así tampoco los nombran las notas por programa. */
function withoutMoney(data: PortalData): PortalData {
  const indicators = arrayOf<PortalData["indicators"][number]>(data.indicators);
  const programIndicators = arrayOf<PortalData["programIndicators"][number]>(data.programIndicators);
  const money = new Set([...indicators, ...programIndicators].filter((i) => isMoney(i.name) || isMoney(i.unitLabel)).map((i) => i.id));
  const keep = <T extends { indicatorId: string }>(list: unknown) => arrayOf<T>(list).filter((x) => !money.has(x.indicatorId));
  return {
    ...data,
    indicators: indicators.filter((i) => !money.has(i.id)),
    programIndicators: programIndicators.filter((i) => !money.has(i.id)),
    dimensions: arrayOf(data.dimensions),
    refs: keep(data.refs),
    alignments: keep(data.alignments),
    pillars: arrayOf(data.pillars),
    units: arrayOf(data.units),
    unitFunctions: arrayOf(data.unitFunctions),
    campuses: arrayOf(data.campuses),
    offer: arrayOf(data.offer),
    adoptions: keep(data.adoptions),
    values: keep(data.values),
  };
}

export function impactRows(raw: PortalData | null | undefined): MemoryRow[] {
  if (!raw) return [];
  const data = withoutMoney(raw);
  const out: Partial<MemoryRow>[] = [];
  const year = String(new Date().getFullYear());
  out.push({ ref: "impacto:metas", title: "Cumplimiento de metas en el Portal de Impacto", section: "Portal de Impacto", body: safely(() => noteText(goalsNote(goalStates(data)))), path: "/impacto", cut: "Meta 2026", office: "Vicerrectorías" });
  out.push({ ref: "impacto:cadena", title: "La cadena de valor de las funciones sustantivas", section: "Portal de Impacto", body: safely(() => noteText(riverNote(riverCounts(data)))), path: "/impacto#matriz", cut: year, office: "Vicerrectorías" });
  out.push({ ref: "impacto:lazos", title: "Lazos entre funciones: pilares y ODS", section: "Portal de Impacto", body: safely(() => noteText(linksNote(functionLinks(data)))), path: "/impacto", cut: year, office: "Vicerrectorías" });
  let programs: ReturnType<typeof programsOf> = [];
  try {
    programs = programsOf(data);
  } catch {
    programs = [];
  }
  for (const program of programs) {
    const name = clean(program.name);
    const key = clean(program.slug) || clean(program.id);
    if (!name || !key) continue;
    let rows: ReturnType<typeof programStandings> = [];
    try {
      rows = programStandings(data, program.id);
    } catch {
      rows = [];
    }
    if (!rows.length) continue;
    const faculty = clean(program.faculty?.name);
    out.push({
      ref: `impacto:programa:${key}`,
      title: `Programa ${name}`,
      section: faculty ? `Portal de Impacto · ${faculty}` : "Portal de Impacto",
      body: [safely(() => noteText(programStandingNote(name, rows))), safely(() => noteText(programNote(name, programChain(data, program.id))))].filter(Boolean).join(" "),
      path: `/impacto/programa/${key}`,
      cut: "Meta 2026",
      office: faculty,
    });
  }
  for (const i of data.indicators) {
    const id = clean(i.id);
    const name = clean(i.name);
    if (!id || !name) continue;
    // La meta en texto se pierde si la base la guardó como número: queda la numérica.
    const targetNum = numberOrNull(i.target2026Num);
    const target = clean(i.target2026) || (targetNum !== null ? formatValue(targetNum, Number.isInteger(targetNum) ? "entero" : "decimal") : "");
    const unit = clean(i.unitLabel);
    out.push({
      ref: `impacto:indicador:${id}`,
      title: [clean(i.code), name].filter(Boolean).join(" · "),
      section: "Ficha de indicador del Portal de Impacto",
      body: [
        sentence(i.description) || `${name}: indicador del Portal de Impacto.`,
        target ? `Meta 2026: ${sentence(unit && !target.includes(unit) ? `${target} ${unit}` : target)}` : "",
        clean(i.source) ? `Fuente: ${sentence(i.source)}` : "",
        clean(i.responsible) ? `Responsable: ${sentence(i.responsible)}` : "",
      ]
        .filter(Boolean)
        .join(" "),
      path: "/impacto",
      cut: "Meta 2026",
      office: clean(i.responsible),
    });
  }
  return finalize(out);
}

/* --- Leer todo y armar ------------------------------------------------------------------- */

/** Por qué una fuente no se envía: falló al leerse o armarse, llegó vacía o es demasiado grande. */
export interface SourceProblem {
  source: MemorySource;
  kind: "error" | "vacia";
  message: string;
}

export interface MemoryBuild {
  /** Solo las fuentes listas para enviar. */
  rows: Partial<Record<MemorySource, MemoryRow[]>>;
  /** La malla de cada fuente lista (0097); sus pasajes nuevos ya van en `rows`. */
  meshes?: Partial<Record<MemorySource, MeshPayload>>;
  /** Las cifras en vivo (0107): van con UDES en Cifras, solo si esa fuente quedó lista. */
  facts?: FactRow[];
  problems: SourceProblem[];
}

/** Mensaje corto y en español para la lista de resultados. */
export function problemMessage(error: unknown): string {
  const text = clean(error instanceof Error ? error.message : typeof error === "string" ? error : "");
  if (!text) return "Falló sin decir por qué.";
  // Los errores del navegador llegan en inglés: se dicen como fallo de lectura de los datos.
  if (/^(TypeError|RangeError|ReferenceError)|is not a function|Cannot read properties|undefined/i.test(error instanceof Error ? `${error.name}: ${text}` : text)) {
    return `Los datos llegaron con una forma inesperada (${clip(text, 120)}).`;
  }
  return clip(text, 160);
}

/**
 * Arma cada fuente por separado: una que falla no detiene a las demás. Lo
 * que no se puede enviar sin riesgo (error, vacío, demasiado grande) queda en
 * `problems` y su memoria se queda como estaba.
 */
export function buildSources(makers: Record<MemorySource, () => MemoryRow[]>): MemoryBuild {
  const rows: MemoryBuild["rows"] = {};
  const problems: SourceProblem[] = [];
  for (const { id } of MEMORY_SOURCES) {
    try {
      const list = makers[id]();
      if (!list.length) {
        problems.push({ source: id, kind: "vacia", message: "No trajo pasajes: se dejó la memoria que tenía." });
        continue;
      }
      if (list.length > MAX_ROWS) {
        problems.push({ source: id, kind: "error", message: `Trajo ${list.length.toLocaleString("es-CO")} pasajes, más de los ${MAX_ROWS.toLocaleString("es-CO")} que se envían de una vez.` });
        continue;
      }
      const bytes = new TextEncoder().encode(JSON.stringify(list)).length;
      if (bytes > MAX_PAYLOAD_BYTES) {
        problems.push({ source: id, kind: "error", message: `Pesa ${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB, más de los 4 MB que se envían de una vez.` });
        continue;
      }
      rows[id] = list;
    } catch (error) {
      problems.push({ source: id, kind: "error", message: problemMessage(error) });
    }
  }
  return { rows, problems };
}

/** La consulta falló: se lanza para que la fuente quede como error y no como vacía. */
function need<T>(query: { isError: boolean; error: unknown; data: T }, what: string): T {
  if (query.isError) throw query.error instanceof Error ? query.error : new Error(`No se pudo leer ${what}.`);
  return query.data;
}

/** Las consultas de los portales, listas para armar los pasajes. */
export function useMemoryInputs() {
  const catalog = useOpenDataCatalog();
  const live = useObservatoryLive();
  const pillars = usePillars();
  const projects = useProjects();
  const bulletins = usePublicBulletins(catalog.data?.period?.uuid);
  const impact = usePortalData();
  const structure = useStructure();
  const loading =
    catalog.isPending || live.isPending || pillars.isPending || projects.isPending || structure.isPending || (Boolean(catalog.data?.period?.uuid) && bulletins.isPending);
  const build = (): MemoryBuild => {
    const meshes: Partial<Record<MemorySource, MeshPayload>> = {};
    // Cada fuente trae su malla; los pasajes que nacen de ella (raíz, áreas, líneas) van con los suyos.
    const withMesh = (source: MemorySource, make: () => MemoryRow[]) => () => {
      const rows = make();
      let mesh: MeshPayload;
      try {
        mesh = source === "pdi" ? pdiMesh(need(pillars, "los pilares"), need(structure, "la estructura del plan"), need(projects, "los proyectos")) : meshFromRows(source, rows);
      } catch {
        // Sin malla la fuente igual se guarda: sus pasajes no dependen de ella.
        return rows;
      }
      meshes[source] = mesh;
      const own = new Set(rows.map((r) => r.ref));
      return [...rows, ...mesh.rows.filter((r) => !own.has(r.ref))];
    };
    const built = buildSources({
      cifras: withMesh("cifras", () => cifrasRows(need(catalog, "el catálogo de UDES en Cifras"))),
      boletines: withMesh("boletines", () => {
        const period = need(catalog, "el catálogo de UDES en Cifras");
        return bulletinRows(need(bulletins, "los boletines"), { periodLabel: period?.period?.label, years: period?.years });
      }),
      pdi: withMesh("pdi", () => pdiRows(need(pillars, "los pilares"), need(projects, "los proyectos"))),
      observatorio: withMesh("observatorio", () => observatoryRows(need(live, "el Observatorio"))),
      impacto: withMesh("impacto", () => {
        const data = need(impact, "el Portal de Impacto");
        if (!data) throw new Error(impact.isPending ? "Todavía se estaba leyendo: vuelva a intentarlo en un momento." : "Su consulta no respondió con esta sesión.");
        return impactRows(data);
      }),
    });
    for (const source of Object.keys(meshes) as MemorySource[]) if (!built.rows[source]) delete meshes[source];
    let facts: FactRow[] | undefined;
    if (built.rows.cifras) {
      try {
        facts = factRows(catalog.data);
      } catch {
        // Sin series Pilo sigue respondiendo con la última cifra de la memoria.
        facts = undefined;
      }
    }
    return { ...built, meshes, facts };
  };
  return { loading, impactReady: Boolean(impact.data), build };
}

/* --- Lo que la administración ve de la memoria ------------------------------------------ */

/** Cuántos pasajes tiene cada fuente (sin 0094: null). */
export function useMemoryCounts() {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "conteo"],
    queryFn: async (): Promise<Record<MemorySource, number> | null> => {
      const out = {} as Record<MemorySource, number>;
      for (const s of MEMORY_SOURCES) {
        const { count, error } = await supabase.from("pilo_memory").select("ref", { count: "exact", head: true }).eq("source", s.id);
        if (error) return null;
        out[s.id] = count ?? 0;
      }
      return out;
    },
  });
}

export interface SavedAnswer {
  id: number;
  question: string;
  answer: string;
  created_at: string;
  hits: number;
  up: number;
  down: number;
  hidden: boolean;
  /** Para quién se redactó (0113): «estudiante», «profesor» o vacío. Solo en espacios con rol. */
  rol?: string;
}

const ANSWER_COLUMNS = "id, question, answer, created_at, hits, up, down, hidden";

/** Las respuestas guardadas de un espacio (0113): las de un Pilo no se ven en el otro. */
export async function fetchSavedAnswers(space: PiloSpace = DEFAULT_SPACE): Promise<{ rows: SavedAnswer[]; total: number } | null> {
  const { data, error, count } = await readInSpace(space, (scoped) => {
    // «rol» solo existe con 0113: el Pilo de siempre no lo pide.
    const query = supabase.from("pilo_answers").select(isDefaultSpace(space) ? ANSWER_COLUMNS : `${ANSWER_COLUMNS}, rol`, { count: "exact" });
    return (scoped ? query.eq("space", space) : query).order("created_at", { ascending: false }).limit(8);
  });
  if (error) return null;
  return { rows: (data ?? []) as unknown as SavedAnswer[], total: count ?? 0 };
}

export function useSavedAnswers(space: PiloSpace = DEFAULT_SPACE) {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "respuestas", ...spaceKey(space)],
    queryFn: () => fetchSavedAnswers(space),
  });
}

export function useHideAnswer() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, hidden }: { id: number; hidden: boolean }) => {
      const { error } = await supabase.from("pilo_answers").update({ hidden }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["pilo-ia", "memoria", "respuestas"] }),
  });
}

export interface MemoryHit {
  ref: string;
  /** En otro espacio (0113) las fuentes son otras: llegan como texto. */
  source: MemorySource;
  title: string;
  section: string;
  cut: string;
  rank: number;
  /** Con la búsqueda por significado (0108): por dónde lo halló y cuánto se parece (coseno). */
  via?: "palabras" | "significado" | "ambas";
  sim?: number | null;
}

/* --- Búsqueda por significado (0108) ------------------------------------------------------ */

export interface EmbedStatus {
  model: string;
  memory_total: number;
  memory_done: number;
  facts_total: number;
  facts_done: number;
  /** Las respuestas oficiales del catálogo (0109): sin esa migración, 0. */
  catalog_total: number;
  catalog_done: number;
}

/**
 * Pide a pilo-ia un paso del índice. Los errores llegan en español desde la
 * función. El espacio viaja solo si no es el de partida (0113).
 */
export async function indexStep<T>(body: Record<string, unknown>, space: PiloSpace = DEFAULT_SPACE): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("pilo-ia", { body: { action: "indexar", ...body, ...spaceBody(space) } });
  if (error) throw new Error((await readFunctionError(error)) ?? "No pude hablar con Mr. Pilo ahora.");
  return data as T;
}

const statusOf = (raw: unknown): EmbedStatus | null => {
  if (!isRecord(raw)) return null;
  return {
    model: clean(raw.model),
    memory_total: numberOrNull(raw.memory_total) ?? 0,
    memory_done: numberOrNull(raw.memory_done) ?? 0,
    facts_total: numberOrNull(raw.facts_total) ?? 0,
    facts_done: numberOrNull(raw.facts_done) ?? 0,
    catalog_total: numberOrNull(raw.catalog_total) ?? 0,
    catalog_done: numberOrNull(raw.catalog_done) ?? 0,
  };
};

/** Lo que falta por indexar. */
export const pendingOf = (s: EmbedStatus | null) =>
  s ? Math.max(0, s.memory_total - s.memory_done) + Math.max(0, s.facts_total - s.facts_done) + Math.max(0, s.catalog_total - s.catalog_done) : 0;

/** Cuántos vectores están al día. El error dice por qué no se puede (proveedor, migración). */
export function useEmbedStatus(enabled = true, space: PiloSpace = DEFAULT_SPACE) {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "significado", ...spaceKey(space)],
    enabled,
    retry: false,
    queryFn: async (): Promise<EmbedStatus | null> => statusOf((await indexStep<{ status?: unknown }>({ step: "estado" }, space)).status),
  });
}

/**
 * Indexa por lotes de 64 hasta que no quede nada, avisando el avance. Si un
 * lote no guarda nada (el proveedor falla en silencio), se detiene en vez de
 * repetir para siempre.
 */
export function useIndexMemory(space: PiloSpace = DEFAULT_SPACE) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (onProgress?: (s: EmbedStatus) => void): Promise<EmbedStatus | null> => {
      let last: EmbedStatus | null = null;
      for (let round = 0; round < 200; round++) {
        const r = await indexStep<{ saved?: number; status?: unknown }>({ step: "lote" }, space);
        last = statusOf(r.status);
        if (last) onProgress?.(last);
        if (!pendingOf(last) || !r.saved) break;
      }
      return last;
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["pilo-ia", "memoria", "significado"] }),
  });
}

/** Los modelos de embeddings que el proveedor tiene activos hoy (NVIDIA retira modelos seguido). */
export function useEmbedModels() {
  return useMutation({
    mutationFn: async (): Promise<{ current: string; models: string[] }> => {
      const r = await indexStep<{ current?: string; models?: string[] }>({ step: "modelos" });
      return { current: clean(r.current), models: arrayOf<string>(r.models).map(clean).filter(Boolean) };
    },
  });
}

/**
 * Probar la memoria: los pasajes que Pilo encontraría. Con la función (0108)
 * es la búsqueda híbrida de verdad; si no responde, solo por palabras.
 */
export function useTryMemory(space: PiloSpace = DEFAULT_SPACE) {
  return useMutation({
    mutationFn: async (q: string): Promise<{ hits: MemoryHit[]; semantic: boolean; note?: string }> => {
      try {
        const r = await indexStep<{ hits?: MemoryHit[]; semantic?: boolean; error?: string }>({ step: "probar", q }, space);
        return { hits: r.hits ?? [], semantic: Boolean(r.semantic), note: r.semantic ? undefined : r.error };
      } catch (error) {
        const { data, error: rpcError } = await supabase.rpc("pilo_memory_search", { p_q: q, p_sources: null as never, p_limit: 5, ...spaceArgs(space) });
        if (rpcError) throw rpcError;
        return { hits: (data ?? []) as MemoryHit[], semantic: false, note: error instanceof Error ? error.message : undefined };
      }
    },
  });
}

export interface CatalogHit {
  key: string;
  kind: "respuesta" | "capciosa";
  question: string;
  via: "palabras" | "significado";
  /** Parecido de 0 a 1. */
  score: number;
  /** ¿Alcanza para que Pilo la use como base de su respuesta? */
  used: boolean;
}

/** Probar el catálogo (0112): las entradas que Pilo encontraría para una pregunta. */
export function useTryCatalog(space: PiloSpace = DEFAULT_SPACE) {
  return useMutation({
    mutationFn: async (q: string): Promise<{ hits: CatalogHit[]; semantic: boolean; min: number; note?: string }> => {
      const r = await indexStep<{ hits?: CatalogHit[]; semantic?: boolean; min?: number; error?: string }>({ step: "catalogo", q }, space);
      return { hits: r.hits ?? [], semantic: Boolean(r.semantic), min: r.min ?? 0.8, note: r.semantic ? undefined : r.error };
    },
  });
}

export interface ReplaceResult {
  source: MemorySource;
  added: number;
  changed: number;
  removed: number;
  total: number;
  /** La malla que se guardó (0097), o por qué no. */
  nodes?: number;
  edges?: number;
  meshError?: string;
  /** Las cifras en vivo que se guardaron (0107), o por qué no. */
  facts?: number;
  factsError?: string;
}

export interface ReplaceOutcome {
  done: ReplaceResult[];
  failed: SourceProblem[];
}

/** Guarda las series de UDES en Cifras. Devuelve por qué no se guardaron, o nada. */
async function replaceFacts(facts: FactRow[], result: ReplaceResult): Promise<string | undefined> {
  const bytes = new TextEncoder().encode(JSON.stringify(facts)).length;
  if (bytes > MAX_PAYLOAD_BYTES) return `Las cifras en vivo pesan ${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB, más de los 4 MB que se envían de una vez.`;
  const { data, error } = await supabase.rpc("pilo_facts_replace", { p_rows: facts as never });
  if (error) return /pilo_facts_replace|function/i.test(error.message) ? "Falta la migración 0107 para guardar las cifras en vivo." : problemMessage(new Error(error.message));
  result.facts = numberOrNull(isRecord(data) ? data.total : null) ?? facts.length;
  return undefined;
}

/**
 * Envía cada fuente lista en su propia llamada. Una que la base rechaza no
 * impide las siguientes; su error queda en `failed`.
 */
export function useReplaceMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ rows, meshes = {}, facts }: Pick<MemoryBuild, "rows" | "meshes" | "facts">): Promise<ReplaceOutcome> => {
      const done: ReplaceResult[] = [];
      const failed: SourceProblem[] = [];
      for (const { id: source } of MEMORY_SOURCES) {
        const list = rows[source];
        // Nunca una lista vacía: la base borraría toda la fuente.
        if (!list?.length) continue;
        try {
          const { data, error } = await supabase.rpc("pilo_memory_replace", { p_source: source, p_rows: list as never });
          if (error) throw error;
          const r = (isRecord(data) ? data : {}) as Partial<ReplaceResult>;
          const result: ReplaceResult = { source, added: numberOrNull(r.added) ?? 0, changed: numberOrNull(r.changed) ?? 0, removed: numberOrNull(r.removed) ?? 0, total: numberOrNull(r.total) ?? list.length };
          // La malla, después de sus pasajes: si falla (sin 0097), los pasajes ya quedaron.
          const mesh = meshes[source];
          if (mesh) {
            const g = await supabase.rpc("pilo_graph_replace", { p_source: source, p_nodes: mesh.nodes as never, p_edges: mesh.edges as never });
            if (g.error) result.meshError = /pilo_graph_replace|function/i.test(g.error.message) ? "Falta la migración 0097 para guardar la malla." : problemMessage(new Error(g.error.message));
            else {
              const m = (isRecord(g.data) ? g.data : {}) as Record<string, unknown>;
              result.nodes = numberOrNull(m.nodes) ?? mesh.nodes.length;
              result.edges = numberOrNull(m.edges) ?? mesh.edges.length;
            }
          }
          // Las cifras en vivo, con UDES en Cifras: si fallan (sin 0107), la memoria ya quedó.
          if (source === "cifras" && facts?.length) result.factsError = await replaceFacts(facts, result);
          done.push(result);
        } catch (error) {
          // PostgREST devuelve un objeto con `message`, no un Error.
          const reason = error instanceof Error ? error : new Error(clean(isRecord(error) ? error.message : error));
          failed.push({ source, kind: "error", message: `La base no la guardó: ${problemMessage(reason)}` });
        }
      }
      return { done, failed };
    },
    // Solo la memoria: refrescar la configuración borraría lo que aún no se guardó.
    onSettled: () => client.invalidateQueries({ queryKey: ["pilo-ia", "memoria"] }),
  });
}
