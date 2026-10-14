/* =============================================================================
   Mis Tableros · el modelo.

   Lo común a la intranet y a la página pública: el organigrama, los papeles y
   la escalera de visibilidad.

   Dos ideas sostienen el resto:

   1. El papel se hereda hacia abajo, y gana el más cercano. Quien dirige una
      facultad dirige sus programas sin que haya que apuntarlo uno por uno;
      pero si en un programa concreto se le pone otro papel, ese manda. Aquí se
      calcula igual que en la base de datos (`unit_role_at`, 0057), porque la
      pantalla tiene que enseñar lo mismo que la base va a conceder.

   2. Lo que se ve en la pantalla no es lo que protege. La autorización de
      verdad está en las políticas RLS: esto solo evita ofrecer botones que no
      van a funcionar.
   ========================================================================== */

import type { ObsAnonymization, ObsColumn, ObsDataType } from "../admin/observatorio/model";
import type { FreeRow, FreeTemporality } from "../datos-abiertos/data/free-sets";

/* --- El organigrama ---------------------------------------------------------- */

export type UnitKind = "vicerrectoria" | "facultad" | "programa" | "oficina" | "otra";
export type UnitRole = "visor" | "editor" | "jefe";

export const UNIT_KIND: Record<UnitKind, { label: string; plural: string }> = {
  vicerrectoria: { label: "Vicerrectoría", plural: "Vicerrectorías" },
  facultad: { label: "Facultad", plural: "Facultades" },
  programa: { label: "Programa", plural: "Programas" },
  oficina: { label: "Oficina", plural: "Oficinas" },
  otra: { label: "Otra unidad", plural: "Otras unidades" },
};

/**
 * La función de una persona en una unidad. En la base siguen llamándose
 * visor, editor y jefe; en pantalla se nombran por lo que hacen con los datos
 * de la unidad, que es como lo dice Planeación.
 */
export const UNIT_ROLE: Record<UnitRole, { label: string; hint: string }> = {
  visor: { label: "Consulta", hint: "Ve los tableros y los datos de la unidad y los descarga." },
  editor: { label: "Contribuyente", hint: "Aporta los datos de la unidad: sube tablas, arma visores y prepara boletines." },
  jefe: { label: "Gestor", hint: "Responde por los datos de la unidad: además crea y borra tableros, reparte accesos y pide publicar." },
};

/** De menor a mayor. Sirve para comparar y para ordenar. */
const ROLE_RANK: Record<UnitRole, number> = { visor: 1, editor: 2, jefe: 3 };

export interface Unit {
  id: string;
  parentId: string | null;
  kind: UnitKind;
  code: string;
  name: string;
  slug: string;
  description: string;
  position: number;
}

export interface UnitMember {
  id: string;
  unitId: string;
  profileId: string;
  role: UnitRole;
  name: string;
  email: string;
}

/* --- La herencia -------------------------------------------------------------- */

/** La unidad y todas de las que cuelga, de la más cercana a la más lejana. */
export function unitChain(units: Unit[], target: string): Unit[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const chain: Unit[] = [];
  let walker = byId.get(target);
  // El tope corta un árbol mal formado; la base lo impide con un disparador,
  // pero la pantalla puede recibir datos a medio cargar.
  while (walker && chain.length < 64) {
    chain.push(walker);
    walker = walker.parentId ? byId.get(walker.parentId) : undefined;
  }
  return chain;
}

/** Las unidades que cuelgan de una, a cualquier profundidad. */
export function unitDescendants(units: Unit[], target: string): Unit[] {
  const kids = (id: string) => units.filter((u) => u.parentId === id).sort((a, b) => a.position - b.position);
  const out: Unit[] = [];
  const walk = (id: string, depth: number) => {
    if (depth > 64) return;
    for (const child of kids(id)) {
      out.push(child);
      walk(child.id, depth + 1);
    }
  };
  walk(target, 0);
  return out;
}

/** Los hijos directos, en su orden. */
export function unitChildren(units: Unit[], parentId: string | null): Unit[] {
  return units.filter((u) => u.parentId === parentId).sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, "es"));
}

/**
 * El papel de alguien sobre una unidad, con la herencia aplicada.
 *
 * Manda la pertenencia más cercana del árbol, no la más fuerte: es lo que
 * permite que una puesta en el programa rebaje la que baja de la facultad. A
 * igual distancia gana la más fuerte, que solo puede pasar si hay dos
 * pertenencias en la misma unidad.
 *
 * Espeja `unit_role_at()` de la 0057. Si las dos difieren, manda la base.
 */
export function roleAt(units: Unit[], members: UnitMember[], profileId: string, target: string): UnitRole | null {
  const chain = unitChain(units, target);
  for (const unit of chain) {
    const own = members.filter((m) => m.unitId === unit.id && m.profileId === profileId);
    if (own.length) return own.reduce((best, m) => (ROLE_RANK[m.role] > ROLE_RANK[best.role] ? m : best)).role;
  }
  return null;
}

