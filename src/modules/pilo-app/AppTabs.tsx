/* =============================================================================
   Mr. Pilo · la app móvil · la barra de pestañas.

   Cuatro destinos, siempre los mismos y en el mismo lugar: Pilo (la
   conversación), Pilo U (lo universitario de la persona: clases, notas,
   calendario; grupos y asistencia si enseña), Carnet y Yo (perfil, límites y
   ajustes). Solo en pantallas angostas: en el computador manda la barra lateral
   (AppSide), que lleva los mismos destinos.

   Cambiar de pestaña es una acción frecuente: no se anima el contenido, solo
   el indicador, y con la salida corta de siempre. El borde de abajo respeta el
   gesto del sistema (safe-area), así que en los teléfonos con barra de
   navegación gestual no queda nada tapado.
   ========================================================================== */

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { tr, useLang } from "../../components/pilo/i18n";
import { Icon } from "./icons";
import { APP_CARNET, APP_PROFILE, APP_U } from "./routes";
import "./tabs.css";

export type TabId = "pilo" | "u" | "carnet" | "yo";

export function AppTabs({ active, home }: { active: TabId; home: string }) {
  useLang();
  const nav = useRef<HTMLElement>(null);
  const ind = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const items: { id: TabId; label: string; to: string; icon: ReactNode }[] = [
    { id: "pilo", label: tr("Pilo"), to: home, icon: Icon.chat },
    { id: "u", label: tr("Pilo U"), to: APP_U, icon: Icon.cap },
    { id: "carnet", label: tr("Carnet"), to: APP_CARNET, icon: Icon.id },
    { id: "yo", label: tr("Yo"), to: APP_PROFILE, icon: Icon.user },
  ];

  // El indicador se desliza a la pestaña activa; la primera vez, sin viaje.
  useLayoutEffect(() => {
    const on = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    const el = ind.current;
    if (!on || !el) return;
    const x = on.offsetLeft + on.offsetWidth / 2 - el.offsetWidth / 2;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!placed.current || reduce) gsap.set(el, { x });
    else gsap.to(el, { x, duration: 0.28, ease: "power4.out" });
    placed.current = true;
  }, [active]);

  return (
    <nav className="pt" ref={nav} aria-label={tr("Secciones de la app")}>
      <span className="pt-ind" ref={ind} aria-hidden="true" />
      {items.map((it) => (
        <Link key={it.id} className="pt-i" to={it.to} aria-current={active === it.id ? "page" : undefined}>
          <span className="pt-ic">{it.icon}</span>
          <span className="pt-l">{it.label}</span>
        </Link>
      ))}
    </nav>
  );
}
