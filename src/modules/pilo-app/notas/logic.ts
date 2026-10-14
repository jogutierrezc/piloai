/* =============================================================================
   Mr. Pilo · Mis notas (beta) · las reglas de la página, en un solo sitio.

   Quién ve Mis notas, a cuál portal de Génesis entra (hay uno por sede),
   dónde vive el permiso, qué quiere decir cada error de la función
   `pilo-genesis`, cómo se lee el histórico, y todo lo de
   «Mi evolución»: la tabla de promedios, la geometría de la gráfica, lo que
   Pilo ve en el récord, la cuenta de la meta y las recomendaciones: el
   resumen sin datos personales que se envía a la IA cuando la persona las
   pide, y cómo se lee lo que vuelve.

   El permiso de Génesis (firmado por la función, de solo lectura):
     · nunca está en el servidor: la función lo devuelve y aquí se queda;
     · con «mantener la conexión», en el almacenamiento de este dispositivo;
     · sin ella, solo en la memoria de la pestaña: al cerrarla o recargarla,
       se va;
     · va atado a la cuenta de Pilo que lo pidió: otra cuenta en el mismo
       dispositivo no lo recibe, y encontrarlo lo borra;
     · vence solo (la función dice cuándo): vencido, se borra;
     · lleva la sede en que se entró (su id y su nombre, nunca la dirección
       del portal), para decirla en la pantalla;
     · «Desconectar» lo borra de los dos sitios de inmediato, con su sede.
   La contraseña de Génesis no pasa por aquí: va del formulario a la función y
   no se guarda en ningún lado. Las notas tampoco se guardan: viven en la
   memoria de la pantalla mientras está abierta.

   Los hallazgos de «Mi evolución», la meta y TODOS los números de las
   gráficas se CALCULAN aquí, en el dispositivo, con las notas que llegaron.
   La IA propone cómo agrupar las materias en áreas y redacta las
   recomendaciones; nunca pone una cifra. Las recomendaciones no se guardan:
   viven en la memoria de la pantalla.

   Puro: se prueba en node.
   ========================================================================== */

import { MAX_PORTALS, genesisSite } from "./servidor-logica";
import type { NotaCourse, NotaPeriod, NotasHead } from "./servidor-logica";

export type { NotaCourse, NotaPeriod, NotasHead };

/* --- Quién ---------------------------------------------------------------------------------- */

/** Mis notas es de estudiantes con cuenta de Pilo activa: Génesis es el portal del estudiante. */
export const canUseNotas = (account: { rol: string; status: string } | null | undefined): boolean => Boolean(account) && account!.status === "activa" && account!.rol === "estudiante";

/* --- La sede: a cuál portal de Génesis se entra ---------------------------------------------- */

/** Lo que la app sabe de un portal de Génesis: su id y el nombre de la sede. La dirección no llega aquí. */
export interface PortalInfo {
  id: string;
  name: string;
}

export interface PortalList {
  /** La administración encendió Mis notas y hay al menos un portal. */
  on: boolean;
  portals: PortalInfo[];
}

const portalIdShape = (v: unknown): v is string => typeof v === "string" && /^[a-z][a-z0-9-]{1,23}$/.test(v);

/** Un portal tal como se usa aquí; `null` si no se entiende. */
export function parsePortal(raw: unknown): PortalInfo | null {
  const p = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const name = typeof p.name === "string" ? p.name.trim().slice(0, 60) : "";
  return portalIdShape(p.id) && name ? { id: p.id, name } : null;
}

/** La lista de sedes que responde la función; lo que no se entiende se descarta. */
export function parsePortals(body: unknown): PortalList {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const portals: PortalInfo[] = [];
  for (const raw of Array.isArray(b.portals) ? b.portals : []) {
    const p = parsePortal(raw);
    if (p && !portals.some((x) => x.id === p.id)) portals.push(p);
  }
  return { on: b.on === true && portals.length > 0, portals };
}

/** Un nombre para comparar: sin tildes, sin mayúsculas y sin signos. */
export const plainName = (text: string): string =>
  String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * El portal de la sede de la cuenta de Pilo (`pilo_users.campus`:
 * «bucaramanga», «cucuta»…). Casa si el nombre del portal (o su id) es esa
 * sede, sin distinguir tildes ni mayúsculas: «Cúcuta» casa con «cucuta». Si
 * ninguno es igual, vale el único portal cuyo nombre la trae como palabra
 * («Sede Bucaramanga»); con dos que la traigan, no se adivina.
 */
export function matchPortal(portals: PortalInfo[], campus: string | null | undefined): PortalInfo | null {
  const wanted = plainName(campus ?? "");
  if (!wanted) return null;
  const exact = portals.find((p) => plainName(p.name) === wanted || plainName(p.id) === wanted);
  if (exact) return exact;
  const loose = portals.filter((p) => ` ${plainName(p.name)} `.includes(` ${wanted} `));
  return loose.length === 1 ? loose[0] : null;
}

/**
 * La sede con que abre el ingreso: con un solo portal, ese (no se pregunta);
 * con varios, el de la sede de la cuenta si casa con alguno; si no, ninguna:
 * la persona elige.
 */
export function pickPortal(portals: PortalInfo[], campus: string | null | undefined): string | null {
  if (portals.length === 1) return portals[0].id;
  return matchPortal(portals, campus)?.id ?? null;
}

/* --- La sede, en la intranet: la lista que escribe la administración --------------------------- */

/** Un portal como lo escribe la administración. `id` vacío: es nuevo y aún no tiene. */
export interface PortalRow {
  id: string;
  name: string;
  url: string;
}

/**
 * El id de un portal nuevo, sacado de su nombre: corto, en minúsculas y sin
 * tildes («Cúcuta» → «cucuta»). Si ya está tomado, lleva un número. Una vez
 * guardado no cambia aunque cambie el nombre: los permisos lo llevan dentro.
 */
