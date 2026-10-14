/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria · lo puro del recorrido.

   Un documento (o un curso de Moodle) pasa por el mismo camino:

     leer → subir → ficha → pasajes → mapa → vectores      (y, opcional, comprender)

   Cada paso puede fallar por separado. Aquí está lo que no toca la red: el
   orden de los pasos, desde dónde se retoma, qué muestra cada etapa del
   recorrido (leído → en pasajes → entendido → en el mapa), cómo se lee un error
   de la base o de la función, y cuándo se sigue pidiendo otro lote.
   ========================================================================== */

/* --- Los pasos ---------------------------------------------------------------------------- */

export type StepId = "leer" | "subir" | "ficha" | "pasajes" | "mapa" | "vectores";

export const STEP_ORDER: StepId[] = ["leer", "subir", "ficha", "pasajes", "mapa", "vectores"];

/** Lo que Pilo dice mientras hace cada paso, y cómo se nombra cuando falla. */
export const STEP_TEXT: Record<StepId, { doing: string; failed: string }> = {
  leer: { doing: "Leyendo el archivo", failed: "No se pudo leer el archivo" },
  subir: { doing: "Guardando el original", failed: "No se pudo guardar el original" },
  ficha: { doing: "Anotando el documento", failed: "No se pudo anotar el documento" },
  pasajes: { doing: "Partiéndolo en pasajes", failed: "No se guardaron los pasajes" },
  mapa: { doing: "Ubicándolo en el mapa", failed: "No se pudo ubicar en el mapa" },
  vectores: { doing: "Indexando por significado", failed: "No se terminó de indexar por significado" },
};

export type StepOutcome = { ok: true } | { ok: false; step: StepId; error: unknown };

/**
 * Corre los pasos en orden desde `from`. Un paso sin acción se salta. El
 * primero que falla detiene el recorrido y se devuelve cuál fue: lo anterior
 * queda hecho y se puede retomar desde ahí.
 */
export async function runFrom(
  from: StepId,
  actions: Partial<Record<StepId, () => Promise<void>>>,
  onStep?: (step: StepId, index: number, total: number) => void,
): Promise<StepOutcome> {
  const todo = STEP_ORDER.slice(Math.max(0, STEP_ORDER.indexOf(from))).filter((s) => actions[s]);
  for (let i = 0; i < todo.length; i++) {
    const step = todo[i];
    onStep?.(step, i, todo.length);
    try {
      await actions[step]!();
    } catch (error) {
      return { ok: false, step, error };
    }
  }
  return { ok: true };
}

/* --- El recorrido de un documento, como se ve ---------------------------------------- */

export type DocStatus = "leido" | "en_pasajes" | "entendido" | "en_mapa" | "escaneado" | "error";

export interface DocLike {
  status: DocStatus | string;
  passages: number;
  understood_at?: string | null;
  origin?: string;
  file_path?: string;
}

export type StageId = "leido" | "en_pasajes" | "entendido" | "en_mapa";
export type StageState = "done" | "run" | "fail" | "todo";

export interface Stage {
  id: StageId;
  label: string;
  state: StageState;
}

const STAGE_LABEL: Record<StageId, string> = { leido: "Leído", en_pasajes: "En pasajes", entendido: "Entendido", en_mapa: "En el mapa" };
export const STAGE_ORDER: StageId[] = ["leido", "en_pasajes", "entendido", "en_mapa"];

/** A qué etapa del recorrido pertenece cada paso (los vectores no tienen etapa propia: van con el mapa). */
const STAGE_OF_STEP: Record<StepId, StageId> = { leer: "leido", subir: "leido", ficha: "leido", pasajes: "en_pasajes", mapa: "en_mapa", vectores: "en_mapa" };

/**
 * Las cuatro etapas de un documento. `job` es lo que está pasando ahora mismo
 * en esta pantalla (un paso en curso o el que falló); sin él, sale de la ficha.
 * «Entendido» lo pone la IA al comprender: sin ella queda por hacer y el
 * documento llega igual al mapa (el básico).
 */
export function stagesOf(doc: DocLike | null, job?: { step: StepId; state: "run" | "fail" } | null): Stage[] {
  const status = doc?.status ?? "";
  const done: Record<StageId, boolean> = {
    leido: Boolean(doc) && status !== "escaneado",
    en_pasajes: Boolean(doc) && doc!.passages > 0 && status !== "leido" && status !== "escaneado",
    entendido: status === "entendido" || Boolean(doc?.understood_at),
    en_mapa: status === "en_mapa" || status === "entendido",
  };
  const now = job ? STAGE_OF_STEP[job.step] : null;
  return STAGE_ORDER.map((id) => {
    let state: StageState = done[id] ? "done" : "todo";
    // Lo que corre o falló ahora manda sobre la ficha; los vectores no deshacen «en el mapa».
    if (job && now === id && !(job.step === "vectores" && done[id])) state = job.state;
    return { id, label: STAGE_LABEL[id], state };
  });
}

