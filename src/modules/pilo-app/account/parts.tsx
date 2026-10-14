/* =============================================================================
   Mr. Pilo · cuentas (0120) · las piezas que comparten sus pantallas.

   Un campo con su etiqueta, su nota y su error junto a él (anunciado); un
   mensaje con glifo y palabra (nunca solo color); el selector de tono o de
   extensión; el de tema; la lista de lo que gana quien se registra; y la
   lista de lo que pide una contraseña.
   ========================================================================== */

import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { APP_THEMES, THEME_GROUPS } from "../themes";
import type { AppTheme } from "../themes";
import { Icon } from "../icons";
import { reducedMotion } from "../pwa";
import { ACCOUNT_BENEFITS, passwordChecks } from "./rules";
import { tr, useLang } from "../../../components/pilo/i18n";

gsap.registerPlugin(useGSAP);

export function Msg({ tone, id, alert = false, children }: { tone: "ok" | "bad" | "info"; id?: string; alert?: boolean; children: ReactNode }) {
  return (
    <p className="pc-msg" data-t={tone} id={id} role={alert ? "alert" : "status"}>
      {tone === "ok" ? Icon.check : tone === "bad" ? Icon.close : Icon.dot}
      <span>{children}</span>
    </p>
  );
}

export interface FieldAria {
  id: string;
  "aria-invalid": boolean | undefined;
  "aria-describedby": string | undefined;
}

/** Etiqueta, control, nota y error. El error va junto al campo, lo nombra `aria-describedby` y se anuncia. */
export function Field({ id, label, hint, error, children }: { id: string; label: string; hint?: ReactNode; error?: string | null; children: (aria: FieldAria) => ReactNode }) {
  const described = [hint ? `${id}-nota` : "", error ? `${id}-error` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className="pc-field">
      <label htmlFor={id}>{label}</label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": described })}
      {hint && (
        <span className="pc-hint" id={`${id}-nota`}>
          {hint}
        </span>
      )}
      {error && (
        <Msg tone="bad" id={`${id}-error`} alert>
          {error}
        </Msg>
      )}
    </div>
  );
}

/** Dónde se mueve la flecha: a la derecha y abajo avanza; a la izquierda y arriba, retrocede. */
const ARROWS: Record<string, 1 | -1> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Una elección entre pocas (tono, extensión): un grupo de opciones con un selector que se desliza
 * hasta la elegida. Con las flechas se pasa de una a otra; el selector se mueve solo en el cuerpo
 * del control y se queda quieto si la persona pidió menos movimiento.
 */
export function Seg<T extends string>({ label, value, options, onPick, disabled = false }: { label: string; value: T; options: { id: T; label: string }[]; onPick: (id: T) => void; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const thumb = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  const target = () => root.current?.querySelector<HTMLElement>('[aria-checked="true"]') ?? null;

  useGSAP(
    () => {
      const on = target();
      if (!on || !thumb.current) return;
      const to = { x: on.offsetLeft, width: on.offsetWidth };
      if (placed.current && !reducedMotion()) gsap.to(thumb.current, { ...to, duration: 0.26, ease: "power3.out", overwrite: true });
      else gsap.set(thumb.current, to);
      placed.current = true;
    },
    { dependencies: [value], scope: root },
  );

  // Si cambia el ancho (giro de pantalla, otra letra, otro idioma), el selector se recoloca sin animar.
  useEffect(() => {
    const el = root.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => {
      const on = target();
      if (on && thumb.current) gsap.set(thumb.current, { x: on.offsetLeft, width: on.offsetWidth });
    });
    watch.observe(el);
    return () => watch.disconnect();
  }, []);

  const keys = (e: KeyboardEvent) => {
    const step = ARROWS[e.key];
    if (!step || disabled) return;
    e.preventDefault();
    const at = options.findIndex((o) => o.id === value);
    const next = options[(at + step + options.length) % options.length];
    onPick(next.id);
    window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
  };

  return (
    <div className="pc-seg" role="radiogroup" aria-label={label} ref={root} onKeyDown={keys}>
      <span className="pc-seg__thumb" ref={thumb} aria-hidden="true" />
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={o.id === value} tabIndex={o.id === value ? 0 : -1} disabled={disabled} onClick={() => onPick(o.id)}>
          {tr(o.label)}
        </button>
      ))}
    </div>
  );
}

