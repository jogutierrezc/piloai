/* =============================================================================
   Carnet digital · la lógica pura de la función `pilo-carnet`.

   Todo lo que la función decide sin tocar la red ni la base: el código del
   carnet (firmado con HMAC-SHA256, ligado a la persona y a una ventana de 30 s),
   cómo se comprueba, qué se le dice a quien verifica, y el pase de Google Wallet
   (el contenido del pase y su firma RS256).

   La función del servidor (supabase/functions/pilo-carnet/index.ts) es un solo
   archivo, porque el editor del panel de Supabase solo acepta uno, y lleva
   dentro una copia exacta de este archivo. La prueba servidor-sync.test.ts
   falla si las dos se separan: al cambiar algo aquí, hay que copiarlo también
   en index.ts.

   Por eso este archivo no importa nada y solo usa lo que existe igual en Deno y
   en Node 20+ (Web Crypto, TextEncoder, btoa/atob).

   EL CÓDIGO (token):  UP1.<tipo>.<persona>.<sello>.<firma>
     tipo      «r» (QR que cambia: el sello es el número de ventana de 30 s)
               «v» (verificación para un tercero: el sello es el vencimiento, en
               segundos Unix, base 36; dura 5 minutos)
     persona   el identificador de la cuenta (16 bytes, base64url): un número sin
               sentido fuera de Pilo; ningún dato personal legible
     firma     HMAC-SHA256(secreto, «tipo|persona|sello»), 12 bytes en base64url
   Con una ventana de tolerancia (±1) el código «r» sirve entre 30 y 60 s: una
   captura de pantalla vence en un minuto como máximo.
   ========================================================================== */

/* --- Constantes ------------------------------------------------------------------------------ */

export const WINDOW_SECONDS = 30;
/** Ventanas de tolerancia al verificar un código «r»: ±1 ventana (la ventana en curso, la anterior y la siguiente). */
export const TOLERANCE = 1;
/** Cuánto vale la verificación para un tercero. */
export const VERIFY_SECONDS = 300;
const TOKEN_PREFIX = "UP1";
const MAC_BYTES = 12;

/* --- Bytes ----------------------------------------------------------------------------------- */

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return null;
  try {
    const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
    const binary = atob(padded);
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function uuidToBytes(id: string): Uint8Array | null {
  const lower = id.toLowerCase();
  if (!UUID.test(lower)) return null;
  const hex = lower.replace(/-/g, "");
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16));
}

export function bytesToUuid(bytes: Uint8Array): string | null {
  if (bytes.length !== 16) return null;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

async function hmac(secret: string, message: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message)));
}

/** Comparación sin atajos: tarda lo mismo acierte donde acierte. */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/* --- El código del carnet -------------------------------------------------------------------- */

export type TokenKind = "r" | "v";

/** El número de la ventana de 30 s en que cae un momento. */
export const windowOf = (nowMs: number): number => Math.floor(nowMs / (WINDOW_SECONDS * 1000));

/** Segundos que le quedan a la ventana en curso (1 a 30). */
export const windowLeft = (nowMs: number): number => WINDOW_SECONDS - (Math.floor(nowMs / 1000) % WINDOW_SECONDS);

/** Firma un código para una persona. `stamp` es la ventana («r») o el vencimiento en segundos Unix («v»). */
export async function signToken(secret: string, kind: TokenKind, userId: string, stamp: number): Promise<string | null> {
  const who = uuidToBytes(userId);
  if (!who || !secret || !Number.isInteger(stamp) || stamp < 0) return null;
  const person = toBase64Url(who);
  const mark = stamp.toString(36);
  const mac = (await hmac(secret, `${kind}|${person}|${mark}`)).slice(0, MAC_BYTES);
  return [TOKEN_PREFIX, kind, person, mark, toBase64Url(mac)].join(".");
}

export type TokenCheck = { ok: true; userId: string; kind: TokenKind } | { ok: false; reason: "formato" | "firma" | "vencido" };

/** Lee un código y comprueba la firma y la vigencia. No dice nada de la persona: solo quién es (su identificador). */
export async function checkToken(secret: string, text: unknown, nowMs: number): Promise<TokenCheck> {
  if (typeof text !== "string" || text.length > 120) return { ok: false, reason: "formato" };
  const parts = text.trim().split(".");
  if (parts.length !== 5 || parts[0] !== TOKEN_PREFIX) return { ok: false, reason: "formato" };
  const [, kind, person, mark, mac] = parts;
  if (kind !== "r" && kind !== "v") return { ok: false, reason: "formato" };
  if (!/^[0-9a-z]{1,12}$/.test(mark)) return { ok: false, reason: "formato" };
  const who = fromBase64Url(person);
  const given = fromBase64Url(mac);
  const userId = who ? bytesToUuid(who) : null;
  if (!userId || !given) return { ok: false, reason: "formato" };
  const expected = (await hmac(secret, `${kind}|${person}|${mark}`)).slice(0, MAC_BYTES);
  if (!sameBytes(expected, given)) return { ok: false, reason: "firma" };
  const stamp = parseInt(mark, 36);
  if (kind === "r") {
    if (Math.abs(stamp - windowOf(nowMs)) > TOLERANCE) return { ok: false, reason: "vencido" };
  } else if (stamp * 1000 < nowMs) {
    return { ok: false, reason: "vencido" };
  }
  return { ok: true, userId, kind };
}

