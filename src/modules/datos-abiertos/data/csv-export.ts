/* =============================================================================
   Datos Abiertos · exportar los conjuntos en CSV.

   Un escritor y muchos constructores. Cada conjunto que la ficha dibuja tiene
   aquí su `xToTable()`, que devuelve una tabla (`CsvTable`), y todas pasan por
   el mismo `toCsvText()`: BOM y punto y coma, que es lo que Excel en español
   abre sin preguntar; coma decimal sin ruido de coma flotante ni notación
   científica; comillas donde hacen falta, y un apóstrofo delante de todo texto
   que una hoja de cálculo leería como fórmula.

   La reserva estadística se decide aquí y en ningún otro sitio. El CSV no
   puede decir lo que la ficha calla, así que:
   · una celda reservada nunca entrega su número: va vacía, con su techo
     ("< 5") en la columna «Reservado»;
   · ningún CSV calcula un total: con el total y las demás celdas, la reservada
     se despeja por resta;
   · el corte «todo el periodo» (ALL_YEARS) no se exporta, porque es un
     promedio derivado; la excepción son los mapas de dato global, que guardan
     ahí su cifra real;
   · el mapa por municipio no lleva filas de departamento, que contienen a las
     personas de los municipios reservados, ni las del total institucional, que
     la ficha no lee y que con un campus reservado lo despejarían por resta;
   · una celda de cifra que trae texto ("< 5", como guardan su reserva el
     Observatorio y los Tableros) sale con ese texto, y el total de su grupo se
     calcula sin ella, como en la ficha: no hay resta que la despeje;
   · de Saber PRO y Saber TyT salen promedios y conteos por nivel, con la
     advertencia «Pocos evaluados»; los histogramas y las nubes por programa no
     salen: con un evaluado, señalan a una persona.

   Un vacío no es un cero: lo que no se reportó va en blanco.

   Módulo puro: no importa `open-data.ts` (que arrastra Supabase) ni ningún
   componente, para que las pruebas en node lo lean.
   ========================================================================== */

import { DEPARTMENTS } from "./colombia-map";
import { MUNICIPIOS } from "./colombia-municipios";
import { freeTotalAt, freeTotalShown, numberOf, textOf } from "./free-sets";
import type { FreeCell, FreeColumn, FreeRow, FreeTemporality } from "./free-sets";
import { cellTone, manualTone, rowTone, toneLabel, unitOf } from "./custom-table";
import type { CustomTable } from "./custom-table";
import { orderedTiers } from "./medals";
import type { MedalBoard, MedalEntry } from "./medals";
import { parseRank, RANKING_SYSTEMS, SDGS } from "./rankings";
import type { RankingData, RankingEdition } from "./rankings";
import { formatReserved, RESERVE_DEFAULT, valueOf } from "./reserve";
import { ALPHA_FIT_LABEL, ALPHA_PREDICTORS, entryAxisOf, QUADRANT_LABEL } from "./saber-alpha";
import type { AlphaFit } from "./saber-alpha";
import { competencyInfo, levelScale, SABER_COMPETENCIES, SABER_FEW_LEVELS, SABER_FEW_MEAN } from "./saber-pro";
import type { SaberProData, SaberResult, SaberScope } from "./saber-pro";
import { PERCENTILE_STEP, TYT_COMPETENCIES, TYT_LEVEL_LABEL, tytInfo } from "./saber-tyt";
import type { SaberTytData, TytResult } from "./saber-tyt";
import { slugify } from "./slug";
import { ALL_YEARS, ANNUAL_RULE_LABEL, periodText, termLabel, TERMS } from "./terms";
import type { Term } from "./terms";
import { ALL_CAMPUSES, isMobilityMap, isWorldMap } from "./types";
import type {
  Breakdown,
  BreakdownItem,
  CampusId,
  HeatmapData,
  HistoryData,
  Indicator,
  MapDataset,
  ModelData,
  ModelTerm,
  PipelineData,
  PipelineMeasure,
  TableData,
} from "./types";
import { COUNTRIES } from "./world-map";

export type CsvCell = string | number | null;

export interface CsvTable {
  header: string[];
  rows: CsvCell[][];
}

/** Un archivo descargable. La tabla se arma solo al hacer clic. */
export interface CsvFile {
  filename: string;
  build: () => CsvTable;
}

/* --- El escritor ---------------------------------------------------------------- */

const BOM = "\uFEFF";
const SEPARATOR = ";";

