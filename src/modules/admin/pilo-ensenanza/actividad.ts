/* =============================================================================
   Mr. Pilo en Enseñanza · la actividad de Pilo.

   Pilo tiene un solo lugar en la pantalla: su panel (PiloDock). Todo trabajo
   largo —leer un documento, sincronizar Moodle, indexar, comprender, probar—
   se le reporta aquí y el panel lo cuenta: pose «pensar», qué hace, la barra de
   avance y, si el trabajo se puede cortar, «Detener».

     set       un panel dice qué está haciendo Pilo (uno por dueño; el último
               que se movió es el que se cuenta).
     end       el dueño terminó: se quita lo suyo.
     preview   la cara elegida para un rol se mira en el panel, a su tamaño;
               null la suelta.

   El reductor y lo que de él se deriva (qué cara, qué frase, cuánto avance)
   son puros y tienen sus pruebas; el almacén es un módulo con suscripción
   (useSyncExternalStore), sin proveedor que envolver.
   ========================================================================== */

import { useSyncExternalStore } from "react";
import type { PiloExpression } from "../../../components/pilo/PiloFace";
import { currentReading, readingReducer } from "./memoria/flow";
import type { ReadingJob } from "./memoria/flow";

/** Un trabajo de Pilo. `stop`, solo si de verdad se puede detener. */
export type PiloJob = ReadingJob;

export interface FacePreview {
  expression: PiloExpression;
  /** Para quién es esa cara, dicho entero: «Cara de partida para el estudiante: Feliz». */
  label: string;
}

export interface ActivityState {
  jobs: PiloJob[];
  preview: FacePreview | null;
}

export type ActivityAction = { type: "set"; job: PiloJob } | { type: "end"; owner: string } | { type: "preview"; preview: FacePreview | null };

export const IDLE_ACTIVITY: ActivityState = { jobs: [], preview: null };

const samePreview = (a: FacePreview | null, b: FacePreview | null) => a === b || (a !== null && b !== null && a.expression === b.expression && a.label === b.label);

/** Devuelve el mismo objeto cuando nada cambia: así nadie se vuelve a pintar de más. */
export function activityReducer(state: ActivityState, action: ActivityAction): ActivityState {
  if (action.type === "preview") return samePreview(state.preview, action.preview) ? state : { ...state, preview: action.preview };
  if (action.type === "end" && !state.jobs.some((j) => j.owner === action.owner)) return state;
  return { ...state, jobs: readingReducer({ jobs: state.jobs }, action).jobs };
}

/** El trabajo que se cuenta: el último que se movió. Sin trabajo, null. */
export const currentJob = (state: ActivityState): PiloJob | null => currentReading({ jobs: state.jobs });

/** ¿Ese dueño tiene un trabajo en curso? */
export const isWorking = (state: ActivityState, owner: string): boolean => state.jobs.some((j) => j.owner === owner);

/** El avance del trabajo, de 0 a 1; `undefined` si no se conoce (no se inventa un porcentaje). */
export function jobShare(job: PiloJob | null): number | undefined {
  if (!job || job.progress === undefined || !Number.isFinite(job.progress)) return undefined;
  return Math.max(0, Math.min(1, job.progress));
}

export const IDLE_TITLE = "Sin trabajo en curso";
export const IDLE_LINE = "Cuando Pilo lea, indexe o comprenda, el avance aparece aquí.";

export interface DockView {
  /** La cara del panel: pensar si trabaja; si no, la que se está eligiendo; si no, la suya. */
  expression: PiloExpression;
  busy: boolean;
  title: string;
  line: string;
  counter: string | null;
  share: number | undefined;
  /** Cuántos trabajos más hay detrás del que se cuenta. */
  waiting: number;
  /** La cara que se está mirando (solo sin trabajo en curso). */
  preview: string | null;
  canStop: boolean;
}

/** Lo que muestra el panel de Pilo con ese estado. `base` es la cara de este espacio. */
export function dockView(state: ActivityState, base: PiloExpression = "graduado"): DockView {
  const job = currentJob(state);
  if (job) {
    return {
      expression: "pensar",
      busy: true,
      title: job.title,
      line: job.line,
      counter: job.counter ?? null,
      share: jobShare(job),
      waiting: state.jobs.length - 1,
      preview: null,
      canStop: typeof job.stop === "function",
    };
  }
  return {
    expression: state.preview?.expression ?? base,
    busy: false,
    title: IDLE_TITLE,
    line: IDLE_LINE,
    counter: null,
    share: undefined,
    waiting: 0,
    preview: state.preview?.label ?? null,
    canStop: false,
  };
}

/* --- El almacén ---------------------------------------------------------------------------- */

let state: ActivityState = IDLE_ACTIVITY;
const listeners = new Set<() => void>();

function dispatch(action: ActivityAction) {
  const next = activityReducer(state, action);
  if (next === state) return;
  state = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

export const activity = {
  set: (job: PiloJob) => dispatch({ type: "set", job }),
  end: (owner: string) => dispatch({ type: "end", owner }),
  preview: (preview: FacePreview | null) => dispatch({ type: "preview", preview }),
  get: () => state,
  /** Detiene el trabajo que se cuenta, si se puede. */
  stop: () => currentJob(state)?.stop?.(),
};

export const useActivity = (): ActivityState => useSyncExternalStore(subscribe, activity.get, activity.get);
export const useCurrentJob = (): PiloJob | null => useSyncExternalStore(subscribe, () => currentJob(state), () => null);