/* --- Lo que se le dice a quien verifica ------------------------------------------------------ */

export const ROL_LABEL: Record<string, string> = { estudiante: "Estudiante", profesor: "Profesor", administrativo: "Administrativo" };
export const CAMPUS_LABEL: Record<string, string> = { bucaramanga: "Bucaramanga", cucuta: "Cúcuta", valledupar: "Valledupar", bogota: "Bogotá" };
const VINCULACION_LABEL: Record<string, string> = { planta: "Planta", ocasional: "Ocasional", catedra: "Cátedra" };

export interface CarnetAccount {
  full_name: string;
  rol: string;
  campus: string;
  status: string;
}

export interface CarnetPerfil {
  programa?: string | null;
  semestre?: number | null;
  jornada?: string | null;
  facultad?: string | null;
  vinculacion?: string | null;
  dependencia?: string | null;
  cargo?: string | null;
  suspendido_en?: string | null;
}

/** «Ingeniería de Software · 5.º semestre», «Ingenierías · Planta», «Planeación · Profesional»; "" si aún no hay datos. */
export function perfilLine(rol: string, perfil: CarnetPerfil | null | undefined): string {
  const p = perfil ?? {};
  const join = (...items: (string | null | undefined)[]) => items.filter((x): x is string => Boolean(x)).join(" · ");
  if (rol === "estudiante") return join(p.programa, p.semestre ? `${p.semestre}.º semestre` : null);
  if (rol === "profesor") return join(p.facultad, p.vinculacion ? VINCULACION_LABEL[p.vinculacion] : null);
  if (rol === "administrativo") return join(p.dependencia, p.cargo);
  return "";
}

export interface Vigencia {
  vigente: boolean;
  /** Por qué no: «suspendido» (la persona reportó pérdida) o «cuenta» (la cuenta de Pilo está suspendida). */
  motivo: "" | "suspendido" | "cuenta";
}

export function vigencia(account: CarnetAccount, perfil: CarnetPerfil | null | undefined): Vigencia {
  if (account.status !== "activa") return { vigente: false, motivo: "cuenta" };
  if (perfil?.suspendido_en) return { vigente: false, motivo: "suspendido" };
  return { vigente: true, motivo: "" };
}

/**
 * Lo ÚNICO que ve quien verifica: nombre, perfil y vigencia (más la sede, que es parte del carnet).
 * Nunca el código de estudiante, el RH, el contacto, la foto ni el correo.
 */
export function verificationCard(account: CarnetAccount, perfil: CarnetPerfil | null | undefined) {
  const state = vigencia(account, perfil);
  return {
    nombre: account.full_name,
    perfil: ROL_LABEL[account.rol] ?? "",
    detalle: perfilLine(account.rol, perfil),
    sede: CAMPUS_LABEL[account.campus] ?? "",
    vigente: state.vigente,
    motivo: state.motivo,
  };
}

/* --- Los contadores del límite (copia de pilo-ia; la prueba de sincronía la vigila) ---------- */

/** La ventana fija en que cae un momento: cuándo empezó y cuántos segundos le quedan. */
export function rateWindow(nowMs: number, windowSeconds: number): { start: string; retryAfter: number } {
  const size = Math.max(1, Math.floor(windowSeconds)) * 1000;
  const from = Math.floor(nowMs / size) * size;
  return { start: new Date(from).toISOString(), retryAfter: Math.max(1, Math.ceil((from + size - nowMs) / 1000)) };
}

/** De qué sale la huella del límite por visitante. El espacio entra solo si no es el de partida. */
export const visitorSeed = (salt: string, day: string, scope: string, key: string, space = "planeacion"): string =>
  space === "planeacion" ? `${salt}|${day}|${scope}|${key}` : `${salt}|${day}|${scope}|${space}|${key}`;

/* --- Google Wallet --------------------------------------------------------------------------- */

export interface WalletEnv {
  issuerId: string;
  serviceEmail: string;
  serviceKey: string;
  classId: string;
  /** Opcionales. */
  logoUrl?: string;
  color?: string;
  origin?: string;
}

