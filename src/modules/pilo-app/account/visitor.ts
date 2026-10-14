/* =============================================================================
   Mr. Pilo · quien usa a Pilo sin cuenta.

   Solo dos preferencias: cómo quiere que Pilo le diga y en qué tono. Se
   guardan en este dispositivo y viajan con cada pregunta (`visitor`); el
   servidor las vuelve a limpiar. Con cuenta no viaja nada: el servidor
   reconoce a la persona por su sesión.

   El nombre admite lo mismo que el servidor: letras, espacios, punto,
   apóstrofo o guion, hasta 30. Así nada que parezca una orden llega al modelo.
   ========================================================================== */

import { readStored, storageKey, writeStored } from "../../pregunta/store";
import { APP_PREFIX } from "../themes";
import { isTone } from "./rules";
import type { Tone } from "./rules";
import { tr } from "../../../components/pilo/i18n";

export interface Visitor {
  nick: string;
  tone: Tone;
}

const NICK = /^[\p{L}][\p{L} .'-]{0,29}$/u;

/** Qué le falta al nombre de un visitante, o "" si sirve (vacío también sirve: Pilo no usa nombre). */
export function visitorNickProblem(raw: string): string {
  const nick = raw.replace(/\s+/g, " ").trim();
  if (!nick) return "";
  if (nick.length > 30) return tr("Hasta 30 letras: su nombre o uno abreviado.");
  if (!NICK.test(nick)) return tr("Solo letras, espacios, punto, apóstrofo o guion.");
  return "";
}

/** El nombre como se guarda y se manda; lo que no es un nombre queda vacío. */
export function visitorNick(raw: unknown): string {
  const nick = (typeof raw === "string" ? raw : "").replace(/\s+/g, " ").trim();
  return nick.length <= 30 && NICK.test(nick) ? nick : "";
}

/** Lo guardado; cualquier cosa que no se entienda es «sin preferencias». */
export function parseVisitor(raw: string | null | undefined): Visitor | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as { nick?: unknown; tone?: unknown } | null;
    if (!o || typeof o !== "object") return null;
    const nick = visitorNick(o.nick);
    if (!nick && !isTone(o.tone)) return null;
    return { nick, tone: isTone(o.tone) ? o.tone : "cercano" };
  } catch {
    return null;
  }
}

/** Lo que viaja con la pregunta; undefined si no hay nada que mandar (el pedido queda como siempre). */
export function visitorWire(visitor: Visitor | null | undefined, member: boolean): { nick: string; tone: Tone } | undefined {
  if (member || !visitor) return undefined;
  const nick = visitorNick(visitor.nick);
  return { nick, tone: isTone(visitor.tone) ? visitor.tone : "cercano" };
}

const KEY = storageKey(APP_PREFIX, "visitante");

export const readVisitor = (): Visitor | null => parseVisitor(readStored(KEY));

export function writeVisitor(visitor: Visitor | null) {
  writeStored(KEY, visitor ? JSON.stringify({ nick: visitorNick(visitor.nick), tone: visitor.tone }) : null);
}
