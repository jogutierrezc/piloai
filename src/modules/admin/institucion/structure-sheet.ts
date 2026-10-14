/* =============================================================================
   Carga masiva de la estructura institucional · el libro.

   Lógica pura, sin navegador ni base. Recibe las hojas del libro como
   matrices de textos (primera fila, encabezados) y lo que ya existe, y dice
   fila por fila qué pasaría: nuevo, actualizado, sin cambio o con error.

   El libro tiene una hoja por clase, en el orden en que se resuelven los
   padres —el mismo de admin_import_units (0074)—:

     Vicerrectorías  Código · Nombre · Función sustantiva
     Facultades      Código · Nombre · Vicerrectoría (código)
     Oficinas        Código · Nombre · Depende de (código)
     Programas       SNIES · Código · Nombre · Facultad (código) · Nivel ·
                     Modalidad · Sedes

   Reglas que conviene no perder:

     · Nada se corrige en silencio. Se normaliza la forma de escribir (tildes,
       mayúsculas, «A distancia», una sede por su nombre) de valores con una
       sola lectura posible; lo que no se reconoce es un error «Hoja X, fila
       n, columna Y».
     · Una unidad existente se reconoce igual que en la base: por su código
       (sin importar mayúsculas) y un programa, antes, por su SNIES.
     · Un padre puede venir en el mismo libro (una facultad nueva con sus
       programas nuevos). Se busca en la base y en las filas del libro.
     · El slug de una unidad existente no cambia; el de una nueva sale del
       nombre, sin chocar con ninguno.
     · Una hoja que no está en el libro no cuenta: se puede cargar solo la de
       programas.
   ========================================================================== */

import type { Workbook } from "exceljs";
import { freeSlug } from "../../tableros/model";
import type { UnitKind } from "../../tableros/model";
import type {
  Campus,
  DegreeLevel,
  ImportKind,
  InstUnit,
  Modality,
  ProgramCampus,
  SubstantiveFunction,
  UnitImportRow,
} from "./institution-model";
import { DEGREE_LABEL, FUNCTION_LABEL, KIND_LABEL, MODALITY_LABEL } from "./institution-model";

export type RowStatus = "nuevo" | "actualizado" | "sin_cambio" | "error";

export interface StructureRow {
  sheet: string;
  kind: ImportKind;
  /** Número de fila en la hoja (la de encabezados es la 1). */
  line: number;
  status: RowStatus;
  code: string;
  name: string;
  errors: string[];
  /** Qué cambia en una unidad existente. */
  changes: string[];
  /** Lo que se manda a la base: solo lo nuevo y lo que cambia. */
  payload: UnitImportRow | null;
}

export interface SheetSummary {
  kind: ImportKind;
  name: string;
  /** false: el libro no traía esta hoja. */
  found: boolean;
  rows: StructureRow[];
  counts: Record<RowStatus, number>;
}

export interface StructureResult {
  /** Problemas del libro o de una hoja entera (encabezados que faltan…). */
  problems: string[];
  sheets: SheetSummary[];
  counts: Record<RowStatus, number>;
}

export interface StructureContext {
  units: InstUnit[];
  campuses: Campus[];
  offer: ProgramCampus[];
}

interface ColumnDef {
  key: string;
  header: string;
  hint: string;
  optional?: boolean;
  width: number;
}

interface SheetDef {
  kind: ImportKind;
  name: string;
  columns: ColumnDef[];
}

const CODE: ColumnDef = { key: "codigo", header: "Código", hint: "Único en toda la universidad. Así se reconoce la unidad.", width: 14 };
const NAME: ColumnDef = { key: "nombre", header: "Nombre", hint: "Nombre oficial.", width: 48 };

