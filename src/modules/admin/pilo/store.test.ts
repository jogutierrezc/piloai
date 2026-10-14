import { describe, expect, it } from "vitest";
import { ASK_LIMITS, clampAsk, normalizeSettings, parseProbe } from "./store";
import { reasonHint, reasonLabel } from "./inbox";
import { probeFindings } from "./sections";
import { dirtySections } from "./mesh-view";

describe("la configuración de Mr. Pilo, venga como venga de la base", () => {
  it("sin la migración 0090 (sin proveedor) no se rompe: usa Mistral y lo avisa", () => {
    const s = normalizeSettings({ enabled: true, base_url: "", voice_rate: "1.1", functions: { explicar: false }, portals: { cifras: { on: false, aud: "sesion", fns: [] } } });
    expect(s.provider).toBe("mistral");
    expect(s.needs0090).toBe(true);
    expect(s.voice_rate).toBe(1.1);
    expect(s.functions).toEqual({ leer: true, resumir: true, sintetizar: true, explicar: false, preguntar: true });
    expect(s.portals.cifras.on).toBe(false);
    expect(s.portals.impacto.aud).toBe("admin");
    // Sin 0094, Pregúntele a Pilo queda cerrada y con todas sus memorias, y no se manda al guardar.
    expect(s.needs0094).toBe(true);
    expect(s.portals.pregunta).toEqual({ on: false, aud: "publico", fns: ["preguntar"] });
    expect(s.memory_sources).toEqual({ cifras: true, boletines: true, pdi: true, observatorio: true, impacto: true });
    expect(s.pregunta_welcome).toBe(true);
    // Sin dirección ni modelo, los de Mistral (no un texto de ejemplo vacío).
    expect(s.base_url).toBe("https://api.mistral.ai/v1");
    expect(s.text_model).toBe("mistral-small-latest");
  });

  it("con 0090, respeta lo guardado", () => {
    const s = normalizeSettings({ provider: "freeai", speech_provider: "otro", voice_engine: "proveedor" });
    expect(s).toMatchObject({ provider: "freeai", speech_provider: "otro", voice_engine: "proveedor", needs0090: false });
  });

  it("la voz de NVIDIA (0101): sin la migración, español y calidad media; con ella, lo guardado", () => {
    const before = normalizeSettings({ provider: "nvidia" });
    expect(before).toMatchObject({ needs0101: true, voice_language: "es-US", voice_quality: 20, voice_styles: [], voice_portal_styles: {} });
    const style = { id: "cercano", name: "Cercano", path: "muestras/cercano.wav", seconds: 5 };
    const after = normalizeSettings({ speech_provider: "nvidia", voice_styles: [style], voice_style: "cercano", voice_quality: 30, voice_portal_styles: { pregunta: "cercano" } });
    expect(normalizeSettings({ speech_provider: "fishaudio", fish_model: "s1" })).toMatchObject({ speech_provider: "fishaudio", fish_model: "s1", needs0102: false });
    expect(before).toMatchObject({ fish_model: "s2.1-pro-free", needs0102: true });
    expect(after).toMatchObject({ needs0101: false, speech_provider: "nvidia", voice_styles: [style], voice_quality: 30, voice_portal_styles: { pregunta: "cercano" } });
  });

  it("pilo-ia siempre (0110): sin la migración, los valores de partida y se avisa", () => {
    const s = normalizeSettings({ provider: "nvidia" });
    expect(s).toMatchObject({ needs0110: true, ask_temperature: 0.3, ask_max_tokens: 800, ask_context_tokens: 3500, ask_history_turns: 6, system_role: "auto", ask_stream: true, voice_daily_limit: 1500, visitor_limit: 20, visitor_window_seconds: 600 });
  });

  it("con 0110 respeta lo guardado, dentro del margen de la base", () => {
    const s = normalizeSettings({ ask_max_tokens: 1200, ask_temperature: "0.5", system_role: "user", ask_stream: false, visitor_limit: 0, visitor_window_seconds: 30, voice_daily_limit: 99999999, ask_history_turns: -3 });
    expect(s).toMatchObject({ needs0110: false, ask_max_tokens: 1200, ask_temperature: 0.5, system_role: "user", ask_stream: false, visitor_limit: 0, visitor_window_seconds: 30, voice_daily_limit: 100000, ask_history_turns: 0 });
    expect(normalizeSettings({ ask_max_tokens: 800, system_role: "otro" }).system_role).toBe("auto");
  });

  it("clampAsk: entero y dentro del margen; lo que no es número, a la partida", () => {
    expect(clampAsk("ask_max_tokens", 50)).toBe(100);
    expect(clampAsk("ask_max_tokens", 2500.6)).toBe(2000);
    expect(clampAsk("ask_max_tokens", 640.4)).toBe(640);
    expect(clampAsk("ask_temperature", 0.35)).toBe(0.35);
    expect(clampAsk("visitor_limit", "abc")).toBe(ASK_LIMITS.visitor_limit.def);
  });

  it("los ajustes nuevos marcan su sección como cambiada", () => {
    const a = normalizeSettings({ ask_max_tokens: 800, daily_limit: 200 });
    expect(dirtySections({ ...a, ask_temperature: 0.7 }, a)).toEqual(["pregunta"]);
    expect(dirtySections({ ...a, voice_daily_limit: 10 }, a)).toEqual(["uso"]);
  });

  it("la prueba de conexión: lee solo lo que conoce y tolera una función anterior", () => {
    expect(parseProbe({ ok: true, ms: 420 })).toEqual({ ok: true, ms: 420 });
    expect(probeFindings(parseProbe({ ok: true, ms: 420 }))).toEqual([]);
    const p = parseProbe({ ok: true, ms: 9, system_role: "user", stream: "json", reasoning: true, finish: "stop", extra: 1 });
    expect(p).toEqual({ ok: true, ms: 9, system_role: "user", stream: "json", reasoning: true, finish: "stop" });
    const f = probeFindings(p);
    expect(f.map((x) => [x.id, x.tone])).toEqual([["rol", "warn"], ["partes", "warn"], ["razonamiento", "warn"]]);
    expect(probeFindings(parseProbe({ ok: true, system_role: "system", stream: "sse", reasoning: false })).every((x) => x.tone === "ok")).toBe(true);
    expect(probeFindings(parseProbe({ ok: true, stream: "error", stream_error: "tiempo" }))[0]).toMatchObject({ tone: "fail", detail: "tiempo" });
  });

  it("la bandeja entiende el motivo «general» y no se rompe con uno desconocido", () => {
    expect(reasonLabel("general")).toBe("Respondió de conocimiento general");
    expect(reasonHint("general")).toContain("conocimiento general");
    expect(reasonLabel("nuevo")).toBe("nuevo");
    expect(reasonHint("nuevo")).toBe("");
  });
});
