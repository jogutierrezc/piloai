/* =============================================================================
   Datos Abiertos · cifras grandes en las gráficas.

   Un presupuesto en pesos son trece cifras: «12.345.678.901» no cabe en la
   marca de un eje, sobre una barra ni en una paleta del tablero. De un millón
   en adelante, las gráficas escriben la cifra abreviada, a la colombiana
   (escala larga: un billón es un millón de millones):

     1.500.000            1,5 M          1,5 millones
     12.345.678.901       12,3 mil M     12,3 miles de millones
     3.200.000.000.000    3,2 bill.      3,2 billones

   Solo se abrevia donde no hay sitio: ejes, rótulos sobre barras y paletas. La
   cifra exacta sigue en el tooltip, en la tabla, en el texto para lectores de
   pantalla y en el CSV. Por debajo del millón no cambia nada.

   Módulo puro.
   ========================================================================== */

export const BIG_FROM = 1_000_000;

interface Scale {
  divisor: number;
  /** Para ejes y rótulos: «M», «mil M», «bill.». */
  short: string;
  /** Para el rótulo de una paleta: «millones», «miles de millones», «billones». */
  long: string;
}

const SCALES: Scale[] = [
  { divisor: 1e12, short: "bill.", long: "billones" },
  { divisor: 1e9, short: "mil M", long: "miles de millones" },
  { divisor: 1e6, short: "M", long: "millones" },
];

const figure = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 0, maximumFractionDigits: 1 });

export const isBig = (value: number | null | undefined): value is number =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) >= BIG_FROM;

/**
 * La cifra partida en número y escala; null si no llega al millón.
 * 999.960.000 redondearía a «1.000 M»: se sube de escala para escribir «1 mil M».
 */
export function splitBig(value: number | null | undefined): { text: string; short: string; long: string } | null {
  if (!isBig(value)) return null;
  const index = SCALES.findIndex((scale) => Math.abs(value) >= scale.divisor);
  let scale = SCALES[index];
  let scaled = Math.round((value / scale.divisor) * 10) / 10;
  if (Math.abs(scaled) >= 1000 && index > 0) {
    scale = SCALES[index - 1];
    scaled = Math.round((value / scale.divisor) * 10) / 10;
  }
  return { text: figure.format(scaled).replace("−", "-"), short: scale.short, long: scale.long };
}

/** «12,3 mil M» de un millón en adelante; si no, lo que diga `fallback`. */
export function formatBig(value: number, fallback: (value: number) => string): string {
  const big = splitBig(value);
  return big ? `${big.text} ${big.short}` : fallback(value);
}
