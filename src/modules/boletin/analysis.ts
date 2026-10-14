/* =============================================================================
   Boletín · Análisis de los datos (con Mr. Pilo).

   Un tercer tipo de boletín, junto al completo y al ejecutivo: un documento
   escrito. Quien lo encarga elige formato, público, tono, longitud e
   indicaciones (el «encargo») y los informes que se leen (los `reports`
   incluidos del boletín, con su corte y su campus).

   Cómo se escribe:
   · las cifras de cada informe se reúnen y se calculan aquí, sin IA
     (`analysisFacts`): serie por año, sedes del corte, variación y brecha;
   · la IA (acción «analizar» de pilo-ia) escribe un capítulo por informe con
     esas cifras y un cierre con lo que dijeron los capítulos;
   · cada número del texto se compara con las cifras: los que no están quedan
     en `unknown` para revisar antes de publicar.

   Lo escrito se guarda en od_bulletins.settings.analysis: el boletín se pagina
   y se publica como los demás, sin volver a llamar a la IA.
   ========================================================================== */

import type { AnalysisBrief, AnalysisFormat, AnalysisLength, AnalysisTone } from "../../components/pilo/ai/logic";
import { changeBetween, formatValue, valueOf } from "../datos-abiertos/data/open-data";
import { ALL_YEARS } from "../datos-abiertos/data/terms";
import type { Indicator, OpenDataCatalog, Report } from "../datos-abiertos/data/types";
import type { BulletinReport } from "./model";

export interface AnalysisChapter {
  summary: string;
  paragraphs: string[];
  alerts: string[];
  recommendations: string[];
  /** Números del texto que no están en las cifras. */
  unknown: string[];
  model: string;
  at: string;
}

export interface BulletinAnalysis {
  brief: AnalysisBrief;
  /** Cruzar con los pilares y proyectos del Plan de Desarrollo (memoria de Pilo). */
  pdi: boolean;
  /** Abre con un resumen de hallazgos. */
  summary: boolean;
  /** Pone las gráficas de los indicadores clave dentro de cada capítulo. */
  charts: boolean;
  /** Lo escrito por capítulo, por slug del informe. */
  chapters: Record<string, AnalysisChapter>;
  closing: AnalysisChapter | null;
}

export const ANALYSIS_FORMATS: { id: AnalysisFormat; label: string; for: string; text: string }[] = [
  { id: "ejecutivo", label: "Ejecutivo", for: "Para rectoría y consejos", text: "Hallazgos clave, cifras titulares y recomendaciones." },
  { id: "tecnico", label: "Técnico", for: "Para planeación", text: "Series completas, variaciones, diferencias entre sedes y límites del dato." },
  { id: "sedes", label: "Comparativo por sede", for: "Para directores de sede", text: "Las sedes lado a lado y su brecha frente al total institucional." },
  { id: "tendencias", label: "Tendencias y alertas", for: "Para seguimiento", text: "Lo que sube, lo que cae y lo que se aleja de lo esperado." },
  { id: "libre", label: "Libre", for: "Usted decide", text: "Solo con sus indicaciones." },
];

export const ANALYSIS_AUDIENCES = ["Consejo Superior", "Vicerrectorías", "Decanos y directores", "Público general"];

export const ANALYSIS_TONES: { id: AnalysisTone; label: string }[] = [
  { id: "institucional", label: "Institucional" },
  { id: "divulgativo", label: "Divulgativo" },
  { id: "tecnico", label: "Técnico" },
];

export const ANALYSIS_LENGTHS: { id: AnalysisLength; label: string; pages: string; text: string; indicators: number; seconds: number }[] = [
  { id: "breve", label: "Breve", pages: "4 a 6 páginas", text: "Un párrafo de hallazgos por informe y un cierre.", indicators: 8, seconds: 20 },
  { id: "estandar", label: "Estándar", pages: "10 a 14 páginas", text: "Capítulo por informe con cifras, lectura y alertas.", indicators: 14, seconds: 35 },
  { id: "extenso", label: "Extenso", pages: "20 páginas o más", text: "Todo lo anterior, más detalle por sede y por año.", indicators: 24, seconds: 55 },
];

