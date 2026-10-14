/* =============================================================================
   Mr. Pilo · la app móvil · lo que dice la bienvenida, y con qué voz.

   Pilo se presenta una sola vez por toda la universidad: es «la Inteligencia
   Artificial de la Universidad de Santander», y al final pregunta con cuál de
   sus dos versiones se quiere hablar. Cada frase lleva su cara, su ánimo de
   voz y hacia dónde mira.

   La voz es la oficial y va por el mismo camino que las respuestas: la misma
   acción («voz»), el mismo portal, el mismo estilo y la misma caché
   (client.ts). Lo único que cambia con el ánimo de cada frase es la velocidad
   (modulateVoice), igual que al leer una respuesta. Al texto no se le añade
   nada: lo que se oye es lo que se lee. Si la voz no está disponible no hay
   nada que pedir, y queda el texto: nunca otra voz.

   Puro: se prueba en node.
   ========================================================================== */

import { audioKey, voiceBody } from "../../components/pilo/ai/client";
import { modulateVoice, normalizeMood } from "../../components/pilo/ai/voice-expressions";
import { localizeDeep } from "../../components/pilo/i18n";
import type { MojiMood } from "../../components/pilo/PiloMoji";
import type { AppVoice, Door } from "./access";
import type { SpaceId } from "../pregunta/space";

export interface AppBeat {
  id: "hola" | "preguntar" | "fuente" | "elegir" | "rol" | "cuenta";
  say: string;
  /** La cara de Pilo mientras lo dice. */
  face: MojiMood;
  /** El ánimo de la voz (los de voice-expressions) y cómo se le nombra en pantalla. */
  mood: "emocionado" | "atento" | "pensar";
  label: string;
  look: [number, number];
  /** Aquí se elige: no hay «Siguiente» ni avanza sola. */
  pick?: boolean;
  /** Aquí se toca algo (una pregunta de ejemplo): no avanza sola, pero sí hay «Siguiente». */
  touch?: boolean;
}

export const APP_TITLE = "Hola, soy Mr. Pilo";

export const APP_BEATS: AppBeat[] = [
  { id: "hola", say: "¡Hola! Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander.", face: "feliz", mood: "emocionado", label: "Emocionado", look: [0, -0.1] },
  { id: "preguntar", say: "Pregúnteme por la universidad, o hablemos de enseñar y aprender. Toque una pregunta y vea cómo respondo.", face: "feliz", mood: "atento", label: "Atento", look: [0, 0.7], touch: true },
  { id: "fuente", say: "Le respondo con lo que la universidad ha publicado y le muestro la fuente.", face: "sorpresa", mood: "pensar", label: "Reflexivo", look: [0.2, 0.8] },
  { id: "elegir", say: "¿Con cuál Pilo quiere hablar hoy?", face: "feliz", mood: "emocionado", label: "Emocionado", look: [0, 0.6], pick: true },
];

/** Solo si se elige Pilo en Enseñanza y ese espacio pregunta el rol. */
export const ROLE_BEAT: AppBeat = { id: "rol", say: "¿Quién pregunta? Así le hablo a su medida.", face: "cuidado", mood: "atento", label: "Atento", look: [0, 0.6], pick: true };

/* --- En el computador (desktop.ts) ---------------------------------------------------------
   La misma presentación, dicha para el escritorio. Quien aún no ha entrado no
   elige Pilo al final: Pilo le pide la cuenta, que en el computador es obligatoria. */

export const DESK_HELLO: AppBeat = {
  id: "hola",
  say: "¡Hola! Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander. Ahora también estoy en su computador.",
  face: "feliz",
  mood: "emocionado",
  label: "Emocionado",
  look: [0, -0.1],
};

export const ACCOUNT_BEAT: AppBeat = {
  id: "cuenta",
  say: "En el computador trabajo con su cuenta de Pilo. ¿La creamos, o ya tiene una?",
  face: "feliz",
  mood: "atento",
  label: "Atento",
  look: [0, 0.6],
  pick: true,
};

/* --- En la app de Android (native.ts) ------------------------------------------------------
   Pilo se presenta en el teléfono y, tras elegir con cuál Pilo hablar, pide la cuenta:
   allí es obligatoria, así que no hay «seguir sin cuenta». */

export const NATIVE_HELLO: AppBeat = {
  id: "hola",
  say: "¡Hola! Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander. Ahora vivo en su teléfono.",
  face: "feliz",
  mood: "emocionado",
  label: "Emocionado",
  look: [0, -0.1],
};

export const NATIVE_ACCOUNT_BEAT: AppBeat = {
  id: "cuenta",
  say: "Para empezar necesito su cuenta de Pilo. Toma un minuto. ¿La creamos, o ya tiene una?",
  face: "feliz",
  mood: "atento",
  label: "Atento",
  look: [0, 0.6],
  pick: true,
};

