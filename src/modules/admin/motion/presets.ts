/* =============================================================================
   Administración de Pilo · movimiento compartido (GSAP).

   Una API pequeña para el dashboard y las pantallas. Reglas de la casa:

     - Solo transform y opacity (height únicamente en expand/collapse, que no
       tienen equivalente en transform).
     - Salidas con expo.out (la misma curva que --pa-ease); nada de ease-in.
     - Entradas < 300 ms por elemento; la cascada total tiene tope.
     - Con prefers-reduced-motion solo hay fundidos cortos: nada se desplaza.
     - Todo devuelve un MotionHandle: `kill()` detiene y deja el estado actual
       (para interrumpir sin saltos), `revert()` devuelve el elemento a como
       estaba (úsalo al desmontar). Cada llamada mata la anterior sobre los
       mismos elementos, así que se puede disparar dos veces seguidas.
     - Lo que se repite decenas de veces al día (cambiar de pestaña con el
       teclado, abrir un menú) NO debe animarse: pasa `{ instant: true }` o no
       llames al preset.

   Complementa, sin duplicar, a ../pilo/motion.ts (revealSection, para pestañas
   dentro de una sección) y ../pilo-ensenanza/motion.ts (guardado, listas del
   módulo de Enseñanza).

   API
     prefersReducedMotion()                        -> boolean
     enterCascade(targets, opts?)                  -> MotionHandle
     useEnterCascade(ref, selector?, deps?)        -> hook de React sobre lo anterior
     expand(el, opts?) / collapse(el, opts?)       -> MotionHandle (done: Promise)
     pageEnter(el, opts?)                          -> MotionHandle
     pageLeave(el, opts?)                          -> MotionHandle (done: Promise)
     shake(el)                                     -> MotionHandle (error breve)
   ========================================================================== */

import { useLayoutEffect } from "react";
import type { RefObject } from "react";
import gsap from "gsap";
import { EASE_OUT, EASE_IN_OUT } from "../../impacto/pilo/motion";

export { EASE_OUT, EASE_IN_OUT };

/** ¿La persona pidió menos movimiento? */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export interface MotionHandle {
  /** Se resuelve al terminar (o al matarlo/revertirlo): nunca queda colgada. */
  done: Promise<void>;
  /** Detiene la animación y deja el estado en el que estaba. */
  kill: () => void;
  /** Detiene y devuelve los estilos en línea a su valor original. */
  revert: () => void;
}

type Targets = gsap.TweenTarget;

/** Crea un handle a partir de una función que construye tweens dentro de un contexto. */
function run(scope: Element | undefined, build: (resolve: () => void) => void): MotionHandle {
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });
  const ctx = gsap.context(() => build(() => resolveDone()), scope);
  return {
    done,
    kill: () => {
      ctx.kill();
      resolveDone();
    },
    revert: () => {
      ctx.revert();
      resolveDone();
    },
  };
}

const NOOP: MotionHandle = { done: Promise.resolve(), kill: () => {}, revert: () => {} };

/* ------------------------------------------------------------------------- */
/* Entrada en cascada                                                         */
/* ------------------------------------------------------------------------- */

export interface CascadeOptions {
  /** Elemento raíz para resolver selectores y acotar el contexto. */
  scope?: Element | null;
  /** Desplazamiento inicial en px (por defecto 10). */
  y?: number;
  /** Duración de cada elemento en s (por defecto 0.28). */
  duration?: number;
  /** Retardo entre elementos en s (por defecto 0.05; el total se acota a 0.4). */
  stagger?: number;
  /** Retardo inicial en s. */
  delay?: number;
  /** Sin animación alguna (p. ej. acción con teclado). */
  instant?: boolean;
}

/**
 * Los elementos entran uno tras otro: fundido + 10 px hacia arriba. Con
 * movimiento reducido, un fundido corto y simultáneo. Al terminar limpia los
 * estilos en línea, así no quedan transforms colgando.
 */
