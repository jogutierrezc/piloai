/* =============================================================================
   Mr. Pilo con IA · los pedidos a la función del servidor `pilo-ia`.

   askPilo: resumir, sintetizar o explicar unas secciones.
   sayWithPilo: leer un texto con la voz avanzada del proveedor; si no se
   puede (apagada, sin cupo, sin red), con la voz del navegador, y lo dice.
   ========================================================================== */

import { supabase, readFunctionError } from "../../../lib/supabase";
import { speak, stopSpeaking } from "../voice";
import { directVoice, playPiloAudio, stopPiloAudio } from "./voice-player";
import type { AnalysisBrief, AnalysisPart, Answer, Mesh, NeedAnswer, NeedInput, ReportKind, Section, SpacePortal } from "./logic";
import type { Portal } from "./config";
import { effectiveLang, tr, trServer } from "../i18n/lang";

/** Un portal de siempre o el de otro espacio de Pilo (0113): de ahí saca el servidor el espacio. */
export type AskPortal = Portal | SpacePortal;

/** A qué Pilo se le habla y quién pregunta. Sin esto, es Pregúntele a Pilo, como siempre. */
export interface AskOptions {
  portal?: AskPortal;
  /** «estudiante» o «profesor»; cualquier otra cosa no se manda (el servidor entiende «general»). Solo cuenta en `ensenanza`. */
  rol?: string | null;
  /** El archivo adjunto (0119): su nombre y los pasajes elegidos en este dispositivo. El archivo no se sube. */
  doc?: { name: string; passages: string[] } | null;
  /** La página que la persona ve en otro portal (0127): su dirección, su título y los pasajes elegidos en su navegador. */
  page?: { url: string; title: string; passages: string[] } | null;
  /** Sin cuenta de Pilo (0120): cómo pidió que la llame y en qué tono. Con cuenta no se manda: el servidor la reconoce por la sesión. */
  visitor?: { nick?: string | null; tone?: string | null } | null;
  /** El modo secreto que la persona activó en el chat («pilocop», «pilonator» o «sayayin»): el servidor le pone el personaje a la redacción. Cualquier otra cosa no se manda. */
  modo?: string | null;
  /** El idioma en que la persona usa a Pilo; sin él, el que eligió en la pantalla (español si no eligió). */
  lang?: "es" | "en" | "pt";
}

/** Los modos secretos que entiende el servidor (logic.ts, `parseModo`). */
const modoOf = (modo: string | null | undefined): "pilocop" | "pilonator" | "sayayin" | undefined => (modo === "pilocop" || modo === "pilonator" || modo === "sayayin" ? modo : undefined);

const rolOf = (rol: string | null | undefined): "estudiante" | "profesor" | undefined => (rol === "estudiante" || rol === "profesor" ? rol : undefined);

/** Lo que viaja de un visitante: un nombre de hasta 30 caracteres y un tono conocido; sin ninguno de los dos, nada. */
function visitorOf(visitor: AskOptions["visitor"]): { nick: string; tone: "cercano" | "formal" | "directo" } | undefined {
  if (!visitor) return undefined;
  const nick = (typeof visitor.nick === "string" ? visitor.nick : "").replace(/\s+/g, " ").trim().slice(0, 30);
  const tone = visitor.tone === "cercano" || visitor.tone === "formal" || visitor.tone === "directo" ? visitor.tone : null;
  return nick || tone ? { nick, tone: tone ?? "cercano" } : undefined;
}

export type { Answer };

export interface PiloResult {
  answer: Answer;
  verified: boolean;
  unknown: string[];
  sections: string[];
  cached: boolean;
}

