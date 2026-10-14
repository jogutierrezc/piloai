import { afterEach, describe, expect, it, vi } from "vitest";
import { askBody, askHttpError, askQuestionStream, audioKey, rateBody, voiceBody } from "./client";
import { parseSpaces } from "./config";

const HISTORY = [{ q: "¿Qué es el aprendizaje activo?", a: "Es aprender haciendo." }];

describe("el pedido de «preguntar»: portal y rol (0113)", () => {
  it("sin opciones es, byte a byte, el de siempre", () => {
    const before = JSON.stringify({ action: "preguntar", portal: "pregunta", question: "¿Cuántos estudiantes hay?", history: HISTORY, stream: true });
    expect(JSON.stringify(askBody("¿Cuántos estudiantes hay?", HISTORY))).toBe(before);
    expect(JSON.stringify(askBody("¿Cuántos estudiantes hay?", HISTORY, {}))).toBe(before);
    // Sin cuenta y sin preferencias de visitante (0120), tampoco cambia.
    expect(JSON.stringify(askBody("¿Cuántos estudiantes hay?", HISTORY, { visitor: null }))).toBe(before);
  });

  it("en Enseñanza lleva su portal y el rol de quien pregunta", () => {
    expect(askBody("¿Cómo me evalúan?", [], { portal: "ensenanza", rol: "estudiante" })).toEqual({ action: "preguntar", portal: "ensenanza", question: "¿Cómo me evalúan?", history: [], stream: true, rol: "estudiante" });
    expect(askBody("¿Cómo evalúo?", [], { portal: "ensenanza", rol: "profesor" })).toMatchObject({ portal: "ensenanza", rol: "profesor" });
  });

  it("«general», vacío o cualquier otra cosa no se manda: el servidor entiende «general»", () => {
    for (const rol of ["general", "", null, undefined, "admin", "Estudiante"]) {
      const body = askBody("¿Qué es una rúbrica?", [], { portal: "ensenanza", rol });
      expect(body.portal).toBe("ensenanza");
      expect("rol" in body).toBe(false);
    }
  });

  it("nunca manda un campo `space`: el espacio sale del portal", () => {
    expect("space" in askBody("x", [], { portal: "ensenanza", rol: "profesor" })).toBe(false);
  });
});

describe("askQuestionStream: lo que de verdad sale por la red", () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = { kind: "ia", text: "Listo.", sources: [], trail: [], rol: "profesor", expression: "graduado", mood: "atento" };
  const stubFetch = () => {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) as Record<string, unknown> });
      return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
    });
    return calls;
  };

  it("quien llama como siempre pregunta a «pregunta», sin rol", async () => {
    const calls = stubFetch();
    await askQuestionStream("¿Cuántos estudiantes hay?", HISTORY, {});
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toMatch(/\/functions\/v1\/pilo-ia$/);
    expect(calls[0].body).toEqual({ action: "preguntar", portal: "pregunta", question: "¿Cuántos estudiantes hay?", history: HISTORY, stream: true });
  });

  it("con opciones, el cuerpo lleva `portal: ensenanza` y `rol`, y la respuesta trae rol, cara y ánimo", async () => {
    const calls = stubFetch();
    const result = await askQuestionStream("¿Cómo evalúo por resultados?", [], {}, { portal: "ensenanza", rol: "profesor" });
    expect(calls[0].body).toEqual({ action: "preguntar", portal: "ensenanza", question: "¿Cómo evalúo por resultados?", history: [], stream: true, rol: "profesor" });
    expect(result).toMatchObject({ rol: "profesor", expression: "graduado", mood: "atento" });
  });
});

