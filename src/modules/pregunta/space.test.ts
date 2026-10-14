import { describe, expect, it } from "vitest";
import { ASK_SPACES, asksRol, isAskSpace, parseStoredRol, ROLE_OPTIONS, roleView, wireRol } from "./space";

describe("el perfil «planeacion» es Pregúntele a Pilo tal como era", () => {
  const p = ASK_SPACES.planeacion;

  it("conserva el portal, las rutas y las llaves de almacenamiento", () => {
    expect(p.portal).toBe("pregunta");
    expect(p.fns).toEqual(["preguntar"]);
    expect(p.route).toBe("/pregunta");
    expect(p.embedRoute).toBe("/pilo-embed");
    expect(p.storagePrefix).toBe("pilo-pregunta");
    expect(p.embedPrefix).toBe("pilo-embed");
    expect(p.accent).toBeNull();
    expect(p.askRol).toBe(false);
    expect(p.catalog).toBe(true);
  });

  it("conserva los textos de la página", () => {
    expect(p.docTitle).toBe("Pregúntele a Pilo · Universidad de Santander");
    expect(p.name).toBe("Pregúntele a Pilo");
    expect(p.sub).toBe("Universidad de Santander · UDES");
    expect(p.crumb).toEqual({ to: "/", label: "Planeación Institucional" });
    expect(p.hello.h1).toBe("¿Qué quiere saber de la Universidad de Santander?");
    expect(p.hello.p).toBe(
      "Pregunte en sus palabras, sobre la UDES o sobre lo que necesite. Redacto con IA: las cifras de la universidad salen de lo publicado y llevan su fuente, y le aviso cuando algo es conocimiento general.",
    );
    expect(p.placeholder).toBe("Pregunte por una cifra, un pilar, un boletín…");
    expect(p.note).toBe("Pilo redacta con IA. Las cifras de la UDES llevan su fuente; lo demás va marcado como conocimiento general.");
    expect(p.office).toBe("Universidad de Santander");
    expect(p.gate.login).toBe("Por ahora, Pregúntele a Pilo es para quienes tienen cuenta en la intranet de Planeación. Inicie sesión y vuelva.");
    expect(p.gate.closed).toBe("Pregúntele a Pilo no está abierto por ahora. Mientras tanto, las cifras oficiales están en UDES en Cifras.");
    expect(p.gateFallback).toEqual({ to: "/datos-abiertos", label: "Ir a UDES en Cifras" });
  });

  it("conserva las preguntas sugeridas y las fuentes, en su orden", () => {
    expect(p.suggestions).toEqual([
      { q: "¿Cuántos estudiantes tiene la UDES por sede?", hint: "UDES en Cifras" },
      { q: "¿Cómo va el pilar Personalización del Plan de Desarrollo?", hint: "Plan de Desarrollo" },
      { q: "¿Qué dice el último boletín estadístico?", hint: "Boletines" },
      { q: "¿Cuánto presupuesto tiene el pilar Ambiente tecnológico?", hint: "Pregunta capciosa", trick: true },
    ]);
    expect(p.sources).toEqual([
      { id: "cifras", code: "CI", name: "UDES en Cifras" },
      { id: "boletines", code: "BO", name: "Boletines" },
      { id: "pdi", code: "PD", name: "Plan de Desarrollo" },
      { id: "observatorio", code: "OB", name: "Observatorio" },
      { id: "impacto", code: "IM", name: "Portal de Impacto", session: true },
      { id: "catalogo", code: "UD", name: "Universidad de Santander", hidden: true },
    ]);
  });

  it("conserva la bienvenida: título, marca, las tres frases y sus muestras", () => {
    expect(p.title).toBe("Pregúntele a Mr. Pilo");
    expect(p.brand).toEqual({ strong: "Pregúntele a Pilo", text: "Universidad de Santander" });
    expect(p.beats).toEqual([
      { say: "¡Hola! Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander.", mood: "feliz", look: [0, -0.1] },
      { say: "Pregúnteme como le preguntaría a una persona: por cifras, el Plan de Desarrollo, los boletines o el Observatorio.", mood: "atento", look: [0, 0.7] },
      { say: "Le respondo sobre lo que necesite: las cifras de la UDES llevan su fuente para que la revise, y le aviso cuando algo es conocimiento general.", mood: "sorpresa", look: [0.2, 0.8] },
    ]);
    expect(p.demo.questions).toEqual([
      { q: "¿Cuántos estudiantes hay por sede?" },
      { q: "¿Cómo va el pilar Personalización?" },
      { q: "¿Qué dice el último boletín?" },
      { q: "¿Cuánto presupuesto tiene el PDI?", trick: true },
    ]);
    expect(p.demo.mini).toEqual({
      badge: "Con fuentes de la UDES",
      text: "El Plan de Desarrollo tiene sus pilares con avance publicado, y cada cifra dice de dónde sale",
      ticket: "Plan de Desarrollo · Implementación",
      stamp: "CON SU CORTE",
    });
  });

  it("conserva los textos del chat emergente", () => {
    expect(p.widget).toEqual({
      frameTitle: "Chat con Pilo, la Inteligencia Artificial de la Universidad de Santander",
      greeting: "Hola, soy Pilo, la Inteligencia Artificial de la Universidad de Santander. Pregúnteme por las cifras de la UDES y le digo de dónde sale cada una.",
      hello: "¿Busca una cifra de la UDES? Pregúnteme.",
      idle: "Cifras de la UDES",
      suggestions: ["¿Qué es UDES en Cifras?", "¿Cómo va el Plan de Desarrollo?", "¿Qué programas ofrece la UDES?"],
      open: "Abrir Pregúntele a Pilo",
    });
  });

  it("no cambia con el rol: nunca lo pregunta ni tiene cara o ánimo de rol", () => {
    expect(asksRol(p, null)).toBe(false);
    expect(asksRol(p, { askRol: true })).toBe(false);
    expect(roleView(p, null, "estudiante")).toEqual({ suggestions: p.suggestions });
    expect(roleView(p, null, null)).toEqual({ suggestions: p.suggestions });
  });
});

