/* =============================================================================
   Pilo Enseñanza · lector de CSV.

   Reutiliza el lector de «UDES en Cifras» (separador detectado por la primera
   línea, comillas). El archivo se decodifica como UTF-8 y, si trae caracteres
   rotos, como Windows-1252, que es lo que exporta Excel en español.
   ========================================================================== */

import { parseCsv } from "../../udes-en-cifras/sheet";
import { capRows, type ParsedDocument } from "./types";

function decode(bytes: Uint8Array): string {
  const utf8 = new TextDecoder("utf-8").decode(bytes);
  return utf8.includes("�") ? new TextDecoder("windows-1252").decode(bytes) : utf8;
}

export function readCsv(bytes: Uint8Array, name = "CSV"): ParsedDocument {
  const warnings: string[] = [];
  const rows = capRows(parseCsv(decode(bytes)), name, warnings);
  if (!rows.length) warnings.push("El archivo CSV no tiene filas con datos.");
  return {
    kind: "csv",
    pages: 0,
    blocks: rows.length ? [{ type: "table", rows, sheet: name }] : [],
    warnings,
    scanned: false,
  };
}