describe("calificar y voz con portal y rol", () => {
  it("calificar sin opciones es el de siempre", () => {
    expect(rateBody({ answerId: 7, vote: "down", question: "q", text: "t", kind: "ia" })).toEqual({ action: "calificar", portal: "pregunta", answerId: 7, vote: "down", question: "q", text: "t", kind: "ia" });
  });

  it("calificar en Enseñanza lleva portal y rol", () => {
    expect(rateBody({ answerId: null, vote: "down", question: "q", text: "t", kind: "ia", portal: "ensenanza", rol: "estudiante" })).toEqual({
      action: "calificar",
      portal: "ensenanza",
      answerId: undefined,
      vote: "down",
      question: "q",
      text: "t",
      kind: "ia",
      rol: "estudiante",
    });
    expect("rol" in rateBody({ vote: "down", question: "q", text: "t", kind: "ia", portal: "ensenanza", rol: "general" })).toBe(false);
  });

  it("la voz lleva el rol solo cuando lo hay", () => {
    expect(voiceBody("Hola.", "pregunta")).toEqual({ action: "voz", portal: "pregunta", text: "Hola.", style: undefined });
    expect(voiceBody("Hola.", "ensenanza", undefined, "profesor")).toEqual({ action: "voz", portal: "ensenanza", text: "Hola.", style: undefined, rol: "profesor" });
    expect("rol" in voiceBody("Hola.", "ensenanza", undefined, "general")).toBe(false);
  });

  it("el audio guardado se separa por rol; sin rol, la llave es la de siempre", () => {
    expect(audioKey("Hola.", "pregunta")).toBe("pregunta||Hola.");
    expect(audioKey("Hola.", "prueba", "calmo")).toBe("prueba|calmo|Hola.");
    const student = audioKey("Hola.", "ensenanza", undefined, "estudiante");
    const teacher = audioKey("Hola.", "ensenanza", undefined, "profesor");
    expect(student).not.toBe(teacher);
    expect(student).not.toBe(audioKey("Hola.", "ensenanza"));
    expect(audioKey("Hola.", "ensenanza", undefined, "general")).toBe(audioKey("Hola.", "ensenanza"));
  });
});

describe("sin la migración 0113", () => {
  it("el error del servidor se dice con franqueza y con su código", () => {
    const e = askHttpError(500, { error: "Falta la migración 0113 de los espacios de Mr. Pilo.", advice: "Aplique la migración.", code: "migracion", detail: "…" });
    expect(e.code).toBe("migracion");
    expect(e.message).toMatch(/migración 0113/);
    expect(e.message).toMatch(/No es un problema de su pregunta/);
  });

  it("los demás errores se leen como siempre", () => {
    expect(askHttpError(500, null).code).toBe("interno");
    expect(askHttpError(403, null).message).toBe("Pregúntele a Pilo no está abierto para usted en este momento.");
    expect(askHttpError(429, { error: "Va muy rápido.", code: "visitante", retry_after: 30 })).toMatchObject({ code: "visitante", retryAfter: 30 });
  });
});

describe("parseSpaces: `spaces` de la configuración pública", () => {
  const raw = {
    ensenanza: {
      on: true,
      aud: "publico",
      welcome: true,
      ai: true,
      name: "Mr. Pilo en Enseñanza",
      greeting: "  Hola,   soy Pilo. ",
      ask_rol: true,
      roles: {
        estudiante: { suggestions: ["¿Cómo estudio?", 7, "  "], expression: "feliz", mood: "emocionado" },
        profesor: { suggestions: [], expression: "graduado", mood: "atento" },
      },
      sources: { innovacion: true, politicas: true, global: false, moodle: "sí" },
      widget: { on: true, origins: ["https://www.udes.edu.co", 3] },
    },
  };

  it("lee la ficha tal como la manda 0113", () => {
    expect(parseSpaces(raw).ensenanza).toEqual({
      on: true,
      aud: "publico",
      welcome: true,
      ai: true,
      name: "Mr. Pilo en Enseñanza",
      greeting: "Hola, soy Pilo.",
      askRol: true,
      roles: {
        estudiante: { suggestions: ["¿Cómo estudio?"], expression: "feliz", mood: "emocionado" },
        profesor: { suggestions: [], expression: "graduado", mood: "atento" },
      },
      sources: { innovacion: true, politicas: true, global: false, moodle: false },
      widget: { on: true, origins: ["https://www.udes.edu.co"] },
    });
  });

  it("lo que falta queda cerrado: apagado, solo administración, sin chat en otros portales", () => {
    expect(parseSpaces({ ensenanza: {} }).ensenanza).toMatchObject({ on: false, aud: "admin", ai: false, askRol: true, widget: { on: false, origins: [] }, sources: {} });
    expect(parseSpaces({ ensenanza: { roles: { estudiante: { expression: "<b>x</b>", mood: "Muy Feliz" } } } }).ensenanza.roles.estudiante).toEqual({ suggestions: [], expression: "", mood: "" });
  });

  it("sin la migración no hay espacios", () => {
    expect(parseSpaces(undefined)).toEqual({});
    expect(parseSpaces(null)).toEqual({});
    expect(parseSpaces([])).toEqual({});
    expect(parseSpaces({ "No Válido": { on: true } })).toEqual({});
  });
});
