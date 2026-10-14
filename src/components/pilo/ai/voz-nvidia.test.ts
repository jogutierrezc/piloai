import { describe, expect, it } from "vitest";
import { RIVA_RATE, fishModel, fishText, fishVoiceId, looksLikeFunctionId, pbFields, readWav, rivaAudio, rivaRequest, speechChunks, styleFor, wavFile } from "./logic";
import type { VoiceStyle } from "./logic";

const decode = (b: number | Uint8Array) => new TextDecoder().decode(b as Uint8Array);

/** Una respuesta gRPC como la de Riva: SynthesizeSpeechResponse {audio=1} enmarcada. */
function frame(audio: Uint8Array) {
  const message = new Uint8Array([0x0a, audio.length, ...audio]);
  const out = new Uint8Array(5 + message.length);
  new DataView(out.buffer).setUint32(1, message.length);
  out.set(message, 5);
  return out;
}

describe("la voz de NVIDIA (gRPC de Riva sobre fetch)", () => {
  it("arma el pedido de Synthesize con la muestra de voz", () => {
    const pcm = new Uint8Array(300).fill(7);
    const req = rivaRequest({ text: "Hola, soy Pilo.", language: "es-US", prompt: { pcm, rate: 22050 }, quality: 99 });
    expect(req[0]).toBe(0);
    const length = new DataView(req.buffer).getUint32(1);
    expect(length).toBe(req.length - 5);
    const fields = pbFields(req.subarray(5));
    expect(decode(fields.find((f) => f.field === 1)!.value)).toBe("Hola, soy Pilo.");
    expect(decode(fields.find((f) => f.field === 2)!.value)).toBe("es-US");
    expect(fields.find((f) => f.field === 3)!.value).toBe(1);
    expect(fields.find((f) => f.field === 4)!.value).toBe(RIVA_RATE);
    const zero = pbFields(fields.find((f) => f.field === 6)!.value as Uint8Array);
    expect((zero.find((f) => f.field === 1)!.value as Uint8Array).length).toBe(300);
    expect(zero.find((f) => f.field === 2)!.value).toBe(22050);
    // La calidad va de 1 a 40.
    expect(zero.find((f) => f.field === 4)!.value).toBe(40);
  });

  it("sin muestra ni voz, no manda esos campos", () => {
    const fields = pbFields(rivaRequest({ text: "Hola", language: "es-US" }).subarray(5));
    expect(fields.map((f) => f.field)).toEqual([1, 2, 3, 4]);
  });

  it("saca el audio de una o varias respuestas y nada de una vacía", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([5, 6]);
    expect([...rivaAudio(frame(a))!]).toEqual([1, 2, 3, 4]);
    const two = new Uint8Array([...frame(a), ...frame(b)]);
    expect([...rivaAudio(two)!]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rivaAudio(new Uint8Array())).toBeNull();
  });

  it("lee y escribe WAV de 16 bits", () => {
    const pcm = new Uint8Array([1, 0, 2, 0, 3, 0]);
    const wav = wavFile(pcm, 22050);
    const back = readWav(wav)!;
    expect(back.rate).toBe(22050);
    expect(back.channels).toBe(1);
    expect([...back.pcm]).toEqual([...pcm]);
    expect(readWav(new Uint8Array(50))).toBeNull();
  });

  it("parte el texto por frases sin pasar del máximo", () => {
    const text = "Primera frase. ¿Segunda pregunta? " + "palabra ".repeat(80) + "fin.";
    const chunks = speechChunks(text, 120);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " ").trim());
    expect(chunks[0]).toBe("Primera frase. ¿Segunda pregunta?");
    expect(speechChunks("   ")).toEqual([]);
  });

  it("elige el estilo: el de la prueba, el del portal o el de siempre", () => {
    const styles: VoiceStyle[] = [
      { id: "cercano", name: "Cercano", path: "muestras/cercano.wav", seconds: 5 },
      { id: "formal", name: "Formal", path: "muestras/formal.wav", seconds: 6 },
    ];
    expect(styleFor(styles, "pregunta", { pregunta: "formal" }, "cercano")?.id).toBe("formal");
    expect(styleFor(styles, "cifras", { pregunta: "formal" }, "cercano")?.id).toBe("cercano");
    expect(styleFor(styles, "prueba", {}, "cercano", "formal")?.id).toBe("formal");
    // Fuera de la prueba no se puede pedir otro estilo.
    expect(styleFor(styles, "pregunta", {}, "cercano", "formal")?.id).toBe("cercano");
    expect(styleFor(styles, "pregunta", {}, "borrado")?.id).toBe("cercano");
    expect(styleFor([], "pregunta", {}, "")).toBeNull();
  });

  it("reconoce un function-id", () => {
    expect(looksLikeFunctionId("877104f7-e885-42b9-8de8-f6e4c6303969")).toBe(true);
    expect(looksLikeFunctionId("magpie")).toBe(false);
  });
});

describe("la voz de Fish Audio", () => {
  it("pone el tono al comienzo de cada frase y lo limpia", () => {
    expect(fishText("Hola. Soy Pilo.", "calm")).toBe("[calm] Hola. [calm] Soy Pilo.");
    expect(fishText("¿Cómo va el PDI?", "Soft tone!")).toBe("[soft tone] ¿Cómo va el PDI?");
    expect(fishText("  Hola   Pilo ", "")).toBe("Hola Pilo");
    expect(fishText("Hola", "]] [x")).toBe("[x] Hola");
  });

  it("usa un modelo conocido o el gratuito", () => {
    expect(fishModel("s1")).toBe("s1");
    expect(fishModel("")).toBe("s2.1-pro-free");
    expect(fishModel("otro")).toBe("s2.1-pro-free");
  });

  it("saca el id de la voz aunque se pegue el enlace", () => {
    const id = "802e3bc2b27e49c2995d23ef70e6ac89";
    expect(fishVoiceId(id)).toBe(id);
    expect(fishVoiceId(`https://fish.audio/m/${id.toUpperCase()}/`)).toBe(id);
    expect(fishVoiceId("pilo")).toBe("");
  });
});
