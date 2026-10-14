/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria · lo puro del mapa de conexiones.

   La malla del espacio (pilo_nodes / pilo_edges con source «mapa») trae la
   colección, cada documento con sus secciones, los temas y las referencias. Los
   pasajes («doc:<uuid>:<n>») son extremos de relación sin nodo propio. Para
   dibujar cuatro columnas —colección → documento → tema → referencia— cada
   pasaje y cada sección se pliegan en su documento:

     colección → documento      «contiene»
     documento → tema           algún pasaje suyo «trata» ese tema
     tema → referencia          un mismo pasaje trata el tema y «cita» la referencia
     documento → referencia     un pasaje la cita y no tiene tema (el mapa básico, sin IA)

   Cada relación recuerda de qué documentos y de qué pasajes sale: así, tocar un
   documento enciende también lo que citan sus temas, y una prueba de la memoria
   enciende el camino de los pasajes que encontró.
   ========================================================================== */

import { docOutline } from "../../../../components/pilo/ai/logic";

export type MapColumn = "coleccion" | "documento" | "tema" | "referencia";
export const MAP_COLUMNS: MapColumn[] = ["coleccion", "documento", "tema", "referencia"];

export interface RawNode {
  id: string;
  label?: string;
  type?: string;
  path?: string;
  props?: Record<string, unknown> | null;
}

export interface RawEdge {
  from: string;
  to: string;
  rel: string;
}

export interface MapNode {
  id: string;
  column: MapColumn;
  label: string;
  /** Para un documento: «curso» si viene de Moodle. Para una referencia: norma, ods, organismo, otra. */
  kind: string;
  /** Pasajes que lo sostienen (refs «doc:<uuid>:<n>»), en orden. */
  passages: string[];
  /** Secciones del documento (solo en documentos). */
  sections: number;
}

export interface MapEdge {
  from: string;
  to: string;
  /** Documentos de los que sale la relación. */
  docs: string[];
  /** Pasajes de los que sale. */
  passages: string[];
}

export interface TeachGraph {
  nodes: MapNode[];
  edges: MapEdge[];
  byId: Map<string, MapNode>;
}

const DOC = /^doc:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
const PASSAGE = /^doc:[0-9a-f-]{36}:\d+$/i;

/** El documento dueño de un id de la malla (su nodo, una sección o un pasaje); si no es de un documento, null. */
export const docOf = (id: string): string | null => {
  const m = DOC.exec(id);
  return m ? `doc:${m[1].toLowerCase()}` : null;
};

export const isPassageRef = (id: string) => PASSAGE.test(id);
export const edgeId = (from: string, to: string) => `${from}>${to}`;

export function columnOf(id: string): MapColumn | null {
  if (id.startsWith("fuente:")) return "coleccion";
  if (id.startsWith("tema:")) return "tema";
  if (id.startsWith("ref:")) return "referencia";
  return DOC.test(id) && docOf(id) === id.toLowerCase() ? "documento" : null;
}

