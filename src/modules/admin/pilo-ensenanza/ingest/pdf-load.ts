/* =============================================================================
   Pilo Enseñanza · carga de pdf.js.

   Es el ÚNICO archivo que nombra `pdfjs-dist`, y solo por `import()` dinámico:
   así la librería y su worker quedan en trozos aparte y no llegan a las
   páginas públicas. Devuelve el modelo plano de `pdf.ts`.
   ========================================================================== */

import type { PdfPage } from "./pdf";

/** `maxPages`: lee solo las primeras páginas (la biblioteca de rankings lo usa para no leer PDF enormes). */
export async function loadPdfPages(bytes: Uint8Array, maxPages = Infinity): Promise<PdfPage[]> {
  const pdfjs = await import("pdfjs-dist");
  // Vite emite el worker como archivo propio y entrega su dirección.
  const { default: workerSrc } = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  const pages: PdfPage[] = [];
  try {
    for (let number = 1; number <= Math.min(doc.numPages, maxPages); number += 1) {
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const items: PdfPage["items"] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        const [a, b, , , x, y] = item.transform as number[];
        items.push({ text: item.str, size: Math.hypot(a, b), x, y, width: item.width });
      }
      pages.push({ number, items });
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return pages;
}
