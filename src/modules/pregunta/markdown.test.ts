import { describe, expect, it } from "vitest";
import { parseMarkdown, safeUrl, toPlain, visibleText } from "./markdown";
import type { Block, Piece } from "./markdown";

const pieces = (text: string, options?: { streaming?: boolean }) => parseMarkdown(text, options).sentences.flatMap((s) => s.pieces);
const words = (text: string, options?: { streaming?: boolean }) => pieces(text, options).filter((p) => p.kind === "word");
const show = (p: Piece) => `${p.bold ? "B" : ""}${p.italic ? "I" : ""}${p.code ? "C" : ""}${p.href ? "L" : ""}:${p.value}`;
const kinds = (text: string) => parseMarkdown(text).blocks.map((b: Block) => b.kind);

describe("Markdown básico de una respuesta", () => {
  it("separa párrafos por línea en blanco y conserva el salto de línea simple", () => {
    const p = parseMarkdown("Uno.\nDos.\n\nTres.");
    expect(kinds("Uno.\nDos.\n\nTres.")).toEqual(["p", "p"]);
    expect(p.sentences.map((s) => s.spoken)).toEqual(["Uno.", "Dos.", "Tres."]);
    expect(p.sentences[0].pieces.map((x) => x.kind)).toEqual(["word", "break"]);
  });

  it("negrita y cursiva, sin dejar las marcas en el texto", () => {
    expect(words("Hay **20.500 estudiantes** y *algo* más, ***muy*** _claro_ y __firme__.").map(show)).toEqual([
      ":Hay",
      "B:20.500",
      "B:estudiantes",
      ":y",
      "I:algo",
      ":más,",
      "BI:muy",
      "I:claro",
      ":y",
      "B:firme",
      ":.",
    ]);
  });

  it("no toma por cursiva un asterisco suelto ni un guion bajo dentro de una palabra", () => {
    expect(words("5 * 3 * 2 es 30 y snake_case_name queda igual").map(show)).toEqual([":5", ":*", ":3", ":*", ":2", ":es", ":30", ":y", ":snake_case_name", ":queda", ":igual"]);
  });

  it("listas con viñetas y numeradas, con su número de inicio", () => {
    const p = parseMarkdown("Sedes:\n- Bucaramanga\n- Cúcuta\n  - Campus norte\n\n3. Tercero\n4. Cuarto");
    expect(p.blocks.map((b) => b.kind)).toEqual(["p", "list", "list"]);
    const [, ul, ol] = p.blocks;
    expect(ul).toMatchObject({ kind: "list", ordered: false });
    expect(ul.kind === "list" && ul.items.map((i) => [i.depth, i.sentences[0].spoken])).toEqual([
      [0, "Bucaramanga"],
      [0, "Cúcuta"],
      [1, "Campus norte"],
    ]);
    expect(ol).toMatchObject({ kind: "list", ordered: true, start: 3 });
  });

  it("una línea que sigue a un ítem es parte de él", () => {
    const p = parseMarkdown("- Primer punto\nque sigue aquí\n- Segundo");
    const list = p.blocks[0];
    expect(list.kind === "list" && list.items.map((i) => i.sentences.map((s) => s.spoken).join(" "))).toEqual(["Primer punto que sigue aquí", "Segundo"]);
  });

  it("un año al comienzo de la línea no es una lista", () => {
    expect(kinds("2024. Fue un buen año.")).toEqual(["p"]);
  });

  it("código en línea y bloques de código, sin interpretar lo de adentro", () => {
    const p = parseMarkdown("Use `SELECT * FROM t` así:\n\n```sql\nSELECT **x**\n  FROM t; [1]\n```\n\nListo.");
    expect(p.blocks.map((b) => b.kind)).toEqual(["p", "code", "p"]);
    expect(p.blocks[1]).toMatchObject({ kind: "code", text: "SELECT **x**\n  FROM t; [1]" });
    expect(words("Use `SELECT * FROM t` así").map(show)).toEqual([":Use", "C:SELECT * FROM t", ":así"]);
    // El bloque cuenta como una pieza para la escritura; no se lee en voz alta.
    expect(p.count).toBe(5);
    expect(p.sentences.map((s) => s.spoken)).toEqual(["Use SELECT * FROM t así:", "Listo."]);
  });

  it("títulos modestos, con su nivel", () => {
    const p = parseMarkdown("## Población ##\nTexto.\n# Otro");
    expect(p.blocks).toMatchObject([{ kind: "h", level: 2 }, { kind: "p" }, { kind: "h", level: 1 }]);
    expect(p.sentences[0].spoken).toBe("Población");
    expect(kinds("#sin espacio no es título")).toEqual(["p"]);
  });

  it("enlaces solo a http(s), con el texto del enlace", () => {
    const linked = words("Vea [el portal](https://udes.edu.co/cifras) o https://example.org/a_b(c). Fin.");
    expect(linked.map(show)).toEqual([":Vea", "L:el", "L:portal", ":o", "L:https://example.org/a_b(c)", ":.", ":Fin."]);
    expect(linked[1].href).toBe("https://udes.edu.co/cifras");
    expect(linked[1].link).toBe(linked[2].link);
    expect(linked[4].link).not.toBe(linked[1].link);
  });

  it("rechaza direcciones peligrosas: queda el texto, sin enlace", () => {
    for (const url of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "//evil.example", "/relativa", "mailto:a@b.co", " javascript:alert(1)"]) {
      const got = words(`Pulse [aquí](${url}) ya`);
      expect(got.some((p) => p.href), url).toBe(false);
      expect(got.map((p) => p.value), url).toEqual(["Pulse", "aquí", "ya"]);
    }
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("https://javascript:alert(1)@")).toBeNull();
    expect(safeUrl("http://udes.edu.co")).toBe("http://udes.edu.co/");
  });

  it("el HTML se queda como texto", () => {
    const p = parseMarkdown('<script>alert(1)</script> y <img src=x onerror="a()"> <b>negrita</b>');
    expect(p.blocks).toHaveLength(1);
    expect(p.sentences[0].spoken).toBe('<script>alert(1)</script> y <img src=x onerror="a()"> <b>negrita</b>');
    expect(words("<b>hola</b>").every((w) => !w.bold)).toBe(true);
  });

  it("las tablas quedan como líneas legibles", () => {
    const p = parseMarkdown("| Sede | Estudiantes |\n|---|---:|\n| Bucaramanga | 9.412 [1] |\n| Cúcuta | 3.100 |");
    expect(kinds("| Sede | Estudiantes |\n|---|---:|\n| Bucaramanga | 9.412 |")).toEqual(["p"]);
    expect(p.sentences.map((s) => s.spoken)).toEqual(["Sede · Estudiantes", "Bucaramanga · 9.412", "Cúcuta · 3.100"]);
    expect(pieces("| a | b [2] |").some((x) => x.kind === "cite" && x.value === "2")).toBe(true);
  });

  it("citas, filetes y bloques de cita no ensucian el texto", () => {
    expect(parseMarkdown("> Una cita.\n\n---\n\nSigue.").sentences.map((s) => s.spoken)).toEqual(["Una cita.", "Sigue."]);
    expect(words("Un \\*asterisco\\* literal").map(show)).toEqual([":Un", ":*asterisco*", ":literal"]);
  });
});

