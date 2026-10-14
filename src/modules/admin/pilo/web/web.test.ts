/* =============================================================================
   Páginas web · lo que se calcula sin pantalla: los pasos de la preparación,
   la malla de una página, sus temas del mapa y los hallazgos de una consulta.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { MESH_PASSAGES, browserLine, checkWebUrl, hitsOf, kilobytes, prepRead, prepSet, prepStart, simText, topSection, topicsOf, webMesh, webWhere } from "./web";
import type { WebPageView, WebRead } from "./web";

const DOC = "3f2b8c1e-5a47-4d09-9b61-0c7e2a1d4f58";
const OTHER = "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d";
const page = (n: number): WebPageView => ({
  doc: DOC,
  url: "https://www.udes.edu.co/admisiones",
  title: "Admisiones de pregrado",
  passages: Array.from({ length: n }, (_, i) => ({ seq: i + 1, section: i < 2 ? "Presentación" : i < 4 ? "Documentos › Formato" : "Calendario", text: `Pasaje ${i + 1}` })),
});

describe("la dirección y cómo se nombra", () => {
  it("usa la misma revisión de la función", () => {
    expect(checkWebUrl("https://www.udes.edu.co/admisiones")).toMatchObject({ ok: true });
    expect(checkWebUrl("http://www.udes.edu.co/")).toMatchObject({ ok: false });
    expect(checkWebUrl("https://192.168.1.1/")).toMatchObject({ ok: false });
  });

  it("dice de dónde es una página sin toda su dirección", () => {
    expect(webWhere("https://www.udes.edu.co/admisiones/?x=1")).toBe("udes.edu.co/admisiones");
    expect(webWhere("no es una dirección")).toBe("no es una dirección");
    expect(kilobytes(188_416)).toBe("184 KB");
    expect(kilobytes(10)).toBe("1 KB");
  });
});

describe("los pasos de la preparación", () => {
  const read: WebRead = { doc: DOC, url: "https://x.co/a", title: "A", bytes: 188_416, sections: ["Presentación", "Documentos", "Calendario"], passages: page(6).passages, total: 6, added: 6, changed: 0, removed: 0, redacted: 2, dropped: 0, unchanged: false };

  it("empiezan pendientes y cambian de a uno", () => {
    const steps = prepStart();
    expect(steps.map((s) => s.id)).toEqual(["traer", "limpiar", "partir", "indexar", "conectar"]);
    expect(steps.every((s) => s.state === "pending" && s.detail === "")).toBe(true);
    const next = prepSet(steps, "indexar", "run", "Calculando");
    expect(next.find((s) => s.id === "indexar")).toMatchObject({ state: "run", detail: "Calculando" });
    expect(next.filter((s) => s.state === "pending")).toHaveLength(4);
    // Sin detalle nuevo, el anterior se conserva.
    expect(prepSet(next, "indexar", "done").find((s) => s.id === "indexar")!.detail).toBe("Calculando");
  });

  it("al leer la página, los tres primeros dicen lo que pasó de verdad", () => {
    const steps = prepRead(prepStart(), read);
    expect(steps.slice(0, 3).map((s) => s.state)).toEqual(["done", "done", "done"]);
    expect(steps[0].detail).toBe("184 KB");
    expect(steps[1].detail).toBe("Sin menús, formularios ni pie · 2 datos personales omitidos");
    expect(steps[2].detail).toBe("6 pasajes en 3 secciones · 6 nuevos");
    expect(steps.slice(3).every((s) => s.state === "pending")).toBe(true);
  });

  it("una página que no cambió lo dice", () => {
    const steps = prepRead(prepStart(), { ...read, unchanged: true, added: 0, redacted: 0, cut: true, dropped: 3 });
    expect(steps[0].detail).toBe("184 KB (se leyó hasta el tope)");
    expect(steps[1].detail).toBe("Sin menús, formularios ni pie");
    expect(steps[2].detail).toBe("6 pasajes en 3 secciones · sin cambios desde la última lectura · 3 quedaron por fuera del tope");
  });
});

describe("con navegador (0132)", () => {
  const read: WebRead = { doc: DOC, url: "https://x.co/a", title: "A", bytes: 20_480, sections: ["Presentación"], passages: page(2).passages, total: 2, added: 2, changed: 0, removed: 0, redacted: 0, dropped: 0, unchanged: false };
  const note = { asked: true, used: true, clicks: 0, tried: 0, why: "" };

  it("sin pedirlo, no se dice nada: el paso queda como siempre", () => {
    expect(browserLine(undefined)).toBe("");
    expect(browserLine(null)).toBe("");
    expect(browserLine({ ...note, asked: false })).toBe("");
    expect(prepRead(prepStart(), read)[0].detail).toBe("20 KB");
    expect(prepRead(prepStart(), { ...read, browser: { ...note, asked: false, used: false } })[0].detail).toBe("20 KB");
  });

  it("dice cuántos despliegues hizo, y cuántos no abrieron", () => {
    expect(browserLine(note)).toBe("con navegador, sin nada que desplegar");
    expect(browserLine({ ...note, clicks: 1, tried: 1 })).toBe("con navegador: 1 despliegue");
    expect(browserLine({ ...note, clicks: 5, tried: 5 })).toBe("con navegador: 5 despliegues");
    expect(browserLine({ ...note, clicks: 5, tried: 7 })).toBe("con navegador: 5 despliegues (2 no abrieron)");
    expect(browserLine({ ...note, clicks: 0, tried: 1 })).toBe("con navegador: 0 despliegues (1 no abrió)");
    expect(prepRead(prepStart(), { ...read, cut: true, browser: { ...note, clicks: 3, tried: 3 } })[0].detail).toBe("20 KB (se leyó hasta el tope) · con navegador: 3 despliegues");
  });

  it("si se pidió y no se pudo, dice que se leyó sin ejecutar JavaScript y por qué", () => {
    expect(browserLine({ ...note, used: false, why: "el navegador está apagado" })).toBe("se leyó sin ejecutar JavaScript: el navegador está apagado");
    expect(browserLine({ ...note, used: false })).toBe("se leyó sin ejecutar JavaScript");
    expect(prepRead(prepStart(), { ...read, browser: { ...note, used: false, why: "el navegador tardó demasiado" } })[0].detail).toBe("20 KB · se leyó sin ejecutar JavaScript: el navegador tardó demasiado");
  });
});

describe("la malla de una página", () => {
  it("cada pasaje en su fila; la sección al promedio de sus pasajes y la página al de sus secciones", () => {
    const m = webMesh(page(6));
    expect(m.sections.map((s) => s.name)).toEqual(["Presentación", "Documentos", "Calendario"]);
    expect(m.passages.map((p) => p.section)).toEqual([0, 0, 1, 1, 2, 2]);
    const ys = m.passages.map((p) => p.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(new Set(ys).size).toBe(6);
    expect(m.sections[0].y).toBeCloseTo((ys[0] + ys[1]) / 2);
    expect(m.page.y).toBeCloseTo(m.sections.reduce((a, s) => a + s.y, 0) / 3);
    expect(ys[5]).toBeLessThan(m.query.y - 30);
    expect(m.more).toBe(0);
  });

  it("dibuja hasta el tope y dice cuántos pasajes quedan por fuera", () => {
    const m = webMesh(page(MESH_PASSAGES + 9));
    expect(m.passages).toHaveLength(MESH_PASSAGES);
    expect(m.more).toBe(9);
    expect(webMesh(page(1)).passages).toHaveLength(1);
  });

  it("los temas solo enlazan pasajes que se dibujan", () => {
    const topics = [
      { id: "tema:inscripcion", label: "Inscripción", kind: "tema" as const, seqs: [1, 2, 99], shared: 2 },
      { id: "tema:lejos", label: "Lejos", kind: "tema" as const, seqs: [500], shared: 0 },
    ];
    const m = webMesh(page(6), topics);
    expect(m.topics).toHaveLength(1);
    expect(m.topics[0]).toMatchObject({ id: "tema:inscripcion", seqs: [1, 2], shared: 2 });
  });

  it("la sección de primer nivel de una ruta", () => {
    expect(topSection("Documentos › Formato › PDF")).toBe("Documentos");
    expect(topSection("")).toBe("Presentación");
  });
});

describe("los temas de una página, del mapa de la memoria", () => {
  const mesh = {
    nodes: [
      { id: "tema:inscripcion", label: "Inscripción" },
      { id: "tema:calendario", label: "Calendario académico" },
      { id: "ref:acuerdo-012-2021", label: "Acuerdo 012 de 2021" },
    ],
    edges: [
      { from: `doc:${DOC}:1`, to: "tema:inscripcion" },
      { from: `doc:${DOC}:2`, to: "tema:inscripcion" },
      { from: `doc:${DOC}:2`, to: "tema:inscripcion" },
      { from: `doc:${DOC}:5`, to: "tema:calendario" },
      { from: `doc:${DOC}:3`, to: "ref:acuerdo-012-2021" },
      { from: `doc:${OTHER}:7`, to: "tema:calendario" },
      { from: `doc:${OTHER}:8`, to: "tema:calendario" },
      { from: `doc:${OTHER}:1`, to: "tema:solo-del-otro" },
      { from: `doc:${DOC}`, to: `doc:${DOC}#Documentos` },
    ],
  };

  it("lo que sus pasajes tratan o citan, y con cuántos otros documentos lo comparte", () => {
    const topics = topicsOf(mesh, DOC);
    expect(topics.map((t) => t.id)).toEqual(["tema:inscripcion", "tema:calendario", "ref:acuerdo-012-2021"]);
    expect(topics[0]).toMatchObject({ label: "Inscripción", kind: "tema", seqs: [1, 2], shared: 0 });
    expect(topics[1]).toMatchObject({ seqs: [5], shared: 1 });
    expect(topics[2]).toMatchObject({ kind: "norma", label: "Acuerdo 012 de 2021" });
  });

  it("otra página no ve estos temas, y hay tope", () => {
    expect(topicsOf(mesh, "00000000-0000-4000-8000-000000000000")).toEqual([]);
    expect(topicsOf(mesh, DOC, 1)).toHaveLength(1);
  });
});

describe("los hallazgos de una consulta", () => {
  it("marca cuáles son de esta página y cuáles del resto de la memoria", () => {
    const hits = hitsOf(
      [
        { ref: `doc:${DOC}:4`, title: "Admisiones", section: "Documentos", sim: 0.861, via: "ambas" },
        { ref: "cifras:matriculados", title: "Estudiantes matriculados", section: "Población", sim: null },
        { ref: `doc:${OTHER}:4`, title: "Otra página", section: "Fechas" },
      ],
      DOC,
    );
    expect(hits.map((h) => h.seq)).toEqual([4, null, null]);
    expect(hits[0]).toMatchObject({ sim: 0.861, via: "ambas" });
    expect(hits[1]).toMatchObject({ sim: null, via: "palabras" });
    expect(simText(0.861)).toBe("cercanía 0,86");
    expect(simText(null)).toBe("por palabras");
  });
});
