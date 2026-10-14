/* =============================================================================
   Mr. Pilo en Enseñanza · su ficha (pilo_spaces, 0113) y lo que se lee de ella.

   El segundo Pilo no duplica la conexión, el modelo, la clave ni la voz: salen
   de «Mr. Pilo con IA» (pilo_ai_settings). Lo suyo es su fila de pilo_spaces:
   si está abierto y para quién, cómo se presenta, cómo le habla a cada rol,
   qué fuentes usa su memoria, sus cupos y el chat emergente en otros portales.

   - `normalizeSpace` lee la fila venga como venga, con los mismos márgenes
     que las restricciones de la base (pilo_spaces_len, _limits, _widget, _aud):
     lo que se sale de margen no llega a guardarse y la base no rechaza nada.
   - Sin la migración 0113 no hay tabla: `useSpace` devuelve `missing` y la
     pantalla se pinta con los valores de partida y los controles apagados.
   - El uso de hoy sale de `pilo_space_usage(p_space)`; la bitácora, de
     pilo_ai_log filtrada por espacio, día y rol.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { describeDatabaseError } from "../../../data/errors";
import type { PiloExpression } from "../../../components/pilo/PiloFace";
import type { ExpressionMood } from "../../../components/pilo/ai/voice-expressions";
import type { EXAMPLES } from "../pilo/catalog-sheet";
import type { CatalogKind } from "../pilo/catalog-sheet";
import { mergeSourceFlags } from "../pilo/portals";
import type { LogRow } from "../pilo/store";
import type { PiloSpace } from "../pilo/space";
import type { StaffArea } from "../../../lib/pilo-staff";
import { leerAttr } from "../../pilo-embed/embed";
import type { LeerModo } from "../../pilo-embed/embed";

/** El espacio de esta pantalla. */
export const SPACE: PiloSpace = "ensenanza";

export type Audience = "admin" | "sesion" | "publico";
export type RolId = "estudiante" | "profesor";
export const ROLES: { id: RolId; label: string; plural: string }[] = [
  { id: "estudiante", label: "Estudiante", plural: "estudiantes" },
  { id: "profesor", label: "Profesor", plural: "profesores" },
];

/** Las caras aprobadas por la universidad (PiloFace). Nunca otra mascota. */
export const EXPRESSIONS: { id: PiloExpression; label: string }[] = [
  { id: "feliz", label: "Feliz" },
  { id: "emocionado", label: "Emocionado" },
  { id: "graduado", label: "Graduado" },
  { id: "pensar", label: "Pensando" },
  { id: "atrevido", label: "Atrevido" },
  { id: "neutral", label: "Sereno" },
  { id: "loco", label: "Juguetón" },
  { id: "obra", label: "En obra" },
];

/** Los ánimos de la voz (voice-expressions): con cuál empieza a hablar. */
export const ORAL_MOODS: { id: ExpressionMood; label: string; note: string }[] = [
  { id: "emocionado", label: "Emocionado", note: "Con energía: «¡Qué buena pregunta!»" },
  { id: "atento", label: "Atento", note: "Sereno y preciso: «Veamos lo que dice la política…»" },
  { id: "pensar", label: "Reflexivo", note: "Pausado, como quien lo piensa con usted." },
  { id: "atrevido", label: "Atrevido", note: "Con picardía. Úselo con cuidado." },
  { id: "cuidado", label: "De cuidado", note: "Más lento y grave, para temas delicados." },
];

export type SpaceSource = "innovacion" | "politicas" | "global" | "moodle";
export const SPACE_SOURCES: { id: SpaceSource; code: string; name: string; desc: string }[] = [
  { id: "innovacion", code: "IE", name: "Innovación educativa", desc: "Guías, experiencias y lineamientos de innovación en el aula" },
  { id: "politicas", code: "PO", name: "Políticas institucionales", desc: "Acuerdos, reglamentos y políticas de la universidad" },
  { id: "global", code: "GL", name: "Mirada global", desc: "Referentes nacionales e internacionales de educación" },
  { id: "moodle", code: "MO", name: "Cursos de Moodle", desc: "Lo que se lee de los cursos elegidos, por su API" },
];

