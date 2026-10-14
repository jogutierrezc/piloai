/* =============================================================================
   Datos Abiertos · conjuntos libres (0033).

   Una fuente de datos con las columnas que defina quien la reporta y todas las
   filas que quiera, sobre la que se arman gráficas ("vistas"). Cada vista lee
   una sola fuente: así cada cifra conserva su oficina y su corte.

   Temporalidad de la fuente, elegida al crearla:
   · sin_tiempo  un dato suelto, sin año (convenios por país, sedes por área).
   · anual       cada fila es de un año: la ficha filtra por año y las líneas
                 y áreas recorren los años.
   · periodo     un dato global para un rango ("2020–2025"): se rotula así.

   Columnas:
   · texto       categoría (sede, programa, criterio).
   · cifra       número, con formato y unidad.
   · fecha       inicio o fin de una tarea en el Gantt ("2025-03-01" o 2025).
   · territorio  departamento (código DANE o nombre) o país (ISO alfa-3 o
                 nombre), para los mapas.

   El tipo orienta, no bloquea: una casilla que no encaja con su columna (un
   texto en una cifra) se guarda tal cual. Las gráficas la saltan; las tablas y
   el CSV la muestran como está escrita (`cellShown`).

   Un vacío no es un cero: una casilla sin dato es `null` y se dibuja aparte.
   ========================================================================== */

import type { ValueFormat } from "./types";
import { DEPARTMENTS } from "./colombia-map";
import { COUNTRIES } from "./world-map";
import type { CustomTable } from "./custom-table";

export type FreeTemporality = "sin_tiempo" | "anual" | "periodo";
export type FreeColumnKind = "texto" | "cifra" | "fecha" | "territorio";
export type FreeTerritory = "departamento" | "pais";

export interface FreeColumn {
  key: string;
  label: string;
  kind: FreeColumnKind;
  /** Cifras: cómo se escriben. */
  format?: ValueFormat;
  /** Cifras: "estudiantes", "%", "puntos". */
  unit?: string;
  /** Territorio: qué tipo. */
  territory?: FreeTerritory;
  /** Cifras de una tabla personalizada: cuántos decimales se escriben (0 a 4). */
  decimals?: number;
  /**
   * Texto con lista cerrada: la columna es una categoría o un estado
   * («Cumple», «En proceso»…) y solo admite estos valores. Para las gráficas
   * sigue siendo una columna de texto.
   */
  options?: string[];
}

export type FreeCell = string | number | null;

/**
 * Qué es una fila: un dato, un título que agrupa las siguientes hasta el
 * próximo título, o un total de las filas de datos de su grupo. Cada casilla
 * del total puede venir escrita por quien reporta; la que queda vacía se
 * calcula (ver `freeTotalShown`). Las gráficas solo leen las de datos: un
 * total junto a sus partes contaría dos veces lo mismo.
 */
export type FreeRowKind = "dato" | "grupo" | "total";

export interface FreeRow {
  /** Solo en fuentes anuales. */
  year: number | null;
  kind: FreeRowKind;
  /** Texto del título o del total; vacío en una fila de datos. */
  label: string;
  cells: Record<string, FreeCell>;
}

export type FreeChartType =
  | "barras"
  | "barras_comparadas"
  | "barras_apiladas"
  | "barras_100"
  | "barras_linea"
  | "circular"
  | "dona"
  | "radar"
  | "lineas"
  | "area"
  | "histograma"
  | "caja"
  | "cascada"
  | "gantt"
  | "mapa"
  | "cifras"
  | "tabla";

export interface FreeView {
  key: string;
  title: string;
  description?: string;
  type: FreeChartType;
  /** Columna de texto (o territorio) que da las categorías: barras, circular, radar, cascada, caja (grupos), gantt (tareas), mapa. */
  category?: string;
  /** Columnas de cifra que se dibujan. Circular, histograma, caja, cascada y mapa usan la primera. */
  series?: string[];
  /**
   * Barras comparadas: con qué se reparte cada categoría en varias barras.
   *
   * Normalmente se deja vacío: la gráfica lo deduce de la fuente —los años,
   * si es anual; si no, la primera columna de texto que no sea la de
   * categorías—. Solo se rellena para forzar otra columna.
   */
  compare?: string;
  /** Barras comparadas: todos los periodos en vez de los dos últimos. */
  compareAll?: boolean;
  /** Barras: vertical u horizontal. */
  orientation?: "vertical" | "horizontal";
  /** Orden de las categorías. */
  sort?: "fuente" | "desc" | "asc";
  /** Histograma: número de tramos (por defecto, regla de Sturges). */
  bins?: number;
  /** Gantt: columnas de fecha de inicio y fin. */
  start?: string;
  end?: string;
  /** Cascada: añade la barra del total al final. */
  total?: boolean;
  /**
   * Tabla personalizada (solo en vistas de tipo «tabla»): corte, nota, fuente y
   * reglas de color. Con esto la vista deja de ser «la fuente tal cual» y pasa
   * a ser una tabla escrita por quien publica. Ver custom-table.ts.
   */
  table?: CustomTable;
}

