import { describe, expect, it } from "vitest";
import { SIZE, packParagraphs, splitLong, toPassages, toPassagesReport } from "./chunk";
import { LIMITS, type Block, type ParsedDocument } from "./types";

const doc = (blocks: Block[], extra: Partial<ParsedDocument> = {}): ParsedDocument => ({
  kind: "docx",
  pages: 0,
  blocks,
  warnings: [],
  scanned: false,
  ...extra,
});

const meta = { title: "Reglamento", cut: "2026" };
const sentence = (n: number) => `La frase número ${n} habla de la evaluación formativa en el aula.`;
const paragraph = (from: number, count: number) => Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

describe("troceo por títulos", () => {
  it("separa por títulos y arma la ruta de la sección", () => {
    const parsed = doc([
      { type: "heading", level: 1, text: "Capítulo 2" },
      { type: "paragraph", text: paragraph(1, 6) },
      { type: "heading", level: 2, text: "Artículo 14" },
      { type: "paragraph", text: paragraph(10, 6) },
      { type: "heading", level: 2, text: "Artículo 15" },
      { type: "paragraph", text: paragraph(20, 6) },
      { type: "heading", level: 1, text: "Capítulo 3" },
      { type: "paragraph", text: paragraph(30, 6) },
    ]);
    const out = toPassages(parsed, meta);
    expect(out.map((p) => p.section)).toEqual([
      "Capítulo 2",
      "Capítulo 2 › Artículo 14",
      "Capítulo 2 › Artículo 15",
      "Capítulo 3",
    ]);
    expect(out.map((p) => p.seq)).toEqual([1, 2, 3, 4]);
    expect(out[1].title).toBe("Artículo 14");
    expect(out.every((p) => p.cut === "2026")).toBe(true);
  });

  it("sin títulos usa el título del documento", () => {
    const out = toPassages(doc([{ type: "paragraph", text: paragraph(1, 6) }]), meta);
    expect(out).toHaveLength(1);
    expect(out[0].section).toBe("Reglamento");
  });

  it("no deja pasajes de otro espacio: un documento escaneado no da pasajes", () => {
    const out = toPassagesReport(doc([], { kind: "pdf", scanned: true, warnings: ["Este PDF es una imagen"] }), meta);
    expect(out.passages).toEqual([]);
    expect(out.warnings[0]).toMatch(/imagen/);
  });
});

