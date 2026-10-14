/* =============================================================================
   Datos Abiertos · tabla personalizada.

   Una tabla escrita por quien publica: columnas de texto, de número y de
   categoría en la misma tabla, con patrones de color. No es un tipo de bloque
   nuevo ni tiene tablas propias en la base: es una vista «tabla» de un conjunto
   libre (0033) que además trae `view.table`. Así hereda el bloque de la ficha,
   los permisos, la copia de periodos, el boletín y la descarga en CSV.

   Dónde vive cada cosa:
   · columnas     `set.columns`. Número = `kind: "cifra"` (con `decimals` y
                  `unit`); categoría = `kind: "texto"` con `options`.
   · filas        `set.rows`. Un título de grupo es `kind: "grupo"`; la fila de
                  totales es `kind: "total"` con sus casillas ESCRITAS A MANO
                  (aquí no se calcula nada).
   · color a mano en las casillas de la fila, con claves reservadas que ninguna
                  columna puede tener: `__tono` (toda la fila) y
                  `__tono:<columna>` (una celda). Viajan con la fila, así que
                  reordenar no las descoloca.
   · reglas       `view.table.rules[<columna>]`, en orden: gana la primera que
                  se cumple.

   Quién manda: celda a mano → fila a mano → regla de la columna.

   Tonos: una paleta corta tomada de los tokens del sistema, no un selector
   libre. Cada tono tiene su glifo y su nombre, porque ningún dato se comunica
   solo con color; la leyenda se arma sola a partir de las reglas.

   Un vacío no es un cero: una casilla sin dato se escribe «sin dato» y ninguna
   regla la colorea.

   Módulo puro: sin React ni Supabase.
   ========================================================================== */

import { numberOf, textOf } from "./free-sets";
import type { FreeCell, FreeColumn, FreeRow, FreeSet, FreeView } from "./free-sets";

/* --- Tonos ---------------------------------------------------------------------- */

export type ToneId = "bien" | "atencion" | "riesgo" | "neutro" | "seq-1" | "seq-2" | "seq-3";
/** Lo que se puede elegir a mano: un tono, o «sin color» aunque la regla diga otra cosa. */
export type ManualTone = ToneId | "ninguno";

export interface ToneSpec {
  id: ToneId;
  /** Nombre por defecto; la tabla puede cambiarlo (`table.labels`). */
  label: string;
  /** Va siempre junto al color: formas distintas, no el mismo signo en otro tono. */
  glyph: string;
  family: "semantico" | "secuencial";
}

export const TONES: Record<ToneId, ToneSpec> = {
  bien: { id: "bien", label: "Bien", glyph: "✓", family: "semantico" },
  atencion: { id: "atencion", label: "Atención", glyph: "▲", family: "semantico" },
  riesgo: { id: "riesgo", label: "Riesgo", glyph: "✕", family: "semantico" },
  neutro: { id: "neutro", label: "Neutro", glyph: "◇", family: "semantico" },
  "seq-1": { id: "seq-1", label: "Bajo", glyph: "○", family: "secuencial" },
  "seq-2": { id: "seq-2", label: "Medio", glyph: "◐", family: "secuencial" },
  "seq-3": { id: "seq-3", label: "Alto", glyph: "●", family: "secuencial" },
};

export const TONE_ORDER: ToneId[] = ["bien", "atencion", "riesgo", "neutro", "seq-1", "seq-2", "seq-3"];

export const isTone = (value: unknown): value is ToneId => typeof value === "string" && value in TONES;

/* --- Configuración de la tabla ---------------------------------------------------- */

export type ToneRule =
  /** Menor que `value`. */
  | { op: "menor"; value: number; tone: ToneId }
  /** Desde `min` (incluido) hasta menos de `max`: así no se pisa con «mayor o igual que». */
  | { op: "entre"; min: number; max: number; tone: ToneId }
  /** Mayor o igual que `value`. */
  | { op: "mayor_igual"; value: number; tone: ToneId }
  /** Categoría: este valor de la lista. */
  | { op: "es"; option: string; tone: ToneId };

