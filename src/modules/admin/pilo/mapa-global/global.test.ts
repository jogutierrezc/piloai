import { describe, expect, it } from "vitest";
import { teachGraph } from "../../pilo-ensenanza/memoria/map";
import type { ViewNode } from "../mesh-view";
import { bridgeCounts, bridgeKey, bridgeKeys, bridgeLive, bridgeState, buildGlobal, computeBridges, countsOf, defaultOpen, detailOf, gid, inboxItem, inboxOf, layoutGlobal, litOf, normLabel, pairKey, parseBridges, revealOf, searchGlobal, visibleOf } from "./global";
import type { GNode, StoredBridge, ViewState } from "./global";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const node = (id: string, source: string, type: string, label: string, code = ""): ViewNode => ({ id, source, type, code, label, path: "" });

/** Planeación: el Plan (pilar › área › línea › proyecto) e Impacto con dos indicadores, uno de ellos del ODS 4. */
const planeacion = () => ({
  nodes: [
    node("fuente:pdi", "pdi", "fuente", "Plan de Desarrollo Institucional 2024-2028"),
    node("pdi:pilar:personalizacion", "pdi", "pilar", "Personalización", "P1"),
    node("pdi:area:a1", "pdi", "area", "Evaluación formativa", "AE1"),
    node("pdi:linea:l1", "pdi", "linea", "Rúbricas por competencia", "LA1"),
    node("pdi:proyecto:x", "pdi", "proyecto", "Banco de rúbricas", "PR1"),
    node("fuente:impacto", "impacto", "fuente", "Portal de Impacto"),
    node("impacto:indicador:i1", "impacto", "indicador", "ODS 4 · Educación de calidad: cobertura"),
    node("impacto:indicador:i2", "impacto", "indicador", "Cumplimiento de la Ley 30 de 1992"),
    node("impacto:suelto", "impacto", "tema", "Huérfano sin padre"),
  ],
  edges: [
    { from: "fuente:pdi", to: "pdi:pilar:personalizacion", rel: "contiene" },
    { from: "pdi:pilar:personalizacion", to: "pdi:area:a1", rel: "contiene" },
    { from: "pdi:area:a1", to: "pdi:linea:l1", rel: "contiene" },
    { from: "pdi:linea:l1", to: "pdi:proyecto:x", rel: "contiene" },
    { from: "fuente:impacto", to: "impacto:indicador:i1", rel: "contiene" },
    { from: "fuente:impacto", to: "impacto:indicador:i2", rel: "contiene" },
    { from: "impacto:indicador:i1", to: "pdi:pilar:personalizacion", rel: "mide" },
    { from: "fuente:impacto", to: "no:existe", rel: "contiene" },
  ],
});

/** Enseñanza: dos documentos de políticas; A trata «Evaluación formativa» y cita ODS 4; B cita la Ley 30. */
const ensenanza = () =>
  teachGraph(
    {
      nodes: [
        { id: "fuente:politicas", label: "politicas", type: "fuente" },
        { id: `doc:${A}`, label: "Política de evaluación", type: "documento" },
        { id: `doc:${B}`, label: "Acuerdo de currículo", type: "documento" },
        { id: "tema:evaluacion-formativa", label: "Evaluación formativa", type: "tema" },
        { id: "tema:personalizacion", label: "Pilar Personalización", type: "tema" },
        { id: "ref:ods-4", label: "ODS 4", type: "referencia", props: { clase: "ods" } },
        { id: "ref:ley-30", label: "Ley 30", type: "referencia", props: { clase: "norma" } },
      ],
      edges: [
        { from: "fuente:politicas", to: `doc:${A}`, rel: "contiene" },
        { from: "fuente:politicas", to: `doc:${B}`, rel: "contiene" },
        { from: `doc:${A}:1`, to: "tema:evaluacion-formativa", rel: "trata" },
        { from: `doc:${A}:1`, to: "ref:ods-4", rel: "cita" },
        { from: `doc:${A}:2`, to: "tema:personalizacion", rel: "trata" },
        { from: `doc:${B}:1`, to: "ref:ley-30", rel: "cita" },
      ],
    },
    { politicas: "Políticas institucionales" },
  );

