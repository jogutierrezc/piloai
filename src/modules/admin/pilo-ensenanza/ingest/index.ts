/* =============================================================================
   Pilo Enseñanza · lectores de documentos · entrada.

   `readDocument(file)` elige el lector por extensión o tipo MIME y devuelve
   el modelo común. Los lectores pesados (exceljs, pdf.js) se cargan solo
   cuando hace falta.
   ========================================================================== */

import { importFresh } from "../../../../lib/stale-chunk";
import { readCsv } from "./csv";
import { readDocxDocument } from "./docx";
import { readPdfPages } from "./pdf";
import { LIMITS, type DocKind, type ParsedDocument } from "./types";

export { toPassages, toPassagesReport } from "./chunk";
export type { PassageReport } from "./chunk";
export { redactPersonal } from "./redact";
export { LIMITS, SCANNED_MESSAGE } from "./types";
export type { Block, DocKind, ParsedDocument, Passage, PassageMeta } from "./types";

const MIME: Record<string, DocKind> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "text/csv": "csv",
  "application/csv": "csv",
  "application/pdf": "pdf",
};

export function kindOf(file: { name: string; type?: string }): DocKind | null {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === "docx" || ext === "xlsx" || ext === "csv" || ext === "pdf") return ext;
  return MIME[file.type ?? ""] ?? null;
}

export async function readDocument(file: File): Promise<ParsedDocument> {
  if (file.size > LIMITS.fileBytes) throw new Error("El archivo pesa más de 25 MB: divídalo o suba una versión más liviana.");
  const kind = kindOf(file);
  if (!kind) throw new Error("Formato no admitido: use Word (.docx), Excel (.xlsx), CSV o PDF.");
  const buffer = await file.arrayBuffer();
  if (kind === "xlsx") return (await importFresh(() => import("./xlsx"))).readXlsx(buffer);
  const bytes = new Uint8Array(buffer);
  if (kind === "docx") return readDocxDocument(bytes);
  if (kind === "csv") return readCsv(bytes, file.name.replace(/\.[^.]+$/, ""));
  const { loadPdfPages } = await importFresh(() => import("./pdf-load"));
  return readPdfPages(await loadPdfPages(bytes));
}
