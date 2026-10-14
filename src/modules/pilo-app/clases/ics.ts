/* =============================================================================
   Mr. Pilo · Mis clases (beta) · los recordatorios como archivo de calendario.

   «Agregar a mi calendario» arma un archivo .ics (RFC 5545) en el navegador y
   lo descarga: nada pasa por el servidor. Cada entrega es un evento a la hora
   en que vence, con un aviso el día anterior.

     · Las fechas van en UTC (terminan en Z): el calendario de la persona las
       muestra en su hora.
     · Los textos se escapan (\ ; , y saltos de línea) y pierden los caracteres
       de control: un título de Moodle no puede colar otra línea del archivo.
     · Las líneas se doblan a 75 octetos, sin partir una letra por la mitad.
     · El UID es estable: volver a agregar la misma entrega la actualiza en vez
       de duplicarla (en los calendarios que lo respetan).

   Puro: se prueba en node.
   ========================================================================== */

export interface IcsEntry {
  id: string;
  title: string;
  courseName: string;
  /** Cuándo vence, en segundos desde 1970 (UTC). */
  due: number;
  url: string;
}

const pad = (n: number, size = 2) => String(n).padStart(size, "0");

/** Una fecha como la pide el formato, en UTC: 20261005T045900Z. */
export function icsDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getUTCFullYear(), 4)}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Un texto dentro de una propiedad: sin caracteres de control y con lo especial escapado. */
export function icsText(text: string): string {
  return String(text ?? "")
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/** Una línea doblada a 75 octetos (UTF-8): las de continuación empiezan con un espacio. */
export function icsFold(line: string): string {
  const encoder = new TextEncoder();
  const out: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const bytes = encoder.encode(char).length;
    // Las líneas de continuación llevan un espacio delante, que también cuenta.
    if (size + bytes > 75) {
      out.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += bytes;
  }
  out.push(current);
  return out.join("\r\n");
}

/** Lo que identifica una entrega en el calendario: solo letras, números y guiones. */
const uidPart = (v: string) => v.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";

/**
 * El archivo de calendario de unas entregas. `now` es el momento en que se
 * arma (DTSTAMP) y `host` el nombre del sitio de Moodle (para el UID).
 */
export function buildIcs(entries: IcsEntry[], options: { now: number; host: string }): string {
  const stamp = icsDate(options.now);
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Universidad de Santander//Mr. Pilo · Mis clases//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  for (const e of entries) {
    if (!Number.isFinite(e.due) || e.due <= 0) continue;
    const title = e.title.trim() || "Entrega";
    const summary = e.courseName.trim() ? `Entrega: ${title} (${e.courseName.trim()})` : `Entrega: ${title}`;
    const about = [e.courseName.trim() ? `Curso: ${e.courseName.trim()}` : "", `Actividad: ${title}`, "Recordatorio creado por Mr. Pilo desde su Moodle. Revise la fecha en Moodle: allí manda."].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:pilo-clases-${uidPart(e.id)}@${uidPart(options.host)}`,
      `DTSTAMP:${stamp}`,
      // Un evento a la hora en que vence, sin duración: es una fecha límite.
      `DTSTART:${icsDate(e.due * 1000)}`,
      `SUMMARY:${icsText(summary)}`,
      `DESCRIPTION:${icsText(about)}`,
      ...(/^https:\/\/[^\s]+$/.test(e.url) ? [`URL:${e.url.replace(/[\r\n]/g, "")}`] : []),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(`Mañana vence: ${title}`)}`,
      // El aviso, el día anterior.
      "TRIGGER:-P1D",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(icsFold).join("\r\n")}\r\n`;
}

/** El nombre del archivo: «entregas-didactica-general.ics». */
export function icsFileName(label: string): string {
  const slug = label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/, "");
  return `entregas-${slug || "mis-clases"}.ics`;
}
