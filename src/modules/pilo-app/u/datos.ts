/* =============================================================================
   Mr. Pilo · Pilo U · lo que sale de las conexiones que ya existen.

   Pilo U no abre conexiones nuevas: lee si la persona ya conectó Moodle
   (clases/) y Génesis (notas/), y de Génesis toma las materias del periodo en
   curso que ya entrega el histórico. Los permisos viven en el dispositivo y
   son de la cuenta que los pidió.

   Puro: se prueba en node.
   ========================================================================== */

import { readLink as readMoodle } from "../clases/logic";
import { courseName, inProgress, readLink as readGenesis, settled } from "../notas/logic";
import type { History, LinkStore } from "../notas/logic";

export interface Vinculos {
  moodle: boolean;
  genesis: boolean;
}

/** Qué conexiones tiene la cuenta `owner` en este dispositivo. */
export function vinculos(owner: string | null | undefined, now: number = Date.now(), stores?: { moodle?: LinkStore | null; genesis?: LinkStore | null }): Vinculos {
  if (!owner) return { moodle: false, genesis: false };
  return {
    moodle: (stores?.moodle === undefined ? readMoodle(owner) : readMoodle(owner, stores.moodle)) !== null,
    genesis: (stores?.genesis === undefined ? readGenesis(owner, now) : readGenesis(owner, now, stores.genesis)) !== null,
  };
}

export interface MateriaEnCurso {
  code: string;
  name: string;
  credits: number;
  group: string;
}

export interface EnCurso {
  periodo: string;
  materias: MateriaEnCurso[];
}

/**
 * Las materias del periodo en curso: las del periodo que dice el encabezado de
 * Génesis (o, si no lo dice, el último) que aún no tienen definitiva ni están
 * aprobadas. Sin periodo con materias en curso, la lista queda vacía.
 */
export function materiasEnCurso(history: Pick<History, "periods">, current = ""): EnCurso {
  const periods = history.periods;
  const period = periods.find((p) => p.id === current) ?? periods[periods.length - 1];
  if (!period) return { periodo: "", materias: [] };
  const vigente = current || (settled(period) ? "" : period.id);
  const materias = period.courses
    .filter((c) => inProgress(period, c, vigente))
    .map((c) => ({ code: c.code, name: courseName(c.name), credits: c.credits, group: c.group }));
  return { periodo: period.id, materias };
}

/** «20252» se dice «2025-2»; «2025A», «2025-A». */
export function periodoLegible(id: string): string {
  const m = /^(\d{4})([A-Z0-9]{1,2})$/.exec(id);
  return m ? `${m[1]}-${m[2]}` : id;
}

/* --- El calendario -------------------------------------------------------------------------- */

export interface DiaMes {
  /** Día del mes, o 0 si es un hueco antes del día 1. */
  dia: number;
  hoy: boolean;
}

/** Las semanas de un mes (lunes primero) como filas de siete días. */
export function semanasDelMes(anio: number, mes: number, hoy: Date): DiaMes[][] {
  const primero = new Date(anio, mes, 1);
  const total = new Date(anio, mes + 1, 0).getDate();
  const huecos = (primero.getDay() + 6) % 7;
  const celdas: DiaMes[] = [];
  for (let i = 0; i < huecos; i++) celdas.push({ dia: 0, hoy: false });
  for (let d = 1; d <= total; d++) celdas.push({ dia: d, hoy: hoy.getFullYear() === anio && hoy.getMonth() === mes && hoy.getDate() === d });
  while (celdas.length % 7) celdas.push({ dia: 0, hoy: false });
  const semanas: DiaMes[][] = [];
  for (let i = 0; i < celdas.length; i += 7) semanas.push(celdas.slice(i, i + 7));
  return semanas;
}

/** Las entregas por día del mes (`due` va en segundos desde 1970). */
export function entregasPorDia(entregas: { due: number }[], anio: number, mes: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const e of entregas) {
    const f = new Date(e.due * 1000);
    if (f.getFullYear() === anio && f.getMonth() === mes) out.set(f.getDate(), (out.get(f.getDate()) ?? 0) + 1);
  }
  return out;
}
