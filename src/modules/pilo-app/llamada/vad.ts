/* =============================================================================
   Mr. Pilo · la app · la llamada · cuándo habla la persona.

   Para que la llamada se sienta como una conversación, Pilo tiene que callarse
   en cuanto usted empieza a hablar, sin esperar a que lo toque. Esto mide el
   nivel del micrófono (con cancelación de eco del navegador) y avisa cuándo hay
   una voz sostenida.

   El eco de la propia voz de Pilo en los parlantes también sube el nivel. Por
   eso quien usa esto no cree a la primera: pausa a Pilo y mide otra vez. Si el
   nivel cae al pausarlo, era eco y Pilo sigue; si se mantiene, era usted.

   La parte que decide (VoiceGate) es pura y se prueba en node; la que toca el
   micrófono (openMeter) no.
   ========================================================================== */

/** El nivel (RMS, de 0 a 1) de un bloque de muestras. */
export function rms(samples: ArrayLike<number>): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export interface GateOptions {
  /** El nivel más bajo que cuenta como voz, aunque el cuarto esté en silencio. */
  min?: number;
  /** Cuántas veces el ruido de fondo tiene que ser superado. */
  ratio?: number;
  /** Cuánto debe sostenerse el nivel (ms) para decir que es una voz y no un golpe o un clic. */
  hold?: number;
  /** Cuánto silencio (ms) cierra la voz. */
  release?: number;
}

export type GateEvent = "voz" | "calla" | null;

/**
 * Decide si hay una voz. Aprende el ruido de fondo mientras no la hay: en un cuarto
 * ruidoso, o con el eco de Pilo, el umbral sube; en silencio, baja hasta `min`.
 */
export class VoiceGate {
  floor = 0.008;
  voiced = false;
  private above = 0;
  private below = 0;
  private readonly min: number;
  private readonly ratio: number;
  private readonly hold: number;
  private readonly release: number;

  constructor({ min = 0.03, ratio = 3, hold = 180, release = 500 }: GateOptions = {}) {
    this.min = min;
    this.ratio = ratio;
    this.hold = hold;
    this.release = release;
  }

  get threshold(): number {
    return Math.max(this.min, this.floor * this.ratio);
  }

  /** ¿Este nivel supera el umbral? */
  loud(level: number): boolean {
    return level > this.threshold;
  }

  /** Un nivel nuevo, medido `dt` ms después del anterior. Avisa solo cuando algo cambia. */
  push(level: number, dt: number): GateEvent {
    if (this.loud(level)) {
      this.above += dt;
      this.below = 0;
      if (!this.voiced && this.above >= this.hold) {
        this.voiced = true;
        return "voz";
      }
      return null;
    }
    // Lo que no es voz enseña cuánto ruido hay: el fondo se aprende despacio.
    this.floor = Math.max(0.004, this.floor * 0.97 + level * 0.03);
    this.above = 0;
    this.below += dt;
    if (this.voiced && this.below >= this.release) {
      this.voiced = false;
      return "calla";
    }
    return null;
  }

  reset() {
    this.voiced = false;
    this.above = 0;
    this.below = 0;
  }
}

export interface Meter {
  /** El nivel de ahora mismo. */
  level(): number;
  stop(): void;
}

/**
 * Abre el micrófono (con cancelación de eco y de ruido) y mide su nivel. null si no se pudo:
 * sin permiso o sin micrófono la llamada sigue, solo que a Pilo se le interrumpe tocándolo.
 */
export async function openMeter(): Promise<Meter | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  const Ctx = (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext) as typeof AudioContext | undefined;
  if (!Ctx) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
  } catch {
    return null;
  }
  const ctx = new Ctx();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(buf);
      return rms(buf);
    },
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
    },
  };
}