export interface RoleSettings {
  /** Cómo le habla: se suma, como dato, a la instrucción fija del rol (≤ 300). */
  tone: string;
  /** Preguntas sugeridas en la página, para ese rol. */
  suggestions: string[];
  /** El id de un estilo de voz de «Mr. Pilo con IA»; vacío, el estilo general. */
  voice_style: string;
  /** La cara de partida. */
  expression: PiloExpression;
  /** El ánimo de la voz de partida. */
  mood: ExpressionMood;
}

export interface SpaceSettings {
  id: PiloSpace;
  name: string;
  on: boolean;
  aud: Audience;
  ai: boolean;
  welcome: boolean;
  intro: string;
  focus: string;
  greeting: string;
  ask_rol: boolean;
  roles: Record<RolId, RoleSettings>;
  memory_sources: Record<SpaceSource, boolean>;
  memory_indexed_at: string | null;
  daily_limit: number;
  visitor_limit: number;
  visitor_window_seconds: number;
  widget_on: boolean;
  widget_origins: string[];
  updated_at: string | null;
}

/* --- Márgenes: los mismos de la base ------------------------------------------------- */

/** pilo_spaces_len. */
export const TEXT_MAX = { name: 120, intro: 300, focus: 600, greeting: 300, tone: 300, suggestion: 140, voice_style: 80 } as const;
/** Cuántas sugeridas caben en la página por rol. */
export const MAX_SUGGESTIONS = 6;
/** pilo_spaces_widget. */
export const MAX_ORIGINS = 50;

/** pilo_spaces_limits: partida y margen de cada cupo. */
export const SPACE_LIMITS = {
  daily_limit: { def: 200, min: 0, max: 100000, whole: true },
  visitor_limit: { def: 20, min: 0, max: 1000, whole: true },
  visitor_window_seconds: { def: 600, min: 30, max: 86400, whole: true },
} as const;

export type SpaceLimitKey = keyof typeof SPACE_LIMITS;

/** El valor dentro del margen y entero; lo que no es número vuelve a la partida. */
export function clampLimit(key: SpaceLimitKey, value: unknown): number {
  const { def, min, max } = SPACE_LIMITS[key];
  const n = value === null || value === undefined || value === "" || typeof value === "boolean" ? NaN : Number(value);
  if (!Number.isFinite(n)) return def;
  return Math.round(Math.min(max, Math.max(min, n)));
}

export const DEFAULT_INTRO = "la Inteligencia Artificial de la Universidad de Santander";

const ROLE_DEFAULTS: Record<RolId, Pick<RoleSettings, "expression" | "mood">> = {
  estudiante: { expression: "feliz", mood: "emocionado" },
  profesor: { expression: "graduado", mood: "atento" },
};

const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const flag = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);

/** Un rol leído con cuidado: textos con tope, cara y ánimo solo de los aprobados. */
export function normalizeRole(id: RolId, raw: unknown): RoleSettings {
  const r = isRecord(raw) ? raw : {};
  const suggestions = (Array.isArray(r.suggestions) ? r.suggestions : [])
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX.suggestion))
    .filter(Boolean)
    .slice(0, MAX_SUGGESTIONS);
  return {
    tone: text(r.tone, TEXT_MAX.tone),
    suggestions,
    voice_style: text(r.voice_style, TEXT_MAX.voice_style).trim(),
    expression: EXPRESSIONS.find((e) => e.id === r.expression)?.id ?? ROLE_DEFAULTS[id].expression,
    mood: ORAL_MOODS.find((m) => m.id === r.mood)?.id ?? ROLE_DEFAULTS[id].mood,
  };
}

