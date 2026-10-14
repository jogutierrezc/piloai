/* =============================================================================
   Mr. Pilo · Pilo U · qué ve cada quien.

   Lo que muestra Pilo U depende del rol de la cuenta de Pilo (estudiante,
   profesor, administrativo). Cada vista dice de dónde sale (Génesis, Moodle,
   UDES o Pilo) y qué conexión necesita. Los textos pasan por tr() al pedirlos,
   no al cargar el archivo, para que sigan el idioma de la pantalla.

   Puro: se prueba en node.
   ========================================================================== */

import type { UVista } from "../routes";
import type { PiloRol } from "../account/rules";
import { tr } from "../../../components/pilo/i18n";

export type Fuente = "Génesis" | "Moodle" | "UDES" | "Pilo";
/** La conexión que pide: Génesis y Moodle son las de la persona; «ninguna» no pide nada. */
export type Necesita = "genesis" | "moodle" | "ninguna";
export type IconoU = "cal" | "book" | "chart" | "users" | "scan" | "alert" | "chat" | "building" | "bell" | "gemini";

export interface VistaInfo {
  id: UVista;
  titulo: string;
  pista: string;
  fuente: Fuente;
  necesita: Necesita;
  icono: IconoU;
  /** Tiene datos reales hoy. Si no, se muestra «Próximamente» con su explicación. */
  real: boolean;
}

export function vistaInfo(id: UVista): VistaInfo {
  switch (id) {
    case "presenciales":
      return { id, titulo: tr("Mis clases presenciales"), pista: tr("Las materias del periodo en curso"), fuente: "Génesis", necesita: "genesis", icono: "cal", real: true };
    case "virtuales":
      return { id, titulo: tr("Mis clases virtuales"), pista: tr("Cursos, actividades y entregas"), fuente: "Moodle", necesita: "moodle", icono: "book", real: true };
    case "notas":
      return { id, titulo: tr("Mis notas"), pista: tr("Promedio, evolución y meta"), fuente: "Génesis", necesita: "genesis", icono: "chart", real: true };
    case "calendario":
      return { id, titulo: tr("Calendario académico"), pista: tr("Entregas y fechas importantes"), fuente: "UDES", necesita: "ninguna", icono: "cal", real: true };
    case "grupos":
      return { id, titulo: tr("Mis grupos"), pista: tr("Los grupos que dicto"), fuente: "Génesis", necesita: "genesis", icono: "users", real: false };
    case "gruposv":
      return { id, titulo: tr("Mis grupos virtuales"), pista: tr("Mis cursos en Moodle"), fuente: "Moodle", necesita: "moodle", icono: "book", real: true };
    case "horario":
      return { id, titulo: tr("Mi horario de clases"), pista: tr("La semana por días, con salones"), fuente: "Génesis", necesita: "genesis", icono: "cal", real: false };
    case "boletin":
      return { id, titulo: tr("Boletín de notas de mis clases"), pista: tr("Promedios, distribución y riesgo"), fuente: "Génesis", necesita: "genesis", icono: "chart", real: false };
    case "asistencia":
      return { id, titulo: tr("Tomar asistencia"), pista: tr("Por lista, y con carnets más adelante"), fuente: "Pilo", necesita: "ninguna", icono: "scan", real: false };
    case "riesgo":
      return { id, titulo: tr("Estudiantes en riesgo"), pista: tr("Notas bajas e inasistencias"), fuente: "Génesis", necesita: "genesis", icono: "alert", real: false };
    case "mensaje":
      return { id, titulo: tr("Mensaje a un grupo"), pista: tr("Un aviso a sus estudiantes"), fuente: "Moodle", necesita: "moodle", icono: "chat", real: false };
    case "dependencia":
      return { id, titulo: tr("Mi dependencia"), pista: tr("Su equipo y los indicadores de su unidad"), fuente: "UDES", necesita: "ninguna", icono: "building", real: false };
    case "avisos":
      return { id, titulo: tr("Avisos de la universidad"), pista: tr("Comunicados y alertas del campus"), fuente: "UDES", necesita: "ninguna", icono: "bell", real: false };
  }
}

