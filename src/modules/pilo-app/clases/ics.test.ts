/* Mis clases (beta) · el archivo de calendario: fechas en UTC, textos escapados, un aviso el día anterior. */

import { describe, expect, it } from "vitest";
import { buildIcs, icsDate, icsFileName, icsFold, icsText } from "./ics";
import type { IcsEntry } from "./ics";

const NOW = Date.UTC(2026, 9, 2, 15, 30, 0);
// 5 de octubre de 2026, 23:59 en Colombia (UTC−5) = 6 de octubre, 04:59 UTC.
const DUE = Date.UTC(2026, 9, 6, 4, 59, 0) / 1000;

const entry = (patch: Partial<IcsEntry> = {}): IcsEntry => ({ id: "e42", title: "Taller 1", courseName: "Didáctica general", due: DUE, url: "https://moodle.udes.edu.co/mod/assign/view.php?id=7", ...patch });
const lines = (ics: string) => ics.split("\r\n");
/** Las líneas ya desdobladas, como las lee un calendario. */
const unfolded = (ics: string) => ics.replace(/\r\n /g, "").split("\r\n");

describe("icsDate", () => {
  it("escribe la fecha en UTC, con Z", () => {
    expect(icsDate(DUE * 1000)).toBe("20261006T045900Z");
    expect(icsDate(Date.UTC(2027, 0, 1, 0, 0, 5))).toBe("20270101T000005Z");
  });
});

describe("icsText", () => {
  it("escapa la barra, el punto y coma, la coma y los saltos de línea", () => {
    expect(icsText("a\\b; c, d\ne")).toBe("a\\\\b\\; c\\, d\\ne");
    expect(icsText("uno\r\ndos\rtres")).toBe("uno\\ndos\\ntres");
  });

  it("quita los caracteres de control: un título no cuela otra línea", () => {
    const out = icsText("Taller\u0000\u0007 1\u001b");
    // eslint-disable-next-line no-control-regex
    expect(out).not.toMatch(/[\u0000-\u001f]/);
    expect(icsText("X\r\nEND:VEVENT\r\nBEGIN:VEVENT")).toBe("X\\nEND:VEVENT\\nBEGIN:VEVENT");
  });
});

