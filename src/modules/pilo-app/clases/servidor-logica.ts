/* =============================================================================
   Mis clases (beta) · la lógica pura de la función `pilo-clases`.

   Todo lo que la función decide sin tocar la red ni la base: qué dirección de
   Moodle se acepta, cuáles de los sitios de la administración se ofrecen y
   cuál atiende cada pedido, qué funciones de Moodle se pueden llamar (lista
   cerrada, todas de lectura), cómo se arma cada pedido, qué significa cada
   error de Moodle y qué queda de sus respuestas antes de devolverlas al
   navegador.

   La función del servidor (supabase/functions/pilo-clases/index.ts) es un solo
   archivo, porque el editor del panel de Supabase solo acepta uno, y lleva
   dentro una copia exacta de este archivo. La prueba servidor-sync.test.ts
   falla si las dos se separan: al cambiar algo aquí, hay que copiarlo también
   en index.ts.

   Por eso este archivo no importa nada y no usa nada de Deno ni del
   navegador: vale igual en los dos lados, y la prueba vitest
   (servidor.test.ts) lo importa tal cual. Los tipos de lo que devuelve la
   función (Course, Delivery…) los usa también la interfaz (logic.ts).

   La validación de la dirección es la misma de la acción «moodle» de pilo-ia
   (0116): solo https, nombre de dominio público, sin IP escrita de ninguna
   forma, sin usuario, puerto, consulta ni ancla, y con las rutas fijas.
   ========================================================================== */

/* --- La lista cerrada ------------------------------------------------------------------------ */

/**
 * Las únicas funciones de Moodle que esta función llama. Todas son de lectura
 * y todas están en el servicio de la app móvil de Moodle. Ninguna entrega,
 * escribe, califica, presenta un examen ni lee sus preguntas.
 */
export const CLASES_ALLOWED = [
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "core_calendar_get_action_events_by_timesort",
  "mod_assign_get_assignments",
  "core_course_get_contents",
  "mod_page_get_pages_by_courses",
] as const;
export type ClasesFn = (typeof CLASES_ALLOWED)[number];
export const isClasesFn = (v: unknown): v is ClasesFn => typeof v === "string" && (CLASES_ALLOWED as readonly string[]).includes(v);

/** El servicio con el que se pide el permiso: el de la app móvil oficial de Moodle. */
export const MOODLE_SERVICE = "moodle_mobile_app";
/** Las dos rutas de Moodle que se usan: fijas, nunca las que diga quien configura ni quien llama. */
export const MOODLE_REST_PATH = "/webservice/rest/server.php";
export const MOODLE_LOGIN_PATH = "/login/token.php";

/** Topes de cada pedido a esta función. */
export const CALL_MS = 12_000;
export const TOTAL_MS = 25_000;
export const MAX_CALLS = 4;
/** Lo más que se lee de una respuesta de Moodle. */
export const MAX_BYTES = 3_000_000;
export const MAX_COURSES = 60;
export const MAX_EVENTS = 100;
export const MAX_SECTIONS = 60;
export const MAX_ITEMS = 300;
export const MAX_TEXT = 600;
/** Hasta cuándo se miran las entregas. */
export const AHEAD_DAYS = 90;

/* --- La dirección de Moodle ------------------------------------------------------------------ */

/** ¿Esa dirección IP es de una red privada, local o reservada? Lo que no se entiende cuenta como privado. */
export function privateAddress(ip: string): boolean {
  const text = String(ip ?? "").trim().toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return true;
    return (
      a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  if (!text.includes(":") || !/^[0-9a-f:.]+$/.test(text)) return true;
  // Una IPv4 dentro de una IPv6 (::ffff:10.0.0.1, 64:ff9b::…): no se usa para un sitio público.
  if (text.includes(".") || /^::ffff:/.test(text) || /^64:ff9b:/.test(text)) return true;
  const head = parseInt(text.split(":")[0] || "0", 16);
  // ::/16, fc00::/7 (privadas), fe80::/10 (de enlace), ff00::/8 (multidifusión), 2001:db8::/32 (documentación).
  return head === 0 || (head & 0xfe00) === 0xfc00 || (head & 0xffc0) === 0xfe80 || (head & 0xff00) === 0xff00 || /^2001:0?db8:/.test(text);
}

const BLOCKED_HOST = /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|test|invalid|example|onion|arpa|nip\.io|sslip\.io|xip\.io|localtest\.me|lvh\.me)$/;
const HOST_REASON = "La dirección de Moodle debe ser un nombre de dominio público, no una dirección IP ni un nombre de red interna.";

