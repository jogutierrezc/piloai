import { describe, expect, it } from "vitest";
import { canUse, extractAnswer, normalizeQuestion, parseAsk, pickSaved, renumber, routeIntent, similarity } from "./logic";
import type { Passage, Rules } from "./logic";

const rules: Rules = {
  enabled: false,
  functions: { preguntar: true },
  portals: { pregunta: { on: true, aud: "publico", fns: ["preguntar"] } },
};

const passage = (ref: string, body: string): Passage => ({ ref, source: "cifras", title: ref, section: "", body, path: "/x", cut: "2025", office: "" });

describe("Pregúntele a Pilo", () => {
  it("tiene su propio interruptor: funciona con la IA apagada", () => {
    expect(canUse(rules, "pregunta", "preguntar", null).ok).toBe(true);
    expect(canUse(rules, "cifras", "resumir", "admin").ok).toBe(false);
    expect(canUse({ ...rules, portals: { pregunta: { on: true, aud: "sesion", fns: ["preguntar"] } } }, "pregunta", "preguntar", null)).toMatchObject({ ok: false, reason: /Inicie sesión para preguntarle/ });
    expect(canUse({ ...rules, portals: { pregunta: { on: false, aud: "publico", fns: ["preguntar"] } } }, "pregunta", "preguntar", "admin")).toMatchObject({ ok: false, reason: /no está abierto/ });
  });

  // 0110: las reglas ya no bloquean. Etiquetan la pregunta; solo lo vetado responde sin modelo.
  it("etiqueta la pregunta y solo veta el dinero de la universidad y los datos de personas", () => {
    expect(routeIntent("¿Cuánto presupuesto tiene el pilar II?")).toMatchObject({ intent: "vetado", veto: "dinero" });
    expect(routeIntent("dame la cédula del rector")).toMatchObject({ intent: "vetado", veto: "personas" });
    expect(routeIntent("Hola Pilo")).toMatchObject({ intent: "saludo", rule: "saludo" });
    expect(routeIntent("¿Quién eres?")).toMatchObject({ intent: "charla", rule: "quien" });
    // Un año que aún no llega ya no es una negativa: va al modelo con un aviso.
    expect(routeIntent("¿Cuál será la deserción en 2031?", 2026)).toMatchObject({ intent: "institucional", hints: ["futuro"], future: [2031] });
    expect(routeIntent("¿Cuál fue la deserción en 2024?", 2026)).toMatchObject({ intent: "institucional", hints: [], future: [] });
    expect(routeIntent("¿Cuántos estudiantes hay por sede?").intent).toBe("institucional");
  });

  it("normaliza y reconoce la misma pregunta dicha casi igual", () => {
    const a = normalizeQuestion("¿Cuántos estudiantes hay por sede?");
    expect(a).toBe("cuantos estudiantes hay por sede");
    expect(similarity(a, normalizeQuestion("cuantos estudiantes hay por cada sede"))).toBeGreaterThan(0.78);
    expect(similarity(a, normalizeQuestion("¿cómo va el pilar Personalización?"))).toBeLessThan(0.3);
    const saved = pickSaved(a, [
      { qnorm: "cuantos estudiantes hay por sede", fresh: false },
      { qnorm: "cuantos estudiantes hay por cada sede", fresh: true },
    ]);
    expect(saved?.qnorm).toBe("cuantos estudiantes hay por cada sede");
    expect(pickSaved(a, [{ qnorm: "deserción por periodo", fresh: true }])).toBeNull();
  });

  it("lee la respuesta de la IA y deja solo las citas que existen", () => {
    expect(parseAsk('```json\n{"respuesta":"Hay 15.870 estudiantes [1] y crece [3].","sin_datos":false}\n```', 2)).toEqual({ text: "Hay 15.870 estudiantes [1] y crece.", noData: false });
    expect(parseAsk('{"respuesta":"No alcanza.","sin_datos":true}', 2).noData).toBe(true);
    expect(parseAsk("Texto suelto [2]", 2).text).toBe("Texto suelto [2]");
  });

  it("numera las fuentes en el orden en que se citan", () => {
    const ps = [passage("a", "uno"), passage("b", "dos"), passage("c", "tres")];
    const r = renumber("Primero [3], luego [1] y otra vez [3].", ps);
    expect(r.text).toBe("Primero [1], luego [2] y otra vez [1].");
    expect(r.passages.map((p) => p.ref)).toEqual(["c", "a"]);
  });

  it("sin IA, responde con los pasajes tal cual y citados", () => {
    const text = extractAnswer([passage("Matriculados", "En 2025-2 hay 15.870 estudiantes."), passage("Deserción", "La deserción fue de 8,4 %.")]);
    expect(text).toContain("[1]");
    expect(text).toContain("[2]");
    expect(text).toContain("15.870");
  });
});
