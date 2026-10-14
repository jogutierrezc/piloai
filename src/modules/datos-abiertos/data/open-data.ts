/* =============================================================================
   Datos Abiertos · acceso y formato.

   Las pantallas piden el catálogo con `useOpenDataCatalog()`: lee las tablas
   od_* de Supabase (repository.ts) y devuelve `null` si todavía no hay un
   periodo publicado. Con ?vista-previa en la URL, quien tiene sesión de
   intranet ve también los borradores, tal como quedarán al publicar.
   ========================================================================== */

import { formatBig } from "./big-numbers";
import { useQuery } from "@tanstack/react-query";
import { assembleCatalog, fetchOpenDataRows } from "./repository";
import type { Breakdown, BreakdownItem, CampusId, Indicator, MapDataset, OpenDataCatalog, Report, Term, ValueFormat } from "./types";
import { ALL_YEARS, annualBasis, setPeriodSpan, TERMS } from "./terms";
import { isWorldMap } from "./types";
import { downloadText } from "./download";
import { formatReserved, RESERVE_DEFAULT, valueOf } from "./reserve";

export const openDataKeys = {
  all: ["datos-abiertos"] as const,
  catalog: (preview: boolean) => [...openDataKeys.all, "catalogo", preview ? "vista-previa" : "publico"] as const,
};

/** ¿La URL pide ver los borradores? */
export function isPreview(): boolean {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).has("vista-previa");
}

export function useOpenDataCatalog() {
  const preview = isPreview();
  return useQuery({
    queryKey: openDataKeys.catalog(preview),
    queryFn: async (): Promise<OpenDataCatalog | null> => {
      const rows = await fetchOpenDataRows({ includeDrafts: preview });
      return rows ? withPeriodView(assembleCatalog(rows)) : null;
    },
  });
}

export function findReport(data: OpenDataCatalog, slug: string | undefined): Report | undefined {
  return data.reports.find((report) => report.slug === slug);
}

/* --- Todo el periodo ---------------------------------------------------------
   Las cifras de todos los años se agrupan en el corte ALL_YEARS con promedios,
   no sumas: sumar matrícula o tasas de seis años daría cifras falsas, y el
   promedio conserva la forma de los datos (el reparto entre campus, países o
   categorías es el mismo que el de la suma).
   · Indicadores con regla "último periodo" (existencias: matrícula, docentes):
     la cifra del último año con dato, porque promediar existencias no dice nada
     que el último corte no diga mejor.
   · Los demás indicadores, los desgloses y los mapas por departamento: promedio
     anual de los años con dato. Un año sin reportar no cuenta como cero.
   · Los mapas del mundo (movilidad y convenios por año): total del periodo.
     Cada participante es un viaje distinto y cada convenio inscrito en un año
     es uno nuevo, así que sumar los años no repite a nadie.
   · Un mapa de dato global no tiene años: su cifra ya es la del periodo. */

const average = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;

function groupIndicator(indicator: Indicator, years: number[]): Indicator {
  const own = indicator.years ? years.filter((y) => indicator.years!.includes(y)) : years;
  const campuses = new Set(own.flatMap((y) => Object.keys(indicator.values[y] ?? {})));
  const values: Partial<Record<CampusId, number | null>> = {};
  const basis: Partial<Record<CampusId, string>> = {};
  for (const campus of campuses) {
    const reported = own
      .map((y) => ({ year: y, value: indicator.values[y]?.[campus] }))
      .filter((p): p is { year: number; value: number } => p.value !== null && p.value !== undefined);
    if (!reported.length) continue;
    if (indicator.annualRule === "ultimo") {
      const last = reported[reported.length - 1];
      values[campus] = last.value;
      basis[campus] = `último dato: ${last.year}`;
    } else {
      values[campus] = average(reported.map((p) => p.value));
      basis[campus] = reported.length === 1 ? `solo ${reported[0].year}` : `promedio anual de ${reported.length} años`;
    }
  }
  return { ...indicator, values: { ...indicator.values, [ALL_YEARS]: values }, periodBasis: basis };
}

