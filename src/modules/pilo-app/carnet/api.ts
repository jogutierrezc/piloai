/* =============================================================================
   Mr. Pilo · carnet · los pedidos al servidor.

   El perfil se lee y se escribe con la sesión de la persona (RLS: solo su fila,
   tabla pilo_user_perfil, 0141). El código del carnet, la verificación, la
   suspensión, Google Wallet y el uso de los límites van a la función
   `pilo-carnet`, con la misma sesión.

   Nada de esto se guarda en el almacenamiento del navegador salvo la foto del
   carnet (ver photo.ts), que nunca sale del teléfono.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";
import { asCode, carnetMessage } from "./logic";
import type { CarnetCode } from "./logic";
import { parsePerfil, perfilRow } from "./rules";
import type { PerfilForm, PerfilLoaded } from "./rules";
import type { PiloRol } from "../account/rules";

export class CarnetError extends Error {
  constructor(
    readonly code: CarnetCode,
    readonly retryAfter?: number,
  ) {
    super(carnetMessage(code));
  }
}

export const asCarnetError = (error: unknown): CarnetError => (error instanceof CarnetError ? error : new CarnetError("desconocido"));

/* --- El perfil ------------------------------------------------------------------------------- */

/** Lee el perfil de la cuenta. Sin la migración 0141, falla con «migracion». */
export async function loadPerfil(userId: string): Promise<PerfilLoaded> {
  const { data, error } = await supabase.from("pilo_user_perfil").select("*").eq("user_id", userId).maybeSingle();
  if (error) throw new CarnetError("migracion");
  return parsePerfil(data);
}

/** Guarda los datos del carnet (solo las columnas que la persona puede escribir). */
export async function savePerfil(userId: string, rol: PiloRol, form: PerfilForm): Promise<PerfilLoaded> {
  const { error } = await supabase.from("pilo_user_perfil").upsert(perfilRow(userId, rol, form), { onConflict: "user_id" });
  if (error) throw new CarnetError(/pilo_user_perfil/i.test(error.message) && /does not exist|schema cache/i.test(error.message) ? "migracion" : "interno");
  return loadPerfil(userId);
}

/* --- La función pilo-carnet ------------------------------------------------------------------ */

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key";
  let session: string | undefined;
  try {
    session = (await supabase.auth.getSession()).data.session?.access_token;
  } catch {
    session = undefined;
  }
  if (!session) throw new CarnetError("sesion");
  const address = `${base}/functions/v1/pilo-carnet`;
  let response: Response;
  try {
    response = await fetch(address, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${session}` },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    // O no hay red, o la función no está desplegada (la plataforma responde sin las cabeceras que el navegador pide).
    const reachable = await fetch(address, { method: "GET", mode: "no-cors", cache: "no-store" }).then(
      () => true,
      () => false,
    );
    throw new CarnetError(reachable ? "sin_funcion" : "sin_red");
  }
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = (await response.json()) as Record<string, unknown>;
  } catch {
    /* sin cuerpo */
  }
  if (!response.ok) {
    const retry = typeof parsed?.retry_after === "number" ? parsed.retry_after : undefined;
    throw new CarnetError(response.status === 404 ? "sin_funcion" : asCode(parsed?.code), retry);
  }
  return (parsed ?? {}) as T;
}

export interface TokenReply {
  token: string;
  /** La hora del servidor al firmar, en ms. */
  ahora: number;
}

/** El código del QR de esta ventana de 30 s. */
export const fetchToken = () => call<TokenReply>({ action: "token" });

/** Un código de verificación para otra persona (vale 5 minutos). */
export const fetchShare = () => call<TokenReply & { vence_en: number }>({ action: "compartir" });

export const suspendCard = () => call<{ suspendido: boolean }>({ action: "suspender" });
export const reactivateCard = () => call<{ suspendido: boolean }>({ action: "reactivar" });

/** ¿Está habilitado Google Wallet en el servidor? (No crea ningún pase.) */
export const walletAvailable = async (): Promise<boolean> => {
  try {
    await call<{ disponible: boolean }>({ action: "wallet", estado: true });
    return true;
  } catch (error) {
    if (error instanceof CarnetError && (error.code === "wallet_no_configurado" || error.code === "carnet_no_configurado")) return false;
    throw error;
  }
};

/** El enlace «Agregar a Google Wallet». */
export const walletUrl = () => call<{ url: string }>({ action: "wallet" });

export interface Verified {
  nombre: string;
  perfil: string;
  detalle: string;
  sede: string;
  vigente: boolean;
  motivo: "" | "suspendido" | "cuenta";
}

/** Para profesores: verifica el código de un carnet y recibe solo nombre, perfil y vigencia. */
export const verifyCode = (codigo: string) => call<{ persona: Verified }>({ action: "verificar", codigo });

export interface LimitsUse {
  config: LimitsConfig;
  uso: Record<string, { preguntas: { usadas: number; renueva_en: number } | null; archivos: { usadas: number; renueva_en: number } | null }>;
}

export interface SpaceLimits {
  preguntas_max: number;
  ventana_s: number;
  respuesta_tokens: number;
  archivos: boolean;
  archivo_mb: number;
  archivos_dia: number;
  codigo: boolean;
  codigo_tokens: number;
}

export interface LimitsConfig {
  rol: string;
  campus: string;
  espacios: Record<string, SpaceLimits>;
}

/** Lo configurado y lo gastado en la ventana en curso. */
export const fetchLimitsUse = () => call<LimitsUse>({ action: "limites" });
