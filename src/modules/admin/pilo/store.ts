/* =============================================================================
   Mr. Pilo con IA · lectura y escritura de la configuración (0089).

   La fila de pilo_ai_settings la lee y la cambia solo la administración (RLS).
   Las claves no se leen nunca: se guardan con pilo_ai_set_key y de ellas solo
   vuelven los cuatro últimos caracteres.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase, readFunctionError } from "../../../lib/supabase";
import { describeDatabaseError } from "../../../data/errors";
import type { DatabaseError } from "../../../data/errors";
import type { Fn, Portal, PortalRule } from "../../../components/pilo/ai/config";
import type { ReportKind, VoiceStyle } from "../../../components/pilo/ai/logic";
import type { MemorySource } from "./memory";
import { DEFAULT_VOICE_PATTERNS } from "../../../components/pilo/ai/voice-expressions";
import { mergeSourceFlags } from "./portals";
import { DEFAULT_SPACE, readInSpace, spaceKey } from "./space";
import type { PiloSpace } from "./space";

export type Provider = "mistral" | "freeai" | "nvidia" | "otro";
export type SpeechProvider = "freeai" | "nvidia" | "fishaudio" | "otro" | "navegador";

/** Cómo va la persona de Pilo al modelo (0110): con rol system, dentro del primer mensaje, o lo uno y lo otro según responda el proveedor. */
export type SystemRole = "auto" | "system" | "user";

/**
 * Los ajustes de «preguntar» (0110): partida y margen, los mismos de la
 * restricción pilo_ai_settings_ask de la base. Fuera de margen, la base rechaza
 * el guardado entero.
 */
export const ASK_LIMITS = {
  ask_temperature: { def: 0.3, min: 0, max: 1, whole: false },
  ask_max_tokens: { def: 800, min: 100, max: 2000, whole: true },
  ask_context_tokens: { def: 3500, min: 800, max: 8000, whole: true },
  ask_history_turns: { def: 6, min: 0, max: 6, whole: true },
  voice_daily_limit: { def: 1500, min: 0, max: 100000, whole: true },
  visitor_limit: { def: 20, min: 0, max: 1000, whole: true },
  visitor_window_seconds: { def: 600, min: 30, max: 86400, whole: true },
} as const;

export type AskLimitKey = keyof typeof ASK_LIMITS;

/** El valor dentro del margen (y entero si hace falta); lo que no es número vuelve a la partida. */
export function clampAsk(key: AskLimitKey, value: unknown): number {
  const { def, min, max, whole } = ASK_LIMITS[key];
  const n = value === null || value === undefined || value === "" ? NaN : Number(value);
  if (!Number.isFinite(n)) return def;
  const v = Math.min(max, Math.max(min, n));
  return whole ? Math.round(v) : v;
}