const P = (raw: string) => gid("planeacion", raw);
const E = (raw: string) => gid("ensenanza", raw);
const build = () => buildGlobal({ planeacion: planeacion(), ensenanza: ensenanza(), order: { planeacion: ["cifras", "pdi", "impacto"], ensenanza: ["politicas"] } });
const view = (over: Partial<ViewState> = {}): ViewState => ({ filter: "todo", open: new Set(), pinned: new Set(), allHubs: false, ...over });

describe("fusión de las dos mallas", () => {
  it("cada Pilo conserva lo suyo: ids con su espacio y nada compartido", () => {
    const g = build();
    expect(g.nodes.every((n) => n.id.startsWith(n.space === "planeacion" ? "p|" : "e|"))).toBe(true);
    expect(g.nodes.filter((n) => n.space === "planeacion")).toHaveLength(9);
    expect(g.nodes.filter((n) => n.space === "ensenanza")).toHaveLength(7);
    // Ninguna relación propia cruza de un espacio al otro: solo los puentes, que no son relaciones de la base.
    expect(g.edges.every((e) => g.byId.get(e.from)!.space === g.byId.get(e.to)!.space)).toBe(true);
  });

  it("dos nodos con el mismo id en la base son dos puntos en el mapa", () => {
    const g = buildGlobal({ planeacion: { nodes: [node("fuente:pdi", "pdi", "fuente", "Plan"), node("tema:x", "pdi", "tema", "Equis")], edges: [{ from: "fuente:pdi", to: "tema:x", rel: "contiene" }] }, ensenanza: teachGraph({ nodes: [{ id: "tema:x", label: "Equis" }], edges: [] }) });
    expect(g.byId.get("p|tema:x")!.space).toBe("planeacion");
    expect(g.byId.get("e|tema:x")!.space).toBe("ensenanza");
    expect(g.bridges).toEqual([{ a: "p|tema:x", b: "e|tema:x", kind: "nombre", why: "Se llaman igual: «Equis»" }]);
  });

  it("Planeación es un árbol por «contiene»; la profundidad da la columna y lo huérfano va bajo su fuente", () => {
    const g = build();
    expect(g.roots.planeacion).toEqual([P("fuente:pdi"), P("fuente:impacto")]);
    expect(g.byId.get(P("pdi:pilar:personalizacion"))).toMatchObject({ col: 1, depth: 1, parent: P("fuente:pdi"), inside: 3 });
    expect(g.byId.get(P("pdi:linea:l1"))).toMatchObject({ col: 3, depth: 3 });
    expect(g.byId.get(P("pdi:proyecto:x"))).toMatchObject({ col: 3, depth: 4, parent: P("pdi:linea:l1") });
    expect(g.byId.get(P("impacto:suelto"))).toMatchObject({ depth: 1, parent: P("fuente:impacto") });
    expect(g.byId.get(P("fuente:pdi"))!.inside).toBe(4);
    // Una relación hacia algo que no existe no se dibuja; «mide» queda como enlace.
    expect(g.edges.some((e) => e.to.includes("no:existe"))).toBe(false);
    expect(g.edges.find((e) => e.rel === "mide")).toMatchObject({ kind: "enlace", from: P("impacto:indicador:i1"), to: P("pdi:pilar:personalizacion") });
  });

  it("Enseñanza conserva colección › documento › tema › referencia y los pasajes de cada punto", () => {
    const g = build();
    expect(g.roots.ensenanza).toEqual([E("fuente:politicas")]);
    expect(g.byId.get(E(`doc:${A}`))).toMatchObject({ col: 1, kind: "documento", parent: E("fuente:politicas"), source: "politicas" });
    expect(g.byId.get(E("fuente:politicas"))!.label).toBe("Políticas institucionales");
    expect(g.byId.get(E("tema:evaluacion-formativa"))).toMatchObject({ col: 2, kind: "tema", passages: [`doc:${A}:1`] });
    expect(g.edges.find((e) => e.from === E("tema:evaluacion-formativa") && e.to === E("ref:ods-4"))).toMatchObject({ kind: "cita", docs: [E(`doc:${A}`)] });
    expect(g.edges.find((e) => e.from === E(`doc:${B}`) && e.to === E("ref:ley-30"))).toMatchObject({ kind: "cita" });
  });

  it("un solo lado también se dibuja", () => {
    const g = buildGlobal({ planeacion: null, ensenanza: ensenanza() });
    expect(g.roots.planeacion).toEqual([]);
    expect(g.bridges).toEqual([]);
    expect(countsOf(g)).toEqual({ planeacion: 0, ensenanza: 6, puentes: 0 });
    expect(buildGlobal({ planeacion: null, ensenanza: null }).nodes).toEqual([]);
  });
});

