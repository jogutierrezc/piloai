/* =============================================================================
   Dominio del PDI: lo que no son datos.

   Este archivo contenía los seis pilares y sus cifras escritos a mano. Ahora
   los datos viven en Supabase y aquí solo queda lo que traduce la base de
   datos a la interfaz: colores, glifos, formatos y etiquetas.
   ========================================================================== */

import type {
  ActivityStatus,
  ActivityTarget,
  FacultyAction,
  FacultyActionStatus,
  FacultyPillarCell,
  PdiSummary,
  PillarProgress,
  ProgressScope,
  PublicationStatus,
  YearProgress,
} from "../types/database";

/* --- Estados -------------------------------------------------------------- */

export interface StatusMeta {
  id: ActivityStatus;
  label: string;
  /** Codificación secundaria: el estado nunca se comunica solo con color. */
  glyph: string;
  color: string;
}

export const statusMeta: Record<ActivityStatus, StatusMeta> = {
  cumplida: { id: "cumplida", label: "Cumplido", glyph: "✓", color: "var(--status-done)" },
  curso: { id: "curso", label: "En curso", glyph: "◐", color: "var(--status-active)" },
  pendiente: { id: "pendiente", label: "Pendiente", glyph: "○", color: "var(--status-pending)" },
  riesgo: { id: "riesgo", label: "En riesgo", glyph: "▲", color: "var(--status-risk)" },
};

/** Orden fijo de los segmentos del avance: cumplido → en curso → pendiente → riesgo. */
export const statusOrder: ActivityStatus[] = ["cumplida", "curso", "pendiente", "riesgo"];

export const publicationLabels: Record<PublicationStatus, string> = {
  borrador: "Borrador",
  revision: "En revisión",
  publicado: "Publicado",
  archivado: "Archivado",
};

/* --- Serie anual de los indicadores ----------------------------------------
   El PDI cubre 2024-2028 y su línea base es 2023. Los años viven aquí y en
   ningún otro sitio: la base admite cualquiera, pero los formularios y las
   tablas abren solo estos para que dos personas no capturen el mismo corte con
   dos rejillas distintas.
   -------------------------------------------------------------------------- */

export const planYears = [2024, 2025, 2026, 2027, 2028] as const;

/** Año de la línea base que se propone al crear un indicador. */
export const baselineYear = 2023;

/** "Meta 24" — la cabecera del reporte usa el año en dos cifras. */
export function shortYear(year: number): string {
  return String(year).slice(-2);
}

/**
 * Cumplimiento de un año: resultado sobre meta. Es la misma fórmula que la
 * columna generada de `activity_targets`; se repite aquí solo para que el
 * formulario muestre la cifra mientras se escribe, antes de guardar.
 */
export function computeCompliance(
  target: number | null,
  result: number | null,
): number | null {
  if (target === null || result === null || target === 0) return null;
  return Math.round((result * 100) / target);
}

/** El año más reciente con cumplimiento: el que fija el avance del indicador. */
export function latestTarget(targets: ActivityTarget[]): ActivityTarget | null {
  return (
    [...targets]
      .filter((row) => row.compliance !== null)
      .sort((a, b) => b.year - a.year)[0] ?? null
  );
}

/* --- Tiempo real del plan --------------------------------------------------
   El tiempo transcurrido salía de `indicators.elapsed_label` y
   `elapsed_progress`: dos campos que alguien escribía a mano y que envejecían
   solos —decían "18 meses" en pantalla mientras el calendario iba por 32—.

   El horizonte del plan es un dato del calendario, no del reporte: se calcula.
   Nadie tiene que acordarse de actualizarlo y no puede quedar desalineado.
   -------------------------------------------------------------------------- */

/** 1 de enero del primer año del plan. */
export const planStart = new Date(planYears[0], 0, 1);
/** 31 de diciembre del último: el plan se cierra con el año, no antes. */
export const planEnd = new Date(planYears[planYears.length - 1], 11, 31);

export interface PlanElapsed {
  /** Porcentaje del horizonte ya recorrido, 0-100. */
  progress: number;
  /** "2 años y 8 meses" */
  label: string;
  /** "de 5 años · 2024-2028" */
  caption: string;
  /** Falso antes de que arranque el plan o después de cerrarlo. */
  running: boolean;
}

function monthsBetween(from: Date, to: Date): number {
  const months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  // La fracción del mes en curso: sin ella la barra daría saltos de un mes
  // entero y el porcentaje se quedaría quieto treinta días seguidos.
  const daysInMonth = new Date(to.getFullYear(), to.getMonth() + 1, 0).getDate();
  return months + (to.getDate() - 1) / daysInMonth;
}

