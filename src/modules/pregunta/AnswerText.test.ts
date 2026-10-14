import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AnswerText, parseAnswer } from "./AnswerText";
import type { AskSource } from "../../components/pilo/ai/client";

const SOURCE: AskSource = { n: 1, ref: "cifras:1", source: "cifras", title: "Estudiantes matriculados", section: "", path: "/cifras", cut: "2024", office: "", excerpt: "" };

/** Lo que pinta la página, como marcado estático (sin navegador). */
function render(text: string, options: { streaming?: boolean; shown?: number } = {}) {
  // En el servidor, React avisa de useLayoutEffect: aquí no importa.
  const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const parsed = parseAnswer(text, { streaming: options.streaming });
  const shown = options.shown ?? parsed.count;
  const html = renderToStaticMarkup(
    createElement(AnswerText, { parsed, shown, typing: shown < parsed.count, streaming: options.streaming, reading: null, sources: [SOURCE], active: null, onSource: () => undefined, onFinish: () => undefined }),
  );
  quiet.mockRestore();
  return html;
}

describe("el texto de una respuesta", () => {
  it("se parte en frases que se leen sin las citas", () => {
    const p = parseAnswer("En 2025-2 hay 15.870 estudiantes [1]. Bucaramanga concentra 9.412 [1].\n\nCreció 3,1 % [2].");
    expect(p.paragraphs).toHaveLength(2);
    expect(p.sentences.map((s) => s.spoken)).toEqual(["En 2025-2 hay 15.870 estudiantes.", "Bucaramanga concentra 9.412.", "Creció 3,1 %."]);
  });

  it("cuenta palabras y citas para la escritura, en orden", () => {
    const p = parseAnswer("Hola [1] mundo.");
    expect(p.count).toBe(3);
    const visible = p.sentences[0].pieces.filter((x) => x.order >= 0).map((x) => `${x.kind}:${x.value}`);
    expect(visible).toEqual(["word:Hola", "cite:1", "word:mundo."]);
  });
});

describe("cómo se pinta una respuesta", () => {
  it("el Markdown sale como elementos: negrita, lista, código y título modesto", () => {
    const html = render("## Sedes\n\nHay **tres** sedes:\n\n1. Bucaramanga [1]\n2. Cúcuta\n\nUse `x` así:\n\n```\na < b\n```");
    expect(html).toContain('<p class="ap-h" role="heading" aria-level="4">');
    expect(html).toContain("<strong>tres</strong>");
    expect(html).toContain('<ol class="ap-list"><li value="1">');
    expect(html).toContain("<code>x</code>");
    // El bloque de código lleva su barra (lenguaje y «Copiar») y su texto, línea por línea.
    expect(html).toContain('<pre class="px-pre" tabindex="0">');
    expect(html).toContain("a &lt; b");
    expect(html).toContain("Copiar");
    expect(html).not.toMatch(/\*\*|##|```/);
  });

  it("la cita sigue siendo un botón con el nombre de su fuente, también dentro de una lista y una negrita", () => {
    const html = render("- **9.412 estudiantes [1]** en Bucaramanga");
    expect(html).toContain('<button type="button" class="ap-cite" aria-pressed="false" aria-label="Fuente 1: Estudiantes matriculados">1</button>');
    expect(render("Una cita sin fuente [7].")).not.toContain("ap-cite");
  });

  it("los enlaces http(s) abren aparte y sin referente; los demás no son enlaces", () => {
    const html = render("Vea [el portal](https://udes.edu.co/cifras) y [esto](javascript:alert(1)).");
    expect(html).toContain('<a class="ap-link" href="https://udes.edu.co/cifras" target="_blank" rel="noopener noreferrer">');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).not.toContain("javascript:");
  });

  it("el HTML de la respuesta se ve como texto, nunca como etiquetas", () => {
    const html = render('<img src=x onerror="alert(1)"> <script>alert(1)</script>');
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img");
  });

  it("a medias: una negrita sin cerrar no deja asteriscos y el cursor va al final", () => {
    const html = render("El total es **20.500 estudiantes", { streaming: true });
    expect(html).not.toContain("*");
    expect(html).toContain("<strong>estudiantes</strong>");
    expect(html.match(/ap-caret/g)).toHaveLength(1);
    expect(render("Texto completo.")).not.toContain("ap-caret");
  });

  it("la escritura de una respuesta entera muestra solo lo ya escrito", () => {
    const html = render("Uno dos tres.\n\n- cuatro", { shown: 2 });
    expect(html).toContain("dos");
    expect(html).not.toContain("tres");
    expect(html).not.toContain("<ul");
  });
});
