/* =============================================================================
   Mr. Pilo · las cuatro emociones del catálogo.

   Es la cara oficial (PiloFace: las imágenes aprobadas por la universidad).
   Antes animaba cuatro SVG por capas y, al hablar, escalaba la mandíbula; eso
   deformaba el dibujo. Se conserva su forma de pedirlo para el chat de Impacto
   y para Pregúntele a Pilo, cuyas emociones (atrevido, emocionado, loco,
   pensar) son las que guarda el catálogo.
   ========================================================================== */

import { forwardRef, useImperativeHandle, useRef } from "react";
import { PiloFace } from "./PiloFace";
import type { PiloFaceHandle } from "./PiloFace";

export type PiloSvgMood = "atrevido" | "emocionado" | "loco" | "pensar";

export const PILO_SVG_MOODS: PiloSvgMood[] = ["atrevido", "emocionado", "loco", "pensar"];

export interface PiloSvgMojiHandle {
  /** Mira hacia nx, ny (−1 a 1). */
  look: (nx: number, ny: number) => void;
  talk: (on: boolean) => void;
  mood: (m: PiloSvgMood) => void;
  blink: () => void;
  /** Un asentimiento corto. */
  nod: () => void;
  /** El elemento, para medirlo o moverlo. */
  el: () => HTMLDivElement | null;
}

export const PiloSvgMoji = forwardRef<
  PiloSvgMojiHandle,
  {
    size?: number | string;
    /** Sigue el puntero con la mirada. */
    track?: boolean;
    /** Mira alrededor sola cuando nadie mueve el puntero. */
    idle?: boolean;
    /** Respira suave. */
    alive?: boolean;
    mood?: PiloSvgMood;
    talking?: boolean;
    label?: string;
    className?: string;
  }
>(function PiloSvgMoji({ mood = "emocionado", className, ...rest }, ref) {
  const inner = useRef<PiloFaceHandle>(null);
  useImperativeHandle(ref, () => ({
    look: (nx, ny) => inner.current?.look(nx, ny),
    talk: (on) => inner.current?.talk(on),
    mood: (m) => inner.current?.expression(m),
    blink: () => inner.current?.blink(),
    nod: () => inner.current?.nod(),
    el: () => inner.current?.el() ?? null,
  }));
  return <PiloFace ref={inner} expression={mood} className={className ? `pilo-svg-moji ${className}` : "pilo-svg-moji"} {...rest} />;
});
