/* =============================================================================
   Pregúntele a Pilo · lo que se recuerda en el navegador de quien pregunta.

   - El tema: blanco, soleado o negro. Sin elección, sigue al tema del sitio
     (oscuro → negro).
   - Las conversaciones: las últimas 20, con sus respuestas y fuentes, para
     volver a ellas sin preguntar de nuevo. Nunca salen del navegador.
   - Si ya vio la bienvenida.
   - En los espacios que lo preguntan (0113), quién pregunta: estudiante,
     profesor o «prefiero no decir».
   Cada espacio de Pilo guarda lo suyo bajo su prefijo (space.ts): el de
   siempre conserva «pilo-pregunta:*», así que lo que ya estaba guardado se
   sigue leyendo. El tema es uno solo para todos.
   Todo va entre try/catch: en modo privado o con el almacenamiento bloqueado,
   la página funciona igual, solo que sin recordar.
   ========================================================================== */

import { useCallback, useEffect, useState } from "react";
import type { TurnFile } from "./attach";
import type { TurnPage } from "../pilo-embed/embed";
import { useTheme } from "../../lib/theme";
import type { AskResult } from "../../components/pilo/ai/client";
import type { Think } from "./answer-state";
import { parseStoredRol } from "./space";
import type { Rol } from "./space";

export type Tema = "blanco" | "soleado" | "negro";

export const TEMAS: { id: Tema; label: string }[] = [
  { id: "blanco", label: "Blanco" },
  { id: "soleado", label: "Soleado" },
  { id: "negro", label: "Negro" },
];

/** El prefijo del Pilo de siempre: sus llaves no cambian. */
export const DEFAULT_PREFIX = "pilo-pregunta";

/** La llave de un dato de un espacio: «<prefijo>:<nombre>». */
export const storageKey = (prefix: string, name: string) => `${prefix}:${name}`;

