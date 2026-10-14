import { describe, expect, it } from "vitest";
import { derivePhase, friendlyAuthError, friendlyPasswordError, fromOfState, isRecoveryRequest, newPasswordProblem, passwordRules, safeRedirect } from "./login-logic";

describe("safeRedirect", () => {
  it("acepta rutas internas con query y hash", () => {
    expect(safeRedirect("/admin/pilo/usuarios")).toBe("/admin/pilo/usuarios");
    expect(safeRedirect("/admin/pilo?x=1#a")).toBe("/admin/pilo?x=1#a");
  });
  it("rechaza lo que no es cadena", () => {
    expect(safeRedirect(undefined)).toBe("/admin");
    expect(safeRedirect(42)).toBe("/admin");
    expect(safeRedirect({})).toBe("/admin");
  });
  it("rechaza URLs externas y relativas al protocolo", () => {
    expect(safeRedirect("https://malo.com")).toBe("/admin");
    expect(safeRedirect("//malo.com")).toBe("/admin");
    expect(safeRedirect("/\\malo.com")).toBe("/admin");
    expect(safeRedirect("admin")).toBe("/admin");
    expect(safeRedirect("/a\nb")).toBe("/admin");
  });
  it("no vuelve al propio acceso ni a la raíz", () => {
    expect(safeRedirect("/acceso-intranet")).toBe("/admin");
    expect(safeRedirect("/acceso-intranet/?x=1")).toBe("/admin");
    expect(safeRedirect("/")).toBe("/admin");
  });
  it("respeta un home distinto", () => {
    expect(safeRedirect(null, "/inicio")).toBe("/inicio");
  });
});

describe("fromOfState", () => {
  it("lee una cadena", () => expect(fromOfState({ from: "/admin/x" })).toBe("/admin/x"));
  it("lee un objeto location", () =>
    expect(fromOfState({ from: { pathname: "/admin/x", search: "?a=1", hash: "#h" } })).toBe("/admin/x?a=1#h"));
  it("tolera estado vacío", () => {
    expect(fromOfState(null)).toBeUndefined();
    expect(fromOfState("x")).toBeUndefined();
  });
});

describe("friendlyAuthError", () => {
  it("traduce credenciales inválidas", () =>
    expect(friendlyAuthError("Invalid login credentials")).toMatch(/no coinciden/));
  it("traduce límite de intentos y red", () => {
    expect(friendlyAuthError("Too many requests")).toMatch(/demasiados/);
    expect(friendlyAuthError("Failed to fetch")).toMatch(/conexión/);
  });
  it("tiene mensaje por defecto", () => expect(friendlyAuthError("")).toMatch(/No se pudo/));
});

describe("derivePhase", () => {
  const base = { pending: false, error: false, leaving: false, noAccess: false, typing: false };
  it("reposo por defecto", () => expect(derivePhase(base)).toBe("reposo"));
  it("escribiendo", () => expect(derivePhase({ ...base, typing: true })).toBe("escribiendo"));
  it("verificando gana a escribiendo", () => expect(derivePhase({ ...base, typing: true, pending: true })).toBe("verificando"));
  it("error", () => expect(derivePhase({ ...base, error: true })).toBe("error"));
  it("éxito gana a todo", () => expect(derivePhase({ ...base, error: true, leaving: true })).toBe("exito"));
  it("sin acceso", () => expect(derivePhase({ ...base, noAccess: true })).toBe("sin-acceso"));
});

describe("modo definir contraseña", () => {
  it("detecta ?clave=1", () => {
    expect(isRecoveryRequest("?clave=1")).toBe(true);
    expect(isRecoveryRequest("?a=2&clave=1")).toBe(true);
    expect(isRecoveryRequest("?clave=0")).toBe(false);
    expect(isRecoveryRequest("")).toBe(false);
    expect(isRecoveryRequest(undefined)).toBe(false);
  });
  it("reglas de la contraseña", () => {
    expect(passwordRules("abc").every((r) => r.met)).toBe(false);
    expect(passwordRules("abcdefg1").every((r) => r.met)).toBe(true);
    expect(passwordRules("12345678").find((r) => r.id === "letra")?.met).toBe(false);
  });
  it("problemas en orden", () => {
    expect(newPasswordProblem("corta1", "corta1")?.field).toBe("password");
    expect(newPasswordProblem("sololetrasaqui", "sololetrasaqui")?.message).toMatch(/número/);
    expect(newPasswordProblem("buenaclave1", "otraclave1")?.field).toBe("confirm");
    expect(newPasswordProblem("buenaclave1", "buenaclave1")).toBeNull();
  });
  it("mensajes de updateUser", () => {
    expect(friendlyPasswordError("New password should be different from the old password.")).toMatch(/distinta/);
    expect(friendlyPasswordError("Auth session missing")).toMatch(/venció/);
    expect(friendlyPasswordError("Password is too weak")).toMatch(/débil/);
    expect(friendlyPasswordError(null)).toMatch(/No se pudo/);
  });
  it("fase clave solo si no hay algo más urgente", () => {
    const base = { pending: false, error: false, leaving: false, noAccess: false, typing: false, recovery: true };
    expect(derivePhase(base)).toBe("clave");
    expect(derivePhase({ ...base, typing: true })).toBe("escribiendo");
    expect(derivePhase({ ...base, error: true })).toBe("error");
  });
});
