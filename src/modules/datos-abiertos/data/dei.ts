/* =============================================================================
   Diversidad, Equidad e Inclusión: lectura común del informe DE.

   Lo usan el tablero de la ficha (DiversityBoard) y las hojas del boletín
   (boletin/dei.tsx), así los dos leen las mismas claves, cuentan igual la
   reserva estadística y pintan cada pueblo con el mismo color.
   ========================================================================== */

import { valueOf } from "./open-data";
import type { Breakdown, BreakdownItem, CampusId, Indicator } from "./types";

/* --- Claves del informe ----------------------------------------------------------- */

export const IND = {
  grupo: "grupo-especial",
  etnico: "etnico",
  discapacidad: "discapacidad",
  victima: "victima",
  rural: "rural",
  estratoBajo: "estrato-bajo",
  cobertura: "cobertura-discapacidad",
} as const;

export const BD = {
  tipoDiscapacidad: "tipo-discapacidad",
  indigena: "pueblo-indigena",
  negra: "comunidad-negra",
  estrato: "estrato",
  genero: "genero",
  zona: "zona",
} as const;

export const INES_KEY = "ines-grupos";

/* --- Un color por pueblo o comunidad ---------------------------------------------
   Cada pueblo conserva su color de un corte a otro: Wayuu es el mismo tono en
   2021 y en 2025, y se reconoce sin leer. Los pueblos que llegan después
   toman un tono por su nombre, siempre el mismo. El nombre y la cifra van en
   la tesela: el color distingue, no informa solo. */
export const ETNIA_TONE: Record<string, number> = {
  wayuu: 1,
  otro: 7,
  kakuamo: 3,
  kankuamo: 3,
  "arhuaco (ijka)": 5,
  "wiwa (arzario)": 4,
  "zenu / senu": 2,
  "yuko (yukpa)": 6,
  "chimila (ette e'neka": 8,
  achagua: 9,
  "bari (motilon)": 10,
  kogui: 11,
  pijaos: 12,
  afrocolombianos: 2,
  raizales: 6,
  palenqueros: 5,
  "otras comunidades negras": 10,
};
export const plain = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function toneOf(label: string): string {
  const key = plain(label);
  let n = ETNIA_TONE[key];
  if (!n) {
    let h = 0;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    n = (h % 12) + 1;
  }
  return `var(--od-etnia-${n})`;
}

/** La cifra del DE se captura en el segundo periodo del año. */
export const TERM = "B" as const;
export const cut = (year: number) => `${year}-2`;

/* --- Lectura de datos ------------------------------------------------------------- */

export const published = (item: BreakdownItem) => !item.reserved && item.value !== null;
export const sumOf = (items: BreakdownItem[]) => items.filter(published).reduce((s, i) => s + (i.value as number), 0);

/** Las categorías del corte tal como se capturaron (periodo 2), o la cifra del año. */
export function itemsOf(b: Breakdown | undefined, year: number): BreakdownItem[] {
  if (!b) return [];
  const byTerm = b.terms?.[year]?.[TERM];
  if (byTerm?.length) return byTerm;
  return b.values[year] ?? [];
}

export function cell(ind: Indicator | undefined, year: number, campus: CampusId): number | null {
  if (!ind) return null;
  return valueOf(ind, year, campus);
}

/* --- Mosaico: treemap ------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Treemap cuadriculado (Bruls, Huizing y van Wijk): tiles lo más cuadradas posible. */
export function squarify(values: number[], box: Rect): Rect[] {
  const total = values.reduce((s, v) => s + v, 0);
  if (total <= 0 || box.w <= 0 || box.h <= 0) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
  const areas = values.map((v) => (v / total) * box.w * box.h);
  const out: Rect[] = [];
  let rect = { ...box };
  let row: number[] = [];

  const worst = (r: number[], side: number) => {
    const s = r.reduce((a, b) => a + b, 0);
    const max = Math.max(...r);
    const min = Math.min(...r);
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const place = (r: number[]) => {
    const s = r.reduce((a, b) => a + b, 0);
    if (rect.w >= rect.h) {
      const w = s / rect.h;
      let y = rect.y;
      for (const a of r) {
        out.push({ x: rect.x, y, w, h: a / w });
        y += a / w;
      }
      rect = { x: rect.x + w, y: rect.y, w: rect.w - w, h: rect.h };
    } else {
      const h = s / rect.w;
      let x = rect.x;
      for (const a of r) {
        out.push({ x, y: rect.y, w: a / h, h });
        x += a / h;
      }
      rect = { x: rect.x, y: rect.y + h, w: rect.w, h: rect.h - h };
    }
  };

  let i = 0;
  while (i < areas.length) {
    const side = Math.min(rect.w, rect.h);
    if (row.length === 0 || worst([...row, areas[i]], side) <= worst(row, side)) {
      row.push(areas[i]);
      i += 1;
    } else {
      place(row);
      row = [];
    }
  }
  if (row.length) place(row);
  return out;
}

export interface Family {
  key: string;
  name: string;
  tone: string;
  items: BreakdownItem[];
  reserved: string[];
  zero: number;
  total: number;
}

export function familyOf(b: Breakdown | undefined, year: number, name: string, tone: string): Family | null {
  if (!b) return null;
  const all = itemsOf(b, year);
  const items = all.filter((i) => published(i) && (i.value as number) > 0).sort((a, c) => (c.value as number) - (a.value as number));
  return {
    key: b.id,
    name,
    tone,
    items,
    reserved: all.filter((i) => i.reserved).map((i) => i.label),
    zero: all.filter((i) => !i.reserved && i.value === 0).length,
    total: sumOf(items),
  };
}

