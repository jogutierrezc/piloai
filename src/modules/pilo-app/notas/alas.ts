/* =============================================================================
   Mr. Pilo · Mis notas (beta) · el sonido de las alas.

   Un aleteo corto al cambiar de paso en la guía, y un planeo mientras Pilo
   lee Génesis o piensa las recomendaciones. Todavía no hay grabación: se
   sintetiza con WebAudio (ruido filtrado). Es un módulo pequeño y aislado a
   propósito: el día que haya un archivo, se cambia lo de adentro de `flap` y
   `glide` y nadie más se entera.

   Reglas:
     · Solo suena después de un gesto de la persona: quien llama lo hace desde
       un toque o un clic. Si el navegador no deja (no hubo gesto, no hay
       WebAudio), no suena y no falla.
     · Respeta el interruptor de sonido de la app: `setWingsOn(false)` lo calla
       de inmediato, y con él apagado nada crea ni toca el audio.
     · El movimiento reducido no lo afecta: es sonido, no movimiento.

   No guarda nada ni pide nada a la red.
   ========================================================================== */

type Ctx = AudioContext;

let on = true;
let ctx: Ctx | null = null;
let master: GainNode | null = null;
let noise: AudioBuffer | null = null;

const VOLUME = 0.5;

/** El audio, creado al primer uso; null si el sonido está apagado o el navegador no lo da. */
function audio(): Ctx | null {
  if (!on || typeof window === "undefined") return null;
  try {
    if (!ctx) {
      const Make = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Make) return null;
      ctx = new Make();
      master = ctx.createGain();
      master.gain.value = VOLUME;
      master.connect(ctx.destination);
      // Dos segundos de ruido blanco: de ahí se recorta cada aleteo.
      noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

/** Un golpe de ala: aire que sube de tono y se apaga. */
function flap(at: number, seconds: number, peak: number) {
  const c = audio();
  if (!c || !master || !noise) return;
  try {
    const source = c.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 0.9;
    const gain = c.createGain();
    const t = c.currentTime + at;
    filter.frequency.setValueAtTime(260, t);
    filter.frequency.exponentialRampToValueAtTime(950, t + seconds * 0.45);
    filter.frequency.exponentialRampToValueAtTime(220, t + seconds);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + seconds * 0.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + seconds + 0.05);
  } catch {
    /* sin sonido: no pasa nada */
  }
}

/** El aleteo: `count` golpes de ala, cada uno un poco más suave. Llámese desde un toque o un clic. */
export function wings(count = 2): void {
  for (let i = 0; i < Math.min(4, Math.max(1, count)); i++) flap(i * 0.36, 0.34, Math.max(0.12, 0.5 - i * 0.08));
}

/** El planeo: viento sostenido que respira, mientras Pilo lee o piensa. Llámese desde un toque o un clic. */
export function glide(seconds = 2.4): void {
  const c = audio();
  if (!c || !master || !noise) return;
  const length = Math.min(8, Math.max(0.8, seconds));
  try {
    const source = c.createBufferSource();
    source.buffer = noise;
    source.loop = true;
    const filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 520;
    const gain = c.createGain();
    const t = c.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    for (let k = 1; 0.5 + k * 0.7 < length - 0.3; k++) gain.gain.linearRampToValueAtTime(k % 2 ? 0.09 : 0.16, t + 0.5 + k * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    source.start(t);
    source.stop(t + length + 0.1);
  } catch {
    /* sin sonido: no pasa nada */
  }
}

/** El interruptor: apagado, calla lo que suene y nada vuelve a sonar hasta encenderlo. */
export function setWingsOn(value: boolean): void {
  on = value;
  try {
    if (master) master.gain.value = value ? VOLUME : 0;
  } catch {
    /* sin sonido */
  }
}

/** ¿Está encendido el sonido de las alas? */
export const wingsOn = (): boolean => on;
