import { describe, expect, it } from "vitest";
import { readingDocument, readingRows, readingTitle, readingWhere } from "./readings";

const BODY = ["## Admisiones", "Las inscripciones se hacen en línea. ".repeat(12), "## Requisitos", "Documento de identidad y resultados de la prueba Saber 11. ".repeat(10)].join("\n\n");

describe("lo que leyó Pilo en otros portales", () => {
  it("las líneas «## …» son títulos y lo demás, párrafos", () => {
    const doc = readingDocument(BODY);
    expect(doc.blocks.map((b) => b.type)).toEqual(["heading", "paragraph", "heading", "paragraph"]);
    expect(doc.blocks[0]).toMatchObject({ type: "heading", text: "Admisiones" });
    expect(doc.scanned).toBe(false);
  });

  it("cada pasaje lleva su sección y la dirección de la página", () => {
    const rows = readingRows({ body: BODY, url: "https://www.udes.edu.co/admisiones" }, "Admisiones UDES");
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.path === "https://www.udes.edu.co/admisiones")).toBe(true);
    expect(rows.map((r) => r.section)).toEqual(expect.arrayContaining(["Admisiones", "Requisitos"]));
    expect(rows.map((r) => r.seq)).toEqual(rows.map((_, i) => rows[0].seq + i));
  });

  it("sin texto no deja pasajes", () => {
    expect(readingRows({ body: "", url: "https://a.co/" }, "x")).toEqual([]);
  });

  it("la dirección se lee sin protocolo, y sirve de título si la página no trae uno", () => {
    expect(readingWhere("https://www.udes.edu.co/admisiones/")).toBe("www.udes.edu.co/admisiones");
    expect(readingTitle({ title: "  ", url: "https://www.udes.edu.co/admisiones" })).toBe("www.udes.edu.co/admisiones");
    expect(readingTitle({ title: "Admisiones", url: "https://a.co" })).toBe("Admisiones");
  });
});
