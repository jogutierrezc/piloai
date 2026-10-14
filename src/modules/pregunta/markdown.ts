/* =============================================================================
   Pregúntele a Pilo · el Markdown básico de una respuesta, sin dependencias.

   Convierte el texto en bloques (párrafos, títulos, listas, bloques de código)
   y cada bloque en frases y piezas (palabras, espacios, saltos y citas [n]).
   Nada se convierte en HTML: la página pinta las piezas como elementos de
   React, así que una etiqueta escrita en la respuesta se ve como texto.

   Tolera el Markdown a medias mientras la respuesta se escribe: una negrita o
   un bloque de código sin cerrar se pintan como si ya lo estuvieran, para que
   el texto no cambie de forma cuando llega el cierre.

   Solo enlaza direcciones http(s). Las tablas no se dibujan: cada fila queda
   como una línea legible.

   Regla de la casa: lo que no se reconoce como marca se pinta como texto.
   Ninguna palabra de la respuesta desaparece por parecerse a una marca: un
   número largo entre corchetes no es una cita, lo que va entre paréntesis
   tras unos corchetes y no es una dirección sigue siendo texto, y lo escrito
   en la misma línea que abre un bloque de código no se descarta.
   ========================================================================== */

export interface Piece {
  kind: "word" | "space" | "cite" | "break";
  value: string;
  /** Orden entre las piezas visibles (palabras y citas), para la escritura. -1: no cuenta. */
  order: number;
  bold?: true;
  italic?: true;
  code?: true;
  /** Dirección http(s) del enlace al que pertenece la pieza. */
  href?: string;
  /** Las piezas seguidas de un mismo enlace comparten este número. */
  link?: number;
}

export interface Sentence {
  pieces: Piece[];
  /** El texto que se lee en voz alta: sin las citas ni las marcas. */
  spoken: string;
}

export interface ListItem {
  depth: number;
  sentences: Sentence[];
}

export type Block =
  | { kind: "p"; sentences: Sentence[] }
  | { kind: "h"; level: number; sentences: Sentence[] }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "code"; text: string; order: number; lang?: string };

export interface Parsed {
  blocks: Block[];
  /** Los grupos de frases de cada bloque de texto (párrafo, título o ítem), en orden. */
  paragraphs: Sentence[][];
  sentences: Sentence[];
  /** Cuántas piezas visibles tiene (palabras, citas y bloques de código). */
  count: number;
}

export interface ParseOptions {
  /** La respuesta aún se está escribiendo: lo que quedó abierto se da por cerrado. */
  streaming?: boolean;
}

/** Solo http(s): `javascript:`, `data:` y demás no se enlazan nunca. */
export function safeUrl(raw: string): string | null {
  const url = raw.trim();
  if (!/^https?:\/\/[^\s/]/i.test(url)) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
  } catch {
    return null;
  }
}

/* --- En línea ------------------------------------------------------------------------- */

interface Run {
  text: string;
  bold: boolean;
  italic: boolean;
  code?: boolean;
  cite?: boolean;
  href?: string;
  link?: number;
}