describe("puentes", () => {
  it("normaliza etiquetas: tildes, mayúsculas y signos no cuentan", () => {
    expect(normLabel("  Evaluación   Formativa. ")).toBe("evaluacion formativa");
    expect(bridgeKeys("ODS 4").map((k) => k.key)).toEqual(["ods:4", "nombre:ods 4"]);
    expect(bridgeKeys("Objetivo de Desarrollo Sostenible 4: educación")[0].key).toBe("ods:4");
    expect(bridgeKeys("ODS 44")[0].key).not.toBe("ods:44");
    expect(bridgeKeys("Ley 30 de 1992")[0]).toMatchObject({ key: "norma:ley:30:1992", say: "Ley 30 de 1992", kind: "referencia" });
    expect(bridgeKeys("Decreto No. 1330 del 2019")[0].key).toBe("norma:decreto:1330:2019");
    expect(bridgeKeys("Ley 30")[0].key).toBe("norma:ley:30:?");
    expect(bridgeKeys("P1")).toEqual([]);
    expect(bridgeKeys("2024")).toEqual([]);
  });

  it("une por la misma referencia (ODS, ley) y por el mismo nombre (tema, pilar)", () => {
    const g = build();
    const pairs = g.bridges.map((b) => `${b.a} ~ ${b.b} (${b.kind})`).sort();
    expect(pairs).toEqual(
      [
        `${P("impacto:indicador:i1")} ~ ${E("ref:ods-4")} (referencia)`,
        `${P("impacto:indicador:i2")} ~ ${E("ref:ley-30")} (referencia)`,
        `${P("pdi:area:a1")} ~ ${E("tema:evaluacion-formativa")} (nombre)`,
        `${P("pdi:pilar:personalizacion")} ~ ${E("tema:personalizacion")} (nombre)`,
      ].sort(),
    );
    expect(g.bridges.find((b) => b.b === E("ref:ods-4"))!.why).toBe("Los dos nombran ODS 4");
    expect(g.bridges.find((b) => b.b === E("tema:evaluacion-formativa"))!.why).toBe("Se llaman igual: «Evaluación formativa»");
    expect(g.bridgesOf.get(P("pdi:area:a1"))).toHaveLength(1);
    expect(countsOf(g).puentes).toBe(4);
  });

  it("una norma sin año casa con la misma con año; dos años distintos no casan", () => {
    const mk = (id: string, space: "planeacion" | "ensenanza", label: string): GNode => ({ id, raw: id, space, col: 2, depth: 2, kind: "tema", code: "", label, source: "", path: "", parent: null, kids: [], inside: 0, passages: [] });
    const pairs = (a: string, b: string) => computeBridges([mk("p|a", "planeacion", a), mk("e|b", "ensenanza", b)]).length;
    expect(pairs("Decreto 1330 de 2019", "Decreto 1330")).toBe(1);
    expect(pairs("Decreto 1330", "Decreto 1330 de 2019")).toBe(1);
    expect(pairs("Decreto 1330", "decreto 1330")).toBe(1);
    expect(pairs("Decreto 1330 de 2019", "Decreto 1330 de 2019")).toBe(1);
    expect(pairs("Decreto 1330 de 2019", "Decreto 1330 de 2015")).toBe(0);
    expect(pairs("Ley 30 de 1992", "Ley 115 de 1994")).toBe(0);
  });

  it("nunca une dos puntos del mismo Pilo, y cada par sale una sola vez", () => {
    const g = build();
    expect(g.bridges.every((b) => g.byId.get(b.a)!.space === "planeacion" && g.byId.get(b.b)!.space === "ensenanza")).toBe(true);
    expect(new Set(g.bridges.map((b) => bridgeKey(b.a, b.b))).size).toBe(g.bridges.length);
  });
});

