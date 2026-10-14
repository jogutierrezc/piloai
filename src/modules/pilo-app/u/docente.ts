/* =============================================================================
   Mr. Pilo · Pilo U · lo que necesita quien enseña: grupos, listas, notas por corte y asistencia.

   Hoy Pilo solo lee de Génesis lo del propio estudiante (histórico y polígrafo):
   la función `pilo-genesis` NO entrega los grupos de un profesor, sus listas ni
   sus horarios, y escribir asistencia en Génesis necesita un permiso que no
   existe. Por eso las pantallas del profesor se escriben contra esta interfaz,
   `DocenteData`, y la que viene por defecto (`SIN_DOCENTE`) responde «no
   disponible»: las pantallas dicen «Próximamente» y no inventan nada. El día que
   haya backend, solo se enchufa otro proveedor.

   Lo que se calcula (promedio, % que aprueba, reparto en cuatro rangos, riesgo,
   conteo de asistencia) se calcula aquí, en el teléfono, con lo que el proveedor
   entregue. Privacidad: el proveedor entrega solo los estudiantes de los grupos
   del profesor; nada de esto se comparte.

   Puro: se prueba en node.
   ========================================================================== */

export const PASA = 3;
export const FALTAS_RIESGO = 4;

export interface GrupoDoc {
  id: string;
  materia: string;
  grupo: string;
  estudiantes: number;
}

export interface Sesion {
  /** 0 = domingo … 6 = sábado. */
  dia: number;
  /** Hora de inicio y de fin, en horas decimales (7,5 = 7:30). */
  desde: number;
  hasta: number;
  materia: string;
  grupo: string;
  salon: string;
}

export interface Estudiante {
  id: string;
  nombre: string;
}

export type Corte = "p1" | "p2" | "p3";
export const CORTES: Corte[] = ["p1", "p2", "p3"];

/** Las notas de un estudiante por corte; null = aún sin nota. */
export interface NotasEstudiante {
  id: string;
  p1: number | null;
  p2: number | null;
  p3: number | null;
}

export type Marca = "" | "P" | "A" | "T" | "E";
export const MARCAS: Marca[] = ["", "P", "A", "T", "E"];

export interface Asistencia {
  grupo: string;
  /** AAAA-MM-DD. */
  fecha: string;
  marcas: Record<string, Marca>;
}

export type Razon = "no_disponible" | "sin_sesion" | "error";
export type Resp<T> = { ok: true; data: T } | { ok: false; razon: Razon };

export interface DocenteData {
  grupos(): Promise<Resp<GrupoDoc[]>>;
  horario(): Promise<Resp<Sesion[]>>;
  lista(grupo: string): Promise<Resp<Estudiante[]>>;
  notas(grupo: string): Promise<Resp<NotasEstudiante[]>>;
  /** Cuántas inasistencias lleva cada estudiante de un grupo (id → faltas). */
  faltas(grupo: string): Promise<Resp<Record<string, number>>>;
  /** La asistencia se guarda en Pilo; Génesis no se toca. */
  guardarAsistencia(a: Asistencia): Promise<Resp<null>>;
  enviarMensaje(grupo: string, texto: string): Promise<Resp<null>>;
}

const NO: { ok: false; razon: Razon } = { ok: false, razon: "no_disponible" };
const no = () => Promise.resolve(NO);

/** El proveedor de hoy: no hay de dónde sacar nada, y lo dice. */
export const SIN_DOCENTE: DocenteData = {
  grupos: no,
  horario: no,
  lista: no,
  notas: no,
  faltas: no,
  guardarAsistencia: no,
  enviarMensaje: no,
};

/* --- El boletín ----------------------------------------------------------------------------- */

export type Rango = 0 | 1 | 2 | 3;
/** Los cuatro rangos del reparto: 0,0 a 1,9 · 2,0 a 2,9 · 3,0 a 3,9 · 4,0 a 5,0. */
export const RANGOS = ["0,0 a 1,9", "2,0 a 2,9", "3,0 a 3,9", "4,0 a 5,0"] as const;

export const rangoDe = (n: number): Rango => (n < 2 ? 0 : n < 3 ? 1 : n < 4 ? 2 : 3);

