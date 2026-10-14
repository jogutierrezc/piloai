/* =============================================================================
   Edge Function · pilo-genesis · «Mis notas» (beta)

   Un estudiante con cuenta de Pilo conecta Génesis (el portal del estudiante)
   con su propio código y contraseña, y Pilo le muestra su histórico de notas
   por periodo y su polígrafo oficial. Es un puente SOLO DE LECTURA y SIN
   ESTADO entre el navegador de la persona y el Génesis de la universidad.

   Lo que esta función NO hace, nunca:
     · No guarda nada de Génesis: ni la contraseña, ni el permiso, ni las
       notas. No escribe en ninguna tabla, no anota en la bitácora y no usa
       `console`. Lo único que deja en la base es el contador del límite de
       pedidos (`pilo_visitor_hit`): una huella con sal diaria de la cuenta de
       Pilo o de la dirección, sin nada de Génesis.
     · No escribe en Génesis: solo llama las rutas de GENESIS_ROUTES (más
       abajo): el ingreso y tres lecturas. No matricula ni cambia datos.
     · No devuelve datos personales: el ingreso de Génesis trae nombre,
       apellidos, documento, teléfonos y correo; se descartan aquí (shapeLogin).
     · No acepta una dirección del navegador. Génesis tiene un portal por
       sede: la lista sale de lo que configuró la administración
       (`pilo_spaces`, fila «ensenanza», `genesis_portals`, y solo si
       `genesis_on`). El navegador manda el id de la sede y nada más; la
       dirección de ese portal se revisa (solo https, dominio público, sin IP
       ni red interna, DNS comprobado, rutas fijas; puede llevar puerto) y no
       se siguen redirecciones. A la app solo le llegan el id y el nombre.
     · No acepta un código de estudiante del navegador: el ingreso devuelve un
       permiso firmado (HMAC-SHA-256, con un secreto que solo tiene esta
       función) que amarra el acceso a Génesis, el código que Génesis dijo que
       es el de quien entró, el portal en que entró, la cuenta de Pilo y un
       vencimiento. Cada consulta usa el código y el portal de ese permiso; si
       la firma no cuadra, o ese portal ya no está o cambió de dirección, se
       rechaza y hay que entrar de nuevo.

   Quién puede llamar: solo una cuenta de Pilo activa (0120) con perfil de
   estudiante, y solo si Génesis dice que quien entró es estudiante. La sesión
   se comprueba aquí (verify_jwt = false).

   El secreto de la firma: PILO_GENESIS_SECRET (recomendado: uno propio, de 32
   caracteres o más; al cambiarlo, los permisos ya entregados dejan de servir).
   Sin él se usa la llave de servicio del proyecto, que tampoco sale de aquí.

   Red interna: PILO_GENESIS_RED_INTERNA («true» para encenderlo) deja llamar a
   un portal de Génesis cuya dirección responde en una red privada. Para eso
   está: cuando esta función corre dentro de la red de la universidad (un
   Supabase propio, no la nube), el DNS de la universidad responde los portales
   de Génesis con su dirección interna y, con la regla de siempre, ninguno pasa.
   Apagado (lo normal), la regla sigue: solo direcciones públicas.

   Acciones (POST, JSON, con la sesión de la cuenta de Pilo):
     { action: "portales" }                 → { on, portals: [{ id, name }] }
     { action: "conectar", portal, code, password }
                                            → { permit, expires, head, portal: { id, name } }
     { action: "historico", permit }        → { periods, record, advice }
                                              (advice: la administración encendió las recomendaciones con IA)
     { action: "poligrafo_pdf", permit }    → { pdf, name }

   Los errores llevan `error` (para la persona) y `code` (para la página).

   Un solo archivo: el editor del panel de Supabase solo acepta uno. Por eso la
   lógica pura va pegada aquí dentro (ver «lógica», más abajo).

   Despliegue:
     supabase functions deploy pilo-genesis
     (o pegando este archivo en el editor del panel de Supabase)
   ========================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

// --- lógica: copia exacta de src/modules/pilo-app/notas/servidor-logica.ts (la prueba servidor-sync lo vigila)
// Va dentro para que la función sea un solo archivo y se pueda desplegar
// también pegándola en el editor del panel de Supabase.

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

// --- fin de la lógica -------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Ninguna respuesta se guarda en una caché: llevan el permiso o las notas de una persona. */
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
}

const fail = (fault: Fault) => json({ error: fault.message, code: fault.code }, fault.status);

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const timedOut = (error: unknown) => error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError");