describe("filtros y pliegues", () => {
  it("todo plegado: solo fuentes, colecciones y los temas y referencias; lo plegado pasa sus relaciones y puentes a quien lo contiene", () => {
    const g = build();
    const v = visibleOf(g, view());
    expect([...v.ids].filter((id) => id.startsWith("p|")).sort()).toEqual([P("fuente:impacto"), P("fuente:pdi")].sort());
    expect(v.ids.has(E(`doc:${A}`))).toBe(false);
    expect(v.ids.has(E("ref:ods-4"))).toBe(true);
    expect(v.anchor(P("pdi:proyecto:x"))).toBe(P("fuente:pdi"));
    // doc A → tema se dibuja como colección → tema.
    expect(v.edges.find((e) => e.key === pairKey(E("fuente:politicas"), E("tema:evaluacion-formativa")))).toBeTruthy();
    // El enlace «mide» entre un indicador y un pilar, plegado, va de fuente a fuente.
    expect(v.edges.find((e) => e.key === pairKey(P("fuente:impacto"), P("fuente:pdi")))).toBeTruthy();
    // Los dos puentes de Impacto llegan a su fuente; cada uno a su referencia.
    expect(v.bridges.map((b) => b.key).sort()).toEqual(
      [bridgeKey(P("fuente:impacto"), E("ref:ods-4")), bridgeKey(P("fuente:impacto"), E("ref:ley-30")), bridgeKey(P("fuente:pdi"), E("tema:evaluacion-formativa")), bridgeKey(P("fuente:pdi"), E("tema:personalizacion"))].sort(),
    );
  });

  it("abrir un punto muestra lo que contiene, hasta la cuarta columna", () => {
    const g = build();
    const open = new Set([P("fuente:pdi"), P("pdi:pilar:personalizacion"), P("pdi:area:a1"), P("pdi:linea:l1")]);
    const v = visibleOf(g, view({ open }));
    expect(v.ids.has(P("pdi:linea:l1"))).toBe(true);
    expect(v.ids.has(P("pdi:proyecto:x"))).toBe(false);
    expect(v.anchor(P("pdi:proyecto:x"))).toBe(P("pdi:linea:l1"));
    expect(v.bridges.find((b) => b.a === P("pdi:area:a1"))!.b).toBe(E("tema:evaluacion-formativa"));
  });

  it("ver solo un Pilo quita el otro y sus puentes del dibujo, no del cálculo", () => {
    const g = build();
    const solo = visibleOf(g, view({ filter: "planeacion" }));
    expect(solo.nodes.every((n) => n.space === "planeacion")).toBe(true);
    expect(solo.bridges).toEqual([]);
    expect(solo.anchor(E("ref:ods-4"))).toBeNull();
    expect(g.bridges).toHaveLength(4);
    const ens = visibleOf(g, view({ filter: "ensenanza" }));
    expect(ens.nodes.every((n) => n.space === "ensenanza")).toBe(true);
    expect(detailOf(g, E("ref:ods-4"))!.bridges).toHaveLength(1);
  });

  it("con muchos temas solo se dibujan los más usados; los que hacen puente y los fijados, siempre", () => {
    const g = build();
    const v = visibleOf(g, view({ hubLimit: 1 }));
    expect(v.hiddenHubs).toBe(2);
    expect(v.nodes.filter((n) => n.space === "ensenanza" && n.col >= 2)).toHaveLength(2);
    const pinned = visibleOf(g, view({ hubLimit: 0, pinned: new Set([E("ref:ley-30")]) }));
    expect(pinned.nodes.filter((n) => n.space === "ensenanza" && n.col >= 2).map((n) => n.id)).toEqual([E("ref:ley-30")]);
    expect(visibleOf(g, view({ hubLimit: 0, allHubs: true })).hiddenHubs).toBe(0);
  });

  it("de entrada abre las fuentes pequeñas y respeta el presupuesto", () => {
    const g = build();
    expect([...defaultOpen(g)].sort()).toEqual([E("fuente:politicas"), P("fuente:impacto"), P("fuente:pdi")].sort());
    expect([...defaultOpen(g, 14, 2)]).toEqual([P("fuente:pdi")]);
    expect(defaultOpen(g, 1).has(P("fuente:impacto"))).toBe(false);
  });

  it("para traer un punto a la vista dice qué abrir y qué fijar", () => {
    const g = build();
    expect(revealOf(g, P("pdi:proyecto:x"))).toEqual({ open: [P("fuente:pdi"), P("pdi:pilar:personalizacion"), P("pdi:area:a1"), P("pdi:linea:l1")], pin: null });
    expect(revealOf(g, E("ref:ods-4"))).toEqual({ open: [], pin: E("ref:ods-4") });
    expect(revealOf(g, E(`doc:${A}`))).toEqual({ open: [E("fuente:politicas")], pin: null });
  });

  it("cientos de nodos: plegado, el mapa dibuja unas decenas", () => {
    const nodes = [node("fuente:cifras", "cifras", "fuente", "UDES en Cifras")];
    const edges = [];
    for (let i = 0; i < 40; i++) {
      nodes.push(node(`cifras:inf${i}`, "cifras", "informe", `Informe ${i}`));
      edges.push({ from: "fuente:cifras", to: `cifras:inf${i}`, rel: "contiene" });
      for (let j = 0; j < 20; j++) {
        nodes.push(node(`cifras:inf${i}:ind${j}`, "cifras", "indicador", `Indicador ${i}-${j}`));
        edges.push({ from: `cifras:inf${i}`, to: `cifras:inf${i}:ind${j}`, rel: "contiene" });
      }
    }
    const g = buildGlobal({ planeacion: { nodes, edges }, ensenanza: null });
    expect(g.nodes).toHaveLength(841);
    const open = defaultOpen(g);
    expect(open.size).toBe(0);
    expect(visibleOf(g, view({ open })).nodes).toHaveLength(1);
    const one = visibleOf(g, view({ open: new Set([P("fuente:cifras"), P("cifras:inf3")]) }));
    expect(one.nodes).toHaveLength(61);
    expect(layoutGlobal(g, one).y.size).toBe(61);
  });
});

