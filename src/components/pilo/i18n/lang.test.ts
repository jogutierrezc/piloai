import { afterEach, describe, expect, it } from "vitest";
import { askBody } from "../ai/client";
import { widgetSnippet } from "../../../modules/pilo-embed/embed";
import { effectiveLang, langFromSearch, localizeDeep, resetLangForTests, setPiloScopeForTests, tr, translate, trn } from "./lang";

afterEach(() => {
  setPiloScopeForTests(null);
  resetLangForTests("es");
});

describe("translate", () => {
  it("el español es la clave: sin idioma o sin traducción devuelve el mismo texto", () => {
    expect(translate("es", "Escriba su pregunta")).toBe("Escriba su pregunta");
    expect(translate("en", "Un texto que nadie tradujo")).toBe("Un texto que nadie tradujo");
  });
  it("traduce al inglés y al portugués", () => {
    expect(translate("en", "Escriba su pregunta")).toBe("Type your question");
    expect(translate("pt", "Escriba su pregunta")).toBe("Digite sua pergunta");
  });
  it("pone las variables, también en español", () => {
    expect(translate("es", "Pilo respondió: {text}", { text: "hola" })).toBe("Pilo respondió: hola");
    expect(translate("en", "Pilo respondió: {text}", { text: "hi" })).toBe("Pilo answered: hi");
    expect(translate("pt", "Paso {n} de {total}", { n: 2, total: 5 })).toBe("Passo 2 de 5");
  });
  it("una variable que no llega queda a la vista, no se borra en silencio", () => {
    expect(translate("en", "Pilo respondió: {text}")).toBe("Pilo answered: {text}");
  });
});

describe("el idioma elegido", () => {
  it("tr() sigue el idioma de ahora en las pantallas de Pilo", () => {
    setPiloScopeForTests(true);
    expect(tr("Siguiente")).toBe("Siguiente");
    resetLangForTests("en");
    expect(tr("Siguiente")).toBe("Next");
    resetLangForTests("pt");
    expect(tr("Siguiente")).toBe("Próximo");
  });
  it("fuera de las pantallas de Pilo (la intranet) todo sigue en español", () => {
    resetLangForTests("en");
    setPiloScopeForTests(false);
    expect(tr("Siguiente")).toBe("Siguiente");
    expect(effectiveLang()).toBe("es");
    expect(trn(2, "{n} pasaje", "{n} pasajes")).toBe("2 pasajes");
  });
  it("trn elige singular o plural y traduce cada uno", () => {
    setPiloScopeForTests(true);
    resetLangForTests("en");
    expect(trn(1, "{n} pasaje · no se sube", "{n} pasajes · no se sube")).toBe("1 passage · not uploaded");
    expect(trn(3, "{n} pasaje · no se sube", "{n} pasajes · no se sube")).toBe("3 passages · not uploaded");
  });
});

describe("langFromSearch", () => {
  it("lee ?lang= y ?idioma=, con o sin región", () => {
    expect(langFromSearch("?lang=en")).toBe("en");
    expect(langFromSearch("?idioma=PT")).toBe("pt");
    expect(langFromSearch("?lang=pt-BR&tema=negro")).toBe("pt");
    expect(langFromSearch("?lang=fr")).toBeNull();
    expect(langFromSearch("")).toBeNull();
  });
});

describe("localizeDeep", () => {
  const perfil = { id: "planeacion", route: "/pregunta", title: "Pregúntele a Mr. Pilo", suggestions: [{ q: "¿Qué dice el último boletín?", hint: "Boletines" }], n: 3, trick: true };
  it("en español devuelve el mismo objeto", () => {
    setPiloScopeForTests(true);
    expect(localizeDeep(perfil)).toBe(perfil);
  });
  it("traduce los textos, deja las rutas y los números, y entrega siempre la misma copia", () => {
    setPiloScopeForTests(true);
    resetLangForTests("en");
    const en = localizeDeep(perfil);
    expect(en).toEqual({ id: "planeacion", route: "/pregunta", title: "Ask Mr. Pilo", suggestions: [{ q: "What does the latest bulletin say?", hint: "Bulletins" }], n: 3, trick: true });
    expect(localizeDeep(perfil)).toBe(en);
    resetLangForTests("pt");
    expect(localizeDeep(perfil).title).toBe("Pergunte ao Mr. Pilo");
    expect(perfil.title).toBe("Pregúntele a Mr. Pilo");
  });
});

describe("lo que sale hacia el servidor", () => {
  it("la pregunta lleva el idioma solo si es inglés o portugués; en español el cuerpo es el de siempre", () => {
    setPiloScopeForTests(true);
    expect(askBody("hola", [])).not.toHaveProperty("lang");
    resetLangForTests("en");
    expect(askBody("hello", [])).toMatchObject({ lang: "en" });
    expect(askBody("hello", [], { lang: "pt" })).toMatchObject({ lang: "pt" });
    expect(askBody("hola", [], { lang: "es" })).not.toHaveProperty("lang");
  });
  it("fuera de Pilo (por ejemplo, la prueba de la intranet) no viaja idioma", () => {
    resetLangForTests("en");
    setPiloScopeForTests(false);
    expect(askBody("hello", [])).not.toHaveProperty("lang");
  });
  it("la línea para otros portales puede abrir el chat en otro idioma", () => {
    expect(widgetSnippet("https://planeacion.udes.edu.co", "blanco", "der")).not.toContain("data-lang");
    expect(widgetSnippet("https://planeacion.udes.edu.co", "blanco", "der", "planeacion", false, "en")).toContain('data-lang="en"');
    expect(widgetSnippet("https://planeacion.udes.edu.co", "blanco", "der", "planeacion", false, "es")).not.toContain("data-lang");
  });
});
