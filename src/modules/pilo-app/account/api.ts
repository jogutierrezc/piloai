/* =============================================================================
   Mr. Pilo · cuentas (0120) · los pedidos a la función `pilo-cuentas`.

   Va con `fetch` directo y la clave anónima: quien se registra o entra aún no
   tiene sesión. Solo «eliminar» (la administración) lleva el token de la
   sesión. Cada fallo llega como CuentaError, con el código del contrato y un
   texto que la persona entiende (rules.ts).

   La contraseña pasa por aquí hacia la función y no se guarda en ningún
   sitio: ni en el almacenamiento del navegador ni en un registro.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";
import { cleanUsername, cuentaFailure, cuentaMessage } from "./rules";
import type { CuentaCode, RegData } from "./rules";
import { registerBody } from "./rules";

export class CuentaError extends Error {
  constructor(
    message: string,
    readonly code: CuentaCode,
    readonly retryAfter?: number,
  ) {
    super(message);
  }
}

export const asCuentaError = (error: unknown): CuentaError => (error instanceof CuentaError ? error : new CuentaError(cuentaMessage("desconocido"), "desconocido"));

async function call<T>(body: Record<string, unknown>, withSession = false): Promise<T> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key";
  let token = anonKey;
  if (withSession) {
    try {
      token = (await supabase.auth.getSession()).data.session?.access_token ?? anonKey;
    } catch {
      /* sin sesión: la función lo dirá */
    }
  }
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/pilo-cuentas`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    // El navegador no deja leer la respuesta: o no hay red, o la función no está desplegada (la plataforma
    // responde sin las cabeceras que el navegador pide). Una consulta sin leer la respuesta distingue las dos.
    const reachable = await fetch(`${base}/functions/v1/pilo-cuentas`, { method: "GET", mode: "no-cors", cache: "no-store" }).then(
      () => true,
      () => false,
    );
    const code: CuentaCode = reachable ? "sin_funcion" : "red";
    throw new CuentaError(cuentaMessage(code), code);
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* sin cuerpo, o no es JSON */
  }
  if (!response.ok) {
    const failure = cuentaFailure(response.status, parsed);
    throw new CuentaError(failure.message, failure.code, failure.retryAfter);
  }
  return parsed as T;
}

/** ¿Está libre este nombre de usuario? */
export async function checkUsername(username: string): Promise<{ free: boolean; reason: string }> {
  const out = await call<{ free?: boolean; reason?: string }>({ action: "usuario", username: cleanUsername(username) });
  return { free: out?.free === true, reason: typeof out?.reason === "string" ? out.reason : "" };
}

/**
 * Crea la cuenta y dice cómo se sigue:
 *   «entro»       la cuenta quedó lista y la sesión, abierta (la confirmación por correo está apagada);
 *   «ingresar»    quedó lista, pero hay que entrar con el usuario;
 *   «confirmar»   se envió un correo y hasta confirmarlo no se puede entrar.
 */
export async function registerAccount(data: RegData): Promise<"entro" | "ingresar" | "confirmar"> {
  const out = await call<{ confirm?: boolean; session?: { access_token?: string; refresh_token?: string } }>({ action: "registrar", ...registerBody(data) });
  // Una función anterior no dice `confirm`: entonces sí se confirma por correo.
  if (out?.confirm !== false) return "confirmar";
  const access_token = out.session?.access_token;
  const refresh_token = out.session?.refresh_token;
  if (!access_token || !refresh_token) return "ingresar";
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  return error ? "ingresar" : "entro";
}

/** Entra con usuario y contraseña: la función devuelve la sesión y aquí se instala. */
export async function loginAccount(username: string, password: string): Promise<void> {
  const out = await call<{ session?: { access_token?: string; refresh_token?: string } }>({ action: "ingresar", username: cleanUsername(username), password });
  const access_token = out?.session?.access_token;
  const refresh_token = out?.session?.refresh_token;
  if (!access_token || !refresh_token) throw new CuentaError(cuentaMessage("desconocido"), "desconocido");
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw new CuentaError(cuentaMessage("desconocido"), "desconocido");
}

/** Reenvía el correo de confirmación. Responde igual exista o no el usuario. */
export async function resendConfirmation(username: string): Promise<void> {
  await call({ action: "reenviar", username: cleanUsername(username) });
}

/** Envía el correo para cambiar la contraseña. Responde igual exista o no el usuario. */
export async function recoverPassword(username: string): Promise<void> {
  await call({ action: "recuperar", username: cleanUsername(username) });
}

/** Elimina una cuenta de Pilo (solo la administración, con su sesión). */
export async function deletePiloUser(userId: string): Promise<void> {
  await call({ action: "eliminar", user_id: userId }, true);
}
