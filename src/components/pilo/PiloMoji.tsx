/* =============================================================================
   Mr. Pilo · el Pilo que mira, habla y reacciona.

   Es la cara oficial (PiloFace: las imágenes aprobadas por la universidad).
   Antes era un dibujo hecho a mano en SVG; se conserva su forma de pedirlo
   —gestos, mirada, voz— para quien ya lo usa (el chat emergente de otros
   portales):

     feliz      →  feliz          atento   →  neutral
     piensa     →  pensar         sorpresa →  emocionado
     duda       →  neutral        cuidado  →  neutral
   ========================================================================== */

import { forwardRef, useImperativeHandle, useRef } from "react";
import { PiloFace } from "./PiloFace";
import type { PiloExpression, PiloFaceHandle } from "./PiloFace";

export type MojiMood = "feliz" | "atento" | "piensa" | "sorpresa" | "duda" | "cuidado";

export interface PiloMojiHandle {
  /** Mira hacia nx, ny (−1 a 1). */
  look: (nx: number, ny: number) => void;
  talk: (on: boolean) => void;
  mood: (m: MojiMood) => void;
  blink: () => void;
  /** Un asentimiento corto. */
  nod: () => void;
  /** El elemento, para medirlo o moverlo. */
  el: () => HTMLDivElement | null;
}

export const MOJI_EXPRESSION: Record<MojiMood, PiloExpression> = {
  feliz: "feliz",
  atento: "neutral",
  piensa: "pensar",
  sorpresa: "emocionado",
  duda: "neutral",
  cuidado: "neutral",
};

export const PiloMoji = forwardRef<
  PiloMojiHandle,
  {
    size?: number | string;
    /** Sigue el puntero con la mirada. */
    track?: boolean;
    /** Mira alrededor sola cuando nadie mueve el puntero. */
    idle?: boolean;
    /** Respira suave. */
    alive?: boolean;
    mood?: MojiMood;
    talking?: boolean;
    label?: string;
    className?: string;
  }
>(function PiloMoji({ mood = "feliz", className, ...rest }, ref) {
  const inner = useRef<PiloFaceHandle>(null);
  useImperativeHandle(ref, () => ({
    look: (nx, ny) => inner.current?.look(nx, ny),
    talk: (on) => inner.current?.talk(on),
    mood: (m) => inner.current?.expression(MOJI_EXPRESSION[m]),
    blink: () => inner.current?.blink(),
    nod: () => inner.current?.nod(),
    el: () => inner.current?.el() ?? null,
  }));
  return <PiloFace ref={inner} expression={MOJI_EXPRESSION[mood]} className={className ? `pilo-moji ${className}` : "pilo-moji"} {...rest} />;
});
