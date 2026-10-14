import { describe, expect, it } from "vitest";
import {
  askHttpError,
  buildHistory,
  consumeAskStream,
  createSseParser,
  HISTORY_TURNS,
  PiloError,
  readAskResponse,
  retryAfterSeconds,
  toAskEvent,
} from "../../components/pilo/ai/client";
import type { AskMeta, AskThinkStep } from "../../components/pilo/ai/client";

const FINAL = { kind: "ia", text: "En 2024 hubo 20.500 estudiantes [1].", sources: [{ n: 1, ref: "cifras:matriculados", title: "Estudiantes matriculados" }], trail: [], grounding: "oficial" };
const sse = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

async function* parts(...chunks: string[]) {
  for (const c of chunks) yield c;
}

/** Un cuerpo de respuesta que entrega los trozos uno a uno. */
function streamOf(chunks: string[], options: { hang?: boolean; signal?: AbortSignal } = {}): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      options.signal?.addEventListener("abort", () => controller.error(new DOMException("Aborted", "AbortError")));
    },
    pull(controller) {
      if (i < chunks.length) controller.enqueue(encoder.encode(chunks[i++]));
      else if (!options.hang) controller.close();
      else return new Promise<void>(() => undefined);
    },
  });
}

describe("el lector del flujo (SSE)", () => {
  it("junta una línea partida entre dos trozos", () => {
    const p = createSseParser();
    const whole = sse("delta", { text: "Hola. " });
    const out = [...p.push(whole.slice(0, 9)), ...p.push(whole.slice(9, 21)), ...p.push(whole.slice(21))];
    expect(out).toEqual([{ event: "delta", data: '{"text":"Hola. "}' }]);
  });

  it("saca varios eventos de un mismo trozo, en orden", () => {
    const p = createSseParser();
    const out = p.push(sse("meta", { asked: "" }) + sse("delta", { text: "Uno. " }) + sse("delta", { text: "Dos. " }));
    expect(out.map((m) => m.event)).toEqual(["meta", "delta", "delta"]);
  });

  it("ignora los comentarios de mantenimiento y acepta CRLF", () => {
    const p = createSseParser();
    const out = p.push(': ping\r\n\r\nevent: delta\r\ndata: {"text":"Sí. "}\r\n\r\n: ping\n\n');
    expect(out).toEqual([{ event: "delta", data: '{"text":"Sí. "}' }]);
  });

  it("no parte un CRLF que llega en dos trozos", () => {
    const p = createSseParser();
    const out = [...p.push('event: delta\r'), ...p.push('\ndata: {"text":"a"}\r'), ...p.push("\n\r"), ...p.push("\n")];
    expect(out).toEqual([{ event: "delta", data: '{"text":"a"}' }]);
  });

  it("une varias líneas data y entrega lo que quedó al cerrar", () => {
    const p = createSseParser();
    expect(p.push("data: uno\ndata: dos\n")).toEqual([]);
    expect(p.flush()).toEqual([{ event: "message", data: "uno\ndos" }]);
  });

  it("un data que no es JSON, o un evento desconocido, se ignora", () => {
    expect(toAskEvent({ event: "delta", data: "{roto" })).toBeNull();
    expect(toAskEvent({ event: "delta", data: '"texto"' })).toBeNull();
    expect(toAskEvent({ event: "otro", data: "{}" })).toBeNull();
    expect(toAskEvent({ event: "done", data: '{"kind":"ia"}' })).toBeNull();
  });

  it("entiende los pasos y el razonamiento, y completa lo que falte", () => {
    expect(toAskEvent({ event: "step", data: '{"id":"cifras","label":"Consultando las cifras","state":"start"}' })).toEqual({
      type: "step",
      step: { id: "cifras", label: "Consultando las cifras", state: "start" },
    });
    expect(toAskEvent({ event: "step", data: '{"id":"cifras","label":"Consultando las cifras","detail":"2 cifras","state":"done"}' })).toMatchObject({ step: { detail: "2 cifras", state: "done" } });
    expect(toAskEvent({ event: "step", data: '{"label":"sin id","state":"start"}' })).toBeNull();
    expect(toAskEvent({ event: "thinking", data: '{"text":"Primero busco…"}' })).toEqual({ type: "thinking", text: "Primero busco…" });
    expect(toAskEvent({ event: "thinking", data: '{"text":""}' })).toBeNull();
    expect(toAskEvent({ event: "meta", data: '{"intent":"general"}' })).toEqual({ type: "meta", meta: { intent: "general", asked: "", sources: [], trail: [] } });
  });
});

