/* Pilo lee las cifras por periodo académico y cierra con un resumen calculado
   en el servidor: cómo entiende un periodo, qué cortes elige, cómo compara dos
   periodos y por qué un cálculo del resumen no dispara «revise las cifras». */
import { describe, expect, it } from "vitest";
import {
  NOTE_ANNUAL_ONLY,
  NOTE_NO_ANNUAL,
  ASK_FIGURES_RULE,
  buildAskMessages,
  changeText,
  cutText,
  dataAnswer,
  factPassage,
  factSummary,
  figureChange,
  finishAnswer,
  followChain,
  hasSlots,
  isFollowUp,
  mergeSlots,
  parseSlots,
  pickCuts,
  planAsk,
  previousTerm,
  sameCut,
  stepDetail,
  termOn,
  verifyNumbers,
} from "./logic";
import type { Fact, FactPoint } from "./logic";

const CAMPUSES = ["Bucaramanga", "Cúcuta", "Valledupar"];
const slots = (q: string) => parseSlots(q, CAMPUSES);
const point = (y: number, t: "A" | "B" | null, c: string, v: number, k?: FactPoint["k"]): FactPoint => (k ? { y, t, c, v, k } : { y, t, c, v });

/** Un indicador que se reporta por periodo; la cifra del año es la del último periodo reportado. */
const matriculados: Fact = {
  ref: "cifras:poblacion:matriculados",
  report: "Población estudiantil",
  label: "Matriculados",
  unit: "estudiantes",
  format: "entero",
  definition: "Estudiantes con matrícula en el periodo.",
  office: "Registro y Control",
  path: "/datos-abiertos/poblacion",
  period: "2020–2025",
  illustrative: false,
  series: [
    point(2023, null, "", 19800, "p2"),
    point(2023, "A", "", 19000),
    point(2023, "B", "", 19800),
    point(2024, null, "", 20500, "p2"),
    point(2024, "A", "", 20100),
    point(2024, "B", "", 20500),
    point(2025, null, "", 20900, "p1"),
    point(2025, "A", "", 20900),
    point(2024, "B", "Bucaramanga", 12000),
    point(2025, "A", "Bucaramanga", 12300),
    point(2024, "B", "Cúcuta", 3400),
    point(2025, "A", "Cúcuta", 3350),
    point(2024, "B", "Valledupar", 5100),
  ],
};

/** Una tasa: sus cambios se dicen en puntos porcentuales. */
const permanencia: Fact = {
  ...matriculados,
  ref: "cifras:permanencia:tasa",
  label: "Tasa de permanencia",
  unit: "%",
  format: "porcentaje",
  series: [point(2024, "A", "", 87.1), point(2024, "B", "", 88.3), point(2025, "A", "", 88.3), point(2024, null, "", 87.7, "promedio")],
};

/** Un indicador que solo se reporta por año. */
const programas: Fact = { ...matriculados, ref: "cifras:oferta:programas", label: "Programas activos", unit: "programas", series: [point(2023, null, "", 98), point(2024, null, "", 104)] };

const OCT_2026 = new Date(2026, 9, 2);

