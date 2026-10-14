import { describe, expect, it } from "vitest";
import { parseSaved, saveProblem, savedCopyText, savedDraft, savedMeta, savedWhen, searchSaved } from "./answers";
import type { SavedAnswer } from "./answers";

const source = (n: number, over: Record<string, unknown> = {}) => ({ n, ref: `r${n}`, source: "pdi", title: `Fuente ${n}`, section: "Sección", path: `/pdi/${n}`, cut: "2025", office: "Planeación", excerpt: "x".repeat(900), ...over });

const item = (over: Partial<SavedAnswer> = {}): SavedAnswer => ({ id: 1, space: "ensenanza", question: "¿Cómo se arma una rúbrica?", answer: "Con criterios y niveles [1].", sources: [{ n: 1, title: "Guía de evaluación", path: "/pilo-ensenanza/guia", section: "" }], created_at: "2026-10-01T15:00:00Z", ...over });

describe("lo que se guarda de una respuesta", () => {
  it("la pregunta, la respuesta y sus fuentes, sin el extracto", () => {
    const draft = savedDraft("planeacion", "  ¿Qué es   el PDI? ", { text: " El plan de desarrollo [1]. ", sources: [source(1)] });
    expect(draft).toEqual({ space: "planeacion", question: "¿Qué es el PDI?", answer: "El plan de desarrollo [1].", sources: [{ n: 1, title: "Fuente 1", path: "/pdi/1", section: "Sección" }] });
  });

  it("sin pregunta o sin texto no hay nada que guardar", () => {
    expect(savedDraft("planeacion", "", { text: "algo" })).toBeNull();
    expect(savedDraft("planeacion", "¿x?", { text: "   " })).toBeNull();
    expect(savedDraft("planeacion", "¿x?", null)).toBeNull();
    expect(savedDraft("planeacion", "¿x?", undefined)).toBeNull();
  });

  it("respeta los topes de la base: 600, 12.000 y el peso de las fuentes", () => {
    const many = Array.from({ length: 200 }, (_, i) => source(i + 1, { title: "T".repeat(200), path: `/p/${"a".repeat(390)}` }));
    const draft = savedDraft("ensenanza", "q".repeat(900), { text: "a".repeat(20_000), sources: many })!;
    expect(draft.question).toHaveLength(600);
    expect(draft.answer).toHaveLength(12_000);
    expect(JSON.stringify(draft.sources).length).toBeLessThanOrEqual(9_000);
    expect(draft.sources.length).toBeGreaterThan(0);
    // Las que quedan son las primeras, en su orden.
    expect(draft.sources.map((s) => s.n)).toEqual(draft.sources.map((_, i) => i + 1));
  });

  it("unas fuentes que no se entienden no rompen el guardado", () => {
    expect(savedDraft("planeacion", "¿x?", { text: "y", sources: "no es una lista" })?.sources).toEqual([]);
    expect(savedDraft("planeacion", "¿x?", { text: "y", sources: [null, 3, { title: "" }, { title: "Buena" }] })?.sources).toEqual([{ n: 1, title: "Buena", path: "", section: "" }]);
  });
});

describe("lo que vuelve de la base", () => {
  it("una fila se lee; lo que no se entiende se descarta", () => {
    expect(parseSaved({ id: 7, space: "ensenanza", question: "¿q?", answer: "a", sources: [source(2)], created_at: "2026-10-01T00:00:00Z" })).toEqual({
      id: 7,
      space: "ensenanza",
      question: "¿q?",
      answer: "a",
      sources: [{ n: 2, title: "Fuente 2", path: "/pdi/2", section: "Sección" }],
      created_at: "2026-10-01T00:00:00Z",
    });
    expect(parseSaved({ id: "9", space: "otro", question: "¿q?", answer: "a", sources: null })).toMatchObject({ id: 9, space: "planeacion", sources: [], created_at: "" });
    for (const bad of [null, 3, {}, { id: "x", question: "q", answer: "a" }, { id: 1, question: 2, answer: "a" }]) expect(parseSaved(bad)).toBeNull();
  });
});

