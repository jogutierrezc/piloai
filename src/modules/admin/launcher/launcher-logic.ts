/* =============================================================================
   Inicio de la administración · lo puro.

   Las decisiones del dashboard que no necesitan React ni la base: qué módulos
   ve cada rol, qué cifras salen de las fichas de pilo_docs, qué queda
   pendiente y cómo se busca. Los módulos salen del mismo menú que usa el
   AdminShell (buildStaffNav): una ruta nueva se agrega allí y aparece aquí.
   Nada de esto protege datos; la autorización real son las políticas RLS.

   Pendientes: solo lo que las fichas dicen. Un documento en error, uno que
   Pilo aún no entiende, un PDF escaneado sin texto, y —por espacio— la
   memoria que lleva más de 30 días sin recibir nada. Sin fichas no se
   inventa nada: no hay pendiente.
   ========================================================================== */

import { spacesFor, staffRoleLabels } from "../../../lib/pilo-staff";
import type { PiloSpaceId, PiloStaffRole } from "../../../lib/pilo-staff";
import { SPACE_LABELS, buildStaffNav, spaceSectionPath } from "../../../lib/staff-access";
import type { StaffNavEntry } from "../../../lib/staff-access";

/** Días sin cargar nada tras los cuales la memoria de un espacio se considera vieja. */
export const STALE_DAYS = 30;
/** Con tantas entradas o más, el inicio ofrece buscador. */
export const SEARCH_MIN_ENTRIES = 8;

const DAY = 86_400_000;

/** Lo que el inicio lee de una ficha de pilo_docs. */
export interface DocLite {
  space: string;
  status: string;
  passages: number;
  active: boolean;
  created_at: string;
  updated_at: string;
}

/* --- Módulos ----------------------------------------------------------------------------------- */

export interface SpaceModule {
  kind: "space";
  id: PiloSpaceId;
  label: string;
  text: string;
  /** Pantalla de configuración del espacio. */
  to: string;
  uploadTo: string;
  docsTo: string;
  /** Las secciones de trabajo del espacio que este rol abre (para el microportal). */
  links: { label: string; to: string }[];
}

export interface ToolModule {
  kind: "tool";
  id: string;
  label: string;
  text: string;
  to: string;
}

export type LauncherModule = SpaceModule | ToolModule;

const SPACE_TEXT: Record<PiloSpaceId, string> = {
  planeacion: "La memoria institucional de Pilo: documentos, respuestas oficiales y fuentes.",
  ensenanza: "La memoria de la docencia de Pilo: documentos, cursos y respuestas para el aula.",
};

const TOOL_TEXT: Record<string, string> = {
  conexion: "Proveedor de IA, claves, voz y consumo.",
  portales: "Los portales donde Pilo atiende.",
  usuarios: "Las cuentas de quienes usan Pilo.",
  emergencias: "Las alertas de Aluna que piden atención.",
  personal: "Quién administra Pilo y con qué rol.",
};

/** Los módulos de un rol: un cartel por espacio que trabaja y una herramienta por zona que abre. */
export function modulesFor(role: PiloStaffRole | null): LauncherModule[] {
  if (!role) return [];
  const nav = buildStaffNav(role);
  const spaces: SpaceModule[] = spacesFor(role).map((space) => ({
    kind: "space",
    id: space,
    label: SPACE_LABELS[space],
    text: SPACE_TEXT[space],
    to: spaceSectionPath(space, "memoria"),
    uploadTo: `${spaceSectionPath(space, "memoria")}&accion=subir`,
    docsTo: spaceSectionPath(space, "memoria"),
    links: [
      { label: "Documentos", to: spaceSectionPath(space, "memoria") },
      { label: "Catálogo", to: spaceSectionPath(space, "catalogo") },
    ],
  }));
  const tools: ToolModule[] = nav
    .filter((e) => e.group !== "trabajo")
    .map((e) => ({ kind: "tool", id: e.id, label: e.label, text: TOOL_TEXT[e.id] ?? "", to: e.to }));
  return [...spaces, ...tools];
}

/** Las entradas buscables: las del menú, sin el propio inicio. */
export function searchableEntries(role: PiloStaffRole | null): StaffNavEntry[] {
  return buildStaffNav(role).filter((e) => e.id !== "inicio");
}

export function hasSearch(role: PiloStaffRole | null): boolean {
  return searchableEntries(role).length >= SEARCH_MIN_ENTRIES;
}

/** Minúsculas y sin tildes: «ensenanza» encuentra «Enseñanza». */
export function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Filtra entradas por todas las palabras escritas; sin texto devuelve todas. */
export function filterEntries(entries: readonly StaffNavEntry[], query: string): StaffNavEntry[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries.filter((e) => {
    const hay = fold(`${e.label} ${e.group} ${e.space ? SPACE_LABELS[e.space] : ""}`);
    return words.every((w) => hay.includes(w));
  });
}

