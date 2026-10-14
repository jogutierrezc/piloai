/* =============================================================================
   Intranet · Mr. Pilo con IA · lo que se calcula sin pantalla.

   - Las secciones del módulo, cómo se leen de la dirección (?seccion=…) y
     cuáles tienen cambios sin guardar.
   - La malla indexada una sola vez: con dos mil nodos, buscar padres e hijos
     recorriendo todas las relaciones en cada clic se nota.
   - La cadena de un nodo: todo lo que lo contiene (por cualquiera de sus
     padres) y todo lo que cuelga de él.
   - El trazado del Plan de Desarrollo en columnas (P › AE › LA › PR) con la
     regla del Mapa numerado: las líneas de acción son las hojas, cada una en
     su fila; un área va al promedio de sus líneas, un pilar al de sus áreas y
     un proyecto al de todo aquello de lo que cuelga, sin pisarse.
   - La búsqueda por código (P1, AE3, LA12, PR4) o por nombre.
   ========================================================================== */

import type { MeshEdge, MeshNode } from "../../../components/pilo/ai/logic";
import type { StaffArea } from "../../../lib/pilo-staff";
import type { PiloSettings } from "./store";

/* --- Las secciones -------------------------------------------------------------------- */

export type SectionId = "conexion" | "voz" | "portales" | "pregunta" | "memoria" | "web" | "catalogo" | "usuarios" | "emergencias" | "uso";

export const SECTIONS: { id: SectionId; label: string; title: string; lead: string }[] = [
  { id: "conexion", label: "Conexión", title: "Conexión para resumir y sintetizar", lead: "El servicio que redacta, su clave y la prueba." },
  { id: "voz", label: "Voz", title: "La voz de Mr. Pilo", lead: "Con qué voz lee en voz alta, a qué velocidad y en qué tono." },
  { id: "portales", label: "Dónde aparece", title: "Qué hace y dónde aparece", lead: "Las funciones de Mr. Pilo y, portal por portal, para quién están abiertas." },
  { id: "pregunta", label: "Pregúntele a Pilo", title: "Pregúntele a Pilo", lead: "La página pública de preguntas: si está abierta, para quién y lo que ya respondió." },
  { id: "memoria", label: "Memoria", title: "La memoria de Pilo", lead: "Lo que Pilo sabe de los portales, cómo se conecta y cuándo se leyó por última vez." },
  { id: "web", label: "Páginas web", title: "Páginas web", lead: "Pilo lee una página por su dirección, la guarda en su memoria y la conecta con lo demás que sabe." },
  { id: "catalogo", label: "Catálogo", title: "Catálogo de Pilo", lead: "Respuestas oficiales y microexpresiones, escritas en Excel." },
  { id: "usuarios", label: "Usuarios de Pilo", title: "Usuarios de Pilo", lead: "Las cuentas que solo sirven para Pilo: quién se registró, con qué perfil y sede, y en qué estado está." },
  { id: "emergencias", label: "Emergencias", title: "Alerta de emergencias", lead: "Sismos, incendios y emergencias que Aluna declara: Pilo los muestra a todos mientras duren." },
  { id: "uso", label: "Uso y bitácora", title: "Uso, límites y bitácora", lead: "Cuánto se ha usado hoy, los topes y los últimos pedidos." },
];

export const DEFAULT_SECTION: SectionId = "conexion";

/**
 * A qué zona del personal pertenece cada sección. Quien no tenga la zona no ve
 * la pestaña ni monta el cuerpo (la autorización real sigue siendo RLS).
 *
 *   conexion      Conexión, Voz, Uso y bitácora (proveedor, claves, voz, topes)
 *   portales      Dónde aparece, Pregúntele a Pilo (apertura y audiencia)
 *   memoria       Memoria (documentos y fuentes; la actualización, la malla y
 *                 la prueba son solo del admin dentro de ella)
 *   conexion      también Páginas web: el navegador (pilo_0146) sigue solo-admin
 *   catalogo      Catálogo
 *   usuarios      Usuarios de Pilo
 *   emergencias   Emergencias
 */