export function portalSlug(name: string, taken: string[]): string {
  let base = plainName(name).replace(/ /g, "-").slice(0, 20).replace(/-+$/, "");
  if (!/^[a-z]/.test(base)) base = `sede${base ? `-${base}` : ""}`.slice(0, 20).replace(/-+$/, "");
  if (base.length < 2) base = "sede";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export type PortalRowsCheck =
  | { ok: true; portals: { id: string; name: string; url: string }[] }
  | { ok: false; errors: Record<number, { name?: string; url?: string }>; why?: string };

/**
 * La lista de portales antes de guardarla: cada fila con su nombre y su
 * dirección (la misma regla de la función: https, dominio público, sin ruta;
 * puede llevar puerto), sin nombres ni direcciones repetidos y sin pasar del
 * tope. Devuelve la lista lista para guardar, en el orden en que está escrita,
 * o qué le falta a cada fila.
 */
export function checkPortalRows(rows: PortalRow[]): PortalRowsCheck {
  const errors: Record<number, { name?: string; url?: string }> = {};
  if (rows.length > MAX_PORTALS) return { ok: false, errors, why: `Son máximo ${MAX_PORTALS} portales.` };
  const out: { id: string; name: string; url: string }[] = [];
  const taken = rows.map((r) => r.id).filter(portalIdShape);
  rows.forEach((row, i) => {
    const name = row.name.replace(/\s+/g, " ").trim();
    const site = genesisSite(row.url);
    const problem: { name?: string; url?: string } = {};
    if (!name) problem.name = "Escriba el nombre de la sede.";
    else if (name.length > 60) problem.name = "El nombre es demasiado largo (máximo 60 caracteres).";
    else if (out.some((p) => plainName(p.name) === plainName(name))) problem.name = "Ya hay un portal con ese nombre.";
    if (!site.ok) problem.url = site.reason;
    else if (out.some((p) => p.url === site.site)) problem.url = "Esa dirección ya está en otro portal.";
    if (problem.name || problem.url || !site.ok) return void (errors[i] = problem);
    const id = portalIdShape(row.id) && !out.some((p) => p.id === row.id) ? row.id : portalSlug(name, [...taken, ...out.map((p) => p.id)]);
    out.push({ id, name, url: site.site });
  });
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, portals: out };
}

/* --- El permiso, en el dispositivo ---------------------------------------------------------- */

export interface Link {
  /** El permiso firmado: se devuelve a la función en cada consulta, tal cual. */
  permit: string;
  /** Cuándo vence, en segundos desde 1970 (UTC). */
  expires: number;
  head: NotasHead;
  /** La sede en que se entró: su id y su nombre, para decirla en la pantalla. */
  portal: PortalInfo;
  /** Quedó guardado en este dispositivo (si no, solo en la memoria de la pestaña). */
  kept: boolean;
}

export interface LinkStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const LINK_KEY = "pilo-app:notas";

