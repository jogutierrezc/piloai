/* =============================================================================
   Mr. Pilo · carnet · el código QR y el aro de cuenta regresiva.

   El QR va en papel claro con tinta oscura en TODOS los temas (--w-card y
   --w-card-ink): los lectores necesitan ese contraste. El aro se vacía en 30 s
   con un solo movimiento lineal que GSAP reinicia en cada ventana; con menos
   movimiento pedido, el aro se actualiza cada segundo y no se anima.
   ========================================================================== */

import { useEffect, useMemo, useRef } from "react";
import gsap from "gsap";
import { reducedMotion } from "../pwa";
import { drawQr } from "./qr";
import { WINDOW_SECONDS } from "./servidor-logica";

export function QrView({ text, label }: { text: string; label: string }) {
  const qr = useMemo(() => drawQr(text), [text]);
  if (!qr.size) return null;
  return (
    <svg className="cn-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} shapeRendering="crispEdges" role="img" aria-label={label}>
      <rect width={qr.size} height={qr.size} />
      <path d={qr.path} />
    </svg>
  );
}

const R = 17;
const C = 2 * Math.PI * R;

/** El aro de 30 s. `win` cambia al empezar cada ventana; `fraction` es lo que falta (0 a 1). */
export function Ring({ win, fraction, left }: { win: number; fraction: number; left: number }) {
  const arc = useRef<SVGCircleElement>(null);
  const still = reducedMotion();

  useEffect(() => {
    const el = arc.current;
    if (!el || still) return;
    const remaining = Math.max(0.2, fraction * WINDOW_SECONDS);
    gsap.fromTo(el, { strokeDashoffset: C * (1 - fraction) }, { strokeDashoffset: C, duration: remaining, ease: "none", overwrite: true });
    return () => {
      gsap.killTweensOf(el);
    };
    // Un movimiento por ventana: `fraction` solo se lee al empezar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [win, still]);

  return (
    <span className="cn-ring">
      <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">
        <circle className="cn-ring__track" cx="20" cy="20" r={R} />
        <circle
          ref={arc}
          className="cn-ring__arc"
          cx="20"
          cy="20"
          r={R}
          strokeDasharray={C}
          style={still ? { strokeDashoffset: C * (1 - fraction) } : undefined}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <b className="cn-ring__n">{left}</b>
    </span>
  );
}