/** Lo que Excel, Calc y Sheets ejecutan como fórmula si abre una celda. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Separador, comillas, saltos de línea o espacios en los bordes: la celda va entre comillas. */
const NEEDS_QUOTES = /[;"\r\n]|^\s|\s$/;

/**
 * Texto de una celda. El apóstrofo desactiva la fórmula; la hoja de cálculo sí
 * lo muestra al abrir el archivo, y el LEEME lo avisa. Solo mira el primer
 * carácter: "< 5" no se toca.
 */
function textCell(text: string): string {
  const safe = FORMULA_START.test(text) ? `'${text}` : text;
  return NEEDS_QUOTES.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Seis decimales como mucho y sin agrupar: 0,1 + 0,2 sale "0,3" y 1e21 sale con todas sus cifras, nunca con "e+". */
const plainNumber = new Intl.NumberFormat("en-US", { useGrouping: false, maximumFractionDigits: 6 });

/** Un número nunca lleva apóstrofo ni comillas: -3 es una cifra, no una fórmula. */
function numberCell(value: number): string {
  if (!Number.isFinite(value)) return "";
  const text = plainNumber.format(value);
  // Lo que se redondea a cero no conserva el signo.
  return text === "-0" ? "0" : text.replace(".", ",");
}

function csvCell(cell: CsvCell): string {
  if (cell === null) return "";
  return typeof cell === "number" ? numberCell(cell) : textCell(cell);
}

/** La tabla como texto CSV: BOM, punto y coma, coma decimal y un salto de línea por fila. */
export function toCsvText(table: CsvTable): string {
  const lines = [table.header, ...table.rows].map((row) => row.map(csvCell).join(SEPARATOR));
  return `${BOM}${lines.join("\n")}`;
}

/** Dos columnas con el mismo rótulo se confunden al importar: la segunda lleva " (2)". */
export function uniqueLabels(labels: string[]): string[] {
  const taken = new Set<string>();
  return labels.map((label) => {
    let name = label;
    for (let n = 2; taken.has(name); n += 1) name = `${label} (${n})`;
    taken.add(name);
    return name;
  });
}

/* --- Nombres de archivo ----------------------------------------------------------- */

const FILE_PREFIX = "udes-en-cifras";

/** El zip de un informe: "udes-en-cifras-matricula.zip". */
export const csvZipName = (report: string): string => `${FILE_PREFIX}-${slugify(report, "informe")}.zip`;

/** Un conjunto que baja suelto: "udes-en-cifras-matricula-desglose-genero.csv". */
export const csvFilename = (report: string, kind: string, key: string): string =>
  `${FILE_PREFIX}-${slugify(report, "informe")}-${slugify(kind, "conjunto")}-${slugify(key, "datos")}.csv`;

/* --- Lo común a varios constructores ------------------------------------------------ */

/** Lo que el CSV necesita de un campus: su clave y su nombre. */
export interface CsvCampus {
  id: CampusId;
  name: string;
}

function campusNamer(campuses: CsvCampus[]): (id: CampusId) => string {
  const names = new Map(campuses.map((c) => [c.id, c.name]));
  return (id) => names.get(id) ?? (id === ALL_CAMPUSES ? "Total institucional" : id);
}

/** Las claves presentes, con los campus conocidos primero y en su orden. */
function campusOrder(present: Iterable<CampusId>, campuses: CsvCampus[]): CampusId[] {
  const found = new Set(present);
  const known = campuses.map((c) => c.id).filter((id) => found.has(id));
  return [...known, ...[...found].filter((id) => !known.includes(id)).sort()];
}

/** Los años capturados de un registro, sin el corte derivado «todo el periodo». */
function capturedYears(declared: number[] | undefined, ...records: (Record<number, unknown> | undefined)[]): number[] {
  const years = new Set(records.flatMap((record) => Object.keys(record ?? {}).map(Number)));
  return [...years]
    .filter((year) => Number.isFinite(year) && year !== ALL_YEARS && (!declared || declared.includes(year)))
    .sort((a, b) => a - b);
}

const orNull = <T,>(value: T | null | undefined): T | null => (value === undefined ? null : value);
const textOrNull = (text: string | null | undefined): string | null => (text ? text : null);

/* --- Territorios -------------------------------------------------------------------- */

interface TerritoryNames {
  departments: Map<string, string>;
  countries: Map<string, string>;
  municipios: Map<string, string>;
}

let territories: TerritoryNames | null = null;

/** Los nombres se indexan la primera vez que un CSV los pide: son más de mil municipios. */
function territoryNames(): TerritoryNames {
  territories ??= {
    departments: new Map(DEPARTMENTS.map((d) => [d.code, d.name])),
    countries: new Map(COUNTRIES.map((c) => [c.code, c.name])),
    municipios: new Map(MUNICIPIOS.map((m) => [m[0], m[1]])),
  };
  return territories;
}

/** Nombre del departamento por su código DANE; vacío si el código no existe. */
export const departmentName = (code: string): string => territoryNames().departments.get(code) ?? "";
/** Nombre del país por su código ISO alfa-3; vacío si el código no existe. */
export const countryName = (code: string): string => territoryNames().countries.get(code) ?? "";
/** Nombre del municipio por su código DIVIPOLA; vacío si el código no existe. */
export const municipioName = (code: string): string => territoryNames().municipios.get(code) ?? "";

/* --- Indicadores ---------------------------------------------------------------------- */

export interface IndicatorsExport {
  /** Nombre del informe: va en la primera columna. */
  reportName: string;
  indicators: Indicator[];
  /** Años del periodo publicado, en orden. */
  years: number[];
  campuses: CsvCampus[];
}

/**
 * Indicadores en ancho: una fila por indicador y campus, y por cada año sus
 * periodos 1 y 2 y la cifra del año. Las filas sin ninguna cifra no salen.
 */
export function indicatorsToTable({ reportName, indicators, years, campuses }: IndicatorsExport): CsvTable {
  const cuts = years
    .filter((year) => year !== ALL_YEARS)
    .flatMap((year) => [...TERMS.map((term) => ({ year, term })), { year, term: null as Term | null }]);
  const header = [
    "Informe",
    "Clave",
    "Indicador",
    "Unidad",
    "Campus",
    ...cuts.map((cut) => (cut.term ? `${cut.year}-${termLabel(cut.term)}` : `${cut.year} (año)`)),
    "Regla anual",
    "Fuente",
  ];
  const rows: CsvCell[][] = [];
  for (const indicator of indicators) {
    for (const campus of campuses) {
      const cells = cuts.map((cut) => valueOf(indicator, cut.year, campus.id, cut.term));
      if (cells.every((cell) => cell === null)) continue;
      const rule = indicator.annualRule ? ANNUAL_RULE_LABEL[indicator.annualRule] : null;
      rows.push([reportName, indicator.id, indicator.label, indicator.unit, campus.name, ...cells, rule, indicator.source]);
    }
  }
  return { header, rows };
}

/* --- Desgloses ------------------------------------------------------------------------ */

export interface BreakdownExport {
  /**
   * El tablero de la diversidad lee un solo corte por año: el de este periodo
   * si se capturó y, si no, la cifra del año (igual que `itemsOf` en dei.ts).
   */
  preferTerm?: Term;
}

interface BreakdownCut {
  year: number;
  period: string;
  items: BreakdownItem[];
}

const ANNUAL_PERIOD = "Anual";

/** ¿El corte trae algo? Una celda reservada cuenta, y su valor no se mira. */
const captured = (items: BreakdownItem[] | undefined): items is BreakdownItem[] =>
  (items ?? []).some((item) => item.reserved || item.value !== null);

function breakdownCuts(breakdown: Breakdown, year: number, preferTerm?: Term): BreakdownCut[] {
  const annual = breakdown.values[year];
  if (preferTerm) {
    const byTerm = breakdown.terms?.[year]?.[preferTerm];
    if (byTerm?.length) return [{ year, period: termLabel(preferTerm), items: byTerm }];
    return annual?.length ? [{ year, period: ANNUAL_PERIOD, items: annual }] : [];
  }
  const cuts: BreakdownCut[] = [];
  for (const term of TERMS) {
    const items = breakdown.terms?.[year]?.[term];
    if (captured(items)) cuts.push({ year, period: termLabel(term), items });
  }
  // La cifra del año es un corte propio solo si se reportó como año. Deducida
  // de los periodos (suma, promedio) es un total calculado, y esos no salen.
  const reportedAsYear = (breakdown.annualRule ?? "reportado") === "reportado" || cuts.length === 0;
  if (reportedAsYear && captured(annual)) cuts.push({ year, period: ANNUAL_PERIOD, items: annual });
  return cuts;
}

/**
 * Desglose en largo: una fila por corte y categoría. Sin columna ni fila de
 * total: permitiría despejar por resta la celda reservada.
 */
export function breakdownToTable(breakdown: Breakdown, { preferTerm }: BreakdownExport = {}): CsvTable {
  const header = ["Desglose", "Año", "Periodo", "Categoría", "Valor", "Reservado", "Unidad", "Fuente"];
  const ceiling = formatReserved(breakdown.reserveThreshold);
  const rows: CsvCell[][] = capturedYears(breakdown.years, breakdown.values, breakdown.terms)
    .flatMap((year) => breakdownCuts(breakdown, year, preferTerm))
    .flatMap((cut) =>
      cut.items.map((item) => [
        breakdown.title,
        cut.year,
        cut.period,
        item.label,
        // El número de una celda reservada no se lee: ni para escribirlo ni para compararlo.
        item.reserved ? null : item.value,
        item.reserved ? ceiling : null,
        breakdown.unit,
        breakdown.source,
      ]),
    );
  return { header, rows };
}

/* --- Mapas ---------------------------------------------------------------------------- */

export interface MapExport {
  campuses: CsvCampus[];
}

const GLOBAL_CUT = "Dato global";
const DIVIPOLA = /^\d{5}$/;
const DIRECTION: Partial<Record<MapDataset["mode"], string>> = { entrante: "Entrante", saliente: "Saliente" };

interface MapCell {
  year: number;
  campus: CampusId;
  code: string;
  value: number | null;
  reserved: boolean;
}

/** Los cortes del mapa: sus años capturados o, en un dato global, la clave única donde vive. */
function mapYears(map: MapDataset, municipio: boolean): number[] {
  if (map.reporting === "global") return [ALL_YEARS];
  return capturedYears(map.years, map.values, municipio ? map.reserved : undefined);
}

function mapCells(map: MapDataset, campuses: CsvCampus[]): MapCell[] {
  const municipio = map.mode === "municipio";
  // Por municipio la ficha solo lee los campus. El total institucional no sale:
  // con un municipio reservado en un campus, total menos los demás lo despeja.
  const exported = (campus: CampusId) => !(municipio && campus === ALL_CAMPUSES);
  const cells: MapCell[] = [];
  for (const year of mapYears(map, municipio)) {
    const values = map.values[year] ?? {};
    // Fuera del mapa por municipio la ficha no pinta las reservadas: aquí tampoco salen.
    const reserved: Partial<Record<CampusId, string[]>> = municipio ? map.reserved?.[year] ?? {} : {};
    for (const campus of campusOrder([...Object.keys(values), ...Object.keys(reserved)], campuses).filter(exported)) {
      const hidden = new Set((reserved[campus] ?? []).filter((code) => DIVIPOLA.test(code)));
      const reported = Object.keys(values[campus] ?? {});
      // Por municipio solo salen códigos DIVIPOLA: la fila de un departamento
      // contiene a las personas de sus municipios reservados.
      const codes = municipio ? [...new Set([...reported.filter((code) => DIVIPOLA.test(code)), ...hidden])] : reported;
      for (const code of codes.sort()) {
        const isReserved = hidden.has(code);
        cells.push({ year, campus, code, value: isReserved ? null : orNull(values[campus]?.[code]), reserved: isReserved });
      }
    }
  }
  return cells;
}

function territoryOf(map: MapDataset, code: string): string {
  if (map.mode === "municipio") return municipioName(code);
  return isWorldMap(map.mode) ? countryName(code) : departmentName(code);
}

/**
 * Mapas en largo: una fila por corte, campus y territorio con dato. Admite
 * varios mapas (entrante y saliente van juntos en la ficha) y añade «Sentido»
 * si alguno es de movilidad. Con un mapa por municipio las columnas son las de
 * DIVIPOLA, con el departamento al lado y la columna «Reservado», y solo
 * salen sus campus, sin el total institucional.
 */
export function mapToTable(maps: MapDataset | MapDataset[], { campuses }: MapExport): CsvTable {
  const list = Array.isArray(maps) ? maps : [maps];
  const byMunicipio = list.some((map) => map.mode === "municipio");
  const withDirection = list.some((map) => isMobilityMap(map.mode));
  const campusName = campusNamer(campuses);
  const header = [
    "Mapa",
    ...(withDirection ? ["Sentido"] : []),
    "Año",
    "Campus",
    ...(byMunicipio ? ["DIVIPOLA", "Municipio", "Depto", "Valor", "Reservado"] : ["Código", "Nombre", "Valor"]),
    "Unidad",
    "Fuente",
  ];
  const rows: CsvCell[][] = list.flatMap((map) =>
    mapCells(map, campuses).map((cell) => [
      map.title,
      ...(withDirection ? [orNull(DIRECTION[map.mode])] : []),
      cell.year === ALL_YEARS ? GLOBAL_CUT : cell.year,
      campusName(cell.campus),
      cell.code,
      textOrNull(territoryOf(map, cell.code)),
      ...(byMunicipio
        ? [
            textOrNull(map.mode === "municipio" ? departmentName(cell.code.slice(0, 2)) : ""),
            cell.value,
            cell.reserved ? formatReserved(RESERVE_DEFAULT) : null,
          ]
        : [cell.value]),
      map.unit,
      map.source,
    ]),
  );
  return { header, rows };
}

/* --- Tubería -------------------------------------------------------------------------- */

export interface PipelineExport {
  campuses: CsvCampus[];
}

const MEASURE_LABEL: Record<PipelineMeasure, string> = {
  estudiantes: "Estudiantes",
  permanencia: "% de la cohorte que sigue",
  desercion: "% de la cohorte que se retiró (acumulado)",
};

/**
 * Tubería en largo: una fila por cohorte, campus y etapa. El retiro del tramo
 * sale solo si se reportó aparte: el que la ficha deduce no se exporta.
 */
export function pipelineToTable(pipeline: PipelineData, { campuses }: PipelineExport): CsvTable {
  const header = ["Cohorte", "Campus", "N.º etapa", "Etapa", "Valor", "Retiro del tramo", "Causa principal", "Medida"];
  const campusName = campusNamer(campuses);
  const measure = MEASURE_LABEL[pipeline.measure ?? "estudiantes"];
  const rows: CsvCell[][] = pipeline.cohorts.flatMap((cohort) =>
    pipeline.stages.map((stage, index) => [
      periodText(cohort.cohort),
      campusName(cohort.campus),
      index + 1,
      stage,
      orNull(cohort.remaining[index]),
      orNull(cohort.dropout?.[index]),
      // La causa es del tramo que termina en la etapa: la primera no tiene.
      index > 0 ? textOrNull(cohort.mainCause[index - 1]) : null,
      measure,
    ]),
  );
  return { header, rows };
}

/* --- Histórico ------------------------------------------------------------------------ */

/**
 * Histórico en largo: una fila por periodo y categoría. El total es un dato
 * capturado, no una suma: sale como una categoría más, con su rótulo.
 */
export function historyToTable(history: HistoryData): CsvTable {
  const header = ["Periodo", "Categoría", "Valor", "Unidad"];
  const rows: CsvCell[][] = history.periods.flatMap((period) => {
    const label = periodText(period);
    const parts: CsvCell[][] = history.categories.map((category) => [
      label,
      category,
      orNull(history.values[category]?.[period]),
      history.unit,
    ]);
    const total = history.total[period];
    return total === undefined ? parts : [...parts, [label, history.totalLabel || "Total", total, history.unit]];
  });
  return { header, rows };
}

/* --- Mapa de calor -------------------------------------------------------------------- */

/** La matriz tal como se ve: una fila por fila y una columna por columna. */
export function heatmapToTable(heatmap: HeatmapData): CsvTable {
  const header = uniqueLabels([heatmap.rowLabel || "Fila", ...heatmap.columns]);
  const rows: CsvCell[][] = heatmap.rows.map((row, r) => [row, ...heatmap.columns.map((_, c) => orNull(heatmap.values[r]?.[c]))]);
  return { header, rows };
}

/* --- Tabla ---------------------------------------------------------------------------- */

type TableColumn = TableData["columns"][number];

/** Una cifra capturada como texto ("1.234,5") sale como número; lo que no es número, como se escribió. */
function tableCell(column: TableColumn, value: string | number | null | undefined): CsvCell {
  if (value === null || value === undefined || value === "") return null;
  if (column.format === "texto" || column.format === "enlace") return String(value);
  return numberOf(value) ?? String(value);
}

/** La tabla con sus columnas, en el orden de origen. */
export function tableToTable(table: TableData): CsvTable {
  const header = uniqueLabels(table.columns.map((column) => column.label || column.key));
  const rows = table.rows.map((row) => table.columns.map((column) => tableCell(column, row[column.key])));
  return { header, rows };
}

/* --- Rankings ------------------------------------------------------------------------- */

/** Una posición es texto: "=145", "801–1000", "1001+". Lo que no se reconoce va como se capturó. */
const rankCell = (raw: string | null | undefined): CsvCell => textOrNull(parseRank(raw)?.text ?? (raw ?? "").trim());

const sdgLabel = (n: number): string => {
  const name = SDGS.find((sdg) => sdg.n === n)?.name;
  return name ? `ODS ${n} · ${name}` : `ODS ${n}`;
};

/** Las columnas tras «Ítem»: puestos mundial, regional y nacional, evaluadas, puntaje, estrellas, valor y nota. */
type RankingFigures = [CsvCell, CsvCell, CsvCell, CsvCell, CsvCell, CsvCell, CsvCell, CsvCell];

function editionRows(edition: RankingEdition): { section: string; item: string | null; figures: RankingFigures }[] {
  const general: RankingFigures = [
    rankCell(edition.global_rank),
    rankCell(edition.regional_rank),
    rankCell(edition.national_rank),
    edition.evaluated,
    edition.score,
    null,
    null,
    textOrNull(edition.note),
  ];
  return [
    { section: "General", item: null, figures: general },
    ...edition.stars.map((star) => ({
      section: "Estrellas",
      item: star.category,
      figures: [null, null, null, null, null, star.stars, null, null] as RankingFigures,
    })),
    ...edition.sdgs.map((sdg) => ({
      section: "ODS",
      item: sdgLabel(sdg.sdg),
      figures: [rankCell(sdg.global_rank), null, rankCell(sdg.national_rank), null, orNull(sdg.score), null, null, null] as RankingFigures,
    })),
    ...edition.subjects.map((subject) => ({
      section: "Materia",
      item: subject.subject,
      figures: [rankCell(subject.global_rank), null, rankCell(subject.national_rank), null, null, null, null, null] as RankingFigures,
    })),
    ...edition.custom.map((field) => ({
      section: "Dato",
      item: field.label,
      figures: [null, null, null, null, null, null, textOrNull(field.value), null] as RankingFigures,
    })),
  ];
}

/**
 * Rankings en largo y en un solo archivo: por edición, su fila general y
 * debajo las estrellas, los ODS, las materias y los datos sueltos.
 */
export function rankingToTable(rankings: RankingData | RankingData[]): CsvTable {
  const header = [
    "Ranking",
    "Sistema",
    "Año",
    "Sección",
    "Ítem",
    "Puesto mundial",
    "Puesto regional",
    "Puesto nacional",
    "Instituciones evaluadas",
    "Puntaje",
    "Estrellas",
    "Valor",
    "Nota",
  ];
  const list = Array.isArray(rankings) ? rankings : [rankings];
  const rows: CsvCell[][] = list.flatMap((ranking) =>
    ranking.editions.flatMap((edition) =>
      editionRows(edition).map((row) => [
        ranking.title,
        RANKING_SYSTEMS[ranking.system].label,
        edition.year,
        row.section,
        row.item,
        ...row.figures,
      ]),
    ),
  );
  return { header, rows };
}

/* --- Medallero ------------------------------------------------------------------------ */

const termOrder = (entry: MedalEntry): number => (entry.term === null ? 0 : entry.term === "A" ? 1 : 2);

/**
 * Medallero en ancho: una fila por corte capturado y un nivel por columna. Sin
 * total ni puesto: los dos se calculan, y lo no capturado («no compitió») va
 * vacío, que no es un cero.
 */
export function medalBoardToTable(board: MedalBoard): CsvTable {
  const tiers = orderedTiers(board);
  const header = uniqueLabels(["Año", "Periodo", board.rowLabel || "Fila", ...tiers.map((tier) => tier.label || tier.key), "Nota"]);
  const entries = [...board.entries].sort((a, b) => a.year - b.year || termOrder(a) - termOrder(b) || a.position - b.position);
  const rows: CsvCell[][] = entries.map((entry) => [
    entry.year,
    entry.term ? termLabel(entry.term) : null,
    entry.label,
    ...tiers.map((tier) => orNull(entry.counts[tier.key])),
    textOrNull(entry.note),
  ]);
  return { header, rows };
}

/* --- Saber PRO ------------------------------------------------------------------------ */

const FEW = "sí";

const SABER_SCOPE_LABEL: Record<SaberScope, string> = {
  programa: "Programa",
  institucion: "Institución",
  nacional: "Nacional",
};
const SABER_SCOPE_ORDER: SaberScope[] = ["nacional", "institucion", "programa"];

/** Las dos escalas de niveles, una columna por nivel: las genéricas y la de inglés. */
const SABER_LEVELS = (["lc", "ing"] as const).flatMap((competency) => {
  const scale = levelScale(competency);
  return scale ? scale.keys.map((key, i) => ({ key, label: scale.labels[i], scale })) : [];
});

/**
 * Con menos evaluados que el umbral de la ficha, la cifra se publica con una
 * advertencia: 30 si la fila trae reparto por niveles (cambia mucho de un año
 * a otro), 10 si solo trae promedio. Solo aplica a los programas.
 */
function saberFew(result: SaberResult): boolean {
  if (result.scope !== "programa" || result.evaluated === null) return false;
  const leveled = Object.keys(result.levels).length > 0;
  return result.evaluated < (leveled ? SABER_FEW_LEVELS : SABER_FEW_MEAN);
}

const competencyRank = (result: SaberResult): number => SABER_COMPETENCIES.findIndex((c) => c.key === result.competency);

function saberOrder(a: SaberResult, b: SaberResult): number {
  return (
    a.year - b.year ||
    SABER_SCOPE_ORDER.indexOf(a.scope) - SABER_SCOPE_ORDER.indexOf(b.scope) ||
    a.campus.localeCompare(b.campus, "es") ||
    a.faculty.localeCompare(b.faculty, "es") ||
    a.program.localeCompare(b.program, "es") ||
    competencyRank(a) - competencyRank(b)
  );
}

/**
 * Saber PRO en largo: una fila por año, ámbito, programa y competencia, con
 * evaluados, promedio y evaluados por nivel. El histograma de puntajes no
 * sale: con un evaluado, un tramo de 10 puntos es su resultado.
 */
export function saberProToTable(data: SaberProData): CsvTable {
  const header = [
    "Año",
    "Ámbito",
    "Sede",
    "Facultad",
    "Programa",
    "Competencia",
    "Evaluados",
    "Promedio",
    ...SABER_LEVELS.map((level) => level.label),
    "Pocos evaluados",
  ];
  const rows: CsvCell[][] = [...data.results].sort(saberOrder).map((result) => {
    const scale = levelScale(result.competency);
    return [
      result.year,
      SABER_SCOPE_LABEL[result.scope],
      textOrNull(result.campus),
      textOrNull(result.faculty),
      textOrNull(result.program),
      competencyInfo(result.competency)?.label ?? result.competency,
      result.evaluated,
      result.mean,
      ...SABER_LEVELS.map((level) => (level.scale === scale ? orNull(result.levels[level.key]) : null)),
      saberFew(result) ? FEW : null,
    ];
  });
  return { header, rows };
}

/* --- Saber TyT ------------------------------------------------------------------------ */

/**
 * Umbral de «pocos evaluados» del Motor Beta. Es el `FEW` de
 * components/SaberTytBlock.tsx, repetido aquí porque este módulo no importa
 * componentes: si cambia allí, cambia aquí.
 */
export const TYT_FEW = 10;

const QUARTERS = ["1", "2", "3", "4"];
const TRANSITIONS = QUARTERS.flatMap((from) => QUARTERS.map((to) => ({ from, to })));

/** Un conteo existente y por debajo del umbral. Cero es «esa medida no aplica», no «pocos». */
const few = (count: number | null): boolean => count !== null && count > 0 && count < TYT_FEW;

const tytOrder = (a: TytResult, b: TytResult): number =>
  a.year - b.year ||
  a.level.localeCompare(b.level) ||
  a.program.localeCompare(b.program, "es") ||
  TYT_COMPETENCIES.findIndex((c) => c.key === a.competency) - TYT_COMPETENCIES.findIndex((c) => c.key === b.competency);

/**
 * Saber TyT, resultados: una fila por año, nivel, programa y competencia, con
 * los escalares del Motor Beta, el tránsito entre cuartos y los del Motor
 * Alpha con sus cuadrantes. Las nubes y los histogramas (`histogram`,
 * `scatter`, `plane`, `quadPlane`) no salen.
 */
export function saberTytResultsToTable(data: SaberTytData): CsvTable {
  const header = [
    "Año",
    "Nivel",
    "Programa",
    "Competencia",
    "Evaluados",
    "Percentil medio de salida",
    "Pareados",
    "Percentil medio de entrada",
    "Valor agregado (percentil)",
    "Subieron de percentil",
    "Puntaje medio de entrada",
    "Puntaje medio de salida",
    ...TRANSITIONS.map(({ from, to }) => `Tránsito del cuarto ${from} al ${to}`),
    "Evaluados del modelo",
    "Puntaje esperado",
    "Puntaje real",
    "Valor agregado (modelo)",
    "Sobre lo esperado",
    ...QUARTERS.map((q) => `Cuadrante ${q} · ${QUADRANT_LABEL[q]}`),
    "Pocos evaluados",
  ];
  const rows: CsvCell[][] = [...data.results].sort(tytOrder).map((r) => [
    r.year,
    TYT_LEVEL_LABEL[r.level] ?? r.level,
    r.program || "Todo el nivel",
    tytInfo(r.competency)?.label ?? r.competency,
    r.evaluated,
    r.meanExit,
    r.paired,
    r.meanEntry,
    r.meanDelta,
    r.improved,
    r.rawEntry,
    r.rawExit,
    ...TRANSITIONS.map(({ from, to }) => orNull(r.transitions[from]?.[to])),
    r.alphaN,
    r.alphaExpected,
    r.alphaActual,
    r.alphaVa,
    r.alphaPositive,
    ...QUARTERS.map((q) => orNull(r.quadrants[q])),
    few(r.evaluated) || few(r.paired) ? FEW : null,
  ]);
  return { header, rows };
}

/** Saber TyT, curvas de referencia: el puntaje que deja por debajo a cada 5 % de la cohorte. */
export function saberTytCurvesToTable(data: SaberTytData): CsvTable {
  const header = ["Competencia", "Prueba", "Percentil", "Puntaje"];
  const rows: CsvCell[][] = TYT_COMPETENCIES.flatMap((competency) => {
    const curves = data.benchmarks[competency.key];
    if (!curves) return [];
    const points = (test: string, curve: number[]): CsvCell[][] =>
      curve.map((score, i) => [competency.label, test, i * PERCENTILE_STEP, score]);
    return [...points("Entrada (Saber 11)", curves.entrada), ...points("Salida (Saber TyT)", curves.salida)];
  });
  return { header, rows };
}

const ALPHA_FITS: AlphaFit[] = ["completo", "ampliado"];

/**
 * Saber TyT, modelos del Motor Alpha: una fila por competencia y ajuste, con
 * sus coeficientes y los promedios nacionales que cortan los cuadrantes.
 */
export function saberTytModelsToTable(data: SaberTytData): CsvTable {
  const header = [
    "Competencia",
    "Ajuste",
    "Intercepto",
    ...ALPHA_PREDICTORS.map((predictor) => `Coeficiente · ${predictor.label}`),
    "R²",
    "Casos",
    "Error típico",
    "Promedio nacional Saber 11",
    "Promedio nacional Saber TyT",
  ];
  const { nacional, modelos } = data.alpha;
  const rows: CsvCell[][] = TYT_COMPETENCIES.flatMap((competency) =>
    ALPHA_FITS.flatMap((fit) => {
      const model = modelos[competency.key]?.[fit];
      if (!model) return [];
      const row: CsvCell[] = [
        competency.label,
        ALPHA_FIT_LABEL[fit],
        model.coef.intercepto,
        ...ALPHA_PREDICTORS.map((predictor) => orNull(model.coef[predictor.key])),
        model.r2,
        model.n,
        model.rmse,
        orNull(nacional.saber11[entryAxisOf(competency.key) ?? "global"]),
        orNull(nacional.tyt[competency.key]),
      ];
      return [row];
    }),
  );
  return { header, rows };
}

/* --- Conjuntos libres, Observatorio y Tableros ------------------------------------------- */

/**
 * Lo que comparten un conjunto libre, una tabla del Observatorio y una de un
 * tablero: temporalidad, columnas y filas con la forma de `FreeRow`.
 */
export interface FreeTable {
  temporality: FreeTemporality;
  columns: Omit<FreeColumn, "territory">[];
  rows: FreeRow[];
}

const ROW_KIND_LABEL: Record<FreeRow["kind"], string> = { dato: "Dato", grupo: "Grupo", total: "Total" };

/**
 * Una cifra escrita "1.234,5" sale como número; lo demás, como texto. Una
 * columna de cifra puede traer texto: el Observatorio y los Tableros guardan
 * ahí la reserva estadística ("< 5"). Ese texto sale tal cual (como en
 * `tableCell`): vacía, la celda diría «sin reportar» de un dato que sí existe.
 */
function freeCell(column: FreeTable["columns"][number], cell: FreeCell | undefined): CsvCell {
  if (column.kind === "cifra") return numberOf(cell) ?? textOrNull(textOf(cell));
  return textOrNull(textOf(cell));
}

/**
 * Las cifras de una fila de total, como las imprime la ficha (`freeTotalAt`):
 * sobre las filas de datos de su grupo y, en una fuente anual, de su año.
 */
function freeTotalCells(set: FreeTable, row: FreeRow, written: boolean): Record<string, FreeCell> {
  const scope = set.temporality === "anual" ? set.rows.filter((other) => other.year === row.year) : set.rows;
  return (written ? freeTotalShown : freeTotalAt)(scope, scope.indexOf(row), set.columns).cells;
}

/**
 * La fuente en ancho, con sus columnas. Añade «Año» si es anual y, si trae
 * títulos de grupo o totales, «Tipo de fila» y «Rótulo» para no confundirlos
 * con un dato. Los totales son los que la ficha ya imprime.
 *
 * `writtenTotals` es la regla de los conjuntos libres de UDES en Cifras
 * (`freeTotalShown`): la casilla que quien reporta escribió en la fila de total
 * sale tal cual, y la vacía se calcula. Sin la opción —Observatorio y
 * Tableros— el total es siempre el calculado sobre lo publicado y ninguna
 * celda de la fila de total sale del archivo: escrita, dejaría deducir una
 * reserva.
 */
export function freeSetToTable(set: FreeTable, { writtenTotals = false }: { writtenTotals?: boolean } = {}): CsvTable {
  const annual = set.temporality === "anual";
  const mixed = set.rows.some((row) => row.kind !== "dato");
  const header = uniqueLabels([
    ...(annual ? ["Año"] : []),
    ...(mixed ? ["Tipo de fila", "Rótulo"] : []),
    ...set.columns.map((column) => column.label || column.key),
  ]);
  const rows: CsvCell[][] = set.rows.map((row) => {
    const totals = row.kind === "total" ? freeTotalCells(set, row, writtenTotals) : null;
    return [
      ...(annual ? [row.year] : []),
      ...(mixed ? [ROW_KIND_LABEL[row.kind], textOrNull(row.label)] : []),
      ...set.columns.map((column): CsvCell => {
        if (row.kind === "grupo") return null;
        // Un total solo tiene cifras: las calculadas (`freeTotalAt` salta lo que no es
        // número, así que una reserva no entra en la suma), nunca una celda de la fuente.
        if (totals && writtenTotals) return freeCell(column, totals[column.key]);
        if (totals) return column.kind === "cifra" ? numberOf(totals[column.key]) : null;
        return freeCell(column, row.cells[column.key]);
      }),
    ];
  });
  return { header, rows };
}

/**
 * Una tabla personalizada (custom-table.ts), con sus textos y sus cifras como
 * están escritas: aquí el total es el que escribió quien publica, no se calcula.
 * El color no viaja, pero sí lo que dice: cada columna con reglas o con celdas
 * marcadas a mano trae al lado su «Tono», con el nombre del tono, y una fila
 * coloreada entera lo dice en «Tono de la fila». El corte va en cada fila, para
 * que ninguna cifra salga del archivo sin él.
 */
export function customTableToTable(set: { columns: FreeColumn[]; rows: FreeRow[] }, table: CustomTable): CsvTable {
  const mixed = set.rows.some((row) => row.kind !== "dato");
  const wholeRows = set.rows.some((row) => rowTone(row) !== null);
  const toned = new Set(
    set.columns
      .filter((column) => (table.rules?.[column.key] ?? []).length > 0 || set.rows.some((row) => manualTone(row, column.key) !== null))
      .map((column) => column.key),
  );
  const cut = table.cut?.trim() ?? "";
  const header = uniqueLabels([
    ...(mixed ? ["Tipo de fila"] : []),
    ...set.columns.flatMap((column) => {
      const name = column.label || column.key;
      const unit = unitOf(column);
      return [unit ? `${name} (${unit})` : name, ...(toned.has(column.key) ? [`Tono · ${name}`] : [])];
    }),
    ...(wholeRows ? ["Tono de la fila"] : []),
    ...(cut ? ["Corte"] : []),
  ]);
  const rows: CsvCell[][] = set.rows.map((row) => {
    const whole = rowTone(row);
    return [
      ...(mixed ? [ROW_KIND_LABEL[row.kind]] : []),
      ...set.columns.flatMap((column, index): CsvCell[] => {
        // Un título de grupo no tiene casillas: su texto va en la primera columna.
        const value: CsvCell = row.kind === "grupo" ? (index === 0 ? textOrNull(row.label) : null) : freeCell(column, row.cells[column.key]);
        if (!toned.has(column.key)) return [value];
        return [value, row.kind === "grupo" ? null : cellTone(table, column, row)?.label ?? null];
      }),
      ...(wholeRows ? [whole ? toneLabel(table, whole) : null] : []),
      ...(cut ? [cut] : []),
    ];
  });
  return { header, rows };
}

/* --- Modelo estadístico ----------------------------------------------------------------- */

/** B, error estándar, Wald, gl, sig., Exp(B) y su intervalo: las columnas de un coeficiente. */
const termCells = (term: ModelTerm): CsvCell[] => [term.b, term.se, term.wald, term.df, term.sig, term.or, term.lo, term.hi];
const NO_TERM: CsvCell[] = [null, null, null, null, null, null, null, null];

/** Una fila que solo trae un dato y su valor (ficha, ajuste, clasificación, muestra). */
const factRow = (section: string, name: string, category: string | null, value: CsvCell): CsvCell[] => [
  section,
  name,
  category,
  null,
  ...NO_TERM,
  value,
];

function modelCoefficients(model: ModelData): CsvCell[][] {
  const { intercept, variables } = model.spec;
  const constant: CsvCell[] = [
    "Coeficiente",
    "Constante",
    null,
    null,
    intercept.b,
    intercept.se,
    intercept.wald,
    null,
    intercept.sig,
    intercept.or,
    null,
    null,
    null,
  ];
  const levels = variables.flatMap((variable) =>
    variable.levels.map((level): CsvCell[] => ["Coeficiente", variable.label, level.label, variable.reference, ...termCells(level.term), null]),
  );
  const joint = variables.flatMap((variable): CsvCell[][] => {
    const test = variable.overall;
    if (!test) return [];
    return [["Prueba conjunta", variable.label, null, variable.reference, null, null, test.wald, test.df, test.sig, null, null, null, null]];
  });
  return [...levels, constant, ...joint];
}

function modelFacts(model: ModelData): CsvCell[][] {
  const { fit, classification, response, sample, composition, question, method } = model.spec;
  const observed = [
    { label: response.negative, row: classification.negative },
    { label: response.positive, row: classification.positive },
  ];
  return [
    factRow("Ajuste", "Desviación (−2LL)", null, fit.m2ll),
    factRow("Ajuste", "R² de Cox y Snell", null, fit.coxSnell),
    factRow("Ajuste", "R² de Nagelkerke", null, fit.nagelkerke),
    factRow("Ajuste", "Hosmer y Lemeshow (sig.)", null, fit.hosmerLemeshowSig),
    factRow("Ajuste", "Punto de corte", null, fit.cutoff),
    factRow("Ajuste", "Nivel de significancia", null, fit.significance),
    ...observed.flatMap(({ label, row }) => [
      factRow("Clasificación", `Observado: ${label}`, `Pronosticado: ${response.negative}`, row.negative),
      factRow("Clasificación", `Observado: ${label}`, `Pronosticado: ${response.positive}`, row.positive),
    ]),
    ...composition.flatMap((group) => group.items.map(([category, cases]) => factRow("Muestra", group.label, category, cases))),
    factRow("Ficha", "Modelo", null, model.title),
    factRow("Ficha", "Pregunta", null, textOrNull(question)),
    factRow("Ficha", "Respuesta", null, response.label),
    factRow("Ficha", "Método", null, textOrNull(method)),
    factRow("Ficha", "Casos", null, sample.n),
    factRow("Ficha", "Cohortes", null, textOrNull(periodText(sample.cohorts))),
    factRow("Ficha", "Población", null, textOrNull(sample.population)),
    factRow("Ficha", "Fuente de la muestra", null, textOrNull(sample.source)),
    factRow("Ficha", "Fuente", null, textOrNull(model.source)),
  ];
}

/**
 * Modelo en largo y en un solo archivo: los coeficientes («Variables en la
 * ecuación»), las pruebas conjuntas, el ajuste, la tabla de clasificación, la
 * composición de la muestra y la ficha técnica, cada fila con su sección.
 */
export function modelToTable(model: ModelData): CsvTable {
  const header = [
    "Sección",
    "Variable",
    "Categoría",
    "Referencia",
    "B",
    "Error estándar",
    "Wald",
    "gl",
    "Sig.",
    "Exp(B)",
    "IC 95 % inferior",
    "IC 95 % superior",
    "Valor",
  ];
  return { header, rows: [...modelCoefficients(model), ...modelFacts(model)] };
}
