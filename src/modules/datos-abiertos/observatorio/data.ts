/* =============================================================================
   Observatorio de Analítica Académica · DATOS DE EJEMPLO.

   Maqueta. Ninguna cifra de este archivo es real: sirven para diseñar el
   portal mientras se define de dónde sale cada conjunto (microdatos por
   oficina, cargas por Excel desde la intranet). Toda página que las muestre
   lleva el aviso «Datos de ejemplo».

   A diferencia de los informes de UDES en Cifras, el Observatorio no publica
   indicadores con meta y corte: publica conjuntos de datos brutos o poco
   agregados para explorar. Cada tema trae tres vistas de ejemplo:
   · serie: una magnitud año a año;
   · reparto: cómo se divide un total en categorías;
   · tabla: registros agregados con varias columnas, para ordenar y buscar.
   ========================================================================== */

export interface ObsSeries {
  title: string;
  unit: string;
  points: [label: string, value: number][];
}

export interface ObsShare {
  title: string;
  unit: string;
  items: [label: string, value: number][];
}

export interface ObsTable {
  title: string;
  columns: { key: string; label: string; numeric?: boolean; unit?: string }[];
  rows: Record<string, string | number>[];
}

export interface ObsTopic {
  slug: string;
  /** Código de dos letras del tablero. */
  code: string;
  name: string;
  /** Una línea para el tablero. */
  summary: string;
  /** Qué pregunta responde la página. */
  question: string;
  /** Color de línea 1-11 (--od-line-n). */
  line: number;
  /** Quién alimentará el conjunto cuando haya datos reales. */
  source: string;
  headline: { label: string; value: number; unit: string; format?: "entero" | "decimal" | "porcentaje" };
  series: ObsSeries;
  share: ObsShare;
  table: ObsTable;
}

const YEARS = ["2020", "2021", "2022", "2023", "2024", "2025"];
const serie = (title: string, unit: string, values: number[]): ObsSeries => ({ title, unit, points: YEARS.map((y, i) => [y, values[i]]) });

