/* =============================================================================
   Pregúntele a Pilo · el catálogo en Excel.

   Lógica pura: define las dos plantillas, las llena (vacías, con ejemplos o
   con lo que ya hay) y lee un libro fila por fila diciendo qué entra y qué
   no, con «Hoja, fila, columna» en cada error. Sin navegador ni base, para
   poder probarla y para que el script de plantillas la use tal cual
   (scripts/pilo-catalogo-plantillas.mjs).

     Respuestas   Clave · Pregunta · Variantes · Respuesta · Emoción ·
                  Fuente · Ruta de la fuente · Corte · Oficina · Activa
     Capciosas    Clave · Tema · Disparadores · Respuesta · Emoción · Activa

   Variantes y disparadores: uno por línea dentro de la celda (Alt+Enter) o
   separados por «|». Un disparador son palabras que la pregunta debe traer,
   en cualquier orden. Emoción: emocionado, atrevido, loco o pensar.
   ========================================================================== */

import type { Workbook, Worksheet } from "exceljs";

export type CatalogKind = "respuesta" | "capciosa";

export const MOODS = ["emocionado", "atrevido", "loco", "pensar"] as const;
export type CatalogMood = (typeof MOODS)[number];

/** Para quién es una entrada (0113): vacío es «todos». Solo los espacios con rol lo usan. */
export const CATALOG_ROLES = ["", "estudiante", "profesor"] as const;
export type CatalogRol = (typeof CATALOG_ROLES)[number];
export const ROL_LABEL: Record<CatalogRol, string> = { "": "Todos", estudiante: "Estudiante", profesor: "Profesor" };

/**
 * Lo que cambia de un espacio a otro (0113). Sin opciones, todo es como
 * siempre: prefijos R y C, sin columna «Para quién».
 */
export interface SheetOptions {
  /** Prefijo de las claves por clase. Si viene, toda clave debe llevarlo. */
  prefix?: Record<CatalogKind, string>;
  /** Con columna «Para quién» (todos, estudiante o profesor). */
  rol?: boolean;
  /** El nombre de la pantalla de la intranet, para la hoja de instrucciones. */
  screen?: string;
}

export interface CatalogRow {
  kind?: CatalogKind;
  key: string;
  question: string;
  variants: string[];
  triggers: string[];
  answer: string;
  mood: CatalogMood;
  source_title: string;
  source_path: string;
  cut: string;
  office: string;
  active: boolean;
  /** Para quién (0113). Sin él, la base guarda «todos». */
  rol?: CatalogRol;
}

interface Column {
  id: keyof CatalogRow | "tema";
  header: string;
  width: number;
  help: string;
  required?: boolean;
}

export const SHEET_NAME: Record<CatalogKind, string> = { respuesta: "Respuestas", capciosa: "Capciosas" };

export const COLUMNS: Record<CatalogKind, Column[]> = {
  respuesta: [
    { id: "key", header: "Clave", width: 10, required: true, help: "Única y corta: R-001, R-002… Si se deja vacía se genera automáticamente. Importar otra vez la misma clave la actualiza." },
    { id: "question", header: "Pregunta", width: 42, required: true, help: "La pregunta como la haría el público." },
    { id: "variants", header: "Variantes", width: 42, help: "Otras formas de preguntar lo mismo, una por línea (Alt+Enter) o separadas por |." },
    { id: "triggers", header: "Disparadores", width: 36, help: "Opcional. Palabras clave que activan la respuesta (ej: pdi, plan de desarrollo), separadas por comas o líneas." },
    { id: "answer", header: "Respuesta", width: 60, required: true, help: "Lo que dice Pilo. Corta y clara, en usted. Sin cifras de dinero ni datos de personas." },
    { id: "mood", header: "Emoción", width: 13, help: "Cómo la dice Pilo: emocionado (por defecto), atrevido, loco o pensar." },
    { id: "source_title", header: "Fuente", width: 30, help: "Opcional. El nombre de la página o documento de donde sale." },
    { id: "source_path", header: "Ruta de la fuente", width: 30, help: "Opcional. La dirección: /datos-abiertos/poblacional o https://…" },
    { id: "cut", header: "Corte", width: 10, help: "Opcional. 2025, 2025-2…" },
    { id: "office", header: "Oficina", width: 26, help: "Opcional. Quién reporta el dato." },
    { id: "active", header: "Activa", width: 8, help: "SI o NO. Con NO, Pilo no la usa pero queda guardada." },
  ],
  capciosa: [
    { id: "key", header: "Clave", width: 10, required: true, help: "Única y corta: C-001, C-002… Si se deja vacía se genera automáticamente. Importar otra vez la misma clave la actualiza." },
    { id: "tema", header: "Tema", width: 24, help: "Para usted: de qué trata (salarios, vida personal de Pilo…)." },
    { id: "triggers", header: "Disparadores", width: 36, required: true, help: "Palabras que activan la respuesta, separadas por coma, punto y coma, | o una por línea (salario, sueldo, cuánto gana). Si un disparador tiene varias palabras, todas deben estar en la pregunta, en cualquier orden; no cuentan las de relleno (el, una, eres, usted) y valen plural, femenino y tú o usted (tienes = tiene)." },
    { id: "answer", header: "Respuesta", width: 60, required: true, help: "La microexpresión: corta, rápida y con gracia, en usted." },
    { id: "mood", header: "Emoción", width: 13, help: "Cómo la dice Pilo: atrevido (por defecto), emocionado, loco o pensar." },
    { id: "active", header: "Activa", width: 8, help: "SI o NO." },
  ],
};

