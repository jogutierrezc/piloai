/* =============================================================================
   Personal de Pilo · lo que se calcula sin pantalla.

   Cómo se lee una fila de `pilo_staff_list()`, en qué estado está, cómo se
   filtra y se cuenta, qué abre cada rol (todo sale del contrato
   src/lib/pilo-staff.ts: aquí no se escribe a mano quién puede qué), cómo se
   validan el correo y el nombre antes de invitar y cómo se traducen a una frase
   los códigos de error de la base y de la función `pilo-staff`.

   Nada de este archivo toca la red ni React: se prueba entero.
   ========================================================================== */

import { STAFF_ROLES, canUseArea, isStaffRole, spacesFor, staffRoleLabels } from "../../../lib/pilo-staff";
import type { PiloSpaceId, PiloStaffRole, PiloStaffRow, StaffArea } from "../../../lib/pilo-staff";

/** Una fila de `pilo_staff_list()`: el contrato más si ya confirmó su correo. */
export interface StaffPerson extends PiloStaffRow {
  confirmed: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Una fila de la base; null si no se entiende (sin id, sin correo o con un rol desconocido). */
export function parseStaffRow(row: unknown): StaffPerson | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!str(r.user_id) || !str(r.email) || !isStaffRole(r.role)) return null;
  return {
    user_id: str(r.user_id),
    email: str(r.email).toLowerCase(),
    full_name: str(r.full_name),
    role: r.role,
    active: r.active !== false,
    created_at: str(r.created_at),
    last_seen_at: str(r.last_seen_at) || null,
    confirmed: r.confirmed === true,
  };
}

/* ------------------------------------------------------------------------- */
/* Estado                                                                     */
/* ------------------------------------------------------------------------- */

export type StaffState = "activo" | "sin_confirmar" | "inactivo";

/** El estado que se muestra: la desactivación manda; después, si aún no abre su enlace. */
export function staffState(p: Pick<StaffPerson, "active" | "confirmed">): StaffState {
  if (!p.active) return "inactivo";
  return p.confirmed ? "activo" : "sin_confirmar";
}

/** El estado nunca va solo en color: cada uno lleva rótulo y un ícono (nombre del set de Icon). */
export const STATE_INFO: Record<StaffState, { label: string; tone: "ok" | "warn" | "fail"; icon: "check" | "clock" | "lock" }> = {
  activo: { label: "Activo", tone: "ok", icon: "check" },
  sin_confirmar: { label: "Sin confirmar", tone: "warn", icon: "clock" },
  inactivo: { label: "Inactivo", tone: "fail", icon: "lock" },
};

/* ------------------------------------------------------------------------- */
/* Filtros y conteos                                                          */
/* ------------------------------------------------------------------------- */

export type StateFilter = "todos" | "activos" | "inactivos";

export const STATE_FILTERS: { id: StateFilter; label: string }[] = [
  { id: "todos", label: "Todos" },
  { id: "activos", label: "Activos" },
  { id: "inactivos", label: "Inactivos" },
];

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Quien contiene lo buscado (nombre, correo o rol), del rol y del estado pedidos. Sin tildes ni mayúsculas. */
export function filterStaff(rows: StaffPerson[], role: PiloStaffRole | "", state: StateFilter, query: string): StaffPerson[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return rows.filter((p) => {
    if (role && p.role !== role) return false;
    if (state === "activos" && !p.active) return false;
    if (state === "inactivos" && p.active) return false;
    if (!words.length) return true;
    const hay = fold(`${p.full_name} ${p.email} ${staffRoleLabels[p.role]} ${STATE_INFO[staffState(p)].label}`);
    return words.every((w) => hay.includes(w));
  });
}

export interface RoleCount {
  /** Personas con ese rol, activas o no. */
  total: number;
  /** De ellas, las que hoy pueden entrar. */
  active: number;
}

/** Cuántas personas hay por rol (todos los roles aparecen, aunque sea en cero). */
export function countByRole(rows: StaffPerson[]): Record<PiloStaffRole, RoleCount> {
  const out = Object.fromEntries(STAFF_ROLES.map((r) => [r, { total: 0, active: 0 }])) as Record<PiloStaffRole, RoleCount>;
  for (const p of rows) {
    out[p.role].total += 1;
    if (p.active) out[p.role].active += 1;
  }
  return out;
}

/** Cuántos administradores activos hay. */
export const activeAdmins = (rows: StaffPerson[]): number => rows.filter((p) => p.role === "admin" && p.active).length;

