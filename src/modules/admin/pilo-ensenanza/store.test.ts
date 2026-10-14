import { describe, expect, it } from "vitest";
import {
  CATALOG_EXAMPLES,
  DEFAULT_INTRO,
  MAX_ORIGINS,
  MAX_SUGGESTIONS,
  SPACE_LIMITS,
  TABS,
  TEXT_MAX,
  clampLimit,
  dayRange,
  dirtyTabs,
  normalizeRole,
  normalizeSpace,
  parseTab,
  parseUsage,
  spacePatch,
  spaceSnippet,
  tableMissing,
} from "./store";

describe("la ficha de Mr. Pilo en Enseñanza, venga como venga de la base", () => {
  it("sin fila (sin 0113) nace con los valores de partida de la migración: cerrado y solo para la administración", () => {
    const s = normalizeSpace({});
    expect(s).toMatchObject({
      id: "ensenanza",
      name: "Mr. Pilo en Enseñanza",
      on: false,
      aud: "admin",
      ai: true,
      welcome: true,
      intro: DEFAULT_INTRO,
      focus: "",
      greeting: "",
      ask_rol: true,
      daily_limit: 200,
      visitor_limit: 20,
      visitor_window_seconds: 600,
      widget_on: false,
      widget_origins: [],
      memory_indexed_at: null,
    });
    expect(s.memory_sources).toEqual({ innovacion: true, politicas: true, global: true, moodle: true });
    expect(normalizeSpace(null)).toEqual(s);
  });

  it("respeta lo guardado, incluida la columna «on»", () => {
    const s = normalizeSpace({ on: true, aud: "publico", ai: false, welcome: false, ask_rol: false, intro: "", focus: "Solo enseñanza.", greeting: "Hola.", widget_on: true });
    expect(s).toMatchObject({ on: true, aud: "publico", ai: false, welcome: false, ask_rol: false, intro: "", focus: "Solo enseñanza.", greeting: "Hola.", widget_on: true });
  });

  it("una audiencia desconocida vuelve a la más cerrada", () => {
    expect(normalizeSpace({ aud: "todos" }).aud).toBe("admin");
    expect(normalizeSpace({ aud: null }).aud).toBe("admin");
  });

  it("los textos no pasan de lo que admite pilo_spaces_len", () => {
    const long = "x".repeat(2000);
    const s = normalizeSpace({ name: long, intro: long, focus: long, greeting: long });
    expect([s.name.length, s.intro.length, s.focus.length, s.greeting.length]).toEqual([120, 300, 600, 300]);
    expect(TEXT_MAX).toMatchObject({ name: 120, intro: 300, focus: 600, greeting: 300 });
  });

  it("los cupos se quedan dentro de pilo_spaces_limits", () => {
    expect(SPACE_LIMITS).toEqual({
      daily_limit: { def: 200, min: 0, max: 100000, whole: true },
      visitor_limit: { def: 20, min: 0, max: 1000, whole: true },
      visitor_window_seconds: { def: 600, min: 30, max: 86400, whole: true },
    });
    const s = normalizeSpace({ daily_limit: 999999, visitor_limit: -4, visitor_window_seconds: 5 });
    expect([s.daily_limit, s.visitor_limit, s.visitor_window_seconds]).toEqual([100000, 0, 30]);
    const t = normalizeSpace({ daily_limit: "150", visitor_limit: 12.6, visitor_window_seconds: 1e9 });
    expect([t.daily_limit, t.visitor_limit, t.visitor_window_seconds]).toEqual([150, 13, 86400]);
    // Lo que no es número vuelve a la partida; cero es un valor, no «vacío».
    expect(clampLimit("daily_limit", "muchos")).toBe(200);
    expect(clampLimit("daily_limit", null)).toBe(200);
    expect(clampLimit("daily_limit", true)).toBe(200);
    expect(clampLimit("daily_limit", 0)).toBe(0);
    expect(clampLimit("visitor_window_seconds", 0)).toBe(30);
  });

  it("la lista de portales: solo textos, sin repetidos y hasta 50 (pilo_spaces_widget)", () => {
    const many = Array.from({ length: 80 }, (_, i) => `https://p${i}.udes.edu.co`);
    expect(normalizeSpace({ widget_origins: many }).widget_origins).toHaveLength(MAX_ORIGINS);
    expect(normalizeSpace({ widget_origins: ["https://a.co", 7, "", "https://a.co", null] }).widget_origins).toEqual(["https://a.co"]);
    expect(normalizeSpace({ widget_origins: "https://a.co" }).widget_origins).toEqual([]);
  });

  it("una fuente cuenta solo si está en `true`, como en el servidor", () => {
    expect(normalizeSpace({ memory_sources: { innovacion: true, politicas: false, global: "si" } }).memory_sources).toEqual({ innovacion: true, politicas: false, global: false, moodle: false });
    // Una fuente que no es de este espacio no entra.
    expect(normalizeSpace({ memory_sources: { cifras: true } }).memory_sources).not.toHaveProperty("cifras");
  });
});