describe("una respuesta que se escribe en vivo", () => {
  it("avisa meta, pasos, razonamiento y cada frase, y se cumple con el objeto final", async () => {
    const seen: string[] = [];
    let meta: AskMeta | null = null;
    const steps: AskThinkStep[] = [];
    const body =
      sse("step", { id: "memoria", label: "Buscando en lo que conozco", state: "start" }) +
      sse("step", { id: "memoria", label: "Buscando en lo que conozco", detail: "5 pasajes", state: "done" }) +
      sse("meta", { asked: "", intent: "institucional", sources: FINAL.sources, trail: [] }) +
      sse("thinking", { text: "Hay una cifra. " }) +
      ": ping\n\n" +
      sse("delta", { text: "En 2024 hubo 20.500 " }) +
      "event: delta\ndata: {mal\n\n" +
      sse("delta", { text: "estudiantes [3]. " }) +
      sse("done", FINAL);
    // En trozos de 7 caracteres: ninguna línea llega entera.
    const chunks = body.match(/[\s\S]{1,7}/g) as string[];
    const result = await consumeAskStream(parts(...chunks), {
      onMeta: (m) => (meta = m),
      onStep: (s) => steps.push(s),
      onThinking: (t) => seen.push(`(${t})`),
      onDelta: (t) => seen.push(t),
    });
    expect(result.text).toBe(FINAL.text);
    expect(result.grounding).toBe("oficial");
    expect(seen).toEqual(["(Hay una cifra. )", "En 2024 hubo 20.500 ", "estudiantes [3]. "]);
    expect((meta as AskMeta | null)?.sources).toHaveLength(1);
    expect(steps.map((s) => s.state)).toEqual(["start", "done"]);
  });

  it("un evento error se rechaza con su mensaje, tal cual", async () => {
    const run = consumeAskStream(parts(sse("delta", { text: "Hola. " }), sse("error", { message: "El proveedor de IA respondió con un error (503).", code: "proveedor" })));
    await expect(run).rejects.toMatchObject({ message: "El proveedor de IA respondió con un error (503).", code: "proveedor" });
  });

  it("un flujo que se cierra sin done queda como cortado", async () => {
    const seen: string[] = [];
    const run = consumeAskStream(parts(sse("delta", { text: "A medias. " })), { onDelta: (t) => seen.push(t) });
    await expect(run).rejects.toMatchObject({ code: "cortado" });
    expect(seen).toEqual(["A medias. "]);
  });

  it("una conexión que se cae a mitad queda como cortada", async () => {
    async function* broken() {
      yield sse("delta", { text: "Uno. " });
      throw new TypeError("network error");
    }
    await expect(consumeAskStream(broken())).rejects.toMatchObject({ code: "cortado" });
  });

  it("lee el flujo de una respuesta HTTP", async () => {
    const seen: string[] = [];
    const response = new Response(streamOf([sse("delta", { text: "Hola. " }), sse("done", FINAL)]), { headers: { "Content-Type": "text/event-stream; charset=utf-8" } });
    const result = await readAskResponse(response, { onDelta: (t) => seen.push(t) });
    expect(seen).toEqual(["Hola. "]);
    expect(result.kind).toBe("ia");
  });

  it("no parte un carácter de varios bytes entre dos trozos", async () => {
    const bytes = new TextEncoder().encode(sse("delta", { text: "Cúcuta ¿sí? " }) + sse("done", FINAL));
    const pieces: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 5) pieces.push(bytes.slice(i, i + 5));
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i < pieces.length) controller.enqueue(pieces[i++]);
        else controller.close();
      },
    });
    const seen: string[] = [];
    await readAskResponse(new Response(body, { headers: { "Content-Type": "text/event-stream" } }), { onDelta: (t) => seen.push(t) });
    expect(seen).toEqual(["Cúcuta ¿sí? "]);
  });

  it("cancelar a mitad se rechaza como cancelado y conserva lo ya avisado", async () => {
    const ctl = new AbortController();
    const seen: string[] = [];
    const response = new Response(streamOf([sse("delta", { text: "Primera frase. " })], { hang: true, signal: ctl.signal }), { headers: { "Content-Type": "text/event-stream" } });
    const run = readAskResponse(response, {
      signal: ctl.signal,
      onDelta: (t) => {
        seen.push(t);
        ctl.abort();
      },
    });
    await expect(run).rejects.toMatchObject({ code: "cancelado" });
    expect(seen).toEqual(["Primera frase. "]);
  });
});

describe("una respuesta que llega entera (JSON)", () => {
  it("se acepta aunque se haya pedido el flujo: respuestas sin modelo o una función anterior", async () => {
    const seen: string[] = [];
    const response = new Response(JSON.stringify({ kind: "regla", text: "De eso no hablo.", sources: [], trail: [] }), { headers: { "Content-Type": "application/json" } });
    const result = await readAskResponse(response, { onDelta: (t) => seen.push(t) });
    expect(result).toMatchObject({ kind: "regla", text: "De eso no hablo." });
    expect(seen).toEqual([]);
  });

  it("completa sources y trail si no vienen", async () => {
    const result = await readAskResponse(new Response(JSON.stringify({ kind: "nada", text: "No encontré eso." }), { headers: { "Content-Type": "application/json" } }));
    expect(result.sources).toEqual([]);
    expect(result.trail).toEqual([]);
  });

  it("un cuerpo que no es una respuesta se rechaza con un mensaje claro", async () => {
    await expect(readAskResponse(new Response("<html>", { headers: { "Content-Type": "text/html" } }))).rejects.toMatchObject({ code: "formato" });
    await expect(readAskResponse(new Response(JSON.stringify({ error: "Algo falló." }), { headers: { "Content-Type": "application/json" } }))).rejects.toMatchObject({ message: "Algo falló." });
  });
});