/**
 * La fila tal como venga, con los valores de partida de la migración para lo
 * que falte y cada campo dentro de su margen. Sin fila (`{}`), es la ficha
 * recién creada: cerrada y solo para la administración.
 */
export function normalizeSpace(raw: Record<string, unknown> | null | undefined, id: PiloSpace = SPACE): SpaceSettings {
  const r = raw ?? {};
  const roles = isRecord(r.roles) ? r.roles : {};
  // Como la función del servidor: una fuente cuenta solo si está marcada en `true`.
  const sources = isRecord(r.memory_sources) ? r.memory_sources : null;
  const origins = (Array.isArray(r.widget_origins) ? r.widget_origins : []).filter((o): o is string => typeof o === "string" && o.trim() !== "");
  return {
    id,
    name: text(r.name, TEXT_MAX.name) || "Mr. Pilo en Enseñanza",
    on: flag(r.on, false),
    aud: (["admin", "sesion", "publico"] as const).find((a) => a === r.aud) ?? "admin",
    ai: flag(r.ai, true),
    welcome: flag(r.welcome, true),
    intro: typeof r.intro === "string" ? r.intro.slice(0, TEXT_MAX.intro) : DEFAULT_INTRO,
    focus: text(r.focus, TEXT_MAX.focus),
    greeting: text(r.greeting, TEXT_MAX.greeting),
    ask_rol: flag(r.ask_rol, true),
    roles: { estudiante: normalizeRole("estudiante", roles.estudiante), profesor: normalizeRole("profesor", roles.profesor) },
    memory_sources: Object.fromEntries(SPACE_SOURCES.map((s) => [s.id, sources ? sources[s.id] === true : true])) as Record<SpaceSource, boolean>,
    memory_indexed_at: typeof r.memory_indexed_at === "string" ? r.memory_indexed_at : null,
    daily_limit: clampLimit("daily_limit", r.daily_limit),
    visitor_limit: clampLimit("visitor_limit", r.visitor_limit),
    visitor_window_seconds: clampLimit("visitor_window_seconds", r.visitor_window_seconds),
    widget_on: r.widget_on === true,
    widget_origins: [...new Set(origins)].slice(0, MAX_ORIGINS),
    updated_at: typeof r.updated_at === "string" ? r.updated_at : null,
  };
}

/** Lo que se manda a la base: solo columnas de pilo_spaces que esta pantalla cambia. */
export function spacePatch(s: SpaceSettings): Record<string, unknown> {
  const clean = normalizeSpace(s as unknown as Record<string, unknown>, s.id);
  const { id: _id, memory_indexed_at: _indexed, updated_at: _updated, ...columns } = clean;
  return columns;
}

/* --- Las pestañas ---------------------------------------------------------------------- */

export type TabId = "pregunta" | "memoria" | "catalogo" | "bitacora";

export const TABS: { id: TabId; label: string; title: string; lead: string }[] = [
  { id: "pregunta", label: "Pregúntele a Pilo", title: "Pregúntele a Pilo", lead: "Su página propia: si está abierta, cómo se presenta, cómo le habla a cada quien y cuánto puede usarse." },
  { id: "memoria", label: "Memoria", title: "La memoria de este Pilo", lead: "Lo que sabe de innovación educativa, políticas y mirada global, y lo que ya respondió." },
  { id: "catalogo", label: "Catálogo", title: "Catálogo de este Pilo", lead: "Sus respuestas oficiales y microexpresiones, y lo que todavía no supo responder." },
  { id: "bitacora", label: "Bitácora de uso", title: "Bitácora de uso", lead: "Cuánto se usó hoy, quién preguntó (estudiantes o profesores) y los últimos pedidos." },
];

export const DEFAULT_TAB: TabId = "pregunta";

/**
 * A qué zona del personal pertenece cada pestaña. «Pregúntele a Pilo» abre y
 * cierra la página y sus cupos (portales); la bitácora es el uso (conexión).
 * Docencia, Institucional y ambos solo ven Memoria y Catálogo.
 */