describe("icsFold", () => {
  it("dobla a 75 octetos y las continuaciones empiezan con un espacio", () => {
    const folded = icsFold(`SUMMARY:${"a".repeat(200)}`);
    const parts = folded.split("\r\n");
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    for (const part of parts.slice(1)) expect(part.startsWith(" ")).toBe(true);
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"a".repeat(200)}`);
  });

  it("no parte una letra con tilde ni un emoji por la mitad", () => {
    const text = `SUMMARY:${"áñ😀".repeat(40)}`;
    const folded = icsFold(text);
    for (const part of folded.split("\r\n")) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
      expect(part).not.toContain("�");
    }
    expect(folded.replace(/\r\n /g, "")).toBe(text);
  });

  it("una línea corta queda igual", () => {
    expect(icsFold("BEGIN:VEVENT")).toBe("BEGIN:VEVENT");
  });
});

describe("buildIcs", () => {
  it("arma un calendario válido con un evento por entrega", () => {
    const ics = buildIcs([entry(), entry({ id: "e43", title: "Parcial" })], { now: NOW, host: "moodle.udes.edu.co" });
    const all = lines(ics);
    expect(all[0]).toBe("BEGIN:VCALENDAR");
    expect(all).toContain("VERSION:2.0");
    expect(all[all.length - 2]).toBe("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(all.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(2);
    expect(all.filter((l) => l === "END:VEVENT")).toHaveLength(2);
    // Solo CRLF: ningún salto suelto.
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
  });

  it("las fechas van en UTC", () => {
    const all = lines(buildIcs([entry()], { now: NOW, host: "moodle.udes.edu.co" }));
    expect(all).toContain("DTSTART:20261006T045900Z");
    expect(all).toContain("DTSTAMP:20261002T153000Z");
    expect(all.some((l) => l.startsWith("DTEND"))).toBe(false);
  });

  it("lleva un aviso el día anterior", () => {
    const all = lines(buildIcs([entry()], { now: NOW, host: "moodle.udes.edu.co" }));
    const start = all.indexOf("BEGIN:VALARM");
    const end = all.indexOf("END:VALARM");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const alarm = all.slice(start, end);
    expect(alarm).toContain("TRIGGER:-P1D");
    expect(alarm).toContain("ACTION:DISPLAY");
    expect(alarm.some((l) => l.startsWith("DESCRIPTION:Mañana vence: Taller 1"))).toBe(true);
    // El aviso va dentro del evento.
    expect(all.indexOf("END:VEVENT")).toBeGreaterThan(end);
  });

  it("escapa el título y el curso, y nombra los dos", () => {
    const all = unfolded(buildIcs([entry({ title: "Ensayo; parte 1, final", courseName: "Ética\ny sociedad" })], { now: NOW, host: "moodle.udes.edu.co" }));
    expect(all).toContain("SUMMARY:Entrega: Ensayo\\; parte 1\\, final (Ética\\ny sociedad)");
    expect(all.find((l) => l.startsWith("DESCRIPTION:Curso"))).toContain("Curso: Ética\\ny sociedad\\nActividad: Ensayo\\; parte 1\\, final");
  });

  it("un título malicioso no agrega propiedades ni eventos", () => {
    const all = unfolded(buildIcs([entry({ title: "X\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nSUMMARY:otro" })], { now: NOW, host: "moodle.udes.edu.co" }));
    expect(all.filter((l) => l === "BEGIN:VEVENT")).toHaveLength(1);
    expect(all.filter((l) => l.startsWith("SUMMARY:"))).toHaveLength(1);
  });

  it("el UID es estable y solo lleva caracteres seguros", () => {
    const a = unfolded(buildIcs([entry()], { now: NOW, host: "moodle.udes.edu.co" })).find((l) => l.startsWith("UID:"));
    const b = unfolded(buildIcs([entry()], { now: NOW + 86_400_000, host: "moodle.udes.edu.co" })).find((l) => l.startsWith("UID:"));
    expect(a).toBe("UID:pilo-clases-e42@moodle.udes.edu.co");
    expect(b).toBe(a);
    const odd = unfolded(buildIcs([entry({ id: "e 1\r\nX:1" })], { now: NOW, host: "mal host\r\n" })).find((l) => l.startsWith("UID:"));
    expect(odd).toMatch(/^UID:[a-z0-9.@-]+$/);
  });

  it("el enlace solo va si es https y sin espacios", () => {
    const ok = lines(buildIcs([entry()], { now: NOW, host: "h.co" }));
    expect(ok).toContain("URL:https://moodle.udes.edu.co/mod/assign/view.php?id=7");
    for (const url of ["", "http://moodle.udes.edu.co/x", "javascript:alert(1)", "https://a.co/x y"]) {
      expect(lines(buildIcs([entry({ url })], { now: NOW, host: "h.co" })).some((l) => l.startsWith("URL:"))).toBe(false);
    }
  });

  it("una entrega sin fecha no sale; sin entregas, el calendario queda vacío pero válido", () => {
    const all = lines(buildIcs([entry({ due: 0 }), entry({ due: Number.NaN })], { now: NOW, host: "h.co" }));
    expect(all).not.toContain("BEGIN:VEVENT");
    expect(all[0]).toBe("BEGIN:VCALENDAR");
    expect(all).toContain("END:VCALENDAR");
  });

  it("ninguna línea pasa de 75 octetos", () => {
    const ics = buildIcs([entry({ title: "Análisis crítico de la lectura número cuatro del módulo de fundamentos ".repeat(3), courseName: "Seminario de investigación formativa en ciencias de la educación" })], { now: NOW, host: "moodle.udes.edu.co" });
    for (const l of lines(ics)) expect(new TextEncoder().encode(l).length).toBeLessThanOrEqual(75);
  });
});

describe("icsFileName", () => {
  it("usa letras simples y termina en .ics", () => {
    expect(icsFileName("Didáctica general")).toBe("entregas-didactica-general.ics");
    expect(icsFileName("  ¿¡!?  ")).toBe("entregas-mis-clases.ics");
    expect(icsFileName("a/b\\c:d")).toBe("entregas-a-b-c-d.ics");
    expect(icsFileName("x".repeat(200)).length).toBeLessThanOrEqual("entregas-.ics".length + 48);
  });
});