/** Lee las variables de entorno del pase; null si falta alguna de las cuatro obligatorias. */
export function walletEnv(get: (name: string) => string | undefined): WalletEnv | null {
  const issuerId = (get("GOOGLE_WALLET_ISSUER_ID") ?? "").trim();
  const serviceEmail = (get("GOOGLE_WALLET_SA_EMAIL") ?? "").trim();
  // La llave suele pegarse con los saltos de línea escritos como \n.
  const serviceKey = (get("GOOGLE_WALLET_SA_KEY") ?? "").replace(/\\n/g, "\n").trim();
  let classId = (get("GOOGLE_WALLET_CLASS_ID") ?? "").trim();
  if (!issuerId || !serviceEmail || !serviceKey || !classId) return null;
  if (!/^\d+$/.test(issuerId)) return null;
  // Se admite el identificador completo («emisor.clase») o solo la clase.
  if (!classId.includes(".")) classId = `${issuerId}.${classId}`;
  if (!/^[0-9]+\.[A-Za-z0-9._-]+$/.test(classId)) return null;
  const logoUrl = (get("GOOGLE_WALLET_LOGO_URL") ?? "").trim();
  const color = (get("GOOGLE_WALLET_COLOR") ?? "").trim();
  const origin = (get("ALLOWED_ORIGIN") ?? "").trim();
  return {
    issuerId,
    serviceEmail,
    serviceKey,
    classId,
    ...(/^https:\/\/\S+$/.test(logoUrl) ? { logoUrl } : {}),
    ...(/^#[0-9a-fA-F]{6}$/.test(color) ? { color } : {}),
    ...(/^https?:\/\/[^/*]+$/.test(origin) ? { origin } : {}),
  };
}

const localized = (value: string) => ({ defaultValue: { language: "es-CO", value } });

/**
 * El objeto «Genérico» del pase. SOLO viajan nombre, perfil, sede y vigencia: ni el código de
 * estudiante, ni la foto, ni las notas, ni el RH, ni un código QR (el que cambia vive en la app).
 * El identificador del objeto sale de una firma de la persona: Google no recibe su identificador de cuenta.
 */
export async function walletObject(env: WalletEnv, secret: string, userId: string, card: ReturnType<typeof verificationCard>, todayIso: string) {
  const suffix = hex((await hmac(secret, `wallet|${userId}`)).slice(0, 12));
  const modules = [
    { id: "perfil", header: "Perfil", body: card.detalle ? `${card.perfil} · ${card.detalle}` : card.perfil },
    ...(card.sede ? [{ id: "sede", header: "Sede", body: card.sede }] : []),
    { id: "vigencia", header: "Vigencia", body: card.vigente ? `Vigente al ${todayIso}` : "Suspendido" },
  ];
  return {
    id: `${env.issuerId}.${suffix}`,
    classId: env.classId,
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    state: card.vigente ? "ACTIVE" : "INACTIVE",
    cardTitle: localized("Universidad de Santander"),
    subheader: localized("Carnet digital"),
    header: localized(card.nombre),
    textModulesData: modules,
    ...(env.color ? { hexBackgroundColor: env.color } : {}),
    ...(env.logoUrl ? { logo: { sourceUri: { uri: env.logoUrl }, contentDescription: localized("Universidad de Santander") } } : {}),
  };
}

/** Las reclamaciones del JWT «Agregar a Google Wallet». */
export function walletClaims(env: WalletEnv, genericObject: unknown, nowSec: number) {
  return {
    iss: env.serviceEmail,
    aud: "google",
    typ: "savetowallet",
    iat: nowSec,
    origins: env.origin ? [env.origin] : [],
    payload: { genericObjects: [genericObject] },
  };
}

function pemToDer(pem: string): ArrayBuffer | null {
  const body = pem.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "").replace(/-----END [A-Z ]*PRIVATE KEY-----/, "").replace(/\s+/g, "");
  try {
    return Uint8Array.from(atob(body), (c) => c.charCodeAt(0)).buffer as ArrayBuffer;
  } catch {
    return null;
  }
}

/** Firma un JWT RS256 con la llave PKCS#8 (PEM) de la cuenta de servicio; null si la llave no sirve. */
export async function signRs256(claims: unknown, pem: string): Promise<string | null> {
  const der = pemToDer(pem);
  if (!der) return null;
  try {
    const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const enc = new TextEncoder();
    const head = toBase64Url(enc.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
    const body = toBase64Url(enc.encode(JSON.stringify(claims)));
    const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(`${head}.${body}`)));
    return `${head}.${body}.${toBase64Url(signature)}`;
  } catch {
    return null;
  }
}

/** El enlace «Agregar a Google Wallet». */
export const walletLink = (jwt: string): string => `https://pay.google.com/gp/v/save/${jwt}`;