const WORD = /[\p{L}\p{N}]/u;
const ESCAPABLE = /[\\`*_[\]()#+\-.!>|~]/;

function hasCloser(s: string, from: number, marker: string): boolean {
  const rest = s.slice(from);
  if (marker === "**") return rest.includes("**");
  if (marker === "__") return /\S__(?![\p{L}\p{N}])/u.test(rest);
  if (marker === "*") return /[^\s*](?:\*\*)?\*(?!\*)/.test(rest);
  return /[^\s_]_(?![\p{L}\p{N}_])/u.test(rest);
}

function inlineRuns(s: string, streaming: boolean, nextLink: () => number): Run[] {
  const runs: Run[] = [];
  let bold = false;
  let italic = false;
  let text = "";
  const flush = () => {
    if (text) runs.push({ text, bold, italic });
    text = "";
  };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);

    if (c === "\\" && i + 1 < s.length && ESCAPABLE.test(s[i + 1])) {
      text += s[i + 1];
      i += 2;
      continue;
    }

    if (c === "`") {
      const close = s.indexOf("`", i + 1);
      const inner = close === -1 ? s.slice(i + 1) : s.slice(i + 1, close);
      flush();
      if (inner.trim()) runs.push({ text: inner.replace(/\s+/g, " ").trim(), bold, italic, code: true });
      i = close === -1 ? s.length : close + 1;
      continue;
    }

    if (c === "[") {
      // Una cita es un número corto: «[2024]» o «[012]» son texto de la respuesta, no fuentes.
      const cite = /^\[(\d{1,2})\]/.exec(rest);
      if (cite) {
        flush();
        runs.push({ text: cite[1], bold, italic, cite: true });
        i += cite[0].length;
        continue;
      }
      const link = /^\[([^\]\n]+)\]\(\s*((?:[^()\s]|\([^()\s]*\))*)[^)\n]*(\))?/.exec(rest);
      // Lo que va entre paréntesis ¿es una dirección (o un intento de una), o es texto de la respuesta?
      // A medias (sin cerrar) también vale el comienzo de una dirección: «(htt».
      const target = link ? link[2] : "";
      const isTarget = /^(?:[a-z][a-z0-9+.-]*:|\/|#|\?|\.{1,2}\/|www\.)/i.test(target) || (link !== null && !link[3] && /^[a-z][a-z0-9+.-]*$|^$/i.test(target));
      if (link && isTarget && (link[3] || (streaming && i + link[0].length === s.length))) {
        flush();
        const href = link[3] ? safeUrl(link[2]) : null;
        // Sin dirección segura queda el texto, sin enlace.
        if (href) runs.push({ text: link[1], bold, italic, href, link: nextLink() });
        else runs.push({ text: link[1], bold, italic });
        i += link[0].length;
        continue;
      }
    }

    if ((c === "h" || c === "H") && (i === 0 || !WORD.test(s[i - 1]))) {
      const bare = /^https?:\/\/[^\s<>"'`[\]]+/i.exec(rest);
      if (bare) {
        let raw = bare[0].replace(/[.,;:!?…*_]+$/, "");
        // Un paréntesis de cierre que no abrió dentro de la dirección es del texto.
        while (raw.endsWith(")") && raw.split("(").length <= raw.split(")").length - 1) raw = raw.slice(0, -1);
        const href = safeUrl(raw);
        if (href) {
          flush();
          runs.push({ text: raw, bold, italic, href, link: nextLink() });
          i += raw.length;
          continue;
        }
      }
    }

    if (c === "*" || c === "_") {
      let n = 1;
      while (s[i + n] === c && n < 3) n += 1;
      const before = i > 0 ? s[i - 1] : "";
      const after = s[i + n] ?? "";
      // Dentro de una palabra el guion bajo es texto («guion_bajo»); entre dos cifras, el asterisco es una multiplicación («2*3*4»).
      const inWord = (c === "_" && before !== "" && WORD.test(before) && after !== "" && WORD.test(after)) || (c === "*" && n === 1 && /\d/.test(before) && /\d/.test(after));
      const canOpen = after !== "" && !/\s/.test(after) && !inWord;
      const canClose = before !== "" && !/\s/.test(before) && !inWord;
      const wantsBold = n >= 2;
      const wantsItalic = n === 1 || n === 3;
      let used = false;
      if (wantsBold) {
        if (bold && canClose) {
          flush();
          bold = false;
          used = true;
        } else if (!bold && canOpen && (c === "*" || hasCloser(s, i + n, "__"))) {
          // Una negrita con asteriscos sin cerrar se da por buena: así no cambia al llegar el cierre.
          flush();
          bold = true;
          used = true;
        }
      }
      if (wantsItalic && (used || n === 1)) {
        if (italic && canClose) {
          flush();
          italic = false;
          used = true;
        } else if (!italic && canOpen && ((c === "*" && streaming) || hasCloser(s, i + n, c))) {
          flush();
          italic = true;
          used = true;
        }
      }
      if (used) {
        i += n;
        continue;
      }
      text += s.slice(i, i + n);
      i += n;
      continue;
    }

    text += c;
    i += 1;
  }
  flush();
  return runs;
}

