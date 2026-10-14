/* =============================================================================
   La voz de Mr. Pilo.

   Usa la síntesis de voz del navegador (speechSynthesis): nada sale del
   equipo y no hay costo. Elige la mejor voz en español disponible, prefiriendo
   las voces neuronales del sistema («Natural», «Neural», «Premium», las
   «Online» de Edge) y el acento latinoamericano.

   Una sola voz para toda la aplicación: al hablar se calla lo anterior.
   La persona la apaga o la prende desde el botón del altavoz; se recuerda
   en el navegador. speak() recibe cualquier texto, así que el día que
   llegue un analista externo (una API), sus respuestas se leen igual.
   ========================================================================== */

import { useSyncExternalStore } from "react";
import { effectiveLang } from "./i18n/lang";

const KEY = "pilo:voz";

export const voiceSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && "SpeechSynthesisUtterance" in window;

/** Voces masculinas en español que traen Windows, macOS, Android y Chrome. Mr. Pilo es hombre. */
const MALE = /(?<![a-záéíóúñ])(gonzalo|jorge|[aá]lvaro|pablo|ra[uú]l|diego|juan|carlos|andr[eé]s|sergio|tom[aá]s|gerardo|liberto|emilio|federico|mateo|nicol[aá]s|rodrigo|dar[ií]o|sa[uú]l|teo|cecilio|yago|alonso|lorenzo|arnau|enrique|jes[uú]s|jos[eé]|luciano|mart[ií]n|santiago|antonio|manuel|francisco|alberto|mario|male|hombre|masculin)/i;
/** Las femeninas conocidas: se descartan si hay alternativa. */
const FEMALE = /(?<![a-záéíóúñ])(salome|salom[eé]|dalia|elvira|helena|laura|sabina|paloma|m[oó]nica|paulina|marisol|luc[ií]a|elena|ximena|camila|valentina|catalina|beatriz|irene|triana|larissa|abril|estrella|renata|nuria|marta|carlota|candela|belkys|lupe|penelope|pen[eé]lope|conchita|female|mujer|femenin)/i;

/** ¿La voz elegida es masculina? Si no, se baja el tono. */
export const isMale = (name: string) => !FEMALE.test(name) && MALE.test(name);

/** Puntúa una voz: primero que sea masculina, luego neuronal, luego el acento. */
export function scoreVoice(v: Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">): number {
  const lang = v.lang.toLowerCase().replace("_", "-");
  if (!lang.startsWith("es")) return -1;
  let score = 0;
  // Primero lo femenino: «female» también contiene «male».
  if (FEMALE.test(v.name)) score -= 0.5;
  else if (MALE.test(v.name)) score += 20;
  if (/natural|neural|premium|enhanced|online/i.test(v.name)) score += 10;
  if (/google/i.test(v.name)) score += 3;
  if (lang === "es-co") score += 5;
  else if (["es-mx", "es-us", "es-419", "es-ar", "es-cl", "es-pe", "es-ve"].includes(lang)) score += 3;
  else if (lang === "es-es") score += 1;
  return score;
}

export function pickVoice<T extends Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">>(voices: T[]): T | null {
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const v of voices) {
    const s = scoreVoice(v);
    if (s >= -0.5 && s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

/** Las voces cargan tarde en Chrome y Edge: se espera a voiceschanged, con tope. */
let voicePromise: Promise<SpeechSynthesisVoice | null> | null = null;
/** Las voces del navegador; cargan tarde, así que se espera a voiceschanged con tope. */
function voicesReady(): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    if (!voiceSupported()) return resolve([]);
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(now);
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      clearTimeout(timer);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, 1500);
    synth.addEventListener("voiceschanged", done);
  });
}

/** Una voz del navegador en el idioma pedido (la primera de ese idioma), o null si no hay. */
async function voiceFor(lang: "en" | "pt"): Promise<SpeechSynthesisVoice | null> {
  const all = await voicesReady();
  const prefix = lang === "en" ? "en" : "pt";
  const preferred = lang === "en" ? "en-us" : "pt-br";
  const mine = all.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  return mine.find((v) => v.lang.toLowerCase() === preferred) ?? mine[0] ?? null;
}

function bestVoice(): Promise<SpeechSynthesisVoice | null> {
  if (!voiceSupported()) return Promise.resolve(null);
  if (voicePromise) return voicePromise;
  voicePromise = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const now = synth.getVoices();
    if (now.length) return resolve(pickVoice(now));
    const done = () => {
      synth.removeEventListener("voiceschanged", done);
      window.clearTimeout(timer);
      resolve(pickVoice(synth.getVoices()));
    };
    const timer = window.setTimeout(done, 1500);
    synth.addEventListener("voiceschanged", done);
  });
  return voicePromise;
}

/* --- Estado compartido: ¿prendida? ¿hablando? ------------------------------------- */

const listeners = new Set<() => void>();
let speaking = false;

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

let enabled = typeof window !== "undefined" ? readEnabled() : false;

const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function setVoiceEnabled(on: boolean) {
  enabled = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
  if (!on) stopSpeaking();
  emit();
}

/** ¿La voz está prendida? (y el navegador la soporta) */
export function useVoice() {
  const on = useSyncExternalStore(subscribe, () => enabled, () => false);
  const talking = useSyncExternalStore(subscribe, () => speaking, () => false);
  return { supported: voiceSupported(), enabled: on && voiceSupported(), speaking: talking, setEnabled: setVoiceEnabled };
}

/**
 * Lee un texto en voz alta si la voz está prendida (o si se fuerza, por un
 * botón «Escuchar»). La promesa se cumple cuando termina de hablar, para
 * poder leer una página parte por parte.
 */
export async function speak(text: string, options: { force?: boolean; rate?: number; pitch?: number } = {}): Promise<void> {
  if (!voiceSupported() || (!enabled && !options.force)) return;
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return;
  const synth = window.speechSynthesis;
  synth.cancel();
  // En inglés o portugués, la voz del navegador es una de ese idioma (la oficial de Pilo lee por Fish Audio, no por aquí).
  const lang = effectiveLang();
  const voice = lang === "es" ? await bestVoice() : await voiceFor(lang);
  const utterance = new SpeechSynthesisUtterance(clean);
  utterance.lang = voice?.lang ?? (lang === "en" ? "en-US" : lang === "pt" ? "pt-BR" : "es-CO");
  if (voice) utterance.voice = voice;
  // Con voz masculina, su tono natural; si el equipo solo tiene voces femeninas, más grave.
  utterance.rate = options.rate ?? 1.02;
  utterance.pitch = (voice && isMale(voice.name) ? 0.95 : 0.6) * (options.pitch ?? 1);
  utterance.onstart = () => {
    speaking = true;
    emit();
  };
  return new Promise<void>((resolve) => {
    const end = () => {
      speaking = false;
      emit();
      resolve();
    };
    utterance.onend = end;
    utterance.onerror = end;
    synth.speak(utterance);
  });
}

export function stopSpeaking() {
  if (!voiceSupported()) return;
  window.speechSynthesis.cancel();
  if (speaking) {
    speaking = false;
    emit();
  }
}
