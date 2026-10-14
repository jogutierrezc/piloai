/* =============================================================================
   Pregúntele a Pilo · lo que se dice de una respuesta, sin pantalla.

   Funciones puras (se prueban en node):
     · la etiqueta de procedencia: información oficial con fuentes, mezcla o
       conocimiento general, según el `grounding` que calcula el servidor;
     · las notas discretas (respuesta cortada, la IA no respondió, quedó corta);
     · los pasos de «Pensando…»: solo los que reporta el servidor, nunca
       inventados; sin pasos, una línea de espera que cambia con el tiempo;
     · en qué queda un turno cuya respuesta se interrumpió.
   ========================================================================== */

import type { AskMeta, AskResult, AskSource, AskThinkStep } from "../../components/pilo/ai/client";
import { tr, trServer, trn } from "../../components/pilo/i18n";

/* --- Etiquetas ---------------------------------------------------------------------------- */

export interface Badge {
  text: string;
  /** El aspecto: oficial (lo publicado), ia (redactada), general (conocimiento general) o aviso. */
  tone: "oficial" | "ia" | "general" | "aviso";
  /** El glifo que acompaña al texto: la marca nunca depende solo del color. */
  icon: "spark" | "globe" | "check" | "alert" | null;
}

const PLAIN: Record<Exclude<AskResult["kind"], "ia">, Badge> = {
  curada: { text: "Respuesta oficial de la UDES", tone: "oficial", icon: "check" },
  memoria: { text: "Respuesta guardada · con fuentes de la UDES", tone: "oficial", icon: "check" },
  extracto: { text: "De lo publicado, tal cual", tone: "oficial", icon: "check" },
  dato: { text: "Cifra de UDES en Cifras", tone: "oficial", icon: "check" },
  malla: { text: "De la malla de la memoria", tone: "oficial", icon: "check" },
  capciosa: { text: "Respuesta rápida de Pilo", tone: "ia", icon: null },
  regla: { text: "Regla de Pilo", tone: "aviso", icon: null },
  nada: { text: "No encontré fuentes", tone: "aviso", icon: null },
};

/** De dónde sale una respuesta redactada; las guardadas antes de este cambio no lo traen. */
export function groundingOf(a: Pick<AskResult, "kind" | "grounding" | "sources">): AskResult["grounding"] {
  if (a.kind !== "ia") return undefined;
  return a.grounding ?? (a.sources.length ? "oficial" : undefined);
}

/** La etiqueta de procedencia; null cuando es conversación (un saludo no lleva fuentes). */
export function badgeOf(a: AskResult, incomplete = false): Badge | null {
  if (incomplete) return { text: tr("Respuesta incompleta"), tone: "aviso", icon: "alert" };
  if (a.kind !== "ia") {
    const plain = PLAIN[a.kind];
    return plain ? { ...plain, text: tr(plain.text) } : null;
  }
  if (a.intent === "saludo" || a.intent === "charla") return null;
  const grounding = groundingOf(a);
  if (grounding === "general") return { text: tr("Conocimiento general · no es información oficial de la UDES"), tone: "general", icon: "globe" };
  if (grounding === "mixta") return { text: tr("Redactada con IA · parte es conocimiento general"), tone: "ia", icon: "spark" };
  if (grounding === "oficial") return { text: tr("Redactada con IA · con fuentes de la UDES"), tone: "ia", icon: "spark" };
  return { text: tr("Redactada con IA"), tone: "ia", icon: "spark" };
}

/** ¿Se muestra la lista de fuentes? Con conocimiento general no hay fuentes que mostrar. */
export const showsSources = (a: AskResult) => a.sources.length > 0 && groundingOf(a) !== "general";

/**
 * La procedencia de una fuente que es de OTRO ámbito de Pilo (0122), tal como
 * la escribió el servidor: «De Pilo en Enseñanza · Políticas institucionales».
 * null si la fuente es de este portal. Nunca se deduce aquí: si el servidor no
 * la manda, no hay procedencia que mostrar.
 */
export function originOf(s: Pick<AskSource, "via" | "from">): string | null {
  if (s.via !== "visita" && s.via !== "puente") return null;
  const from = typeof s.from === "string" ? s.from.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return from || null;
}

/** La frase de procedencia de las fuentes de otro ámbito de una respuesta; vacía si todas son de casa. */
export function originNote(sources: AskSource[]): string {
  const seen = new Map<string, string>();
  for (const s of sources) {
    const from = originOf(s);
    if (!from || seen.has(from)) continue;
    const who = typeof s.written_for === "string" ? s.written_for.replace(/\s+/g, " ").trim().slice(0, 200) : "";
    seen.set(from, who ? tr("{from} (preparado para {who})", { from, who }) : from);
  }
  return seen.size ? tr("Parte de esta respuesta viene de otro ámbito de Pilo: {list}.", { list: [...seen.values()].join("; ") }) : "";
}

