import { describe, expect, it } from "vitest";
import { CALL_FEATURES, clock, MAX_SENTENCE, recognitionSupported, spokenText, takeSentences } from "./logic";

describe("takeSentences", () => {
  it("entrega las frases completas y deja la que aún se escribe", () => {
    const r = takeSentences("La UDES tiene sedes en tres ciudades del país. Bucaramanga es la principal y tiene");
    expect(r.sentences).toEqual(["La UDES tiene sedes en tres ciudades del país."]);
    expect(r.rest).toBe("Bucaramanga es la principal y tiene");
  });

  it("con final dice también lo que quedó sin punto", () => {
    const r = takeSentences("Son tres sedes en total, según el último corte", true);
    expect(r.sentences).toEqual(["Son tres sedes en total, según el último corte"]);
    expect(r.rest).toBe("");
  });

  it("no corta un decimal, una sigla ni un título", () => {
    expect(takeSentences("El avance es de 2.5 puntos más que el año pasado, y sigue creciendo en todos los pilares.", true).sentences).toHaveLength(1);
    expect(takeSentences("Lo explicó el Dr. Pérez durante la presentación del informe anual de gestión.", true).sentences).toHaveLength(1);
  });

  it("une las frases cortas con la siguiente para que el audio no suene a saltos", () => {
    const r = takeSentences("Claro. Con gusto le cuento cuántos programas académicos ofrece la Universidad hoy.", true);
    expect(r.sentences).toEqual(["Claro. Con gusto le cuento cuántos programas académicos ofrece la Universidad hoy."]);
  });

  it("parte en frases las preguntas y las exclamaciones", () => {
    const r = takeSentences("¿Quiere que le detalle las cifras por sede y por programa? Con gusto le muestro cada una de ellas.", true);
    expect(r.sentences).toHaveLength(2);
  });

  it("una frase sin punto que se alarga se corta donde se respira", () => {
    const long = Array.from({ length: 40 }, (_, i) => `palabra${i}`).join(" ").replace(/palabra9 /, "palabra9, ");
    const r = takeSentences(long);
    expect(r.sentences.length).toBeGreaterThan(0);
    for (const s of r.sentences) expect(s.length).toBeLessThanOrEqual(MAX_SENTENCE);
    expect([...r.sentences, r.rest].join(" ").replace(/\s+/g, " ").trim()).toBe(long);
  });

  it("llegando por pedazos da lo mismo que de una vez", () => {
    const full = "Hay doce programas de ingeniería en la Universidad. La mayoría tiene acreditación vigente. Los demás están en proceso de renovación ahora.";
    const once = takeSentences(full, true).sentences;
    const said: string[] = [];
    let buf = "";
    for (const piece of full.match(/.{1,7}/g) ?? []) {
      buf += piece;
      const r = takeSentences(buf);
      said.push(...r.sentences);
      buf = r.rest;
    }
    said.push(...takeSentences(buf, true).sentences);
    expect(said).toEqual(once);
  });
});

describe("spokenText", () => {
  it("quita lo que no se pronuncia", () => {
    const raw = "## Sedes\n- **Bucaramanga**: la [principal](https://udes.edu.co/sedes)\n1. Cúcuta `activa`\n```js\nx\n```";
    expect(spokenText(raw)).toBe("Sedes Bucaramanga: la principal Cúcuta activa");
  });

  it("no lee las citas de las fuentes", () => {
    expect(spokenText("La UDES tiene sedes en tres ciudades [1]. Bucaramanga es la principal [2, 3].")).toBe("La UDES tiene sedes en tres ciudades. Bucaramanga es la principal.");
  });

  it("no deja direcciones sueltas", () => {
    expect(spokenText("Más en https://udes.edu.co/pdi hoy")).toBe("Más en hoy");
  });
});

describe("clock", () => {
  it("formatea minutos y horas", () => {
    expect(clock(0)).toBe("00:00");
    expect(clock(187.9)).toBe("03:07");
    expect(clock(3729)).toBe("1:02:09");
    expect(clock(-4)).toBe("00:00");
  });
});

describe("aviso previo", () => {
  it("cada función tiene título y texto", () => {
    expect(CALL_FEATURES.map((f) => f.id)).toEqual(["voz", "idiomas", "udes", "pausa"]);
    for (const f of CALL_FEATURES) expect(f.title && f.text).toBeTruthy();
  });

  it("sabe si el navegador reconoce la voz", () => {
    expect(recognitionSupported({})).toBe(false);
    expect(recognitionSupported({ webkitSpeechRecognition: function () {} })).toBe(true);
  });
});
