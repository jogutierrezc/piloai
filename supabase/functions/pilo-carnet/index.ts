/* =============================================================================
   Edge Function · pilo-carnet · Carnet digital de Mr. Pilo

   El carnet de quien tiene cuenta de Pilo (0120), en el teléfono. Esta función
   es el servidor del carnet: firma el código QR que cambia cada 30 segundos,
   lo verifica, suspende o reactiva el carnet, arma el enlace «Agregar a Google
   Wallet» y dice cuánto lleva usado la persona de sus límites.

   Lo que esta función NO hace, nunca:
     · No pone datos personales en el código: el QR lleva un identificador sin
       sentido fuera de Pilo, la ventana de tiempo y una firma HMAC-SHA256. Una
       captura de pantalla sirve entre 30 y 60 segundos (ventana ±1).
     · No entrega el código de estudiante, el RH, el contacto de emergencia, la
       foto ni el correo: ni a quien verifica ni a Google Wallet. Quien verifica
       recibe nombre, perfil, sede y vigencia (verificationCard).
     · No escribe nada en la base salvo el estado «suspendido» del carnet
       (pilo_user_perfil.suspendido_en, que el navegador no puede escribir) y el
       contador del límite de pedidos (pilo_visitor_hit).

   Quién llama: una cuenta de Pilo activa, con su sesión (verify_jwt = false;
   la sesión se comprueba aquí). Para «verificar», además, de perfil profesor.

   Acciones (POST, JSON, con la sesión):
     { action: "token" }                    → { token, ahora, ventana_s, renueva_en }
     { action: "compartir" }                → { token, vence_en }       (verificación para un tercero, 5 min)
     { action: "verificar", codigo }        → { persona: { nombre, perfil, detalle, sede, vigente, motivo } }   (solo profesores)
     { action: "suspender" }                → { suspendido: true }
     { action: "reactivar" }                → { suspendido: false }
     { action: "wallet" }                   → { url }  ·  503 { code: "wallet_no_configurado" } si falta la configuración
     { action: "wallet", estado: true }     → { disponible: true }  (solo pregunta si Wallet está habilitado; no crea el pase)
     { action: "limites" }                  → { config, uso }   (config: pilo_my_limits(); uso: lo gastado en la ventana en curso)

   Los errores llevan `error` (para la persona) y `code` (para la página).

   SECRETOS (Supabase › Edge Functions › Secrets):
     PILO_CARNET_SECRET           obligatorio para firmar y verificar códigos y armar el pase.
                                  Genere uno de 32 bytes al azar, por ejemplo:
                                    openssl rand -base64 32
                                  o   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
                                  No lo escriba en ningún archivo ni lo suba al repositorio. Al cambiarlo, los
                                  códigos vigentes dejan de servir (los del QR se renuevan solos).
     PILO_VISITOR_SALT            el mismo de pilo-ia (para leer los contadores del límite). Sin él se usa la llave
                                  de servicio del proyecto, igual que pilo-ia.
     ALLOWED_ORIGIN               el origen de la app (CORS).
     Google Wallet (todas obligatorias para que «wallet» funcione; sin ellas responde 503 wallet_no_configurado):
       GOOGLE_WALLET_ISSUER_ID    el «Issuer ID» de la consola de Google Wallet (solo dígitos).
       GOOGLE_WALLET_SA_EMAIL     el correo de la cuenta de servicio con acceso a la API de Wallet.
       GOOGLE_WALLET_SA_KEY       la llave privada de esa cuenta (PEM PKCS#8, «-----BEGIN PRIVATE KEY-----…»); puede
                                  pegarse con los saltos de línea escritos como \n.
       GOOGLE_WALLET_CLASS_ID     la clase «Genérica» ya creada y aprobada en la consola («emisor.clase» o solo «clase»).
     Opcionales: GOOGLE_WALLET_LOGO_URL (https, imagen pública) y GOOGLE_WALLET_COLOR (#RRGGBB).

   Un solo archivo: el editor del panel de Supabase solo acepta uno. Por eso la
   lógica pura va pegada aquí dentro (ver «lógica», más abajo).

   Despliegue:
     supabase functions deploy pilo-carnet --no-verify-jwt
     (o pegando este archivo en el editor del panel de Supabase)
   ========================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

// --- lógica: copia exacta de src/modules/pilo-app/carnet/servidor-logica.ts (la prueba servidor-sync lo vigila)
// Va dentro para que la función sea un solo archivo y se pueda desplegar
// también pegándola en el editor del panel de Supabase.

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

// --- fin de la lógica -------------------------------------------------------------

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

/** Ninguna respuesta se guarda en una caché: llevan el código o los datos de una persona. */
function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const ACTIONS = ["token", "compartir", "verificar", "suspender", "reactivar", "wallet", "limites"];
/** Las acciones que firman o comprueban con PILO_CARNET_SECRET. */
const NEEDS_SECRET = ["token", "compartir", "verificar", "wallet"];

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
  if (!ACTIONS.includes(action)) return json({ error: "Acción desconocida.", code: "datos" }, 400);

  try {
    /* --- Quién llama: solo una cuenta de Pilo activa ------------------------------------------- */
    const authorization = request.headers.get("Authorization") ?? "";
    const noSession = () => json({ error: "Para usar su carnet, entre con su cuenta de Pilo.", code: "sesion" }, 401);
    if (!authorization.startsWith("Bearer ") || authorization.slice(7) === anonKey) return noSession();
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const who = await caller.auth.getUser();
    if (who.error || !who.data.user) return noSession();
    const userId = who.data.user.id;

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const found = await admin.from("pilo_users").select("full_name, rol, campus, status").eq("id", userId).maybeSingle();
    if (found.error) return json({ error: "No pude revisar su cuenta de Pilo.", code: "interno" }, 500);
    const account = found.data as CarnetAccount | null;
    if (!account) return json({ error: "El carnet es para quienes tienen cuenta de Pilo.", code: "cuenta" }, 403);
    if (account.status !== "activa") return json({ error: "Su cuenta de Pilo está suspendida. Escriba a la administración.", code: "suspendida" }, 403);

    /* --- El límite: por cuenta y por dirección. De quien llama solo queda una huella con sal diaria. */
    const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-direccion";
    const salt = Deno.env.get("PILO_VISITOR_SALT") || serviceKey;
    const limited = async (scope: string, limit: number, windowSeconds: number, key: string): Promise<number | null> => {
      const now = Date.now();
      const start = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
      const visitorId = (await sha256(`${salt}|${new Date().toISOString().slice(0, 10)}|carnet:${scope}|${key}`)).slice(0, 40);
      const { data, error } = await admin.rpc("pilo_visitor_hit", { p_visitor: visitorId, p_window_start: new Date(start).toISOString() });
      // Sin la tabla del límite (0110) no se limita: mejor atender que dejar a todos fuera.
      if (error) return null;
      return Number(data ?? 0) > limit ? Math.max(1, Math.ceil((start + windowSeconds * 1000 - now) / 1000)) : null;
    };
    // «token» se pide cada 30 s con la pantalla abierta (20 en 10 minutos); «verificar» prueba códigos ajenos: pocos.
    const perUser = action === "token" ? 60 : action === "verificar" ? 60 : action === "limites" ? 60 : 12;
    const retry = (await limited(`${action}:u`, perUser, 600, userId)) ?? (await limited(`${action}:i`, perUser * 3, 600, ip));
    if (retry) return json({ error: "Va muy rápido: espere un momento antes de volver a intentarlo.", code: "limite", retry_after: retry }, 429, { "Retry-After": String(retry) });

    const secret = Deno.env.get("PILO_CARNET_SECRET") ?? "";
    if (NEEDS_SECRET.includes(action) && secret.length < 32) {
      return json({ error: "El carnet aún no está disponible: falta configurarlo en el servidor.", code: "carnet_no_configurado" }, 503);
    }

    const readPerfil = async (id: string): Promise<{ ok: true; perfil: CarnetPerfil | null } | { ok: false }> => {
      const row = await admin.from("pilo_user_perfil").select("programa, semestre, jornada, facultad, vinculacion, dependencia, cargo, suspendido_en").eq("user_id", id).maybeSingle();
      return row.error ? { ok: false } : { ok: true, perfil: (row.data ?? null) as CarnetPerfil | null };
    };
    const noMigration = () => json({ error: "El carnet todavía no está instalado: falta la migración 0141.", code: "migracion" }, 500);
    const suspended = () => json({ error: "Su carnet está suspendido. Reactívelo para volver a usarlo.", code: "suspendido" }, 423);

    /* --- Mis límites: lo configurado (pilo_my_limits) y lo gastado en la ventana en curso ------- */
    if (action === "limites") {
      const config = await caller.rpc("pilo_my_limits");
      if (config.error || !config.data) return json({ error: "No pude leer sus límites.", code: "migracion" }, 500);
      const cfg = config.data as { espacios?: Record<string, { preguntas_max?: number; ventana_s?: number; archivos?: boolean; archivos_dia?: number }> };
      const now = Date.now();
      const day = new Date(now).toISOString().slice(0, 10);
      const hits = async (scope: string, space: string, windowSeconds: number): Promise<{ usadas: number; renueva_en: number } | null> => {
        const window = rateWindow(now, windowSeconds);
        const visitor = (await sha256(visitorSeed(salt, day, scope, `m:${userId}`, space))).slice(0, 40);
        const row = await admin.from("pilo_visitor_hits").select("hits").eq("visitor", visitor).eq("window_start", window.start).maybeSingle();
        if (row.error) return null;
        return { usadas: Number((row.data as { hits?: number } | null)?.hits ?? 0), renueva_en: window.retryAfter };
      };
      const uso: Record<string, { preguntas: { usadas: number; renueva_en: number } | null; archivos: { usadas: number; renueva_en: number } | null }> = {};
      for (const [space, c] of Object.entries(cfg.espacios ?? {})) {
        uso[space] = {
          preguntas: (c.preguntas_max ?? 0) > 0 && (c.ventana_s ?? 0) > 0 ? await hits("p", space, c.ventana_s as number) : null,
          archivos: c.archivos && (c.archivos_dia ?? 0) > 0 ? await hits("f", space, 86_400) : null,
        };
      }
      return json({ config: cfg, uso });
    }

    const mine = await readPerfil(userId);
    if (!mine.ok) return noMigration();

    /* --- Suspender o reactivar: la persona, sobre su propio carnet ------------------------------- */
    if (action === "suspender" || action === "reactivar") {
      const stop = action === "suspender";
      const saved = await admin.from("pilo_user_perfil").upsert({ user_id: userId, suspendido_en: stop ? new Date().toISOString() : null }, { onConflict: "user_id" });
      if (saved.error) return json({ error: "No pude cambiar el estado de su carnet. Intente de nuevo.", code: "interno" }, 500);
      return json({ suspendido: stop });
    }

    /* --- Verificar el código de otra persona: solo un profesor con cuenta activa ----------------- */
    if (action === "verificar") {
      if (account.rol !== "profesor") return json({ error: "Verificar carnets es para profesores.", code: "perfil" }, 403);
      const read = await checkToken(secret, body.codigo, Date.now());
      if (!read.ok) {
        return json(
          read.reason === "vencido"
            ? { error: "Ese código ya venció. Pida a la persona que muestre el carnet de nuevo.", code: "codigo_vencido" }
            : { error: "Ese código no es de un carnet de Pilo.", code: "codigo_invalido" },
          400,
        );
      }
      const target = await admin.from("pilo_users").select("full_name, rol, campus, status").eq("id", read.userId).maybeSingle();
      if (target.error) return json({ error: "No pude revisar ese carnet.", code: "interno" }, 500);
      if (!target.data) return json({ error: "Ese código no es de un carnet de Pilo.", code: "codigo_invalido" }, 400);
      const theirs = await readPerfil(read.userId);
      if (!theirs.ok) return noMigration();
      return json({ persona: verificationCard(target.data as CarnetAccount, theirs.perfil) });
    }

    /* --- El código del carnet y la verificación para un tercero ---------------------------------- */
    if (action === "token" || action === "compartir") {
      if (!vigencia(account, mine.perfil).vigente) return suspended();
      const now = Date.now();
      if (action === "token") {
        const token = await signToken(secret, "r", userId, windowOf(now));
        if (!token) return json({ error: "No pude firmar el código.", code: "interno" }, 500);
        return json({ token, ahora: now, ventana_s: WINDOW_SECONDS, renueva_en: windowLeft(now) });
      }
      const expires = Math.floor(now / 1000) + VERIFY_SECONDS;
      const token = await signToken(secret, "v", userId, expires);
      if (!token) return json({ error: "No pude firmar el código.", code: "interno" }, 500);
      return json({ token, ahora: now, vence_en: VERIFY_SECONDS });
    }

    /* --- Google Wallet --------------------------------------------------------------------------- */
    const env = walletEnv((name) => Deno.env.get(name));
    if (!env) {
      return json({ error: "Google Wallet aún no está disponible: lo habilita la administración.", code: "wallet_no_configurado" }, 503);
    }
    // Solo preguntar si está habilitado (la app muestra el botón según esto): no crea ningún pase.
    if (body.estado === true) return json({ disponible: true });
    if (!vigencia(account, mine.perfil).vigente) return suspended();
    const card = verificationCard(account, mine.perfil);
    // Sin programa, facultad o dependencia el pase saldría vacío: primero se completan los datos.
    if (!card.detalle) return json({ error: "Complete los datos de su carnet para crear el pase.", code: "perfil_incompleto" }, 409);
    const now = Date.now();
    const object = await walletObject(env, secret, userId, card, new Date(now).toISOString().slice(0, 10));
    const jwt = await signRs256(walletClaims(env, object, Math.floor(now / 1000)), env.serviceKey);
    if (!jwt) return json({ error: "Google Wallet aún no está disponible: la llave del servicio no es válida.", code: "wallet_no_configurado" }, 503);
    return json({ url: walletLink(jwt) });
  } catch (error) {
    return json({ error: "Algo falló al atender el pedido.", code: "interno", detail: String((error as Error)?.message ?? error).slice(0, 200) }, 500);
  }
});
