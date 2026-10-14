import { describe, expect, it } from "vitest";
import { MAP_COLUMNS, OUTLINE_MAX, THINK_BUDGETS, THINK_LIMITS, buildOutline, columnOf, docOf, edgeId, focusOf, isPassageRef, layoutColumns, neighborsOf, pathOfPassages, readThinkStatus, teachGraph, thinkActive, thinkGain, thinkReduce, thinkResume, thinkShare, thinkStart } from "./map";
import type { RawEdge, RawNode, ThinkLimits, ThinkRun } from "./map";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";

/** Dos documentos de políticas, un curso de Moodle; A comprendido con IA, B solo por reglas. */
const mesh = (): { nodes: RawNode[]; edges: RawEdge[] } => ({
  nodes: [
    { id: "fuente:politicas", label: "politicas", type: "fuente" },
    { id: "fuente:moodle", label: "moodle", type: "fuente" },
    { id: `doc:${A}`, label: "Política de evaluación", type: "documento" },
    { id: `doc:${A}#Capítulo 1`, label: "Capítulo 1", type: "seccion" },
    { id: `doc:${A}#Capítulo 1 › Artículo 5`, label: "Artículo 5", type: "seccion" },
    { id: `doc:${B}`, label: "Acuerdo de currículo", type: "documento" },
    { id: `doc:${C}`, label: "Didáctica general", type: "documento" },
    { id: "tema:evaluacion-formativa", label: "Evaluación formativa", type: "tema" },
    { id: "tema:rubricas", label: "Rúbricas", type: "tema" },
    { id: "ref:ley-30-1992", label: "Ley 30 de 1992", type: "referencia", props: { clase: "norma" } },
    { id: "ref:ods-4", label: "ODS 4", type: "referencia", props: { clase: "ods" } },
    { id: "tema:sin-uso", label: "Tema suelto", type: "tema" },
  ],
  edges: [
    { from: "fuente:politicas", to: `doc:${A}`, rel: "contiene" },
    { from: "fuente:politicas", to: `doc:${B}`, rel: "contiene" },
    { from: "fuente:moodle", to: `doc:${C}`, rel: "contiene" },
    { from: `doc:${A}`, to: `doc:${A}#Capítulo 1`, rel: "contiene" },
    { from: `doc:${A}#Capítulo 1`, to: `doc:${A}:1`, rel: "contiene" },
    { from: `doc:${A}:1`, to: "tema:evaluacion-formativa", rel: "trata" },
    { from: `doc:${A}:1`, to: "ref:ley-30-1992", rel: "cita" },
    { from: `doc:${A}:2`, to: "tema:rubricas", rel: "trata" },
    { from: `doc:${B}:1`, to: "ref:ods-4", rel: "cita" },
    { from: `doc:${C}:3`, to: "tema:evaluacion-formativa", rel: "trata" },
    { from: `doc:${C}:3`, to: "tema:inexistente", rel: "trata" },
  ],
});

const graph = () => teachGraph(mesh(), { politicas: "Políticas institucionales", moodle: "Cursos de Moodle" }, new Set([`doc:${C}`]));
const has = (g: ReturnType<typeof graph>, from: string, to: string) => g.edges.some((e) => e.from === from && e.to === to);

describe("de quién es cada id de la malla", () => {
  it("el nodo, una sección y un pasaje son del mismo documento", () => {
    expect(docOf(`doc:${A}`)).toBe(`doc:${A}`);
    expect(docOf(`doc:${A}#Capítulo 1 › Artículo 5`)).toBe(`doc:${A}`);
    expect(docOf(`doc:${A}:12`)).toBe(`doc:${A}`);
    expect(docOf("tema:rubricas")).toBeNull();
    expect(isPassageRef(`doc:${A}:12`)).toBe(true);
    expect(isPassageRef(`doc:${A}`)).toBe(false);
    expect(isPassageRef(`doc:${A}#x`)).toBe(false);
  });
  it("cada id cae en su columna; secciones y pasajes, en ninguna", () => {
    expect(columnOf("fuente:politicas")).toBe("coleccion");
    expect(columnOf(`doc:${A}`)).toBe("documento");
    expect(columnOf("tema:rubricas")).toBe("tema");
    expect(columnOf("ref:ods-4")).toBe("referencia");
    expect(columnOf(`doc:${A}#Capítulo 1`)).toBeNull();
    expect(columnOf(`doc:${A}:1`)).toBeNull();
  });
});

