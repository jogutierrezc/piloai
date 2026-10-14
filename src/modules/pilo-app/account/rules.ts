
import { tr } from "../../../components/pilo/i18n";/* =============================================================================
   Mr. Pilo · cuentas (0120) · las reglas, en un solo sitio.

   Espejo de lo que deciden la base (`pilo_email_rule`, las restricciones de
   `pilo_users`) y la función `pilo-cuentas`: qué correo entra, qué perfiles
   admite, cuándo se pregunta la sede, cómo es un nombre de usuario y una
   contraseña. La página valida con esto para avisar pronto; quien decide de
   verdad es el servidor, que vuelve a revisarlo todo.

   También van aquí los pasos del registro guiado, lo que se le dice a la
   persona cuando el servidor responde con un código, y la fila de la cuenta.

   Puro: se prueba en node.
   ========================================================================== */

export type PiloRol = "estudiante" | "profesor" | "administrativo";
export type Campus = "bucaramanga" | "cucuta" | "valledupar" | "bogota";
export type Tone = "cercano" | "formal" | "directo";
export type Length = "corta" | "normal" | "detallada";

export const CAMPUSES: { id: Campus; label: string }[] = [
  { id: "bucaramanga", label: "Bucaramanga" },
  { id: "cucuta", label: "Cúcuta" },
  { id: "valledupar", label: "Valledupar" },
  { id: "bogota", label: "Bogotá" },
];

export const ROLES: Record<PiloRol, { label: string; hint: string }> = {
  estudiante: { label: "Estudiante", hint: "Estudio en la UDES" },
  profesor: { label: "Profesor", hint: "Enseño en la UDES" },
  administrativo: { label: "Administrativo", hint: "Trabajo en una dependencia" },
};

export const TONES: { id: Tone; label: string; says: string }[] = [
  { id: "cercano", label: "Cercano", says: "¡Perfecto! Le hablaré con confianza, siempre de usted." },
  { id: "formal", label: "Formal", says: "De acuerdo. Me dirigiré a usted con formalidad." },
  { id: "directo", label: "Directo", says: "Entendido. Iré al punto." },
];

export const LENGTHS: { id: Length; label: string }[] = [
  { id: "corta", label: "Corta" },
  { id: "normal", label: "Normal" },
  { id: "detallada", label: "Detallada" },
];

export const isTone = (v: unknown): v is Tone => v === "cercano" || v === "formal" || v === "directo";
export const isLength = (v: unknown): v is Length => v === "corta" || v === "normal" || v === "detallada";
export const isCampus = (v: unknown): v is Campus => CAMPUSES.some((c) => c.id === v);
export const isRol = (v: unknown): v is PiloRol => v === "estudiante" || v === "profesor" || v === "administrativo";

export const campusLabel = (campus: string | null | undefined): string => CAMPUSES.find((c) => c.id === campus)?.label ?? "";
export const rolLabel = (rol: string | null | undefined): string => (isRol(rol) ? ROLES[rol].label : "");

/* --- El correo -------------------------------------------------------------------------------- */

export interface EmailRule {
  domain: string;
  roles: PiloRol[];
  /** La sede que dice el dominio; "" si hay que preguntarla. */
  campus: Campus | "";
}

const STAFF: PiloRol[] = ["administrativo", "profesor"];

/** Los dominios que acepta Pilo, en el orden en que se muestran. */
export const DOMAINS: EmailRule[] = [
  { domain: "mail.udes.edu.co", roles: ["estudiante", "profesor"], campus: "" },
  { domain: "udes.edu.co", roles: STAFF, campus: "" },
  { domain: "bucaramanga.udes.edu.co", roles: STAFF, campus: "bucaramanga" },
  { domain: "cucuta.udes.edu.co", roles: STAFF, campus: "cucuta" },
  { domain: "valledupar.udes.edu.co", roles: STAFF, campus: "valledupar" },
];

const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9.-]+$/;

export const cleanEmail = (email: string): string => email.trim().toLowerCase();

/** Lo que admite un correo (igual que `pilo_email_rule`); null si no es de la UDES. */
export function emailRule(email: string | null | undefined): EmailRule | null {
  const e = cleanEmail(email ?? "");
  if (!EMAIL.test(e)) return null;
  const domain = e.slice(e.indexOf("@") + 1);
  return DOMAINS.find((d) => d.domain === domain) ?? null;
}