export interface CustomTable {
  /** Corte o periodo de la tabla, como rótulo: «Corte a 30 de junio de 2026», «2025-2». */
  cut: string;
  /** Nota al pie. */
  note?: string;
  /** Fuente; sin ella se muestra la oficina que reporta el conjunto. */
  source?: string;
  /** La primera columna rotula cada fila (encabezado de fila, fija al desplazar). */
  rowHeader?: boolean;
  /** Reglas de color por clave de columna, en orden. */
  rules?: Record<string, ToneRule[]>;
  /** Nombre propio de un tono en esta tabla («Cumple la meta» en vez de «Bien»). */
  labels?: Partial<Record<ToneId, string>>;
}

/** Tamaño máximo: una tabla escrita a mano que pasa de aquí ya es una fuente de datos. */
export const MAX_COLUMNS = 24;
export const MAX_ROWS = 300;

export const EMPTY_TEXT = "sin dato";

export const ROW_TONE_KEY = "__tono";
export const cellToneKey = (column: string) => `__tono:${column}`;
const isReserved = (key: string) => key.startsWith("__");

/** La vista de tabla personalizada de un conjunto, si la tiene. */
export const customViewOf = (set: Pick<FreeSet, "views">): FreeView | undefined =>
  set.views.find((view) => view.type === "tabla" && Boolean(view.table));

export const isCustomView = (view: FreeView): view is FreeView & { table: CustomTable } =>
  view.type === "tabla" && Boolean(view.table);

/* --- Columnas ------------------------------------------------------------------- */

export type CustomKind = "texto" | "numero" | "categoria";

export const CUSTOM_KIND_LABEL: Record<CustomKind, string> = {
  texto: "Texto",
  numero: "Número",
  categoria: "Categoría o estado",
};

export const customKind = (column: FreeColumn): CustomKind =>
  column.kind === "cifra" ? "numero" : Array.isArray(column.options) ? "categoria" : "texto";

export const decimalsOf = (column: FreeColumn): number => {
  if (typeof column.decimals === "number" && Number.isFinite(column.decimals)) return Math.max(0, Math.min(4, Math.round(column.decimals)));
  return (column.format ?? "entero") === "entero" ? 0 : 1;
};

/** «%» si la columna es un porcentaje sin unidad escrita. */
export const unitOf = (column: FreeColumn): string => column.unit?.trim() || (column.format === "porcentaje" ? "%" : "");

/** Una unidad corta («%», «pp», «m²») acompaña a cada cifra; una larga va una vez, en el encabezado. */
export const unitInCell = (column: FreeColumn): boolean => {
  const unit = unitOf(column);
  return unit !== "" && unit.length <= 3;
};

const formatters = new Map<number, Intl.NumberFormat>();
/** Número a la colombiana: punto de miles, coma decimal, con los decimales de la columna. */
export function formatNumber(value: number, decimals: number): string {
  let formatter = formatters.get(decimals);
  if (!formatter) {
    formatter = new Intl.NumberFormat("es-CO", { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true });
    formatters.set(decimals, formatter);
  }
  // El signo menos tipográfico de Intl no se copia bien a una hoja de cálculo.
  return formatter.format(value).replace("−", "-");
}

/** Una cifra con su unidad, como se lee en una frase: «85,5 %», «1.234 estudiantes». */
export const numberWithUnit = (column: FreeColumn, value: number): string => {
  const unit = unitOf(column);
  return `${formatNumber(value, decimalsOf(column))}${unit ? ` ${unit}` : ""}`;
};

/* --- Lectura de una celda ---------------------------------------------------------- */

export interface CellView {
  /** Sin dato: se escribe «sin dato», nunca 0. */
  empty: boolean;
  /** Lo que se escribe en la celda. */
  text: string;
  /** Se alinea a la derecha, con cifras tabulares. */
  numeric: boolean;
  /** El número, si la celda lo es. */
  value: number | null;
}

