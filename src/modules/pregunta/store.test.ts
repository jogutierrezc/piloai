import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PREFIX, KEY_WELCOME, loadConversations, markWelcome, readFlag, readRol, seenWelcome, storageKey, writeFlag, writeRol } from "./store";
import { ASK_SPACES } from "./space";

/** Un localStorage de mentira: lo justo para que store.ts lea y escriba. */
function fakeStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
  };
}

const P = ASK_SPACES.planeacion.storagePrefix;
const E = ASK_SPACES.ensenanza.storagePrefix;

describe("las llaves de almacenamiento, por espacio", () => {
  it("el Pilo de siempre conserva sus llaves", () => {
    expect(DEFAULT_PREFIX).toBe("pilo-pregunta");
    expect(P).toBe(DEFAULT_PREFIX);
    expect(KEY_WELCOME).toBe("pilo-pregunta:bienvenida");
    expect(storageKey(P, "conversaciones")).toBe("pilo-pregunta:conversaciones");
    expect(storageKey(P, "bienvenida")).toBe("pilo-pregunta:bienvenida");
    expect(storageKey(P, "leer")).toBe("pilo-pregunta:leer");
    expect(storageKey(ASK_SPACES.planeacion.embedPrefix, "turnos")).toBe("pilo-embed:turnos");
    expect(storageKey(ASK_SPACES.planeacion.embedPrefix, "saludo")).toBe("pilo-embed:saludo");
    expect(storageKey(ASK_SPACES.planeacion.embedPrefix, "leer")).toBe("pilo-embed:leer");
  });

  it("Enseñanza guarda lo suyo aparte", () => {
    expect(storageKey(E, "conversaciones")).toBe("pilo-ensenanza:conversaciones");
    expect(storageKey(E, "bienvenida")).toBe("pilo-ensenanza:bienvenida");
    expect(storageKey(E, "rol")).toBe("pilo-ensenanza:rol");
    expect(storageKey(ASK_SPACES.ensenanza.embedPrefix, "turnos")).toBe("pilo-ensenanza-embed:turnos");
  });
});

describe("lo guardado en el navegador", () => {
  let storage: ReturnType<typeof fakeStorage>;
  const old = { id: "c1", title: "¿Cuántos estudiantes hay?", at: 1, turns: [{ id: "t1", q: "¿Cuántos estudiantes hay?", answer: { kind: "ia", text: "20.500 [1]." } }] };

  beforeEach(() => {
    storage = fakeStorage({ "pilo-pregunta:conversaciones": JSON.stringify([old]), "pilo-pregunta:bienvenida": "1", "pilo-pregunta:leer": "1" });
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("las conversaciones que ya había en /pregunta se siguen leyendo, sin pedir el prefijo", () => {
    const list = loadConversations();
    expect(list).toHaveLength(1);
    expect(list[0].turns[0].answer).toMatchObject({ kind: "ia", text: "20.500 [1].", sources: [], trail: [] });
    expect(loadConversations(P)).toEqual(list);
  });

  it("Enseñanza no ve las conversaciones, la bienvenida ni las preferencias de Planeación", () => {
    expect(loadConversations(E)).toEqual([]);
    expect(seenWelcome()).toBe(true);
    expect(seenWelcome(E)).toBe(false);
    expect(readFlag(P, "leer")).toBe(true);
    expect(readFlag(E, "leer")).toBe(false);
  });

  it("marcar la bienvenida de un espacio no toca la del otro", () => {
    markWelcome(true, E);
    expect(storage.data.get("pilo-ensenanza:bienvenida")).toBe("1");
    markWelcome(false);
    expect(storage.data.has("pilo-pregunta:bienvenida")).toBe(false);
    expect(seenWelcome(E)).toBe(true);
    writeFlag(E, "leer", true);
    writeFlag(P, "leer", false);
    expect(storage.data.get("pilo-ensenanza:leer")).toBe("1");
    expect(storage.data.get("pilo-pregunta:leer")).toBe("0");
  });

  it("el rol se guarda por espacio y se puede cambiar u olvidar", () => {
    expect(readRol(E)).toBeNull();
    writeRol(E, "estudiante");
    expect(storage.data.get("pilo-ensenanza:rol")).toBe("estudiante");
    expect(readRol(E)).toBe("estudiante");
    expect(readRol(P)).toBeNull();
    writeRol(E, "profesor");
    expect(readRol(E)).toBe("profesor");
    writeRol(E, "general");
    expect(readRol(E)).toBe("general");
    writeRol(E, null);
    expect(storage.data.has("pilo-ensenanza:rol")).toBe(false);
    expect(readRol(E)).toBeNull();
  });

  it("un rol guardado que no se conoce es como no haber elegido", () => {
    storage.data.set("pilo-ensenanza:rol", "rector");
    expect(readRol(E)).toBeNull();
  });
});

describe("sin almacenamiento (modo privado o bloqueado)", () => {
  it("nada falla: no recuerda, y ya", () => {
    expect(readRol(E)).toBeNull();
    expect(() => writeRol(E, "profesor")).not.toThrow();
    expect(seenWelcome(E)).toBe(false);
    expect(loadConversations(E)).toEqual([]);
  });
});
