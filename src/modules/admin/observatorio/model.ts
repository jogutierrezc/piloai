/* =============================================================================
   Observatorio de Analítica · modelo del taller de la intranet.

   El Observatorio no publica indicadores con meta y corte, como UDES en
   Cifras: publica tablas de datos (agregadas y anonimizadas) y los visores
   que se arman sobre ellas. Tres piezas:

   · Tabla de datos (ObsDataset): la forma de un conjunto libre de UDES en
     Cifras —columnas con tipo y filas— más su tema, su fuente, su tipo de
     dato y el acta de anonimización que dejó la importación.
   · Visor (ObsView): una gráfica sobre una tabla. Admite los quince tipos de
     los conjuntos libres y los siete que solo tenían los informes (mapa de
     calor, mosaico, embudo, puntos, bosque, ranking y mapa por municipio).
   · Tema (ObsTopicConfig): cada una de las catorce páginas, con su tipo de
     informe (plantilla) y el orden de sus visores por sección.

   El boletín (ObsBulletin) es un recorte: temas, años, periodos, fuentes y
   tipos de dato.
   ========================================================================== */

import type { FreeChartType, FreeColumn, FreeRow, FreeSet, FreeTemporality, FreeView } from "../../datos-abiertos/data/free-sets";
import { CHART_TYPES, columnOf } from "../../datos-abiertos/data/free-sets";
import { OBS_TOPICS } from "../../datos-abiertos/observatorio/data";

/* --- Tipos ------------------------------------------------------------------------ */

/** Tipos de gráfica que solo tenían los informes de UDES en Cifras. */
export type ObsExtraType = "mapa_calor" | "mosaico" | "embudo" | "puntos" | "bosque" | "ranking" | "mapa_municipal";
export type ObsChartType = FreeChartType | ObsExtraType;

/** Columna: la de los conjuntos libres, con el municipio como territorio más. */
export interface ObsColumn extends Omit<FreeColumn, "territory"> {
  territory?: "departamento" | "pais" | "municipio";
}

/** Qué clase de dato es la tabla. Sirve para clasificar y para el boletín. */
export type ObsDataType = "conteo" | "tasa" | "serie" | "distribucion" | "georreferenciado" | "modelo" | "encuesta";

export const DATA_TYPE_LABEL: Record<ObsDataType, string> = {
  conteo: "Conteos agregados",
  tasa: "Tasas y porcentajes",
  serie: "Serie de tiempo",
  distribucion: "Distribución de valores",
  georreferenciado: "Georreferenciado",
  modelo: "Resultado de modelo",
  encuesta: "Encuesta",
};

/** Acta de lo que la importación le hizo al archivo antes de guardarlo. */
export interface ObsAnonymization {
  fileName: string;
  sourceRows: number;
  sourceColumns: number;
  /** Columnas que no llegaron a la tabla, con el motivo. */
  removed: { column: string; reason: string }[];
  /** Microdatos convertidos en conteos por estas columnas. */
  groupedBy: string[];
  /** Casillas con menos de 5 registros que se publican como «< 5». */
  reservedCells: number;
  threshold: number;
  at: string;
}

export interface ObsDataset {
  id: string;
  topic: string;
  title: string;
  description: string;
  /** Oficina o sistema de origen. */
  source: string;
  dataType: ObsDataType;
  temporality: FreeTemporality;
  periodLabel: string;
  columns: ObsColumn[];
  rows: FreeRow[];
  anonymization: ObsAnonymization | null;
  /** Datos de ejemplo de la maqueta: se marcan y nunca se confunden con reales. */
  sample: boolean;
  status: "borrador" | "publicado";
  position: number;
  updatedAt: string;
}

/** Cómo se clasifica un visor dentro de la página del tema. */
export type ObsSection = "panorama" | "tendencia" | "composicion" | "territorio" | "detalle";

export const SECTION_LABEL: Record<ObsSection, string> = {
  panorama: "Panorama",
  tendencia: "Tendencia",
  composicion: "Composición",
  territorio: "Territorio",
  detalle: "Detalle",
};

export const SECTION_HINT: Record<ObsSection, string> = {
  panorama: "Las cifras que abren la página",
  tendencia: "Cómo cambia en el tiempo",
  composicion: "Cómo se reparte un total",
  territorio: "Dónde ocurre",
  detalle: "Tablas y cruces para explorar",
};

export const SECTIONS = Object.keys(SECTION_LABEL) as ObsSection[];

export interface ObsView extends Omit<FreeView, "type"> {
  id: string;
  datasetId: string;
  topic: string;
  type: ObsChartType;
  /** Mapa de calor: la segunda categoría (columnas de la rejilla). */
  category2?: string;
  /** Ranking: cuántas filas enseña. */
  limit?: number;
  /** Bosque: la línea de referencia (1 para razones, 0 para coeficientes). */
  reference?: number;
  section: ObsSection;
  /** Ancho en el tablero. */
  size: "media" | "completa";
  visible: boolean;
  position: number;
}