describe("Pilo entiende el periodo como la gente lo escribe", () => {
  it.each([
    ["matriculados en 2025-1", [2025], "A"],
    ["matriculados en 2025-01", [2025], "A"],
    ["matriculados 2025 I", [2025], "A"],
    ["matriculados 2025-II", [2025], "B"],
    ["matriculados 2024B", [2024], "B"],
    ["matriculados 2024b", [2024], "B"],
    ["matriculados 2024A", [2024], "A"],
    ["matriculados en el primer periodo", [], "A"],
    ["matriculados en el primer semestre de 2025", [2025], "A"],
    ["matriculados del 1er periodo de 2025", [2025], "A"],
    ["matriculados periodo 2", [], "B"],
    ["matriculados en el periodo académico 2 de 2024", [2024], "B"],
    ["matriculados en el segundo semestre", [], "B"],
    ["matriculados II semestre 2024", [2024], "B"],
    ["¿y en el segundo?", [], "B"],
    ["¿y en el primero?", [], "A"],
  ] as const)("«%s»", (question, years, term) => {
    expect(slots(question)).toMatchObject({ years, term });
  });

  it("un periodo sin número: el que está en curso, el pasado y el último", () => {
    expect(slots("¿cuántos matriculados hay este periodo?")).toMatchObject({ term: null, rel: "actual" });
    expect(slots("matriculados en el semestre actual")).toMatchObject({ rel: "actual" });
    expect(slots("matriculados el periodo pasado")).toMatchObject({ rel: "anterior" });
    expect(slots("matriculados del semestre anterior")).toMatchObject({ rel: "anterior" });
    expect(slots("matriculados en el último periodo")).toMatchObject({ rel: "ultimo" });
    expect(slots("matriculados en el periodo más reciente")).toMatchObject({ rel: "ultimo" });
    expect(hasSlots(slots("¿y el periodo pasado?"))).toBe(true);
    // Un periodo con número manda sobre el que no lo trae.
    expect(slots("matriculados 2024-2, no el periodo pasado")).toEqual({ years: [2024], term: "B", campus: [], byCampus: false });
  });

  it("no ve un periodo donde no lo hay", () => {
    expect(slots("matriculados de 2023 a 2025")).toMatchObject({ years: [2023, 2025], term: null });
    expect(slots("matriculados en 2024")).toEqual({ years: [2024], term: null, campus: [], byCampus: false });
    expect(slots("¿quién ocupó el primero lugar?").term).toBeNull();
    expect(slots("variación periodo a periodo").term).toBeNull();
  });

  it("los dos periodos a la vez no eligen uno: se dan los dos", () => {
    expect(slots("matriculados 2024-1 y 2024-2")).toMatchObject({ years: [2024], term: null, annual: false });
    expect(slots("matriculados del primer y segundo semestre de 2024")).toMatchObject({ term: null, annual: false });
  });

  it("la cifra del año solo cuando se pide", () => {
    for (const q of ["matriculados anual", "matriculados en el año 2024", "matriculados en todo 2024", "matriculados por año", "la cifra del año de matriculados"]) expect(slots(q).annual, q).toBe(true);
    expect(slots("matriculados en 2024").annual).toBeUndefined();
    expect(slots("matriculados por periodo").annual).toBe(false);
    // Un periodo con número manda sobre «del año».
    expect(slots("matriculados del primer semestre del año 2024")).toEqual({ years: [2024], term: "A", campus: [], byCampus: false });
  });

  it("una respuesta guardada del año no sirve para la del periodo", () => {
    expect(sameCut("matriculados 2024", "matriculados en todo 2024", CAMPUSES)).toBe(false);
    expect(sameCut("matriculados 2024-1", "matriculados 2024 I", CAMPUSES)).toBe(true);
    expect(sameCut("matriculados este periodo", "matriculados el periodo pasado", CAMPUSES)).toBe(false);
  });

  it("en la conversación, el periodo nuevo se suma a lo que se venía hablando", () => {
    const before = slots("matriculados en Cúcuta en 2024-1");
    expect(isFollowUp("¿y en el segundo?", CAMPUSES)).toBe(true);
    expect(mergeSlots(before, slots("¿y en el segundo?"))).toEqual({ years: [2024], term: "B", campus: ["Cúcuta"], byCampus: false });
    // «El periodo anterior» se cuenta desde el que se venía hablando.
    expect(mergeSlots(slots("matriculados 2024-2"), slots("¿y el periodo anterior?"))).toMatchObject({ years: [2024], term: "A" });
    expect(mergeSlots(slots("matriculados 2025-1"), slots("¿y el periodo anterior?"))).toMatchObject({ years: [2024], term: "B" });
    // Sin un periodo del que partir, se cuenta desde hoy.
    expect(mergeSlots(slots("matriculados en Cúcuta"), slots("¿y el periodo anterior?"))).toMatchObject({ years: [], term: null, rel: "anterior", campus: ["Cúcuta"] });
    // La lectura del año se conserva al cambiar de sede, hasta que se pida otra.
    const year = mergeSlots(slots("matriculados anual 2024"), slots("¿y en Cúcuta?"));
    expect(year).toMatchObject({ years: [2024], annual: true, campus: ["Cúcuta"] });
    expect(mergeSlots(year, slots("¿y por periodo?"))).toMatchObject({ years: [2024], annual: false });
    expect(mergeSlots(year, slots("¿y en el segundo?"))).toEqual({ years: [2024], term: "B", campus: ["Cúcuta"], byCampus: false });
  });

  it("la cadena de seguimiento lleva el periodo sin IA", () => {
    const chain = followChain("¿y en el segundo?", [{ q: "¿Cuántos matriculados hubo en Cúcuta en 2024-1?", a: "3.350 [1]." }], CAMPUSES);
    expect(chain.slots).toEqual({ years: [2024], term: "B", campus: ["Cúcuta"], byCampus: false });
  });

  it("el periodo en curso sale de la fecha", () => {
    expect(termOn(new Date(2026, 2, 15))).toEqual({ y: 2026, t: "A" });
    expect(termOn(OCT_2026)).toEqual({ y: 2026, t: "B" });
    expect(previousTerm({ y: 2026, t: "B" })).toEqual({ y: 2026, t: "A" });
    expect(previousTerm({ y: 2026, t: "A" })).toEqual({ y: 2025, t: "B" });
  });

  it("los pasos dicen la lectura que se entendió", () => {
    const base = { id: "entender" as const, intent: "institucional" as const, follow: false, campus: [], byCampus: false, years: [], term: null };
    expect(stepDetail({ ...base, rel: "actual" })).toBe("pregunta sobre la UDES · periodo en curso");
    expect(stepDetail({ ...base, years: [2024], annual: true })).toBe("pregunta sobre la UDES · año 2024 · cifra del año");
  });
});

