/* =============================================================================
   Acceso del personal de Pilo: la lógica pura.

   Aquí viven las decisiones que no necesitan React ni la base: si una guarda
   deja pasar, a dónde vuelve quien acaba de iniciar sesión, qué entradas tiene
   el menú de cada rol y qué se le dice a quien no alcanza una pantalla. Lo que
   dice cada rol sigue siendo del contrato (pilo-staff.ts); esto solo lo usa.
   La autorización real está en las políticas RLS: nada de esto protege datos.
   ========================================================================== */

import { canUseArea, canWorkInSpace, spacesFor, staffRoleDescriptions, staffRoleLabels } from "./pilo-staff";
import type { PiloSpaceId, PiloStaffRole, StaffArea } from "./pilo-staff";

/** El panel de la administración de Pilo. */
export const STAFF_HOME = "/admin";

export type GuardDecision = "wait" | "login" | "forbidden" | "allow";

/**
 * Qué hace una guarda de ruta. Mientras se resuelve la sesión espera (así no
 * parpadea «sin permiso»); sin sesión manda al acceso; con sesión pero sin la
 * zona —o sin el espacio— manda a «sin permiso».
 */
export function guardDecision(input: {
  loading: boolean;
  signedIn: boolean;
  role: PiloStaffRole | null;
  area: StaffArea;
  space?: PiloSpaceId;
}): GuardDecision {
  if (input.loading) return "wait";
  if (!input.signedIn) return "login";
  if (!canUseArea(input.role, input.area)) return "forbidden";
  if (input.space && !canWorkInSpace(input.role, input.space)) return "forbidden";
  return "allow";
}

/**
 * A dónde llevar a quien acaba de iniciar sesión: a la pantalla interna de la
 * que venía, o al panel. Una dirección externa, el propio login, «sin permiso»
 * o la portada no valen como destino.
 */
export function safeReturnPath(from: unknown, home: string = STAFF_HOME): string {
  if (typeof from !== "string" || !from.startsWith("/") || from.startsWith("//")) return home;
  const path = from.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/" || path === "/acceso-intranet" || path === "/sin-permiso") return home;
  return from;
}

/** Lo que se le explica a quien llegó a una pantalla que su rol no abre. */
export function forbiddenMessage(role: PiloStaffRole | null): string {
  if (!role) {
    return "Tu cuenta no pertenece al personal de Pilo. Pide a un administrador que te dé de alta.";
  }
  return `Tu rol es «${staffRoleLabels[role]}»: ${staffRoleDescriptions[role]} Esta pantalla no está entre sus zonas. Pide a un administrador que lo cambie si lo necesitas.`;
}

/* --- El menú -------------------------------------------------------------------------------- */

export type NavGroupId = "trabajo" | "pilo" | "administracion";

/** Una entrada del menú, sin ícono: el ícono es cosa de la interfaz. */
export interface StaffNavEntry {
  id: string;
  label: string;
  /** Dirección completa, con su `?seccion=` si lleva. */
  to: string;
  area: StaffArea;
  group: NavGroupId;
  space?: PiloSpaceId;
}

export const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  trabajo: "Trabajo",
  pilo: "Pilo",
  administracion: "Administración",
};

export const SPACE_LABELS: Record<PiloSpaceId, string> = {
  planeacion: "Pilo Universidad",
  ensenanza: "Pilo Enseñanza",
};

/** La pantalla de configuración de cada Pilo. */
export const SPACE_PATHS: Record<PiloSpaceId, string> = {
  planeacion: "/admin/mr-pilo",
  ensenanza: "/admin/mr-pilo-ensenanza",
};

/** Dirección de una sección de la pantalla de un espacio. */
export function spaceSectionPath(space: PiloSpaceId, section: string): string {
  return `${SPACE_PATHS[space]}?seccion=${section}`;
}

