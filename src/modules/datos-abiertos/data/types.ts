/* =============================================================================
   Datos Abiertos · contrato de datos del portal.

   Es lo que las pantallas consumen. Lo arma `repository.ts` a partir de las
   tablas `od_*` de Supabase (0019_udes_en_cifras.sql): un periodo global, sus
   campus y sus informes, cada uno con indicadores, desgloses, mapas de calor,
   mapas, tubería y el diseño de su ficha.

   Un valor ausente es `null`, nunca 0: "no reportado" y "cero" son
   afirmaciones distintas y la interfaz las pinta distinto.

   Los `uuid` opcionales solo los rellena la carga de la intranet: el portal
   público identifica todo por clave legible (slug de informe, clave de
   indicador, slug de campus).
   ========================================================================== */

import type { PublicationStatus } from "../../../types/database";
import type { AnnualRule, Term } from "./terms";
import type { RankingData } from "./rankings";
import type { MedalBoard } from "./medals";
import type { SaberProData } from "./saber-pro";
import type { FreeSet } from "./free-sets";
import type { SaberTytData } from "./saber-tyt";

export type { AnnualRule, Term } from "./terms";

export type ReportSlug = string;

/** Slug del campus. "todas" es el total institucional. */
export type CampusId = string;
export const ALL_CAMPUSES: CampusId = "todas";

export type ValueFormat = "entero" | "porcentaje" | "decimal";

/** Si subir es bueno o malo: decide cómo se lee la variación, no su color. */
export type Direction = "sube" | "baja" | "neutro";

/** "suma": el total institucional es la suma de los campus. "reportado": se captura aparte. */
export type Aggregation = "suma" | "reportado";

export type ChartKind = "circular" | "barras" | "lineas" | "composicion";

export type BlockKind =
  | "kpis"
  | "evolucion"
  | "mapa"
  | "tuberia"
  | "mapa_calor"
  | "desgloses"
  | "tabla_dinamica"
  | "metodologia"
  | "historico"
  | "tabla"
  | "separador"
  | "rankings"
  | "saber_pro"
  | "libre"
  | "saber_tyt"
  | "diversidad"
  | "imagenes"
  | "modelo"
  | "medallero"
  | "tablas_personalizadas";

export interface Campus {
  id: CampusId;
  name: string;
  uuid?: string;
}

/** valores[año][campus] */
export type YearCampusValues = Record<number, Partial<Record<CampusId, number | null>>>;

/** valores[año][periodo][campus] */
export type TermCampusValues = Record<number, Partial<Record<Term, Partial<Record<CampusId, number | null>>>>>;

export interface Indicator {
  id: string;
  uuid?: string;
  label: string;
  /** Unidad que acompaña a la cifra: "estudiantes", "%", "m²". */
  unit: string;
  format: ValueFormat;
  direction: Direction;
  aggregation?: Aggregation;
  /** Qué se cuenta y cómo, en una frase. */
  definition: string;
  /** Oficina que reporta la cifra. */
  source: string;
  officeId?: string | null;
  isKpi?: boolean;
  kpiPosition?: number | null;
  isHeadline?: boolean;
  /** Años con dato. Sin lista, todos los del periodo. */
  years?: number[];
  /** Cifra del año: sale de los periodos A y B según `annualRule`. */
  values: YearCampusValues;
  /** Por periodo (A y B) o por año. */
  reporting?: "periodo" | "anual";
  /** Cómo se obtiene la cifra del año. Sin ella, la serie es solo anual. */
  annualRule?: AnnualRule;
  /** Cifras por periodo académico, tal como se reportaron. */
  terms?: TermCampusValues;
  /** Todo el periodo: cómo salió la cifra agrupada de cada campus ("promedio anual de 6 años"). */
  periodBasis?: Partial<Record<CampusId, string>>;
  /** Con la regla "ultimo": de qué periodo salió cada cifra anual. */
  annualFrom?: Record<number, Partial<Record<CampusId, Term>>>;
}

export interface BreakdownItem {
  label: string;
  value: number | null;
  /**
   * La celda tiene dato, pero tan pocos registros que publicarlo señalaría a
   * personas concretas: se escribe "< n" y nunca su número. No es un vacío
   * (ahí no hay dato) ni un cero (ahí no hay nadie).
   */
  reserved?: boolean;
}