export type MoodleSite = { ok: true; site: string; host: string; rest: string; login: string } | { ok: false; reason: string };

/**
 * La dirección del Moodle que configuró la administración, revisada: solo
 * https, con nombre de dominio público (ni IP escrita de ninguna forma, ni
 * localhost, ni nombres de red interna), sin usuario, puerto, consulta ni
 * ancla. Devuelve las dos direcciones que se llaman, con sus rutas fijas.
 */
export function moodleSite(raw0: unknown): MoodleSite {
  const no = (reason: string) => ({ ok: false as const, reason });
  const raw = typeof raw0 === "string" ? raw0.trim() : "";
  if (!raw) return no("Falta la dirección del sitio de Moodle.");
  if (raw.length > 300 || /[\s\\@%]/.test(raw) || raw.includes("..")) return no("La dirección de Moodle no es válida.");
  if (!/^https:\/\//i.test(raw)) return no("La dirección de Moodle debe empezar por https://.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return no("La dirección de Moodle no es válida.");
  }
  if (u.protocol !== "https:" || u.username || u.password) return no("La dirección de Moodle debe empezar por https:// y no llevar usuario.");
  if (u.port) return no("La dirección de Moodle no puede llevar puerto.");
  if (u.search || u.hash || raw.includes("?") || raw.includes("#")) return no("La dirección de Moodle no puede llevar consulta (?…) ni ancla (#…).");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // Una IP escrita como sea (decimal, hexadecimal, IPv6) queda aquí: el nombre debe terminar en un dominio de letras.
  if (host.startsWith("[") || host.includes(":") || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}|xn--[a-z0-9-]{2,59})$/.test(host)) return no(HOST_REASON);
  if (BLOCKED_HOST.test(host)) return no(HOST_REASON);
  let path = u.pathname.replace(/\/+$/, "");
  for (const fixed of [MOODLE_REST_PATH, MOODLE_LOGIN_PATH]) if (path.toLowerCase().endsWith(fixed)) path = path.slice(0, -fixed.length);
  if (path && (!/^(\/[A-Za-z0-9._~-]+)+$/.test(path) || path.split("/").some((p) => p === "." || p === ".."))) return no("La ruta de la dirección de Moodle no es válida.");
  const site = `https://${host}${path}`;
  return { ok: true, site, host, rest: `${site}${MOODLE_REST_PATH}`, login: `${site}${MOODLE_LOGIN_PATH}` };
}

/* --- Los pedidos ----------------------------------------------------------------------------- */

/** Un permiso de Moodle tiene esta forma (32 hexadecimales; se admite algo más por si cambia). */
export const tokenShape = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{20,128}$/.test(v);

export type MoodleParams = Record<string, string | number | (string | number)[]>;

/**
 * El cuerpo de un pedido al servicio REST (application/x-www-form-urlencoded),
 * con el permiso dentro: nunca en la dirección. `null` si la función no está
 * en la lista cerrada.
 */
export function moodleForm(token: string, fn: string, params: MoodleParams = {}): string | null {
  if (!isClasesFn(fn)) return null;
  const form = new URLSearchParams();
  form.set("wstoken", token);
  form.set("wsfunction", fn);
  form.set("moodlewsrestformat", "json");
  for (const [key, value] of Object.entries(params)) {
    if (/^(wstoken|wsfunction|moodlewsrestformat)$/i.test(key)) continue;
    if (Array.isArray(value)) value.forEach((v, i) => form.append(`${key}[${i}]`, String(v)));
    else form.append(key, String(value));
  }
  return form.toString();
}

