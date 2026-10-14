import { describe, expect, it } from "vitest";
import { LEER_MODOS, captureLine, captureStatus, hostLabel, leerAttr, pageForQuestion, pageHeadings, pagePassages, pageRequest, pageStamp, readHostMessage, readHostPage, widgetSnippet } from "./embed";
import type { HostPage } from "./embed";

/* Leer la página anfitriona (0127): lo que el marco le pide a la página, lo que
   acepta de vuelta y lo que viaja con la pregunta. */

const PAGE: HostPage = {
  url: "https://www.udes.edu.co/admisiones",
  title: "Admisiones",
  blocks: [
    { h: true, t: "Inscripciones" },
    { h: false, t: "Las inscripciones se hacen en línea y cierran en noviembre." },
    { h: true, t: "Requisitos" },
    { h: false, t: "Documento de identidad y resultados de la prueba." },
    { h: true, t: "Becas" },
    { h: false, t: "Hay becas por excelencia académica." },
  ],
};

describe("leer la página anfitriona", () => {
  it("el pedido lleva su id y solo se acepta la respuesta de ese pedido", () => {
    expect(pageRequest("a1")).toEqual({ source: "pilo-embed", type: "leer", id: "a1" });
    const reply = { source: "pilo-host", type: "pagina", id: "a1", page: { url: "https://www.udes.edu.co/admisiones#becas", title: " Admisiones ", blocks: [{ h: 1, t: "Becas" }, { h: 0, t: "  Hay   becas. " }, { h: 0, t: "" }, "x"] } };
    expect(readHostPage(reply, "a1")).toEqual({ page: { url: "https://www.udes.edu.co/admisiones", title: "Admisiones", blocks: [{ h: true, t: "Becas" }, { h: false, t: "Hay becas." }] } });
    expect(readHostPage(reply, "otro")).toBeNull();
    expect(readHostPage({ ...reply, source: "otro" }, "a1")).toBeNull();
  });

  it("una página que no se deja leer, sin texto o con una dirección que no es de un sitio llega vacía", () => {
    expect(readHostPage({ source: "pilo-host", type: "pagina", id: "a", page: null }, "a")).toEqual({ page: null });
    expect(readHostPage({ source: "pilo-host", type: "pagina", id: "a", page: { url: "https://a.co/", blocks: [] } }, "a")).toEqual({ page: null });
    expect(readHostPage({ source: "pilo-host", type: "pagina", id: "a", page: { url: "javascript:alert(1)", blocks: [{ t: "hola a todos" }] } }, "a")).toEqual({ page: null });
  });

  it("la dirección viaja sin parámetros privados", () => {
    const reply = { source: "pilo-host", type: "pagina", id: "a", page: { url: "https://a.co/ver?id=7&token=abc&utm_source=x", blocks: [{ t: "hola a todos" }] } };
    expect(readHostPage(reply, "a")?.page?.url).toBe("https://a.co/ver?id=7");
  });

  it("cada título abre un pasaje y va en su primera línea", () => {
    expect(pagePassages(PAGE)).toEqual([
      "Inscripciones\nLas inscripciones se hacen en línea y cierran en noviembre.",
      "Requisitos\nDocumento de identidad y resultados de la prueba.",
      "Becas\nHay becas por excelencia académica.",
    ]);
    expect(pageHeadings(PAGE, 2)).toEqual(["Inscripciones", "Requisitos"]);
  });

  it("un párrafo largo se parte sin pasarse del tope", () => {
    const long: HostPage = { ...PAGE, blocks: [{ h: true, t: "Largo" }, { h: false, t: "a".repeat(500) }] };
    const parts = pagePassages(long, 200);
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every((p) => p.length <= 200 && p.startsWith("Largo\n"))).toBe(true);
  });

  it("con la pregunta viaja la página elegida, y el turno recuerda cuánto", () => {
    const { wire, turn } = pageForQuestion(PAGE, "¿hay becas?");
    expect(wire).toMatchObject({ url: PAGE.url, title: "Admisiones" });
    expect(turn).toMatchObject({ total: 3, sent: 3, headings: ["Inscripciones", "Requisitos", "Becas"], stamp: pageStamp(PAGE) });
    expect(pageStamp({ ...PAGE, blocks: PAGE.blocks.slice(0, 2) })).not.toBe(pageStamp(PAGE));
  });

  it("el recibo solo dice lo que el servidor confirmó", () => {
    expect(hostLabel("https://www.udes.edu.co/admisiones/?a=1")).toBe("www.udes.edu.co/admisiones");
    expect(captureStatus("nueva")).toBe("nueva");
    expect(captureStatus("cualquier cosa")).toBe("no");
    expect(captureLine("nueva")).toMatch(/Enviada para guardarla/);
    expect(captureLine("guardada")).toMatch(/Ya está en mi memoria/);
    expect(captureLine("descartada")).toBe("");
    expect(captureLine("no")).toBe("");
  });

  it("la línea para pegar pide leer solo si se marca", () => {
    expect(widgetSnippet("https://portal.example", "blanco", "der", "planeacion", true)).toBe('<script src="https://portal.example/pilo.js" data-tema="blanco" data-esquina="derecha" data-leer="si" defer></script>');
    expect(readHostMessage({ source: "pilo-host", full: false, read: true })).toEqual({ full: false, read: true });
  });

  it("la línea para pegar tiene tres opciones: no leer, leer lo visible y leer todo", () => {
    const line = (read: Parameters<typeof widgetSnippet>[4]) => widgetSnippet("https://portal.example", "blanco", "der", "planeacion", read);
    expect(line("no")).toBe(line(false));
    expect(line("no")).not.toContain("data-leer");
    expect(line("si")).toBe(line(true));
    expect(line("todo")).toBe('<script src="https://portal.example/pilo.js" data-tema="blanco" data-esquina="derecha" data-leer="todo" defer></script>');
    expect(widgetSnippet("https://portal.example", "blanco", "der", "ensenanza", "todo")).toContain('data-pilo="ensenanza" data-tema="blanco" data-esquina="derecha" data-leer="todo"');
    expect(leerAttr("otra" as never)).toBe("");
    expect(LEER_MODOS.map((m) => m.id)).toEqual(["no", "si", "todo"]);
    expect(LEER_MODOS.every((m) => m.label.length > 3 && m.hint.length > 20)).toBe(true);
  });

  it("lo plegado que repite un párrafo ya leído se quita; los títulos y lo plegado nuevo se quedan", () => {
    const blocks = [
      { h: 1, t: "Pregrado" },
      { h: 0, t: "La inscripción abre en octubre." },
      { h: 1, t: "Pregrado", o: 1 },
      { h: 0, t: "la  inscripción abre en OCTUBRE.", o: 1 },
      { h: 1, t: "Posgrado", o: 1 },
      { h: 0, t: "La inscripción abre en enero.", o: 1 },
      { h: 0, t: "La inscripción abre en enero.", o: 1 },
      { h: 0, t: "La inscripción abre en octubre." },
    ];
    const seen = readHostPage({ source: "pilo-host", type: "pagina", id: "a", page: { url: "https://a.co/", title: "A", blocks } }, "a");
    expect(seen?.page?.blocks).toEqual([
      { h: true, t: "Pregrado" },
      { h: false, t: "La inscripción abre en octubre." },
      { h: true, t: "Pregrado" },
      { h: true, t: "Posgrado" },
      { h: false, t: "La inscripción abre en enero." },
      // Lo visible repetido no es cosa de esta regla: queda como antes.
      { h: false, t: "La inscripción abre en octubre." },
    ]);
  });
});