/**
 * Desde qué paso se retoma un documento que quedó a medias, mirando solo su
 * ficha (sirve tras recargar la página). `null`: no le falta nada, o no se
 * puede retomar (un PDF escaneado se reemplaza, no se reintenta).
 */
export function resumePoint(doc: DocLike): StepId | null {
  if (doc.status === "escaneado") return null;
  if (doc.status === "en_mapa" || doc.status === "entendido") return null;
  if (doc.status === "leido" || doc.passages === 0) return doc.origin === "moodle" || !doc.file_path ? null : "pasajes";
  return "mapa";
}

/* --- Errores ------------------------------------------------------------------------------- */

export type FaultCode = "config" | "apagado" | "moodle" | "token" | "red" | "tiempo" | "migracion" | "interno" | "permiso" | "pedido" | "otro";

export interface Fault {
  code: FaultCode;
  /** Qué pasó, en una frase. */
  title: string;
  /** Lo que dijo el servidor, ya limpio (o vacío). */
  detail: string;
  /** Qué hacer. */
  hint: string;
  /** ¿Vale la pena pulsar «Reintentar» sin cambiar nada? */
  retry: boolean;
}

const FAULT: Record<FaultCode, { title: string; hint: string; retry: boolean }> = {
  config: { title: "La conexión no está completa", hint: "Revise la dirección de Moodle (debe empezar por https y ser la de entrada al sitio) y que el token esté guardado.", retry: false },
  apagado: { title: "La lectura de Moodle está apagada", hint: "Enciéndala arriba para leer categorías y cursos. «Probar conexión» funciona aun apagada.", retry: false },
  moodle: { title: "Moodle respondió con un error", hint: "Puede ser un permiso que le falta al usuario del token o una función que el servicio no incluye. «Probar conexión» dice cuáles puede usar.", retry: true },
  token: { title: "Moodle no aceptó el token", hint: "Genere un token nuevo en Moodle para el usuario de Pilo y péguelo otra vez.", retry: false },
  red: { title: "No hubo conexión", hint: "Revise que la dirección sea la correcta y que el sitio responda. Luego reintente.", retry: true },
  tiempo: { title: "Tardó demasiado", hint: "Lo que alcanzó a guardarse queda guardado. Reintente: sigue desde donde iba.", retry: true },
  migracion: { title: "Falta una migración en la base", hint: "Aplíquela y vuelva a intentar.", retry: false },
  interno: { title: "Falló la base", hint: "Reintente en un momento. Si se repite, revise la bitácora de la función.", retry: true },
  permiso: { title: "Solo la administración puede hacer esto", hint: "Inicie sesión con una cuenta de administración.", retry: false },
  pedido: { title: "El pedido no es válido", hint: "Recargue la página y vuelva a intentar.", retry: false },
  otro: { title: "No se pudo completar", hint: "Reintente en un momento.", retry: true },
};

const KNOWN = new Set<string>(["config", "apagado", "moodle", "token", "red", "tiempo", "migracion", "interno"]);

/** Nunca se muestra algo con forma de token o de consulta de dirección, por si un texto se cuela. */
export const tidyDetail = (text: unknown): string =>
  String(text ?? "")
    .replace(/wstoken=[^\s&]+/gi, "wstoken=…")
    .replace(/\b[a-f0-9]{32,}\b/gi, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);

/**
 * Lo que respondió la función (estado HTTP y cuerpo) como un error legible. El
 * `code` del cuerpo manda; sin él, se deduce del estado. Sin respuesta
 * (`status` 0) es la red.
 */
export function faultFrom(status: number, body?: { error?: unknown; advice?: unknown; code?: unknown } | null): Fault {
  const given = typeof body?.code === "string" ? body.code : "";
  let code: FaultCode;
  if (KNOWN.has(given)) code = given as FaultCode;
  else if (!status) code = "red";
  else if (status === 401 || status === 403) code = "permiso";
  else if (status === 504 || status === 408) code = "tiempo";
  else if (status === 400 || status === 404 || status === 422) code = "pedido";
  else if (status >= 500) code = "interno";
  else code = "otro";
  const said = [body?.error, body?.advice].filter((v): v is string => typeof v === "string" && v.trim() !== "").join(" ");
  return { code, ...FAULT[code], detail: tidyDetail(said) };
}

/** Un error con su lectura: lo lanza todo lo que habla con la función o con la base. */
export class StepError extends Error {
  fault: Fault;
  constructor(fault: Fault) {
    super(fault.detail || fault.title);
    this.name = "StepError";
    this.fault = fault;
  }
}