describe("la malla plegada en cuatro columnas", () => {
  it("solo quedan colecciones, documentos, temas y referencias, con su nombre visible", () => {
    const g = graph();
    expect(g.nodes.map((n) => n.column).sort()).toEqual(["coleccion", "coleccion", "documento", "documento", "documento", "referencia", "referencia", "tema", "tema", "tema"]);
    expect(g.byId.get("fuente:politicas")?.label).toBe("Políticas institucionales");
    expect(g.byId.get(`doc:${C}`)?.kind).toBe("curso");
    expect(g.byId.get(`doc:${A}`)?.kind).toBe("archivo");
    expect(g.byId.get("ref:ley-30-1992")?.kind).toBe("norma");
    expect(g.byId.get(`doc:${A}`)?.sections).toBe(2);
  });

  it("colección → documento; documento → tema por lo que tratan sus pasajes", () => {
    const g = graph();
    expect(has(g, "fuente:politicas", `doc:${A}`)).toBe(true);
    expect(has(g, "fuente:moodle", `doc:${C}`)).toBe(true);
    expect(has(g, `doc:${A}`, "tema:evaluacion-formativa")).toBe(true);
    expect(has(g, `doc:${A}`, "tema:rubricas")).toBe(true);
    expect(has(g, `doc:${C}`, "tema:evaluacion-formativa")).toBe(true);
  });

  it("tema → referencia cuando el mismo pasaje trata y cita; documento → referencia en el mapa básico", () => {
    const g = graph();
    expect(has(g, "tema:evaluacion-formativa", "ref:ley-30-1992")).toBe(true);
    expect(has(g, `doc:${A}`, "ref:ley-30-1992")).toBe(false);
    expect(has(g, `doc:${B}`, "ref:ods-4")).toBe(true);
    // Otro pasaje del mismo documento no hereda la cita.
    expect(has(g, "tema:rubricas", "ref:ley-30-1992")).toBe(false);
  });

  it("cada relación recuerda de qué documento y pasaje sale, y cada tema, sus pasajes", () => {
    const g = graph();
    const e = g.edges.find((x) => x.from === "tema:evaluacion-formativa" && x.to === "ref:ley-30-1992")!;
    expect(e.docs).toEqual([`doc:${A}`]);
    expect(e.passages).toEqual([`doc:${A}:1`]);
    expect(g.byId.get("tema:evaluacion-formativa")?.passages).toEqual([`doc:${A}:1`, `doc:${C}:3`]);
  });

  it("ignora relaciones hacia nodos que no llegaron y no se rompe con una malla vacía", () => {
    const g = graph();
    expect(g.edges.some((e) => e.to === "tema:inexistente")).toBe(false);
    expect(teachGraph({ nodes: [], edges: [] }).nodes).toEqual([]);
  });
});

describe("layoutColumns", () => {
  it("ubica cada punto en su columna y ninguna columna pisa rótulos (al menos una fila entre dos)", () => {
    const g = graph();
    const row = 26;
    const l = layoutColumns(g, ["innovacion", "politicas", "global", "moodle"], row);
    expect(l.placed).toHaveLength(g.nodes.length);
    for (const c of MAP_COLUMNS) {
      const ys = l.columns[c].map((id) => l.byId.get(id)!.y);
      expect(l.columns[c].every((id) => l.byId.get(id)!.column === c)).toBe(true);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(row);
    }
    expect(l.height).toBe(Math.max(...l.placed.map((p) => p.y)));
  });

  it("las colecciones siguen el orden dado, con sus documentos debajo por nombre", () => {
    const l = layoutColumns(graph(), ["politicas", "moodle"]);
    expect(l.columns.coleccion).toEqual(["fuente:politicas", "fuente:moodle"]);
    expect(l.columns.documento).toEqual([`doc:${B}`, `doc:${A}`, `doc:${C}`]);
    expect(layoutColumns(graph(), ["moodle", "politicas"]).columns.coleccion).toEqual(["fuente:moodle", "fuente:politicas"]);
    // La colección queda a la altura media de sus documentos.
    const y = (id: string) => l.byId.get(id)!.y;
    expect(y("fuente:politicas")).toBe((y(`doc:${A}`) + y(`doc:${B}`)) / 2);
  });

  it("un tema va cerca de lo que lo trata y lo que no se conecta con nada va al final", () => {
    const l = layoutColumns(graph(), ["politicas", "moodle"]);
    expect(l.columns.tema[l.columns.tema.length - 1]).toBe("tema:sin-uso");
    expect(l.placed.every((p) => Number.isFinite(p.y) && p.y >= 0)).toBe(true);
  });

  it("es estable: la misma malla da el mismo dibujo", () => {
    expect(layoutColumns(graph(), ["politicas"]).placed).toEqual(layoutColumns(graph(), ["politicas"]).placed);
  });

  it("una malla vacía no tiene alto ni puntos", () => {
    const l = layoutColumns(teachGraph({ nodes: [], edges: [] }));
    expect(l.placed).toEqual([]);
    expect(l.height).toBe(0);
  });
});