export const TAB_AREA: Record<TabId, StaffArea> = {
  pregunta: "portales",
  memoria: "memoria",
  catalogo: "catalogo",
  bitacora: "conexion",
};

/** Las pestañas que esta persona puede ver (`canUse` de useAuth()), en el orden de siempre. */
export function tabsFor(canUse: (area: StaffArea) => boolean): typeof TABS {
  return TABS.filter((t) => canUse(TAB_AREA[t.id]));
}

/**
 * La pestaña que pide la dirección (?seccion=…), solo entre las permitidas; una
 * desconocida o prohibida cae a la primera permitida y nunca se monta otra.
 */
export function parseTab(value: string | null | undefined, allowed: readonly TabId[] = TABS.map((t) => t.id)): TabId {
  const v = (value ?? "").trim().toLowerCase();
  return allowed.find((id) => id === v) ?? allowed[0] ?? DEFAULT_TAB;
}

const TAB_FIELDS: Partial<Record<TabId, (keyof SpaceSettings)[]>> = {
  pregunta: ["on", "aud", "ai", "welcome", "intro", "focus", "greeting", "ask_rol", "roles", "daily_limit", "visitor_limit", "visitor_window_seconds", "widget_on", "widget_origins"],
  memoria: ["memory_sources"],
};

/** Las pestañas con cambios sin guardar. Catálogo y Bitácora se aplican al momento: nunca. */
export function dirtyTabs(now: SpaceSettings, saved: SpaceSettings): TabId[] {
  return TABS.map((t) => t.id).filter((id) => (TAB_FIELDS[id] ?? []).some((f) => JSON.stringify(now[f]) !== JSON.stringify(saved[f])));
}

/* --- El chat emergente de este espacio --------------------------------------------- */

/** La línea que se pega en otro portal: la misma de siempre, con `data-pilo` diciendo qué Pilo es. */
/** Con `read`, la línea pide además que Pilo lea la página que lo aloja (0127): lo visible («si») o todo, también lo plegado («todo»). */
export function spaceSnippet(origin: string, space: PiloSpace, tema: string, lado: "der" | "izq", read: boolean | LeerModo = false): string {
  return `<script src="${origin.replace(/\/+$/, "")}/pilo.js" data-pilo="${space}" data-tema="${tema}" data-esquina="${lado === "izq" ? "izquierda" : "derecha"}"${leerAttr(read)} defer></script>`;
}

/* --- Leer y guardar la ficha ---------------------------------------------------------- */

export const spaceKeys = {
  row: (space: PiloSpace) => ["pilo-ia", "espacio", space, "ficha"] as const,
  usage: (space: PiloSpace) => ["pilo-ia", "espacio", space, "uso"] as const,
  log: (space: PiloSpace) => ["pilo-ia", "espacio", space, "bitacora"] as const,
  counts: (space: PiloSpace) => ["pilo-ia", "memoria", "conteo", space] as const,
};

export interface SpaceLoad {
  settings: SpaceSettings;
  /** La base aún no tiene la migración 0113 (o le falta la fila del espacio). */
  missing: boolean;
}

/** ¿El error es «esa tabla no existe»? PostgREST (PGRST205) o Postgres (42P01). */
export const tableMissing = (error: { code?: string; message?: string } | null | undefined) =>
  Boolean(error) && (error!.code === "PGRST205" || error!.code === "42P01" || /could not find the table|does not exist/i.test(error!.message ?? ""));

export async function fetchSpace(space: PiloSpace = SPACE): Promise<SpaceLoad> {
  const { data, error } = await supabase.from("pilo_spaces").select("*").eq("id", space).maybeSingle();
  if (error && tableMissing(error)) return { settings: normalizeSpace({}, space), missing: true };
  if (error) throw describeDatabaseError(error);
  if (!data) return { settings: normalizeSpace({}, space), missing: true };
  return { settings: normalizeSpace(data as Record<string, unknown>, space), missing: false };
}

