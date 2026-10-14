/* =============================================================================
   Mr. Pilo · la app móvil · las conversaciones guardadas en el teléfono.

   Las conversaciones son las mismas de cada página (store.ts): se guardan por
   espacio, bajo su prefijo, las últimas 20, y nunca salen del dispositivo. Lo
   que se conversa en /app/universidad es lo que se ve en /pregunta en ese
   mismo navegador, y al revés.

   Aquí va lo que la app añade: la lista del menú (los dos Pilos juntos, la más
   reciente primero, con su fecha en palabras) y cuál fue la última
   conversación abierta, para volver a ella al abrir la app. Todo tolera un
   almacenamiento vacío, lleno, bloqueado o con datos dañados.
   ========================================================================== */

import { loadConversations, readStored, saveConversations, storageKey, writeStored } from "../pregunta/store";
import type { Conversation } from "../pregunta/store";
import { ASK_SPACES, isAskSpace } from "../pregunta/space";
import type { SpaceId } from "../pregunta/space";
import { APP_PREFIX } from "./themes";
import { APP_SPACES } from "./routes";

export interface SavedEntry {
  space: SpaceId;
  id: string;
  title: string;
  at: number;
}

/** La lista del menú: las conversaciones de los dos Pilos, la más reciente primero. */
export function savedEntries(bySpace: Partial<Record<SpaceId, Conversation[]>>): SavedEntry[] {
  const out: SavedEntry[] = [];
  for (const space of APP_SPACES) {
    for (const c of bySpace[space] ?? []) {
      if (!c || typeof c.id !== "string" || !c.id) continue;
      // Solo lo que se puede volver a leer: al menos un turno con respuesta o con su aviso.
      if (!Array.isArray(c.turns) || !c.turns.some((t) => t && (t.answer || t.error))) continue;
      const title = typeof c.title === "string" && c.title.trim() ? c.title.trim() : "Conversación sin título";
      out.push({ space, id: c.id, title, at: Number.isFinite(c.at) ? c.at : 0 });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}

const DAY = 86_400_000;
const startOfDay = (ms: number) => {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

/** La fecha de una conversación, en palabras: «hoy», «ayer», «hace 3 días», «12 de marzo». */
export function dayLabel(at: number, now: number = Date.now()): string {
  if (!Number.isFinite(at) || at <= 0) return "sin fecha";
  const days = Math.round((startOfDay(now) - startOfDay(at)) / DAY);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return `hace ${days} días`;
  const d = new Date(at);
  const month = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][d.getMonth()];
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : ` de ${d.getFullYear()}`;
  return `${d.getDate()} de ${month}${year}`;
}

/** Las conversaciones guardadas de un Pilo (vacío si no hay, o si lo guardado no se entiende). */
export const loadSaved = (space: SpaceId): Conversation[] => loadConversations(ASK_SPACES[space].storagePrefix);

/** Borra una conversación guardada de un Pilo que no es el que está abierto. Devuelve lo que queda. */
export function removeSaved(space: SpaceId, id: string): Conversation[] {
  const rest = loadSaved(space).filter((c) => c.id !== id);
  saveConversations(ASK_SPACES[space].storagePrefix, rest);
  return rest;
}

/* --- La última conversación abierta ----------------------------------------------------- */

export interface LastOpen {
  /** El Pilo con el que se habló la última vez. */
  space: SpaceId | null;
  /** La conversación abierta de cada Pilo; sin ella, ese Pilo abre una nueva. */
  ids: Partial<Record<SpaceId, string>>;
}

export const NO_LAST: LastOpen = { space: null, ids: {} };

/** Lo guardado como «última conversación»; cualquier cosa que no se entienda es «ninguna». */
export function parseLast(raw: string | null | undefined): LastOpen {
  if (!raw) return NO_LAST;
  try {
    const o = JSON.parse(raw) as { space?: unknown; ids?: unknown } | null;
    if (!o || typeof o !== "object") return NO_LAST;
    const ids: Partial<Record<SpaceId, string>> = {};
    const given = o.ids && typeof o.ids === "object" ? (o.ids as Record<string, unknown>) : {};
    for (const space of APP_SPACES) {
      const id = given[space];
      if (typeof id === "string" && id && id.length <= 64) ids[space] = id;
    }
    return { space: isAskSpace(o.space) ? o.space : null, ids };
  } catch {
    return NO_LAST;
  }
}

/** Se abrió (o se cerró, con null) una conversación de un Pilo: ese pasa a ser el último. */
export function nextLast(last: LastOpen, space: SpaceId, id: string | null): LastOpen {
  const ids = { ...last.ids };
  if (id) ids[space] = id;
  else delete ids[space];
  return { space, ids };
}

const KEY_LAST = storageKey(APP_PREFIX, "ultima");
export const readLast = (): LastOpen => parseLast(readStored(KEY_LAST));
export const writeLast = (last: LastOpen) => writeStored(KEY_LAST, JSON.stringify(last));

/** La conversación que se abre al entrar a un Pilo: la última suya, si sigue guardada. */
export function openingId(last: LastOpen, space: SpaceId, convs: Pick<Conversation, "id">[]): string | null {
  const id = last.ids[space];
  return id && convs.some((c) => c.id === id) ? id : null;
}