/** Qué le falta a un correo, o "" si sirve. */
export function emailProblem(email: string): string {
  const e = cleanEmail(email);
  if (!e) return tr("Escriba su correo de la UDES.");
  if (!EMAIL.test(e)) return tr("Escriba su correo completo, con la arroba.");
  if (!emailRule(e)) return `«@${e.slice(e.indexOf("@") + 1)}» no es un correo de la UDES. Use su correo institucional.`;
  return "";
}

/** Lo que Pilo pregunta al ver el dominio. */
export function rolQuestion(rule: EmailRule): string {
  if (rule.domain === "mail.udes.edu.co") return tr("Su correo es de @mail.udes.edu.co, el de estudiantes y profesores. ¿Cuál de los dos es usted?");
  if (rule.campus) return tr("Su correo es de la sede {v0}. ¿Es administrativo o profesor?", { v0: campusLabel(rule.campus) });
  return tr("Su correo es administrativo. ¿Es administrativo o profesor?");
}

/* --- El nombre, el usuario y la contraseña ---------------------------------------------------- */

const USERNAME = /^[a-z0-9._]{4,20}$/;
/** Los mismos nombres que no entrega la función: se prestan para hacerse pasar por la universidad o por Pilo. */
const RESERVED = ["admin", "administrador", "pilo", "mrpilo", "mr.pilo", "udes", "soporte", "root", "sistema", "planeacion", "rectoria", "intranet"];

export const USERNAME_HINT = "De 4 a 20 caracteres: letras minúsculas, números, punto o guion bajo.";

export const cleanUsername = (username: string): string => username.trim().toLowerCase();

/** Qué le falta a un nombre de usuario, o "" si sirve. */
export function usernameProblem(username: string): string {
  const u = cleanUsername(username);
  if (!u) return tr("Escriba un nombre de usuario.");
  if (!USERNAME.test(u)) return tr("El usuario lleva de 4 a 20 caracteres: letras minúsculas, números, punto o guion bajo.");
  if (/^[._]|[._]$|[._]{2}/.test(u)) return tr("El usuario no puede empezar ni terminar con punto o guion bajo, ni llevar dos seguidos.");
  if (RESERVED.includes(u.replace(/[._]/g, "")) || RESERVED.includes(u)) return tr("Ese nombre de usuario está reservado. Elija otro.");
  return "";
}

/** Un usuario de partida a partir del nombre: «Laura Gómez» → «laura.gomez». La persona lo cambia si quiere. */
export function suggestUsername(fullName: string): string {
  return fullName
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 20)
    .replace(/\.+$/, "");
}

export const cleanName = (name: string): string => name.replace(/\s+/g, " ").trim();

export function nameProblem(fullName: string): string {
  const n = cleanName(fullName);
  if (n.length < 3) return tr("Escriba su nombre completo.");
  if (n.length > 120) return tr("El nombre es demasiado largo: hasta 120 caracteres.");
  return "";
}

/** El primer nombre: así la llama Pilo si no dice otra cosa. */
export const firstName = (fullName: string): string => cleanName(fullName).split(" ")[0] ?? "";

export interface PasswordChecks {
  len: boolean;
  letter: boolean;
  num: boolean;
}

export const passwordChecks = (password: string): PasswordChecks => ({ len: password.length >= 8, letter: /[a-zA-Z]/.test(password), num: /\d/.test(password) });

/** Qué le falta a una contraseña, o "" si sirve. */
export function passwordProblem(password: string): string {
  if (password.length < 8) return tr("La contraseña lleva 8 caracteres o más.");
  if (password.length > 72) return tr("La contraseña es demasiado larga: hasta 72 caracteres.");
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return tr("La contraseña lleva al menos una letra y un número.");
  return "";
}

/** Cómo quiere que la llame Pilo: hasta 40 caracteres, sin saltos. */
export const cleanNick = (nick: string): string => nick.replace(/\s+/g, " ").trim().slice(0, 40);

/* --- Los pasos del registro ------------------------------------------------------------------ */

export type RegStep = "correo" | "perfil" | "sede" | "identidad" | "clave" | "trato";

/** Los pasos, en orden. La sede solo se pregunta si el dominio no la dice. */
export function regSteps(rule: EmailRule | null): RegStep[] {
  return ["correo", "perfil", ...(rule && rule.campus ? [] : (["sede"] as RegStep[])), "identidad", "clave", "trato"];
}

export interface RegData {
  email: string;
  rol: PiloRol | "";
  campus: Campus | "";
  fullName: string;
  username: string;
  password: string;
  nick: string;
  tone: Tone;
  /** Leyó y aceptó los términos y la política de uso de Mr. Pilo (terms/policy.ts): sin esto no se crea. */
  terms: boolean;
}

