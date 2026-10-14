/* =============================================================================
   Mr. Pilo en Enseñanza · las piezas que se repiten en sus paneles.

   Thinking     Pilo pensando, en una línea y sin cara (Pilo vive en su panel):
                tres puntos, qué hace y, con avance conocido, su barra.
   Sheet        una hoja de trabajo que se apaga entera sin la migración 0113.
   FoldRow      una fila plegable: cerrada dice su valor; abierta, sus controles.
   Meter        un contador de hoy contra su tope, con la barra que crece.
   Skeleton     filas de espera con la forma de lo que va a llegar.
   TextArea     un texto con tope y su contador.
   RolTag       para quién: estudiante, profesor o sin rol.
   Soon         un panel anunciado que llega en la próxima entrega.
   useEnter     una lista que llega de la base entra una vez por llegada.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Icon } from "../../../components/ui/Icon";
import type { IconName } from "../../../components/ui/Icon";
import { Group, StatusMark } from "../pilo/ui";
import { enterBlock, enterList, fillBar, thinkingDots } from "./motion";

/**
 * Pilo pensando, dicho en el sitio donde se pidió el trabajo. Sin cara: Pilo
 * vive en su panel, y allí están su pose y el avance. `progress` (0 a 1) solo
 * cuando se conoce de verdad. Lo anuncia el panel (role="status"), no esta línea.
 */
export function Thinking({ children, progress, detail }: { children: ReactNode; progress?: number; detail?: ReactNode }) {
  const dots = useRef<HTMLSpanElement>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => thinkingDots(dots.current ? [...dots.current.children] : []), []);

  useLayoutEffect(() => {
    if (progress === undefined) return;
    fillBar(bar.current, progress, started.current ? undefined : 0);
    started.current = true;
  }, [progress]);

  return (
    <div className="pen-think">
      <span className="pen-think__text">
        <strong>
          {children}
          <span className="pen-think__dots" ref={dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </strong>
        {detail && <small>{detail}</small>}
        {progress !== undefined && (
          <i className="pen-think__bar" role="progressbar" aria-label="Avance" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
            <span ref={bar} />
          </i>
        )}
      </span>
    </div>
  );
}

/**
 * Una hoja de trabajo. Sin la migración 0113 nada se puede guardar: `off`
 * apaga de una vez todos sus controles (un fieldset), y lo de fuera —pestañas,
 * momentos, cabeceras de fila— sigue respondiendo.
 */
export function Sheet({ off = false, children }: { off?: boolean; children: ReactNode }) {
  return (
    <fieldset className="pen-sheet" disabled={off}>
      <div className="pis-sheet">{children}</div>
    </fieldset>
  );
}

/**
 * Una fila plegable. Cerrada dice su valor (`summary`); abierta muestra sus
 * controles. El contenido sigue montado al cerrarse (no se pierde lo que se
 * estaba escribiendo); solo se oculta. Abrirla con el puntero se ve; con el
 * teclado, no.
 */
export function FoldRow({
  id,
  title,
  summary,
  open,
  dirty = false,
  off = false,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  summary: ReactNode;
  open: boolean;
  dirty?: boolean;
  off?: boolean;
  onToggle: (via: "pointer" | "keyboard") => void;
  children: ReactNode;
}) {
  const body = useRef<HTMLDivElement>(null);
  const via = useRef<"pointer" | "keyboard" | null>(null);

  useLayoutEffect(() => {
    if (open && via.current === "pointer") enterBlock(body.current);
    via.current = null;
  }, [open]);

  return (
    <section className="pen-row" data-open={open || undefined} aria-labelledby={`pen-row-${id}-t`}>
      <h3 className="pen-row__h">
        <button
          type="button"
          className="pen-row__head"
          aria-expanded={open}
          aria-controls={`pen-row-${id}`}
          // Un clic sin puntero (Intro o espacio) llega con detail 0.
          onClick={(e) => {
            via.current = e.detail === 0 ? "keyboard" : "pointer";
            onToggle(via.current);
          }}
        >
          <span className="pen-row__title" id={`pen-row-${id}-t`}>
            {title}
            {dirty && (
              <span className="pis-tabs__dot" title="Cambios sin guardar">
                <span className="sr-only">(cambios sin guardar)</span>
              </span>
            )}
          </span>
          <span className="pen-row__sum">{summary}</span>
          <Icon name="chevron-down" size={16} className="pen-row__chev" />
        </button>
      </h3>
      <div className="pen-row__body" id={`pen-row-${id}`} hidden={!open} ref={body}>
        <fieldset className="pen-sheet" disabled={off}>
          <div className="pen-row__inner">{children}</div>
        </fieldset>
      </div>
    </section>
  );
}

