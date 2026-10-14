/* =============================================================================
   Mis notas (beta) · la lógica pura de la función `pilo-genesis`.

   Todo lo que la función decide sin tocar la red ni la base: qué portales de
   Génesis hay (uno por sede) y qué dirección se le acepta a cada uno, qué
   rutas de Génesis se pueden llamar (lista cerrada),
   cómo se arma cada pedido, qué significa cada respuesta, qué queda de ellas
   antes de devolverlas al navegador (lo personal se descarta aquí) y cómo se
   firma y se comprueba el permiso que guarda el dispositivo.

   La función del servidor (supabase/functions/pilo-genesis/index.ts) es un
   solo archivo, porque el editor del panel de Supabase solo acepta uno, y
   lleva dentro una copia exacta de este archivo. La prueba
   servidor-sync.test.ts falla si las dos se separan: al cambiar algo aquí,
   hay que copiarlo también en index.ts.

   Por eso este archivo no importa nada y no usa nada propio de Deno ni del
   navegador: vale igual en los dos lados, y la prueba vitest
   (servidor.test.ts) lo importa tal cual. Los tipos de lo que devuelve la
   función (NotaPeriod, NotaCourse…) los usa también la interfaz (logic.ts).

   La validación de la dirección es la de Moodle (pilo-clases): solo https,
   nombre de dominio público, sin IP escrita de ninguna forma, sin usuario,
   consulta ni ancla y con las rutas fijas. La única diferencia: Génesis
   atiende en un puerto propio, así que se admite un puerto explícito.
   ========================================================================== */

/* --- La lista cerrada ------------------------------------------------------------------------ */

/**
 * Las únicas rutas de Génesis que esta función llama. El ingreso entrega el
 * permiso; las otras tres leen: el polígrafo, el récord de notas y el
 * polígrafo oficial en PDF. Ninguna matricula, cambia datos ni escribe nada.
 */
export const GENESIS_ROUTES = {
  ingreso: { method: "POST", path: "/genesis/mod_auth/login/" },
  poligrafo: { method: "GET", path: "/genesis/mod_polygraph/polygraph/student/{codigo}/" },
  record: { method: "POST", path: "/genesis/mod_scores_hist/scores_hist/get_scores/" },
  poligrafo_pdf: { method: "POST", path: "/genesis/mod_polygraph/polygraph/student/download/" },
} as const;
export type GenesisRoute = keyof typeof GENESIS_ROUTES;
export const isGenesisRoute = (v: unknown): v is GenesisRoute => typeof v === "string" && Object.prototype.hasOwnProperty.call(GENESIS_ROUTES, v);

/** El único perfil de Génesis al que se le leen notas. */
export const GENESIS_STUDENT = "estudiante";

/** Topes de cada pedido a esta función. */
export const CALL_MS = 15_000;
export const TOTAL_MS = 28_000;
export const MAX_CALLS = 2;
/** Lo más que se lee de una respuesta de Génesis; el PDF, en base64, pesa más. */
export const MAX_BYTES = 3_000_000;
export const MAX_PDF_BYTES = 8_000_000;
export const MAX_PERIODS = 60;
export const MAX_COURSES = 40;
/** Cuántos portales de Génesis (uno por sede) puede configurar la administración. */
export const MAX_PORTALS = 12;
/** Cuánto vale el permiso que guarda el dispositivo. */
export const PERMIT_SECONDS = 12 * 3600;

/* --- La dirección de Génesis ----------------------------------------------------------------- */

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
const HOST_REASON = "La dirección de Génesis debe ser un nombre de dominio público, no una dirección IP ni un nombre de red interna.";

export type GenesisSite = { ok: true; site: string; host: string; port: number } | { ok: false; reason: string };

/**
 * La dirección de Génesis que configuró la administración, revisada: solo
 * https, con nombre de dominio público (ni IP escrita de ninguna forma, ni
 * localhost, ni nombres de red interna), sin usuario, consulta ni ancla. Puede
 * llevar un puerto explícito (Génesis atiende en uno propio) y nada de ruta:
 * las rutas son las de GENESIS_ROUTES, nunca las que diga quien configura.
 */