const TERMINAL = /[.!?…]["»”’)]*$/;

function sentenceOf(pieces: Piece[]): Sentence {
  return {
    pieces,
    spoken: pieces
      .filter((p) => p.kind === "word" || p.kind === "space")
      .map((p) => p.value)
      .join("")
      .replace(/\s+([.,;:])/g, "$1")
      .trim(),
  };
}

/* --- Bloques ---------------------------------------------------------------------------- */

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;
const HEAD = /^\s{0,3}(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const ITEM = /^(\s*)(?:([-*+•])|(\d{1,3})[.)])\s+(\S.*)$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const QUOTE = /^\s{0,3}>\s?/;

/** Una fila de tabla como una línea legible: «Sede · Estudiantes». */
function tableRow(line: string): string | null {
  const t = line.trim();
  if (!t.startsWith("|") || t.indexOf("|", 1) === -1) return null;
  return t
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
    .filter(Boolean)
    .join(" · ");
}

/** Parte la respuesta en bloques, frases y piezas. Las citas [n] se quedan en la frase que las lleva. */
export function parseMarkdown(text: string, options: ParseOptions = {}): Parsed {
  const streaming = Boolean(options.streaming);
  let order = 0;
  let linkSeq = 0;
  const nextLink = () => ++linkSeq;
  const sentences: Sentence[] = [];
  const paragraphs: Sentence[][] = [];
  const blocks: Block[] = [];

  /** Texto en línea → frases. Una frase termina en . ! ? … seguidos de espacio, o en un salto de línea. */
  const inline = (raw: string): Sentence[] => {
    const pieces: Piece[] = [];
    for (const run of inlineRuns(raw.trim(), streaming, nextLink)) {
      const marks: Partial<Piece> = {};
      if (run.bold) marks.bold = true;
      if (run.italic) marks.italic = true;
      if (run.href) {
        marks.href = run.href;
        marks.link = run.link;
      }
      if (run.cite) {
        pieces.push({ kind: "cite", value: run.text, order: order++ });
        continue;
      }
      if (run.code) {
        pieces.push({ kind: "word", value: run.text, order: order++, ...marks, code: true });
        continue;
      }
      for (const part of run.text.split(/(\s+)/)) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          if (part.includes("\n")) pieces.push({ kind: "break", value: "\n", order: -1 });
          else pieces.push({ kind: "space", value: " ", order: -1, ...(run.href ? { href: run.href, link: run.link } : {}) });
        } else pieces.push({ kind: "word", value: part, order: order++, ...marks });
      }
    }
    const group: Sentence[] = [];
    let current: Piece[] = [];
    const close = () => {
      if (current.some((p) => p.kind === "word" || p.kind === "cite")) group.push(sentenceOf(current));
      current = [];
    };
    pieces.forEach((p, j) => {
      if (p.kind === "break") {
        if (current.length) current.push(p);
        close();
        return;
      }
      if (p.kind === "space") {
        const prev = pieces[j - 1];
        const next = pieces[j + 1];
        const ends = prev?.kind === "word" && !prev.code && TERMINAL.test(prev.value) && next && next.kind !== "cite" && next.kind !== "break" && !(next.kind === "word" && next.value.startsWith("["));
        // El espacio entre dos frases lo pone la página; dentro de un enlace se conserva.
        if (ends && !(p.link && next.link === p.link)) {
          close();
          return;
        }
        if (!current.length) return;
      }
      current.push(p);
    });
    close();
    for (const s of group) sentences.push(s);
    if (group.length) paragraphs.push(group);
    return group;
  };

  let para: string[] = [];
  let listing: { ordered: boolean; start: number; indent: number; items: { depth: number; raw: string }[]; gap: boolean } | null = null;

  const flushPara = () => {
    if (!para.length) return;
    const group = inline(para.join("\n"));
    if (group.length) blocks.push({ kind: "p", sentences: group });
    para = [];
  };
  const flushList = () => {
    if (!listing) return;
    const items: ListItem[] = [];
    for (const item of listing.items) {
      const group = inline(item.raw);
      if (group.length) items.push({ depth: item.depth, sentences: group });
    }
    if (items.length) blocks.push({ kind: "list", ordered: listing.ordered, start: listing.start, items });
    listing = null;
  };
  const flush = () => {
    flushPara();
    flushList();
  };

  let source = text.replace(/\r\n?/g, "\n");
  // A medias, la última línea puede ser solo la marca de lo que viene («2.», «-», «##»): aún no se pinta.
  if (streaming) source = source.replace(/(^|\n)[ \t]*(?:[-*+•]|\d{1,3}[.)]|#{1,6})[ \t]*$/, "$1");
  const lines = source.split("\n");
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k].replace(/\t/g, "  ");

    const fence = FENCE.exec(line);
    // «```texto``` y sigue» en una sola línea no abre un bloque: es código en línea dentro de un párrafo.
    const info = fence ? line.slice(fence[0].length).trim() : "";
    if (fence && !info.includes(fence[1][0].repeat(3))) {
      flush();
      const mark = fence[1][0];
      const body: string[] = [];
      // Tras la marca va, si acaso, el nombre del lenguaje (una palabra). Si hay más, es texto: abre el bloque.
      if (/\s/.test(info)) body.push(info);
      k += 1;
      // Sin cierre (la respuesta va a medias o el modelo lo olvidó), el bloque llega hasta el final.
      while (k < lines.length && !new RegExp(`^\\s{0,3}\\${mark}{3,}\\s*$`).test(lines[k])) {
        body.push(lines[k]);
        k += 1;
      }
      const code = body.join("\n").replace(/\s+$/, "");
      // El lenguaje, si la marca lo dice («```python»): es el rótulo del bloque.
      const lang = info && !/\s/.test(info) && /^[\w+#.-]{1,20}$/.test(info) ? info.toLowerCase() : "";
      if (code.trim()) blocks.push({ kind: "code", text: code, order: order++, ...(lang ? { lang } : {}) });
      continue;
    }

    if (!line.trim()) {
      flushPara();
      if (listing) listing.gap = true;
      continue;
    }

    // El filete que separa el encabezado de una tabla se salta sin partir el párrafo.
    if (line.includes("|") && TABLE_SEP.test(line)) continue;
    if (RULE.test(line)) {
      flush();
      continue;
    }

    const head = HEAD.exec(line);
    if (head) {
      flush();
      const group = inline(head[2]);
      if (group.length) blocks.push({ kind: "h", level: head[1].length, sentences: group });
      continue;
    }

    const item = ITEM.exec(line);
    if (item) {
      flushPara();
      const indent = item[1].length;
      const ordered = item[3] !== undefined;
      const nested = listing !== null && indent >= listing.indent + 2;
      if (listing && !nested && listing.ordered !== ordered) flushList();
      if (!listing) listing = { ordered, start: ordered ? Number(item[3]) : 1, indent, items: [], gap: false };
      listing.gap = false;
      listing.items.push({ depth: Math.max(0, Math.min(2, Math.floor((indent - listing.indent) / 2))), raw: item[4] });
      continue;
    }

    // Una línea que sigue a un ítem sin línea en blanco de por medio (o sangrada) es parte de él.
    if (listing && listing.items.length && (!listing.gap || /^\s{2,}/.test(line))) {
      listing.items[listing.items.length - 1].raw += ` ${line.trim()}`;
      continue;
    }

    flushList();
    const row = tableRow(line);
    para.push(row ?? line.replace(QUOTE, "").trim());
  }
  flush();

  return { blocks, paragraphs, sentences, count: order };
}