export const DEFAULT_BRIEF: AnalysisBrief = {
  format: "ejecutivo",
  audience: "Consejo Superior",
  tone: "institucional",
  length: "estandar",
  alerts: true,
  recommendations: true,
  method: false,
  prompt: "",
};

export function defaultAnalysis(): BulletinAnalysis {
  return { brief: { ...DEFAULT_BRIEF }, pdi: true, summary: true, charts: true, chapters: {}, closing: null };
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown, max: number, len: number) =>
  (Array.isArray(v) ? v : []).filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.slice(0, len)).slice(0, max);

function normalizeChapter(raw: unknown): AnalysisChapter | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const paragraphs = list(c.paragraphs, 12, 4000);
  if (!paragraphs.length && !str(c.summary, 1)) return null;
  return {
    summary: str(c.summary, 600),
    paragraphs,
    alerts: list(c.alerts, 6, 600),
    recommendations: list(c.recommendations, 8, 600),
    unknown: list(c.unknown, 40, 40),
    model: str(c.model, 120),
    at: str(c.at, 40),
  };
}

/** Lo guardado nunca se da por bueno: se completa con los valores por defecto. */
export function normalizeAnalysis(raw: unknown): BulletinAnalysis {
  const base = defaultAnalysis();
  if (!raw || typeof raw !== "object") return base;
  const a = raw as Record<string, unknown>;
  const b = (a.brief && typeof a.brief === "object" ? a.brief : {}) as Record<string, unknown>;
  const pick = <T extends string>(v: unknown, ids: readonly T[], d: T): T => (ids.includes(v as T) ? (v as T) : d);
  const chapters: Record<string, AnalysisChapter> = {};
  if (a.chapters && typeof a.chapters === "object") {
    for (const [slug, value] of Object.entries(a.chapters as Record<string, unknown>)) {
      const chapter = normalizeChapter(value);
      if (chapter) chapters[slug] = chapter;
    }
  }
  return {
    brief: {
      format: pick(b.format, ANALYSIS_FORMATS.map((f) => f.id), DEFAULT_BRIEF.format),
      audience: str(b.audience, 80) || DEFAULT_BRIEF.audience,
      tone: pick(b.tone, ANALYSIS_TONES.map((t) => t.id), DEFAULT_BRIEF.tone),
      length: pick(b.length, ANALYSIS_LENGTHS.map((l) => l.id), DEFAULT_BRIEF.length),
      alerts: b.alerts !== false,
      recommendations: b.recommendations !== false,
      method: b.method === true,
      prompt: str(b.prompt, 1200),
    },
    pdi: a.pdi !== false,
    summary: a.summary !== false,
    charts: a.charts !== false,
    chapters,
    closing: normalizeChapter(a.closing),
  };
}

/* --- Las cifras que lee Pilo (sin IA) ------------------------------------------------ */

const DIRECTION = { sube: "más alto es mejor", baja: "más bajo es mejor", neutro: "sin dirección deseada" } as const;

const unitOf = (indicator: Indicator) => (indicator.format === "porcentaje" || indicator.unit === "%" ? "%" : indicator.unit);

const hasData = (indicator: Indicator, catalog: OpenDataCatalog) =>
  catalog.years.some((y) => Object.values(indicator.values[y] ?? {}).some((v) => v !== null && v !== undefined));

/** Indicadores del informe que entran al análisis: los clave primero, con dato, hasta el tope. */
export function analysisIndicators(report: Report, entry: BulletinReport | undefined, catalog: OpenDataCatalog, limit: number): Indicator[] {
  const included = new Set((entry?.indicators ?? []).filter((i) => i.include).map((i) => i.id));
  const allowed = (i: Indicator) => !entry || included.has(i.id);
  const keys = report.keyIndicators.map((id) => report.indicators.find((i) => i.id === id)).filter((i): i is Indicator => Boolean(i));
  const ordered = [...keys, ...report.indicators.filter((i) => !keys.includes(i))];
  return ordered.filter((i) => allowed(i) && hasData(i, catalog)).slice(0, limit);
}

export interface AnalysisSource {
  /** El número con que el texto la cita: «[2]». */
  n: number;
  indicator: Indicator;
  /** Años con cifra dentro del corte. */
  series: { y: number; v: number }[];
}