export interface FreeSet {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  source: string;
  officeId?: string | null;
  temporality: FreeTemporality;
  /** Periodo: el rango que cubre ("2020–2025"). */
  periodLabel: string;
  columns: FreeColumn[];
  rows: FreeRow[];
  views: FreeView[];
}

export const TEMPORALITY_LABEL: Record<FreeTemporality, string> = {
  sin_tiempo: "Sin tiempo: un dato suelto",
  anual: "Por año: cada fila es de un año",
  periodo: "Por periodo: un dato global para un rango de años",
};

export const COLUMN_KIND_LABEL: Record<FreeColumnKind, string> = {
  texto: "Texto (categoría)",
  cifra: "Cifra",
  fecha: "Fecha",
  territorio: "Territorio",
};

/** Qué pide cada gráfica, para la intranet y para validar una vista. */
export const CHART_TYPES: Record<
  FreeChartType,
  {
    label: string;
    hint: string;
    category: "texto" | "territorio" | "ninguna" | "opcional";
    /** "dos": la primera cifra en barras y la segunda en línea, cada una con su eje. */
    series: "una" | "dos" | "varias" | "ninguna";
    dates?: boolean;
    needsYears?: boolean;
    /** Pide una segunda columna de texto que reparte cada categoría. */
    compare?: boolean;
  }
> = {
  barras: { label: "Barras", hint: "Compara una o varias cifras entre categorías.", category: "texto", series: "varias" },
  barras_comparadas: {
    label: "Barras comparadas",
    hint: "Una cifra con una barra por periodo. Con categorías, un grupo de barras por categoría; sin ellas, el total de cada periodo. Con dos periodos dice además cuánto varió.",
    category: "opcional",
    series: "una",
    compare: true,
  },
  barras_apiladas: { label: "Barras apiladas", hint: "Cada barra suma sus cifras: el total y sus partes.", category: "texto", series: "varias" },
  barras_100: { label: "Barras al 100 %", hint: "El reparto de cada categoría entre sus partes, en porcentaje.", category: "texto", series: "varias" },
  barras_linea: {
    label: "Barras y línea",
    hint: "Dos cifras de escala distinta, cada una con su eje: la primera en barras (a la izquierda) y la segunda en línea (a la derecha). En una fuente anual, un año por barra y, con categorías, la barra repartida entre ellas.",
    category: "opcional",
    series: "dos",
  },
  circular: { label: "Circular", hint: "El reparto de un total entre pocas categorías (hasta 6; el resto va a «Otros»).", category: "texto", series: "una" },
  dona: { label: "Dona", hint: "Como la circular, con el total en el centro.", category: "texto", series: "una" },
  radar: { label: "Radar", hint: "El perfil de varias categorías en las mismas dimensiones (cada cifra es un eje).", category: "texto", series: "varias" },
  lineas: { label: "Líneas", hint: "Cómo cambia una cifra por año (o a lo largo de las categorías, en orden).", category: "opcional", series: "varias" },
  area: { label: "Área", hint: "Como las líneas, con el área bajo la curva; apilada si hay varias series.", category: "opcional", series: "varias" },
  histograma: { label: "Histograma", hint: "Cómo se reparten los valores de una cifra en tramos. Cada fila es una observación.", category: "ninguna", series: "una" },
  caja: { label: "Diagrama de caja", hint: "Mediana, cuartiles y extremos de una cifra por grupo. Cada fila es una observación.", category: "opcional", series: "una" },
  cascada: { label: "Cascada", hint: "Cómo se llega de un valor a otro sumando y restando partes.", category: "texto", series: "una" },
  gantt: { label: "Gantt", hint: "Tareas con fecha de inicio y fin en una línea de tiempo.", category: "texto", series: "ninguna", dates: true },
  mapa: { label: "Mapa", hint: "Una cifra por departamento de Colombia o por país.", category: "territorio", series: "una" },
  cifras: { label: "Cifras clave", hint: "Las cifras de la primera fila (o del total) en grande.", category: "opcional", series: "varias" },
  tabla: { label: "Tabla", hint: "La fuente tal cual, ordenable.", category: "ninguna", series: "ninguna" },
};

