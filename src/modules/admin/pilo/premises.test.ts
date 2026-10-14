import { describe, expect, it } from "vitest";
import { PREMISE_MAX, REASON_LIMITS, TRUTH_MAX, clampReason, normalizePremise, normalizeReason, premiseCounts, premiseNext, premiseProblem, premiseState, reasonPatch, reasonSummary } from "./premises";
import type { PremiseRow } from "./premises";
import { reasonSettings } from "../../../components/pilo/ai/logic";

describe("los ajustes de cómo razona Pilo, venga la fila como venga", () => {
  it("sin la migración 0130 todo queda apagado, con los topes de partida, y nada se manda a la base", () => {
    for (const raw of [null, undefined, {}, { ask_stream: true, ask_max_tokens: 800 }]) {
      const v = normalizeReason(raw);
      expect(v).toEqual({ ask_relations: false, ask_relations_lines: 12, ask_relations_chars: 1200, tricky_near: false, tricky_near_min: 0.7, ask_analysis: false, needs0130: true });
      expect(reasonPatch(v)).toBeNull();
      expect(reasonSummary(v)).toBe("Todo apagado: Pilo pide y responde como siempre.");
    }
  });

  it("con la migración, la fila recién creada también nace apagada", () => {
    const v = normalizeReason({ ask_relations: false, ask_relations_lines: 12, ask_relations_chars: 1200, tricky_near: false, tricky_near_min: 0.7, ask_analysis: false });
    expect(v).toMatchObject({ needs0130: false, ask_relations: false, tricky_near: false, ask_analysis: false });
    expect(reasonPatch(v)).toEqual({ ask_relations: false, ask_relations_lines: 12, ask_relations_chars: 1200, tricky_near: false, tricky_near_min: 0.7, ask_analysis: false });
  });

  it("un interruptor solo enciende con `true`, y lo que se sale de margen no llega a guardarse", () => {
    const v = normalizeReason({ ask_relations: "true", tricky_near: 1, ask_analysis: true, ask_relations_lines: 400, ask_relations_chars: "50", tricky_near_min: 2 });
    expect(v).toMatchObject({ ask_relations: false, tricky_near: false, ask_analysis: true, ask_relations_lines: 40, ask_relations_chars: 200, tricky_near_min: 0.99 });
    expect(reasonPatch({ ...v, ask_relations_lines: 9999, tricky_near_min: 0.123 })).toMatchObject({ ask_relations_lines: 40, tricky_near_min: 0.5 });
    expect(reasonPatch(v)).not.toHaveProperty("needs0130");
    expect(clampReason("tricky_near_min", 0.8)).toBe(0.8);
    expect(clampReason("tricky_near_min", "0.756")).toBe(0.76);
    expect(clampReason("ask_relations_lines", "")).toBe(12);
    expect(clampReason("ask_relations_lines", true)).toBe(12);
    expect(clampReason("ask_relations_lines", 7.6)).toBe(8);
  });

  it("dice en una línea lo que está encendido", () => {
    expect(reasonSummary(normalizeReason({ ask_relations: true, tricky_near: true, ask_analysis: true }))).toBe("Encendido: relaciones en el pedido, capciosas cercanas, análisis antes de responder.");
    expect(reasonSummary(normalizeReason({ ask_relations: false, ask_analysis: true }))).toBe("Encendido: análisis antes de responder.");
  });

  it("la pantalla y la función leen los mismos márgenes y las mismas partidas", () => {
    const server = reasonSettings({});
    expect(server).toMatchObject({ relationLines: REASON_LIMITS.ask_relations_lines.def, relationChars: REASON_LIMITS.ask_relations_chars.def, trickyNearMin: REASON_LIMITS.tricky_near_min.def });
    const low = reasonSettings({ ask_relations_lines: -5, ask_relations_chars: -5, tricky_near_min: -5 });
    const high = reasonSettings({ ask_relations_lines: 1e9, ask_relations_chars: 1e9, tricky_near_min: 1e9 });
    expect([low.relationLines, high.relationLines]).toEqual([REASON_LIMITS.ask_relations_lines.min, REASON_LIMITS.ask_relations_lines.max]);
    expect([low.relationChars, high.relationChars]).toEqual([REASON_LIMITS.ask_relations_chars.min, REASON_LIMITS.ask_relations_chars.max]);
    expect([low.trickyNearMin, high.trickyNearMin]).toEqual([REASON_LIMITS.tricky_near_min.min, REASON_LIMITS.tricky_near_min.max]);
  });
});