interface Held {
  owner: string;
  permit: string;
  expires: number;
  head: NotasHead;
  portal: PortalInfo;
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

const permitShape = (v: unknown): v is string => typeof v === "string" && /^v1\.[A-Za-z0-9_-]{40,1600}\.[A-Za-z0-9_-]{43}$/.test(v);
const short = (v: unknown, max = 160): string => (typeof v === "string" ? v.slice(0, max) : "");
const whole = (v: unknown): number => (Number.isInteger(v) && (v as number) > 0 ? (v as number) : 0);

/** El encabezado tal como se usa aquí; lo que no se entiende se descarta. */
export function parseHead(raw: unknown): NotasHead {
  const h = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const percent = h.creditsPercent;
  return {
    program: short(h.program),
    period: typeof h.period === "string" && /^\d{4}[A-Z0-9]{1,2}$/.test(h.period) ? h.period : "",
    creditsPercent: typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100 ? percent : null,
  };
}

function parseHeld(raw: string | null): Held | null {
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { v?: unknown; owner?: unknown; permit?: unknown; expires?: unknown; head?: unknown; portal?: unknown };
    const portal = parsePortal(d?.portal);
    // Un permiso sin su sede no se entiende: no se sabría a qué portal pertenece.
    if (d?.v !== 1 || typeof d.owner !== "string" || !d.owner || !permitShape(d.permit) || !whole(d.expires) || !portal) return null;
    return { owner: d.owner, permit: d.permit, expires: whole(d.expires), head: parseHead(d.head), portal };
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
export function saveLink(owner: string, link: { permit: string; expires: number; head: NotasHead; portal: PortalInfo }, keep: boolean, store: LinkStore | null = deviceStore()): Link {
  memory = { owner, permit: link.permit, expires: link.expires, head: link.head, portal: link.portal };
  let kept = false;
  if (keep && store) {
    try {
      store.setItem(LINK_KEY, JSON.stringify({ v: 1, owner, permit: link.permit, expires: link.expires, head: link.head, portal: link.portal }));
      kept = true;
    } catch {
      kept = false;
    }
  }
  if (!kept) drop(store);
  return { ...link, kept };
}

/** El permiso de la cuenta `owner`, si lo hay y no ha vencido. El de otra cuenta no se entrega: se borra. */
export function readLink(owner: string, now: number = Date.now(), store: LinkStore | null = deviceStore()): Link | null {
  let stored: Held | null = null;
  let raw: string | null = null;
  try {
    raw = store?.getItem(LINK_KEY) ?? null;
  } catch {
    raw = null;
  }
  stored = parseHeld(raw);
  const live = (h: Held) => h.owner === owner && h.expires * 1000 > now;
  // Algo guardado que no se entiende, que es de otra cuenta o que ya venció: fuera.
  if (raw && (!stored || !live(stored))) {
    drop(store);
    stored = null;
  }
  if (memory && !live(memory)) memory = null;
  if (stored) return { permit: stored.permit, expires: stored.expires, head: stored.head, portal: stored.portal, kept: true };
  if (memory) return { permit: memory.permit, expires: memory.expires, head: memory.head, portal: memory.portal, kept: false };
  return null;
}

/** «Desconectar»: el permiso, con su sede, se borra de la memoria y del dispositivo, de inmediato. */
export function clearLink(store: LinkStore | null = deviceStore()): void {
  memory = null;
  drop(store);
}

/* --- Lo que responde la función ------------------------------------------------------------- */

export type NotasCode =
  | "sesion" | "cuenta" | "perfil" | "suspendida" | "limite" | "no_disponible" | "datos"
  | "credenciales" | "no_estudiante" | "permiso" | "pdf" | "portal"
  | "tiempo" | "red" | "tamano" | "genesis" | "interno"
  /** Los que pone la página: sin red, la función no está desplegada, o respondió algo que no se entiende. */
  | "sin_red" | "sin_funcion" | "desconocido";

const SERVER: string[] = ["sesion", "cuenta", "perfil", "suspendida", "limite", "no_disponible", "datos", "credenciales", "no_estudiante", "permiso", "pdf", "portal", "tiempo", "red", "tamano", "genesis", "interno"];

const FALLBACK: Record<NotasCode, string> = {
  sesion: "Para ver sus notas, entre con su cuenta de Pilo.",
  cuenta: "Mis notas es para quienes tienen cuenta de Pilo de estudiante.",
  perfil: "Mis notas es para estudiantes.",
  suspendida: "Su cuenta de Pilo está suspendida. Escriba a la administración.",
  limite: "Va muy rápido: espere un momento antes de volver a intentarlo.",
  no_disponible: "Mis notas aún no está disponible: la universidad todavía no ha conectado a Pilo con Génesis.",
  datos: "Escriba su usuario de Génesis (solo números) y su contraseña.",
  credenciales: "Génesis no aceptó ese usuario y esa contraseña. Revíselos e intente de nuevo.",
  no_estudiante: "Mis notas es para estudiantes: esa cuenta de Génesis no es de estudiante.",
  permiso: "Su permiso de Génesis venció o fue retirado. Conecte de nuevo sus notas.",
  pdf: "Génesis no entregó el polígrafo en PDF. Intente de nuevo en un momento.",
  portal: "Elija su sede: esa no está entre los portales de Génesis que Pilo puede leer.",
  tiempo: "Génesis tardó demasiado en responder. Intente de nuevo en un momento.",
  red: "No pude conectarme con Génesis. Intente de nuevo en un momento.",
  tamano: "Génesis devolvió más de lo que Pilo puede leer de una vez.",
  genesis: "Génesis no respondió como se esperaba. Intente de nuevo en un momento.",
  interno: "Algo falló al leer sus notas. Intente de nuevo en un momento.",
  sin_red: "No hay conexión a internet. Revísela e intente de nuevo.",
  sin_funcion: "Mis notas aún no está disponible.",
  desconocido: "Algo falló. Intente de nuevo en un momento.",
};

export const notasMessage = (code: NotasCode): string => FALLBACK[code];

/** A qué estado de la pantalla lleva un fallo. */
export type FailureView =
  /** El permiso ya no sirve: se borra y se pide conectar de nuevo. */
  | "vencido"
  /** Mis notas no se puede usar todavía (falta configurar Génesis o desplegar la función). */
  | "no_disponible"
  | "sin_conexion"
  /** La cuenta de Pilo no puede usar Mis notas, o hay que entrar otra vez. */
  | "cuenta"
  /** Se dice junto al campo de la contraseña de Génesis. */
  | "campo"
  /** La sede elegida ya no está: se dice junto a la sede y se vuelve a leer la lista. */
  | "sede"
  /** Se dice en la pantalla en que esté la persona, y puede reintentar. */
  | "aviso";

const VIEW: Partial<Record<NotasCode, FailureView>> = {
  permiso: "vencido",
  no_disponible: "no_disponible",
  sin_funcion: "no_disponible",
  sin_red: "sin_conexion",
  sesion: "cuenta",
  cuenta: "cuenta",
  perfil: "cuenta",
  suspendida: "cuenta",
  credenciales: "campo",
  no_estudiante: "campo",
  datos: "campo",
  portal: "sede",
};

export interface NotasFailure {
  code: NotasCode;
  message: string;
  view: FailureView;
  /** Segundos que hay que esperar (solo `limite`). */
  retryAfter?: number;
}

const waitText = (seconds: number) => (seconds >= 90 ? `${Math.round(seconds / 60)} minutos` : `${Math.max(1, Math.round(seconds))} segundos`);

export const failureOf = (code: NotasCode, message = FALLBACK[code], retryAfter?: number): NotasFailure => ({ code, message, view: VIEW[code] ?? "aviso", ...(retryAfter ? { retryAfter } : {}) });

/**
 * Una respuesta de error de `pilo-genesis`, como algo que la persona entiende
 * y con el estado de pantalla al que lleva. El texto del servidor se usa solo
 * cuando su código es de los conocidos.
 */
export function notasFailure(status: number, body: unknown): NotasFailure {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; retry_after?: unknown };
  const said = typeof b.error === "string" ? b.error.trim().slice(0, 300) : "";
  const raw = typeof b.code === "string" ? b.code : "";
  const known = SERVER.includes(raw);
  // La plataforma responde 404 cuando la función no está desplegada.
  if (status === 404 && !known) return failureOf("sin_funcion");
  if (!known) return failureOf(status === 429 ? "limite" : status === 401 ? "sesion" : "desconocido");
  const code = raw as NotasCode;
  if (code === "limite") {
    const n = Number(b.retry_after);
    const retryAfter = Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
    return failureOf(code, `${said || FALLBACK.limite}${retryAfter ? ` Podrá intentarlo de nuevo en ${waitText(retryAfter)}.` : ""}`, retryAfter);
  }
  return failureOf(code, said || FALLBACK[code]);
}

/* --- Lo que llega de la función -------------------------------------------------------------- */

export interface History {
  /** Los periodos, del más antiguo al más reciente. */
  periods: NotaPeriod[];
  /** El récord de notas se dejó leer (si no, faltan el grupo y la nota mínima). */
  record: boolean;
  /** La administración encendió las recomendaciones con IA. */
  advice: boolean;
}

const rows = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : []);
const mark = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 10 ? v : null);
const credits = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 2000 ? v : 0);