describe("cómo le habla a cada quien", () => {
  it("cada rol tiene su forma completa y sus valores de partida", () => {
    const { roles } = normalizeSpace({});
    expect(roles.estudiante).toEqual({ tone: "", suggestions: [], voice_style: "", expression: "feliz", mood: "emocionado" });
    expect(roles.profesor).toEqual({ tone: "", suggestions: [], voice_style: "", expression: "graduado", mood: "atento" });
    expect(Object.keys(roles)).toEqual(["estudiante", "profesor"]);
  });

  it("lee lo guardado y deja fuera lo que no es un rol", () => {
    const { roles } = normalizeSpace({
      roles: {
        estudiante: { tone: "Cercano.", suggestions: ["¿Cómo me evalúan?"], voice_style: "voz-a", expression: "emocionado", mood: "pensar" },
        general: { tone: "no existe" },
      },
    });
    expect(roles.estudiante).toEqual({ tone: "Cercano.", suggestions: ["¿Cómo me evalúan?"], voice_style: "voz-a", expression: "emocionado", mood: "pensar" });
    expect(roles.profesor.expression).toBe("graduado");
    expect(roles).not.toHaveProperty("general");
  });

  it("la cara y el ánimo son solo de los aprobados; otro vuelve al de partida del rol", () => {
    expect(normalizeRole("estudiante", { expression: "dragon", mood: "furioso" })).toMatchObject({ expression: "feliz", mood: "emocionado" });
    expect(normalizeRole("profesor", { expression: 3, mood: null })).toMatchObject({ expression: "graduado", mood: "atento" });
    expect(normalizeRole("profesor", { expression: "obra", mood: "cuidado" })).toMatchObject({ expression: "obra", mood: "cuidado" });
  });

  it("el tono y las sugeridas tienen tope; las sugeridas, limpias y hasta seis", () => {
    const r = normalizeRole("estudiante", {
      tone: "t".repeat(900),
      suggestions: ["  ¿Uno?  ", "", 4, "¿Dos\n  líneas?", ...Array.from({ length: 10 }, (_, i) => `¿Pregunta ${i}?`), "s".repeat(400)],
      voice_style: " voz-b ",
    });
    expect(r.tone).toHaveLength(TEXT_MAX.tone);
    expect(r.suggestions).toHaveLength(MAX_SUGGESTIONS);
    expect(r.suggestions.slice(0, 2)).toEqual(["¿Uno?", "¿Dos líneas?"]);
    expect(r.voice_style).toBe("voz-b");
    expect(normalizeRole("estudiante", { suggestions: ["s".repeat(400)] }).suggestions[0]).toHaveLength(TEXT_MAX.suggestion);
    expect(normalizeRole("estudiante", "raro")).toEqual(normalizeRole("estudiante", {}));
  });
});