/**
 * Las fuentes de un capítulo, numeradas en el orden en que la IA las recibe:
 * el texto las cita («[2]») y el capítulo las lista al final.
 */
export function analysisSources(report: Report, entry: BulletinReport | undefined, catalog: OpenDataCatalog, cut: number, campus: string, limit: number): AnalysisSource[] {
  const years = cut === ALL_YEARS ? catalog.years : catalog.years.filter((y) => y <= cut);
  const out: AnalysisSource[] = [];
  for (const indicator of analysisIndicators(report, entry, catalog, limit)) {
    const own = indicator.years?.length ? years.filter((y) => indicator.years!.includes(y)) : years;
    const series = own.map((y) => ({ y, v: valueOf(indicator, y, campus) })).filter((p): p is { y: number; v: number } => p.v !== null);
    if (series.length) out.push({ n: out.length + 1, indicator, series });
  }
  return out;
}

/**
 * Las cifras de un informe, una línea por indicador: la serie por año, las
 * sedes del último año con dato, la variación frente al año anterior y la
 * brecha de cada sede frente al total. Son los únicos números que la IA puede
 * escribir; lo que no esté aquí queda marcado para revisar.
 */
export function analysisFacts(report: Report, entry: BulletinReport | undefined, catalog: OpenDataCatalog, cut: number, campus: string, limit: number): string {
  const sites = catalog.campuses.filter((c) => c.id !== "todas");
  const lines: string[] = [`Informe: ${report.name}. ${report.summary}`.trim()];
  if (campus !== "todas") lines.push(`Sede analizada: ${catalog.campuses.find((c) => c.id === campus)?.name ?? campus}.`);
  for (const { n, indicator, series } of analysisSources(report, entry, catalog, cut, campus, limit)) {
    const unit = unitOf(indicator);
    const fmt = (v: number) => `${formatValue(v, indicator.format)}${unit === "%" ? " %" : ""}`;
    const parts = [`[${n}] ${indicator.label} (${unit || "valor"}; ${DIRECTION[indicator.direction]}; reporta ${indicator.source || "la oficina responsable"})`];
    parts.push(`por año: ${series.map((p) => `${p.y}: ${fmt(p.v)}`).join(", ")}`);
    const last = series[series.length - 1];
    const prev = series.length > 1 ? series[series.length - 2] : null;
    if (prev) {
      const change = changeBetween(indicator, last.v, prev.v);
      if (change) parts.push(`cambio ${prev.y}→${last.y}: ${change.label} (${change.reading})`);
    }
    if (series.length > 2) {
      const first = series[0];
      const change = changeBetween(indicator, last.v, first.v);
      if (change) parts.push(`cambio ${first.y}→${last.y}: ${change.label}`);
    }
    if (campus === "todas" && sites.length > 1) {
      const bySite = sites
        .map((s) => ({ s, v: valueOf(indicator, last.y, s.id) }))
        .filter((x): x is { s: (typeof sites)[number]; v: number } => x.v !== null);
      if (bySite.length > 1) {
        parts.push(`sedes ${last.y}: ${bySite.map((x) => `${x.s.name} ${fmt(x.v)}`).join(", ")}`);
        if (indicator.format === "porcentaje") {
          const gaps = bySite.map((x) => `${x.s.name} ${x.v - last.v >= 0 ? "+" : "−"}${formatValue(Math.abs(x.v - last.v), "decimal")} p. p.`);
          parts.push(`brecha frente al total: ${gaps.join(", ")}`);
        }
      }
    }
    if (indicator.definition) parts.push(`qué mide: ${indicator.definition.slice(0, 160)}`);
    lines.push(parts.join("; "));
  }
  return lines.join("\n");
}

/** Lo que dijo cada capítulo, para escribir el cierre. */
export function closingFacts(chapters: { title: string; chapter: AnalysisChapter }[]): string {
  return chapters
    .map(({ title, chapter }) =>
      [`## ${title}`, chapter.summary, ...chapter.paragraphs.slice(0, 2), ...chapter.alerts.map((a) => `Alerta: ${a}`)].filter(Boolean).join("\n"),
    )
    .join("\n\n");
}
