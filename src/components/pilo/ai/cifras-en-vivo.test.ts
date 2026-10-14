import { describe, expect, it } from "vitest";
import {
  cutText,
  dataAnswer,
  expandQuery,
  factPassage,
  figureText,
  buildAskMessages,
  buildUnderstandMessages,
  isFollowUp,
  knownCampuses,
  mergeSlots,
  numbersIn,
  parseSlots,
  parseUnderstand,
  pickCuts,
  planAsk,
  sameCampus,
  sameCut,
  verifyNumbers,
  wantsFigure,
} from "./logic";
import type { Fact, FactPoint } from "./logic";

const CAMPUSES = ["Bucaramanga", "Cúcuta", "Valledupar", "Bogotá"];

const point = (y: number, t: "A" | "B" | null, c: string, v: number): FactPoint => ({ y, t, c, v });

const matriculados: Fact = {
  ref: "cifras:poblacion:matriculados",
  report: "Población estudiantil",
  label: "Matriculados",
  unit: "estudiantes",
  format: "entero",
  definition: "Estudiantes con matrícula financiera y académica en el periodo.",
  office: "Registro y Control",
  path: "/datos-abiertos/poblacion",
  period: "2020–2025",
  illustrative: false,
  series: [
    point(2024, null, "", 20500),
    point(2024, "A", "", 20100),
    point(2024, "B", "", 20500),
    point(2024, null, "Cúcuta", 3400),
    point(2024, "A", "Cúcuta", 3350),
    point(2024, "B", "Cúcuta", 3400),
    point(2024, null, "Bucaramanga", 12000),
    point(2024, "B", "Bucaramanga", 12000),
    point(2023, null, "", 19800),
    point(2023, "B", "Cúcuta", 3210),
    point(2023, null, "Cúcuta", 3210),
    point(2022, null, "", 19000),
  ],
};

describe("Pilo entiende el corte que se pide", () => {
  it("lee sede, año y periodo", () => {
    expect(parseSlots("¿Cuántos matriculados hubo en Cúcuta en 2023-2?", CAMPUSES)).toEqual({ years: [2023], term: "B", campus: ["Cúcuta"], byCampus: false });
    expect(parseSlots("matriculados primer semestre de 2024 en bga", CAMPUSES)).toMatchObject({ years: [2024], term: "A", campus: ["Bucaramanga"] });
    expect(parseSlots("¿Cuántos estudiantes hay por sede?", CAMPUSES)).toMatchObject({ campus: [], byCampus: true });
    expect(parseSlots("¿Qué es el Plan de Desarrollo?", CAMPUSES)).toEqual({ years: [], term: null, campus: [], byCampus: false });
  });

  it("no confunde un rango de años con un periodo", () => {
    expect(parseSlots("matriculados de 2023 a 2025", CAMPUSES)).toMatchObject({ years: [2023, 2025], term: null });
  });

  it("reconoce la pregunta que sigue a la anterior", () => {
    expect(isFollowUp("¿Y en Cúcuta?", CAMPUSES)).toBe(true);
    expect(isFollowUp("¿y en 2023?", CAMPUSES)).toBe(true);
    expect(isFollowUp("¿Eso cómo se compara con el año pasado?", CAMPUSES)).toBe(true);
    expect(isFollowUp("¿Qué es el PDI?", CAMPUSES)).toBe(false);
    expect(isFollowUp("¿Cuántos graduados tuvo la UDES en 2024?", CAMPUSES)).toBe(false);
  });

  it("lo que dice ahora manda y lo que calla lo pone la anterior", () => {
    const before = parseSlots("matriculados en Cúcuta en 2024-1", CAMPUSES);
    expect(mergeSlots(before, parseSlots("¿y en Valledupar?", CAMPUSES))).toEqual({ years: [2024], term: "A", campus: ["Valledupar"], byCampus: false });
    // Un año nuevo sin periodo pide el año entero.
    expect(mergeSlots(before, parseSlots("¿y en 2023?", CAMPUSES))).toEqual({ years: [2023], term: null, campus: ["Cúcuta"], byCampus: false });
  });

  it("busca también con las palabras de los informes", () => {
    expect(expandQuery("¿Cuántos alumnos hay?")).toContain("estudiantes");
    expect(expandQuery("profesores con doctorado")).toContain("docentes");
    expect(expandQuery("¿Qué es el PDI?")).toBe("¿Qué es el PDI?");
  });

  it("sabe cuándo se pide una cifra", () => {
    expect(wantsFigure("¿Cuántos matriculados hay?")).toBe(true);
    expect(wantsFigure("¿Cuál es la tasa de deserción?")).toBe(true);
    expect(wantsFigure("¿Quién reporta los boletines?")).toBe(false);
  });

  it("una respuesta guardada solo sirve para el mismo corte", () => {
    expect(sameCut("matriculados cucuta 2024", "matriculados en Cúcuta en 2024", CAMPUSES)).toBe(true);
    expect(sameCut("matriculados cucuta 2024", "matriculados cucuta 2023", CAMPUSES)).toBe(false);
    expect(sameCut("matriculados 2024", "matriculados 2024 en Valledupar", CAMPUSES)).toBe(false);
  });
});

