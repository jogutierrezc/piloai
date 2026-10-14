import { describe, expect, it } from "vitest";
import { WARN_AT, bannerText, limitsView, meterOf, renewText, spaceView, windowText } from "./logic";
import type { SpaceLimits } from "../carnet/api";

const base: SpaceLimits = { preguntas_max: 60, ventana_s: 600, respuesta_tokens: 1200, archivos: false, archivo_mb: 10, archivos_dia: 5, codigo: false, codigo_tokens: 2000 };

describe("los medidores", () => {
  it("avisan al 80 % y se agotan al tope", () => {
    expect(WARN_AT).toBe(0.8);
    expect(meterOf(47, 60, 100)).toMatchObject({ warn: false, spent: false, left: 13 });
    expect(meterOf(48, 60, 100)).toMatchObject({ warn: true, spent: false, left: 12 });
    expect(meterOf(60, 60, 100)).toMatchObject({ warn: true, spent: true, left: 0 });
    // Los intentos de más (la base cuenta cada pedido) no pasan del tope.
    expect(meterOf(75, 60, 100)).toMatchObject({ used: 60, left: 0 });
  });

  it("los textos de tiempo", () => {
    expect(windowText(600)).toBe("10 minutos");
    expect(windowText(3600)).toBe("1 hora");
    expect(windowText(86_400)).toBe("el día");
    expect(windowText(45)).toBe("45 segundos");
    expect(renewText(45)).toBe("45 s");
    expect(renewText(130)).toBe("3 min");
    expect(renewText(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
  });
});

describe("solo lo que existe de verdad", () => {
  it("las preguntas son un tope por ventana, y sin tope dicen «Sin tope fijo»", () => {
    const withCap = spaceView("planeacion", base, { preguntas: { usadas: 50, renueva_en: 120 }, archivos: null });
    expect(withCap.rows[0]).toMatchObject({ id: "preguntas", value: "60 cada 10 minutos" });
    expect(withCap.rows[0].meter).toMatchObject({ used: 50, warn: true });
    const open = spaceView("planeacion", { ...base, preguntas_max: 0 }, undefined);
    expect(open.rows[0]).toMatchObject({ value: "Sin tope fijo", meter: null });
    expect(open.questions).toBeNull();
  });

  it("sin uso conocido no hay barra: nunca se inventa un contador", () => {
    const view = spaceView("planeacion", base, undefined);
    expect(view.rows[0].meter).toBeNull();
    expect(view.questions).toBeNull();
  });

  it("los archivos solo aparecen con tope y tamaño si están habilitados", () => {
    const off = spaceView("planeacion", base, undefined);
    expect(off.rows.map((r) => r.id)).toEqual(["preguntas", "archivos", "codigo"]);
    expect(off.rows[1]).toMatchObject({ value: "No habilitado", off: true });
    const on = spaceView("planeacion", { ...base, archivos: true }, { preguntas: null, archivos: { usadas: 4, renueva_en: 3600 } });
    expect(on.rows.map((r) => r.id)).toEqual(["preguntas", "archivos", "archivo_mb", "codigo"]);
    expect(on.rows[1].meter).toMatchObject({ used: 4, max: 5, warn: true });
    expect(on.rows[2].value).toBe("10 MB");
    const free = spaceView("planeacion", { ...base, archivos: true, archivos_dia: 0 }, undefined);
    expect(free.rows[1]).toMatchObject({ value: "Sin tope fijo", meter: null });
  });

  it("no existen renglones de «preguntas por día» ni de minutos de llamada", () => {
    const ids = limitsView({ rol: "estudiante", campus: "", espacios: { planeacion: base, ensenanza: base } }, null).flatMap((s) => s.rows.map((r) => r.id));
    expect(ids.every((id) => ["preguntas", "archivos", "archivo_mb", "codigo"].includes(id))).toBe(true);
    expect(limitsView(null, null)).toEqual([]);
  });
});

describe("el aviso del chat", () => {
  it("solo habla desde el 80 % (o siempre, si se pide)", () => {
    expect(bannerText(null)).toBeNull();
    expect(bannerText(meterOf(10, 60, 100))).toBeNull();
    expect(bannerText(meterOf(10, 60, 100), true)).toBe("Le quedan 50 preguntas · se renuevan en 2 min");
    expect(bannerText(meterOf(48, 60, 600))).toBe("Le quedan 12 preguntas · se renuevan en 10 min");
    expect(bannerText(meterOf(59, 60, 30))).toBe("Le queda 1 pregunta · se renueva en 30 s");
    expect(bannerText(meterOf(60, 60, 30))).toMatch(/Llegó al límite/);
  });
});
