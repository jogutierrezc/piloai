/* =============================================================================
   Mr. Pilo con IA · el reproductor de la voz.

   Tres cosas que en el celular deciden si Pilo suena o se queda mudo:

   1. Un solo reproductor, desbloqueado con el primer toque. Los navegadores
      móviles solo dejan sonar lo que arranca dentro de un toque; el audio de
      Pilo llega después (hay que pedirlo), así que un `new Audio()` por frase
      se queda bloqueado. Un elemento que ya sonó una vez dentro de un toque sí
      puede volver a sonar solo: por eso es uno, y se estrena con un silencio.
      Lo mismo con la voz del navegador, que también pide un toque.
   2. El tipo del audio. El servicio lo entrega sin decir qué es
      («octet-stream») y Safari en iOS no reproduce lo que no sabe qué es: se
      mira el comienzo del archivo y se le pone su tipo.
   3. La vía directa (api/pilo-voz.js, en Vercel): más rápida que la de
      Supabase. Si no está configurada o no existe, se deja de intentar y la
      voz sigue por donde siempre.
   ========================================================================== */

/** El tipo de un audio por sus primeros bytes; "" si no se reconoce. */
export function sniffAudioType(head: Uint8Array): string {
  const tag = String.fromCharCode(...Array.from(head.slice(0, 4)));
  if (tag === "RIFF") return "audio/wav";
  if (tag === "OggS") return "audio/ogg";
  if (tag === "fLaC") return "audio/flac";
  if (tag.startsWith("ID3")) return "audio/mpeg";
  if (head.length >= 8 && String.fromCharCode(...Array.from(head.slice(4, 8))) === "ftyp") return "audio/mp4";
  // MP3 sin etiqueta: empieza por la marca de sincronía de un cuadro (0xFFEx / 0xFFFx).
  if (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0) return "audio/mpeg";
  return "";
}

/** El mismo audio, con su tipo puesto si venía sin él. */
export async function typedAudio(blob: Blob): Promise<Blob> {
  if (blob.type.startsWith("audio/")) return blob;
  const type = sniffAudioType(new Uint8Array(await blob.slice(0, 12).arrayBuffer()));
  return type ? new Blob([blob], { type }) : blob;
}

/* --- El reproductor único ---------------------------------------------------------------------- */

let player: HTMLAudioElement | null = null;
let unlocked = false;
let settle: ((ended: boolean) => void) | null = null;
let currentUrl = "";

/** Medio segundo de silencio en WAV (8 kHz, 8 bits, mono). */
function silence(): string {
  const samples = 4000;
  const bytes = new Uint8Array(44 + samples).fill(128);
  const view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => [...text].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples, true);
  ascii(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples, true);
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

/**
 * Estrena el reproductor y la voz del navegador. Hay que llamarla dentro de
 * un toque o una tecla; la página lo hace sola con el primero (más abajo).
 */
export function unlockPiloAudio() {
  if (unlocked || typeof window === "undefined" || typeof Audio === "undefined") return;
  // Si ya está sonando algo, el reproductor ya estaba desbloqueado.
  if (settle) return;
  try {
    if (!player) player = new Audio();
    const el = player;
    const url = silence();
    el.src = url;
    el.volume = 0;
    el.play()
      .then(() => {
        unlocked = true;
      })
      .catch(() => undefined)
      .finally(() => {
        // Solo si nadie puso ya otro audio en su lugar.
        if (el.src === url) {
          el.pause();
          el.removeAttribute("src");
        }
        el.volume = 1;
        URL.revokeObjectURL(url);
      });
    if ("speechSynthesis" in window && "SpeechSynthesisUtterance" in window && !window.speechSynthesis.speaking) {
      const hush = new SpeechSynthesisUtterance(" ");
      hush.volume = 0;
      window.speechSynthesis.speak(hush);
    }
  } catch {
    /* sin audio: la lectura dirá que no pudo sonar */
  }
}

if (typeof window !== "undefined") {
  const first = () => {
    unlockPiloAudio();
    if (!unlocked) return;
    window.removeEventListener("pointerdown", first, true);
    window.removeEventListener("keydown", first, true);
  };
  window.addEventListener("pointerdown", first, true);
  window.addEventListener("keydown", first, true);
}

/** Pone en pausa lo que suene, sin soltar a quien espera: `resumePiloAudio` lo retoma donde iba. */
export function pausePiloAudio() {
  if (player && !player.paused && !player.ended) player.pause();
}

/** Retoma lo que `pausePiloAudio` detuvo. Si ya no hay nada por seguir, no hace nada. */
export function resumePiloAudio() {
  if (!player || !settle || !player.paused || player.ended) return;
  player.play().catch(() => stopPiloAudio());
}

/** Calla lo que suene. Quien esperaba a que terminara recibe `false`. */
export function stopPiloAudio() {
  player?.pause();
  const done = settle;
  settle = null;
  done?.(false);
}

/** Reproduce un audio y se cumple al terminar: `true` si sonó entero, `false` si no pudo o lo callaron. */
export async function playPiloAudio(blob: Blob, rate = 1): Promise<boolean> {
  if (typeof Audio === "undefined") return false;
  const typed = await typedAudio(blob);
  stopPiloAudio();
  if (!player) player = new Audio();
  const el = player;
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  const url = URL.createObjectURL(typed);
  currentUrl = url;
  return new Promise<boolean>((resolve) => {
    const finish = (ended: boolean) => {
      if (settle !== finish) return;
      settle = null;
      el.onended = null;
      el.onerror = null;
      resolve(ended);
    };
    settle = finish;
    el.onended = () => finish(true);
    el.onerror = () => finish(false);
    el.volume = 1;
    el.src = url;
    el.playbackRate = rate;
    el.play().catch(() => finish(false));
  });
}

/* --- La vía directa (Vercel) -------------------------------------------------------------------- */

export const DIRECT_VOICE_PATH = "/api/pilo-voz";
const DIRECT_TIMEOUT = 12_000;
/** Las frases más largas que esto van por la vía de siempre (el tope de api/pilo-voz.js). */
const DIRECT_MAX_TEXT = 600;

let direct: "sin probar" | "sirve" | "no hay" = "sin probar";

/**
 * Qué hacer con la respuesta de la vía directa: usar el audio, olvidarse de
 * ella por esta visita (no existe o no está configurada) o seguir por la de
 * siempre solo esta vez (un tropiezo del servicio).
 */
export function directVerdict(status: number, contentType: string | null): "audio" | "no hay" | "esta vez no" {
  const type = (contentType ?? "").toLowerCase();
  if (status >= 200 && status < 300) return type.startsWith("audio/") ? "audio" : "no hay";
  if (status === 404 || status === 405 || status === 501 || status === 403) return "no hay";
  return "esta vez no";
}

/** El audio por la vía directa, o null si hay que pedirlo por la de siempre. */
export async function directVoice(text: string, tone?: string): Promise<Blob | null> {
  if (direct === "no hay" || typeof window === "undefined" || text.length > DIRECT_MAX_TEXT) return null;
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), DIRECT_TIMEOUT);
  try {
    const response = await fetch(DIRECT_VOICE_PATH, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(tone ? { text, tone } : { text }), signal: ctl.signal });
    const verdict = directVerdict(response.status, response.headers.get("content-type"));
    if (verdict === "no hay") direct = "no hay";
    if (verdict !== "audio") return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    direct = "sirve";
    return blob;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}