const OFF: Fault = { code: "no_disponible", message: "Mis notas aún no está disponible: la universidad todavía no ha conectado a Pilo con Génesis.", status: 503 };

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "La función no está configurada correctamente.", code: "interno" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "El pedido no es JSON.", code: "datos" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "El pedido no es JSON.", code: "datos" }, 400);
  const action = String(body.action ?? "");
  if (!["portales", "conectar", "historico", "poligrafo_pdf"].includes(action)) return json({ error: "Acción desconocida.", code: "datos" }, 400);

  try {
    /* --- Quién llama: solo una cuenta de Pilo activa, de estudiante ---------------------------- */
    const authorization = request.headers.get("Authorization") ?? "";
    const noSession = () => json({ error: "Para ver sus notas, entre con su cuenta de Pilo.", code: "sesion" }, 401);
    if (!authorization.startsWith("Bearer ") || authorization.slice(7) === anonKey) return noSession();
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const who = await caller.auth.getUser();
    if (who.error || !who.data.user) return noSession();
    const userId = who.data.user.id;

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const found = await admin.from("pilo_users").select("rol, status").eq("id", userId).maybeSingle();
    if (found.error) return json({ error: "No pude revisar su cuenta de Pilo.", code: "interno" }, 500);
    const account = found.data as { rol: string; status: string } | null;
    if (!account) return json({ error: "Mis notas es para quienes tienen cuenta de Pilo de estudiante.", code: "cuenta" }, 403);
    if (account.status !== "activa") return json({ error: "Su cuenta de Pilo está suspendida. Escriba a la administración.", code: "suspendida" }, 403);
    if (account.rol !== "estudiante") return json({ error: "Mis notas es para estudiantes.", code: "perfil" }, 403);

    /* --- El límite: por cuenta y por dirección. De quien llama solo queda una huella con sal diaria. */
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-direccion";
    const limited = async (scope: string, limit: number, windowSeconds: number, key: string): Promise<number | null> => {
      const salt = Deno.env.get("PILO_VISITOR_SALT") || serviceKey;
      const now = Date.now();
      const start = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
      const visitorId = (await sha256(`${salt}|${new Date().toISOString().slice(0, 10)}|genesis:${scope}|${key}`)).slice(0, 40);
      const { data, error } = await admin.rpc("pilo_visitor_hit", { p_visitor: visitorId, p_window_start: new Date(start).toISOString() });
      // Sin la tabla del límite (0110) no se limita: mejor atender que dejar a todos fuera.
      if (error) return null;
      return Number(data ?? 0) > limit ? Math.max(1, Math.ceil((start + windowSeconds * 1000 - now) / 1000)) : null;
    };
    // «conectar» prueba una contraseña de Génesis: pocos intentos, para que esto no sirva para adivinarla.
    const [perUser, perIp] = action === "conectar" ? [6, 20] : action === "historico" ? [30, 90] : action === "portales" ? [60, 180] : [10, 30];
    const retry = (await limited(`${action}:u`, perUser, 600, userId)) ?? (await limited(`${action}:i`, perIp, 600, ip));
    if (retry) return json({ error: "Va muy rápido: espere un momento antes de volver a intentarlo.", code: "limite", retry_after: retry }, 429, { "Retry-After": String(retry) });

    /* --- Los portales de Génesis: los de la administración, nunca una dirección del navegador --- */
    const space = await admin.from("pilo_spaces").select("genesis_on, genesis_portals, genesis_advice").eq("id", "ensenanza").maybeSingle();
    const row = (space.data ?? null) as { genesis_on?: unknown; genesis_portals?: unknown; genesis_advice?: unknown } | null;
    // Sin la migración 0131, sin ningún portal que pase la revisión o con Génesis apagado: aún no hay Mis notas.
    const portals = space.error || !row || row.genesis_on !== true ? [] : genesisPortals(row.genesis_portals);

    /* --- Las sedes: lo que la app puede saber (id y nombre; la dirección no viaja) -------------- */
    if (action === "portales") return json({ on: portals.length > 0, portals: publicPortals(portals) });
    if (!portals.length) return fail(OFF);

    // El secreto de la firma del permiso: solo vive aquí.
    const secret = Deno.env.get("PILO_GENESIS_SECRET") || serviceKey;

    /* --- A cuál portal: al conectar, el de la sede elegida; después, el del permiso firmado ----- */
    let site: GenesisPortal | null = null;
    let opened: PermitData | null = null;
    if (action === "conectar") {
      site = findPortal(portals, body.portal);
      if (!site) return fail(FAULTS.portal);
    } else {
      const read = await openPermit(body.permit, secret, userId, Math.floor(Date.now() / 1000));
      if (!read.ok) return fail(FAULTS.permiso);
      opened = read.data;
      // El portal es el del permiso, con la dirección que tenía al entrar: si ya no está o cambió, hay que entrar de nuevo.
      site = await permitPortal(portals, opened);
      if (!site) return fail(FAULTS.permiso);
    }
    const target = site;
    // Un nombre público que resuelve a una red interna tampoco pasa (donde la plataforma deja preguntar).
    // Con PILO_GENESIS_RED_INTERNA encendido se permite a propósito: los portales de Génesis los
    // elige la administración y, en una instalación dentro de la red de la universidad, son internos.
    const insideNetwork = ["true", "1", "si", "sí"].includes(String(Deno.env.get("PILO_GENESIS_RED_INTERNA") ?? "").trim().toLowerCase());
    const dns = (Deno as unknown as { resolveDns?: (host: string, type: string) => Promise<unknown[]> }).resolveDns;
    if (!insideNetwork && typeof dns === "function") {
      const answers = await Promise.all(["A", "AAAA"].map((type) => dns(target.host, type).then((list) => (Array.isArray(list) ? list.map(String) : []), () => [] as string[])));
      if (answers.flat().some(privateAddress)) return fail(OFF);
    }

    /* --- Un pedido a Génesis: con tope de tiempo, de tamaño y de cantidad, y sin redirecciones --- */
    const deadline = Date.now() + TOTAL_MS;
    let calls = 0;
    type Result = { ok: true; msg: unknown } | { ok: false; fault: Fault };
    const ask = async (route: GenesisRoute, access: GenesisAccess | undefined, payload: string | null, max = MAX_BYTES): Promise<Result> => {
      // Fuera de la lista cerrada no se llama nada.
      const address = genesisAddress(target.site, route, access);
      if (!address) return { ok: false, fault: FAULTS.permiso };
      const left = Math.min(CALL_MS, deadline - Date.now());
      if (calls >= MAX_CALLS || left < 1_000) return { ok: false, fault: FAULTS.tiempo };
      calls += 1;
      try {
        const response = await fetch(address, {
          method: GENESIS_ROUTES[route].method,
          headers: payload === null ? { Accept: "application/json" } : { "Content-Type": "application/json", Accept: "application/json" },
          ...(payload === null ? {} : { body: payload }),
          redirect: "error",
          signal: AbortSignal.timeout(left),
        });
        const text = await readCapped(response, max);
        if (text === null) return { ok: false, fault: FAULTS.tamano };
        let data: unknown = null;
        try {
          data = JSON.parse(text);
        } catch {
          // Sin JSON, queda el estado de la respuesta.
          data = null;
        }
        return genesisReply(response.status, data, route === "ingreso" ? "ingreso" : "consulta");
      } catch (error) {
        if (timedOut(error)) return { ok: false, fault: FAULTS.tiempo };
        // Ni el motivo ni la dirección viajan: la dirección lleva el permiso.
        return { ok: false, fault: FAULTS.red };
      }
    };

    /* --- Conectar: la contraseña se usa una vez para entrar y no se guarda ----------------------- */
    if (action === "conectar") {
      const creds = credentials(body);
      if (!creds) return json({ error: "Escriba su usuario de Génesis (solo números) y su contraseña.", code: "datos" }, 400);
      const entered = await ask("ingreso", undefined, loginBody(creds.code, creds.password));
      if (!entered.ok) return fail(entered.fault);
      // De lo que responde Génesis solo queda el acceso y el encabezado: lo personal se descarta.
      const login = shapeLogin(entered.msg, creds.code);
      if (!login.ok) return fail(login.fault);
      const expires = Math.floor(Date.now() / 1000) + PERMIT_SECONDS;
      const permit = await signPermit({ ...login.access, portal: target.id, mark: await portalMark(target.site), period: login.head.period, owner: userId, exp: expires }, secret);
      return json({ permit, expires, head: login.head, portal: { id: target.id, name: target.name } });
    }

    /* --- Lo demás lleva el permiso firmado que guarda el navegador ------------------------------- */
    if (!opened) return fail(FAULTS.permiso);
    // El código del estudiante es el del permiso: del pedido no se lee ninguno.
    const access: GenesisAccess = { token: opened.token, apiKey: opened.apiKey, code: opened.code };

    /* --- Histórico: el polígrafo, completado con el récord de notas ----------------------------- */
    if (action === "historico") {
      const [polygraph, record] = await Promise.all([ask("poligrafo", access, null), ask("record", access, recordBody(access.code))]);
      if (!polygraph.ok) return fail(polygraph.fault);
      // Si el permiso venció a mitad de camino, se dice; si el récord no se deja leer, queda el polígrafo.
      if (!record.ok && record.fault.code === "permiso") return fail(record.fault);
      const periods = mergeHistory(shapePolygraph(polygraph.msg), record.ok ? shapeRecord(record.msg) : new Map());
      return json({ periods, record: record.ok, advice: row?.genesis_advice === true });
    }

    /* --- El polígrafo oficial, en PDF, tal como lo entrega Génesis ------------------------------- */
    if (!opened.period) return fail(FAULTS.pdf);
    const file = await ask("poligrafo_pdf", access, pdfBody(access.code, opened.period), MAX_PDF_BYTES);
    if (!file.ok) return fail(file.fault);
    const pdf = pdfBase64(file.msg);
    if (!pdf) return fail(FAULTS.pdf);
    return json({ pdf, name: "poligrafo.pdf" });
  } catch {
    // Sin detalle: un error inesperado podría llevar algo del pedido.
    return json({ error: "Algo falló al leer sus notas. Intente de nuevo en un momento.", code: "interno" }, 500);
  }
});
33