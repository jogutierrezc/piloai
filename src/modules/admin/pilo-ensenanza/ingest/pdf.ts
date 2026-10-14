/* =============================================================================
   Pilo Enseñanza · lector de PDF (sobre un modelo plano de páginas).

   No usa pdf.js: recibe, por página, los trozos de texto con su tamaño de
   letra y posición (lo que arma `pdf-load.ts`), así se prueba sin la
   librería. Aquí se arman las líneas, se quitan encabezados y pies repetidos,
   se detecta si el PDF es una imagen y se separan títulos de párrafos.

   Los títulos se reconocen por letra más grande que la mediana (≥ 1,15 ×) o
   por patrones del texto: «Capítulo 2», «Artículo 14», «1.2 Admisión».
   ========================================================================== */

import { SCANNED_MESSAGE, type Block, type ParsedDocument } from "./types";

export interface PdfItem {
  text: string;
  size: number;
  x: number;
  /** Posición vertical al estilo PDF: crece hacia arriba. */
  y: number;
  width?: number;
}

export interface PdfPage {
  number: number;
  items: PdfItem[];
}

interface Line {
  page: number;
  text: string;
  size: number;
  y: number;
}

const HEADING_RATIO = 1.15;
const HEADING_MAX_CHARS = 100;
const SCAN_AVG_CHARS = 40;
const SCAN_PAGE_CHARS = 20;
/** Franja (fracción de la altura usada) donde viven encabezados y pies. */
const EDGE_BAND = 0.12;

/* --- Líneas ---------------------------------------------------------------------------------- */

function joinItems(items: PdfItem[]): string {
  let text = "";
  let prev: PdfItem | null = null;
  for (const item of items) {
    if (prev) {
      const gap = prev.width === undefined ? Infinity : item.x - (prev.x + prev.width);
      if (gap > prev.size * 0.15 && !/\s$/.test(text) && !/^\s/.test(item.text)) text += " ";
    }
    text += item.text;
    prev = item;
  }
  return text.replace(/\s+/g, " ").trim();
}

/** Tamaño de letra que domina la línea (el del trozo con más caracteres). */
function dominantSize(items: PdfItem[]): number {
  const bySize = new Map<number, number>();
  for (const item of items) {
    const key = Math.round(item.size * 2) / 2;
    bySize.set(key, (bySize.get(key) ?? 0) + item.text.trim().length);
  }
  return [...bySize.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

export function linesOf(page: PdfPage): Line[] {
  const items = page.items.filter((item) => item.text.trim() !== "").sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: PdfItem[][] = [];
  for (const item of items) {
    const group = groups[groups.length - 1];
    if (group && Math.abs(group[0].y - item.y) <= Math.max(2, item.size * 0.4)) group.push(item);
    else groups.push([item]);
  }
  return groups
    .map((group) => group.sort((a, b) => a.x - b.x))
    .map((group) => ({ page: page.number, text: joinItems(group), size: dominantSize(group), y: group[0].y }))
    .filter((line) => line.text !== "");
}

/** Mediana de tamaño de letra ponderada por caracteres: la letra del cuerpo. */
export function bodySize(lines: Line[]): number {
  const sorted = [...lines].sort((a, b) => a.size - b.size);
  const total = sorted.reduce((sum, line) => sum + line.text.length, 0);
  let seen = 0;
  for (const line of sorted) {
    seen += line.text.length;
    if (seen >= total / 2) return line.size;
  }
  return 0;
}

/* --- Encabezados y pies repetidos ------------------------------------------------------------ */

const repeatKey = (text: string) => text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** Quita las líneas que se repiten en el borde de varias páginas (cabeceras, pies, números de página). */
export function dropRepeated(pages: Line[][]): Line[][] {
  if (pages.length < 3) return pages;
  const ys = pages.flat().map((line) => line.y);
  const top = Math.max(...ys);
  const bottom = Math.min(...ys);
  const band = (top - bottom) * EDGE_BAND;
  // Solo cuentan las dos primeras y las dos últimas líneas, y solo si están en la franja de arriba o de abajo.
  const edges = (lines: Line[]) =>
    [...lines.slice(0, 2), ...lines.slice(-2)].filter((line) => line.y >= top - band || line.y <= bottom + band);
  const counts = new Map<string, number>();
  for (const lines of pages) {
    for (const key of new Set(edges(lines).map((line) => repeatKey(line.text)))) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const minimum = Math.max(3, Math.ceil(pages.length * 0.4));
  return pages.map((lines) => {
    const edge = new Set(edges(lines));
    return lines.filter((line) => !(edge.has(line) && (counts.get(repeatKey(line.text)) ?? 0) >= minimum));
  });
}

/* --- Escaneado ------------------------------------------------------------------------------- */

export function looksScanned(pages: Line[][]): boolean {
  if (!pages.length) return true;
  const chars = pages.map((lines) => lines.reduce((sum, line) => sum + line.text.length, 0));
  const average = chars.reduce((a, b) => a + b, 0) / pages.length;
  return average < SCAN_AVG_CHARS || chars.filter((n) => n < SCAN_PAGE_CHARS).length > pages.length / 2;
}

/* --- Títulos --------------------------------------------------------------------------------- */

const UNIT = /^(cap[ií]tulo|t[ií]tulo|secci[oó]n)\s+(\d+|[ivxlc]+|[úu]nico|[úu]nica)\b/i;
const ARTICLE = /^art[ií]culo\s+\d+[º°o]?\.?/i;
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2})*)\.?\s+\p{Lu}/u;