describe("Pilo elige los cortes por periodo", () => {
  const cuts = (q: string, fact = matriculados, today = OCT_2026) => pickCuts(fact, slots(q), 8, today);
  const names = (q: string, fact = matriculados, today = OCT_2026) => cuts(q, fact, today).points.map(cutText);

  it("de partida: el periodo más reciente con dato, el anterior y el mismo del año anterior", () => {
    const c = cuts("¿cuántos matriculados hay?");
    expect(c.points.map(cutText)).toEqual(["2025-1", "2024-2", "2024-1"]);
    expect(c).toMatchObject({ reading: "periodo", missing: [], near: [], notes: [] });
  });

  it("un año sin periodo da sus periodos por separado, no la cifra del año", () => {
    expect(names("matriculados en 2024")).toEqual(["2024-2", "2024-1"]);
    expect(names("matriculados 2024-1 y 2024-2")).toEqual(["2024-2", "2024-1"]);
  });

  it("la cifra del año solo si se pide, y es la del portal con su regla", () => {
    const c = cuts("matriculados en todo 2024");
    expect(c.points).toEqual([point(2024, null, "", 20500, "p2")]);
    expect(c.reading).toBe("anual");
    expect(dataAnswer(matriculados, c.points, c.missing, c)).toBe("Según UDES en Cifras, «Matriculados» en toda la UDES fue 20.500 estudiantes en el año 2024 (la del periodo 2, el último reportado) [1].");
    expect(names("matriculados anual")).toEqual(["2025", "2024"]);
  });

  it("con la memoria de antes (sin regla) la cifra del año se dice sin inventar cómo se calculó", () => {
    const old: Fact = { ...matriculados, series: matriculados.series.map(({ k: _k, ...p }) => p) };
    const c = pickCuts(old, slots("matriculados en todo 2024"), 8, OCT_2026);
    expect(dataAnswer(old, c.points, c.missing, c)).toBe("Según UDES en Cifras, «Matriculados» en toda la UDES fue 20.500 estudiantes en el año 2024 [1].");
    // Y la lectura por periodo no depende de la regla: la memoria vieja ya trae los periodos.
    expect(pickCuts(old, slots("¿cuántos matriculados hay?"), 8, OCT_2026).points.map(cutText)).toEqual(["2025-1", "2024-2", "2024-1"]);
  });

  it("un periodo sin cifra publicada se dice, y se ofrece el más cercano que sí la tiene", () => {
    const c = cuts("matriculados en 2025-2");
    expect(c).toMatchObject({ points: [], missing: ["2025-2"], near: [point(2025, "A", "", 20900)] });
    const answer = dataAnswer(matriculados, c.points, c.missing, c);
    expect(answer).toBe("«Matriculados» no tiene cifra publicada para 2025-2: un dato sin reportar no es un cero. El corte más cercano con cifra es toda la UDES, 2025-1: 20.900 estudiantes [1].");
    expect(factPassage(matriculados, c.points, c.missing, c).body).toContain("El corte más cercano con cifra: toda la UDES, 2025-1: 20.900 estudiantes.");
    // Un año entero sin cifras: el periodo con dato más cercano.
    expect(cuts("matriculados en 2021")).toMatchObject({ points: [], missing: ["2021"], near: [point(2023, "A", "", 19000)] });
  });

  it("«este periodo» y «el periodo pasado» se cuentan desde hoy y se dice cuál es", () => {
    const now = cuts("¿cuántos matriculados hay este periodo?");
    expect(now).toMatchObject({ points: [], missing: ["2026-2"], near: [point(2025, "A", "", 20900)], notes: ["El periodo en curso es 2026-2."] });
    expect(dataAnswer(matriculados, now.points, now.missing, now)).toBe(
      "El periodo en curso es 2026-2. «Matriculados» no tiene cifra publicada para 2026-2: un dato sin reportar no es un cero. El corte más cercano con cifra es toda la UDES, 2025-1: 20.900 estudiantes [1].",
    );
    expect(names("matriculados este periodo", matriculados, new Date(2025, 3, 1))).toEqual(["2025-1"]);
    const past = cuts("matriculados el periodo pasado", matriculados, new Date(2025, 7, 1));
    expect(past.points.map(cutText)).toEqual(["2025-1"]);
    expect(past.notes).toEqual(["El periodo anterior al que está en curso es 2025-1."]);
    // «El último periodo» no depende de la fecha: es el más reciente con dato.
    expect(names("matriculados en el último periodo")[0]).toBe("2025-1");
    expect(names("matriculados en el último periodo de 2024")).toEqual(["2024-2"]);
  });

  it("un periodo sin año: el más reciente y el mismo del año anterior", () => {
    expect(names("matriculados en el segundo semestre")).toEqual(["2024-2", "2023-2"]);
  });

  it("por sede: cada una en el periodo más reciente; la que no lo tiene da su último dato, con su corte", () => {
    const c = cuts("matriculados por sede");
    expect(c.points.map((p) => [p.c, cutText(p)])).toEqual([
      ["Bucaramanga", "2025-1"],
      ["Cúcuta", "2025-1"],
      ["Valledupar", "2024-2"],
    ]);
  });

  it("un indicador que solo se publica por año da la cifra del año, y lo dice", () => {
    const c = cuts("¿cuántos programas activos hay?", programas);
    expect(c.points.map(cutText)).toEqual(["2024", "2023"]);
    expect(c).toMatchObject({ reading: "anual", notes: [NOTE_ANNUAL_ONLY] });
    expect(dataAnswer(programas, c.points, c.missing, c)).toContain("cifra del año: toda la UDES, año 2024: 104 programas; toda la UDES, año 2023: 98 programas [1]. Este indicador se publica por año");
    // Si le piden un periodo, no lo inventa: dice que no lo hay y ofrece la del año.
    const term = cuts("programas activos en 2024-2", programas);
    expect(term).toMatchObject({ points: [], missing: ["2024-2"], near: [point(2024, null, "", 104)], notes: [NOTE_ANNUAL_ONLY] });
    expect(dataAnswer(programas, term.points, term.missing, term)).toBe(
      "Este indicador se publica por año: no tiene cifras por periodo. «Programas activos» no tiene cifra publicada para 2024-2: un dato sin reportar no es un cero. El corte más cercano con cifra es toda la UDES, año 2024: 104 programas [1].",
    );
    expect(cuts("programas activos este periodo", programas)).toMatchObject({ points: [], missing: ["2026-2"], near: [point(2024, null, "", 104)] });
  });

  it("no suma ni promedia: sin cifra del año publicada, van los periodos por separado", () => {
    const soloPeriodos: Fact = { ...matriculados, series: matriculados.series.filter((p) => p.t !== null) };
    const c = pickCuts(soloPeriodos, slots("matriculados en todo 2024"), 8, OCT_2026);
    expect(c.points.map(cutText)).toEqual(["2024-2", "2024-1"]);
    expect(c).toMatchObject({ reading: "periodo", notes: [NOTE_NO_ANNUAL] });
    const answer = dataAnswer(soloPeriodos, c.points, c.missing, c);
    expect(answer).not.toMatch(/40\.600|20\.300/);
    expect(answer).toContain(NOTE_NO_ANNUAL);
  });
});

