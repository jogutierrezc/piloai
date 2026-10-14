/* =============================================================================
   Datos Abiertos · medallero.

   Lo que gana la universidad cuando compite: juegos, festivales, concursos.
   Lo común a la ficha, la intranet y el Boletín.

   Dos ideas sostienen todo lo demás:

   1. Las categorías están *ordenadas*, no numeradas. Oro, plata y bronce es lo
      corriente, pero un concurso premia «Primer puesto» y «Mención de honor».
      Lo que no cambia es que la primera pesa más que la segunda, y de ahí sale
      el orden del medallero.

   2. Un medallero no se ordena por el total. Se ordena como el olímpico: quien
      más medallas de la categoría más alta; si empatan, la siguiente; y así.
      Un oro vale más que cualquier montón de bronces, y esa es justamente la
      lectura que un total destruiría.
   ========================================================================== */

/**
 * El periodo académico de una fila. `OdTerm` del resto del portal incluye
 * «anual», que aquí no es un corte sino la ausencia de uno: un medallero anual
 * guarda el periodo vacío.
 */
export type MedalTerm = "A" | "B";

/** Cómo reporta un medallero: por año, o por periodo académico. */
export type MedalReporting = "anual" | "periodo";
/** Qué enseña: todo el periodo sumado, o un año a la vez. */
export type MedalScope = "acumulado" | "por_ano";
/** Cómo se ordenan las filas. */
export type MedalSort = "medallero" | "manual";

/** Una categoría de medalla. `position` 1 es la más alta. */
export interface MedalTier {
  key: string;
  label: string;
  position: number;
}

/** Una fila capturada en un corte. */
export interface MedalEntry {
  year: number;
  term: MedalTerm | null;
  label: string;
  /** Solo lo capturado. Lo que falta es «no compitió», que no es un cero. */
  counts: Record<string, number | null>;
  note: string;
  position: number;
}

export interface MedalBoard {
  id: string;
  uuid: string;
  title: string;
  description: string;
  /** Cabecera de la columna de filas: la escribe la oficina. */
  rowLabel: string;
  reporting: MedalReporting;
  scope: MedalScope;
  /** Año con el que abre; vacío, el último que tenga. */
  fixedYear: number | null;
  sort: MedalSort;
  tiers: MedalTier[];
  note: string;
  source: string;
  officeId: string | null;
  entries: MedalEntry[];
}

export const MEDAL_REPORTING: Record<MedalReporting, string> = {
  anual: "Por año",
  periodo: "Por periodo académico",
};

export const MEDAL_SCOPE: Record<MedalScope, { label: string; hint: string }> = {
  por_ano: {
    label: "Un año a la vez",
    hint: "La ficha trae un selector de año y el medallero enseña el que se elija.",
  },
  acumulado: {
    label: "Todo el periodo sumado",
    hint: "Una sola tabla con las medallas de todos los años juntos.",
  },
};

export const MEDAL_SORT: Record<MedalSort, { label: string; hint: string }> = {
  medallero: {
    label: "Por medallero",
    hint: "Como el olímpico: primero quien más medallas de la categoría más alta. Se numera el puesto.",
  },
  manual: {
    label: "En el orden que yo deje",
    hint: "Las filas se arrastran. Sin columna de puesto.",
  },
};

/** Cuántas categorías caben. Más allá, el medallero deja de leerse de un vistazo. */
export const MAX_TIERS = 8;

export const DEFAULT_TIERS: MedalTier[] = [
  { key: "oro", label: "Oro", position: 1 },
  { key: "plata", label: "Plata", position: 2 },
  { key: "bronce", label: "Bronce", position: 3 },
];

/**
 * Las categorías en su orden, sin huecos ni posiciones repetidas.
 *
 * Se ordena por `position` y se renumera: lo que guardó la intranet puede
 * tener saltos si se borró una categoría de en medio, y el resto del código
 * cuenta con que la primera es la 1.
 */
export function orderedTiers(board: Pick<MedalBoard, "tiers">): MedalTier[] {
  return [...board.tiers]
    .sort((a, b) => a.position - b.position)
    .slice(0, MAX_TIERS)
    .map((tier, index) => ({ ...tier, position: index + 1 }));
}

/**
 * Con qué metal se dibuja una categoría.
 *
 * Solo hay tres, porque solo hay tres: oro, plata y bronce. De la cuarta
 * categoría en adelante el disco va sin relleno, con su anillo y su cifra en
 * tinta. Se intentó darle un cuarto color y no cabe: cualquier gris que
 * quedara cerca de la plata se confundía con ella (ΔE 4 sobre un piso de 15,8),
 * y un cuarto premio tampoco es un metal para quien lo lee. El ámbar de señal
 * queda fuera del medallero: significa «esto acaba de llegar», y una tabla
 * entera en ámbar no señalaría nada.
 */
export function tierSlot(position: number): "1" | "2" | "3" | "rest" {
  return position === 1 ? "1" : position === 2 ? "2" : position === 3 ? "3" : "rest";
}

/* --- Cortes ------------------------------------------------------------------ */

