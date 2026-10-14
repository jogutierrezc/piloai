import { describe, expect, it } from "vitest";
import { DEFAULT_MOMENT, DEFAULT_ROW, MOMENTS, ROWS, dirtyRows, parseMoment, parseRow } from "./navegacion";
import { clip, rowSummary, spanOf, voiceName } from "./resumen";
import { dirtyTabs, normalizeSpace } from "./store";
import type { SpaceSettings } from "./store";

const base = normalizeSpace({});
const withRole = (s: SpaceSettings, rol: "estudiante" | "profesor", patch: Partial<SpaceSettings["roles"]["estudiante"]>): SpaceSettings => ({
  ...s,
  roles: { ...s.roles, [rol]: { ...s.roles[rol], ...patch } },
});

describe("el momento de la memoria en la dirección (?momento=…)", () => {
  it("son cuatro, en el orden en que se trabaja", () => {
    expect(MOMENTS.map((m) => m.id)).toEqual(["alimentar", "comprender", "mapa", "probar"]);
  });

  it("reconoce cada momento, sin importar mayúsculas ni espacios", () => {
    for (const m of MOMENTS) expect(parseMoment(m.id)).toBe(m.id);
    expect(parseMoment(" MAPA ")).toBe("mapa");
  });

  it("sin parámetro, vacío o desconocido vuelve al primero", () => {
    expect(DEFAULT_MOMENT).toBe("alimentar");
    for (const v of [null, undefined, "", "documentos", "mapa-global"]) expect(parseMoment(v)).toBe("alimentar");
  });
});

describe("la fila abierta en la dirección (?fila=…)", () => {
  it("sin parámetro abre la primera", () => {
    expect(DEFAULT_ROW).toBe("pagina");
    expect(parseRow(null)).toBe("pagina");
    expect(parseRow(undefined)).toBe("pagina");
  });

  it("vacío es «todas cerradas», que también se puede enlazar", () => {
    expect(parseRow("")).toBeNull();
    expect(parseRow("  ")).toBeNull();
  });

  it("reconoce cada fila y una desconocida vuelve a la primera", () => {
    for (const r of ROWS) expect(parseRow(r.id)).toBe(r.id);
    expect(parseRow("CUPOS")).toBe("cupos");
    expect(parseRow("voz")).toBe("pagina");
  });
});

describe("el punto de «cambios sin guardar» de cada fila", () => {
  it("sin cambios, ninguna", () => {
    expect(dirtyRows(base, base)).toEqual([]);
  });

  it("marca solo la fila que cambió", () => {
    expect(dirtyRows({ ...base, aud: "publico" }, base)).toEqual(["pagina"]);
    expect(dirtyRows({ ...base, focus: "Solo enseñanza." }, base)).toEqual(["presenta"]);
    expect(dirtyRows(withRole(base, "profesor", { tone: "Preciso" }), base)).toEqual(["roles"]);
    expect(dirtyRows({ ...base, daily_limit: 50, widget_on: true }, base)).toEqual(["cupos", "portales"]);
  });

  it("abrir o cerrar a Pilo es del panel: no marca ninguna fila, pero sí la pestaña", () => {
    const now = { ...base, on: !base.on };
    expect(dirtyRows(now, base)).toEqual([]);
    expect(dirtyTabs(now, base)).toEqual(["pregunta"]);
  });

  it("las fuentes de la memoria no son de esta pestaña", () => {
    const now = { ...base, memory_sources: { ...base.memory_sources, moodle: false } };
    expect(dirtyRows(now, base)).toEqual([]);
    expect(dirtyTabs(now, base)).toEqual(["memoria"]);
  });

  it("toda columna de la pestaña (menos «on») pertenece a alguna fila", () => {
    const changed: SpaceSettings = {
      ...withRole(base, "estudiante", { tone: "x" }),
      aud: "sesion",
      ai: !base.ai,
      welcome: !base.welcome,
      intro: "x",
      focus: "x",
      greeting: "x",
      ask_rol: !base.ask_rol,
      daily_limit: 1,
      visitor_limit: 1,
      visitor_window_seconds: 60,
      widget_on: true,
      widget_origins: ["https://aula.udes.edu.co"],
    };
    expect(dirtyRows(changed, base)).toEqual(["pagina", "presenta", "roles", "cupos", "portales"]);
  });
});