/**
 * El espacio al que apuntan las entradas que no distinguen espacio (catálogo,
 * memoria): Pilo Universidad si el rol lo trabaja; si no, el primero que tenga.
 */
export function primarySpace(role: PiloStaffRole | null): PiloSpaceId | null {
  const spaces = spacesFor(role);
  return spaces.includes("planeacion") ? "planeacion" : spaces[0] ?? null;
}

/**
 * El menú completo de un rol, ya filtrado: cada entrada aparece solo si el rol
 * abre su zona. «Documentos» se abre en una entrada por espacio permitido.
 */
export function buildStaffNav(role: PiloStaffRole | null): StaffNavEntry[] {
  if (!role) return [];
  const main = primarySpace(role);
  const all: StaffNavEntry[] = [
    { id: "inicio", label: "Inicio", to: STAFF_HOME, area: "inicio", group: "trabajo" },
    ...spacesFor(role).map((space): StaffNavEntry => ({
      id: `documentos-${space}`,
      label: spacesFor(role).length > 1 ? `Documentos · ${SPACE_LABELS[space]}` : "Documentos",
      to: spaceSectionPath(space, "memoria"),
      area: "documentos",
      group: "trabajo",
      space,
    })),
    ...(main
      ? [
          { id: "catalogo", label: "Catálogo", to: spaceSectionPath(main, "catalogo"), area: "catalogo", group: "trabajo", space: main },
          { id: "memoria", label: "Memoria", to: spaceSectionPath(main, "memoria"), area: "memoria", group: "trabajo", space: main },
        ] as StaffNavEntry[]
      : []),
    { id: "conexion", label: "Conexión y voz", to: spaceSectionPath("planeacion", "conexion"), area: "conexion", group: "pilo" },
    { id: "portales", label: "Dónde aparece", to: spaceSectionPath("planeacion", "portales"), area: "portales", group: "pilo" },
    { id: "usuarios", label: "Usuarios de Pilo", to: spaceSectionPath("planeacion", "usuarios"), area: "usuarios", group: "administracion" },
    { id: "emergencias", label: "Emergencias", to: spaceSectionPath("planeacion", "emergencias"), area: "emergencias", group: "administracion" },
    { id: "personal", label: "Personal", to: "/admin/personal", area: "personal", group: "administracion" },
  ];
  return all.filter((entry) => canUseArea(role, entry.area));
}

/**
 * La entrada que corresponde a la dirección actual: la que coincide en ruta y
 * en `?seccion=`; si ninguna, la primera de esa ruta. Así el menú marca bien
 * aunque la pantalla no diga en qué sección está.
 */
export function activeNavId(entries: readonly StaffNavEntry[], pathname: string, search: string): string | null {
  const seccion = new URLSearchParams(search).get("seccion");
  const clean = (p: string) => p.replace(/\/+$/, "") || "/";
  const onPath = entries.filter((e) => clean(e.to.split("?")[0]) === clean(pathname));
  if (onPath.length === 0) return null;
  const exact = onPath.find((e) => new URLSearchParams(e.to.split("?")[1] ?? "").get("seccion") === seccion && seccion !== null);
  return (exact ?? onPath[0]).id;
}

/** Dos letras para el avatar: nunca una sola, nunca tres. */
export function initials(name: string, email: string): string {
  const parts = (name || email.split("@")[0]).trim().split(/[\s.@_-]+/).filter(Boolean);
  if (parts.length === 0) return "··";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? "" : parts[0][1] ?? "";
  return (first + last).toUpperCase();
}

/** Cada cuánto, como mucho, se anota el último ingreso (pilo_staff_touch). */
export const TOUCH_EVERY_MS = 10 * 60 * 1000;

/** ¿Toca anotar el ingreso? La primera vez sí; luego, pasado el intervalo. */
export function shouldTouch(lastTouchAt: number | null, now: number, every: number = TOUCH_EVERY_MS): boolean {
  return lastTouchAt === null || now - lastTouchAt >= every;
}
