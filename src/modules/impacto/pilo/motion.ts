/* =============================================================================
   Mr. Pilo Bot · el movimiento, con GSAP.

   Un solo momento con puesta en escena y todo lo demás al servicio de la
   lectura (criterios de Emil Kowalski):

     Abrir        el círculo crece desde el botón (520 ms, salida fuerte);
                  luego la mascota (escala 0.92 → 1), la voz y el contenido
                  en cascada de 40 ms. Nada entra desde escala 0.
     Cerrar       el círculo vuelve al botón en 260 ms: salir es más rápido
                  que entrar.
     Paso         200 ms de fundido con 12 px hacia donde se avanza y 2 px de
                  desenfoque que disimula el cruce.
     Voz          180 ms: opacidad, 4 px y un desenfoque leve.
     Pulso        un eslabón que se llena late una vez (250 ms). Nada en bucle.

   Con movimiento reducido solo quedan fundidos cortos. Toda animación se
   limpia al desmontar (gsap.context) y una nueva mata a la anterior: se
   puede interrumpir sin saltos.
   ========================================================================== */

import gsap from "gsap";

/** Salida fuerte, como --ease-out del sistema: cubic-bezier(0.23, 1, 0.32, 1). */
export const EASE_OUT = "expo.out";
/** Movimiento en pantalla. */
export const EASE_IN_OUT = "power3.inOut";

export const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const circle = (radius: string, x: string, y: string) => `circle(${radius} at ${x} ${y})`;

/** La entrada de la escena. Devuelve el timeline para poder matarlo. */
export function playEntrance(scene: HTMLElement, origin: { x: string; y: string }) {
  if (reducedMotion()) {
    return gsap.fromTo(scene, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none" });
  }
  const tl = gsap.timeline({ defaults: { ease: EASE_OUT } });
  tl.fromTo(scene, { clipPath: circle("0px", origin.x, origin.y) }, { clipPath: circle("150vmax", origin.x, origin.y), duration: 0.52 });
  const avatar = scene.querySelector(".pilo__avatar");
  if (avatar) tl.fromTo(avatar, { opacity: 0, scale: 0.92, y: 8 }, { opacity: 1, scale: 1, y: 0, duration: 0.42 }, 0.16);
  const speech = scene.querySelectorAll(".pilo__intro h1, .pilo__speech");
  tl.fromTo(speech, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.32, stagger: 0.05 }, 0.24);
  const items = scene.querySelectorAll("[data-anim]");
  if (items.length) tl.fromTo(items, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.04, clearProps: "transform" }, 0.3);
  return tl;
}

/** La salida: vuelve al botón. Resuelve cuando termina. */
export function playExit(scene: HTMLElement, origin: { x: string; y: string }): Promise<void> {
  return new Promise((resolve) => {
    gsap.killTweensOf(scene);
    if (reducedMotion()) {
      gsap.to(scene, { opacity: 0, duration: 0.12, ease: "none", onComplete: resolve });
      return;
    }
    gsap.to(scene, { clipPath: circle("0px", origin.x, origin.y), duration: 0.26, ease: EASE_IN_OUT, onComplete: resolve });
  });
}

/** El contenido de un paso nuevo entra desde el lado hacia el que se avanza. */
export function playStep(panel: HTMLElement, direction: 1 | -1) {
  const items = panel.querySelectorAll("[data-anim]");
  if (!items.length) return;
  if (reducedMotion()) {
    gsap.fromTo(items, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none" });
    return;
  }
  gsap.fromTo(
    items,
    { opacity: 0, x: 12 * direction },
    { opacity: 1, x: 0, duration: 0.2, stagger: 0.03, ease: EASE_OUT, overwrite: "auto", clearProps: "transform,filter,opacity" },
  );
}

/** La voz de Mr. Pilo cambia. */
export function playSpeech(node: HTMLElement) {
  if (reducedMotion()) {
    gsap.fromTo(node, { opacity: 0.4 }, { opacity: 1, duration: 0.15, ease: "none" });
    return;
  }
  gsap.fromTo(node, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.18, ease: EASE_OUT, overwrite: "auto", clearProps: "transform,filter,opacity" });
}

/** Un eslabón que se acaba de llenar late una vez. */
export function playPulse(node: Element) {
  if (reducedMotion()) return;
  gsap.fromTo(node, { scale: 1 }, { scale: 1.08, duration: 0.12, ease: EASE_OUT, yoyo: true, repeat: 1, clearProps: "transform" });
}