/* --- Lectura ------------------------------------------------------------------- */

export const freeYears = (set: FreeSet): number[] =>
  set.temporality === "anual"
    ? Array.from(new Set(set.rows.map((r) => r.year).filter((y): y is number => y !== null))).sort((a, b) => a - b)
    : [];

/** Filas tal como se capturaron (con títulos y totales), del año pedido o todas. */
export const freeAllRowsAt = (set: FreeSet, year: number | null): FreeRow[] =>
  set.temporality === "anual" && year !== null ? set.rows.filter((r) => r.year === year) : set.rows;

/** Las filas que dibuja una gráfica: solo datos. */
export const freeRowsAt = (set: FreeSet, year: number | null): FreeRow[] =>
  freeAllRowsAt(set, year).filter((r) => r.kind === "dato");

/**
 * El total de una fila 'total': sobre las filas de datos de su grupo, o de
 * toda la fuente si no hay títulos antes. Las cifras enteras se suman; las
 * decimales y los porcentajes se promedian, que sumarlos no significa nada.
 */
export function freeTotalAt(rows: FreeRow[], index: number, columns: FreeColumn[]) {
  let from = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (rows[i].kind === "grupo") {
      from = i + 1;
      break;
    }
  }
  const part = rows.slice(from, index).filter((r) => r.kind === "dato");
  const cells: Record<string, FreeCell> = {};
  const basis: Record<string, "suma" | "promedio"> = {};
  for (const column of columns) {
    if (column.kind !== "cifra") continue;
    const values = part.map((r) => numberOf(r.cells[column.key])).filter((v): v is number => v !== null);
    if (!values.length) {
      cells[column.key] = null;
      continue;
    }
    const add = (column.format ?? "entero") === "entero";
    basis[column.key] = add ? "suma" : "promedio";
    cells[column.key] = add ? values.reduce((a, b) => a + b, 0) : values.reduce((a, b) => a + b, 0) / values.length;
  }
  return { cells, basis, count: part.length };
}

/**
 * Lo que se lee en una casilla, sea cual sea el tipo de su columna: el número
 * si la columna es de cifra y la casilla lo es; si no, el texto tal como se
 * escribió («N/D», «< 5», «en trámite»). El tipo de la columna orienta, no
 * bloquea: las gráficas saltan lo que no es número (`numberOf`), pero la tabla,
 * el boletín y el CSV lo muestran en vez de dejar un hueco.
 */
export function cellShown(column: Pick<FreeColumn, "kind">, cell: FreeCell | undefined): number | string | null {
  const text = textOf(cell);
  // Antes que nada: unos espacios sueltos no son un cero.
  if (text === "") return null;
  if (column.kind === "cifra") {
    const n = numberOf(cell);
    if (n !== null) return n;
  }
  return text;
}

/**
 * La fila de total como se muestra: escrita o calculada, casilla por casilla.
 *
 * · casilla escrita en la fila de total → se muestra esa, tal cual;
 * · casilla vacía → la calculada de `freeTotalAt` (solo en columnas de cifra).
 *
 * Los totales guardados antes de esta regla no traen casillas, así que siguen
 * saliendo calculados sin migrar nada. `written` dice qué columnas vienen
 * escritas; `basis` solo conserva las calculadas, para rotular «suma de 4».
 *
 * Es la regla de la ficha, el boletín y el CSV de UDES en Cifras. El
 * Observatorio y los Tableros siguen con `freeTotalAt`: allí un total escrito
 * dejaría deducir una celda en reserva.
 */
export function freeTotalShown(rows: FreeRow[], index: number, columns: FreeColumn[]) {
  const total = freeTotalAt(rows, index, columns);
  const own = rows[index]?.cells ?? {};
  const cells: Record<string, FreeCell> = { ...total.cells };
  const basis = { ...total.basis };
  const written: string[] = [];
  for (const column of columns) {
    const shown = cellShown(column, own[column.key]);
    if (shown === null) continue;
    cells[column.key] = shown;
    delete basis[column.key];
    written.push(column.key);
  }
  return { cells, basis, count: total.count, written };
}

