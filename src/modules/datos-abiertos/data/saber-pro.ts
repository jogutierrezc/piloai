/* =============================================================================
   Datos Abiertos · resultados Saber PRO (0031).

   Lo que guarda la base son agregados: por año, sede, facultad, programa y
   competencia, cuántos evaluados hubo, su promedio, cuántos quedaron en cada
   nivel de desempeño y el reparto del puntaje en tramos de 10 puntos. Nunca
   estudiantes.

   Desde ahí se arma cualquier corte: una sede suma sus programas, una
   facultad los suyos, la institución todos. El promedio sumado es el
   ponderado por evaluados; si el ICFES publicó el promedio oficial de la
   institución (ámbito "institucion"), ese manda para el total.

   `aggregateSaberRecords` convierte los resultados individuales del Excel del
   ICFES en esas filas; la intranet la usa en el navegador y solo sube su
   salida.
   ========================================================================== */

export type SaberCompetency = "global" | "lc" | "rc" | "cc" | "ce" | "ing";
export type SaberScope = "programa" | "institucion" | "nacional";

export interface SaberResult {
  year: number;
  scope: SaberScope;
  campus: string;
  faculty: string;
  program: string;
  competency: SaberCompetency;
  evaluated: number | null;
  mean: number | null;
  /** Evaluados por nivel de desempeño ("1".."4"; en inglés "-A1".."B2"). */
  levels: Record<string, number>;
  /** Evaluados por tramo de 10 puntos: "140" es [140, 150). */
  histogram: Record<string, number>;
}

export interface SaberProData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  note: string;
  source: string;
  officeId?: string | null;
  results: SaberResult[];
}

export interface SaberCompetencyInfo {
  key: SaberCompetency;
  label: string;
  /** Dos letras del tablero. */
  code: string;
}

/** Orden fijo del selector: el global primero, luego las genéricas como las publica el ICFES. */
export const SABER_COMPETENCIES: SaberCompetencyInfo[] = [
  { key: "global", label: "Puntaje global", code: "PG" },
  { key: "lc", label: "Lectura crítica", code: "LC" },
  { key: "rc", label: "Razonamiento cuantitativo", code: "RC" },
  { key: "cc", label: "Competencias ciudadanas", code: "CC" },
  { key: "ce", label: "Comunicación escrita", code: "CE" },
  { key: "ing", label: "Inglés", code: "IN" },
];

export const competencyInfo = (key: SaberCompetency) => SABER_COMPETENCIES.find((c) => c.key === key)!;

export interface SaberLevelScale {
  /** Claves en orden, de menor a mayor desempeño. */
  keys: string[];
  labels: string[];
  /** Índice del primer nivel que cuenta como "alto". */
  high: number;
  /** Cómo se dice el umbral en una frase. */
  highLabel: string;
  /** Qué describe cada nivel, para la ayuda. */
  hints: string[];
}

const GENERIC_LEVELS: SaberLevelScale = {
  keys: ["1", "2", "3", "4"],
  labels: ["Nivel 1", "Nivel 2", "Nivel 3", "Nivel 4"],
  high: 2,
  highLabel: "nivel 3 o 4",
  hints: [
    "Desempeño mínimo: responde lo más básico de la prueba.",
    "Desempeño bajo: resuelve tareas sencillas.",
    "Desempeño alto: integra y aplica lo que sabe.",
    "Desempeño sobresaliente: domina lo que evalúa la prueba.",
  ],
};

const ENGLISH_LEVELS: SaberLevelScale = {
  keys: ["-A1", "A1", "A2", "B1", "B2"],
  labels: ["Pre A1", "A1", "A2", "B1", "B2"],
  high: 3,
  highLabel: "B1 o B2",
  hints: [
    "Por debajo de A1 en el Marco Común Europeo.",
    "Usuario básico: expresiones cotidianas muy sencillas.",
    "Usuario básico: temas conocidos y frases frecuentes.",
    "Usuario independiente: la meta de inglés para un profesional.",
    "Usuario independiente avanzado.",
  ],
};

/** El puntaje global no tiene niveles de desempeño. */
export const levelScale = (competency: SaberCompetency): SaberLevelScale | null =>
  competency === "global" ? null : competency === "ing" ? ENGLISH_LEVELS : GENERIC_LEVELS;