/** Los años que tiene capturados, de menor a mayor. */
export function medalYears(board: MedalBoard): number[] {
  return Array.from(new Set(board.entries.map((e) => e.year))).sort((a, b) => a - b);
}

/**
 * El año con el que abre la ficha: el que fijó la oficina si está capturado,
 * y si no el último que tenga.
 */
export function openingYear(board: MedalBoard): number | null {
  const years = medalYears(board);
  if (!years.length) return null;
  if (board.fixedYear && years.includes(board.fixedYear)) return board.fixedYear;
  return years[years.length - 1];
}

/** Las filas de un corte: un año, o todos si el medallero es acumulado. */
export function entriesAt(board: MedalBoard, year: number | null): MedalEntry[] {
  return board.scope === "acumulado" || year === null
    ? board.entries
    : board.entries.filter((e) => e.year === year);
}

/* --- La tabla ---------------------------------------------------------------- */

/** Una fila ya sumada y lista para dibujar. */
export interface MedalStanding {
  label: string;
  /** Recuento por categoría. `null` = no compitió; 0 = compitió y no ganó. */
  counts: Record<string, number | null>;
  total: number;
  /** Puesto en el medallero, compartido si empata. Vacío con orden manual. */
  rank: number | null;
  note: string;
  /** Orden en que lo dejó la oficina, para el modo manual. */
  position: number;
}

const add = (a: number | null, b: number | null): number | null =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0);

/**
 * Junta las filas de un corte por rótulo y las ordena.
 *
 * Al sumar dos cortes (un medallero acumulado, o uno por periodo con dos
 * semestres) hay que decidir qué pasa con lo que no se capturó: si una fila no
 * compitió en el primer semestre y ganó dos oros en el segundo, el resultado
 * es dos oros, no «no compitió». Pero si no compitió en ninguno, sigue sin
 * competir. De ahí `add`: nulo con nulo da nulo, y nulo con cifra da cifra.
 */
export function standings(board: MedalBoard, year: number | null): MedalStanding[] {
  const tiers = orderedTiers(board);
  const byLabel = new Map<string, MedalStanding>();

  for (const entry of entriesAt(board, year)) {
    const found = byLabel.get(entry.label);
    const row: MedalStanding = found ?? {
      label: entry.label,
      counts: Object.fromEntries(tiers.map((t) => [t.key, null])),
      total: 0,
      rank: null,
      note: entry.note,
      position: entry.position,
    };
    for (const tier of tiers) {
      const value = entry.counts[tier.key];
      row.counts[tier.key] = add(row.counts[tier.key], value === undefined ? null : value);
    }
    if (!found) byLabel.set(entry.label, row);
    else if (entry.note && !row.note) row.note = entry.note;
  }

  const rows = [...byLabel.values()];
  for (const row of rows) {
    row.total = tiers.reduce((sum, tier) => sum + (row.counts[tier.key] ?? 0), 0);
  }

  if (board.sort === "manual") {
    return rows.sort((a, b) => a.position - b.position || a.label.localeCompare(b.label, "es"));
  }

  // El orden del medallero: categoría por categoría, de la más alta a la más
  // baja. El total nunca desempata —si lo hiciera, tres bronces adelantarían a
  // un oro y el medallero dejaría de serlo—.
  const byMedals = (a: MedalStanding, b: MedalStanding) => {
    for (const tier of tiers) {
      const diff = (b.counts[tier.key] ?? 0) - (a.counts[tier.key] ?? 0);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  // El rótulo desempata solo para *colocar* las filas, y va aparte: si entrara
  // en la comparación de medallas, dos filas idénticas nunca darían cero y el
  // puesto compartido no llegaría a existir.
  rows.sort((a, b) => byMedals(a, b) || a.label.localeCompare(b.label, "es"));

  // Puestos compartidos, como en el olímpico: dos primeros y ningún segundo.
  let rank = 0;
  rows.forEach((row, index) => {
    if (index === 0 || byMedals(rows[index - 1], row) !== 0) rank = index + 1;
    row.rank = rank;
  });
  return rows;
}

/** La fila de totales del medallero. */
export function medalTotals(board: MedalBoard, rows: MedalStanding[]) {
  const tiers = orderedTiers(board);
  const counts: Record<string, number> = {};
  for (const tier of tiers) counts[tier.key] = rows.reduce((sum, row) => sum + (row.counts[tier.key] ?? 0), 0);
  return { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Medallas por año, para la tira de evolución. */
export function medalsByYear(board: MedalBoard): { year: number; counts: Record<string, number>; total: number }[] {
  const tiers = orderedTiers(board);
  return medalYears(board).map((year) => {
    const counts: Record<string, number> = {};
    for (const tier of tiers) counts[tier.key] = 0;
    for (const entry of board.entries.filter((e) => e.year === year)) {
      for (const tier of tiers) counts[tier.key] += entry.counts[tier.key] ?? 0;
    }
    return { year, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
  });
}

/**
 * ¿Hay algo que enseñar?
 *
 * Un medallero sin filas capturadas no se dibuja vacío: el bloque desaparece,
 * como la franja de la galería sin fotos.
 */
export function hasMedals(board: MedalBoard): boolean {
  return board.entries.length > 0;
}