describe("tamaño de los pasajes", () => {
  it("corta un texto largo en pasajes de hasta 1.500 caracteres, por frase", () => {
    const parsed = doc([{ type: "paragraph", text: paragraph(1, 120) }]);
    const out = toPassages(parsed, meta);
    expect(out.length).toBeGreaterThan(3);
    for (const p of out) {
      expect(p.body.length).toBeLessThanOrEqual(SIZE.max);
      expect(p.body.length).toBeGreaterThanOrEqual(SIZE.min);
      expect(p.body).toMatch(/[.]$/);
    }
    // Salvo el último, los pasajes llenan casi todo el tope.
    expect(out[0].body.length).toBeGreaterThan(900);
  });

  it("parte una frase gigante por palabras", () => {
    const parts = splitLong("palabra ".repeat(600).trim(), 1500);
    expect(parts.every((p) => p.length <= 1500)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe("palabra ".repeat(600).trim());
  });

  it("empaca párrafos cortos sin partirlos", () => {
    const packed = packParagraphs(Array.from({ length: 30 }, (_, i) => paragraph(i, 2)));
    expect(packed.length).toBeGreaterThan(1);
    expect(packed.every((p) => p.length <= SIZE.max)).toBe(true);
  });

  it("une al vecino un trozo de menos de 200 caracteres", () => {
    const parsed = doc([
      { type: "heading", level: 1, text: "Uno" },
      { type: "paragraph", text: paragraph(1, 8) },
      { type: "heading", level: 1, text: "Dos" },
      { type: "paragraph", text: "Un párrafo muy corto." },
    ]);
    const out = toPassages(parsed, meta);
    expect(out).toHaveLength(1);
    expect(out[0].body).toContain("Dos. Un párrafo muy corto.");
  });

  it("si no hay anterior, el trozo chico se une al siguiente", () => {
    const parsed = doc([
      { type: "heading", level: 1, text: "Uno" },
      { type: "paragraph", text: "Corto." },
      { type: "heading", level: 1, text: "Dos" },
      { type: "paragraph", text: paragraph(1, 8) },
    ]);
    const out = toPassages(parsed, meta);
    expect(out).toHaveLength(1);
    expect(out[0].body.startsWith("Uno. Corto.")).toBe(true);
    expect(out[0].section).toBe("Dos");
  });
});

describe("tablas", () => {
  const rows = (n: number) => [["Programa", "Sede"], ...Array.from({ length: n }, (_, i) => [`Programa ${i + 1}`, `Sede ${i + 1}`])];

  it("escribe cada fila con su encabezado", () => {
    const out = toPassages(doc([{ type: "table", rows: rows(3), sheet: "Oferta" }], { kind: "xlsx" }), meta);
    expect(out).toHaveLength(1);
    expect(out[0].body.split("\n")).toEqual([
      "Programa: Programa 1; Sede: Sede 1",
      "Programa: Programa 2; Sede: Sede 2",
      "Programa: Programa 3; Sede: Sede 3",
    ]);
    expect(out[0].section).toBe("Oferta · filas 2–4");
  });

  it("agrupa de a 25 filas y numera las filas de la hoja", () => {
    const out = toPassages(doc([{ type: "table", rows: rows(60), sheet: "Oferta" }], { kind: "xlsx" }), meta);
    expect(out.map((p) => p.section)).toEqual(["Oferta · filas 2–26", "Oferta · filas 27–51", "Oferta · filas 52–61"]);
  });

  it("cierra el pasaje al pasar de 1.400 caracteres", () => {
    const wide = [["Texto"], ...Array.from({ length: 10 }, (_, i) => [`${"x".repeat(400)}${i}`])];
    const out = toPassages(doc([{ type: "table", rows: wide, sheet: "H" }], { kind: "xlsx" }), meta);
    expect(out.length).toBeGreaterThan(2);
    expect(out.every((p) => p.body.length <= 1400 + 3)).toBe(true);
  });

  it("una tabla de Word cuelga de la ruta de títulos", () => {
    const parsed = doc([
      { type: "heading", level: 1, text: "Capítulo 1" },
      { type: "table", rows: rows(2) },
    ]);
    expect(toPassages(parsed, meta)[0].section).toBe("Capítulo 1 › Tabla · filas 2–3");
  });

  it("no mezcla filas de tabla con el texto vecino", () => {
    const parsed = doc([
      { type: "paragraph", text: "Corto." },
      { type: "table", rows: rows(2), sheet: "H" },
    ]);
    const out = toPassages(parsed, meta);
    expect(out).toHaveLength(2);
    expect(out[1].body).toContain("Programa: Programa 1");
  });
});

describe("límites y limpieza", () => {
  it("recorta a 400 pasajes y lo avisa", () => {
    const rows = [["A"], ...Array.from({ length: 1999 }, (_, i) => [`fila ${i}`])];
    const sheets: Block[] = Array.from({ length: 6 }, (_, i) => ({ type: "table", rows, sheet: `H${i}` }));
    const out = toPassagesReport(doc(sheets, { kind: "xlsx" }), meta);
    expect(out.passages).toHaveLength(LIMITS.passages);
    expect(out.passages[out.passages.length - 1].seq).toBe(LIMITS.passages);
    expect(out.warnings.join(" ")).toMatch(/400 pasajes/);
  });

  it("tapa datos personales y quita cifras de dinero", () => {
    const parsed = doc([
      {
        type: "paragraph",
        text: `${paragraph(1, 5)} Escriba a maria.perez@udes.edu.co o llame al 300 123 4567. La matrícula cuesta 5 millones de pesos.`,
      },
    ]);
    const out = toPassagesReport(parsed, meta);
    expect(out.passages[0].body).toContain("[dato omitido]");
    expect(out.passages[0].body).not.toContain("maria.perez");
    expect(out.passages[0].body).not.toMatch(/millones/);
    expect(out.redacted).toBe(2);
    expect(out.warnings.join(" ")).toMatch(/2 datos personales/);
  });
});