// El tema se comparte entre los espacios: es una preferencia de la persona, no de un Pilo.
const KEY_TEMA = storageKey(DEFAULT_PREFIX, "tema");
export const KEY_WELCOME = storageKey(DEFAULT_PREFIX, "bienvenida");

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Escribe y dice si quedó guardado: sin almacenamiento, o con el almacenamiento lleno, no se recuerda. */
function write(key: string, value: string | null): boolean {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Lo mismo, para lo que otra superficie de Pilo recuerda en el dispositivo (la app móvil: su tema, su última conversación). */
export const readStored = read;
export const writeStored = write;

export function useTema(): [Tema, (t: Tema) => void] {
  const { resolved } = useTheme();
  const [chosen, setChosen] = useState<Tema | null>(() => {
    const v = read(KEY_TEMA);
    return v === "blanco" || v === "soleado" || v === "negro" ? v : null;
  });
  const set = useCallback((t: Tema) => {
    setChosen(t);
    write(KEY_TEMA, t);
  }, []);
  return [chosen ?? (resolved === "dark" ? "negro" : "blanco"), set];
}

export const seenWelcome = (prefix: string = DEFAULT_PREFIX) => read(storageKey(prefix, "bienvenida")) === "1";
export const markWelcome = (seen: boolean, prefix: string = DEFAULT_PREFIX) => write(storageKey(prefix, "bienvenida"), seen ? "1" : null);

/** Una preferencia de la página (p. ej. «leer»), por espacio. */
export const readFlag = (prefix: string, name: string) => read(storageKey(prefix, name)) === "1";
export const writeFlag = (prefix: string, name: string, on: boolean) => write(storageKey(prefix, name), on ? "1" : "0");

/* --- Quién pregunta (0113) ------------------------------------------------------------ */

/** El rol elegido en este navegador para ese espacio; null si aún no ha elegido. */
export const readRol = (prefix: string): Rol | null => parseStoredRol(read(storageKey(prefix, "rol")));
/** Guarda el rol («general» = prefiere no decir); null lo olvida y se vuelve a preguntar. */
export const writeRol = (prefix: string, rol: Rol | null) => write(storageKey(prefix, "rol"), rol === null ? null : (parseStoredRol(rol) ?? "general"));

/* --- Conversaciones ------------------------------------------------------------------ */

export interface Turn {
  id: string;
  q: string;
  /** El modo secreto que estaba puesto al responder (super/modes.ts): la respuesta lo dice en su insignia. */
  modo?: string;
  /** La respondió la página (una orden o el catálogo de un modo): no fue al servidor ni entra en la historia que se le manda. */
  local?: boolean;
  answer?: AskResult;
  error?: string;
  vote?: "up" | "down";
  /** La respuesta se interrumpió (se cortó el flujo o la persona la detuvo): `answer` es lo que alcanzó a escribirse. */
  incomplete?: boolean;
  /** «Pensando…» en compacto: los pasos que reportó el servidor y cuánto tardó. */
  think?: Think;
  /** La pregunta llevó un archivo adjunto (0119): su nombre y cuánto se leyó. Nunca su contenido. */
  file?: TurnFile;
  /** En otro portal, Pilo leyó la página que lo aloja (0127): cuál y cuánto. Nunca su contenido. */
  page?: TurnPage;
  /** La respuesta se guardó en la cuenta de Pilo de la persona (0120, solo la app): el id de lo guardado. */
  savedId?: number;
}

export interface Conversation {
  id: string;
  title: string;
  at: number;
  turns: Turn[];
}

export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function loadConversations(prefix: string = DEFAULT_PREFIX): Conversation[] {
  try {
    const parsed = JSON.parse(read(storageKey(prefix, "conversaciones")) ?? "[]") as Conversation[];
    if (!Array.isArray(parsed)) return [];
    // Lo guardado antes de «IA siempre» no trae grounding, pasos ni marcas: se lee igual.
    return parsed
      .filter((c) => c && Array.isArray(c.turns))
      .slice(0, SAVED_LIMIT)
      .map((c) => ({
        ...c,
        turns: c.turns
          .filter((t) => t && typeof t.q === "string")
          .map((t) =>
            t.answer && typeof t.answer.text === "string"
              ? { ...t, answer: { ...t.answer, sources: Array.isArray(t.answer.sources) ? t.answer.sources : [], trail: Array.isArray(t.answer.trail) ? t.answer.trail : [] } }
              : { ...t, answer: undefined },
          ),
      }));
  } catch {
    return [];
  }
}

/** Cuántas conversaciones se recuerdan por espacio. */
export const SAVED_LIMIT = 20;

/**
 * Lo que se guarda de una lista: solo los turnos terminados (o marcados como
 * incompletos) y las últimas conversaciones. Lo que aún se está escribiendo
 * vive fuera de esta lista y no se recuerda.
 */
export function storableConversations(list: Conversation[]): Conversation[] {
  return list
    .map((c) => ({ ...c, turns: c.turns.filter((t) => t.answer || t.error) }))
    .filter((c) => c.turns.length)
    .slice(0, SAVED_LIMIT);
}

/**
 * Guarda las conversaciones de un espacio. Si no caben (el almacenamiento del
 * navegador está lleno), se quedan las más recientes: se reintenta con la
 * mitad hasta que quepan. Dice si algo quedó guardado.
 */
export function saveConversations(prefix: string, list: Conversation[]): boolean {
  let keep = storableConversations(list);
  for (;;) {
    if (write(storageKey(prefix, "conversaciones"), JSON.stringify(keep))) return true;
    if (keep.length <= 1) return false;
    keep = keep.slice(0, Math.ceil(keep.length / 2));
  }
}

export function useConversations(prefix: string = DEFAULT_PREFIX) {
  const [list, setList] = useState<Conversation[]>(() => loadConversations(prefix));
  useEffect(() => {
    saveConversations(prefix, list);
    // El prefijo no cambia mientras la página vive: cada espacio monta la suya.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list]);
  return [list, setList] as const;
}