function groupBreakdown(breakdown: Breakdown, years: number[]): Breakdown {
  const own = (breakdown.years ? years.filter((y) => breakdown.years!.includes(y)) : years).filter((y) =>
    (breakdown.values[y] ?? []).some((item) => item.value !== null),
  );
  if (!own.length) return breakdown;
  const labels = Array.from(new Set(own.flatMap((y) => breakdown.values[y]!.map((item) => item.label))));
  const items: BreakdownItem[] = labels.map((label) => {
    const reported = own
      .map((y) => breakdown.values[y]!.find((item) => item.label === label)?.value)
      .filter((v): v is number => v !== null && v !== undefined);
    return { label, value: reported.length ? average(reported) : null };
  });
  return { ...breakdown, values: { ...breakdown.values, [ALL_YEARS]: items } };
}

function groupMap(map: MapDataset, years: number[]): MapDataset {
  // Un dato global ya viene en la clave ALL_YEARS: no hay años que agrupar.
  if (map.reporting === "global") return map;
  const own = (map.years ? years.filter((y) => map.years!.includes(y)) : years).filter((y) =>
    Object.values(map.values[y] ?? {}).some((codes) => codes && Object.keys(codes).length > 0),
  );
  if (!own.length) return map;
  // Movilidad: suma de los años. Por departamento: promedio sobre los años con
  // dato del mapa, así un departamento que solo aparece un año pesa lo que pesó
  // ese año dividido entre todos.
  const divisor = isWorldMap(map.mode) ? 1 : own.length;
  const grouped: Partial<Record<CampusId, Record<string, number>>> = {};
  for (const y of own) {
    for (const [campus, codes] of Object.entries(map.values[y] ?? {})) {
      const target = (grouped[campus] ??= {});
      for (const [code, value] of Object.entries(codes ?? {})) target[code] = (target[code] ?? 0) + value / divisor;
    }
  }
  return { ...map, values: { ...map.values, [ALL_YEARS]: grouped } };
}

/** Añade al catálogo el corte "todo el periodo" (ALL_YEARS) con las cifras agrupadas. */
export function withPeriodView(catalog: OpenDataCatalog): OpenDataCatalog {
  const years = catalog.years;
  if (years.length) setPeriodSpan(years[0], years[years.length - 1]);
  return {
    ...catalog,
    reports: catalog.reports.map((report) => ({
      ...report,
      indicators: report.indicators.map((i) => groupIndicator(i, years)),
      breakdowns: report.breakdowns.map((b) => groupBreakdown(b, years)),
      maps: report.maps?.map((m) => groupMap(m, years)),
    })),
  };
}

/** Cómo salió la cifra de todo el periodo: "promedio anual de 6 años", "último dato: 2025". */
export function periodBasisOf(indicator: Indicator, campus: CampusId): string | null {
  return indicator.periodBasis?.[campus] ?? null;
}

// `valueOf` (la cifra de un corte) vive en reserve.ts, sin Supabase detrás, para
// que el exportador de CSV lo lea en las pruebas. Aquí se sigue ofreciendo.
export { valueOf };

/** ¿El indicador trae cifras por periodo? */
export function hasTerms(indicator: Indicator): boolean {
  return Boolean(indicator.terms && indicator.annualRule);
}

/** Qué hay detrás de la cifra del corte, para el boleto: "periodos 1 + 2", "periodo 2". */
export function basisOf(indicator: Indicator, year: number, campus: CampusId, term?: Term | null): string | null {
  if (year === ALL_YEARS) return periodBasisOf(indicator, campus);
  if (term || !hasTerms(indicator) || valueOf(indicator, year, campus) === null) return null;
  return annualBasis(indicator.annualRule, indicator.annualFrom?.[year]?.[campus]);
}

/** Cortes en orden: años, o periodos 1 y 2 de cada año. */
export function cutsOf(years: number[], bySemester: boolean): { year: number; term: Term | null }[] {
  return bySemester ? years.flatMap((year) => TERMS.map((term) => ({ year, term }))) : years.map((year) => ({ year, term: null }));
}

export function keyIndicators(report: Report): Indicator[] {
  return report.keyIndicators
    .map((id) => report.indicators.find((indicator) => indicator.id === id))
    .filter((indicator): indicator is Indicator => Boolean(indicator));
}

/* --- Formato ---------------------------------------------------------------
   es-CO: punto de miles y coma decimal. Los porcentajes llevan un decimal
   porque las tasas se mueven de a décimas; los enteros nunca llevan decimales. */