describe("lo que se enciende", () => {
  it("un tema enciende los documentos que lo tratan y las referencias que lo acompañan", () => {
    const g = graph();
    const lit = focusOf(g, "tema:evaluacion-formativa");
    expect([...lit.nodes].sort()).toEqual([`doc:${A}`, `doc:${C}`, "ref:ley-30-1992", "tema:evaluacion-formativa"].sort());
    expect(lit.edges.has(edgeId(`doc:${A}`, "tema:evaluacion-formativa"))).toBe(true);
  });

  it("un documento enciende su colección, sus temas y lo que citan sus pasajes", () => {
    const g = graph();
    const lit = focusOf(g, `doc:${A}`);
    expect(lit.nodes.has("fuente:politicas")).toBe(true);
    expect(lit.nodes.has("ref:ley-30-1992")).toBe(true);
    expect(lit.edges.has(edgeId("tema:evaluacion-formativa", "ref:ley-30-1992"))).toBe(true);
    expect(lit.nodes.has(`doc:${B}`)).toBe(false);
  });

  it("los vecinos se dicen por columna y por nombre", () => {
    const near = neighborsOf(graph(), "tema:evaluacion-formativa");
    expect(near.documento.map((n) => n.label)).toEqual(["Didáctica general", "Política de evaluación"]);
    expect(near.referencia.map((n) => n.label)).toEqual(["Ley 30 de 1992"]);
    expect(near.coleccion).toEqual([]);
  });

  it("el camino de una prueba: el documento del pasaje, su colección y lo que ese pasaje trata y cita", () => {
    const g = graph();
    const path = pathOfPassages(g, [`doc:${A}:1`, "cifras:otro"]);
    expect([...path.nodes].sort()).toEqual(["fuente:politicas", `doc:${A}`, "tema:evaluacion-formativa", "ref:ley-30-1992"].sort());
    // El otro pasaje del documento (rúbricas) no se enciende.
    expect(path.nodes.has("tema:rubricas")).toBe(false);
    expect(pathOfPassages(g, []).nodes.size).toBe(0);
  });
});