export interface PiloSettings {
  enabled: boolean;
  provider: Provider;
  base_url: string;
  chat_path: string;
  text_model: string;
  speech_provider: SpeechProvider;
  speech_base_url: string;
  speech_path: string;
  speech_model: string;
  speech_voice: string;
  voice_engine: "proveedor" | "navegador";
  voice_rate: number;
  voice_pitch: number;
  /** Voz de NVIDIA (0101): el function-id de Magpie TTS Zeroshot, el idioma, la calidad y las muestras. */
  speech_function_id: string;
  voice_language: string;
  voice_quality: number;
  voice_styles: VoiceStyle[];
  voice_style: string;
  voice_portal_styles: Partial<Record<Portal, string>>;
  /** Fish Audio (0102): el modelo (s2.1-pro-free es el gratuito). */
  fish_model: string;
  functions: Record<Fn, boolean>;
  portals: Record<Portal, PortalRule>;
  daily_limit: number;
  max_rows: number;
  cache_days: number;
  updated_at?: string;
  /** Pregúntele a Pilo (0094): qué fuentes usa su memoria y si muestra la bienvenida. */
  memory_sources: Record<MemorySource, boolean>;
  pregunta_welcome: boolean;
  memory_indexed_at?: string | null;
  /** Informes de Impacto con Pilo (0100): a quién más, además de la administración, se abren. */
  impacto_report: Record<ReportKind, boolean>;
  /** Expresiones emocionales y microexpresiones orales (0106). */
  voice_expressions: boolean;
  voice_modulation: boolean;
  voice_patterns: Record<string, string[]>;
  /** La base aún no tiene la migración 0106 (expresiones orales de voz). */
  needs0106?: boolean;
  /** Búsqueda por significado (0109): otro modelo de embeddings; vacío, el de partida del proveedor. */
  embed_model: string;
  /** La base aún no tiene la migración 0109 (Pilo aprende). */
  needs0109?: boolean;
  /** Pregúntele a Pilo con IA siempre (0110): cómo redacta, la voz aparte y el límite por visitante. */
  ask_temperature: number;
  ask_max_tokens: number;
  ask_context_tokens: number;
  ask_history_turns: number;
  system_role: SystemRole;
  ask_stream: boolean;
  voice_daily_limit: number;
  visitor_limit: number;
  visitor_window_seconds: number;
  /** La base aún no tiene la migración 0110 (IA siempre, streaming y límite por visitante). */
  needs0110?: boolean;
  /** El chat emergente en otros portales (0111): si se permite y en qué portales (por origen). */
  widget_on: boolean;
  widget_origins: string[];
  /** La base aún no tiene la migración 0111 (Pilo en otros portales). */
  needs0111?: boolean;
  /** La base aún no tiene la migración 0100 (informes de Impacto). */
  needs0100?: boolean;
  /** La base aún no tiene la migración 0101 (voz de NVIDIA). */
  needs0101?: boolean;
  /** La base aún no tiene la migración 0102 (voz de Fish Audio). */
  needs0102?: boolean;
  /** La base aún no tiene la migración 0090 (Mistral y voz aparte). */
  needs0090?: boolean;
  /** La base aún no tiene la migración 0094 (Pregúntele a Pilo). */
  needs0094?: boolean;
}

const DEFAULT_PORTALS: Record<Portal, PortalRule> = {
  cifras: { on: true, aud: "admin", fns: ["leer", "resumir", "sintetizar", "explicar"] },
  pdi: { on: false, aud: "admin", fns: ["leer", "resumir"] },
  observatorio: { on: false, aud: "admin", fns: ["leer", "resumir"] },
  impacto: { on: false, aud: "admin", fns: ["leer", "sintetizar", "explicar"] },
  pregunta: { on: false, aud: "publico", fns: ["preguntar"] },
};

const ALL_SOURCES: Record<MemorySource, boolean> = { cifras: true, boletines: true, pdi: true, observatorio: true, impacto: true };

/** Un nombre de modelo, no una ruta pegada por error («/tts-1»). */
const validModel = (m: string) => (/^[\w.:-][\w.:/-]*$/.test(m) && !/^https?:/.test(m) ? m : "");

/**
 * La fila tal como venga, con valores por defecto para lo que falte: así una
 * base con una versión anterior de la migración no rompe la pantalla.
 */