/** Tipo de informe de un tema: cómo se ordena su página. */
export type ObsTemplate = "tablero" | "narrativo" | "comparativo" | "ficha";

export const TEMPLATES: { id: ObsTemplate; label: string; hint: string }[] = [
  { id: "tablero", label: "Tablero", hint: "Rejilla densa: cifras arriba y visores en dos columnas. Para explorar." },
  { id: "narrativo", label: "Narrativo", hint: "Una columna que se lee de arriba abajo, sección por sección, con su texto." },
  { id: "comparativo", label: "Comparativo", hint: "Visores lado a lado, del mismo alto, para contrastar cortes." },
  { id: "ficha", label: "Ficha técnica", hint: "Primero las tablas con su metodología; las gráficas acompañan." },
];

export interface ObsTopicConfig {
  slug: string;
  template: ObsTemplate;
  intro: string;
  /** Secciones en el orden en que salen; las que no están no se muestran. */
  sections: ObsSection[];
  status: "borrador" | "publicado";
}

export interface ObsBulletinFilters {
  topics: string[];
  years: number[];
  /** "2024-1", "2024-2"… Vacío: todos. */
  periods: string[];
  sources: string[];
  dataTypes: ObsDataType[];
}

export interface ObsBulletin {
  id: string;
  title: string;
  subtitle: string;
  filters: ObsBulletinFilters;
  include: { cover: boolean; summary: boolean; tables: boolean; method: boolean };
  updatedAt: string;
}

export interface ObsState {
  /** "base": Supabase con la migración 0049. "local": borrador en este navegador. */
  mode: "base" | "local";
  datasets: ObsDataset[];
  views: ObsView[];
  topics: ObsTopicConfig[];
  bulletins: ObsBulletin[];
}

export const RESERVE = 5;
export const RESERVED_TEXT = "< 5";

/* --- Temas ------------------------------------------------------------------------- */

export const TOPICS = OBS_TOPICS.map(({ slug, code, name, summary, question, line, source }) => ({ slug, code, name, summary, question, line, source }));
export type ObsTopicInfo = (typeof TOPICS)[number];

export const topicInfo = (slug: string | undefined) => TOPICS.find((t) => t.slug === slug);

export function defaultTopic(slug: string): ObsTopicConfig {
  return { slug, template: "tablero", intro: "", sections: [...SECTIONS], status: "borrador" };
}

export const topicConfig = (state: ObsState, slug: string) => state.topics.find((t) => t.slug === slug) ?? defaultTopic(slug);

/* --- Catálogo de gráficas ------------------------------------------------------------ */

export type ChartFamily = "Comparar" | "Reparto" | "Tiempo" | "Distribución" | "Territorio" | "Relación" | "Detalle";

export interface ChartSpec {
  label: string;
  hint: string;
  family: ChartFamily;
  /** Dónde nació el tipo: los conjuntos libres o un bloque de informe. */
  origin: "Conjuntos libres" | "Informes";
  category: "texto" | "territorio" | "municipio" | "ninguna" | "opcional";
  series: "una" | "dos" | "varias" | "tres" | "ninguna";
  category2?: boolean;
  dates?: boolean;
}

const EXTRA: Record<ObsExtraType, ChartSpec> = {
  mapa_calor: {
    label: "Mapa de calor",
    hint: "Una cifra en el cruce de dos categorías (programa × año, campus × estrato).",
    family: "Relación",
    origin: "Informes",
    category: "texto",
    category2: true,
    series: "una",
  },
  mosaico: {
    label: "Mosaico",
    hint: "El reparto de un total en rectángulos proporcionales; lee bien muchas categorías.",
    family: "Reparto",
    origin: "Informes",
    category: "texto",
    series: "una",
  },
  embudo: {
    label: "Embudo",
    hint: "Etapas en orden (inscritos, admitidos, matriculados) y cuánto se pierde entre una y otra.",
    family: "Comparar",
    origin: "Informes",
    category: "texto",
    series: "una",
  },
  puntos: {
    label: "Puntos",
    hint: "Una o dos cifras por categoría como puntos; con dos, la brecha entre ellas.",
    family: "Comparar",
    origin: "Informes",
    category: "texto",
    series: "varias",
  },
  bosque: {
    label: "Bosque",
    hint: "Estimación con su intervalo (razón de probabilidades, coeficiente) frente a una referencia.",
    family: "Relación",
    origin: "Informes",
    category: "texto",
    series: "tres",
  },
  ranking: {
    label: "Ranking",
    hint: "Las categorías ordenadas de mayor a menor, con su puesto.",
    family: "Comparar",
    origin: "Informes",
    category: "texto",
    series: "una",
  },
  mapa_municipal: {
    label: "Mapa por municipio",
    hint: "Una cifra por municipio de Colombia, como puntos proporcionales.",
    family: "Territorio",
    origin: "Informes",
    category: "municipio",
    series: "una",
  },
};