export function cellView(column: FreeColumn, cell: FreeCell | undefined): CellView {
  if (customKind(column) === "numero") {
    const value = numberOf(cell);
    if (value !== null) {
      return { empty: false, numeric: true, value, text: `${formatNumber(value, decimalsOf(column))}${unitInCell(column) ? ` ${unitOf(column)}` : ""}` };
    }
    // Un texto en una columna de número («N/A», «< 5») se respeta tal cual.
    const text = textOf(cell);
    return { empty: text === "", numeric: true, value: null, text };
  }
  const text = textOf(cell);
  return { empty: text === "", numeric: false, value: null, text };
}

/* --- Reglas y tonos ------------------------------------------------------------------ */

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** El valor de la lista que corresponde a lo escrito, sin distinguir tildes ni mayúsculas. */
export const optionOf = (column: FreeColumn, raw: string): string | null => {
  const wanted = fold(raw);
  if (!wanted) return null;
  return (column.options ?? []).find((option) => fold(option) === wanted) ?? null;
};

/** La primera regla de la columna que cumple la celda; null si ninguna, o si la celda está vacía. */
export function matchRule(column: FreeColumn, rules: ToneRule[] | undefined, cell: FreeCell | undefined): ToneRule | null {
  if (!rules?.length) return null;
  if (customKind(column) === "numero") {
    const value = numberOf(cell);
    if (value === null) return null;
    for (const rule of rules) {
      if (rule.op === "menor" && value < rule.value) return rule;
      if (rule.op === "mayor_igual" && value >= rule.value) return rule;
      if (rule.op === "entre" && value >= rule.min && value < rule.max) return rule;
    }
    return null;
  }
  const text = fold(textOf(cell));
  if (!text) return null;
  return rules.find((rule) => rule.op === "es" && fold(rule.option) === text) ?? null;
}

export const toneLabel = (table: CustomTable | undefined, tone: ToneId): string => table?.labels?.[tone]?.trim() || TONES[tone].label;

/** El tono puesto a mano en toda la fila, si lo hay. */
export const rowTone = (row: FreeRow): ToneId | null => {
  const value = row.cells[ROW_TONE_KEY];
  return isTone(value) ? value : null;
};

/** El tono puesto a mano en una celda: un tono, «ninguno» (sin color aunque haya regla) o nada. */
export const manualTone = (row: FreeRow, column: string): ManualTone | null => {
  const value = row.cells[cellToneKey(column)];
  return value === "ninguno" || isTone(value) ? value : null;
};

export interface CellTone {
  tone: ToneId;
  label: string;
  glyph: string;
  /** De dónde sale: puesto a mano en la celda, en la fila, o por la regla de la columna. */
  by: "celda" | "fila" | "regla";
}

/**
 * El tono de una celda. Manda lo puesto a mano en la celda (incluido «sin
 * color»); después, lo puesto a mano en la fila; por último, la regla de la
 * columna, que solo lee filas de datos: un total o un título no se califican
 * solos.
 */
export function cellTone(table: CustomTable | undefined, column: FreeColumn, row: FreeRow): CellTone | null {
  const make = (tone: ToneId, by: CellTone["by"]): CellTone => ({ tone, by, label: toneLabel(table, tone), glyph: TONES[tone].glyph });
  const manual = manualTone(row, column.key);
  if (manual === "ninguno") return null;
  if (manual) return make(manual, "celda");
  const whole = rowTone(row);
  if (whole) return make(whole, "fila");
  if (row.kind !== "dato") return null;
  const rule = matchRule(column, table?.rules?.[column.key], row.cells[column.key]);
  return rule ? make(rule.tone, "regla") : null;
}

/** Una regla dicha en palabras: «menos de 60 %», «de 60 a menos de 80 %», «80 % o más», «Cumple». */
export function ruleText(column: FreeColumn, rule: ToneRule): string {
  const n = (value: number) => numberWithUnit(column, value);
  switch (rule.op) {
    case "menor":
      return `menos de ${n(rule.value)}`;
    case "entre":
      return `de ${formatNumber(rule.min, decimalsOf(column))} a menos de ${n(rule.max)}`;
    case "mayor_igual":
      return `${n(rule.value)} o más`;
    case "es":
      return rule.option;
  }
}

