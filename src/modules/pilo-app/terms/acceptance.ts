/* =============================================================================
   Mr. Pilo · términos y política de uso · la aceptación, en el dispositivo.

   Quien acepta la política queda anotado en su propio dispositivo, con la
   versión que aceptó y cuándo («pilo-app:terminos»). No viaja al servidor.
   Si POLICY_VERSION cambia, lo guardado ya no vale y se vuelve a pedir.

   Sin almacenamiento (modo privado), la aceptación dura lo que dure la app
   abierta: quien la usa la recuerda en su estado.
   ========================================================================== */

import { readStored, storageKey, writeStored } from "../../pregunta/store";
import { APP_PREFIX } from "../themes";
import { POLICY_VERSION } from "./policy";

export const KEY_TERMS = storageKey(APP_PREFIX, "terminos");

export interface Acceptance {
  version: string;
  /** Cuándo se aceptó (ISO); "" si lo guardado no lo dice. */
  at: string;
}

/** Lo guardado, si se entiende; cualquier otra cosa es «no ha aceptado». */
export function parseAcceptance(raw: string | null | undefined): Acceptance | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { v?: unknown; at?: unknown } | null;
    if (!value || typeof value !== "object" || typeof value.v !== "string" || !value.v.trim()) return null;
    return { version: value.v.trim(), at: typeof value.at === "string" ? value.at : "" };
  } catch {
    return null;
  }
}

/** Lo que se guarda al aceptar. */
export const acceptanceRecord = (version: string = POLICY_VERSION, now: Date = new Date()): string => JSON.stringify({ v: version, at: now.toISOString() });

/**
 * En qué está la aceptación de este dispositivo:
 *   «vigente»  aceptó la versión actual: no se pide
 *   «cambio»   aceptó otra versión: la política cambió y se vuelve a pedir
 *   «nunca»    no ha aceptado
 */
export type AcceptanceState = "vigente" | "cambio" | "nunca";

export function acceptanceState(raw: string | null | undefined, version: string = POLICY_VERSION): AcceptanceState {
  const kept = parseAcceptance(raw);
  if (!kept) return "nunca";
  return kept.version === version ? "vigente" : "cambio";
}

/** ¿Hay que pedir la aceptación? */
export const mustAccept = (raw: string | null | undefined, version: string = POLICY_VERSION): boolean => acceptanceState(raw, version) !== "vigente";

export const readAcceptanceState = (): AcceptanceState => acceptanceState(readStored(KEY_TERMS));
export const needsAcceptance = (): boolean => readAcceptanceState() !== "vigente";

/** Anota la aceptación de la versión actual en este dispositivo. Dice si quedó guardada. */
export const acceptPolicy = (now: Date = new Date()): boolean => writeStored(KEY_TERMS, acceptanceRecord(POLICY_VERSION, now));
