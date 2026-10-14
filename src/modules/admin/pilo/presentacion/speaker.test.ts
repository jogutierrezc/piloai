import { describe, expect, it } from "vitest";
import { PRESENTATION_BEATS } from "./PiloWelcomeSpeaker";

describe("Orador de bienvenida de Mr. Pilo (Fase 0)", () => {
  it("contiene los 5 beats requeridos para la apertura de la presentación", () => {
    expect(PRESENTATION_BEATS.length).toBe(5);
  });

  it("se presenta como la Inteligencia Artificial de la Universidad de Santander (UDES)", () => {
    const intro = PRESENTATION_BEATS.find((b) => b.id === "bienvenida");
    expect(intro).toBeDefined();
    expect(intro!.say).toContain("Mr. Pilo");
    expect(intro!.say).toContain("Inteligencia Artificial de la Universidad de Santander");
    expect(intro!.say).toContain("Oficina de Planeación Institucional");
  });

  it("incluye chistes sobre sus plumas y resalta sus capacidades inimaginables", () => {
    const plumas = PRESENTATION_BEATS.find((b) => b.id === "plumas");
    expect(plumas).toBeDefined();
    expect(plumas!.say).toMatch(/plumas/i);
    expect(plumas!.say).toMatch(/pequeñ/i);
    expect(plumas!.say).toMatch(/capacidades.*inimaginables/i);
    expect(plumas!.voiceMood).toBe("atrevido");
  });

  it("declara el apoyo a la toma de decisiones y a profesores y estudiantes con integración sistémica", () => {
    const mision = PRESENTATION_BEATS.find((b) => b.id === "mision");
    expect(mision).toBeDefined();
    expect(mision!.say).toContain("toma de decisiones institucionales");
    expect(mision!.say).toContain("profesores y estudiantes");
    expect(mision!.say).toContain("sistemas de la universidad");
  });

  it("agradece y resalta el soporte tecnológico de NVIDIA y sus entornos", () => {
    const nvidia = PRESENTATION_BEATS.find((b) => b.id === "nvidia");
    expect(nvidia).toBeDefined();
    expect(nvidia!.say).toContain("NVIDIA");
    expect(nvidia!.say).toMatch(/entornos/i);
  });

  it("cierra con orgullo como piloto de innovación educativa de su alma mater la UDES", () => {
    const cierre = PRESENTATION_BEATS.find((b) => b.id === "cierre");
    expect(cierre).toBeDefined();
    expect(cierre!.say).toMatch(/piloto.*innovación educativa/i);
    expect(cierre!.say).toContain("alma mater, la UDES");
    expect(cierre!.say).toMatch(/plumas/i);
  });

  it("todos los beats cuentan con ánimos prosódicos, rostros oficiales y chips semánticos", () => {
    for (const b of PRESENTATION_BEATS) {
      expect(["emocionado", "atrevido", "pensar", "atento"]).toContain(b.voiceMood);
      expect(["feliz", "atento", "piensa", "sorpresa", "duda", "cuidado"]).toContain(b.face);
      expect(["feliz", "piensa", "idea", "bien"]).toContain(b.canvasFace);
      expect(b.chips.length).toBeGreaterThanOrEqual(3);
      expect(b.look.length).toBe(2);
      expect(b.moodLabel).toContain("Voz oficial de Pilo");
    }
  });
});