const FAMILY_OF: Record<FreeChartType, ChartFamily> = {
  barras: "Comparar",
  barras_comparadas: "Comparar",
  barras_apiladas: "Comparar",
  barras_100: "Reparto",
  barras_linea: "Comparar",
  radar: "Comparar",
  circular: "Reparto",
  dona: "Reparto",
  cascada: "Reparto",
  histograma: "Distribución",
  caja: "Distribución",
  lineas: "Tiempo",
  area: "Tiempo",
  gantt: "Tiempo",
  mapa: "Territorio",
  cifras: "Detalle",
  tabla: "Detalle",
};

export const CHARTS: Record<ObsChartType, ChartSpec> = {
  ...(Object.fromEntries(
    (Object.keys(CHART_TYPES) as FreeChartType[]).map((type) => {
      const spec = CHART_TYPES[type];
      return [
        type,
        {
          label: type === "mapa" ? "Mapa por departamento" : spec.label,
          hint: spec.hint,
          family: FAMILY_OF[type],
          origin: "Conjuntos libres",
          category: spec.category,
          series: spec.series,
          dates: spec.dates,
        } satisfies ChartSpec,
      ];
    }),
  ) as Record<FreeChartType, ChartSpec>),
  ...EXTRA,
};

export const FAMILIES: ChartFamily[] = ["Comparar", "Reparto", "Tiempo", "Distribución", "Territorio", "Relación", "Detalle"];

export const isFreeType = (type: ObsChartType): type is FreeChartType => type in CHART_TYPES;

/** El conjunto libre equivalente, para dibujar con FreeChart. */
export function asFreeSet(dataset: ObsDataset): FreeSet {
  return {
    id: dataset.id,
    title: dataset.title,
    description: dataset.description,
    source: dataset.source,
    temporality: dataset.temporality,
    periodLabel: dataset.periodLabel,
    columns: dataset.columns.map((c) => ({ ...c, territory: c.territory === "municipio" ? undefined : c.territory })),
    rows: dataset.rows,
    views: [],
  };
}

/** Qué le falta a un visor para dibujarse, en palabras. */
export function obsViewProblems(dataset: ObsDataset | undefined, view: Pick<ObsView, "type" | "category" | "category2" | "series" | "start" | "end">): string[] {
  if (!dataset) return ["El visor perdió su tabla de datos."];
  const spec = CHARTS[view.type];
  const problems: string[] = [];
  const set = asFreeSet(dataset);
  const category = dataset.columns.find((c) => c.key === view.category);
  if (spec.category === "texto" && (!category || category.kind === "cifra")) problems.push("Falta la categoría.");
  if (spec.category === "territorio" && (category?.kind !== "territorio" || category.territory === "municipio"))
    problems.push("Falta una columna de departamento o país.");
  if (spec.category === "municipio" && !category) problems.push("Falta la columna de municipio.");
  if (spec.category2) {
    const second = dataset.columns.find((c) => c.key === view.category2);
    if (!second || second.kind === "cifra" || second.key === view.category) problems.push("Falta la segunda categoría (columnas).");
  }
  const series = (view.series ?? []).map((key) => columnOf(set, key)).filter((c) => c?.kind === "cifra");
  if (spec.series === "una" || spec.series === "varias") {
    if (!series.length) problems.push("Falta al menos una cifra.");
  }
  if (spec.series === "dos" && (series.length < 2 || view.series?.[0] === view.series?.[1])) problems.push("Faltan dos cifras: la de las barras y la de la línea.");
  if (spec.series === "tres" && series.length < 3) problems.push("El bosque pide tres cifras: estimación, límite inferior y superior.");
  if (spec.dates && (columnOf(set, view.start)?.kind !== "fecha" || columnOf(set, view.end)?.kind !== "fecha")) problems.push("Faltan las fechas de inicio y fin.");
  if (view.type === "radar" && series.length < 3) problems.push("El radar necesita al menos tres cifras.");
  return problems;
}

/* --- Utilidades ------------------------------------------------------------------------ */

export const newId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;