export const EMPTY_REG: RegData = { email: "", rol: "", campus: "", fullName: "", username: "", password: "", nick: "", tone: "cercano", terms: false };

/*
 * Los términos que se aceptan al crear la cuenta son los de Mr. Pilo, y viven
 * en un solo sitio: terms/policy.ts (las cuatro reglas de oro, la política
 * completa y su versión). El registro los muestra desde ahí; aquí solo se
 * exige que la casilla esté marcada.
 */

export interface StepProblem {
  field: "email" | "rol" | "campus" | "fullName" | "username" | "password" | "nick" | "terms";
  message: string;
}

/** Lo primero que le falta a un paso para poder seguir; null si está completo. */
export function stepProblem(step: RegStep, data: RegData): StepProblem | null {
  const rule = emailRule(data.email);
  const bad = (field: StepProblem["field"], message: string): StepProblem | null => (message ? { field, message } : null);
  if (step === "correo") return bad("email", emailProblem(data.email));
  if (step === "perfil") return bad("rol", rule && data.rol && rule.roles.includes(data.rol) ? "" : tr("Elija su perfil en la universidad."));
  if (step === "sede") return bad("campus", rule?.campus || isCampus(data.campus) ? "" : tr("Elija su sede: Bucaramanga, Cúcuta, Valledupar o Bogotá."));
  if (step === "identidad") return bad("fullName", nameProblem(data.fullName)) ?? bad("username", usernameProblem(data.username));
  if (step === "clave") return bad("password", passwordProblem(data.password));
  return bad("nick", data.nick.replace(/\s+/g, " ").trim().length > 40 ? tr("Hasta 40 caracteres.") : "") ?? bad("terms", data.terms ? "" : tr("Para crear la cuenta, lea y acepte los términos."));
}

/** El primer paso incompleto: hasta ahí puede llegar la persona. */
export function firstOpenStep(data: RegData): RegStep | null {
  return regSteps(emailRule(data.email)).find((s) => stepProblem(s, data)) ?? null;
}

/** Lo que viaja a `registrar`. La sede del dominio manda sobre la elegida. */
export function registerBody(data: RegData) {
  const rule = emailRule(data.email);
  const fullName = cleanName(data.fullName);
  return {
    email: cleanEmail(data.email),
    rol: data.rol,
    campus: rule?.campus || data.campus,
    full_name: fullName,
    username: cleanUsername(data.username),
    password: data.password,
    nick: cleanNick(data.nick) || firstName(fullName),
    tone: data.tone,
  };
}

/* --- Lo que responde la función -------------------------------------------------------------- */

export type CuentaCode =
  | "correo" | "rol" | "sede" | "nombre" | "usuario" | "clave" | "existe" | "intranet" | "correos" | "alta"
  | "credenciales" | "sin_confirmar" | "suspendida" | "bloqueada" | "limite" | "migracion"
  /** Los que pone la página: sin red, la función no está desplegada, o respondió algo que no se entiende. */
  | "red" | "sin_funcion" | "desconocido";

const KNOWN: string[] = ["correo", "rol", "sede", "nombre", "usuario", "clave", "existe", "intranet", "correos", "alta", "credenciales", "sin_confirmar", "suspendida", "bloqueada", "limite", "migracion"];

const waitText = (seconds: number) => (seconds >= 90 ? `${Math.round(seconds / 60)} minutos` : `${Math.max(1, Math.round(seconds))} segundos`);

const FALLBACK: Record<CuentaCode, string> = {
  correo: "Ese correo no es de la UDES. Solo se aceptan correos institucionales.",
  rol: "Ese perfil no corresponde a su correo.",
  sede: "Elija su sede: Bucaramanga, Cúcuta, Valledupar o Bogotá.",
  nombre: "Escriba su nombre completo.",
  usuario: "Ese usuario no está disponible. Pruebe con otro.",
  clave: "La contraseña lleva 8 caracteres o más, con una letra y un número.",
  existe: "Ese correo ya tiene una cuenta de Pilo. Entre con su usuario.",
  intranet: "Ese correo ya tiene una cuenta en la intranet de la universidad. Entre a Pilo con esa cuenta.",
  correos: "Se enviaron muchos correos en poco tiempo. Intente de nuevo en unos minutos.",
  alta: "No pude crear la cuenta. Intente de nuevo en un momento.",
  // Nunca dice si el usuario existe: la misma frase para «no existe» y «contraseña errada».
  credenciales: "El usuario o la contraseña no coinciden.",
  sin_confirmar: "Aún no ha confirmado su correo. Revise su bandeja y abra el enlace que le enviamos.",
  suspendida: "Su cuenta de Pilo está suspendida. Escriba a la administración.",
  bloqueada: "Demasiados intentos. Espere unos minutos antes de volver a intentarlo.",
  limite: "Va muy rápido: espere un momento antes de volver a intentarlo.",
  migracion: "Las cuentas de Pilo todavía no están disponibles: la administración debe terminar de instalarlas. Mientras tanto puede usar a Pilo sin cuenta.",
  red: "No pude conectarme. Revise su conexión a internet e intente de nuevo.",
  sin_funcion: "Las cuentas de Pilo todavía no están disponibles. Mientras tanto puede usar a Pilo sin cuenta.",
  desconocido: "Algo falló. Intente de nuevo en un momento.",
};