export function normalizeSettings(raw: Record<string, unknown>): PiloSettings {
  const str = (k: string, d: string) => (typeof raw[k] === "string" ? (raw[k] as string) : d);
  const num = (k: string, d: number) => (raw[k] === null || raw[k] === undefined || raw[k] === "" ? d : Number(raw[k]));
  const provider = (["mistral", "freeai", "nvidia", "otro"] as const).find((p) => p === raw.provider) ?? "mistral";
  const portals = { ...DEFAULT_PORTALS, ...((raw.portals as Record<Portal, PortalRule>) ?? {}) };
  return {
    enabled: Boolean(raw.enabled),
    provider,
    // Vacíos con Mistral: se muestran (y se usan en el servidor) los de Mistral,
    // no un texto de ejemplo que parece escrito y no lo está.
    base_url: str("base_url", "") || PROVIDERS[provider].base,
    chat_path: str("chat_path", "") || "/chat/completions",
    text_model: validModel(str("text_model", "")) || PROVIDERS[provider].model,
    speech_provider: (["freeai", "nvidia", "fishaudio", "otro", "navegador"] as const).find((p) => p === raw.speech_provider) ?? "navegador",
    speech_base_url: str("speech_base_url", ""),
    speech_path: str("speech_path", "/audio/speech"),
    speech_model: str("speech_model", ""),
    speech_voice: str("speech_voice", ""),
    voice_engine: raw.voice_engine === "proveedor" ? "proveedor" : "navegador",
    voice_rate: num("voice_rate", 1),
    voice_pitch: num("voice_pitch", 1),
    speech_function_id: str("speech_function_id", ""),
    voice_language: str("voice_language", "") || "es-US",
    voice_quality: num("voice_quality", 20),
    voice_styles: Array.isArray(raw.voice_styles) ? (raw.voice_styles as VoiceStyle[]) : [],
    voice_style: str("voice_style", ""),
    voice_portal_styles: (raw.voice_portal_styles as Partial<Record<Portal, string>>) ?? {},
    fish_model: str("fish_model", "") || "s2.1-pro-free",
    functions: { leer: true, resumir: true, sintetizar: true, explicar: true, preguntar: true, ...((raw.functions as Partial<Record<Fn, boolean>>) ?? {}) } as Record<Fn, boolean>,
    portals,
    daily_limit: num("daily_limit", 200),
    max_rows: num("max_rows", 500),
    cache_days: num("cache_days", 30),
    updated_at: str("updated_at", ""),
    memory_sources: { ...ALL_SOURCES, ...((raw.memory_sources as Partial<Record<MemorySource, boolean>>) ?? {}) },
    pregunta_welcome: raw.pregunta_welcome === undefined ? true : Boolean(raw.pregunta_welcome),
    memory_indexed_at: (raw.memory_indexed_at as string | null | undefined) ?? null,
    impacto_report: (() => {
      const r = (raw.impacto_report ?? {}) as Partial<Record<ReportKind, unknown>>;
      return { programa: r.programa === true, facultad: r.facultad === true, vicerrectoria: r.vicerrectoria === true };
    })(),
    voice_expressions: raw.voice_expressions === undefined ? true : Boolean(raw.voice_expressions),
    voice_modulation: raw.voice_modulation === undefined ? true : Boolean(raw.voice_modulation),
    voice_patterns: (raw.voice_patterns && typeof raw.voice_patterns === "object" ? raw.voice_patterns : DEFAULT_VOICE_PATTERNS) as Record<string, string[]>,
    needs0106: !("voice_expressions" in raw),
    embed_model: typeof raw.embed_model === "string" ? raw.embed_model : "",
    needs0109: !("embed_model" in raw),
    ask_temperature: clampAsk("ask_temperature", raw.ask_temperature),
    ask_max_tokens: clampAsk("ask_max_tokens", raw.ask_max_tokens),
    ask_context_tokens: clampAsk("ask_context_tokens", raw.ask_context_tokens),
    ask_history_turns: clampAsk("ask_history_turns", raw.ask_history_turns),
    system_role: (["auto", "system", "user"] as const).find((r) => r === raw.system_role) ?? "auto",
    ask_stream: raw.ask_stream === undefined ? true : Boolean(raw.ask_stream),
    voice_daily_limit: clampAsk("voice_daily_limit", raw.voice_daily_limit),
    visitor_limit: clampAsk("visitor_limit", raw.visitor_limit),
    visitor_window_seconds: clampAsk("visitor_window_seconds", raw.visitor_window_seconds),
    needs0110: !("ask_max_tokens" in raw),
    widget_on: raw.widget_on === true,
    widget_origins: Array.isArray(raw.widget_origins) ? raw.widget_origins.filter((o): o is string => typeof o === "string") : [],
    needs0111: !("widget_on" in raw),
    needs0100: !("impacto_report" in raw),
    needs0101: !("voice_styles" in raw),
    needs0102: !("fish_model" in raw),
    needs0090: !("provider" in raw),
    needs0094: !("memory_sources" in raw),
  };
}

export type KeySlot = "mistral" | "freeai" | "nvidia" | "fishaudio" | "otro" | "voz";

export interface KeyStatus {
  /** Una por proveedor (0091). Sin 0091, no viene. */
  keys?: Partial<Record<KeySlot, { has: boolean; last4: string }>>;
  has_key: boolean;
  last4: string;
  has_speech_key: boolean;
  speech_last4: string;
  updated_at: string | null;
  /** Pedidos de texto de hoy. Con 0110 no incluye la voz; antes sí. */
  today: number;
  /** Lecturas con la voz del servicio de hoy (0110). Sin 0110, no viene. */
  today_voice?: number;
}

export interface LogRow {
  id: number;
  created_at: string;
  portal: string;
  action: string;
  subject: string;
  status: string;
  cached: boolean;
  ms: number | null;
  /** A qué Pilo fue el pedido y para quién (0113). Sin 0113, no vienen. */
  space?: string;
  rol?: string;
}

