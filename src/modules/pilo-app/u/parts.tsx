/* =============================================================================
   Mr. Pilo · Pilo U · las piezas que comparten todas sus vistas.

   Iconos propios (un trazo, sin relleno), el marco de una vista con su
   «volver», el aviso «Próximamente» (honesto: dice qué será y por qué aún no),
   el selector de opciones y la lectura de datos con su carga y su error.
   Todo el color sale de las variables del tema.
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { PiloAvatar } from "../../../components/pilo/PiloAvatar";
import { tr } from "../../../components/pilo/i18n";
import { APP_U } from "../routes";
import type { IconoU, VistaInfo } from "./vistas";

const Svg = ({ children, size = 20 }: { children: ReactNode; size?: number }) => (
  <svg className="pu-i" viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
    {children}
  </svg>
);

const ICONOS: Record<IconoU | "check" | "right" | "left" | "ext" | "reloj" | "x" | "info", ReactNode> = {
  cal: <Svg><rect x="3" y="4.5" width="14" height="12" rx="2" /><path d="M3 8.5h14M7 3v3M13 3v3" /></Svg>,
  book: <Svg><path d="M4 4.5A1.5 1.5 0 015.5 3H16v12.5H5.5A1.5 1.5 0 004 17zM4 17V4.5M7.5 6.5h5" /></Svg>,
  chart: <Svg><path d="M3.5 3.5v13h13M6.5 12.5l3-3.5 2.5 2 4-5" /></Svg>,
  users: <Svg><circle cx="7.5" cy="7" r="2.6" /><path d="M2.5 16c.6-2.6 2.6-3.8 5-3.8s4.4 1.2 5 3.8M13 4.6a2.6 2.6 0 010 4.8M14.5 12.4c1.6.4 2.7 1.6 3 3.6" /></Svg>,
  scan: <Svg><path d="M3.5 7V4.5a1 1 0 011-1H7M13 3.5h2.5a1 1 0 011 1V7M16.5 13v2.5a1 1 0 01-1 1H13M7 16.5H4.5a1 1 0 01-1-1V13M3.5 10h13" /></Svg>,
  alert: <Svg><path d="M10 3.5l7 12.5H3zM10 8.5v3.2M10 13.8v.1" /></Svg>,
  chat: <Svg><path d="M3.5 4.5h13v9H9l-3.5 3v-3h-2v-9z" /></Svg>,
  building: <Svg><path d="M4.5 17V4.5a1 1 0 011-1h6a1 1 0 011 1V17M12.5 8.5h2a1 1 0 011 1V17M3 17h14M7.5 7h2M7.5 10h2M7.5 13h2" /></Svg>,
  bell: <Svg><path d="M5 14.5V9a5 5 0 0110 0v5.5l1.5 1.5h-13zM8.5 17.5a1.6 1.6 0 003 0" /></Svg>,
  gemini: <Svg><path d="M10 2.5c.6 4.2 3.3 6.9 7.5 7.5-4.2.6-6.9 3.3-7.5 7.5-.6-4.2-3.3-6.9-7.5-7.5 4.2-.6 6.9-3.3 7.5-7.5z" /></Svg>,
  check: <Svg><path d="M4.5 10.5l3.5 3.5 7.5-8" /></Svg>,
  right: <Svg><path d="M7.5 4.5L13 10l-5.5 5.5" /></Svg>,
  left: <Svg><path d="M12.5 4.5L7 10l5.5 5.5" /></Svg>,
  ext: <Svg><path d="M8 4.5H5.5a1 1 0 00-1 1v9a1 1 0 001 1h9a1 1 0 001-1V12M11 3.5h5.5V9M16.5 3.5L9 11" /></Svg>,
  reloj: <Svg><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></Svg>,
  x: <Svg><path d="M5.5 5.5l9 9M14.5 5.5l-9 9" /></Svg>,
  info: <Svg><circle cx="10" cy="10" r="6.5" /><path d="M10 9v4.2M10 6.6v.1" /></Svg>,
};

export const Ico = ({ n }: { n: keyof typeof ICONOS }) => <>{ICONOS[n]}</>;

/** ¿La persona pidió menos movimiento? */
export const calmado = (): boolean => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** La entrada de una vista: se desliza un poco y aparece (menos de 320 ms). Con movimiento reducido, no se anima. */
export function useEntrada<T extends HTMLElement>(dep?: unknown) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || calmado()) return;
    const tween = gsap.fromTo(el, { opacity: 0, x: 14 }, { opacity: 1, x: 0, duration: 0.28, ease: "power3.out", clearProps: "transform,opacity" });
    return () => void tween.kill();
  }, [dep]);
  return ref;
}