export interface CuentaFailure {
  code: CuentaCode;
  message: string;
  /** Segundos que hay que esperar (solo `limite`). */
  retryAfter?: number;
}

/**
 * Una respuesta de error de `pilo-cuentas`, como algo que la persona entiende.
 * El texto del servidor se usa cuando su código es conocido; lo demás (la
 * función no existe, un 500 sin código) lleva un texto de la página.
 */
export function cuentaFailure(status: number, body: unknown): CuentaFailure {
  const b = (body && typeof body === "object" ? body : {}) as { error?: unknown; code?: unknown; retry_after?: unknown };
  const said = typeof b.error === "string" ? b.error.trim() : "";
  const raw = typeof b.code === "string" ? b.code : "";
  // La plataforma responde 404 cuando la función no está desplegada (con su propio «code»).
  if (status === 404 && !KNOWN.includes(raw)) return { code: "sin_funcion", message: FALLBACK.sin_funcion };
  const code: CuentaCode = KNOWN.includes(raw) ? (raw as CuentaCode) : status === 429 ? "limite" : "desconocido";
  if (code === "migracion") return { code, message: FALLBACK.migracion };
  if (code === "credenciales") return { code, message: FALLBACK.credenciales };
  if (code === "limite") {
    const n = Number(b.retry_after);
    const retryAfter = Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
    return { code, message: `${said || FALLBACK.limite}${retryAfter ? tr(" Podrá intentarlo de nuevo en {v0}.", { v0: waitText(retryAfter) }) : ""}`, retryAfter };
  }
  // Sin código conocido: lo que dijo la función (siempre en palabras de la persona), o un texto de la página.
  if (code === "desconocido") return { code, message: said || FALLBACK.desconocido };
  return { code, message: said || FALLBACK[code] };
}

export const cuentaMessage = (code: CuentaCode): string => tr(FALLBACK[code]);

/** A qué paso del registro pertenece un error del servidor; null = no es de un campo (se dice donde esté la persona). */
export function registerErrorStep(code: CuentaCode, steps: RegStep[]): RegStep | null {
  const step: Partial<Record<CuentaCode, RegStep>> = { correo: "correo", existe: "correo", intranet: "correo", rol: "perfil", sede: "sede", nombre: "identidad", usuario: "identidad", clave: "clave" };
  const s = step[code];
  if (!s) return null;
  // Sin el paso de la sede (el dominio la dice), un error de sede se dice en el del perfil.
  return steps.includes(s) ? s : s === "sede" ? "perfil" : null;
}

/** El campo que marca un error del servidor. */
export function registerErrorField(code: CuentaCode): StepProblem["field"] | null {
  const field: Partial<Record<CuentaCode, StepProblem["field"]>> = { correo: "email", existe: "email", intranet: "email", rol: "rol", sede: "campus", nombre: "fullName", usuario: "username", clave: "password" };
  return field[code] ?? null;
}

/** ¿Las cuentas no están instaladas? (falta la migración o la función): se ofrece seguir sin cuenta. */
export const cuentasOff = (code: CuentaCode): boolean => code === "migracion" || code === "sin_funcion";

/* --- La cuenta ------------------------------------------------------------------------------- */