describe("disposición", () => {
  it("una banda por Pilo, Planeación arriba; nada se pisa en una columna", () => {
    const g = build();
    const v = visibleOf(g, view({ open: defaultOpen(g) }));
    const l = layoutGlobal(g, v, { row: 24, head: 56, gap: 28 });
    expect(l.bands.map((b) => b.space)).toEqual(["planeacion", "ensenanza"]);
    expect(l.bands[1].top).toBeGreaterThan(l.bands[0].bottom);
    expect(l.height).toBe(l.bands[1].bottom);
    for (const n of v.nodes) {
      const band = l.bands.find((b) => b.space === n.space)!;
      expect(l.y.get(n.id)).toBeGreaterThanOrEqual(band.top + 56);
      expect(l.y.get(n.id)).toBeLessThan(band.bottom);
    }
    for (const band of l.bands) {
      for (const column of band.columns) {
        const ys = column.map((id) => l.y.get(id)!);
        for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(24);
      }
    }
  });

  it("quien contiene va a la altura media de lo suyo; lo plegado ocupa una fila", () => {
    const g = build();
    const v = visibleOf(g, view({ open: new Set([P("fuente:impacto")]) }));
    const l = layoutGlobal(g, v);
    const kids = g.byId.get(P("fuente:impacto"))!.kids.map((k) => l.y.get(k)!);
    expect(kids).toHaveLength(3);
    expect(l.y.get(P("fuente:impacto"))).toBeCloseTo((kids[0] + kids[1] + kids[2]) / 3);
    expect(l.y.get(P("fuente:pdi"))).toBeLessThan(Math.min(...kids));
  });

  it("con un solo Pilo hay una sola banda, y sin nada, ninguna", () => {
    const g = build();
    expect(layoutGlobal(g, visibleOf(g, view({ filter: "ensenanza" }))).bands.map((b) => b.space)).toEqual(["ensenanza"]);
    const empty = buildGlobal({ planeacion: null, ensenanza: null });
    expect(layoutGlobal(empty, visibleOf(empty, view()))).toMatchObject({ bands: [], height: 0 });
  });
});