const valida = (n: number | null | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 5;

export interface Boletin {
  /** Estudiantes del grupo y cuántos tienen nota en el corte. */
  total: number;
  conNota: number;
  promedio: number | null;
  /** Porcentaje (0 a 100) de los que tienen nota y llegan a 3,0; null sin notas. */
  aprueba: number | null;
  reparto: [number, number, number, number];
  /** Los que están por debajo de 3,0, de la nota más baja a la más alta. */
  debajo: { id: string; nota: number; antes: number | null }[];
}

export function boletin(notas: NotasEstudiante[], corte: Corte): Boletin {
  const reparto: [number, number, number, number] = [0, 0, 0, 0];
  const debajo: Boletin["debajo"] = [];
  let suma = 0;
  let con = 0;
  let pasan = 0;
  for (const e of notas) {
    const n = e[corte];
    if (!valida(n)) continue;
    con += 1;
    suma += n;
    reparto[rangoDe(n)] += 1;
    if (n >= PASA) pasan += 1;
    else debajo.push({ id: e.id, nota: n, antes: corte === "p2" && valida(e.p1) ? e.p1 : corte === "p3" && valida(e.p2) ? e.p2 : null });
  }
  debajo.sort((a, b) => a.nota - b.nota);
  return {
    total: notas.length,
    conNota: con,
    promedio: con ? Math.round((suma / con) * 100) / 100 : null,
    aprueba: con ? Math.round((pasan / con) * 1000) / 10 : null,
    reparto,
    debajo,
  };
}

/** El último corte en que el grupo ya tiene alguna nota. */
export function corteVigente(notas: NotasEstudiante[]): Corte {
  for (const c of [...CORTES].reverse()) if (notas.some((e) => valida(e[c]))) return c;
  return "p1";
}

/* --- Estudiantes en riesgo ------------------------------------------------------------------ */

export type Motivo = { tipo: "nota"; corte: Corte; nota: number } | { tipo: "faltas"; n: number };

export interface EnRiesgo {
  id: string;
  grupo: string;
  motivos: Motivo[];
}

/** Nota por debajo de 3,0 en el último corte con nota, o 4 inasistencias o más. */
export function enRiesgo(grupo: string, notas: NotasEstudiante[], faltas: Record<string, number>): EnRiesgo[] {
  const corte = corteVigente(notas);
  const ids = new Set<string>([...notas.map((e) => e.id), ...Object.keys(faltas)]);
  const out: EnRiesgo[] = [];
  for (const id of ids) {
    const motivos: Motivo[] = [];
    const n = notas.find((e) => e.id === id)?.[corte];
    if (valida(n) && n < PASA) motivos.push({ tipo: "nota", corte, nota: n });
    const f = faltas[id] ?? 0;
    if (f >= FALTAS_RIESGO) motivos.push({ tipo: "faltas", n: f });
    if (motivos.length) out.push({ id, grupo, motivos });
  }
  const peor = (r: EnRiesgo) => r.motivos.reduce((min, m) => (m.tipo === "nota" ? Math.min(min, m.nota) : min), 5);
  return out.sort((a, b) => b.motivos.length - a.motivos.length || peor(a) - peor(b) || a.id.localeCompare(b.id));
}

/* --- La asistencia -------------------------------------------------------------------------- */

export interface Conteo {
  presentes: number;
  ausentes: number;
  tardeOExcusa: number;
  sinMarcar: number;
}

export function conteo(ids: string[], marcas: Record<string, Marca>): Conteo {
  const c: Conteo = { presentes: 0, ausentes: 0, tardeOExcusa: 0, sinMarcar: 0 };
  for (const id of ids) {
    const m = marcas[id] ?? "";
    if (m === "P") c.presentes += 1;
    else if (m === "A") c.ausentes += 1;
    else if (m === "T" || m === "E") c.tardeOExcusa += 1;
    else c.sinMarcar += 1;
  }
  return c;
}

/** El siguiente estado al tocar la fila: sin marcar, presente, ausente, tarde, excusa y vuelta. */
export const siguienteMarca = (m: Marca): Marca => MARCAS[(MARCAS.indexOf(m) + 1) % MARCAS.length];

export const todosPresentes = (ids: string[]): Record<string, Marca> => Object.fromEntries(ids.map((id) => [id, "P" as Marca]));

const CSV_ESTADO: Record<Marca, string> = { "": "Sin marcar", P: "Presente", A: "Ausente", T: "Tarde", E: "Excusa" };

const celda = (v: string): string => {
  // Una celda que empieza como fórmula se neutraliza para que Excel no la ejecute.
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[";\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

const csv = (filas: string[][]): string => "﻿" + filas.map((f) => f.map(celda).join(";")).join("\r\n") + "\r\n";

/** La asistencia en CSV (abre en Excel), con los nombres de la lista. */
export function asistenciaCsv(a: Asistencia, lista: Estudiante[]): string {
  return csv([["Fecha", "Grupo", "Estudiante", "Estado"], ...lista.map((e) => [a.fecha, a.grupo, e.nombre, CSV_ESTADO[a.marcas[e.id] ?? ""]])]);
}

/** El boletín en CSV. */
export function boletinCsv(lista: Estudiante[], notas: NotasEstudiante[], nombreGrupo: string): string {
  const por = new Map(notas.map((n) => [n.id, n]));
  const f = (n: number | null | undefined) => (valida(n) ? String(n).replace(".", ",") : "");
  return csv([["Grupo", "Estudiante", "P1", "P2", "P3"], ...lista.map((e) => [nombreGrupo, e.nombre, f(por.get(e.id)?.p1), f(por.get(e.id)?.p2), f(por.get(e.id)?.p3)])]);
}

/* --- El horario ----------------------------------------------------------------------------- */

/** Las sesiones de un día, por hora de inicio. */
export const sesionesDelDia = (sesiones: Sesion[], dia: number): Sesion[] => sesiones.filter((s) => s.dia === dia).sort((a, b) => a.desde - b.desde);

/** 7,5 se dice «7:30». */
export function hora(x: number): string {
  const h = Math.floor(x);
  const m = Math.round((x - h) * 60);
  return `${h}:${m < 10 ? "0" : ""}${m}`;
}