/** Cualquier cosa que se haya lanzado, como un error legible. */
export function faultOf(error: unknown): Fault {
  if (error instanceof StepError) return error.fault;
  const missing = missingMigration(error as DbError);
  if (missing) return { code: "migracion", ...FAULT.migracion, title: `Falta la migración ${missing}`, detail: "" };
  const message = error instanceof Error ? error.message : typeof (error as DbError)?.message === "string" ? (error as DbError).message! : "";
  if (/failed to fetch|networkerror|load failed/i.test(message)) return { code: "red", ...FAULT.red, detail: "" };
  if ((error as DbError)?.code === "42501") return { code: "permiso", ...FAULT.permiso, detail: tidyDetail(message) };
  return { code: "otro", ...FAULT.otro, detail: tidyDetail(message) };
}

/** Una frase para un aviso: qué pasó, lo que dijo el servidor y qué hacer. */
export const faultLine = (f: Fault): string => [f.title + ".", f.detail && f.detail !== f.title ? f.detail : "", f.hint].filter(Boolean).join(" ");

/* --- ¿Qué migración falta? ---------------------------------------------------------------- */

export interface DbError {
  code?: string;
  message?: string;
}

const MIGRATION_OF: [RegExp, string][] = [
  [/pilo_readings?\b|pilo_reading_/i, "0127"],
  [/pilo_portals?\b|pilo_sources\b|pilo_scope|pilo_portal_update|pilo_memory_readable/i, "0121"],
  [/pilo_moodle_sites?(\b|_)|p_site\b/i, "0133"],
  [/pilo_moodle|pilo_space_secret|pilo_space_set_secret|moodle_(on|url|site|checked_at)/i, "0116"],
  [/pilo_doc_outline|pilo_map_|pilo_graph_neighbors|mapped_at/i, "0115"],
  [/pilo_docs?\b|pilo_doc_|pilo-docs|doc_id/i, "0114"],
  [/pilo_spaces|p_space/i, "0113"],
];

/**
 * Si el error dice «eso no existe» (tabla, columna o función), cuál migración
 * la trae. PostgREST: PGRST205 (tabla), PGRST202 (función), PGRST204 (columna);
 * Postgres: 42P01, 42883, 42703. Otro error: null.
 */
export function missingMigration(error: DbError | null | undefined): string | null {
  if (!error) return null;
  const message = error.message ?? "";
  const gone =
    ["PGRST205", "PGRST202", "PGRST204", "42P01", "42883", "42703"].includes(error.code ?? "") ||
    /could not find the (table|function|'[^']+' column)|does not exist|bucket not found/i.test(message);
  if (!gone) return null;
  return MIGRATION_OF.find(([re]) => re.test(message))?.[1] ?? null;
}

/* --- Comprender, por lotes ------------------------------------------------------------- */

export interface ComprehendResult {
  ai?: boolean;
  asked?: number;
  saved?: number;
  failed?: number;
  done?: boolean;
  stopped?: string;
  note?: string;
  status?: { total?: number; mapped?: number; pending?: number; topics?: number; refs?: number };
}

export const MAX_ROUNDS = 80;

const STOP_TEXT: Record<string, string> = {
  limite_proveedor: "El proveedor de IA limitó los pedidos. Lo comprendido queda guardado: continúe en unos minutos.",
  proveedor: "El proveedor de IA respondió con un error. Lo comprendido queda guardado.",
  tiempo: "El lote se quedó sin tiempo. Lo comprendido queda guardado: puede continuar.",
  red: "No hubo conexión con el proveedor de IA. Lo comprendido queda guardado.",
  formato: "El modelo no devolvió nada que se pudiera leer y no se guardó nada. No conviene insistir: revise el modelo en «Mr. Pilo con IA».",
};

/**
 * Tras un lote: `seguir` pide otro; `listo` terminó; `parar` se detiene y dice
 * por qué. Cualquier `stopped` detiene la repetición automática (con
 * «formato» tampoco se ofrece continuar). Un lote que no guardó nada también
 * para: no se repite para siempre.
 */
export function comprehendNext(r: ComprehendResult, round: number): { next: "seguir" | "listo" | "parar"; why: string; again: boolean } {
  if (r.ai === false) return { next: "listo", why: r.note || "Sin IA, el mapa es el básico: estructura y normas citadas.", again: false };
  if (r.done || (r.status && r.status.pending === 0)) return { next: "listo", why: "", again: false };
  if (r.stopped) return { next: "parar", why: STOP_TEXT[r.stopped] ?? r.note ?? "El lote se detuvo antes de terminar.", again: r.stopped !== "formato" };
  if (!r.saved) return { next: "parar", why: "El lote no guardó ningún pasaje. Lo anterior queda guardado.", again: true };
  if (round + 1 >= MAX_ROUNDS) return { next: "parar", why: "Se hicieron muchos lotes seguidos. Puede continuar.", again: true };
  return { next: "seguir", why: "", again: false };
}

