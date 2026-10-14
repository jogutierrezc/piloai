import { describe, expect, it } from "vitest";
import { canUseArea, STAFF_ROLES } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { DEFAULT_SECTION, parseSection, SECTION_AREA, SECTIONS, sectionsFor } from "./mesh-view";
import type { SectionId } from "./mesh-view";

const canUseOf = (role: PiloStaffRole | null) => (area: Parameters<typeof canUseArea>[1]) => canUseArea(role, area);
const idsFor = (role: PiloStaffRole | null) => sectionsFor(canUseOf(role)).map((s) => s.id);

describe("sección → zona", () => {
  it("toda sección tiene zona", () => {
    for (const s of SECTIONS) expect(SECTION_AREA[s.id]).toBeTruthy();
  });
});

describe("matriz rol × sección (Pilo Universidad)", () => {
  it("el admin ve todas, en el orden de siempre", () => {
    expect(idsFor("admin")).toEqual(SECTIONS.map((s) => s.id));
  });

  it.each(["docencia", "institucional", "ambos"] as const)("%s solo ve Memoria y Catálogo", (role) => {
    expect(idsFor(role)).toEqual(["memoria", "catalogo"]);
  });

  it("sin rol no ve nada", () => {
    expect(idsFor(null)).toEqual([]);
  });

  it("ningún rol no admin ve conexión, voz, portales, usuarios, emergencias ni uso", () => {
    const hidden: SectionId[] = ["conexion", "voz", "uso", "web", "portales", "pregunta", "usuarios", "emergencias"];
    for (const role of STAFF_ROLES.filter((r) => r !== "admin")) for (const id of hidden) expect(idsFor(role)).not.toContain(id);
  });
});

describe("parseSection con permisos", () => {
  it("sin lista, como siempre", () => {
    expect(parseSection("voz")).toBe("voz");
    expect(parseSection("nada")).toBe(DEFAULT_SECTION);
    expect(parseSection(null)).toBe(DEFAULT_SECTION);
  });

  it("una prohibida cae a la primera permitida", () => {
    const allowed = idsFor("institucional");
    for (const asked of ["conexion", "usuarios", "emergencias", "uso", "voz", "web", "portales", "pregunta"]) expect(parseSection(asked, allowed)).toBe("memoria");
  });

  it("una permitida se respeta, con mayúsculas y espacios", () => {
    expect(parseSection(" Catalogo ", idsFor("docencia"))).toBe("catalogo");
  });

  it("una desconocida o vacía cae a la primera permitida", () => {
    expect(parseSection("zzz", idsFor("ambos"))).toBe("memoria");
    expect(parseSection(undefined, idsFor("ambos"))).toBe("memoria");
  });

  it("el admin sigue cayendo en Conexión", () => {
    expect(parseSection("zzz", idsFor("admin"))).toBe("conexion");
  });
});
