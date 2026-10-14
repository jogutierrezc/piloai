/* =============================================================================
   Datos Abiertos · lectura desde Supabase.

   Dos pasos separados a propósito:

   1. `fetchOpenDataRows` trae las filas de las tablas `od_*` tal cual, sin
      incrustaciones: una consulta por tabla y en tres oleadas (periodo →
      informes → lo que cuelga de ellos). Las tablas grandes (valores, mapas)
      se paginan de mil en mil, que es el tope por respuesta de la API.
   2. `assembleCatalog` convierte esas filas en el catálogo que consumen las
      pantallas. Es una función pura: la intranet la reutiliza sobre los datos
      que acaba de editar y la prueba de humo la ejercita con fixtures.

   Lo publicado lo filtra la consulta además de RLS: una persona con sesión de
   intranet puede leer borradores, pero el portal público solo los muestra con
   ?vista-previa en la URL.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";
import { describeDatabaseError } from "../../../data/errors";
import type { DatabaseError } from "../../../data/errors";
import type {
  OdBreakdownRow,
  OdBreakdownValueRow,
  OdHeatmapCellRow,
  OdHeatmapRow,
  OdHistoryRow,
  OdHistoryValueRow,
  OdIndicatorRow,
  OdMapRow,
  OdMapValueRow,
  OdOffice,
  OdPeriod,
  OdPeriodCampus,
  OdPipelineRow,
  OdPipelineValueRow,
  OdReportBlockRow,
  OdReportRow,
  OdSectionRow,
  OdTableRecordRow,
  OdTableRow,
  OdRankingRow,
  OdRankingEditionRow,
  OdSaberProResultRow,
  OdSaberProRow,
  OdFreeSetRow,
  OdFreeSetRecordRow,
  OdSaberTytRow,
  OdSaberTytResultRow,
  OdModelRow,
  OdMedalBoardRow,
  OdMedalEntryRow,
  OdValueRow,
} from "../../../types/database";
import type {
  Breakdown,
  Campus,
  CampusId,
  HeatmapData,
  HistoryData,
  Indicator,
  MapDataset,
  OpenDataCatalog,
  PipelineCohort,
  PipelineData,
  Report,
  ReportBlock,
  ReportSection,
  TableData,
  YearCampusValues,
  ModelData,
  ModelSpec,
} from "./types";
import { ALL_CAMPUSES } from "./types";
import type { Term, TermCampusValues } from "./types";
import { annualFigure, periodText, TERMS } from "./terms";
import { editionFromRow } from "./rankings";
import type { RankingData } from "./rankings";
import type { MedalBoard } from "./medals";
import type { SaberProData } from "./saber-pro";
import type { FreeSet } from "./free-sets";
import type { SaberTytData } from "./saber-tyt";
import { emptyAlpha } from "./saber-alpha";

export interface OpenDataRows {
  period: OdPeriod;
  campuses: OdPeriodCampus[];
  offices: OdOffice[];
  reports: OdReportRow[];
  indicators: OdIndicatorRow[];
  values: OdValueRow[];
  breakdowns: OdBreakdownRow[];
  breakdownValues: OdBreakdownValueRow[];
  heatmaps: OdHeatmapRow[];
  heatmapCells: OdHeatmapCellRow[];
  maps: OdMapRow[];
  mapValues: OdMapValueRow[];
  pipelines: OdPipelineRow[];
  pipelineValues: OdPipelineValueRow[];
  histories: OdHistoryRow[];
  historyValues: OdHistoryValueRow[];
  sections: OdSectionRow[];
  tables: OdTableRow[];
  /** 0030: vacías si la base aún no tiene la migración. */
  rankings: OdRankingRow[];
  rankingEditions: OdRankingEditionRow[];
  /** 0031: vacías si la base aún no tiene la migración. */
  saberPro: OdSaberProRow[];
  saberProResults: OdSaberProResultRow[];
  /** 0033: vacías si la base aún no tiene la migración. */
  freeSets: OdFreeSetRow[];
  freeSetRows: OdFreeSetRecordRow[];
  /** 0035: vacías si la base aún no tiene la migración. */
  saberTyt: OdSaberTytRow[];
  saberTytResults: OdSaberTytResultRow[];
  /** 0046: vacía si la base aún no tiene la migración. */
  models: OdModelRow[];
  /** 0056: vacías si la base aún no tiene la migración. */
  medalBoards: OdMedalBoardRow[];
  medalEntries: OdMedalEntryRow[];
  tableRows: OdTableRecordRow[];
  blocks: OdReportBlockRow[];
}

const PAGE = 1000;

type Result<T> = { data: T[] | null; error: DatabaseError | null };

function unwrap<T>({ data, error }: Result<T>): T[] {
  if (error) throw describeDatabaseError(error);
  return data ?? [];
}

/** Tablas de una migración posterior (0022): si aún no existen, el portal sigue sin ellas. */
function unwrapOptional<T>({ data, error }: Result<T>): T[] {
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return [];
  return unwrap({ data, error });
}

