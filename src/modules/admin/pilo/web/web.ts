/* =============================================================================
   Intranet · Mr. Pilo con IA · Páginas web · lo que se calcula sin pantalla.

   La administración le da a Pilo la dirección de una página; la función
   pilo-ia la lee («web», 0129) y la deja como documento de la memoria. Aquí:
   - los pasos de la preparación y cómo avanzan;
   - la malla de una página en cuatro columnas (página › secciones › pasajes ›
     temas), con las hojas en su fila, como la malla de la memoria;
   - los temas y normas de la página que salen del mapa, y con cuántos otros
     documentos de la memoria los comparte (ahí se ve que quedó conectada);
   - qué pasajes de la página encontró una consulta;
   - con navegador (0132): qué se dice de una lectura hecha (o no) con él.
   ========================================================================== */

import { webAddress } from "../../../../components/pilo/ai/logic";
import type { BrowserNote } from "../../../../components/pilo/ai/logic";

/** Lo que devuelve la función al leer una página. */
export interface WebRead {
  doc: string;
  url: string;
  title: string;
  bytes: number;
  cut?: boolean;
  sections: string[];
  passages: { seq: number; section: string; text: string }[];
  total: number;
  added: number;
  changed: number;
  removed: number;
  redacted: number;
  dropped: number;
  unchanged: boolean;
  mapped?: boolean;
  collection?: { id: string; name: string };
  /** Si se pidió abrirla con navegador, y qué pasó (0132). */
  browser?: BrowserNote;
}

/** Una página en pantalla: recién leída, o una ya guardada con sus pasajes de la memoria. */
export interface WebPageView {
  doc: string;
  url: string;
  title: string;
  passages: { seq: number; section: string; text: string }[];
}

/** La dirección que se puede mandar a leer, o por qué no. La misma revisión que hace la función. */
export const checkWebUrl = (raw: string) => webAddress(raw);