export function useSpace(space: PiloSpace = SPACE) {
  return useQuery({ queryKey: spaceKeys.row(space), queryFn: () => fetchSpace(space) });
}

export function useSaveSpace(space: PiloSpace = SPACE) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (settings: SpaceSettings) => {
      const patch = spacePatch(settings);
      // Los interruptores de «Fuentes» son el espejo de la matriz (0121): solo se guardan los que esta
      // pestaña movió, sobre lo que la base tiene ahora. Así una pestaña vieja no devuelve una celda
      // que otra acaba de cambiar en «Qué lee cada portal».
      const loaded = client.getQueryData<SpaceLoad>(spaceKeys.row(space))?.settings.memory_sources as Record<string, boolean> | undefined;
      const edited = patch.memory_sources as Record<string, boolean> | undefined;
      if (edited && loaded) {
        if (!Object.keys(edited).some((k) => edited[k] !== loaded[k])) delete patch.memory_sources;
        else {
          const { data: now } = await supabase.from("pilo_spaces").select("memory_sources").eq("id", space).maybeSingle();
          patch.memory_sources = mergeSourceFlags(edited, loaded, (now as { memory_sources?: unknown } | null)?.memory_sources) ?? edited;
        }
      }
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("pilo_spaces")
        .update({ ...patch, updated_by: user.user?.id ?? null, updated_at: new Date().toISOString() } as never)
        .eq("id", space);
      if (error) throw describeDatabaseError(error);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ["pilo-ia", "espacio", space] }),
  });
}

/* --- Uso de hoy ----------------------------------------------------------------------- */

export interface SpaceUsage {
  today: number;
  limit: number;
  byRol: { estudiante: number; profesor: number; general: number };
  todayVoice: number;
}

const count = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/** Lo que devuelve pilo_space_usage: `{today, limit, by_rol:{estudiante, profesor, ''}, today_voice}`. */
export function parseUsage(raw: unknown): SpaceUsage | null {
  if (!isRecord(raw)) return null;
  const by = isRecord(raw.by_rol) ? raw.by_rol : {};
  return {
    today: count(raw.today),
    limit: count(raw.limit),
    byRol: { estudiante: count(by.estudiante), profesor: count(by.profesor), general: count(by[""]) },
    todayVoice: count(raw.today_voice),
  };
}

/** El uso de hoy del espacio. Sin 0113 (la función no existe), null. */
export function useSpaceUsage(space: PiloSpace = SPACE, enabled = true) {
  return useQuery({
    queryKey: spaceKeys.usage(space),
    enabled,
    queryFn: async (): Promise<SpaceUsage | null> => {
      const { data, error } = await supabase.rpc("pilo_space_usage", { p_space: space } as never);
      if (error) return null;
      return parseUsage(data);
    },
  });
}

/* --- Bitácora ------------------------------------------------------------------------- */

export type RolFilter = "todos" | RolId | "general";

export const ROL_FILTERS: { id: RolFilter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "estudiante", label: "Estudiantes" },
  { id: "profesor", label: "Profesores" },
  { id: "general", label: "Sin rol" },
];

/** El día «2026-10-01» como intervalo de instantes, en la hora de quien mira. Vacío o raro: null. */
export function dayRange(day: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day.trim());
  if (!m) return null;
  const start = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(start.getTime()) || start.getDate() !== Number(m[3])) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

export const LOG_PAGE = 60;