export interface PiloAccount {
  id: string;
  username: string;
  full_name: string;
  email: string;
  rol: PiloRol;
  campus: Campus | "";
  status: "activa" | "suspendida";
  nick: string;
  tone: Tone;
  length: Length;
  about: string;
  program: string;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

/** La fila propia de `pilo_users`; null si no hay, o si no se entiende. */
export function parseAccount(row: unknown): PiloAccount | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!str(r.id) || !str(r.username) || !isRol(r.rol)) return null;
  return {
    id: str(r.id),
    username: str(r.username),
    full_name: str(r.full_name),
    email: str(r.email),
    rol: r.rol,
    campus: isCampus(r.campus) ? r.campus : "",
    status: r.status === "suspendida" ? "suspendida" : "activa",
    nick: str(r.nick),
    tone: isTone(r.tone) ? r.tone : "cercano",
    length: isLength(r.length) ? r.length : "normal",
    about: str(r.about),
    program: str(r.program),
  };
}

/** ¿Cuenta como sesión en Pilo? Solo la cuenta activa. */
export const isMember = (account: PiloAccount | null | undefined): boolean => account?.status === "activa";

/** ¿El correo fija la sede? Entonces no se cambia en el perfil. */
export const campusFixed = (account: Pick<PiloAccount, "email">): boolean => Boolean(emailRule(account.email)?.campus);

export interface Prefs {
  nick: string;
  tone: Tone;
  length: Length;
  about: string;
  program: string;
  campus: Campus | "";
}

export const prefsOf = (a: PiloAccount): Prefs => ({ nick: a.nick, tone: a.tone, length: a.length, about: a.about, program: a.program, campus: a.campus });

/** Lo que cambió, listo para `pilo_user_update_prefs`: solo las claves que la función acepta; la sede, solo si el correo no la fija. */
export function prefsPatch(account: PiloAccount, next: Prefs): Partial<Prefs> {
  const patch: Partial<Prefs> = {};
  const nick = cleanNick(next.nick);
  if (nick !== account.nick) patch.nick = nick;
  if (next.tone !== account.tone) patch.tone = next.tone;
  if (next.length !== account.length) patch.length = next.length;
  const about = next.about.trim().slice(0, 400);
  if (about !== account.about) patch.about = about;
  const program = cleanName(next.program).slice(0, 120);
  if (program !== account.program) patch.program = program;
  if (!campusFixed(account) && isCampus(next.campus) && next.campus !== account.campus) patch.campus = next.campus;
  return patch;
}

/** En Enseñanza, el rol que cuenta es el de la cuenta: estudiante, profesor o «general» para un administrativo. */
export const memberAskRol = (account: PiloAccount): "estudiante" | "profesor" | "general" => (account.rol === "administrativo" ? "general" : account.rol);

/** Cómo se ve la persona en el menú: su nombre, y debajo el perfil y el usuario. */
export function personCard(account: PiloAccount): { name: string; under: string; initial: string } {
  const name = account.full_name || account.nick || account.username;
  return { name, under: `${rolLabel(account.rol)} · @${account.username}`, initial: (account.nick || name).trim().charAt(0).toUpperCase() || "P" };
}

/* --- Así le respondería Pilo ---------------------------------------------------------------- */

/** Una muestra de cómo cambia la respuesta con el nombre, el tono y la extensión. Es un ejemplo: no la escribe la IA. */
export function previewAnswer(nick: string, tone: Tone, length: Length): string {
  const name = cleanNick(nick);
  const open = { cercano: name ? tr("¡Claro, {name}!", { name }) : tr("¡Claro!"), formal: name ? tr("Con gusto, {name}.", { name }) : tr("Con gusto."), directo: name ? `${name}:` : "" }[tone];
  const body = {
    corta: tr("Una rúbrica dice qué se evalúa y con qué niveles."),
    normal: tr("Una rúbrica dice qué se evalúa y con qué niveles. Así se sabe desde el inicio cómo se calificará un trabajo."),
    detallada:
      tr("Una rúbrica dice qué se evalúa y con qué niveles. Así se sabe desde el inicio cómo se calificará un trabajo. Por ejemplo, en un proyecto puede valorar el diseño, las pruebas y la documentación por separado."),
  }[length];
  return [open, body].filter(Boolean).join(" ");
}

/** Lo que gana quien se registra: lo mismo en el registro, en el menú y en el perfil. */
export const ACCOUNT_BENEFITS: { title: string; text: string }[] = [
  { title: "Funciones ampliadas de la universidad", text: "Lo que la universidad abre solo a quienes tienen cuenta." },
  { title: "Respuestas a su medida", text: "Pilo sabe si es estudiante, profesor o administrativo, su sede y cómo prefiere que le hable." },
  { title: "Guardar respuestas", text: "Las encuentra en cualquier dispositivo, con su buscador." },
  { title: "Más cupo", text: "Puede preguntar más seguido y recibir respuestas más extensas." },
];
