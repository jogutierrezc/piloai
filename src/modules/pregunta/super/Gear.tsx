/* =============================================================================
   Los modos secretos · el equipo de cada modo.

   Pilo no se redibuja: el equipo son piezas que van ENCIMA del dibujo
   aprobado. Están dibujadas una sola vez, en las medidas del Pilo de cuerpo
   entero (public/Pilo2/Recurso 1.png, 1023 × 1550), y sirven en los dos sitios:

     · en la entrada (SuperEntrance), sobre la cabeza del cuerpo entero;
     · en la cara del chat (PiloFace, 450 × 631), movidas a su encuadre.

     Pilocop     visor de acero con barrido rojo y antena
     Pilonator   gafas oscuras de píxeles
     Sayayín     rastreador sobre una lente y el copete dorado y erizado

   El modo llega a cada cara por contexto: quien pinta a Pilo en la página
   (Pilo.tsx) lo lee y le pone el equipo.
   ========================================================================== */

import { createContext } from "react";
import type { SuperMode } from "./modes";
import "./super.css";

/** El modo activo en la conversación; null, el Pilo de siempre. */
export const SuperContext = createContext<SuperMode | null>(null);

/** Las gafas de Pilo están inclinadas tres grados: lo que va sobre ellas, también. */
export const GLASSES_TILT = "rotate(-3 415 237)";

/** Los degradados y el brillo que comparten todas las piezas. Va una vez por página. */
export function SuperDefs() {
  return (
    <svg className="sp-defs" width="0" height="0" aria-hidden="true">
      <defs>
        <linearGradient id="sp-metal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a475f" />
          <stop offset=".5" stopColor="#1a2233" />
          <stop offset="1" stopColor="#0c111c" />
        </linearGradient>
        <linearGradient id="sp-flame" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff3b0" />
          <stop offset=".35" stopColor="#ffb020" />
          <stop offset="1" stopColor="#ff3a00" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="sp-aura" cx=".5" cy=".6" r=".6">
          <stop offset=".35" stopColor="#ffd21f" stopOpacity="0" />
          <stop offset=".8" stopColor="#ffd21f" stopOpacity=".55" />
          <stop offset="1" stopColor="#fff7c2" stopOpacity=".85" />
        </radialGradient>
        <filter id="sp-glow" x="-50%" y="-150%" width="200%" height="400%">
          <feGaussianBlur stdDeviation="7" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
    </svg>
  );
}

export const Antenna = () => (
  <>
    <rect x="528" y="6" width="34" height="22" rx="4" fill="url(#sp-metal)" stroke="#56637d" strokeWidth="3" />
    <line x1="545" y1="8" x2="562" y2="-96" stroke="#56637d" strokeWidth="7" strokeLinecap="round" />
    <circle className="sp-blink" cx="563" cy="-104" r="16" fill="#ff2a1f" />
  </>
);

export const Visor = () => (
  <>
    <polygon points="238,178 592,160 602,248 566,300 300,312 234,268" fill="url(#sp-metal)" stroke="#8d9bb5" strokeWidth="4" strokeLinejoin="round" />
    <path d="M262 196 L574 180" stroke="#c7d2e6" strokeWidth="3" strokeLinecap="round" opacity=".6" />
    <rect x="274" y="220" width="282" height="34" rx="6" fill="#2a0505" stroke="#0c111c" strokeWidth="3" />
    <rect className="sp-scan" x="276" y="222" width="76" height="30" rx="5" fill="#ff2a1f" />
  </>
);

export const PixelShades = () => (
  <g fill="#111">
    <rect x="254" y="166" width="324" height="44" />
    <rect x="254" y="210" width="136" height="66" />
    <rect x="264" y="276" width="118" height="24" />
    <rect x="420" y="210" width="158" height="66" />
    <rect x="430" y="276" width="138" height="24" />
    <g fill="#fff">
      <rect x="290" y="222" width="22" height="22" />
      <rect x="312" y="244" width="22" height="22" />
      <rect x="456" y="222" width="22" height="22" />
      <rect x="478" y="244" width="22" height="22" />
    </g>
  </g>
);

export const Scouter = () => (
  <>
    <rect x="566" y="196" width="46" height="78" rx="8" fill="url(#sp-metal)" stroke="#8d9bb5" strokeWidth="3" />
    <rect x="424" y="166" width="146" height="134" rx="18" fill="#39ff88" fillOpacity=".5" stroke="#0c111c" strokeWidth="5" />
    <circle className="sp-blink" cx="482" cy="236" r="34" fill="none" stroke="#063d1c" strokeWidth="4" strokeDasharray="12 8" />
  </>
);

/** El copete dorado: cubre el copete café del dibujo y le saca puntas. */
export const GoldHair = () => (
  <path
    d="M606 72 L552 68 L510 97 L486 102 L482 146 L442 157 L437 206 L402 223 L354 202 L332 152 L336 100 L290 60 L350 55 L330 -40 L410 10 L440 -110 L500 -5 L560 -90 L585 5 L650 -20 Z"
    fill="#ffd21f"
    stroke="#222"
    strokeWidth="5"
    strokeLinejoin="round"
  />
);

/**
 * El equipo sobre la cara del chat. La cara (450 × 631) es la cabeza del
 * cuerpo entero corrida 266 a la izquierda y 3 abajo: con eso las piezas caen
 * en su sitio sin dibujarlas dos veces.
 */
export function Gear({ mode }: { mode: SuperMode }) {
  return (
    <svg className="pilo-face__gear" viewBox="0 0 450 631" aria-hidden="true">
      <g transform="translate(-266 3)">
        {mode === "pilocop" && (
          <>
            <Antenna />
            <g transform={GLASSES_TILT}>
              <Visor />
            </g>
          </>
        )}
        {mode === "pilonator" && (
          <g transform={GLASSES_TILT}>
            <PixelShades />
          </g>
        )}
        {mode === "sayayin" && (
          <>
            <GoldHair />
            <g transform={GLASSES_TILT}>
              <Scouter />
            </g>
          </>
        )}
      </g>
    </svg>
  );
}
