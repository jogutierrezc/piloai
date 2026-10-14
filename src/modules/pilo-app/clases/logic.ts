/* =============================================================================
   Mr. Pilo · Mis clases (beta) · las reglas de la página, en un solo sitio.

   Quién ve Mis clases, dónde vive el permiso de Moodle, qué quiere decir cada
   error de la función `pilo-clases`, cómo se ordenan y se agrupan las
   entregas, y qué se le pregunta a Pilo sobre un curso o una actividad.

   El permiso de Moodle (un token de solo lectura):
     · nunca está en el servidor: la función lo devuelve y aquí se queda;
     · con «mantener la conexión», en el almacenamiento de este dispositivo;
     · sin ella, solo en la memoria de la pestaña: al cerrarla o recargarla,
       se va;
     · va atado a la cuenta de Pilo que lo pidió: otra cuenta en el mismo
       dispositivo no lo recibe, y encontrarlo lo borra;
     · «Desconectar» lo borra de los dos sitios de inmediato;
     · es de UN Moodle: la universidad tiene varios y con el permiso se
       guarda cuál (su identificador y su nombre, nunca su dirección). Una
       persona tiene una conexión a la vez. Un permiso guardado antes de que
       hubiera varios no dice cuál: se envía sin sitio y la función lo
       resuelve mientras haya uno solo.
   La contraseña de Moodle no pasa por aquí: va del formulario a la función y
   no se guarda en ningún lado.

   Puro: se prueba en node.
   ========================================================================== */

import type { Course, CourseItem, CourseSection, Delivery, SiteInfo } from "./servidor-logica";

export type { Course, CourseItem, CourseSection, Delivery, SiteInfo };

/* --- Quién ---------------------------------------------------------------------------------- */

/** Mis clases es de estudiantes y profesores con cuenta de Pilo activa. */
export const canUseClases = (account: { rol: string; status: string } | null | undefined): boolean =>
  Boolean(account) && account!.status === "activa" && (account!.rol === "estudiante" || account!.rol === "profesor");

/* --- El permiso, en el dispositivo ---------------------------------------------------------- */

/** Un Moodle de los que ofrece la administración: su identificador y su nombre. La dirección no llega aquí. */
export interface SiteRef {
  id: string;
  name: string;
}

export interface Link {
  token: string;
  site: SiteInfo;
  /** A cuál Moodle es la conexión. Falta en un permiso guardado antes de que hubiera varios. */
  moodle?: SiteRef & {
    /** La persona lo eligió entre varios: solo entonces se nombra en la pantalla. */
    chosen: boolean;
  };
  /** Quedó guardado en este dispositivo (si no, solo en la memoria de la pestaña). */
  kept: boolean;
}

export interface LinkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LINK_KEY = "pilo-app:clases";

interface Held {
  owner: string;
  token: string;
  site: SiteInfo;
  moodle?: Link["moodle"];
}

/** Lo que vive solo mientras la pestaña está abierta. */
let memory: Held | null = null;

/** El almacenamiento del dispositivo; null si el navegador no lo deja usar. */
export function deviceStore(): LinkStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

const tokenShape = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{20,128}$/.test(v);
const short = (v: unknown, max = 120): string => (typeof v === "string" ? v.slice(0, max) : "");
/** El identificador de un sitio de Moodle, con la forma que exige la función. */
export const siteIdShape = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(v);

/** El Moodle de un permiso; si no se entiende, el permiso queda como los de antes: sin sitio. */
function moodleOf(v: unknown): Link["moodle"] {
  const m = (v && typeof v === "object" ? v : {}) as { id?: unknown; name?: unknown; chosen?: unknown };
  return siteIdShape(m.id) ? { id: m.id, name: short(m.name, 60), chosen: m.chosen === true } : undefined;
}

function parseHeld(raw: string | null): Held | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { v?: unknown; owner?: unknown; token?: unknown; site?: { name?: unknown; user?: unknown }; moodle?: unknown };
    if (d?.v !== 1 || typeof d.owner !== "string" || !d.owner || !tokenShape(d.token)) return null;
    const moodle = moodleOf(d.moodle);
    return { owner: d.owner, token: d.token, site: { name: short(d.site?.name), user: short(d.site?.user) }, ...(moodle ? { moodle } : {}) };
  } catch {
    return null;
  }
}

