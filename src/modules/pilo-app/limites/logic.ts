/* =============================================================================
   Mr. Pilo · «Mis límites de Pilo» · la lógica pura.

   REGLA DE VERDAD: aquí solo se muestran límites que existen de verdad en el
   servidor (pilo_my_limits(), 0141, y los contadores de la función pilo-ia):

     · preguntas      un tope por VENTANA de tiempo (p. ej. 60 cada 10 minutos),
                      no por día. 0 en la base = sin tope.
     · archivos       si la administración dejó analizarlos a quienes tienen
                      sesión, el tamaño máximo y cuántos por día (0 = sin tope).
     · código         si Pilo puede escribir código para esta cuenta.

   No hay «preguntas por día» ni «minutos de llamada» por persona en el servidor
   (el cupo diario de pilo-ia es de toda la universidad, no de cada cuenta): esos
   renglones no existen aquí. Cuando algo no tiene tope, se dice «Sin tope fijo».

   El aviso llega al 80 % de un tope.

   Puro: se prueba en node.
   ========================================================================== */

import type { LimitsConfig, LimitsUse, SpaceLimits } from "../carnet/api";
import { tr } from "../../../components/pilo/i18n";

export const WARN_AT = 0.8;

export interface Meter {
  used: number;
  max: number;
  left: number;
  /** De 0 a 1. */
  pct: number;
  warn: boolean;
  spent: boolean;
  /** Segundos hasta que el contador empieza de cero. */
  renews: number;
}

export interface LimitRow {
  id: "preguntas" | "archivos" | "archivo_mb" | "codigo";
  label: string;
  /** El valor en palabras: «Sin tope fijo», «10 MB», «No incluido». */
  value: string;
  /** Con tope y con uso conocido: la barra. */
  meter: Meter | null;
  /** Detalle corto bajo el renglón. */
  note: string;
  /** El renglón está apagado (no habilitado). */
  off: boolean;
}

export interface SpaceView {
  space: string;
  rows: LimitRow[];
  /** El mayor aviso de la sección, para el aviso del chat. */
  questions: Meter | null;
}

/** «10 minutos», «1 hora», «24 horas». */
export function windowText(seconds: number): string {
  if (seconds >= 86_400 && seconds % 86_400 === 0) return seconds === 86_400 ? tr("el día") : tr("{n} días", { n: seconds / 86_400 });
  if (seconds >= 3600 && seconds % 3600 === 0) return seconds === 3600 ? tr("1 hora") : tr("{n} horas", { n: seconds / 3600 });
  if (seconds >= 60) {
    const m = Math.round(seconds / 60);
    return m === 1 ? tr("1 minuto") : tr("{n} minutos", { n: m });
  }
  return tr("{n} segundos", { n: seconds });
}

/** «3 h 20 min», «12 min», «45 s». */
export function renewText(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  if (s >= 60) return `${Math.ceil(s / 60)} min`;
  return `${s} s`;
}

export function meterOf(used: number, max: number, renews: number): Meter {
  const u = Math.max(0, Math.min(used, max));
  return { used: u, max, left: Math.max(0, max - u), pct: max > 0 ? u / max : 0, warn: max > 0 && u / max >= WARN_AT, spent: max > 0 && u >= max, renews };
}

type Use = LimitsUse["uso"][string] | undefined;

export function spaceView(space: string, c: SpaceLimits, use: Use): SpaceView {
  const rows: LimitRow[] = [];

  // Preguntas: un tope por ventana de tiempo, o ninguno.
  let questions: Meter | null = null;
  if (c.preguntas_max > 0) {
    questions = use?.preguntas ? meterOf(use.preguntas.usadas, c.preguntas_max, use.preguntas.renueva_en) : null;
    rows.push({ id: "preguntas", label: tr("Preguntas"), value: tr("{n} cada {t}", { n: c.preguntas_max, t: windowText(c.ventana_s) }), meter: questions, note: "", off: false });
  } else {
    rows.push({ id: "preguntas", label: tr("Preguntas"), value: tr("Sin tope fijo"), meter: null, note: "", off: false });
  }

  // Archivos: si están habilitados, cuántos por día y de qué tamaño.
  if (!c.archivos) {
    rows.push({ id: "archivos", label: tr("Analizar archivos"), value: tr("No habilitado"), meter: null, note: tr("La administración decide quién puede usarlo."), off: true });
  } else {
    const meter = c.archivos_dia > 0 && use?.archivos ? meterOf(use.archivos.usadas, c.archivos_dia, use.archivos.renueva_en) : null;
    rows.push({ id: "archivos", label: tr("Archivos por día"), value: c.archivos_dia > 0 ? String(c.archivos_dia) : tr("Sin tope fijo"), meter, note: "", off: false });
    rows.push({ id: "archivo_mb", label: tr("Tamaño de cada archivo"), value: `${c.archivo_mb} MB`, meter: null, note: tr("Lo fija la administración."), off: false });
  }

  rows.push({ id: "codigo", label: tr("Escribir código"), value: c.codigo ? tr("Incluido") : tr("No incluido"), meter: null, note: "", off: !c.codigo });

  return { space, rows, questions };
}

export function limitsView(config: LimitsConfig | null, use: LimitsUse["uso"] | null): SpaceView[] {
  if (!config) return [];
  return Object.entries(config.espacios).map(([space, c]) => spaceView(space, c, use?.[space]));
}

/** Lo que dice el aviso del chat; null si no hay nada que avisar. */
export function bannerText(q: Meter | null, always = false): string | null {
  if (!q) return null;
  if (q.spent) return tr("Llegó al límite de preguntas. Se renueva en {t}.", { t: renewText(q.renews) });
  if (!q.warn && !always) return null;
  return q.left === 1 ? tr("Le queda 1 pregunta · se renueva en {t}", { t: renewText(q.renews) }) : tr("Le quedan {n} preguntas · se renuevan en {t}", { n: q.left, t: renewText(q.renews) });
}
