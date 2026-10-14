import { describe, expect, it } from "vitest";
import { cleanDraft, finishAnswer, parseTones, streamVisible, stripMarks, styleFor, voiceModeOf } from "./logic";

describe("las marcas que el modelo copia del pedido", () => {
  it("quita los nombres de los bloques y las etiquetas sueltas", () => {
    expect(stripMarks("[OFICIAL] La matrícula abre en enero [CIFRAS] y cierra en marzo.")).toBe("La matrícula abre en enero y cierra en marzo.");
    expect(stripMarks("[DE OTRO ÁMBITO] Esto viene de Enseñanza.")).toBe("Esto viene de Enseñanza.");
    expect(stripMarks("[calm] Hola, soy Pilo [pause] ¿en qué te ayudo?")).toBe("Hola, soy Pilo ¿en qué te ayudo?");
    expect(stripMarks("Según la norma [fuente] y [n] y […] aplica.")).toBe("Según la norma y y aplica.");
  });

  it("deja las citas, los enlaces y los años entre corchetes", () => {
    expect(stripMarks("Bajó a 9,6 % [2] [2024] y ver [la guía](https://udes.edu.co).")).toBe("Bajó a 9,6 % [2] [2024] y ver [la guía](https://udes.edu.co).");
  });

  it("«[Fuente 2]» pasa a «[2]»", () => {
    expect(stripMarks("Lo dice la norma [Fuente 2].")).toBe("Lo dice la norma [2].");
  });

  it("la respuesta terminada sale sin corchetes de más", () => {
    expect(cleanDraft("[PASAJES] La evaluación es formativa [1].")).toBe("La evaluación es formativa [1].");
    const src = [{ ref: "a", title: "Política", section: "", cut: "", body: "La evaluación es formativa.", source: "documento" }] as never;
    const done = finishAnswer("[OFICIAL] La evaluación es formativa [1] [calm].", src, { question: "¿cómo se evalúa?", intent: "institucional" } as never);
    expect(done.text).toBe("La evaluación es formativa [1].");
  });
});

describe("el eco del bloque de datos", () => {
  const eco = "<<<DATOS\n[OFICIAL] El pilar I, Personalización, lleva un avance de 12,0 % en el corte 2026 [1].\n\n[GUARDADA] Lo que ya respondiste:\nPara el corte 2026, el pilar I tiene un avance del 12,0 % [1].\n\n[RELACIONES]\n\n[1] Pilar I —trata de→ Flexibilidad Curricular [PUBLICADO] DATOS>>>";

  it("se queda con la respuesta oficial y descarta lo interno", () => {
    expect(cleanDraft(eco)).toBe("El pilar I, Personalización, lleva un avance de 12,0 % en el corte 2026 [1].");
  });

  it("mientras llega no se muestra nada", () => {
    expect(streamVisible("<<<DAT", false, { institutional: true, known: new Set() })).toBe("");
    expect(streamVisible("<<<DATOS\n[OFICIAL] El pilar I lleva 12,0 % [1]. ", false, { institutional: true, known: new Set() })).toBe("");
  });
});

describe("la voz de cada modo secreto", () => {
  const styles = [
    { id: "a", name: "Pilo", path: "a.wav", seconds: 10, fish_id: "f1" },
    { id: "b", name: "Pilonaitor", path: "b.wav", seconds: 10, fish_id: "f2" },
  ];

  it("reconoce el modo en el tono y lo quita de las emociones", () => {
    expect(voiceModeOf("short pause,whispering,modo:pilonator")).toBe("pilonator");
    expect(voiceModeOf("excited")).toBeNull();
    expect(parseTones("short pause,modo:pilonator")).toEqual(["short pause"]);
  });

  it("usa el estilo que se llama como el modo, y si no hay, el de siempre", () => {
    expect(styleFor(styles, "pregunta", null, "a", undefined, "pilonator")?.id).toBe("b");
    expect(styleFor(styles, "pregunta", null, "a", undefined, "pilocop")?.id).toBe("a");
    expect(styleFor(styles, "pregunta", null, "a")?.id).toBe("a");
  });
});