const drop = (store: LinkStore | null) => {
  try {
    store?.removeItem(LINK_KEY);
  } catch {
    /* sin almacenamiento: no hay nada que borrar */
  }
};

/**
 * Guarda el permiso de la cuenta `owner`. Con `keep`, en el dispositivo; sin
 * él, solo en memoria (y borra el que hubiera guardado). Dice si quedó en el
 * dispositivo: con el almacenamiento lleno o bloqueado, queda en memoria.
 */
export function saveLink(owner: string, link: { token: string; site: SiteInfo; moodle?: Link["moodle"] }, keep: boolean, store: LinkStore | null = deviceStore()): Link {
  const moodle = moodleOf(link.moodle);
  const held: Held = { owner, token: link.token, site: link.site, ...(moodle ? { moodle } : {}) };
  memory = held;
  let kept = false;
  if (keep && store) {
    try {
      store.setItem(LINK_KEY, JSON.stringify({ v: 1, ...held }));
      kept = true;
    } catch {
      kept = false;
    }
  }
  if (!kept) drop(store);
  return { token: held.token, site: held.site, ...(moodle ? { moodle } : {}), kept };
}

/** El permiso de la cuenta `owner`, si lo hay. El de otra cuenta no se entrega: se borra. */
export function readLink(owner: string, store: LinkStore | null = deviceStore()): Link | null {
  let stored: Held | null = null;
  let raw: string | null = null;
  try {
    raw = store?.getItem(LINK_KEY) ?? null;
  } catch {
    raw = null;
  }
  stored = parseHeld(raw);
  // Algo guardado que no se entiende, o que es de otra cuenta: fuera.
  if (raw && (!stored || stored.owner !== owner)) {
    drop(store);
    stored = null;
  }
  if (memory && memory.owner !== owner) memory = null;
  const held = stored ?? memory;
  if (!held) return null;
  return { token: held.token, site: held.site, ...(held.moodle ? { moodle: held.moodle } : {}), kept: Boolean(stored) };
}

/** «Desconectar»: el permiso se borra de la memoria y del dispositivo, de inmediato. */
export function clearLink(store: LinkStore | null = deviceStore()): void {
  memory = null;
  drop(store);
}

/* --- Lo que responde la función ------------------------------------------------------------- */

export type ClasesCode =
  | "sesion" | "cuenta" | "perfil" | "suspendida" | "limite" | "no_disponible" | "datos"
  | "credenciales" | "movil" | "permiso" | "mantenimiento" | "clave_moodle" | "curso" | "sitio"
  | "funcion" | "tiempo" | "red" | "tamano" | "moodle" | "interno"
  /** Los que pone la página: sin red, la función no está desplegada, o respondió algo que no se entiende. */
  | "sin_red" | "sin_funcion" | "desconocido";

const SERVER: string[] = [
  "sesion", "cuenta", "perfil", "suspendida", "limite", "no_disponible", "datos", "credenciales", "movil", "permiso", "mantenimiento", "clave_moodle", "curso", "sitio",
  "funcion", "tiempo", "red", "tamano", "moodle", "interno",
];

const FALLBACK: Record<ClasesCode, string> = {
  sesion: "Para ver sus clases, entre con su cuenta de Pilo.",
  cuenta: "Mis clases es para quienes tienen cuenta de Pilo de estudiante o de profesor.",
  perfil: "Mis clases es para estudiantes y profesores.",
  suspendida: "Su cuenta de Pilo está suspendida. Escriba a la administración.",
  limite: "Va muy rápido: espere un momento antes de volver a intentarlo.",
  no_disponible: "Mis clases aún no está disponible: la universidad todavía no ha conectado a Pilo con Moodle.",
  datos: "Escriba su usuario y su contraseña de Moodle.",
  credenciales: "Moodle no aceptó ese usuario y esa contraseña. Revíselos e intente de nuevo.",
  movil: "El Moodle de la universidad no tiene activo el servicio que Pilo necesita para leer sus clases.",
  permiso: "Su permiso de Moodle venció o fue retirado. Conecte de nuevo sus clases.",
  mantenimiento: "Moodle está en mantenimiento. Intente de nuevo más tarde.",
  clave_moodle: "Moodle le pide revisar su contraseña. Entre a Moodle y vuelva a conectar.",
  curso: "Moodle no encontró ese curso, o usted no está inscrito en él.",
  sitio: "Ese Moodle ya no está disponible en Pilo. Conecte de nuevo sus clases.",
  funcion: "El Moodle de la universidad no deja leer esa parte desde una aplicación.",
  tiempo: "Moodle tardó demasiado en responder. Intente de nuevo en un momento.",
  red: "No pude conectarme con Moodle. Intente de nuevo en un momento.",
  tamano: "Moodle devolvió más de lo que Pilo puede leer de una vez.",
  moodle: "Moodle respondió con un error. Intente de nuevo en un momento.",
  interno: "Algo falló al leer sus clases. Intente de nuevo en un momento.",
  sin_red: "No hay conexión a internet. Revísela e intente de nuevo.",
  sin_funcion: "Mis clases aún no está disponible.",
  desconocido: "Algo falló. Intente de nuevo en un momento.",
};

