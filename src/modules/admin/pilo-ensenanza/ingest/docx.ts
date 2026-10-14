/* =============================================================================
   Pilo Enseñanza · lector de Word (.docx).

   Parte de `readDocx()` de «UDES en Cifras» y le pone sentido: el estilo del
   párrafo dice si es título (Título 1, Heading 2, Title…) y de qué nivel.
   ========================================================================== */

import { readDocx } from "../../udes-en-cifras/import/docx";
import { capRows, type Block, type ParsedDocument } from "./types";

/** «Heading1», «Título2» (Word en español guarda «Ttulo2») y «Title». 0 si no es título. */
export function headingLevel(style: string): number {
  if (/^title$/i.test(style) || /^t[ií]?tulo$/i.test(style)) return 1;
  const match = style.match(/^(?:heading|t[ií]?tulo)\s*(\d)$/i);
  return match ? Math.min(Math.max(Number(match[1]), 1), 6) : 0;
}

export function readDocxDocument(bytes: Uint8Array): ParsedDocument {
  const warnings: string[] = [];
  const blocks: Block[] = [];
  for (const block of readDocx(bytes)) {
    if (block.type === "table") {
      const rows = capRows(
        block.rows.filter((row) => row.some((cell) => cell.trim() !== "")),
        "Tabla de Word",
        warnings,
      );
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }
    const level = headingLevel(block.style);
    blocks.push(level ? { type: "heading", level, text: block.text } : { type: "paragraph", text: block.text });
  }
  if (!blocks.length) warnings.push("El documento de Word no trae texto.");
  return { kind: "docx", pages: 0, blocks, warnings, scanned: false };
}
