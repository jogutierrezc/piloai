/* =============================================================================
   Pilo Enseñanza · lector de Excel (.xlsx).

   Cada hoja visible pasa a una tabla de texto: la primera fila es el
   encabezado. exceljs se carga solo cuando se lee un libro.
   ========================================================================== */

import { capRows, type Block, type ParsedDocument } from "./types";

export async function readXlsx(bytes: ArrayBuffer): Promise<ParsedDocument> {
  const { default: ExcelJS } = await import("exceljs");
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const warnings: string[] = [];
  const blocks: Block[] = [];
  let sheets = 0;
  book.eachSheet((sheet) => {
    if (sheet.state !== "visible") {
      warnings.push(`Se omitió la hoja oculta «${sheet.name}».`);
      return;
    }
    sheets += 1;
    const rows: string[][] = [];
    const width = sheet.columnCount;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let col = 1; col <= width; col += 1) cells.push(row.getCell(col).text.trim());
      if (cells.some((cell) => cell !== "")) rows.push(cells);
    });
    const kept = capRows(rows, `Hoja «${sheet.name}»`, warnings);
    if (kept.length) blocks.push({ type: "table", rows: kept, sheet: sheet.name });
  });
  if (!blocks.length) warnings.push("El libro no tiene hojas visibles con datos.");
  return { kind: "xlsx", pages: sheets, blocks, warnings, scanned: false };
}
