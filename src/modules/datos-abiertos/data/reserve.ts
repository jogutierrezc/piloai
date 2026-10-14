/* =============================================================================
   Datos Abiertos · lectura de una cifra y reserva estadística.

   Lo que la ficha y la descarga tienen que leer igual: qué cifra corresponde a
   un corte y cómo se escribe una celda reservada. Salió de `open-data.ts`, que
   lo sigue reexportando, porque aquel arrastra el cliente de Supabase y un
   serializador probado en node no puede importarlo.

   Una celda reservada no es un vacío ni un cero: tiene dato, pero tan pocos
   registros que publicarlo señalaría a personas concretas. Se escribe siempre
   como un techo ("< 5"), nunca como su número.

   Módulo puro: solo tipos y `terms.ts`.
   ========================================================================== */

import { ALL_YEARS } from "./terms";
import type { CampusId, Indicator, Term } from "./types";

export const RESERVE_DEFAULT = 5;

/** En pantalla y en el CSV: "< 5". */
export function formatReserved(threshold = RESERVE_DEFAULT): string {
  return `< ${threshold}`;
}

/** Cifra de un corte: el año (sin periodo), un periodo académico del año o todo el periodo. */
export function valueOf(indicator: Indicator, year: number, campus: CampusId, term?: Term | null): number | null {
  if (year === ALL_YEARS) {
    const value = indicator.values[ALL_YEARS]?.[campus];
    return value === undefined ? null : value;
  }
  if (indicator.years && !indicator.years.includes(year)) return null;
  const value = term ? indicator.terms?.[year]?.[term]?.[campus] : indicator.values[year]?.[campus];
  return value === undefined ? null : value;
}