/** Las hojas del libro, en el orden en que se resuelven. */
export const SHEETS: SheetDef[] = [
  {
    kind: "vicerrectoria",
    name: "Vicerrectorías",
    columns: [
      CODE,
      NAME,
      {
        key: "funcion",
        header: "Función sustantiva",
        hint: "La que lidera: Investigación, Enseñanza o Extensión. Vacía si no lidera ninguna.",
        optional: true,
        width: 22,
      },
    ],
  },
  {
    kind: "facultad",
    name: "Facultades",
    columns: [
      CODE,
      NAME,
      {
        key: "vicerrectoria",
        header: "Vicerrectoría (código)",
        hint: "De qué vicerrectoría depende en el organigrama. No le da acceso a sus datos. Opcional.",
        optional: true,
        width: 22,
      },
    ],
  },
  {
    kind: "oficina",
    name: "Oficinas",
    columns: [
      CODE,
      NAME,
      {
        key: "depende",
        header: "Depende de (código)",
        hint: "Vicerrectoría u otra oficina de la que cuelga; quien trabaja arriba ve también esta. Vacía si es de primer nivel.",
        optional: true,
        width: 22,
      },
    ],
  },
  {
    kind: "programa",
    name: "Programas",
    columns: [
      { key: "snies", header: "SNIES", hint: "Código SNIES. Solo dígitos. Opcional, pero es como mejor se reconoce.", optional: true, width: 12 },
      CODE,
      NAME,
      { key: "facultad", header: "Facultad (código)", hint: "La facultad a la que pertenece.", width: 18 },
      { key: "nivel", header: "Nivel", hint: "Técnico profesional, Tecnológico, Profesional universitario, Especialización, Especialización médico-quirúrgica, Maestría o Doctorado.", width: 18 },
      { key: "modalidad", header: "Modalidad", hint: "Presencial, Virtual, A distancia, Dual o Híbrida.", width: 16 },
      {
        key: "sedes",
        header: "Sedes",
        hint: "Donde se ofrece, separadas por coma. Las que no se nombren quedan inactivas.",
        width: 32,
      },
    ],
  },
];