export interface Breakdown {
  id: string;
  uuid?: string;
  title: string;
  unit: string;
  format: ValueFormat;
  source: string;
  officeId?: string | null;
  defaultChart?: ChartKind;
  /**
   * Umbral de reserva estadística: por debajo de este número de registros la
   * celda se publica como "< n". Sin umbral, el desglose no reserva nada.
   */
  reserveThreshold?: number;
  /**
   * «Ver datos por corte» lleva la columna Total (suma de categorías). Solo
   * `false` la quita; sin la opción, el desglose queda con total.
   */
  showTotal?: boolean;
  /** Años con dato. Sin lista, todos los del periodo. */
  years?: number[];
  /** Se publica para el total institucional; por campus no se desagrega. */
  values: Record<number, BreakdownItem[]>;
  reporting?: "periodo" | "anual";
  annualRule?: AnnualRule;
  terms?: Record<number, Partial<Record<Term, BreakdownItem[]>>>;
}

/** Matriz para mapa de calor. `values[fila][columna]`; null = no aplica o sin reportar. */
export interface HeatmapData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  rowLabel: string;
  columnLabel: string;
  rows: string[];
  columns: string[];
  values: (number | null)[][];
  unit: string;
  format: ValueFormat;
  source: string;
  officeId?: string | null;
  /** Qué significa una casilla vacía en esta matriz. */
  emptyMeaning: string;
}

/** Qué se captura en cada etapa: estudiantes, % de la cohorte que sigue o % de la cohorte que ya se retiró (acumulado). */
export type PipelineMeasure = "estudiantes" | "permanencia" | "desercion";

/** Cohorte que avanza por etapas y pierde estudiantes entre una y otra. */
export interface PipelineCohort {
  /** Periodo de ingreso ("2014-A"). La semilla antigua usaba el año. */
  cohort: string | number;
  campus: CampusId;
  /**
   * Lo que sigue al llegar a cada etapa. El primero es el ingreso. En
   * estudiantes, personas; en permanencia y deserción, % de la cohorte.
   */
  remaining: (number | null)[];
  /** % que se retira en el tramo que termina en cada etapa, si se reportó aparte. */
  dropout?: (number | null)[];
  /** Causa principal de retiro en cada tramo (entre etapa i e i+1). */
  mainCause: string[];
}

export interface PipelineData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  measure?: PipelineMeasure;
  stages: string[];
  cohorts: PipelineCohort[];
  source: string;
  officeId?: string | null;
}

/** La cifra en los periodos elegidos, con sus categorías y su peso en el total. */
export interface HistoryData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  unit: string;
  format: ValueFormat;
  totalLabel: string;
  source: string;
  officeId?: string | null;
  /** Periodos en orden cronológico ("2020-A"). */
  periods: string[];
  /** Categorías en su orden (Pregrado, Posgrado…). */
  categories: string[];
  /** total[periodo] */
  total: Record<string, number | null>;
  /** values[categoría][periodo] */
  values: Record<string, Record<string, number | null>>;
}

export type MapMode = "origen" | "cobertura" | "entrante" | "saliente" | "convenios" | "municipio";

/** Mapa del mundo: la clave es el país (ISO alfa-3). */
export const isWorldMap = (mode: MapMode) => mode === "entrante" || mode === "saliente" || mode === "convenios";

/** Movilidad: rutas entre un país y los campus. */
export const isMobilityMap = (mode: MapMode) => mode === "entrante" || mode === "saliente";

/** Nombre de cada tipo de mapa, para la intranet y el rótulo de la gráfica. */
export const MAP_MODE_TITLE: Record<MapMode, string> = {
  origen: "Mapa por departamento",
  cobertura: "Mapa por departamento",
  entrante: "Movilidad entrante por país",
  saliente: "Movilidad saliente por país",
  convenios: "Convenios internacionales por país",
  municipio: "Origen por municipio",
};

/**
 * Valores por territorio para un año y un campus. En los mapas por departamento
 * la clave es el código DANE; en los mundiales, el país en ISO 3166-1 alfa-3.
 */
export interface MapDataset {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  /**
   * "origen": de dónde vienen las personas que atiende cada campus, con flujos.
   * "cobertura": solo color por departamento.
   * "entrante": participantes que llegan de otro país a un campus.
   * "saliente": participantes que salen de un campus a otro país.
   * "convenios": convenios internacionales por país, como mapa de calor.
   */
  mode: MapMode;
  /** "global": una sola cifra sin año, guardada en la clave ALL_YEARS (0). "anual": por año. */
  reporting?: "anual" | "global";
  unit: string;
  source: string;
  officeId?: string | null;
  /** Años con dato. Sin lista, todos los del periodo. */
  years?: number[];
  values: Record<number, Partial<Record<CampusId, Record<string, number>>>>;
  /** Celdas con menos de 5 personas: existen pero sin cifra (mapas «municipio»). */
  reserved?: Record<number, Partial<Record<CampusId, string[]>>>;
}

