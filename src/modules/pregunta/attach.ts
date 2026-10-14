/* =============================================================================
   Pregúntele a Pilo · el archivo adjunto (0119).

   El archivo se lee aquí, en el dispositivo de la persona, con los mismos
   lectores de la Memoria de Enseñanza (Word, Excel, CSV y PDF con texto). No
   se sube a ningún lado: con cada pregunta viajan solo los pasajes que más
   tienen que ver con ella, ya sin correos, teléfonos ni documentos.

   Los lectores pesados se cargan solo cuando alguien adjunta algo: no entran
   en el trozo de la página.
   ========================================================================== */

import { DOC_PASSAGE_CHARS, DOC_PASSAGES } from "../../components/pilo/ai/logic";

export const ATTACH_ACCEPT = ".docx,.xlsx,.csv,.pdf";

export interface Attachment {
  name: string;
  /** Todos los pasajes del archivo, en su orden. Viven en memoria mientras dure la conversación. */
  passages: string[];
  /** Datos personales tapados al leerlo. */
  omitted: number;
  warnings: string[];
}

/** Lo que el turno recuerda del archivo: nunca su contenido. */
export interface TurnFile {
  name: string;
  /** Pasajes que tiene el archivo y cuántos viajaron con esta pregunta. */
  total: number;
  sent: number;
  omitted: number;
}

export async function readAttachment(file: File, maxMb: number): Promise<Attachment> {
  if (file.size > maxMb * 1024 * 1024) throw new Error(`El archivo pesa más de ${maxMb} MB: adjunte una versión más liviana.`);
  const { readDocument, toPassagesReport, SCANNED_MESSAGE } = await import("../admin/pilo-ensenanza/ingest");
  const parsed = await readDocument(file);
  if (parsed.scanned) throw new Error(SCANNED_MESSAGE);
  const report = toPassagesReport(parsed, { title: file.name.replace(/\.[^.]+$/, "") });
  const passages = report.passages.map((p) => (p.section && p.section !== p.title ? `${p.section}\n${p.body}` : p.body).trim()).filter(Boolean);
  if (!passages.length) throw new Error("No encontré texto que leer en ese archivo.");
  return { name: file.name.slice(0, 120), passages, omitted: report.redacted, warnings: [...parsed.warnings, ...report.warnings] };
}

const STOP = new Set(["para", "como", "cual", "cuales", "que", "los", "las", "del", "una", "uno", "por", "con", "mis", "sus", "este", "esta", "esto", "hay", "son", "fue", "mas", "sobre", "deme", "dame", "quiero", "puede", "archivo", "documento"]);

const wordsOf = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Los pasajes que viajan con una pregunta: el primero (dice de qué trata el
 * archivo) y los que más palabras comparten con ella, en el orden del archivo.
 * Si la pregunta no nombra nada del archivo («¿qué dice?»), los primeros.
 */
export function pickPassages(passages: string[], question: string, max: number = DOC_PASSAGES, chars: number = DOC_PASSAGE_CHARS): string[] {
  const clipped = passages.map((p) => p.slice(0, chars));
  if (clipped.length <= max) return clipped;
  const asked = new Set(wordsOf(question));
  const scored = clipped.map((p, i) => {
    const seen = new Set(wordsOf(p));
    let score = 0;
    for (const w of asked) if (seen.has(w)) score += 1;
    return { i, score };
  });
  const best = scored
    .filter((s) => s.i > 0 && s.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max - 1)
    .map((s) => s.i);
  const chosen = new Set([0, ...best]);
  // Lo que falte se completa con lo que sigue al comienzo, para no mandar pasajes sueltos.
  for (let i = 1; chosen.size < max && i < clipped.length; i++) chosen.add(i);
  return [...chosen].sort((a, b) => a - b).map((i) => clipped[i]);
}

export const turnFile = (attachment: Attachment, sent: number): TurnFile => ({ name: attachment.name, total: attachment.passages.length, sent, omitted: attachment.omitted });

/** «notas.csv · 12 pasajes». */
export const fileLine = (file: TurnFile): string => `${file.name} · ${file.total} ${file.total === 1 ? "pasaje" : "pasajes"}`;

/** El resumen de lo que Pilo hizo con el archivo, para la bitácora de la respuesta. */
export function fileSteps(file: TurnFile): { verb: string; target: string; meta: string }[] {
  return [
    { verb: "Leyó", target: file.name, meta: `${file.total} ${file.total === 1 ? "pasaje" : "pasajes"} · en este dispositivo` },
    ...(file.omitted ? [{ verb: "Tapó", target: "datos personales", meta: `${file.omitted} ${file.omitted === 1 ? "omitido" : "omitidos"}` }] : []),
    { verb: "Envió", target: "lo necesario para la pregunta", meta: `${file.sent} de ${file.total}` },
  ];
}
