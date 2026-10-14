import { describe, expect, it } from "vitest";
import { buildMessages, canUse, clipSections, numbersIn, parseAnswer, verifyNumbers } from "./logic";
import type { Rules } from "./logic";

const rules: Rules = {
  enabled: true,
  functions: { leer: true, resumir: true, sintetizar: true, explicar: false },
  portals: {
    cifras: { on: true, aud: "admin", fns: ["leer", "resumir", "sintetizar", "explicar"] },
    impacto: { on: true, aud: "sesion", fns: ["leer", "sintetizar"] },
    observatorio: { on: true, aud: "publico", fns: ["leer"] },
    pdi: { on: false, aud: "publico", fns: ["leer"] },
  },
};

describe("quién puede usar a Mr. Pilo con IA", () => {
  it("la audiencia de cada portal manda", () => {
    expect(canUse(rules, "cifras", "resumir", "admin").ok).toBe(true);
    expect(canUse(rules, "cifras", "resumir", "planeacion")).toMatchObject({ ok: false, reason: /solo para la administración/ });
    expect(canUse(rules, "impacto", "sintetizar", "consulta").ok).toBe(true);
    expect(canUse(rules, "impacto", "sintetizar", null)).toMatchObject({ ok: false, reason: /Inicie sesión/ });
    expect(canUse(rules, "observatorio", "voz", null).ok).toBe(true);
  });

  it("una función apagada, un portal apagado o una función no activa en el portal, no", () => {
    expect(canUse(rules, "cifras", "explicar", "admin")).toMatchObject({ ok: false, reason: /función de Mr. Pilo está apagada/ });
    expect(canUse(rules, "pdi", "voz", "admin")).toMatchObject({ ok: false, reason: /no está activo en este portal/ });
    expect(canUse(rules, "observatorio", "resumir", "admin")).toMatchObject({ ok: false, reason: /no está activa en este portal/ });
    expect(canUse({ ...rules, enabled: false }, "cifras", "resumir", "admin")).toMatchObject({ ok: false, reason: /apagado/ });
    expect(canUse(rules, "cifras", "probar", "planeacion").ok).toBe(false);
  });
});

describe("lo que se le pide al modelo", () => {
  it("recorta las filas y dice de qué página viene", () => {
    const sections = clipSections(
      [
        { title: "Matrícula", kind: "tabla", text: "a\nb\nc\nd" },
        { title: "Sedes", kind: "tabla", text: "e\nf" },
      ],
      5,
    );
    expect(sections.map((s) => s.text)).toEqual(["a\nb\nc\nd", "e"]);
    const [system, user] = buildMessages("resumir", "Población estudiantil", sections);
    expect(system.content).toMatch(/Mr. Pilo/);
    expect(system.content).toMatch(/No inventes números/);
    expect(user.content).toMatch(/Página: Población estudiantil/);
    expect(user.content).toMatch(/### 1\. Matrícula \(tabla\)/);
  });

  it("lee el JSON aunque venga envuelto, y el texto suelto si no es JSON", () => {
    expect(parseAnswer("resumir", '```json\n{"puntos":[{"texto":"Crece","fuente":"Matrícula"}]}\n```')).toEqual({
      puntos: [{ texto: "Crece", fuente: "Matrícula" }],
    });
    expect(parseAnswer("explicar", "Es una gráfica de barras.")).toEqual({ explicacion: "Es una gráfica de barras." });
    expect(parseAnswer("resumir", "- Uno\n- Dos").puntos).toEqual([{ texto: "Uno" }, { texto: "Dos" }]);
  });
});

describe("la revisión de números", () => {
  it("normaliza miles y decimales al estilo colombiano", () => {
    expect(numbersIn("12.345 estudiantes y 78,5 %")).toEqual(["12345", "78.5"]);
  });

  it("marca los números que no están en los datos; los años y los conteos pequeños no cuentan", () => {
    const source = "Bucaramanga | 2024 | 12345\nBogotá | 2024 | 4321";
    expect(verifyNumbers("En 2024 Bucaramanga tuvo 12.345, tres veces Bogotá.", source)).toEqual({ verified: true, unknown: [] });
    expect(verifyNumbers("Bogotá tuvo 5.000 estudiantes.", source)).toEqual({ verified: false, unknown: ["5000"] });
  });
});

describe("la dirección del proveedor", () => {
  it("con Mistral, nunca pierde ni duplica el /v1", async () => {
    const { endpoint } = await import("./logic");
    expect(endpoint("mistral", "https://api.mistral.ai", "/chat/completions")).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(endpoint("mistral", "https://api.mistral.ai/v1/", "chat/completions")).toBe("https://api.mistral.ai/v1/chat/completions");
    expect(endpoint("otro", "https://x.ai/v1", "/v1/chat/completions")).toBe("https://x.ai/v1/chat/completions");
    expect(endpoint("otro", "https://x.ai/api", "/chat/completions")).toBe("https://x.ai/api/chat/completions");
  });

  it("Mistral y Free.ai traen todo puesto; un dato mal escrito no rompe nada", async () => {
    const { textTarget, speechTarget } = await import("./logic");
    expect(textTarget("mistral", "", "", "")).toEqual({ url: "https://api.mistral.ai/v1/chat/completions", model: "mistral-small-latest" });
    expect(textTarget("mistral", "https://api.mistral.ai/v1", "/chat/completions", "mistral-large-latest").model).toBe("mistral-large-latest");
    // Lo que pasó de verdad: dirección de la web y una ruta en el campo del modelo.
    expect(textTarget("freeai", "https://free.ai/api", "/audio/speech", "/tts-1")).toEqual({ url: "https://api.free.ai/v1/chat/", model: "qwen7b" });
    expect(textTarget("otro", "https://integrate.api.nvidia.com/v1/chat/completions", "/chat/completions", "google/gemma-4-31b-it").url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(textTarget("otro", "https://integrate.api.nvidia.com/v1/chat/completions/", "", "m").url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(textTarget("otro", "https://integrate.api.nvidia.com/v1", "/chat/completions/chat/completions", "m").url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(textTarget("nvidia", "https://integrate.api.nvidia.com/v1", "/chat/completions/chat/completions", "").url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
    expect(textTarget("nvidia", "", "", "")).toEqual({ url: "https://integrate.api.nvidia.com/v1/chat/completions", model: "google/gemma-4-31b-it" });
    expect(textTarget("nvidia", "", "", "meta/llama-3.3-70b-instruct").model).toBe("meta/llama-3.3-70b-instruct");
    expect(speechTarget("freeai", "https://free.ai/api", "/audio/speech", "/tts-1", "")).toEqual({
      url: "https://api.free.ai/v1/tts/",
      model: "kokoro",
      voice: "em_alex",
      format: "freeai",
    });
    expect(speechTarget("otro", "https://voz.ejemplo.ai/v1", "", "tts-1", "onyx")).toMatchObject({ url: "https://voz.ejemplo.ai/v1/audio/speech", format: "openai" });
  });
});