export function genesisSite(raw0: unknown): GenesisSite {
  const no = (reason: string) => ({ ok: false as const, reason });
  const raw = typeof raw0 === "string" ? raw0.trim() : "";
  if (!raw) return no("Falta la dirección de Génesis.");
  if (raw.length > 300 || /[\s\\@%]/.test(raw) || raw.includes("..")) return no("La dirección de Génesis no es válida.");
  if (!/^https:\/\//i.test(raw)) return no("La dirección de Génesis debe empezar por https://.");
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return no("La dirección de Génesis no es válida.");
  }
  if (u.protocol !== "https:" || u.username || u.password) return no("La dirección de Génesis debe empezar por https:// y no llevar usuario.");
  if (u.search || u.hash || raw.includes("?") || raw.includes("#")) return no("La dirección de Génesis no puede llevar consulta (?…) ni ancla (#…).");
  const host = u.hostname.toLowerCase().replace(/\.$/, "");
  // Una IP escrita como sea (decimal, hexadecimal, IPv6) queda aquí: el nombre debe terminar en un dominio de letras.
  if (host.startsWith("[") || host.includes(":") || !/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24}|xn--[a-z0-9-]{2,59})$/.test(host)) return no(HOST_REASON);
  if (BLOCKED_HOST.test(host)) return no(HOST_REASON);
  // El puerto, si viene, es un número de puerto y nada más (el 443 se da por dicho y no se escribe).
  const port = u.port ? Number(u.port) : 0;
  if (u.port && (!/^\d{1,5}$/.test(u.port) || port < 1 || port > 65535)) return no("El puerto de la dirección de Génesis no es válido.");
  // Solo la entrada del sitio: sin ruta, o con el «/genesis» de sus direcciones, que se quita.
  const path = u.pathname.replace(/\/+$/, "").toLowerCase();
  if (path && path !== "/genesis") return no("La dirección de Génesis es solo la de entrada al sitio, sin ruta.");
  return { ok: true, site: `https://${host}${port ? `:${port}` : ""}`, host, port: port || 443 };
}

/* --- Los portales: uno por sede --------------------------------------------------------------- */

/** El id de un portal: corto y estable. Es lo único que manda el navegador; la dirección, nunca. */
export const portalIdShape = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(v);

export interface GenesisPortal {
  id: string;
  /** El nombre que ve el estudiante («Bucaramanga», «Cúcuta», «TEC»…): lo escribe la administración. */
  name: string;
  /** La dirección de entrada, ya revisada. No sale de la función. */
  site: string;
  host: string;
}

/**
 * Los portales que configuró la administración (`[{ id, name, url }]`), ya
 * revisados: el que no tenga un id con buena forma, un nombre o una dirección
 * que pase genesisSite, no cuenta; tampoco un id repetido. Hasta MAX_PORTALS,
 * en el orden en que se guardaron.
 */
export function genesisPortals(raw: unknown): GenesisPortal[] {
  const out: GenesisPortal[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (out.length >= MAX_PORTALS) break;
    const p = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    // deno-lint-ignore no-control-regex
    const name = typeof p.name === "string" ? p.name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    const site = genesisSite(p.url);
    if (!portalIdShape(p.id) || !name || !site.ok || out.some((x) => x.id === p.id)) continue;
    out.push({ id: p.id, name, site: site.site, host: site.host });
  }
  return out;
}

/** Lo que la app puede saber de los portales: su id y su nombre. La dirección no viaja. */
export const publicPortals = (portals: GenesisPortal[]): { id: string; name: string }[] => portals.map((p) => ({ id: p.id, name: p.name }));

/** El portal con ese id; `null` si no es un id o no está configurado. */
export const findPortal = (portals: GenesisPortal[], id: unknown): GenesisPortal | null => (portalIdShape(id) ? (portals.find((p) => p.id === id) ?? null) : null);

/* --- Los pedidos ----------------------------------------------------------------------------- */

/** El código del estudiante: solo dígitos (once, en la UDES; se admite algo más por si cambia). */
export const codeShape = (v: unknown): v is string => typeof v === "string" && /^\d{6,15}$/.test(v);
/** El permiso y la llave de Génesis: 40 caracteres opacos (se admite algo más por si cambian). */
export const keyShape = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9]{20,128}$/.test(v);
/** Un periodo académico: «2024B». */
export const periodShape = (v: unknown): v is string => typeof v === "string" && /^\d{4}[A-Z0-9]{1,2}$/.test(v);

export interface GenesisAccess {
  token: string;
  apiKey: string;
  /** El código del estudiante: el que devolvió el ingreso, nunca el que diga el navegador. */
  code: string;
}

/**
 * La dirección de un pedido a Génesis: una ruta de la lista cerrada y, salvo
 * en el ingreso, el permiso y la llave en la consulta, que es como Génesis los
 * recibe. `null` si la ruta no está en la lista o falta algo.
 */
