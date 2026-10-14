import { describe, expect, it } from "vitest";
import { ASK_SPACES } from "../pregunta/space";
import { APP_ACCOUNT, APP_BASE, APP_GUEST, APP_LOGIN, APP_PATHS, APP_PILOS, APP_PROFILE, APP_SAVED, APP_SPACES, gateMode, isAppPath, linkExpired, readAppPath, startTarget, U_VISTAS, uPath } from "./routes";

describe("las rutas de la app y su Pilo", () => {
  it("cada ruta abre su espacio", () => {
    expect(readAppPath("/app")).toEqual({ kind: "inicio" });
    expect(readAppPath("/app/")).toEqual({ kind: "inicio" });
    expect(readAppPath("/app/universidad")).toEqual({ kind: "pilo", space: "planeacion" });
    expect(readAppPath("/app/ensenanza")).toEqual({ kind: "pilo", space: "ensenanza" });
    expect(readAppPath("/app/ensenanza/")).toEqual({ kind: "pilo", space: "ensenanza" });
    expect(readAppPath("/APP/Universidad")).toEqual({ kind: "pilo", space: "planeacion" });
    expect(readAppPath("/app/universidad?x=1#y")).toEqual({ kind: "pilo", space: "planeacion" });
  });

  it("la cuenta, el perfil y las guardadas son pantallas de la app (0120)", () => {
    expect(readAppPath("/app/cuenta")).toEqual({ kind: "cuenta" });
    expect(readAppPath("/app/cuenta/")).toEqual({ kind: "cuenta" });
    expect(readAppPath("/app/cuenta?confirmada=1#access_token=x")).toEqual({ kind: "cuenta" });
    expect(readAppPath("/app/perfil")).toEqual({ kind: "perfil" });
    expect(readAppPath("/app/guardadas")).toEqual({ kind: "guardadas" });
    expect(readAppPath(APP_ACCOUNT)).toEqual({ kind: "cuenta" });
    expect(readAppPath(APP_LOGIN)).toEqual({ kind: "cuenta" });
    expect(readAppPath(APP_GUEST)).toEqual({ kind: "cuenta" });
    expect(readAppPath(APP_PROFILE)).toEqual({ kind: "perfil" });
    expect(readAppPath(APP_SAVED)).toEqual({ kind: "guardadas" });
    for (const path of [APP_ACCOUNT, APP_PROFILE, APP_SAVED]) expect(isAppPath(path)).toBe(true);
    expect(readAppPath("/app/cuenta/otra")).toEqual({ kind: "otra" });
  });

  it("Mis clases y Mis notas son pantallas de la app", () => {
    expect(readAppPath("/app/clases")).toEqual({ kind: "clases" });
    expect(readAppPath("/app/notas")).toEqual({ kind: "notas" });
    expect(readAppPath("/app/notas/")).toEqual({ kind: "notas" });
    expect(readAppPath("/app/notas/2024B")).toEqual({ kind: "otra" });
    expect(isAppPath("/app/notas")).toBe(true);
  });

  it("/app/cuenta abre según lo que traiga la dirección; los enlaces del correo mandan", () => {
    expect(gateMode("")).toBe("registro");
    expect(gateMode("?entrar=1")).toBe("ingreso");
    expect(gateMode("?visita=1")).toBe("visita");
    expect(gateMode("?confirmada=1")).toBe("confirmada");
    expect(gateMode("?clave=1")).toBe("clave");
    expect(gateMode("?clave=1&entrar=1")).toBe("clave");
    expect(gateMode("?confirmada=1&code=abc")).toBe("confirmada");
    expect(gateMode("?entrar=0&otra=1")).toBe("registro");
    expect(gateMode(new URL(`https://x${APP_LOGIN}`).search)).toBe("ingreso");
    expect(gateMode(new URL(`https://x${APP_GUEST}`).search)).toBe("visita");
    // En la dirección nunca viaja un correo ni un usuario.
    for (const path of [APP_ACCOUNT, APP_LOGIN, APP_GUEST, APP_PROFILE, APP_SAVED]) expect(path).not.toMatch(/@|usuario|correo|email|user/i);
  });

  it("un enlace vencido se reconoce por lo que la plataforma deja en la dirección", () => {
    expect(linkExpired("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired")).toBe(true);
    expect(linkExpired("", "?confirmada=1&error=access_denied&error_code=otp_expired")).toBe(true);
    expect(linkExpired("#access_token=abc&refresh_token=def&type=invite")).toBe(false);
    expect(linkExpired("", "?confirmada=1")).toBe(false);
    expect(linkExpired("")).toBe(false);
  });

  it("lo que no existe dentro de la app, o no es de la app, es «otra»", () => {
    for (const path of ["/app/otra", "/app/universidad/mas", "/apple", "/pregunta", "/", ""]) expect(readAppPath(path)).toEqual({ kind: "otra" });
  });

  it("cada Pilo tiene su ruta, su nombre y su perfil", () => {
    expect(APP_BASE).toBe("/app");
    expect(APP_SPACES).toEqual(["planeacion", "ensenanza"]);
    for (const space of APP_SPACES) {
      expect(ASK_SPACES[space].id).toBe(space);
      expect(readAppPath(APP_PATHS[space])).toEqual({ kind: "pilo", space });
      expect(APP_PILOS[space].label).toMatch(/^Pilo /);
    }
    // No son las rutas de las páginas: la app tiene las suyas.
    expect(APP_PATHS.planeacion).not.toBe(ASK_SPACES.planeacion.route);
    expect(APP_PATHS.ensenanza).not.toBe(ASK_SPACES.ensenanza.route);
  });

  it("el service worker solo se registra bajo /app", () => {
    expect(isAppPath("/app")).toBe(true);
    expect(isAppPath("/app/ensenanza")).toBe(true);
    expect(isAppPath("/app?x=1")).toBe(true);
    expect(isAppPath("/apple")).toBe(false);
    expect(isAppPath("/pregunta")).toBe(false);
    expect(isAppPath("/")).toBe(false);
  });

  it("/app: la bienvenida la primera vez; después, el Pilo de la última conversación", () => {
    expect(startTarget({ seen: false, last: "ensenanza" })).toBe("bienvenida");
    expect(startTarget({ seen: false, last: null })).toBe("bienvenida");
    expect(startTarget({ seen: true, last: "ensenanza" })).toBe("ensenanza");
    expect(startTarget({ seen: true, last: "planeacion" })).toBe("planeacion");
    expect(startTarget({ seen: true, last: null })).toBe("planeacion");
    expect(startTarget({ seen: true, last: undefined })).toBe("planeacion");
  });

  it("reconoce Pilo U, sus vistas y el carnet", () => {
    expect(readAppPath("/app/u")).toEqual({ kind: "u", vista: null });
    expect(readAppPath("/app/u/")).toEqual({ kind: "u", vista: null });
    expect(readAppPath("/app/u/notas")).toEqual({ kind: "u", vista: "notas" });
    expect(readAppPath("/APP/U/Asistencia?x=1")).toEqual({ kind: "u", vista: "asistencia" });
    expect(readAppPath("/app/u/inventada")).toEqual({ kind: "otra" });
    expect(readAppPath("/app/carnet")).toEqual({ kind: "carnet" });
    expect(uPath()).toBe("/app/u");
    expect(uPath("grupos")).toBe("/app/u/grupos");
    expect(U_VISTAS.every((v) => readAppPath(uPath(v)).kind === "u")).toBe(true);
  });
});
