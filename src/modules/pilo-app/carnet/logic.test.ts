import { describe, expect, it } from "vitest";
import { asCode, carnetMessage, clock, needsRefresh, offsetOf, ringFraction, serverNow, stillShowable } from "./logic";
import { codeTail, detailLine, emptyPerfil, fieldsOf, parsePerfil, perfilRow, problems, progress, rhLabel, sameForm } from "./rules";
import { drawQr } from "./qr";
import { windowOf } from "./servidor-logica";

const T0 = Date.UTC(2026, 9, 9, 15, 0, 7);
const USER = "00000000-0000-4000-c000-000000000011";

describe("el reloj del carnet", () => {
  it("usa la hora del servidor, no la del teléfono", () => {
    const off = offsetOf(T0 + 90_000, T0);
    expect(off).toBe(90_000);
    expect(serverNow(off, T0)).toBe(T0 + 90_000);
  });

  it("pide otro código al cambiar la ventana, y muestra el anterior solo una ventana más", () => {
    const held = { token: "x", win: windowOf(T0) };
    expect(needsRefresh(null, T0)).toBe(true);
    expect(needsRefresh(held, T0 + 5_000)).toBe(false);
    expect(needsRefresh(held, T0 + 30_000)).toBe(true);
    expect(stillShowable(held, T0 + 30_000)).toBe(true);
    expect(stillShowable(held, T0 + 60_000)).toBe(false);
    expect(stillShowable(null, T0)).toBe(false);
  });

  it("el aro y el reloj", () => {
    expect(ringFraction(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(1);
    expect(ringFraction(Date.UTC(2026, 0, 1, 0, 0, 15))).toBe(0.5);
    expect(clock(247)).toBe("4:07");
    expect(clock(-3)).toBe("0:00");
  });

  it("cada código de la función tiene su mensaje", () => {
    expect(asCode("wallet_no_configurado")).toBe("wallet_no_configurado");
    expect(asCode("algo raro")).toBe("desconocido");
    expect(carnetMessage("wallet_no_configurado")).toMatch(/lo habilita la administración/);
    expect(carnetMessage("desconocido")).not.toBe("");
  });
});

describe("el código QR", () => {
  it("dibuja un trazo y deja la zona de silencio", () => {
    const qr = drawQr("UP1.r.AAAAAAAAAAAAAAAAAAAAAA.ab12.AAAAAAAAAAAAAAAA");
    expect(qr.size).toBeGreaterThan(21 + 8 - 1);
    expect(qr.path.startsWith("M4 4")).toBe(true);
    expect(drawQr("")).toEqual({ size: 0, path: "" });
  });
});

describe("los datos del perfil", () => {
  it("cada perfil pide sus datos obligatorios", () => {
    const required = (rol: "estudiante" | "profesor" | "administrativo") => fieldsOf(rol).filter((f) => f.required).map((f) => f.key);
    expect(required("estudiante")).toEqual(["programa", "semestre", "jornada"]);
    expect(required("profesor")).toEqual(["facultad", "vinculacion"]);
    expect(required("administrativo")).toEqual(["dependencia", "cargo"]);
  });

  it("el avance y lo que falta", () => {
    const form = { ...emptyPerfil(), programa: "Ingeniería", semestre: "5" };
    expect(progress("estudiante", form)).toEqual({ ok: 2, total: 3, full: false });
    expect(progress("estudiante", { ...form, jornada: "diurna" }).full).toBe(true);
    expect(problems("estudiante", form).jornada).toBe("Falta este dato.");
    expect(problems("estudiante", { ...form, jornada: "diurna", codigo: "a b" }).codigo).toMatch(/3 a 20/);
    expect(problems("estudiante", { ...form, jornada: "diurna", codigo: "2260000" })).toEqual({});
  });

  it("la fila que se envía: nulos para lo vacío, solo lo de su perfil y sin la suspensión", () => {
    const form = { ...emptyPerfil(), programa: "  Ingeniería  de Software ", semestre: "5", jornada: "diurna", facultad: "Ajena", codigo: "2260000", show_codigo: true, show_rh: true, rh: "" };
    const row = perfilRow(USER, "estudiante", form);
    expect(row).toMatchObject({ user_id: USER, programa: "Ingeniería de Software", semestre: 5, jornada: "diurna", facultad: null, codigo: "2260000", rh: null, show_codigo: true, show_rh: false });
    expect(row).not.toHaveProperty("suspendido_en");
  });

  it("lee la fila de la base", () => {
    const loaded = parsePerfil({ programa: "Derecho", semestre: 3, show_codigo: true, suspendido_en: "2026-10-01T00:00:00Z" });
    expect(loaded.form).toMatchObject({ programa: "Derecho", semestre: "3", show_codigo: true, show_rh: false });
    expect(loaded.suspendido).toBe(true);
    expect(parsePerfil(null).suspendido).toBe(false);
    expect(sameForm(loaded.form, { ...loaded.form, programa: " Derecho " })).toBe(true);
  });

  it("lo que dice la tarjeta", () => {
    expect(detailLine("estudiante", { ...emptyPerfil(), programa: "Derecho", semestre: "3" })).toBe("Derecho · 3.º semestre");
    expect(detailLine("profesor", { ...emptyPerfil(), facultad: "Ingenierías", vinculacion: "planta" })).toBe("Ingenierías · Planta");
    expect(codeTail("2260123")).toBe("···· 0123");
    expect(rhLabel("O-")).toBe("O−");
  });
});
