/* =============================================================================
   Pilo Enseñanza · troceo en pasajes (puro).

   Del documento leído a pasajes para la memoria:
   - Texto (Word, PDF): se parte por títulos; `section` es la ruta de títulos
     («Capítulo 2 › Artículo 14»). Cada sección se empaca en pasajes de hasta
     1.500 caracteres cortando en párrafo o frase; los de menos de 200 se unen
     a un vecino.
   - Tablas (Excel, CSV, tablas de Word): cada fila va como «Columna: valor;
     …» con su encabezado, hasta 25 filas o 1.400 caracteres por pasaje;
     `section` es «Hoja · filas 26–50».
   Todo texto pasa por clean(), noMoney() y redactPersonal().
   ========================================================================== */

import { clean, noMoney } from "../../pilo/memory";
import { redactPersonal } from "./redact";
import { LIMITS, type Block, type ParsedDocument, type Passage, type PassageMeta } from "./types";

export const SIZE = { min: 200, max: 1500, mergeMax: 1700, rowsMax: 1400, rowsPerPassage: 25 } as const;

export interface PassageReport {
  passages: Passage[];
  warnings: string[];
  /** Datos personales tapados en todo el documento. */
  redacted: number;
}

interface Draft {
  section: string;
  title: string;
  body: string;
  table: boolean;
}

/** Limpieza común del texto que entra a la memoria. */
function sanitize(text: string, tally: { redacted: number }): string {
  const { text: out, count } = redactPersonal(noMoney(clean(text)));
  tally.redacted += count;
  return out;
}

/* --- Texto ----------------------------------------------------------------------------------- */