/** Nivel del título por el patrón del texto; 0 si el texto no tiene patrón de título. */
export function patternLevel(text: string): number {
  const unit = text.match(UNIT);
  if (unit) return /^secci/i.test(unit[1]) ? 2 : 1;
  if (ARTICLE.test(text)) return 3;
  const numbered = text.match(NUMBERED);
  if (numbered && !/[.;,]$/.test(text)) return Math.min(numbered[1].split(".").length, 4);
  return 0;
}

function sizeLevel(size: number, body: number): number {
  const ratio = size / body;
  return ratio >= 1.6 ? 1 : ratio >= 1.35 ? 2 : 3;
}

interface Heading {
  level: number;
  text: string;
  byPattern: boolean;
}

function headingOf(line: Line, body: number): Heading | null {
  if (line.text.length > HEADING_MAX_CHARS || /[,;]$/.test(line.text)) return null;
  if (!/\p{L}{2}/u.test(line.text)) return null;
  const pattern = patternLevel(line.text);
  if (pattern) return { level: pattern, text: line.text, byPattern: true };
  if (body > 0 && line.size >= body * HEADING_RATIO) return { level: sizeLevel(line.size, body), text: line.text, byPattern: false };
  return null;
}

/* --- Bloques --------------------------------------------------------------------------------- */

const BULLET = /^(?:[•●·▪‣-]|\d+[.)]|[a-z][.)])\s/;
const ENDS_SENTENCE = /[.!?:;…]$/;

function build(lines: Line[], body: number): Block[] {
  const blocks: Block[] = [];
  let paragraph: { text: string; page: number; y: number; size: number } | null = null;
  let last: Heading | null = null;
  let lastSize = 0;
  let bodyAfterHeading = true;

  const flush = () => {
    if (paragraph) blocks.push({ type: "paragraph", text: paragraph.text, page: paragraph.page });
    paragraph = null;
  };

  for (const line of lines) {
    const heading = headingOf(line, body);
    if (heading) {
      flush();
      const prev = blocks[blocks.length - 1];
      const join = prev?.type === "heading" && last && !bodyAfterHeading && prev.page === line.page;
      // «CAPÍTULO 2» seguido de su nombre en letra grande, o un título partido en dos líneas.
      if (join && !heading.byPattern && (last?.byPattern || Math.abs(lastSize - line.size) < 0.5)) {
        prev.text = `${prev.text} · ${heading.text}`;
      } else {
        blocks.push({ type: "heading", level: heading.level, text: heading.text, page: line.page });
        last = heading;
        lastSize = line.size;
      }
      bodyAfterHeading = false;
      continue;
    }
    // «Artículo 14. Texto…» en una sola línea larga: el rótulo es el título y el resto abre el párrafo.
    const lead = line.text.match(/^(art[ií]culo\s+\d+[º°o]?)\.?\s+(\S.*)$/i);
    let text = line.text;
    if (lead) {
      flush();
      blocks.push({ type: "heading", level: 3, text: lead[1], page: line.page });
      last = { level: 3, text: lead[1], byPattern: true };
      text = lead[2];
    }
    bodyAfterHeading = true;
    const open = paragraph as { text: string; page: number; y: number; size: number } | null;
    if (open) {
      const apart = open.page === line.page && open.y - line.y > Math.max(open.size, line.size) * 1.7;
      const pageBreak = open.page !== line.page && ENDS_SENTENCE.test(open.text);
      if (apart || pageBreak || BULLET.test(text)) flush();
    }
    const current = paragraph as { text: string; page: number; y: number; size: number } | null;
    if (current) {
      const hyphen = /\p{L}-$/u.test(current.text) && /^\p{Ll}/u.test(text);
      current.text = hyphen ? current.text.slice(0, -1) + text : `${current.text} ${text}`;
      current.y = line.y;
      current.page = line.page;
    } else {
      paragraph = { text, page: line.page, y: line.y, size: line.size };
    }
  }
  flush();
  return blocks;
}

/* --- Entrada --------------------------------------------------------------------------------- */

export function readPdfPages(pages: PdfPage[]): ParsedDocument {
  const lines = pages.map(linesOf);
  if (looksScanned(lines)) {
    return { kind: "pdf", pages: pages.length, blocks: [], warnings: [SCANNED_MESSAGE], scanned: true };
  }
  const kept = dropRepeated(lines);
  const flat = kept.flat();
  const warnings: string[] = [];
  const removed = lines.flat().length - flat.length;
  if (removed > 0) warnings.push(`Se quitaron ${removed} líneas de encabezado o pie de página repetidas.`);
  return { kind: "pdf", pages: pages.length, blocks: build(flat, bodySize(flat)), warnings, scanned: false };
}