export const SECTION_AREA: Record<SectionId, StaffArea> = {
  conexion: "conexion",
  voz: "conexion",
  uso: "conexion",
  portales: "portales",
  pregunta: "portales",
  memoria: "memoria",
  web: "conexion",
  catalogo: "catalogo",
  usuarios: "usuarios",
  emergencias: "emergencias",
};

/** Lo que el personal puede usar: `canUse` de useAuth(). */
export type CanUse = (area: StaffArea) => boolean;

/** Las secciones que esta persona puede ver, en el orden de siempre. */
export function sectionsFor(canUse: CanUse): typeof SECTIONS {
  return SECTIONS.filter((s) => canUse(SECTION_AREA[s.id]));
}

/**
 * La sección que pide la dirección, solo entre las permitidas; una
 * desconocida o prohibida cae a la primera permitida (nunca se monta otra).
 * Sin ninguna permitida devuelve la de partida: quien llama no debe montar nada.
 */
export function parseSection(value: string | null | undefined, allowed: readonly SectionId[] = SECTIONS.map((s) => s.id)): SectionId {
  const v = (value ?? "").trim().toLowerCase();
  const hit = allowed.find((id) => id === v);
  return hit ?? allowed[0] ?? DEFAULT_SECTION;
}

/** Qué campos de la configuración vive en cada sección (los que se guardan con «Guardar cambios»). */
const SECTION_FIELDS: Partial<Record<SectionId, (keyof PiloSettings)[]>> = {
  conexion: ["provider", "base_url", "chat_path", "text_model"],
  voz: [
    "voice_engine",
    "speech_provider",
    "speech_base_url",
    "speech_path",
    "speech_model",
    "speech_voice",
    "voice_rate",
    "voice_pitch",
    "speech_function_id",
    "voice_language",
    "voice_quality",
    "voice_styles",
    "voice_style",
    "voice_portal_styles",
    "fish_model",
  ],
  portales: ["impacto_report", "widget_on", "widget_origins"],
  pregunta: ["ask_temperature", "ask_max_tokens", "ask_context_tokens", "ask_history_turns", "system_role", "ask_stream", "visitor_limit", "visitor_window_seconds"],
  memoria: ["memory_sources", "embed_model"],
  uso: ["daily_limit", "voice_daily_limit", "max_rows", "cache_days"],
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Las secciones con cambios sin guardar. «Dónde aparece» y «Pregúntele a
 * Pilo» se reparten las funciones y los portales: la de preguntar y el portal
 * «pregunta» son de la segunda, el resto de la primera. El interruptor
 * general vive en la cabecera y no cuenta para ninguna.
 */
export function dirtySections(now: PiloSettings, saved: PiloSettings): SectionId[] {
  const out = new Set<SectionId>();
  for (const [id, fields] of Object.entries(SECTION_FIELDS) as [SectionId, (keyof PiloSettings)[]][]) {
    if (fields.some((f) => !same(now[f], saved[f]))) out.add(id);
  }
  const fnKeys = new Set([...Object.keys(now.functions ?? {}), ...Object.keys(saved.functions ?? {})]);
  for (const k of fnKeys) {
    const a = (now.functions as Record<string, boolean>)[k];
    const b = (saved.functions as Record<string, boolean>)[k];
    if (a !== b) out.add(k === "preguntar" ? "pregunta" : "portales");
  }
  const portalKeys = new Set([...Object.keys(now.portals ?? {}), ...Object.keys(saved.portals ?? {})]);
  for (const k of portalKeys) {
    const a = (now.portals as Record<string, unknown>)[k];
    const b = (saved.portals as Record<string, unknown>)[k];
    if (!same(a, b)) out.add(k === "pregunta" ? "pregunta" : "portales");
  }
  if (now.pregunta_welcome !== saved.pregunta_welcome) out.add("pregunta");
  return SECTIONS.map((s) => s.id).filter((id) => out.has(id));
}

/** «Voz», «Voz y Memoria», «Voz, Memoria y Uso y bitácora». */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`;
}

/* --- La malla indexada ------------------------------------------------------------------ */

export type ViewNode = MeshNode & { props?: Record<string, unknown> };

export interface MeshIndex {
  nodes: ViewNode[];
  edges: MeshEdge[];
  byId: Map<string, ViewNode>;
  /** Hijos por «contiene», en el orden en que llegan las relaciones. */
  kids: Map<string, string[]>;
  /** Padres por «contiene»; el primero es el de la ruta. */
  parents: Map<string, string[]>;
  /** Otras relaciones que llegan a un nodo (no «contiene»). */
  links: Map<string, MeshEdge[]>;
}

export function indexMesh(mesh: { nodes: ViewNode[]; edges: MeshEdge[] }): MeshIndex {
  const byId = new Map(mesh.nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  const links = new Map<string, MeshEdge[]>();
  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => {
    const list = map.get(key);
    if (list) list.push(value);
    else map.set(key, [value]);
  };
  for (const e of mesh.edges) {
    if (!byId.has(e.from) || !byId.has(e.to)) continue;
    if (e.rel === "contiene") {
      if (kids.get(e.from)?.includes(e.to)) continue;
      push(kids, e.from, e.to);
      push(parents, e.to, e.from);
    } else {
      push(links, e.to, e);
      push(links, e.from, e);
    }
  }
  return { nodes: mesh.nodes, edges: mesh.edges, byId, kids, parents, links };
}

/** La ruta por el primer padre: [raíz, …, nodo]. */
export function routeOf(index: MeshIndex, id: string): ViewNode[] {
  const out: ViewNode[] = [];
  const seen = new Set<string>();
  let current = index.byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    out.unshift(current);
    const up = index.parents.get(current.id)?.[0];
    current = up ? index.byId.get(up) : undefined;
  }
  return out;
}

export interface Chain {
  /** Nodos de la cadena: el nodo, todo lo que lo contiene y todo lo que cuelga de él. */
  nodes: Set<string>;
  /** Relaciones de la cadena, como «de>a». */
  edges: Set<string>;
  /** Solo los de arriba (para abrir el árbol hasta el nodo). */
  up: Set<string>;
}

export const edgeKey = (from: string, to: string) => `${from}>${to}`;

export function chainOf(index: MeshIndex, id: string): Chain {
  const nodes = new Set<string>([id]);
  const edges = new Set<string>();
  const up = new Set<string>();
  const upStack = [id];
  while (upStack.length) {
    const current = upStack.pop()!;
    for (const p of index.parents.get(current) ?? []) {
      edges.add(edgeKey(p, current));
      if (up.has(p)) continue;
      up.add(p);
      nodes.add(p);
      upStack.push(p);
    }
  }
  const downStack = [id];
  const down = new Set<string>([id]);
  while (downStack.length) {
    const current = downStack.pop()!;
    for (const k of index.kids.get(current) ?? []) {
      edges.add(edgeKey(current, k));
      if (down.has(k)) continue;
      down.add(k);
      nodes.add(k);
      downStack.push(k);
    }
  }
  return { nodes, edges, up };
}

/** Cuántos nodos tiene cada fuente, sin contar su raíz. */
export function countBySource(nodes: ViewNode[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const n of nodes) if (n.type !== "fuente") out[n.source] = (out[n.source] ?? 0) + 1;
  return out;
}

/* --- El Plan de Desarrollo en columnas ----------------------------------------------------- */

export type PdiColumn = "pilar" | "area" | "linea" | "proyecto";
export const PDI_COLUMNS: PdiColumn[] = ["pilar", "area", "linea", "proyecto"];

export interface PlacedNode {
  id: string;
  column: PdiColumn;
  y: number;
}

export interface PdiLayout {
  placed: PlacedNode[];
  byId: Map<string, PlacedNode>;
  /** Por columna, de arriba abajo: para moverse con las flechas. */
  columns: Record<PdiColumn, string[]>;
  edges: { from: string; to: string }[];
  height: number;
}

/**
 * Las columnas del Plan. `row` es la distancia entre dos hojas; los proyectos
 * se reparten con la misma distancia mínima para que sus rótulos no se pisen.
 */
export function layoutPdi(index: MeshIndex, root = "fuente:pdi", row = 20): PdiLayout {
  const y = new Map<string, number>();
  const column = new Map<string, PdiColumn>();
  let next = 0;
  const take = () => {
    const v = next * row;
    next += 1;
    return v;
  };
  const kidsOfType = (id: string, type: PdiColumn) => (index.kids.get(id) ?? []).filter((k) => index.byId.get(k)?.type === type);
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

  for (const p of kidsOfType(root, "pilar")) {
    if (y.has(p)) continue;
    column.set(p, "pilar");
    const areaYs: number[] = [];
    for (const a of kidsOfType(p, "area")) {
      if (y.has(a)) {
        areaYs.push(y.get(a)!);
        continue;
      }
      column.set(a, "area");
      const lineYs: number[] = [];
      for (const l of kidsOfType(a, "linea")) {
        if (!y.has(l)) {
          column.set(l, "linea");
          y.set(l, take());
        }
        lineYs.push(y.get(l)!);
      }
      y.set(a, lineYs.length ? mean(lineYs) : take());
      areaYs.push(y.get(a)!);
    }
    y.set(p, areaYs.length ? mean(areaYs) : take());
  }

  // Proyectos: al promedio de sus padres ya ubicados, luego sin pisarse.
  const projects = index.nodes.filter((n) => n.source === "pdi" && n.type === "proyecto");
  const ideal = projects
    .map((n) => {
      const ys = (index.parents.get(n.id) ?? []).map((p) => y.get(p)).filter((v): v is number => v !== undefined);
      return { id: n.id, want: ys.length ? mean(ys) : Number.POSITIVE_INFINITY };
    })
    .sort((a, b) => a.want - b.want || a.id.localeCompare(b.id));
  let last = -Infinity;
  const tail = next * row;
  let orphan = 0;
  for (const p of ideal) {
    const want = Number.isFinite(p.want) ? p.want : tail + orphan++ * row;
    const placed = Math.max(want, last + row);
    y.set(p.id, placed);
    column.set(p.id, "proyecto");
    last = placed;
  }

  const placed: PlacedNode[] = [];
  for (const [id, col] of column) placed.push({ id, column: col, y: y.get(id)! });
  const byId = new Map(placed.map((p) => [p.id, p]));
  const columns = { pilar: [], area: [], linea: [], proyecto: [] } as Record<PdiColumn, string[]>;
  for (const p of [...placed].sort((a, b) => a.y - b.y)) columns[p.column].push(p.id);
  const edges: { from: string; to: string }[] = [];
  for (const p of placed) for (const k of index.kids.get(p.id) ?? []) if (byId.has(k)) edges.push({ from: p.id, to: k });
  const height = placed.reduce((m, p) => Math.max(m, p.y), 0);
  return { placed, byId, columns, edges, height };
}

/* --- La búsqueda --------------------------------------------------------------------------- */

export const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Por código primero (PR4 es PR4, no PR41), luego código que empieza así,
 * luego nombre que empieza así y al final nombre que lo contiene. Las raíces
 * de fuente no se buscan: se eligen con el filtro.
 */
export function searchNodes(nodes: ViewNode[], query: string, limit = 12): ViewNode[] {
  const q = fold(query).replace(/\s+/g, " ");
  if (!q) return [];
  const code = q.replace(/\s+/g, "");
  const scored: { n: ViewNode; score: number }[] = [];
  for (const n of nodes) {
    if (n.type === "fuente") continue;
    const c = fold(n.code ?? "");
    const label = fold(n.label ?? "");
    let score = 0;
    if (c && c === code) score = 400;
    else if (c && c.startsWith(code)) score = 300 - (c.length - code.length);
    else if (label.startsWith(q)) score = 200;
    else if (label.includes(q)) score = 100 - Math.min(90, label.indexOf(q));
    else if (fold(`${n.code} ${n.label}`).includes(q)) score = 50;
    if (score > 0) scored.push({ n, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || (a.n.code ?? "").length - (b.n.code ?? "").length || a.n.label.localeCompare(b.n.label, "es"))
    .slice(0, limit)
    .map((s) => s.n);
}

/** Recorta un rótulo al ancho de su columna; completo sigue en el panel. */
export function clipLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
