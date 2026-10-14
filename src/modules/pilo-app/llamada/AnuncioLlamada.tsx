/* =============================================================================
   Mr. Pilo · la app · la llamada · el anuncio de lanzamiento.

   Una hoja que sale una sola vez (novedad.ts decide cuándo) y cuenta en tres
   pasos cómo se habla con Pilo. Tiene un solo momento de movimiento: tres anillos
   salen de Pilo al abrirse y se quedan como dibujo. Cerrarla, de cualquier
   forma, cuenta como verla; quien la cierra con «Probar la llamada» pasa al
   aviso de funciones.
   ========================================================================== */

import { useRef } from "react";
import type { MouseEvent } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { tr } from "../../../components/pilo/i18n";
import { Pilo } from "../../pregunta/Pilo";
import { Layer } from "../Layer";
import { Icon } from "../icons";
import { reducedMotion } from "../pwa";
import "./llamada.css";

gsap.registerPlugin(useGSAP);

export function AnuncioLlamada({ open, quick, onClose, onTry }: { open: boolean; quick: boolean; onClose: (event?: MouseEvent) => void; onTry: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useGSAP(
    () => {
      if (!open || reducedMotion()) return;
      const delay = quick ? 0 : 0.14;
      gsap.fromTo(".pn-in > *:not(.pn-hero)", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.34, ease: "power3.out", stagger: 0.05, delay, clearProps: "transform,opacity,visibility" });
      // El único momento: tres anillos salen de Pilo, una vez, y se quedan quietos.
      gsap.fromTo(".pn-ring", { scale: 0.6, opacity: 0, transformOrigin: "50% 50%" }, { scale: 1, opacity: (i) => 0.55 - i * 0.14, duration: 0.9, ease: "power3.out", stagger: 0.12, delay: delay + 0.1 });
    },
    { scope: root, dependencies: [open, quick] },
  );

  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Novedad: habla con Pilo")} onClose={onClose}>
      <div className="pa-sheet__in pn-in" ref={root}>
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pn-hero" aria-hidden="true">
          <svg className="pn-rings" viewBox="0 0 240 240">
            <circle className="pn-ring" cx="120" cy="120" r="64" />
            <circle className="pn-ring" cx="120" cy="120" r="88" />
            <circle className="pn-ring" cx="120" cy="120" r="112" />
          </svg>
          <span className="pn-face">
            <Pilo size="100%" mood="feliz" alive />
          </span>
        </div>
        <div className="pa-sheet__head">
          <h2>{tr("Ahora puede hablar con Pilo")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar el anuncio")}>
            {Icon.close}
          </button>
        </div>
        <p className="pc-lead">{tr("Toque el teléfono de la cabecera y converse en voz alta, como en una llamada. Está en prueba.")}</p>
        <ol className="pn-how">
          <li>
            <strong>{tr("Toque el teléfono")}</strong>
            <span>{tr("Está arriba a la derecha, junto al sonido.")}</span>
          </li>
          <li>
            <strong>{tr("Hable en su idioma")}</strong>
            <span>{tr("Pilo le escucha cuando usted habla y se calla si usted lo interrumpe.")}</span>
          </li>
          <li>
            <strong>{tr("Pilo le responde")}</strong>
            <span>{tr("Con las cifras y las fuentes oficiales de la UDES, en voz alta.")}</span>
          </li>
        </ol>
        <p className="pn-langs">{tr("Español, inglés y portugués.")}</p>
        <div className="pc-actions">
          <button type="button" className="pa-btn pa-btn--main" onClick={onTry}>
            {Icon.phone}
            {tr("Probar la llamada")}
          </button>
          <button type="button" className="pa-btn pa-btn--line" onClick={onClose}>
            {tr("Entendido, no mostrar más")}
          </button>
        </div>
      </div>
    </Layer>
  );
}