export const OBS_TOPICS: ObsTopic[] = [
  {
    slug: "presentacion-institucional", code: "PI", line: 1,
    name: "Presentación Institucional",
    summary: "La universidad en cifras básicas: campus, facultades, programas y comunidad.",
    question: "¿Qué es la UDES, dónde está y cuántos la conforman?",
    source: "Planeación Institucional",
    headline: { label: "Programas académicos", value: 64, unit: "programas" },
    series: serie("Comunidad universitaria", "personas", [11850, 12120, 12460, 12710, 12980, 13240]),
    share: { title: "Programas por nivel de formación", unit: "programas", items: [["Pregrado universitario", 34], ["Especialización", 16], ["Tecnológico", 7], ["Maestría", 6], ["Doctorado", 1]] },
    table: {
      title: "Campus",
      columns: [{ key: "campus", label: "Campus" }, { key: "fac", label: "Facultades", numeric: true }, { key: "prog", label: "Programas", numeric: true }, { key: "est", label: "Estudiantes", numeric: true }, { key: "prof", label: "Profesores", numeric: true }],
      rows: [
        { campus: "Bucaramanga", fac: 6, prog: 38, est: 6420, prof: 612 },
        { campus: "Valledupar", fac: 5, prog: 16, est: 2710, prof: 248 },
        { campus: "Cúcuta", fac: 4, prog: 10, est: 1180, prof: 131 },
      ],
    },
  },
  {
    slug: "oferta-academica", code: "OA", line: 2,
    name: "Oferta Académica",
    summary: "Programas vigentes por facultad, nivel, modalidad y campus.",
    question: "¿Qué se puede estudiar en la UDES, en qué modalidad y dónde?",
    source: "Vicerrectoría Académica",
    headline: { label: "Programas con registro vigente", value: 61, unit: "programas" },
    series: serie("Programas ofertados", "programas", [52, 55, 57, 59, 61, 64]),
    share: { title: "Programas por facultad", unit: "programas", items: [["Ciencias de la Salud", 19], ["Ingenierías", 13], ["Ciencias Económicas", 11], ["Ciencias Sociales y Jurídicas", 10], ["Ciencias Exactas", 6], ["Educación", 5]] },
    table: {
      title: "Programas (muestra)",
      columns: [{ key: "prog", label: "Programa" }, { key: "nivel", label: "Nivel" }, { key: "mod", label: "Modalidad" }, { key: "campus", label: "Campus" }, { key: "rc", label: "Registro hasta" }],
      rows: [
        { prog: "Medicina", nivel: "Universitario", mod: "Presencial", campus: "Bucaramanga", rc: "2029" },
        { prog: "Enfermería", nivel: "Universitario", mod: "Presencial", campus: "Valledupar", rc: "2028" },
        { prog: "Derecho", nivel: "Universitario", mod: "Presencial", campus: "Cúcuta", rc: "2027" },
        { prog: "Ingeniería de Sistemas", nivel: "Universitario", mod: "Virtual", campus: "Bucaramanga", rc: "2030" },
        { prog: "Administración Financiera", nivel: "Universitario", mod: "Presencial", campus: "Valledupar", rc: "2028" },
        { prog: "Maestría en Salud Pública", nivel: "Maestría", mod: "Presencial", campus: "Bucaramanga", rc: "2031" },
        { prog: "Tecnología en Gestión Logística", nivel: "Tecnológico", mod: "Virtual", campus: "Cúcuta", rc: "2027" },
      ],
    },
  },
  {
    slug: "alertas-tempranas", code: "AT", line: 6,
    name: "Alertas Tempranas",
    summary: "Estudiantes con señales de riesgo académico, financiero o psicosocial, y su atención.",
    question: "¿Cuántos estudiantes muestran señales de riesgo y cuántos reciben atención a tiempo?",
    source: "Bienestar Universitario · Vicerrectoría Académica",
    headline: { label: "Alertas activas en el periodo", value: 1284, unit: "alertas" },
    series: serie("Alertas registradas por año", "alertas", [2140, 2310, 1980, 1760, 1510, 1284]),
    share: { title: "Alertas por tipo", unit: "alertas", items: [["Académica", 612], ["Asistencia", 298], ["Financiera", 221], ["Psicosocial", 153]] },
    table: {
      title: "Atención por facultad",
      columns: [{ key: "fac", label: "Facultad" }, { key: "alert", label: "Alertas", numeric: true }, { key: "aten", label: "Atendidas", numeric: true }, { key: "pct", label: "Atención", numeric: true, unit: "%" }],
      rows: [
        { fac: "Ciencias de la Salud", alert: 421, aten: 377, pct: 89.5 },
        { fac: "Ingenierías", alert: 298, aten: 241, pct: 80.9 },
        { fac: "Ciencias Económicas", alert: 236, aten: 199, pct: 84.3 },
        { fac: "Ciencias Sociales y Jurídicas", alert: 201, aten: 171, pct: 85.1 },
        { fac: "Ciencias Exactas", alert: 128, aten: 97, pct: 75.8 },
      ],
    },
  },
  {
    slug: "poblacion-estudiantil", code: "PB", line: 3,
    name: "Población Estudiantil",
    summary: "Matrícula por campus, nivel, jornada y periodo.",
    question: "¿Cuántos estudiantes tiene la UDES y cómo se reparten?",
    source: "Admisiones y Registro Académico",
    headline: { label: "Estudiantes matriculados", value: 10310, unit: "estudiantes" },
    series: serie("Matrícula total (periodo 2)", "estudiantes", [9330, 9670, 9690, 9630, 9920, 10310]),
    share: { title: "Matrícula por campus", unit: "estudiantes", items: [["Bucaramanga", 6420], ["Valledupar", 2710], ["Cúcuta", 1180]] },
    table: {
      title: "Matrícula por nivel",
      columns: [{ key: "nivel", label: "Nivel" }, { key: "prim", label: "Primer ingreso", numeric: true }, { key: "tot", label: "Total", numeric: true }, { key: "muj", label: "Mujeres", numeric: true, unit: "%" }],
      rows: [
        { nivel: "Universitario", prim: 2140, tot: 8520, muj: 63.1 },
        { nivel: "Tecnológico", prim: 410, tot: 980, muj: 51.4 },
        { nivel: "Especialización", prim: 380, tot: 520, muj: 58.7 },
        { nivel: "Maestría", prim: 110, tot: 270, muj: 55.2 },
        { nivel: "Doctorado", prim: 6, tot: 20, muj: 45.0 },
      ],
    },
  },
  {
    slug: "profesores", code: "PR", line: 4,
    name: "Profesores",
    summary: "Planta docente por formación, dedicación, escalafón y campus.",
    question: "¿Quiénes enseñan en la UDES y con qué formación y dedicación?",
    source: "Talento Humano",
    headline: { label: "Profesores", value: 991, unit: "profesores" },
    series: serie("Profesores por año", "profesores", [902, 918, 931, 948, 967, 991]),
    share: { title: "Máximo nivel de formación", unit: "profesores", items: [["Maestría", 486], ["Especialización", 271], ["Doctorado", 118], ["Pregrado", 116]] },
    table: {
      title: "Dedicación por campus",
      columns: [{ key: "campus", label: "Campus" }, { key: "tc", label: "Tiempo completo", numeric: true }, { key: "mt", label: "Medio tiempo", numeric: true }, { key: "cat", label: "Cátedra", numeric: true }],
      rows: [
        { campus: "Bucaramanga", tc: 298, mt: 104, cat: 210 },
        { campus: "Valledupar", tc: 112, mt: 41, cat: 95 },
        { campus: "Cúcuta", tc: 58, mt: 22, cat: 51 },
      ],
    },
  },
  {
    slug: "diversidad-equidad-inclusion", code: "DE", line: 10,
    name: "Diversidad, Equidad e Inclusión",
    summary: "Estudiantes de grupos de protección constitucional y su trayectoria.",
    question: "¿Cómo avanzan en la universidad los estudiantes de grupos de protección constitucional?",
    source: "Admisiones y Registro Académico",
    headline: { label: "Estudiantes de grupos especiales", value: 2350, unit: "estudiantes" },
    series: serie("Estudiantes de grupos especiales", "estudiantes", [1150, 1060, 1900, 1910, 2130, 2350]),
    share: { title: "Por grupo", unit: "estudiantes", items: [["Pertenencia étnica", 1450], ["Víctimas del conflicto", 1240], ["Zona rural", 750], ["Discapacidad", 250]] },
    table: {
      title: "Permanencia por grupo (cohorte de ejemplo)",
      columns: [{ key: "grupo", label: "Grupo" }, { key: "ing", label: "Ingresaron", numeric: true }, { key: "sig", label: "Siguen al 4.º semestre", numeric: true }, { key: "pct", label: "Permanencia", numeric: true, unit: "%" }],
      rows: [
        { grupo: "Pertenencia étnica", ing: 410, sig: 312, pct: 76.1 },
        { grupo: "Víctimas del conflicto", ing: 356, sig: 259, pct: 72.8 },
        { grupo: "Zona rural", ing: 214, sig: 158, pct: 73.8 },
        { grupo: "Discapacidad", ing: 71, sig: 55, pct: 77.5 },
      ],
    },
  },
  {
    slug: "valor-agregado", code: "VA", line: 2,
    name: "Valor Agregado Académico",
    summary: "Cuánto avanzan los estudiantes entre Saber 11 y Saber PRO o TyT.",
    question: "¿Cuánto aporta la universidad al desempeño de sus estudiantes?",
    source: "Aseguramiento de la Calidad",
    headline: { label: "Programas con valor agregado positivo", value: 27, unit: "programas" },
    series: serie("Valor agregado medio (percentiles)", "percentiles", [2.1, 3.4, 2.8, 4.2, 5.1, 4.7]),
    share: { title: "Programas según su valor agregado", unit: "programas", items: [["Positivo", 27], ["Sin diferencia", 14], ["Negativo", 6]] },
    table: {
      title: "Programas (muestra)",
      columns: [{ key: "prog", label: "Programa" }, { key: "ent", label: "Percentil de entrada", numeric: true }, { key: "sal", label: "Percentil de salida", numeric: true }, { key: "va", label: "Valor agregado", numeric: true }],
      rows: [
        { prog: "Enfermería", ent: 41, sal: 52, va: 11 },
        { prog: "Derecho", ent: 38, sal: 45, va: 7 },
        { prog: "Ingeniería Industrial", ent: 47, sal: 51, va: 4 },
        { prog: "Contaduría Pública", ent: 35, sal: 37, va: 2 },
        { prog: "Psicología", ent: 44, sal: 43, va: -1 },
      ],
    },
  },
  {
    slug: "vinculacion-laboral", code: "VL", line: 8,
    name: "Vinculación Laboral de Egresados",
    summary: "Egresados con empleo formal, sector y tiempo hasta el primer empleo.",
    question: "¿Consiguen empleo los egresados de la UDES, dónde y en cuánto tiempo?",
    source: "Oficina de Egresados",
    headline: { label: "Tasa de vinculación formal", value: 78.4, unit: "%", format: "porcentaje" },
    series: serie("Tasa de vinculación formal", "%", [71.2, 69.8, 73.5, 75.1, 76.9, 78.4]),
    share: { title: "Egresados vinculados por sector", unit: "egresados", items: [["Salud", 1240], ["Servicios", 860], ["Educación", 410], ["Industria", 390], ["Sector público", 350]] },
    table: {
      title: "Por programa (muestra)",
      columns: [{ key: "prog", label: "Programa" }, { key: "tasa", label: "Vinculación", numeric: true, unit: "%" }, { key: "meses", label: "Meses al primer empleo", numeric: true }],
      rows: [
        { prog: "Medicina", tasa: 92.3, meses: 3 },
        { prog: "Enfermería", tasa: 88.1, meses: 4 },
        { prog: "Ingeniería de Sistemas", tasa: 83.6, meses: 5 },
        { prog: "Derecho", tasa: 71.4, meses: 8 },
        { prog: "Administración de Empresas", tasa: 68.9, meses: 9 },
      ],
    },
  },
  {
    slug: "desercion-academica", code: "DA", line: 3,
    name: "Deserción Académica",
    summary: "Deserción por periodo y por cohorte, con sus causas principales.",
    question: "¿Cuántos estudiantes dejan sus estudios, cuándo y por qué?",
    source: "Planeación Institucional",
    headline: { label: "Deserción por periodo", value: 6.6, unit: "%", format: "porcentaje" },
    series: serie("Deserción por periodo", "%", [8.4, 7.9, 7.3, 7.0, 6.8, 6.6]),
    share: { title: "Causa principal de retiro", unit: "estudiantes", items: [["Económica", 318], ["Académica", 241], ["Personal o familiar", 176], ["Cambio de programa", 98], ["Otra", 57]] },
    table: {
      title: "Deserción acumulada por cohorte",
      columns: [{ key: "coh", label: "Cohorte" }, { key: "s2", label: "Semestre 2", numeric: true, unit: "%" }, { key: "s4", label: "Semestre 4", numeric: true, unit: "%" }, { key: "s6", label: "Semestre 6", numeric: true, unit: "%" }, { key: "s10", label: "Semestre 10", numeric: true, unit: "%" }],
      rows: [
        { coh: "2018-1", s2: 13.1, s4: 24.8, s6: 31.2, s10: 38.4 },
        { coh: "2019-1", s2: 12.4, s4: 23.5, s6: 29.8, s10: 36.9 },
        { coh: "2020-1", s2: 14.2, s4: 25.1, s6: 30.6, s10: 37.2 },
        { coh: "2021-1", s2: 11.8, s4: 21.9, s6: 27.4, s10: "—" },
      ],
    },
  },
  {
    slug: "internacionalizacion", code: "IX", line: 1,
    name: "Internacionalización",
    summary: "Movilidad entrante y saliente, convenios y visibilidad internacional.",
    question: "¿Con qué países se conecta la UDES y cuántas personas se mueven?",
    source: "Dirección de Relaciones Internacionales",
    headline: { label: "Personas en movilidad", value: 412, unit: "personas" },
    series: serie("Movilidad total por año", "personas", [96, 58, 187, 281, 356, 412]),
    share: { title: "Movilidad por país (principales)", unit: "personas", items: [["México", 98], ["España", 76], ["Argentina", 54], ["Brasil", 41], ["Chile", 37], ["Otros", 106]] },
    table: {
      title: "Convenios vigentes por región",
      columns: [{ key: "reg", label: "Región" }, { key: "conv", label: "Convenios", numeric: true }, { key: "inst", label: "Instituciones", numeric: true }],
      rows: [
        { reg: "América Latina", conv: 58, inst: 51 },
        { reg: "Europa", conv: 34, inst: 29 },
        { reg: "Norteamérica", conv: 9, inst: 8 },
        { reg: "Asia", conv: 4, inst: 4 },
      ],
    },
  },
  {
    slug: "caracterizacion-estudiante", code: "CE", line: 11,
    name: "Caracterización del Estudiante",
    summary: "Quiénes son los estudiantes: edad, estrato, familia, trabajo y hábitos.",
    question: "¿Cómo son los estudiantes que llegan a la UDES?",
    source: "Bienestar Universitario",
    headline: { label: "Respuestas a la caracterización", value: 1262, unit: "respuestas" },
    series: serie("Respuestas por año", "respuestas", [640, 812, 904, 2340, 2151, 1262]),
    share: { title: "Edad al ingresar", unit: "respuestas", items: [["16 a 19 años", 684], ["20 a 24 años", 402], ["25 a 29 años", 104], ["30 años o más", 72]] },
    table: {
      title: "Rasgos por campus",
      columns: [{ key: "campus", label: "Campus" }, { key: "trab", label: "Trabaja", numeric: true, unit: "%" }, { key: "prim", label: "Primera generación", numeric: true, unit: "%" }, { key: "est12", label: "Estratos 1 y 2", numeric: true, unit: "%" }],
      rows: [
        { campus: "Bucaramanga", trab: 21.4, prim: 23.1, est12: 44.0 },
        { campus: "Valledupar", trab: 17.8, prim: 30.1, est12: 76.5 },
        { campus: "Cúcuta", trab: 24.9, prim: 25.4, est12: 45.2 },
      ],
    },
  },
  {
    slug: "calidad-institucional", code: "CC", line: 5,
    name: "Cifras de Calidad Institucional",
    summary: "Acreditación, registros calificados y resultados de autoevaluación.",
    question: "¿Qué dicen los procesos de calidad sobre la universidad y sus programas?",
    source: "Aseguramiento de la Calidad",
    headline: { label: "Programas acreditados en alta calidad", value: 14, unit: "programas" },
    series: serie("Programas acreditados", "programas", [8, 9, 10, 11, 13, 14]),
    share: { title: "Programas acreditados por facultad", unit: "programas", items: [["Ciencias de la Salud", 6], ["Ingenierías", 3], ["Ciencias Económicas", 2], ["Ciencias Sociales y Jurídicas", 2], ["Educación", 1]] },
    table: {
      title: "Autoevaluación por factor (muestra)",
      columns: [{ key: "fac", label: "Factor" }, { key: "cal", label: "Calificación", numeric: true }, { key: "grado", label: "Grado de cumplimiento" }],
      rows: [
        { fac: "Misión y proyecto institucional", cal: 4.6, grado: "Pleno" },
        { fac: "Estudiantes", cal: 4.4, grado: "Alto" },
        { fac: "Profesores", cal: 4.3, grado: "Alto" },
        { fac: "Investigación", cal: 4.0, grado: "Alto" },
        { fac: "Bienestar institucional", cal: 4.5, grado: "Pleno" },
      ],
    },
  },
  {
    slug: "factores-rendimiento", code: "FR", line: 9,
    name: "Factores Asociados con el Rendimiento",
    summary: "Qué se asocia, al ingresar, con un mejor promedio en el primer semestre.",
    question: "¿Qué rasgos al ingresar acompañan un mejor rendimiento académico?",
    source: "Planeación Institucional",
    headline: { label: "Estudiantes con promedio de 3,8 o más", value: 54.3, unit: "%", format: "porcentaje" },
    series: serie("Promedio del primer semestre", "puntos", [3.61, 3.58, 3.66, 3.70, 3.72, 3.75]),
    share: { title: "Nivel Saber 11 en matemáticas al ingresar", unit: "estudiantes", items: [["Niveles 3 y 4", 844], ["Niveles 1 y 2", 695]] },
    table: {
      title: "Promedio alto según el factor (muestra)",
      columns: [{ key: "fac", label: "Factor" }, { key: "con", label: "Con el rasgo", numeric: true, unit: "%" }, { key: "sin", label: "Sin el rasgo", numeric: true, unit: "%" }],
      rows: [
        { fac: "Matemáticas Saber 11, niveles 3-4", con: 66.2, sin: 42.1 },
        { fac: "Ciencias naturales, niveles 3-4", con: 64.7, sin: 49.3 },
        { fac: "Trabaja mientras estudia", con: 58.1, sin: 54.0 },
        { fac: "Primera generación universitaria", con: 51.6, sin: 55.8 },
      ],
    },
  },
  {
    slug: "seguimiento-graduados", code: "SG", line: 7,
    name: "Seguimiento de Graduados",
    summary: "Graduados por año, programa y nivel, y su trayectoria después del grado.",
    question: "¿Cuántos se gradúan y qué pasa con ellos después?",
    source: "Secretaría General · Oficina de Egresados",
    headline: { label: "Graduados en el año", value: 3190, unit: "graduados" },
    series: serie("Graduados por año", "graduados", [2840, 2610, 2980, 3050, 3120, 3190]),
    share: { title: "Graduados por nivel", unit: "graduados", items: [["Universitario", 1980], ["Especialización", 710], ["Tecnológico", 290], ["Maestría", 205], ["Doctorado", 5]] },
    table: {
      title: "Trayectoria a un año del grado (muestra)",
      columns: [{ key: "prog", label: "Programa" }, { key: "grad", label: "Graduados", numeric: true }, { key: "emp", label: "Empleados", numeric: true, unit: "%" }, { key: "pos", label: "Estudian un posgrado", numeric: true, unit: "%" }],
      rows: [
        { prog: "Medicina", grad: 148, emp: 91.2, pos: 22.3 },
        { prog: "Enfermería", grad: 212, emp: 87.5, pos: 9.4 },
        { prog: "Derecho", grad: 176, emp: 70.1, pos: 14.8 },
        { prog: "Ingeniería de Sistemas", grad: 98, emp: 82.7, pos: 11.2 },
      ],
    },
  },
];

export const findTopic = (slug: string | undefined) => OBS_TOPICS.find((t) => t.slug === slug);
