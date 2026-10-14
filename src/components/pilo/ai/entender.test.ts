import { describe, expect, it } from "vitest";
import { buildNeedMessages, canUse, parseNeed } from "./logic";

describe("Mr. Pilo Bot entiende la necesidad de un programa", () => {
  it("solo con la IA encendida y con sesión", () => {
    const rules = { enabled: true, functions: {}, portals: {} };
    expect(canUse(rules, "impacto", "entender", "consulta").ok).toBe(true);
    expect(canUse(rules, "impacto", "entender", null).ok).toBe(false);
    expect(canUse({ ...rules, enabled: false }, "impacto", "entender", "admin").ok).toBe(false);
  });

  it("la IA solo puede elegir de las listas cerradas", () => {
    const r = parseNeed(
      '{"resumen":"Quiere mejorar la empleabilidad.","impactos":["empleo","inventado"],"fichas":[{"id":"i1","porque":"Mide el empleo"},{"id":"x9","porque":"no existe"},{"id":"i1","porque":"repetida"}]}',
      new Set(["empleo", "semilleros"]),
      new Set(["i1", "i2"]),
    );
    expect(r).toEqual({ summary: "Quiere mejorar la empleabilidad.", goals: ["empleo"], indicators: [{ id: "i1", reason: "Mide el empleo" }] });
    expect(parseNeed("no es json", new Set(), new Set())).toEqual({ summary: "", goals: [], indicators: [] });
  });

  it("le pasa al modelo la necesidad y las listas", () => {
    const m = buildNeedMessages({ program: "Enfermería", text: "Queremos empleo", goals: [{ id: "empleo", fn: "ensenanza", title: "Empleo" }], indicators: [{ id: "i1", code: "ENS-01", name: "Tasa de empleo", fn: "ensenanza", stage: "impacto" }] });
    expect(m[1].content).toContain("empleo · ensenanza · Empleo");
    expect(m[1].content).toContain("i1 · ENS-01 · ensenanza · impacto · Tasa de empleo");
    expect(m[1].content).toContain("Lo que escribió el programa: Queremos empleo");
  });
});
