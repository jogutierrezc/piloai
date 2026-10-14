/* =============================================================================
   Mr. Pilo con IA · Expresiones emocionales y modulación oral de la voz.

   Permite que la voz de Pilo hable con naturalidad prosódica, usando
   microexpresiones orales y entonaciones iniciales acordes con el estado
   de ánimo de la respuesta (emocionado, atento, atrevido, cuidado, pensar),
   y modulando sutilmente la velocidad y el tono.

   La respuesta escrita visible en pantalla se mantiene 100% formal, limpia
   y fidedigna; la enriquecida es únicamente la locución oral (TTS).
   ========================================================================== */

export type ExpressionMood = "emocionado" | "atento" | "atrevido" | "cuidado" | "pensar";

export const DEFAULT_VOICE_PATTERNS: Record<ExpressionMood, string[]> = {
  emocionado: [
    "¡Claro que sí!",
    "¡Qué buena pregunta!",
    "¡Mira este dato interesante!",
    "¡Con mucho gusto te cuento!",
  ],
  atento: [
    "Veamos lo que tenemos registrado...",
    "Revisemos con atención las cifras oficiales...",
    "Según los reportes de Planeación...",
  ],
  atrevido: [
    "¡Jeje, esa es buena!",
    "¡Ojo con esa pregunta!",
    "¡Ah, qué curioso detalle!",
  ],
  cuidado: [
    "Atención a este detalle...",
    "Es importante aclarar que...",
    "Fíjate bien en esto...",
  ],
  pensar: [
    "Hmm, déjame revisar...",
    "Consultando los registros...",
    "A ver, veamos qué encontramos...",
  ],
};

export const MOOD_LABELS: Record<ExpressionMood, { label: string; desc: string }> = {
  emocionado: {
    label: "Entusiasta / Emocionado",
    desc: "Para cifras positivas, hitos alcanzados y respuestas alegres de Planeación.",
  },
  atento: {
    label: "Atento / Analítico",
    desc: "Para explicaciones técnicas, tablas y desgloses detallados.",
  },
  atrevido: {
    label: "Pícaro / Atrevido",
    desc: "Para preguntas capciosas, curiosidades y bromas con Pilo.",
  },
  cuidado: {
    label: "Precaución / Advertencia",
    desc: "Para cifras no públicas (dinero, salarios), datos confidenciales o advertencias.",
  },
  pensar: {
    label: "Reflexivo / Pensativo",
    desc: "Cuando Pilo analiza varias fuentes o no encuentra información directa.",
  },
};

export interface EnrichVoiceOptions {
  mood?: string | null;
  expressionsEnabled?: boolean;
  patterns?: Record<string, string[]>;
  modulationEnabled?: boolean;
  baseRate?: number;
  basePitch?: number;
}

export interface EnrichedVoiceResult {
  sentences: string[];
  rate: number;
  pitch: number;
  openerUsed?: string;
}

/**
 * Normaliza el mood recibido a uno de los conocidos por Pilo.
 */
export function normalizeMood(mood?: string | null): ExpressionMood {
  if (!mood) return "atento";
  const m = mood.toLowerCase().trim();
  if (m === "loco" || m === "atrevido" || m === "curioso") return "atrevido";
  if (m === "emocionado" || m === "feliz" || m === "alegre") return "emocionado";
  if (m === "cuidado" || m === "advertencia" || m === "alerta") return "cuidado";
  if (m === "pensar" || m === "duda" || m === "reflexivo") return "pensar";
  return "atento";
}

/**
 * Verifica si una frase ya comienza con una exclamación o saludo que haga
 * redundante anteponer otra microexpresión.
 */
function alreadyHasGreetingOrExclamation(text: string): boolean {
  const clean = text.trim();
  return /^[¡!¿?]/i.test(clean) || /^(hola|buen[oa]s|oye|mira|atenci[oó]n|f[ií]jate)/i.test(clean);
}

/**
 * Selecciona una microexpresión oral adecuada según el mood y el banco de patrones.
 */
export function pickMicroexpression(
  mood: ExpressionMood,
  patterns: Record<string, string[]> = DEFAULT_VOICE_PATTERNS,
  seedText = "",
): string | null {
  const list = patterns[mood] ?? DEFAULT_VOICE_PATTERNS[mood] ?? [];
  if (!list.length) return null;

  // Selección pseudo-determinista basada en la longitud/contenido para evitar repetición monótona
  let hash = 0;
  for (let i = 0; i < seedText.length; i++) hash = (hash * 31 + seedText.charCodeAt(i)) | 0;
  const index = Math.abs(hash) % list.length;
  return list[index] ?? list[0] ?? null;
}

/**
 * Modula sutilmente la velocidad y el tono de la voz según la emoción.
 */
export function modulateVoice(
  mood: ExpressionMood,
  baseRate = 1.0,
  basePitch = 1.0,
): { rate: number; pitch: number } {
  switch (mood) {
    case "emocionado":
      return {
        rate: Math.min(1.3, Number((baseRate * 1.04).toFixed(2))),
        pitch: Math.min(1.2, Number((basePitch * 1.03).toFixed(2))),
      };
    case "atrevido":
      return {
        rate: Math.min(1.3, Number((baseRate * 1.02).toFixed(2))),
        pitch: Math.min(1.2, Number((basePitch * 1.02).toFixed(2))),
      };
    case "cuidado":
      return {
        rate: Math.max(0.7, Number((baseRate * 0.95).toFixed(2))),
        pitch: Math.max(0.8, Number((basePitch * 0.98).toFixed(2))),
      };
    case "pensar":
      return {
        rate: Math.max(0.7, Number((baseRate * 0.96).toFixed(2))),
        pitch: Math.max(0.8, Number((basePitch * 0.97).toFixed(2))),
      };
    case "atento":
    default:
      return { rate: baseRate, pitch: basePitch };
  }
}

/**
 * Enriquece la lista de frases para locución oral de Mr. Pilo:
 * 1. Inyecta la microexpresión inicial en la primera frase si está habilitado.
 * 2. Modula velocidad y tono según la emoción si está habilitado.
 */
export function enrichSpokenSentences(
  rawSentences: string[],
  options: EnrichVoiceOptions = {},
): EnrichedVoiceResult {
  const {
    mood: rawMood,
    expressionsEnabled = true,
    patterns = DEFAULT_VOICE_PATTERNS,
    modulationEnabled = true,
    baseRate = 1.0,
    basePitch = 1.0,
  } = options;

  const mood = normalizeMood(rawMood);
  const sentences = [...rawSentences];

  let openerUsed: string | undefined;

  if (expressionsEnabled && sentences.length > 0 && sentences[0]) {
    const first = sentences[0].trim();
    if (!alreadyHasGreetingOrExclamation(first)) {
      const opener = pickMicroexpression(mood, patterns, first);
      if (opener) {
        openerUsed = opener;
        sentences[0] = `${opener} ${first}`;
      }
    }
  }

  const { rate, pitch } = modulationEnabled
    ? modulateVoice(mood, baseRate, basePitch)
    : { rate: baseRate, pitch: basePitch };

  return { sentences, rate, pitch, openerUsed };
}