/** «udes.edu.co/admisiones», para decir de dónde es una página sin toda su dirección. */
export function webWhere(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/+$/, "")}`.slice(0, 80);
  } catch {
    return url.slice(0, 80);
  }
}

export const kilobytes = (bytes: number) => `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("es-CO")} KB`;

/**
 * Lo que se dice del navegador en una lectura: cuántos despliegues hizo, o que
 * se leyó sin ejecutar JavaScript y por qué. Vacío si no se pidió navegador.
 */
export function browserLine(note: BrowserNote | null | undefined): string {
  if (!note?.asked) return "";
  if (!note.used) return `se leyó sin ejecutar JavaScript${note.why ? `: ${note.why}` : ""}`;
  if (!note.tried) return "con navegador, sin nada que desplegar";
  const failed = note.tried - note.clicks;
  return `con navegador: ${note.clicks} ${note.clicks === 1 ? "despliegue" : "despliegues"}${failed > 0 ? ` (${failed} no ${failed === 1 ? "abrió" : "abrieron"})` : ""}`;
}

/* --- La preparación ---------------------------------------------------------------------- */

export type PrepId = "traer" | "limpiar" | "partir" | "indexar" | "conectar";
export type StepState = "pending" | "run" | "done" | "skip" | "fail";
export interface PrepStep {
  id: PrepId;
  label: string;
  state: StepState;
  detail: string;
}

export const PREP: { id: PrepId; label: string }[] = [
  { id: "traer", label: "Traer la página" },
  { id: "limpiar", label: "Limpiar" },
  { id: "partir", label: "Partir en pasajes" },
  { id: "indexar", label: "Indexar por significado" },
  { id: "conectar", label: "Conectar con la memoria" },
];

export const prepStart = (): PrepStep[] => PREP.map((s) => ({ ...s, state: "pending", detail: "" }));

/** Un paso cambia de estado (y de detalle, si se da). Los demás no se tocan. */
export function prepSet(steps: PrepStep[], id: PrepId, state: StepState, detail?: string): PrepStep[] {
  return steps.map((s) => (s.id === id ? { ...s, state, detail: detail ?? s.detail } : s));
}

/** Lo que dicen los tres primeros pasos cuando la función ya leyó la página. */
export function prepRead(steps: PrepStep[], r: WebRead): PrepStep[] {
  const tops = new Set(r.passages.map((p) => topSection(p.section))).size;
  const browser = browserLine(r.browser);
  let out = prepSet(steps, "traer", "done", `${kilobytes(r.bytes)}${r.cut ? " (se leyó hasta el tope)" : ""}${browser ? ` · ${browser}` : ""}`);
  out = prepSet(out, "limpiar", "done", `Sin menús, formularios ni pie${r.redacted ? ` · ${r.redacted} ${r.redacted === 1 ? "dato personal omitido" : "datos personales omitidos"}` : ""}`);
  const moved = r.unchanged ? "sin cambios desde la última lectura" : [r.added ? `${r.added} nuevos` : "", r.changed ? `${r.changed} cambiaron` : "", r.removed ? `${r.removed} se quitaron` : ""].filter(Boolean).join(", ");
  return prepSet(out, "partir", "done", `${r.total} ${r.total === 1 ? "pasaje" : "pasajes"} en ${tops} ${tops === 1 ? "sección" : "secciones"}${moved ? ` · ${moved}` : ""}${r.dropped ? ` · ${r.dropped} quedaron por fuera del tope` : ""}`);
}

/* --- La malla de una página ---------------------------------------------------------------- */

/** La sección de primer nivel de «A › B › C». */
export const topSection = (section: string) => section.split(" › ")[0] || "Presentación";

export interface WebTopic {
  id: string;
  label: string;
  kind: "tema" | "norma";
  /** Los pasajes de esta página que lo tocan (su número). */
  seqs: number[];
  /** En cuántos otros documentos de la memoria aparece. */
  shared: number;
}

const DOC_REF = /^doc:([0-9a-f-]{36}):(\d+)$/i;

/**
 * Los temas y normas de una página, del mapa de la memoria: lo que sus pasajes
 * «tratan» o «citan», y con cuántos otros documentos lo comparten. Los que
 * más pasajes de la página tocan van primero; hasta `max`.
 */
export function topicsOf(mesh: { nodes: { id: string; label?: string }[]; edges: { from: string; to: string }[] }, doc: string, max = 7): WebTopic[] {
  const labels = new Map(mesh.nodes.map((n) => [n.id, n.label ?? ""]));
  const mine = new Map<string, Set<number>>();
  const others = new Map<string, Set<string>>();
  for (const e of mesh.edges) {
    if (!/^(tema|ref):/.test(e.to)) continue;
    const m = DOC_REF.exec(e.from);
    if (!m) continue;
    if (m[1].toLowerCase() === doc.toLowerCase()) {
      if (!mine.has(e.to)) mine.set(e.to, new Set());
      mine.get(e.to)!.add(Number(m[2]));
    } else {
      if (!others.has(e.to)) others.set(e.to, new Set());
      others.get(e.to)!.add(m[1].toLowerCase());
    }
  }
  return [...mine.entries()]
    .map(([id, seqs]) => ({ id, label: (labels.get(id) || id.replace(/^(tema|ref):/, "")).slice(0, 40), kind: id.startsWith("ref:") ? ("norma" as const) : ("tema" as const), seqs: [...seqs].sort((a, b) => a - b), shared: others.get(id)?.size ?? 0 }))
    .sort((a, b) => b.seqs.length - a.seqs.length || b.shared - a.shared || a.label.localeCompare(b.label, "es"))
    .slice(0, max);
}

export interface WebMesh {
  width: number;
  height: number;
  x: { pagina: number; seccion: number; pasaje: number; tema: number };
  page: { y: number };
  sections: { name: string; y: number }[];
  passages: { seq: number; section: number; y: number }[];
  topics: (WebTopic & { y: number })[];
  /** Cuántos pasajes hay de más: la malla dibuja hasta MESH_PASSAGES. */
  more: number;
  /** Dónde entra la pregunta al consultar. */
  query: { x: number; y: number };
}

export const MESH_PASSAGES = 28;
const ROW = 26;

/** El trazado: cada pasaje en su fila; una sección va al promedio de sus pasajes, la página al de sus secciones. */
export function webMesh(page: WebPageView, topics: WebTopic[] = []): WebMesh {
  const shown = page.passages.slice(0, MESH_PASSAGES);
  const names: string[] = [];
  for (const p of shown) if (!names.includes(topSection(p.section))) names.push(topSection(p.section));
  const top = 58;
  const span = Math.max(shown.length - 1, 6) * ROW;
  const height = top + span + 92;
  const step = shown.length > 1 ? span / (shown.length - 1) : 0;
  const passages = shown.map((p, i) => ({ seq: p.seq, section: names.indexOf(topSection(p.section)), y: shown.length > 1 ? top + i * step : top + span / 2 }));
  const sections = names.map((name, s) => {
    const ys = passages.filter((p) => p.section === s).map((p) => p.y);
    return { name, y: ys.reduce((a, b) => a + b, 0) / Math.max(ys.length, 1) };
  });
  const visible = new Set(shown.map((p) => p.seq));
  const kept = topics.map((t) => ({ ...t, seqs: t.seqs.filter((s) => visible.has(s)) })).filter((t) => t.seqs.length);
  const pad = 18;
  const placed = kept.map((t, i) => ({ ...t, y: kept.length > 1 ? top + pad + (i * (span - pad * 2)) / (kept.length - 1) : top + span / 2 }));
  return {
    width: 920,
    height,
    x: { pagina: 64, seccion: 232, pasaje: 470, tema: 700 },
    page: { y: sections.length ? sections.reduce((a, s) => a + s.y, 0) / sections.length : top + span / 2 },
    sections,
    passages,
    topics: placed,
    more: Math.max(0, page.passages.length - shown.length),
    query: { x: 586, y: height - 30 },
  };
}

/** Una curva horizontal entre dos puntos, como las de la malla de la memoria. */
export const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${round(y1)}C${mx} ${round(y1)},${mx} ${round(y2)},${x2} ${round(y2)}`;
};
const round = (n: number) => Math.round(n * 10) / 10;

/* --- La consulta ------------------------------------------------------------------------- */

export interface WebHit {
  ref: string;
  title: string;
  section: string;
  /** El pasaje de ESTA página, si el hallazgo es de ella. */
  seq: number | null;
  /** Qué tan cerca quedó, de 0 a 1; null si se halló solo por palabras. */
  sim: number | null;
  via: string;
}

/** Los hallazgos de una consulta, marcando cuáles son de esta página. */
export function hitsOf(hits: { ref: string; title: string; section: string; sim?: number | null; via?: string }[], doc: string): WebHit[] {
  return hits.map((h) => {
    const m = DOC_REF.exec(h.ref);
    const own = m && m[1].toLowerCase() === doc.toLowerCase();
    return { ref: h.ref, title: h.title, section: h.section, seq: own ? Number(m![2]) : null, sim: typeof h.sim === "number" ? h.sim : null, via: h.via ?? "palabras" };
  });
}

export const simText = (sim: number | null) => (sim === null ? "por palabras" : `cercanía ${sim.toFixed(2).replace(".", ",")}`);
