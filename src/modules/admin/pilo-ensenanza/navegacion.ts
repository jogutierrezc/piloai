/* =============================================================================
   Mr. Pilo en Enseñanza · lo que se lee de la dirección, además de la pestaña.

     ?seccion=memoria&momento=mapa     la Memoria en cuatro momentos, en vez
                                       de ocho bloques apilados.
     ?seccion=pregunta&fila=cupos      las filas plegables de «Pregúntele a
                                       Pilo»: una abierta a la vez.

   Todo puro, con sus pruebas (navegacion.test.ts).
   ========================================================================== */

import type { SpaceSettings } from "./store";

/* --- Los momentos de la memoria ---------------------------------------------------------- */

export type MomentId = "alimentar" | "comprender" | "mapa" | "probar";

export const MOMENTS: { id: MomentId; label: string; lead: string }[] = [
  { id: "alimentar", label: "Alimentar", lead: "Lo que entra: las colecciones, los documentos y los cursos de Moodle." },
  { id: "comprender", label: "Comprender", lead: "Lo que Pilo entiende: el índice por significado y la comprensión con IA." },
  { id: "mapa", label: "Mapa de conexiones", lead: "Cómo se conecta lo que sabe: colecciones, documentos, temas y referencias." },
  { id: "probar", label: "Probar", lead: "Lo que encontraría ante una pregunta, y lo que ya respondió." },
];

export const DEFAULT_MOMENT: MomentId = "alimentar";

/** El momento que pide la dirección (?momento=…); uno desconocido vuelve al primero. */
export function parseMoment(value: string | null | undefined, allowed: readonly MomentId[] = MOMENTS.map((m) => m.id)): MomentId {
  const v = (value ?? "").trim().toLowerCase();
  return allowed.find((id) => id === v) ?? allowed[0] ?? DEFAULT_MOMENT;
}

/**
 * Los momentos del personal que solo carga documentos: sin «Probar», porque la
 * búsqueda de prueba y las respuestas guardadas son solo del admin (pilo_0146).
 */
export function momentsFor(limited: boolean) {
  return limited ? MOMENTS.filter((m) => m.id !== "probar") : MOMENTS;
}

/* --- Las filas de «Pregúntele a Pilo» ----------------------------------------------------- */

export type RowId = "pagina" | "conexion" | "presenta" | "roles" | "cupos" | "portales";

export const ROWS: { id: RowId; title: string }[] = [
  { id: "pagina", title: "La página" },
  { id: "conexion", title: "Conexión y voz" },
  { id: "presenta", title: "Cómo se presenta" },
  { id: "roles", title: "Cómo le habla a cada quien" },
  { id: "cupos", title: "Cupos de este Pilo" },
  { id: "portales", title: "Este Pilo en otros portales" },
];

export const DEFAULT_ROW: RowId = "pagina";

/**
 * La fila abierta que pide la dirección (?fila=…). Sin el parámetro, la
 * primera; con el parámetro vacío (?fila=), ninguna: así «todas cerradas»
 * también se puede enlazar. Una desconocida vuelve a la primera.
 */
export function parseRow(value: string | null | undefined): RowId | null {
  if (value === null || value === undefined) return DEFAULT_ROW;
  const v = value.trim().toLowerCase();
  if (v === "") return null;
  return ROWS.find((r) => r.id === v)?.id ?? DEFAULT_ROW;
}

/** Qué columnas de la ficha cambia cada fila. «Conexión y voz» no guarda nada aquí. "on" es del panel de Pilo. */
const ROW_FIELDS: Record<RowId, (keyof SpaceSettings)[]> = {
  pagina: ["aud", "welcome", "ai"],
  conexion: [],
  presenta: ["intro", "focus", "greeting"],
  roles: ["ask_rol", "roles"],
  cupos: ["daily_limit", "visitor_limit", "visitor_window_seconds"],
  portales: ["widget_on", "widget_origins"],
};

/** Las filas con cambios sin guardar: cada una lleva su punto, además del de la pestaña. */
export function dirtyRows(now: SpaceSettings, saved: SpaceSettings): RowId[] {
  return ROWS.map((r) => r.id).filter((id) => ROW_FIELDS[id].some((f) => JSON.stringify(now[f]) !== JSON.stringify(saved[f])));
}