/** Cuánto del horizonte del plan va recorrido a día de hoy. */
export function planElapsed(reference: Date = new Date()): PlanElapsed {
  const total = monthsBetween(planStart, planEnd);
  const span = `de ${planYears.length} años · ${planYears[0]}-${planYears[planYears.length - 1]}`;

  if (reference <= planStart) {
    return { progress: 0, label: "Sin iniciar", caption: span, running: false };
  }
  if (reference >= planEnd) {
    return { progress: 100, label: "Horizonte cumplido", caption: span, running: false };
  }

  const elapsed = monthsBetween(planStart, reference);
  const years = Math.floor(elapsed / 12);
  const months = Math.floor(elapsed % 12);

  const parts: string[] = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "año" : "años"}`);
  if (months > 0) parts.push(`${months} ${months === 1 ? "mes" : "meses"}`);
  if (parts.length === 0) parts.push("menos de un mes");

  return {
    progress: Math.round((elapsed / total) * 100),
    label: parts.join(" y "),
    caption: span,
    running: true,
  };
}

/* --- Presupuesto -----------------------------------------------------------
   El plan no tiene una cifra de presupuesto propia: la tiene cada proyecto, en
   `projects.total_value`. Sumarlos es la única cifra de dinero que el portal
   puede sostener, y es una **estimación**: es lo que los proyectos declaran que
   valen, no lo que se ha girado.

   Lo ejecutado se publica en cero a propósito. No hay ningún campo donde se
   registre ejecución presupuestal, así que cualquier otra cifra sería inventada.
   -------------------------------------------------------------------------- */

/** Suma del valor declarado de un conjunto de proyectos. */
export function estimatedBudget(projects: { total_value: number | null }[]): number {
  return projects.reduce((total, project) => total + (project.total_value ?? 0), 0);
}

/** Cuántos de esos proyectos traen cifra: el resto no suma y conviene decirlo. */
export function budgetedCount(projects: { total_value: number | null }[]): number {
  return projects.filter((project) => project.total_value !== null && project.total_value > 0).length;
}

/** Lo ejecutado, mientras no exista dónde registrarlo. */
export const EXECUTED_BUDGET = 0;

/** Los años a mostrar: los del plan más cualquiera ya capturado fuera de rango. */
export function yearsInPlay(targets: ActivityTarget[]): number[] {
  const years = new Set<number>(planYears);
  for (const row of targets) years.add(row.year);
  return [...years].sort((a, b) => a - b);
}

/** 28 → "28", 28.5 → "28,5". Sin decimales de relleno en una tabla de cifras. */
export function formatValue(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("es-CO", { maximumFractionDigits: 2 });
}

/* --- Avance por año --------------------------------------------------------
   `v_year_progress` llega como una lista plana de (ámbito, entidad, año,
   avance). Las tablas la necesitan al revés: dada una fila y un año, su cifra.
   Este índice hace esa vuelta una sola vez por pantalla.
   -------------------------------------------------------------------------- */

/** Dónde está puesta la barra de años: un corte del plan, o el plan entero. */
export type YearScope = number | "plan";

/** Un año del horizonte con su cifra. Null = ese año no se ha reportado. */
export interface YearStop {
  year: number;
  progress: number | null;
}

/**
 * Avance del plan.
 *
 * Los cinco años del horizonte pesan lo mismo y **los que todavía no se han
 * reportado cuentan como cero**: el 100 % no se alcanza hasta cerrar 2028. Es
 * una pregunta distinta de "cómo se cumplió lo comprometido hasta ahora" —para
 * eso está el cumplimiento de cada año— y da siempre una cifra más baja.
 *
 * Un plan que va perfecto marca 40 % a finales de 2025, y eso es correcto: le
 * quedan tres años por cumplir.
 */
export function planProgress(at: (year: number) => number | null): number {
  const total = planYears.reduce((sum, year) => sum + (at(year) ?? 0), 0);
  return Math.round(total / planYears.length);
}

export interface YearIndex {
  /** Años con algo reportado, de menor a mayor. */
  years: number[];
  /** Avance de una entidad en un año. Null = ese año no se reportó. */
  at: (scope: ProgressScope, id: string, year: number) => number | null;
  /** La serie completa de una entidad, ya ordenada. Solo los años con dato. */
  of: (scope: ProgressScope, id: string) => { year: number; progress: number }[];
  /** Los cinco años del plan, con hueco donde no hay dato. Para la barra. */
  series: (scope: ProgressScope, id: string) => YearStop[];
  /** Avance del plan de esa entidad, ponderado hasta 2028. */
  plan: (scope: ProgressScope, id: string) => number;
}

export function indexYearProgress(rows: YearProgress[]): YearIndex {
  const byEntity = new Map<string, Map<number, number>>();
  const years = new Set<number>();

  for (const row of rows) {
    const key = `${row.scope}:${row.entity_id}`;
    const bucket = byEntity.get(key) ?? new Map<number, number>();
    bucket.set(row.year, row.progress);
    byEntity.set(key, bucket);
    years.add(row.year);
  }

  const at = (scope: ProgressScope, id: string, year: number) =>
    byEntity.get(`${scope}:${id}`)?.get(year) ?? null;

  return {
    years: [...years].sort((a, b) => a - b),
    at,
    of: (scope, id) =>
      [...(byEntity.get(`${scope}:${id}`) ?? new Map())]
        .map(([year, progress]) => ({ year, progress }))
        .sort((a, b) => a.year - b.year),
    series: (scope, id) => planYears.map((year) => ({ year, progress: at(scope, id, year) })),
    plan: (scope, id) => planProgress((year) => at(scope, id, year)),
  };
}

/**
 * El mismo cálculo para un conjunto de entidades del mismo nivel: el tablero
 * necesita "los seis pilares en 2025" y "los seis pilares en el plan".
 *
 * Cada entidad pesa lo mismo, igual que en `v_pdi_summary`: sumar indicadores
 * daría más voz a los pilares con más filas.
 *
 * Las dos lecturas tratan el silencio de forma distinta, a propósito:
 *
 * - **Un año concreto** promedia solo a quien lo reportó. Contar como cero a un
 *   pilar que aún no ha entregado ese corte diría "no cumplió" donde solo hay
 *   "todavía no se sabe".
 *
 * - **El plan** cuenta como cero los años no reportados de quien ya reporta:
 *   ahí el cero sí significa algo —queda por cumplir— y es lo que hace que el
 *   100 % solo llegue al cerrar el último año del horizonte.
 *
 * `roster` da el conjunto completo y, por entidad, el número que se publicaba
 * antes de la serie anual. Una entidad sin ningún año capturado conserva ese
 * valor en la posición del plan, igual que hace la cascada: aplicar la
 * ponderación a quien no ha empezado a reportar por años la mandaría a cero de
 * golpe.
 */
export interface YearAggregate {
  /** Promedio de las entidades que reportaron ese año. Null = ninguna. */
  at: (year: number) => number | null;
  /** Los cinco años del plan, con hueco donde no hay dato. */
  series: YearStop[];
  /** Avance del plan del conjunto, ponderado hasta el final del horizonte. */
  plan: number;
}

export interface RosterEntry {
  id: string;
  /** Avance acumulado, para las entidades que aún no reportan por años. */
  fallback: number;
}

export function aggregateYears(rows: YearProgress[], roster?: RosterEntry[]): YearAggregate {
  const byYear = new Map<number, number[]>();
  const byEntity = new Map<string, Map<number, number>>();

  for (const row of rows) {
    byYear.set(row.year, [...(byYear.get(row.year) ?? []), row.progress]);
    const bucket = byEntity.get(row.entity_id) ?? new Map<number, number>();
    bucket.set(row.year, row.progress);
    byEntity.set(row.entity_id, bucket);
  }

  const at = (year: number) => {
    const values = byYear.get(year);
    if (!values || values.length === 0) return null;
    return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  };

  const entries: RosterEntry[] =
    roster ?? [...byEntity.keys()].map((id) => ({ id, fallback: 0 }));

  const planes = entries.map((entry) => {
    const bucket = byEntity.get(entry.id);
    if (!bucket || bucket.size === 0) return entry.fallback;
    return planProgress((year) => bucket.get(year) ?? null);
  });

  return {
    at,
    series: planYears.map((year) => ({ year, progress: at(year) })),
    plan:
      planes.length === 0
        ? 0
        : Math.round(planes.reduce((sum, value) => sum + value, 0) / planes.length),
  };
}

/** Etiqueta de la posición de la barra, para los rótulos que la acompañan. */
export function yearScopeLabel(scope: YearScope): string {
  return scope === "plan" ? `Plan ${planYears[0]}-${planYears[planYears.length - 1]}` : String(scope);
}

/* --- Proyectos --------------------------------------------------------------
   Tres listas cerradas. Viven aquí y no en `parameters` porque ninguna de las
   tres la decide la universidad: los ODS son los de Naciones Unidas, y los
   tipos de impacto y de plazo son la nomenclatura del formato de proyectos.
   Si algún día hay que editarlas desde la intranet, pasan a ser catálogos.
   -------------------------------------------------------------------------- */

export interface SdgGoal {
  id: number;
  label: string;
  /** Color oficial del objetivo. Se usa como refuerzo, nunca como único dato. */
  color: string;
  /**
   * Con qué tinta se escribe encima de `color`.
   *
   * No es una preferencia: diez de los diecisiete colores oficiales no llegan a
   * 4,5:1 con texto blanco —el amarillo del objetivo 7 se queda en 1,62:1, que
   * es ilegible—. Cada objetivo lleva la tinta que sí pasa, elegida una vez y
   * escrita aquí en vez de recalculada en cada pintado.
   *
   * Es un valor fijo y no un token: el fondo es el color de Naciones Unidas en
   * los dos temas, así que la tinta tampoco puede cambiar con el tema.
   */
  ink: string;
}

export const sdgGoals: SdgGoal[] = [
  { id: 1, label: "Fin de la pobreza", color: "#e5243b", ink: "#ffffff" },
  { id: 2, label: "Hambre cero", color: "#dda63a", ink: "#11202f" },
  { id: 3, label: "Salud y bienestar", color: "#4c9f38", ink: "#11202f" },
  { id: 4, label: "Educación de calidad", color: "#c5192d", ink: "#ffffff" },
  { id: 5, label: "Igualdad de género", color: "#ff3a21", ink: "#11202f" },
  { id: 6, label: "Agua limpia y saneamiento", color: "#26bde2", ink: "#11202f" },
  { id: 7, label: "Energía asequible y no contaminante", color: "#fcc30b", ink: "#11202f" },
  { id: 8, label: "Trabajo decente y crecimiento económico", color: "#a21942", ink: "#ffffff" },
  { id: 9, label: "Industria, innovación e infraestructura", color: "#fd6925", ink: "#11202f" },
  { id: 10, label: "Reducción de las desigualdades", color: "#dd1367", ink: "#ffffff" },
  { id: 11, label: "Ciudades y comunidades sostenibles", color: "#fd9d24", ink: "#11202f" },
  { id: 12, label: "Producción y consumo responsables", color: "#bf8b2e", ink: "#11202f" },
  { id: 13, label: "Acción por el clima", color: "#3f7e44", ink: "#ffffff" },
  { id: 14, label: "Vida submarina", color: "#0a97d9", ink: "#11202f" },
  { id: 15, label: "Vida de ecosistemas terrestres", color: "#56c02b", ink: "#11202f" },
  { id: 16, label: "Paz, justicia e instituciones sólidas", color: "#00689d", ink: "#ffffff" },
  { id: 17, label: "Alianzas para lograr los objetivos", color: "#19486a", ink: "#ffffff" },
];

export const sdgById = new Map(sdgGoals.map((goal) => [goal.id, goal]));

/* --- El plan visto desde los ODS -------------------------------------------
   La relación entre el PDI y los ODS no está declarada en ninguna parte: se
   deduce de los proyectos, que son los que marcan a qué objetivos aportan. Un
   pilar aporta a un ODS si alguno de sus proyectos lo marca.

   El recuento se hace aquí y no en una vista de la base porque depende de qué
   proyectos puede ver quien mira: con RLS, un anónimo solo ve los de pilares
   públicos, y una vista agregada le daría totales de proyectos que no puede
   abrir.
   -------------------------------------------------------------------------- */

/** Lo mínimo que necesita el recuento; encaja con `ProjectWithLinks`. */
export interface SdgCountable {
  sdg_goals: number[] | null;
  pillar_ids?: string[] | null;
  pillar_id?: string | null;
  total_value?: number | null;
}

export interface SdgContribution<T extends SdgCountable> {
  goal: SdgGoal;
  /** Proyectos que declaran aportar a este objetivo. */
  projects: T[];
  /** Pilares desde los que se aporta, sin repetir. */
  pillarIds: string[];
  /** Valor estimado de esos proyectos. Un proyecto que aporta a tres ODS suma
   *  su valor en los tres: la cifra responde "cuánto se mueve alrededor de este
   *  objetivo", no reparte el presupuesto entre objetivos. */
  value: number;
}

/** Los diecisiete objetivos con lo que el plan les aporta. Siempre los 17: los
 *  que nadie toca también dicen algo, y desaparecerlos lo escondería. */
export function tallySdg<T extends SdgCountable>(projects: T[]): SdgContribution<T>[] {
  const buckets = new Map<number, { projects: T[]; pillars: Set<string>; value: number }>();
  for (const goal of sdgGoals) {
    buckets.set(goal.id, { projects: [], pillars: new Set(), value: 0 });
  }

  for (const project of projects) {
    // Un proyecto puede repetir un número en su arreglo; contarlo dos veces
    // duplicaría su valor dentro del mismo objetivo.
    for (const id of new Set(project.sdg_goals ?? [])) {
      const bucket = buckets.get(id);
      if (!bucket) continue; // Un número fuera de 1-17 no es un objetivo.
      bucket.projects.push(project);
      bucket.value += project.total_value ?? 0;
      for (const pillarId of pillarsOfProject(project)) bucket.pillars.add(pillarId);
    }
  }

  return sdgGoals.map((goal) => {
    const bucket = buckets.get(goal.id)!;
    return {
      goal,
      projects: bucket.projects,
      pillarIds: [...bucket.pillars],
      value: bucket.value,
    };
  });
}

/** Los pilares a los que apunta un proyecto, con respaldo para los anteriores
 *  al módulo de vínculos. */
export function pillarsOfProject(project: SdgCountable): string[] {
  if (project.pillar_ids?.length) return project.pillar_ids;
  return project.pillar_id ? [project.pillar_id] : [];
}

/* --- Dónde entra un proyecto en un pilar ------------------------------------
   El espejo en la interfaz de la vista `v_project_entry` (migración 0014). Un
   proyecto puede apuntar a un pilar de tres formas —a una línea, a un área
   entera o al pilar entero— y la ficha tiene que filtrar y dibujar la cadena
   con los vínculos de **ese** pilar, no con `projects.action_line_id`, que es
   siempre el del vínculo principal.

   Mientras la ficha usó el campo principal, un proyecto compartido mostraba en
   el pilar B una cadena inventada: el nombre del pilar B seguido del área y la
   línea del pilar A. Y al filtrar por un área del pilar B desaparecía, aunque
   su vínculo apuntara justo a una línea de esa área.
   -------------------------------------------------------------------------- */

/** Un punto de entrada del proyecto en un pilar. */
export interface ProjectEntry {
  areaId: string | null;
  lineId: string | null;
}

interface LinkedProject {
  pillar_id: string | null;
  action_line_id: string | null;
  links?: { pillar_id: string; area_id: string | null; action_line_id: string | null }[];
}

/**
 * Por dónde entra el proyecto en este pilar.
 *
 * Devuelve un punto por vínculo, en el orden en que se capturaron. Vacío = el
 * proyecto no toca este pilar. Un solo punto con las dos partes en null = está
 * vinculado al pilar entero, sin área ni línea.
 */
export function entriesForPillar(project: LinkedProject, pillarId: string): ProjectEntry[] {
  const links = (project.links ?? []).filter((link) => link.pillar_id === pillarId);
  if (links.length > 0) {
    return links.map((link) => ({ areaId: link.area_id, lineId: link.action_line_id }));
  }

  // Respaldo para un proyecto sin vínculos —anterior al módulo, o insertado a
  // mano—: su pilar y su línea de siempre. Es el mismo respaldo que la vista.
  if (project.pillar_id !== pillarId) return [];
  return [{ areaId: null, lineId: project.action_line_id }];
}

/** Los ODS a los que aporta un pilar, en orden y sin repetir. */
export function sdgOfPillar<T extends SdgCountable>(projects: T[], pillarId: string): number[] {
  const goals = new Set<number>();
  for (const project of projects) {
    if (!pillarsOfProject(project).includes(pillarId)) continue;
    for (const id of project.sdg_goals ?? []) {
      if (sdgById.has(id)) goals.add(id);
    }
  }
  return [...goals].sort((a, b) => a - b);
}

/** Tipos de impacto del formato de proyectos. */
export const impactKinds = [
  "Académico",
  "Social",
  "Económico",
  "Ambiental",
  "Institucional",
  "Tecnológico",
  "Cultural",
];

/** Plazos en los que se espera el impacto. */
export const impactTerms = ["Corto plazo", "Mediano plazo", "Largo plazo"];

/** 4200000000 → "$4.200.000.000". El valor de un proyecto se lee entero: a
 *  diferencia del presupuesto del indicador, aquí la cifra exacta importa. */
export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });
}

/** "2026-03-01" y "2027-11-30" → "mar 2026 – nov 2027". */
export function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return "Sin fechas";
  if (start && end) return `${formatMonth(start)} – ${formatMonth(end)}`;
  return start ? `desde ${formatMonth(start)}` : `hasta ${formatMonth(end)}`;
}

/* --- Color ---------------------------------------------------------------- */

/**
 * La base de datos guarda un índice de 1 a 6, no un color. El color vive en
 * tokens.css, donde el tema oscuro tiene su propia paleta validada: si se
 * guardara el hex, el modo oscuro heredaría colores pensados para fondo claro.
 */
export function accentFor(slot: number | null | undefined): string {
  const index = Math.min(Math.max(slot ?? 1, 1), 6);
  return `var(--pillar-${index})`;
}

/* --- Formatos ------------------------------------------------------------- */

const monthFormatter = new Intl.DateTimeFormat("es-CO", { month: "short", year: "numeric" });
const longDateFormatter = new Intl.DateTimeFormat("es-CO", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;

  // Postgres manda dos formas: `date` llega como "2026-08-31" y `timestamptz`
  // como "2026-08-31T14:05:00Z". A la primera se le pone el mediodía —un huso
  // al oeste mostraría "30 ago" si se interpretara a medianoche—; la segunda ya
  // trae su hora y añadírsela producía un texto que `Date` no sabe leer, así
  // que se devolvía "—" en vez de la fecha. Es el caso de `received_at` y
  // `published_at` de las propuestas de facultad.
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00`);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** "2026-08-31" → "ago 2026" */
export function formatMonth(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? monthFormatter.format(date).replace(".", "") : "Sin fecha";
}

