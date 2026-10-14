import { zipSync, strToU8 } from "fflate";
import { describe, expect, it } from "vitest";
import { detectSeparator } from "../../udes-en-cifras/sheet";
import { readCsv } from "./csv";
import { headingLevel, readDocxDocument } from "./docx";
import { kindOf, readDocument, toPassages } from "./index";
import { LIMITS } from "./types";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style = "") =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${para(text)}</w:tc>`;
const table = (rows: string[][]) => `<w:tbl>${rows.map((r) => `<w:tr>${r.map(cell).join("")}</w:tr>`).join("")}</w:tbl>`;

function docxBytes(body: string): Uint8Array {
  const xml = `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`;
  return zipSync({ "word/document.xml": strToU8(xml) });
}

const fileOf = (bytes: Uint8Array | string, name: string, type = ""): File =>
  new File([typeof bytes === "string" ? bytes : new Uint8Array(bytes)], name, { type });

describe("Word", () => {
  const long = "El profesor acompaña la evaluación formativa con retroalimentación oportuna. ".repeat(8);
  const bytes = docxBytes(
    para("Política de evaluación", "Title") +
      para("Principios", "Heading1") +
      para(long) +
      para("Escalas", "Ttulo2") +
      para(long) +
      table([["Nota", "Significado"], ["A", "Superior"], ["B", "Alto"]]),
  );

  it("lee títulos por estilo, párrafos y tablas", () => {
    const parsed = readDocxDocument(bytes);
    expect(parsed.kind).toBe("docx");
    expect(parsed.blocks.map((b) => b.type)).toEqual(["heading", "heading", "paragraph", "heading", "paragraph", "table"]);
    expect(parsed.blocks[3]).toMatchObject({ type: "heading", level: 2, text: "Escalas" });
  });

  it("de ahí salen pasajes con ruta y filas con encabezado", () => {
    const passages = toPassages(readDocxDocument(bytes), { title: "Política" });
    expect(passages.map((p) => p.section)).toEqual([
      "Principios",
      "Principios › Escalas",
      "Principios › Escalas › Tabla · filas 2–3",
    ]);
    expect(passages[2].body).toBe("Nota: A; Significado: Superior\nNota: B; Significado: Alto");
  });

  it("reconoce nombres de estilo", () => {
    expect(headingLevel("Heading3")).toBe(3);
    expect(headingLevel("Ttulo1")).toBe(1);
    expect(headingLevel("Normal")).toBe(0);
  });

  it("recorta las tablas de más de 2.000 filas y avisa", () => {
    const rows = [["A"], ...Array.from({ length: 2100 }, (_, i) => [`v${i}`])];
    const parsed = readDocxDocument(docxBytes(table(rows)));
    expect((parsed.blocks[0] as { rows: string[][] }).rows).toHaveLength(LIMITS.rowsPerSheet);
    expect(parsed.warnings.join(" ")).toMatch(/2000 filas/);
  });

  it("falla con claridad si no es un Word", async () => {
    await expect(readDocument(fileOf(zipSync({ "otro.txt": strToU8("x") }), "malo.docx"))).rejects.toThrow(/no parece un Word/);
  });
});

describe("CSV", () => {
  it("reutiliza la detección de separador de UDES en Cifras", () => {
    expect(detectSeparator("a;b;c")).toBe(";");
    const semicolon = readCsv(new TextEncoder().encode("Programa;Sede\nMedicina;Bucaramanga\nDerecho;Cúcuta"), "Oferta");
    const comma = readCsv(new TextEncoder().encode("Programa,Sede\nMedicina,Bucaramanga"), "Oferta");
    expect((semicolon.blocks[0] as { rows: string[][] }).rows[1]).toEqual(["Medicina", "Bucaramanga"]);
    expect((comma.blocks[0] as { rows: string[][] }).rows[0]).toEqual(["Programa", "Sede"]);
  });

  it("lee Windows-1252 cuando el UTF-8 sale roto", () => {
    const bytes = Uint8Array.from([..."Año;Sede\n2026;Cúcuta"].map((c) => c.charCodeAt(0)));
    const parsed = readCsv(bytes);
    expect((parsed.blocks[0] as { rows: string[][] }).rows[0][0]).toBe("Año");
    expect((parsed.blocks[0] as { rows: string[][] }).rows[1][1]).toBe("Cúcuta");
  });

  it("recorta a 2.000 filas y avisa", () => {
    const text = ["A;B", ...Array.from({ length: 2500 }, (_, i) => `${i};x`)].join("\n");
    const parsed = readCsv(new TextEncoder().encode(text), "Grande");
    expect((parsed.blocks[0] as { rows: string[][] }).rows).toHaveLength(LIMITS.rowsPerSheet);
    expect(parsed.warnings[0]).toMatch(/2000 filas de 2501/);
  });

  it("readDocument lo lee desde un File y arma «Hoja · filas»", async () => {
    const parsed = await readDocument(fileOf("Programa;Sede\nMedicina;Bucaramanga\n", "oferta.csv", "text/csv"));
    expect(parsed.kind).toBe("csv");
    expect(toPassages(parsed, { title: "Oferta" })[0]).toMatchObject({
      section: "oferta · filas 2–2",
      body: "Programa: Medicina; Sede: Bucaramanga",
    });
  });
});

describe("Excel", () => {
  it("lee cada hoja visible y omite las ocultas", async () => {
    const { default: ExcelJS } = await import("exceljs");
    const book = new ExcelJS.Workbook();
    const oferta = book.addWorksheet("Oferta");
    oferta.addRow(["Programa", "Sede", "Créditos"]);
    oferta.addRow(["Medicina", "Bucaramanga", 180]);
    oferta.addRow(["", "", ""]);
    oferta.addRow(["Derecho", "Cúcuta", 160]);
    book.addWorksheet("Secreta", { state: "hidden" }).addRow(["x"]);
    const buffer = (await book.xlsx.writeBuffer()) as ArrayBuffer;

    const parsed = await readDocument(fileOf(new Uint8Array(buffer), "oferta.xlsx"));
    expect(parsed.kind).toBe("xlsx");
    expect(parsed.pages).toBe(1);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.warnings.join(" ")).toMatch(/hoja oculta «Secreta»/);
    const passages = toPassages(parsed, { title: "Oferta académica" });
    expect(passages[0].section).toBe("Oferta · filas 2–3");
    expect(passages[0].body).toBe("Programa: Medicina; Sede: Bucaramanga; Créditos: 180\nPrograma: Derecho; Sede: Cúcuta; Créditos: 160");
  });
});

describe("readDocument", () => {
  it("elige el formato por extensión o por tipo", () => {
    expect(kindOf({ name: "A.DOCX" })).toBe("docx");
    expect(kindOf({ name: "datos", type: "application/pdf" })).toBe("pdf");
    expect(kindOf({ name: "notas.txt" })).toBeNull();
  });

  it("rechaza formatos no admitidos y archivos de más de 25 MB", async () => {
    await expect(readDocument(fileOf("x", "notas.txt"))).rejects.toThrow(/Formato no admitido/);
    const big = { name: "grande.pdf", size: LIMITS.fileBytes + 1 } as File;
    await expect(readDocument(big)).rejects.toThrow(/25 MB/);
  });
});