/**
 * Las partes de la bienvenida: las de siempre en el teléfono y en el navegador;
 * en la app de Android sin cuenta, cinco: se elige Pilo y al final se pide la cuenta;
 * en la app de escritorio, el saludo de escritorio y, si falta entrar, la cuenta
 * en vez de la elección de Pilo.
 */
export function welcomeBeats(options: { desktop?: boolean; native?: boolean; account?: boolean } = {}): AppBeat[] {
  if (options.native && !options.desktop && options.account) return localizeDeep([NATIVE_HELLO, APP_BEATS[1], APP_BEATS[2], APP_BEATS[3], NATIVE_ACCOUNT_BEAT]);
  if (!options.desktop) return localizeDeep(APP_BEATS);
  return localizeDeep([DESK_HELLO, APP_BEATS[1], APP_BEATS[2], options.account ? ACCOUNT_BEAT : APP_BEATS[3]]);
}

/** Lo que conoce Pilo, para la primera muestra: lo de sus dos versiones. */
export const APP_KNOWS = ["UDES en Cifras", "Plan de Desarrollo", "Impacto", "Innovación educativa", "Políticas"];
export const APP_ASKS = ["¿Qué es el PDI?", "¿Qué es el aprendizaje activo?"];

/**
 * Las preguntas de ejemplo de la bienvenida. Cada respuesta es verdad y sale de lo
 * que el portal dice de sí mismo (PRODUCT.md): ninguna cifra inventada. En pantalla
 * van marcadas «Ejemplo»: no son una respuesta de Pilo.
 */
export interface WelcomeExample {
  id: string;
  q: string;
  a: string;
  /** La fuente que se muestra con la respuesta. */
  source: string;
}

export const WELCOME_EXAMPLES: WelcomeExample[] = [
  {
    id: "pdi",
    q: "¿Qué es el PDI 2024-2028?",
    a: "Es el Plan de Desarrollo Institucional de la Universidad de Santander. Su seguimiento se ve en el Portal PDI, con sus pilares, áreas, líneas, proyectos e indicadores.",
    source: "Portal PDI",
  },
  {
    id: "cifras",
    q: "¿Dónde veo las cifras oficiales?",
    a: "En UDES en Cifras, el portal estadístico de la universidad. Reúne once informes con las cifras que reporta cada oficina.",
    source: "UDES en Cifras",
  },
  {
    id: "quien",
    q: "¿Quién publica las cifras?",
    a: "La Oficina de Planeación Institucional, a partir de lo que reporta cada oficina, siempre con su corte y su procedencia.",
    source: "UDES en Cifras",
  },
];

/**
 * Con qué voz habla la bienvenida: la de la primera versión de Pilo que tenga
 * la voz oficial disponible para esta persona (primero la de la Universidad).
 * null = no hay voz oficial: la bienvenida es solo texto.
 */
export function welcomeVoice(doors: Partial<Record<SpaceId, Pick<Door, "state" | "voice">>>): AppVoice | null {
  for (const space of ["planeacion", "ensenanza"] as const) {
    const door = doors[space];
    if (door && door.state === "abierto" && door.voice.advanced) return door.voice;
  }
  return null;
}

export interface VoiceRequest {
  beat: AppBeat["id"];
  /** Lo que se le pide al servicio: exactamente la frase que se lee en pantalla. */
  text: string;
  portal: AppVoice["portal"];
  /** La velocidad con que suena, según el ánimo de la frase. */
  rate: number;
  /** El cuerpo del pedido y la llave de su audio guardado: los mismos de una respuesta leída. */
  body: ReturnType<typeof voiceBody>;
  key: string;
}

/** Lo que se pide para una frase de la bienvenida. */
export function voiceRequest(beat: AppBeat, voice: AppVoice): VoiceRequest {
  const rate = voice.modulation ? modulateVoice(normalizeMood(beat.mood), voice.rate, voice.pitch).rate : voice.rate;
  return { beat: beat.id, text: beat.say, portal: voice.portal, rate, body: voiceBody(beat.say, voice.portal), key: audioKey(beat.say, voice.portal) };
}

/**
 * Todo lo que la bienvenida pide por adelantado. Sin voz oficial, nada. La
 * pregunta del rol solo se pide si Pilo en Enseñanza la va a hacer.
 */
export function welcomeVoicePlan(voice: AppVoice | null, options: { askRol?: boolean; beats?: AppBeat[] } = {}): VoiceRequest[] {
  if (!voice || !voice.advanced) return [];
  const base = options.beats ?? localizeDeep(APP_BEATS);
  const beats = options.askRol ? [...base, localizeDeep(ROLE_BEAT)] : base;
  return beats.map((b) => voiceRequest(b, voice));
}