/** "2026-08-28" → "28 ago 2026" */
export function formatDate(value: string | null | undefined): string {
  const date = parseDate(value);
  return date ? longDateFormatter.format(date).replace(".", "") : "—";
}

/** 4200000 → "$4,2 M" */
export function formatBudget(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toLocaleString("es-CO", { maximumFractionDigits: 0 })} K`;
  }
  return `$${value.toLocaleString("es-CO")}`;
}

/* --- Derivados ------------------------------------------------------------ */

export const emptyProgress: PillarProgress = {
  pillar_id: "",
  slug: "",
  done: 0,
  active: 0,
  pending: 0,
  risk: 0,
  total: 0,
  progress: 0,
  completion_rate: 0,
  area_count: 0,
  line_count: 0,
  project_count: 0,
};

export const emptySummary: PdiSummary = {
  done: 0,
  active: 0,
  pending: 0,
  risk: 0,
  total: 0,
  progress: 0,
  on_track: 0,
  need_attention: 0,
  pillar_count: 0,
  completion_rate: 0,
};

/** Cuenta de un estado dentro de un resumen, para no repetir el switch. */
export function countFor(summary: PdiSummary | PillarProgress, status: ActivityStatus): number {
  switch (status) {
    case "cumplida":
      return summary.done;
    case "curso":
      return summary.active;
    case "pendiente":
      return summary.pending;
    case "riesgo":
      return summary.risk;
  }
}

/** Suma varios avances por pilar en un resumen, para el filtro del tablero. */
export function summarizeProgress(rows: PillarProgress[]): PdiSummary {
  const totals = rows.reduce(
    (acc, row) => ({
      done: acc.done + row.done,
      active: acc.active + row.active,
      pending: acc.pending + row.pending,
      risk: acc.risk + row.risk,
      total: acc.total + row.total,
    }),
    { done: 0, active: 0, pending: 0, risk: 0, total: 0 },
  );

  return {
    ...totals,
    // Promedio de los pilares, igual que v_pdi_summary: cada pilar pesa lo
    // mismo. Sumar indicadores daría más peso a los pilares con más filas.
    progress:
      rows.length === 0 ? 0 : Math.round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length),
    completion_rate: totals.total === 0 ? 0 : Math.round((totals.done / totals.total) * 100),
    on_track: rows.filter((row) => row.progress >= 80).length,
    need_attention: rows.filter((row) => row.risk > 0).length,
    pillar_count: rows.length,
  };
}

/* --- Bandas de cumplimiento ------------------------------------------------
   Cinco tramos con nombre. Los umbrales viven aquí y en ningún otro sitio: si
   la institución cambia el criterio, se cambia una vez.

   El color nunca viaja solo — cada uso muestra también el nombre de la banda.
   Naranja y verde son indistinguibles bajo daltonismo, así que la escala se
   apoya además en la luminosidad (ver tokens.css).
   -------------------------------------------------------------------------- */

export interface ComplianceBand {
  id: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** Mínimo incluido del tramo. */
  from: number;
  /** Máximo incluido del tramo. */
  to: number;
  color: string;
}

export const complianceBands: ComplianceBand[] = [
  { id: 1, label: "Bajo", from: 0, to: 24, color: "var(--band-1)" },
  { id: 2, label: "Medio bajo", from: 25, to: 49, color: "var(--band-2)" },
  { id: 3, label: "Medio", from: 50, to: 69, color: "var(--band-3)" },
  { id: 4, label: "Medio alto", from: 70, to: 89, color: "var(--band-4)" },
  { id: 5, label: "Satisfactorio", from: 90, to: 100, color: "var(--band-5)" },
];

export function bandFor(progress: number): ComplianceBand {
  const value = Math.max(0, Math.min(100, Math.round(progress)));
  return complianceBands.find((band) => value >= band.from && value <= band.to) ?? complianceBands[0];
}

/** Etiqueta de estado a partir del avance, no de un texto escrito a mano. */
export function toneForProgress(progress: number) {
  if (progress >= 90) return { label: "Consolidado", tone: "done" as const, glyph: "✓" };
  if (progress >= 70) return { label: "En progreso", tone: "active" as const, glyph: "◐" };
  if (progress >= 45) return { label: "En desarrollo", tone: "pending" as const, glyph: "○" };
  return { label: "Atención requerida", tone: "risk" as const, glyph: "▲" };
}

/* =============================================================================
   PDI por facultad

   La aritmética del módulo vive aquí y no en la pantalla, por lo mismo que
   `tallySdg`: son preguntas sobre el plan, no sobre cómo se dibuja.
   ========================================================================== */

export type ToneName = "done" | "active" | "pending" | "risk" | "neutral";

/** Etiqueta y codificación secundaria del estado que declara la facultad. El
 *  color nunca viaja solo: la pantalla escribe siempre la etiqueta al lado. */
export const facultyActionStatus: Record<FacultyActionStatus, { label: string; tone: ToneName }> = {
  pendiente: { label: "Pendiente", tone: "pending" },
  proceso: { label: "En proceso", tone: "active" },
  completado: { label: "Completado", tone: "done" },
};

/**
 * En qué banda de la rampa cae una casilla de la matriz.
 *
 * Cuatro bandas de un solo tono, no seis colores de pilar: la casilla compara
 * cuántas acciones hay, y comparar entre columnas con seis matices distintos es
 * imposible. El color del pilar vive en la cabecera de la columna, que es donde
 * sí identifica. Y la cifra está siempre escrita, así que la rampa es un
 * refuerzo y nunca el único dato.
 *
 * Los cortes no son lineales: con la distribución real —de 0 a 18 acciones por
 * casilla, y la mayoría entre 1 y 3— repartir el rango en cuatro tramos iguales
 * dejaría casi todo en la banda más clara y la matriz no diría nada.
 */
export function matrixBand(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 6) return 2;
  return 3;
}

/** Las cifras de cabecera del índice de facultades. */
export interface FacultyOverview {
  actions: number;
  faculties: number;
  facultiesWithPlan: number;
  /** Pilares que no recibe ninguna acción de ninguna facultad. */
  untouchedPillars: string[];
}

export function tallyFaculties(
  matrix: FacultyPillarCell[],
  counts: { action_count: number }[],
): FacultyOverview {
  const byPillar = new Map<string, { name: string; numeral: string; total: number }>();
  for (const cell of matrix) {
    const row = byPillar.get(cell.pillar_id) ?? {
      name: cell.pillar_name,
      numeral: cell.pillar_numeral,
      total: 0,
    };
    row.total += cell.actions;
    byPillar.set(cell.pillar_id, row);
  }

  return {
    actions: counts.reduce((sum, row) => sum + row.action_count, 0),
    faculties: counts.length,
    facultiesWithPlan: counts.filter((row) => row.action_count > 0).length,
    untouchedPillars: [...byPillar.values()]
      .filter((row) => row.total === 0)
      .map((row) => `${row.numeral} · ${row.name}`),
  };
}

/** Los pilares a los que esta facultad todavía no apunta. Se muestra tal cual:
 *  un pilar sin acciones es información, no un hueco que haya que tapar. */
export function pillarsMissedBy(matrix: FacultyPillarCell[], facultyId: string): string[] {
  return matrix
    .filter((cell) => cell.faculty_id === facultyId && cell.actions === 0)
    .map((cell) => `${cell.pillar_numeral} · ${cell.pillar_name}`);
}

/** Reparte las acciones por pilar, para el filtro de la ficha. */
export function tallyActionsByPillar(actions: FacultyAction[]) {
  const rows = new Map<
    string,
    { id: string; numeral: string; name: string; accent: number; count: number }
  >();

  for (const action of actions) {
    if (!action.pillar_id) continue;
    const row = rows.get(action.pillar_id) ?? {
      id: action.pillar_id,
      numeral: action.pillar_numeral ?? "",
      name: action.pillar_name ?? "",
      accent: action.pillar_accent ?? 1,
      count: 0,
    };
    row.count += 1;
    rows.set(action.pillar_id, row);
  }

  return [...rows.values()].sort((a, b) => b.count - a.count || a.numeral.localeCompare(b.numeral));
}

/**
 * Agrupa las acciones por su dimensión, que es como las ordena la facultad.
 *
 * El orden es el del código —d1, d2, d3…— y no el del número de acciones: las
 * dimensiones son una secuencia que la facultad reconoce, y reordenarlas por
 * tamaño rompería el índice mental de quien las escribió.
 */
export interface FacultyDimension {
  id: string;
  name: string;
  actions: FacultyAction[];
}

export function groupByDimension(actions: FacultyAction[]): FacultyDimension[] {
  const rows = new Map<string, FacultyDimension>();

  for (const action of actions) {
    const id = action.dimension || "sin-dimension";
    const row = rows.get(id) ?? {
      id,
      name: action.dimension_name || "Sin dimensión",
      actions: [],
    };
    row.actions.push(action);
    rows.set(id, row);
  }

  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }));
}

/** La fecha límite en el texto correcto: la formateada cuando es una fecha, y
 *  lo que escribió la facultad —"Por definir"— cuando no lo es. */
export function deadlineText(date: string | null, label: string): string {
  if (date) return formatDate(date);
  return label || "Sin fecha";
}

/* =============================================================================
   PDI por campus

   Los estados de lo que reporta una sede son distintos de los del plan
   (`statusMeta`): allí se mide avance, aquí cumplimiento de una meta anual. No
   se reutilizan las mismas etiquetas para que nadie lea "En curso" donde dice
   "Parcial".

   Mismo criterio de accesibilidad: glifo y etiqueta siempre, nunca solo color.
   ========================================================================== */

import type { CampusState, MappingConfidence } from "../types/database";

export interface CampusStateMeta {
  id: CampusState;
  label: string;
  glyph: string;
  color: string;
}

export const campusStateMeta: Record<CampusState, CampusStateMeta> = {
  superada: { id: "superada", label: "Superada", glyph: "▲", color: "var(--status-done)" },
  cumplida: { id: "cumplida", label: "Cumplida", glyph: "✓", color: "var(--status-done)" },
  parcial: { id: "parcial", label: "Parcial", glyph: "◐", color: "var(--status-pending)" },
  no_cumplida: { id: "no_cumplida", label: "No cumplida", glyph: "○", color: "var(--status-risk)" },
  // Un logro sin meta no es un incumplimiento: es una casilla que el informe de
  // esa sede no tiene. Por eso va en gris y no en rojo.
  sin_meta: { id: "sin_meta", label: "Logro sin meta", glyph: "—", color: "var(--ink-muted)" },
};

/** Orden de lectura: de lo mejor cumplido a lo que no se puede medir. */
export const campusStateOrder: CampusState[] = [
  "superada",
  "cumplida",
  "parcial",
  "no_cumplida",
  "sin_meta",
];

export const confidenceLabels: Record<MappingConfidence, string> = {
  alta: "El informe nombra la línea",
  media: "Asignación inferida por afinidad temática",
  baja: "Asignación tentativa",
};

/**
 * Cómo se dice un cumplimiento que no se puede calcular.
 *
 * Bucaramanga no declara metas programadas, así que su promedio es nulo. Pintar
 * un 0 % diría que no cumplió nada, que es lo contrario de lo que dice su
 * informe. Esta función existe para que esa distinción no dependa de que cada
 * pantalla se acuerde.
 */
export function formatCompliance(value: number | null | undefined): string {
  if (value === null || value === undefined) return "No calculable";
  return `${Math.round(value)}%`;
}

/** Cuánto del plan cubre un reporte, en porcentaje entero. */
export function coveragePct(covered: number, total: number): number {
  if (!total) return 0;
  return Math.round((covered * 100) / total);
}