describe("Pilo elige y dice las cifras", () => {
  it("sin sede ni año: toda la UDES, el periodo más reciente y el que lo compara (no la cifra del año)", () => {
    const { points, missing, reading } = pickCuts(matriculados, parseSlots("¿cuántos matriculados hay?", CAMPUSES));
    expect(points.map(cutText)).toEqual(["2024-2", "2024-1"]);
    expect(points.every((p) => p.c === "")).toBe(true);
    expect(missing).toEqual([]);
    expect(reading).toBe("periodo");
  });

  it("la cifra del año solo si se pide, y son los dos últimos años", () => {
    const { points, reading } = pickCuts(matriculados, parseSlots("¿cuántos matriculados hay, cifra anual?", CAMPUSES));
    expect(points.map(cutText)).toEqual(["2024", "2023"]);
    expect(points.every((p) => p.c === "" && p.t === null)).toBe(true);
    expect(reading).toBe("anual");
  });

  it("con sede y periodo: esa cifra exacta", () => {
    const { points } = pickCuts(matriculados, parseSlots("matriculados en Cúcuta 2023-2", CAMPUSES));
    expect(points).toEqual([point(2023, "B", "Cúcuta", 3210)]);
  });

  it("por sede: el periodo más reciente, cada sede", () => {
    const { points } = pickCuts(matriculados, parseSlots("matriculados por sede", CAMPUSES));
    expect(points.map((p) => p.c)).toEqual(["Cúcuta", "Bucaramanga"]);
    expect(points.every((p) => p.y === 2024 && p.t === "B")).toBe(true);
    // Y si se pide la del año, la del año de cada sede.
    const year = pickCuts(matriculados, parseSlots("matriculados por sede, anual", CAMPUSES)).points;
    expect(year.map((p) => [p.c, cutText(p)])).toEqual([["Cúcuta", "2024"], ["Bucaramanga", "2024"]]);
  });

  it("lo pedido que no está no es un cero", () => {
    const { points, missing } = pickCuts(matriculados, parseSlots("matriculados en Valledupar en 2019", CAMPUSES));
    expect(points).toEqual([]);
    expect(missing).toEqual(["2019", "Valledupar"]);
    expect(dataAnswer(matriculados, points, missing)).toMatch(/no tiene cifra publicada para 2019, Valledupar: un dato sin reportar no es un cero/);
  });

  it("escribe las cifras como el portal", () => {
    expect(figureText(20500, "entero", "estudiantes")).toBe("20.500 estudiantes");
    expect(figureText(12.345, "porcentaje", "%")).toBe("12,3 %");
    expect(figureText(3.25, "decimal", "")).toBe("3,3");
  });

  it("el pasaje trae cada número que dirá la respuesta, y se verifica", () => {
    const cuts = pickCuts(matriculados, parseSlots("matriculados en Cúcuta en todo 2024", CAMPUSES));
    const { points, missing } = cuts;
    const passage = factPassage(matriculados, points, missing, cuts);
    expect(passage.ref).toBe("dato:cifras:poblacion:matriculados");
    // La cifra del año se dice como lo que es.
    expect(passage.body).toContain("Lectura anual (cifra del año): Cúcuta, año 2024: 3.400 estudiantes");
    expect(passage.cut).toBe("2024");
    const answer = dataAnswer(matriculados, points, missing, cuts);
    expect(answer).toBe("Según UDES en Cifras, «Matriculados» en Cúcuta fue 3.400 estudiantes en el año 2024 [1].");
    expect(verifyNumbers(answer, passage.body).verified).toBe(true);
    // El modelo puede escribirlo sin punto de miles: es el mismo número.
    expect(verifyNumbers("En Cúcuta hubo 3400 estudiantes.", passage.body).verified).toBe(true);
    expect(numbersIn("3.400")).toEqual(["3400"]);
  });
});