/** ¿De dónde le viene el papel? La unidad misma, o el ancestro que lo presta. */
export function roleSource(units: Unit[], members: UnitMember[], profileId: string, target: string): Unit | null {
  for (const unit of unitChain(units, target)) {
    if (members.some((m) => m.unitId === unit.id && m.profileId === profileId)) return unit;
  }
  return null;
}

export const atLeast = (role: UnitRole | null, minimum: UnitRole) =>
  role !== null && ROLE_RANK[role] >= ROLE_RANK[minimum];

/**
 * ¿Puede mandar en esta unidad: crear y borrar sus tableros?
 *
 * Su jefe —el de la unidad o el de una de la que cuelga— y la administración.
 * Tener rol de Planeación no basta: en la escalera clásica ese rol significa
 * «edita pilares y decide qué se publica», y lo tiene mucha gente. Borrar el
 * tablero de una facultad es de esa facultad. Espeja `unit_can_lead` (0060).
 */
export const canLead = (role: UnitRole | null, isAdmin: boolean) => isAdmin || role === "jefe";

/**
 * ¿Puede repartir los papeles de esta unidad?
 *
 * Va aparte de mandar, a propósito: al crear una unidad todavía no hay jefe,
 * así que alguien de fuera tiene que nombrar al primero. Pero poder nombrarlo
 * no es poder borrarle sus tableros. Espeja `unit_can_staff` (0060).
 */
export const canStaff = (role: UnitRole | null, isPlaneacion: boolean) => isPlaneacion || role === "jefe";

/** Qué pinta cada unidad en el árbol de quien mira. */
export type Reach = "propia" | "heredada" | "contexto";

/**
 * La parte del organigrama que le toca a alguien.
 *
 * Tres clases de unidad, y la diferencia importa:
 *
 *   propia     tiene papel en ella, puesto ahí o bajado de más arriba.
 *   heredada   cuelga de una suya, así que su papel también llega.
 *   contexto   está por encima de alguna suya. Se dibuja para que el camino
 *              se entienda —«estás dentro de esta facultad»— pero no se abre:
 *              no hay nada detrás, y ofrecerla sería prometer un acceso que
 *              la base va a negar.
 *
 * El resto de la universidad no sale. No es que se esconda un secreto —el
 * organigrama es público— sino que un árbol con cuarenta unidades de las que
 * treinta y ocho no te tocan parece un acceso que no tienes.
 *
 * Quien lo ve entero es quien lo mantiene: la administración.
 */
export function reachOf(
  units: Unit[],
  members: UnitMember[],
  profileId: string,
  seesAll: boolean,
): Map<string, Reach> {
  const reach = new Map<string, Reach>();
  if (seesAll) {
    for (const unit of units) reach.set(unit.id, "propia");
    return reach;
  }
  if (!profileId) return reach;

  // Donde tiene pertenencia puesta a mano, y todo lo que cuelga de ahí.
  const seats = members.filter((m) => m.profileId === profileId).map((m) => m.unitId);
  for (const seat of seats) {
    if (!units.some((u) => u.id === seat)) continue;
    reach.set(seat, "propia");
    for (const kid of unitDescendants(units, seat)) {
      if (!reach.has(kid.id)) reach.set(kid.id, "heredada");
    }
  }

  // El camino hasta la raíz, solo para que se entienda dónde está.
  for (const id of [...reach.keys()]) {
    const unit = units.find((u) => u.id === id);
    if (!unit) continue;
    for (const up of unitChain(units, unit.id).slice(1)) {
      if (!reach.has(up.id)) reach.set(up.id, "contexto");
    }
  }
  return reach;
}

/* --- Los tableros -------------------------------------------------------------- */

export type BoardVisibility = "unidad" | "universidad" | "publico";

export const VISIBILITY: Record<BoardVisibility, { label: string; short: string; hint: string }> = {
  unidad: {
    label: "Solo la unidad",
    short: "Solo la unidad",
    hint: "Lo abren quienes pertenecen a la unidad o a una de la que cuelga. Y Planeación, que ve todos los tableros.",
  },
  universidad: {
    label: "Toda la universidad",
    short: "Con sesión",
    hint: "Cualquiera que entre con su cuenta lo encuentra. Sin sesión, la dirección no devuelve nada.",
  },
  publico: {
    label: "Público, en el portal",
    short: "Público",
    hint: "Queda en el portal como un tablero más, sin sesión. Lo aprueba Planeación.",
  },
};

export interface BoardPage {
  slug: string;
  title: string;
}

export interface Board {
  id: string;
  unitId: string;
  slug: string;
  title: string;
  description: string;
  visibility: BoardVisibility;
  pages: BoardPage[];
  position: number;
  updatedAt: string;
}

/** Una tabla de datos: la misma forma que las del Observatorio, a propósito. */
export interface BoardDataset {
  id: string;
  boardId: string;
  title: string;
  description: string;
  source: string;
  dataType: ObsDataType;
  temporality: FreeTemporality;
  periodLabel: string;
  columns: ObsColumn[];
  rows: FreeRow[];
  /**
   * El acta que dejó la importación. Es la misma del Observatorio, no una
   * copia: quien sube una tabla aquí pasa por el mismo analizador, así que el
   * acta que produce ya tiene esta forma y traducirla solo abriría la puerta a
   * que las dos se separen.
   */
  anonymization: ObsAnonymization | null;
  position: number;
  updatedAt: string;
}