/** Reglas que no se pueden cumplir o que sobran, en palabras; vacío si están bien. */
export function ruleProblems(column: FreeColumn, rules: ToneRule[] | undefined): string[] {
  const problems: string[] = [];
  const numeric = customKind(column) === "numero";
  (rules ?? []).forEach((rule, index) => {
    const where = `Regla ${index + 1} de «${column.label}»`;
    if (!isTone(rule.tone)) problems.push(`${where}: elige un tono.`);
    if (rule.op === "es") {
      if (numeric) problems.push(`${where}: es de categoría y la columna es de número.`);
      else if (!optionOf(column, rule.option)) problems.push(`${where}: «${rule.option}» ya no está en la lista de valores.`);
      return;
    }
    if (!numeric) {
      problems.push(`${where}: es de número y la columna no lo es.`);
      return;
    }
    if (rule.op === "entre") {
      if (!Number.isFinite(rule.min) || !Number.isFinite(rule.max)) problems.push(`${where}: escribe los dos valores.`);
      else if (rule.min >= rule.max) problems.push(`${where}: el primer valor tiene que ser menor que el segundo.`);
    } else if (!Number.isFinite(rule.value)) problems.push(`${where}: escribe el valor.`);
  });
  return problems;
}

/* --- Leyenda ---------------------------------------------------------------------- */

export interface LegendItem {
  tone: ToneId;
  glyph: string;
  label: string;
  /** Qué significa: las reglas que llevan a este tono, o «marcado a mano». */
  detail: string[];
}

/**
 * La leyenda de la tabla, armada sola: un renglón por tono que aparece en las
 * reglas o que alguien puso a mano, en el orden fijo de la paleta. Si más de
 * una columna tiene reglas, cada una dice de qué columna habla.
 */
export function legendOf(columns: FreeColumn[], table: CustomTable | undefined, rows: FreeRow[]): LegendItem[] {
  const keys = new Set(columns.map((column) => column.key));
  const ruled = columns.filter((column) => (table?.rules?.[column.key] ?? []).length > 0);
  const details = new Map<ToneId, string[]>();
  const push = (tone: ToneId, text?: string) => {
    if (!isTone(tone)) return;
    const list = details.get(tone) ?? [];
    if (text && !list.includes(text)) list.push(text);
    details.set(tone, list);
  };

  for (const column of ruled) {
    const numeric = customKind(column) === "numero";
    for (const rule of table!.rules![column.key]) {
      if ((rule.op === "es") === numeric) continue;
      const text = ruleText(column, rule);
      push(rule.tone, ruled.length > 1 ? `${column.label}: ${text}` : text);
    }
  }

  // Lo puesto a mano no tiene regla que lo explique: se dice que fue a mano.
  const manual = new Set<ToneId>();
  for (const row of rows) {
    const whole = rowTone(row);
    if (whole) manual.add(whole);
    for (const key of Object.keys(row.cells)) {
      if (!key.startsWith(`${ROW_TONE_KEY}:`) || !keys.has(key.slice(ROW_TONE_KEY.length + 1))) continue;
      const value = row.cells[key];
      if (isTone(value)) manual.add(value);
    }
  }
  for (const tone of manual) if (!details.has(tone)) push(tone, "marcado a mano");

  return TONE_ORDER.filter((tone) => details.has(tone)).map((tone) => ({
    tone,
    glyph: TONES[tone].glyph,
    label: toneLabel(table, tone),
    detail: details.get(tone)!,
  }));
}

/** La leyenda en una línea, para el papel y los lectores de pantalla. */
export const legendText = (items: LegendItem[]): string =>
  items.map((item) => `${item.glyph} ${item.label}${item.detail.length ? ` (${item.detail.join("; ")})` : ""}`).join(" · ");

/* --- Pegar desde Excel ------------------------------------------------------------- */

export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

/**
 * Un número como lo escribe Excel en Colombia: «1.234,5» es mil doscientos
 * treinta y cuatro coma cinco; «12.345», doce mil trescientos cuarenta y cinco;
 * «45 %» es 45; «-3,2» es negativo. También lee «1234.5» y «1,234,567.8»
 * cuando no hay ambigüedad. Vacío y la raya son «sin dato», no cero.
 */
