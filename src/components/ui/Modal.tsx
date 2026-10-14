/* =============================================================================
   Modal accesible, compartido por toda la administración.
   Los diálogos anteriores solo se cerraban con el clic en el fondo o en la ×:
   no atrapaban el foco, no respondían a Escape y dejaban la página de atrás
   desplazable, así que con el teclado se podía tabular hasta fuera del modal
   sin cerrarlo.

   Entra con scale(0.97) y opacidad, nunca desde scale(0): nada en el mundo
   real aparece de la nada. El origen se queda centrado porque un modal no
   cuelga de un disparador concreto.
   ========================================================================== */

import { useCallback, useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";

interface ModalProps {
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  /** "reader" ensancha el panel: un párrafo largo a 34rem sale demasiado
   *  estrecho y se lee a saltos. "wide" es para los formularios largos —el de
   *  proyectos tiene nueve grupos de campos—, que a 46rem obligan a desplazarse
   *  media docena de pantallas para ver lo que se está capturando. Los
   *  formularios cortos se quedan como están. */
  size?: "form" | "reader" | "wide";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, description, onClose, children, size = "form" }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  const focusables = useCallback(
    () => Array.from(panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []),
    [],
  );

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null;

    // El primer campo del formulario, o el panel, reciben el foco al abrir.
    const first = focusables()[0] ?? panelRef.current;
    first?.focus();

    const { overflow, paddingRight } = document.body.style;
    const gap = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gap > 0) document.body.style.paddingRight = `${gap}px`;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      // Trampa de foco: del último al primero y viceversa.
      const items = focusables();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panelRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
      restoreRef.current?.focus();
    };
  }, [focusables, onClose]);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        ref={panelRef}
        className={`modal-panel${size === "form" ? "" : ` modal-panel--${size}`}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
      >
        <header className="modal-panel__head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">
            <Icon name="close" size={16} />
          </button>
        </header>

        {description && (
          <p className="modal-panel__description" id={descriptionId}>
            {description}
          </p>
        )}

        <div className="modal-panel__body">{children}</div>
      </div>
    </div>
  );
}

export function ModalActions({ onCancel, submitLabel }: { onCancel: () => void; submitLabel: string }) {
  return (
    <div className="modal-actions">
      <button className="button-ghost" type="button" onClick={onCancel}>
        Cancelar
      </button>
      <button className="button-primary" type="submit">
        {submitLabel}
      </button>
    </div>
  );
}
