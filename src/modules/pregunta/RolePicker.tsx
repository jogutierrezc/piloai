/* =============================================================================
   Pregúntele a Pilo · quién pregunta (0113).

   Los espacios que lo piden (Mr. Pilo en Enseñanza) preguntan una vez si quien
   habla es estudiante o profesor; «Prefiero no decir» también es una
   respuesta. La elección se guarda por navegador y por espacio (store.ts) y
   con ella el servidor adapta la redacción y la voz, y la página cambia las
   preguntas sugeridas y la cara de partida.

   RolePicker: las tres opciones, con el aspecto del lugar donde aparece
   (la bienvenida, el saludo de la página, el chat emergente o el menú).
   RoleMenu: el control pequeño de la barra para cambiar la elección.

   Movimiento: solo opacidad y transform, corto y con salida fuerte; con
   movimiento reducido no se anima nada. Nunca se desenfoca texto.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import gsap from "gsap";
import { ROLE_OPTIONS, ROLE_QUESTION } from "./space";
import type { Rol } from "./space";
import "./role-picker.css";
import { tr, useLang } from "../../components/pilo/i18n";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function RolePicker({
  value,
  onPick,
  variant = "page",
  legend,
}: {
  value: Rol | null;
  onPick: (rol: Rol) => void;
  /** Dónde aparece: la escena de bienvenida, el saludo de la página, el chat emergente o el menú de la barra. */
  variant?: "stage" | "page" | "chat" | "menu";
  /** La pregunta, visible. Sin ella, el grupo igual se anuncia con la pregunta. */
  legend?: string;
}) {
  return (
    <div className="ap-rolp" data-variant={variant} role="group" aria-label={tr(ROLE_QUESTION)}>
      {legend && <p className="ap-rolp__q">{legend}</p>}
      <div className="ap-rolp__opts">
        {ROLE_OPTIONS.map((o) => (
          <button key={o.id} type="button" className="ap-rolp__b" data-quiet={o.id === "general" || undefined} aria-pressed={value === o.id} onClick={() => onPick(o.id)}>
            {tr(o.label)}
          </button>
        ))}
      </div>
    </div>
  );
}

/** El control de la barra: dice quién pregunta y deja cambiarlo. */
export function RoleMenu({ value, onPick }: { value: Rol | null; onPick: (rol: Rol) => void }) {
  useLang();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const current = ROLE_OPTIONS.find((o) => o.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Sale de su botón: crece un poco desde la esquina de arriba. Si se interrumpe, termina en su estado final.
  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el || reduced()) return;
    const tween = gsap.fromTo(el, { autoAlpha: 0, y: -6, scale: 0.97 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.2, ease: "power3.out", clearProps: "opacity,visibility,transform" });
    return () => {
      tween.progress(1).kill();
    };
  }, [open]);

  return (
    <div className="ap-rol" ref={root}>
      <button
        ref={button}
        type="button"
        className="ap-rol__btn"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={current ? tr("Quién pregunta: {short}. Cambiar", { short: tr(current.short) }) : tr("Decir quién pregunta")}
        title={tr("Quién pregunta")}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="8" r="3.6" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
        <span>{current ? tr(current.short) : tr("¿Quién pregunta?")}</span>
      </button>
      {open && (
        <div className="ap-rol__panel" ref={panel}>
          <RolePicker
            variant="menu"
            value={value}
            legend={tr("Pilo adapta la respuesta a quien pregunta.")}
            onPick={(rol) => {
              onPick(rol);
              setOpen(false);
              button.current?.focus({ preventScroll: true });
            }}
          />
        </div>
      )}
    </div>
  );
}
