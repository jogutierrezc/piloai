import { describe, expect, it } from "vitest";
import { redactPersonal } from "./redact";

describe("redactPersonal", () => {
  it("tapa correos", () => {
    expect(redactPersonal("Escriba a ana.lopez+x@udes.edu.co hoy")).toEqual({ text: "Escriba a [dato omitido] hoy", count: 1 });
  });

  it("tapa teléfonos con y sin indicativo", () => {
    const out = redactPersonal("Cel 300 123 4567, +57 3001234567 y fijo (607) 123 4567.");
    expect(out.text).not.toMatch(/\d{3}/);
    expect(out.count).toBe(3);
  });

  it("tapa documentos con rótulo y números largos", () => {
    const out = redactPersonal("C.C. 1098765432; NIT 890.200.000-1; código 1.098.765.432; id 12345678901.");
    expect(out.text).not.toMatch(/\d{5}/);
    expect(out.count).toBeGreaterThanOrEqual(4);
  });

  it("deja en paz años, porcentajes y cifras cortas", () => {
    const text = "En 2026 hubo 1.250 estudiantes (35,5 %) en 12 programas, acuerdo 024 de 2019.";
    expect(redactPersonal(text)).toEqual({ text, count: 0 });
  });
});