export function enterCascade(targets: Targets | null | undefined, opts: CascadeOptions = {}): MotionHandle {
  if (!targets) return NOOP;
  if (opts.instant) return NOOP;
  const scope = opts.scope ?? undefined;
  return run(scope, (resolve) => {
    gsap.killTweensOf(targets);
    if (prefersReducedMotion()) {
      gsap.fromTo(targets, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", delay: opts.delay ?? 0, clearProps: "opacity", onComplete: resolve });
      return;
    }
    const count = Array.isArray(targets) ? targets.length : gsap.utils.toArray(targets, scope).length;
    const each = Math.min(opts.stagger ?? 0.05, count > 1 ? 0.4 / (count - 1) : 0);
    gsap.fromTo(
      targets,
      { opacity: 0, y: opts.y ?? 10 },
      {
        opacity: 1,
        y: 0,
        duration: opts.duration ?? 0.28,
        ease: EASE_OUT,
        stagger: each,
        delay: opts.delay ?? 0,
        clearProps: "transform,opacity",
        onComplete: resolve,
      },
    );
  });
}

/**
 * Hook: la cascada corre una vez al montar (o cuando cambian `deps`) sobre los
 * hijos que coincidan con `selector` dentro de `ref`, y se revierte al
 * desmontar. Quien lo use debe dejar visible el contenido sin JS: el estado
 * inicial (opacity 0) lo pone GSAP, no el CSS.
 */
export function useEnterCascade(
  ref: RefObject<HTMLElement | null>,
  selector = "[data-cascade]",
  deps: ReadonlyArray<unknown> = [],
  opts: CascadeOptions = {},
) {
  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const handle = enterCascade(gsap.utils.toArray(selector, root), { ...opts, scope: root });
    return () => handle.revert();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/* ------------------------------------------------------------------------- */
/* Expandir / replegar                                                        */
/* ------------------------------------------------------------------------- */

export interface ExpandOptions {
  /** Duración en s (por defecto 0.26 al abrir, 0.2 al cerrar: salir es más rápido). */
  duration?: number;
  /** Sin animación (teclado). Aplica el estado final de inmediato. */
  instant?: boolean;
  onDone?: () => void;
}

/**
 * Abre un panel plegable (height 0 -> auto). Parte de la altura actual, así que
 * se puede invertir a mitad de camino. Deja `height: auto` al terminar.
 * El elemento debe poder recortar su contenido: se fuerza overflow hidden
 * mientras dura el movimiento.
 */
export function expand(el: HTMLElement | null, opts: ExpandOptions = {}): MotionHandle {
  if (!el) return NOOP;
  gsap.killTweensOf(el);
  el.hidden = false;
  if (opts.instant) {
    gsap.set(el, { clearProps: "height,opacity,overflow" });
    opts.onDone?.();
    return NOOP;
  }
  return run(el, (resolve) => {
    const finish = () => {
      gsap.set(el, { clearProps: "height,opacity,overflow" });
      opts.onDone?.();
      resolve();
    };
    if (prefersReducedMotion()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", onComplete: finish });
      return;
    }
    const from = el.getBoundingClientRect().height;
    const to = el.scrollHeight;
    gsap.fromTo(
      el,
      { height: from, opacity: from === 0 ? 0 : 1, overflow: "hidden" },
      { height: to, opacity: 1, duration: opts.duration ?? 0.26, ease: EASE_OUT, onComplete: finish },
    );
  });
}

/**
 * Repliega un panel (height actual -> 0) y lo marca `hidden` al terminar.
 * Más rápido que expand: el sistema responde, la persona ya decidió.
 */
export function collapse(el: HTMLElement | null, opts: ExpandOptions = {}): MotionHandle {
  if (!el) return NOOP;
  gsap.killTweensOf(el);
  if (opts.instant) {
    el.hidden = true;
    gsap.set(el, { clearProps: "height,opacity,overflow" });
    opts.onDone?.();
    return NOOP;
  }
  return run(el, (resolve) => {
    const finish = () => {
      el.hidden = true;
      gsap.set(el, { clearProps: "height,opacity,overflow" });
      opts.onDone?.();
      resolve();
    };
    if (prefersReducedMotion()) {
      gsap.to(el, { opacity: 0, duration: 0.12, ease: "none", onComplete: finish });
      return;
    }
    gsap.fromTo(
      el,
      { height: el.getBoundingClientRect().height, overflow: "hidden" },
      { height: 0, opacity: 0, duration: opts.duration ?? 0.2, ease: EASE_OUT, onComplete: finish },
    );
  });
}

/* ------------------------------------------------------------------------- */
/* Transición de página                                                       */
/* ------------------------------------------------------------------------- */

export interface PageOptions {
  /** Sin animación (navegación con teclado: no se hace esperar a nadie). */
  instant?: boolean;
  /** Retardo inicial en s. */
  delay?: number;
}

/** La pantalla entra: fundido + 8 px hacia arriba, 260 ms. Reducido: solo fundido. */
export function pageEnter(el: HTMLElement | null, opts: PageOptions = {}): MotionHandle {
  if (!el || opts.instant) return NOOP;
  return run(el, (resolve) => {
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", delay: opts.delay ?? 0, clearProps: "opacity", onComplete: resolve });
      return;
    }
    gsap.fromTo(
      el,
      { opacity: 0, y: 8 },
      { opacity: 1, y: 0, duration: 0.26, ease: EASE_OUT, delay: opts.delay ?? 0, clearProps: "transform,opacity", onComplete: resolve },
    );
  });
}

/**
 * La pantalla sale antes de navegar: fundido + 6 px hacia arriba, 200 ms.
 * Espera `handle.done` y navega. NO hace revert al terminar (el elemento se
 * queda invisible hasta que la ruta nueva lo desmonte).
 */
export function pageLeave(el: HTMLElement | null, opts: PageOptions = {}): MotionHandle {
  if (!el || opts.instant) return NOOP;
  return run(el, (resolve) => {
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.to(el, { opacity: 0, duration: 0.12, ease: "none", delay: opts.delay ?? 0, onComplete: resolve });
      return;
    }
    gsap.to(el, { opacity: 0, y: -6, duration: 0.2, ease: EASE_IN_OUT, delay: opts.delay ?? 0, onComplete: resolve });
  });
}

/* ------------------------------------------------------------------------- */
/* Error breve                                                                */
/* ------------------------------------------------------------------------- */

/**
 * Sacudida horizontal corta (±7 px, 3 oscilaciones, ~300 ms) para un envío que
 * falló. Con movimiento reducido no hay desplazamiento: un parpadeo de
 * opacidad. El error siempre se dice además con texto (role="alert").
 */
export function shake(el: HTMLElement | null): MotionHandle {
  if (!el) return NOOP;
  return run(el, (resolve) => {
    gsap.killTweensOf(el);
    if (prefersReducedMotion()) {
      gsap.fromTo(el, { opacity: 0.55 }, { opacity: 1, duration: 0.25, ease: "none", clearProps: "opacity", onComplete: resolve });
      return;
    }
    gsap
      .timeline({ onComplete: resolve, defaults: { ease: "power2.inOut" } })
      .to(el, { x: -7, duration: 0.05 })
      .to(el, { x: 7, duration: 0.09 })
      .to(el, { x: -5, duration: 0.08 })
      .to(el, { x: 3, duration: 0.07 })
      .to(el, { x: 0, duration: 0.07, clearProps: "transform" });
  });
}