describe("lo que se guarda", () => {
  it("solo columnas de pilo_spaces que esta pantalla cambia, y dentro de margen", () => {
    const s = normalizeSpace({ on: true, daily_limit: 50, memory_indexed_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" });
    const patch = spacePatch({ ...s, daily_limit: 5_000_000, focus: "f".repeat(900) });
    expect(patch).not.toHaveProperty("id");
    expect(patch).not.toHaveProperty("memory_indexed_at");
    expect(patch).not.toHaveProperty("updated_at");
    expect(patch).toMatchObject({ on: true, daily_limit: 100000 });
    expect(String(patch.focus)).toHaveLength(600);
    expect(Object.keys(patch).sort()).toEqual(
      ["ai", "ask_rol", "aud", "daily_limit", "focus", "greeting", "intro", "memory_sources", "name", "on", "roles", "visitor_limit", "visitor_window_seconds", "welcome", "widget_on", "widget_origins"].sort(),
    );
  });
});

describe("las pestañas", () => {
  it("son cuatro, sin Conexión ni Voz", () => {
    expect(TABS.map((t) => t.id)).toEqual(["pregunta", "memoria", "catalogo", "bitacora"]);
  });

  it("la dirección elige la pestaña; una desconocida vuelve a la primera", () => {
    expect(parseTab("memoria")).toBe("memoria");
    expect(parseTab(" Bitacora ")).toBe("bitacora");
    expect(parseTab("voz")).toBe("pregunta");
    expect(parseTab(null)).toBe("pregunta");
  });

  it("marca la pestaña donde vive lo que cambió", () => {
    const saved = normalizeSpace({});
    expect(dirtyTabs(saved, saved)).toEqual([]);
    expect(dirtyTabs({ ...saved, greeting: "Hola" }, saved)).toEqual(["pregunta"]);
    expect(dirtyTabs({ ...saved, roles: { ...saved.roles, profesor: { ...saved.roles.profesor, tone: "Preciso." } } }, saved)).toEqual(["pregunta"]);
    expect(dirtyTabs({ ...saved, memory_sources: { ...saved.memory_sources, moodle: false } }, saved)).toEqual(["memoria"]);
    expect(dirtyTabs({ ...saved, on: true, memory_sources: { ...saved.memory_sources, global: false } }, saved)).toEqual(["pregunta", "memoria"]);
  });
});

describe("el chat emergente de este espacio", () => {
  it("la línea dice qué Pilo es con data-pilo", () => {
    expect(spaceSnippet("https://pdi.udes.edu.co/", "ensenanza", "blanco", "izq")).toBe(
      '<script src="https://pdi.udes.edu.co/pilo.js" data-pilo="ensenanza" data-tema="blanco" data-esquina="izquierda" defer></script>',
    );
    expect(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "negro", "der")).toContain('data-esquina="derecha"');
    // Leer la página: nada, lo visible («si», o true como antes) o todo, también lo plegado.
    expect(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "blanco", "izq", "no")).toBe(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "blanco", "izq"));
    expect(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "blanco", "izq", true)).toBe(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "blanco", "izq", "si"));
    expect(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "blanco", "izq", "si")).toContain(' data-esquina="izquierda" data-leer="si" defer>');
    expect(spaceSnippet("https://pdi.udes.edu.co", "ensenanza", "blanco", "izq", "todo")).toBe(
      '<script src="https://pdi.udes.edu.co/pilo.js" data-pilo="ensenanza" data-tema="blanco" data-esquina="izquierda" data-leer="todo" defer></script>',
    );
  });
});

describe("el uso y la bitácora", () => {
  it("lee lo que devuelve pilo_space_usage, con «sin rol» en la llave vacía", () => {
    expect(parseUsage({ space: "ensenanza", today: 14, limit: 200, by_rol: { estudiante: 9, profesor: 3, "": 2 }, today_voice: 5 })).toEqual({
      today: 14,
      limit: 200,
      byRol: { estudiante: 9, profesor: 3, general: 2 },
      todayVoice: 5,
    });
    expect(parseUsage({ today: "7", by_rol: null })).toEqual({ today: 7, limit: 0, byRol: { estudiante: 0, profesor: 0, general: 0 }, todayVoice: 0 });
    expect(parseUsage(null)).toBeNull();
    expect(parseUsage([])).toBeNull();
  });

  it("un día es un intervalo de 24 horas; una fecha rara no filtra", () => {
    const range = dayRange("2026-10-01")!;
    expect(new Date(range.to).getTime() - new Date(range.from).getTime()).toBe(24 * 60 * 60 * 1000);
    expect(new Date(range.from).getDate()).toBe(1);
    expect(dayRange("")).toBeNull();
    expect(dayRange("2026-02-31")).toBeNull();
    expect(dayRange("ayer")).toBeNull();
  });

  it("reconoce que falta la tabla (sin 0113)", () => {
    expect(tableMissing({ code: "PGRST205", message: "Could not find the table 'public.pilo_spaces' in the schema cache" })).toBe(true);
    expect(tableMissing({ code: "42P01", message: 'relation "pilo_spaces" does not exist' })).toBe(true);
    expect(tableMissing({ code: "42501", message: "permission denied" })).toBe(false);
    expect(tableMissing(null)).toBe(false);
  });
});

describe("los ejemplos de la plantilla del catálogo", () => {
  it("llevan los prefijos de este espacio y un rol válido", () => {
    expect(CATALOG_EXAMPLES.respuesta.every((e) => e.key?.startsWith("ER-"))).toBe(true);
    expect(CATALOG_EXAMPLES.capciosa.every((e) => e.key?.startsWith("EC-"))).toBe(true);
    for (const e of [...CATALOG_EXAMPLES.respuesta, ...CATALOG_EXAMPLES.capciosa]) expect(["", "estudiante", "profesor"]).toContain(e.rol);
  });
});