const ROL_COLUMN: Column = { id: "rol", header: "Para quién", width: 14, help: "Opcional. todos (por defecto), estudiante o profesor: a quién le sirve esta entrada." };

/** Las columnas de una clase; con `rol`, «Para quién» va antes de «Activa». */
export function columnsFor(kind: CatalogKind, opts: SheetOptions = {}): Column[] {
  const cols = COLUMNS[kind];
  if (!opts.rol) return cols;
  const at = cols.findIndex((c) => c.id === "active");
  return [...cols.slice(0, at), ROL_COLUMN, ...cols.slice(at)];
}

/** «todos», «estudiantes», «docente»… → el rol; null si no se entiende. */
export function parseRolCell(text: string): CatalogRol | null {
  const t = fold(text);
  if (!t || ["todos", "todas", "todo", "cualquiera", "general", "ambos"].includes(t)) return "";
  if (/^estudiantes?$/.test(t)) return "estudiante";
  if (/^(profesor(es|a|as)?|docentes?)$/.test(t)) return "profesor";
  return null;
}

/** Alias comunes de encabezados para reconocer tablas armadas libremente en Excel. */
export const HEADER_ALIASES: Record<string, string[]> = {
  key: ["clave", "id", "codigo", "código", "key", "item", "nro", "numero", "número"],
  question: ["pregunta", "preguntas", "question", "consulta", "duda"],
  tema: ["tema", "asunto", "categoria", "categoría", "topic", "titulo", "título"],
  variants: ["variantes", "variante", "variants", "otras preguntas", "otras formas", "sinonimos", "sinónimos"],
  triggers: ["disparadores", "disparador", "triggers", "trigger", "palabras clave", "palabras claves", "keywords", "disparador(es)"],
  answer: ["respuesta", "respuestas", "answer", "lo que dice pilo", "texto"],
  mood: ["emocion", "emoción", "mood", "tono", "expresion", "expresión"],
  source_title: ["fuente", "source", "origen", "fuente titulo", "fuente_titulo", "nombre fuente", "documento"],
  source_path: ["ruta de la fuente", "ruta", "enlace", "url", "link", "path", "source_path", "direccion", "dirección"],
  cut: ["corte", "periodo", "período", "ano", "año", "cut", "vigencia"],
  office: ["oficina", "responsable", "dependencia", "unidad", "office", "reporta"],
  active: ["activa", "activo", "estado", "active", "en uso", "habilitada", "habilitado"],
  rol: ["para quien", "rol", "audiencia", "dirigido a", "destinatario"],
};