import type { GridImage } from "./images";

export interface ReportBlock {
  uuid?: string;
  kind: BlockKind;
  /** Clave del conjunto (mapa, mapa de calor) al que apunta el bloque. */
  refKey?: string | null;
  visible: boolean;
  position: number;
  settings: {
    chart?: ChartKind;
    title?: string;
    indicators?: string[];
    /** Evolución por campus: clave del indicador con que abre. Sin ella, la cifra titular. */
    indicator?: string;
    /** Mapas: clave (no id) del otro mapa que se muestra con este. La clave sobrevive a la copia de periodo. */
    mapWith?: string;
    /** "combinado": entrante y saliente en un solo mapa; "lado_a_lado": dos mapas en una fila. */
    mapLayout?: "combinado" | "lado_a_lado";
    /** Mapa con panel denso y encuadre a los países con datos. */
    compact?: boolean;
    /** Separador: una frase bajo su título. */
    description?: string;
    /** Bloque de desgloses: claves de los desgloses que muestra. Sin ellas, los que ningún otro bloque eligió. */
    breakdowns?: string[];
    /** Distingue varios bloques del mismo tipo sin conjunto (separadores, tableros). */
    slot?: string;
    /** Bloque de rankings: claves de los rankings que muestra. */
    rankings?: string[];
    /** Medalleros que enseña este bloque; vacío, los que no reclamó otro. */
    medalleros?: string[];
    /** Bloque de tablas: claves de las tablas personalizadas (su conjunto libre) que muestra. Sin ellas, las que ningún otro bloque eligió. */
    tablas?: string[];
    /** Bloque Saber PRO: clave del conjunto. Sin ella, el primero del informe. */
    saberPro?: string;
    /** Bloque de conjunto libre: clave de la vista. Sin ella, todas las de la fuente. */
    view?: string;
    /** Bloque del Motor Beta: clave del conjunto. Sin ella, el primero del informe. */
    saberTyt?: string;
    /** Grid de imágenes: las fotografías, en su orden. */
    images?: GridImage[];
    /** Grid de imágenes: cuántas caben por fila. Dos por defecto. */
    columns?: 1 | 2;
  };
  /** Punto del informe al que pertenece. Sin punto, el bloque es de toda la ficha. */
  sectionKey?: string | null;
}

/* --- Modelo estadístico (0046) ------------------------------------------------------ */

/** Un coeficiente tal como lo publica SPSS en «Variables en la ecuación». */
export interface ModelTerm {
  b: number;
  se: number;
  wald: number;
  df: number;
  sig: number;
  /** Exp(B): razón de probabilidades frente a la categoría de referencia. */
  or: number;
  /** Intervalo de confianza del 95 % para Exp(B). */
  lo: number;
  hi: number;
}

export interface ModelVariable {
  key: string;
  label: string;
  /** La categoría contra la que se compara cada nivel (su B es 0). */
  reference: string;
  /** Prueba conjunta de la variable, si tiene más de un nivel. */
  overall?: { wald: number; df: number; sig: number };
  levels: { label: string; term: ModelTerm }[];
}

/** Regresión logística binaria: lo necesario para leerla, explorarla y dibujarla. */
export interface ModelSpec {
  kind: "logistica";
  question: string;
  response: { label: string; positive: string; negative: string };
  method: string;
  sample: { n: number; cohorts: string; population: string; source: string };
  fit: { m2ll: number; coxSnell: number; nagelkerke: number; hosmerLemeshowSig: number; cutoff: number; significance: number };
  /** Observado × pronosticado. */
  classification: {
    negative: { negative: number; positive: number };
    positive: { negative: number; positive: number };
  };
  intercept: { b: number; se: number; wald: number; sig: number; or: number };
  variables: ModelVariable[];
  /** Composición de la muestra: [categoría, casos]. */
  composition: { label: string; items: [string, number][] }[];
}

export interface ModelData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  note: string;
  spec: ModelSpec;
  source: string;
  officeId?: string | null;
}

export interface ReportImage {
  src: string;
  alt: string;
  /** Procedencia visible: la imagen es provisional hasta tener fotografía oficial. */
  credit: string;
}