/** ¿Es esta persona el último administrador activo? Sin otro que lo releve no se baja ni se quita. */
export function isLastAdmin(rows: StaffPerson[], id: string): boolean {
  const p = rows.find((r) => r.user_id === id);
  return !!p && p.role === "admin" && p.active && activeAdmins(rows) <= 1;
}

/** Pasar de admin a cualquier otro rol quita acceso: pide confirmación en la fila. */
export const isDowngrade = (from: PiloStaffRole, to: PiloStaffRole): boolean => from === "admin" && to !== "admin";

/** Para quitar a alguien hay que escribir su correo tal cual: así no se quita por un clic de más. */
export const removalConfirmed = (typed: string, email: string): boolean => email.length > 0 && typed.trim().toLowerCase() === email.toLowerCase();

/* ------------------------------------------------------------------------- */
/* Qué abre cada rol (todo del contrato)                                      */
/* ------------------------------------------------------------------------- */

export const SPACE_LABELS: Record<PiloSpaceId, string> = {
  planeacion: "Pilo Universidad",
  ensenanza: "Pilo Enseñanza",
};

/** Las zonas en el orden del menú, con su nombre; el acceso lo dice el contrato, no esta lista. */
export const AREA_ROWS: { id: StaffArea; label: string }[] = [
  { id: "inicio", label: "Inicio" },
  { id: "documentos", label: "Documentos" },
  { id: "catalogo", label: "Respuestas oficiales" },
  { id: "memoria", label: "Memoria de Pilo" },
  { id: "conexion", label: "Conexión, voz y uso" },
  { id: "portales", label: "Portales" },
  { id: "usuarios", label: "Usuarios de Pilo" },
  { id: "emergencias", label: "Alertas de emergencia" },
  { id: "personal", label: "Personal" },
];

export interface AccessRow {
  key: string;
  label: string;
  kind: "espacio" | "zona";
  /** Qué roles lo abren. */
  roles: Record<PiloStaffRole, boolean>;
}

/** Las filas de «qué abre cada rol»: primero los dos espacios, después las zonas. */
export function accessRows(): AccessRow[] {
  const spaces = (Object.keys(SPACE_LABELS) as PiloSpaceId[]).map(
    (space): AccessRow => ({
      key: `espacio-${space}`,
      label: `Documentos de ${SPACE_LABELS[space]}`,
      kind: "espacio",
      roles: Object.fromEntries(STAFF_ROLES.map((r) => [r, spacesFor(r).includes(space)])) as Record<PiloStaffRole, boolean>,
    }),
  );
  const areas = AREA_ROWS.map(
    (area): AccessRow => ({
      key: `zona-${area.id}`,
      label: area.label,
      kind: "zona",
      roles: Object.fromEntries(STAFF_ROLES.map((r) => [r, canUseArea(r, area.id)])) as Record<PiloStaffRole, boolean>,
    }),
  );
  return [...spaces, ...areas];
}

/** Los espacios de un rol, con su nombre, para la tarjeta del resumen. */
export const spaceNamesFor = (role: PiloStaffRole): string[] => spacesFor(role).map((s) => SPACE_LABELS[s]);

/* ------------------------------------------------------------------------- */
/* Validación del formulario «Invitar»                                        */
/* ------------------------------------------------------------------------- */

// Misma regla de la función `pilo-staff` (supabase/functions/pilo-staff): lo que pasa aquí pasa allá.
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** Correo en minúsculas y sin espacios en los bordes. */
export const normalizeEmail = (value: string): string => value.trim().toLowerCase();

/** Escapa \, % y _ para usar un texto como patrón de ilike sin comodines. */
export const escapeLike = (value: string): string => value.replace(/[\\%_]/g, (c) => "\\" + c);

/** ¿Es exactamente el mismo correo (sin distinguir mayúsculas ni espacios en los bordes)? */
export const sameEmail = (a: string | null | undefined, b: string | null | undefined): boolean => {
  const x = normalizeEmail(a ?? "");
  return x.length > 0 && x === normalizeEmail(b ?? "");
};

/** Nombre con los espacios repetidos juntados. */
export const normalizeName = (value: string): string => value.replace(/\s+/g, " ").trim();

/** Qué le falta a un correo, o "" si sirve. */
export function emailProblem(raw: string): string {
  const email = normalizeEmail(raw);
  if (!email) return "Escriba el correo de la persona.";
  if (email.length > 160 || !EMAIL.test(email)) return "Ese correo no es válido.";
  return "";
}

/** Qué le falta a un nombre, o "" si sirve (la base admite hasta 120). */
export function nameProblem(raw: string): string {
  const name = normalizeName(raw);
  if (name.length < 3) return "Escriba el nombre completo.";
  if (name.length > 120) return "El nombre es demasiado largo (hasta 120 letras).";
  return "";
}

