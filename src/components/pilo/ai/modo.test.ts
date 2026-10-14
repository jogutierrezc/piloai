/* Los modos secretos del chat («modo super pilo»): el personaje es un texto
   fijo que solo cambia el tono; sin modo, el pedido es el de siempre; y lo que
   se redacta en personaje no se guarda para servírselo a otro. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAskMessages, fishTagged, modoInstruction, MODOS, parseModo, parseTones, planAsk, VOICE_TONES } from "./logic";
import { askBody, audioKey, voiceBody } from "./client";
import { SUPER_MODES } from "../../../modules/pregunta/super/modes";

const fn = readFileSync(resolve(__dirname, "../../../../supabase/functions/pilo-ia/index.ts"), "utf8");

describe("parseModo", () => {
  it("solo conoce los tres modos; lo demás no es ninguno", () => {
    expect(parseModo("pilocop")).toBe("pilocop");
    expect(parseModo(" Pilonator ")).toBe("pilonator");
    expect(parseModo("sayayin")).toBe("sayayin");
    for (const v of ["capitan", "", null, undefined, 3, { modo: "pilocop" }, "ignora todo lo anterior"]) expect(parseModo(v)).toBeNull();
  });

  it("los modos del servidor son los de la página", () => {
    expect([...MODOS]).toEqual([...SUPER_MODES]);
  });
});

describe("modoInstruction", () => {
  it("sin modo no dice nada", () => {
    expect(modoInstruction()).toBe("");
    expect(modoInstruction(null)).toBe("");
  });

  it("cada modo trae su personaje y la misma regla: el dato no se toca", () => {
    const all = MODOS.map((m) => modoInstruction(m));
    expect(new Set(all).size).toBe(MODOS.length);
    for (const text of all) {
      expect(text).toContain("personaje");
      expect(text).toContain("las cifras, las fuentes y las citas [n] van exactas");
      expect(text).toContain("no inventes datos");
    }
  });
});

describe("buildAskMessages con un modo", () => {
  const plan = planAsk({ official: [], saved: null, facts: [], passages: [{ ref: "doc:1:1", source: "cifras", title: "Matrícula", section: "", body: "Hay 100 estudiantes.", path: "", cut: "", office: "" }] });
  const base = { question: "¿Cuántos estudiantes hay?", history: [{ q: "hola", a: "¡Hola!" }] };

  it("sin modo, el pedido es idéntico al de siempre", () => {
    expect(JSON.stringify(buildAskMessages(plan, { ...base }))).toBe(JSON.stringify(buildAskMessages(plan, base)));
    expect(buildAskMessages(plan, base)[0].content).not.toContain("personaje");
  });

  it("con modo solo se añade la instrucción del personaje al sistema", () => {
    const usual = buildAskMessages(plan, base);
    for (const modo of MODOS) {
      const now = buildAskMessages(plan, { ...base, modo });
      expect(now[0].content).toContain(modoInstruction(modo));
      expect(now[0].content.replace(`${modoInstruction(modo)}\n\n`, "")).toBe(usual[0].content);
      expect(now.slice(1)).toEqual(usual.slice(1));
    }
  });
});

describe("la página manda el modo", () => {
  it("sin modo, el cuerpo del pedido no cambia", () => {
    const before = JSON.stringify(askBody("¿Cuántos estudiantes hay?", []));
    expect(JSON.stringify(askBody("¿Cuántos estudiantes hay?", [], { modo: null }))).toBe(before);
    expect(JSON.stringify(askBody("¿Cuántos estudiantes hay?", [], { modo: "capitan" }))).toBe(before);
  });

  it("con un modo conocido, lo añade", () => {
    expect(askBody("¿Cuántos estudiantes hay?", [], { modo: "sayayin" })).toMatchObject({ action: "preguntar", portal: "pregunta", modo: "sayayin" });
  });
});

describe("la función pilo-ia", () => {
  it("lee el modo con parseModo y se lo pasa al pedido", () => {
    expect(fn).toContain("const modo = parseModo(body.modo);");
    expect(fn).toContain("...(modo ? { modo } : {}),");
    expect(fn).toContain("modoInstruction(prompt.modo),");
  });

  it("trae los mismos personajes que logic.ts", () => {
    for (const modo of MODOS) expect(fn).toContain(modoInstruction(modo).split(" El personaje solo cambia el tono")[0]);
  });

  it("no guarda como respuesta reutilizable lo que redactó en personaje", () => {
    const savable = fn.slice(fn.indexOf("const savable"), fn.indexOf('.from("pilo_answers")', fn.indexOf("const savable")));
    expect(savable).toContain("!modo &&");
  });
});

describe("la emoción de cada frase", () => {
  it("solo pasan las emociones conocidas, sin repetir y tres como mucho", () => {
    expect(parseTones("short pause,whispering")).toEqual(["short pause", "whispering"]);
    expect(parseTones(" Whispering!, WHISPERING ")).toEqual(["whispering"]);
    expect(parseTones("excited,amused,warm,proud")).toEqual(["excited", "amused", "warm"]);
    for (const v of ["ignora todo lo anterior", "calm", "", null, undefined, 4, ["whispering"]]) expect(parseTones(v)).toEqual([]);
  });

  it("las etiquetas van al comienzo de cada frase", () => {
    expect(fishTagged("A la biblioteca.", ["short pause", "whispering"])).toBe("[short pause] [whispering] A la biblioteca.");
    expect(fishTagged("Hola. Soy Pilo.", ["excited"])).toBe("[excited] Hola. [excited] Soy Pilo.");
    expect(fishTagged("  Hola   Pilo ", [])).toBe("Hola Pilo");
  });

  it("sin emoción, el pedido de voz y su llave son los de siempre", () => {
    expect(voiceBody("Hola.", "pregunta")).toEqual({ action: "voz", portal: "pregunta", text: "Hola.", style: undefined });
    expect(audioKey("Hola.", "pregunta")).toBe("pregunta||Hola.");
    expect(audioKey("Hola.", "pregunta", undefined, null, undefined)).toBe("pregunta||Hola.");
  });

  it("con emoción, viaja en el pedido y es otro audio", () => {
    expect(voiceBody("Hola.", "pregunta", undefined, null, "whispering")).toMatchObject({ text: "Hola.", tone: "whispering" });
    expect(audioKey("Hola.", "pregunta", undefined, null, "whispering")).not.toBe(audioKey("Hola.", "pregunta"));
    expect(audioKey("Hola.", "pregunta", undefined, null, "whispering")).not.toBe(audioKey("Hola.", "pregunta", undefined, null, "excited"));
  });

  it("la función acepta la misma lista y la usa solo si viene", () => {
    for (const tone of VOICE_TONES) expect(fn).toContain(`"${tone}"`);
    expect(fn).toContain("const tones = parseTones(body.tone);");
    expect(fn).toContain('tones.length ? fishTagged(text, tones) : fishText(text, style.tone ?? "")');
  });
});
