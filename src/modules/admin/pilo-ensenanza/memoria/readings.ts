/* =============================================================================
   Mr. Pilo · Memoria · lo que leyó en otros portales (0127) · sin pantalla.

   El chat de Pilo puesto en otra página manda aquí el texto de la página que
   lo aloja. No entra solo a la memoria: queda en la bandeja de lecturas del
   Pilo que la leyó, y la administración la guarda en una colección de ese
   mismo ámbito o la descarta. Guardada, es un documento más («web»): la
   búsqueda por palabras, la búsqueda por significado y «Comprender» lo toman
   igual que a un archivo.

   Funciones puras (se prueban en node): el texto de la bandeja a los bloques
   que entiende el troceo de la Memoria, y de ahí a las filas del documento.
   ========================================================================== */

import { toPassagesReport } from "../ingest/chunk";
import type { Block, ParsedDocument } from "../ingest/types";

/** Una lectura pendiente, como la guarda la base. */
export interface ReadingRow {
  id: string;
  space: string;
  url: string;
  url_hash: string;
  host: string;
  title: string;
  body: string;
  chars: number;
  sections: number;
  omitted: number;
  content_hash: string;
  seen: number;
  status: "pendiente" | "guardada" | "descartada";
  doc_id: string | null;
  first_seen: string;
  last_seen: string;
}

/**
 * El texto de la bandeja como documento: cada línea «## …» es un título (así
 * lo deja el servidor) y lo demás, párrafos. Va como un Word para el troceo:
 * no tiene páginas ni tablas.
 */
export function readingDocument(body: string): ParsedDocument {
  const blocks: Block[] = [];
  for (const raw of body.split(/\n{2,}/)) {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const heading = /^##\s+(.+)$/.exec(text);
    blocks.push(heading ? { type: "heading", level: 2, text: heading[1].trim() } : { type: "paragraph", text });
  }
  return { kind: "docx", pages: 0, blocks, warnings: [], scanned: false };
}

/** Las filas del documento: los pasajes de la página, cada uno con la dirección de donde salió (la fuente enlaza allí). */
export function readingRows(reading: Pick<ReadingRow, "body" | "url">, title: string): { seq: number; title: string; section: string; body: string; path: string; cut: string }[] {
  return toPassagesReport(readingDocument(reading.body), { title }).passages.map((p) => ({ ...p, path: reading.url }));
}

/** «www.udes.edu.co/admisiones»: la dirección como se lee, sin protocolo. */
export const readingWhere = (url: string): string => url.replace(/^https?:\/\//i, "").replace(/\/+$/, "");

/** El título con que se guarda: el de la página o, si no trae, su dirección. */
export const readingTitle = (reading: Pick<ReadingRow, "title" | "url">): string => (reading.title.trim() || readingWhere(reading.url)).slice(0, 300);
