/* =============================================================================
   Mr. Pilo · la app · la llamada · los tres idiomas.

   El idioma de la llamada es el de todo Pilo (components/pilo/i18n): el que la
   persona eligió y el que ya ven el chat, el menú y la bienvenida. Aquí solo
   vive lo que la llamada necesita además: con qué idioma reconoce el navegador
   la voz y qué se le pide a Pilo para que conteste en él y en voz hablada.
   Nada de esto se muestra en pantalla.
   ========================================================================== */

import type { PiloLang } from "../../../components/pilo/i18n";

export type CallLang = PiloLang;

/** El idioma con el que el navegador reconoce lo que se dice. */
const SPEECH: Record<CallLang, string> = { es: "es-CO", en: "en-US", pt: "pt-BR" };

/** Lo que se le agrega a la pregunta para que Pilo conteste en el idioma elegido y como se habla, no como se escribe. */
const DIRECTIVE: Record<CallLang, string> = {
  es: "(Responde hablando, en frases cortas y en español.)",
  en: "(Answer out loud, in short sentences, in English.)",
  pt: "(Responda falando, em frases curtas e em português.)",
};

export const speechLang = (lang: CallLang): string => SPEECH[lang] ?? SPEECH.es;

/** La pregunta que viaja a Pilo: lo que dijo la persona y, al lado, cómo contestar. */
export const spokenQuestion = (heard: string, lang: CallLang): string => `${heard.replace(/\s+/g, " ").trim()} ${DIRECTIVE[lang] ?? DIRECTIVE.es}`;