/** Los pedidos del espacio, del más reciente al más viejo, por día y por rol. Siempre filtra por espacio. */
export async function fetchSpaceLog(space: PiloSpace, filters: { day: string; rol: RolFilter }): Promise<LogRow[] | null> {
  let query = supabase.from("pilo_ai_log").select("*").eq("space", space);
  const range = dayRange(filters.day);
  if (range) query = query.gte("created_at", range.from).lt("created_at", range.to);
  if (filters.rol !== "todos") query = query.eq("rol", filters.rol === "general" ? "" : filters.rol);
  const { data, error } = await query.order("created_at", { ascending: false }).limit(LOG_PAGE);
  if (error) return null;
  return (data ?? []) as LogRow[];
}

export function useSpaceLog(space: PiloSpace, filters: { day: string; rol: RolFilter }, enabled = true) {
  return useQuery({
    queryKey: [...spaceKeys.log(space), filters.day, filters.rol],
    enabled,
    queryFn: () => fetchSpaceLog(space, filters),
    placeholderData: (previous) => previous,
  });
}

/* --- La memoria de este espacio ------------------------------------------------------- */

/** Cuántos pasajes tiene cada fuente del espacio. Sin 0113, null. */
export function useSpaceMemoryCounts(space: PiloSpace = SPACE, enabled = true) {
  return useQuery({
    queryKey: spaceKeys.counts(space),
    enabled,
    queryFn: async (): Promise<Record<SpaceSource, number> | null> => {
      const out = {} as Record<SpaceSource, number>;
      for (const s of SPACE_SOURCES) {
        const { count: n, error } = await supabase.from("pilo_memory").select("ref", { count: "exact", head: true }).eq("space", space).eq("source", s.id);
        if (error) return null;
        out[s.id] = n ?? 0;
      }
      return out;
    },
  });
}

/* --- El catálogo de este espacio: textos y ejemplos ----------------------------------- */

export const CATALOG_LEAD: Record<CatalogKind, string> = {
  respuesta:
    "Preguntas con la respuesta oficial de la universidad sobre enseñanza, políticas e innovación educativa. Cuando la pregunta se parece a la escrita o a una de sus variantes, es la base obligatoria de lo que redacta la IA. Cada entrada dice para quién es: todos, estudiantes o profesores.",
  capciosa:
    "Microexpresiones: respuestas cortas para preguntas capciosas o fuera de tema. Cuando la pregunta trae las palabras de un disparador o se le parece por significado, la IA responde con esa microexpresión como base y con la emoción elegida.",
};

/** Ejemplos de la plantilla: solo afirmaciones que valen sin importar qué se haya cargado. */
export const CATALOG_EXAMPLES: typeof EXAMPLES = {
  respuesta: [
    {
      key: "ER-001",
      question: "¿Quién es Mr. Pilo en Enseñanza?",
      variants: ["¿Qué es este asistente?", "¿Para qué sirve este Pilo?"],
      triggers: ["quien eres", "para que sirves"],
      answer: "Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander. Le ayudo con innovación educativa, políticas institucionales y una mirada global de la educación.",
      mood: "emocionado",
      rol: "",
      active: true,
    },
    {
      key: "ER-002",
      question: "¿Cómo llevo una política institucional al aula?",
      variants: ["¿Cómo aplico el reglamento en mi curso?"],
      triggers: ["llevar al aula", "aplicar la politica"],
      answer: "Empiece por el artículo que aplica a su curso, tradúzcalo en un acuerdo claro con sus estudiantes y déjelo escrito en el plan de asignatura.",
      mood: "pensar",
      rol: "profesor",
      active: true,
    },
  ],
  capciosa: [
    { key: "EC-001", tema: "Hacer la tarea", triggers: ["hazme la tarea", "resuelve mi taller", "haz mi trabajo"], answer: "La tarea es suya, pero la ruta para resolverla la armamos juntos. ¿Por dónde empezamos?", mood: "atrevido", rol: "estudiante", active: true },
    { key: "EC-002", tema: "¿Eres una IA?", triggers: ["eres una ia", "eres un robot", "eres humano"], answer: "Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander: respondo con lo que la universidad ha puesto en mi memoria.", mood: "pensar", rol: "", active: true },
  ],
};