/** Un contador de hoy contra su tope: el número, la barra y lo que pasa al llegar. */
export function Meter({ label, used, limit, unit, full }: { label: string; used: number; limit: number; unit: string; full: string }) {
  const bar = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  const share = limit > 0 ? Math.min(1, used / limit) : 0;
  const high = limit === 0 ? used > 0 : share >= 0.9;

  useLayoutEffect(() => {
    fillBar(bar.current, share, started.current ? undefined : 0);
    started.current = true;
  }, [share]);

  return (
    <div className="pis-usage pen-meter">
      <div>
        <strong>
          {used.toLocaleString("es-CO")}{" "}
          <span>
            de {limit.toLocaleString("es-CO")} {unit}
          </span>
        </strong>
        <small>{limit === 0 ? <StatusMark tone="warn">{`Tope en 0. ${full}`}</StatusMark> : high ? <StatusMark tone="warn">{`Casi en el tope. ${full}`}</StatusMark> : "Se reinicia cada día."}</small>
      </div>
      <i role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <span ref={bar} data-high={high || undefined} />
      </i>
    </div>
  );
}

/** Filas de espera: dicen que algo está llegando y qué forma tendrá. */
export function Skeleton({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div className="pen-skeleton" role="status" aria-busy="true">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} aria-hidden="true" />
      ))}
    </div>
  );
}

/** Un texto con tope: el contador avisa antes de llegar. */
export function TextArea({
  label,
  hint,
  value,
  max,
  rows = 3,
  placeholder,
  onChange,
}: {
  label: string;
  hint?: ReactNode;
  value: string;
  max: number;
  rows?: number;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  const left = max - value.length;
  return (
    <label className="pen-field">
      <span className="pen-field__label">
        {label}
        <small data-near={left <= max * 0.1 || undefined}>
          {value.length.toLocaleString("es-CO")} de {max.toLocaleString("es-CO")}
        </small>
      </span>
      <textarea rows={rows} maxLength={max} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

const ROL_TEXT: Record<string, string> = { estudiante: "Estudiante", profesor: "Profesor" };

/** Para quién: con su palabra, no solo con un color. */
export function RolTag({ rol }: { rol: string | null | undefined }) {
  const key = rol === "estudiante" || rol === "profesor" ? rol : "";
  return (
    <span className="pen-rol" data-rol={key || "general"}>
      {ROL_TEXT[key] ?? "Sin rol"}
    </span>
  );
}

/** Un panel que todavía no existe: dice qué hará y cuándo llega, sin controles de mentira. */
export function Soon({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
  return (
    <Group title={title} aside={<span className="pen-soon__tag">Llega en la próxima entrega</span>}>
      <div className="pen-soon" role="note">
        <Icon name={icon} size={20} />
        <p>{children}</p>
      </div>
    </Group>
  );
}

/** La lista entra una vez cada vez que cambia `key` (los datos que llegaron), no en cada pintada. */
export function useEnter<T extends HTMLElement>(key: unknown): RefObject<T> {
  const ref = useRef<T>(null);
  const last = useRef<unknown>(undefined);
  useLayoutEffect(() => {
    if (key === undefined || key === null || key === last.current) return;
    last.current = key;
    if (ref.current) enterList([...ref.current.children]);
  }, [key]);
  return ref;
}
