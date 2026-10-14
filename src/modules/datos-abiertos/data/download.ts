/* =============================================================================
   Datos Abiertos · entregar un archivo al navegador.

   Datos abiertos que no se pueden bajar no son abiertos. Aquí está lo único
   que toca el DOM en la descarga: un enlace temporal que se pulsa solo. Un
   conjunto baja como su CSV; varios, en un solo .zip, porque el navegador
   bloquea las descargas en serie.

   `fflate` se carga con `import()` dentro del clic: quien solo consulta la
   ficha no lo descarga.

   Sin Supabase ni intranet: lo puede usar cualquier portal público.
   ========================================================================== */

import { toCsvText } from "./csv-export";
import type { CsvFile } from "./csv-export";

const CSV_TYPE = "text/csv;charset=utf-8";

/** Cuánto vive la URL temporal después del clic: lo justo para que la descarga arranque. */
const REVOKE_AFTER_MS = 1000;

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
}

export function downloadText(filename: string, text: string, type = CSV_TYPE): void {
  downloadBlob(new Blob([text], { type }), filename);
}

/** Dos archivos con el mismo nombre se pisarían dentro del zip: el segundo lleva "-2". */
function uniqueNames(names: string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf(".");
    const [stem, extension] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let unique = name;
    for (let n = 2; taken.has(unique); n += 1) unique = `${stem}-${n}${extension}`;
    taken.add(unique);
    return unique;
  });
}

/**
 * Un archivo baja como su .csv. Varios bajan en un .zip, junto con los textos
 * de `extra` (el LEEME). Las tablas se arman aquí, al hacer clic, no antes.
 */
export async function downloadCsvFiles(files: CsvFile[], zipName: string, extra: { name: string; text: string }[] = []): Promise<void> {
  if (files.length === 0) return;
  if (files.length === 1) {
    downloadText(files[0].filename, toCsvText(files[0].build()));
    return;
  }
  const { strToU8, zipSync } = await import("fflate");
  const texts = [...files.map((file) => ({ name: file.filename, text: toCsvText(file.build()) })), ...extra];
  const names = uniqueNames(texts.map((entry) => entry.name));
  const entries: Record<string, Uint8Array> = {};
  texts.forEach((entry, i) => {
    entries[names[i]] = strToU8(entry.text);
  });
  downloadBlob(new Blob([zipSync(entries) as BlobPart], { type: "application/zip" }), /\.zip$/i.test(zipName) ? zipName : `${zipName}.zip`);
}