/** Valores de partida de cada proveedor de texto. La dirección y el modelo se pueden cambiar. */
export const PROVIDERS: Record<Provider, { label: string; base: string; model: string; hint: string }> = {
  mistral: {
    label: "Mistral",
    base: "https://api.mistral.ai/v1",
    model: "mistral-small-latest",
    hint: "Pegue su clave de console.mistral.ai. Todo lo demás ya está puesto.",
  },
  freeai: {
    label: "Free.ai",
    base: "https://api.free.ai",
    model: "qwen7b",
    hint: "Pegue su clave de free.ai (empieza por «sk-free-»). Todo lo demás ya está puesto.",
  },
  nvidia: {
    label: "NVIDIA",
    base: "https://integrate.api.nvidia.com/v1",
    model: "google/gemma-4-31b-it",
    hint: "Pegue su clave de build.nvidia.com (empieza por «nvapi-»). Todo lo demás ya está puesto; el modelo se cambia en opciones avanzadas.",
  },
  otro: { label: "Otro compatible", base: "", model: "", hint: "Cualquier servicio con el formato de OpenAI: escriba su dirección, el modelo y la ruta." },
};

export const pilokeys = {
  settings: ["pilo-ia", "ajustes"] as const,
  keys: ["pilo-ia", "claves"] as const,
  log: ["pilo-ia", "bitacora"] as const,
};

function fail(error: DatabaseError | null) {
  if (error) throw describeDatabaseError(error);
}

/** `enabled` en falso: el personal que RLS no deja leer la ficha ni la pide. */
export function usePiloSettings(enabled = true) {
  return useQuery({
    queryKey: pilokeys.settings,
    enabled,
    queryFn: async (): Promise<PiloSettings | null> => {
      const { data, error } = await supabase.from("pilo_ai_settings").select("*").eq("id", 1).maybeSingle();
      if (error && ["PGRST205", "42P01"].includes(error.code ?? "")) return null;
      fail(error);
      if (!data) return null;
      return normalizeSettings(data as Record<string, unknown>);
    },
  });
}

export function useKeyStatus(enabled = true) {
  return useQuery({
    queryKey: pilokeys.keys,
    enabled,
    queryFn: async (): Promise<KeyStatus | null> => {
      const { data, error } = await supabase.rpc("pilo_ai_key_status");
      if (error) return null;
      return data as KeyStatus;
    },
  });
}

/** Los últimos pedidos de un espacio (0113): la bitácora de un Pilo no trae los del otro. */
export async function fetchPiloLog(space: PiloSpace = DEFAULT_SPACE, limit = 20): Promise<LogRow[]> {
  const { data, error } = await readInSpace(space, (scoped) => {
    const query = supabase.from("pilo_ai_log").select("*");
    return (scoped ? query.eq("space", space) : query).order("created_at", { ascending: false }).limit(limit);
  });
  if (error) return [];
  return (data ?? []) as LogRow[];
}

export function usePiloLog(space: PiloSpace = DEFAULT_SPACE) {
  return useQuery({
    queryKey: [...pilokeys.log, ...spaceKey(space)],
    queryFn: () => fetchPiloLog(space),
  });
}

