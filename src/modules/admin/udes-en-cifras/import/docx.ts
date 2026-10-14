/* =============================================================================
   Leer un Word (.docx) sin servidor.

   Un .docx es un zip; el texto vive en word/document.xml. Se recorre en orden
   y se devuelve como bloques: párrafos (con su estilo) y tablas (filas de
   celdas). Basta para leer títulos, textos, estados y fuentes de un informe;
   las cifras se toman de los CSV, que son la fuente exacta.
   ========================================================================== */

import { strFromU8, unzipSync } from "fflate";

export type DocBlock = { type: "p"; style: string; text: string } | { type: "table"; rows: string[][] };

const decode = (text: string) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, "&");

/** Texto de un fragmento de XML de Word: w:t, tabulaciones y saltos. */
function textOf(xml: string): string {
  let out = "";
  for (const match of xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
    if (match[1] !== undefined) out += decode(match[1]);
    else out += match[0] === "<w:tab/>" ? "\t" : "\n";
  }
  return out;
}

export function readDocx(bytes: Uint8Array): DocBlock[] {
  const files = unzipSync(bytes, { filter: (file) => file.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("El archivo no parece un Word (.docx): no tiene word/document.xml.");
  const body = strFromU8(xml);
  const blocks: DocBlock[] = [];
  for (const match of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const part = match[0];
    if (part.startsWith("<w:tbl>")) {
      const rows = [...part.matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((row) =>
        [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((cell) =>
          [...cell[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => textOf(p[0])).join("\n").trim(),
        ),
      );
      blocks.push({ type: "table", rows });
    } else {
      const text = textOf(part).trim();
      if (!text) continue;
      const style = part.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? "";
      blocks.push({ type: "p", style, text });
    }
  }
  return blocks;
}

export interface DocPoint {
  number: number;
  title: string;
  paragraphs: string[];
  tables: string[][][];
}

export interface ReportDoc {
  lines: string[];
  points: Map<number, DocPoint>;
}

/**
 * Agrupa el Word por puntos: cada título "Punto N. …" abre uno, y lo que sigue
 * hasta el próximo le pertenece. Lo anterior al primer punto es la cabecera.
 */
export function splitPoints(blocks: DocBlock[]): ReportDoc {
  const lines: string[] = [];
  const points = new Map<number, DocPoint>();
  let current: DocPoint | null = null;
  for (const block of blocks) {
    if (block.type === "p") {
      const heading = block.text.match(/^Punto\s+(\d+)\.\s*(.+)$/i);
      if (heading) {
        current = { number: Number(heading[1]), title: heading[2].trim(), paragraphs: [], tables: [] };
        points.set(current.number, current);
        continue;
      }
      if (current) current.paragraphs.push(block.text);
      else lines.push(block.text);
    } else if (current) {
      current.tables.push(block.rows);
    }
  }
  return { lines, points };
}
