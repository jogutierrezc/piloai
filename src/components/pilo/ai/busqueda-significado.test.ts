import { describe, expect, it } from "vitest";
import { EMBED_DIM, canUse, embedBody, embedModelsIn, embedTarget, fitVector, fuseHits, modelGone, parseEmbeddings, vectorText } from "./logic";
import type { Rules } from "./logic";

const vec = (x: number) => Array.from({ length: EMBED_DIM }, () => x);

describe("búsqueda por significado (0108)", () => {
  it("solo NVIDIA y Mistral dan embeddings con la clave del texto", () => {
    expect(embedTarget("nvidia")).toMatchObject({ model: "nvidia/nemotron-3-embed-1b", nvidia: true });
    expect(embedTarget("mistral")).toMatchObject({ model: "mistral-embed", nvidia: false });
    expect(embedTarget("freeai")).toBeNull();
    expect(embedTarget("otro")).toBeNull();
  });

  it("a NVIDIA le dice si es pregunta o pasaje y cuántas dimensiones", () => {
    expect(embedBody(embedTarget("nvidia")!, ["hola"], "query")).toEqual({
      model: "nvidia/nemotron-3-embed-1b",
      input: ["hola"],
      input_type: "query",
      dimensions: 1024,
      truncate: "END",
      encoding_format: "float",
    });
    expect(embedBody(embedTarget("mistral")!, ["hola"], "passage")).toEqual({ model: "mistral-embed", input: ["hola"] });
  });

  it("si el modelo no acepta dimensiones, se pide sin ellas", () => {
    expect(embedBody(embedTarget("nvidia")!, ["hola"], "passage", "plain")).toEqual({ model: "nvidia/nemotron-3-embed-1b", input: ["hola"], input_type: "passage" });
  });

  it("un vector más largo se recorta a 1024 y queda de largo 1; uno corto no sirve", () => {
    const long = Array.from({ length: 2048 }, () => 1);
    const fit = fitVector(long)!;
    expect(fit).toHaveLength(EMBED_DIM);
    expect(Math.sqrt(fit.reduce((s, x) => s + x * x, 0))).toBeCloseTo(1, 6);
    expect(fitVector(vec(0.5))).toHaveLength(EMBED_DIM);
    expect(fitVector([1, 2, 3])).toBeNull();
    expect(parseEmbeddings({ data: [{ index: 0, embedding: long }] }, 1)![0]).toHaveLength(EMBED_DIM);
  });

  it("reconoce un modelo retirado y lista los de embeddings", () => {
    expect(modelGone(410, "The model has reached its end of life")).toBe(true);
    expect(modelGone(400, "The model 'x' is no longer available")).toBe(true);
    expect(modelGone(500, "error interno")).toBe(false);
    expect(embedModelsIn({ data: [{ id: "google/gemma-4-31b-it" }, { id: "nvidia/nemotron-3-embed-1b" }, { id: "baai/bge-m3-embed" }, { id: "nvidia/nemotron-3-embed-1b" }] })).toEqual([
      "baai/bge-m3-embed",
      "nvidia/nemotron-3-embed-1b",
    ]);
    expect(embedModelsIn(null)).toEqual([]);
  });

  it("lee los vectores en el orden de lo enviado y rechaza los incompletos", () => {
    const data = { data: [{ index: 1, embedding: vec(0.2) }, { index: 0, embedding: vec(0.1) }] };
    const out = parseEmbeddings(data, 2)!;
    expect(out[0][0]).toBe(0.1);
    expect(out[1][0]).toBe(0.2);
    expect(parseEmbeddings({ data: [{ index: 0, embedding: [1, 2, 3] }] }, 1)).toBeNull();
    expect(parseEmbeddings({ data: [{ index: 0, embedding: vec(0.1) }] }, 2)).toBeNull();
    expect(parseEmbeddings({ error: "x" }, 1)).toBeNull();
    expect(parseEmbeddings({ data: [{ index: 0, embedding: [...vec(0.1).slice(1), Number.NaN] }] }, 1)).toBeNull();
  });

  it("escribe el vector como lo lee pgvector", () => {
    expect(vectorText([0.1234567, -2, 3])).toBe("[0.123457,-2,3]");
  });

  it("funde las dos búsquedas: lo que está en ambas sube", () => {
    const lexical = [
      { ref: "a", rank: 0.9 },
      { ref: "b", rank: 0.5 },
    ];
    const semantic = [
      { ref: "c", sim: 0.8 },
      { ref: "b", sim: 0.6 },
    ];
    const fused = fuseHits<{ ref: string }>(lexical, semantic);
    expect(fused.map((h) => h.ref)).toEqual(["b", "a", "c"]);
    expect(fused[0]).toMatchObject({ ref: "b", via: "ambas", sim: 0.6, rank: 1 });
    expect(fused[1]).toMatchObject({ ref: "a", via: "palabras" });
    expect(fused[1]).not.toHaveProperty("sim");
    expect(fused[2]).toMatchObject({ ref: "c", via: "significado", sim: 0.8 });
    expect(fused.every((h) => h.rank > 0 && h.rank <= 1)).toBe(true);
  });

  it("sin vectores, queda la búsqueda por palabras tal cual", () => {
    expect(fuseHits([{ ref: "a", rank: 0.9 }, { ref: "b", rank: 0.1 }], []).map((h) => [h.ref, h.via])).toEqual([
      ["a", "palabras"],
      ["b", "palabras"],
    ]);
    expect(fuseHits([], [])).toEqual([]);
  });

  it("indexar es de la administración, con la IA encendida o no", () => {
    const off: Rules = { enabled: false, functions: {}, portals: {} };
    expect(canUse(off, "", "indexar", "admin").ok).toBe(true);
    expect(canUse(off, "", "indexar", "planeacion")).toMatchObject({ ok: false, reason: /Solo la administración/ });
    expect(canUse(off, "", "indexar", null).ok).toBe(false);
  });
});