export interface InviteDraft {
  email: string;
  name: string;
  role: PiloStaffRole | "";
}

export interface InviteProblems {
  email: string;
  name: string;
  role: string;
}

/** Los problemas de cada campo; si todos están vacíos, se puede invitar. */
export function inviteProblems(draft: InviteDraft): InviteProblems {
  return {
    email: emailProblem(draft.email),
    name: nameProblem(draft.name),
    role: draft.role && isStaffRole(draft.role) ? "" : "Elija un rol.",
  };
}

export const inviteValid = (p: InviteProblems): boolean => !p.email && !p.name && !p.role;

/* ------------------------------------------------------------------------- */
/* Errores                                                                    */
/* ------------------------------------------------------------------------- */

export type StaffErrorCode =
  | "correo"
  | "nombre"
  | "rol"
  | "existe"
  | "cuenta"
  | "permiso"
  | "ultimo_admin"
  | "no_existe"
  | "migracion"
  | "persona"
  | "alta"
  | "sin_enlace";

const ERROR_TEXT: Record<StaffErrorCode, string> = {
  correo: "Ese correo no es válido. Revíselo.",
  nombre: "Escriba el nombre completo de la persona.",
  rol: "Elija un rol para la persona.",
  existe: "Esa persona ya está en el personal de Pilo.",
  cuenta: "Ese correo ya tiene una cuenta (por ejemplo, de PDI), así que no se le puede crear otra.",
  permiso: "Solo la administración de Pilo maneja el personal.",
  ultimo_admin: "Es el último administrador activo de Pilo: nombre a otro antes de bajarlo, desactivarlo o quitarlo.",
  no_existe: "Esa persona ya no está en el personal. Actualice la lista.",
  migracion: "Falta aplicar la migración pilo_0146 en la base.",
  persona: "Falta indicar a qué persona se refiere.",
  alta: "No se pudo crear la cuenta. Intente de nuevo en un momento.",
  sin_enlace: "La cuenta se creó, pero no salió el correo ni se pudo generar el enlace. La persona puede pedir uno desde «Olvidé mi contraseña».",
};

export const isStaffErrorCode = (v: unknown): v is StaffErrorCode => typeof v === "string" && v in ERROR_TEXT;

/** La frase para un código de la función; sin código conocido, el mensaje que trajo o una frase general. */
export function staffErrorText(code: string | undefined, fallback?: string): string {
  if (isStaffErrorCode(code)) return ERROR_TEXT[code];
  return fallback?.trim() || "No se pudo completar la acción. Intente de nuevo.";
}

/** ¿El error de la base dice que la migración no está aplicada (la función no existe)? */
export function isMigrationMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883" || error.code === "42P01") return true;
  return /schema cache|could not find the function|does not exist|no existe la funci/i.test(error.message ?? "");
}

/**
 * Un error de una llamada rpc a su frase. 42501 (sin permiso o último admin)
 * ya trae un mensaje en español escrito para la persona: se respeta. Lo demás
 * pasa por los textos de arriba.
 */
export function rpcErrorText(error: { code?: string; message?: string }): { code: StaffErrorCode | "otro"; text: string } {
  if (isMigrationMissing(error)) return { code: "migracion", text: ERROR_TEXT.migracion };
  if (error.code === "42501") {
    const message = error.message ?? "";
    if (/último administrador/i.test(message)) return { code: "ultimo_admin", text: message };
    return { code: "permiso", text: message || ERROR_TEXT.permiso };
  }
  if (/no está en el personal/i.test(error.message ?? "")) return { code: "no_existe", text: ERROR_TEXT.no_existe };
  return { code: "otro", text: staffErrorText(undefined, error.message) };
}

/* ------------------------------------------------------------------------- */
/* Fechas                                                                     */
/* ------------------------------------------------------------------------- */

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «28 sept 2026»; «—» si no hay fecha. */
export function dayLabel(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "—";
}

/** «Nunca», «hace un momento», «hace 3 h», «hace 2 d» o la fecha si pasó un mes. */
export function lastSeenLabel(iso: string | null, now: number = Date.now()): string {
  if (!iso) return "Nunca";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "Nunca";
  const minutes = Math.floor((now - t) / 60000);
  if (minutes < 2) return "hace un momento";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} d`;
  return dayLabel(iso);
}

/** «1 persona» / «3 personas». */
export const peopleLabel = (n: number): string => `${n.toLocaleString("es-CO")} ${n === 1 ? "persona" : "personas"}`;
