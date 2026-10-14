import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { EXAMPLES, detectCatalogKind, fillCatalogTemplate, parseCatalogTable } from "./catalog-sheet";
import { workbookToTables } from "../institucion/structure-sheet";

async function roundTrip(kind: "respuesta" | "capciosa") {
  const book = new ExcelJS.Workbook();
  fillCatalogTemplate(book, kind);
  const again = new ExcelJS.Workbook();
  await again.xlsx.load((await book.xlsx.writeBuffer()) as ArrayBuffer);
  return parseCatalogTable(kind, workbookToTables(again));
}

describe("el catálogo de Pilo en Excel", () => {
  it("la plantilla de respuestas se lee tal como se escribió", async () => {
    const r = await roundTrip("respuesta");
    expect(r.problems).toEqual([]);
    expect(r.valid.map((v) => v.key)).toEqual(EXAMPLES.respuesta.map((e) => e.key));
    expect(r.valid[0].variants).toHaveLength(2);
    expect(r.valid[0].source_path).toBe("/pdi");
  });

  it("la plantilla de capciosas también, con sus disparadores y emociones", async () => {
    const r = await roundTrip("capciosa");
    expect(r.problems).toEqual([]);
    expect(r.valid.map((v) => [v.key, v.mood, v.triggers.length])).toEqual([
      ["C-001", "atrevido", 3],
      ["C-002", "loco", 3],
      ["C-003", "pensar", 3],
    ]);
    expect(r.valid[0].question).toBe("Salarios");
  });

  it("cada error dice hoja, fila y columna", () => {
    const r = parseCatalogTable("capciosa", {
      Capciosas: [
        ["Clave", "Tema", "Disparadores", "Respuesta", "Emoción", "Activa"],
        ["c 1", "", "salario", "No.", "", ""],
        ["C-2", "", "", "Algo", "furioso", "tal vez"],
        ["C-3", "", "ok", "Cuesta $ 5.000", "", "NO"],
        ["", "", "", "", "", ""],
        ["C-4", "Edad", "cuantos años | edad", "Tengo los años de la universidad.", "", "no"],
        ["C-5", "Plata", "salario, sueldo; cuanto gana", "No se publica.", "", ""],
      ],
    });
    const errors = r.rows.flatMap((x) => x.errors);
    expect(errors.some((e) => /fila 2, columna «Clave»/.test(e))).toBe(true);
    expect(errors.some((e) => /fila 3, columna «Disparadores»: falta/.test(e))).toBe(true);
    expect(errors.some((e) => /fila 3, columna «Emoción»/.test(e))).toBe(true);
    expect(errors.some((e) => /fila 3, columna «Activa»/.test(e))).toBe(true);
    expect(errors.some((e) => /fila 4, columna «Disparadores»: «ok» es demasiado corto/.test(e))).toBe(true);
    expect(errors.some((e) => /fila 4, columna «Respuesta»: no se publican cifras de dinero/.test(e))).toBe(true);
    expect(r.valid).toEqual([
      expect.objectContaining({ key: "C-4", active: false, triggers: ["cuantos años", "edad"], mood: "atrevido" }),
      expect.objectContaining({ key: "C-5", triggers: ["salario", "sueldo", "cuanto gana"] }),
    ]);
  });

  it("sin la columna obligatoria, lo dice y no lee nada", () => {
    const r = parseCatalogTable("respuesta", { Respuestas: [["Clave", "Respuesta"], ["R-1", "Hola"]] });
    expect(r.problems).toEqual(["Hoja «Respuestas»: falta la columna «Pregunta»."]);
    expect(r.valid).toEqual([]);
  });

  it("reconoce alias de columnas y genera claves si faltan", () => {
    const r = parseCatalogTable("respuesta", {
      "Respuestas locales": [
        ["Preguntas", "Respuestas", "Disparadores"],
        ["¿Qué es el PDI?", "Es el plan de desarrollo institucional.", "pdi, plan de desarrollo"],
        ["¿Dónde están las cifras?", "En el portal de datos abiertos.", "cifras oficiales"],
      ],
    });
    expect(r.problems).toEqual([]);
    expect(r.valid).toHaveLength(2);
    expect(r.valid[0].key).toBe("R-001");
    expect(r.valid[0].triggers).toEqual(["pdi", "plan de desarrollo"]);
    expect(r.valid[1].key).toBe("R-002");
    expect(r.valid[1].triggers).toEqual(["cifras oficiales"]);
  });

  it("detectCatalogKind identifica automáticamente el tipo de libro", () => {
    expect(detectCatalogKind({ "Respuestas oficiales": [["Pregunta", "Respuesta"]] })).toBe("respuesta");
    expect(detectCatalogKind({ "Capciosas": [["Tema", "Disparadores", "Respuesta"]] })).toBe("capciosa");
    expect(detectCatalogKind({ "Hoja 1": [["Preguntas frecuentes", "Respuesta"]] })).toBe("respuesta");
    expect(detectCatalogKind({ "Hoja 1": [["Tema", "Triggers", "Respuesta"]] })).toBe("capciosa");
  });
});