export const clasesMessage = (code: ClasesCode): string => FALLBACK[code];

/** A qué estado de la pantalla lleva un fallo. */
export type FailureView =
  /** El permiso ya no sirve, o su Moodle ya no se ofrece: se borra y se pide conectar de nuevo. */
  | "vencido"
  /** Mis clases no se puede usar todavía (falta configurar Moodle o desplegar la función). */
  | "no_disponible"
  | "sin_conexion"
  /** La cuenta de Pilo no puede usar Mis clases, o hay que entrar otra vez. */
  | "cuenta"
  /** Se dice junto al campo de la contraseña de Moodle. */
  | "campo"
  /** Se dice en la pantalla en que esté la persona, y puede reintentar. */
  | "aviso";

const VIEW: Partial<Record<ClasesCode, FailureView>> = {
  permiso: "vencido",
  sitio: "vencido",
  no_disponible: "no_disponible",
  movil: "no_disponible",
  sin_funcion: "no_disponible",
  sin_red: "sin_conexion",
  sesion: "cuenta",
  cuenta: "cuenta",
  perfil: "cuenta",
  suspendida: "cuenta",
  credenciales: "campo",
  clave_moodle: "campo",
  datos: "campo",
};

export interface ClasesFailure {
  code: ClasesCode;
  message: string;
  view: FailureView;
  /** Segundos que hay que esperar (solo `limite`). */
  retryAfter?: number;
}

const waitText = (seconds: number) => (seconds >= 90 ? `${Math.round(seconds / 60)} minutos` : `${Math.max(1, Math.round(seconds))} segundos`);

export const failureOf = (code: ClasesCode, message = FALLBACK[code], retryAfter?: number): ClasesFailure => ({ code, message, view: VIEW[code] ?? "aviso", ...(retryAfter ? { retryAfter } : {}) });

/**
 * Una respuesta de error de `pilo-clases`, como algo que la persona entiende
 * y con el estado de pantalla al que lleva. El texto del servidor se usa solo
 * cuando su código es de los conocidos.
 */
export function clasesFailure(status: number, body: unknown): ClasesFailure {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; retry_after?: unknown };
  const said = typeof b.error === "string" ? b.error.trim().slice(0, 300) : "";
  const raw = typeof b.code === "string" ? b.code : "";
  const known = SERVER.includes(raw);
  // La plataforma responde 404 cuando la función no está desplegada.
  if (status === 404 && !known) return failureOf("sin_funcion");
  if (!known) return failureOf(status === 429 ? "limite" : status === 401 ? "sesion" : "desconocido");
  const code = raw as ClasesCode;
  if (code === "limite") {
    const n = Number(b.retry_after);
    const retryAfter = Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
    return failureOf(code, `${said || FALLBACK.limite}${retryAfter ? ` Podrá intentarlo de nuevo en ${waitText(retryAfter)}.` : ""}`, retryAfter);
  }
  return failureOf(code, said || FALLBACK[code]);
}

/* --- Lo que llega de la función -------------------------------------------------------------- */

export interface Agenda {
  site: SiteInfo;
  courses: Course[];
  deliveries: Delivery[];
  /** De dónde salieron las fechas: el calendario de Moodle, sus tareas, o ninguna parte. */
  from: "calendario" | "tareas" | "ninguna";
}

