/* =============================================================================
   Mr. Pilo · la cara oficial, animada sin deformarla.

   Todo sale de las imágenes aprobadas por la universidad (public/pilo-moods),
   preparadas por scripts/pilo-face.py en public/pilo-face. Nada se redibuja ni
   se estira:

     El pico    tres cuadros completos (abierto, cerrado, lengua). Se muestra
                uno a la vez: apilados, el abierto asomaría detrás del cerrado.
                Al hablar alterna cerrado y abierto, en seco: son fotogramas.
     Los ojos   dos parches encima (ojos cerrados y guiño). El parpadeo es el
                parche de ojos cerrados durante 110 ms.
     La mirada  las pupilas, sueltas, se desplazan un par de píxeles sobre el
                blanco del ojo y siguen el puntero.
     El cuerpo  solo se mueve entero: respira (menos del 1 % de su alto y de un
                grado) y da un pulso al cambiar de expresión.

   Pensar, graduado y obra son poses de una sola imagen aprobada: respiran, pero
   no hablan, no parpadean ni miran, porque no hay otro dibujo suyo que usar.

   Con movimiento reducido no hay respiración, mirada ni pulso: quedan los
   cambios de cuadro, que son estado y no adorno.

   Quien la usa puede ponerle algo ENCIMA (`gear`): un dibujo aparte, en las
   medidas de la cara (450 × 631), que se mueve con ella. El dibujo aprobado no
   cambia; así se visten los modos secretos de Pregúntele a Pilo.

   PiloAvatar, PiloMoji y PiloSvgMoji son esta cara con los gestos de cada uno.
   ========================================================================== */

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import gsap from "gsap";
import "./pilo-face.css";

export type PiloExpression = "neutral" | "feliz" | "atrevido" | "emocionado" | "loco" | "pensar" | "graduado" | "obra";

export const PILO_EXPRESSIONS: PiloExpression[] = ["neutral", "feliz", "atrevido", "emocionado", "loco", "pensar", "graduado", "obra"];

export interface PiloFaceHandle {
  /** Mira hacia nx, ny (−1 a 1). */
  look: (nx: number, ny: number) => void;
  talk: (on: boolean) => void;
  expression: (e: PiloExpression) => void;
  blink: () => void;
  /** Un asentimiento corto. */
  nod: () => void;
  /** El elemento, para medirlo o moverlo. */
  el: () => HTMLDivElement | null;
}

interface Look {
  closed?: boolean;
  tongue?: boolean;
  wink?: boolean;
  eyes?: boolean;
  /** Pose de una sola imagen. */
  pose?: string;
}

/* Cada expresión es una combinación de capas aprobadas, o una pose. */
const LOOKS: Record<PiloExpression, Look> = {
  neutral: { closed: true },
  feliz: {},
  atrevido: { wink: true },
  emocionado: { eyes: true },
  loco: { wink: true, tongue: true },
  pensar: { pose: "pensar" },
  graduado: { pose: "graduado" },
  obra: { pose: "obra" },
};

const FRAME = (name: string) => `/pilo-face/${name}.png`;
const PARTS = ["open", "closed", "tongue", "plate", "pupils", "eyes", "wink"];

/** Cuánto se desplaza la mirada, en % del ancho y del alto del dibujo (unos 3 y 2 px de 450 × 631). */
const GAZE_X = 0.7;
const GAZE_Y = 0.32;
/** Dónde quedan los ojos dentro del dibujo, para saber hacia dónde mirar. */
const EYES_AT = { x: 0.36, y: 0.36 };

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

/** Descarga los cuadros antes de que hagan falta: el primer cambio no parpadea. */
let preloaded = false;
export function preloadPiloFace() {
  if (preloaded || typeof window === "undefined") return;
  preloaded = true;
  for (const name of PARTS) new Image().src = FRAME(name);
}

export const PiloFace = forwardRef<
  PiloFaceHandle,
  {
    size?: number | string;
    expression?: PiloExpression;
    talking?: boolean;
    /** Respira suave y parpadea. */
    alive?: boolean;
    /** Sigue el puntero con la mirada. */
    track?: boolean;
    /** Mira alrededor sola cuando nadie mueve el puntero. */
    idle?: boolean;
    label?: string;
    className?: string;
    /** Algo que va encima de la cara y se mueve con ella (un SVG de 450 × 631). No se ve en las poses de una sola imagen. */
    gear?: ReactNode;
  }