/** El cuerpo del pedido del permiso: usuario, contraseña y el servicio fijo. */
export function loginForm(username: string, password: string): string {
  const form = new URLSearchParams();
  form.set("username", username);
  form.set("password", password);
  form.set("service", MOODLE_SERVICE);
  return form.toString();
}

/** Lo que la persona escribe para conectar; `null` si falta algo o no tiene forma de usuario y contraseña. */
export function credentials(body: Record<string, unknown>): { username: string; password: string } | null {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  // deno-lint-ignore no-control-regex
  if (!username || username.length > 100 || /[\u0000-\u001f]/.test(username)) return null;
  if (!password || password.length > 200) return null;
  return { username, password };
}

/* --- Los errores ----------------------------------------------------------------------------- */

/** Los códigos con que esta función responde un fallo. La página los traduce a un estado. */
export type ClasesCode =
  | "sesion" | "cuenta" | "perfil" | "suspendida" | "limite" | "no_disponible" | "datos"
  | "credenciales" | "movil" | "permiso" | "mantenimiento" | "clave_moodle" | "curso" | "sitio"
  | "funcion" | "tiempo" | "red" | "tamano" | "moodle" | "interno";

export interface Fault {
  code: ClasesCode;
  message: string;
  status: number;
}

const MOVIL = "El Moodle de la universidad no tiene activo el servicio que Pilo necesita para leer sus clases. La administración de Moodle debe activar el servicio de la app móvil.";

/** Los textos son de esta función: lo que diga Moodle no viaja a la página (podría nombrar a la persona o a un curso). */
const FAULTS: Record<string, Fault> = {
  invalidlogin: { code: "credenciales", message: "Moodle no aceptó ese usuario y esa contraseña. Revíselos e intente de nuevo.", status: 401 },
  invalidtoken: { code: "permiso", message: "Su permiso de Moodle venció o fue retirado. Conecte de nuevo sus clases.", status: 401 },
  enablewsdescription: { code: "movil", message: MOVIL, status: 503 },
  webservicesnotenabled: { code: "movil", message: MOVIL, status: 503 },
  servicenotavailable: { code: "movil", message: MOVIL, status: 503 },
  restprotocoldisabled: { code: "movil", message: MOVIL, status: 503 },
  cannotcreatetoken: { code: "movil", message: "Su usuario de Moodle no tiene permiso para conectarse desde una aplicación. La administración de Moodle debe permitirlo.", status: 503 },
  missingrequiredcapability: { code: "movil", message: "Su usuario de Moodle no tiene permiso para conectarse desde una aplicación. La administración de Moodle debe permitirlo.", status: 503 },
  accessexception: { code: "funcion", message: "El Moodle de la universidad no deja leer esa parte desde una aplicación.", status: 502 },
  sitemaintenance: { code: "mantenimiento", message: "Moodle está en mantenimiento. Intente de nuevo más tarde.", status: 503 },
  upgraderunning: { code: "mantenimiento", message: "Moodle está en mantenimiento. Intente de nuevo más tarde.", status: 503 },
  passwordisexpired: { code: "clave_moodle", message: "Moodle le pide cambiar su contraseña. Entre a Moodle, cámbiela y vuelva a conectar.", status: 401 },
  forcepasswordchangenotice: { code: "clave_moodle", message: "Moodle le pide cambiar su contraseña. Entre a Moodle, cámbiela y vuelva a conectar.", status: 401 },
  usernotconfirmed: { code: "clave_moodle", message: "Su usuario de Moodle aún no está confirmado. Entre primero a Moodle.", status: 401 },
  invalidrecord: { code: "curso", message: "Moodle no encontró ese curso, o usted no está inscrito en él.", status: 404 },
  requireloginerror: { code: "curso", message: "Moodle no encontró ese curso, o usted no está inscrito en él.", status: 404 },
  errorcoursecontextnotvalid: { code: "curso", message: "Moodle no encontró ese curso, o usted no está inscrito en él.", status: 404 },
  notenrolled: { code: "curso", message: "Moodle no encontró ese curso, o usted no está inscrito en él.", status: 404 },
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const whole = (v: unknown): number => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : 0);

