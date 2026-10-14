/* =============================================================================
   La voz de Pilo, directa (función de Vercel, en el borde).

   El navegador le pide aquí el audio de una frase y esta función se lo pide a
   Fish Audio y lo devuelve tal como va llegando. Es un atajo de la voz que da
   la función `pilo-ia` de Supabase: no lee la configuración, no guarda lo ya
   leído ni escribe en la bitácora, y por eso responde antes.

   Se configura con variables de entorno del proyecto en Vercel:
     FISH_AUDIO_KEY     la clave de Fish Audio (obligatoria)
     FISH_VOICE_ID      el id de la voz de Pilo en Fish Audio (obligatoria)
     FISH_MODEL         el modelo; por defecto s2.1-pro-free
     FISH_TONE          el tono de la voz («calm»); por defecto, ninguno
     PILO_VOZ_ORIGINS   otros orígenes que pueden pedir voz, separados por coma

   Sin la clave o la voz responde 501 y el portal sigue con la voz de siempre.
   Solo atiende pedidos hechos desde el propio portal (o los orígenes de
   PILO_VOZ_ORIGINS) y frases de hasta 600 caracteres.
   ========================================================================== */

export const config = { runtime: "edge" };

const FISH_TTS_URL = "https://api.fish.audio/v1/tts";
const FISH_MODELS = ["s2.1-pro-free", "s2.1-pro", "s2-pro", "s1"];
export const MAX_TEXT = 600;

/** El id de una voz de Fish Audio (32 hexadecimales), aunque se pegue su enlace completo. */
export const fishVoiceId = (input) => (String(input ?? "").match(/[0-9a-f]{32}/i)?.[0] ?? "").toLowerCase();

export const fishModel = (model) => (FISH_MODELS.includes(model) ? model : FISH_MODELS[0]);

/** El texto con el tono al comienzo de cada frase, igual que en pilo-ia. */
export function fishText(text, tone) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const tag = String(tone ?? "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
  if (!tag || !clean) return clean;
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["»)]*|$)/g) ?? [clean];
  return sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `[${tag}] ${s}`)
    .join(" ");
}

/** Las emociones que la página puede pedir para una frase (los modos secretos del chat). Lista cerrada, igual que en pilo-ia. */
export const VOICE_TONES = ["robotic monotone", "deep serious voice", "cold calm voice", "whispering", "short pause", "excited", "shouting", "amused", "proud", "playful", "alarmed", "confident", "worried", "warm", "laughing", "helpful", "cheerful", "sighing", "sleepy", "singing"];

const cleanTone = (tone) =>
  String(tone ?? "")
    .toLowerCase()
    .replace(/[^a-z ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);

/** Las emociones pedidas para una frase («short pause,whispering»): solo las conocidas, sin repetir y tres como mucho. */
export function parseTones(v) {
  if (typeof v !== "string") return [];
  const known = v.split(",").map(cleanTone).filter((t) => VOICE_TONES.includes(t));
  return [...new Set(known)].slice(0, 3);
}

/** El texto con varias emociones al comienzo de cada frase, igual que en pilo-ia. */
export function fishTagged(text, tones) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  const tags = tones.map((t) => `[${t}]`).join(" ");
  if (!tags || !clean) return clean;
  const sentences = clean.match(/[^.!?…]+(?:[.!?…]+["»)]*|$)/g) ?? [clean];
  return sentences
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${tags} ${s}`)
    .join(" ");
}

/** ¿Viene el pedido del propio portal o de un origen autorizado? */
export function originAllowed(origin, self, extra) {
  if (!origin) return false;
  if (origin === self) return true;
  return String(extra ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean)
    .includes(origin);
}

const json = (body, status, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

export default async function handler(request) {
  const env = process.env;
  const origin = request.headers.get("origin");
  const allowed = originAllowed(origin, new URL(request.url).origin, env.PILO_VOZ_ORIGINS);
  const cors = allowed ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {};

  if (request.method === "OPTIONS") {
    return new Response(null, { status: allowed ? 204 : 403, headers: { ...cors, "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "content-type", "Access-Control-Max-Age": "86400" } });
  }
  if (request.method !== "POST") return json({ error: "Solo se aceptan pedidos POST.", code: "metodo" }, 405, { Allow: "POST, OPTIONS" });
  if (!allowed) return json({ error: "Este sitio no puede pedir la voz de Pilo.", code: "origen" }, 403);

  const key = env.FISH_AUDIO_KEY ?? "";
  const voiceId = fishVoiceId(env.FISH_VOICE_ID);
  if (!key || !voiceId) return json({ error: "La voz directa no está configurada.", code: "sin_configurar" }, 501, cors);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "El pedido no se pudo leer.", code: "formato" }, 400, cors);
  }
  const text = typeof body?.text === "string" ? body.text.replace(/\s+/g, " ").trim() : "";
  if (!text) return json({ error: "Falta el texto.", code: "formato" }, 400, cors);
  // Una frase de un modo secreto del chat trae su propia emoción: manda sobre el tono de siempre.
  const tones = parseTones(body?.tone);
  if (text.length > MAX_TEXT) return json({ error: "El texto es demasiado largo para leerlo de una vez.", code: "tamano" }, 413, cors);

  let upstream;
  try {
    upstream = await fetch(FISH_TTS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", model: fishModel(env.FISH_MODEL) },
      body: JSON.stringify({ text: tones.length ? fishTagged(text, tones) : fishText(text, env.FISH_TONE), reference_id: voiceId, format: "mp3", mp3_bitrate: 128, latency: "balanced", normalize: true }),
    });
  } catch {
    return json({ error: "No se pudo conectar con Fish Audio.", code: "red" }, 502, cors);
  }
  if (!upstream.ok || !upstream.body) {
    // El detalle de Fish Audio no se le pasa al navegador: puede nombrar la cuenta.
    const status = upstream.status === 429 ? 429 : 502;
    return json({ error: status === 429 ? "Fish Audio está al tope ahora." : `Fish Audio respondió ${upstream.status}.`, code: status === 429 ? "limite_proveedor" : "proveedor" }, status, cors);
  }
  return new Response(upstream.body, { status: 200, headers: { ...cors, "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
}
