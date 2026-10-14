import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_PATTERNS,
  enrichSpokenSentences,
  modulateVoice,
  normalizeMood,
  pickMicroexpression,
} from "./voice-expressions";

describe("voice-expressions", () => {
  it("normaliza emociones desconocidas o variantes a las 5 principales", () => {
    expect(normalizeMood("feliz")).toBe("emocionado");
    expect(normalizeMood("alegre")).toBe("emocionado");
    expect(normalizeMood("loco")).toBe("atrevido");
    expect(normalizeMood("curioso")).toBe("atrevido");
    expect(normalizeMood("advertencia")).toBe("cuidado");
    expect(normalizeMood("duda")).toBe("pensar");
    expect(normalizeMood("algo_raro")).toBe("atento");
    expect(normalizeMood(null)).toBe("atento");
  });

  it("selecciona microexpresiones acordes a la emoción", () => {
    const opener = pickMicroexpression("emocionado", DEFAULT_VOICE_PATTERNS, "pregunta de prueba");
    expect(opener).toBeTruthy();
    expect(DEFAULT_VOICE_PATTERNS.emocionado).toContain(opener);
  });

  it("modula velocidad y tono según la emoción", () => {
    const excited = modulateVoice("emocionado", 1.0, 1.0);
    expect(excited.rate).toBeGreaterThan(1.0);
    expect(excited.pitch).toBeGreaterThan(1.0);

    const careful = modulateVoice("cuidado", 1.0, 1.0);
    expect(careful.rate).toBeLessThan(1.0);
    expect(careful.pitch).toBeLessThan(1.0);

    const attentive = modulateVoice("atento", 1.0, 1.0);
    expect(attentive.rate).toBe(1.0);
    expect(attentive.pitch).toBe(1.0);
  });

  it("enriquece la primera frase oral anteponiendo la microexpresión", () => {
    const raw = ["La UDES cuenta con 14.500 estudiantes en 2025.", "En Bucaramanga están la mayoría."];
    const res = enrichSpokenSentences(raw, {
      mood: "emocionado",
      expressionsEnabled: true,
      modulationEnabled: true,
    });

    expect(res.sentences.length).toBe(2);
    expect(res.openerUsed).toBeTruthy();
    expect(res.sentences[0].startsWith(res.openerUsed!)).toBe(true);
    expect(res.sentences[1]).toBe(raw[1]);
    expect(res.rate).toBeGreaterThan(1.0);
  });

  it("no duplica microexpresiones si la frase ya empieza con un saludo o exclamación", () => {
    const raw = ["¡Hola! La UDES cuenta con 14.500 estudiantes.", "Están en 3 sedes."];
    const res = enrichSpokenSentences(raw, {
      mood: "emocionado",
      expressionsEnabled: true,
    });

    expect(res.openerUsed).toBeUndefined();
    expect(res.sentences[0]).toBe(raw[0]);
  });

  it("respeta cuando las microexpresiones o modulación están desactivadas", () => {
    const raw = ["La UDES cuenta con 14.500 estudiantes."];
    const res = enrichSpokenSentences(raw, {
      mood: "emocionado",
      expressionsEnabled: false,
      modulationEnabled: false,
      baseRate: 1.0,
      basePitch: 1.0,
    });

    expect(res.openerUsed).toBeUndefined();
    expect(res.sentences[0]).toBe(raw[0]);
    expect(res.rate).toBe(1.0);
    expect(res.pitch).toBe(1.0);
  });
});