/**
 * Moodle dice sus errores como JSON con `exception` o `errorcode`, aunque
 * responda 200. Devuelve qué pasó, en palabras de esta función; `null` si la
 * respuesta no es un error.
 */
export function moodleFault(data: unknown): Fault | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.exception !== "string" && typeof d.errorcode !== "string" && typeof d.error !== "string") return null;
  const code = String(d.errorcode ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 60);
  return FAULTS[code] ?? { code: "moodle", message: "Moodle respondió con un error. Intente de nuevo en un momento.", status: 502 };
}

/** Lo que responde `login/token.php`: el permiso, o por qué no lo dio. */
export function loginResult(data: unknown): { ok: true; token: string } | { ok: false; fault: Fault } {
  const fault = moodleFault(data);
  if (fault) return { ok: false, fault };
  const token = obj(data).token;
  if (!tokenShape(token)) return { ok: false, fault: { code: "moodle", message: "Moodle no entregó el permiso. Intente de nuevo en un momento.", status: 502 } };
  return { ok: true, token };
}

/* --- Los sitios de Moodle -------------------------------------------------------------------- */

/** Lo más que se ofrece: los que la administración puede tener en un espacio (0133). */
export const MAX_SITES = 12;

/** El identificador de un sitio, con la forma que exige su tabla (0133). */
export const siteIdShape = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(v);

export interface OpenSite {
  id: string;
  /** El nombre que le puso la administración. Con el identificador, es lo único del sitio que viaja al navegador. */
  name: string;
  /** Su dirección, ya revisada. No sale de la función. */
  at: Extract<MoodleSite, { ok: true }>;
}

/**
 * Los sitios que «Mis clases» ofrece, en el orden en que llegan: los
 * encendidos, con un identificador bien formado y una dirección que pasa
 * `moodleSite`. Lo demás no existe para quien llama.
 */
export function openSites(rows: unknown): OpenSite[] {
  const out: OpenSite[] = [];
  for (const raw of list(rows)) {
    const r = obj(raw);
    const id = r.id;
    if (r.enabled !== true || !siteIdShape(id) || out.some((s) => s.id === id)) continue;
    const at = moodleSite(r.url);
    if (!at.ok) continue;
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
    out.push({ id, name: name || "Moodle", at });
    if (out.length >= MAX_SITES) break;
  }
  return out;
}

/** Aún no hay ningún Moodle conectado a Pilo. */
export const OFF: Fault = { code: "no_disponible", message: "Mis clases aún no está disponible: la universidad todavía no ha conectado a Pilo con Moodle.", status: 503 };
/** El sitio que se pide no está (lo quitaron o lo apagaron), o no se dijo cuál y hay varios. */
export const SITE_GONE: Fault = { code: "sitio", message: "Ese Moodle ya no está disponible en Pilo. Conecte de nuevo sus clases.", status: 409 };

/**
 * El sitio de un pedido: el que nombra su identificador, si sigue entre los
 * que se ofrecen. Un permiso guardado antes de que hubiera varios no dice
 * cuál: vale si hay exactamente uno. La dirección sale siempre de la lista de
 * la administración; del navegador solo llega el identificador.
 */
