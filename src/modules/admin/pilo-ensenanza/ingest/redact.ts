/* =============================================================================
   Pilo Enseñanza · datos personales.

   Antes de guardar un pasaje se tapan correos, teléfonos y números de
   documento. Es una red de seguridad por patrones, no un detector perfecto:
   también puede tapar una cifra larga que no era un documento.
   ========================================================================== */

export const OMITTED = "[dato omitido]";

const PATTERNS: RegExp[] = [
  // Correos.
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  // Teléfonos con indicativo (+57 300 123 4567).
  /\+\d{1,3}[\s-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}/g,
  // Celulares colombianos (3xx xxx xxxx) y fijos con indicativo (60x xxx xxxx).
  /(?<![\d.])(?:3\d{2}|\(?60\d\)?)[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g,
  // Documentos con su rótulo (C.C. 1098765432, NIT 890.200.000-1, T.I. 1234567).
  /\b(?:c\.?\s?c\.?|c[eé]dula|t\.?\s?i\.?|nit|documento|identificaci[oó]n|pasaporte)\s*(?:n[oº°.]*\s*)?[:#]?\s*\d[\d.-]{5,14}\d/gi,
  // Números con puntos de miles largos (1.098.765.432).
  /(?<![\d.])\d{1,3}(?:\.\d{3}){2,3}(?![\d.])/g,
  // Números largos sin separadores (8 a 11 dígitos).
  /(?<![\d.,])\d{8,11}(?!\d)/g,
];

export function redactPersonal(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const pattern of PATTERNS) {
    out = out.replace(pattern, () => {
      count += 1;
      return OMITTED;
    });
  }
  return { text: out, count };
}