const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatValue(value: number | null, format: ValueFormat): string {
  if (value === null) return "—";
  if (format === "entero") return integer.format(value);
  return oneDecimal.format(value);
}

/**
 * Conteo de personas que puede venir promediado (todo el periodo): entero si lo
 * es o si es grande; si no, un decimal, para que 0,3 participantes al año no
 * se lea como cero.
 */
export function formatCount(value: number | null): string {
  if (value === null) return "—";
  return Number.isInteger(value) || Math.abs(value) >= 100 ? integer.format(value) : oneDecimal.format(value);
}

/** Cifra con su unidad, para lectores de pantalla y tooltips. */
/**
 * La cifra donde no hay sitio (ejes, rótulos sobre barras, paletas): de un
 * millón en adelante se abrevia («12,3 mil M»); la exacta sigue en el tooltip,
 * la tabla y el texto para lectores de pantalla. Ver big-numbers.ts.
 */
export function formatCompact(value: number | null, format: ValueFormat): string {
  if (value === null) return "—";
  return formatBig(value, (v) => formatValue(v, format));
}

export function formatWithUnit(value: number | null, format: ValueFormat, unit: string): string {
  if (value === null) return "Sin reportar";
  const figure = formatValue(value, format);
  return unit === "%" ? `${figure} %` : `${figure} ${unit}`;
}

/* --- Reserva estadística -----------------------------------------------------
   Una celda reservada no es un vacío ni un cero: tiene dato, pero tan pocos
   registros que publicarlo señalaría a personas concretas. Se escribe siempre
   como un techo ("< 5"), nunca como su número, y se dice en voz alta distinto
   que un "sin reportar", porque significan cosas opuestas: aquí sí hay gente.
   El umbral y su escritura ("< 5") viven en reserve.ts. */

export { formatReserved, RESERVE_DEFAULT };

/** Cifra del desglose, respetando la reserva. */
export function formatCell(
  value: number | null,
  format: ValueFormat,
  reserved?: boolean,
  threshold = RESERVE_DEFAULT,
): string {
  return reserved ? formatReserved(threshold) : formatValue(value, format);
}

/** Lo mismo, hablado: para lectores de pantalla y tooltips. */
export function formatCellWithUnit(
  value: number | null,
  format: ValueFormat,
  unit: string,
  reserved?: boolean,
  threshold = RESERVE_DEFAULT,
): string {
  if (!reserved) return formatWithUnit(value, format, unit);
  return unit === "%" ? `menos de ${threshold} %` : `menos de ${threshold} ${unit}`;
}

export interface Change {
  /** Texto listo: "+3,6 %" o "−0,5 p. p." */
  label: string;
  /** Si el cambio va en la dirección deseada del indicador. */
  reading: "mejora" | "empeora" | "igual" | "neutro";
}

/** Variación frente al corte anterior. Las tasas cambian en puntos, no en porcentaje. */
export function changeBetween(indicator: Indicator, current: number | null, previous: number | null): Change | null {
  if (current === null || previous === null) return null;

  let label: string;
  if (indicator.format === "porcentaje") {
    const diff = current - previous;
    label = `${diff > 0 ? "+" : diff < 0 ? "−" : "±"}${oneDecimal.format(Math.abs(diff))} p. p.`;
  } else if (previous === 0) {
    return null;
  } else {
    const pct = ((current - previous) / previous) * 100;
    label = `${pct > 0 ? "+" : pct < 0 ? "−" : "±"}${oneDecimal.format(Math.abs(pct))} %`;
  }

  const delta = current - previous;
  let reading: Change["reading"] = "neutro";
  if (delta === 0) reading = "igual";
  else if (indicator.direction === "sube") reading = delta > 0 ? "mejora" : "empeora";
  else if (indicator.direction === "baja") reading = delta < 0 ? "mejora" : "empeora";

  return { label, reading };
}

export function formatCutoff(iso: string): string {
  return new Intl.DateTimeFormat("es-CO", { day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${iso}T12:00:00`),
  );
}

/* --- Descarga en CSV -------------------------------------------------------
   Datos abiertos que no se pueden bajar no son abiertos. Los CSV de la ficha
   los arma y los escribe csv-export.ts, desde el registro (export-registry.ts). */

// La descarga vive en download.ts, que no arrastra Supabase. Aquí se sigue ofreciendo.
export { downloadText };
