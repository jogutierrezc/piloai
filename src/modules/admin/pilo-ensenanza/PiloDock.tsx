/* =============================================================================
   Mr. Pilo en Enseñanza · el panel de Pilo.

   El único lugar de la pantalla donde vive su cara: completa y a buen tamaño
   (PiloFace encaja el dibujo aprobado entero, sin recortes ni deformación),
   fija a la izquierda en escritorio y en una franja arriba en el móvil.

     La cara        «graduado» identifica este espacio; «pensar» mientras
                    trabaja; la cara elegida para un rol, mientras se elige.
                    El cambio de pose lo funde PiloFace.
     El estado      abierto o cerrado, en palabras, y su interruptor.
     Tres datos     redacta con IA, uso de hoy y memoria; cada uno lleva a su
                    sección.
     La actividad   todo trabajo largo (leer, sincronizar, indexar, comprender,
                    probar) se cuenta aquí: qué hace, su avance y «Detener»
                    cuando se puede. Sale del almacén de actividad.

   Movimiento: la barra sigue el avance real (transform), la frase cambia con un
   fundido corto y, al guardar, Pilo asiente. Nada más se mueve.
   ========================================================================== */

import { useLayoutEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Icon } from "../../../components/ui/Icon";
import { PiloFace } from "../../../components/pilo/PiloFace";
import type { PiloFaceHandle } from "../../../components/pilo/PiloFace";
import { Switch } from "../pilo/ui";
import { activity, dockView, useActivity } from "./actividad";
import { enterList, fillBar, swapLine } from "./motion";

export interface DockFact {
  id: string;
  label: string;
  /** El valor, con su glifo (StatusMark). */
  value: ReactNode;
  /** Una nota corta bajo el valor. */
  detail?: string;
  /** 0 a 1: una barra fina bajo el dato (el uso contra su tope). */
  share?: number;
  onClick: () => void;
}

export function PiloDock({
  status,
  on,
  disabled,
  onToggle,
  facts,
  nod,
  limited = false,
  otherSpace = false,
}: {
  /** El estado en palabras: «Abierto para quien tiene sesión». */
  status: string;
  on: boolean;
  disabled: boolean;
  onToggle: (on: boolean) => void;
  /** Personal de carga documental: sin interruptor de apertura ni enlace a la conexión compartida. */
  limited?: boolean;
  /** Puede cambiar a Pilo Universidad (rol «ambos» o admin). */
  otherSpace?: boolean;
  facts: DockFact[];
  /** Cambia cada vez que se guarda: Pilo asiente una vez. */
  nod: number;
}) {
  const state = useActivity();
  const view = dockView(state);
  const root = useRef<HTMLElement>(null);
  const face = useRef<PiloFaceHandle>(null);
  const bar = useRef<HTMLSpanElement>(null);
  const say = useRef<HTMLDivElement>(null);

  // El panel entra una vez, por partes.
  useLayoutEffect(() => {
    if (root.current) enterList([...root.current.children]);
  }, []);

  useLayoutEffect(() => {
    if (nod) face.current?.nod();
  }, [nod]);

  useLayoutEffect(() => {
    if (view.share !== undefined) fillBar(bar.current, view.share);
  }, [view.share, view.busy]);

  // La frase cambia de paso: fundido corto. El primer pintado no se anima.
  const first = useRef(true);
  useLayoutEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    swapLine(say.current);
  }, [view.title]);

  return (
    <aside className="pen-dock" ref={root} aria-label="Mr. Pilo en Enseñanza: estado y actividad" data-busy={view.busy || undefined}>
      <div className="pen-dock__stage">
        <PiloFace ref={face} size="100%" expression={view.expression} alive label={view.busy ? "Mr. Pilo, pensando" : "Mr. Pilo en Enseñanza"} />
      </div>

      <p className="pen-dock__state">
        <strong>{status}</strong>
        <span>
          {limited ? (otherSpace ? "Cambiar de espacio: " : "") : "Comparte la conexión y la voz con "}
          {(!limited || otherSpace) && (
            <Link className="pen-dock__link" to="/admin/mr-pilo">
              {limited ? "Pilo Universidad" : "Mr. Pilo con IA"} <Icon name="arrow-right" size={13} />
            </Link>
          )}
        </span>
        {view.preview && <em>{view.preview}</em>}
      </p>

      {!limited && (
        <label className="pen-dock__open">
          <span>{on ? "Abierto" : "Cerrado"}</span>
          <Switch big on={on} disabled={disabled} onChange={onToggle} label="Mr. Pilo en Enseñanza abierto" />
        </label>
      )}

      <ul className="pen-dock__facts">
        {facts.map((f) => (
          <li key={f.id}>
            <button type="button" className="pen-dock__fact" onClick={f.onClick}>
              <span>{f.label}</span>
              <b>{f.value}</b>
              {f.share !== undefined && <FactBar share={f.share} />}
              {f.detail && <small>{f.detail}</small>}
            </button>
          </li>
        ))}
      </ul>

      <div className="pen-act">
        <div className="pen-act__say" role="status" aria-live="polite">
          <div ref={say}>
            <strong>{view.title}</strong>
            <span>{view.line}</span>
          </div>
          {view.busy && (
            <i
              className="pen-act__bar"
              data-loose={view.share === undefined || undefined}
              role="progressbar"
              aria-label="Avance"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={view.share === undefined ? undefined : Math.round(view.share * 100)}
            >
              {/* Otra pieza para cada modo: el barrido no hereda la escala del avance, ni al revés. */}
              <span key={view.share === undefined ? "barrido" : "avance"} ref={bar} />
            </i>
          )}
          {view.busy && (view.counter || view.waiting > 0) && (
            <small>{[view.counter, view.waiting > 0 ? (view.waiting === 1 ? "y otro trabajo en curso" : `y otros ${view.waiting} trabajos en curso`) : ""].filter(Boolean).join(" · ")}</small>
          )}
        </div>
        {view.canStop && (
          <button type="button" className="pen-act__stop" onClick={() => activity.stop()}>
            Detener
          </button>
        )}
      </div>
    </aside>
  );
}

function FactBar({ share }: { share: number }) {
  const bar = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useLayoutEffect(() => {
    fillBar(bar.current, share, started.current ? undefined : 0);
    started.current = true;
  }, [share]);
  return (
    <i className="pen-dock__meter" aria-hidden="true">
      <span ref={bar} />
    </i>
  );
}