/** La malla plegada en cuatro columnas. `collections` da el nombre visible de cada colección. */
export function teachGraph(mesh: { nodes: RawNode[]; edges: RawEdge[] }, collections: Record<string, string> = {}, courses: ReadonlySet<string> = new Set()): TeachGraph {
  const byId = new Map<string, MapNode>();
  const sections = new Map<string, number>();
  for (const n of mesh.nodes ?? []) {
    if (!n || typeof n.id !== "string") continue;
    const column = columnOf(n.id);
    if (!column) {
      const owner = docOf(n.id);
      if (owner && n.id.includes("#")) sections.set(owner, (sections.get(owner) ?? 0) + 1);
      continue;
    }
    const id = column === "documento" ? n.id.toLowerCase() : n.id;
    const key = id.slice(id.indexOf(":") + 1);
    const label = column === "coleccion" ? collections[key] ?? (n.label || key) : n.label || key;
    const kind = column === "documento" ? (courses.has(id) ? "curso" : "archivo") : column === "referencia" ? String(n.props?.clase ?? "otra") : column;
    byId.set(id, { id, column, label: String(label).trim() || key, kind, passages: [], sections: 0 });
  }
  for (const [owner, count] of sections) {
    const node = byId.get(owner);
    if (node) node.sections = count;
  }

  const edges = new Map<string, { from: string; to: string; docs: Set<string>; passages: Set<string> }>();
  const link = (from: string, to: string, doc: string | null, passage: string | null) => {
    if (from === to || !byId.has(from) || !byId.has(to)) return;
    const key = edgeId(from, to);
    const e = edges.get(key) ?? { from, to, docs: new Set<string>(), passages: new Set<string>() };
    if (doc) e.docs.add(doc);
    if (passage) e.passages.add(passage);
    edges.set(key, e);
  };

  // Qué trata y qué cita cada pasaje (o sección, o el documento entero).
  const topicsOf = new Map<string, string[]>();
  const refsOf = new Map<string, string[]>();
  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key) ?? [];
    if (!list.includes(value)) list.push(value);
    map.set(key, list);
  };
  for (const e of mesh.edges ?? []) {
    if (!e || typeof e.from !== "string" || typeof e.to !== "string") continue;
    const owner = docOf(e.from);
    if (e.rel === "contiene") {
      if (e.from.startsWith("fuente:") && columnOf(e.to) === "documento") link(e.from, e.to.toLowerCase(), e.to.toLowerCase(), null);
      continue;
    }
    if (!owner || !byId.has(owner)) continue;
    if (e.to.startsWith("tema:") && byId.has(e.to)) push(topicsOf, e.from, e.to);
    else if (e.to.startsWith("ref:") && byId.has(e.to)) push(refsOf, e.from, e.to);
  }

  const note = (node: string, passage: string) => {
    const n = byId.get(node);
    if (n && isPassageRef(passage) && !n.passages.includes(passage)) n.passages.push(passage);
  };
  for (const from of new Set([...topicsOf.keys(), ...refsOf.keys()])) {
    const owner = docOf(from)!;
    const passage = isPassageRef(from) ? from : null;
    const topics = topicsOf.get(from) ?? [];
    const refs = refsOf.get(from) ?? [];
    for (const t of topics) {
      link(owner, t, owner, passage);
      if (passage) note(t, passage);
    }
    for (const r of refs) {
      if (topics.length) for (const t of topics) link(t, r, owner, passage);
      else link(owner, r, owner, passage);
      if (passage) note(r, passage);
    }
  }

  const order = (id: string) => Number(id.slice(id.lastIndexOf(":") + 1)) || 0;
  for (const n of byId.values()) n.passages.sort((a, b) => (docOf(a) ?? "").localeCompare(docOf(b) ?? "") || order(a) - order(b));
  return {
    nodes: [...byId.values()],
    edges: [...edges.values()].map((e) => ({ from: e.from, to: e.to, docs: [...e.docs], passages: [...e.passages] })),
    byId,
  };
}

/* --- Las columnas --------------------------------------------------------------------- */

export interface Placed {
  id: string;
  column: MapColumn;
  y: number;
}

