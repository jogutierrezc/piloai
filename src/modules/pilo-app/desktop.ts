/* =============================================================================
   Mr. Pilo · la app de escritorio.

   La misma app (/app), instalada en un computador: desde la Microsoft Store
   (el paquete que arma PWABuilder, ver pilo-escritorio/LEEME.md) o con
   «Instalar» en Edge o Chrome. No es otro código: es la app corriendo en su
   propia ventana, fuera del navegador, en un equipo que no es un teléfono.

   En el computador Pilo pide cuenta siempre: no hay modo sin cuenta. Vale la
   cuenta de Pilo (0120) o la sesión de la intranet. En el teléfono y en la
   pestaña del navegador todo sigue como antes.

   Puro: se prueba en node.
   ========================================================================== */

import { isIosDevice, isStandalone } from "./pwa";

/** ¿Un teléfono o una tableta? Un iPad moderno dice ser Mac, pero tiene pantalla táctil. */
export function isMobileDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return /Android|Mobile|Windows Phone/i.test(userAgent) || isIosDevice(userAgent, maxTouchPoints);
}

/** ¿La app instalada en un computador? En su propia ventana y no en un teléfono. */
export function desktopApp(input: { standalone: boolean; userAgent: string; maxTouchPoints?: number }): boolean {
  return input.standalone && !isMobileDevice(input.userAgent, input.maxTouchPoints ?? 0);
}

export function isDesktopApp(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return desktopApp({ standalone: isStandalone(), userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints });
}

/**
 * Qué hace la app de escritorio con quien llega:
 *   «libre»    no es la app de escritorio, o ya entró con su cuenta
 *   «espera»   aún se está leyendo la sesión: no se pinta nada que se pueda usar
 *   «cuenta»   no ha entrado: solo ve la bienvenida y las pantallas de la cuenta
 */
export function desktopGate(input: { desktop: boolean; pending: boolean; signedIn: boolean }): "libre" | "espera" | "cuenta" {
  if (!input.desktop || input.signedIn) return "libre";
  return input.pending ? "espera" : "cuenta";
}