export function parseLocalNumber(raw: string): ParsedNumber {
  let text = raw.replace(/[\s  ]/g, "").replace(/^\$/, "").replace(/%$/, "");
  if (text === "" || text === "—" || text === "–" || text === "-") return { ok: true, value: null };
  let negative = false;
  if (/^[-−]/.test(text)) {
    negative = true;
    text = text.slice(1);
  } else if (/^\(.*\)$/.test(text)) {
    // Excel contable: (1.234) es negativo.
    negative = true;
    text = text.slice(1, -1);
  }
  let normalized: string;
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(text) && (text.match(/,/g)!.length > 1 || text.includes("."))) {
    // «1,234,567» o «1,234.5»: miles con coma, a la inglesa.
    normalized = text.replace(/,/g, "");
  } else if (text.includes(",")) {
    if (!/^[\d.]*,\d*$/.test(text)) return { ok: false };
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  } else {
    normalized = text;
  }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(normalized)) return { ok: false };
  const value = Number(normalized);
  if (!Number.isFinite(value)) return { ok: false };
  return { ok: true, value: negative ? -value : value };
}

/**
 * Filas y columnas de lo copiado en Excel: tabuladores entre columnas, saltos
 * de línea entre filas, y entre comillas las celdas que traen un salto de línea
 * o un tabulador dentro. Una celda vacía se conserva vacía: su sitio importa.
 */
export function parsePaste(text: string): string[][] {
  const clean = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let fresh = true;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') quoted = false;
      else cell += ch;
      continue;
    }
    if (ch === '"' && fresh) {
      quoted = true;
      fresh = false;
    } else if (ch === "\t") {
      row.push(cell);
      cell = "";
      fresh = true;
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      fresh = true;
    } else {
      cell += ch;
      fresh = false;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  // Excel cierra lo copiado con un salto de línea: esa última fila vacía no es una fila.
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === "")) rows.pop();
  const width = Math.max(0, ...rows.map((r) => r.length));
  return rows.map((r) => [...r, ...Array<string>(width - r.length).fill("")].map((c) => c.trim()));
}

export interface CellRead {
  value: FreeCell;
  error?: string;
}

/** Lee lo escrito o pegado en una celda según el tipo de su columna. */
export function readCell(column: FreeColumn, raw: string): CellRead {
  const text = raw.trim();
  if (!text) return { value: null };
  const kind = customKind(column);
  if (kind === "numero") {
    const parsed = parseLocalNumber(text);
    return parsed.ok ? { value: parsed.value } : { value: null, error: `«${text}» no es un número` };
  }
  if (kind === "categoria") {
    const option = optionOf(column, text);
    return option ? { value: option } : { value: null, error: `«${text}» no está en la lista de ${column.label || "la columna"}` };
  }
  return { value: text };
}

/** Texto editable de una casilla guardada: los números con coma decimal y sin miles. */
export const editText = (cell: FreeCell | undefined): string =>
  cell === null || cell === undefined ? "" : typeof cell === "number" ? String(cell).replace(".", ",") : String(cell);

/** El tipo que mejor describe una columna pegada: número si todo lo escrito lo es. */
export function guessColumn(values: string[]): Pick<FreeColumn, "kind" | "format" | "decimals" | "unit"> {
  const filled = values.map((v) => v.trim()).filter(Boolean);
  if (!filled.length) return { kind: "texto" };
  let decimals = 0;
  let numbers = 0;
  for (const text of filled) {
    const parsed = parseLocalNumber(text);
    if (!parsed.ok) return { kind: "texto" };
    if (parsed.value === null) continue;
    numbers += 1;
    const fraction = String(parsed.value).split(".")[1] ?? "";
    decimals = Math.max(decimals, Math.min(4, fraction.length));
  }
  if (!numbers) return { kind: "texto" };
  // Porcentaje si todo lo que es número lo trae escrito con su «%».
  const percent = filled.every((text) => {
    const parsed = parseLocalNumber(text);
    return /%$/.test(text) || (parsed.ok && parsed.value === null);
  });
  return {
    kind: "cifra",
    format: percent ? "porcentaje" : decimals ? "decimal" : "entero",
    decimals,
    ...(percent ? { unit: "%" } : {}),
  };
}