export function genesisAddress(site: string, route: string, access?: GenesisAccess): string | null {
  if (!isGenesisRoute(route)) return null;
  const path: string = GENESIS_ROUTES[route].path;
  if (route === "ingreso") return `${site}${path}`;
  if (!access || !keyShape(access.token) || !keyShape(access.apiKey) || !codeShape(access.code)) return null;
  const query = new URLSearchParams();
  query.set("token", access.token);
  query.set("api_key", access.apiKey);
  return `${site}${path.replace("{codigo}", access.code)}?${query.toString()}`;
}

/** El cuerpo del ingreso: el código y la contraseña, tal como los pide Génesis. */
export const loginBody = (code: string, password: string): string => JSON.stringify({ login: code, password });
/** El cuerpo del récord de notas. */
export const recordBody = (code: string): string => JSON.stringify({ code });
/** El cuerpo de la descarga del polígrafo: el del portal del estudiante. */
export const pdfBody = (code: string, period: string): string => JSON.stringify({ period, code, name_doc: `poligrafo_${code}.pdf`, type: ".pdf", exists_doc: false });

/** Lo que la persona escribe para conectar; `null` si falta algo o no tiene forma de código y contraseña. */
export function credentials(body: Record<string, unknown>): { code: string; password: string } | null {
  const code = typeof body.code === "string" ? body.code.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!codeShape(code)) return null;
  if (!password || password.length > 200) return null;
  return { code, password };
}

/* --- Los errores ----------------------------------------------------------------------------- */

/** Los códigos con que esta función responde un fallo. La página los traduce a un estado. */
export type GenesisCode =
  | "sesion" | "cuenta" | "perfil" | "suspendida" | "limite" | "no_disponible" | "datos"
  | "credenciales" | "no_estudiante" | "permiso" | "pdf" | "portal"
  | "tiempo" | "red" | "tamano" | "genesis" | "interno";

export interface Fault {
  code: GenesisCode;
  message: string;
  status: number;
}

/** Los textos son de esta función: lo que diga Génesis no viaja a la página (podría nombrar a la persona). */
export const FAULTS = {
  credenciales: { code: "credenciales", message: "Génesis no aceptó ese usuario y esa contraseña. Revíselos e intente de nuevo.", status: 401 },
  permiso: { code: "permiso", message: "Su permiso de Génesis venció o fue retirado. Conecte de nuevo sus notas.", status: 401 },
  no_estudiante: { code: "no_estudiante", message: "Mis notas es para estudiantes: esa cuenta de Génesis no es de estudiante.", status: 403 },
  genesis: { code: "genesis", message: "Génesis no respondió como se esperaba. Intente de nuevo en un momento.", status: 502 },
  tiempo: { code: "tiempo", message: "Génesis tardó demasiado en responder. Intente de nuevo en un momento.", status: 504 },
  red: { code: "red", message: "No pude conectarme con Génesis. Intente de nuevo en un momento.", status: 502 },
  tamano: { code: "tamano", message: "Génesis devolvió más de lo que Pilo puede leer de una vez.", status: 502 },
  pdf: { code: "pdf", message: "Génesis no entregó el polígrafo en PDF. Intente de nuevo en un momento.", status: 502 },
  portal: { code: "portal", message: "Elija su sede: esa no está entre los portales de Génesis que Pilo puede leer.", status: 400 },
} as const satisfies Record<string, Fault>;

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * Lo que respondió Génesis (`{ msg, code }`), leído: lo que trae, o qué pasó
 * en palabras de esta función. Un 401 en el ingreso es la contraseña; en una
 * consulta, que el permiso ya no sirve.
 */
export function genesisReply(status: number, data: unknown, where: "ingreso" | "consulta"): { ok: true; msg: unknown } | { ok: false; fault: Fault } {
  const d = obj(data);
  const said = Number(d.code);
  const code = Number.isInteger(said) && said >= 100 && said <= 599 ? said : status;
  const worst = Math.max(code, status);
  if (worst === 401 || worst === 403) return { ok: false, fault: where === "ingreso" ? FAULTS.credenciales : FAULTS.permiso };
  if (worst < 200 || worst >= 300 || !("msg" in d)) return { ok: false, fault: FAULTS.genesis };
  return { ok: true, msg: d.msg };
}

/* --- Lo que se devuelve ---------------------------------------------------------------------- */