const text = (v: unknown, max = 300): string => (typeof v === "string" ? v.slice(0, max) : "");
const whole = (v: unknown): number => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0);
const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
/** Un enlace que se puede abrir: solo https. */
const link = (v: unknown): string => (typeof v === "string" && /^https:\/\/[^\s]+$/.test(v) ? v.slice(0, 400) : "");

/** Los Moodle entre los que se elige, en el orden de la función; lo que no se entiende se descarta. */
export function parseSites(body: unknown): SiteRef[] {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: SiteRef[] = [];
  for (const s of rows(b.sites)) {
    const id = s.id;
    if (!siteIdShape(id) || out.some((o) => o.id === id)) continue;
    out.push({ id, name: text(s.name, 60).trim() || "Moodle" });
  }
  return out.slice(0, 12);
}

/** La agenda tal como se usa aquí; lo que no se entiende se descarta. */
export function parseAgenda(body: unknown): Agenda {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const site = (b.site && typeof b.site === "object" ? b.site : {}) as Record<string, unknown>;
  return {
    site: { name: text(site.name, 120), user: text(site.user, 120) },
    courses: rows(b.courses)
      .map((c) => ({ id: whole(c.id), name: text(c.name), short: text(c.short, 80), url: link(c.url), ended: c.ended === true }))
      .filter((c) => c.id && c.name),
    deliveries: sortDeliveries(
      rows(b.deliveries)
        .map((d) => ({ id: text(d.id, 40), title: text(d.title), course: whole(d.course), courseName: text(d.courseName), kind: text(d.kind, 32), due: whole(d.due), url: link(d.url) }))
        .filter((d) => d.id && d.title && d.due),
    ),
    from: b.from === "calendario" || b.from === "tareas" ? b.from : "ninguna",
  };
}

export interface CourseDetail {
  sections: CourseSection[];
  /** El curso es más largo de lo que se muestra. */
  cut: boolean;
}

export function parseCourse(body: unknown): CourseDetail {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  return {
    sections: rows(b.sections).map((s) => ({
      name: text(s.name) || "Sección",
      summary: text(s.summary, 500),
      items: rows(s.items)
        .map((m) => ({
          id: whole(m.id),
          name: text(m.name),
          kind: text(m.kind, 32),
          kindName: text(m.kindName, 40),
          url: link(m.url),
          text: text(m.text, 700),
          dates: rows(m.dates)
            .map((d) => ({ label: text(d.label, 60), at: whole(d.at) }))
            .filter((d) => d.at),
          files: (Array.isArray(m.files) ? m.files : []).filter((f): f is string => typeof f === "string").map((f) => f.slice(0, 120)),
        }))
        .filter((m) => m.id && m.name),
    })),
    cut: b.cut === true,
  };
}

/* --- Las entregas: orden y grupos ------------------------------------------------------------ */

/** Por fecha, la más próxima primero; a igual fecha, por curso y por título. */
export function sortDeliveries(list: Delivery[]): Delivery[] {
  return [...list].sort((a, b) => a.due - b.due || a.courseName.localeCompare(b.courseName, "es") || a.title.localeCompare(b.title, "es"));
}

export type GroupId = "vencidas" | "hoy" | "semana" | "despues";

export const GROUP_LABEL: Record<GroupId, string> = {
  vencidas: "Ya vencieron",
  hoy: "Hoy",
  semana: "Esta semana",
  despues: "Más adelante",
};

/** El fin del día de `now`, en la hora del dispositivo. */
const endOfDay = (now: number): number => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

/** En qué grupo cae una entrega: ya venció, vence hoy, en los siete días siguientes, o después. */
export function groupOf(due: number, now: number): GroupId {
  const at = due * 1000;
  if (at < now) return "vencidas";
  const end = endOfDay(now);
  if (at < end) return "hoy";
  if (at < end + 7 * 86_400_000) return "semana";
  return "despues";
}

const GROUP_ORDER: GroupId[] = ["hoy", "semana", "despues", "vencidas"];

/** Las entregas por grupos, en el orden en que se leen; los grupos vacíos no salen. */
export function groupDeliveries(list: Delivery[], now: number): { id: GroupId; label: string; items: Delivery[] }[] {
  const sorted = sortDeliveries(list);
  return GROUP_ORDER.map((id) => ({ id, label: GROUP_LABEL[id], items: sorted.filter((d) => groupOf(d.due, now) === id) })).filter((g) => g.items.length > 0);
}