export const columnOf = (set: FreeSet, key: string | undefined) => (key ? set.columns.find((c) => c.key === key) : undefined);

export function numberOf(cell: FreeCell | undefined): number | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "number") return Number.isFinite(cell) ? cell : null;
  const clean = cell.trim().replace(/\s/g, "").replace(/%$/, "");
  // "1.234,5" (es-CO) y "1234.5".
  const normalized = /,\d{1,}$/.test(clean) ? clean.replace(/\./g, "").replace(",", ".") : clean.replace(/,/g, "");
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

export const textOf = (cell: FreeCell | undefined) => (cell === null || cell === undefined ? "" : String(cell).trim());

/** Categorías con sus cifras sumadas (filas con la misma categoría se suman), en el orden pedido. */
export function categoryTotals(rows: FreeRow[], category: string, series: string[], sort: FreeView["sort"] = "fuente") {
  const order: string[] = [];
  const totals = new Map<string, Record<string, number | null>>();
  for (const row of rows) {
    const label = textOf(row.cells[category]);
    if (!label) continue;
    if (!totals.has(label)) {
      order.push(label);
      totals.set(label, Object.fromEntries(series.map((s) => [s, null])));
    }
    const entry = totals.get(label)!;
    for (const s of series) {
      const n = numberOf(row.cells[s]);
      if (n !== null) entry[s] = (entry[s] ?? 0) + n;
    }
  }
  const list = order.map((label) => ({ label, values: totals.get(label)! }));
  if (sort === "fuente" || !series.length) return list;
  const lead = series[0];
  return list.sort((a, b) => ((sort === "desc" ? -1 : 1) * ((a.values[lead] ?? -Infinity) - (b.values[lead] ?? -Infinity))));
}

/**
 * Con qué se comparan las barras, deducido de la fuente.
 *
 * Los periodos de un conjunto anual no son una columna: viven en la fila
 * (`row.year`), y pedirle a quien captura que elija «la columna del periodo»
 * era pedirle algo que no existe. El orden de preferencia es el que responde
 * a lo que casi siempre se quiere: los años si los hay, y si no, la primera
 * columna de texto que no sea ya la de categorías.
 */
export type CompareSource =
  | { kind: "anual"; label: string }
  | { kind: "columna"; label: string; column: FreeColumn };

export function compareSource(set: FreeSet, view: FreeView): CompareSource | null {
  const usable = (column: FreeColumn | undefined) =>
    column && column.kind !== "cifra" && column.kind !== "fecha" && column.key !== view.category
      ? column
      : undefined;

  // Lo elegido a mano manda sobre la deducción.
  const forced = usable(columnOf(set, view.compare));
  if (forced) return { kind: "columna", label: forced.label, column: forced };

  // Estructural, nunca por los datos: el editor de la intranet trabaja con el
  // conjunto sin filas cargadas, y «¿tiene dos años?» es una pregunta que solo
  // puede responder quien tiene las filas delante. Si la fuente es anual, ya
  // hay con qué comparar; que haya un año o seis lo dice la gráfica al
  // dibujarse.
  if (set.temporality === "anual") return { kind: "anual", label: "Año" };

  const guess = set.columns.find((c) => Boolean(usable(c)));
  if (guess) return { kind: "columna", label: guess.label, column: guess };
  return null;
}

/** Los periodos que se van a dibujar, en su orden y ya recortados. */
export function comparePeriods(set: FreeSet, view: FreeView, rows: FreeRow[]): string[] {
  const source = compareSource(set, view);
  if (!source) return [];
  const all =
    source.kind === "anual"
      ? freeYears(set).map(String)
      : (() => {
          const seen: string[] = [];
          for (const row of rows) {
            const value = textOf(row.cells[source.column.key]);
            if (value && !seen.includes(value)) seen.push(value);
          }
          return seen;
        })();
  // Por defecto, los dos últimos: comparar es poner dos cosas al lado, y una
  // fuente de seis años daría seis barras por categoría sin que nadie lo pida.
  return view.compareAll ? all : all.slice(-2);
}

/** De qué periodo es una fila, sea por su año o por una columna. */
export const periodOf = (row: FreeRow, source: CompareSource): string =>
  source.kind === "anual" ? (row.year === null ? "" : String(row.year)) : textOf(row.cells[source.column.key]);