export interface Report {
  uuid?: string;
  slug: ReportSlug;
  /** Código de dos letras del tablero. */
  code: string;
  name: string;
  /** Una línea para el tablero. */
  summary: string;
  /** Párrafo de la ficha. */
  description: string;
  image: ReportImage;
  /** Índice 1-9 de la franja de línea (color de la insignia del código). */
  line: number;
  /** Indicadores del tablero de KPI, en orden. El primero es el titular. */
  keyIndicators: string[];
  indicators: Indicator[];
  breakdowns: Breakdown[];
  heatmaps?: HeatmapData[];
  /** Semilla ilustrativa: una sola tubería. La base puede tener varias (`pipelines`). */
  pipeline?: PipelineData;
  pipelines?: PipelineData[];
  histories?: HistoryData[];
  maps?: MapDataset[];
  /** Puntos del informe, en orden. Sin puntos, la ficha es una sola columna de bloques. */
  sections?: ReportSection[];
  tables?: TableData[];
  /** Rankings universitarios (QS, THE…) con sus ediciones anuales. */
  rankings?: RankingData[];
  /** Medalleros: lo que gana la universidad cuando compite (0056). */
  medals?: MedalBoard[];
  /** Resultados Saber PRO por competencia, año, sede y programa. */
  saberPro?: SaberProData[];
  /** Conjuntos libres: fuentes con columnas propias y sus gráficas. */
  freeSets?: FreeSet[];
  /** Motor Beta: Saber 11 → Saber TyT en rango percentil. */
  saberTyt?: SaberTytData[];
  /** Modelos estadísticos publicados (0046). */
  models?: ModelData[];
  /** Orden y visibilidad de los bloques de la ficha. Sin bloques, el orden por defecto. */
  blocks?: ReportBlock[];
  /** Nota metodológica o de alcance. */
  note?: string;
  status?: PublicationStatus;
  position?: number;
  updatedAt?: string;
}

export interface PeriodInfo {
  uuid?: string;
  label: string;
  startYear: number;
  endYear: number;
  status?: PublicationStatus;
}

export interface OpenDataCatalog {
  period?: PeriodInfo;
  years: number[];
  currentYear: number;
  campuses: Campus[];
  /** Mientras sea true, cada cifra lleva la marca "Dato ilustrativo". */
  illustrative: boolean;
  /** Fecha de corte publicada, ISO. */
  cutoffDate: string;
  reports: Report[];
}

/** Orden de la ficha cuando el informe no declara bloques. */
export const DEFAULT_BLOCK_ORDER: BlockKind[] = [
  "kpis",
  "evolucion",
  "historico",
  "mapa",
  "tuberia",
  "mapa_calor",
  "desgloses",
  "tabla_dinamica",
  "metodologia",
];

export type SectionStatus = "completo" | "parcial" | "no_recibido" | "no_oficial" | "abierto";

/** Un punto de un informe institucional: su texto, su estado y su fuente. */
export interface ReportSection {
  key: string;
  uuid?: string;
  number: number | null;
  title: string;
  status: SectionStatus;
  lede: string;
  warning: string;
  source: string;
  requested: { dato: string; responsable: string; periodicidad: string }[];
  position: number;
}

export type TableDisplay = "tabla" | "ranking" | "fichas" | "cifras";

export interface TableData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  display: TableDisplay;
  columns: { key: string; label: string; format: ValueFormat | "texto" | "enlace" }[];
  rows: Record<string, string | number | null>[];
  source: string;
}

/** Bloques que apuntan a un conjunto concreto del informe. */
export const DATASET_BLOCKS: BlockKind[] = ["mapa", "mapa_calor", "tuberia", "historico", "tabla", "libre"];

export const BLOCK_LABELS: Record<BlockKind, string> = {
  kpis: "Tablero de indicadores",
  evolucion: "Evolución por campus",
  mapa: "Mapa por departamento",
  tuberia: "Tubería de permanencia",
  historico: "Evolución histórica",
  tabla: "Tabla",
  mapa_calor: "Mapa de calor",
  desgloses: "Desgloses",
  tabla_dinamica: "Tabla dinámica",
  metodologia: "Qué mide cada cifra",
  separador: "Separador",
  rankings: "Rankings",
  saber_pro: "Resultados Saber PRO",
  libre: "Conjunto libre",
  saber_tyt: "Saber TyT · Motor Beta",
  diversidad: "Tablero de la diversidad",
  imagenes: "Grid de imágenes",
  modelo: "Modelo predictivo",
  medallero: "Medallero",
  tablas_personalizadas: "Tablas personalizadas",
};
