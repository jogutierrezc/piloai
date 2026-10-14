/* Los espacios de Pilo (0113), sin red ni base: de dónde sale el espacio, qué
   fuentes le tocan, cómo se lee su fila y qué regla le da a `canUse`. */
import { describe, expect, it } from "vitest";
import { DEFAULT_SPACE, PORTALS, SPACES, SPACE_INTRO, SPACE_PORTALS, canUse, isSpace, nothingText, portalView, ruleText, spaceOfPortal, spaceProfile, spaceRule, spaceSources, visitorSeed, NOTHING_TEXT, RULE_TEXT, type Rules } from "./logic";

describe("de dónde sale el espacio", () => {
  it("solo el portal propio de otro espacio lo cambia; lo demás es el Pilo de siempre", () => {
    expect(spaceOfPortal("ensenanza")).toBe("ensenanza");
    for (const portal of [...PORTALS, "prueba", "", "planeacion", "Ensenanza", "ensenanza ", "__proto__", "constructor"]) expect(spaceOfPortal(portal)).toBe(DEFAULT_SPACE);
  });

  it("los espacios son una lista cerrada", () => {
    expect(Object.keys(SPACES)).toEqual(["planeacion", "ensenanza"]);
    expect(isSpace("ensenanza")).toBe(true);
    expect(isSpace("planeacion")).toBe(true);
    for (const v of ["otro", "", "toString", "__proto__", null, undefined, 1, ["ensenanza"]]) expect(isSpace(v)).toBe(false);
  });

  it("cada espacio tiene sus fuentes y ninguna se repite en otro", () => {
    expect(SPACES.planeacion.sources).toEqual(["cifras", "boletines", "pdi", "observatorio", "impacto"]);
    expect(SPACES.ensenanza.sources).toEqual(["innovacion", "politicas", "global", "moodle"]);
    expect(SPACES.planeacion.sources.filter((s) => SPACES.ensenanza.sources.includes(s))).toEqual([]);
    // El portal del espacio nuevo no es uno de los portales de pilo_ai_settings.
    expect(SPACE_PORTALS).toEqual(["ensenanza"]);
    expect(PORTALS).toEqual(["cifras", "pdi", "observatorio", "impacto", "pregunta"]);
  });
});

describe("las fuentes las fija el servidor", () => {
  it("en Planeación, como siempre: encendida salvo que diga lo contrario, e Impacto solo con sesión", () => {
    expect(spaceSources("planeacion", {}, false)).toEqual(["cifras", "boletines", "pdi", "observatorio"]);
    expect(spaceSources("planeacion", null, true)).toEqual(["cifras", "boletines", "pdi", "observatorio", "impacto"]);
    expect(spaceSources("planeacion", { pdi: false, innovacion: true }, true)).toEqual(["cifras", "boletines", "observatorio", "impacto"]);
  });

  it("en otro espacio, solo las suyas y solo las encendidas", () => {
    expect(spaceSources("ensenanza", { innovacion: true, politicas: true, global: false, moodle: true }, false)).toEqual(["innovacion", "politicas", "moodle"]);
    // Una fuente de otro espacio no entra aunque venga encendida; sin marca, apagada.
    expect(spaceSources("ensenanza", { cifras: true, impacto: true, politicas: true }, true)).toEqual(["politicas"]);
    expect(spaceSources("ensenanza", null, true)).toEqual([]);
    expect(spaceSources("ensenanza", { innovacion: "true", politicas: 1 }, true)).toEqual([]);
  });
});

