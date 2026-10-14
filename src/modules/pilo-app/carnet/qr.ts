/* Mr. Pilo · carnet · el código QR como un solo trazo SVG (sin DOM, con qrcode-generator). */

import qrcode from "qrcode-generator";

export interface QrDraw {
  /** Lado de la cuadrícula, con la zona de silencio incluida. */
  size: number;
  /** Todos los módulos oscuros en un solo trazo. */
  path: string;
}

/** Zona de silencio, en módulos: la norma pide 4; menos y algunos lectores fallan. */
export const QUIET = 4;

/** Dibuja un texto como QR (corrección «M»). Cadena vacía: sin trazo. */
export function drawQr(text: string): QrDraw {
  if (!text) return { size: 0, path: "" };
  const code = qrcode(0, "M");
  code.addData(text);
  code.make();
  const n = code.getModuleCount();
  let path = "";
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (!code.isDark(r, c)) {
        c++;
        continue;
      }
      let end = c;
      while (end < n && code.isDark(r, end)) end++;
      path += `M${c + QUIET} ${r + QUIET}h${end - c}v1h${c - end}z`;
      c = end;
    }
  }
  return { size: n + QUIET * 2, path };
}
