import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { embedRoute, frameMessage, hostOrigin, normalizeOrigin, readHostMessage, readParams, sourceUrl, spaceWidget, widgetAllowed, widgetSnippet } from "./embed";

describe("readParams", () => {
  it("sin nada pedido: blanco y a la derecha", () => {
    expect(readParams("")).toEqual({ tema: "blanco", lado: "der" });
  });

  it("acepta los tres temas y la esquina izquierda, con cualquier mayúscula", () => {
    expect(readParams("?tema=Soleado&lado=izquierda")).toEqual({ tema: "soleado", lado: "izq" });
    expect(readParams("?tema=negro&lado=izq")).toEqual({ tema: "negro", lado: "izq" });
  });

  it("lo que no conoce cae en lo de siempre", () => {
    expect(readParams("?tema=rosado&lado=arriba")).toEqual({ tema: "blanco", lado: "der" });
  });
});

describe("mensajes entre el marco y la página anfitriona", () => {
  it("el marco dice su estado", () => {
    expect(frameMessage("abierto")).toEqual({ source: "pilo-embed", type: "estado", state: "abierto" });
  });

  it("solo se lee lo que viene de la página anfitriona", () => {
    expect(readHostMessage({ source: "pilo-host", full: true })).toEqual({ full: true });
    expect(readHostMessage({ source: "pilo-host" })).toEqual({ full: false });
    expect(readHostMessage({ source: "otro", full: true })).toBeNull();
    expect(readHostMessage("pilo-host")).toBeNull();
    expect(readHostMessage(null)).toBeNull();
  });
});

describe("sourceUrl", () => {
  it("una ruta del portal se abre en el portal", () => {
    expect(sourceUrl("/datos-abiertos/poblacional", "https://portal.example/")).toBe("https://portal.example/datos-abiertos/poblacional");
  });

  it("una dirección completa se respeta", () => {
    expect(sourceUrl("https://www.udes.edu.co/x", "https://portal.example")).toBe("https://www.udes.edu.co/x");
  });

  it("sin ruta, o con algo que no es una ruta, lleva a Pregúntele a Pilo", () => {
    expect(sourceUrl("", "https://portal.example")).toBe("https://portal.example/pregunta");
    expect(sourceUrl(null, "https://portal.example")).toBe("https://portal.example/pregunta");
    expect(sourceUrl("javascript:alert(1)", "https://portal.example")).toBe("https://portal.example/pregunta");
  });
});

describe("normalizeOrigin", () => {
  it("deja el origen, con o sin https, ruta o mayúsculas", () => {
    expect(normalizeOrigin("www.udes.edu.co/")).toBe("https://www.udes.edu.co");
    expect(normalizeOrigin(" https://Admisiones.UDES.edu.co/programas?x=1 ")).toBe("https://admisiones.udes.edu.co");
    expect(normalizeOrigin("http://localhost:5173")).toBe("http://localhost:5173");
  });

  it("rechaza lo que no es la dirección de un sitio", () => {
    expect(normalizeOrigin("")).toBeNull();
    expect(normalizeOrigin("udes")).toBeNull();
    expect(normalizeOrigin("javascript:alert(1)")).toBeNull();
    expect(normalizeOrigin("ftp://udes.edu.co")).toBeNull();
  });
});

describe("hostOrigin", () => {
  it("prefiere ancestorOrigins y cae en el referente", () => {
    expect(hostOrigin(["https://a.example"], "https://b.example/pagina")).toBe("https://a.example");
    expect(hostOrigin([], "https://b.example/pagina")).toBe("https://b.example");
    expect(hostOrigin(undefined, "")).toBeNull();
  });
});

describe("widgetAllowed", () => {
  const self = "https://portal.example";
  const on = { on: true, origins: ["https://www.udes.edu.co"] };

  it("este portal siempre puede, aunque esté apagado o sin migración", () => {
    expect(widgetAllowed({ on: false, origins: [] }, self, self)).toBe(true);
    expect(widgetAllowed(undefined, self, self)).toBe(true);
  });

  it("otro portal: solo encendido y en la lista", () => {
    expect(widgetAllowed(on, "https://www.udes.edu.co", self)).toBe(true);
    expect(widgetAllowed(on, "https://otro.example", self)).toBe(false);
    expect(widgetAllowed({ ...on, on: false }, "https://www.udes.edu.co", self)).toBe(false);
    expect(widgetAllowed(undefined, "https://www.udes.edu.co", self)).toBe(false);
  });

  it("si no se sabe quién aloja el marco, no", () => {
    expect(widgetAllowed(on, null, self)).toBe(false);
  });
});