export function useSavePiloSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (settings: PiloSettings) => {
      const { updated_at: _ignored, needs0090, needs0094, needs0100, needs0101, needs0102, needs0106, needs0109, needs0110, needs0111, memory_indexed_at: _indexed, ...all } = settings;
      // Sin 0090 no existen las columnas nuevas: no se mandan.
      const rest: Record<string, unknown> = { ...all };
      if (needs0090) for (const k of ["provider", "speech_provider", "speech_base_url"]) delete rest[k];
      // Sin 0094, tampoco las de Pregúntele a Pilo.
      if (needs0094) for (const k of ["memory_sources", "pregunta_welcome"]) delete rest[k];
      // Sin 0100, tampoco el interruptor de los informes de Impacto.
      if (needs0100) delete rest.impacto_report;
      // Sin 0101, tampoco la voz de NVIDIA.
      if (needs0101) {
        for (const k of ["speech_function_id", "voice_language", "voice_quality", "voice_styles", "voice_style", "voice_portal_styles"]) delete rest[k];
        if (rest.speech_provider === "nvidia") rest.speech_provider = "navegador";
      }
      // Sin 0102, tampoco Fish Audio.
      if (needs0102) {
        delete rest.fish_model;
        if (rest.speech_provider === "fishaudio") rest.speech_provider = "navegador";
      }
      // Sin 0109, tampoco el modelo de embeddings.
      if (needs0109) delete rest.embed_model;
      // Sin 0110, tampoco los ajustes de «preguntar», el cupo de la voz ni el límite por visitante.
      if (needs0110) for (const k of [...Object.keys(ASK_LIMITS), "system_role", "ask_stream"]) delete rest[k];
      // Sin 0111, tampoco el chat emergente en otros portales.
      if (needs0111) for (const k of ["widget_on", "widget_origins"]) delete rest[k];
      // Sin 0106, tampoco las expresiones de voz.
      if (needs0106) {
        delete rest.voice_expressions;
        delete rest.voice_modulation;
        delete rest.voice_patterns;
      }
      // Los interruptores de «Fuentes» son el espejo de la matriz (0121): solo se guardan los que esta
      // pestaña movió, sobre lo que la base tiene ahora. Así una pestaña vieja no devuelve una celda
      // que otra acaba de cambiar en «Qué lee cada portal».
      if (rest.memory_sources) {
        const loaded = client.getQueryData<PiloSettings | null>(pilokeys.settings)?.memory_sources as Record<string, boolean> | undefined;
        const edited = rest.memory_sources as Record<string, boolean>;
        const touched = !loaded || Object.keys(edited).some((k) => edited[k] !== loaded[k]);
        if (!touched) delete rest.memory_sources;
        else if (loaded) {
          const { data: now } = await supabase.from("pilo_ai_settings").select("memory_sources").eq("id", 1).maybeSingle();
          rest.memory_sources = mergeSourceFlags(edited, loaded, (now as { memory_sources?: unknown } | null)?.memory_sources) ?? edited;
        }
      }
      const { data: user } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("pilo_ai_settings")
        .update({ ...rest, updated_by: user.user?.id ?? null, updated_at: new Date().toISOString() })
        .eq("id", 1);
      fail(error);
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["pilo-ia"] });
    },
  });
}

/* --- Probar la conexión ------------------------------------------------------------------------ */

/** Lo que dice la prueba (0110). Una función anterior solo devuelve ok y ms: lo demás queda sin decir. */
export interface ProbeResult {
  ok: boolean;
  ms?: number;
  error?: string;
  /** «system»: el proveedor aceptó el rol; «user»: lo rechazó y la persona va dentro del primer mensaje. */
  system_role?: "system" | "user";
  /** «sse»: llega por partes; «json»: el proveedor responde entero; «error»: falló. */
  stream?: "sse" | "json" | "error";
  stream_error?: string;
  /** El modelo manda razonamiento aparte (puede comerse el tope de la respuesta). */
  reasoning?: boolean;
  finish?: string;
}

/** Lee la respuesta de la prueba sin fiarse de su forma: cada campo, solo si trae un valor conocido. */
export function parseProbe(raw: unknown): ProbeResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: ProbeResult = { ok: r.ok === true };
  if (typeof r.ms === "number") out.ms = r.ms;
  if (typeof r.error === "string") out.error = r.error;
  if (r.system_role === "system" || r.system_role === "user") out.system_role = r.system_role;
  if (r.stream === "sse" || r.stream === "json" || r.stream === "error") out.stream = r.stream;
  if (typeof r.stream_error === "string") out.stream_error = r.stream_error;
  if (typeof r.reasoning === "boolean") out.reasoning = r.reasoning;
  if (typeof r.finish === "string") out.finish = r.finish;
  return out;
}

/** «Probar conexión»: la misma llamada de siempre, pero conservando los campos nuevos. */
export async function probeConnection(): Promise<ProbeResult> {
  const { data, error } = await supabase.functions.invoke<unknown>("pilo-ia", { body: { action: "probar" } });
  if (error) throw new Error((await readFunctionError(error)) ?? "No pude hablar con Mr. Pilo ahora.");
  return parseProbe(data);
}

export function useSetKey() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, which }: { key: string; which: KeySlot | "texto" }) => {
      const { data, error } = await supabase.rpc("pilo_ai_set_key", { p_key: key, p_which: which });
      fail(error);
      return data as string;
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ["pilo-ia"] });
    },
  });
}