/** Un texto de una línea, recortado, sin caracteres de control. */
// deno-lint-ignore no-control-regex
const line = (v: unknown, max = 160): string => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Una nota o un promedio: un número entre 0 y 10 con dos decimales. Génesis a veces lo manda como texto («3.5»). */
export function grade(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\s*\d{1,2}([.,]\d{1,4})?\s*$/.test(v) ? Number(v.trim().replace(",", ".")) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 10 ? Math.round(n * 100) / 100 : null;
}

/** Una cantidad de créditos: un entero que no es negativo. */
const count = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2000 ? v : 0);
/** Un porcentaje de avance, entre 0 y 100; `null` si Génesis no lo dice. */
const percent = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null);
const courseCode = (v: unknown): string => {
  const text = typeof v === "string" || typeof v === "number" ? String(v).trim() : "";
  return /^[A-Za-z0-9._-]{1,20}$/.test(text) ? text : "";
};

/** El encabezado: lo único del ingreso que sale de la función. Nada de esto identifica a la persona. */
export interface NotasHead {
  /** El programa que cursa, como lo nombra Génesis. */
  program: string;
  /** Su periodo vigente en Génesis («2024B»); vacío si no lo dice. */
  period: string;
  /** Cuánto lleva del plan de estudios, en porcentaje de créditos. */
  creditsPercent: number | null;
}

export type LoginResult = { ok: true; access: GenesisAccess; head: NotasHead } | { ok: false; fault: Fault };

/**
 * Lo que queda del ingreso. Génesis responde con el nombre, los apellidos, el
 * documento, los teléfonos y el correo de la persona: nada de eso se copia.
 * Solo salen el permiso y la llave (que después viajan firmados), el código
 * que Génesis dice que es el de quien entró, y el encabezado. Si la cuenta no
 * es de estudiante, o el código no es el que se escribió, no hay permiso.
 */
export function shapeLogin(msg: unknown, typed: string): LoginResult {
  const m = obj(msg);
  const token = m.access_token;
  const apiKey = m.api_key;
  const code = typeof m.user === "string" || typeof m.user === "number" ? String(m.user).trim() : "";
  if (!keyShape(token) || !keyShape(apiKey) || !codeShape(code) || code !== typed) return { ok: false, fault: FAULTS.genesis };
  if (line(m.user_type, 40).toLowerCase() !== GENESIS_STUDENT) return { ok: false, fault: FAULTS.no_estudiante };
  const period = obj(m.current_info).semester;
  return {
    ok: true,
    access: { token, apiKey, code },
    head: { program: line(m.program), period: periodShape(period) ? period : "", creditsPercent: percent(m.complete_credits_percent) },
  };
}

export interface NotaCourse {
  /** El código de la materia en Génesis: el mismo cuando se repite en otro periodo. */
  code: string;
  name: string;
  credits: number;
  /** La definitiva; `null` si Génesis no trae un número. */
  def: number | null;
  approved: boolean;
  homologated: boolean;
  /** El grupo, cuando el récord lo trae y dice algo distinto del nombre. */
  group: string;
  /** La nota mínima para aprobar (3,0 o 3,5), cuando el récord la trae. */
  min: number | null;
}

export interface NotaPeriod {
  /** «2024B». */
  id: string;
  /** El promedio del semestre y el acumulado hasta ese periodo, como los calcula Génesis. */
  average: number | null;
  accumulated: number | null;
  /** Los créditos cursados y aprobados en el periodo. */
  credits: number;
  creditsApproved: number;
  /** Los créditos aprobados hasta ese periodo. */
  totalApproved: number;
  courses: NotaCourse[];
}

const byPeriod = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** El polígrafo: por periodo, sus promedios, sus créditos y sus materias. Del más antiguo al más reciente. */
export function shapePolygraph(msg: unknown): NotaPeriod[] {
  const out: NotaPeriod[] = [];
  for (const raw of list(msg)) {
    const p = obj(raw);
    if (!periodShape(p.semester) || out.some((x) => x.id === p.semester)) continue;
    const courses: NotaCourse[] = [];
    for (const rawCourse of list(p.courses).slice(0, MAX_COURSES)) {
      const c = obj(rawCourse);
      const code = courseCode(c.code);
      const name = line(c.name);
      if (!code && !name) continue;
      courses.push({ code, name, credits: count(c.credits), def: grade(c.def), approved: c.approved === true, homologated: c.homologation === true, group: "", min: null });
    }
    out.push({
      id: p.semester,
      average: grade(p.semester_average),
      accumulated: grade(p.accumulated_average),
      credits: count(p.credits_semester),
      creditsApproved: count(p.credits_approved_sem),
      totalApproved: count(p.credits_approved),
      courses,
    });
  }
  return out.sort(byPeriod).slice(-MAX_PERIODS);
}

