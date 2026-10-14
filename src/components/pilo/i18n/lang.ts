/* =============================================================================
   Mr. Pilo en tres idiomas · el idioma elegido y `t()`.

   El español es el idioma de Pilo y de todo el portal: nada cambia para quien no
   toca el selector. Inglés y portugués se piden desde las pantallas de Pilo
   (Pregúntele a Pilo, el chat emergente y la app); el resto del portal sigue en
   español.

   Cómo se traduce: el texto en español ES la clave. `t("Escriba su pregunta")`
   devuelve ese mismo texto en español y, en inglés o portugués, el que esté en
   `dict/`. Un texto sin traducción sale en español: nunca queda en blanco ni
   muestra una clave. Las variables se escriben `{nombre}` en los tres idiomas.

   Qué idioma: el de la dirección (`?lang=en`, `?idioma=pt`), si no el que la
   persona eligió antes en este navegador y, si no, español. El idioma del
   navegador no se usa: quien abre Pilo en español no debe verlo cambiar solo.
   ========================================================================== */

import { useEffect, useSyncExternalStore } from "react";
import { DICTIONARY } from "./dict";

export type PiloLang = "es" | "en" | "pt";

export const PILO_LANGS: readonly { id: PiloLang; code: string; name: string }[] = [
  { id: "es", code: "ES", name: "Español" },
  { id: "en", code: "EN", name: "English" },
  { id: "pt", code: "PT", name: "Português" },
];

const KEY = "pilo-lang";

export const isLang = (value: unknown): value is PiloLang => value === "es" || value === "en" || value === "pt";

/** El idioma que pide una dirección: `?lang=en`, `?lang=pt-BR` o `?idioma=pt`. */
export function langFromSearch(search: string): PiloLang | null {
  try {
    const q = new URLSearchParams(search);
    const v = (q.get("lang") ?? q.get("idioma") ?? "").trim().toLowerCase().slice(0, 2);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function stored(): PiloLang | null {
  try {
    const v = window.localStorage.getItem(KEY);
    return isLang(v) ? v : null;
  } catch {
    return null;
  }
}

function persist(lang: PiloLang) {
  try {
    window.localStorage.setItem(KEY, lang);
  } catch {
    /* sin almacenamiento: vale para esta visita */
  }
}

function initial(): PiloLang {
  if (typeof window === "undefined") return "es";
  const asked = langFromSearch(window.location.search);
  if (asked) {
    persist(asked);
    return asked;
  }
  return stored() ?? "es";
}

let current: PiloLang = initial();
const listeners = new Set<() => void>();

export const getLang = (): PiloLang => current;

export function setLang(lang: PiloLang) {
  if (!isLang(lang) || lang === current) return;
  current = lang;
  persist(lang);
  for (const l of [...listeners]) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Para pruebas: vuelve al español sin tocar el almacenamiento. */
export function resetLangForTests(lang: PiloLang = "es") {
  current = lang;
  for (const l of [...listeners]) l();
}

/**
 * Las pantallas de Pilo viven en estas rutas. El idioma elegido solo se aplica ahí: la intranet, que
 * comparte funciones con ellas (la espera de la respuesta, las etiquetas), sigue siempre en español.
 */
const PILO_PATH = /^\/(pregunta|pilo-embed|pilo-ensenanza|pilo-ensenanza-embed|app)(\/|$)/;
let scope: boolean | null = null;

/** Para pruebas: fuerza que haya (true) o no haya (false) una pantalla de Pilo a la vista; null, según la ruta. */
export function setPiloScopeForTests(value: boolean | null) {
  scope = value;
}

const inPiloScreen = (): boolean => (scope !== null ? scope : typeof window === "undefined" ? true : PILO_PATH.test(window.location.pathname));

/** El texto en un idioma, con sus variables. Sin traducción, el español. */
export function translate(lang: PiloLang, source: string, vars?: Record<string, string | number>): string {
  const hit = lang === "es" ? undefined : DICTIONARY[lang]?.[source];
  const text = hit ?? source;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m)) : text;
}

/** El texto en el idioma de ahora. Las pantallas que lo usan se repintan al cambiar de idioma con `useLang()`. */
export const tr = (source: string, vars?: Record<string, string | number>): string => translate(inPiloScreen() ? current : "es", source, vars);
export const t = tr;

/** Cuántas pantallas de Pilo hay a la vista y el idioma que tenía la página antes de la primera. */
let mounted = 0;
let pageLang = "";

/** El idioma de ahora, y la pantalla que lo pide se repinta cuando cambia. También pone el idioma en la página mientras haya una pantalla de Pilo a la vista. */
export function useLang(): PiloLang {
  const lang = useSyncExternalStore(subscribe, getLang, () => "es" as PiloLang);
  useEffect(() => {
    const root = document.documentElement;
    if (mounted === 0) pageLang = root.lang;
    mounted += 1;
    return () => {
      mounted -= 1;
      if (mounted === 0) root.lang = pageLang;
    };
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return lang;
}

/** Singular o plural según la cantidad: `trn(n, "{n} pasaje", "{n} pasajes")`. `{n}` es la cantidad; se pueden sumar más variables. */
export const trn = (count: number, one: string, other: string, vars: Record<string, string | number> = {}): string => translate(inPiloScreen() ? current : "es", count === 1 ? one : other, { n: count, ...vars });

/* --- Datos enteros: el perfil de cada Pilo ----------------------------------------------------- */

const deepCache = new WeakMap<object, Map<string, unknown>>();

function mapStrings(value: unknown, lang: PiloLang): unknown {
  if (typeof value === "string") return translate(lang, value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, lang));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, lang)]));
  }
  return value;
}

