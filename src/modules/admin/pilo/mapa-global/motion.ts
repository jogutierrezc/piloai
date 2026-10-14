/* =============================================================================
   Mr. Pilo · el mapa global: el movimiento, con GSAP.

   Las curvas se trazan con `drawChain` (../motion). Aquí va lo propio:

     Puentes    al llegar el mapa, los puentes entre los dos Pilos aparecen con
                un fundido de 240 ms, después del trazo.
     Vecinos    al tocar un punto con el puntero, los glifos de sus vecinos
                crecen de 0.6 a 1 en 200 ms, en cascada corta.

   Solo transform y opacidad, con salida fuerte. Los rótulos nunca se animan:
   si algo se interrumpe, el texto ya está en su sitio. Con movimiento reducido
   no se mueve nada.
   ========================================================================== */

import gsap from "gsap";
import { EASE_OUT, reducedMotion } from "../../../impacto/pilo/motion";

export function showBridges(bridges: Element[]) {
  if (!bridges.length) return;
  gsap.killTweensOf(bridges);
  gsap.set(bridges, { clearProps: "opacity" });
  if (reducedMotion()) return;
  gsap.fromTo(bridges, { opacity: 0 }, { opacity: 1, duration: 0.24, delay: 0.2, ease: EASE_OUT, clearProps: "opacity" });
}

export function lightNeighbors(glyphs: Element[]) {
  if (!glyphs.length) return;
  gsap.killTweensOf(glyphs);
  gsap.set(glyphs, { clearProps: "transform" });
  if (reducedMotion() || glyphs.length > 80) return;
  gsap.fromTo(
    glyphs,
    { scale: 0.6, transformOrigin: "50% 50%" },
    { scale: 1, duration: 0.2, ease: EASE_OUT, stagger: Math.min(0.012, 0.12 / glyphs.length), clearProps: "transform" },
  );
}