export interface ColumnLayout {
  placed: Placed[];
  byId: Map<string, Placed>;
  /** Por columna, de arriba abajo: para moverse con las flechas. */
  columns: Record<MapColumn, string[]>;
  height: number;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Dónde va cada punto. Las colecciones en el orden dado (`order`) y cada una
 * con sus documentos debajo, por nombre; los temas y las referencias, a la
 * altura media de aquello con lo que se conectan, separados al menos `row`
 * para que los rótulos no se pisen. Lo que no se conecta con nada va al final.
 */
export function layoutColumns(graph: TeachGraph, order: string[] = [], row = 26): ColumnLayout {
  const y = new Map<string, number>();
  const column = new Map<string, MapColumn>();
  const of = (c: MapColumn) => graph.nodes.filter((n) => n.column === c);
  const byLabel = (a: MapNode, b: MapNode) => a.label.localeCompare(b.label, "es") || a.id.localeCompare(b.id);
  const rank = (n: MapNode) => {
    const at = order.indexOf(n.id.slice("fuente:".length));
    return at < 0 ? order.length : at;
  };

  // Documentos, colección por colección; los sin colección, al final.
  let next = 0;
  const take = () => next++ * row;
  const docsOf = new Map<string, MapNode[]>();
  const homed = new Set<string>();
  for (const e of graph.edges) {
    const from = graph.byId.get(e.from);
    const to = graph.byId.get(e.to);
    if (from?.column !== "coleccion" || to?.column !== "documento" || homed.has(to.id)) continue;
    homed.add(to.id);
    docsOf.set(from.id, [...(docsOf.get(from.id) ?? []), to]);
  }
  for (const c of of("coleccion").sort((a, b) => rank(a) - rank(b) || byLabel(a, b))) {
    column.set(c.id, "coleccion");
    const docs = (docsOf.get(c.id) ?? []).sort(byLabel);
    const ys = docs.map((d) => {
      column.set(d.id, "documento");
      const at = take();
      y.set(d.id, at);
      return at;
    });
    y.set(c.id, ys.length ? mean(ys) : take());
  }
  for (const d of of("documento").filter((n) => !homed.has(n.id)).sort(byLabel)) {
    column.set(d.id, "documento");
    y.set(d.id, take());
  }

  // Temas y luego referencias: a la altura media de sus vecinos ya ubicados.
  const spread = (nodes: MapNode[], col: MapColumn) => {
    const wants = nodes
      .map((n) => {
        const ys = graph.edges.flatMap((e) => (e.to === n.id && y.has(e.from) ? [y.get(e.from)!] : e.from === n.id && y.has(e.to) ? [y.get(e.to)!] : []));
        return { n, want: ys.length ? mean(ys) : Number.POSITIVE_INFINITY };
      })
      .sort((a, b) => a.want - b.want || byLabel(a.n, b.n));
    let last = -Infinity;
    for (const w of wants) {
      const at = Math.max(Number.isFinite(w.want) ? w.want : last + row, last + row, 0);
      y.set(w.n.id, at);
      column.set(w.n.id, col);
      last = at;
    }
  };
  spread(of("tema"), "tema");
  spread(of("referencia"), "referencia");

  const placed: Placed[] = [...column].map(([id, col]) => ({ id, column: col, y: y.get(id)! }));
  const byId = new Map(placed.map((p) => [p.id, p]));
  const columns = { coleccion: [], documento: [], tema: [], referencia: [] } as Record<MapColumn, string[]>;
  for (const p of [...placed].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))) columns[p.column].push(p.id);
  return { placed, byId, columns, height: placed.reduce((m, p) => Math.max(m, p.y), 0) };
}

/* --- Lo que se enciende ------------------------------------------------------------------ */

export interface Lit {
  nodes: Set<string>;
  edges: Set<string>;
}

/**
 * Los vecinos de un punto: todo lo que se conecta con él. Un documento enciende
 * además las relaciones que salen de sus pasajes (tema → referencia) y su
 * colección; una colección, sus documentos.
 */
export function focusOf(graph: TeachGraph, id: string): Lit {
  const nodes = new Set<string>([id]);
  const edges = new Set<string>();
  const isDoc = graph.byId.get(id)?.column === "documento";
  for (const e of graph.edges) {
    if (e.from === id || e.to === id || (isDoc && e.docs.includes(id))) {
      edges.add(edgeId(e.from, e.to));
      nodes.add(e.from);
      nodes.add(e.to);
    }
  }
  return { nodes, edges };
}

/** Con qué se conecta un punto, por columna y por nombre: para decirlo con palabras. */
export function neighborsOf(graph: TeachGraph, id: string): Record<MapColumn, MapNode[]> {
  const out = { coleccion: [], documento: [], tema: [], referencia: [] } as Record<MapColumn, MapNode[]>;
  for (const other of focusOf(graph, id).nodes) {
    const n = graph.byId.get(other);
    if (n && other !== id) out[n.column].push(n);
  }
  for (const c of MAP_COLUMNS) out[c].sort((a, b) => a.label.localeCompare(b.label, "es"));
  return out;
}

/**
 * El camino de unos pasajes (los que encontró una prueba de la memoria): su
 * documento, su colección y los temas y referencias de esos mismos pasajes.
 */