/**
 * El cruce de las categorías contra los periodos: una fila por categoría y,
 * dentro, una casilla por periodo.
 *
 * El orden de las barras sale del orden de aparición en la fuente, no del
 * alfabeto: «2020-2022» antes que «2023-2025» es lo que quiere quien captura,
 * y ordenar alfabéticamente rompería cualquier periodo que no empiece por su
 * año. Una casilla sin filas se queda en nulo y no se dibuja, que no es lo
 * mismo que un cero.
 */
export function compareTotals(
  rows: FreeRow[],
  category: string,
  keys: string[],
  keyOf: (row: FreeRow) => string,
  measure: string,
  sort: FreeView["sort"] = "fuente",
) {
  const order: string[] = [];
  const totals = new Map<string, Record<string, number | null>>();

  for (const row of rows) {
    const label = textOf(row.cells[category]);
    const key = keyOf(row);
    if (!label || !key || !keys.includes(key)) continue;
    if (!totals.has(label)) {
      order.push(label);
      totals.set(label, {});
    }
    const value = numberOf(row.cells[measure]);
    if (value === null) continue;
    const entry = totals.get(label)!;
    entry[key] = (entry[key] ?? 0) + value;
  }

  let groups = order.map((label) => ({ label, values: totals.get(label)! }));
  if (sort !== "fuente" && keys.length) {
    // Se ordena por el último valor comparado: en una serie de periodos, el
    // más reciente es el que interesa mirar de mayor a menor.
    const lead = keys[keys.length - 1];
    const sign = sort === "desc" ? -1 : 1;
    groups = [...groups].sort((a, b) => sign * ((a.values[lead] ?? -Infinity) - (b.values[lead] ?? -Infinity)));
  }
  return groups;
}

/**
 * El total de una cifra en cada periodo, sin cruzar nada.
 *
 * Es el caso de una fuente que solo trae la cifra y el año: comparar periodos
 * no necesita categorías, son dos barras. Se devuelve con la forma de
 * `compareTotals` —un grupo único— para que la gráfica no tenga que saber cuál
 * de los dos caminos la trajo.
 */
export function periodTotals(
  rows: FreeRow[],
  keys: string[],
  keyOf: (row: FreeRow) => string,
  measure: string,
  label: string,
) {
  const values: Record<string, number | null> = {};
  for (const row of rows) {
    const key = keyOf(row);
    if (!key || !keys.includes(key)) continue;
    const value = numberOf(row.cells[measure]);
    if (value === null) continue;
    values[key] = (values[key] ?? 0) + value;
  }
  return [{ label, values }];
}

/** Tramos de un histograma: Sturges si no se pide número, bordes redondos. */
export function histogramBins(values: number[], count?: number) {
  if (!values.length) return [];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const k = Math.max(1, Math.min(40, count ?? Math.ceil(Math.log2(values.length) + 1)));
  const raw = (max - min) / k || 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const start = Math.floor(min / step) * step;
  const bins: { from: number; to: number; count: number }[] = [];
  for (let from = start; from <= max; from += step) bins.push({ from, to: from + step, count: 0 });
  for (const v of values) {
    const i = Math.min(bins.length - 1, Math.floor((v - start) / step));
    bins[i].count += 1;
  }
  return bins;
}

/** Fecha de una casilla: "2025-03-01", "01/03/2025", Date o año suelto (1 de enero). */
export function dateOf(cell: FreeCell | undefined): Date | null {
  if (cell === null || cell === undefined || cell === "") return null;
  if (typeof cell === "number") {
    if (cell >= 1900 && cell <= 2200) return new Date(cell, 0, 1);
    // Número de serie de Excel.
    if (cell > 20000 && cell < 80000) return new Date(Math.round((cell - 25569) * 86400000));
    return null;
  }
  const text = cell.trim();
  let m = text.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1));
  m = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = text.match(/^(\d{4})$/);
  if (m) return new Date(Number(m[1]), 0, 1);
  return null;
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const departmentByName = new Map(DEPARTMENTS.map((d) => [fold(d.name), d.code]));
const countryByName = new Map(COUNTRIES.map((c) => [fold(c.name), c.code]));

