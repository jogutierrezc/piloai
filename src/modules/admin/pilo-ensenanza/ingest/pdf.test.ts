import { describe, expect, it } from "vitest";
import { patternLevel, readPdfPages, type PdfItem, type PdfPage } from "./pdf";
import { toPassages } from "./chunk";
import { SCANNED_MESSAGE } from "./types";

const BODY = 11;
const item = (text: string, y: number, size = BODY, x = 50): PdfItem => ({ text, size, x, y, width: text.length * size * 0.5 });
const filler = (n: number) => `Esta es la línea ${n} del cuerpo del documento y habla de la evaluación de los aprendizajes.`;

/** Una página con encabezado, pie y las líneas que se le pasen (de arriba abajo). */
function page(number: number, lines: PdfItem[], withFrame = true): PdfPage {
  const frame = withFrame ? [item("Universidad de Santander · Reglamento", 800), item(`Página ${number} de 6`, 30)] : [];
  return { number, items: [...frame, ...lines] };
}

const body = (start: number, count: number, top = 700): PdfItem[] =>
  Array.from({ length: count }, (_, i) => item(filler(start + i), top - i * 14));

describe("PDF · escaneado", () => {
  it("un PDF sin texto es escaneado y trae el mensaje", () => {
    const out = readPdfPages([page(1, [], false), page(2, [], false), page(3, [item("1", 30)], false)]);
    expect(out.scanned).toBe(true);
    expect(out.blocks).toEqual([]);
    expect(out.warnings).toContain(SCANNED_MESSAGE);
    expect(toPassages(out, { title: "x" })).toEqual([]);
  });

  it("más de la mitad de las páginas casi vacías cuenta como escaneado aunque una tenga mucho texto", () => {
    const rich = page(1, body(1, 60), false);
    const out = readPdfPages([rich, page(2, [item("1", 400)], false), page(3, [item("2", 400)], false), page(4, [item("3", 400)], false)]);
    // Promedio: 60 líneas / 4 páginas = alto; pero 3 de 4 páginas < 20 caracteres.
    expect(out.scanned).toBe(true);
  });

  it("un PDF con texto no es escaneado", () => {
    expect(readPdfPages([page(1, body(1, 10), false)]).scanned).toBe(false);
  });
});

describe("PDF · encabezados y pies repetidos", () => {
  const pages = [1, 2, 3, 4, 5, 6].map((n) => page(n, body(n * 10, 6)));

  it("quita lo que se repite en las páginas, con números de página incluidos", () => {
    const out = readPdfPages(pages);
    const text = out.blocks.map((b) => (b.type === "table" ? "" : b.text)).join("\n");
    expect(text).not.toMatch(/Reglamento/);
    expect(text).not.toMatch(/Página \d/);
    expect(text).toContain("línea 10 del cuerpo");
    expect(out.warnings.join(" ")).toMatch(/12 líneas/);
  });

  it("no toca documentos de menos de tres páginas", () => {
    const out = readPdfPages([page(1, body(1, 6)), page(2, body(10, 6))]);
    expect(out.blocks.map((b) => (b.type === "table" ? "" : b.text)).join("\n")).toMatch(/Reglamento/);
  });
});

describe("PDF · títulos", () => {
  it("reconoce letra grande y patrones, y el troceo arma la ruta", () => {
    const first = page(1, [
      item("CAPÍTULO 2", 720, 16),
      item("De la admisión", 700, 16),
      item("Artículo 14", 680, 12),
      ...body(1, 6, 660),
    ], false);
    const second = page(2, [item("2.1 Requisitos", 720, BODY), ...body(20, 6, 700)], false);
    const out = readPdfPages([first, second]);
    const headings = out.blocks.filter((b) => b.type === "heading");
    expect(headings.map((h) => (h.type === "heading" ? h.text : ""))).toEqual([
      "CAPÍTULO 2 · De la admisión",
      "Artículo 14",
      "2.1 Requisitos",
    ]);
    const passages = toPassages(out, { title: "Reglamento" });
    expect(passages[0].section).toBe("CAPÍTULO 2 · De la admisión › Artículo 14");
    expect(passages[1].section).toBe("CAPÍTULO 2 · De la admisión › 2.1 Requisitos");
  });

  it("un artículo con su texto en la misma línea separa el rótulo", () => {
    const lines = [item(`Artículo 3. ${filler(1)}`, 700), ...body(2, 5, 686)];
    const out = readPdfPages([page(1, lines, false)]);
    expect(out.blocks[0]).toMatchObject({ type: "heading", text: "Artículo 3", level: 3 });
    expect(out.blocks[1]).toMatchObject({ type: "paragraph" });
  });

  it("no toma por título una línea larga ni una lista", () => {
    expect(patternLevel("2024 fue un año de mucho trabajo")).toBe(0);
    expect(patternLevel("1. Introducción")).toBe(1);
    expect(patternLevel("3.2.1 Evaluación formativa")).toBe(3);
    expect(patternLevel("Capítulo III")).toBe(1);
    expect(patternLevel("Artículo 14º")).toBe(3);
  });
});

describe("PDF · párrafos", () => {
  it("une líneas vecinas, parte por espacio vertical y repara guiones de fin de línea", () => {
    const lines = [
      item("La evaluación formativa es una prác-", 700),
      item("tica continua del aula.", 686),
      item("Un segundo párrafo, más abajo.", 640),
    ];
    const out = readPdfPages([page(1, [...lines, ...body(3, 5, 600)], false)]);
    expect(out.blocks[0]).toMatchObject({ type: "paragraph", text: "La evaluación formativa es una práctica continua del aula." });
    expect(out.blocks[1]).toMatchObject({ type: "paragraph", text: expect.stringContaining("Un segundo párrafo") });
  });
});