export function pathOfPassages(graph: TeachGraph, refs: string[]): Lit {
  const wanted = new Set(refs.filter(isPassageRef));
  const docs = new Set([...wanted].map((r) => docOf(r)!).filter((d) => graph.byId.has(d)));
  const nodes = new Set<string>(docs);
  const edges = new Set<string>();
  for (const e of graph.edges) {
    const structural = graph.byId.get(e.from)?.column === "coleccion" && docs.has(e.to);
    if (!structural && !e.passages.some((p) => wanted.has(p))) continue;
    edges.add(edgeId(e.from, e.to));
    nodes.add(e.from);
    nodes.add(e.to);
  }
  return { nodes, edges };
}

/* --- La estructura de un documento, sin IA ------------------------------------------- */

export interface OutlineInput {
  id: string;
  source: string;
  title: string;
}

/** Lo que cabe en un pedido a pilo_doc_outline sin que la base lo rechace. */
export const OUTLINE_MAX = { nodes: 1200, edges: 4000 };

/**
 * Los nodos y las relaciones que se mandan a `pilo_doc_outline`: colección ›
 * documento › secciones › pasajes, y las normas y organismos que cada pasaje
 * cita, reconocidos por reglas (`docOutline`, la misma lógica de la función).
 * Si un documento enorme pasa del tope, se recorta por el final y se avisa.
 */
export function buildOutline(doc: OutlineInput, collection: string, rows: { seq: number; section: string; body: string }[]) {
  const full = docOutline({ id: doc.id, source: doc.source, collection, title: doc.title }, rows);
  const nodes = full.nodes.slice(0, OUTLINE_MAX.nodes);
  const kept = new Set(nodes.map((n) => n.id));
  const mine = `doc:${doc.id}:`;
  // Una relación vale si sus dos extremos existen: un nodo enviado o un pasaje del documento.
  const known = (id: string) => kept.has(id) || id.startsWith(mine);
  const edges = full.edges.filter((e) => known(e.from) && known(e.to)).slice(0, OUTLINE_MAX.edges);
  return {
    nodes,
    edges,
    sections: nodes.filter((n) => n.id.includes("#")).length,
    refs: nodes.filter((n) => n.id.startsWith("ref:")).length,
    trimmed: nodes.length < full.nodes.length || edges.length < full.edges.length,
  };
}

/* --- Pensar el mapa: el bucle de «comprender» ------------------------------------------- */

/*
   «Comprender» va por lotes (función pilo-ia). Esta máquina decide, tras cada
   lote, qué sigue —otro lote, una espera, o parar— para que la corrida dure lo
   que haga falta sin que nadie la relance:

     pensando     se pide un lote
     esperando    un lote falló o el proveedor limitó: se reintenta tras `waitMs`
     deteniendo   se pidió detener: el lote en curso termina y se guarda
     pausado      detenido a pedido o por cumplir el tiempo; se puede retomar
     detenido     no pudo seguir (muchos fallos seguidos o algo que no se arregla solo)
     listo        no queda nada pendiente

   Lo comprendido se guarda en la base lote por lote: detener, fallar o cerrar
   la página no pierde nada, y retomar sigue desde lo pendiente. La respuesta de
   la función se lee con cuidado: cualquier campo puede faltar.
*/

export interface ThinkStatus {
  total: number;
  mapped: number;
  pending: number;
  topics: number;
  refs: number;
}

/** El estado del mapa como venga (de la base o de la función); sin números, null. */
export function readThinkStatus(raw: unknown): ThinkStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const n = (v: unknown) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Math.floor(Number(v)) : 0);
  if (r.total === undefined && r.mapped === undefined && r.pending === undefined) return null;
  const total = n(r.total);
  const mapped = n(r.mapped);
  return { total, mapped, pending: r.pending === undefined ? Math.max(0, total - mapped) : n(r.pending), topics: n(r.topics), refs: n(r.refs) };
}

/** Lo que responde un lote, hasta donde se usa aquí. Todo es opcional. */
export interface ThinkBatch {
  ai?: unknown;
  saved?: unknown;
  done?: unknown;
  stopped?: unknown;
  note?: unknown;
  status?: unknown;
}

export interface ThinkLimits {
  /** Cuánto puede durar la corrida. */
  maxMs: number;
  /** Tope de lotes, por si el reloj no avanza. */
  maxRounds: number;
  /** Fallos seguidos que se toleran antes de parar. */
  maxStrikes: number;
  /** Cuánto se espera tras cada fallo seguido. */
  waits: number[];
  /** Cuánto se espera cuando el proveedor limita los pedidos. */
  limitWaits: number[];
}

