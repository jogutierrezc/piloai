import { describe, expect, it } from "vitest";
import {
  activeNavId,
  buildStaffNav,
  forbiddenMessage,
  guardDecision,
  initials,
  primarySpace,
  shouldTouch,
  TOUCH_EVERY_MS,
  safeReturnPath,
} from "./staff-access";
import { canUseArea, STAFF_ROLES } from "./pilo-staff";

describe("guardDecision", () => {
  const base = { loading: false, signedIn: true, role: "admin" as const, area: "personal" as const };
  it("espera mientras se resuelve la sesión", () => {
    expect(guardDecision({ ...base, loading: true, signedIn: false, role: null })).toBe("wait");
  });
  it("sin sesión manda al acceso", () => {
    expect(guardDecision({ ...base, signedIn: false, role: null })).toBe("login");
  });
  it("con sesión pero sin rol de Pilo, sin permiso", () => {
    expect(guardDecision({ ...base, role: null })).toBe("forbidden");
  });
  it("respeta la zona del rol", () => {
    expect(guardDecision({ ...base, role: "docencia" })).toBe("forbidden");
    expect(guardDecision({ ...base, role: "docencia", area: "documentos" })).toBe("allow");
  });
  it("respeta el espacio", () => {
    const docs = { ...base, area: "documentos" as const };
    expect(guardDecision({ ...docs, role: "docencia", space: "planeacion" })).toBe("forbidden");
    expect(guardDecision({ ...docs, role: "docencia", space: "ensenanza" })).toBe("allow");
    expect(guardDecision({ ...docs, role: "institucional", space: "ensenanza" })).toBe("forbidden");
    expect(guardDecision({ ...docs, role: "ambos", space: "ensenanza" })).toBe("allow");
  });
});

describe("safeReturnPath", () => {
  it("vuelve a la pantalla interna de origen", () => {
    expect(safeReturnPath("/admin/mr-pilo?seccion=voz")).toBe("/admin/mr-pilo?seccion=voz");
  });
  it("descarta destinos que no valen", () => {
    for (const from of [undefined, 3, "https://x.co", "//x.co", "/", "/acceso-intranet", "/sin-permiso/", "/sin-permiso?a=1"]) {
      expect(safeReturnPath(from)).toBe("/admin");
    }
  });
});

describe("buildStaffNav", () => {
  const ids = (role: Parameters<typeof buildStaffNav>[0]) => buildStaffNav(role).map((e) => e.id);
  it("sin rol no hay menú", () => {
    expect(buildStaffNav(null)).toEqual([]);
  });
  it("docencia solo ve su espacio, sin conexión ni personal", () => {
    expect(ids("docencia")).toEqual(["inicio", "documentos-ensenanza", "catalogo", "memoria"]);
    expect(buildStaffNav("docencia").find((e) => e.id === "catalogo")?.to).toBe("/admin/mr-pilo-ensenanza?seccion=catalogo");
  });
  it("institucional apunta a Pilo Universidad", () => {
    expect(ids("institucional")).toEqual(["inicio", "documentos-planeacion", "catalogo", "memoria"]);
  });
  it("ambos y admin tienen un Documentos por espacio", () => {
    expect(ids("ambos").filter((i) => i.startsWith("documentos"))).toEqual(["documentos-planeacion", "documentos-ensenanza"]);
    expect(ids("admin")).toContain("personal");
    expect(ids("admin")).toContain("conexion");
  });
  it("toda entrada visible la abre el contrato", () => {
    for (const role of STAFF_ROLES) {
      for (const entry of buildStaffNav(role)) expect(canUseArea(role, entry.area)).toBe(true);
    }
  });
});

describe("primarySpace", () => {
  it("prefiere Pilo Universidad", () => {
    expect(primarySpace("ambos")).toBe("planeacion");
    expect(primarySpace("docencia")).toBe("ensenanza");
    expect(primarySpace(null)).toBeNull();
  });
});

describe("activeNavId", () => {
  const nav = buildStaffNav("admin");
  it("distingue por sección", () => {
    expect(activeNavId(nav, "/admin/mr-pilo", "?seccion=portales")).toBe("portales");
    expect(activeNavId(nav, "/admin/personal", "")).toBe("personal");
    expect(activeNavId(nav, "/admin", "")).toBe("inicio");
  });
  it("sin coincidencia de sección cae en la primera de la ruta", () => {
    expect(activeNavId(nav, "/admin/mr-pilo", "")).not.toBeNull();
    expect(activeNavId(nav, "/otra", "")).toBeNull();
  });
});

describe("forbiddenMessage y initials", () => {
  it("nombra el rol", () => {
    expect(forbiddenMessage("docencia")).toContain("Docencia");
    expect(forbiddenMessage(null)).toContain("personal de Pilo");
  });
  it("dos letras siempre", () => {
    expect(initials("Ana María Gómez", "")).toBe("AG");
    expect(initials("", "luis@udes.edu.co")).toBe("LU");
    expect(initials("", "")).toBe("··");
  });
});

describe("shouldTouch", () => {
  it("anota la primera vez y luego espera el intervalo", () => {
    expect(shouldTouch(null, 1000)).toBe(true);
    expect(shouldTouch(1000, 1000 + TOUCH_EVERY_MS - 1)).toBe(false);
    expect(shouldTouch(1000, 1000 + TOUCH_EVERY_MS)).toBe(true);
  });
});