describe("widgetSnippet", () => {
  it("arma la línea con el tema y la esquina", () => {
    expect(widgetSnippet("https://portal.example/", "negro", "izq")).toBe('<script src="https://portal.example/pilo.js" data-tema="negro" data-esquina="izquierda" defer></script>');
  });
});

/* --- Los espacios de Pilo (0113): el chat de Mr. Pilo en Enseñanza ------------------------ */

describe("readParams con un espacio", () => {
  it("el de siempre no anota espacio: el resultado es el de antes", () => {
    expect(readParams("?tema=negro", "planeacion")).toEqual({ tema: "negro", lado: "der" });
  });

  it("otro espacio queda anotado, con el mismo tema y la misma esquina", () => {
    expect(readParams("?tema=soleado&lado=izq", "ensenanza")).toEqual({ tema: "soleado", lado: "izq", space: "ensenanza" });
    expect(readParams("", "ensenanza")).toEqual({ tema: "blanco", lado: "der", space: "ensenanza" });
  });

  it("el espacio no se toma de la dirección: lo fija la ruta del marco", () => {
    expect(readParams("?space=ensenanza&espacio=ensenanza")).toEqual({ tema: "blanco", lado: "der" });
  });
});

describe("widgetSnippet con un espacio", () => {
  it("el de siempre no cambia, se diga o no el espacio", () => {
    expect(widgetSnippet("https://portal.example/", "negro", "izq", "planeacion")).toBe(widgetSnippet("https://portal.example/", "negro", "izq"));
  });

  it("Enseñanza se pide con data-pilo", () => {
    expect(widgetSnippet("https://portal.example", "blanco", "der", "ensenanza")).toBe('<script src="https://portal.example/pilo.js" data-pilo="ensenanza" data-tema="blanco" data-esquina="derecha" defer></script>');
  });
});

describe("spaceWidget: cada chat tiene su interruptor y su lista", () => {
  const self = "https://portal.example";
  const config = {
    widget: { on: true, origins: ["https://www.udes.edu.co"] },
    spaces: { ensenanza: { widget: { on: true, origins: ["https://aulas.udes.edu.co"] } } },
  };

  it("el de siempre lee `widget`; Enseñanza, `spaces.ensenanza.widget`", () => {
    expect(spaceWidget(config)).toEqual(config.widget);
    expect(spaceWidget(config, "planeacion")).toEqual(config.widget);
    expect(spaceWidget(config, "ensenanza")).toEqual(config.spaces.ensenanza.widget);
  });

  it("un portal autorizado para un Pilo no lo está para el otro", () => {
    expect(widgetAllowed(spaceWidget(config, "ensenanza"), "https://aulas.udes.edu.co", self)).toBe(true);
    expect(widgetAllowed(spaceWidget(config, "ensenanza"), "https://www.udes.edu.co", self)).toBe(false);
    expect(widgetAllowed(spaceWidget(config, "planeacion"), "https://aulas.udes.edu.co", self)).toBe(false);
  });

  it("sin la migración 0113 no hay ficha: otros portales no; este portal sí puede intentarlo", () => {
    expect(spaceWidget({ widget: config.widget, spaces: {} }, "ensenanza")).toBeNull();
    expect(spaceWidget(null, "ensenanza")).toBeNull();
    expect(widgetAllowed(spaceWidget({ widget: config.widget }, "ensenanza"), "https://aulas.udes.edu.co", self)).toBe(false);
  });
});

describe("la página de cada Pilo", () => {
  it("una fuente sin página propia lleva a la del Pilo que respondió", () => {
    expect(sourceUrl("", "https://portal.example", "/pilo-ensenanza")).toBe("https://portal.example/pilo-ensenanza");
    expect(sourceUrl("/pilo-ensenanza", "https://portal.example")).toBe("https://portal.example/pilo-ensenanza");
  });

  it("el cargador (public/pilo.js) y la página conocen las mismas rutas de marco", () => {
    const loader = readFileSync(resolve(process.cwd(), "public/pilo.js"), "utf8");
    expect(embedRoute()).toBe("/pilo-embed");
    expect(embedRoute("ensenanza")).toBe("/pilo-ensenanza-embed");
    expect(loader).toContain(`route: "${embedRoute()}"`);
    expect(loader).toContain(`route: "${embedRoute("ensenanza")}"`);
    expect(loader).toContain('getAttribute("data-pilo")');
    // La guarda del de siempre no cambia de nombre; la de Enseñanza es otra: los dos caben en una página.
    expect(loader).toContain('guard: "__piloEmbed"');
    expect(loader).toContain('guard: "__piloEmbed_ensenanza"');
  });
});