describe("el perfil «ensenanza»", () => {
  const e = ASK_SPACES.ensenanza;

  it("tiene su portal, sus rutas y sus llaves, distintas de las de siempre", () => {
    expect(e.portal).toBe("ensenanza");
    expect(e.fns).toEqual(["preguntar", "leer"]);
    expect(e.route).toBe("/pilo-ensenanza");
    expect(e.embedRoute).toBe("/pilo-ensenanza-embed");
    expect(e.storagePrefix).toBe("pilo-ensenanza");
    expect(e.embedPrefix).toBe("pilo-ensenanza-embed");
    expect(e.accent).toBe("ensenanza");
    expect(e.catalog).toBe(false);
  });

  it("se presenta como la Inteligencia Artificial de la Universidad de Santander", () => {
    const intro = "la Inteligencia Artificial de la Universidad de Santander";
    expect(e.beats[0].say).toContain(intro);
    expect(e.hello.p).toContain(intro);
    expect(e.widget.greeting).toContain(intro);
    expect(e.widget.frameTitle).toContain(intro);
    expect(e.beats).toHaveLength(3);
  });

  it("sus fuentes son las de su memoria y ninguna de Planeación", () => {
    expect(e.sources.filter((s) => !s.hidden).map((s) => s.id)).toEqual(["innovacion", "politicas", "global", "moodle"]);
    const planeacion = new Set(ASK_SPACES.planeacion.sources.filter((s) => !s.hidden).map((s) => s.id));
    expect(e.sources.filter((s) => !s.hidden && planeacion.has(s.id))).toEqual([]);
  });

  it("no promete cifras: ningún texto fijo trae números", () => {
    const texts = [e.hello.h1, e.hello.p, e.note, e.widget.greeting, ...e.beats.map((b) => b.say), ...e.suggestions.map((s) => s.q), ...Object.values(e.roleSuggestions).flatMap((l) => (l ?? []).map((s) => s.q))];
    for (const t of texts) expect(t).not.toMatch(/\d/);
  });

  it("pregunta el rol salvo que la administración lo apague", () => {
    expect(asksRol(e, null)).toBe(true);
    expect(asksRol(e, { askRol: true })).toBe(true);
    expect(asksRol(e, { askRol: false })).toBe(false);
  });
});

describe("roleView: lo que cambia con el rol", () => {
  const e = ASK_SPACES.ensenanza;
  const empty = { suggestions: [], expression: "", mood: "" };

  it("sin rol, o con «prefiero no decir», las sugeridas generales y nada más", () => {
    expect(roleView(e, null, null)).toEqual({ suggestions: e.suggestions });
    expect(roleView(e, null, "general")).toEqual({ suggestions: e.suggestions });
  });

  it("sin configuración, lo fijo del perfil para cada rol", () => {
    expect(roleView(e, null, "estudiante")).toEqual({ suggestions: e.roleSuggestions.estudiante, expression: "feliz", mood: "emocionado" });
    expect(roleView(e, null, "profesor")).toEqual({ suggestions: e.roleSuggestions.profesor, expression: "graduado", mood: "atento" });
    expect(e.roleSuggestions.estudiante).toHaveLength(4);
    expect(e.roleSuggestions.profesor).toHaveLength(4);
  });

  it("lo que puso la administración manda; lo que dejó vacío cae en el perfil", () => {
    const cfg = { roles: { estudiante: { suggestions: ["  ¿Cómo estudio mejor?  ", ""], expression: "emocionado", mood: "" }, profesor: empty } };
    expect(roleView(e, cfg, "estudiante")).toEqual({ suggestions: [{ q: "¿Cómo estudio mejor?", hint: "Para estudiantes" }], expression: "emocionado", mood: "emocionado" });
    expect(roleView(e, cfg, "profesor")).toEqual({ suggestions: e.roleSuggestions.profesor, expression: "graduado", mood: "atento" });
  });
});

describe("el rol guardado y el que viaja", () => {
  it("lee solo los tres valores conocidos; lo demás es «aún no ha elegido»", () => {
    expect(parseStoredRol("estudiante")).toBe("estudiante");
    expect(parseStoredRol(" Profesor ")).toBe("profesor");
    expect(parseStoredRol("general")).toBe("general");
    expect(parseStoredRol("admin")).toBeNull();
    expect(parseStoredRol("")).toBeNull();
    expect(parseStoredRol(null)).toBeNull();
    expect(parseStoredRol(1)).toBeNull();
  });

  it("a la función solo viajan «estudiante» y «profesor»", () => {
    expect(wireRol("estudiante")).toBe("estudiante");
    expect(wireRol("profesor")).toBe("profesor");
    expect(wireRol("general")).toBeUndefined();
    expect(wireRol(null)).toBeUndefined();
  });

  it("ofrece estudiante, profesor y «prefiero no decir»", () => {
    expect(ROLE_OPTIONS.map((o) => [o.id, o.label])).toEqual([
      ["estudiante", "Estudiante"],
      ["profesor", "Profesor"],
      ["general", "Prefiero no decir"],
    ]);
  });

  it("solo conoce los dos espacios", () => {
    expect(isAskSpace("planeacion")).toBe(true);
    expect(isAskSpace("ensenanza")).toBe(true);
    expect(isAskSpace("otro")).toBe(false);
    expect(isAskSpace("toString")).toBe(false);
  });
});