/** Los grupos de filas del inicio, por rol, en el orden en que se muestran. */
const HUB: Record<PiloRol, { titulo: string; vistas: UVista[] }[]> = {
  estudiante: [
    { titulo: "Mis clases", vistas: ["presenciales", "virtuales"] },
    { titulo: "Mi avance", vistas: ["notas", "calendario"] },
  ],
  profesor: [
    { titulo: "Mis clases", vistas: ["grupos", "gruposv", "horario"] },
    { titulo: "Evaluación", vistas: ["boletin", "asistencia", "riesgo"] },
    { titulo: "Comunicación y fechas", vistas: ["mensaje", "calendario"] },
  ],
  administrativo: [{ titulo: "Mi universidad", vistas: ["dependencia", "calendario", "avisos"] }],
};

export interface GrupoVistas {
  titulo: string;
  vistas: VistaInfo[];
}

export function hubDe(rol: PiloRol | null | undefined): GrupoVistas[] {
  if (!rol) return [];
  return HUB[rol].map((g) => ({ titulo: tr(g.titulo), vistas: g.vistas.map(vistaInfo) }));
}

/** Las vistas que existen para un rol. */
export const vistasDe = (rol: PiloRol | null | undefined): UVista[] => (rol ? HUB[rol].flatMap((g) => g.vistas) : []);

/** ¿Este rol puede abrir esta vista? Una dirección de otro rol no la abre. */
export const puedeVer = (rol: PiloRol | null | undefined, vista: UVista): boolean => vistasDe(rol).includes(vista);

/** ¿El rol enseña? Tiene Gemini y las vistas de grupo. */
export const tieneGemini = (rol: PiloRol | null | undefined): boolean => rol === "estudiante" || rol === "profesor";

/** Qué es lo que llegará, para las vistas que aún no tienen de dónde leer. */
export function proximamente(id: UVista): { que: string; porque: string } {
  switch (id) {
    case "grupos":
      return { que: tr("Aquí verá los grupos que dicta, con su número de estudiantes."), porque: tr("Génesis aún no entrega a Pilo los grupos de un profesor.") };
    case "horario":
      return { que: tr("Aquí verá su semana por días, con las horas y los salones de cada clase."), porque: tr("Génesis aún no entrega a Pilo los horarios con salones.") };
    case "boletin":
      return { que: tr("Aquí verá, por corte, el promedio de cada grupo, cuántos aprueban, cómo se reparten las notas y quiénes están por debajo de 3,0."), porque: tr("Génesis aún no entrega a Pilo las listas ni las notas de sus grupos.") };
    case "asistencia":
      return { que: tr("Aquí tomará la asistencia por lista, y escaneando carnets cuando llegue el carnet con su verificador."), porque: tr("Pilo aún no recibe las listas de sus grupos.") };
    case "riesgo":
      return { que: tr("Aquí verá a los estudiantes de sus grupos con una nota por debajo de 3,0 o con 4 inasistencias o más."), porque: tr("Pilo aún no recibe las notas ni la asistencia de sus grupos.") };
    case "mensaje":
      return { que: tr("Aquí escribirá un aviso a un grupo y saldrá por Moodle."), porque: tr("Pilo hoy solo lee de Moodle; enviar mensajes necesita un permiso que aún no existe.") };
    case "dependencia":
      return { que: tr("Aquí verá a su equipo, sus procesos y los indicadores de su unidad, tomados de la estructura institucional."), porque: tr("Esta vista aún está en diseño.") };
    case "avisos":
      return { que: tr("Aquí verá los comunicados y las alertas del campus, con su fuente. Las emergencias llegan como notificación."), porque: tr("Esta vista aún está en diseño.") };
    default:
      return { que: "", porque: "" };
  }
}