export const THINK_LIMITS: ThinkLimits = { maxMs: 60 * 60_000, maxRounds: 1500, maxStrikes: 4, waits: [5_000, 15_000, 40_000, 90_000], limitWaits: [45_000, 90_000, 180_000, 300_000] };

/** Cuánto tiempo se le da a Pilo para pensar el mapa de una sola vez. */
export const THINK_BUDGETS: { id: string; label: string; ms: number }[] = [
  { id: "15", label: "15 minutos", ms: 15 * 60_000 },
  { id: "60", label: "1 hora", ms: 60 * 60_000 },
  { id: "180", label: "Hasta terminar (máximo 3 horas)", ms: 180 * 60_000 },
];

export type ThinkPhase = "pensando" | "esperando" | "deteniendo" | "pausado" | "detenido" | "listo";

export interface ThinkRun {
  phase: ThinkPhase;
  startedAt: number;
  /** Lotes pedidos en esta corrida (los que fallaron también). */
  rounds: number;
  /** Lotes que fallaron o no guardaron nada. */
  failed: number;
  /** Fallos seguidos ahora mismo. */
  strikes: number;
  /** El estado al empezar: contra él se mide lo ganado. */
  base: ThinkStatus | null;
  status: ThinkStatus | null;
  /** En «esperando»: cuánto falta para reintentar. */
  waitMs: number;
  /** Por qué espera o por qué paró, en palabras. */
  why: string;
  /** Tras parar: ¿sirve retomar sin cambiar nada? */
  again: boolean;
}

export type ThinkEvent =
  | { type: "lote"; result: ThinkBatch; now: number }
  /** El pedido falló entero (red, tiempo, error del servidor). `retry`: si vale la pena insistir. */
  | { type: "fallo"; retry: boolean; why: string; now: number }
  | { type: "esperado"; now: number }
  | { type: "detener" };

const SAVED = "Lo comprendido queda guardado.";
const THINK_STOP: Record<string, string> = {
  limite_proveedor: "El proveedor de IA limitó los pedidos.",
  proveedor: "El proveedor de IA respondió con un error.",
  tiempo: "El lote se quedó sin tiempo.",
  red: "No hubo conexión con el proveedor de IA.",
  formato: "El modelo no devolvió nada que se pudiera leer y no se guardó nada. No conviene insistir: revise el modelo en «Mr. Pilo con IA».",
};

export const thinkStart = (status: unknown, now: number): ThinkRun => {
  const s = readThinkStatus(status);
  return { phase: "pensando", startedAt: now, rounds: 0, failed: 0, strikes: 0, base: s, status: s, waitMs: 0, why: "", again: false };
};

/** Retomar una corrida que paró: reloj y tropiezos nuevos, pero lo ganado y los lotes se siguen sumando. */
export const thinkResume = (prev: ThinkRun, status: unknown, now: number): ThinkRun => {
  const next = thinkStart(status ?? prev.status, now);
  return { ...next, status: next.status ?? prev.status, base: prev.base ?? next.base, rounds: prev.rounds, failed: prev.failed };
};

/** ¿La corrida sigue viva (pide lotes o espera)? */
export const thinkActive = (run: ThinkRun | null | undefined): boolean => Boolean(run) && (run!.phase === "pensando" || run!.phase === "esperando" || run!.phase === "deteniendo");