describe("las premisas de las capciosas", () => {
  const row = (over: Partial<PremiseRow> = {}): PremiseRow => ({ key: "C-001", premise: "Da por hecho que Pilo es una persona.", truth: "Pilo es una inteligencia artificial.", status: "propuesta", origin: "ia", reviewed_at: null, ...over });

  it("una fila se lee con cuidado: solo «aprobada» es aprobada", () => {
    expect(normalizePremise({ key: "C-001", premise: "p", truth: "t", status: "aprobada", origin: "admin", reviewed_at: "2026-10-04T00:00:00Z" })).toEqual({ key: "C-001", premise: "p", truth: "t", status: "aprobada", origin: "admin", reviewed_at: "2026-10-04T00:00:00Z" });
    expect(normalizePremise({ key: "C-002", status: "lista", origin: "otro", premise: 7 })).toEqual({ key: "C-002", premise: "", truth: "", status: "propuesta", origin: "ia", reviewed_at: null });
    expect(normalizePremise({ premise: "sin clave" })).toBeNull();
    expect(normalizePremise(null)).toBeNull();
  });

  it("dice en qué va, con palabra y no solo con color", () => {
    expect(premiseState(undefined)).toEqual({ tone: "off", label: "Sin premisa" });
    expect(premiseState(row())).toEqual({ tone: "warn", label: "Propuesta por la IA, sin aprobar" });
    expect(premiseState(row({ origin: "admin" }))).toEqual({ tone: "warn", label: "Sin aprobar" });
    expect(premiseState(row({ premise: "", truth: " " }))).toEqual({ tone: "off", label: "La IA no halló premisa" });
    expect(premiseState(row({ status: "aprobada" }))).toEqual({ tone: "ok", label: "Premisa aprobada" });
  });

  it("aprobar pide las dos frases; guardar sin aprobar, no; y nunca cifras de dinero ni textos fuera de margen", () => {
    expect(premiseProblem("", "", false)).toBeNull();
    expect(premiseProblem("", "", true)).toMatch(/hacen falta las dos frases/);
    expect(premiseProblem("Da por hecho que Pilo es una persona.", "no", true)).toMatch(/hacen falta/);
    expect(premiseProblem("Da por hecho que Pilo es una persona.", "Pilo es una inteligencia artificial.", true)).toBeNull();
    expect(premiseProblem("x".repeat(PREMISE_MAX + 1), "", false)).toMatch(/máximo es 400/);
    expect(premiseProblem("", "x".repeat(TRUTH_MAX + 1), false)).toMatch(/máximo es 600/);
    expect(premiseProblem("Da por hecho que el rector gana $ 20 millones.", "No se dan cifras de dinero.", true)).toMatch(/dinero/);
  });

  it("cuenta solo las capciosas en uso de ese catálogo", () => {
    const premises = { "C-001": row({ status: "aprobada" }), "C-002": row({ key: "C-002" }), "EC-009": row({ key: "EC-009", status: "aprobada" }) };
    expect(premiseCounts(["C-001", "C-002", "C-003"], premises)).toEqual({ total: 3, pending: 1, proposed: 1, approved: 1 });
    expect(premiseCounts([], premises)).toEqual({ total: 0, pending: 0, proposed: 0, approved: 0 });
  });

  it("proponer con la IA: suma cada lote y se detiene cuando termina, cuando la función lo dice o si un lote no avanza", () => {
    const start = { asked: 0, proposed: 0, empty: 0, note: "" };
    const one = premiseNext(start, { ai: true, asked: 8, proposed: 6, empty: 2, done: false });
    expect(one).toEqual({ run: { asked: 8, proposed: 6, empty: 2, note: "" }, more: true });
    expect(premiseNext(one.run, { ai: true, asked: 3, proposed: 3, empty: 0, done: true })).toEqual({ run: { asked: 11, proposed: 9, empty: 2, note: "" }, more: false });
    expect(premiseNext(one.run, { ai: true, asked: 0, proposed: 0, stopped: "formato", note: "El modelo no devolvió una respuesta que se pueda leer." })).toMatchObject({ more: false, run: { asked: 8, note: "El modelo no devolvió una respuesta que se pueda leer." } });
    expect(premiseNext(start, { ai: false, note: "Sin IA no se proponen premisas.", done: true }).more).toBe(false);
    expect(premiseNext(start, {}).more).toBe(false);
  });
});
