/* =============================================================================
   Mr. Pilo · el mapa global: lo puro.

   Los dos Pilos tienen memorias separadas (columna `space`) y así se quedan:
   aquí no se escribe nada ni se mezcla nada. Cada malla se lee por su cuenta
   (pilo_graph_overview, una vez por espacio) y se dibujan juntas, cada una en
   su banda:

     Pregúntele a Pilo   fuente › informe, pilar, tema… › indicador, área… › detalle
     Pilo en Enseñanza   colección › documento o curso › tema › referencia

   Los ids llevan el espacio delante («p|…», «e|…»): aunque dos nodos se llamen
   igual en la base, en el mapa son dos puntos.

   Los PUENTES entre los dos Pilos se LEEN de la base desde 0122 (`pilo_bridges`):
   cada uno con su origen (reglas, IA o administración) y su estado (propuesto,
   aprobado o rechazado). Los de reglas —la misma referencia (un ODS, una ley,
   un decreto…) o el mismo nombre de un punto del Plan— los calcula y guarda la
   base (`pilo_bridges_sync`); los que propone la IA se aprueban uno por uno.
   Los rechazados no se dibujan. Sin 0122, los puentes se calculan aquí al
   dibujar, por etiqueta normalizada, como antes: son solo un dibujo.

   Con cientos de nodos el mapa se pliega: de entrada se ven las fuentes y las
   colecciones (abiertas solo las pequeñas), y los temas y referencias más
   usados. Lo que queda plegado pasa sus relaciones y sus puentes a quien lo
   contiene, con su cuenta.
   ========================================================================== */

import type { MeshEdge } from "../../../../components/pilo/ai/logic";
import { fold, indexMesh, searchNodes } from "../mesh-view";
import type { ViewNode } from "../mesh-view";
import type { PiloSpace } from "../space";
import { MAP_COLUMNS } from "../../pilo-ensenanza/memoria/map";
import type { TeachGraph } from "../../pilo-ensenanza/memoria/map";

export const SPACES: PiloSpace[] = ["planeacion", "ensenanza"];
export type GlobalFilter = "todo" | PiloSpace;

/** El id de un punto en el mapa global: su espacio y su id en la malla. */
export const gid = (space: PiloSpace, raw: string) => `${space === "planeacion" ? "p" : "e"}|${raw}`;

export interface GNode {
  id: string;
  /** El id en su malla (y, en Planeación, el ref de su pasaje). */
  raw: string;
  space: PiloSpace;
  /** Columna de su banda, 0 a 3. */
  col: number;
  /** Qué tan abajo cuelga; más allá de 3 no se dibuja: queda dentro de quien lo contiene. */
  depth: number;
  /** fuente, pilar, informe… en Planeación; coleccion, documento, curso, tema, referencia en Enseñanza. */
  kind: string;
  code: string;
  label: string;
  /** La fuente o colección de la que es. */
  source: string;
  path: string;
  /** Quien lo contiene (el primero, el de la ruta). */
  parent: string | null;
  kids: string[];
  /** Cuántos puntos cuelgan de él, a cualquier profundidad. */
  inside: number;
  /** Pasajes que lo sostienen (refs de pilo_memory de su espacio). */
  passages: string[];
}

export type EdgeKind = "contiene" | "trata" | "cita" | "enlace";

export interface GEdge {
  from: string;
  to: string;
  kind: EdgeKind;
  /** La relación como está en la base («vincula», «incluye», «mide»…). */
  rel: string;
  /** Documentos de los que sale (Enseñanza). */
  docs: string[];
}

export type BridgeOrigin = "reglas" | "ia" | "admin";
export type BridgeStatus = "propuesta" | "aprobada" | "rechazada";
export type BridgeKind = "referencia" | "nombre" | "tema" | "relacion";

export interface Bridge {
  /** El punto de Planeación. */
  a: string;
  /** El punto de Enseñanza. */
  b: string;
  kind: BridgeKind;
  /** Por qué se unen, en palabras. */
  why: string;
  /** Solo los que se leen de la base (0122): su id, quién lo puso y en qué estado está. Un puente calculado al dibujar no los trae. */
  id?: number;
  origin?: BridgeOrigin;
  status?: BridgeStatus;
}

/** Un puente como lo guarda la base (`pilo_bridges_list`): el par va con el ámbito menor primero. */
export interface StoredBridge {
  id: number;
  a_scope: string;
  a_id: string;
  a_label: string;
  b_scope: string;
  b_id: string;
  b_label: string;
  kind: BridgeKind;
  key: string;
  why: string;
  origin: BridgeOrigin;
  status: BridgeStatus;
}

