/* =============================================================================
   Mr. Pilo en Enseñanza · el movimiento, con GSAP.

   La misma regla de «Mr. Pilo con IA»: pocas cosas se mueven y cada una dice
   algo. Lo que se suma aquí:

     Pestaña      la de siempre (revealSection): 200 ms, solo con el puntero.
     Guardado     al guardar, la marca del pie confirma con un pulso de 220 ms
                  (0.94 → 1, nunca desde 0) y Pilo asiente. Es la única
                  respuesta a «¿quedó guardado?»; se ve una vez por guardado.
     Lista        lo que llega de la base entra una vez, fila por fila (40 ms de
                  cascada, con tope de 240 ms en total): la bandeja, las
                  respuestas guardadas, los pedidos de la bitácora al cambiar el
                  filtro, los resultados de una prueba.
     Medidor      la barra de uso crece desde cero hasta su valor en 280 ms:
                  dice que el número acaba de llegar, no que siempre estuvo.
     Pensando     mientras Pilo indexa o busca en su memoria: tres puntos en
                  ola (bucle que vive solo mientras dura la espera) y, si se
                  conoce el avance, una barra que lo sigue. Es el único bucle
                  del módulo y se mata al terminar.
     Panel        el panel de Pilo entra una vez, por partes (enterList); su
                  cara cambia de pose con el fundido propio de PiloFace, su
                  frase con un fundido de 180 ms y su barra sigue el avance.
     Fila         una fila plegable que se abre con el puntero muestra su
                  contenido con un fundido de 180 ms (enterBlock); con el
                  teclado se abre en seco. Igual los momentos de la Memoria.

   Solo transform y opacity. Con movimiento reducido quedan fundidos cortos,
   las barras aparecen en su valor y los puntos se quedan quietos. Cada llamada
   mata la anterior sobre los mismos elementos: se puede interrumpir sin saltos.
   ========================================================================== */

import gsap from "gsap";
import { EASE_OUT, reducedMotion } from "../../impacto/pilo/motion";

export { revealSection } from "../pilo/motion";

/** La marca del pie confirma el guardado. */
export function confirmSave(mark: Element | null) {
  if (!mark) return;
  gsap.killTweensOf(mark);
  if (reducedMotion()) {
    gsap.fromTo(mark, { opacity: 0.4 }, { opacity: 1, duration: 0.15, ease: "none", clearProps: "opacity" });
    return;
  }
  gsap.fromTo(mark, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.22, ease: EASE_OUT, clearProps: "transform,opacity" });
}

/** Una lista que acaba de llegar entra una vez. La cascada completa nunca pasa de 240 ms. */
export function enterList(items: Element[]) {
  if (!items.length) return;
  gsap.killTweensOf(items);
  if (reducedMotion()) {
    gsap.fromTo(items, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", clearProps: "opacity" });
    return;
  }
  const each = Math.min(0.04, 0.24 / items.length);
  gsap.fromTo(items, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.22, stagger: each, ease: EASE_OUT, clearProps: "transform,opacity" });
}

/** Un bloque que aparece (un aviso, un resultado): fundido corto con 4 px. */
export function enterBlock(node: Element | null) {
  if (!node) return;
  gsap.killTweensOf(node);
  if (reducedMotion()) {
    gsap.fromTo(node, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", clearProps: "opacity" });
    return;
  }
  gsap.fromTo(node, { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: 0.18, ease: EASE_OUT, clearProps: "transform,opacity" });
}

/** La barra de un medidor va a su valor (0 a 1). `from` = desde dónde: 0 la primera vez. */
export function fillBar(bar: Element | null, share: number, from?: number) {
  if (!bar) return;
  const to = Math.max(0, Math.min(1, Number.isFinite(share) ? share : 0));
  gsap.killTweensOf(bar);
  if (reducedMotion()) {
    gsap.set(bar, { scaleX: to });
    return;
  }
  if (from !== undefined) gsap.set(bar, { scaleX: from });
  gsap.to(bar, { scaleX: to, duration: 0.28, ease: EASE_OUT });
}

/**
 * Pilo pensando: los puntos suben y bajan en ola mientras dura la espera.
 * Devuelve cómo apagarlos; quien los enciende los apaga al terminar.
 */
export function thinkingDots(dots: Element[]): () => void {
  if (!dots.length || reducedMotion()) return () => {};
  const tween = gsap.fromTo(
    dots,
    { y: 0, opacity: 0.35 },
    { y: -3, opacity: 1, duration: 0.42, ease: "sine.inOut", stagger: { each: 0.14, repeat: -1, yoyo: true } },
  );
  return () => {
    tween.kill();
    gsap.set(dots, { clearProps: "transform,opacity" });
  };
}

/* --- Memoria: la frase del panel de Pilo, el recorrido y el mapa -------------------------
     Frase       al cambiar de paso, la frase del panel entra con un fundido de 180 ms.
     Recorrido   la etapa que se acaba de cumplir llena su barra una vez (280 ms).
     Mapa        al llegar, las relaciones se trazan una vez; al elegir un punto con
                 el puntero, se traza su camino (drawChain, de «Mr. Pilo con IA»).
   Todo se puede interrumpir: lo que se corta se lleva a su final (`settle`), así
   ningún texto ni trazo queda a medias. */

/** Lleva a su final lo que se esté moviendo en esos elementos y lo suelta. */
export function settle(targets: Element[] | Element | null) {
  const list = Array.isArray(targets) ? targets : targets ? [targets] : [];
  if (!list.length) return;
  for (const tween of gsap.getTweensOf(list)) {
    if (tween.repeat() === -1) continue;
    tween.progress(1);
  }
  gsap.killTweensOf(list);
}

/** La frase del panel cambió: entra con un fundido corto, partiendo siempre de un estado limpio. */
export function swapLine(node: Element | null) {
  if (!node) return;
  settle(node);
  enterBlock(node);
}

/** Las barras de las etapas recién cumplidas se llenan una vez. */
export function fillStages(bars: Element[]) {
  if (!bars.length) return;
  settle(bars);
  if (reducedMotion()) {
    gsap.set(bars, { clearProps: "transform" });
    return;
  }
  gsap.fromTo(bars, { scaleX: 0 }, { scaleX: 1, duration: 0.28, ease: EASE_OUT, stagger: 0.06, clearProps: "transform" });
}
