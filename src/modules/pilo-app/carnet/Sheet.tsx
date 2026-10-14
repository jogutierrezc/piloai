/* =============================================================================
   Mr. Pilo · carnet · la hoja inferior.

   Sube con un resorte suave y se cierra arrastrándola hacia abajo: al soltar, si
   el arrastre fue largo o rápido (inercia) sale; si no, vuelve a su sitio con
   rebote. Con menos movimiento pedido, aparece y se va sin recorrido.

   El foco queda dentro (Tab da la vuelta), Escape y la capa de detrás la cierran,
   y al cerrarse el foco vuelve a quien la abrió. Se monta dentro de `.pa` para
   heredar los colores del tema.
   ========================================================================== */

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { useFocusTrap } from "../Layer";
import { reducedMotion } from "../pwa";
import { tr, useLang } from "../../../components/pilo/i18n";

/** Cuánto hay que arrastrar (px) o a qué velocidad (px/ms) para que la hoja se vaya. */
const DISMISS_DISTANCE = 120;
const DISMISS_SPEED = 0.6;

export function Sheet({ label, onClose, children }: { label: string; onClose: () => void; children: (close: () => void) => ReactNode }) {
  useLang();
  const panel = useRef<HTMLDivElement>(null);
  const scrim = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const drag = useRef<{ y: number; t: number; dy: number; v: number } | null>(null);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    const el = panel.current;
    if (!el || reducedMotion()) {
      onClose();
      return;
    }
    gsap.to(scrim.current, { opacity: 0, duration: 0.2, ease: "power1.out" });
    gsap.to(el, { y: el.offsetHeight + 40, duration: 0.24, ease: "power2.in", overwrite: true, onComplete: onClose });
  }, [onClose]);

  useFocusTrap(panel, true, close);

  useEffect(() => {
    const el = panel.current;
    if (!el || reducedMotion()) return;
    gsap.fromTo(scrim.current, { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "power1.out" });
    // El resorte: pasa un poco y se acomoda.
    gsap.fromTo(el, { y: el.offsetHeight + 40 }, { y: 0, duration: 0.55, ease: "back.out(1.15)" });
    return () => {
      gsap.killTweensOf([el, scrim.current]);
    };
  }, []);

  const down = (e: PointerEvent<HTMLDivElement>) => {
    drag.current = { y: e.clientY, t: performance.now(), dy: 0, v: 0 };
    e.currentTarget.setPointerCapture(e.pointerId);
    gsap.killTweensOf(panel.current);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    const dy = Math.max(0, e.clientY - d.y);
    d.v = (dy - d.dy) / Math.max(1, now - d.t);
    d.dy = dy;
    d.t = now;
    gsap.set(panel.current, { y: dy });
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.dy > DISMISS_DISTANCE || d.v > DISMISS_SPEED) close();
    else gsap.to(panel.current, { y: 0, duration: 0.5, ease: "back.out(1.6)", overwrite: true });
  };

  const host = (typeof document !== "undefined" && document.querySelector<HTMLElement>(".pa")) || null;
  const node = (
    <div className="cn-layer">
      <div className="cn-scrim" ref={scrim} onClick={close} aria-hidden="true" />
      <div className="cn-sheet" ref={panel} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1}>
        <div className="cn-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-hidden="true">
          <span />
        </div>
        <div className="cn-sheet__body">{children(close)}</div>
        <button type="button" className="cn-sheet__x" onClick={close} aria-label={tr("Cerrar")}>
          <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      </div>
    </div>
  );
  return host ? createPortal(node, host) : node;
}