describe("Entender con IA", () => {
  it("lee la pregunta reescrita y sus palabras", () => {
    expect(parseUnderstand('```json\n{"pregunta":"¿Cuántos matriculados hubo en Cúcuta en 2023?","buscar":["matriculados","estudiantes"]}\n```', "¿y en Cúcuta?")).toEqual({
      question: "¿Cuántos matriculados hubo en Cúcuta en 2023?",
      terms: ["matriculados", "estudiantes"],
    });
  });

  it("si no llega JSON, se queda con la pregunta original", () => {
    expect(parseUnderstand("no sé", "¿y en Cúcuta?")).toEqual({ question: "¿y en Cúcuta?", terms: [] });
  });
});

describe("sedes con otro nombre y sin cifras", () => {
  it("«Campus Cúcuta» y «Cúcuta» son la misma sede; el total de la UDES no es una sede", () => {
    expect(sameCampus("Campus Cúcuta", "Cúcuta")).toBe(true);
    expect(sameCampus("UDES Bucaramanga", "bucaramanga")).toBe(true);
    expect(sameCampus("Cúcuta", "Valledupar")).toBe(false);
  });

  it("reconoce todas las sedes de la universidad, aunque no tengan cifras", () => {
    const all = knownCampuses(["Bucaramanga"], ["Campus Bucaramanga", "Cúcuta", "Valledupar"]);
    expect(all).toEqual(["Bucaramanga", "Cúcuta", "Valledupar"]);
    const slots = parseSlots("¿Cuántos matriculados hubo en Cúcuta en 2024?", all);
    expect(slots.campus).toEqual(["Cúcuta"]);
    // Solo Bucaramanga tiene cifras: para Cúcuta se dice que no hay, en vez de dar el total.
    const soloBga: Fact = { ...matriculados, series: [point(2024, null, "", 20500), point(2024, null, "Bucaramanga", 12000)] };
    const { points, missing } = pickCuts(soloBga, slots);
    expect(points).toEqual([]);
    expect(missing).toEqual(["Cúcuta"]);
  });

  it("la sede de la pregunta encuentra la de la serie aunque se escriba distinto", () => {
    const { points } = pickCuts(matriculados, parseSlots("matriculados en el campus de cucuta 2024", ["Campus Cúcuta"]));
    expect(points).toEqual([point(2024, "B", "Cúcuta", 3400), point(2024, "A", "Cúcuta", 3350)]);
  });
});

describe("Pilo conversa: entiende el contexto y no evade", () => {
  const history = [{ q: "¿Cuántos estudiantes matriculados hubo en Bucaramanga en 2024?", a: "En Bucaramanga hubo 17.476 estudiantes matriculados en 2024 [1]." }];

  it("al entender, cambia solo lo que ahora se pide", () => {
    const text = buildUnderstandMessages("¿y en Cúcuta?", history).map((m) => m.content).join(" ");
    expect(text).toContain("cambiando solo lo que ahora se pide");
    expect(text).toContain("17.476");
    expect(text).toContain("Pregunta: ¿y en Cúcuta?");
  });

  // 0110: la conversación va como turnos reales (usuario y asistente), no como texto dentro del pedido.
  it("al redactar, responde en el contexto y da lo que hay sin evadir", () => {
    const messages = buildAskMessages(planAsk({ official: [], saved: null, facts: [], passages: [] }), { question: "¿Cuántos estudiantes matriculados hubo en Cúcuta en 2024?", history });
    expect(messages[0].content).toContain("respóndela en ese contexto");
    expect(messages[0].content).toContain("No evadas");
    expect(messages.slice(1).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    // La cita de la respuesta anterior es de otra numeración: no pasa.
    expect(messages[2].content).toBe("En Bucaramanga hubo 17.476 estudiantes matriculados en 2024.");
  });
});