/**
 * Una copia del dato con todos sus textos traducidos al idioma de ahora. Es la forma de traducir lo que vive en
 * constantes de módulo (el perfil de cada Pilo, con sus saludos y sugeridas) sin repartir `tr()` por cada campo: los
 * textos que no están en el diccionario (rutas, identificadores) quedan igual. La copia se guarda por idioma, así
 * que cada render recibe el mismo objeto y los efectos que lo vigilan no se disparan de más. En español devuelve el dato.
 */
export function localizeDeep<T extends object>(value: T): T {
  const lang = inPiloScreen() ? current : "es";
  if (lang === "es") return value;
  let byLang = deepCache.get(value);
  if (!byLang) deepCache.set(value, (byLang = new Map()));
  const hit = byLang.get(lang);
  if (hit) return hit as T;
  const out = mapStrings(value, lang) as T;
  byLang.set(lang, out);
  return out;
}

/** El idioma que de verdad aplica ahora: el elegido en una pantalla de Pilo y español en cualquier otra. */
export const effectiveLang = (): PiloLang => (inPiloScreen() ? current : "es");

/* --- Lo que dice el servidor ------------------------------------------------------------------ */

/** Las frases del servidor que llevan un número: se reconocen por su forma y se traducen con su plantilla. */
const SERVER_PATTERNS: [RegExp, string][] = [[/^Podrá preguntar de nuevo en (\d+) s\.$/, "Podrá preguntar de nuevo en {n} s."]];

/**
 * Un mensaje del servidor (un error, un consejo, un aviso) en el idioma de ahora. Llegan en español y a
 * veces dos frases juntas («error consejo»): cada frase se busca sola; la que no está queda como llegó.
 */
export function trServer(message: string): string {
  const lang = inPiloScreen() ? current : "es";
  if (lang === "es" || !message) return message;
  const dict = DICTIONARY[lang];
  return message
    .split(/(?<=[.!?…])\s+/)
    .map((sentence) => {
      const hit = dict[sentence];
      if (hit) return hit;
      for (const [re, key] of SERVER_PATTERNS) {
        const m = sentence.match(re);
        if (m) return translate(lang, key, { n: m[1] });
      }
      return sentence;
    })
    .join(" ");
}
