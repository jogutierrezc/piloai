/* =============================================================================
   Mr. Pilo · la app móvil · solo la voz oficial.

   La app nunca habla con otra voz: si el servicio no da audio (apagado, sin
   cupo, sin red) o el teléfono no deja sonar, se queda con el texto. Por eso
   no usa sayWithPilo (que cae a la voz del navegador) sino el audio oficial a
   secas (piloAudio: el mismo pedido y la misma caché) en el reproductor único
   de voice-player.ts, que se desbloquea con el primer toque.

   El audio de la bienvenida, además, se guarda en el teléfono (Cache Storage,
   aparte del esqueleto de la app): la segunda vez suena sin pedirlo. El de las
   respuestas no se guarda.
   ========================================================================== */

import { audioKey, piloAudio, stopPilo } from "../../components/pilo/ai/client";
import type { AskPortal } from "../../components/pilo/ai/client";
import { playPiloAudio } from "../../components/pilo/ai/voice-player";

/** Donde se guarda el audio de la bienvenida. El service worker lo respeta al limpiar cachés viejas. */
export const VOICE_CACHE = "pilo-app-voz-v1";

/** La dirección (de mentira, nunca se pide a la red) bajo la que se guarda un audio. */
export function voiceCacheUrl(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `/__pilo-voz__/${h.toString(16).padStart(8, "0")}-${key.length}`;
}

async function kept(key: string): Promise<Blob | null> {
  try {
    if (typeof caches === "undefined") return null;
    const hit = await (await caches.open(VOICE_CACHE)).match(voiceCacheUrl(key));
    const blob = hit ? await hit.blob() : null;
    return blob && blob.size > 0 ? blob : null;
  } catch {
    return null;
  }
}

async function keep(key: string, blob: Blob) {
  try {
    if (typeof caches === "undefined") return;
    await (await caches.open(VOICE_CACHE)).put(voiceCacheUrl(key), new Response(blob, { headers: { "Content-Type": blob.type || "application/octet-stream" } }));
  } catch {
    /* sin espacio o sin Cache Storage: se pide de nuevo la próxima vez */
  }
}

/** Deja en el teléfono solo los audios de estas llaves (la bienvenida de hoy): lo demás se borra. */
export async function keepOnlyVoices(keys: string[]) {
  try {
    if (typeof caches === "undefined") return;
    const cache = await caches.open(VOICE_CACHE);
    const wanted = new Set(keys.map(voiceCacheUrl));
    for (const request of await cache.keys()) if (!wanted.has(new URL(request.url).pathname)) await cache.delete(request);
  } catch {
    /* nada que limpiar */
  }
}

export interface OfficialOptions {
  portal: AskPortal | null;
  advanced: boolean;
  rate?: number;
  rol?: string | null;
  /** La emoción de la frase (los modos secretos del chat): «short pause,whispering». */
  tone?: string;
  /** Guardar el audio en el teléfono (solo la bienvenida). */
  keep?: boolean;
}

/** El audio oficial de un texto: el guardado en el teléfono, o el del servicio. null = no hay voz. */
export async function officialAudio(text: string, options: OfficialOptions): Promise<Blob | null> {
  if (!options.advanced || !options.portal || !text.trim()) return null;
  const key = audioKey(text, options.portal, undefined, options.rol, options.tone);
  if (options.keep) {
    const saved = await kept(key);
    if (saved) return saved;
  }
  const blob = await piloAudio(text, { portal: options.portal, advanced: true, rol: options.rol, tone: options.tone });
  if (blob && options.keep) void keep(key, blob);
  return blob;
}

/** Pide por adelantado (y guarda, si se pide) el audio de unas frases. */
export function prefetchOfficial(texts: string[], options: OfficialOptions) {
  for (const text of texts) void officialAudio(text, options);
}

let run = 0;

/** Calla a Pilo. Quien esperaba la lectura recibe «cancelado». */
export function stopOfficial() {
  run += 1;
  stopPilo();
}

/**
 * Dice un texto con la voz oficial y se cumple al terminar. `onSound` avisa
 * cuando el audio empieza y cuando deja de sonar: con eso se mueve el pico.
 * «sin voz»: no hubo audio o el teléfono no dejó sonar; no se dijo nada.
 */
export async function sayOfficial(text: string, options: OfficialOptions & { onSound?: (on: boolean) => void }): Promise<"sono" | "sin voz" | "cancelado"> {
  stopPilo();
  const mine = ++run;
  const blob = await officialAudio(text, options);
  if (mine !== run) return "cancelado";
  if (!blob) return "sin voz";
  options.onSound?.(true);
  const ended = await playPiloAudio(blob, options.rate ?? 1);
  options.onSound?.(false);
  if (mine !== run) return "cancelado";
  return ended ? "sono" : "sin voz";
}
