/* =============================================================================
   Pilo Enseñanza · lectores de documentos · modelo común.

   Cada formato (Word, Excel, CSV, PDF) se lee a la misma forma: una lista de
   bloques (título, párrafo o tabla) con su página u hoja, avisos de lo que se
   recortó y la marca de «escaneado». El troceo en pasajes parte de aquí y no
   sabe de formatos.
   ========================================================================== */

export type DocKind = "docx" | "xlsx" | "csv" | "pdf";

export type Block =
  | { type: "heading"; level: number; text: string; page?: number }
  | { type: "paragraph"; text: string; page?: number }
  | { type: "table"; rows: string[][]; sheet?: string; page?: number };

export interface ParsedDocument {
  kind: DocKind;
  /** Páginas del PDF u hojas del libro; 0 cuando el formato no tiene páginas (Word, CSV). */
  pages: number;
  blocks: Block[];
  warnings: string[];
  scanned: boolean;
}

export interface PassageMeta {
  /** Título del documento: sirve de sección y de título cuando no hay encabezados. */
  title: string;
  /** Corte o periodo al que pertenece (por ejemplo «2026»). */
  cut?: string;
}

export interface Passage {
  seq: number;
  title: string;
  section: string;
  body: string;
  cut: string;
}

export const LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  passages: 400,
  rowsPerSheet: 2000,
} as const;

export const SCANNED_MESSAGE = "Este PDF es una imagen: no trae texto. Súbalo en Word o con OCR.";

/** Recorta las filas de una hoja o tabla al tope y deja el aviso si hubo recorte. */
export function capRows(rows: string[][], label: string, warnings: string[]): string[][] {
  if (rows.length <= LIMITS.rowsPerSheet) return rows;
  warnings.push(`${label}: se leyeron solo las primeras ${LIMITS.rowsPerSheet} filas de ${rows.length}.`);
  return rows.slice(0, LIMITS.rowsPerSheet);
}