const SENTENCE_END = /(?<=[.!?…])\s+(?=[\p{Lu}¿¡"«(\d])/u;

/** Parte un texto largo en trozos de a lo sumo `max`: por frase y, si una frase no cabe, por palabra. */
export function splitLong(text: string, max: number = SIZE.max): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let current = "";
  const push = (piece: string) => {
    let rest = piece;
    while (rest.length > max) {
      const cut = rest.lastIndexOf(" ", max);
      const at = cut > max / 2 ? cut : max;
      out.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) out.push(rest);
  };
  for (const sentence of text.split(SENTENCE_END)) {
    if (current && current.length + 1 + sentence.length > max) {
      push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) push(current);
  return out;
}

/** Empaca los párrafos de una sección en pasajes de hasta `max` caracteres. */
export function packParagraphs(paragraphs: string[], max: number = SIZE.max): string[] {
  const out: string[] = [];
  let current = "";
  for (const piece of paragraphs.flatMap((p) => splitLong(p, max))) {
    if (current && current.length + 2 + piece.length > max) {
      out.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Une los pasajes de texto chicos con un vecino (el anterior, o el siguiente si no hay o no cabe). */
function mergeSmall(drafts: Draft[], headOf: Map<Draft, string>): Draft[] {
  const out: Draft[] = [];
  const queue = [...drafts];
  while (queue.length) {
    const draft = queue.shift() as Draft;
    if (draft.table || draft.body.length >= SIZE.min) {
      out.push(draft);
      continue;
    }
    const prev = out[out.length - 1];
    const next = queue[0];
    const lead = prev && prev.section !== draft.section ? `${headOf.get(draft) ?? draft.section}. ` : "";
    if (prev && !prev.table && prev.body.length + 2 + lead.length + draft.body.length <= SIZE.mergeMax) {
      prev.body = `${prev.body}\n\n${lead}${draft.body}`;
    } else if (next && !next.table && next.body.length + 2 + draft.body.length <= SIZE.mergeMax) {
      const heading = draft.section !== next.section ? `${headOf.get(draft) ?? draft.section}. ` : "";
      next.body = `${heading}${draft.body}\n\n${next.body}`;
    } else {
      out.push(draft);
    }
  }
  return out;
}

/* --- Tablas ---------------------------------------------------------------------------------- */

function rowText(header: string[], cells: string[], tally: { redacted: number }): string {
  const parts: string[] = [];
  cells.forEach((cell, index) => {
    const value = sanitize(cell, tally);
    if (!value) return;
    const name = clean(header[index]);
    parts.push(name ? `${name}: ${value}` : value);
  });
  return noMoney(parts.join("; "));
}

function tableDrafts(rows: string[][], label: string, tally: { redacted: number }): Draft[] {
  const [header, ...data] = rows;
  const lines = (data.length ? data : [header]).map((cells, index) => ({
    n: index + (data.length ? 2 : 1),
    text: rowText(data.length ? header : [], cells, tally).slice(0, SIZE.rowsMax),
  }));
  const drafts: Draft[] = [];
  let group: typeof lines = [];
  const close = () => {
    if (!group.length) return;
    drafts.push({
      section: `${label} · filas ${group[0].n}–${group[group.length - 1].n}`,
      title: label,
      body: group.map((line) => line.text).join("\n"),
      table: true,
    });
    group = [];
  };
  for (const line of lines.filter((l) => l.text)) {
    const size = group.reduce((sum, l) => sum + l.text.length + 1, 0);
    if (group.length >= SIZE.rowsPerPassage || (group.length && size + line.text.length > SIZE.rowsMax)) close();
    group.push(line);
  }
  close();
  return drafts;
}

/* --- Recorrido ------------------------------------------------------------------------------- */

export function toPassagesReport(parsed: ParsedDocument, meta: PassageMeta): PassageReport {
  const warnings: string[] = [];
  const tally = { redacted: 0 };
  if (parsed.scanned) return { passages: [], warnings: [...parsed.warnings], redacted: 0 };

  const drafts: Draft[] = [];
  const heads = new Map<Draft, string>();
  const path: { level: number; text: string }[] = [];
  let paragraphs: string[] = [];
  const base = clean(meta.title) || "Documento";
  const sectionName = () => (path.length ? path.map((p) => p.text).join(" › ") : base);
  const titleName = () => path[path.length - 1]?.text ?? base;

  const flushText = () => {
    for (const body of packParagraphs(paragraphs)) {
      const draft: Draft = { section: sectionName(), title: titleName(), body, table: false };
      heads.set(draft, titleName());
      drafts.push(draft);
    }
    paragraphs = [];
  };

  const onBlock = (block: Block) => {
    if (block.type === "heading") {
      flushText();
      const text = sanitize(block.text, tally);
      while (path.length && path[path.length - 1].level >= block.level) path.pop();
      if (text) path.push({ level: block.level, text });
    } else if (block.type === "paragraph") {
      const text = sanitize(block.text, tally);
      if (text) paragraphs.push(text);
    } else {
      flushText();
      const label = block.sheet ?? [...path.map((p) => p.text), "Tabla"].join(" › ");
      if (block.rows.length) drafts.push(...tableDrafts(block.rows, label, tally));
    }
  };
  parsed.blocks.forEach(onBlock);
  flushText();

  let merged = mergeSmall(drafts, heads);
  if (merged.length > LIMITS.passages) {
    warnings.push(`El documento se recortó a ${LIMITS.passages} pasajes; quedaron sin leer ${merged.length - LIMITS.passages}.`);
    merged = merged.slice(0, LIMITS.passages);
  }
  const cut = clean(meta.cut);
  const passages = merged.map((d, index) => ({ seq: index + 1, title: d.title, section: d.section, body: d.body, cut }));
  if (tally.redacted) warnings.push(`Se omitieron ${tally.redacted} datos personales (correos, teléfonos o documentos).`);
  return { passages, warnings, redacted: tally.redacted };
}

/** Pasajes del documento: `{ seq, title, section, body, cut }`. */
export function toPassages(parsed: ParsedDocument, meta: PassageMeta): Passage[] {
  return toPassagesReport(parsed, meta).passages;
}