export class PiloError extends Error {
  constructor(
    message: string,
    readonly code: string = "",
    /** Segundos que hay que esperar antes de volver a preguntar (429). */
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

async function failure(error: unknown): Promise<PiloError> {
  const response = (error as { context?: Response })?.context;
  let code = "";
  try {
    code = ((await response?.clone().json()) as { code?: string })?.code ?? "";
  } catch {
    /* sin cuerpo */
  }
  const detail = await readFunctionError(error);
  return new PiloError(detail ? trServer(detail) : tr("No pude hablar con Mr. Pilo ahora."), code || "red");
}

export async function askPilo(action: "resumir" | "sintetizar" | "explicar", portal: Portal, page: string, sections: Section[]): Promise<PiloResult> {
  const { data, error } = await supabase.functions.invoke<PiloResult>("pilo-ia", {
    body: { action, portal, page, sections: sections.map(({ title, kind, text }) => ({ title, kind, text })) },
  });
  if (error) throw await failure(error);
  return data as PiloResult;
}

/* --- Pregúntele a Pilo ------------------------------------------------------------ */

export type AskKind = "regla" | "memoria" | "extracto" | "ia" | "nada" | "curada" | "capciosa" | "malla" | "dato";

export interface AskSource {
  n: number;
  ref: string;
  source: string;
  title: string;
  section: string;
  path: string;
  cut: string;
  office: string;
  excerpt: string;
  /** Cómo llegó, si no fue por la búsqueda de siempre: «mapa» (0115) o, de otro ámbito (0122), «visita» (lo de casa no alcanzó) o «puente» (lo trajo un puente aprobado). */
  via?: string;
  /** De otro ámbito (0122): su procedencia, como la escribió el servidor («De Pilo en Enseñanza · Políticas institucionales»). */
  from?: string;
  /** De otro ámbito: para quién fue preparado, cuando quien pregunta no es ese público. */
  written_for?: string;
}

export interface AskStep {
  step: string;
  status: "ok" | "skip" | "ai";
  detail: string;
  ms: number;
}

export interface AskResult {
  kind: AskKind;
  text: string;
  /** La respuesta analizó un archivo adjunto (0119): su nombre, cuántos pasajes leyó y cuántos datos personales se taparon. */
  file?: { name: string; passages: number; omitted: number };
  /** La respuesta leyó la página que la persona ve (0127): cuál, cuántos pasajes y cuántos datos personales se taparon. */
  page?: { url: string; title: string; passages: number; omitted: number };
  sources: AskSource[];
  trail: AskStep[];
  answerId?: number | null;
  /**
   * La pregunta como la entendió Pilo en su contexto («¿y en 2023?» → «¿Cuántos
   * matriculados hubo en Cúcuta en 2023?»). La página la manda como historia en
   * la siguiente pregunta: así el contexto se encadena.
   */
  asked?: string;
  /** La emoción de Pilo que pide el catálogo (atrevido, emocionado, loco, pensar); en otro espacio, si no hay, el ánimo de partida del rol. */
  mood?: string;
  /** Solo en otro espacio (0113): para quién se redactó, según el servidor. */
  rol?: string;
  /** Solo en otro espacio: la cara de partida del rol, cuando la respuesta no trae ánimo propio. */
  expression?: string;
  /** El tramo de la malla de la memoria que se dibuja con la respuesta (0097). */
  graph?: Mesh & { focus: string };
  verified?: boolean;
  unknown?: string[];
  /** Cómo leyó el servidor la pregunta: saludo, charla, institucional, general, vetado o capciosa. */
  intent?: AskIntent;
  /** De dónde sale lo que dice: de lo publicado, en parte, o de conocimiento general. */
  grounding?: AskGrounding;
  /** El modelo falló y se respondió con lo publicado, tal cual. */
  fallback?: string;
  /** La redacción se cortó a medias: `text` es lo que alcanzó a escribir. */
  partial?: boolean;
  notice?: string;
  /** Llegó al tope de extensión: el final puede quedar corto. */
  truncated?: boolean;
  filtered?: string[];
  finish?: string;
  usage?: { prompt?: number; completion?: number; total?: number };
  model?: string;
  /** Solo en el flujo: los pasos terminados y los segundos totales, para guardar «cómo respondí». */
  steps?: { id: string; label: string; detail?: string; ms?: number }[];
  seconds?: number;
}

export type AskIntent = "saludo" | "charla" | "institucional" | "general" | "vetado" | "capciosa";
export type AskGrounding = "oficial" | "mixta" | "general";

/** Lo que Pilo encontró antes de redactar (evento `meta` del flujo). */
export interface AskMeta {
  asked: string;
  intent?: AskIntent;
  official?: boolean;
  model?: string;
  mood?: string;
  rol?: string;
  expression?: string;
  /** Todas las fuentes que se le dieron al modelo, con el número con que las cita mientras escribe. */
  sources: AskSource[];
  trail: AskStep[];
}

/** Una etapa real del trabajo del servidor (evento `step`): empieza y, más tarde, termina. */
export interface AskThinkStep {
  id: string;
  label: string;
  detail?: string;
  state: "start" | "done";
}

export type AskEvent =
  | { type: "meta"; meta: AskMeta }
  | { type: "step"; step: AskThinkStep }
  | { type: "thinking"; text: string }
  | { type: "delta"; text: string }
  | { type: "done"; result: AskResult }
  | { type: "error"; message: string; code: string };

export interface AskHandlers {
  onMeta?: (meta: AskMeta) => void;
  /** Opcionales: una función anterior no los manda. */
  onStep?: (step: AskThinkStep) => void;
  onThinking?: (text: string) => void;
  onDelta?: (text: string) => void;
  /** Cancela el pedido: otra pregunta, salir de la página o «Detener». */
  signal?: AbortSignal;
}

/** Sin flujo: la respuesta llega entera. Se conserva para quien no necesita verla escribirse. */
export async function askQuestion(question: string, history: { q: string; a: string }[] = []): Promise<AskResult> {
  const { data, error } = await supabase.functions.invoke<AskResult>("pilo-ia", {
    body: { action: "preguntar", portal: "pregunta", question, history },
  });
  if (error) throw await failure(error);
  return data as AskResult;
}

/* --- El flujo (SSE): funciones puras, probadas en node -------------------------------- */

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * Lee un flujo `text/event-stream` por partes. Una parte puede cortar una línea
 * por la mitad o traer varios eventos; los comentarios (`: ping`) se ignoran.
 */
export function createSseParser() {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  const line = (raw: string, out: SseMessage[]) => {
    if (raw === "") {
      if (data.length) out.push({ event: event || "message", data: data.join("\n") });
      event = "";
      data = [];
      return;
    }
    if (raw.startsWith(":")) return;
    const cut = raw.indexOf(":");
    const field = cut === -1 ? raw : raw.slice(0, cut);
    const value = cut === -1 ? "" : raw.slice(cut + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  };
  return {
    push(chunk: string): SseMessage[] {
      const out: SseMessage[] = [];
      buffer += chunk;
      for (;;) {
        const at = buffer.search(/\r\n|\n|\r/);
        // Un \r al final puede ser la mitad de un \r\n: se espera a la parte siguiente.
        if (at === -1 || (buffer[at] === "\r" && at === buffer.length - 1)) break;
        const size = buffer[at] === "\r" && buffer[at + 1] === "\n" ? 2 : 1;
        line(buffer.slice(0, at), out);
        buffer = buffer.slice(at + size);
      }
      return out;
    },
    /** El flujo se cerró: lo que quedó sin su línea en blanco final también cuenta. */
    flush(): SseMessage[] {
      const out: SseMessage[] = [];
      if (buffer) line(buffer.replace(/\r$/, ""), out);
      buffer = "";
      line("", out);
      return out;
    },
  };
}

const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** El objeto final, con lo mínimo en su sitio aunque el servidor mande de menos. */
export function toAskResult(raw: unknown): AskResult | null {
  const o = raw as Partial<AskResult> | null;
  if (!o || typeof o !== "object" || typeof o.kind !== "string" || typeof o.text !== "string") return null;
  return { ...(o as AskResult), sources: list<AskSource>(o.sources), trail: list<AskStep>(o.trail) };
}

/** Un mensaje del flujo como evento de la pregunta; null si no se entiende (se ignora). */
export function toAskEvent(message: SseMessage): AskEvent | null {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(message.data);
    if (!parsed || typeof parsed !== "object") return null;
    body = parsed as Record<string, unknown>;
  } catch {
    return null;
  }
  if (message.event === "meta") {
    return {
      type: "meta",
      meta: { ...(body as unknown as AskMeta), asked: typeof body.asked === "string" ? body.asked : "", sources: list<AskSource>(body.sources), trail: list<AskStep>(body.trail) },
    };
  }
  if (message.event === "step") {
    if (typeof body.id !== "string" || !body.id.trim()) return null;
    return {
      type: "step",
      step: {
        id: body.id.trim(),
        label: typeof body.label === "string" ? body.label : "",
        ...(typeof body.detail === "string" && body.detail ? { detail: body.detail } : {}),
        state: body.state === "done" ? "done" : "start",
      },
    };
  }
  if (message.event === "thinking") return typeof body.text === "string" && body.text ? { type: "thinking", text: body.text } : null;
  if (message.event === "delta") return typeof body.text === "string" && body.text ? { type: "delta", text: body.text } : null;
  if (message.event === "done") {
    const result = toAskResult(body);
    return result ? { type: "done", result } : null;
  }
  if (message.event === "error") {
    return { type: "error", message: typeof body.message === "string" && body.message ? body.message : tr("Pilo no pudo terminar la respuesta."), code: typeof body.code === "string" ? body.code : "" };
  }
  return null;
}

const isAbort = (e: unknown) => (e as { name?: string })?.name === "AbortError";

/**
 * Consume el flujo ya decodificado: avisa `meta` y cada `delta`, y se cumple
 * con el objeto de `done`. Un evento `error`, o un flujo que se cierra sin
 * `done`, se rechaza con PiloError (lo ya escrito lo conserva quien llama).
 */
export async function consumeAskStream(chunks: AsyncIterable<string>, handlers: AskHandlers = {}): Promise<AskResult> {
  const parser = createSseParser();
  const take = (messages: SseMessage[]): AskResult | null => {
    for (const message of messages) {
      const event = toAskEvent(message);
      if (!event) continue;
      if (event.type === "meta") handlers.onMeta?.(event.meta);
      else if (event.type === "step") handlers.onStep?.(event.step);
      else if (event.type === "thinking") handlers.onThinking?.(event.text);
      else if (event.type === "delta") handlers.onDelta?.(event.text);
      else if (event.type === "done") return event.result;
      else throw new PiloError(event.message, event.code || "proveedor");
    }
    return null;
  };
  try {
    for await (const chunk of chunks) {
      if (handlers.signal?.aborted) throw new PiloError("", "cancelado");
      const result = take(parser.push(chunk));
      if (result) return result;
    }
    const result = take(parser.flush());
    if (result) return result;
  } catch (e) {
    if (e instanceof PiloError) throw e;
    if (isAbort(e) || handlers.signal?.aborted) throw new PiloError("", "cancelado");
    throw new PiloError(tr("Se cortó la conexión mientras Pilo escribía."), "cortado");
  }
  throw new PiloError(tr("La respuesta se cortó antes de terminar."), "cortado");
}

const waitText = (seconds: number) => (seconds >= 90 ? `${Math.round(seconds / 60)} min` : `${Math.max(1, Math.round(seconds))} s`);

/** `Retry-After` en segundos: puede venir como número o como fecha. */
export function retryAfterSeconds(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const n = Number(header);
  if (Number.isFinite(n)) return n > 0 ? Math.ceil(n) : undefined;
  const at = Date.parse(header);
  return Number.isFinite(at) && at > now ? Math.ceil((at - now) / 1000) : undefined;
}

/** Un estado HTTP de error como un mensaje que la persona entiende y puede seguir. */
export function askHttpError(status: number, body: unknown, retryAfter?: string | null): PiloError {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; advice?: unknown; code?: unknown; retry_after?: unknown };
  const said = typeof b.error === "string" && b.error.trim() ? b.error.trim() : "";
  const advice = typeof b.advice === "string" && b.advice.trim() ? b.advice.trim() : "";
  const code = typeof b.code === "string" ? b.code : "";
  // Otro espacio de Pilo sin su migración (0113): no es un fallo de la pregunta ni algo que se arregle reintentando.
  if (code === "migracion") {
    return new PiloError(tr("Este Pilo todavía no está instalado: a la base de datos le falta la migración 0113 de los espacios. No es un problema de su pregunta; la administración debe aplicarla."), "migracion");
  }
  if (status === 429) {
    const fromBody = Number(b.retry_after);
    const wait = Number.isFinite(fromBody) && fromBody > 0 ? Math.ceil(fromBody) : retryAfterSeconds(retryAfter);
    const base = said ? trServer(said) : tr("Va muy rápido: espere un momento antes de volver a preguntar.");
    const when = advice ? trServer(advice) : (wait ? tr("Podrá preguntar de nuevo en {v0}.", { v0: waitText(wait) }) : "");
    return new PiloError(when ? `${base} ${when}` : base, code || "limite", wait);
  }
  if (said) return new PiloError(advice ? `${said} ${advice}` : said, code || `http_${status}`);
  if (status === 401 || status === 403) return new PiloError(tr("Pregúntele a Pilo no está abierto para usted en este momento."), code || "acceso");
  if (status === 413) return new PiloError(tr("La conversación es demasiado larga para enviarla. Empiece una conversación nueva."), code || "tamano");
  if (status === 504) return new PiloError(tr("Pilo tardó demasiado en responder. Intente de nuevo en un momento."), code || "tiempo");
  if (status >= 500) return new PiloError(tr("Pilo tuvo un problema al responder. Intente de nuevo en un momento."), code || "interno");
  return new PiloError(tr("No pude hablar con Pilo ahora."), code || `http_${status}`);
}

/** Lee la respuesta de `preguntar`: un flujo o un JSON, según lo que diga su `Content-Type`. */
export async function readAskResponse(response: Response, handlers: AskHandlers = {}): Promise<AskResult> {
  const type = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!response.ok) {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      /* sin cuerpo, o no es JSON */
    }
    throw askHttpError(response.status, body, response.headers.get("retry-after"));
  }
  if (type.includes("text/event-stream") && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    async function* chunks() {
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          yield decoder.decode(value, { stream: true });
        }
        const rest = decoder.decode();
        if (rest) yield rest;
      } finally {
        reader.cancel().catch(() => undefined);
      }
    }
    return consumeAskStream(chunks(), handlers);
  }
  // Respuestas sin modelo, IA apagada o una función anterior que no conoce `stream`: JSON entero.
  let body: unknown;
  try {
    body = await response.json();
  } catch (e) {
    if (isAbort(e) || handlers.signal?.aborted) throw new PiloError("", "cancelado");
    throw new PiloError(tr("Pilo respondió algo que no pude leer. Intente de nuevo."), "formato");
  }
  const result = toAskResult(body);
  if (result) return result;
  const said = (body as { error?: unknown } | null)?.error;
  throw new PiloError(typeof said === "string" && said ? trServer(said) : tr("Pilo respondió algo que no pude leer. Intente de nuevo."), "formato");
}