describe("la comparación entre periodos", () => {
  it("un conteo cambia en valor y en porcentaje", () => {
    expect(figureChange(20900, 20500, "entero", "estudiantes")).toEqual({ diff: 400, pct: 1.95122, share: false });
    expect(changeText(20900, 20500, "entero", "estudiantes")).toBe("subió 400 estudiantes (+2,0 %)");
    expect(changeText(3350, 3400, "entero", "estudiantes")).toBe("bajó 50 estudiantes (-1,5 %)");
    expect(changeText(18.5, 17, "decimal", "estudiantes por docente")).toBe("subió 1,5 estudiantes por docente (+8,8 %)");
  });

  it("un porcentaje cambia en puntos porcentuales, nunca en porcentaje", () => {
    expect(figureChange(88.3, 87.1, "porcentaje", "%")).toEqual({ diff: 1.2, pct: null, share: true });
    expect(changeText(88.3, 87.1, "porcentaje", "%")).toBe("subió 1,2 puntos porcentuales");
    expect(changeText(86.1, 87.1, "decimal", "%")).toBe("bajó 1,0 punto porcentual");
    expect(changeText(88.3, 87.1, "porcentaje", "%")).not.toContain("(");
  });

  it("sin base no hay porcentaje, y lo que no se ve no es un cambio", () => {
    expect(figureChange(5, 0, "entero", "casos").pct).toBeNull();
    expect(changeText(5, 0, "entero", "casos")).toBe("subió 5 casos");
    expect(changeText(100, 100, "entero", "casos")).toBe("sin cambio");
    expect(changeText(88.31, 88.29, "porcentaje", "%")).toBe("sin cambio");
  });
});