/**
 * Trae todas las filas de una consulta que no tiene columna `id`.
 *
 * `od_heatmap_cells` y `od_map_values` se identifican por una clave compuesta,
 * así que no hay una sola columna por la que avanzar. Siguen paginando por
 * desplazamiento —son cientos de filas, no miles, y ahí el sobrecoste no se
 * nota—, pero ordenando por la clave *completa*: con `order("department_code")`
 * a secas, dos filas con el mismo departamento podían repetirse o perderse
 * justo en el corte entre dos páginas.
 */
async function fetchAllByOffset<T>(page: (from: number, to: number) => PromiseLike<Result<T>>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const chunk = unwrap(await page(from, from + PAGE - 1));
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
  }
}

/**
 * Trae todas las filas de una consulta, página a página.
 *
 * Se avanza por la clave —«dame las siguientes a esta»— y no por
 * desplazamiento. Con `range(2000, 2999)` la base tiene que recorrer *y
 * autorizar* también las 2.000 filas que se salta, de modo que cada página
 * sale más cara que la anterior; sobre `od_saber_pro_results`, con la
 * instancia fría, la tercera tardaba el doble que la primera y la consulta
 * llegó a agotar el tiempo del servidor. Pidiendo por clave, toda página
 * cuesta lo mismo que la primera.
 *
 * El orden en que lleguen da igual: el ensamblado siempre reordena por su
 * propia columna o indexa por clave, nunca confía en el orden de llegada.
 */
async function fetchAll<T>(page: (after: string | null) => PromiseLike<Result<T & { id: string }>>): Promise<T[]> {
  const rows: (T & { id: string })[] = [];
  let after: string | null = null;
  for (;;) {
    // Anotado a mano: si no, TypeScript intenta deducir el tipo de la página
    // a partir del cursor que esa misma página produce, y se muerde la cola.
    const chunk: (T & { id: string })[] = unwrap(await page(after));
    rows.push(...chunk);
    if (chunk.length < PAGE) return rows;
    after = chunk[chunk.length - 1].id;
  }
}

/**
 * Las familias de tablas que cuelgan de un informe: la cabecera del conjunto y
 * sus filas (od_indicators + od_values, od_maps + od_map_values…).
 */
export type RowFamily =
  | "indicators" | "breakdowns" | "heatmaps" | "maps" | "pipelines" | "histories" | "sections" | "tables"
  | "rankings" | "saberPro" | "freeSets" | "saberTyt" | "models" | "medalBoards" | "blocks";

interface FetchOptions {
  /** Periodo concreto (intranet). Sin él, el vigente. */
  periodId?: string;
  /** Incluir borradores. El portal público solo lo hace en vista previa. */
  includeDrafts?: boolean;
  /**
   * Relectura parcial (intranet): solo se vuelven a pedir las familias de
   * `only`; el resto se toma de `rows`, la lectura anterior del mismo periodo.
   * El periodo, sus campus, las oficinas y los informes se piden siempre: son
   * cuatro consultas pequeñas y de ellos depende qué filas siguen vivas.
   * Guardar una rejilla de cifras releía antes las treinta y tantas consultas
   * del periodo; así relee las de su familia.
   */
  reuse?: { rows: OpenDataRows; only: ReadonlySet<RowFamily> };
}