/** Lo que el servidor acepta de historia (contrato §1). */
export const HISTORY_TURNS = 12;
const HISTORY_Q = 500;
const HISTORY_A = 2000;
/** El cuerpo entero no puede pasar de 48.000 caracteres: se deja margen para la pregunta. */
const HISTORY_BUDGET = 44_000;

/**
 * La historia que viaja con la pregunta: los últimos 12 turnos respondidos, del
 * más viejo al más nuevo, con lo que la persona escribió (`q`) y el texto final
 * de la respuesta (`a`), recortados a lo que el servidor acepta.
 */
export function buildHistory(turns: { q: string; a?: string | null }[]): { q: string; a: string }[] {
  const out = turns
    .filter((t) => t.q.trim() && (t.a ?? "").trim())
    .slice(-HISTORY_TURNS)
    .map((t) => ({ q: t.q.trim().slice(0, HISTORY_Q), a: (t.a as string).trim().slice(0, HISTORY_A) }));
  while (out.length && JSON.stringify(out).length > HISTORY_BUDGET) out.shift();
  return out;
}

/** El cuerpo de `preguntar` con flujo. Sin opciones es, byte a byte, el de siempre. */
export function askBody(question: string, history: { q: string; a: string }[], opts: AskOptions = {}) {
  const rol = rolOf(opts.rol);
  const visitor = visitorOf(opts.visitor);
  const modo = modoOf(opts.modo);
  const lang = opts.lang ?? effectiveLang();
  return {
    action: "preguntar" as const,
    portal: opts.portal ?? "pregunta",
    question,
    history,
    stream: true as const,
    ...(rol ? { rol } : {}),
    ...(opts.doc && opts.doc.passages.length ? { doc: opts.doc } : {}),
    ...(opts.page && opts.page.passages.length ? { page: opts.page } : {}),
    ...(visitor ? { visitor } : {}),
    ...(modo ? { modo } : {}),
    // Solo si la persona eligió inglés o portugués: sin él, el cuerpo es el de siempre.
    ...(lang !== "es" ? { lang } : {}),
  };
}