/** Código del territorio (DANE de dos cifras o ISO alfa-3) desde un código o un nombre. */
export function territoryCode(kind: FreeTerritory, cell: FreeCell | undefined): string | null {
  const text = textOf(cell);
  if (!text) return null;
  if (kind === "departamento") {
    const digits = text.replace(/\D/g, "");
    if (digits && digits.length <= 2 && DEPARTMENTS.some((d) => d.code === digits.padStart(2, "0"))) return digits.padStart(2, "0");
    return departmentByName.get(fold(text)) ?? null;
  }
  const upper = text.toUpperCase();
  if (COUNTRIES.some((c) => c.code === upper)) return upper;
  return countryByName.get(fold(text)) ?? null;
}

/** Referencia de una vista en el boletín: "libre:<fuente>:<vista>". */
export const freeRef = (set: FreeSet, view: FreeView) => `libre:${set.id}:${view.key}`;

const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/gi, " ").trim().toLowerCase();

/**
 * Título de una vista: «Conjunto · Vista». Cuando uno de los dos ya dice al
 * otro (la vista se llama como el conjunto, o lo repite entero), se imprime
 * una sola vez el más completo: nada de leer el mismo nombre dos veces.
 */
export function freeTitle(set: { title: string }, view: { title: string }): string {
  const a = set.title.trim();
  const b = view.title.trim();
  if (!a) return b;
  if (!b) return a;
  const pa = plain(a);
  const pb = plain(b);
  if (pa === pb || pb.includes(pa)) return b.length >= a.length ? b : a;
  if (pa.includes(pb)) return a;
  return `${a} · ${b}`;
}

/** Vistas publicables de un informe, en el orden de sus fuentes (sin dibujar nada). */
export function freeRefs(sets: FreeSet[] | undefined): { ref: string; title: string }[] {
  return (sets ?? []).flatMap((set) =>
    set.rows.length ? set.views.filter((v) => viewProblems(set, v).length === 0).map((v) => ({ ref: freeRef(set, v), title: freeTitle(set, v) })) : [],
  );
}

/** Las columnas que una vista nombra: categorías, comparación, fechas y cifras. */
export const viewColumnKeys = (view: FreeView): string[] =>
  Array.from(new Set([view.category, view.compare, view.start, view.end, ...(view.series ?? [])].filter((key): key is string => Boolean(key))));

/**
 * Columnas que la vista nombra y el conjunto ya no tiene. No es lo mismo que
 * `viewProblems`: una gráfica de tres cifras a la que le quitan una se sigue
 * dibujando con dos, y por eso no deja de publicarse; pero quien edita tiene
 * que saber que le falta una.
 */
export const viewLostColumns = (set: Pick<FreeSet, "columns">, view: FreeView): string[] =>
  viewColumnKeys(view).filter((key) => !set.columns.some((c) => c.key === key));

/** Qué le falta a una vista para dibujarse, en palabras; vacío si está completa. */
export function viewProblems(set: FreeSet, view: FreeView): string[] {
  const spec = CHART_TYPES[view.type];
  const problems: string[] = [];
  const category = columnOf(set, view.category);
  if (spec.category === "texto" && (!category || category.kind === "cifra")) problems.push("Elige la columna de categorías.");
  if (spec.category === "territorio" && category?.kind !== "territorio") problems.push("Elige una columna de territorio.");
  const series = (view.series ?? []).map((key) => columnOf(set, key)).filter((c) => c?.kind === "cifra");
  if (spec.series !== "ninguna" && series.length === 0) problems.push("Elige al menos una columna de cifras.");
  if (spec.dates && (columnOf(set, view.start)?.kind !== "fecha" || columnOf(set, view.end)?.kind !== "fecha")) problems.push("Elige las columnas de inicio y fin.");
  if (spec.compare && !compareSource(set, view)) {
    problems.push(
      "Esta fuente no tiene con qué comparar: tiene que ser anual, o tener otra columna de texto además de la de categorías.",
    );
  }
  if (view.type === "radar" && series.length < 3) problems.push("El radar necesita al menos tres cifras (una por eje).");
  if (spec.series === "dos" && (series.length < 2 || view.series?.[0] === view.series?.[1])) {
    problems.push("Elige dos cifras distintas: una para las barras y otra para la línea.");
  }
  if (view.type === "barras_linea" && set.temporality !== "anual" && !category) problems.push("Sin años, elige la columna de categorías: cada una es una barra.");
  // Tabla personalizada: la escribe quien publica, así que su corte no sale de
  // ninguna parte si no lo escribe. Sin corte no se publica (custom-table.ts).
  if (view.type === "tabla" && view.table && !view.table.cut?.trim()) problems.push("Escribe el corte o periodo de la tabla.");
  return problems;
}
