/* =============================================================================
   Mr. Pilo · las cuatro reglas de oro, como lista.

   La misma lista en la aceptación de la app y en el paso de términos del
   registro: el texto sale de policy.ts y de ningún otro sitio.
   ========================================================================== */

import type { ReactNode } from "react";
import { GOLDEN_RULES } from "./policy";
import type { RuleIcon } from "./policy";
import "./terms.css";

const GLYPH: Record<RuleIcon, ReactNode> = {
  guia: (
    <>
      <circle cx="9" cy="9" r="6.5" />
      <path d="M11.5 6.5l-1.5 4-4 1.5 1.5-4 4-1.5z" />
    </>
  ),
  lupa: (
    <>
      <circle cx="8" cy="8" r="4.5" />
      <path d="M11.5 11.5L15 15" />
    </>
  ),
  balanza: <path d="M9 3v12M5 15h8M3.5 6h11M3.5 6L2 10h3L3.5 6zM14.5 6L13 10h3l-1.5-4z" />,
  candado: (
    <>
      <rect x="4" y="8" width="10" height="7" rx="1.5" />
      <path d="M6 8V6a3 3 0 016 0v2" />
    </>
  ),
};

export const TermsIcon = ({ children }: { children: ReactNode }) => (
  <svg className="pt-i" viewBox="0 0 18 18" aria-hidden="true">
    {children}
  </svg>
);

export function GoldenRules({ id, labelledBy }: { id?: string; labelledBy?: string }) {
  return (
    <ol className="pt-rules" id={id} aria-labelledby={labelledBy}>
      {GOLDEN_RULES.map((rule) => (
        <li key={rule.id}>
          <span className="pt-rules__icon">
            <TermsIcon>{GLYPH[rule.icon]}</TermsIcon>
          </span>
          <div>
            <b>{rule.title}</b>
            <p>{rule.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
