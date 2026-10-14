import { describe, expect, it } from "vitest";
import { parseAnalysis } from "./logic";

/* Las formas en que un modelo (Gemma en NVIDIA, Mistral…) devuelve un capítulo. */
describe("parseAnalysis lee lo que escribe la IA, venga como venga", () => {
  it("JSON limpio", () => {
    const p = parseAnalysis('{"resumen":"Baja la deserción","parrafos":["Uno.","Dos."],"alertas":["A"],"recomendaciones":["R1","R2"]}');
    expect(p).toEqual({ summary: "Baja la deserción", paragraphs: ["Uno.", "Dos."], alerts: ["A"], recommendations: ["R1", "R2"] });
  });

  it("campos con tilde o en inglés, y listas que llegan como texto", () => {
    const p = parseAnalysis('{"Resumen":"X","párrafos":"Primero.\\n\\nSegundo.","Alertas":"Una\\nOtra","recommendations":["R"]}');
    expect(p.paragraphs).toEqual(["Primero.", "Segundo."]);
    expect(p.alerts).toEqual(["Una", "Otra"]);
    expect(p.recommendations).toEqual(["R"]);
  });

  it("quita el Markdown que el modelo mete dentro del texto", () => {
    const p = parseAnalysis('```json\n{"resumen":"**Baja** la deserción","parrafos":["La deserción bajó a **9,6 %** en 2025."],"recomendaciones":["- Priorizar Valledupar","2. Medir apoyos"]}\n```');
    expect(p.summary).toBe("Baja la deserción");
    expect(p.paragraphs).toEqual(["La deserción bajó a 9,6 % en 2025."]);
    expect(p.recommendations).toEqual(["Priorizar Valledupar", "Medir apoyos"]);
  });

  it("JSON cortado por el tope de palabras: rescata lo escrito, sin llaves ni comillas", () => {
    const cut =
      '{"resumen":"La deserción bajó.","parrafos":["Primer párrafo completo con su cifra de 9,6 %.","Segundo párrafo que empezó a escribirse y se cortó cuando el modelo llegó al tope de palabras permitido en la';
    const p = parseAnalysis(cut);
    expect(p.summary).toBe("La deserción bajó.");
    expect(p.paragraphs[0]).toBe("Primer párrafo completo con su cifra de 9,6 %.");
    expect(p.paragraphs[1]).toMatch(/^Segundo párrafo .*…$/);
    expect(p.paragraphs.join(" ")).not.toMatch(/[{}[\]"]/);
  });

  it("JSON con una coma de más: también se rescata", () => {
    const p = parseAnalysis('{"resumen":"R","parrafos":["Uno.","Dos.",],"alertas":[],}');
    expect(p.paragraphs).toEqual(["Uno.", "Dos."]);
  });

  it("solo texto: se toma por párrafos", () => {
    const p = parseAnalysis("## Hallazgos\n\nLa deserción bajó.\n\n**Alerta:** Valledupar.");
    expect(p.paragraphs).toEqual(["Hallazgos", "La deserción bajó.", "Alerta: Valledupar."]);
  });
});
