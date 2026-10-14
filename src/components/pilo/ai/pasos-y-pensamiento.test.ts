/* =============================================================================
   Lo que Pilo va haciendo y pensando mientras responde: el detalle de cada
   paso (`step`), la cuenta de los pasos, el razonamiento que el modelo manda
   aparte (`thinking`) y sus filtros. Todo sin red ni base.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  GENERAL_NOTE,
  NO_RESULTS,
  STEP_LABEL,
  THINKING_KEEP,
  THINKING_MAX,
  UNPUBLISHED_NOTE,
  buildAskMessages,
  cleanDraft,
  countText,
  createChatReader,
  createStepLog,
  finishAnswer,
  numbersIn,
  planAsk,
  readChatChunk,
  stepDetail,
  streamVisible,
  thinkingBlocked,
  thinkingOf,
  thinkingVisible,
} from "./logic";
import type { MoneyContext, Passage, StepId } from "./logic";

const ctx: MoneyContext = { institutional: true, known: new Set(numbersIn("20.500 estudiantes en 2024")) };
const delta = (d: Record<string, unknown>) => `data: ${JSON.stringify({ choices: [{ delta: d }] })}\n\n`;

describe("el detalle de cada paso", () => {
  it("cuenta en singular y en plural", () => {
    expect(countText(1, "pasaje", "pasajes")).toBe("1 pasaje");
    expect(countText(5, "pasaje", "pasajes")).toBe("5 pasajes");
    expect(stepDetail({ id: "memoria", count: 1 })).toBe("1 pasaje");
    expect(stepDetail({ id: "memoria", count: 5 })).toBe("5 pasajes");
    expect(stepDetail({ id: "catalogo", count: 1 })).toBe("1 respuesta oficial");
    expect(stepDetail({ id: "catalogo", count: 2 })).toBe("2 respuestas oficiales");
    expect(stepDetail({ id: "guardadas", count: 1 })).toBe("1 respuesta anterior");
    expect(stepDetail({ id: "cifras", count: 2, title: "Permanencia", cut: "2024" })).toBe("2 cifras de Permanencia 2024");
    expect(stepDetail({ id: "cifras", count: 1, title: "Estudiantes matriculados" })).toBe("1 cifra de Estudiantes matriculados");
  });

  it("sin nada, dice «sin resultados»", () => {
    for (const id of ["catalogo", "guardadas", "memoria"] as const) expect(stepDetail({ id, count: 0 })).toBe(NO_RESULTS);
    expect(stepDetail({ id: "cifras", count: 0, title: "Permanencia", cut: "2024" })).toBe(NO_RESULTS);
  });

  it("dice lo que entendió: la sede, el año, el periodo o que sigue la conversación", () => {
    const base = { id: "entender" as const, intent: "institucional" as const, follow: false, campus: [] as string[], byCampus: false, years: [] as number[], term: null };
    expect(stepDetail(base)).toBe("pregunta sobre la UDES");
    expect(stepDetail({ ...base, campus: ["Cúcuta"], years: [2024] })).toBe("pregunta sobre la UDES · sede Cúcuta · año 2024");
    expect(stepDetail({ ...base, follow: true, campus: ["Cúcuta", "Bucaramanga"], years: [2023, 2024], term: "B" })).toBe("sigue la conversación · sedes Cúcuta y Bucaramanga · años 2023 y 2024 · periodo 2");
    expect(stepDetail({ ...base, byCampus: true, term: "A" })).toBe("pregunta sobre la UDES · todas las sedes · periodo 1");
    expect(stepDetail({ ...base, intent: "general" })).toBe("tema general");
    expect(stepDetail({ ...base, intent: "saludo" })).toBe("es un saludo");
    expect(stepDetail({ ...base, intent: "charla" })).toBe("es conversación");
  });

  it("al redactar dice con qué, o que no hay datos de la UDES", () => {
    const base = { id: "redactar" as const, intent: "institucional" as const, official: 0, saved: false, facts: 0, passages: 0 };
    expect(stepDetail({ ...base, official: 1, facts: 2, passages: 3 })).toBe("con 1 respuesta oficial, 2 indicadores y 3 pasajes");
    expect(stepDetail({ ...base, saved: true, passages: 1 })).toBe("con 1 respuesta anterior y 1 pasaje");
    expect(stepDetail({ ...base, facts: 1 })).toBe("con 1 indicador");
    expect(stepDetail({ ...base, intent: "general" })).toBe(GENERAL_NOTE);
    expect(GENERAL_NOTE).toBe("No hay datos de la UDES sobre esto; respondo con conocimiento general");
    expect(stepDetail(base)).toBe(UNPUBLISHED_NOTE);
    expect(stepDetail({ ...base, intent: "saludo" })).toBe("");
    expect(stepDetail({ ...base, passages: 3, failed: true })).toBe("el modelo no respondió");
  });

  it("al verificar dice si cada número está en las fuentes", () => {
    expect(stepDetail({ id: "verificar", grounding: "oficial", verified: true, unknown: 0 })).toBe("cada número está en las fuentes");
    expect(stepDetail({ id: "verificar", grounding: "mixta", verified: false, unknown: 1 })).toBe("1 número por revisar");
    expect(stepDetail({ id: "verificar", grounding: "oficial", verified: false, unknown: 3 })).toBe("3 números por revisar");
    expect(stepDetail({ id: "verificar", grounding: "general", verified: true, unknown: 0 })).toBe("sin cifras de la UDES que verificar");
  });

  it("nunca deja pasar dinero, datos de personas ni nombres larguísimos", () => {
    // Un indicador de dinero o con un dato personal en el nombre: queda la cuenta, sin el nombre.
    for (const title of ["Presupuesto de inversión", "Ingresos por $ 1.200 millones", "Salario docente", "Contacto: ana@udes.edu.co", "Cédula 1098765432", "Recaudo de 300 millones de pesos"]) {
      expect(stepDetail({ id: "cifras", count: 2, title, cut: "2024" })).toBe("2 cifras");
    }
    expect(stepDetail({ id: "cifras", count: 1, title: "Permanencia", cut: "$ 500" })).toBe("1 cifra de Permanencia");
    const long = stepDetail({ id: "cifras", count: 1, title: "Tasa de permanencia ".repeat(10) });
    expect(long.length).toBeLessThanOrEqual("1 cifra de ".length + 60);
    expect(long.endsWith("…")).toBe(true);
    expect(stepDetail({ id: "entender", intent: "institucional", follow: false, campus: ["Cúcuta", "tel 3001234567"], byCampus: false, years: [], term: null })).toBe("pregunta sobre la UDES · sede Cúcuta");
    // Las etiquetas son las de la página, en español.
    expect(STEP_LABEL).toEqual({
      entender: "Entendiendo la pregunta",
      catalogo: "Revisando las respuestas oficiales",
      guardadas: "Recordando respuestas anteriores",
      cifras: "Consultando las cifras",
      memoria: "Buscando en lo que conozco",
      redactar: "Redactando la respuesta",
      verificar: "Verificando las cifras",
    });
  });
});

describe("la cuenta de los pasos", () => {
  it("cada paso empieza una vez y termina una vez, y queda en el resumen", () => {
    let t = 1000;
    const log = createStepLog(() => t);
    expect(log.start("entender")).toEqual({ id: "entender", label: "Entendiendo la pregunta", state: "start" });
    expect(log.start("entender")).toBeNull();
    t += 5;
    expect(log.done("entender", "pregunta sobre la UDES")).toEqual({ id: "entender", label: "Entendiendo la pregunta", detail: "pregunta sobre la UDES", state: "done" });
    expect(log.done("entender")).toBeNull();
    expect(log.done("cifras", "2 cifras")).toBeNull();
    // Los que corren a la par terminan en el orden real.
    log.start("catalogo");
    log.start("memoria");
    t += 300;
    log.done("memoria", "5 pasajes");
    t += 200;
    log.done("catalogo", NO_RESULTS);
    expect(log.start("redactar", "con 5 pasajes")).toEqual({ id: "redactar", label: "Redactando la respuesta", detail: "con 5 pasajes", state: "start" });
    t += 8000;
    // Lo que quedó abierto se cierra, con el detalle con que empezó.
    expect(log.closeAll()).toEqual([{ id: "redactar", label: "Redactando la respuesta", detail: "con 5 pasajes", state: "done" }]);
    expect(log.closeAll()).toEqual([]);
    expect(log.summary()).toEqual({
      steps: [
        { id: "entender", label: "Entendiendo la pregunta", detail: "pregunta sobre la UDES", ms: 5 },
        { id: "memoria", label: "Buscando en lo que conozco", detail: "5 pasajes", ms: 300 },
        { id: "catalogo", label: "Revisando las respuestas oficiales", detail: NO_RESULTS, ms: 500 },
        { id: "redactar", label: "Redactando la respuesta", detail: "con 5 pasajes", ms: 8000 },
      ],
      seconds: 8.5,
    });
  });

  it("un paso sin detalle no lleva el campo", () => {
    const log = createStepLog(() => 0);
    log.start("verificar" as StepId);
    expect(log.done("verificar")).toEqual({ id: "verificar", label: "Verificando las cifras", state: "done" });
    expect(log.summary().steps[0]).toEqual({ id: "verificar", label: "Verificando las cifras", ms: 0 });
  });
});

describe("el razonamiento que el modelo manda aparte", () => {
  it("se lee de reasoning_content o de reasoning, sin mezclarse con el texto", () => {
    expect(readChatChunk(JSON.stringify({ choices: [{ delta: { reasoning_content: "pienso…" } }] }))).toMatchObject({ text: "", reasoning: true, thinking: "pienso…" });
    expect(readChatChunk(JSON.stringify({ choices: [{ delta: { reasoning: "pienso…" } }] }))).toMatchObject({ text: "", reasoning: true, thinking: "pienso…" });
    expect(readChatChunk(JSON.stringify({ choices: [{ delta: { content: "Hola" } }] }))).toMatchObject({ text: "Hola", reasoning: false, thinking: "" });
    expect(readChatChunk(JSON.stringify({ choices: [{ message: { content: "Hola", reasoning_content: "antes pensé" } }] }))).toMatchObject({ text: "Hola", thinking: "antes pensé" });
  });

  it("el lector lo junta por su lado, partido entre trozos, y lo corta cuando empieza la respuesta", () => {
    const reader = createChatReader();
    const whole = [delta({ reasoning_content: "Busco la " }), delta({ reasoning_content: "cifra. " }), delta({ content: "En 2024 " }), delta({ reasoning_content: "tarde" }), delta({ content: "hubo 20.500." }), "data: [DONE]\n\n"].join("");
    let text = "";
    const seen: string[] = [];
    for (let i = 0; i < whole.length; i += 23) {
      text += reader.push(whole.slice(i, i + 23));
      seen.push(reader.thinking());
    }
    expect(text).toBe("En 2024 hubo 20.500.");
    expect(reader.thinking()).toBe("Busco la cifra. ");
    // Crece sin desdecirse.
    for (let i = 1; i < seen.length; i++) expect(seen[i].startsWith(seen[i - 1])).toBe(true);
    expect(reader.end()).toMatchObject({ text: "En 2024 hubo 20.500.", thinking: "Busco la cifra. ", reasoning: true, streamed: true });
  });

  it("sin razonamiento queda vacío, y con el JSON entero también se lee", () => {
    const none = createChatReader();
    none.push(delta({ content: "Hola." }));
    expect(none.thinking()).toBe("");
    expect(none.end()).toMatchObject({ text: "Hola.", thinking: "", reasoning: false });
    const whole = createChatReader();
    whole.push(JSON.stringify({ choices: [{ message: { content: "Hola.", reasoning_content: "Saludo corto." }, finish_reason: "stop" }] }));
    expect(whole.end()).toMatchObject({ text: "Hola.", thinking: "Saludo corto.", streamed: false });
    expect(whole.thinking()).toBe("Saludo corto.");
  });

  it("guarda con tope aunque el modelo piense muchísimo", () => {
    const reader = createChatReader();
    for (let i = 0; i < 40; i++) reader.push(delta({ reasoning_content: "x".repeat(1000) }));
    expect(reader.thinking().length).toBe(THINKING_KEEP);
  });
});

describe("el razonamiento entre <think> y </think>", () => {
  it("sale completo cuando el bloque está cerrado y no deja nada en el texto", () => {
    const raw = "<think>Busco la cifra. Está en la fuente 1.</think>En 2024 hubo 20.500 [1].";
    expect(thinkingOf(raw)).toBe("Busco la cifra. Está en la fuente 1.");
    expect(cleanDraft(raw)).toBe("En 2024 hubo 20.500 [1].");
    expect(thinkingOf("<thinking>\nVeamos.\n</thinking>Hola.")).toBe("Veamos.\n");
    expect(thinkingOf("Hola, sin pensar.")).toBe("");
    expect(thinkingOf("a < b y c > d")).toBe("");
  });

  it("partido entre trozos crece sin desdecirse y nunca muestra una etiqueta a medias", () => {
    const raw = "<think>Busco la cifra. Está en la fuente 1.</think>En 2024 hubo 20.500 [1]. Listo.";
    let before = "";
    for (let i = 1; i <= raw.length; i++) {
      const now = thinkingOf(raw.slice(0, i), false);
      expect(now.startsWith(before)).toBe(true);
      expect(now).not.toMatch(/[<>]/);
      before = now;
      // Y la respuesta visible nunca trae nada del razonamiento.
      expect(streamVisible(raw.slice(0, i), false, ctx)).not.toContain("Busco");
    }
    expect(before).toBe("Busco la cifra. Está en la fuente 1.");
    // Un bloque que no llegó a cerrarse: a medio camino y al final, lo que haya.
    expect(thinkingOf("<think>Busco la cifra. Y lue", false)).toBe("Busco la cifra. Y lue");
    expect(thinkingOf("<think>Busco la cifra.</thi", false)).toBe("Busco la cifra.");
    expect(thinkingOf("<think>Busco la cifra.</thi", true)).toBe("Busco la cifra.</thi");
  });
});

describe("los filtros del razonamiento", () => {
  it("solo salen frases completas, y con `final` también la última", () => {
    expect(thinkingVisible("Busco la cifra. Está en la fu", false, ctx)).toBe("Busco la cifra. ");
    expect(thinkingVisible("Busco la cifra. Está en la fu", true, ctx)).toBe("Busco la cifra. Está en la fu");
    expect(thinkingVisible("", true, ctx)).toBe("");
    expect(thinkingVisible("<think>Veamos. </think>", true, ctx)).toBe("Veamos. ");
  });

  it("no deja pasar dinero que no esté publicado, aunque no nombre a la universidad", () => {
    expect(thinkingBlocked("El presupuesto es de $ 5.000.000.000.", ctx)).toBe(true);
    expect(thinkingBlocked("Serían unos 300 millones de pesos.", ctx)).toBe(true);
    expect(thinkingBlocked("Cuesta USD 1200 al año.", ctx)).toBe(true);
    expect(thinkingBlocked("Hubo 20.500 estudiantes en 2024.", ctx)).toBe(false);
    const out = thinkingVisible("Miro la fuente. El presupuesto es de $ 5.000.000.000. Respondo sin esa cifra. ", true, ctx);
    expect(out).toBe("Miro la fuente. Respondo sin esa cifra. ");
    // Un valor en pesos que sí está en las fuentes se puede decir.
    expect(thinkingBlocked("La matrícula publicada es de $ 20.500.", ctx)).toBe(false);
  });

  it("no deja pasar datos de personas ni las marcas del pedido", () => {
    for (const s of [
      "Su correo es ana.perez@udes.edu.co.",
      "El teléfono es 300 123 4567.",
      "La cédula del rector es conocida.",
      "Su documento de identidad no se da.",
      "El número 1.098.765.432 parece un documento.",
      "Llamar al 3001234567.",
      "Entre <<<DATOS y DATOS>>> está la fuente.",
      "El bloque [OFICIAL] dice otra cosa.",
      "En [pasajes] no hay nada.",
    ]) {
      expect(thinkingBlocked(s, ctx), s).toBe(true);
    }
    for (const s of ["La fuente 1 trae la cifra de 2024.", "Son 20.500 estudiantes.", "No hay datos; respondo en general.", "El periodo 2023-2024 no está."]) {
      expect(thinkingBlocked(s, ctx), s).toBe(false);
    }
  });

  it("tiene tope: pasado, no muestra más y lo ya mostrado no cambia", () => {
    const sentence = "Reviso otra vez la misma fuente con cuidado. ";
    const raw = sentence.repeat(200);
    const out = thinkingVisible(raw, true, ctx);
    expect(out.length).toBeLessThanOrEqual(THINKING_MAX);
    expect(out.length).toBeGreaterThan(THINKING_MAX - sentence.length);
    let before = "";
    for (let i = 0; i <= raw.length; i += 97) {
      const now = thinkingVisible(raw.slice(0, i), false, ctx);
      expect(now.startsWith(before)).toBe(true);
      expect(now.length).toBeLessThanOrEqual(THINKING_MAX);
      before = now;
    }
    // Una sola frase más larga que el tope sale recortada, no entera.
    const one = thinkingVisible("palabra ".repeat(400), true, ctx);
    expect(one.length).toBeLessThanOrEqual(THINKING_MAX);
    expect(one.endsWith("…")).toBe(true);
    expect(thinkingVisible("Corto. ", true, ctx, 3)).toBe("Co…");
  });
});

describe("el razonamiento no toca la respuesta", () => {
  const source: Passage = { ref: "cifras:matriculados", source: "cifras", title: "Estudiantes matriculados", section: "Población", body: "En 2024 hubo 20.500 estudiantes matriculados.", path: "/cifras", cut: "2024", office: "Registro" };

  it("los números del razonamiento no entran en la revisión de cifras", () => {
    const fin = finishAnswer("<think>Quizá eran 99.999, pero la fuente dice otra cosa.</think>En 2024 hubo 20.500 estudiantes [1].", [source], { question: "¿Cuántos estudiantes hay?", intent: "institucional" });
    expect(fin).toMatchObject({ text: "En 2024 hubo 20.500 estudiantes [1].", verified: true, unknown: [] });
  });

  it("el pedido pide razonar en español y breve, sin pedir pensamientos en la respuesta", () => {
    const system = buildAskMessages(planAsk({ official: [], saved: null, facts: [], passages: [source] }), { question: "¿Cuántos estudiantes hay?" })[0].content;
    expect(system).toContain("9. Si antes de responder razonas aparte, hazlo en español y con brevedad.");
    expect(system).toContain("en la respuesta no cuentes cómo pensaste");
    expect(system).not.toMatch(/<think>|piensa paso a paso/i);
  });
});