describe("la vista de un portal (0121)", () => {
  const row = (source: string, mode: string, name = "") => ({ source, space: "planeacion", mode, vis: ["publico"], name });

  it("sin lista no hay vista: quien llama sigue con las fuentes de partida", () => {
    for (const v of [null, undefined, {}, "cifras", 3]) expect(portalView("planeacion", v)).toBeNull();
    // Una lista vacía sí es una vista: el portal no lee nada.
    expect(portalView("planeacion", [])).toEqual({ sources: [], visiting: [], names: SPACES.planeacion.names, scopes: {} });
  });

  it("con la matriz de partida da las mismas fuentes, en el mismo orden y con los mismos nombres", () => {
    const start = SPACES.planeacion.sources.map((s) => row(s, "casa", "Otro nombre en la base"));
    const view = portalView("planeacion", start)!;
    expect(view.sources).toEqual(spaceSources("planeacion", {}, true));
    expect(view.sources).toEqual(SPACES.planeacion.sources);
    // Los nombres de las fuentes de siempre son los del código: el pedido no cambia ni una letra.
    expect(view.names).toEqual(SPACES.planeacion.names);
    const teach = portalView("ensenanza", SPACES.ensenanza.sources.map((s) => row(s, "casa")))!;
    expect(teach.sources).toEqual(spaceSources("ensenanza", { innovacion: true, politicas: true, global: true, moodle: true }, false));
    expect(teach.names).toEqual(SPACES.ensenanza.names);
  });

  it("solo «casa» se busca; «visita» queda aparte; lo demás y lo raro no entra", () => {
    const view = portalView("planeacion", [
      row("cifras", "casa"), row("normativa", "casa", "  Normativa\n institucional "), row("politicas", "visita", "Políticas institucionales"),
      row("global", "no"), row("cifras", "casa"), row("politicas", "casa"), row("Mala Fuente", "casa"), row("__proto__", "casa"), { mode: "casa" }, null, "pdi", row("pdi", "siempre"),
    ])!;
    expect(view.sources).toEqual(["cifras", "normativa"]);
    expect(view.visiting).toEqual(["politicas"]);
    expect(view.names.normativa).toBe("Normativa institucional");
    expect(view.names.cifras).toBe("UDES en Cifras");
    expect(Object.keys(view.names)).not.toContain("global");
  });
});

describe("la fila de un espacio", () => {
  it("sin fila, o con algo raro, queda cerrado y solo para la administración", () => {
    for (const row of [null, undefined, {}, { on: "true", aud: "todos", roles: "x", memory_sources: [] }]) {
      const p = spaceProfile("ensenanza", row as Record<string, unknown> | null);
      expect(p).toMatchObject({ id: "ensenanza", on: false, aud: "admin", ai: true, intro: "", focus: "", dailyLimit: 200, visitorLimit: 20, visitorWindow: 600 });
      expect(p.sources).toEqual({ innovacion: false, politicas: false, global: false, moodle: false });
      expect(p.roles.estudiante).toEqual({ tone: "", voiceStyle: "", expression: "", mood: "" });
      expect(spaceRule(p)).toEqual({ on: false, aud: "admin", fns: ["preguntar", "leer"] });
    }
  });

  it("lee lo que la administración puso, recortado y sin lo que no conoce", () => {
    const p = spaceProfile("ensenanza", {
      on: true,
      aud: "publico",
      ai: false,
      intro: `  ${"x".repeat(400)}`,
      focus: "innovación\neducativa",
      roles: { estudiante: { tone: "t".repeat(500), voice_style: "cercano", expression: "feliz", mood: "emocionado" }, profesor: { expression: "<b>mala</b>", mood: "Atento!" }, rector: { tone: "no existe" } },
      memory_sources: { innovacion: true, politicas: false, cifras: true },
      daily_limit: "50",
      visitor_limit: -3,
      visitor_window_seconds: 5,
    });
    expect(p).toMatchObject({ on: true, aud: "publico", ai: false, focus: "innovación educativa", dailyLimit: 50, visitorLimit: 0, visitorWindow: 30 });
    expect(p.intro).toHaveLength(300);
    expect(p.roles.estudiante).toEqual({ tone: "t".repeat(300), voiceStyle: "cercano", expression: "feliz", mood: "emocionado" });
    expect(p.roles.profesor).toEqual({ tone: "", voiceStyle: "", expression: "", mood: "" });
    expect(Object.keys(p.roles)).toEqual(["estudiante", "profesor"]);
    expect(p.sources).toEqual({ innovacion: true, politicas: false, global: false, moodle: false });
    expect(SPACE_INTRO).toBe("la Inteligencia Artificial de la Universidad de Santander");
  });
});