/**
 * Pregunta y ve escribirse la respuesta. Va con `fetch` directo (functions.invoke
 * no entrega el flujo por partes), con las mismas cabeceras: la clave anónima y,
 * si hay sesión, su token. Se cumple con el objeto final; avisa `meta` y cada
 * `delta` por el camino. Si el servidor responde JSON, llega entero y sin avisos.
 */
export async function askQuestionStream(question: string, history: { q: string; a: string }[] = [], handlers: AskHandlers = {}, opts: AskOptions = {}): Promise<AskResult> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key";
  let token = anonKey;
  try {
    token = (await supabase.auth.getSession()).data.session?.access_token ?? anonKey;
  } catch {
    /* sin sesión: con la clave anónima */
  }
  if (handlers.signal?.aborted) throw new PiloError("", "cancelado");
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/pilo-ia`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(askBody(question, history, opts)),
      signal: handlers.signal,
    });
  } catch (e) {
    if (isAbort(e) || handlers.signal?.aborted) throw new PiloError("", "cancelado");
    throw new PiloError(tr("No pude conectarme con Pilo. Revise su conexión a internet e intente de nuevo."), "red");
  }
  return readAskResponse(response, handlers);
}

/**
 * La lectura de una página anfitriona, para la bandeja de la administración
 * (0127). Va aparte de la pregunta y una sola vez por página: la administración
 * decide si entra a la memoria. Nunca falla hacia fuera: si algo sale mal, o
 * la página no es de un portal autorizado, responde «no» y la conversación sigue.
 */
export async function capturePage(page: { url: string; title: string; blocks: { h: boolean; t: string }[] }, portal: AskPortal = "pregunta"): Promise<string> {
  try {
    const { data, error } = await supabase.functions.invoke<{ status?: string }>("pilo-ia", { body: { action: "captura", portal, page } });
    return error ? "no" : String(data?.status ?? "no");
  } catch {
    return "no";
  }
}

/**
 * «Me sirvió» / «No me sirvió». Una respuesta guardada suma su voto; «No me
 * sirvió» en cualquier respuesta lleva la pregunta a la bandeja de Planeación
 * (0109), para que Pilo aprenda. Si falla, no pasa nada: es una opinión, no un dato.
 */
export interface RateInput extends AskOptions {
  answerId?: number | null;
  vote: "up" | "down";
  question: string;
  text: string;
  kind: AskKind;
}

/** El cuerpo de `calificar`. Sin portal ni rol es el de siempre. */
export function rateBody(input: RateInput) {
  const { answerId, vote, question, text, kind } = input;
  const rol = rolOf(input.rol);
  return { action: "calificar" as const, portal: input.portal ?? "pregunta", answerId: answerId ?? undefined, vote, question, text, kind, ...(rol ? { rol } : {}) };
}

export async function rateAnswer(input: RateInput) {
  if (!input.answerId && input.vote === "up") return;
  await supabase.functions
    .invoke("pilo-ia", { body: rateBody(input) })
    .catch(() => undefined);
}

/* --- Mr. Pilo Bot: entender la necesidad de un programa ------------------------------ */

export async function interpretNeed(need: NeedInput): Promise<NeedAnswer & { cached?: boolean }> {
  const { data, error } = await supabase.functions.invoke<NeedAnswer & { cached?: boolean }>("pilo-ia", {
    body: { action: "entender", portal: "impacto", need },
  });
  if (error) throw await failure(error);
  return data as NeedAnswer & { cached?: boolean };
}

/* --- Análisis de los datos (boletines de UDES en Cifras) ------------------------------- */

export interface AnalysisResult extends AnalysisPart {
  /** Números del texto que no están en las cifras: quedan para revisar. */
  unknown: string[];
  verified: boolean;
  model: string;
  /** La IA llegó al tope de palabras: el final puede quedar corto. */
  truncated?: boolean;
  cached?: boolean;
}

/**
 * Escribe un capítulo (o el cierre) con las cifras ya calculadas. Por defecto,
 * para los boletines de UDES en Cifras; los informes de Impacto mandan
 * `portal: "impacto"`, el nombre del documento y la unidad (`scope`).
 */
export async function analyzePart(
  input: {
    brief: AnalysisBrief;
    part: "capitulo" | "cierre";
    title: string;
    facts: string;
    pdi: boolean;
    /** Sin lo guardado: para «Volver a escribir». */
    fresh?: boolean;
    doc?: string;
    scope?: { kind: ReportKind; ref: string; campus: string | null };
  },
  portal: "cifras" | "impacto" = "cifras",
): Promise<AnalysisResult> {
  const { data, error } = await supabase.functions.invoke<AnalysisResult>("pilo-ia", {
    body: { action: "analizar", portal, analysis: input },
  });
  if (error) throw await failure(error);
  return data as AnalysisResult;
}

export async function testPilo(): Promise<{ ok: boolean; ms?: number; error?: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok: boolean; ms?: number; error?: string }>("pilo-ia", { body: { action: "probar" } });
  if (error) throw await failure(error);
  return data as { ok: boolean; ms?: number; error?: string };
}

/* --- Voz ------------------------------------------------------------------------ */

/**
 * La prueba de la configuración: pide la voz del servicio (con un estilo de
 * NVIDIA, si se dice cuál) y devuelve el audio o por qué no sonó, sin caer en
 * la del navegador.
 */
export async function cloneFishVoice(style: string): Promise<{ id: string; state: string }> {
  const { data, error } = await supabase.functions.invoke<{ id: string; state: string }>("pilo-ia", { body: { action: "voz", portal: "prueba", clone: style } });
  if (error) throw await failure(error);
  return data as { id: string; state: string };
}

export async function probeVoice(text: string, style?: string): Promise<{ audio: Blob; ms: number } | { error: string }> {
  const started = performance.now();
  const { data, error } = await supabase.functions.invoke<Blob>("pilo-ia", { body: { action: "voz", portal: "prueba", text, style } });
  if (error) return { error: (await failure(error)).message };
  if (!(data instanceof Blob) || data.size === 0) return { error: tr("El servicio de voz no devolvió audio.") };
  return { audio: data, ms: Math.round(performance.now() - started) };
}

let token = 0;

export function stopPilo() {
  token += 1;
  stopPiloAudio();
  stopSpeaking();
}

/**
 * Lee el texto y se cumple al terminar. Devuelve qué voz sonó; con otra
 * lectura de por medio (stopPilo), se cumple sin sonar.
 */
/**
 * El audio de la voz de IA, pedido una sola vez por texto: lo que se pidió por
 * adelantado (prefetchPilo) se reutiliza al leer. null si el servicio no dio audio.
 */
const audios = new Map<string, Promise<Blob | null>>();

/** Los portales de otros espacios de Pilo: su voz no va por la vía directa. */
const SPACE_VOICE: readonly string[] = ["ensenanza"];

/** La llave del audio guardado: el rol entra porque cambia el estilo de la voz. Sin rol, la de siempre. */
export function audioKey(text: string, portal: string, style?: string, rol?: string | null, tone?: string): string {
  const r = rolOf(rol);
  // La misma frase dicha con otra emoción es otro audio.
  const t = tone ? `tono:${tone}|` : "";
  return r ? `${portal}|${style ?? ""}|rol:${r}|${t}${text}` : `${portal}|${style ?? ""}|${t}${text}`;
}

/** El cuerpo de `voz`. Sin rol ni emoción es el de siempre. `tone`: la emoción de la frase («short pause,whispering»), de la lista cerrada del servidor. */
export function voiceBody(text: string, portal: string, style?: string, rol?: string | null, tone?: string) {
  const r = rolOf(rol);
  return { action: "voz" as const, portal, text, style, ...(r ? { rol: r } : {}), ...(tone ? { tone } : {}) };
}

/**
 * Por qué no sonó la voz de IA. La página sigue con la voz del navegador y no lo
 * dice; el motivo (clave, voz, cupo…) llega en el cuerpo del error y se deja en
 * la consola para quien lo busque.
 */
async function reportVoiceFault(error: unknown): Promise<void> {
  if (typeof console === "undefined") return;
  let detail = "";
  const response = (error as { context?: Response } | null)?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = (await response.clone().json()) as { error?: unknown; code?: unknown };
      detail = [body.code, body.error].filter((v) => typeof v === "string" && v).join(" · ");
    } catch {
      detail = "";
    }
  }
  console.warn(`[Pilo] La voz de IA no sonó (${response?.status ?? "sin respuesta"}). ${detail || (error instanceof Error ? error.message : "")}`.trim());
}

function audioFor(text: string, portal: AskPortal, style?: string, rol?: string | null, tone?: string): Promise<Blob | null> {
  const key = audioKey(text, portal, style, rol, tone);
  const known = audios.get(key);
  if (known) return known;
  const usual = () =>
    supabase.functions
      .invoke<Blob>("pilo-ia", { body: voiceBody(text, portal, style, rol, tone) })
      .then(async ({ data, error }) => {
        if (!error && data instanceof Blob && data.size > 0) return data;
        if (error) await reportVoiceFault(error);
        return null;
      })
      .catch(() => null);
  // Primero la vía directa (Vercel), que responde antes; si no está o tropieza, la de siempre.
  // Un estilo pedido a propósito (la prueba de la configuración) solo lo sabe dar la de siempre.
  // Otro espacio de Pilo tampoco va por la directa: esa no sabe de su cupo, su bitácora ni la voz de cada rol.
  // Una frase de un modo secreto («modo:pilonator») también: solo la función sabe qué estilo del sistema se llama como el modo.
  const viaFunction = Boolean(style) || SPACE_VOICE.includes(portal) || /(?:^|,)modo:/.test(tone ?? "");
  const asked = (viaFunction ? usual() : directVoice(text, tone).then((blob) => blob ?? usual()))
    .then((blob) => {
      // Lo que falló se puede volver a pedir más tarde.
      if (!blob) audios.delete(key);
      return blob;
    });
  audios.set(key, asked);
  // Solo las últimas: una conversación larga no llena la memoria.
  if (audios.size > 40) audios.delete(audios.keys().next().value as string);
  return asked;
}

/**
 * Pide por adelantado el audio de las frases que vienen, para que suenen sin
 * pausas entre una y otra. Pocas a la vez: cada una gasta del cupo del servicio.
 */
export function prefetchPilo(texts: string[], options: { portal: AskPortal | null; advanced: boolean; style?: string; rol?: string | null; tone?: string }) {
  if (!options.advanced || !options.portal) return;
  for (const text of texts) if (text.trim()) void audioFor(text, options.portal, options.style, options.rol, options.tone);
}

/**
 * El audio de la voz oficial de un texto, sin reproducirlo: el mismo pedido y
 * la misma caché que usan prefetchPilo y sayWithPilo. null si la voz no está
 * disponible. Lo usa quien no admite otra voz que la oficial (la app móvil):
 * si no hay audio, se queda con el texto.
 */
export function piloAudio(text: string, options: { portal: AskPortal | null; advanced: boolean; style?: string; rol?: string | null; tone?: string }): Promise<Blob | null> {
  if (!options.advanced || !options.portal || !text.trim()) return Promise.resolve(null);
  return audioFor(text, options.portal, options.style, options.rol, options.tone);
}

export async function sayWithPilo(
  text: string,
  options: { portal: AskPortal | null; advanced: boolean; rate?: number; pitch?: number; style?: string; rol?: string | null; tone?: string },
): Promise<"proveedor" | "navegador" | "cancelado"> {
  stopPilo();
  const mine = ++token;
  if (options.advanced && options.portal) {
    const data = await audioFor(text, options.portal, options.style, options.rol, options.tone);
    if (mine !== token) return "cancelado";
    if (data) {
      const done = await playPiloAudio(data, options.rate ?? 1);
      if (mine !== token) return "cancelado";
      if (done) return "proveedor";
    }
  }
  if (mine !== token) return "cancelado";
  await speak(text, { force: true, rate: options.rate, pitch: options.pitch });
  return mine === token ? "navegador" : "cancelado";
}