/** Las notas discretas que acompañan a la respuesta. */
export function notesOf(a: AskResult): string[] {
  const notes: string[] = [];
  const origin = showsSources(a) ? originNote(a.sources) : "";
  if (origin) notes.push(origin);
  if (a.partial) notes.push(a.notice?.trim() ? trServer(a.notice.trim()) : tr("La redacción se cortó: esta respuesta quedó incompleta."));
  if (a.truncated && !a.partial) notes.push(tr("La respuesta quedó corta: llegó al tope de extensión."));
  if (a.fallback) notes.push(a.kind === "curada" ? tr("La IA no respondió: esta es la respuesta oficial, tal cual.") : tr("La IA no respondió esta vez: le muestro lo publicado, tal cual."));
  return notes;
}

/* --- Pensando… ---------------------------------------------------------------------------- */

export interface ThinkStep {
  id: string;
  label: string;
  detail?: string;
  state: "start" | "done";
}

/**
 * Suma un evento `step` a los pasos. Un `start` repetido no duplica el paso ni
 * reabre uno terminado; un `done` sin `start` entra ya terminado; un id que la
 * página no conoce se pinta igual, con su etiqueta. Lo que no trae id se ignora.
 */
export function reduceSteps(steps: ThinkStep[], event: AskThinkStep): ThinkStep[] {
  const id = typeof event?.id === "string" ? event.id.trim() : "";
  if (!id) return steps;
  const label = typeof event.label === "string" ? event.label.trim() : "";
  const detail = typeof event.detail === "string" ? event.detail.trim() : "";
  const state = event.state === "done" ? "done" : "start";
  const at = steps.findIndex((s) => s.id === id);
  if (at === -1) return [...steps, { id, label: label || id, ...(detail ? { detail } : {}), state }];
  const known = steps[at];
  const next: ThinkStep = {
    id,
    label: label || known.label,
    ...(detail || known.detail ? { detail: detail || known.detail } : {}),
    state: known.state === "done" ? "done" : state,
  };
  return steps.map((s, i) => (i === at ? next : s));
}

/** El paso en curso: el último que empezó y no ha terminado. */
export const activeStep = (steps: ThinkStep[]): ThinkStep | null => [...steps].reverse().find((s) => s.state === "start") ?? null;

/** Lo que Pilo va haciendo mientras redacta, según cuánto lleva. Antes de 20 s basta el nombre del paso. */
const DRAFTING_LINES: [number, string][] = [
  [110, "Ya casi: sigo esperando la respuesta del modelo…"],
  [85, "Esto está tardando más de lo normal; sigo en ello."],
  [60, "Escribiendo la respuesta con calma…"],
  [40, "Revisando las fuentes para no inventar cifras…"],
  [20, "Organizando las ideas…"],
];

const draftingLine = (seconds: number): string | null => {
  const line = DRAFTING_LINES.find(([from]) => seconds >= from)?.[1];
  return line ? tr(line) : null;
};

/**
 * El titular mientras Pilo trabaja. Con pasos del servidor, el que está en
 * curso (o el último terminado). Sin pasos, una línea honesta que cambia con el
 * tiempo: no se inventan etapas.
 */
export function waitingLine(input: { steps: ThinkStep[]; meta: AskMeta | null; seconds: number }): string {
  const { steps, meta, seconds } = input;
  if (steps.length) {
    const current = activeStep(steps) ?? steps[steps.length - 1];
    // Redactar es el paso largo (el modelo puede tardar dos minutos): el titular
    // cuenta en qué anda esa redacción para que la espera no parezca un cuelgue.
    return current.id === "redactar" && current.state === "start" ? draftingLine(seconds) ?? tr(current.label) : tr(current.label);
  }
  if (seconds >= 25) return tr("Esto está tardando más de lo normal; sigo en ello.");
  if (meta) {
    const n = meta.sources.length;
    if (n > 0) return trn(n, "Encontré {n} fuente. Redactando la respuesta…", "Encontré {n} fuentes. Redactando la respuesta…");
    return tr("Redactando la respuesta…");
  }
  if (seconds >= 8) return tr("Redactando la respuesta…");
  return tr("Buscando en lo que conozco…");
}

/* --- Mientras espera ------------------------------------------------------------------------
   El titular dice en qué va Pilo de verdad. Aparte, para que la espera no
   desespere, Pilo suelta de vez en cuando un consejo o una ocurrencia, y su
   cara cambia de gesto. Nada de esto es un estado: los consejos hablan de cómo
   preguntarle y de cómo responde, nunca de la universidad ni de la respuesta. */

