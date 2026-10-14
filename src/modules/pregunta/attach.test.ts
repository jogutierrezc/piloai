import { describe, expect, it } from "vitest";
import { fileLine, fileSteps, pickPassages, turnFile } from "./attach";
import { codeTokens, langOf } from "./Extras";
import { extrasFor, parseExtras } from "../../components/pilo/ai/extras";
import { cleanDoc, extraAllowed, extraSettings, redactDoc, wantsCode } from "../../components/pilo/ai/logic";
import { parseMarkdown } from "./markdown";

describe("qué pasajes del archivo viajan con la pregunta", () => {
  const passages = ["Informe de notas del semestre", "Grupo A: promedio 4,1", "Asistencia general del curso", "Grupo C: promedio 3,2", "Bibliografía recomendada"];

  it("si caben todos, van todos y en su orden", () => {
    expect(pickPassages(passages, "¿qué dice?", 8)).toEqual(passages);
  });

  it("si no caben, va el primero y los que más tienen que ver con la pregunta, en el orden del archivo", () => {
    expect(pickPassages(passages, "¿Cuál es el promedio de cada grupo?", 3)).toEqual([passages[0], passages[1], passages[3]]);
  });

  it("una pregunta que no nombra nada del archivo se queda con el comienzo", () => {
    expect(pickPassages(passages, "¿Qué opina?", 2)).toEqual([passages[0], passages[1]]);
  });

  it("cada pasaje se recorta a su tope", () => {
    expect(pickPassages(["a".repeat(50)], "x", 8, 10)).toEqual(["a".repeat(10)]);
  });
});

describe("lo que el turno recuerda del archivo", () => {
  const file = turnFile({ name: "notas.csv", passages: ["a", "b", "c"], omitted: 2, warnings: [] }, 2);

  it("guarda el nombre y las cuentas, nunca el contenido", () => {
    expect(file).toEqual({ name: "notas.csv", total: 3, sent: 2, omitted: 2 });
    expect(fileLine(file)).toBe("notas.csv · 3 pasajes");
  });

  it("la bitácora cuenta lo que se hizo, y solo nombra los datos tapados si los hubo", () => {
    expect(fileSteps(file).map((s) => s.verb)).toEqual(["Leyó", "Tapó", "Envió"]);
    expect(fileSteps({ ...file, omitted: 0 }).map((s) => s.verb)).toEqual(["Leyó", "Envió"]);
  });
});

describe("quién puede usar las funciones ampliadas", () => {
  it("cada nivel abre a quien le toca", () => {
    expect(extraAllowed("nadie", "admin")).toBe(false);
    expect(extraAllowed("admin", "admin")).toBe(true);
    expect(extraAllowed("admin", "consulta")).toBe(false);
    expect(extraAllowed("sesion", "consulta")).toBe(true);
    expect(extraAllowed("sesion", null)).toBe(false);
    expect(extraAllowed("publico", null)).toBe(true);
  });

  it("lo que no se entiende queda apagado, y los topes dentro de sus límites", () => {
    expect(extraSettings(null)).toMatchObject({ filesAud: "nadie", codeAud: "nadie" });
    // Sin los topes de las cuentas de Pilo (0120) en la fila, quedan los de partida.
    expect(extraSettings({ files_aud: "todos", code_aud: "sesion", file_max_mb: 99, file_daily: -3, code_max_tokens: 100 })).toEqual({ filesAud: "nadie", codeAud: "sesion", fileMaxMb: 25, fileDaily: 0, codeMaxTokens: 400, memberFactor: 3, memberMaxTokens: 1200 });
    expect(extraSettings({ member_factor: 99, member_max_tokens: 10 })).toMatchObject({ memberFactor: 20, memberMaxTokens: 400 });
    // Una cuenta de Pilo entra como «miembro»: vale para «Con sesión», nunca para «Solo administración».
    expect(extraAllowed("sesion", "miembro")).toBe(true);
    expect(extraAllowed("admin", "miembro")).toBe(false);
    expect(extraAllowed("nadie", "miembro")).toBe(false);
  });

  it("la página lee lo público por espacio; sin la migración, nada", () => {
    const all = parseExtras({ ensenanza: { files_aud: "sesion", code_aud: "publico", file_max_mb: 8 }, "mal espacio": {} });
    expect(extrasFor(all, "ensenanza", null)).toEqual({ files: false, code: true, fileMaxMb: 8 });
    expect(extrasFor(all, "ensenanza", "consulta").files).toBe(true);
    expect(extrasFor({}, "planeacion", "admin")).toEqual({ files: false, code: false, fileMaxMb: 10 });
  });
});

describe("el archivo que llega al servidor", () => {
  it("se tapan correos, teléfonos y documentos", () => {
    const out = redactDoc("Escriba a ana@ejemplo.edu.co o al 300 123 4567. C.C. 1098765432.");
    expect(out.text).not.toMatch(/ana@|300 123|1098765432/);
    expect(out.count).toBe(3);
  });

  it("se limpia y se recorta; sin pasajes no hay archivo", () => {
    expect(cleanDoc({ name: "x.csv", passages: [] })).toBeNull();
    expect(cleanDoc("nada")).toBeNull();
    const doc = cleanDoc({ name: " notas <b>.csv ", passages: Array.from({ length: 20 }, (_, i) => `pasaje ${i}`) });
    expect(doc?.passages).toHaveLength(8);
    expect(doc?.name).toBe("notas b .csv");
  });

  it("reconoce cuándo se pide código", () => {
    expect(wantsCode("Deme un script de Python")).toBe(true);
    expect(wantsCode("¿Cómo hago una fórmula de Excel para promediar?")).toBe(true);
    expect(wantsCode("¿Cuántos estudiantes hay por sede?")).toBe(false);
  });
});

describe("los bloques de código", () => {
  it("el bloque recuerda su lenguaje", () => {
    const code = parseMarkdown("```python\nx = 1\n```").blocks[0];
    expect(code).toMatchObject({ kind: "code", text: "x = 1", lang: "python" });
    expect(parseMarkdown("```\nx\n```").blocks[0]).not.toHaveProperty("lang");
  });

  it("se pintan comentarios, textos y números según el lenguaje", () => {
    expect(langOf("py")).toBe("python");
    expect(codeTokens('n = pd.read_csv("a.csv")  # leer', "python").map((t) => t.kind)).toEqual(["plain", "string", "plain", "comment"]);
    expect(codeTokens("select 1 -- uno", "sql").map((t) => t.kind)).toEqual(["plain", "number", "plain", "comment"]);
    // En CSS, «#» no es un comentario.
    expect(codeTokens("color: #fff;", "css").some((t) => t.kind === "comment")).toBe(false);
  });
});
