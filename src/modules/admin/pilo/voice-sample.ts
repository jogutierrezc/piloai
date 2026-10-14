/* =============================================================================
   Mr. Pilo con IA · las muestras de la voz de NVIDIA (0101).

   Magpie TTS Zeroshot clona una voz a partir de 3 a 10 segundos de habla
   limpia, en WAV mono de 16 bits y a 22,05 kHz o más. Aquí cualquier audio que
   el navegador sepa abrir (WAV, MP3, M4A, OGG, lo grabado con el micrófono) se
   deja así: una sola pista, 22 050 Hz, sin silencio al principio ni al final,
   con el volumen parejo y a lo sumo 10 segundos. Luego se sube al bucket
   privado pilo-voz.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";
import { RIVA_RATE, wavFile } from "../../../components/pilo/ai/logic";
import type { VoiceStyle } from "../../../components/pilo/ai/logic";

export const MIN_SECONDS = 3;
export const MAX_SECONDS = 10;

/**
 * Quita el silencio de los extremos: lo que queda por debajo de un 4 % del pico
 * (o de un piso fijo) en ventanas de 20 ms, con un margen de 0,15 s.
 */
export function trimSilence(samples: Float32Array, rate: number): Float32Array {
  const win = Math.max(1, Math.round(rate * 0.02));
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const floor = Math.max(0.01, peak * 0.04);
  const loud = (start: number) => {
    let sum = 0;
    const end = Math.min(samples.length, start + win);
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, end - start)) > floor;
  };
  let first = 0;
  while (first < samples.length && !loud(first)) first += win;
  let last = samples.length;
  while (last > first && !loud(Math.max(first, last - win))) last -= win;
  if (first >= last) return new Float32Array();
  const pad = Math.round(rate * 0.15);
  return samples.slice(Math.max(0, first - pad), Math.min(samples.length, last + pad));
}

/** A PCM de 16 bits, con el pico en 0,9 para que todas las muestras suenen parejo. */
export function toPcm16(samples: Float32Array): Uint8Array {
  let peak = 0;
  for (const v of samples) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.9 / peak : 1;
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i] * gain));
    view.setInt16(i * 2, Math.round(v < 0 ? v * 0x8000 : v * 0x7fff), true);
  }
  return out;
}

/** Cualquier audio → WAV mono de 16 bits a 22 050 Hz, recortado. Falla si queda muy corto. */
export async function prepareSample(file: Blob): Promise<{ wav: Blob; seconds: number; cut: boolean }> {
  const bytes = await file.arrayBuffer();
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new Context();
  let decoded: AudioBuffer;
  try {
    decoded = await context.decodeAudioData(bytes);
  } catch {
    throw new Error("El navegador no pudo abrir ese audio. Pruebe con WAV o MP3.");
  } finally {
    void context.close();
  }
  // Una sola pista a 22 050 Hz: el contexto de una pista mezcla el estéreo.
  const offline = new OfflineAudioContext(1, Math.max(1, Math.ceil(decoded.duration * RIVA_RATE)), RIVA_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const mono = (await offline.startRendering()).getChannelData(0);
  let samples = trimSilence(mono, RIVA_RATE);
  const cut = samples.length > MAX_SECONDS * RIVA_RATE;
  if (cut) samples = samples.slice(0, MAX_SECONDS * RIVA_RATE);
  const seconds = samples.length / RIVA_RATE;
  if (seconds < MIN_SECONDS) {
    throw new Error(`Sin los silencios, la muestra dura ${seconds.toLocaleString("es-CO", { maximumFractionDigits: 1 })} s. Hacen falta al menos ${MIN_SECONDS} s de voz.`);
  }
  return { wav: new Blob([wavFile(toPcm16(samples), RIVA_RATE)], { type: "audio/wav" }), seconds, cut };
}

/** Un identificador corto para el estilo, a partir de su nombre. */
export function styleId(name: string, taken: string[]): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || "voz";
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

/** Sube la muestra ya preparada. Cada subida lleva su fecha: cambiar la muestra no reutiliza el audio guardado. */
export async function uploadSample(id: string, name: string, sample: { wav: Blob; seconds: number }): Promise<VoiceStyle> {
  const path = `muestras/${id}-${Date.now().toString(36)}.wav`;
  const { error } = await supabase.storage.from("pilo-voz").upload(path, sample.wav, { contentType: "audio/wav", upsert: true });
  if (error) {
    if (/bucket/i.test(error.message)) throw new Error("Falta el bucket pilo-voz: aplique la migración 0101.");
    throw new Error(`No se pudo subir la muestra: ${error.message}`);
  }
  return { id, name: name.trim() || id, path, seconds: Math.round(sample.seconds * 10) / 10 };
}

/** La muestra guardada, para oírla en la configuración. */
export async function sampleUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage.from("pilo-voz").createSignedUrl(path, 300);
  if (error || !data) throw new Error("No se pudo abrir la muestra.");
  return data.signedUrl;
}

/** Borra el archivo de una muestra que ya no se usa. */
export async function removeSample(path: string) {
  await supabase.storage.from("pilo-voz").remove([path]);
}

/**
 * Graba con el micrófono hasta `stop()` o hasta 12 segundos (luego se recorta
 * a 10). Devuelve el audio tal como lo da el navegador (webm u ogg).
 */
export async function startRecording(): Promise<{ stop: () => Promise<Blob>; cancel: () => void }> {
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Este navegador no permite grabar. Suba un archivo de audio.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
  const finished = new Promise<Blob>((resolve) => {
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
  });
  recorder.start();
  const timer = window.setTimeout(() => recorder.state === "recording" && recorder.stop(), (MAX_SECONDS + 2) * 1000);
  return {
    stop: () => {
      window.clearTimeout(timer);
      if (recorder.state === "recording") recorder.stop();
      return finished;
    },
    cancel: () => {
      window.clearTimeout(timer);
      if (recorder.state === "recording") recorder.stop();
    },
  };
}