const span = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 1000)} s`);

export function thinkReduce(run: ThinkRun, event: ThinkEvent, limits: ThinkLimits = THINK_LIMITS): ThinkRun {
  if (!thinkActive(run)) return run;

  if (event.type === "detener") {
    // En una espera no hay nada en curso: se detiene ya.
    if (run.phase === "esperando") return { ...run, phase: "pausado", waitMs: 0, again: true, why: `Se detuvo a pedido. ${SAVED}` };
    return { ...run, phase: "deteniendo" };
  }

  const spent = event.now - run.startedAt >= limits.maxMs;
  const outOfTime = (r: ThinkRun): ThinkRun => ({ ...r, phase: "pausado", waitMs: 0, again: true, why: `Se cumplió el tiempo de pensamiento de esta corrida. ${SAVED} Puede continuar cuando quiera.` });

  if (event.type === "esperado") {
    if (run.phase !== "esperando") return run;
    return spent ? outOfTime(run) : { ...run, phase: "pensando", waitMs: 0 };
  }

  const asked = run.phase === "deteniendo";
  const rounds = run.rounds + 1;
  /** Un tropiezo: se espera y se reintenta, hasta `maxStrikes` seguidos. */
  const strike = (r: ThinkRun, why: string, waits: number[]): ThinkRun => {
    const strikes = r.strikes + 1;
    const next = { ...r, strikes, failed: r.failed + 1 };
    if (asked) return { ...next, phase: "pausado", waitMs: 0, again: true, why: `Se detuvo a pedido. ${SAVED}` };
    if (strikes > limits.maxStrikes) return { ...next, phase: "detenido", waitMs: 0, again: true, why: `${why} Falló ${strikes} veces seguidas y se detuvo. ${SAVED}` };
    if (spent || rounds >= limits.maxRounds) return outOfTime(next);
    const waitMs = waits[Math.min(strikes, waits.length) - 1] ?? 0;
    return { ...next, phase: "esperando", waitMs, why: `${why} ${SAVED} Reintenta en ${span(waitMs)} (intento ${strikes} de ${limits.maxStrikes}).` };
  };

  if (event.type === "fallo") {
    const r = { ...run, rounds };
    if (!event.retry) return { ...r, phase: "detenido", waitMs: 0, failed: r.failed + 1, again: false, why: event.why || "No se pudo completar." };
    return strike(r, event.why || "Un lote falló.", limits.waits);
  }

  const result = event.result ?? {};
  const status = readThinkStatus(result.status) ?? run.status;
  const r: ThinkRun = { ...run, rounds, status };
  const stopped = typeof result.stopped === "string" ? result.stopped : "";
  const note = typeof result.note === "string" ? result.note : "";
  const progressed = Number(result.saved) > 0 || (status !== null && run.status !== null && status.mapped > run.status.mapped);

  if (result.ai === false) return { ...r, phase: "listo", waitMs: 0, again: false, why: note || "Sin IA, el mapa es el básico: estructura y normas citadas." };
  if (result.done === true || (status !== null && status.pending === 0)) return { ...r, phase: "listo", waitMs: 0, again: false, why: "" };
  if (stopped === "formato") return { ...r, phase: "detenido", waitMs: 0, failed: r.failed + 1, again: false, why: THINK_STOP.formato };
  if (!progressed) return strike(r, stopped ? THINK_STOP[stopped] ?? (note || "El lote se detuvo antes de terminar.") : "El lote no guardó ningún pasaje.", stopped === "limite_proveedor" ? limits.limitWaits : limits.waits);

  // Hubo avance: los tropiezos seguidos se olvidan.
  const ok: ThinkRun = { ...r, strikes: 0, why: "", waitMs: 0 };
  if (asked) return { ...ok, phase: "pausado", again: true, why: `Se detuvo a pedido. ${SAVED}` };
  if (spent || rounds >= limits.maxRounds) return outOfTime(ok);
  if (stopped === "limite_proveedor") return { ...ok, phase: "esperando", waitMs: limits.limitWaits[0] ?? 0, why: `${THINK_STOP.limite_proveedor} ${SAVED} Sigue en ${span(limits.limitWaits[0] ?? 0)}.` };
  return { ...ok, phase: "pensando" };
}

/** Lo ganado en la corrida: pasajes comprendidos, temas y referencias nuevas. */
export function thinkGain(run: ThinkRun | null | undefined): { mapped: number; topics: number; refs: number } {
  const a = run?.base;
  const b = run?.status;
  if (!a || !b) return { mapped: 0, topics: 0, refs: 0 };
  return { mapped: Math.max(0, b.mapped - a.mapped), topics: Math.max(0, b.topics - a.topics), refs: Math.max(0, b.refs - a.refs) };
}

/** El avance real: de los pasajes con documento, cuántos ya están comprendidos (0 a 1). */
export const thinkShare = (s: ThinkStatus | null | undefined): number => (s && s.total > 0 ? Math.min(1, Math.max(0, s.mapped / s.total)) : 0);