/** El marco de una vista de Pilo U: «volver», su título y de dónde sale. */
export function Marco({ info, children }: { info: Pick<VistaInfo, "titulo" | "fuente">; children: ReactNode }) {
  const ref = useEntrada<HTMLDivElement>();
  return (
    <div className="pu-view" ref={ref}>
      <header className="pu-top">
        <Link className="pu-back" to={APP_U} aria-label={tr("Volver a Pilo U")}>
          <Ico n="left" />
        </Link>
        <h1>{info.titulo}</h1>
        <span className="pu-chip pu-chip--mut">{info.fuente}</span>
      </header>
      <div className="pu-body">{children}</div>
    </div>
  );
}

/** Lo que aún no tiene de dónde leer: dice qué será y por qué todavía no, sin una sola cifra inventada. */
export function Proximamente({ titulo, que, porque }: { titulo: string; que: string; porque: string }) {
  return (
    <section className="pu-soon" aria-label={titulo}>
      <PiloAvatar mood="idea" size={96} />
      <h2>{tr("Próximamente")}</h2>
      <p>{que}</p>
      <p className="pu-soon__why">
        <Ico n="reloj" />
        <span>
          {tr("Aún no disponible.")} {porque}
        </span>
      </p>
    </section>
  );
}

export function Cargando({ texto }: { texto?: string }) {
  return (
    <p className="pu-wait" role="status">
      {texto ?? tr("Pilo está buscando…")}
    </p>
  );
}

export function Aviso({ texto, onRetry }: { texto: string; onRetry?: () => void }) {
  return (
    <div className="pu-note" role="alert">
      <Ico n="alert" />
      <span>{texto}</span>
      {onRetry && (
        <button type="button" className="pu-btn pu-btn--line" onClick={onRetry}>
          {tr("Reintentar")}
        </button>
      )}
    </div>
  );
}

/** Un selector de una opción entre pocas: botones de 48 px, con la elegida marcada y dicha. */
export function Seg<T extends string>({ nombre, items, valor, onChange }: { nombre: string; items: [T, string][]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="pu-seg" role="group" aria-label={nombre}>
      {items.map(([id, texto]) => (
        <button key={id} type="button" aria-pressed={valor === id} onClick={() => onChange(id)}>
          {valor === id && <Ico n="check" />}
          {texto}
        </button>
      ))}
    </div>
  );
}

export type Carga<T> = { estado: "carga" } | { estado: "ok"; datos: T } | { estado: "error"; mensaje: string };

/** Lee algo al abrir (y al reintentar). Si cambia `llave`, vuelve a leer y lo anterior se descarta. */
export function useCarga<T>(leer: (señal: AbortSignal) => Promise<T>, mensaje: (e: unknown) => string, llave: string): { carga: Carga<T>; recargar: () => void } {
  const [carga, setCarga] = useState<Carga<T>>({ estado: "carga" });
  const [n, setN] = useState(0);
  const lector = useRef(leer);
  lector.current = leer;
  const decir = useRef(mensaje);
  decir.current = mensaje;
  useEffect(() => {
    const ctl = new AbortController();
    setCarga({ estado: "carga" });
    lector.current(ctl.signal).then(
      (datos) => {
        if (!ctl.signal.aborted) setCarga({ estado: "ok", datos });
      },
      (e) => {
        if (!ctl.signal.aborted) setCarga({ estado: "error", mensaje: decir.current(e) });
      },
    );
    return () => ctl.abort();
  }, [llave, n]);
  const recargar = useCallback(() => setN((v) => v + 1), []);
  return { carga, recargar };
}

/** Descarga un texto como archivo (CSV) sin pasar por ningún servidor. */
export function descargar(nombre: string, texto: string): void {
  const url = URL.createObjectURL(new Blob([texto], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
