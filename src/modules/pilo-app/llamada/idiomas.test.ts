import { describe, expect, it } from "vitest";
import { PILO_LANGS } from "../../../components/pilo/i18n";
import { speechLang, spokenQuestion } from "./idiomas";

describe("idiomas de la llamada", () => {
  it("cubren los mismos tres idiomas que todo Pilo", () => {
    expect(PILO_LANGS.map((l) => l.id)).toEqual(["es", "en", "pt"]);
    expect(PILO_LANGS.map((l) => speechLang(l.id))).toEqual(["es-CO", "en-US", "pt-BR"]);
  });

  it("la pregunta lleva la orden del idioma y el espacio justo", () => {
    expect(spokenQuestion("  how many   students? ", "en")).toBe("how many students? (Answer out loud, in short sentences, in English.)");
    expect(spokenQuestion("quantos alunos", "pt")).toContain("português");
    expect(spokenQuestion("cuántos programas", "es")).toContain("español");
  });
});
