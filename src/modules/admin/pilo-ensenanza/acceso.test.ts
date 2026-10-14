import { describe, expect, it } from "vitest";
import { canUseArea, canWorkInSpace } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { MOMENTS, momentsFor, parseMoment } from "./navegacion";
import { DEFAULT_TAB, TABS, TAB_AREA, parseTab, tabsFor } from "./store";

const idsFor = (role: PiloStaffRole | null) => tabsFor((a) => canUseArea(role, a)).map((t) => t.id);

describe("matriz rol × pestaña (Pilo Enseñanza)", () => {
  it("toda pestaña tiene zona", () => {
    for (const t of TABS) expect(TAB_AREA[t.id]).toBeTruthy();
  });

  it("el admin ve todas", () => {
    expect(idsFor("admin")).toEqual(TABS.map((t) => t.id));
  });

  it.each(["docencia", "institucional", "ambos"] as const)("%s solo ve memoria y catálogo", (role) => {
    expect(idsFor(role)).toEqual(["memoria", "catalogo"]);
  });

  it("sin rol no ve nada", () => {
    expect(idsFor(null)).toEqual([]);
  });
});

describe("parseTab con permisos", () => {
  it("sin lista, como siempre", () => {
    expect(parseTab("bitacora")).toBe("bitacora");
    expect(parseTab("x")).toBe(DEFAULT_TAB);
  });

  it("una prohibida cae a la primera permitida", () => {
    const allowed = idsFor("docencia");
    expect(parseTab("pregunta", allowed)).toBe("memoria");
    expect(parseTab("bitacora", allowed)).toBe("memoria");
    expect(parseTab("catalogo", allowed)).toBe("catalogo");
    expect(parseTab(null, allowed)).toBe("memoria");
  });
});

describe("espacios por rol", () => {
  it("docencia no abre planeación, institucional no abre enseñanza, ambos abre los dos", () => {
    expect(canWorkInSpace("docencia", "planeacion")).toBe(false);
    expect(canWorkInSpace("docencia", "ensenanza")).toBe(true);
    expect(canWorkInSpace("institucional", "ensenanza")).toBe(false);
    expect(canWorkInSpace("institucional", "planeacion")).toBe(true);
    expect(canWorkInSpace("ambos", "planeacion") && canWorkInSpace("ambos", "ensenanza")).toBe(true);
  });
});

describe("momentos de la memoria para el personal limitado", () => {
  it("sin «probar» (búsqueda y respuestas guardadas son del admin)", () => {
    expect(momentsFor(true).map((m) => m.id)).toEqual(["alimentar", "comprender", "mapa"]);
    expect(momentsFor(false)).toEqual(MOMENTS);
  });

  it("parseMoment cae al primero permitido", () => {
    const allowed = momentsFor(true).map((m) => m.id);
    expect(parseMoment("probar", allowed)).toBe("alimentar");
    expect(parseMoment("mapa", allowed)).toBe("mapa");
    expect(parseMoment("probar")).toBe("probar");
  });
});