/** El histórico tal como se usa aquí; lo que no se entiende se descarta. */
export function parseHistory(body: unknown): History {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const periods = rows(b.periods)
    .map((p) => ({
      id: typeof p.id === "string" && /^\d{4}[A-Z0-9]{1,2}$/.test(p.id) ? p.id : "",
      average: mark(p.average),
      accumulated: mark(p.accumulated),
      credits: credits(p.credits),
      creditsApproved: credits(p.creditsApproved),
      totalApproved: credits(p.totalApproved),
      courses: rows(p.courses)
        .map((c) => ({
          code: short(c.code, 20),
          name: short(c.name),
          credits: credits(c.credits),
          def: mark(c.def),
          approved: c.approved === true,
          homologated: c.homologated === true,
          group: short(c.group),
          min: mark(c.min),
        }))
        .filter((c) => c.name || c.code),
    }))
    .filter((p) => p.id)
    .sort((a, b2) => (a.id < b2.id ? -1 : a.id > b2.id ? 1 : 0));
  return { periods, record: b.record === true, advice: b.advice === true };
}

/* --- Los números y los nombres, dichos ------------------------------------------------------- */

const NOTE = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 2 });

/** Una nota o un promedio, con coma: «4,1», «3,75». Sin redondear a un decimal: 2,95 no es 3,0. */
export const nota = (v: number | null | undefined): string => (typeof v === "number" && Number.isFinite(v) ? NOTE.format(v) : "—");

const ROMAN = /^(?:i{1,3}|iv|v|vi{1,3}|ix|x)$/i;
const SMALL = new Set(["a", "al", "con", "de", "del", "e", "el", "en", "la", "las", "los", "o", "para", "por", "u", "y"]);

/**
 * El nombre de una materia para leerlo: Génesis los manda en mayúsculas
 * («CÁLCULO DIFERENCIAL II»). Queda «Cálculo diferencial II»: los números
 * romanos siguen en mayúscula. Un nombre que ya viene con minúsculas no se toca.
 */