describe("el buscador de lo guardado", () => {
  const list = [
    item({ id: 1, question: "¿Cómo se arma una rúbrica?", answer: "Con criterios y niveles de desempeño." }),
    item({ id: 2, space: "planeacion", question: "¿Qué es el PDI y cómo va?", answer: "El Plan de Desarrollo Institucional 2024-2028.", sources: [{ n: 1, title: "Tablero de avance", path: "/pdi", section: "" }] }),
    item({ id: 3, question: "¿Qué es la evaluación formativa?", answer: "La que acompaña el aprendizaje." }),
  ];

  it("sin texto devuelve todo, en su orden", () => {
    expect(searchSaved(list, "")).toBe(list);
    expect(searchSaved(list, "   ")).toBe(list);
  });

  it("busca en la pregunta, la respuesta y los títulos de las fuentes", () => {
    expect(searchSaved(list, "rúbrica").map((x) => x.id)).toEqual([1]);
    expect(searchSaved(list, "institucional").map((x) => x.id)).toEqual([2]);
    expect(searchSaved(list, "tablero").map((x) => x.id)).toEqual([2]);
  });

  it("sin importar acentos ni mayúsculas, y con todas las palabras", () => {
    expect(searchSaved(list, "RUBRICA").map((x) => x.id)).toEqual([1]);
    expect(searchSaved(list, "evaluacion formativa").map((x) => x.id)).toEqual([3]);
    expect(searchSaved(list, "que es").map((x) => x.id)).toEqual([2, 3]);
    expect(searchSaved(list, "rúbrica pdi")).toEqual([]);
    expect(searchSaved(list, "inexistente")).toEqual([]);
  });
});

describe("cómo se nombra una guardada", () => {
  const now = new Date(2026, 9, 10, 12).getTime();
  const at = (y: number, m: number, d: number) => new Date(y, m, d, 9).toISOString();

  it("la fecha, en palabras", () => {
    expect(savedWhen(at(2026, 9, 10), now)).toBe("guardada hoy");
    expect(savedWhen(at(2026, 9, 9), now)).toBe("guardada ayer");
    expect(savedWhen(at(2026, 9, 7), now)).toBe("guardada hace 3 días");
    expect(savedWhen(at(2026, 2, 12), now)).toBe("guardada el 12 de marzo");
    expect(savedWhen(at(2025, 11, 24), now)).toBe("guardada el 24 de diciembre de 2025");
    expect(savedWhen("no es una fecha", now)).toBe("guardada");
  });

  it("el Pilo, la fecha y cuántas fuentes", () => {
    expect(savedMeta(item({ created_at: at(2026, 9, 9) }), "Enseñanza", now)).toBe("Enseñanza · guardada ayer · con 1 fuente");
    expect(savedMeta(item({ created_at: at(2026, 9, 10), sources: [] }), "Universidad", now)).toBe("Universidad · guardada hoy");
    expect(savedMeta(item({ created_at: at(2026, 9, 10), sources: [{ n: 1, title: "a", path: "", section: "" }, { n: 2, title: "b", path: "", section: "" }] }), "Universidad", now)).toMatch(/con 2 fuentes$/);
  });

  it("lo que se copia: la pregunta, el texto y las fuentes con su dirección completa", () => {
    const text = savedCopyText(item({ sources: [{ n: 1, title: "Guía", path: "/pilo-ensenanza/guia", section: "" }, { n: 2, title: "Decreto", path: "https://mineducacion.gov.co/d", section: "" }] }), "Con criterios y niveles.", "https://pdi.udes.edu.co");
    expect(text).toBe("¿Cómo se arma una rúbrica?\n\nCon criterios y niveles.\n\n[1] Guía · https://pdi.udes.edu.co/pilo-ensenanza/guia\n[2] Decreto · https://mineducacion.gov.co/d");
    expect(savedCopyText(item({ sources: [] }), "Texto.", "https://x")).toBe("¿Cómo se arma una rúbrica?\n\nTexto.");
  });

  it("los fallos de la base, en palabras de la persona", () => {
    expect(saveProblem("Ya tiene 300 respuestas guardadas: quite alguna para guardar otra.")).toMatch(/300 respuestas guardadas/);
    expect(saveProblem('relation "public.pilo_user_saved" does not exist')).toMatch(/todavía no está disponible/);
    expect(saveProblem("new row violates row-level security policy")).toBe("No se pudo guardar la respuesta. Intente de nuevo.");
    expect(saveProblem(null)).toBe("No se pudo guardar la respuesta. Intente de nuevo.");
  });
});