const KINDS: BridgeKind[] = ["referencia", "nombre", "tema", "relacion"];
const ORIGINS: BridgeOrigin[] = ["reglas", "ia", "admin"];
const STATUSES: BridgeStatus[] = ["propuesta", "aprobada", "rechazada"];

/** Las filas de la base, leídas con cuidado: lo que no se reconoce no entra. */
export function parseBridges(rows: unknown): StoredBridge[] {
  const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
  return (Array.isArray(rows) ? rows : [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .filter((r) => Number.isInteger(Number(r.id)) && typeof r.a_id === "string" && typeof r.b_id === "string" && typeof r.a_scope === "string" && typeof r.b_scope === "string" && r.a_scope !== r.b_scope)
    .filter((r) => STATUSES.includes(r.status as BridgeStatus) && ORIGINS.includes(r.origin as BridgeOrigin))
    .map((r) => ({
      id: Number(r.id),
      a_scope: r.a_scope as string,
      a_id: r.a_id as string,
      a_label: text(r.a_label, 300),
      b_scope: r.b_scope as string,
      b_id: r.b_id as string,
      b_label: text(r.b_label, 300),
      kind: KINDS.includes(r.kind as BridgeKind) ? (r.kind as BridgeKind) : "relacion",
      key: text(r.key, 200),
      why: text(r.why, 300),
      origin: r.origin as BridgeOrigin,
      status: r.status as BridgeStatus,
    }));
}

export const ORIGIN_TEXT: Record<BridgeOrigin, string> = { reglas: "Por reglas", ia: "Lo propuso la IA", admin: "Lo puso la administración" };
export const STATUS_TEXT: Record<BridgeStatus, string> = { propuesta: "Por revisar", aprobada: "Aprobado", rechazada: "Rechazado" };

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** Qué dice un puente de sí mismo: su estado y su origen, en palabras. Uno calculado al dibujar no está guardado. */
export const bridgeState = (b: Pick<Bridge, "origin" | "status">): string =>
  b.status && b.origin ? `${STATUS_TEXT[b.status]} · ${lowerFirst(ORIGIN_TEXT[b.origin])}` : "Calculado al dibujar · sin guardar";

/** ¿La búsqueda de Pilo puede seguir este puente? Solo los aprobados (y solo hacia lo que la matriz deja leer de visita). */
export const bridgeLive = (b: Pick<Bridge, "status">): boolean => b.status === "aprobada";

export interface GlobalGraph {
  nodes: GNode[];
  byId: Map<string, GNode>;
  edges: GEdge[];
  /** Los puntos sin padre que encabezan cada banda (fuentes y colecciones, y lo huérfano). */
  roots: Record<PiloSpace, string[]>;
  /** Temas y referencias de Enseñanza, los más conectados primero. */
  hubs: string[];
  bridges: Bridge[];
  bridgesOf: Map<string, Bridge[]>;
  /** Los puentes se leyeron de la base (0122). Si no, se calcularon al dibujar. */
  stored: boolean;
  /** Puentes guardados (sin los rechazados) que no se pueden dibujar: alguno de sus extremos no está en este mapa. */
  offMap: number;
}

/**
 * Los puentes guardados, puestos sobre el mapa: cada extremo es el punto de su
 * ámbito con ese id. Los rechazados no se dibujan; los que apuntan a un punto
 * que este mapa no tiene, tampoco (se cuentan aparte y se ven en la bandeja).
 */
export function placeBridges(rows: StoredBridge[], byId: Map<string, GNode>): { bridges: Bridge[]; offMap: number } {
  const out: Bridge[] = [];
  let offMap = 0;
  for (const r of rows) {
    if (r.status === "rechazada") continue;
    const ends = [
      { scope: r.a_scope, id: r.a_id },
      { scope: r.b_scope, id: r.b_id },
    ];
    const plan = ends.find((e) => e.scope === "planeacion");
    const teach = ends.find((e) => e.scope === "ensenanza");
    const a = plan ? byId.get(gid("planeacion", plan.id)) : undefined;
    const b = teach ? byId.get(gid("ensenanza", teach.id)) : undefined;
    if (!a || !b) {
      offMap += 1;
      continue;
    }
    out.push({ a: a.id, b: b.id, kind: r.kind, why: r.why, id: r.id, origin: r.origin, status: r.status });
  }
  return { bridges: out, offMap };
}

/* --- Puentes ---------------------------------------------------------------------------- */

/** Una etiqueta sin tildes, sin signos y con un solo espacio: para comparar. */
export const normLabel = (text: string) =>
  fold(String(text ?? ""))
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export interface BridgeKey {
  key: string;
  kind: Bridge["kind"];
  /** Cómo se dice a la vista: «ODS 4», «Ley 30 de 1992», el nombre. */
  say: string;
  /** Otras claves con las que también casa (una norma sin año casa con la misma norma con año). */
  also: string[];
}

const NORMS = "ley|decreto|resolucion|acuerdo|circular|directiva";
const NORM_NAME: Record<string, string> = { ley: "Ley", decreto: "Decreto", resolucion: "Resolución", acuerdo: "Acuerdo", circular: "Circular", directiva: "Directiva" };

/**
 * Las claves de puente de una etiqueta. Primero las referencias que nombra (un
 * ODS, una norma con su número) y al final su nombre entero. Un nombre muy
 * corto o solo de cifras no sirve de puente.
 */
export function bridgeKeys(label: string): BridgeKey[] {
  const text = normLabel(label);
  if (!text) return [];
  const out: BridgeKey[] = [];
  const seen = new Set<string>();
  const add = (k: BridgeKey) => {
    if (!seen.has(k.key)) (seen.add(k.key), out.push(k));
  };
  for (const m of text.matchAll(/\b(?:ods|objetivos? de desarrollo sostenible)\s*(?:n|no|numero)?\s*(\d{1,2})\b/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 17) add({ key: `ods:${n}`, kind: "referencia", say: `ODS ${n}`, also: [] });
  }
  for (const m of text.matchAll(new RegExp(`\\b(${NORMS})\\s+(?:no\\s+|n\\s+|numero\\s+)?(\\d{1,5})(?:\\s+del?\\s+(\\d{4}))?`, "g"))) {
    const [, type, number, year] = m;
    const base = `norma:${type}:${Number(number)}`;
    const say = `${NORM_NAME[type]} ${Number(number)}`;
    if (year) add({ key: `${base}:${year}`, kind: "referencia", say: `${say} de ${year}`, also: [`${base}:?`] });
    else add({ key: `${base}:?`, kind: "referencia", say, also: [`${base}:*`] });
  }
  if (text.length >= 4 && !/^[\d ]+$/.test(text)) {
    add({ key: `nombre:${text}`, kind: "nombre", say: String(label).trim(), also: [] });
    const bare = text.replace(/^(pilar|eje)( \d{1,2})? (de |del )?/, "");
    if (bare !== text && bare.length >= 4) add({ key: `nombre:${bare}`, kind: "nombre", say: String(label).trim(), also: [] });
  }
  return out;
}

/** Bajo qué claves se anota un punto para que lo encuentren (una norma con año también responde por «cualquier año»). */
const indexKeys = (k: BridgeKey) => (/^norma:.+:\d{4}$/.test(k.key) ? [k.key, k.key.replace(/:\d{4}$/, ":*")] : [k.key]);

/**
 * Los puentes entre los dos Pilos: pares (Planeación, Enseñanza) que nombran lo
 * mismo. Un par sale una sola vez, con su primera razón (la referencia antes
 * que el nombre). Las raíces de fuente y las colecciones no hacen puente por
 * referencia: solo por llamarse igual.
 */
export function computeBridges(nodes: GNode[]): Bridge[] {
  const plan = new Map<string, GNode[]>();
  for (const n of nodes) {
    if (n.space !== "planeacion") continue;
    for (const k of bridgeKeys(n.label)) {
      if (n.depth === 0 && k.kind !== "nombre") continue;
      for (const key of indexKeys(k)) plan.set(key, [...(plan.get(key) ?? []), n]);
    }
  }
  const out: Bridge[] = [];
  const paired = new Set<string>();
  for (const n of nodes) {
    if (n.space !== "ensenanza") continue;
    for (const k of bridgeKeys(n.label)) {
      if (n.col === 0 && k.kind !== "nombre") continue;
      for (const key of [k.key, ...k.also]) {
        for (const other of plan.get(key) ?? []) {
          const pair = `${other.id}~${n.id}`;
          if (paired.has(pair)) continue;
          paired.add(pair);
          out.push({ a: other.id, b: n.id, kind: k.kind, why: k.kind === "referencia" ? `Los dos nombran ${k.say}` : `Se llaman igual: «${k.say}»` });
        }
      }
    }
  }
  return out;
}

/* --- La fusión de las dos mallas ---------------------------------------------------------- */

export interface GlobalInput {
  /** La malla de Pregúntele a Pilo, como la da pilo_graph_overview. */
  planeacion: { nodes: ViewNode[]; edges: MeshEdge[] } | null;
  /** El mapa de Enseñanza, ya plegado en cuatro columnas (teachGraph). */
  ensenanza: TeachGraph | null;
  /** El orden de las fuentes y de las colecciones. */
  order?: Partial<Record<PiloSpace, string[]>>;
  /** Los puentes guardados en la base (0122). Sin ellos (null o ausente), se calculan al dibujar. */
  bridges?: StoredBridge[] | null;
}

const natural = (a: GNode, b: GNode) => a.code.localeCompare(b.code, "es", { numeric: true }) || a.label.localeCompare(b.label, "es", { numeric: true }) || a.id.localeCompare(b.id);

export function buildGlobal(input: GlobalInput): GlobalGraph {
  const byId = new Map<string, GNode>();
  const edges: GEdge[] = [];
  const roots: Record<PiloSpace, string[]> = { planeacion: [], ensenanza: [] };
  const rank = (space: PiloSpace, source: string) => {
    const at = (input.order?.[space] ?? []).indexOf(source);
    return at < 0 ? 999 : at;
  };

  // Pregúntele a Pilo: un árbol por «contiene» desde cada fuente.
  if (input.planeacion) {
    const P = (raw: string) => gid("planeacion", raw);
    const index = indexMesh(input.planeacion);
    const make = (n: ViewNode, depth: number, parent: string | null): GNode => ({
      id: P(n.id),
      raw: n.id,
      space: "planeacion",
      col: Math.min(depth, 3),
      depth,
      kind: n.type || "nodo",
      code: n.code ?? "",
      label: String(n.label ?? "").trim() || n.id,
      source: n.source,
      path: n.path ?? "",
      parent,
      kids: [],
      inside: 0,
      passages: [n.id],
    });
    const queue: string[] = [];
    const walk = () => {
      while (queue.length) {
        const current = queue.shift()!;
        const node = byId.get(P(current))!;
        for (const k of index.kids.get(current) ?? []) {
          const kid = index.byId.get(k);
          if (!kid || byId.has(P(k))) continue;
          byId.set(P(k), make(kid, node.depth + 1, node.id));
          queue.push(k);
        }
      }
    };
    for (const n of index.nodes.filter((x) => x.type === "fuente").sort((a, b) => rank("planeacion", a.source) - rank("planeacion", b.source) || a.id.localeCompare(b.id))) {
      if (byId.has(P(n.id))) continue;
      byId.set(P(n.id), make(n, 0, null));
      roots.planeacion.push(P(n.id));
      queue.push(n.id);
    }
    walk();
    // Lo que no cuelga de nada va bajo su fuente; sin fuente, encabeza la banda.
    for (const n of index.nodes) {
      if (byId.has(P(n.id))) continue;
      const root = byId.get(P(`fuente:${n.source}`));
      byId.set(P(n.id), make(n, root ? 1 : 0, root?.id ?? null));
      if (!root) roots.planeacion.push(P(n.id));
      queue.push(n.id);
      walk();
    }
    for (const e of index.edges) {
      const from = byId.get(P(e.from));
      const to = byId.get(P(e.to));
      if (!from || !to || from === to) continue;
      edges.push({ from: from.id, to: to.id, kind: e.rel === "contiene" ? "contiene" : "enlace", rel: e.rel, docs: [] });
    }
  }

  // Pilo en Enseñanza: colección › documento › tema › referencia.
  if (input.ensenanza) {
    const E = (raw: string) => gid("ensenanza", raw);
    for (const n of input.ensenanza.nodes) {
      const col = MAP_COLUMNS.indexOf(n.column);
      byId.set(E(n.id), {
        id: E(n.id),
        raw: n.id,
        space: "ensenanza",
        col,
        depth: col,
        kind: n.column === "documento" ? (n.kind === "curso" ? "curso" : "documento") : n.column,
        code: "",
        label: n.label,
        source: n.column === "coleccion" ? n.id.slice("fuente:".length) : "",
        path: "",
        parent: null,
        kids: [],
        inside: 0,
        passages: [...n.passages],
      });
    }
    for (const e of input.ensenanza.edges) {
      const from = byId.get(E(e.from));
      const to = byId.get(E(e.to));
      if (!from || !to) continue;
      const kind: EdgeKind = from.col === 0 ? "contiene" : to.kind === "tema" ? "trata" : "cita";
      if (kind === "contiene" && !to.parent) {
        to.parent = from.id;
        to.source = from.source;
      }
      edges.push({ from: from.id, to: to.id, kind, rel: kind, docs: e.docs.map(E) });
    }
    const heads = [...byId.values()].filter((n) => n.space === "ensenanza" && n.col <= 1 && !n.parent);
    heads.sort((a, b) => a.col - b.col || rank("ensenanza", a.source) - rank("ensenanza", b.source) || natural(a, b));
    roots.ensenanza = heads.map((n) => n.id);
  }

  const nodes = [...byId.values()];
  for (const n of nodes) if (n.parent) byId.get(n.parent)?.kids.push(n.id);
  for (const n of nodes) n.kids.sort((a, b) => natural(byId.get(a)!, byId.get(b)!));
  const count = (n: GNode): number => (n.inside = n.kids.reduce((sum, k) => sum + 1 + count(byId.get(k)!), 0));
  for (const space of SPACES) for (const r of roots[space]) count(byId.get(r)!);

  const stored = Array.isArray(input.bridges);
  const placed = stored ? placeBridges(input.bridges!, byId) : { bridges: computeBridges(nodes), offMap: 0 };
  const bridges = placed.bridges;
  const bridgesOf = new Map<string, Bridge[]>();
  for (const b of bridges) for (const end of [b.a, b.b]) bridgesOf.set(end, [...(bridgesOf.get(end) ?? []), b]);

  // Temas y referencias: primero los que hacen puente, luego los que más pasajes sostienen.
  const degree = new Map<string, number>();
  for (const e of edges) for (const end of [e.from, e.to]) degree.set(end, (degree.get(end) ?? 0) + 1);
  const weight = (n: GNode) => (bridgesOf.get(n.id)?.length ? 100_000 : 0) + n.passages.length * 10 + (degree.get(n.id) ?? 0);
  const hubs = nodes
    .filter((n) => n.space === "ensenanza" && n.col >= 2)
    .sort((a, b) => weight(b) - weight(a) || natural(a, b))
    .map((n) => n.id);

  return { nodes, byId, edges, roots, hubs, bridges, bridgesOf, stored, offMap: placed.offMap };
}

/* --- Lo que se ve: filtros y pliegues ----------------------------------------------------- */

export interface ViewState {
  filter: GlobalFilter;
  /** Los puntos abiertos: se ve lo que contienen. */
  open: ReadonlySet<string>;
  /** Temas o referencias que se muestran aunque no estén entre los más usados (lo elegido, lo buscado). */
  pinned: ReadonlySet<string>;
  /** Ver todos los temas y referencias. */
  allHubs: boolean;
  /** Cuántos temas y cuántas referencias se ven de entrada. */
  hubLimit?: number;
}

export interface VEdge {
  key: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** Cuántas relaciones de la malla resume esta curva. */
  weight: number;
  docs: Set<string>;
}

export interface VBridge {
  key: string;
  a: string;
  b: string;
  items: Bridge[];
}

export interface Visible {
  ids: Set<string>;
  nodes: GNode[];
  /** El punto visible que representa a otro: él mismo o quien lo contiene. Null si su Pilo está filtrado. */
  anchor: (id: string) => string | null;
  edges: VEdge[];
  bridges: VBridge[];
  /** Temas y referencias que no se muestran por el tope. */
  hiddenHubs: number;
}

export const HUB_LIMIT = 40;
export const pairKey = (a: string, b: string) => `${a}>${b}`;
export const bridgeKey = (a: string, b: string) => `${a}~${b}`;

export function visibleOf(g: GlobalGraph, view: ViewState): Visible {
  const spaces = view.filter === "todo" ? SPACES : [view.filter];
  const ids = new Set<string>();
  const show = (id: string) => {
    const n = g.byId.get(id);
    if (!n || n.depth > 3 || ids.has(id)) return;
    ids.add(id);
    if (view.open.has(id)) for (const k of n.kids) show(k);
  };
  for (const space of spaces) for (const r of g.roots[space]) show(r);

  let hiddenHubs = 0;
  if (spaces.includes("ensenanza")) {
    const limit = view.hubLimit ?? HUB_LIMIT;
    const taken = [0, 0, 0, 0];
    for (const id of g.hubs) {
      const n = g.byId.get(id)!;
      if (view.allHubs || view.pinned.has(id) || taken[n.col] < limit) {
        ids.add(id);
        taken[n.col] += 1;
      } else hiddenHubs += 1;
    }
  }

  const cache = new Map<string, string | null>();
  const anchor = (id: string): string | null => {
    if (cache.has(id)) return cache.get(id)!;
    let n = g.byId.get(id);
    const seen = new Set<string>();
    while (n && !ids.has(n.id) && n.parent && !seen.has(n.id)) {
      seen.add(n.id);
      n = g.byId.get(n.parent);
    }
    const found = n && ids.has(n.id) ? n.id : null;
    cache.set(id, found);
    return found;
  };

  const edges = new Map<string, VEdge>();
  for (const e of g.edges) {
    const from = anchor(e.from);
    const to = anchor(e.to);
    if (!from || !to || from === to) continue;
    const key = pairKey(from, to);
    const seen = edges.get(key);
    if (seen) {
      seen.weight += 1;
      for (const d of e.docs) seen.docs.add(d);
      if (seen.kind !== "contiene" && e.kind === "contiene" && from === e.from && to === e.to) seen.kind = "contiene";
    } else edges.set(key, { key, from, to, kind: e.kind, weight: 1, docs: new Set(e.docs) });
  }

  const bridges = new Map<string, VBridge>();
  for (const b of g.bridges) {
    const a = anchor(b.a);
    const z = anchor(b.b);
    if (!a || !z) continue;
    const key = bridgeKey(a, z);
    const seen = bridges.get(key);
    if (seen) seen.items.push(b);
    else bridges.set(key, { key, a, b: z, items: [b] });
  }

  return { ids, nodes: g.nodes.filter((n) => ids.has(n.id)), anchor, edges: [...edges.values()], bridges: [...bridges.values()], hiddenHubs };
}

/** De entrada se abren solo las fuentes y colecciones pequeñas, hasta llenar un mapa que todavía se lee. */
export function defaultOpen(g: GlobalGraph, each = 14, budget = 90): Set<string> {
  const open = new Set<string>();
  let shown = 0;
  for (const space of SPACES) {
    for (const id of g.roots[space]) {
      const n = g.byId.get(id)!;
      if (!n.kids.length || n.kids.length > each || shown + n.kids.length > budget) continue;
      open.add(id);
      shown += n.kids.length;
    }
  }
  return open;
}

/** Lo que hay que abrir (o fijar) para que un punto se vea: quienes lo contienen y, si es un tema o una referencia, él mismo. */
export function revealOf(g: GlobalGraph, id: string): { open: string[]; pin: string | null } {
  const open: string[] = [];
  const seen = new Set<string>();
  let n = g.byId.get(id);
  const hub = n && n.space === "ensenanza" && n.col >= 2 ? n.id : null;
  while (n?.parent && !seen.has(n.id)) {
    seen.add(n.id);
    open.unshift(n.parent);
    n = g.byId.get(n.parent);
  }
  return { open, pin: hub };
}

/* --- Dónde va cada punto ---------------------------------------------------------------------- */

export interface Band {
  space: PiloSpace;
  /** Donde empieza la banda (su encabezado) y donde termina. */
  top: number;
  bottom: number;
  /** Por columna, de arriba abajo: para moverse con las flechas. */
  columns: string[][];
}

export interface GlobalLayout {
  y: Map<string, number>;
  bands: Band[];
  height: number;
}

const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

/**
 * Una banda por Pilo, una debajo de la otra. En cada una, quien no contiene
 * nada visible ocupa una fila y quien contiene va a la altura media de lo
 * suyo; los temas y las referencias de Enseñanza, a la altura media de aquello
 * con lo que se conectan, sin pisarse.
 */
export function layoutGlobal(g: GlobalGraph, v: Visible, opts: { row?: number; head?: number; gap?: number } = {}): GlobalLayout {
  const row = opts.row ?? 24;
  const head = opts.head ?? 56;
  const gap = opts.gap ?? 28;
  const y = new Map<string, number>();
  const bands: Band[] = [];
  let cursor = 0;

  for (const space of SPACES) {
    const mine = v.nodes.filter((n) => n.space === space);
    if (!mine.length) continue;
    const top = cursor;
    const base = top + head;
    let next = 0;
    const take = () => base + next++ * row;
    const place = (id: string): number => {
      const n = g.byId.get(id)!;
      const kids = n.kids.filter((k) => v.ids.has(k));
      const at = kids.length ? mean(kids.map(place)) : take();
      y.set(id, at);
      return at;
    };
    for (const r of g.roots[space]) if (v.ids.has(r)) place(r);

    let bottom = base + Math.max(0, next - 1) * row;
    for (const col of [2, 3]) {
      const hubs = mine.filter((n) => n.col === col && !y.has(n.id));
      const wants = hubs
        .map((n) => {
          const ys = v.edges.flatMap((e) => (e.to === n.id && y.has(e.from) ? [y.get(e.from)!] : e.from === n.id && y.has(e.to) ? [y.get(e.to)!] : []));
          return { n, want: ys.length ? mean(ys) : Number.POSITIVE_INFINITY };
        })
        .sort((a, b) => a.want - b.want || natural(a.n, b.n));
      let last = base - row;
      for (const w of wants) {
        const at = Math.max(Number.isFinite(w.want) ? w.want : last + row, last + row);
        y.set(w.n.id, at);
        last = at;
        bottom = Math.max(bottom, at);
      }
    }

    const columns: string[][] = [[], [], [], []];
    for (const n of [...mine].sort((a, b) => y.get(a.id)! - y.get(b.id)! || a.id.localeCompare(b.id))) columns[n.col].push(n.id);
    bands.push({ space, top, bottom: bottom + row, columns });
    cursor = bottom + row + gap;
  }
  return { y, bands, height: bands.length ? bands[bands.length - 1].bottom : 0 };
}

/* --- Lo que se enciende ---------------------------------------------------------------------- */

export interface GlobalLit {
  nodes: Set<string>;
  edges: Set<string>;
  bridges: Set<string>;
}

/**
 * Los vecinos de un punto, sobre lo que se ve: quienes lo contienen, aquello
 * con lo que se relaciona en su Pilo y, por los puentes, lo que le corresponde
 * en el otro. Un documento enciende además lo que sale de sus pasajes.
 */
export function litOf(g: GlobalGraph, v: Visible, id: string | null): GlobalLit | null {
  const at = id ? v.anchor(id) : null;
  if (!id || !at) return null;
  const nodes = new Set<string>([at]);
  const edges = new Set<string>();
  const bridges = new Set<string>();
  for (const e of v.edges) {
    if (e.from === at || e.to === at || e.docs.has(id) || e.docs.has(at)) {
      edges.add(e.key);
      nodes.add(e.from);
      nodes.add(e.to);
    }
  }
  // La ruta hacia arriba, entera.
  let n = g.byId.get(at);
  const seen = new Set<string>();
  while (n?.parent && !seen.has(n.id)) {
    seen.add(n.id);
    if (v.ids.has(n.parent)) {
      nodes.add(n.parent);
      edges.add(pairKey(n.parent, n.id));
    }
    n = g.byId.get(n.parent);
  }
  for (const b of v.bridges) {
    if (b.a !== at && b.b !== at) continue;
    bridges.add(b.key);
    nodes.add(b.a);
    nodes.add(b.b);
  }
  return { nodes, edges, bridges };
}

/* --- El detalle de un punto ---------------------------------------------------------------- */

export interface NodeDetail {
  node: GNode;
  /** De su fuente o colección hasta él. */
  route: GNode[];
  kids: GNode[];
  /** Con qué se conecta dentro de su Pilo, por grupos. */
  links: { title: string; nodes: GNode[] }[];
  /** Con qué se corresponde en el otro Pilo, por qué, y —si el puente está guardado— su estado y su origen. */
  bridges: { other: GNode; why: string; kind: Bridge["kind"]; id?: number; origin?: BridgeOrigin; status?: BridgeStatus }[];
}

const LINK_TITLE: Record<string, string> = { coleccion: "Colección", documento: "Documentos y cursos", curso: "Documentos y cursos", tema: "Temas", referencia: "Referencias" };
const LINK_ORDER = ["Colección", "Documentos y cursos", "Temas", "Referencias", "También cuelga de", "Contiene además", "Se enlaza con"];

export function detailOf(g: GlobalGraph, id: string): NodeDetail | null {
  const node = g.byId.get(id);
  if (!node) return null;
  const route: GNode[] = [];
  const seen = new Set<string>();
  for (let n: GNode | undefined = node; n && !seen.has(n.id); n = n.parent ? g.byId.get(n.parent) : undefined) {
    seen.add(n.id);
    route.unshift(n);
  }
  const kids = node.kids.map((k) => g.byId.get(k)!).filter(Boolean);
  const skip = new Set<string>([...route.map((n) => n.id), ...node.kids]);
  const groups = new Map<string, Map<string, GNode>>();
  const put = (title: string, other: GNode | undefined) => {
    if (!other || skip.has(other.id)) return;
    if (!groups.has(title)) groups.set(title, new Map());
    groups.get(title)!.set(other.id, other);
  };
  for (const e of g.edges) {
    const mine = e.from === id || e.to === id;
    if (!mine && !e.docs.includes(id)) continue;
    if (node.space === "ensenanza") {
      for (const end of mine ? [e.from === id ? e.to : e.from] : [e.from, e.to]) put(LINK_TITLE[g.byId.get(end)?.kind ?? ""] ?? "Se enlaza con", g.byId.get(end));
    } else if (e.kind === "contiene") put(e.to === id ? "También cuelga de" : "Contiene además", g.byId.get(e.to === id ? e.from : e.to));
    else put("Se enlaza con", g.byId.get(e.from === id ? e.to : e.from));
  }
  const links = [...groups]
    .map(([title, list]) => ({ title, nodes: [...list.values()].sort(natural) }))
    .sort((a, b) => LINK_ORDER.indexOf(a.title) - LINK_ORDER.indexOf(b.title));
  const bridges = (g.bridgesOf.get(id) ?? [])
    .map((b) => ({ other: g.byId.get(b.a === id ? b.b : b.a)!, why: b.why, kind: b.kind, ...(b.status && b.origin ? { id: b.id, origin: b.origin, status: b.status } : {}) }))
    .filter((b) => b.other)
    .sort((a, b) => (a.kind === b.kind ? natural(a.other, b.other) : a.kind === "referencia" ? -1 : b.kind === "referencia" ? 1 : a.kind.localeCompare(b.kind)));
  return { node, route, kids, links, bridges };
}

/* --- Buscar ------------------------------------------------------------------------------------ */

/** Por código o por nombre, en los dos Pilos (o en el que se está viendo). Las fuentes y colecciones no se buscan. */
export function searchGlobal(g: GlobalGraph, query: string, filter: GlobalFilter = "todo", limit = 12): GNode[] {
  const pool: ViewNode[] = g.nodes
    .filter((n) => filter === "todo" || n.space === filter)
    .map((n) => ({ id: n.id, source: n.source, type: n.kind === "coleccion" ? "fuente" : n.kind, code: n.code, label: n.label, path: n.path }));
  return searchNodes(pool, query, limit).map((n) => g.byId.get(n.id)!);
}

/** Cuántos puntos tiene cada Pilo (sin sus fuentes ni colecciones) y cuántos puentes hay. */
export function countsOf(g: GlobalGraph): Record<PiloSpace, number> & { puentes: number } {
  const out = { planeacion: 0, ensenanza: 0, puentes: g.bridges.length };
  for (const n of g.nodes) if (n.kind !== "fuente" && n.kind !== "coleccion") out[n.space] += 1;
  return out;
}

/** De los puentes dibujados: cuántos sigue la búsqueda (aprobados) y cuántos esperan revisión. */
export function bridgeCounts(g: GlobalGraph): { aprobados: number; propuestos: number } {
  const aprobados = g.bridges.filter((b) => b.status === "aprobada").length;
  return { aprobados, propuestos: g.bridges.filter((b) => b.status === "propuesta").length };
}

/* --- La bandeja de puentes por revisar ------------------------------------------------------ */

export interface InboxItem {
  bridge: StoredBridge;
  /** El extremo de cada Pilo, con su nombre y, si está en el mapa, el punto para saltar a él. */
  ends: { space: PiloSpace; label: string; node: string | null }[];
  /** De dónde sale la propuesta, en palabras. */
  origin: string;
}

const KIND_TEXT: Record<BridgeKind, string> = { referencia: "Citan la misma referencia", nombre: "Se llaman igual", tema: "Tratan el mismo tema", relacion: "Relación propuesta" };

/** Un puente guardado, listo para la bandeja: sus dos extremos (Planeación primero) y de dónde sale. */
export function inboxItem(b: StoredBridge, byId: Map<string, GNode>): InboxItem {
  const ends = [
    { scope: b.a_scope, id: b.a_id, label: b.a_label },
    { scope: b.b_scope, id: b.b_id, label: b.b_label },
  ]
    .filter((e): e is { scope: PiloSpace; id: string; label: string } => e.scope === "planeacion" || e.scope === "ensenanza")
    .sort((x, y) => SPACES.indexOf(x.scope) - SPACES.indexOf(y.scope))
    .map((e) => {
      const node = byId.get(gid(e.scope, e.id));
      return { space: e.scope, label: e.label || node?.label || e.id, node: node?.id ?? null };
    });
  return { bridge: b, ends, origin: `${ORIGIN_TEXT[b.origin]} · ${lowerFirst(KIND_TEXT[b.kind])}` };
}

/** Los que faltan por revisar, los más recientes primero (el orden de la base). */
export const inboxOf = (rows: StoredBridge[], byId: Map<string, GNode>): InboxItem[] => rows.filter((b) => b.status === "propuesta").map((b) => inboxItem(b, byId));
