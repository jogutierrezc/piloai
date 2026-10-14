/* =============================================================================
   Los modos secretos · los efectos de sonido de la entrada.

   Se sintetizan en el navegador (Web Audio): no hay archivos ni red. Solo
   suenan si la persona tiene prendido «Leer en voz alta»: quien no pidió
   sonido no lo oye.
   ========================================================================== */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = ctx ?? new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(from: number, to: number, seconds: number, type: OscillatorType = "square", volume = 0.05) {
  const a = audio();
  if (!a) return;
  const osc = a.createOscillator();
  const gain = a.createGain();
  const t = a.currentTime;
  osc.type = type;
  osc.frequency.setValueAtTime(from, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t + seconds);
  gain.gain.setValueAtTime(volume, t);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + seconds + 0.02);
}

export interface SuperSfx {
  tick: () => void;
  boot: () => void;
  clank: () => void;
  servo: () => void;
  lift: () => void;
  down: () => void;
}

const SOUNDS: SuperSfx = {
  tick: () => tone(1200, 900, 0.05),
  boot: () => tone(90, 700, 0.6, "sawtooth", 0.06),
  clank: () => {
    tone(190, 55, 0.14, "sawtooth", 0.12);
    tone(950, 300, 0.05, "square", 0.05);
  },
  servo: () => tone(300, 520, 0.22, "sawtooth", 0.03),
  lift: () => tone(60, 240, 0.7, "sawtooth", 0.07),
  down: () => tone(600, 80, 0.45, "triangle", 0.08),
};

const noop = () => {};
const SILENT: SuperSfx = { tick: noop, boot: noop, clank: noop, servo: noop, lift: noop, down: noop };

/** Los efectos, o su versión muda si el sonido está apagado. */
export const superSfx = (on: boolean): SuperSfx => (on && typeof window !== "undefined" ? SOUNDS : SILENT);