/** Sin tildes, en minúscula y con los espacios apretados. */
export function normalize(text: unknown): string {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** El encabezado sin su aclaración entre paréntesis: «Facultad (código)» → «facultad». */
const headerKey = (text: unknown) => normalize(text).replace(/\s*\(.*\)\s*$/, "");

/** Cómo lo escribe la gente, sin tildes ni mayúsculas: el SNIES y los catálogos dicen cosas distintas. */
const DEGREES: Record<string, DegreeLevel> = {
  tecnico: "tecnico",
  "tecnico profesional": "tecnico",
  "formacion tecnica profesional": "tecnico",
  tecnica: "tecnico",
  "tecnica profesional": "tecnico",
  tecnologico: "tecnologico",
  tecnologica: "tecnologico",
  tecnologia: "tecnologico",
  tecnologo: "tecnologico",
  "formacion tecnologica": "tecnologico",
  pregrado: "pregrado",
  profesional: "pregrado",
  universitario: "pregrado",
  universitaria: "pregrado",
  "profesional universitario": "pregrado",
  "universitario (pregrado)": "pregrado",
  especializacion: "especializacion",
  "especializacion medicoquirurgica": "especializacion_medicoquirurgica",
  "especializacion medico quirurgica": "especializacion_medicoquirurgica",
  "especializacion medico-quirurgica": "especializacion_medicoquirurgica",
  "especializacion-medicoquirurgica": "especializacion_medicoquirurgica",
  "especialidad medico quirurgica": "especializacion_medicoquirurgica",
  "especialidad medico-quirurgica": "especializacion_medicoquirurgica",
  "medicoquirurgica": "especializacion_medicoquirurgica",
  "medico-quirurgica": "especializacion_medicoquirurgica",
  especializacion_medicoquirurgica: "especializacion_medicoquirurgica",
  maestria: "maestria",
  doctorado: "doctorado",
};

const MODALITIES: Record<string, Modality> = {
  presencial: "presencial",
  virtual: "virtual",
  distancia: "distancia",
  "a distancia": "distancia",
  dual: "dual",
  hibrida: "hibrida",
};

const FUNCTIONS: Record<string, SubstantiveFunction> = {
  investigacion: "investigacion",
  ensenanza: "ensenanza",
  extension: "extension",
};

/** A, B, …, Z, AA… para decir la columna como la ve Excel. */
export function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

const text = (row: unknown[], index: number | undefined) =>
  index === undefined ? "" : String(row[index] ?? "").replace(/\s+/g, " ").trim();

const sameSet = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

const emptyCounts = (): Record<RowStatus, number> => ({ nuevo: 0, actualizado: 0, sin_cambio: 0, error: 0 });

const importKindOf = (kind: UnitKind): ImportKind | null =>
  kind === "otra" ? "oficina" : kind === "vicerrectoria" || kind === "facultad" || kind === "oficina" || kind === "programa" ? kind : null;

/** Busca una hoja del libro por su nombre, sin tildes ni mayúsculas. */
function findSheet(book: Record<string, unknown[][]>, name: string): unknown[][] | undefined {
  const wanted = normalize(name);
  const key = Object.keys(book).find((candidate) => normalize(candidate) === wanted);
  return key === undefined ? undefined : book[key];
}

/**
 * Lee el libro. `book` es { nombre de hoja: matriz de textos }.
 */
export function parseStructureWorkbook(book: Record<string, unknown[][]>, context: StructureContext): StructureResult {
  const problems: string[] = [];
  const counts = emptyCounts();
  const units = context.units;
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const takenSlugs = units.map((unit) => unit.slug);

  // Primera pasada: qué hojas hay, dónde está cada columna y qué códigos trae
  // el libro, para resolver padres que vienen en él y detectar repetidos.
  interface Located {
    def: SheetDef;
    table: unknown[][];
    at: Record<string, number | undefined>;
  }
  const located: Located[] = [];
  const summaries: SheetSummary[] = SHEETS.map((def) => ({ kind: def.kind, name: def.name, found: false, rows: [], counts: emptyCounts() }));

  for (const def of SHEETS) {
    const table = findSheet(book, def.name);
    if (!table) continue;
    summaries.find((summary) => summary.kind === def.kind)!.found = true;
    const at: Record<string, number | undefined> = {};
    (table[0] ?? []).forEach((value, index) => {
      const column = def.columns.find((candidate) => headerKey(candidate.header) === headerKey(value));
      if (column && at[column.key] === undefined) at[column.key] = index;
    });
    const missing = def.columns.filter((column) => !column.optional && at[column.key] === undefined);
    if (missing.length > 0) {
      problems.push(
        `Hoja ${def.name}: faltan las columnas ${missing.map((column) => column.header).join(", ")}. Use la plantilla de esta pantalla.`,
      );
      continue;
    }
    located.push({ def, table, at });
  }

  if (summaries.every((summary) => !summary.found)) {
    problems.push(
      `El libro no trae ninguna de las hojas de la plantilla (${SHEETS.map((def) => def.name).join(", ")}). Descárguela de esta pantalla.`,
    );
    return { problems, sheets: summaries, counts };
  }

  /** Códigos que trae el libro, con su clase y dónde están. */
  const fileCodes = new Map<string, { kind: ImportKind; sheet: string; line: number }>();
  for (const { def, table, at } of located) {
    table.slice(1).forEach((raw, offset) => {
      const code = normalize(text(raw ?? [], at.codigo));
      if (code && !fileCodes.has(code)) fileCodes.set(code, { kind: def.kind, sheet: def.name, line: offset + 2 });
    });
  }

  const unitByCode = (code: string) => units.find((unit) => normalize(unit.code) === normalize(code));
  /** ¿Existe (en la base o en el libro) una unidad de estas clases con ese código? */
  const resolves = (code: string, kinds: ImportKind[]) => {
    const unit = unitByCode(code);
    // Si el código ya existe, manda su clase en la base: el libro no la cambia.
    if (unit) return kinds.includes(importKindOf(unit.kind) ?? ("" as ImportKind)) ? unit.code : null;
    const inFile = fileCodes.get(normalize(code));
    if (inFile && kinds.includes(inFile.kind)) return code;
    return null;
  };

  for (const { def, table, at } of located) {
    const summary = summaries.find((item) => item.kind === def.kind)!;
    const letter = (key: string) => columnLetter(at[key] ?? 0);

    table.slice(1).forEach((raw, offset) => {
      const line = offset + 2;
      const row = raw ?? [];
      if (row.every((value) => String(value ?? "").trim() === "")) return;

      const errors: string[] = [];
      const fail = (key: string, message: string) =>
        errors.push(`Hoja ${def.name}, fila ${line}, columna ${letter(key)}: ${message}`);

      const code = text(row, at.codigo);
      const name = text(row, at.nombre);
      if (!code) fail("codigo", "falta el código.");
      if (!name) fail("nombre", "falta el nombre.");

      const first = code ? fileCodes.get(normalize(code)) : undefined;
      if (first && (first.sheet !== def.name || first.line !== line)) {
        fail("codigo", `el código ${code} ya está en la hoja ${first.sheet}, fila ${first.line}.`);
      }

      // ¿Existe? Como en admin_import_units.
      const snies = def.kind === "programa" ? text(row, at.snies).replace(/\.0$/, "") : "";
      if (snies && !/^\d+$/.test(snies)) fail("snies", `el SNIES «${snies}» no es un número.`);
      let existing = snies ? units.find((unit) => unit.sniesCode === snies) : undefined;
      if (!existing && code) {
        existing = unitByCode(code);
        if (existing && def.kind === "programa" && existing.sniesCode && existing.sniesCode !== snies) {
          fail("codigo", `el código ${code} ya es del programa con SNIES ${existing.sniesCode}.`);
          existing = undefined;
        }
      }
      if (existing && importKindOf(existing.kind) !== def.kind) {
        fail("codigo", `el código ${code} ya es de «${existing.name}» (${KIND_LABEL[existing.kind].label.toLowerCase()}).`);
        existing = undefined;
      }
      // Un código de otra unidad chocaría al guardar (p. ej. un programa
      // reconocido por SNIES al que se le pone el código de otro).
      const clash = code ? units.find((unit) => normalize(unit.code) === normalize(code) && unit.id !== existing?.id) : undefined;
      if (existing && clash) fail("codigo", `el código ${code} ya es de «${clash.name}».`);

      const payload: UnitImportRow = {
        sheet: def.name,
        line,
        kind: def.kind,
        code,
        name,
        slug: existing ? existing.slug : "",
      };
      const changes: string[] = [];
      if (existing) {
        if (existing.name !== name) changes.push(`nombre: «${existing.name}» → «${name}»`);
        if (existing.code !== code) changes.push(`código: ${existing.code} → ${code}`);
      }

      if (def.kind === "vicerrectoria") {
        const raw = text(row, at.funcion);
        const fn = raw ? FUNCTIONS[normalize(raw)] : null;
        if (raw && !fn) fail("funcion", `«${raw}» no es una función sustantiva. Use ${Object.values(FUNCTION_LABEL).join(", ")} o déjela vacía.`);
        payload.substantive_function = fn ?? null;
        if (existing && (existing.substantiveFunction ?? null) !== (fn ?? null)) {
          const label = (value: SubstantiveFunction | null) => (value ? FUNCTION_LABEL[value] : "ninguna");
          changes.push(`función: ${label(existing.substantiveFunction)} → ${label(fn ?? null)}`);
        }
      }

      if (def.kind === "facultad") {
        const raw = text(row, at.vicerrectoria);
        const vice = raw ? resolves(raw, ["vicerrectoria"]) : null;
        if (raw && !vice) fail("vicerrectoria", `no existe la vicerrectoría «${raw}».`);
        payload.vice_code = vice;
        const before = existing?.reportsTo ? (byId.get(existing.reportsTo)?.code ?? null) : null;
        if (existing && normalize(before) !== normalize(vice)) changes.push(`vicerrectoría: ${before ?? "ninguna"} → ${vice ?? "ninguna"}`);
      }

      if (def.kind === "oficina") {
        const raw = text(row, at.depende);
        const parent = raw ? resolves(raw, ["vicerrectoria", "oficina"]) : null;
        if (raw && !parent) fail("depende", `no existe la vicerrectoría u oficina «${raw}».`);
        if (raw && normalize(raw) === normalize(code)) fail("depende", "una oficina no depende de sí misma.");
        payload.parent_code = parent;
        const before = existing?.parentId ? (byId.get(existing.parentId)?.code ?? null) : null;
        if (existing && normalize(before) !== normalize(parent)) changes.push(`depende de: ${before ?? "nadie"} → ${parent ?? "nadie"}`);
      }

      if (def.kind === "programa") {
        const facultyText = text(row, at.facultad);
        const degreeText = text(row, at.nivel);
        const modalityText = text(row, at.modalidad);
        const campusText = text(row, at.sedes);

        const faculty = facultyText ? resolves(facultyText, ["facultad"]) : null;
        if (!facultyText) fail("facultad", "falta la facultad.");
        else if (!faculty) fail("facultad", `no existe la facultad «${facultyText}».`);

        const degree = DEGREES[normalize(degreeText)];
        if (!degreeText) fail("nivel", "falta el nivel de formación.");
        else if (!degree) fail("nivel", `«${degreeText}» no es un nivel. Use ${Object.values(DEGREE_LABEL).join(", ")}.`);

        const modality = MODALITIES[normalize(modalityText)];
        if (!modalityText) fail("modalidad", "falta la modalidad.");
        else if (!modality) fail("modalidad", `«${modalityText}» no es una modalidad. Use ${Object.values(MODALITY_LABEL).join(", ")}.`);

        const campuses: string[] = [];
        for (const part of campusText.split(/[,;/]/).map((item) => item.trim()).filter(Boolean)) {
          const campus = context.campuses.find(
            (item) =>
              normalize(item.slug) === normalize(part) || normalize(item.name) === normalize(part) || normalize(item.code) === normalize(part),
          );
          if (!campus) fail("sedes", `no existe la sede «${part}».`);
          else if (!campuses.includes(campus.slug)) campuses.push(campus.slug);
        }
        if (!campusText) fail("sedes", "falta al menos una sede donde se ofrece.");

        Object.assign(payload, {
          snies_code: snies || null,
          faculty_code: faculty ?? facultyText,
          degree_level: degree,
          modality,
          campuses,
        });

        if (existing && faculty && degree && modality) {
          if ((existing.sniesCode ?? "") !== snies) changes.push(`SNIES: ${existing.sniesCode ?? "sin SNIES"} → ${snies || "sin SNIES"}`);
          const before = existing.parentId ? (byId.get(existing.parentId)?.code ?? null) : null;
          if (normalize(before) !== normalize(faculty)) changes.push(`facultad: ${before ?? "ninguna"} → ${faculty}`);
          if (existing.degreeLevel !== degree) {
            changes.push(`nivel: ${existing.degreeLevel ? DEGREE_LABEL[existing.degreeLevel] : "sin nivel"} → ${DEGREE_LABEL[degree]}`);
          }
          if (existing.modality !== modality) {
            changes.push(`modalidad: ${existing.modality ? MODALITY_LABEL[existing.modality] : "sin modalidad"} → ${MODALITY_LABEL[modality]}`);
          }
          const offered = context.offer
            .filter((item) => item.programId === existing!.id && item.active)
            .map((item) => context.campuses.find((campus) => campus.id === item.campusId)?.slug ?? "")
            .filter(Boolean);
          if (!sameSet(offered, campuses)) {
            const nameOf = (slug: string) => context.campuses.find((campus) => campus.slug === slug)?.name ?? slug;
            changes.push(`sedes: ${offered.map(nameOf).join(", ") || "ninguna"} → ${campuses.map(nameOf).join(", ")}`);
          }
        }
      }

      let status: RowStatus;
      if (errors.length > 0) status = "error";
      else if (!existing) status = "nuevo";
      else status = changes.length > 0 ? "actualizado" : "sin_cambio";

      if (status === "nuevo") {
        payload.slug = freeSlug(name, takenSlugs);
        takenSlugs.push(payload.slug);
      }

      summary.counts[status] += 1;
      counts[status] += 1;
      summary.rows.push({
        sheet: def.name,
        kind: def.kind,
        line,
        status,
        code,
        name,
        errors,
        changes: status === "actualizado" ? changes : [],
        payload: status === "nuevo" || status === "actualizado" ? payload : null,
      });
    });
  }

  if (problems.length === 0 && summaries.every((summary) => summary.rows.length === 0)) {
    problems.push("El libro no trae unidades debajo de los encabezados.");
  }
  return { problems, sheets: summaries, counts };
}

/** Lo que se manda a la base: solo lo nuevo y lo que cambia. */
export function rowsToImport(result: StructureResult): UnitImportRow[] {
  return result.sheets.flatMap((sheet) => sheet.rows.flatMap((row) => (row.payload ? [row.payload] : [])));
}

/** Se puede aplicar: sin problemas de libro, sin filas con error y con algo que hacer. */
export function canApply(result: StructureResult): boolean {
  return result.problems.length === 0 && result.counts.error === 0 && result.counts.nuevo + result.counts.actualizado > 0;
}

/* --- Plantilla ---------------------------------------------------------------------- */

const HEADER_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0A2D63" } } as const;
const HEADER_FONT = { bold: true, color: { argb: "FFFFFFFF" } } as const;
/** Filas con listas desplegables, además de las que ya traen datos. */
const SPARE_ROWS = 300;

/** Referencia a un rango, con comillas si el nombre de la hoja lo pide. */
const ref = (sheet: string, column: string, from: number, to: number) => `'${sheet}'!$${column}$${from}:$${column}$${to}`;

/**
 * Arma el libro: INSTRUCCIONES, una hoja por clase con lo que ya existe (así
 * sirve también para corregir en bloque) y listas desplegables, y LISTAS con
 * los valores válidos.
 */
export function fillStructureTemplate(book: Workbook, context: StructureContext) {
  const byId = new Map(context.units.map((unit) => [unit.id, unit]));
  const sorted = (kinds: UnitKind[]) =>
    context.units.filter((unit) => kinds.includes(unit.kind)).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const codeOf = (id: string | null) => (id ? (byId.get(id)?.code ?? "") : "");

  // --- Instrucciones
  const help = book.addWorksheet("Instrucciones");
  help.columns = [{ width: 24 }, { width: 100 }];
  help.addRow(["Carga de la estructura institucional · UDES"]).font = { bold: true, size: 14 };
  help.addRow([]);
  const lines: [string, string][] = [
    ["Cómo funciona", "Cada hoja es una clase de unidad. Ya trae lo que existe: corrija, añada filas y súbala en la intranet (Sistema → Estructura institucional → Cargar estructura)."],
    ["Nada se guarda solo", "Primero verá, hoja por hoja, qué se crea, qué cambia y qué tiene error. Si una sola fila tiene error, no se guarda ninguna."],
    ["El código manda", "Cada unidad se reconoce por su código, sin importar mayúsculas; un programa, antes, por su SNIES. No reutilice un código para otra unidad."],
    ["Orden", "Vicerrectorías, luego facultades, oficinas y programas. Un padre puede venir en el mismo libro: una facultad nueva con sus programas nuevos."],
    ["Organigrama y herencia", "Una facultad depende de una vicerrectoría solo en el organigrama: no le da acceso a sus datos. Una oficina que depende de otra unidad sí hereda: quien trabaja arriba la ve."],
    ["Sedes", "Escríbalas separadas por coma (Bucaramanga, Cúcuta). Las que se quiten quedan inactivas; no se borran."],
    ["Hojas que no use", "Puede borrarlas o dejarlas vacías."],
  ];
  for (const [title, body] of lines) {
    const row = help.addRow([title, body]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  }
  help.addRow([]);
  help.addRow(["Columnas"]).font = { bold: true, size: 12 };
  for (const def of SHEETS) {
    for (const column of def.columns) {
      const row = help.addRow([`${def.name} · ${column.header}`, `${column.hint}${column.optional ? " (opcional)" : ""}`]);
      row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    }
  }

  // --- Listas
  const campuses = context.campuses.map((campus) => campus.name);
  const functions = Object.values(FUNCTION_LABEL);
  const degrees = Object.values(DEGREE_LABEL);
  const modalities = Object.values(MODALITY_LABEL);
  const dependencies = sorted(["vicerrectoria", "oficina", "otra"]).map((unit) => unit.code);

  const sheets = new Map<ImportKind, ReturnType<Workbook["addWorksheet"]>>();
  const prefill: Record<ImportKind, (string | number)[][]> = {
    vicerrectoria: sorted(["vicerrectoria"]).map((unit) => [
      unit.code,
      unit.name,
      unit.substantiveFunction ? FUNCTION_LABEL[unit.substantiveFunction] : "",
    ]),
    facultad: sorted(["facultad"]).map((unit) => [unit.code, unit.name, codeOf(unit.reportsTo)]),
    oficina: sorted(["oficina", "otra"]).map((unit) => [unit.code, unit.name, codeOf(unit.parentId)]),
    programa: sorted(["programa"]).map((unit) => [
      unit.sniesCode ?? "",
      unit.code,
      unit.name,
      codeOf(unit.parentId),
      unit.degreeLevel ? DEGREE_LABEL[unit.degreeLevel] : "",
      unit.modality ? MODALITY_LABEL[unit.modality] : "",
      context.offer
        .filter((item) => item.programId === unit.id && item.active)
        .map((item) => context.campuses.find((campus) => campus.id === item.campusId)?.name ?? "")
        .filter(Boolean)
        .join(", "),
    ]),
  };

  for (const def of SHEETS) {
    const sheet = book.addWorksheet(def.name, { views: [{ state: "frozen", ySplit: 1 }] });
    sheet.columns = def.columns.map((column) => ({ header: column.header, key: column.key, width: column.width }));
    const head = sheet.getRow(1);
    head.font = HEADER_FONT;
    head.fill = HEADER_FILL;
    def.columns.forEach((column, index) => {
      head.getCell(index + 1).note = column.hint;
    });
    for (const values of prefill[def.kind]) sheet.addRow(values);
    // Los códigos, como texto: «0045» no debe volverse 45.
    sheet.getColumn(def.columns.findIndex((column) => column.key === "codigo") + 1).numFmt = "@";
    sheets.set(def.kind, sheet);
  }

  const lists = book.addWorksheet("Listas");
  lists.columns = [
    { header: "Funciones sustantivas", width: 22 },
    { header: "Niveles", width: 18 },
    { header: "Modalidades", width: 16 },
    { header: "Sedes", width: 18 },
    { header: "Vicerrectorías y oficinas (código)", width: 30 },
  ];
  lists.getRow(1).font = HEADER_FONT;
  lists.getRow(1).fill = HEADER_FILL;
  const height = Math.max(functions.length, degrees.length, modalities.length, campuses.length, dependencies.length);
  for (let i = 0; i < height; i += 1) {
    lists.addRow([functions[i] ?? "", degrees[i] ?? "", modalities[i] ?? "", campuses[i] ?? "", dependencies[i] ?? ""]);
  }

  // --- Listas desplegables
  const list = (formula: string, strict: boolean) => ({
    type: "list" as const,
    allowBlank: true,
    formulae: [formula],
    showErrorMessage: strict,
    errorStyle: "error" as const,
    errorTitle: "Valor no válido",
    error: "Elija un valor de la lista.",
  });
  const validate = (kind: ImportKind, key: string, formula: string, strict: boolean) => {
    const def = SHEETS.find((item) => item.kind === kind)!;
    const sheet = sheets.get(kind)!;
    const column = def.columns.findIndex((item) => item.key === key) + 1;
    const last = prefill[kind].length + 1 + SPARE_ROWS;
    for (let row = 2; row <= last; row += 1) sheet.getCell(row, column).dataValidation = list(formula, strict);
  };
  const facultyRows = prefill.facultad.length + 1 + SPARE_ROWS;
  const viceRows = prefill.vicerrectoria.length + 1 + SPARE_ROWS;
  validate("vicerrectoria", "funcion", ref("Listas", "A", 2, functions.length + 1), true);
  // Los códigos se toman de la hoja misma: una vicerrectoría o facultad nueva
  // ya aparece en la lista de las demás hojas.
  validate("facultad", "vicerrectoria", ref("Vicerrectorías", "A", 2, viceRows), true);
  // Una oficina puede depender de otra que se escribe en esta misma hoja: la
  // lista sugiere, pero no impide.
  validate("oficina", "depende", ref("Listas", "E", 2, Math.max(2, dependencies.length + 1)), false);
  validate("programa", "facultad", ref("Facultades", "A", 2, facultyRows), true);
  validate("programa", "nivel", ref("Listas", "B", 2, degrees.length + 1), true);
  validate("programa", "modalidad", ref("Listas", "C", 2, modalities.length + 1), true);
}

/** Las hojas de un libro de ExcelJS como matrices de textos (fórmulas por su resultado). */
export function workbookToTables(book: Workbook): Record<string, string[][]> {
  const out: Record<string, string[][]> = {};
  for (const sheet of book.worksheets) {
    const table: string[][] = [];
    sheet.eachRow({ includeEmpty: true }, (row, index) => {
      const values: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell, column) => {
        const value = cell.value as unknown;
        let result = "";
        if (value == null) result = "";
        else if (typeof value === "object" && "result" in (value as object)) result = String((value as { result: unknown }).result ?? "");
        else if (typeof value === "object" && "richText" in (value as object)) {
          result = (value as { richText: { text: string }[] }).richText.map((part) => part.text).join("");
        } else if (typeof value === "object" && "text" in (value as object)) result = String((value as { text: unknown }).text ?? "");
        else result = String(value);
        values[column - 1] = result;
      });
      table[index - 1] = Array.from(values, (value) => value ?? "");
    });
    out[sheet.name] = Array.from(table, (row) => row ?? []);
  }
  return out;
}
