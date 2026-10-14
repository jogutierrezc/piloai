/* =============================================================================
   Mr. Pilo · Presentación de investigación · la bienvenida.

   La de la app al abrirla por primera vez (AppWelcome), a la medida de la sala:
   luz y anillos crecen, Pilo salta a escena, se sorprende y mira a los lados;
   el título llega letra por letra y cada frase palabra por palabra mientras
   habla, con su muestra debajo. La salida: el escenario se cierra en círculo
   sobre la cabecera mientras Pilo vuela hasta ella.

   La voz es la oficial o ninguna (official-voice.ts): nunca la del navegador.
   Se pide por adelantado; suena solo después de un toque o una tecla, que es
   cuando el navegador deja; el pico se mueve mientras suena el audio de verdad.
   Sin voz, el pico acompaña a las palabras mientras aparecen.

   Lo que dice Pilo (PRESENTATION_BEATS) lo fija speaker.test.ts: quién es y de
   dónde viene, el chiste de las plumas, su doble misión, el apoyo de NVIDIA y
   el cierre como piloto de innovación educativa de la UDES.

   Movimiento: transform y opacidad, y clip-path solo para el cierre. Cada
   animación se monta en un contexto de GSAP que, al interrumpirse (otra frase,
   Saltar, desmontaje), devuelve todo a su estado visible. Con movimiento
   reducido, solo fundidos.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import gsap from "gsap";
import { Pilo } from "../../../pregunta/Pilo";
import type { MojiMood, PiloMojiHandle } from "../../../pregunta/Pilo";
import { modulateVoice } from "../../../../components/pilo/ai/voice-expressions";
import { prefetchOfficial, sayOfficial, stopOfficial } from "../../../pilo-app/official-voice";
import { useFocusTrap } from "../../../pilo-app/Layer";
import type { Face } from "./engine";

export interface PresentationBeat {
  id: string;
  say: string;
  face: MojiMood;
  canvasFace: Face;
  voiceMood: "emocionado" | "atrevido" | "pensar" | "atento";
  moodLabel: string;
  look: [number, number];
  chips: string[];
  tag: string;
}

export const PRESENTATION_BEATS: PresentationBeat[] = [
  // 1. Presentación, Origen y Bienvenida Institucional
  {
    id: "bienvenida",
    say: "¡Hola a todos! Es un inmenso honor saludarlos. Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander, concebido y creado con orgullo desde la Oficina de Planeación Institucional.",
    face: "feliz",
    canvasFace: "feliz",
    voiceMood: "emocionado",
    moodLabel: "Voz oficial de Pilo · Entusiasta / Identidad Institucional",
    look: [0, -0.1],
    chips: ["Universidad de Santander", "Planeación Institucional", "IA Oficial UDES"],
    tag: "Identidad & Origen",
  },
  // 2. Chiste de las plumas y capacidades inimaginables
  {
    id: "plumas",
    say: "¡Uy, perdonen si sacudo un poco las plumas de la emoción! Es que coordinar tantas sinapsis a veces me eriza el plumaje cibernético. Aunque todavía me ven pequeñito, ¡tengo unas capacidades de procesamiento y análisis verdaderamente inimaginables!",
    face: "cuidado", // Se traduce a 'atrevido' (guiño pícaro)
    canvasFace: "idea",
    voiceMood: "atrevido",
    moodLabel: "Voz oficial de Pilo · Pícaro / Sacudiendo las plumas",
    look: [0.35, 0.15],
    chips: ["Plumaje Cibernético", "Pequeño pero Poderoso", "Capacidades Inimaginables"],
    tag: "Humor & Potencial",
  },
  // 3. Misión Dual: Toma de decisiones + Profesores y Estudiantes
  {
    id: "mision",
    say: "Fui entrenado para un doble propósito: apoyar la toma de decisiones institucionales estratégicas de nuestros directivos, y a la vez, enseñar, acompañar y resolver dudas de nuestros profesores y estudiantes, gracias a mi integración directa con los sistemas de la universidad.",
    face: "piensa",
    canvasFace: "piensa",
    voiceMood: "atento",
    moodLabel: "Voz oficial de Pilo · Atento / Conexión Sistémica",
    look: [-0.25, 0.35],
    chips: ["Toma de Decisiones", "Profesores & Estudiantes", "Integración Moodle & PDI", "Cero Alucinación"],
    tag: "Misión Dual",
  },
  // 4. Apoyo de NVIDIA
  {
    id: "nvidia",
    say: "Todo esto funciona con el respaldo invaluable de NVIDIA, quien nos permitió usar sus entornos de vanguardia y microservicios NIM para que yo pudiera estar hoy aquí con ustedes, acelerado con supercómputo Hopper y modelos de última generación.",
    face: "sorpresa", // Se traduce a 'emocionado'
    canvasFace: "bien",
    voiceMood: "emocionado",
    moodLabel: "Voz oficial de Pilo · Orgullo Tecnológico / NVIDIA NIM",
    look: [0, -0.2],
    chips: ["NVIDIA NIM", "TensorRT-LLM", "Supercómputo Hopper", "Gemma 4 31B"],
    tag: "Alianza NVIDIA",
  },
  // 5. Cierre y Orgullo de Alma Mater
  {
    id: "cierre",
    say: "¡Y miren mis plumas cómo brillan! Hoy tengo el honor de ser un piloto pionero de innovación educativa y transformación digital de mi amada alma mater, la UDES. ¡Acompáñenme a explorar mi cerebro y descubrir cómo funciona mi capa profunda!",
    face: "feliz",
    canvasFace: "feliz",
    voiceMood: "emocionado",
    moodLabel: "Voz oficial de Pilo · Emocionado / Alma Mater UDES",
    look: [0, 0],
    chips: ["Piloto de Innovación Educativa", "Transformación Digital", "Alma Mater UDES", "Capa Profunda"],
    tag: "Innovación Educativa",
  },
];

export const WELCOME_TITLE = "Hola, soy Mr. Pilo";

const VOICE = { portal: "pregunta", advanced: true, keep: true } as const;
const stillMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
/** Ya hubo un toque o una tecla en esta página: el navegador deja sonar. */
const touched = () => typeof navigator !== "undefined" && Boolean((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive);

const VoiceIcon = ({ on }: { on: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 8v4h3l4 3V5L6 8H3z" />
    {on ? <path d="M13 7.5a3.5 3.5 0 010 5M15.5 5a7 7 0 010 10" /> : <path d="M13.5 8l4 4M17.5 8l-4 4" />}
  </svg>
);

export function PiloWelcomeSpeaker({
  target,
  onFaceChange,
  onDone,
}: {
  /** El lugar de Pilo en la cabecera de la presentación: hasta ahí vuela al salir. */
  target: RefObject<HTMLElement>;
  /** La cara de Pilo en el núcleo de la malla acompaña a la de la bienvenida. */
  onFaceChange?: (face: Face) => void;
  onDone: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const pilo = useRef<PiloMojiHandle>(null);
  const hold = useRef<gsap.core.Tween | null>(null);
  const intro = useRef<gsap.core.Timeline | null>(null);
  const leaving = useRef(false);
  const [beat, setBeat] = useState(-1);
  const [voiceOn, setVoiceOn] = useState(true);
  const [armed, setArmed] = useState(touched);
  const [silent, setSilent] = useState(false);

  const current = beat >= 0 ? PRESENTATION_BEATS[beat] : null;
  const last = beat >= PRESENTATION_BEATS.length - 1;
  // Habla si la voz está encendida, ya hubo un toque y el servicio no ha fallado.
  const speaks = voiceOn && armed && !silent;

  /* El audio de la presentación se pide por adelantado. */
  useEffect(() => {
    prefetchOfficial(PRESENTATION_BEATS.map((b) => b.say), VOICE);
  }, []);

  /* El primer toque (o tecla) estrena el audio: desde ahí Pilo puede sonar. */
  useEffect(() => {
    if (armed) return;
    const arm = () => setArmed(true);
    // Al soltar, no al tocar: si el toque fue en «Siguiente», la frase que suena es ya la nueva.
    window.addEventListener("pointerup", arm, { once: true });
    window.addEventListener("keyup", arm, { once: true });
    return () => {
      window.removeEventListener("pointerup", arm);
      window.removeEventListener("keyup", arm);
    };
  }, [armed]);

  /* La entrada. */
  useLayoutEffect(() => {
    const root = stage.current!;
    const ctx = gsap.context(() => {
      if (stillMotion()) {
        gsap.from(root, { autoAlpha: 0, duration: 0.3 });
        gsap.delayedCall(0.4, () => setBeat((b) => (b < 0 ? 0 : b)));
        return;
      }
      intro.current = gsap
        .timeline()
        .from(".pw-glow", { scale: 0.4, autoAlpha: 0, duration: 1.2, ease: "power2.out" }, 0)
        .from(".pw-rings i", { scale: 0.6, autoAlpha: 0, duration: 1.1, stagger: 0.12, ease: "power3.out" }, 0.1)
        .from(holder.current, { y: 160, scale: 0.82, rotation: -10, autoAlpha: 0, duration: 0.95, ease: "back.out(1.5)" }, 0.3)
        .add(() => {
          pilo.current?.mood("sorpresa");
          pilo.current?.blink();
        }, 0.95)
        .add(() => pilo.current?.look(-0.9, -0.1), 1.2)
        .add(() => pilo.current?.look(0.9, -0.1), 1.6)
        .add(() => {
          pilo.current?.look(0, 0);
          pilo.current?.mood("feliz");
        }, 1.95)
        // Letra por letra. Sin desenfoque: al texto solo se le anima posición y opacidad.
        .from(".pw-title .ch", { y: 24, autoAlpha: 0, duration: 0.7, stagger: 0.028, ease: "power3.out" }, 1.1)
        .from(".pw-top > *", { autoAlpha: 0, y: -8, duration: 0.5, stagger: 0.06, ease: "power3.out" }, 1.3)
        .from([".pw-mood", ".pw-foot"], { autoAlpha: 0, y: 14, duration: 0.6, ease: "power3.out" }, 1.6)
        .add(() => setBeat((b) => (b < 0 ? 0 : b)), 2.1);
    }, root);
    return () => {
      // Interrumpida (o desmontada), todo vuelve a verse.
      ctx.revert();
      hold.current?.kill();
      stopOfficial();
    };
  }, []);

  /* Cada frase: palabra por palabra mientras Pilo habla, con su cara, su mirada y su muestra. */
  useLayoutEffect(() => {
    if (!current || leaving.current) return;
    const root = stage.current!;
    const b = current;
    const i = beat;
    const still = stillMotion();
    const words = root.querySelectorAll(".pw-bubble .wd");
    // Con voz las palabras llegan al paso del habla; sin ella, al de la lectura.
    const perWord = still ? 0 : speaks ? 0.22 : 0.075;
    let typed = false;
    let spoken = !speaks;
    let cancelled = false;
    const next = () => {
      if (cancelled || !typed || !spoken) return;
      pilo.current?.talk(false);
      // La última frase espera a quien presenta: «Conocer la capa profunda».
      if (i >= PRESENTATION_BEATS.length - 1) return;
      const seg = root.querySelectorAll(".pw-segs span i")[i];
      // La barra del segmento marca la pausa antes de la frase siguiente.
      hold.current = gsap.to(seg, { scaleX: 1, duration: 2.4, ease: "none", onComplete: () => setBeat(i + 1) });
    };

    pilo.current?.mood(b.face);
    pilo.current?.look(...b.look);
    pilo.current?.blink();
    if (i % 2 === 0) pilo.current?.nod();
    onFaceChange?.(b.canvasFace);
    if (speaks) {
      void sayOfficial(b.say, {
        ...VOICE,
        rate: modulateVoice(b.voiceMood, 1.02, 1.0).rate,
        // El pico se mueve con el audio de verdad: cuando empieza y hasta que calla.
        onSound: (on) => !cancelled && pilo.current?.talk(on),
      }).then((result) => {
        if (cancelled || result === "cancelado") return;
        // Sin audio no hay otra voz: la bienvenida sigue en texto.
        if (result === "sin voz") setSilent(true);
        spoken = true;
        next();
      });
    } else {
      pilo.current?.talk(true);
    }

    const ctx = gsap.context(() => {
      const segs = root.querySelectorAll(".pw-segs span i");
      gsap.set(segs, { scaleX: (k: number) => (k < i ? 1 : 0) });
      const tl = gsap.timeline();
      if (words.length) tl.fromTo(words, { autoAlpha: 0, y: still ? 0 : 8 }, { autoAlpha: 1, y: 0, duration: still ? 0.2 : 0.35, stagger: perWord, ease: "power3.out" }, 0);
      tl.add(() => {
        typed = true;
        if (!speaks) pilo.current?.talk(false);
        next();
      }, words.length * perWord + 0.3);
      const items = root.querySelectorAll(".pw-exhibit > *");
      if (items.length) {
        if (still) tl.fromTo(items, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0);
        else tl.fromTo(items, { autoAlpha: 0, y: 16, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.08, ease: "back.out(1.6)" }, 0.2);
      }
    }, root);

    return () => {
      cancelled = true;
      hold.current?.kill();
      hold.current = null;
      ctx.revert();
      stopOfficial();
      pilo.current?.talk(false);
    };
    // La cara del lienzo no cambia a media frase: mandan la frase y si suena.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, speaks]);

  /* La salida: Pilo vuela a la cabecera y el escenario se cierra sobre él. */
  const finish = () => {
    if (leaving.current) return;
    leaving.current = true;
    hold.current?.kill();
    stopOfficial();
    pilo.current?.talk(false);
    const root = stage.current;
    const slot = target.current;
    const fly = holder.current;
    if (!root || !fly) return onDone();
    // Si la entrada no había terminado, termina ya: Pilo vuela desde su sitio, entero y visible.
    intro.current?.progress(1);
    if (stillMotion() || !slot) {
      gsap.to(root, { autoAlpha: 0, duration: 0.3, onComplete: onDone });
      return;
    }
    const frame = root.getBoundingClientRect();
    const from = fly.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    const cx = to.left + to.width / 2 - frame.left;
    const cy = to.top + to.height / 2 - frame.top;
    const R = Math.hypot(frame.width, frame.height);
    gsap.killTweensOf([fly, root.querySelectorAll(".pw-center > *, .pw-top, .pw-foot, .pw-bubble .wd, .pw-segs span i")]);
    gsap.set(fly, { transformOrigin: "0 0" });
    gsap
      .timeline({ onComplete: onDone })
      .to(root.querySelectorAll(".pw-center > :not(.pw-slot), .pw-top, .pw-foot, .pw-rings"), { autoAlpha: 0, y: -8, duration: 0.25, ease: "power2.out" }, 0)
      .fromTo(root.querySelector(".pw-bg"), { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)`, duration: 0.75, ease: "power3.inOut" }, 0.12)
      .to(fly, { x: to.left - from.left, y: to.top - from.top, scale: to.width / from.width, rotation: 0, duration: 0.85, ease: "power3.inOut" }, 0.08);
  };

  const advance = () => {
    if (beat < 0) setBeat(0);
    else if (last) finish();
    else setBeat(beat + 1);
  };

  // Escape salta la bienvenida; el foco no sale de ella mientras está.
  useFocusTrap(stage, true, finish);

  /* Las flechas pasan de frase, como después pasan de fase. */
  const keys = useRef({ advance, back: () => {} });
  keys.current = {
    advance,
    back: () => {
      if (beat > 0) setBeat(beat - 1);
    },
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === " " && e.target instanceof HTMLElement && e.target.closest("button")) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        keys.current.advance();
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        keys.current.back();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shown = Math.min(beat < 0 ? 0 : beat, PRESENTATION_BEATS.length - 1) + 1;
  const moodLine = silent ? "La voz de Pilo no está disponible: lea a Pilo" : !voiceOn ? "Voz apagada" : !armed ? "Toque la pantalla para oír a Pilo" : (current?.moodLabel ?? "Voz oficial de Pilo");
  const voiceLabel = silent ? "La voz de Pilo no está disponible ahora" : voiceOn ? "Voz de Pilo activada. Apagar" : "Voz de Pilo apagada. Activar";

  return (
    <div className="pw" ref={stage} role="dialog" aria-modal="true" aria-label="Bienvenida de Mr. Pilo" tabIndex={-1}>
      <div className="pw-bg">
        <div className="pw-glow" />
        <div className="pw-rings" aria-hidden="true">
          <i style={{ width: 250, height: 250 }} />
          <i style={{ width: 400, height: 400 }} />
          <i style={{ width: 570, height: 570 }} />
        </div>
      </div>

      <header className="pw-top">
        <div className="cpp-brand">
          <b>Mr. Pilo</b>
          <span>Universidad de Santander · Planeación Institucional</span>
        </div>
        <button
          type="button"
          className="cpp-ghost"
          aria-pressed={!silent && voiceOn}
          aria-disabled={silent || undefined}
          aria-label={voiceLabel}
          title={voiceLabel}
          onClick={() => {
            if (silent) return;
            if (voiceOn) stopOfficial();
            setVoiceOn(!voiceOn);
          }}
        >
          <VoiceIcon on={!silent && voiceOn} />
        </button>
        <button type="button" className="cpp-ghost" onClick={finish}>
          Saltar
        </button>
      </header>

      <div className="pw-center">
        <div className="pw-slot">
          <div className="pw-fly" ref={holder}>
            <Pilo ref={pilo} size="100%" alive label="Mr. Pilo" />
          </div>
        </div>
        <h1 className="pw-title" aria-label={WELCOME_TITLE}>
          {WELCOME_TITLE.split(" ").map((word, i) => (
            <span key={i} className="w" aria-hidden="true">
              {[...word].map((c, j) => (
                <span key={j} className="ch">
                  {c}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <span className="pw-mood">
          <i aria-hidden="true" />
          <span>{moodLine}</span>
        </span>
        {/* Lo que se ve aparece palabra por palabra; lo que se anuncia, la frase entera de una vez. */}
        <p className="pw-sr" aria-live="polite">
          {current?.say}
        </p>
        <p className="pw-bubble" aria-hidden="true">
          {current?.say.split(" ").map((w, i) => (
            <span key={`${current.id}:${i}`} className="wd">
              {w}{" "}
            </span>
          ))}
        </p>
        <div className="pw-exhibit">
          {current?.chips.map((chip) => (
            <span key={`${current.id}:${chip}`} className="pw-know">
              {chip}
            </span>
          ))}
        </div>
      </div>

      <footer className="pw-foot">
        <div className="pw-segs">
          {PRESENTATION_BEATS.map((b) => (
            <span key={b.id} aria-hidden="true">
              <i />
            </span>
          ))}
          <small aria-label={`Parte ${shown} de ${PRESENTATION_BEATS.length}`}>
            {shown} de {PRESENTATION_BEATS.length}
          </small>
        </div>
        <button type="button" className="pw-next" onClick={advance}>
          {last ? "Conocer la capa profunda" : "Siguiente"}
        </button>
      </footer>
    </div>
  );
}