export interface SaberFilter {
  campus?: string;
  faculty?: string;
  program?: string;
}

export interface SaberFigure {
  year: number;
  evaluated: number;
  /** Promedio ponderado de los programas del corte. */
  mean: number | null;
  /** Promedio oficial publicado por el ICFES (solo para toda la institución). */
  official: number | null;
  /** El que se muestra: el oficial si lo hay, si no el ponderado. */
  shown: number | null;
  national: number | null;
  levels: Record<string, number>;
  /** Evaluados con nivel reportado (el denominador del reparto). */
  leveled: number;
  histogram: Record<string, number>;
}

const isAll = (filter: SaberFilter) => !filter.campus && !filter.faculty && !filter.program;

const matches = (r: SaberResult, filter: SaberFilter) =>
  r.scope === "programa" &&
  (!filter.campus || r.campus === filter.campus) &&
  (!filter.faculty || r.faculty === filter.faculty) &&
  (!filter.program || r.program === filter.program);

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Todos los años con algún resultado, en orden. */
export function saberYears(data: SaberProData): number[] {
  return Array.from(new Set(data.results.map((r) => r.year))).sort((a, b) => a - b);
}

/** Cifra de un corte para un año y una competencia. `null` si no hay nada que mostrar. */
export function saberFigure(data: SaberProData, competency: SaberCompetency, year: number, filter: SaberFilter = {}): SaberFigure | null {
  const rows = data.results.filter((r) => r.year === year && r.competency === competency);
  const parts = rows.filter((r) => matches(r, filter));
  const national = rows.find((r) => r.scope === "nacional")?.mean ?? null;
  const official = isAll(filter) ? rows.find((r) => r.scope === "institucion")?.mean ?? null : null;

  let evaluated = 0;
  let weighted = 0;
  let weight = 0;
  const levels: Record<string, number> = {};
  const histogram: Record<string, number> = {};
  for (const part of parts) {
    const n = part.evaluated ?? 0;
    evaluated += n;
    if (part.mean !== null && n > 0) {
      weighted += part.mean * n;
      weight += n;
    }
    for (const [key, count] of Object.entries(part.levels)) levels[key] = (levels[key] ?? 0) + count;
    for (const [key, count] of Object.entries(part.histogram)) histogram[key] = (histogram[key] ?? 0) + count;
  }
  const mean = weight > 0 ? round2(weighted / weight) : null;
  if (mean === null && official === null) return null;
  const leveled = Object.values(levels).reduce((a, b) => a + b, 0);
  return { year, evaluated, mean, official, shown: official ?? mean, national, levels, leveled, histogram };
}

/** Participación en niveles altos (0-100), o null sin niveles. */
export function highShare(figure: SaberFigure | null, competency: SaberCompetency): number | null {
  const scale = levelScale(competency);
  if (!figure || !scale || figure.leveled === 0) return null;
  const high = scale.keys.slice(scale.high).reduce((sum, key) => sum + (figure.levels[key] ?? 0), 0);
  return (high / figure.leveled) * 100;
}

export interface SaberCatalog {
  campuses: string[];
  /** Facultades con sus programas, en orden alfabético. */
  faculties: { name: string; programs: { name: string; campuses: string[] }[] }[];
}

const byName = (a: string, b: string) => a.localeCompare(b, "es");

/** Sedes, facultades y programas presentes en el conjunto. */
export function saberCatalog(data: SaberProData): SaberCatalog {
  const programs = data.results.filter((r) => r.scope === "programa");
  const campusOrder = ["Bucaramanga", "Cúcuta", "Valledupar", "Bogotá"];
  const campuses = Array.from(new Set(programs.map((r) => r.campus))).sort(
    (a, b) => ((campusOrder.indexOf(a) + 1 || 99) - (campusOrder.indexOf(b) + 1 || 99)) || byName(a, b),
  );
  const faculties = new Map<string, Map<string, Set<string>>>();
  for (const r of programs) {
    const faculty = r.faculty || "Sin facultad";
    const list = faculties.get(faculty) ?? new Map<string, Set<string>>();
    const at = list.get(r.program) ?? new Set<string>();
    at.add(r.campus);
    list.set(r.program, at);
    faculties.set(faculty, list);
  }
  return {
    campuses,
    faculties: Array.from(faculties.entries())
      .sort(([a], [b]) => byName(a, b))
      .map(([name, list]) => ({
        name,
        programs: Array.from(list.entries())
          .sort(([a], [b]) => byName(a, b))
          .map(([program, at]) => ({ name: program, campuses: Array.from(at) })),
      })),
  };
}

