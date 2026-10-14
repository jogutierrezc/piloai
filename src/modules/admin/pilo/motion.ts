/* =============================================================================
   Intranet · Mr. Pilo con IA · el movimiento, con GSAP.

   Pocas cosas se mueven, y cada una dice algo (criterios de Emil Kowalski):

     Sección      al cambiar de pestaña con el puntero, el contenido entra en
                  200 ms: fundido, 6 px hacia arriba y 2 px de desenfoque que
                  disimula el cruce. Con el teclado no se mueve nada: quien
                  recorre las pestañas con las flechas no espera a nadie.
     Panel        el panel del nodo cambia de contenido en 180 ms (8 px desde
                  la derecha). En pantallas estrechas es un cajón: entra en
                  300 ms con la curva de cajón y sale en 200 ms.
     Cadena       al elegir un nodo, sus relaciones se dibujan de la raíz hacia
                  el nodo y de ahí hacia abajo (320 ms, cascada de 12 ms por
                  relación, con tope); el resto se apaga por CSS.
     Resultado    los resultados de «Actualizar la memoria» entran uno tras
                  otro (40 ms), una sola vez por actualización.

   Con movimiento reducido solo quedan fundidos cortos y la cadena aparece
   dibujada. Cada llamada mata la anterior sobre los mismos elementos: se
   puede interrumpir sin saltos.
   ========================================================================== */

import gsap from "gsap";
import { EASE_OUT, EASE_IN_OUT, reducedMotion } from "../../impacto/pilo/motion";

/** La curva de cajón del sistema (--ease-drawer, cubic-bezier(0.32, 0.72, 0, 1)).
    GSAP solo lee curvas CSS con CustomEase; power4.out es de la misma familia. */
const drawer = "power4.out";

export function revealSection(panel: HTMLElement | null) {
  if (!panel) return;
  gsap.killTweensOf(panel);
  if (reducedMotion()) {
    gsap.fromTo(panel, { opacity: 0.4 }, { opacity: 1, duration: 0.12, ease: "none", clearProps: "opacity" });
    return;
  }
  gsap.fromTo(
    panel,
    { opacity: 0, y: 6, filter: "blur(2px)" },
    { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.2, ease: EASE_OUT, clearProps: "transform,filter,opacity" },
  );
}

/** El contenido del panel del nodo cambia. */
export function swapPanel(body: HTMLElement | null) {
  if (!body) return;
  gsap.killTweensOf(body);
  if (reducedMotion()) {
    gsap.fromTo(body, { opacity: 0.3 }, { opacity: 1, duration: 0.12, ease: "none", clearProps: "opacity" });
    return;
  }
  gsap.fromTo(body, { opacity: 0, x: 8 }, { opacity: 1, x: 0, duration: 0.18, ease: EASE_OUT, clearProps: "transform,opacity" });
}

/** El cajón del panel (pantallas estrechas). */
export function drawerIn(panel: HTMLElement | null) {
  if (!panel) return;
  gsap.killTweensOf(panel);
  if (reducedMotion()) {
    gsap.fromTo(panel, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", clearProps: "opacity" });
    return;
  }
  gsap.fromTo(panel, { xPercent: 100 }, { xPercent: 0, duration: 0.3, ease: drawer, clearProps: "transform" });
}

export function drawerOut(panel: HTMLElement | null): Promise<void> {
  return new Promise((resolve) => {
    if (!panel) return resolve();
    gsap.killTweensOf(panel);
    if (reducedMotion()) {
      gsap.to(panel, { opacity: 0, duration: 0.12, ease: "none", onComplete: () => resolve() });
      return;
    }
    gsap.to(panel, { xPercent: 100, duration: 0.2, ease: EASE_IN_OUT, onComplete: () => resolve() });
  });
}

/**
 * La cadena del nodo elegido se dibuja. Las curvas llevan pathLength="1", así
 * el trazo se anima de 1 a 0 sin medir nada. `order` las trae de la raíz al nodo.
 */
export function drawChain(paths: SVGPathElement[]) {
  gsap.killTweensOf(paths);
  if (!paths.length || reducedMotion()) {
    gsap.set(paths, { clearProps: "strokeDasharray,strokeDashoffset" });
    return;
  }
  const each = Math.min(0.012, 0.24 / paths.length);
  gsap.fromTo(
    paths,
    { strokeDasharray: 1, strokeDashoffset: 1 },
    { strokeDashoffset: 0, duration: 0.32, ease: EASE_IN_OUT, stagger: each, clearProps: "strokeDasharray,strokeDashoffset" },
  );
}

/** Los resultados de una actualización de la memoria entran uno tras otro. */
export function revealList(items: Element[]) {
  if (!items.length) return;
  gsap.killTweensOf(items);
  if (reducedMotion()) {
    gsap.fromTo(items, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", clearProps: "opacity" });
    return;
  }
  gsap.fromTo(items, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.04, ease: EASE_OUT, clearProps: "transform,opacity" });
}