/** Las entregas de un curso que aún no vencen. */
export const courseDeliveries = (list: Delivery[], course: number, now: number): Delivery[] => sortDeliveries(list.filter((d) => d.course === course && d.due * 1000 >= now));

/** La línea de un curso: qué tiene por entregar. */
export function courseLine(list: Delivery[], course: number, now: number): string {
  const mine = courseDeliveries(list, course, now);
  const soon = mine.filter((d) => groupOf(d.due, now) !== "despues").length;
  if (soon > 0) return `Esta semana: ${soon} ${soon === 1 ? "entrega" : "entregas"}`;
  if (mine.length > 0) return `Sin entregas esta semana · ${mine.length} más adelante`;
  return "Sin entregas a la vista";
}

/* --- Las fechas, dichas ---------------------------------------------------------------------- */

const DAY = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short" });
const DAY_YEAR = new Intl.DateTimeFormat("es-CO", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const HOUR = new Intl.DateTimeFormat("es-CO", { hour: "numeric", minute: "2-digit" });

/** «lun, 5 oct · 11:59 p. m.», en la hora del dispositivo; con el año si no es el de ahora. */
export function dueLabel(due: number, now: number): string {
  const d = new Date(due * 1000);
  const day = d.getFullYear() === new Date(now).getFullYear() ? DAY.format(d) : DAY_YEAR.format(d);
  return `${day} · ${HOUR.format(d)}`;
}

/** Cuánto falta, en palabras: «vence hoy», «vence mañana», «en 3 días». */
export function dueIn(due: number, now: number): string {
  const at = due * 1000;
  if (at < now) return "ya venció";
  const end = endOfDay(now);
  if (at < end) return "vence hoy";
  if (at < end + 86_400_000) return "vence mañana";
  const days = Math.floor((at - end) / 86_400_000) + 1;
  return `en ${days} días`;
}

/** La lista de fechas, para copiar y pegar en una agenda o en un mensaje. */
export function datesText(list: Delivery[], now: number): string {
  const sorted = sortDeliveries(list);
  if (!sorted.length) return "";
  return ["Mis entregas (Moodle)", ...sorted.map((d) => `- ${dueLabel(d.due, now)} · ${[d.courseName, d.title].filter(Boolean).join(" · ")}`)].join("\n");
}

/** El tipo de una actividad, en palabras (el de Moodle si no se conoce). */
const KINDS: Record<string, string> = {
  assign: "Tarea", quiz: "Cuestionario", forum: "Foro", page: "Página", resource: "Archivo", url: "Enlace", folder: "Carpeta", book: "Libro",
  lesson: "Lección", workshop: "Taller", choice: "Consulta", feedback: "Encuesta", glossary: "Glosario", wiki: "Wiki", scorm: "Paquete", h5pactivity: "Actividad interactiva",
  label: "Nota", data: "Base de datos", chat: "Chat", survey: "Encuesta", lti: "Herramienta externa", bigbluebuttonbn: "Clase en vivo",
};
export const kindLabel = (kind: string, fromMoodle = ""): string => KINDS[kind] ?? fromMoodle ?? "";

/* --- Preguntarle a Pilo ---------------------------------------------------------------------- */

const quote = (v: string, max = 140) => v.replace(/[«»"\s]+/g, " ").trim().slice(0, max);

/**
 * La pregunta que queda escrita en la conversación. Lleva solo títulos (el
 * curso y, si la hay, la actividad): ningún contenido de Moodle viaja a la
 * conversación. La persona la lee, la cambia si quiere y la envía.
 */
export function askAbout(course: string, activity = ""): string {
  const c = quote(course);
  const a = quote(activity);
  if (c && a) return `En mi curso «${c}» tengo la actividad «${a}». ¿Me orienta sobre cómo abordarla y cómo organizar mi tiempo?`;
  if (a) return `Tengo la actividad «${a}». ¿Me orienta sobre cómo abordarla y cómo organizar mi tiempo?`;
  if (c) return `Estoy en el curso «${c}». ¿Me ayuda a organizarme con lo que tengo pendiente?`;
  return "";
}