describe("los errores HTTP, en palabras de la persona", () => {
  it("429 por visitante: el mensaje del servidor y cuándo volver", async () => {
    const response = new Response(JSON.stringify({ error: "Va muy rápido: espere un momento antes de volver a preguntar.", advice: "Podrá preguntar de nuevo en 42 s.", code: "visitante", retry_after: 42 }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "42" },
    });
    const error = await readAskResponse(response).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PiloError);
    expect(error).toMatchObject({ code: "visitante", retryAfter: 42, message: "Va muy rápido: espere un momento antes de volver a preguntar. Podrá preguntar de nuevo en 42 s." });
  });

  it("429 sin cuerpo: sale de Retry-After", () => {
    expect(askHttpError(429, null, "30")).toMatchObject({ code: "limite", retryAfter: 30, message: "Va muy rápido: espere un momento antes de volver a preguntar. Podrá preguntar de nuevo en 30 s." });
    expect(askHttpError(429, null, "240").message).toContain("en 4 min.");
    expect(askHttpError(429, null, null)).toMatchObject({ retryAfter: undefined, message: "Va muy rápido: espere un momento antes de volver a preguntar." });
  });

  it("Retry-After como número o como fecha", () => {
    const now = Date.parse("2026-10-01T12:00:00Z");
    expect(retryAfterSeconds("12")).toBe(12);
    expect(retryAfterSeconds("Thu, 01 Oct 2026 12:01:00 GMT", now)).toBe(60);
    expect(retryAfterSeconds("0")).toBeUndefined();
    expect(retryAfterSeconds("pronto")).toBeUndefined();
    expect(retryAfterSeconds(null)).toBeUndefined();
  });

  it("el error de la función se muestra con su consejo", () => {
    expect(askHttpError(502, { error: "No pude buscar en lo publicado.", advice: "Intente más tarde.", code: "memoria" })).toMatchObject({ message: "No pude buscar en lo publicado. Intente más tarde.", code: "memoria" });
  });

  it("sin mensaje del servidor, uno propio por estado", () => {
    expect(askHttpError(500, null).message).toMatch(/problema al responder/);
    expect(askHttpError(504, "").message).toMatch(/tardó demasiado/);
    expect(askHttpError(413, {}).message).toMatch(/demasiado larga/);
    expect(askHttpError(403, {}).code).toBe("acceso");
    expect(askHttpError(418, {}).message).toBe("No pude hablar con Pilo ahora.");
  });
});

describe("la historia que viaja con la pregunta", () => {
  it("manda lo que la persona escribió y el texto final, del más viejo al más nuevo", () => {
    expect(buildHistory([{ q: " ¿Cuántos estudiantes hay? ", a: "20.500 [1]." }, { q: "¿y en Cúcuta?", a: "3.100 [1]." }])).toEqual([
      { q: "¿Cuántos estudiantes hay?", a: "20.500 [1]." },
      { q: "¿y en Cúcuta?", a: "3.100 [1]." },
    ]);
  });

  it("salta los turnos sin respuesta (errores, lo que se detuvo antes de escribir)", () => {
    expect(buildHistory([{ q: "uno", a: "" }, { q: "dos" }, { q: "tres", a: null }, { q: "cuatro", a: "sí" }])).toEqual([{ q: "cuatro", a: "sí" }]);
  });

  it("solo los últimos 12, con q hasta 500 y a hasta 2000 caracteres", () => {
    const turns = Array.from({ length: 15 }, (_, i) => ({ q: `p${i} ${"x".repeat(600)}`, a: `r${i} ${"y".repeat(2500)}` }));
    const h = buildHistory(turns);
    expect(h).toHaveLength(HISTORY_TURNS);
    expect(h[0].q.startsWith("p3 ")).toBe(true);
    expect(h[11].q.startsWith("p14 ")).toBe(true);
    expect(Math.max(...h.map((t) => t.q.length))).toBe(500);
    expect(Math.max(...h.map((t) => t.a.length))).toBe(2000);
  });

  it("nunca pasa del tamaño que acepta el servidor: suelta los más viejos", () => {
    // Las comillas y los saltos pesan el doble en JSON.
    const turns = Array.from({ length: 12 }, (_, i) => ({ q: `p${i}`, a: `${i}${'"\n'.repeat(1000)}` }));
    const h = buildHistory(turns);
    expect(JSON.stringify(h).length).toBeLessThanOrEqual(44_000);
    expect(h.length).toBeLessThan(12);
    expect(h[h.length - 1].q).toBe("p11");
  });
});