describe("la estructura de un documento, sin IA (lo que va a pilo_doc_outline)", () => {
  const doc = { id: A, source: "politicas", title: "Política de evaluación" };
  const rows = [
    { seq: 1, section: "Capítulo 1 › Artículo 5", body: "Según la Ley 30 de 1992 y el ODS 4, la evaluación es formativa." },
    { seq: 2, section: "Capítulo 1", body: "Los criterios se publican al iniciar el periodo." },
  ];

  it("arma colección › documento › secciones › pasajes, y las normas citadas por reglas", () => {
    const o = buildOutline(doc, "Políticas institucionales", rows);
    const ids = o.nodes.map((n) => n.id);
    expect(ids).toContain("fuente:politicas");
    expect(ids).toContain(`doc:${A}`);
    expect(ids).toContain(`doc:${A}#Capítulo 1`);
    expect(ids).toContain(`doc:${A}#Capítulo 1 › Artículo 5`);
    expect(o.nodes.find((n) => n.id === "fuente:politicas")?.label).toBe("Políticas institucionales");
    expect(o.edges).toContainEqual({ from: "fuente:politicas", to: `doc:${A}`, rel: "contiene" });
    expect(o.edges).toContainEqual({ from: `doc:${A}#Capítulo 1`, to: `doc:${A}#Capítulo 1 › Artículo 5`, rel: "contiene" });
    expect(o.edges).toContainEqual({ from: `doc:${A}#Capítulo 1 › Artículo 5`, to: `doc:${A}:1`, rel: "contiene" });
    expect(o.edges).toContainEqual({ from: `doc:${A}#Capítulo 1`, to: `doc:${A}:2`, rel: "contiene" });
    expect(o.sections).toBe(2);
    expect(o.refs).toBeGreaterThanOrEqual(1);
    expect(o.edges.some((e) => e.rel === "cita" && e.from === `doc:${A}:1` && e.to.startsWith("ref:"))).toBe(true);
    expect(o.trimmed).toBe(false);
  });

  it("solo manda lo que la base acepta: nodos del documento, su colección y referencias; relaciones con un extremo suyo", () => {
    const o = buildOutline(doc, "Políticas institucionales", rows);
    const mine = (id: string) => id === `doc:${A}` || id.startsWith(`doc:${A}#`) || id.startsWith(`doc:${A}:`);
    expect(o.nodes.every((n) => mine(n.id) || n.id === "fuente:politicas" || n.id.startsWith("ref:"))).toBe(true);
    expect(o.nodes.every((n) => n.id.length >= 3 && n.id.length <= 300)).toBe(true);
    expect(o.edges.every((e) => (mine(e.from) || mine(e.to)) && e.from !== e.to)).toBe(true);
  });

  it("un documento sin secciones cuelga sus pasajes del documento", () => {
    const o = buildOutline(doc, "Políticas institucionales", [{ seq: 1, section: "", body: "Texto sin títulos." }]);
    expect(o.edges).toContainEqual({ from: `doc:${A}`, to: `doc:${A}:1`, rel: "contiene" });
    expect(o.sections).toBe(0);
  });

  it("un documento enorme se recorta al tope y lo dice, sin relaciones colgando de nodos que no van", () => {
    const many = Array.from({ length: OUTLINE_MAX.nodes + 50 }, (_, i) => ({ seq: i + 1, section: `Sección ${i + 1}`, body: "Texto." }));
    const o = buildOutline(doc, "Políticas institucionales", many);
    expect(o.nodes.length).toBe(OUTLINE_MAX.nodes);
    expect(o.trimmed).toBe(true);
    const kept = new Set(o.nodes.map((n) => n.id));
    expect(o.edges.every((e) => (kept.has(e.from) || e.from.startsWith(`doc:${A}:`)) && (kept.has(e.to) || e.to.startsWith(`doc:${A}:`)))).toBe(true);
  });
});