/** Una materia del récord de notas: lo que completa al polígrafo. */
export interface RecordCourse {
  code: string;
  /** Génesis llama «group» al nombre de la materia con su grupo. */
  group: string;
  credits: number;
  def: number | null;
  approved: boolean;
  min: number | null;
}

/** El récord de notas (`[{ "<periodo>": [materias] }]`), por periodo. */
export function shapeRecord(msg: unknown): Map<string, RecordCourse[]> {
  const out = new Map<string, RecordCourse[]>();
  for (const raw of list(msg)) {
    for (const [period, rows] of Object.entries(obj(raw))) {
      if (!periodShape(period)) continue;
      const courses = out.get(period) ?? [];
      for (const rawCourse of list(rows)) {
        if (courses.length >= MAX_COURSES) break;
        const c = obj(rawCourse);
        const code = courseCode(c.code_cou);
        const group = line(c.group);
        if (!code && !group) continue;
        const min = grade(c.apro);
        courses.push({ code, group, credits: count(c.credits), def: grade(c.def), approved: c.approved === true, min: min !== null && min > 0 ? min : null });
      }
      out.set(period, courses);
    }
  }
  return out;
}

const same = (a: string, b: string) => a.toLowerCase().replace(/\s+/g, " ").trim() === b.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * El histórico: el polígrafo, completado con el récord por periodo y código de
 * materia (el grupo y la nota mínima). Lo que solo está en el récord —una
 * materia o un periodo entero— también sale, sin promedios que nadie calculó.
 */
export function mergeHistory(polygraph: NotaPeriod[], record: Map<string, RecordCourse[]>): NotaPeriod[] {
  const out: NotaPeriod[] = polygraph.map((p) => ({ ...p, courses: p.courses.map((c) => ({ ...c })) }));
  for (const [period, rows] of record) {
    let target = out.find((p) => p.id === period);
    if (!target) {
      target = { id: period, average: null, accumulated: null, credits: 0, creditsApproved: 0, totalApproved: 0, courses: [] };
      out.push(target);
    }
    for (const r of rows) {
      const found = target.courses.find((c) => (r.code && c.code === r.code) || (!r.code && same(c.name, r.group)));
      if (found) {
        found.min = r.min;
        if (!found.name) found.name = r.group;
        else if (r.group && !same(found.name, r.group)) found.group = r.group;
        if (found.def === null) found.def = r.def;
        if (!found.credits) found.credits = r.credits;
      } else if (target.courses.length < MAX_COURSES) {
        target.courses.push({ code: r.code, name: r.group, credits: r.credits, def: r.def, approved: r.approved, homologated: false, group: "", min: r.min });
      }
    }
  }
  return out.sort(byPeriod).slice(-MAX_PERIODS);
}