/** Años que cubre una tabla: por su año de fila o por una columna de tiempo. */
export function yearsOfDataset(dataset: ObsDataset): number[] {
  const years = new Set<number>();
  for (const row of dataset.rows) {
    if (row.year !== null) years.add(row.year);
  }
  if (!years.size) {
    for (const column of dataset.columns) {
      if (!/a[ñn]o|periodo|year|vigencia|corte/i.test(column.label)) continue;
      for (const row of dataset.rows) {
        const m = String(row.cells[column.key] ?? "").match(/\b(19|20)\d{2}\b/);
        if (m) years.add(Number(m[0]));
      }
    }
  }
  return [...years].sort((a, b) => a - b);
}

/** Periodos académicos ("2024-1") que aparecen en la tabla. */
export function periodsOfDataset(dataset: ObsDataset): string[] {
  const out = new Set<string>();
  for (const row of dataset.rows) {
    for (const cell of Object.values(row.cells)) {
      const m = String(cell ?? "").match(/^\s*((?:19|20)\d{2})\s*[-_ ]?\s*(0?[12]|I{1,2}|[AB])\s*$/i);
      if (m) {
        const term = m[2].toUpperCase().replace(/^0/, "");
        out.add(`${m[1]}-${term === "A" || term === "I" ? "1" : term === "B" || term === "II" ? "2" : term}`);
      }
    }
  }
  return [...out].sort();
}

/* --- Datos de ejemplo --------------------------------------------------------------------
   Para el borrador local: los catorce temas de la maqueta pública, cada uno con
   sus tres tablas y un visor por tabla. Todo marcado como ejemplo.            */

export function sampleState(): ObsState {
  const datasets: ObsDataset[] = [];
  const views: ObsView[] = [];
  const now = new Date().toISOString();
  OBS_TOPICS.forEach((topic) => {
    const base = { topic: topic.slug, source: topic.source, anonymization: null, sample: true, status: "borrador" as const, updatedAt: now, periodLabel: "" };

    const serieId = `ej-${topic.slug}-serie`;
    datasets.push({
      ...base,
      id: serieId,
      title: topic.series.title,
      description: `Serie anual · ${topic.series.unit}.`,
      dataType: "serie",
      temporality: "anual",
      position: 0,
      columns: [
        { key: "anio", label: "Año", kind: "texto" },
        { key: "valor", label: topic.series.title, kind: "cifra", format: "entero", unit: topic.series.unit },
      ],
      rows: topic.series.points.map(([label, value]) => ({ year: Number(label), kind: "dato", label: "", cells: { anio: label, valor: value } })),
    });
    views.push({
      id: `${serieId}-v`, datasetId: serieId, topic: topic.slug, key: "v1", title: topic.series.title, type: "lineas",
      category: "anio", series: ["valor"], section: "tendencia", size: "media", visible: true, position: 0,
    });

    const shareId = `ej-${topic.slug}-reparto`;
    datasets.push({
      ...base,
      id: shareId,
      title: topic.share.title,
      description: `Reparto · ${topic.share.unit}.`,
      dataType: "conteo",
      temporality: "periodo",
      periodLabel: "2025",
      position: 1,
      columns: [
        { key: "categoria", label: "Categoría", kind: "texto" },
        { key: "valor", label: topic.share.unit, kind: "cifra", format: "entero", unit: topic.share.unit },
      ],
      rows: topic.share.items.map(([label, value]) => ({ year: null, kind: "dato", label: "", cells: { categoria: label, valor: value } })),
    });
    views.push({
      id: `${shareId}-v`, datasetId: shareId, topic: topic.slug, key: "v1", title: topic.share.title, type: topic.share.items.length <= 6 ? "dona" : "barras",
      category: "categoria", series: ["valor"], orientation: "horizontal", sort: "desc", section: "composicion", size: "media", visible: true, position: 1,
    });

    const tableId = `ej-${topic.slug}-tabla`;
    const numeric = topic.table.columns.filter((c) => c.numeric);
    datasets.push({
      ...base,
      id: tableId,
      title: topic.table.title,
      description: "Tabla agregada.",
      dataType: "conteo",
      temporality: "sin_tiempo",
      position: 2,
      columns: topic.table.columns.map((c) => (c.numeric ? { key: c.key, label: c.label, kind: "cifra" as const, format: "entero" as const, unit: c.unit } : { key: c.key, label: c.label, kind: "texto" as const })),
      rows: topic.table.rows.map((r) => ({ year: null, kind: "dato", label: "", cells: { ...r } })),
    });
    views.push({
      id: `${tableId}-v`, datasetId: tableId, topic: topic.slug, key: "v1", title: topic.table.title, type: "tabla",
      series: numeric.map((c) => c.key), section: "detalle", size: "completa", visible: true, position: 2,
    });
  });
  return {
    mode: "local",
    datasets,
    views,
    topics: OBS_TOPICS.map((t) => defaultTopic(t.slug)),
    bulletins: [],
  };
}
