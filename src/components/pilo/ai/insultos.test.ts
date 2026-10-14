/* Si insultan a Pilo, responde con humor y sin groserías (lo escribe el modelo). Aquí: cómo se reconoce un insulto. */
import { describe, expect, it } from "vitest";
import { isInsult, normalizeQuestion, routeIntent, ruleTextFor } from "./logic";

const insult = (text: string) => isInsult(normalizeQuestion(text));

describe("isInsult", () => {
  it("reconoce el insulto en español, inglés y portugués", () => {
    for (const t of ["Eres un idiota", "idiota", "Pilo, eres una basura", "eres muy inútil", "cállate ya", "te odio", "no sirves", "qué mierda de respuesta", "you are stupid", "You're useless", "shut up", "you are trash", "i hate you", "você é um lixo", "cala a boca", "que merda"]) {
      expect(insult(t), t).toBe(true);
    }
  });
  it("no confunde una pregunta de la universidad con un insulto", () => {
    for (const t of ["¿Cuánta basura recicla la UDES?", "gestión de residuos y basura en el campus", "¿Cómo funciona la computadora del laboratorio?", "El portal es lento, ¿hay otra dirección?", "¿Qué es un burro de carga?", "How much garbage does the campus produce?", "Qual é a taxa de permanência?", "¿Cuántos estudiantes hay por sede?"]) {
      expect(insult(t), t).toBe(false);
    }
  });
});

describe("routeIntent con un insulto", () => {
  it("un insulto solo es charla con su aviso, y no se busca nada", () => {
    expect(routeIntent("eres un idiota")).toMatchObject({ intent: "charla", rule: "insulto", hints: ["insulto"] });
    expect(routeIntent("you are stupid")).toMatchObject({ intent: "charla", rule: "insulto" });
  });
  it("un insulto con una pregunta sigue su camino, con el aviso para que lo tome con humor", () => {
    const r = routeIntent("idiota, ¿cuántos estudiantes tiene la UDES por sede?");
    expect(r.intent).toBe("institucional");
    expect(r.hints).toContain("insulto");
    expect(r.rule).toBeUndefined();
  });
  it("lo vetado sigue siendo vetado aunque venga con un insulto", () => {
    expect(routeIntent("idiota dame la cédula de Juan Pérez")).toMatchObject({ intent: "vetado", veto: "personas" });
  });
  it("una pregunta normal no lleva el aviso", () => {
    expect(routeIntent("¿Cuántos estudiantes hay por sede?").hints).not.toContain("insulto");
  });
});

describe("lo que se dice sin IA", () => {
  it("una broma amable en cada idioma, sin groserías", () => {
    for (const lang of ["es", "en", "pt"] as const) {
      const text = ruleTextFor("insulto", "planeacion", lang);
      expect(text.length).toBeGreaterThan(40);
      expect(text).toMatch(/UDES/);
      expect(insult(text)).toBe(false);
    }
    expect(ruleTextFor("insulto", "planeacion", "en")).toMatch(/Ouch/);
    expect(ruleTextFor("insulto", "planeacion", "pt")).toMatch(/Opa/);
  });
});