describe("el resumen de cifras", () => {
  const today = OCT_2026;

  it("una serie en el tiempo: el dato más reciente y su cambio frente al periodo anterior y al mismo del año anterior", () => {
    const { points } = pickCuts(matriculados, slots("¿cuántos matriculados hay?"), 8, today);
    expect(factSummary(matriculados, points)).toEqual([
      "Dato más reciente, 2025-1: 20.900 estudiantes.",
      "Frente a 2024-2, el periodo anterior: subió 400 estudiantes (+2,0 %).",
      "Frente a 2024-1, el mismo periodo del año anterior: subió 800 estudiantes (+4,0 %).",
    ]);
  });

  it("una tasa: en puntos porcentuales", () => {
    const { points } = pickCuts(permanencia, slots("¿cuál es la tasa de permanencia?"), 8, today);
    expect(factSummary(permanencia, points)).toEqual([
      "Dato más reciente, 2025-1: 88,3 %.",
      "Frente a 2024-2, el periodo anterior: sin cambio.",
      "Frente a 2024-1, el mismo periodo del año anterior: subió 1,2 puntos porcentuales.",
    ]);
  });

  it("varias sedes en un mismo corte: la más alta y la más baja, solo entre las de ese corte", () => {
    const { points } = pickCuts(matriculados, slots("matriculados por sede"), 8, today);
    expect(factSummary(matriculados, points)).toEqual(["Sede con la cifra más alta en 2025-1: Bucaramanga, 12.300 estudiantes.", "Sede con la cifra más baja en 2025-1: Cúcuta, 3.350 estudiantes."]);
  });

  it("no calcula si falta uno de los dos datos, ni mezcla un año con un periodo", () => {
    expect(factSummary(matriculados, [point(2025, "A", "", 20900)])).toEqual([]);
    expect(factSummary(matriculados, [])).toEqual([]);
    expect(factSummary(matriculados, [point(2025, "A", "", 20900), point(2024, null, "", 20500)])).toEqual([]);
    // Años con años.
    expect(factSummary(programas, [point(2024, null, "", 104), point(2023, null, "", 98)])).toEqual(["Dato más reciente, año 2024: 104 programas.", "Frente a año 2023, el año anterior: subió 6 programas (+6,1 %)."]);
    // Dos cortes que no son vecinos: se comparan sin llamarlos «el anterior».
    expect(factSummary(matriculados, [point(2025, "A", "", 20900), point(2023, "B", "", 19800)])[1]).toBe("Frente a 2023-2: subió 1.100 estudiantes (+5,6 %).");
  });

  it("la respuesta de plantilla (sin IA) cierra con el resumen, como lista corta", () => {
    const cuts = pickCuts(matriculados, slots("¿cuántos matriculados hay?"), 8, today);
    expect(dataAnswer(matriculados, cuts.points, cuts.missing, cuts)).toBe(
      [
        "Según UDES en Cifras, «Matriculados», por periodo académico: toda la UDES, 2025-1: 20.900 estudiantes; toda la UDES, 2024-2: 20.500 estudiantes; toda la UDES, 2024-1: 20.100 estudiantes [1].",
        "",
        "**En resumen**",
        "- Dato más reciente, 2025-1: 20.900 estudiantes.",
        "- Frente a 2024-2, el periodo anterior: subió 400 estudiantes (+2,0 %).",
        "- Frente a 2024-1, el mismo periodo del año anterior: subió 800 estudiantes (+4,0 %).",
      ].join("\n"),
    );
    // Una sola cifra no lleva resumen.
    const one = pickCuts(matriculados, slots("matriculados 2024-2"), 8, today);
    expect(dataAnswer(matriculados, one.points, one.missing, one)).toBe("Según UDES en Cifras, «Matriculados» en toda la UDES fue 20.500 estudiantes en 2024-2 [1].");
  });

  it("cada número del resumen está en el pasaje: el verificador lo conoce y no pide revisar", () => {
    const cuts = pickCuts(matriculados, slots("¿cuántos matriculados hay?"), 8, today);
    const passage = factPassage(matriculados, cuts.points, cuts.missing, cuts);
    expect(passage.body).toContain("Lectura por periodo académico, el más reciente primero: toda la UDES, 2025-1: 20.900 estudiantes");
    expect(passage.body).toContain("Resumen calculado con estas cifras");
    expect(passage.cut).toBe("2025-1, 2024-2, 2024-1");
    // La plantilla se verifica contra su propio pasaje.
    expect(verifyNumbers(dataAnswer(matriculados, cuts.points, cuts.missing, cuts), passage.body)).toEqual({ verified: true, unknown: [] });
    // El modelo redacta alrededor con los números del resumen (los escriba como los escriba).
    const good = finishAnswer(
      "En 2025-1 hubo 20.900 estudiantes matriculados [1].\n\n- Frente a 2024-2 subió 400 estudiantes, un 2 % [1].\n- Frente a 2024-1 subió 800 estudiantes (+4,0 %) [1].",
      [passage],
      { question: "¿cuántos matriculados hay?", intent: "institucional" },
    );
    expect(good).toMatchObject({ verified: true, unknown: [], grounding: "oficial" });
    // Un cálculo que el modelo hizo por su cuenta no está en el pasaje: se marca.
    const bad = finishAnswer("En 2025-1 hubo 20.900 estudiantes, un 1,95 % más que en 2024-2 y 41.400 en el año [1].", [passage], { question: "¿cuántos matriculados hay?", intent: "institucional" });
    expect(bad.verified).toBe(false);
    expect(bad.unknown).toEqual(["1.95", "41400"]);
  });

  it("la regla de las cifras solo va al modelo cuando hay cifras", () => {
    const cuts = pickCuts(matriculados, slots("¿cuántos matriculados hay?"), 8, today);
    const passage = factPassage(matriculados, cuts.points, cuts.missing, cuts);
    const withFacts = buildAskMessages(planAsk({ official: [], saved: null, facts: [passage], passages: [] }), { question: "¿cuántos matriculados hay?" })[0].content;
    expect(withFacts).toContain(ASK_FIGURES_RULE);
    expect(withFacts).toContain("Resumen calculado con estas cifras");
    expect(ASK_FIGURES_RULE).toMatch(/Nunca sumes ni promedies periodos/);
    const without = buildAskMessages(planAsk({ official: [], saved: null, facts: [], passages: [] }), { question: "¿qué es el PDI?" })[0].content;
    expect(without).not.toContain("Cómo das las cifras");
  });
});
