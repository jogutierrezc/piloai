import { describe, expect, it } from "vitest";
import { styleId, toPcm16, trimSilence } from "./voice-sample";

const RATE = 22050;

describe("las muestras de la voz de NVIDIA", () => {
  it("quita el silencio de los extremos y deja un margen", () => {
    const samples = new Float32Array(RATE * 4);
    // 1 s de silencio, 2 s de «voz», 1 s de silencio.
    for (let i = RATE; i < RATE * 3; i++) samples[i] = Math.sin(i / 5) * 0.5;
    const trimmed = trimSilence(samples, RATE);
    const seconds = trimmed.length / RATE;
    expect(seconds).toBeGreaterThan(2);
    expect(seconds).toBeLessThan(2.4);
    expect(trimSilence(new Float32Array(RATE), RATE)).toHaveLength(0);
  });

  it("lleva el pico a 0,9 en PCM de 16 bits", () => {
    const pcm = toPcm16(new Float32Array([0, 0.25, -0.5]));
    const view = new DataView(pcm.buffer);
    expect(pcm.length).toBe(6);
    expect(view.getInt16(0, true)).toBe(0);
    expect(view.getInt16(2, true)).toBe(Math.round(0.45 * 0x7fff));
    expect(view.getInt16(4, true)).toBe(Math.round(-0.9 * 0x8000));
  });

  it("da un id corto y sin repetir al estilo", () => {
    expect(styleId("Pilo cercano", [])).toBe("pilo-cercano");
    expect(styleId("Formal", ["formal"])).toBe("formal-2");
    expect(styleId("¡Ánimo!", [])).toBe("animo");
    expect(styleId("   ", [])).toBe("voz");
  });
});