describe("pensar el mapa: el bucle de comprender", () => {
  const limits: ThinkLimits = { maxMs: 60_000, maxRounds: 50, maxStrikes: 3, waits: [1_000, 2_000, 4_000], limitWaits: [10_000, 20_000, 30_000] };
  const st = (mapped: number, topics = 0, refs = 0) => ({ total: 100, mapped, pending: 100 - mapped, topics, refs });
  const lote = (run: ThinkRun, result: object, now = 1_000) => thinkReduce(run, { type: "lote", result, now }, limits);

  it("lee el estado con cuidado: números como texto, campos que faltan, basura", () => {
    expect(readThinkStatus({ total: "10", mapped: 4, pending: 6, topics: 2, refs: 1 })).toEqual({ total: 10, mapped: 4, pending: 6, topics: 2, refs: 1 });
    expect(readThinkStatus({ total: 10, mapped: 4 })).toEqual({ total: 10, mapped: 4, pending: 6, topics: 0, refs: 0 });
    expect(readThinkStatus({ total: -3, mapped: "x", pending: null })).toEqual({ total: 0, mapped: 0, pending: 0, topics: 0, refs: 0 });
    expect(readThinkStatus(null)).toBeNull();
    expect(readThinkStatus("18")).toBeNull();
    expect(readThinkStatus({ otro: 1 })).toBeNull();
  });

  it("sigue lote tras lote mientras haya avance, sin tope de 80 lotes", () => {
    let run = thinkStart(st(0), 0);
    for (let i = 1; i <= 40; i++) run = lote(run, { saved: 2, status: st(i * 2, i, i) }, i * 100);
    expect(run).toMatchObject({ phase: "pensando", rounds: 40, strikes: 0, failed: 0 });
    expect(thinkGain(run)).toEqual({ mapped: 80, topics: 40, refs: 40 });
    expect(thinkShare(run.status)).toBeCloseTo(0.8);
    expect(thinkActive(run)).toBe(true);
  });

  it("termina cuando no queda nada pendiente o la función dice «done»", () => {
    expect(lote(thinkStart(st(90), 0), { saved: 10, status: st(100) })).toMatchObject({ phase: "listo", why: "", again: false });
    expect(lote(thinkStart(st(90), 0), { done: true })).toMatchObject({ phase: "listo" });
    expect(lote(thinkStart(st(0), 0), { ai: false, note: "Este Pilo no tiene IA." })).toMatchObject({ phase: "listo", why: "Este Pilo no tiene IA." });
  });

  it("un lote que falla espera y reintenta sin perder lo hecho; al avanzar olvida los tropiezos", () => {
    let run = lote(thinkStart(st(0), 0), { saved: 18, status: st(18, 5, 2) });
    run = thinkReduce(run, { type: "fallo", retry: true, why: "Tardó demasiado.", now: 2_000 }, limits);
    expect(run).toMatchObject({ phase: "esperando", waitMs: 1_000, strikes: 1, failed: 1, rounds: 2 });
    expect(run.why).toContain("Tardó demasiado.");
    expect(run.why).toContain("intento 1 de 3");
    expect(thinkGain(run)).toEqual({ mapped: 18, topics: 5, refs: 2 });
    run = thinkReduce(run, { type: "esperado", now: 3_000 }, limits);
    expect(run).toMatchObject({ phase: "pensando", waitMs: 0, strikes: 1 });
    run = thinkReduce(run, { type: "fallo", retry: true, why: "No hubo conexión.", now: 4_000 }, limits);
    expect(run).toMatchObject({ phase: "esperando", waitMs: 2_000, strikes: 2 });
    run = lote(thinkReduce(run, { type: "esperado", now: 6_000 }, limits), { saved: 18, status: st(36, 9, 3) }, 7_000);
    expect(run).toMatchObject({ phase: "pensando", strikes: 0, failed: 2, rounds: 4, why: "" });
  });

  it("tras muchos fallos seguidos se detiene, y se puede retomar", () => {
    let run = thinkStart(st(10), 0);
    for (let i = 0; i < 3; i++) {
      run = thinkReduce(run, { type: "fallo", retry: true, why: "Falló la base.", now: 100 * i }, limits);
      expect(run.phase).toBe("esperando");
      run = thinkReduce(run, { type: "esperado", now: 100 * i + 50 }, limits);
    }
    run = thinkReduce(run, { type: "fallo", retry: true, why: "Falló la base.", now: 900 }, limits);
    expect(run).toMatchObject({ phase: "detenido", again: true, strikes: 4 });
    expect(run.why).toContain("4 veces seguidas");
    expect(thinkActive(run)).toBe(false);
    // Ya detenida no reacciona a nada.
    expect(lote(run, { saved: 5 })).toBe(run);
  });

  it("un error que no se arregla solo (permiso, migración) no se reintenta", () => {
    const run = thinkReduce(thinkStart(st(0), 0), { type: "fallo", retry: false, why: "Falta la migración 0115.", now: 10 }, limits);
    expect(run).toMatchObject({ phase: "detenido", again: false, why: "Falta la migración 0115." });
  });

  it("«formato» no se insiste; un lote sin nada guardado cuenta como tropiezo", () => {
    expect(lote(thinkStart(st(0), 0), { stopped: "formato", saved: 0, status: st(0) })).toMatchObject({ phase: "detenido", again: false });
    const empty = lote(thinkStart(st(0), 0), { saved: 0, status: st(0) });
    expect(empty).toMatchObject({ phase: "esperando", strikes: 1, waitMs: 1_000 });
    expect(empty.why).toContain("no guardó ningún pasaje");
  });

  it("si el proveedor limita, espera más; si el lote se quedó sin tiempo pero guardó, sigue de una vez", () => {
    const limited = lote(thinkStart(st(0), 0), { stopped: "limite_proveedor", saved: 0, status: st(0) });
    expect(limited).toMatchObject({ phase: "esperando", waitMs: 10_000, strikes: 1 });
    const partial = lote(thinkStart(st(0), 0), { stopped: "limite_proveedor", saved: 6, status: st(6) });
    expect(partial).toMatchObject({ phase: "esperando", waitMs: 10_000, strikes: 0, failed: 0 });
    expect(lote(thinkStart(st(0), 0), { stopped: "tiempo", saved: 9, status: st(9) })).toMatchObject({ phase: "pensando", strikes: 0 });
    expect(lote(thinkStart(st(0), 0), { stopped: "tiempo", saved: 0, status: st(0) })).toMatchObject({ phase: "esperando" });
    // Sin «saved» pero con más pasajes comprendidos en el estado: hubo avance.
    expect(lote(thinkStart(st(0), 0), { status: st(12) })).toMatchObject({ phase: "pensando", strikes: 0 });
  });

  it("detener: el lote en curso termina y se guarda; en una espera se corta ya", () => {
    let run = thinkReduce(thinkStart(st(0), 0), { type: "detener" }, limits);
    expect(run.phase).toBe("deteniendo");
    expect(thinkActive(run)).toBe(true);
    run = lote(run, { saved: 18, status: st(18, 4, 1) });
    expect(run).toMatchObject({ phase: "pausado", again: true });
    expect(thinkGain(run)).toEqual({ mapped: 18, topics: 4, refs: 1 });

    const waiting = thinkReduce(thinkStart(st(0), 0), { type: "fallo", retry: true, why: "x", now: 1 }, limits);
    expect(thinkReduce(waiting, { type: "detener" }, limits)).toMatchObject({ phase: "pausado", waitMs: 0, again: true });
    // Detener y que el lote falle: pausa, no una espera.
    const failing = thinkReduce(thinkReduce(thinkStart(st(0), 0), { type: "detener" }, limits), { type: "fallo", retry: true, why: "x", now: 1 }, limits);
    expect(failing.phase).toBe("pausado");
  });

  it("al cumplirse el tiempo de pensamiento se pausa y ofrece continuar", () => {
    const late = lote(thinkStart(st(0), 0), { saved: 18, status: st(18) }, 60_000);
    expect(late).toMatchObject({ phase: "pausado", again: true });
    expect(late.why).toContain("tiempo de pensamiento");
    const waited = thinkReduce(thinkReduce(thinkStart(st(0), 0), { type: "fallo", retry: true, why: "x", now: 59_000 }, limits), { type: "esperado", now: 61_000 }, limits);
    expect(waited.phase).toBe("pausado");
    let many = thinkStart(st(0), 0);
    for (let i = 1; i <= 50; i++) many = lote(many, { saved: 1, status: st(i) }, i);
    expect(many).toMatchObject({ phase: "pausado", rounds: 50 });
  });

  it("retomar suma a lo ya ganado y estrena reloj y tropiezos", () => {
    const paused = lote(thinkReduce(thinkStart(st(0), 0), { type: "detener" }, limits), { saved: 18, status: st(18, 4, 1) }, 500);
    const again = thinkResume(paused, st(18, 4, 1), 90_000);
    expect(again).toMatchObject({ phase: "pensando", startedAt: 90_000, rounds: 1, strikes: 0, why: "" });
    const more = lote(again, { saved: 18, status: st(36, 7, 2) }, 91_000);
    expect(more).toMatchObject({ phase: "pensando", rounds: 2 });
    expect(thinkGain(more)).toEqual({ mapped: 36, topics: 7, refs: 2 });
    expect(thinkResume(paused, null, 5).status).toEqual(paused.status);
  });

  it("los tiempos de pensamiento van de menos a más y el de partida da una hora", () => {
    expect(THINK_BUDGETS.map((b) => b.ms)).toEqual([...THINK_BUDGETS.map((b) => b.ms)].sort((a, b) => a - b));
    expect(THINK_LIMITS.maxMs).toBe(60 * 60_000);
    expect(THINK_LIMITS.waits).toHaveLength(THINK_LIMITS.maxStrikes);
    expect(thinkGain(null)).toEqual({ mapped: 0, topics: 0, refs: 0 });
    expect(thinkShare(null)).toBe(0);
  });
});