/* --- Brecha con el país: lo mismo en la ficha y en el boletín --------------------- */

/** Menos evaluados que esto y un promedio de programa no se compara con el país. */
export const SABER_FEW_MEAN = 10;
/** Menos evaluados que esto y un reparto por niveles cambia mucho de un año a otro. */
export const SABER_FEW_LEVELS = 30;

export interface SaberGapRow {
  key: string;
  label: string;
  level: "udes" | "sede" | "programa";
  filter: SaberFilter;
}

/**
 * Filas de la brecha: toda la UDES (si no hay filtro), cada sede y, debajo, sus
 * programas. Un programa es siempre de una sede: nunca se suman dos sedes.
 */
export function saberGapRows(data: SaberProData, filter: SaberFilter = {}): SaberGapRow[] {
  const catalog = saberCatalog(data);
  const rows: SaberGapRow[] = [];
  if (!filter.campus && !filter.faculty && !filter.program) rows.push({ key: "udes", label: "Toda la UDES", level: "udes", filter: {} });
  for (const campus of catalog.campuses) {
    if (filter.campus && filter.campus !== campus) continue;
    const programs = catalog.faculties
      .filter((f) => !filter.faculty || f.name === filter.faculty)
      .flatMap((f) =>
        f.programs.filter((p) => p.campuses.includes(campus) && (!filter.program || p.name === filter.program)).map((p) => ({ faculty: f.name, name: p.name })),
      )
      .sort((a, b) => byName(a.name, b.name));
    if (programs.length === 0) continue;
    rows.push({ key: campus, label: filter.faculty ? `${campus} · ${filter.faculty}` : campus, level: "sede", filter: { campus, faculty: filter.faculty } });
    programs.forEach((p) =>
      rows.push({ key: `${campus}|${p.faculty}|${p.name}`, label: p.name, level: "programa", filter: { campus, faculty: p.faculty, program: p.name } }),
    );
  }
  return rows;
}

/**
 * Tono de una brecha, en pasos y no en degradado: a menos de 3 puntos es "como
 * el país"; de 3 a 9, una diferencia; de 10 o más, una brecha.
 */
export function saberGapTone(gap: number): "neg-2" | "neg-1" | "mid" | "pos-1" | "pos-2" {
  const size = Math.abs(Math.round(gap));
  if (size < 3) return "mid";
  return `${gap > 0 ? "pos" : "neg"}-${size >= 10 ? 2 : 1}` as "neg-2" | "neg-1" | "pos-1" | "pos-2";
}

export const SABER_GAP_LEGEND = [
  { tone: "neg-2", label: "10 o más bajo el país" },
  { tone: "neg-1", label: "3 a 9 bajo" },
  { tone: "mid", label: "como el país" },
  { tone: "pos-1", label: "3 a 9 sobre" },
  { tone: "pos-2", label: "10 o más sobre el país" },
] as const;

/** Tono de cada nivel: los de abajo en terracota, más oscuros cuanto más lejos del umbral. */
export function saberLevelTone(index: number, scale: SaberLevelScale): string {
  const below = scale.high - index;
  if (below > 0) return `neg-${Math.min(3, below)}`;
  return `pos-${Math.min(2, index - scale.high + 1)}`;
}

/* --- Importación desde los resultados individuales ----------------------------- */

/** Un evaluado tal como viene del ICFES, ya leído del Excel. Nunca sale del navegador. */
export interface SaberRecord {
  year: number;
  campus: string;
  faculty: string;
  program: string;
  scores: Partial<Record<SaberCompetency, number | null>>;
  levels: Partial<Record<SaberCompetency, string | null>>;
}

/**
 * Nombres del archivo del ICFES → nombre para el público. Solo abreviaturas y
 * tildes; lo que no está aquí se publica tal como llega. La clave va sin
 * tildes y en minúsculas (ver `fold`).
 */