describe("quién entra a un espacio", () => {
  const rules = (rule: ReturnType<typeof spaceRule> | undefined): Rules => ({ enabled: true, functions: { preguntar: true, leer: true }, portals: { pregunta: { on: true, aud: "publico", fns: ["preguntar", "leer"] }, ensenanza: rule } });
  const open = (over: Record<string, unknown>) => spaceRule(spaceProfile("ensenanza", { on: true, aud: "publico", ...over }));

  it("abierto al público, preguntar y leer; lo demás no", () => {
    const r = rules(open({}));
    expect(canUse(r, "ensenanza", "preguntar", null)).toEqual({ ok: true });
    expect(canUse(r, "ensenanza", "voz", null)).toEqual({ ok: true });
    expect(canUse(r, "ensenanza", "resumir", "admin").ok).toBe(false);
    expect(canUse(r, "ensenanza", "explicar", null).ok).toBe(false);
  });

  it("apagado, sin regla o con otra audiencia, se cierra", () => {
    expect(canUse(rules(open({ on: false })), "ensenanza", "preguntar", "admin").ok).toBe(false);
    expect(canUse(rules(undefined), "ensenanza", "preguntar", "admin").ok).toBe(false);
    expect(canUse(rules(open({ aud: "admin" })), "ensenanza", "preguntar", "planeacion").ok).toBe(false);
    expect(canUse(rules(open({ aud: "admin" })), "ensenanza", "preguntar", "admin")).toEqual({ ok: true });
    expect(canUse(rules(open({ aud: "sesion" })), "ensenanza", "preguntar", null).ok).toBe(false);
    expect(canUse(rules(open({ aud: "sesion" })), "ensenanza", "preguntar", "consulta")).toEqual({ ok: true });
  });

  it("el portal de siempre no cambia", () => {
    const r = rules(undefined);
    expect(canUse(r, "pregunta", "preguntar", null)).toEqual({ ok: true });
    expect(canUse(r, "otro", "preguntar", "admin").ok).toBe(false);
  });
});

describe("lo que cada espacio dice sin IA y su huella", () => {
  it("Planeación dice lo de siempre; Enseñanza, lo suyo", () => {
    for (const rule of ["saludo", "gracias", "quien", "dinero", "personas"] as const) expect(ruleText(rule)).toBe(RULE_TEXT[rule]);
    expect(nothingText()).toBe(NOTHING_TEXT);
    expect(ruleText("quien", "ensenanza")).toContain("Inteligencia Artificial de la Universidad de Santander");
    expect(ruleText("quien", "ensenanza")).not.toContain("Planeación");
    expect(ruleText("personas", "ensenanza")).toBe(RULE_TEXT.personas);
    expect(nothingText("ensenanza")).not.toContain("UDES en Cifras");
  });

  it("la huella del visitante lleva el espacio solo si no es el de partida", () => {
    expect(visitorSeed("sal", "2026-10-01", "p", "v:1.2.3.4|nav")).toBe("sal|2026-10-01|p|v:1.2.3.4|nav");
    expect(visitorSeed("sal", "2026-10-01", "p", "v:1.2.3.4|nav", "planeacion")).toBe("sal|2026-10-01|p|v:1.2.3.4|nav");
    expect(visitorSeed("sal", "2026-10-01", "p", "v:1.2.3.4|nav", "ensenanza")).toBe("sal|2026-10-01|p|ensenanza|v:1.2.3.4|nav");
  });
});