describe("lo que dice cada fila cerrada", () => {
  it("la página: para quién, la bienvenida y si redacta con IA", () => {
    expect(rowSummary("pagina", base)).toBe("Para solo la administración · con bienvenida · redacta con IA");
    expect(rowSummary("pagina", { ...base, aud: "publico", welcome: false, ai: false })).toBe("Para el público · sin bienvenida · responde con lo publicado");
  });

  it("conexión y voz: las de Mr. Pilo con IA, por su nombre cuando ya se conocen", () => {
    expect(rowSummary("conexion", base)).toBe("Las de Mr. Pilo con IA");
    expect(rowSummary("conexion", base, { enabled: true, provider: "NVIDIA", voice: "la voz de Fish Audio" })).toBe("Redacta con NVIDIA · lee con la voz de Fish Audio");
    expect(rowSummary("conexion", base, { enabled: false, provider: "NVIDIA", voice: "la voz del navegador" })).toBe("Mr. Pilo con IA está apagado");
  });

  it("cómo se presenta: la presentación entre comillas, recortada, y qué más trae", () => {
    expect(rowSummary("presenta", base)).toBe("«la Inteligencia Artificial de la Universidad de Santander» · sin enfoque · saludo de partida");
    const long = rowSummary("presenta", { ...base, intro: "x".repeat(200), focus: "Solo enseñanza.", greeting: "Hola." });
    expect(long).toMatch(/^«x{63}…» · con enfoque · saludo propio$/);
    expect(rowSummary("presenta", { ...base, intro: "  " })).toMatch(/^Sin presentación/);
  });

  it("cómo le habla a cada quien: el tono y las sugeridas de cada rol", () => {
    expect(rowSummary("roles", base)).toBe("Estudiante: tono de partida · Profesor: tono de partida");
    const s = withRole(withRole(base, "estudiante", { tone: "Cercano, con ejemplos", suggestions: ["¿Cómo se evalúa?"] }), "profesor", { suggestions: ["a", "b"] });
    expect(rowSummary("roles", { ...s, ask_rol: false })).toBe("Estudiante: Cercano, con ejemplos, 1 sugerida · Profesor: tono de partida, 2 sugeridas · no pregunta el rol");
  });

  it("cupos: al día y por visitante, con la ventana dicha como se lee", () => {
    expect(rowSummary("cupos", base)).toBe("200 preguntas con IA al día · 20 por visitante cada 10 minutos");
    expect(rowSummary("cupos", { ...base, daily_limit: 0, visitor_limit: 0 })).toBe("Sin cupo de IA: responde con lo publicado · sin límite por visitante");
    expect(rowSummary("cupos", { ...base, daily_limit: 1, visitor_window_seconds: 7200 })).toBe("1 pregunta con IA al día · 20 por visitante cada 2 horas");
  });

  it("otros portales: apagado, encendido sin lista o abierto a tantos", () => {
    expect(rowSummary("portales", base)).toBe("Apagado: solo en este portal");
    expect(rowSummary("portales", { ...base, widget_on: true })).toBe("Encendido, sin portales en la lista");
    expect(rowSummary("portales", { ...base, widget_on: true, widget_origins: ["https://a.co"] })).toBe("Abierto a 1 portal");
    expect(rowSummary("portales", { ...base, widget_on: true, widget_origins: ["https://a.co", "https://b.co"] })).toBe("Abierto a 2 portales");
  });

  it("toda fila tiene resumen", () => {
    for (const r of ROWS) expect(rowSummary(r.id, base).length).toBeGreaterThan(0);
  });
});

describe("piezas del resumen", () => {
  it("la ventana se dice en segundos, minutos u horas", () => {
    expect([spanOf(30), spanOf(1), spanOf(600), spanOf(60 * 119), spanOf(86400)]).toEqual(["30 segundos", "1 segundo", "10 minutos", "119 minutos", "24 horas"]);
  });

  it("un texto largo se corta en una línea con puntos suspensivos", () => {
    expect(clip("  hola   mundo \n", 40)).toBe("hola mundo");
    expect(clip("abcdefghij", 5)).toBe("abcd…");
  });

  it("la voz, por su nombre", () => {
    expect(voiceName({ voice_engine: "navegador", speech_provider: "nvidia" })).toBe("la voz del navegador");
    expect(voiceName({ voice_engine: "proveedor", speech_provider: "nvidia" })).toBe("la voz de NVIDIA");
    expect(voiceName({ voice_engine: "proveedor", speech_provider: "fishaudio" })).toBe("la voz de Fish Audio");
    expect(voiceName({ voice_engine: "proveedor", speech_provider: "freeai" })).toBe("la voz de Free.ai");
  });
});