export const WAIT_TIPS: string[] = [
  "Consejo: si me dice el año o la sede, le respondo más exacto.",
  "Dato capcioso: yo no adivino cifras. Si no está publicada, se lo digo sin pena.",
  "Después puede preguntarme «¿y el año pasado?»: me acuerdo de lo que veníamos hablando.",
  "Cada cifra que digo trae su fuente. Al final puede ver de dónde salió.",
  "Pregunta capciosa: ¿qué es más largo, un semestre o esta espera? Tranquilo, ya voy.",
  "Consejo: una pregunta a la vez me sale mejor que tres juntas.",
  "Si la respuesta le queda corta, pídame «explíquemelo con un ejemplo».",
  "No me sé chismes, pero sí lo que publica la universidad.",
  "Si me equivoco, dígamelo con «No me sirvió»: así aprendo.",
  "Cuando termine, puedo leerle la respuesta en voz alta.",
  "Dato capcioso: prefiero demorarme a inventar. Por eso reviso las fuentes dos veces.",
  "Consejo: las siglas me confunden menos si las escribe completas la primera vez.",
];

/** Cuándo aparece el primer consejo y cada cuánto cambia, en segundos. */
export const TIP_AFTER = 6;
export const TIP_EVERY = 9;

/**
 * El consejo de este momento de la espera, o null si aún es pronto. `seed`
 * (cualquier entero del turno) hace que no todas las esperas empiecen igual.
 */
export function waitingTip(seconds: number, seed = 0): string | null {
  if (!(seconds >= TIP_AFTER)) return null;
  const turn = Math.floor((seconds - TIP_AFTER) / TIP_EVERY);
  return tr(WAIT_TIPS[(Math.abs(Math.trunc(seed)) + turn) % WAIT_TIPS.length]);
}

/** Los gestos de Pilo mientras piensa: vuelve siempre a «pensar», y entre uno y otro se le escapa otro. */
const WAIT_FACES = ["pensar", "neutral", "pensar", "atrevido", "pensar", "emocionado"] as const;
export const FACE_EVERY = 6;

/** La cara de Pilo según cuánto lleva esperando. Con las primeras palabras ya escritas, se emociona. */
export function waitingFace(seconds: number, writing = false): (typeof WAIT_FACES)[number] {
  if (writing) return "emocionado";
  return WAIT_FACES[Math.floor(Math.max(0, seconds) / FACE_EVERY) % WAIT_FACES.length];
}

/** Un entero estable de un texto (el id del turno), para sembrar los consejos. */
export const seedOf = (text: string): number => [...String(text)].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 7);

/** «12 s», «1 min 5 s». */
export function secondsText(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const rest = s % 60;
  return rest ? `${Math.floor(s / 60)} min ${rest} s` : `${Math.floor(s / 60)} min`;
}

/** Lo que se guarda de «Pensando…» con el turno: los pasos y el tiempo; del razonamiento, solo el comienzo. */
export interface Think {
  steps: ThinkStep[];
  seconds: number;
  thinking?: string;
}

export const THINKING_KEEP = 600;

export function compactThink(steps: ThinkStep[], thinking: string, seconds: number): Think {
  const text = thinking.replace(/\s+/g, " ").trim();
  return {
    // Lo que quedó «en curso» al terminar ya no lo está.
    steps: steps.slice(0, 12).map((s) => ({ ...s, state: "done" as const })),
    seconds: Math.max(0, Math.round(seconds)),
    ...(text ? { thinking: text.length > THINKING_KEEP ? `${text.slice(0, THINKING_KEEP).trimEnd()}…` : text } : {}),
  };
}

/* --- Una respuesta interrumpida ----------------------------------------------------------- */

export interface Interrupted {
  answer?: AskResult;
  error?: string;
  incomplete?: boolean;
}

/**
 * En qué queda un turno cuando el flujo se rompe o la persona lo detiene: lo ya
 * escrito se conserva como respuesta incompleta (con las fuentes que alcanzó a
 * citar); sin nada escrito, queda el mensaje.
 */
export function interruptedTurn(text: string, meta: AskMeta | null, message?: string): Interrupted {
  const written = text.trim();
  if (!written) return { error: message || tr("Detuvo la pregunta antes de que Pilo respondiera.") };
  const cited = new Set([...written.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])));
  return {
    incomplete: true,
    ...(message ? { error: message } : {}),
    answer: {
      kind: "ia",
      text: written,
      sources: (meta?.sources ?? []).filter((s) => cited.has(s.n)),
      trail: meta?.trail ?? [],
      answerId: null,
      ...(meta?.asked ? { asked: meta.asked } : {}),
      ...(meta?.intent ? { intent: meta.intent } : {}),
    },
  };
}