export function pickSite(sites: OpenSite[], asked: unknown): { ok: true; site: OpenSite } | { ok: false; fault: Fault } {
  if (sites.length === 0) return { ok: false, fault: OFF };
  if (asked === undefined || asked === null || asked === "") return sites.length === 1 ? { ok: true, site: sites[0] } : { ok: false, fault: SITE_GONE };
  const site = siteIdShape(asked) ? sites.find((s) => s.id === asked) : undefined;
  return site ? { ok: true, site } : { ok: false, fault: SITE_GONE };
}

/* --- El texto -------------------------------------------------------------------------------- */

const HTML_ENTITY: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", iexcl: "¡", iquest: "¿", laquo: "«", raquo: "»", ndash: "–", mdash: "—", hellip: "…",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", middot: "·", bull: "•", deg: "°", ordm: "º", ordf: "ª", copy: "©", reg: "®", euro: "€", trade: "™",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ", Uuml: "Ü",
};
const HTML_DROP = "script|style|iframe|noscript|object|svg|template|head|form|select|textarea|audio|video|canvas";
const HTML_BLOCK = "p|div|section|article|header|footer|main|aside|nav|h[1-6]|ul|ol|li|tr|table|thead|tbody|blockquote|pre|dl|dt|dd|figure|figcaption|address";

/**
 * El texto de un fragmento de HTML de Moodle: sin scripts, estilos ni marcos
 * (con todo lo que llevan dentro), con los bloques como saltos de línea, las
 * entidades leídas y los enlaces reducidos a su texto. No interpreta nada: lo
 * que queda es texto plano.
 */