/** El avance de comprender: de los pasajes con documento, cuántos ya tienen sus temas. */
export const comprehendShare = (s: ComprehendResult["status"] | null | undefined): number => {
  const total = Number(s?.total) || 0;
  return total > 0 ? Math.min(1, Math.max(0, (Number(s?.mapped) || 0) / total)) : 0;
};

/* --- Archivos ----------------------------------------------------------------------------- */

/** El nombre con que el original va al bucket: sin tildes ni signos, que el almacenamiento no acepta. */
export function safeFileName(name: string): string {
  const flat = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|-+$/g, "");
  const dot = flat.lastIndexOf(".");
  const ext = dot > 0 ? flat.slice(dot).toLowerCase() : "";
  const stem = (dot > 0 ? flat.slice(0, dot) : flat).slice(0, 100).replace(/-+$/, "");
  return `${stem || "documento"}${ext}`;
}

/** `<espacio>/<id>/<nombre>`: la ruta que exige pilo_docs. */
export const docPath = (space: string, id: string, name: string) => `${space}/${id}/${safeFileName(name)}`;

/** El título de partida: el nombre del archivo sin extensión, con espacios. */
export const titleFromFile = (name: string) =>
  String(name ?? "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Documento";

export const MIME_OF: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
  csv: "text/csv",
};

/* --- La dirección de Moodle ------------------------------------------------------------ */

/**
 * La dirección como se guarda: https, solo el sitio (y su carpeta, si la
 * tiene), sin usuario, puerto, consulta ni ancla, y nunca una dirección
 * interna. La función lo revisa otra vez (y resuelve el nombre); aquí se
 * avisa antes de guardar.
 */
export function checkMoodleUrl(value: string): { ok: true; url: string } | { ok: false; why: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: true, url: "" };
  if (!/^https:\/\//i.test(raw)) return { ok: false, why: "La dirección debe empezar por https://." };
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, why: "Esa dirección no es válida." };
  }
  if (u.username || u.password) return { ok: false, why: "La dirección no lleva usuario ni clave." };
  if (u.port) return { ok: false, why: "La dirección no lleva puerto." };
  if (u.search || u.hash) return { ok: false, why: "La dirección no lleva consulta (?…) ni ancla (#…)." };
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || /^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".") || /\.(local|internal|lan|home)$/.test(host))
    return { ok: false, why: "Debe ser la dirección pública del sitio, no una dirección interna ni una IP." };
  const url = `https://${host}${u.pathname.replace(/\/+$/, "")}`;
  if (url.length > 300) return { ok: false, why: "La dirección es demasiado larga." };
  return { ok: true, url };
}

/** Hasta cuántos sitios de Moodle tiene un espacio (lo mismo que revisa la base, 0133). */
export const MAX_MOODLE_SITES = 12;

/**
 * El id de un sitio nuevo, a partir de su nombre: minúsculas, números y
 * guiones, empieza por letra, hasta 24 caracteres y sin repetir uno que ya
 * exista («Campus Cúcuta» → «campus-cucuta»; si ya está, «campus-cucuta-2»).
 */
export function moodleSiteId(name: string, taken: readonly string[] = []): string {
  const plain = String(name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .replace(/-+$/, "");
  const base = (plain.length >= 2 ? plain : "sitio").slice(0, 24).replace(/-+$/, "");
  if (!taken.includes(base)) return base;
  for (let n = 2; n < 100; n++) {
    const tail = `-${n}`;
    const id = `${base.slice(0, 24 - tail.length).replace(/-+$/, "")}${tail}`;
    if (!taken.includes(id)) return id;
  }
  return base;
}

/* --- Quién está leyendo: la franja ------------------------------------------------------ */

export interface ReadingJob {
  /** Quién lo puso: «documentos», «moodle», «mapa», «prueba». */
  owner: string;
  title: string;
  line: string;
  /** 0 a 1, solo si se conoce de verdad. */
  progress?: number;
  /** «2 de 5», «37 pasajes»… */
  counter?: string;
  /** Cómo detenerlo, solo si de verdad se puede: el panel de Pilo ofrece «Detener». */
  stop?: () => void;
}

export interface ReadingState {
  jobs: ReadingJob[];
}

export type ReadingAction = { type: "set"; job: ReadingJob } | { type: "end"; owner: string };

/** Los trabajos en curso: uno por dueño; el último que se movió es el que se cuenta. */
export function readingReducer(state: ReadingState, action: ReadingAction): ReadingState {
  const rest = state.jobs.filter((j) => j.owner !== (action.type === "set" ? action.job.owner : action.owner));
  return { jobs: action.type === "set" ? [...rest, action.job] : rest };
}

export const currentReading = (state: ReadingState): ReadingJob | null => state.jobs[state.jobs.length - 1] ?? null;
