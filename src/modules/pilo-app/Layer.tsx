/* =============================================================================
   Mr. Pilo · la app móvil · lo que se abre encima: el cajón del menú y las hojas.

   Entran desde su borde con la curva de cajón y salen más rápido (la hoja de
   estilos lo hace con transiciones, que se pueden interrumpir a medio camino).
   Lo que se abrió con el teclado no hace recorrido: aparece en su sitio.

   La capa oscura de detrás es una sola y la pone quien los usa (.pa-scrim).

   Mientras está abierto, el foco no sale de él (Tab da la vuelta), Escape lo
   cierra y, al cerrarse, el foco vuelve a quien lo abrió. Cerrado, no se puede
   enfocar ni leer (inert).
   ========================================================================== */

import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const focusables = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null || el === document.activeElement);

/** El foco se queda dentro de `root` mientras `active`; Escape llama a `onEscape`. */
export function useFocusTrap(root: React.RefObject<HTMLElement>, active: boolean, onEscape: () => void) {
  const escape = useRef(onEscape);
  escape.current = onEscape;
  useEffect(() => {
    const el = root.current;
    if (!active || !el) return;
    const before = document.activeElement as HTMLElement | null;
    // El primer control, o el propio panel si no tiene ninguno.
    (focusables(el)[0] ?? el).focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        escape.current();
        return;
      }
      if (e.key !== "Tab") return;
      const items = focusables(el);
      if (!items.length) {
        e.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const here = document.activeElement;
      if (!el.contains(here)) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      } else if (e.shiftKey && here === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && here === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      // El foco vuelve a quien abrió, si sigue en la página.
      if (before && document.contains(before)) before.focus({ preventScroll: true });
    };
  }, [root, active]);
}

/** Cerrado, un panel no recibe foco ni se lee. React 18 no conoce `inert`: se pone a mano. */
export function useInert(root: React.RefObject<HTMLElement>, inert: boolean) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    if (inert) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [root, inert]);
}

export function Layer({
  kind,
  open,
  quick,
  label,
  onClose,
  children,
}: {
  kind: "menu" | "sheet";
  open: boolean;
  /** Se abrió (o se cierra) con el teclado: sin recorrido. */
  quick: boolean;
  label: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open, onClose);
  useInert(panel, !open);
  return (
    <div
      ref={panel}
      className={kind === "menu" ? "pa-menu" : "pa-sheet"}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      aria-hidden={!open}
      tabIndex={-1}
      data-open={open || undefined}
      data-quick={quick || undefined}
    >
      {children}
    </div>
  );
}
