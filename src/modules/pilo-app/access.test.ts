import { describe, expect, it } from "vitest";
import type { PiloAiConfig, SpaceConfig } from "../../components/pilo/ai/config";
import { ASK_SPACES } from "../pregunta/space";
import { extrasFor } from "../../components/pilo/ai/extras";
import { extrasRole, spaceDoor } from "./access";

const U = ASK_SPACES.planeacion;
const E = ASK_SPACES.ensenanza;

const ficha = (over: Partial<SpaceConfig> = {}): SpaceConfig => ({
  on: true,
  aud: "publico",
  welcome: true,
  ai: true,
  name: "Mr. Pilo en Enseñanza",
  greeting: "",
  askRol: true,
  roles: { estudiante: { suggestions: [], expression: "", mood: "" }, profesor: { suggestions: [], expression: "", mood: "" } },
  sources: {},
  widget: { on: false, origins: [] },
  ...over,
});

const rules = (over: Partial<PiloAiConfig> = {}): PiloAiConfig =>
  ({
    enabled: true,
    functions: { leer: true, resumir: true, sintetizar: true, explicar: true, preguntar: true },
    portals: { pregunta: { on: true, aud: "publico", fns: ["preguntar", "leer"] } },
    voiceEngine: "proveedor",
    speechReady: true,
    voiceRate: 1.05,
    voicePitch: 1,
    voiceExpressions: true,
    voiceModulation: true,
    voicePatterns: {},
    pregunta: { on: true, aud: "publico", welcome: true, ai: true },
    widget: { on: false, origins: [] },
    spaces: { ensenanza: ficha() },
    spacesReady: true,
    ...over,
  }) as PiloAiConfig;

describe("quién entra a cada Pilo en la app: lo mismo que en su página", () => {
  it("abierto al público: cualquiera pregunta, con sesión o sin ella", () => {
    expect(spaceDoor(rules(), U, null).state).toBe("abierto");
    expect(spaceDoor(rules(), E, null).state).toBe("abierto");
    expect(spaceDoor(rules(), E, "consulta").state).toBe("abierto");
  });

  it("cada Pilo se abre con lo suyo: la Universidad con «pregunta», Enseñanza con su ficha", () => {
    const closedU = rules({ pregunta: { on: false, aud: "publico", welcome: true, ai: true } });
    expect(spaceDoor(closedU, U, null).state).toBe("cerrado");
    expect(spaceDoor(closedU, E, null).state).toBe("abierto");
    const closedE = rules({ spaces: { ensenanza: ficha({ on: false }) } });
    expect(spaceDoor(closedE, U, null).state).toBe("abierto");
    expect(spaceDoor(closedE, E, null)).toMatchObject({ state: "cerrado", message: E.gate.closed });
  });

  it("para quienes tienen sesión: sin sesión pide iniciarla; con sesión, entra", () => {
    const r = rules({ pregunta: { on: true, aud: "sesion", welcome: true, ai: true } });
    expect(spaceDoor(r, U, null)).toMatchObject({ state: "sesion", message: U.gate.login });
    expect(spaceDoor(r, U, "consulta").state).toBe("abierto");
  });

  it("una cuenta de Pilo activa cuenta como sesión, sin rol de intranet (0120)", () => {
    const r = rules({ pregunta: { on: true, aud: "sesion", welcome: true, ai: true }, spaces: { ensenanza: ficha({ aud: "sesion" }) } });
    expect(spaceDoor(r, U, null, false).state).toBe("sesion");
    expect(spaceDoor(r, U, null, true).state).toBe("abierto");
    expect(spaceDoor(r, E, null, true).state).toBe("abierto");
    // Y su voz: con sesión, la oficial.
    expect(spaceDoor(r, U, null, true).voice.advanced).toBe(true);
    expect(spaceDoor(r, U, null, false).voice.advanced).toBe(false);
    // Lo público sigue abierto con cuenta o sin ella.
    expect(spaceDoor(rules(), U, null, true).state).toBe("abierto");
  });

  it("una cuenta de Pilo nunca cuenta como administración", () => {
    const r = rules({ pregunta: { on: true, aud: "admin", welcome: true, ai: true }, spaces: { ensenanza: ficha({ aud: "admin" }) } });
    expect(spaceDoor(r, U, null, true).state).toBe("cerrado");
    expect(spaceDoor(r, E, null, true).state).toBe("cerrado");
    // Ni abre un Pilo apagado.
    expect(spaceDoor(rules({ spaces: { ensenanza: ficha({ on: false }) } }), E, null, true).state).toBe("cerrado");
  });

  it("las funciones ampliadas: una cuenta de Pilo entra como «miembro»", () => {
    expect(extrasRole(null, false)).toBeNull();
    expect(extrasRole(null, true)).toBe("miembro");
    // El rol de la intranet manda si lo hay.
    expect(extrasRole("admin", true)).toBe("admin");
    expect(extrasRole("consulta", false)).toBe("consulta");
    const all = { planeacion: { filesAud: "sesion" as const, codeAud: "admin" as const, fileMaxMb: 10 } };
    expect(extrasFor(all, "planeacion", extrasRole(null, true))).toMatchObject({ files: true, code: false });
    expect(extrasFor(all, "planeacion", extrasRole(null, false))).toMatchObject({ files: false, code: false });
    expect(extrasFor(all, "planeacion", extrasRole("admin", false))).toMatchObject({ files: true, code: true });
  });

  it("solo administración: los demás lo ven cerrado", () => {
    const r = rules({ spaces: { ensenanza: ficha({ aud: "admin" }) } });
    expect(spaceDoor(r, E, null).state).toBe("cerrado");
    expect(spaceDoor(r, E, "consulta").state).toBe("cerrado");
    expect(spaceDoor(r, E, "admin").state).toBe("abierto");
  });

  it("sin configuración (sin conexión, o sin la migración) está cerrado, y Enseñanza dice qué falta", () => {
    expect(spaceDoor(null, U, null)).toMatchObject({ state: "cerrado", message: U.gate.closed });
    expect(spaceDoor(rules({ spaces: {}, spacesReady: false }), E, "admin")).toMatchObject({ state: "cerrado", message: E.gate.missing });
    expect(spaceDoor(rules({ spaces: {} }), E, "admin")).toMatchObject({ state: "cerrado", message: E.gate.closed });
  });

  it("la voz oficial: solo con el servicio listo, el Pilo abierto y permiso de voz", () => {
    expect(spaceDoor(rules(), U, null).voice).toMatchObject({ portal: "pregunta", advanced: true, rate: 1.05 });
    expect(spaceDoor(rules(), E, null).voice).toMatchObject({ portal: "ensenanza", advanced: true });
    expect(spaceDoor(rules({ speechReady: false }), U, null).voice.advanced).toBe(false);
    // Un Pilo cerrado no habla, aunque el servicio de voz esté listo.
    expect(spaceDoor(rules({ spaces: { ensenanza: ficha({ on: false }) } }), E, null).voice.advanced).toBe(false);
    expect(spaceDoor(null, U, null).voice.advanced).toBe(false);
  });

  it("la ficha del espacio viaja con la puerta (su nombre, si pregunta el rol)", () => {
    expect(spaceDoor(rules(), U, null).cfg).toBeNull();
    expect(spaceDoor(rules(), E, null).cfg).toMatchObject({ name: "Mr. Pilo en Enseñanza", askRol: true });
  });
});