export interface PasteCell {
  raw: string;
  value: FreeCell;
  error?: string;
  /** Cae fuera del máximo de columnas: no se pega. */
  dropped?: boolean;
}

export interface PastePlan {
  /** Nombres de columna, si la primera fila se toma como encabezado. */
  headers: string[] | null;
  /** Las filas que se pegan, ya leídas con el tipo de la columna donde caen. */
  rows: PasteCell[][];
  /** Columna de la tabla donde cae cada columna pegada; de `columns.length` en adelante, nuevas. */
  targets: number[];
  /** Columnas nuevas que hacen falta, con el tipo adivinado de lo pegado. */
  newColumns: Pick<FreeColumn, "kind" | "format" | "decimals" | "unit">[];
  /** Filas nuevas que hacen falta al final. */
  newRows: number;
  errors: number;
  /** Filas o columnas que no caben en el máximo. */
  droppedRows: number;
  droppedColumns: number;
}

/**
 * Qué pasaría al pegar `grid` desde la fila y la columna dadas, sin tocar nada:
 * es lo que enseña la vista previa. Las columnas que no existen se crean con el
 * tipo que se adivina de lo pegado; lo que no cabe en el máximo se avisa.
 */
export function planPaste({
  columns,
  grid,
  atRow,
  atColumn,
  rowCount,
  header = false,
}: {
  columns: FreeColumn[];
  grid: string[][];
  atRow: number;
  atColumn: number;
  /** Filas que ya tiene la tabla. */
  rowCount: number;
  /** La primera fila pegada trae los nombres de las columnas. */
  header?: boolean;
}): PastePlan {
  const headers = header && grid.length ? grid[0] : null;
  const body = headers ? grid.slice(1) : grid;
  const width = Math.max(0, ...grid.map((line) => line.length));
  const fitColumns = Math.max(0, Math.min(width, MAX_COLUMNS - atColumn));
  const fitRows = Math.max(0, Math.min(body.length, MAX_ROWS - atRow));
  const targets = Array.from({ length: fitColumns }, (_, i) => atColumn + i);
  const newColumns = targets
    .filter((target) => target >= columns.length)
    .map((target) => guessColumn(body.slice(0, fitRows).map((line) => line[target - atColumn] ?? "")));
  const columnAt = (target: number): FreeColumn =>
    columns[target] ?? { key: "", label: "", ...newColumns[target - columns.length] };

  let errors = 0;
  const rows = body.slice(0, fitRows).map((line) =>
    Array.from({ length: width }, (_, i): PasteCell => {
      const raw = line[i] ?? "";
      if (i >= fitColumns) return { raw, value: null, dropped: true };
      const read = readCell(columnAt(atColumn + i), raw);
      if (read.error) errors += 1;
      return { raw, ...read };
    }),
  );

  return {
    headers,
    rows,
    targets,
    newColumns,
    newRows: Math.max(0, atRow + fitRows - rowCount),
    errors,
    droppedRows: body.length - fitRows,
    droppedColumns: width - fitColumns,
  };
}

/* --- Filas ------------------------------------------------------------------------ */

/** Las casillas de datos de una fila, sin las claves reservadas del color. */
export const dataCells = (row: FreeRow): Record<string, FreeCell> =>
  Object.fromEntries(Object.entries(row.cells).filter(([key]) => !isReserved(key)));

/** Qué le falta a la tabla para publicarse, en palabras; vacío si está completa. */
export function customTableProblems(set: Pick<FreeSet, "columns">, view: FreeView): string[] {
  if (!isCustomView(view)) return [];
  const problems: string[] = [];
  if (!set.columns.length) problems.push("La tabla no tiene columnas.");
  if (set.columns.length > MAX_COLUMNS) problems.push(`La tabla admite hasta ${MAX_COLUMNS} columnas.`);
  if (!view.table.cut?.trim()) problems.push("Escribe el corte o periodo de la tabla: una cifra sin corte no se publica.");
  for (const column of set.columns) problems.push(...ruleProblems(column, view.table.rules?.[column.key]));
  return problems;
}