/** Ejemplos para empezar: solo afirmaciones que ya son ciertas en los portales. */
export const EXAMPLES: Record<CatalogKind, Partial<CatalogRow & { tema: string }>[]> = {
  respuesta: [
    {
      key: "R-001",
      question: "¿Qué es el PDI?",
      variants: ["¿Qué significa PDI?", "¿Para qué sirve el Plan de Desarrollo?"],
      triggers: ["pdi", "plan de desarrollo institucional"],
      answer: "El PDI es el Plan de Desarrollo Institucional 2024-2028 de la UDES: sus pilares, proyectos e indicadores, y cómo avanzan. Todo está en el Portal PDI.",
      mood: "emocionado",
      source_title: "Portal PDI",
      source_path: "/pdi",
      active: true,
    },
    {
      key: "R-002",
      question: "¿Dónde encuentro las cifras oficiales de la universidad?",
      variants: ["¿Qué es UDES en Cifras?", "¿Dónde veo los datos abiertos?"],
      triggers: ["cifras oficiales", "datos abiertos"],
      answer: "En UDES en Cifras: once informes con las cifras oficiales de la universidad, cada una con su corte y la oficina que la reporta.",
      mood: "emocionado",
      source_title: "UDES en Cifras",
      source_path: "/datos-abiertos",
      active: true,
    },
  ],
  capciosa: [
    { key: "C-001", tema: "Salarios", triggers: ["salario", "cuanto gana", "sueldo"], answer: "¡Uy, eso no! Los salarios no se publican en los portales. Yo solo hablo de cifras institucionales.", mood: "atrevido", active: true },
    { key: "C-002", tema: "Vida personal de Pilo", triggers: ["novia", "estas casado", "tienes pareja"], answer: "Mi único amor son los datos abiertos, y me corresponden cada corte.", mood: "loco", active: true },
    { key: "C-003", tema: "¿Eres una IA?", triggers: ["eres una ia", "eres un robot", "eres humano"], answer: "Soy Mr. Pilo, el guía de Planeación. Respondo con lo que publica la universidad y, solo cuando hace falta, me ayudo con IA.", mood: "pensar", active: true },
  ],
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

const list = (cell: string) =>
  cell
    .split(/\r?\n|\|/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/* --- Plantillas ----------------------------------------------------------------------- */

function styleHeader(sheet: Worksheet, count: number) {
  const row = sheet.getRow(1);
  row.height = 22;
  for (let c = 1; c <= count; c++) {
    const cell = row.getCell(c);
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2D63" } };
    cell.alignment = { vertical: "middle" };
  }
}

/** Llena un libro con la hoja de datos de una clase y su hoja de instrucciones. */
export function fillCatalogTemplate(book: Workbook, kind: CatalogKind, rows: Partial<CatalogRow & { tema: string }>[] = EXAMPLES[kind], opts: SheetOptions = {}) {
  const cols = columnsFor(kind, opts);
  const screen = opts.screen ?? "Mr. Pilo con IA";
  const section = opts.screen ? "Catálogo" : "Catálogo de Pilo";
  const sheet = book.addWorksheet(SHEET_NAME[kind], { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = cols.map((c) => ({ header: c.header, key: c.id, width: c.width }));
  styleHeader(sheet, cols.length);
  cols.forEach((c, i) => {
    sheet.getCell(1, i + 1).note = c.help;
  });
  for (const r of rows) {
    sheet.addRow(
      cols.map((c) => {
        if (c.id === "active") return r.active === false ? "NO" : "SI";
        if (c.id === "tema") return r.tema ?? r.question ?? "";
        if (c.id === "rol") return r.rol ? r.rol : "todos";
        const v = r[c.id as keyof CatalogRow];
        return Array.isArray(v) ? v.join("\n") : (v ?? "");
      }),
    );
  }
  // Una lista para la emoción y otra para «Activa», hasta la fila 1000.
  const moodCol = cols.findIndex((c) => c.id === "mood") + 1;
  const activeCol = cols.findIndex((c) => c.id === "active") + 1;
  for (let r = 2; r <= 1000; r++) {
    sheet.getCell(r, moodCol).dataValidation = { type: "list", allowBlank: true, formulae: [`"${MOODS.join(",")}"`] };
    sheet.getCell(r, activeCol).dataValidation = { type: "list", allowBlank: true, formulae: ['"SI,NO"'] };
    if (opts.rol) sheet.getCell(r, cols.findIndex((c) => c.id === "rol") + 1).dataValidation = { type: "list", allowBlank: true, formulae: ['"todos,estudiante,profesor"'] };
  }
  sheet.eachRow((row, n) => {
    if (n > 1) row.alignment = { vertical: "top", wrapText: true };
  });

  const help = book.addWorksheet("Cómo llenarla");
  help.columns = [
    { header: "Columna", key: "c", width: 22 },
    { header: "Qué va", key: "h", width: 90 },
  ];
  styleHeader(help, 2);
  for (const c of cols) help.addRow({ c: `${c.header}${c.required ? " (obligatoria)" : ""}`, h: c.help });
  help.addRow({});
  help.addRow({
    c: "Importar",
    h:
      kind === "respuesta"
        ? `En la intranet: ${screen} → ${section} → Respuestas → Importar Excel. Pilo usa estas respuestas antes que todo, sin IA, cuando la pregunta se parece a la Pregunta o a una Variante.`
        : `En la intranet: ${screen} → ${section} → Capciosas → Importar Excel. Pilo responde con la microexpresión, al instante y sin IA, cuando la pregunta trae un grupo de disparadores.`,
  });
  help.eachRow((row) => (row.alignment = { vertical: "top", wrapText: true }));
}

/* --- Leer un libro ---------------------------------------------------------------------- */

export interface ParsedRow {
  line: number;
  row: CatalogRow | null;
  errors: string[];
}

export interface ParseResult {
  kind: CatalogKind;
  problems: string[];
  rows: ParsedRow[];
  valid: CatalogRow[];
}

/**
 * Detecta si un libro de Excel corresponde a «Respuestas» o «Capciosas»
 * examinando nombres de hoja y encabezados.
 */
export function detectCatalogKind(tables: Record<string, string[][]>): CatalogKind | null {
  for (const [name, table] of Object.entries(tables)) {
    const fName = fold(name);
    if (fName.includes("respuest")) return "respuesta";
    if (fName.includes("capcios")) return "capciosa";
    const headers = (table[0] ?? []).map((h) => fold(h ?? ""));
    if (headers.some((h) => (HEADER_ALIASES.question ?? []).some((a) => h === a || h.startsWith(a)))) return "respuesta";
    if (headers.some((h) => (HEADER_ALIASES.triggers ?? []).some((a) => h === a || h.startsWith(a)))) return "capciosa";
  }
  return null;
}

/**
 * Lee la hoja de la clase (por su nombre, o la primera que no sea de
 * instrucciones) desde una tabla de textos (fila 1: encabezados).
 */
export function parseCatalogTable(kind: CatalogKind, tables: Record<string, string[][]>, opts: SheetOptions = {}): ParseResult {
  const cols = columnsFor(kind, opts);
  const prefix = opts.prefix?.[kind] ?? (kind === "capciosa" ? "C" : "R");
  // 1. Buscar primero la hoja con el nombre de la clase
  let name = Object.keys(tables).find((n) => fold(n) === fold(SHEET_NAME[kind]));
  // 2. Si no, buscar hoja que contenga la palabra clave de la clase
  if (!name) {
    const keyword = kind === "respuesta" ? "respuest" : "capcios";
    name = Object.keys(tables).find((n) => fold(n).includes(keyword));
  }
  // 3. Si no, la primera hoja que no sea de instrucciones
  if (!name) {
    name = Object.keys(tables).find((n) => !fold(n).startsWith("como") && !fold(n).startsWith("instruc"));
  }

  const out: ParseResult = { kind, problems: [], rows: [], valid: [] };
  if (!name) {
    out.problems.push(`El libro no tiene la hoja «${SHEET_NAME[kind]}».`);
    return out;
  }
  const table = tables[name];
  const headers = (table[0] ?? []).map((h) => fold(h ?? ""));
  const at: Partial<Record<Column["id"], number>> = {};
  for (const c of cols) {
    const aliases = HEADER_ALIASES[c.id] ?? [fold(c.header)];
    const i = headers.findIndex((h) => aliases.some((a) => fold(h) === a || fold(h).startsWith(a)));
    if (i >= 0) at[c.id] = i;
    else if (c.required && c.id !== "key") out.problems.push(`Hoja «${name}»: falta la columna «${c.header}».`);
  }
  if (out.problems.length) return out;

  const seen = new Map<string, number>();
  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (id: Column["id"]) => (at[id] === undefined ? "" : String(cells[at[id]!] ?? "").trim());
    if (cols.every((c) => !get(c.id))) return; // fila vacía
    const errors: string[] = [];
    const where = (col: string) => `Hoja «${name}», fila ${line}, columna «${col}»`;
    let key = get("key").toUpperCase();
    if (!key) key = `${prefix}-${String(i + 1).padStart(3, "0")}`;
    if (!/^[A-Z0-9._-]{1,40}$/.test(key)) errors.push(`${where("Clave")}: use solo letras, números, punto, guion o guion bajo (sin espacios).`);
    // La clave es global: en un espacio con prefijo propio, una clave sin él chocaría con la del otro Pilo.
    else if (opts.prefix && !key.startsWith(`${prefix}-`)) errors.push(`${where("Clave")}: «${key}» debe empezar por ${prefix}- (por ejemplo ${prefix}-001).`);
    else if (seen.has(key)) errors.push(`${where("Clave")}: «${key}» ya está en la fila ${seen.get(key)}.`);
    if (key) seen.set(key, line);

    const answer = get("answer").replace(/\s+/g, " ");
    if (answer.length < 2) errors.push(`${where("Respuesta")}: falta la respuesta.`);
    else if (answer.length > 2000) errors.push(`${where("Respuesta")}: tiene ${answer.length} caracteres; el máximo es 2000.`);
    if (/\$\s?\d|\bpesos\b|\bcop\b|millones de pesos/i.test(answer)) errors.push(`${where("Respuesta")}: no se publican cifras de dinero.`);

    const moodText = fold(get("mood"));
    const mood = (moodText ? MOODS.find((m) => m === moodText) : kind === "capciosa" ? "atrevido" : "emocionado") as CatalogMood | undefined;
    if (!mood) errors.push(`${where("Emoción")}: «${get("mood")}» no es una emoción de Pilo (${MOODS.join(", ")}).`);

    const activeText = fold(get("active"));
    const active = !activeText || ["si", "sí", "s", "x", "1", "true", "verdadero"].includes(activeText);
    if (activeText && !active && !["no", "n", "0", "false", "falso"].includes(activeText)) errors.push(`${where("Activa")}: escriba SI o NO.`);

    const rol = opts.rol ? parseRolCell(get("rol")) : "";
    if (rol === null) errors.push(`${where("Para quién")}: escriba todos, estudiante o profesor.`);

    let question = "";
    let variants: string[] = [];
    let triggers: string[] = [];
    let sourcePath = "";
    if (kind === "respuesta") {
      question = get("question").replace(/\s+/g, " ");
      if (question.length < 3) errors.push(`${where("Pregunta")}: falta la pregunta.`);
      variants = list(get("variants"));
      sourcePath = get("source_path");
      if (sourcePath && !/^(\/|https?:\/\/)/i.test(sourcePath)) errors.push(`${where("Ruta de la fuente")}: debe empezar por / (una página del portal) o por https://.`);
      if (at["triggers"] !== undefined) {
        triggers = list(get("triggers"))
          .flatMap((t) => t.split(/[,;]/))
          .map((t) => t.trim())
          .filter(Boolean);
      }
    } else {
      question = get("tema");
      // Los disparadores también se separan por coma y punto y coma: es como los escribe la gente.
      triggers = list(get("triggers"))
        .flatMap((t) => t.split(/[,;]/))
        .map((t) => t.trim())
        .filter(Boolean);
      if (!triggers.length) errors.push(`${where("Disparadores")}: falta al menos un disparador.`);
      const short = triggers.find((t) => fold(t).replace(/[^a-z0-9ñ ]/g, "").trim().length < 3);
      if (short) errors.push(`${where("Disparadores")}: «${short}» es demasiado corto; se dispararía con casi cualquier pregunta.`);
    }

    const row: CatalogRow | null = errors.length
      ? null
      : {
          key,
          question,
          variants,
          triggers,
          answer,
          mood: mood!,
          source_title: kind === "respuesta" ? get("source_title") : "",
          source_path: sourcePath,
          cut: kind === "respuesta" ? get("cut") : "",
          office: kind === "respuesta" ? get("office") : "",
          active,
          ...(opts.rol ? { rol: rol ?? "" } : {}),
        };
    out.rows.push({ line, row, errors });
    if (row) out.valid.push(row);
  });
  if (!out.rows.length) out.problems.push(`La hoja «${name}» no tiene filas.`);
  return out;
}
