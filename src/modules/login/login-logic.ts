/* Lógica pura del acceso a la administración de Pilo (sin React, probada). */

import type { PiloMood } from "../../components/pilo/PiloAvatar";

export const LOGIN_PATH = "/acceso-intranet";
export const ADMIN_HOME = "/admin";

/**
 * Destino tras entrar: la ruta de origen si es interna y segura; si no, /admin.
 * Es segura cuando empieza con "/" (ruta interna), no con "//" ni "/\" (URL
 * relativa al protocolo), no trae saltos de línea y no es el propio acceso.
 */
export function safeRedirect(from: unknown, home: string = ADMIN_HOME): string {
  if (typeof from !== "string") return home;
  if (!from.startsWith("/") || from.startsWith("//") || from.startsWith("/\\")) return home;
  if (/[\r\n\t\\]/.test(from)) return home;
  const path = from.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (path === "/" || path === LOGIN_PATH) return home;
  return from;
}

/** Ruta de origen guardada por la guarda en `location.state.from` (cadena o { pathname }). */
export function fromOfState(state: unknown): unknown {
  if (!state || typeof state !== "object") return undefined;
  const from = (state as { from?: unknown }).from;
  if (from && typeof from === "object" && typeof (from as { pathname?: unknown }).pathname === "string") {
    const f = from as { pathname: string; search?: unknown; hash?: unknown };
    return f.pathname + (typeof f.search === "string" ? f.search : "") + (typeof f.hash === "string" ? f.hash : "");
  }
  return from;
}

export type PiloLoginPhase = "clave" | "reposo" | "escribiendo" | "verificando" | "error" | "exito" | "sin-acceso";

export const PHASE_MOOD: Record<PiloLoginPhase, PiloMood> = {
  clave: "idea",
  reposo: "feliz",
  escribiendo: "bien",
  verificando: "piensa",
  error: "duda",
  exito: "excelente",
  "sin-acceso": "cuidado",
};

export const PHASE_LINE: Record<PiloLoginPhase, string> = {
  clave: "Bienvenido. Define una contraseña solo tuya y entras.",
  reposo: "Hola, soy Mr. Pilo. Entra para cuidar de lo que sé.",
  escribiendo: "Sigue con calma. Yo no miro la contraseña.",
  verificando: "Un momento, reviso tu llave…",
  error: "Mmm, eso no cuadra. Revisa e intenta de nuevo.",
  exito: "¡Listo! Te abro la puerta.",
  "sin-acceso": "Tu cuenta entró, pero aún no tiene llave para esta puerta.",
};

/** Mensaje claro para el error de inicio de sesión (el de Supabase llega en inglés). */
export function friendlyAuthError(message: string | undefined | null): string {
  const text = (message ?? "").toLowerCase();
  if (!text) return "No se pudo iniciar sesión. Intenta de nuevo.";
  if (text.includes("invalid login") || text.includes("invalid credentials") || text.includes("credenciales")) {
    return "El correo o la contraseña no coinciden. Revísalos e intenta de nuevo.";
  }
  if (text.includes("email not confirmed")) return "Tu correo aún no está confirmado. Revisa tu bandeja de entrada.";
  if (text.includes("rate") || text.includes("too many")) return "Hubo demasiados intentos. Espera un minuto antes de volver a probar.";
  if (text.includes("network") || text.includes("fetch")) return "No hay conexión con el servidor. Revisa tu red e intenta de nuevo.";
  return message ?? "No se pudo iniciar sesión.";
}

/** Fase visible según el estado del formulario. */
export function derivePhase(input: {
  pending: boolean;
  error: boolean;
  leaving: boolean;
  noAccess: boolean;
  typing: boolean;
  recovery?: boolean;
}): PiloLoginPhase {
  if (input.leaving) return "exito";
  if (input.noAccess) return "sin-acceso";
  if (input.pending) return "verificando";
  if (input.error) return "error";
  if (input.recovery && !input.typing) return "clave";
  if (input.typing) return "escribiendo";
  return "reposo";
}

/* --- Definir contraseña (invitación / recuperación) --------------------------- */

/** ¿La dirección trae ?clave=1 (enlace del correo de invitación o recuperación)? */
export function isRecoveryRequest(search: unknown): boolean {
  if (typeof search !== "string") return false;
  return new URLSearchParams(search).get("clave") === "1";
}

export const PASSWORD_MIN = 8;

export interface PasswordRule {
  id: "largo" | "letra" | "numero";
  label: string;
  met: boolean;
}

export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: "largo", label: `Al menos ${PASSWORD_MIN} caracteres`, met: password.length >= PASSWORD_MIN },
    { id: "letra", label: "Una letra", met: /\p{L}/u.test(password) },
    { id: "numero", label: "Un número", met: /\d/.test(password) },
  ];
}

/** Primer problema de la contraseña nueva, en español, o null si sirve. */
export function newPasswordProblem(password: string, confirm: string): { field: "password" | "confirm"; message: string } | null {
  const missing = passwordRules(password).find((rule) => !rule.met);
  if (missing) return { field: "password", message: `A la contraseña le falta: ${missing.label.toLowerCase()}.` };
  if (password !== confirm) return { field: "confirm", message: "Las dos contraseñas no coinciden." };
  return null;
}

/** Mensaje claro para el error de updateUser (Supabase responde en inglés). */
export function friendlyPasswordError(message: string | undefined | null): string {
  const text = (message ?? "").toLowerCase();
  if (/different|same/.test(text)) return "La contraseña nueva debe ser distinta de la anterior.";
  if (/weak|short|at least|characters/.test(text)) return "Esa contraseña es muy débil. Usa una más larga y variada.";
  if (/session|expired|invalid|jwt|token/.test(text)) return "El enlace venció. Pide otro correo de invitación o recupera tu contraseña.";
  if (/network|fetch/.test(text)) return "No hay conexión con el servidor. Revisa tu red e intenta de nuevo.";
  return "No se pudo guardar la contraseña. Intenta de nuevo.";
}