describe("lo que se enciende y el detalle", () => {
  it("un tema enciende sus documentos, sus referencias y su puente", () => {
    const g = build();
    const v = visibleOf(g, view({ open: new Set([E("fuente:politicas"), P("fuente:pdi"), P("pdi:pilar:personalizacion")]) }));
    const lit = litOf(g, v, E("tema:evaluacion-formativa"))!;
    expect(lit.nodes.has(E(`doc:${A}`))).toBe(true);
    expect(lit.nodes.has(E("ref:ods-4"))).toBe(true);
    expect(lit.nodes.has(P("pdi:area:a1"))).toBe(true);
    expect(lit.nodes.has(E(`doc:${B}`))).toBe(false);
    expect([...lit.bridges]).toEqual([bridgeKey(P("pdi:area:a1"), E("tema:evaluacion-formativa"))]);
  });

  it("un documento enciende lo que sale de sus pasajes y su colección", () => {
    const g = build();
    const v = visibleOf(g, view({ open: new Set([E("fuente:politicas")]) }));
    const lit = litOf(g, v, E(`doc:${A}`))!;
    expect(lit.edges.has(pairKey(E("tema:evaluacion-formativa"), E("ref:ods-4")))).toBe(true);
    expect(lit.nodes.has(E("fuente:politicas"))).toBe(true);
    expect(lit.nodes.has(E("ref:ley-30"))).toBe(false);
  });

  it("un punto plegado enciende a quien lo contiene; uno del Pilo filtrado, nada", () => {
    const g = build();
    const v = visibleOf(g, view());
    expect(litOf(g, v, P("pdi:area:a1"))!.nodes.has(P("fuente:pdi"))).toBe(true);
    expect(litOf(g, v, P("pdi:area:a1"))!.nodes.has(E("tema:evaluacion-formativa"))).toBe(true);
    expect(litOf(g, visibleOf(g, view({ filter: "ensenanza" })), P("pdi:area:a1"))).toBeNull();
    expect(litOf(g, v, null)).toBeNull();
  });

  it("el detalle dice de dónde viene, con qué se conecta y por qué puente", () => {
    const g = build();
    const tema = detailOf(g, E("tema:evaluacion-formativa"))!;
    expect(tema.node.passages).toEqual([`doc:${A}:1`]);
    expect(tema.links.map((l) => [l.title, l.nodes.map((n) => n.label)])).toEqual([
      ["Documentos y cursos", ["Política de evaluación"]],
      ["Referencias", ["ODS 4"]],
    ]);
    expect(tema.bridges.map((b) => [b.other.id, b.why])).toEqual([[P("pdi:area:a1"), "Se llaman igual: «Evaluación formativa»"]]);

    const doc = detailOf(g, E(`doc:${A}`))!;
    expect(doc.route.map((n) => n.label)).toEqual(["Políticas institucionales", "Política de evaluación"]);
    expect(doc.links.map((l) => l.title)).toEqual(["Temas", "Referencias"]);

    const linea = detailOf(g, P("pdi:linea:l1"))!;
    expect(linea.route.map((n) => n.code || n.kind)).toEqual(["fuente", "P1", "AE1", "LA1"]);
    expect(linea.kids.map((n) => n.code)).toEqual(["PR1"]);

    const pilar = detailOf(g, P("pdi:pilar:personalizacion"))!;
    expect(pilar.links).toEqual([{ title: "Se enlaza con", nodes: [g.byId.get(P("impacto:indicador:i1"))] }]);
    expect(pilar.bridges[0].other.id).toBe(E("tema:personalizacion"));
    expect(detailOf(g, "p|nada")).toBeNull();
  });

  it("el buscador encuentra en los dos Pilos, por código o por nombre, y respeta el filtro", () => {
    const g = build();
    expect(searchGlobal(g, "evaluacion formativa").map((n) => n.id).sort()).toEqual([E("tema:evaluacion-formativa"), P("pdi:area:a1")].sort());
    expect(searchGlobal(g, "PR1").map((n) => n.id)).toEqual([P("pdi:proyecto:x")]);
    expect(searchGlobal(g, "ods 4", "ensenanza").map((n) => n.id)).toEqual([E("ref:ods-4")]);
    expect(searchGlobal(g, "politicas institucionales")).toEqual([]);
    expect(searchGlobal(g, "   ")).toEqual([]);
  });
});

