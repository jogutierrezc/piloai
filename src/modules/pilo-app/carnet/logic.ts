/* =============================================================================
   Mr. Pilo · carnet · la lógica pura de la pantalla.

   El reloj del servidor (el código cambia con SU hora, no con la del teléfono),
   cuándo hay que pedir otro código, qué se muestra mientras llega, y qué se le
   dice a la persona cuando la función responde con un código de error.

   Puro: se prueba en node.
   ========================================================================== */

import { WINDOW_SECONDS, windowLeft, windowOf } from "./servidor-logica";
import { tr } from "../../../components/pilo/i18n";

/** Diferencia entre la hora del servidor y la del teléfono, en ms. */
export const offsetOf = (serverMs: number, clientMs: number): number => serverMs - clientMs;

/** La hora del servidor según el teléfono. */
export const serverNow = (offset: number, clientMs: number = Date.now()): number => clientMs + offset;

export interface HeldCode {
  token: string;
  /** La ventana de 30 s del servidor en que se firmó. */
  win: number;
}

/** ¿Hay que pedir otro código? Sin código, o cuando ya cambió la ventana. */
export const needsRefresh = (held: HeldCode | null, nowMs: number): boolean => !held || windowOf(nowMs) > held.win;

/**
 * ¿Se puede seguir mostrando? Mientras llega el nuevo se muestra el anterior, que el servidor acepta
 * una ventana más; después ya no: una captura vence en un minuto como máximo.
 */
export const stillShowable = (held: HeldCode | null, nowMs: number): boolean => Boolean(held) && windowOf(nowMs) <= (held as HeldCode).win + 1;

/** Cuánto de la cuenta regresiva queda, de 0 a 1. */
export const ringFraction = (nowMs: number): number => windowLeft(nowMs) / WINDOW_SECONDS;

export type CarnetCode =
  | "sesion"
  | "cuenta"
  | "suspendida"
  | "suspendido"
  | "carnet_no_configurado"
  | "wallet_no_configurado"
  | "perfil_incompleto"
  | "perfil"
  | "codigo_invalido"
  | "codigo_vencido"
  | "migracion"
  | "limite"
  | "sin_red"
  | "sin_funcion"
  | "datos"
  | "interno"
  | "desconocido";

const KNOWN: CarnetCode[] = [
  "sesion",
  "cuenta",
  "suspendida",
  "suspendido",
  "carnet_no_configurado",
  "wallet_no_configurado",
  "perfil_incompleto",
  "perfil",
  "codigo_invalido",
  "codigo_vencido",
  "migracion",
  "limite",
  "sin_red",
  "sin_funcion",
  "datos",
  "interno",
];

export const asCode = (value: unknown): CarnetCode => (KNOWN.includes(value as CarnetCode) ? (value as CarnetCode) : "desconocido");

/** Lo que se le dice a la persona por cada código de la función. */
export function carnetMessage(code: CarnetCode): string {
  switch (code) {
    case "sesion":
      return tr("Entre con su cuenta de Pilo para usar su carnet.");
    case "cuenta":
      return tr("El carnet es para quienes tienen cuenta de Pilo.");
    case "suspendida":
      return tr("Su cuenta de Pilo está suspendida. Escriba a la administración.");
    case "suspendido":
      return tr("Su carnet está suspendido. Reactívelo para volver a usarlo.");
    case "carnet_no_configurado":
      return tr("El carnet aún no está disponible: lo habilita la administración.");
    case "wallet_no_configurado":
      return tr("Google Wallet aún no está disponible: lo habilita la administración.");
    case "perfil_incompleto":
      return tr("Complete los datos de su carnet para crear el pase.");
    case "perfil":
      return tr("Esta acción es para profesores.");
    case "codigo_invalido":
      return tr("Ese código no es de un carnet de Pilo.");
    case "codigo_vencido":
      return tr("Ese código ya venció. Pida a la persona que muestre el carnet de nuevo.");
    case "migracion":
      return tr("El carnet todavía no está instalado: la administración debe aplicar una actualización de la base.");
    case "limite":
      return tr("Va muy rápido: espere un momento antes de volver a intentarlo.");
    case "sin_red":
      return tr("No hay conexión. El código del carnet necesita internet.");
    case "sin_funcion":
      return tr("El servicio del carnet no responde todavía. Intente más tarde.");
    default:
      return tr("No se pudo completar. Intente de nuevo en un momento.");
  }
}

/** «4:07» para una cuenta de segundos. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
