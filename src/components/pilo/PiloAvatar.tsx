/* =============================================================================
   Mr. Pilo · la cara, con un gesto para cada momento.

   Es la cara oficial (PiloFace: las imágenes aprobadas por la universidad).
   Los ocho momentos de siempre se dicen con las expresiones que hay aprobadas:

     feliz      saludar                     →  feliz
     bien       algo quedó correcto         →  atrevido (guiño)
     idea       proponer algo               →  graduado
     excelente  terminar                    →  emocionado
     piensa     analizar, cargar            →  pensar
     piensa2    esperar una decisión        →  pensar
     duda       falta elegir algo           →  neutral
     cuidado    un hueco o una alerta       →  neutral

   No hay un dibujo aprobado de duda ni de alerta: ambos usan el neutral, y el
   texto que acompaña a Pilo es el que avisa. Con `alive` respira y parpadea.

   Lo usan Mr. Pilo en Impacto, el lanzador de la intranet y los recorridos
   de todos los portales.
   ========================================================================== */

import { PiloFace, preloadPiloFace } from "./PiloFace";
import type { PiloExpression } from "./PiloFace";

export type PiloMood = "feliz" | "bien" | "idea" | "excelente" | "piensa" | "piensa2" | "duda" | "cuidado";

export const PILO_MOODS: PiloMood[] = ["feliz", "bien", "idea", "excelente", "piensa", "piensa2", "duda", "cuidado"];

export const EXPRESSION_OF: Record<PiloMood, PiloExpression> = {
  feliz: "feliz",
  bien: "atrevido",
  idea: "graduado",
  excelente: "emocionado",
  piensa: "pensar",
  piensa2: "pensar",
  duda: "neutral",
  cuidado: "neutral",
};

/** Precarga los cuadros para que el primer cambio no parpadee. */
export const preloadPiloMoods = preloadPiloFace;

export function PiloAvatar({
  mood = "feliz",
  size = 64,
  alive = false,
  className,
  label,
}: {
  mood?: PiloMood;
  size?: number;
  /** Respira suave y parpadea mientras está en escena. */
  alive?: boolean;
  className?: string;
  /** Texto alternativo; sin él la imagen es decorativa. */
  label?: string;
}) {
  return <PiloFace expression={EXPRESSION_OF[mood]} size={size} alive={alive} label={label} className={className ? `pilo-avatar ${className}` : "pilo-avatar"} />;
}