export const SABER_PROGRAM_NAMES: Record<string, string> = {
  "adm financiera": "Administración Financiera",
  "adm negocios": "Administración de Negocios",
  antropologia: "Antropología",
  bacteriologia: "Bacteriología",
  "comercio ext": "Comercio Exterior",
  "comun social": "Comunicación Social",
  "com social": "Comunicación Social",
  contaduria: "Contaduría Pública",
  "diseno graf": "Diseño Gráfico",
  enfermeria: "Enfermería",
  fonoaudiologia: "Fonoaudiología",
  geologia: "Geología",
  "ing agroindustrial": "Ingeniería Agroindustrial",
  "ing ambiental": "Ingeniería Ambiental",
  ingambiental: "Ingeniería Ambiental",
  "ing civil": "Ingeniería Civil",
  "ing electronica": "Ingeniería Electrónica",
  "ing industrial": "Ingeniería Industrial",
  "ing petroquimica": "Ingeniería Petroquímica",
  "ing sistemas": "Ingeniería de Sistemas",
  "ing software": "Ingeniería de Software",
  instrumentacion: "Instrumentación Quirúrgica",
  microbiologia: "Microbiología",
  psicologia: "Psicología",
  terapia: "Terapia Ocupacional",
  "veterinaria y zooctenia": "Medicina Veterinaria y Zootecnia",
  veterinaria: "Medicina Veterinaria",
};

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

export function saberProgramName(raw: string): string {
  const clean = raw.replace(/\s+/g, " ").trim();
  return SABER_PROGRAM_NAMES[fold(clean)] ?? clean;
}

/**
 * Un evaluado sin código SNIES no se asigna a ningún programa que la fuente no
 * nombre: queda en una fila propia de su sede, con el nombre que trae y esta
 * marca. Cuenta en el total de la sede, la facultad y la institución.
 */
export const SABER_NO_CODE = " · sin código SNIES";

/** Nombre publicado del programa de un evaluado; `hasCode` en false marca la fila sin código. */
export function saberProgramLabel(raw: string, hasCode = true): string {
  const name = saberProgramName(raw);
  return name && !hasCode ? `${name}${SABER_NO_CODE}` : name;
}

/** Puntaje válido: número mayor que 0. 0 y "-" son pruebas no presentadas o anuladas. */
export function saberScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value.replace(",", ".").trim()) : NaN;
  return Number.isFinite(n) && n > 0 && n <= 300 ? n : null;
}

/** Nivel válido para la competencia, normalizado ("-a1" → "-A1", 3 → "3"). */
export function saberLevel(competency: SaberCompetency, value: unknown): string | null {
  const scale = levelScale(competency);
  if (!scale || value === null || value === undefined) return null;
  const text = String(value).trim().toUpperCase();
  return scale.keys.includes(text) ? text : null;
}

/** Resultados individuales → filas de ámbito "programa". */
export function aggregateSaberRecords(records: SaberRecord[]): SaberResult[] {
  const groups = new Map<string, SaberResult & { sum: number }>();
  for (const record of records) {
    for (const { key: competency } of SABER_COMPETENCIES) {
      const score = record.scores[competency];
      if (score === null || score === undefined) continue;
      const id = [record.year, record.campus, record.faculty, record.program, competency].join("|");
      const group = groups.get(id) ?? {
        year: record.year,
        scope: "programa" as const,
        campus: record.campus,
        faculty: record.faculty,
        program: record.program,
        competency,
        evaluated: 0,
        mean: null,
        levels: {},
        histogram: {},
        sum: 0,
      };
      group.evaluated = (group.evaluated ?? 0) + 1;
      group.sum += score;
      const level = record.levels[competency];
      if (level) group.levels[level] = (group.levels[level] ?? 0) + 1;
      const bin = String(Math.min(290, Math.floor(score / 10) * 10));
      group.histogram[bin] = (group.histogram[bin] ?? 0) + 1;
      groups.set(id, group);
    }
  }
  return Array.from(groups.values()).map(({ sum, ...row }) => ({
    ...row,
    mean: row.evaluated ? round2(sum / row.evaluated) : null,
  }));
}
