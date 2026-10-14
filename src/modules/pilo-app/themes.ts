/* =============================================================================
   Mr. Pilo · la app móvil · sus temas.

   Doce temas en tres grupos, elegidos en el selector y recordados por
   dispositivo. Aquí solo van sus nombres y su grupo (provisionales: se cambian
   en esta lista y en nada más); los colores viven en una sola hoja
   (pilo-app-themes.css), como variables, y la muestra de cada tema se pinta
   con ellas.
   ========================================================================== */

import { readStored, storageKey, writeStored } from "../pregunta/store";

export type AppTheme = "udes" | "dorado" | "gris" | "noche" | "salud" | "bio" | "magenta" | "social" | "purpura" | "ambar" | "turquesa" | "granate";

export type ThemeGroup = "Institucionales" | "Por facultad" | "Propuestos";

export interface ThemeInfo {
  id: AppTheme;
  /** El nombre, en español (la pantalla lo pasa por tr()). */
  label: string;
  /** Una pista corta debajo del nombre. */
  hint: string;
  group: ThemeGroup;
}

export const THEME_GROUPS: ThemeGroup[] = ["Institucionales", "Por facultad", "Propuestos"];

export const APP_THEMES: ThemeInfo[] = [
  { id: "udes", label: "Azul UDES", hint: "Azul y dorado", group: "Institucionales" },
  { id: "dorado", label: "Dorado UDES", hint: "Cálido", group: "Institucionales" },
  { id: "gris", label: "Gris claro", hint: "Limpio y neutro", group: "Institucionales" },
  { id: "noche", label: "Noche", hint: "Oscuro", group: "Institucionales" },
  { id: "salud", label: "Salud", hint: "Médicas y de la Salud", group: "Por facultad" },
  { id: "bio", label: "Bio", hint: "Agrícolas y Veterinarias", group: "Por facultad" },
  { id: "magenta", label: "Magenta", hint: "Ingenierías y Tecnologías", group: "Por facultad" },
  { id: "social", label: "Social", hint: "Ciencias Sociales", group: "Por facultad" },
  { id: "purpura", label: "Tecnológico", hint: "UDESTEC", group: "Por facultad" },
  { id: "ambar", label: "Ámbar", hint: "Propuesta", group: "Propuestos" },
  { id: "turquesa", label: "Turquesa", hint: "Propuesta", group: "Propuestos" },
  { id: "granate", label: "Granate", hint: "Propuesta", group: "Propuestos" },
];

export const DEFAULT_THEME: AppTheme = "udes";

/** Lo que la app recuerda en el dispositivo va bajo este prefijo («pilo-app:tema», «pilo-app:voz»…). */
export const APP_PREFIX = "pilo-app";

/**
 * Los cinco temas de antes y el nuevo más cercano. Quien ya había elegido uno lo conserva (no se le
 * reinicia): «udes» sigue siendo «udes»; el resto pasa al tema nuevo que más se le parece.
 *
 *   udes       → udes      (Mi UDES era el marino institucional: ahora Azul UDES)
 *   blanco     → gris      (fondo y barra claros: Gris claro)
 *   negro      → noche     (el oscuro: Noche)
 *   futurista  → purpura   (el violeta tecnológico: Tecnológico)
 *   pilo       → dorado    (el cálido de marrones y crema: Dorado UDES)
 */
const LEGACY_THEMES: ReadonlyMap<string, AppTheme> = new Map<string, AppTheme>([
  ["udes", "udes"],
  ["blanco", "gris"],
  ["negro", "noche"],
  ["futurista", "purpura"],
  ["pilo", "dorado"],
]);

/** El tema guardado; un tema de antes pasa al nuevo más cercano y cualquier otra cosa (nada, un valor desconocido) es «Azul UDES». */
export function parseTheme(value: unknown): AppTheme {
  const v = typeof value === "string" ? value.trim().toLowerCase() : "";
  return APP_THEMES.find((t) => t.id === v)?.id ?? LEGACY_THEMES.get(v) ?? DEFAULT_THEME;
}

export const readTheme = (): AppTheme => parseTheme(readStored(storageKey(APP_PREFIX, "tema")));
export const writeTheme = (theme: AppTheme) => writeStored(storageKey(APP_PREFIX, "tema"), parseTheme(theme));