>(function PiloFace({ size = 96, expression = "feliz", talking = false, alive = false, track = false, idle = false, label, className, gear }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const api = useRef<(PiloFaceHandle & { breathe: (on: boolean) => void }) | null>(null);
  const props = useRef({ expression, talking, alive });
  props.current = { expression, talking, alive };

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    preloadPiloFace();
    const q = <T extends HTMLElement>(part: string) => node.querySelector<T>(`[data-part="${part}"]`);
    const rig = q<HTMLDivElement>("rig");
    const pose = q<HTMLImageElement>("pose");
    const pupils = q<HTMLImageElement>("pupils");
    const layer = { open: q("open"), closed: q("closed"), tongue: q("tongue"), eyes: q("eyes"), wink: q("wink"), gaze: q("gaze") };
    if (!rig || !pose || !pupils) return;

    const still = reduced();
    let current: PiloExpression = props.current.expression;
    let speaking = false;
    let mouthOpen = true;
    let blinkCall: gsap.core.Tween | null = null;
    let talkCall: gsap.core.Tween | null = null;
    let glanceCall: gsap.core.Tween | null = null;
    let breath: gsap.core.Tween[] = [];
    let lastPointer = 0;
    const show = (el: Element | null, on: boolean) => el && gsap.set(el, { opacity: on ? 1 : 0 });

    /** Pinta las capas según la expresión y la boca. En seco: son fotogramas, no fundidos. */
    const paint = () => {
      const look = LOOKS[current];
      const posed = Boolean(look.pose);
      const mouth = speaking ? (mouthOpen ? "open" : "closed") : look.closed ? "closed" : look.tongue ? "tongue" : "open";
      show(layer.open, !posed && mouth === "open");
      show(layer.closed, !posed && mouth === "closed");
      show(layer.tongue, !posed && mouth === "tongue");
      show(layer.wink, !posed && Boolean(look.wink));
      show(layer.eyes, !posed && Boolean(look.eyes));
      show(layer.gaze, !posed);
    };

    const blink = (times = 1) => {
      const look = LOOKS[current];
      if (look.pose || look.eyes || !layer.eyes) return;
      const tl = gsap.timeline();
      for (let i = 0; i < times; i++) tl.set(layer.eyes, { opacity: 1 }, i * 0.24).set(layer.eyes, { opacity: 0 }, i * 0.24 + 0.11);
    };
    const scheduleBlink = () => {
      blinkCall?.kill();
      blinkCall = gsap.delayedCall(2.4 + Math.random() * 3.2, () => {
        blink(Math.random() < 0.18 ? 2 : 1);
        scheduleBlink();
      });
    };

    // La mirada: un desplazamiento corto y con inercia, no un salto.
    const gazeX = gsap.quickTo(pupils, "xPercent", { duration: 0.28, ease: "power3.out" });
    const gazeY = gsap.quickTo(pupils, "yPercent", { duration: 0.28, ease: "power3.out" });
    const look = (nx: number, ny: number) => {
      if (still) return;
      const clamp = (v: number) => Math.max(-1, Math.min(1, v));
      gazeX(clamp(nx) * GAZE_X);
      gazeY(clamp(ny) * GAZE_Y);
    };
    const onPointer = (event: PointerEvent) => {
      const box = rig.getBoundingClientRect();
      if (!box.width) return;
      lastPointer = Date.now();
      const reach = Math.max(box.width, 160) * 2.2;
      look((event.clientX - (box.left + box.width * EYES_AT.x)) / reach, (event.clientY - (box.top + box.height * EYES_AT.y)) / reach);
    };
    const glance = () => {
      glanceCall = gsap.delayedCall(2.6 + Math.random() * 3.4, () => {
        // Si alguien mueve el puntero, manda el puntero.
        if (Date.now() - lastPointer > 2000) Math.random() < 0.35 ? look(0, 0) : look(Math.random() * 2 - 1, Math.random() * 1.2 - 0.6);
        glance();
      });
    };

    // La voz: sílabas de pico abierto y cerrado, con una pausa cada tanto.
    const syllable = (left: number) => {
      mouthOpen = true;
      paint();
      talkCall = gsap.delayedCall(0.09 + Math.random() * 0.07, () => {
        mouthOpen = false;
        paint();
        const pause = left <= 0;
        talkCall = gsap.delayedCall(pause ? 0.2 + Math.random() * 0.16 : 0.06 + Math.random() * 0.05, () => syllable(pause ? 3 + Math.floor(Math.random() * 6) : left - 1));
      });
    };
    const talk = (on: boolean) => {
      talkCall?.kill();
      talkCall = null;
      speaking = on && !LOOKS[current].pose;
      if (speaking) syllable(3 + Math.floor(Math.random() * 6));
      else paint();
    };

    const setExpression = (next: PiloExpression) => {
      const wasPose = Boolean(LOOKS[current].pose);
      const look = LOOKS[next];
      const changed = next !== current;
      current = next;
      if (look.pose) {
        talkCall?.kill();
        talkCall = null;
        speaking = false;
        pose.src = FRAME(look.pose);
      }
      if (look.pose || wasPose) {
        // Cambio de pose: fundido corto con un asomo de escala. Lo que sale se va más rápido.
        gsap.killTweensOf([pose, rig], "opacity,scale");
        const [enter, leave] = look.pose ? [pose, rig] : [rig, pose];
        gsap.to(leave, { opacity: 0, duration: still ? 0 : 0.12, ease: "power2.out" });
        gsap.fromTo(enter, { opacity: 0, scale: still ? 1 : 0.96 }, { opacity: 1, scale: 1, duration: still ? 0 : 0.18, ease: "power3.out" });
      } else if (changed && !still) {
        // Misma pose, otra cara: un pulso de toda la figura confirma el cambio.
        gsap.fromTo(rig, { scale: 0.975 }, { scale: 1, duration: 0.22, ease: "power3.out" });
      }
      paint();
    };

    const breathe = (on: boolean) => {
      breath.forEach((t) => t.kill());
      breath = [];
      blinkCall?.kill();
      gsap.to([rig, pose], { yPercent: 0, rotation: 0, duration: 0.2, ease: "power2.out" });
      if (!on) return;
      scheduleBlink();
      if (still) return;
      breath = [
        gsap.to([rig, pose], { yPercent: -0.9, duration: 2.3, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 0.2 }),
        gsap.to([rig, pose], { rotation: 0.9, duration: 4.6, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 0.2 }),
      ];
    };

    const nod = () => {
      if (still) return;
      gsap.fromTo([rig, pose], { y: 0 }, { y: "4%", duration: 0.12, ease: "power2.out", yoyo: true, repeat: 1 });
    };

    gsap.set(pose, { opacity: 0 });
    setExpression(current);
    talk(props.current.talking);
    breathe(props.current.alive);
    if (track && !still && finePointer()) window.addEventListener("pointermove", onPointer, { passive: true });
    if (idle && !still) glance();

    api.current = { look, talk, expression: setExpression, blink: () => blink(1), nod, el: () => root.current, breathe };
    return () => {
      window.removeEventListener("pointermove", onPointer);
      blinkCall?.kill();
      talkCall?.kill();
      glanceCall?.kill();
      breath.forEach((t) => t.kill());
      gsap.killTweensOf([rig, pose, pupils, ...Object.values(layer)]);
      api.current = null;
    };
  }, [track, idle]);

  useImperativeHandle(ref, () => ({
    look: (nx, ny) => api.current?.look(nx, ny),
    talk: (on) => api.current?.talk(on),
    expression: (e) => api.current?.expression(e),
    blink: () => api.current?.blink(),
    nod: () => api.current?.nod(),
    el: () => root.current,
  }));

  useEffect(() => {
    api.current?.expression(expression);
  }, [expression]);

  useEffect(() => {
    api.current?.talk(talking);
  }, [talking]);

  useEffect(() => {
    api.current?.breathe(alive);
  }, [alive]);

  const img = (part: string, hidden = true) => <img data-part={part} src={FRAME(part)} alt="" draggable={false} decoding="async" style={hidden ? { opacity: 0 } : undefined} />;

  return (
    <div
      ref={root}
      className={className ? `pilo-face ${className}` : "pilo-face"}
      style={{ width: size, height: size }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <div className="pilo-face__rig" data-part="rig">
        {img("open", false)}
        {img("closed")}
        {img("tongue")}
        <div className="pilo-face__gaze" data-part="gaze">
          <img src={FRAME("plate")} alt="" draggable={false} decoding="async" />
          <div className="pilo-face__white">
            <img data-part="pupils" src={FRAME("pupils")} alt="" draggable={false} decoding="async" />
          </div>
        </div>
        {img("eyes")}
        {img("wink")}
        {gear}
      </div>
      <img className="pilo-face__pose" data-part="pose" alt="" draggable={false} decoding="async" style={{ opacity: 0 }} />
    </div>
  );
});