export interface BoardView {
  id: string;
  boardId: string;
  datasetId: string;
  page: string;
  /** Tipo, columnas y opciones; lo mismo que `ObsView` guarda en su `spec`. */
  spec: Record<string, unknown>;
  size: "media" | "completa";
  visible: boolean;
  position: number;
}

/* --- La publicación ------------------------------------------------------------ */

export type ReviewState = "pendiente" | "aprobada" | "devuelta";

export interface ReviewCheck {
  key: string;
  ok: boolean;
  label: string;
  detail: string;
}

export interface BoardReview {
  id: string;
  boardId: string;
  target: BoardVisibility;
  state: ReviewState;
  checks: ReviewCheck[];
  note: string;
  requestedBy: string | null;
  requestedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string;
}

/**
 * Lo que se comprueba antes de dejar publicar.
 *
 * No es un trámite de forma: son las cuatro cosas que hacen daño si se
 * publican mal. Se calculan aquí, se guardan escritas con la solicitud y quien
 * aprueba las lee tal cual quedaron, no como estén hoy.
 *
 * Un aviso no bloquea: bloquea que no haya nada que publicar y que falte el
 * acta. Lo demás lo pesa quien aprueba.
 */
export function reviewChecks(board: Board, datasets: BoardDataset[], views: BoardView[]): ReviewCheck[] {
  const shown = views.filter((v) => v.visible);
  const used = new Set(shown.map((v) => v.datasetId));
  const inPlay = datasets.filter((d) => used.has(d.id));
  const withoutAct = inPlay.filter((d) => !d.anonymization);
  const withoutSource = inPlay.filter((d) => !d.source.trim());
  const reserved = inPlay.reduce((sum, d) => sum + (d.anonymization?.reservedCells ?? 0), 0);
  const removed = inPlay.flatMap((d) => d.anonymization?.removed ?? []);

  return [
    {
      key: "contenido",
      ok: shown.length > 0,
      label: shown.length > 0 ? `${shown.length} ${shown.length === 1 ? "visor" : "visores"} a la vista` : "El tablero no enseña nada",
      detail: shown.length > 0 ? `Sobre ${inPlay.length} ${inPlay.length === 1 ? "tabla" : "tablas"}.` : "Un tablero sin visores visibles no se publica.",
    },
    {
      key: "acta",
      ok: withoutAct.length === 0,
      label: withoutAct.length === 0 ? "Todas las tablas traen acta de anonimización" : `${withoutAct.length} ${withoutAct.length === 1 ? "tabla no trae acta" : "tablas no traen acta"}`,
      detail:
        withoutAct.length === 0
          ? removed.length
            ? `Se dejaron fuera ${removed.length} ${removed.length === 1 ? "columna" : "columnas"} al importar.`
            : "Ninguna columna parecía un identificador de persona."
          : `Sin acta no se sabe cómo se agregaron: ${withoutAct.map((d) => d.title).join(", ")}.`,
    },
    {
      key: "reserva",
      ok: reserved === 0,
      label: reserved === 0 ? "Ninguna celda por debajo del umbral" : `${reserved} ${reserved === 1 ? "celda" : "celdas"} por debajo del umbral`,
      detail: reserved === 0 ? "" : "Se publicarán como «< n», nunca con su cifra.",
    },
    {
      key: "origen",
      ok: withoutSource.length === 0,
      label: withoutSource.length === 0 ? "Todas las tablas dicen quién las reporta" : `${withoutSource.length} ${withoutSource.length === 1 ? "tabla" : "tablas"} sin oficina que reporte`,
      detail: withoutSource.length === 0 ? "" : `Una cifra publicada sin origen no se puede citar: ${withoutSource.map((d) => d.title).join(", ")}.`,
    },
  ];
}

/** Lo que impide pedir la publicación, en palabras. Vacío, se puede pedir. */
export function blockingProblems(checks: ReviewCheck[]): string[] {
  return checks.filter((c) => !c.ok && (c.key === "contenido" || c.key === "acta")).map((c) => c.label);
}

/* --- Direcciones --------------------------------------------------------------- */

/** La dirección pública de un tablero. No cambia al subir de peldaño. */
export const boardPath = (unitSlug: string, boardSlug: string) => `/tableros/${unitSlug}/${boardSlug}`;

/** Un slug a partir de un título, para proponerlo al crear. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48)
    // Cortar a 48 puede dejar un guion al final («…economicas-»), y la base
    // rechaza ese slug (units_slug_format): se quita después de cortar.
    .replace(/-+$/, "");
}

/** Un slug que no choque con los que ya hay. */
export function freeSlug(text: string, taken: string[]): string {
  const base = slugify(text) || "tablero";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}