/** Quien pulsó: con teclado (`detail` 0) no hay movimiento de cortesía. */
type Pick = { detail: number };

/**
 * Los doce temas de la app en tres grupos. Cada uno es una mini-escena (barra, burbujas y acento),
 * pintada con los colores de ese tema; el elegido lleva un borde grueso y una marca, no solo color.
 * Es un grupo de opciones: con las flechas se pasa de un tema a otro y se aplica al llegar.
 */
export function ThemePicker({ value, onPick, labelledBy }: { value: AppTheme; onPick: (theme: AppTheme, event: Pick) => void; labelledBy: string }) {
  useLang();
  const uid = useId();
  const root = useRef<HTMLDivElement>(null);

  const keys = (e: KeyboardEvent) => {
    const step = ARROWS[e.key];
    if (!step) return;
    e.preventDefault();
    const at = APP_THEMES.findIndex((t) => t.id === value);
    const next = APP_THEMES[(at + step + APP_THEMES.length) % APP_THEMES.length];
    onPick(next.id, e);
    window.requestAnimationFrame(() => root.current?.querySelector<HTMLElement>(`[data-id="${next.id}"]`)?.focus());
  };

  return (
    <div className="pa-groups" role="radiogroup" aria-labelledby={labelledBy} ref={root} onKeyDown={keys}>
      {THEME_GROUPS.map((group, gi) => (
        <div className="pa-grp" role="group" aria-labelledby={`${uid}-g${gi}`} key={group}>
          <p className="pa-grp__t" id={`${uid}-g${gi}`}>
            {tr(group)}
          </p>
          <div className="pa-tiles">
            {APP_THEMES.filter((t) => t.group === group).map((t) => (
              <button key={t.id} type="button" className="pa-tile" role="radio" aria-checked={t.id === value} tabIndex={t.id === value ? 0 : -1} data-id={t.id} onClick={(e) => onPick(t.id, e)}>
                <span className="pa-swatch" data-tema={t.id} aria-hidden="true">
                  <i />
                  <b />
                  <em />
                  <u />
                </span>
                <span className="pa-tile__nm">
                  {tr(t.label)}
                  <small>{tr(t.hint)}</small>
                </span>
                <span className="pa-tile__ck" aria-hidden="true">
                  {Icon.check}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** Lo que gana quien se registra. */
export function Benefits({ title }: { title: string }) {
  return (
    <div className="pc-benefits">
      <p className="pc-label">{title}</p>
      <ul>
        {ACCOUNT_BENEFITS.map((b) => (
          <li key={b.title}>
            {Icon.check}
            <span>
              <strong>{tr(b.title)}</strong>
              <small>{tr(b.text)}</small>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Lo que pide la contraseña, con lo que ya cumple marcado (glifo y palabra). */
export function PasswordChecklist({ password, id }: { password: string; id: string }) {
  useLang();
  const c = passwordChecks(password);
  const items: [boolean, string][] = [
    [c.len, tr("8 caracteres o más")],
    [c.letter, tr("Una letra")],
    [c.num, tr("Un número")],
  ];
  return (
    <ul className="pc-checks" id={id} aria-label={tr("Lo que pide la contraseña")}>
      {items.map(([ok, text]) => (
        <li key={text} data-ok={ok || undefined}>
          {ok ? Icon.check : Icon.dot}
          {text}
          <span className="pa-sr">{ok ? " (cumplido)" : " (falta)"}</span>
        </li>
      ))}
    </ul>
  );
}
