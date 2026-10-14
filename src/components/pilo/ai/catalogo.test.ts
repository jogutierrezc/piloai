import { describe, expect, it } from "vitest";
import { hasTrigger, matchCatalog, normalizeQuestion } from "./logic";
import type { CatalogEntry } from "./logic";

const entry = (e: Partial<CatalogEntry>): CatalogEntry => ({
  key: "X",
  kind: "capciosa",
  question: "",
  variants: [],
  triggers: [],
  answer: "…",
  mood: "atrevido",
  source_title: "",
  source_path: "",
  cut: "",
  office: "",
  ...e,
});

const catalog = [
  entry({ key: "C-001", triggers: ["salario"], answer: "Los salarios no se publican." }),
  entry({ key: "C-002", triggers: ["salario rector"], answer: "Del rector tampoco, lo siento.", mood: "loco" }),
  entry({ key: "C-003", triggers: ["novia"], answer: "Mi único amor son los datos abiertos." }),
  entry({
    key: "R-001",
    kind: "respuesta",
    question: "¿Qué es el PDI?",
    variants: ["que significa pdi", "para que sirve el plan de desarrollo"],
    answer: "El PDI es el Plan de Desarrollo Institucional 2024-2028.",
    mood: "emocionado",
  }),
];

describe("el catálogo de Planeación", () => {
  it("un disparador son palabras en cualquier orden, sin tildes, al comienzo de una palabra", () => {
    const q = normalizeQuestion("¿Cuál es el SALARIO del rector?");
    expect(hasTrigger(q, "salario rector")).toBe(true);
    expect(hasTrigger(q, "rector salario")).toBe(true);
    // Plural y singular son la misma palabra.
    expect(hasTrigger(q, "salarios")).toBe(true);
    expect(hasTrigger(normalizeQuestion("¿tienes novia?"), "novia")).toBe(true);
    expect(hasTrigger(normalizeQuestion("¿cómo va la novedad?"), "novia")).toBe(false);
  });

  it("gana la capciosa más específica", () => {
    expect(matchCatalog("¿Cuánto es el salario del rector?", catalog)?.entry.key).toBe("C-002");
    expect(matchCatalog("¿Cuál es el salario de un profesor?", catalog)?.entry.key).toBe("C-001");
  });

  it("una respuesta oficial responde a su pregunta y a sus variantes", () => {
    expect(matchCatalog("que es el PDI", catalog)?.entry.key).toBe("R-001");
    expect(matchCatalog("¿Qué significa PDI?", catalog)?.entry.key).toBe("R-001");
    expect(matchCatalog("¿Cuántos estudiantes hay?", catalog)).toBeNull();
  });

  it("una celda con comas son varios disparadores, no uno", () => {
    const withCommas = [entry({ key: "C-9", triggers: ["salario, sueldo; cuanto gana"], answer: "No se publica." })];
    expect(matchCatalog("¿Cuál es el sueldo del decano?", withCommas)?.entry.key).toBe("C-9");
    expect(matchCatalog("¿Cuánto gana un profesor?", withCommas)?.entry.key).toBe("C-9");
  });

  it("reconoce la capciosa aunque se pregunte de usted, en plural o en otro género", () => {
    const has = (question: string, trigger: string) => hasTrigger(normalizeQuestion(question), trigger);
    expect(has("¿Pilo tiene pareja?", "tienes pareja")).toBe(true);
    expect(has("¿Usted está casado?", "estas casado")).toBe(true);
    expect(has("¿Es usted una IA?", "eres una ia")).toBe(true);
    expect(has("¿Eres un robot?", "eres un robot")).toBe(true);
    expect(has("¿Tiene novio?", "novia")).toBe(true);
    expect(has("¿Cuánto ganan los profesores?", "cuanto gana")).toBe(true);
    expect(has("¿Cuáles son los salarios?", "salario")).toBe(true);
  });

  it("no se dispara con palabras que solo se parecen", () => {
    const has = (question: string, trigger: string) => hasTrigger(normalizeQuestion(question), trigger);
    expect(has("¿Dónde queda la sala de juntas?", "salarios")).toBe(false);
    expect(has("¿Qué novedades hay en el PDI?", "novia")).toBe(false);
    expect(has("¿Cuántos estudiantes hay?", "cuanto gana")).toBe(false);
    expect(has("¿Qué es el PDI?", "eres una ia")).toBe(false);
    // Un disparador que es solo relleno exige sus palabras tal cual.
    expect(has("¿Qué es el PDI?", "eres tu")).toBe(false);
  });

  it("disparadores separados por | o por línea también cuentan", () => {
    const piped = [entry({ key: "C-8", triggers: ["novia | tienes pareja\nestas casado"], answer: "Solo los datos." })];
    expect(matchCatalog("¿Está casado Pilo?", piped)?.entry.key).toBe("C-8");
  });

  it("reconoce la respuesta oficial aunque la pregunta traiga saludos o frases conversacionales", () => {
    expect(matchCatalog("Hola Pilo, ¿me puedes decir qué es el PDI?", catalog)?.entry.key).toBe("R-001");
    expect(matchCatalog("Buenos días, quisiera saber qué significa PDI por favor", catalog)?.entry.key).toBe("R-001");
    expect(matchCatalog("Cuéntame qué es el PDI", catalog)?.entry.key).toBe("R-001");
  });

  it("reconoce respuestas oficiales por sus disparadores / palabras clave", () => {
    const withRespTriggers = [
      entry({
        key: "R-005",
        kind: "respuesta",
        question: "¿Dónde veo los datos?",
        triggers: ["datos abiertos", "cifras oficiales"],
        answer: "En UDES en Cifras.",
      }),
    ];
    expect(matchCatalog("¿Dónde están los datos abiertos?", withRespTriggers)?.entry.key).toBe("R-005");
    expect(matchCatalog("Quiero consultar las cifras oficiales de la udes", withRespTriggers)?.entry.key).toBe("R-005");
  });

  it("que la pregunta nombre a la UDES no la vuelve «qué es la UDES»", () => {
    const udes = [
      entry({ key: "R-003", kind: "respuesta", question: "¿Qué es la UDES?", answer: "La UDES es una universidad privada." }),
      entry({ key: "R-004", kind: "respuesta", question: "¿Quién es el rector?", triggers: ["udes"], answer: "El rector es…" }),
    ];
    // «es» ya no coincide con «estudiantes», y la entrada debe cubrir lo esencial.
    expect(matchCatalog("¿Cuántos estudiantes matriculados tiene la UDES?", udes)).toBeNull();
    expect(matchCatalog("¿Cuántos programas tiene la UDES en Cúcuta?", udes)).toBeNull();
    // La pregunta de verdad sigue respondiéndose.
    expect(matchCatalog("hola pilo, ¿qué es la UDES?", udes)?.entry.key).toBe("R-003");
    expect(matchCatalog("¿Qué es la udes?", udes)?.entry.key).toBe("R-003");
  });
});