/**
 * Todo lo que la página pinta de una respuesta, en orden y con las citas como
 * «[n]»: palabras, espacios, código y el número de cada ítem de una lista
 * ordenada. Sirve para comprobar que el análisis no pierde texto.
 */
export function visibleText(parsed: Parsed): string {
  const say = (group: Sentence[]) => group.map((s) => s.pieces.map((p) => (p.kind === "cite" ? `[${p.value}]` : p.kind === "break" ? "\n" : p.value)).join("")).join(" ");
  return parsed.blocks
    .map((b) => {
      if (b.kind === "code") return b.text;
      if (b.kind === "list") {
        let n = b.start;
        return b.items.map((i) => `${b.ordered && i.depth === 0 ? `${n++}. ` : ""}${say(i.sentences)}`).join("\n");
      }
      return say(b.sentences);
    })
    .join("\n");
}

/** Los grupos de frases de un bloque de texto. */
export function groupsOf(block: Block): Sentence[][] {
  if (block.kind === "code") return [];
  if (block.kind === "list") return block.items.map((i) => i.sentences);
  return [block.sentences];
}

/** El texto sin marcas ni citas: para copiar, para el catálogo y para anunciarlo. */
export function toPlain(parsed: Parsed): string {
  const say = (group: Sentence[]) =>
    group
      .map((s) => s.spoken)
      .filter(Boolean)
      .join(" ");
  return parsed.blocks
    .map((b) => {
      if (b.kind === "code") return b.text;
      if (b.kind === "list") {
        let n = b.start;
        return b.items.map((i) => `${"  ".repeat(i.depth)}${b.ordered && i.depth === 0 ? `${n++}.` : "-"} ${say(i.sentences)}`).join("\n");
      }
      return say(b.sentences);
    })
    .filter(Boolean)
    .join("\n\n");
}
