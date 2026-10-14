/* =============================================================================
   Mr. Pilo · el enlace a la política de uso, para cualquier superficie de Pilo.

   En la app va en el menú. En las páginas web de Pilo (/pregunta y
   /pilo-ensenanza) basta con montarlo diciendo de dónde se llega, y la
   política sabe a dónde volver:

     <PolicyLink from="pregunta" className="…" />
     <PolicyLink from="ensenanza" />

   No trae estilos: toma los de la clase que se le pase.
   ========================================================================== */

import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { POLICY_MENU_LABEL, policyHref } from "./policy";
import type { PolicyOrigin } from "./policy";

export function PolicyLink({
  from = "app",
  className,
  newTab = false,
  onClick,
  children,
}: {
  /** Desde dónde se llega: decide a dónde lleva «Volver» en la página de la política. */
  from?: PolicyOrigin;
  className?: string;
  /** En otra pestaña: para no perder lo que la persona está escribiendo. */
  newTab?: boolean;
  onClick?: () => void;
  children?: ReactNode;
}) {
  return (
    <Link className={className} to={policyHref(from)} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener" : undefined} onClick={onClick}>
      {children ?? POLICY_MENU_LABEL}
    </Link>
  );
}
