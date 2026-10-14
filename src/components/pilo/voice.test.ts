import { describe, expect, it } from "vitest";
import { pickVoice } from "./voice";

const v = (name: string, lang: string) => ({ name, lang, localService: true });

describe("la voz de Mr. Pilo", () => {
  it("Mr. Pilo es hombre: una voz masculina gana aunque haya femeninas neuronales", () => {
    const voices = [
      v("Microsoft Salome Online (Natural) - Spanish (Colombia)", "es-CO"),
      v("Microsoft Dalia Online (Natural) - Spanish (Mexico)", "es-MX"),
      v("Microsoft Jorge Online (Natural) - Spanish (Mexico)", "es-MX"),
      v("Microsoft Gonzalo Online (Natural) - Spanish (Colombia)", "es-CO"),
      v("Microsoft Pablo - Spanish (Spain)", "es-ES"),
    ];
    expect(pickVoice(voices)?.name).toMatch(/Gonzalo/);
    expect(pickVoice([v("Microsoft Álvaro - Spanish (Spain)", "es-ES"), v("Google español female", "es-ES")])?.name).toMatch(/Álvaro/);
  });

  it("sin masculinas, prefiere una voz neuronal en español, y entre ellas la de Colombia", () => {
    const voices = [
      v("Microsoft Helena - Spanish (Spain)", "es-ES"),
      v("Microsoft Salome Online (Natural) - Spanish (Colombia)", "es-CO"),
      v("Microsoft Dalia Online (Natural) - Spanish (Mexico)", "es-MX"),
      v("Microsoft Aria Online (Natural) - English", "en-US"),
    ];
    expect(pickVoice(voices)?.name).toMatch(/Salome/);
  });

  it("sin neuronales, toma cualquier voz en español; sin español, ninguna", () => {
    expect(pickVoice([v("Google español", "es-ES"), v("Samantha", "en-US")])?.lang).toBe("es-ES");
    expect(pickVoice([v("Samantha", "en-US")])).toBeNull();
  });
});
