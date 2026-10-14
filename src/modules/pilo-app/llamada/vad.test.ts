import { describe, expect, it } from "vitest";
import { rms, VoiceGate } from "./vad";

const feed = (gate: VoiceGate, level: number, ms: number, step = 40) => {
  const events: string[] = [];
  for (let t = 0; t < ms; t += step) {
    const e = gate.push(level, step);
    if (e) events.push(e);
  }
  return events;
};

describe("rms", () => {
  it("mide el nivel de un bloque", () => {
    expect(rms([])).toBe(0);
    expect(rms([0, 0, 0])).toBe(0);
    expect(rms([0.5, -0.5, 0.5, -0.5])).toBeCloseTo(0.5);
  });
});

describe("VoiceGate", () => {
  it("el silencio y el murmullo no son voz", () => {
    const gate = new VoiceGate();
    expect(feed(gate, 0.005, 2000)).toEqual([]);
    expect(feed(gate, 0.02, 2000)).toEqual([]);
  });

  it("una voz sostenida avisa una sola vez", () => {
    const gate = new VoiceGate();
    expect(feed(gate, 0.005, 400)).toEqual([]);
    expect(feed(gate, 0.12, 1000)).toEqual(["voz"]);
    expect(gate.voiced).toBe(true);
  });

  it("un golpe corto no cuenta", () => {
    const gate = new VoiceGate({ hold: 180 });
    expect(feed(gate, 0.2, 80)).toEqual([]);
    expect(feed(gate, 0.005, 600)).toEqual([]);
  });

  it("tras la voz, el silencio la cierra", () => {
    const gate = new VoiceGate({ release: 500 });
    feed(gate, 0.12, 400);
    expect(feed(gate, 0.004, 300)).toEqual([]);
    expect(feed(gate, 0.004, 400)).toEqual(["calla"]);
    expect(gate.voiced).toBe(false);
  });

  it("en un cuarto ruidoso el umbral sube y el ruido deja de ser voz", () => {
    const gate = new VoiceGate();
    const quiet = gate.threshold;
    feed(gate, 0.025, 6000);
    expect(gate.threshold).toBeGreaterThan(quiet);
    expect(feed(gate, 0.05, 1000)).toEqual([]);
    expect(feed(gate, 0.4, 600)).toEqual(["voz"]);
  });

  it("el eco que cae al pausar a Pilo se distingue de una voz que sigue", () => {
    const gate = new VoiceGate();
    // Eco: sube mientras Pilo suena y cae en cuanto se lo pausa.
    expect(feed(gate, 0.06, 240)).toEqual(["voz"]);
    expect(gate.loud(0.004)).toBe(false);
    // Una persona: el nivel se mantiene aunque Pilo ya esté en silencio.
    expect(gate.loud(0.09)).toBe(true);
  });
});