/* --- Cifras ------------------------------------------------------------------------------------ */

export interface SpaceStats {
  documents: number;
  passages: number;
  /** ISO del documento más reciente, o null si no hay. */
  lastLoadedAt: string | null;
  errors: number;
}

export function spaceStats(docs: readonly DocLite[], space: PiloSpaceId): SpaceStats {
  const mine = docs.filter((d) => d.space === space);
  let last: string | null = null;
  for (const d of mine) if (!last || Date.parse(d.created_at) > Date.parse(last)) last = d.created_at;
  return {
    documents: mine.length,
    passages: mine.reduce((sum, d) => sum + (d.passages || 0), 0),
    lastLoadedAt: last,
    errors: mine.filter((d) => d.status === "error").length,
  };
}

/** Días enteros transcurridos; nunca negativos. */
export function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now - t) / DAY));
}

/** «hoy», «ayer», «hace 5 días», «hace 3 meses». */
export function agoLabel(iso: string | null, now: number): string {
  const d = daysSince(iso, now);
  if (d === null) return "sin cargas";
  if (d === 0) return "hoy";
  if (d === 1) return "ayer";
  if (d < 60) return `hace ${d} días`;
  const months = Math.floor(d / 30);
  return months < 12 ? `hace ${months} meses` : `hace ${Math.floor(months / 12)} ${months < 24 ? "año" : "años"}`;
}

/* --- Pendientes -------------------------------------------------------------------------------- */

export type PendingKind = "error" | "sin_entender" | "escaneado" | "memoria_vieja";

export interface PendingItem {
  id: string;
  kind: PendingKind;
  space: PiloSpaceId;
  count: number;
  /** Frase completa, lista para mostrarse. */
  label: string;
  to: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Lo pendiente en los espacios que el rol trabaja. «Sin entender» son los
 * documentos activos que Pilo leyó pero aún no entendió ni puso en el mapa.
 * Con varios espacios el texto nombra a cuál pertenece.
 */
export function pendingItems(docs: readonly DocLite[], role: PiloStaffRole | null, now: number): PendingItem[] {
  const spaces = spacesFor(role);
  const many = spaces.length > 1;
  const out: PendingItem[] = [];
  for (const space of spaces) {
    const mine = docs.filter((d) => d.space === space);
    const where = many ? ` en ${SPACE_LABELS[space]}` : "";
    const to = spaceSectionPath(space, "memoria");
    const errors = mine.filter((d) => d.status === "error").length;
    if (errors) out.push({ id: `${space}:error`, kind: "error", space, count: errors, to, label: `${plural(errors, "documento con error", "documentos con error")}${where}` });
    const pending = mine.filter((d) => d.active && (d.status === "leido" || d.status === "en_pasajes")).length;
    if (pending) out.push({ id: `${space}:sin_entender`, kind: "sin_entender", space, count: pending, to, label: `${plural(pending, "documento sin entender", "documentos sin entender")}${where}` });
    const scanned = mine.filter((d) => d.status === "escaneado").length;
    if (scanned) out.push({ id: `${space}:escaneado`, kind: "escaneado", space, count: scanned, to, label: `${plural(scanned, "documento escaneado sin texto", "documentos escaneados sin texto")}${where}` });
    const stats = spaceStats(mine, space);
    const age = daysSince(stats.lastLoadedAt, now);
    if (age !== null && age > STALE_DAYS) {
      out.push({ id: `${space}:memoria_vieja`, kind: "memoria_vieja", space, count: age, to, label: `Memoria sin novedades${where}: la última carga fue ${agoLabel(stats.lastLoadedAt, now)}` });
    }
  }
  return out;
}

/* --- Saludo ------------------------------------------------------------------------------------ */

export function greetingFor(hour: number): string {
  if (hour < 5) return "Buenas noches";
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

/** El primer nombre; si el nombre es un correo, la parte antes de la arroba. */
export function firstName(name: string): string {
  const base = name.includes("@") ? name.split("@")[0] : name;
  const word = base.trim().split(/[\s.._-]+/).filter(Boolean)[0] ?? "";
  return word ? word[0].toUpperCase() + word.slice(1) : "";
}

/** Qué cara pone Mr. Pilo: cuidado si hay errores, atento si hay pendientes, feliz si todo está al día. */
export function moodFor(items: readonly PendingItem[], loading: boolean): "feliz" | "piensa" | "cuidado" | "bien" {
  if (loading) return "piensa";
  if (items.some((i) => i.kind === "error")) return "cuidado";
  if (items.length > 0) return "bien";
  return "feliz";
}

export function roleLine(role: PiloStaffRole | null): string {
  return role ? staffRoleLabels[role] : "";
}