describe("las citas [n] dentro del Markdown", () => {
  const cites = (text: string) => pieces(text).filter((p) => p.kind === "cite").map((p) => p.value);

  it("dentro de listas, negritas, títulos y junto a un enlace", () => {
    expect(cites("- **9.412 estudiantes [1]** en Bucaramanga\n- Cúcuta: 3.100 [2].\n\n## Fuente [3]\n\nVea [el informe](https://udes.edu.co) [4].")).toEqual(["1", "2", "3", "4"]);
  });

  it("la cita se queda en su frase y no se lee", () => {
    const p = parseMarkdown("1. Hay **15.870** estudiantes [1]. Creció [2].\n2. Otro dato.");
    expect(p.sentences.map((s) => s.spoken)).toEqual(["Hay 15.870 estudiantes.", "Creció.", "Otro dato."]);
    expect(p.sentences[0].pieces.filter((x) => x.kind === "cite")).toHaveLength(1);
  });

  it("no confunde una cita con un enlace ni con un corchete cualquiera", () => {
    expect(cites("Según [1](nota) y [ver más] y [12].")).toEqual(["1", "12"]);
  });

  it("cuenta palabras y citas en orden, también dentro de una lista", () => {
    const p = parseMarkdown("- Hola [1] mundo.\n- Fin [2]");
    expect(p.count).toBe(5);
    expect(p.sentences.flatMap((s) => s.pieces).filter((x) => x.order >= 0).map((x) => x.order)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe("Markdown a medias, mientras la respuesta se escribe", () => {
  it("una negrita sin cerrar ya se ve en negrita: no cambia al llegar el cierre", () => {
    const half = words("El total es **20.500 estudiantes", { streaming: true }).map(show);
    const whole = words("El total es **20.500 estudiantes** hoy.", { streaming: true }).map(show);
    expect(half).toEqual([":El", ":total", ":es", "B:20.500", "B:estudiantes"]);
    expect(whole.slice(0, half.length)).toEqual(half);
  });

  it("una cursiva sin cerrar se da por buena solo mientras se escribe", () => {
    expect(words("Es *muy importante", { streaming: true }).map(show)).toEqual([":Es", "I:muy", "I:importante"]);
    expect(words("Es *muy importante").map(show)).toEqual([":Es", ":*muy", ":importante"]);
  });

  it("un bloque de código sin cerrar llega hasta el final, sin romper lo anterior", () => {
    const p = parseMarkdown("Mire:\n\n```\nlinea 1\nlinea **2**", { streaming: true });
    expect(p.blocks).toMatchObject([{ kind: "p" }, { kind: "code", text: "linea 1\nlinea **2**" }]);
    expect(parseMarkdown("Mire:\n\n```", { streaming: true }).blocks.map((b) => b.kind)).toEqual(["p"]);
  });

  it("un código en línea sin cerrar no deja el acento suelto", () => {
    expect(words("Use `npm run build", { streaming: true }).map(show)).toEqual([":Use", "C:npm run build"]);
    expect(words("Termina en `", { streaming: true }).map(show)).toEqual([":Termina", ":en"]);
  });

  it("un enlace a medias muestra su texto, no los corchetes", () => {
    expect(words("Vea [el portal](https://udes.edu", { streaming: true }).map(show)).toEqual([":Vea", ":el", ":portal"]);
  });

  it("lo ya escrito no cambia cuando llega más texto", () => {
    const full = "**Resumen**\n\n1. Hay **15.870** estudiantes [1].\n2. Creció *3,1 %* [2].\n\nMás en `cifras`.";
    const final = words(full).map(show);
    for (let n = 1; n < full.length; n++) {
      // El servidor manda frases o líneas completas: se corta en esos puntos.
      if (!/[\n ]/.test(full[n - 1]) || !/[.\n]/.test(full[n - 2] ?? "")) continue;
      const partial = words(full.slice(0, n), { streaming: true }).map(show);
      expect(final.slice(0, partial.length), `corte en ${n}`).toEqual(partial);
    }
  });

  it("texto vacío o solo marcas no produce bloques", () => {
    for (const t of ["", "   \n\n", "**", "- ", "#", "```"]) expect(parseMarkdown(t, { streaming: true }).count, JSON.stringify(t)).toBeLessThanOrEqual(1);
    expect(parseMarkdown("").blocks).toEqual([]);
  });
});

describe("el texto sin marcas (copiar, catálogo, anuncio)", () => {
  it("quita marcas y citas y conserva las listas", () => {
    expect(toPlain(parseMarkdown("## Sedes\n\nHay **tres** [1]:\n\n1. Bucaramanga [2]\n2. Cúcuta\n\n- *Valledupar*"))).toBe("Sedes\n\nHay tres:\n\n1. Bucaramanga\n2. Cúcuta\n\n- Valledupar");
  });
});

/* --- Nada se pierde -------------------------------------------------------------------------
   El dueño vio respuestas con partes ocultas. El análisis no puede ser la causa: toda letra y
   todo número de la respuesta que no sea una marca (la dirección de un enlace, el nombre del
   lenguaje de un bloque de código) tiene que quedar en lo que se pinta, también a medias. */

/** Las letras y los números, en orden: lo que no puede faltar. */
const letters = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).join(" ");

/** Lo que sí es marca aunque tenga letras: la dirección de un enlace `](…)` y el lenguaje de un bloque. */
const withoutMarkup = (s: string) =>
  s
    .replace(/\]\(\s*(?:[a-z][a-z0-9+.-]*:|\/|#|www\.)[^)\n]*\)?/gi, "]")
    .replace(/\]\([a-z][a-z0-9+.-]*$/i, "]")
    .replace(/^(\s{0,3}(?:`{3,}|~{3,}))[^\s`~]+[ \t]*$/gm, "$1");

const SAMPLES = [
  "La UDES tiene **tres sedes** y *varios* programas. Vea `pilo_memory` y siga.",
  "## Evaluación por resultados\n\nSe evalúa lo que el estudiante *demuestra*, no lo que el curso cubre.\n\n- Rúbricas claras\n- Evidencias de aprendizaje\n  - Portafolio\n  - Proyecto\n\n> Una cita textual de la política.\n\nFin del texto.",
  "Primero un párrafo.\n\n```\nconst nota = 4.5;\nconsole.log(nota);\n```\n\nY después otro párrafo con [un enlace](https://www.udes.edu.co/politicas) y más texto.",
  "| Sede | Estudiantes |\n|---|---|\n| Bucaramanga | muchos |\n| Cúcuta | varios |\n\nTexto tras la tabla.",
  "Texto con <b>etiquetas</b> y <script>alert(uno)</script> que se ven como texto.\n\n___\n\nDespués del filete.",
  "Un guion_bajo en medio, 2*3*4 sin cursiva, un asterisco * suelto y un _ suelto también.",
  "### Título con C#\n\nUna línea\ncon salto y otra frase. ¿Y una pregunta? ¡Claro! Sí… quizá.",
];

describe("el análisis no pierde texto", () => {
  it("cada letra y cada número de la respuesta queda en lo que se pinta", () => {
    for (const text of SAMPLES) expect(letters(visibleText(parseMarkdown(text)))).toBe(letters(withoutMarkup(text)));
  });

  it("tampoco a medias: en cada punto de la escritura, con lo que quedó sin cerrar", () => {
    for (const text of SAMPLES) {
      for (let cut = 1; cut <= text.length; cut++) {
        const part = text.slice(0, cut);
        // A medias, la última línea puede ser solo la marca de lo que viene («-», «##»): esa aún no se pinta.
        const expected = letters(withoutMarkup(part));
        const got = letters(visibleText(parseMarkdown(part, { streaming: true })));
        expect(got, `a los ${cut} caracteres de «${text.slice(0, 24)}…»`).toBe(expected);
      }
    }
  });

  it("un número largo entre corchetes es texto, no una cita que pueda quedar sin fuente", () => {
    const parsed = parseMarkdown("Según el Acuerdo [012] de [2024], aplica [1].");
    expect(parsed.sentences[0].pieces.filter((p) => p.kind === "cite").map((p) => p.value)).toEqual(["1"]);
    expect(visibleText(parsed)).toBe("Según el Acuerdo [012] de [2024], aplica [1].");
    expect(toPlain(parsed)).toContain("[2024]");
  });

  it("unos corchetes seguidos de un paréntesis que no es una dirección se quedan como están", () => {
    expect(visibleText(parseMarkdown("Vea [la nota](véase el anexo dos) antes."))).toBe("Vea [la nota](véase el anexo dos) antes.");
    expect(visibleText(parseMarkdown("El conjunto [a, b](c, d) es otro."))).toBe("El conjunto [a, b](c, d) es otro.");
    // Una dirección que no es http(s) sí es marca: queda el texto, sin enlace.
    expect(visibleText(parseMarkdown("Abra [el portal](javascript:alert(1)) ya."))).toContain("el portal");
    expect(visibleText(parseMarkdown("Abra [el portal](/datos-abiertos) ya."))).toBe("Abra el portal ya.");
  });

  it("lo escrito en la línea que abre un bloque de código no se descarta", () => {
    expect(letters(visibleText(parseMarkdown("```así se escribe``` y luego sigue el texto")))).toBe("así se escribe y luego sigue el texto");
    expect(letters(visibleText(parseMarkdown("``` esto no es un lenguaje\ncuerpo\n```\nfinal")))).toBe("esto no es un lenguaje cuerpo final");
    // El nombre del lenguaje sí es marca.
    expect(letters(visibleText(parseMarkdown("```python\nx = 1\n```")))).toBe("x 1");
  });

  it("un bloque de código sin cerrar llega hasta el final, entero", () => {
    expect(letters(visibleText(parseMarkdown("Antes.\n```\nuno\ndos\n\ntres")))).toBe("Antes uno dos tres");
  });

  it("un título conserva el «#» que es suyo", () => {
    expect(visibleText(parseMarkdown("## Lenguaje C#"))).toBe("Lenguaje C#");
    expect(visibleText(parseMarkdown("## Cerrado con marcas ##"))).toBe("Cerrado con marcas");
  });

  it("una comilla de código o una negrita sin cerrar no se comen el resto", () => {
    expect(letters(visibleText(parseMarkdown("Use la tecla ` y siga leyendo hasta el final.")))).toBe("Use la tecla y siga leyendo hasta el final");
    expect(letters(visibleText(parseMarkdown("Esto es **importante y nunca se cierra.\n\nOtro párrafo.")))).toBe("Esto es importante y nunca se cierra Otro párrafo");
    expect(letters(visibleText(parseMarkdown("Un [corchete sin cerrar y un (paréntesis también.")))).toBe("Un corchete sin cerrar y un paréntesis también");
  });
});