export function courseName(raw: string): string {
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text || text !== text.toUpperCase()) return text;
  const words = text.split(" ").map((w, i) => (ROMAN.test(w) && !(i === 0 && w.length === 1) && !SMALL.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

export type CourseState = "homologada" | "aprobada" | "reprobada" | "en_curso";

export const STATE_LABEL: Record<CourseState, string> = { homologada: "Homologada", aprobada: "Aprobada", reprobada: "Reprobada", en_curso: "En curso" };

/** ¿El periodo ya tiene alguna definitiva? Uno que apenas va en curso llega con todo en cero. */
export const settled = (p: NotaPeriod): boolean => p.courses.some((c) => c.homologated || (c.def !== null && c.def > 0));

/**
 * ¿Esa materia sigue en curso? Génesis manda las del periodo vigente sin
 * aprobar y con la definitiva en cero hasta que se cierran: eso no es haberla
 * reprobado. Vale para el periodo vigente (`current`) y para uno que aún no
 * tiene ninguna definitiva.
 */
export const inProgress = (p: NotaPeriod, c: NotaCourse, current = ""): boolean => !c.approved && !c.homologated && !(c.def !== null && c.def > 0) && (p.id === current || !settled(p));

/** El estado de una materia. La homologada se dice primero: no se cursó aquí. */
export const courseState = (c: Pick<NotaCourse, "approved" | "homologated">, pending = false): CourseState => (c.homologated ? "homologada" : c.approved ? "aprobada" : pending ? "en_curso" : "reprobada");

/** «Promedio 4,1 · 5 materias · 14 créditos». */
export function periodLine(p: NotaPeriod): string {
  const n = p.courses.length;
  const sum = p.credits || p.courses.reduce((total, c) => total + c.credits, 0);
  return [p.average !== null && settled(p) ? `Promedio ${nota(p.average)}` : "", `${n} ${n === 1 ? "materia" : "materias"}`, sum ? `${sum} ${sum === 1 ? "crédito" : "créditos"}` : ""].filter(Boolean).join(" · ");
}

/* --- Mi evolución: los promedios, periodo a periodo ------------------------------------------ */

export interface EvoRow {
  id: string;
  /** El promedio del semestre. */
  avg: number | null;
  /** El promedio acumulado hasta ese periodo. */
  acc: number | null;
  credits: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * La tabla de la evolución. Manda lo que calcula Génesis; si un periodo llega
 * sin promedio, se calcula con sus definitivas ponderadas por créditos (las
 * homologadas no cuentan), y el acumulado con todos los periodos hasta ese.
 * Un periodo que aún no tiene definitivas no tiene promedio: un cero ahí sería
 * una caída que no ocurrió.
 */
export function evolution(periods: NotaPeriod[]): EvoRow[] {
  let sumCredits = 0;
  let sumWeighted = 0;
  return periods.map((p) => {
    const counted = p.courses.filter((c) => !c.homologated && c.def !== null && c.credits > 0);
    const c = counted.reduce((total, x) => total + x.credits, 0);
    const w = counted.reduce((total, x) => total + x.credits * (x.def as number), 0);
    sumCredits += c;
    sumWeighted += w;
    const open = !settled(p);
    return {
      id: p.id,
      avg: open ? null : (p.average ?? (c > 0 ? round2(w / c) : null)),
      acc: open && !p.accumulated ? null : (p.accumulated ?? (sumCredits > 0 ? round2(sumWeighted / sumCredits) : null)),
      credits: p.credits || p.courses.reduce((total, x) => total + x.credits, 0),
    };
  });
}

/** El promedio del último semestre que ya tiene definitivas; null si no hay ninguno. */
export const lastAverage = (periods: NotaPeriod[]): number | null => [...evolution(periods)].reverse().find((r) => r.avg !== null)?.avg ?? null;

export interface Totals {
  /** El promedio acumulado más reciente. */
  accumulated: number | null;
  /** Los créditos aprobados hasta hoy. */
  approved: number;
  periods: number;
}

/** Los totales de arriba del histórico. */
export function totals(periods: NotaPeriod[]): Totals {
  const evo = evolution(periods);
  const lastAcc = [...evo].reverse().find((r) => r.acc !== null)?.acc ?? null;
  const said = Math.max(0, ...periods.map((p) => p.totalApproved));
  const counted = periods.reduce((total, p) => total + p.courses.filter((c) => c.approved || c.homologated).reduce((sum, c) => sum + c.credits, 0), 0);
  return { accumulated: lastAcc, approved: said || counted, periods: periods.length };
}

/* --- Mi evolución: lo que Pilo ve en el récord ------------------------------------------------ */

export interface Finding {
  id: "acumulado" | "extremos" | "reprobadas" | "creditos" | "reciente";
  text: string;
}

const join = (items: string[]): string => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`);
const times = (n: number): string => (n === 1 ? "una vez" : n === 2 ? "dos veces" : `${n} veces`);

/**
 * Lo que se ve en el récord, calculado aquí con las notas que llegaron: no
 * hay nada escrito a mano ni redactado por una IA. Con un solo periodo no se
 * habla de tendencia ni de mejor y peor.
 */
export function findings(periods: NotaPeriod[], head?: Partial<Pick<NotasHead, "creditsPercent" | "period">> | null): Finding[] {
  const out: Finding[] = [];
  const evo = evolution(periods);
  if (!evo.length) return out;

  const withAcc = evo.filter((r) => r.acc !== null);
  const last = withAcc[withAcc.length - 1];
  if (last) {
    // Contra el acumulado de cuatro periodos atrás (o el primero, si hay menos).
    const from = withAcc[Math.max(0, withAcc.length - 5)];
    const span = withAcc.length - 1 - Math.max(0, withAcc.length - 5);
    const delta = round2((last.acc as number) - (from.acc as number));
    const over = span === 1 ? "en el último periodo" : `en los últimos ${span} periodos`;
    const same = span === 1 ? "que en el periodo anterior" : `que hace ${span} periodos`;
    const trend = span < 1 ? "." : Math.abs(delta) < 0.05 ? `: prácticamente igual ${same}.` : ` y ha ${delta > 0 ? "subido" : "bajado"} ${nota(Math.abs(delta))} ${over}.`;
    out.push({ id: "acumulado", text: `Su promedio acumulado va en ${nota(last.acc)}${trend}` });
  }

  const withAvg = evo.filter((r) => r.avg !== null);
  if (withAvg.length >= 2) {
    // Con empate, el más reciente.
    const best = withAvg.reduce((a, b) => ((b.avg as number) >= (a.avg as number) ? b : a));
    const worst = withAvg.reduce((a, b) => ((b.avg as number) <= (a.avg as number) ? b : a));
    if (best.id !== worst.id) out.push({ id: "extremos", text: `Su mejor periodo fue ${best.id} (${nota(best.avg)}) y el más difícil, ${worst.id} (${nota(worst.avg)}).` });
  }
  if (withAvg.length >= 3) {
    const recent = withAvg[withAvg.length - 1];
    const before = withAvg.slice(0, -1);
    const mean = before.reduce((total, r) => total + (r.avg as number), 0) / before.length;
    const gap = round2((recent.avg as number) - mean);
    if (Math.abs(gap) >= 0.2) out.push({ id: "reciente", text: `En ${recent.id} su promedio (${nota(recent.avg)}) estuvo ${nota(Math.abs(gap))} por ${gap > 0 ? "encima" : "debajo"} de lo que traía en los periodos anteriores.` });
  }

  const failed = failedCourses(periods, head?.period ?? "");
  if (!failed.length) {
    out.push({ id: "reprobadas", text: periods.some(settled) ? "No ha reprobado ninguna materia." : "" });
  } else {
    const named = failed.slice(0, 4).map((f) => `${courseName(f.name)} en ${f.period}`);
    const more = failed.length - named.length;
    const pending = failed.filter((f) => !f.recovered);
    const after =
      pending.length === 0
        ? failed.length === 1 ? "La repitió y la aprobó." : "Las repitió y las aprobó."
        : pending.length === failed.length
          ? failed.length === 1 ? "Aún no aparece aprobada en su récord." : "Aún no aparecen aprobadas en su récord."
          : `De esas, ${pending.length === 1 ? "una aún no aparece aprobada" : `${pending.length} aún no aparecen aprobadas`} en su récord.`;
    out.push({ id: "reprobadas", text: `Reprobó ${times(failed.length)}: ${join(named)}${more > 0 ? ` y ${more} más` : ""}. ${after}` });
  }

  const t = totals(periods);
  if (t.approved > 0) {
    const percent = head?.creditsPercent;
    out.push({ id: "creditos", text: `Lleva ${t.approved} créditos aprobados${typeof percent === "number" ? `: el ${nota(percent).replace(/,0$/, "")} % de su plan de estudios` : ""}.` });
  }
  return out.filter((f) => f.text);
}

export interface FailedCourse {
  period: string;
  name: string;
  /** Aparece aprobada (o homologada) en un periodo posterior. */
  recovered: boolean;
}

const key = (c: Pick<NotaCourse, "code" | "name">) => c.code || c.name.toLowerCase().replace(/\s+/g, " ").trim();

/** Cada vez que reprobó una materia, y si después la aprobó. Las que siguen en curso no cuentan. */
export function failedCourses(periods: NotaPeriod[], current = ""): FailedCourse[] {
  const out: FailedCourse[] = [];
  periods.forEach((p, i) => {
    for (const c of p.courses) {
      if (c.approved || c.homologated || inProgress(p, c, current)) continue;
      const recovered = periods.slice(i + 1).some((later) => later.courses.some((x) => key(x) === key(c) && (x.approved || x.homologated)));
      // Sin nombre no se muestra su código: en ninguna pantalla se ve un identificador.
      out.push({ period: p.id, name: c.name || "una materia", recovered });
    }
  });
  return out;
}

/* --- Mi evolución: la gráfica ----------------------------------------------------------------- */

/** El lienzo de la gráfica (unidades del viewBox) y sus márgenes. */
export const CHART = { W: 320, H: 190, L: 30, R: 12, T: 12, B: 26 } as const;
/** Con cuánto se aprueba: la guía de la gráfica. */
export const PASS_MARK = 3;

export interface ChartShape {
  /** El eje, uno solo para las dos series. */
  y0: number;
  y1: number;
  /** La posición de cada periodo y de cada valor (null si ese periodo no lo tiene). */
  xs: number[];
  avg: (number | null)[];
  acc: (number | null)[];
  pathAvg: string;
  pathAcc: string;
  /** Las líneas de guía, con su etiqueta. */
  grid: { value: number; y: number }[];
  /** Los periodos que se nombran en el eje (no todos caben). */
  ticks: { index: number; x: number; label: string; anchor: "start" | "middle" | "end" }[];
  /** A qué altura va la línea de la meta de acumulado; null si no hay meta. */
  goal: number | null;
}

const fixed = (n: number) => Number(n.toFixed(1));

/** La geometría de la gráfica de líneas: pura, para pintarla y para probarla. */
export function chartOf(rowsIn: EvoRow[], goal: number | null = null): ChartShape {
  const { W, H, L, R, T, B } = CHART;
  const n = rowsIn.length;
  const values = rowsIn.flatMap((r) => [r.avg, r.acc]).filter((v): v is number => v !== null);
  const low = Math.min(PASS_MARK, ...values);
  // El eje baja de 2,5 solo si hay un promedio por debajo; siempre llega a 5.
  const y0 = low < 2.5 ? Math.max(0, Math.floor(low)) : 2.5;
  const y1 = Math.max(5, Math.ceil(Math.max(5, ...values)));
  const x = (i: number) => fixed(n <= 1 ? L + (W - L - R) / 2 : L + ((W - L - R) * i) / (n - 1));
  const y = (v: number) => fixed(T + (H - T - B) * (1 - (v - y0) / (y1 - y0)));
  const path = (pick: (r: EvoRow) => number | null) => {
    let d = "";
    let pen = false;
    rowsIn.forEach((r, i) => {
      const v = pick(r);
      if (v === null) return void (pen = false);
      d += `${d ? " " : ""}${pen ? "L" : "M"}${x(i)} ${y(v)}`;
      pen = true;
    });
    return d;
  };
  const grid: ChartShape["grid"] = [];
  for (let v = Math.ceil(y0 + 0.001); v <= y1; v++) grid.push({ value: v, y: y(v) });
  const step = Math.max(1, Math.ceil(n / 5));
  const ticks: ChartShape["ticks"] = [];
  rowsIn.forEach((r, i) => {
    const lastOne = i === n - 1;
    // El último siempre se nombra; el que quedaría pegado a él, no.
    if (!lastOne && (i % step !== 0 || n - 1 - i < step)) return;
    ticks.push({ index: i, x: x(i), label: r.id, anchor: n > 1 && lastOne ? "end" : n > 1 && i === 0 ? "start" : "middle" });
  });
  const goalAt = goal !== null && Number.isFinite(goal) && goal >= y0 && goal <= y1 ? y(goal) : null;
  return { goal: goalAt, y0, y1, xs: rowsIn.map((_, i) => x(i)), avg: rowsIn.map((r) => (r.avg === null ? null : y(r.avg))), acc: rowsIn.map((r) => (r.acc === null ? null : y(r.acc))), pathAvg: path((r) => r.avg), pathAcc: path((r) => r.acc), grid, ticks };
}

/** El periodo más cercano a un punto de la gráfica (en unidades del viewBox). */
export function nearestIndex(px: number, n: number): number {
  if (n <= 1) return 0;
  const { W, L, R } = CHART;
  return Math.max(0, Math.min(n - 1, Math.round(((px - L) / (W - L - R)) * (n - 1))));
}

/* --- Qué necesita para llegar a su meta -------------------------------------------------------- */

/** La meta que puede elegir la persona: un promedio acumulado entre 3,0 y 5,0, de décima en décima. */
export const GOAL = { min: 3, max: 5, step: 0.1 } as const;
/** La nota más alta que se puede sacar. */
export const TOP_MARK = 5;

/** Los créditos que ya pesan en el promedio: los de las materias con definitiva, sin las homologadas ni las que van en curso. */
export function gradedCredits(periods: NotaPeriod[], current = ""): number {
  return periods.reduce((total, p) => total + p.courses.filter((c) => !c.homologated && c.def !== null && c.credits > 0 && !inProgress(p, c, current)).reduce((sum, c) => sum + c.credits, 0), 0);
}

export interface GoalInput {
  /** El promedio acumulado de hoy. */
  accumulated: number | null;
  /** Los créditos que pesan en ese promedio (gradedCredits). */
  graded: number;
  /** Los créditos aprobados hasta hoy. */
  approved: number;
  /** Cuánto lleva del plan de estudios, en porcentaje de créditos (el encabezado de Génesis). */
  percent: number | null;
  /** La meta elegida. */
  goal: number;
}

export type GoalPlan =
  /** No hay con qué calcular: falta el promedio, los créditos o el avance. */
  | { status: "sin_datos" }
  /** Ya no le quedan créditos por cursar: el promedio no se mueve. */
  | { status: "terminado"; accumulated: number }
  /**
   * `needed`: lo que debe promediar en los `remaining` créditos que faltan.
   * «cumplida»: ya va en la meta o por encima (y `needed` es lo que la
   * mantiene); «inalcanzable»: pediría más de 5,0, y `best` es a lo más que
   * llega sacando 5,0 en todo lo que falta.
   */
  | { status: "posible" | "cumplida" | "inalcanzable"; needed: number; remaining: number; best: number; accumulated: number };

/**
 * Cuánto hay que promediar en lo que falta para cerrar con la meta. Aritmética
 * pura: los créditos que faltan salen del avance (si lleva `approved` y eso
 * es el `percent` % del plan, faltan approved × (100 − percent) / percent), y
 * el promedio final es el de hoy y el de lo que falta, cada uno con sus
 * créditos. Es una cuenta aproximada y así se le dice a la persona.
 */
export function goalPlan(input: GoalInput): GoalPlan {
  const { accumulated, graded, approved, percent } = input;
  if (accumulated === null || !Number.isFinite(accumulated) || !(graded > 0) || !(approved > 0) || percent === null || !Number.isFinite(percent) || percent <= 0) return { status: "sin_datos" };
  const goal = Math.min(GOAL.max, Math.max(GOAL.min, input.goal));
  const remaining = Math.round((approved * (100 - Math.min(100, percent))) / percent);
  if (remaining < 1) return { status: "terminado", accumulated };
  const raw = (goal * (graded + remaining) - accumulated * graded) / remaining;
  // Hacia arriba, a la centésima: con lo que se muestra, alcanza.
  const needed = Math.max(0, Math.ceil(raw * 100 - 1e-7) / 100);
  const best = Math.floor(((accumulated * graded + TOP_MARK * remaining) / (graded + remaining)) * 100 + 1e-7) / 100;
  const status = accumulated >= goal ? "cumplida" : raw > TOP_MARK + 1e-9 ? "inalcanzable" : "posible";
  return { status, needed, remaining, best, accumulated };
}

/* --- Lo que le recomiendo: el resumen que se envía y lo que vuelve ------------------------------ */

/** Los topes del resumen: los mismos que aplica la función (que además lo limpia por su cuenta). */
export const ADVICE_PERIODS = 24;
export const ADVICE_PERIOD_COURSES = 12;
export const ADVICE_COURSES = 120;
export const ADVICE_NAME = 80;

export interface AdviceCourse {
  name: string;
  credits: number;
  def: number | null;
  state: CourseState;
}

/**
 * El resumen que se envía a la IA cuando la persona pide recomendaciones, y
 * solo entonces. No lleva nada que la identifique: ni nombre, ni código de
 * estudiante, ni documento, ni los códigos de las materias. Lleva el programa,
 * las dos metas que se puso la persona y, por periodo, los promedios y las
 * materias con sus créditos, su definitiva y su estado.
 */
export interface AdviceSummary {
  program: string;
  /** Las metas de la persona: su promedio acumulado y el de este semestre. null si no las ha dicho. */
  goals: { accumulated: number | null; semester: number | null };
  periods: { id: string; average: number | null; accumulated: number | null; courses: AdviceCourse[] }[];
}

const fiveOrNull = (v: number | null): number | null => (v !== null && v >= 0 && v <= TOP_MARK ? v : null);

/** Arma el resumen, de los periodos más recientes hacia atrás hasta los topes, y lo deja en orden. */
export function adviceSummary(periods: NotaPeriod[], head?: Partial<Pick<NotasHead, "program" | "period">> | null, goals?: { accumulated: number; semester: number } | null): AdviceSummary {
  const current = head?.period ?? "";
  const evo = evolution(periods);
  const out: AdviceSummary["periods"] = [];
  let room = ADVICE_COURSES;
  for (let i = periods.length - 1; i >= 0 && out.length < ADVICE_PERIODS && room > 0; i--) {
    const p = periods[i];
    const courses = p.courses.slice(0, Math.min(ADVICE_PERIOD_COURSES, room)).map((c): AdviceCourse => {
      const pending = inProgress(p, c, current);
      return { name: (courseName(c.name) || "Materia").slice(0, ADVICE_NAME), credits: c.credits, def: pending ? null : fiveOrNull(c.def), state: courseState(c, pending) };
    });
    if (!courses.length) continue;
    room -= courses.length;
    out.unshift({ id: p.id, average: fiveOrNull(evo[i].avg), accumulated: fiveOrNull(evo[i].acc), courses });
  }
  return { program: courseName(head?.program ?? "").slice(0, 120), goals: { accumulated: fiveOrNull(goals?.accumulated ?? null), semester: fiveOrNull(goals?.semester ?? null) }, periods: out };
}

/** Las materias del resumen en fila, en su orden: la IA las nombra por su número en esta fila. */
export const summaryCourses = (summary: AdviceSummary): (AdviceCourse & { period: string })[] => summary.periods.flatMap((p) => p.courses.map((c) => ({ ...c, period: p.id })));

export interface AdviceArea {
  name: string;
  /** Las materias del área, por su posición en summaryCourses. */
  courses: number[];
}

export interface AdviceRec {
  title: string;
  /** Por qué, referido a sus notas. */
  why: string;
  /** Qué hacer, en concreto. */
  action: string;
  /** Los números de las fuentes en que se apoya. */
  sources: number[];
  /** Se apoya en un documento de la universidad; si no, es una recomendación general. */
  grounded: boolean;
}

export interface AdviceSource {
  n: number;
  title: string;
  section: string;
  /** A dónde lleva: una ruta del portal o una dirección https. Vacía si no hay a dónde enlazar. */
  path: string;
}

export interface Advice {
  areas: AdviceArea[];
  recs: AdviceRec[];
  sources: AdviceSource[];
}

const said = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const linkOf = (v: unknown): string => (typeof v === "string" && (/^\/[^\s/][^\s]*$/.test(v) || /^https:\/\/[^\s]+$/.test(v)) ? v.slice(0, 400) : "");

/**
 * Lo que responde la función, leído con cuidado. Las áreas solo valen si la
 * función contó las mismas materias que se enviaron (`total`): cada número es
 * una posición de esa fila, y cada materia queda en una sola área. Una
 * recomendación solo cita fuentes que vinieron en la respuesta.
 */
export function parseAdvice(body: unknown, total: number): Advice {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const sources: AdviceSource[] = [];
  for (const r of rows(b.sources)) {
    const n = Number(r.n);
    const title = said(r.title, 200);
    if (!Number.isInteger(n) || n < 1 || !title || sources.some((x) => x.n === n)) continue;
    sources.push({ n, title, section: said(r.section, 160), path: linkOf(r.path) });
  }
  const recs: AdviceRec[] = [];
  for (const r of rows(b.recs).slice(0, 5)) {
    const title = said(r.title, 120);
    const why = said(r.why, 500);
    const action = said(r.action, 500);
    if (!title || (!why && !action)) continue;
    const cited = [...new Set((Array.isArray(r.sources) ? r.sources : []).filter((n): n is number => Number.isInteger(n) && sources.some((x) => x.n === n)))];
    recs.push({ title, why, action, sources: cited, grounded: r.grounded === true && cited.length > 0 });
  }
  const areas: AdviceArea[] = [];
  if (Number(b.courses) === total && total > 0) {
    const taken = new Set<number>();
    for (const r of rows(b.areas).slice(0, 8)) {
      const name = said(r.name, 40);
      const mine = (Array.isArray(r.courses) ? r.courses : []).filter((n): n is number => Number.isInteger(n) && n >= 0 && n < total && !taken.has(n));
      const unique = [...new Set(mine)];
      if (!name || !unique.length || areas.some((a) => plainName(a.name) === plainName(name))) continue;
      unique.forEach((n) => taken.add(n));
      areas.push({ name, courses: unique });
    }
  }
  return { areas, recs, sources };
}

export interface AreaBar {
  name: string;
  /** El promedio del área, ponderado por créditos. */
  avg: number;
  credits: number;
  /** Cuántas materias con definitiva entraron en la cuenta. */
  count: number;
  /** Va en el promedio acumulado o por encima: una fortaleza. Por debajo: un área por reforzar. */
  strong: boolean;
}

/**
 * Las barras de «Fortalezas y áreas por reforzar». Las áreas las propone la
 * IA; los números NO: el promedio de cada una se calcula aquí, con las
 * definitivas reales, ponderado por créditos (sin las homologadas ni lo que va
 * en curso). De mayor a menor. Con menos de dos áreas con notas no hay nada
 * que comparar, y no hay gráfica.
 */
export function areaBars(summary: AdviceSummary, areas: AdviceArea[], reference: number | null): AreaBar[] {
  const flat = summaryCourses(summary);
  const bars: Omit<AreaBar, "strong">[] = [];
  for (const area of areas) {
    const graded = area.courses.map((i) => flat[i]).filter((c) => c && c.def !== null && c.state !== "homologada" && c.state !== "en_curso");
    const weight = (c: AdviceCourse) => Math.max(1, c.credits);
    const credits = graded.reduce((total, c) => total + weight(c), 0);
    if (!credits) continue;
    bars.push({ name: area.name, avg: round2(graded.reduce((total, c) => total + weight(c) * (c.def as number), 0) / credits), credits, count: graded.length });
  }
  if (bars.length < 2) return [];
  const line = reference ?? bars.reduce((total, b) => total + b.avg * b.credits, 0) / bars.reduce((total, b) => total + b.credits, 0);
  return bars.sort((a, b) => b.avg - a.avg || a.name.localeCompare(b.name, "es")).map((b) => ({ ...b, strong: b.avg >= line - 1e-9 }));
}

/** Cómo va el pedido de recomendaciones, para la pantalla. */
export type AdviceCode = "apagado" | "tope" | "limite" | "sesion" | "perfil" | "datos" | "vacio" | "proveedor" | "tiempo" | "red" | "sin_red" | "desconocido";

export interface AdviceFailure {
  code: AdviceCode;
  message: string;
  /** Se puede volver a intentar ya. */
  retry: boolean;
}

const ADVICE_TEXT: Record<AdviceCode, string> = {
  apagado: "La universidad aún no ha habilitado las recomendaciones con IA en Mis notas.",
  tope: "Ya pidió las recomendaciones que se pueden pedir por hoy. Mañana puede pedirlas otra vez.",
  limite: "Pilo llegó a su límite de pedidos de hoy. Mañana vuelve.",
  sesion: "Para pedir recomendaciones, entre con su cuenta de Pilo.",
  perfil: "Las recomendaciones de Mis notas son para estudiantes con cuenta de Pilo.",
  datos: "No hay notas suficientes para recomendarle algo todavía.",
  vacio: "Pilo no logró escribir recomendaciones que pasaran la revisión. Intente de nuevo.",
  proveedor: "La IA no respondió como se esperaba. Intente de nuevo en un momento.",
  tiempo: "La IA tardó demasiado. Intente de nuevo en un momento.",
  red: "No pude hablar con la IA. Intente de nuevo en un momento.",
  sin_red: "No hay conexión a internet. Revísela e intente de nuevo.",
  desconocido: "Algo falló al pedir las recomendaciones. Intente de nuevo en un momento.",
};

const ADVICE_FINAL: AdviceCode[] = ["apagado", "tope", "limite", "sesion", "perfil", "datos"];

export const adviceFailureOf = (code: AdviceCode): AdviceFailure => ({ code, message: ADVICE_TEXT[code], retry: !ADVICE_FINAL.includes(code) });

/** Un error de la acción de recomendaciones, en palabras de la app: el texto del servidor no se muestra. */
export function adviceFailure(status: number, body: unknown): AdviceFailure {
  const raw = (body && typeof body === "object" ? (body as { code?: unknown }).code : "") as unknown;
  const known = typeof raw === "string" && raw in ADVICE_TEXT ? (raw as AdviceCode) : null;
  if (known && known !== "sin_red" && known !== "desconocido") return adviceFailureOf(known);
  if (raw === "limite_proveedor") return adviceFailureOf("proveedor");
  if (status === 401) return adviceFailureOf("sesion");
  if (status === 403) return adviceFailureOf("perfil");
  if (status === 429) return adviceFailureOf("tope");
  if (status === 504) return adviceFailureOf("tiempo");
  if (status === 502 || status === 503) return adviceFailureOf("proveedor");
  return adviceFailureOf("desconocido");
}