/** El PDF del polígrafo, en base64 y sin espacios; `null` si lo que llegó no es un PDF. */
export function pdfBase64(msg: unknown): string | null {
  if (typeof msg !== "string") return null;
  const text = msg.replace(/^data:application\/pdf;base64,/i, "").replace(/\s+/g, "");
  // «JVBER» es «%PDF» en base64: lo que no empiece así no es un PDF.
  if (text.length < 200 || text.length > MAX_PDF_BYTES || !text.startsWith("JVBER") || !/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  return text;
}

/* --- El permiso firmado ---------------------------------------------------------------------- */

/** Lo que amarra el permiso: el acceso a Génesis, el portal en que se entró, el periodo vigente, la cuenta de Pilo que lo pidió y cuándo vence. */
export interface PermitData extends GenesisAccess {
  /** El id del portal (la sede) en que se entró: las consultas van a ese y a ningún otro. */
  portal: string;
  /** La marca de la dirección que tenía ese portal al entrar (portalMark): si la cambian, el permiso deja de valer. */
  mark: string;
  period: string;
  /** La cuenta de Pilo que conectó: otra cuenta no puede usar este permiso. */
  owner: string;
  /** Cuándo vence, en segundos desde 1970 (UTC). */
  exp: number;
}

/** La forma de un permiso firmado: «v1.<datos>.<firma>». */
export const permitShape = (v: unknown): v is string => typeof v === "string" && /^v1\.[A-Za-z0-9_-]{40,1600}\.[A-Za-z0-9_-]{43}$/.test(v);

const toBase64Url = (bytes: Uint8Array): string => {
  let text = "";
  for (const b of bytes) text += String.fromCharCode(b);
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const fromBase64Url = (text: string): Uint8Array | null => {
  try {
    const raw = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
};

const bytesOf = (text: string): Uint8Array => {
  const encoded = new TextEncoder().encode(text);
  const bytes = new Uint8Array(new ArrayBuffer(encoded.byteLength));
  bytes.set(encoded);
  return bytes;
};

/** La llave de la firma sale del secreto del servidor, con su propio rótulo: el secreto no se usa tal cual. */
async function permitKey(secret: string): Promise<CryptoKey> {
  if (typeof secret !== "string" || secret.length < 16) throw new Error("secreto");
  return await crypto.subtle.importKey("raw", bytesOf(`pilo-genesis:permiso:v1|${secret}`) as unknown as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/**
 * La marca de la dirección de un portal: una huella corta, para amarrarla al
 * permiso sin que la dirección viaje al dispositivo.
 */
export async function portalMark(site: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytesOf(`pilo-genesis:portal:v1|${site}`) as unknown as ArrayBuffer));
  return toBase64Url(digest.slice(0, 12));
}

/**
 * El permiso que guarda el dispositivo: el acceso a Génesis, el código del
 * estudiante, el portal, la cuenta de Pilo y el vencimiento, firmados con HMAC-SHA-256 y
 * un secreto que solo tiene el servidor. Quien lo tenga puede leerlo, pero no
 * cambiarle el código ni alargarle la vida: la firma dejaría de cuadrar.
 */
export async function signPermit(data: PermitData, secret: string): Promise<string> {
  const body = toBase64Url(bytesOf(JSON.stringify({ t: data.token, k: data.apiKey, c: data.code, s: data.portal, m: data.mark, p: data.period, o: data.owner, e: data.exp })));
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", await permitKey(secret), bytesOf(`v1.${body}`) as unknown as ArrayBuffer));
  return `v1.${body}.${toBase64Url(mac)}`;
}

export type OpenPermit = { ok: true; data: PermitData } | { ok: false; why: "forma" | "firma" | "vencido" | "cuenta" };

/**
 * Abre un permiso que llega del navegador: primero la firma (si no cuadra, no
 * se lee nada de él), después el vencimiento y la cuenta de Pilo. El código
 * del estudiante de cada consulta sale de aquí.
 */
export async function openPermit(permit: unknown, secret: string, owner: string, nowSec: number): Promise<OpenPermit> {
  if (!permitShape(permit)) return { ok: false, why: "forma" };
  const [, body, mac] = permit.split(".");
  const signature = fromBase64Url(mac);
  if (!signature) return { ok: false, why: "forma" };
  const good = await crypto.subtle.verify("HMAC", await permitKey(secret), signature as unknown as ArrayBuffer, bytesOf(`v1.${body}`) as unknown as ArrayBuffer);
  if (!good) return { ok: false, why: "firma" };
  let d: Record<string, unknown>;
  try {
    d = obj(JSON.parse(new TextDecoder().decode(fromBase64Url(body) ?? new Uint8Array())));
  } catch {
    return { ok: false, why: "forma" };
  }
  const exp = Number(d.e);
  if (!keyShape(d.t) || !keyShape(d.k) || !codeShape(d.c) || !portalIdShape(d.s) || typeof d.m !== "string" || !/^[A-Za-z0-9_-]{16}$/.test(d.m) || typeof d.o !== "string" || !d.o || !Number.isInteger(exp)) return { ok: false, why: "forma" };
  if (exp <= nowSec) return { ok: false, why: "vencido" };
  if (d.o !== owner) return { ok: false, why: "cuenta" };
  return { ok: true, data: { token: d.t, apiKey: d.k, code: d.c, portal: d.s, mark: d.m, period: periodShape(d.p) ? d.p : "", owner: d.o, exp } };
}

/**
 * El portal al que van las consultas de un permiso ya abierto: el que dice el
 * permiso, y solo si sigue configurado con la misma dirección que tenía al
 * entrar. Si lo quitaron o le cambiaron la dirección, `null`: el permiso ya
 * no vale y hay que entrar de nuevo. Nunca se usa otro portal en su lugar.
 */
export async function permitPortal(portals: GenesisPortal[], data: Pick<PermitData, "portal" | "mark">): Promise<GenesisPortal | null> {
  const portal = findPortal(portals, data.portal);
  if (!portal) return null;
  return (await portalMark(portal.site)) === data.mark ? portal : null;
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