export function htmlToText(html: string): string {
  let t = String(html ?? "");
  if (!t) return "";
  t = t.replace(/<!--[\s\S]*?(-->|$)/g, " ");
  t = t.replace(new RegExp(`<(${HTML_DROP})\\b[^>]*>[\\s\\S]*?<\\/\\1\\s*>`, "gi"), " ");
  // Uno sin cerrar se lleva lo que sigue: mejor perder texto que dejar pasar código.
  t = t.replace(new RegExp(`<(${HTML_DROP})\\b[\\s\\S]*$`, "i"), " ");
  t = t.replace(/<li\b[^>]*>/gi, "\n- ");
  t = t.replace(/<(br|hr)\b[^>]*>/gi, "\n");
  t = t.replace(/<\/(td|th)\s*>/gi, " · ");
  t = t.replace(new RegExp(`<\\/?(${HTML_BLOCK})\\b[^>]*>`, "gi"), "\n");
  // Solo lo que es una etiqueta: un «<» suelto en el texto (3 < 5) se queda.
  t = t.replace(/<\/?[a-z][^>]*>|<[!?][^>]*>/gi, "");
  t = t.replace(/<[a-z!/][^>]*$/i, "");
  t = t.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z][a-z0-9]{1,10});/gi, (whole_, name: string) => {
    if (name[0] !== "#") return HTML_ENTITY[name] ?? HTML_ENTITY[name.toLowerCase()] ?? whole_;
    const code = /^#x/i.test(name) ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    if (!Number.isInteger(code) || code < 32 || code > 0x10ffff || (code >= 0x7f && code <= 0x9f) || (code >= 0xd800 && code <= 0xdfff)) return " ";
    return String.fromCodePoint(code);
  });
  return t
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff]/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ ?· ?(?=\n|$)/g, "")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Un título: texto plano, en una línea, recortado. */
const line = (v: unknown, max = 200): string => (typeof v === "string" ? htmlToText(v).replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Un cuerpo: texto plano recortado, con «…» si se cortó. */
const clip = (v: unknown, max = MAX_TEXT): string => {
  const t = typeof v === "string" ? htmlToText(v) : "";
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
};

/**
 * Un enlace que se puede mostrar: solo una página del mismo Moodle, por https
 * y sin ningún permiso en la dirección. Lo demás (archivos del servicio web,
 * otros sitios) no viaja.
 */
export function safeLink(v: unknown, site: string): string {
  const raw = typeof v === "string" ? v.trim() : "";
  if (!raw || raw.length > 400 || /\s/.test(raw)) return "";
  if (!raw.startsWith(`${site}/`)) return "";
  if (/[?&](ws)?token=/i.test(raw) || /\/webservice\//i.test(raw)) return "";
  return raw;
}

/* --- Lo que se devuelve ---------------------------------------------------------------------- */

export interface SiteInfo {
  /** El nombre del sitio de Moodle. */
  name: string;
  /** El nombre de la persona en Moodle. */
  user: string;
}

/** Del sitio: su nombre, la persona, su número (solo para pedir sus cursos) y qué funciones deja usar. */
export function shapeSite(data: unknown): { info: SiteInfo; userId: number; can: (fn: ClasesFn) => boolean } {
  const d = obj(data);
  const granted = new Set(list(d.functions).map((f) => String(obj(f).name ?? "")));
  return {
    info: { name: line(d.sitename, 120), user: line(d.fullname, 120) },
    userId: whole(d.userid),
    // Un Moodle que no dice qué funciones permite: se intenta, y si no deja, lo dirá.
    can: (fn) => granted.size === 0 || granted.has(fn),
  };
}

export interface Course {
  id: number;
  name: string;
  short: string;
  url: string;
  /** Ya terminó, según su fecha de cierre en Moodle. */
  ended: boolean;
}

const visible = (o: Record<string, unknown>) => o.visible !== 0 && o.visible !== false && o.uservisible !== false && o.hidden !== true;

/** Los cursos de la persona: los que siguen abiertos primero. */
export function shapeCourses(data: unknown, site: string, nowSec: number): Course[] {
  const out: Course[] = [];
  for (const raw of list(data)) {
    const c = obj(raw);
    const id = whole(c.id);
    if (!id || !visible(c)) continue;
    const end = whole(c.enddate);
    out.push({ id, name: line(c.fullname) || line(c.shortname) || `Curso ${id}`, short: line(c.shortname, 80), url: `${site}/course/view.php?id=${id}`, ended: end > 0 && end < nowSec });
  }
  out.sort((a, b) => Number(a.ended) - Number(b.ended) || a.name.localeCompare(b.name, "es"));
  return out.slice(0, MAX_COURSES);
}

export interface Delivery {
  /** Estable entre pedidos: sirve para el recordatorio. */
  id: string;
  title: string;
  course: number;
  courseName: string;
  /** El tipo de actividad en Moodle (assign, quiz…). */
  kind: string;
  /** Cuándo vence, en segundos desde 1970 (UTC). */
  due: number;
  url: string;
}

const KIND = /^[a-z][a-z0-9_]{0,30}$/;

/** Las entregas del calendario de la persona (`core_calendar_get_action_events_by_timesort`). */
export function shapeEvents(data: unknown, site: string, courses: Course[]): Delivery[] {
  const names = new Map(courses.map((c) => [c.id, c.name]));
  const out: Delivery[] = [];
  for (const raw of list(obj(data).events)) {
    const e = obj(raw);
    const id = whole(e.id);
    const due = whole(e.timesort) || whole(e.timestart);
    const course = obj(e.course);
    const courseId = whole(course.id) || whole(e.courseid);
    // Las fechas de apertura no son entregas.
    if (!id || !due || /open/i.test(String(e.eventtype ?? ""))) continue;
    const kind = String(e.modulename ?? "");
    out.push({
      id: `e${id}`,
      title: line(e.activityname) || line(e.name) || "Actividad",
      course: courseId,
      courseName: names.get(courseId) ?? line(course.fullname),
      kind: KIND.test(kind) ? kind : "",
      due,
      url: safeLink(e.url, site) || safeLink(obj(e.action).url, site),
    });
  }
  return out.slice(0, MAX_EVENTS);
}

/** Las tareas con fecha de entrega (`mod_assign_get_assignments`): el camino de reserva si el calendario no se deja leer. */
export function shapeAssignments(data: unknown, site: string, nowSec: number): Delivery[] {
  const out: Delivery[] = [];
  for (const rawCourse of list(obj(data).courses)) {
    const c = obj(rawCourse);
    const courseId = whole(c.id);
    for (const raw of list(c.assignments)) {
      const a = obj(raw);
      const id = whole(a.id);
      const due = whole(a.duedate);
      if (!id || !due || due < nowSec || due > nowSec + AHEAD_DAYS * 86_400) continue;
      const cmid = whole(a.cmid);
      out.push({ id: `a${id}`, title: line(a.name) || "Tarea", course: courseId, courseName: line(c.fullname), kind: "assign", due, url: cmid ? `${site}/mod/assign/view.php?id=${cmid}` : "" });
    }
  }
  return out.slice(0, MAX_EVENTS);
}

export interface CourseItem {
  id: number;
  name: string;
  kind: string;
  /** El nombre del tipo, como lo dice Moodle («Tarea», «Página»…). */
  kindName: string;
  url: string;
  /** La descripción o el texto de la página, en texto plano y recortado. */
  text: string;
  /** Las fechas que Moodle anuncia para la actividad. */
  dates: { label: string; at: number }[];
  /** Los nombres de sus archivos (solo los nombres). */
  files: string[];
}

export interface CourseSection {
  name: string;
  summary: string;
  items: CourseItem[];
}

/** El texto de cada página del curso, por su número de actividad (`mod_page_get_pages_by_courses`). */
export function shapePages(data: unknown): Map<number, string> {
  const out = new Map<number, string>();
  for (const raw of list(obj(data).pages)) {
    const p = obj(raw);
    const cm = whole(p.coursemodule);
    const text = clip(p.content);
    if (cm && text) out.set(cm, text);
  }
  return out;
}

/** ¿El curso tiene páginas? (para no pedirlas si no hay). */
export const hasPages = (contents: unknown): boolean => list(contents).some((s) => list(obj(s).modules).some((m) => obj(m).modname === "page"));

/** Las secciones de un curso con sus actividades y materiales (`core_course_get_contents`). */
export function shapeContents(contents: unknown, site: string, pages: Map<number, string> = new Map()): { sections: CourseSection[]; cut: boolean } {
  const sections: CourseSection[] = [];
  let count = 0;
  let cut = false;
  for (const rawSection of list(contents)) {
    const s = obj(rawSection);
    if (!visible(s)) continue;
    if (sections.length >= MAX_SECTIONS) {
      cut = true;
      break;
    }
    const items: CourseItem[] = [];
    for (const rawModule of list(s.modules)) {
      const m = obj(rawModule);
      const id = whole(m.id);
      if (!id || !visible(m)) continue;
      if (count >= MAX_ITEMS) {
        cut = true;
        break;
      }
      count += 1;
      const kind = String(m.modname ?? "");
      const files = list(m.contents)
        .map((f) => line(obj(f).filename, 120))
        .filter((name) => name && name !== "index.html")
        .slice(0, 8);
      const dates = list(m.dates)
        .map((d) => ({ label: line(obj(d).label, 60).replace(/:$/, ""), at: whole(obj(d).timestamp) }))
        .filter((d) => d.at > 0)
        .slice(0, 4);
      items.push({
        id,
        name: line(m.name) || "Actividad",
        kind: KIND.test(kind) ? kind : "",
        kindName: line(m.modplural, 40),
        url: safeLink(m.url, site),
        text: pages.get(id) ?? clip(m.description),
        dates,
        files,
      });
    }
    const name = line(s.name) || `Sección ${sections.length + 1}`;
    const summary = clip(s.summary, 400);
    if (items.length || summary) sections.push({ name, summary, items });
  }
  return { sections, cut };
}

/* --- La red ---------------------------------------------------------------------------------- */

/** El cuerpo de una respuesta, hasta `max` bytes; `null` si se pasa. No confía en Content-Length. */
export async function readCapped(response: Response, max = MAX_BYTES): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    all.set(chunk, at);
    at += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}