export async function fetchOpenDataRows({ periodId, includeDrafts = false, reuse }: FetchOptions = {}): Promise<OpenDataRows | null> {
  let periodQuery = supabase.from("od_periods").select("*");
  periodQuery = periodId ? periodQuery.eq("id", periodId) : periodQuery.eq("is_current", true);
  if (!includeDrafts) periodQuery = periodQuery.eq("status", "publicado");
  const { data: periodRow, error: periodError } = await periodQuery.maybeSingle();
  if (periodError) throw describeDatabaseError(periodError);
  if (!periodRow) return null;
  const period = periodRow as OdPeriod;

  let reportQuery = supabase.from("od_reports").select("*").eq("period_id", period.id).order("position");
  if (!includeDrafts) reportQuery = reportQuery.eq("status", "publicado");

  const [campuses, offices, reports] = await Promise.all([
    supabase.from("od_period_campuses").select("*").eq("period_id", period.id).order("position").then(unwrap<OdPeriodCampus>),
    supabase.from("od_offices").select("*").order("position").then(unwrap<OdOffice>),
    reportQuery.then(unwrap<OdReportRow>),
  ]);

  const reportIds = reports.map((r) => r.id);
  const empty: OpenDataRows = {
    period, campuses, offices, reports, indicators: [], values: [], breakdowns: [], breakdownValues: [],
    heatmaps: [], heatmapCells: [], maps: [], mapValues: [], pipelines: [], pipelineValues: [], histories: [],
    historyValues: [], sections: [], tables: [], tableRows: [], rankings: [], rankingEditions: [], saberPro: [], saberProResults: [], freeSets: [], freeSetRows: [], saberTyt: [], saberTytResults: [], models: [], blocks: [], medalBoards: [], medalEntries: [],
  };
  if (reportIds.length === 0) return empty;

  // Relectura parcial: una familia que no se pide sale de la lectura anterior,
  // recortada a los informes (y a las cabeceras) que siguen existiendo.
  const wanted = (family: RowFamily) => !reuse || reuse.only.has(family);
  const liveReports = new Set(reportIds);
  const head = <T extends { report_id: string }>(family: RowFamily, key: keyof OpenDataRows, load: () => PromiseLike<T[]>): PromiseLike<T[]> =>
    wanted(family) ? load() : Promise.resolve((reuse!.rows[key] as unknown as T[]).filter((row) => liveReports.has(row.report_id)));
  const tail = <T>(
    family: RowFamily,
    key: keyof OpenDataRows,
    parentOf: (row: T) => string,
    parents: { id: string }[],
    load: () => PromiseLike<T[]>,
  ): PromiseLike<T[]> => {
    if (!parents.length) return Promise.resolve([] as T[]);
    if (wanted(family)) return load();
    const live = new Set(parents.map((parent) => parent.id));
    return Promise.resolve((reuse!.rows[key] as unknown as T[]).filter((row) => live.has(parentOf(row))));
  };

  const [indicators, breakdowns, heatmaps, maps, pipelines, histories, sections, tables, rankings, saberPro, freeSets, saberTyt, models, medalBoards, blocks] = await Promise.all([
    head<OdIndicatorRow>("indicators", "indicators", () => supabase.from("od_indicators").select("*").in("report_id", reportIds).order("position").then(unwrap<OdIndicatorRow>)),
    head<OdBreakdownRow>("breakdowns", "breakdowns", () => supabase.from("od_breakdowns").select("*").in("report_id", reportIds).order("position").then(unwrap<OdBreakdownRow>)),
    head<OdHeatmapRow>("heatmaps", "heatmaps", () => supabase.from("od_heatmaps").select("*").in("report_id", reportIds).order("position").then(unwrap<OdHeatmapRow>)),
    head<OdMapRow>("maps", "maps", () => supabase.from("od_maps").select("*").in("report_id", reportIds).order("position").then(unwrap<OdMapRow>)),
    head<OdPipelineRow>("pipelines", "pipelines", () => supabase.from("od_pipelines").select("*").in("report_id", reportIds).order("position").then(unwrap<OdPipelineRow>)),
    head<OdHistoryRow>("histories", "histories", () => supabase.from("od_histories").select("*").in("report_id", reportIds).order("position").then(unwrap<OdHistoryRow>)),
    head<OdSectionRow>("sections", "sections", () => supabase.from("od_sections").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdSectionRow>)),
    head<OdTableRow>("tables", "tables", () => supabase.from("od_tables").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdTableRow>)),
    head<OdRankingRow>("rankings", "rankings", () => supabase.from("od_rankings").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdRankingRow>)),
    head<OdSaberProRow>("saberPro", "saberPro", () => supabase.from("od_saber_pro").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdSaberProRow>)),
    head<OdFreeSetRow>("freeSets", "freeSets", () => supabase.from("od_free_sets").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdFreeSetRow>)),
    head<OdSaberTytRow>("saberTyt", "saberTyt", () => supabase.from("od_saber_tyt").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdSaberTytRow>)),
    head<OdModelRow>("models", "models", () => supabase.from("od_models").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdModelRow>)),
    head<OdMedalBoardRow>("medalBoards", "medalBoards", () => supabase.from("od_medal_boards").select("*").in("report_id", reportIds).order("position").then(unwrapOptional<OdMedalBoardRow>)),
    head<OdReportBlockRow>("blocks", "blocks", () => supabase.from("od_report_blocks").select("*").in("report_id", reportIds).order("position").then(unwrap<OdReportBlockRow>)),
  ]);

  const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

  const [values, breakdownValues, heatmapCells, mapValues, pipelineValues, historyValues, tableRows, rankingEditions, saberProResults, freeSetRows, saberTytResults, medalEntries] = await Promise.all([
    tail<OdValueRow>("indicators", "values", (row) => row.indicator_id, indicators, () =>
      fetchAll<OdValueRow>((after) =>
          (after === null ? supabase.from("od_values").select("id,indicator_id,year,term,campus_id,value,updated_at")
              .in("indicator_id", ids(indicators)) : (supabase.from("od_values").select("id,indicator_id,year,term,campus_id,value,updated_at")
              .in("indicator_id", ids(indicators))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdBreakdownValueRow>("breakdowns", "breakdownValues", (row) => row.breakdown_id, breakdowns, () =>
      fetchAll<OdBreakdownValueRow>((after) =>
          (after === null ? supabase.from("od_breakdown_values").select("*").in("breakdown_id", ids(breakdowns)) : (supabase.from("od_breakdown_values").select("*").in("breakdown_id", ids(breakdowns))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdHeatmapCellRow>("heatmaps", "heatmapCells", (row) => row.heatmap_id, heatmaps, () =>
      fetchAllByOffset<OdHeatmapCellRow>((from, to) =>
          supabase.from("od_heatmap_cells").select("*").in("heatmap_id", ids(heatmaps))
            .order("heatmap_id").order("row_index").order("column_index").range(from, to),
        ),
    ),
    tail<OdMapValueRow>("maps", "mapValues", (row) => row.map_id, maps, () =>
      fetchAllByOffset<OdMapValueRow>((from, to) =>
          supabase.from("od_map_values").select("*").in("map_id", ids(maps))
            .order("map_id").order("year").order("campus_id").order("department_code").range(from, to),
        ),
    ),
    tail<OdPipelineValueRow>("pipelines", "pipelineValues", (row) => row.pipeline_id, pipelines, () =>
      fetchAll<OdPipelineValueRow>((after) =>
          (after === null ? supabase.from("od_pipeline_values").select("*").in("pipeline_id", ids(pipelines)) : (supabase.from("od_pipeline_values").select("*").in("pipeline_id", ids(pipelines))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdHistoryValueRow>("histories", "historyValues", (row) => row.history_id, histories, () =>
      fetchAll<OdHistoryValueRow>((after) =>
          (after === null ? supabase.from("od_history_values").select("*").in("history_id", ids(histories)) : (supabase.from("od_history_values").select("*").in("history_id", ids(histories))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdTableRecordRow>("tables", "tableRows", (row) => row.table_id, tables, () =>
      fetchAll<OdTableRecordRow>((after) =>
          (after === null ? supabase.from("od_table_rows").select("*").in("table_id", ids(tables)) : (supabase.from("od_table_rows").select("*").in("table_id", ids(tables))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdRankingEditionRow>("rankings", "rankingEditions", (row) => row.ranking_id, rankings, () =>
      supabase.from("od_ranking_editions").select("*").in("ranking_id", ids(rankings)).order("year").then(unwrapOptional<OdRankingEditionRow>),
    ),
    tail<OdSaberProResultRow>("saberPro", "saberProResults", (row) => row.saber_id, saberPro, () =>
      fetchAll<OdSaberProResultRow>((after) =>
          (after === null ? supabase.from("od_saber_pro_results")
              .select("id,saber_id,year,scope,campus,faculty,program,competency,evaluated,mean,levels,histogram")
              .in("saber_id", ids(saberPro)) : (supabase.from("od_saber_pro_results")
              .select("id,saber_id,year,scope,campus,faculty,program,competency,evaluated,mean,levels,histogram")
              .in("saber_id", ids(saberPro))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdFreeSetRecordRow>("freeSets", "freeSetRows", (row) => row.set_id, freeSets, () =>
      fetchAll<OdFreeSetRecordRow>((after) =>
          (after === null ? supabase.from("od_free_set_rows").select("id,set_id,position,year,kind,label,cells").in("set_id", ids(freeSets)) : (supabase.from("od_free_set_rows").select("id,set_id,position,year,kind,label,cells").in("set_id", ids(freeSets))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdSaberTytResultRow>("saberTyt", "saberTytResults", (row) => row.tyt_id, saberTyt, () =>
      fetchAll<OdSaberTytResultRow>((after) =>
          (after === null ? supabase.from("od_saber_tyt_results").select("*").in("tyt_id", ids(saberTyt)) : (supabase.from("od_saber_tyt_results").select("*").in("tyt_id", ids(saberTyt))).gt("id", after)).order("id").limit(PAGE),
        ),
    ),
    tail<OdMedalEntryRow>("medalBoards", "medalEntries", (row) => row.board_id, medalBoards, () =>
      supabase.from("od_medal_entries").select("*").in("board_id", ids(medalBoards)).order("position").then(unwrapOptional<OdMedalEntryRow>),
    ),
  ]);

  return {
    ...empty, indicators, values, breakdowns, breakdownValues, heatmaps, heatmapCells, maps, mapValues, pipelines,
    pipelineValues, histories, historyValues, sections, tables, tableRows, rankings, rankingEditions, saberPro,
    saberProResults, freeSets, freeSetRows, saberTyt, saberTytResults, models, blocks, medalBoards, medalEntries,
  };
}

/* --- Ensamblado -------------------------------------------------------------- */

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);

export function assembleCatalog(rows: OpenDataRows): OpenDataCatalog {
  const { period } = rows;
  const years = Array.from({ length: period.end_year - period.start_year + 1 }, (_, i) => period.start_year + i);
  const slugOf = new Map(rows.campuses.map((c) => [c.campus_id, c.slug]));
  const campusSlugs = rows.campuses.map((c) => c.slug);
  const officeName = new Map(rows.offices.map((o) => [o.id, o.name]));
  const source = (officeId: string | null) => (officeId ? officeName.get(officeId) ?? "" : "");
  const campusKey = (id: string | null): CampusId => (id === null ? ALL_CAMPUSES : slugOf.get(id) ?? id);
  /** Años con dato dentro del periodo; sin lista, todos. */
  const yearsOf = (list: number[] | null | undefined) =>
    list && list.length ? list.map(Number).filter((y) => years.includes(y)).sort((a, b) => a - b) : undefined;

  const campuses: Campus[] = [
    { id: ALL_CAMPUSES, name: "Todos los campus" },
    ...rows.campuses.map((c) => ({ id: c.slug, name: c.label, uuid: c.campus_id })),
  ];

  const valuesByIndicator = new Map<string, OdValueRow[]>();
  for (const v of rows.values) {
    const list = valuesByIndicator.get(v.indicator_id) ?? [];
    list.push(v);
    valuesByIndicator.set(v.indicator_id, list);
  }

  const reports: Report[] = rows.reports.map((report) => {
    const indicatorRows = rows.indicators.filter((i) => i.report_id === report.id);

    const indicators: Indicator[] = indicatorRows.map((row) => {
      // Lo reportado: por periodo (A, B) y, con la regla "reportado", la cifra del año.
      const terms: TermCampusValues = {};
      const reported: YearCampusValues = {};
      for (const year of years) {
        terms[year] = { A: {}, B: {} };
        reported[year] = {};
      }
      for (const v of valuesByIndicator.get(row.id) ?? []) {
        if (!terms[v.year]) continue;
        if (v.term === "anual") reported[v.year]![campusKey(v.campus_id)] = num(v.value);
        else terms[v.year]![v.term]![campusKey(v.campus_id)] = num(v.value);
      }

      // El total de lo que se suma, cuando no se capturó, sale de los campus,
      // periodo por periodo.
      const fillTotal = (cell: Partial<Record<CampusId, number | null>>) => {
        if (cell[ALL_CAMPUSES] !== undefined && cell[ALL_CAMPUSES] !== null) return;
        const parts = campusSlugs.map((slug) => cell[slug]);
        cell[ALL_CAMPUSES] = parts.every((p) => p !== undefined && p !== null)
          ? parts.reduce<number>((sum, p) => sum + (p as number), 0)
          : null;
      };
      if (row.aggregation === "suma" && campusSlugs.length > 0) {
        for (const year of years) {
          TERMS.forEach((term) => fillTotal(terms[year]![term]!));
          fillTotal(reported[year]!);
        }
      }

      // Por año: la cifra del año es la reportada y no hay periodos.
      const byYear = row.reporting === "anual";
      const rule = byYear ? "reportado" : row.annual_rule;

      // La cifra del año, campus por campus y para el total.
      const values: YearCampusValues = {};
      const annualFrom: Record<number, Partial<Record<CampusId, Term>>> = {};
      for (const year of years) {
        values[year] = {};
        annualFrom[year] = {};
        for (const key of [ALL_CAMPUSES, ...campusSlugs]) {
          const figure = annualFigure(
            rule,
            terms[year]!.A![key] ?? null,
            terms[year]!.B![key] ?? null,
            reported[year]![key] ?? null,
          );
          values[year]![key] = figure.value;
          if (figure.from) annualFrom[year]![key] = figure.from;
        }
      }
      return {
        id: row.key,
        uuid: row.id,
        label: row.label,
        unit: row.unit,
        format: row.format,
        direction: row.direction,
        aggregation: row.aggregation,
        definition: row.definition,
        source: source(row.office_id),
        officeId: row.office_id,
        isKpi: row.is_kpi,
        kpiPosition: row.kpi_position,
        isHeadline: row.is_headline,
        years: yearsOf(row.years),
        values,
        reporting: byYear ? "anual" : "periodo",
        annualRule: byYear ? undefined : row.annual_rule,
        terms: byYear ? undefined : terms,
        annualFrom,
      };
    });

    const kpis = indicatorRows
      .filter((i) => i.is_kpi)
      .sort((a, b) => (Number(b.is_headline) - Number(a.is_headline)) || ((a.kpi_position ?? 99) - (b.kpi_position ?? 99)) || a.position - b.position)
      .map((i) => i.key);

    const breakdowns: Breakdown[] = rows.breakdowns
      .filter((b) => b.report_id === report.id)
      .map((b) => {
        const values: Breakdown["values"] = {};
        const terms: NonNullable<Breakdown["terms"]> = {};
        const sourceRows = rows.breakdownValues
          .filter((v) => v.breakdown_id === b.id)
          .sort((x, y) => x.position - y.position);
        const byYear = b.reporting === "anual";
        const rule = byYear ? "reportado" : b.annual_rule ?? "reportado";
        for (const year of yearsOf(b.years) ?? years) {
          const yearRows = sourceRows.filter((v) => v.year === year);
          if (!yearRows.length) continue;
          terms[year] = {};
          for (const term of TERMS) {
            terms[year][term] = yearRows
              .filter((v) => v.term === term)
              .map((v) => ({ label: v.label, value: num(v.value), reserved: v.reserved || undefined }));
          }
          values[year] = Array.from(new Set(yearRows.map((v) => v.label))).map((label) => {
            const cells = yearRows.filter((v) => v.label === label);
            const get = (term: string) => num(cells.find((v) => (v.term ?? "anual") === term)?.value);
            // Reservada en cualquier periodo, reservada en la cifra del año: la
            // suma de un corte público y uno reservado seguiría delatándolo.
            const reserved = cells.some((v) => v.reserved);
            return { label, value: annualFigure(rule, get("A"), get("B"), get("anual")).value, reserved: reserved || undefined };
          });
        }
        return {
          id: b.key, uuid: b.id, title: b.title, unit: b.unit, format: b.format,
          source: source(b.office_id), officeId: b.office_id, defaultChart: b.default_chart, years: yearsOf(b.years), values,
          reserveThreshold: b.reserve_threshold ?? undefined,
          // Solo se anota cuando se apagó: sin la opción, el desglose va con total.
          showTotal: b.show_total === false ? false : undefined,
          reporting: byYear ? "anual" : "periodo", annualRule: rule, terms: byYear ? undefined : terms,
        };
      });

    const heatmaps: HeatmapData[] = rows.heatmaps
      .filter((h) => h.report_id === report.id)
      .map((h) => {
        const matrix = h.rows.map(() => h.columns.map(() => null as number | null));
        rows.heatmapCells
          .filter((c) => c.heatmap_id === h.id)
          .forEach((c) => {
            if (matrix[c.row_index] && c.column_index < h.columns.length) matrix[c.row_index][c.column_index] = num(c.value);
          });
        return {
          id: h.key, uuid: h.id, title: h.title, description: h.description, rowLabel: h.row_label,
          columnLabel: h.column_label, rows: h.rows, columns: h.columns, values: matrix, unit: h.unit,
          format: h.format, source: source(h.office_id), officeId: h.office_id, emptyMeaning: h.empty_meaning,
        };
      });

    const maps: MapDataset[] = rows.maps
      .filter((m) => m.report_id === report.id)
      .map((m) => {
        const values: MapDataset["values"] = {};
        const reserved: NonNullable<MapDataset["reserved"]> = {};
        rows.mapValues
          .filter((v) => v.map_id === m.id)
          .forEach((v) => {
            // Menos de 5 personas (0044): la celda existe, pero sin cifra.
            if (v.reserved || v.value === null) {
              ((reserved[v.year] ??= {})[campusKey(v.campus_id)] ??= []).push(v.department_code);
              return;
            }
            const byCampus = (values[v.year] ??= {});
            const depts = (byCampus[campusKey(v.campus_id)] ??= {});
            depts[v.department_code] = Number(v.value);
          });
        return {
          id: m.key, uuid: m.id, title: m.title, description: m.description, mode: m.mode, reporting: m.reporting ?? "anual", unit: m.unit,
          source: source(m.office_id), officeId: m.office_id, years: yearsOf(m.years), values,
          reserved: Object.keys(reserved).length ? reserved : undefined,
        };
      });

    const pipelines: PipelineData[] = rows.pipelines
      .filter((p) => p.report_id === report.id)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((p) => {
        const measure = p.measure ?? "estudiantes";
        const stageCount = p.stages.length;
        const groups = new Map<string, { cohort: string; campus: CampusId; raw: (number | null)[]; mainCause: string[] }>();
        rows.pipelineValues
          .filter((v) => v.pipeline_id === p.id)
          .forEach((v) => {
            const campus = campusKey(v.campus_id);
            const key = `${periodText(v.cohort)}|${campus}`;
            const group = groups.get(key) ?? {
              // "2014-A" se muestra "2014-1": ver periodText.
              cohort: periodText(v.cohort),
              campus,
              raw: Array.from({ length: stageCount }, () => null),
              mainCause: Array.from({ length: Math.max(0, stageCount - 1) }, () => ""),
            };
            if (v.stage_index < stageCount) group.raw[v.stage_index] = num(v.value);
            if (v.stage_index > 0) group.mainCause[v.stage_index - 1] = v.main_cause;
            groups.set(key, group);
          });

        // Estudiantes: el total de la cohorte, si no se capturó, es la suma de los
        // campus cuando están todos. Los porcentajes no se suman: su total se captura.
        if (measure === "estudiantes") {
          const cohorts = Array.from(new Set(Array.from(groups.values()).map((g) => g.cohort)));
          for (const cohort of cohorts) {
            if (groups.has(`${cohort}|${ALL_CAMPUSES}`)) continue;
            const parts = campusSlugs.map((slug) => groups.get(`${cohort}|${slug}`));
            if (parts.some((part) => !part)) continue;
            groups.set(`${cohort}|${ALL_CAMPUSES}`, {
              cohort,
              campus: ALL_CAMPUSES,
              raw: Array.from({ length: stageCount }, (_, i) => {
                const values = parts.map((part) => part!.raw[i]);
                return values.some((v) => v === null) ? null : values.reduce<number>((a, b) => a + (b as number), 0);
              }),
              mainCause: parts[0]!.mainCause,
            });
          }
        }

        const cohorts: PipelineCohort[] = Array.from(groups.values())
          .sort((a, b) => a.cohort.localeCompare(b.cohort))
          .map((g) => {
            if (measure !== "desercion") return { cohort: g.cohort, campus: g.campus, remaining: g.raw, mainCause: g.mainCause };
            // Deserción acumulada: la cifra capturada ya es el % de la cohorte que
            // se retiró al llegar a cada etapa. Se usa tal cual (lo que sigue es
            // 100 menos ella); volver a encadenarla tramo por tramo contaría dos
            // veces el porcentaje y inflaría la deserción.
            const remaining: (number | null)[] = [100];
            for (let i = 1; i < stageCount; i += 1) {
              const lost = g.raw[i];
              remaining.push(lost === null ? null : Math.round((100 - lost) * 100) / 100);
            }
            return { cohort: g.cohort, campus: g.campus, remaining, mainCause: g.mainCause };
          });

        return {
          id: p.key, uuid: p.id, title: p.title, description: p.description, measure, stages: p.stages, cohorts,
          source: source(p.office_id), officeId: p.office_id,
        };
      });

    const histories: HistoryData[] = rows.histories
      .filter((h) => h.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((h) => {
        // Los periodos se guardan "2020-A"; en el portal y el boletín se leen "2020-1".
        const list = rows.historyValues
          .filter((v) => v.history_id === h.id)
          .map((v) => ({ ...v, period_label: periodText(v.period_label) }));
        const periods = Array.from(new Set(list.map((v) => v.period_label))).sort();
        const categories = Array.from(
          new Map(
            list
              .filter((v) => v.category !== "")
              .sort((a, b) => a.position - b.position)
              .map((v) => [v.category, v.category]),
          ).keys(),
        );
        const values: HistoryData["values"] = {};
        const total: HistoryData["total"] = {};
        for (const category of categories) values[category] = {};
        for (const v of list) {
          if (v.category === "") total[v.period_label] = num(v.value);
          else values[v.category]![v.period_label] = num(v.value);
        }
        // Sin total capturado, la suma de las categorías cuando están todas.
        for (const period of periods) {
          if (total[period] !== undefined && total[period] !== null) continue;
          const parts = categories.map((c) => values[c]![period]);
          total[period] = categories.length && parts.every((part) => part !== undefined && part !== null)
            ? parts.reduce<number>((a, b) => a + (b as number), 0)
            : null;
        }
        return {
          id: h.key, uuid: h.id, title: h.title, description: h.description, unit: h.unit, format: h.format,
          totalLabel: h.total_label, source: source(h.office_id), officeId: h.office_id, periods, categories, total, values,
        };
      });

    const sections: ReportSection[] = (rows.sections ?? [])
      .filter((s) => s.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((s) => ({
        key: s.key, uuid: s.id, number: s.number, title: s.title, status: s.status, lede: s.lede, warning: s.warning,
        source: s.source, requested: Array.isArray(s.requested) ? s.requested : [], position: s.position,
      }));

    const tables: TableData[] = (rows.tables ?? [])
      .filter((t) => t.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: t.key, uuid: t.id, title: t.title, description: t.description, display: t.display,
        columns: Array.isArray(t.columns) ? t.columns : [],
        rows: (rows.tableRows ?? []).filter((r) => r.table_id === t.id).sort((a, b) => a.position - b.position).map((r) => r.cells ?? {}),
        source: source(t.office_id),
      }));

    const refKey = (refId: string | null) =>
      refId === null
        ? null
        : breakdowns.find((b) => b.uuid === refId)?.id ??
          tables.find((t) => t.uuid === refId)?.id ??
          heatmaps.find((h) => h.uuid === refId)?.id ??
          maps.find((m) => m.uuid === refId)?.id ??
          pipelines.find((p) => p.uuid === refId)?.id ??
          histories.find((h) => h.uuid === refId)?.id ??
          freeSets.find((f) => f.uuid === refId)?.id ??
          null;

    const rankings: RankingData[] = (rows.rankings ?? [])
      .filter((r) => r.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((r) => ({
        id: r.key, uuid: r.id, title: r.title, description: r.description, system: r.system, accent: r.accent, view: r.view,
        source: source(r.office_id), officeId: r.office_id,
        editions: (rows.rankingEditions ?? []).filter((e) => e.ranking_id === r.id).map(editionFromRow).sort((a, b) => a.year - b.year),
      }));

    const medals: MedalBoard[] = (rows.medalBoards ?? [])
      .filter((b) => b.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((b) => ({
        id: b.key, uuid: b.id, title: b.title, description: b.description,
        rowLabel: b.row_label, reporting: b.reporting, scope: b.scope,
        fixedYear: b.fixed_year, sort: b.sort,
        tiers: Array.isArray(b.tiers) ? b.tiers : [],
        note: b.note, source: source(b.office_id), officeId: b.office_id,
        entries: (rows.medalEntries ?? [])
          .filter((e) => e.board_id === b.id)
          .map((e) => ({
            year: e.year, term: e.term, label: e.label,
            counts: e.counts ?? {}, note: e.note ?? "", position: e.position,
          })),
      }));

    const saberPro: SaberProData[] = (rows.saberPro ?? [])
      .filter((sp) => sp.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((sp) => ({
        id: sp.key, uuid: sp.id, title: sp.title, description: sp.description, note: sp.note,
        source: source(sp.office_id), officeId: sp.office_id,
        results: (rows.saberProResults ?? [])
          .filter((r) => r.saber_id === sp.id)
          .map((r) => ({
            year: r.year, scope: r.scope, campus: r.campus, faculty: r.faculty, program: r.program,
            competency: r.competency, evaluated: r.evaluated, mean: num(r.mean),
            levels: r.levels ?? {}, histogram: r.histogram ?? {},
          })),
      }));

    const freeSets: FreeSet[] = (rows.freeSets ?? [])
      .filter((fs) => fs.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((fs) => ({
        id: fs.key, uuid: fs.id, title: fs.title, description: fs.description, source: source(fs.office_id), officeId: fs.office_id,
        temporality: fs.temporality, periodLabel: fs.period_label ?? "",
        columns: Array.isArray(fs.columns) ? fs.columns : [],
        views: Array.isArray(fs.views) ? fs.views : [],
        rows: (rows.freeSetRows ?? [])
          .filter((r) => r.set_id === fs.id)
          .sort((a, b) => a.position - b.position)
          .map((r) => ({ year: r.year, kind: r.kind ?? "dato", label: r.label ?? "", cells: r.cells ?? {} })),
      }));

    const saberTyt: SaberTytData[] = (rows.saberTyt ?? [])
      .filter((t) => t.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((t) => ({
        id: t.key, uuid: t.id, title: t.title, description: t.description, note: t.note,
        source: source(t.office_id), officeId: t.office_id, benchmarks: t.benchmarks ?? {},
        alpha: t.alpha && Object.keys(t.alpha).length ? t.alpha : emptyAlpha(),
        results: (rows.saberTytResults ?? [])
          .filter((r) => r.tyt_id === t.id)
          .map((r) => ({
            year: r.year, level: r.level, program: r.program, competency: r.competency,
            evaluated: r.evaluated, meanExit: num(r.mean_exit), paired: r.paired, meanEntry: num(r.mean_entry),
            meanDelta: num(r.mean_delta), improved: r.improved, rawEntry: num(r.raw_entry), rawExit: num(r.raw_exit),
            transitions: r.transitions ?? {}, histogram: r.histogram ?? {}, scatter: r.scatter ?? {},
            alphaN: r.alpha_n ?? null, alphaExpected: num(r.alpha_expected), alphaActual: num(r.alpha_actual),
            alphaVa: num(r.alpha_va), alphaPositive: r.alpha_positive ?? null,
            plane: r.plane ?? {}, quadrants: r.quadrants ?? {}, quadPlane: r.quad_plane ?? {},
          })),
      }));

    // Modelos: la especificación se publica tal cual; una sin variables no se dibuja.
    const models: ModelData[] = (rows.models ?? [])
      .filter((m) => m.report_id === report.id && Array.isArray((m.spec as { variables?: unknown }).variables))
      .sort((a, b) => a.position - b.position)
      .map((m) => ({
        id: m.key, uuid: m.id, title: m.title, description: m.description, note: m.note,
        spec: m.spec as unknown as ModelSpec, source: source(m.office_id), officeId: m.office_id,
      }));

    const blocks: ReportBlock[] = rows.blocks
      .filter((b) => b.report_id === report.id)
      .sort((a, b) => a.position - b.position)
      .map((b) => ({
        uuid: b.id, kind: b.kind, refKey: refKey(b.ref_id), visible: b.visible, position: b.position,
        settings: b.settings ?? {},
        sectionKey: b.section_id ? sections.find((s) => s.uuid === b.section_id)?.key ?? null : null,
      }));

    return {
      uuid: report.id,
      slug: report.slug,
      code: report.code,
      name: report.name,
      summary: report.summary,
      description: report.description,
      image: { src: report.image_url, alt: report.image_alt, credit: report.image_credit },
      line: report.line,
      keyIndicators: kpis,
      indicators,
      breakdowns,
      heatmaps,
      maps,
      pipelines,
      histories,
      sections,
      tables,
      rankings,
      medals,
      saberPro,
      freeSets,
      saberTyt,
      models,
      blocks,
      note: report.note || undefined,
      status: report.status,
      position: report.position,
      updatedAt: report.updated_at,
    };
  });

  return {
    period: {
      uuid: period.id,
      label: period.label,
      startYear: period.start_year,
      endYear: period.end_year,
      status: period.status,
    },
    years,
    currentYear: period.end_year,
    campuses,
    illustrative: period.illustrative,
    cutoffDate: period.cutoff_date,
    reports,
  };
}