/* --- Los puentes guardados (0122) ------------------------------------------------------------
   Desde 0122 los puentes se leen de la base, con su origen y su estado. El mapa
   deja de calcularlos: solo los pone sobre sus puntos. */

describe("puentes guardados", () => {
  const row = (over: Partial<StoredBridge>): StoredBridge => ({
    id: 1,
    a_scope: "ensenanza",
    a_id: "ref:ods-4",
    a_label: "ODS 4",
    b_scope: "planeacion",
    b_id: "impacto:indicador:i1",
    b_label: "ODS 4 · Educación de calidad: cobertura",
    kind: "referencia",
    key: "ods:4",
    why: "Los dos nombran ODS 4",
    origin: "reglas",
    status: "aprobada",
    ...over,
  });
  const stored = [
    row({}),
    row({ id: 2, a_id: `doc:${A}`, a_label: "Política de evaluación", b_id: "pdi:proyecto:x", b_label: "Banco de rúbricas", kind: "relacion", key: "", why: "Este proyecto del Plan desarrolla lo que la política pide.", origin: "ia", status: "propuesta" }),
    row({ id: 3, a_id: "ref:ley-30", a_label: "Ley 30", b_id: "impacto:indicador:i2", b_label: "Cumplimiento de la Ley 30 de 1992", why: "Los dos nombran Ley 30 de 1992", status: "rechazada" }),
    // Un puente entre dos puntos que este mapa no dibuja (un tema que también usa Planeación).
    row({ id: 4, a_id: "tema:evaluacion-formativa", a_label: "Evaluación formativa", b_id: "tema:evaluacion-formativa", b_label: "Evaluación formativa", kind: "tema", why: "Los dos ámbitos tratan «Evaluación formativa»", origin: "ia", status: "propuesta" }),
  ];
  const withStored = (bridges: StoredBridge[] | null) => buildGlobal({ planeacion: planeacion(), ensenanza: ensenanza(), order: { planeacion: ["cifras", "pdi", "impacto"], ensenanza: ["politicas"] }, bridges });

  it("el mapa los lee en vez de calcularlos: cada uno con su estado y su origen", () => {
    const g = withStored(stored);
    expect(g.stored).toBe(true);
    // El rechazado no se dibuja; el que une puntos que este mapa no tiene se cuenta aparte.
    expect(g.bridges).toEqual([
      { a: P("impacto:indicador:i1"), b: E("ref:ods-4"), kind: "referencia", why: "Los dos nombran ODS 4", id: 1, origin: "reglas", status: "aprobada" },
      { a: P("pdi:proyecto:x"), b: E(`doc:${A}`), kind: "relacion", why: "Este proyecto del Plan desarrolla lo que la política pide.", id: 2, origin: "ia", status: "propuesta" },
    ]);
    expect(g.offMap).toBe(1);
    expect(countsOf(g).puentes).toBe(2);
    expect(bridgeCounts(g)).toEqual({ aprobados: 1, propuestos: 1 });
    // Ya no calcula nada: los cuatro puentes por etiqueta de antes no aparecen si la base no los tiene.
    expect(g.bridges.some((b) => b.b === E("tema:personalizacion"))).toBe(false);
    // Con la base sin puentes guardados, el mapa no inventa ninguno.
    expect(withStored([]).bridges).toEqual([]);
    expect(withStored([]).stored).toBe(true);
  });

  it("sin 0122 (no llegan filas) los calcula al dibujar, como antes, y dice que no están guardados", () => {
    const g = withStored(null);
    expect(g.stored).toBe(false);
    expect(g.bridges).toHaveLength(4);
    expect(g.bridges.every((b) => b.status === undefined && b.origin === undefined && b.id === undefined)).toBe(true);
    expect(g.offMap).toBe(0);
    expect(bridgeCounts(g)).toEqual({ aprobados: 0, propuestos: 0 });
    expect(bridgeState(g.bridges[0])).toBe("Calculado al dibujar · sin guardar");
    expect(bridgeLive(g.bridges[0])).toBe(false);
    expect(build().bridges).toEqual(g.bridges);
  });

  it("el estado se dice en palabras, y solo lo aprobado lo sigue Pilo", () => {
    expect(bridgeState({ origin: "reglas", status: "aprobada" })).toBe("Aprobado · por reglas");
    expect(bridgeState({ origin: "ia", status: "propuesta" })).toBe("Por revisar · lo propuso la IA");
    expect(bridgeState({ origin: "admin", status: "rechazada" })).toBe("Rechazado · lo puso la administración");
    expect(bridgeLive({ status: "aprobada" })).toBe(true);
    expect(bridgeLive({ status: "propuesta" })).toBe(false);
    expect(bridgeLive({ status: "rechazada" })).toBe(false);
    const g = withStored(stored);
    const detail = detailOf(g, P("pdi:proyecto:x"))!;
    expect(detail.bridges.map((b) => [b.other.id, b.status, b.origin, b.id])).toEqual([[E(`doc:${A}`), "propuesta", "ia", 2]]);
    // El punto del puente rechazado ya no tiene puente.
    expect(detailOf(g, P("impacto:indicador:i2"))!.bridges).toEqual([]);
  });

  it("lo plegado pasa sus puentes a quien lo contiene, con su estado", () => {
    const g = withStored(stored);
    const v = visibleOf(g, view());
    const folded = v.bridges.find((b) => b.a === P("fuente:pdi"))!;
    expect(folded.b).toBe(E("fuente:politicas"));
    expect(folded.items.map((i) => i.status)).toEqual(["propuesta"]);
    expect(v.bridges.find((b) => b.b === E("ref:ods-4"))!.items[0].status).toBe("aprobada");
  });

  it("lee las filas de la base con cuidado: lo que no reconoce no entra", () => {
    expect(parseBridges(null)).toEqual([]);
    expect(parseBridges([row({}), null, "x", { id: "abc" }, { ...row({ id: 9 }), status: "activa" }, { ...row({ id: 10 }), origin: "modelo" }, { ...row({ id: 11 }), b_scope: "ensenanza" }])).toEqual([row({})]);
    expect(parseBridges([{ ...row({ id: 12 }), kind: "otra", why: "  con   espacios  ", a_label: 7 }])).toEqual([row({ id: 12, kind: "relacion", why: "con espacios", a_label: "" })]);
  });

  it("la bandeja: solo los propuestos, con sus dos extremos (Planeación primero) y de dónde salen", () => {
    const g = withStored(stored);
    const inbox = inboxOf(stored, g.byId);
    expect(inbox.map((i) => i.bridge.id)).toEqual([2, 4]);
    expect(inbox[0].ends).toEqual([
      { space: "planeacion", label: "Banco de rúbricas", node: P("pdi:proyecto:x") },
      { space: "ensenanza", label: "Política de evaluación", node: E(`doc:${A}`) },
    ]);
    expect(inbox[0].origin).toBe("Lo propuso la IA · relación propuesta");
    // Un extremo que el mapa no dibuja se nombra igual, sin punto al que saltar.
    expect(inbox[1].ends[0]).toEqual({ space: "planeacion", label: "Evaluación formativa", node: null });
    expect(inbox[1].ends[1]).toEqual({ space: "ensenanza", label: "Evaluación formativa", node: E("tema:evaluacion-formativa") });
    expect(inbox[1].origin).toBe("Lo propuso la IA · tratan el mismo tema");
    // Sin etiqueta guardada, vale el nombre del punto o, si no está en el mapa, su id.
    expect(inboxItem(row({ a_label: "", b_label: "" }), g.byId).ends.map((e) => e.label)).toEqual(["ODS 4 · Educación de calidad: cobertura", "ODS 4"]);
    expect(inboxItem(row({ a_id: "ref:nada", a_label: "" }), g.byId).ends[1]).toEqual({ space: "ensenanza", label: "ref:nada", node: null });
  });
});
