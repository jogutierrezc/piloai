/* =============================================================================
   Pregúntele a Pilo · la memoria, sin base de datos.

   Cada armador recibe datos como los devuelve la base de verdad (bien
   formados) y como llegan cuando algo falla aguas arriba: años donde se
   espera texto, nulos, objetos, cifras que no son número, textos vacíos,
   indicadores de dinero, tablas de ejemplo. Ninguno debe caerse ni dejar
   pasar «undefined», «null», «[object Object]» o una cifra de dinero.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { BODY_MAX, MIN_BODY, bulletinRows, buildSources, cifrasRows, clean, factRows, finalize, impactRows, noMoney, observatoryRows, pdiRows, problemMessage, sentence } from "./memory";
import type { MemoryRow } from "./memory";
import type { Indicator, OpenDataCatalog } from "../../datos-abiertos/data/types";
import type { PillarWithProgress } from "../../../data/queries";
import type { ProjectWithLinks } from "../../../types/database";
import type { LiveTopic } from "../../datos-abiertos/observatorio/live";
import type { ObsDataset, ObsView } from "../observatorio/model";
import { OBS_TOPICS } from "../../datos-abiertos/observatorio/data";
import { toPortalData } from "../../impacto/portal/data";

const MONEY = /dinero|peso|\$|cop\b|millones|presupuest/i;

/** Lo que ningún pasaje puede llevar, venga de donde venga. */
function expectClean(rows: MemoryRow[]) {
  for (const r of rows) {
    for (const [field, value] of Object.entries(r)) {
      expect(typeof value, `${r.ref}.${field}`).toBe("string");
      expect(value, `${r.ref}.${field}`).not.toMatch(/undefined|\bnull\b|\[object Object\]|NaN/);
    }
    expect(r.ref.length).toBeGreaterThanOrEqual(3);
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.body.length).toBeGreaterThanOrEqual(MIN_BODY);
    expect(r.body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(r.cut.length).toBeLessThanOrEqual(60);
    expect(r.office.length).toBeLessThanOrEqual(200);
    // Ninguna frase con dinero y cifra.
    for (const part of r.body.split(/(?<=[.!?…;])\s+/)) expect(MONEY.test(part) && /\d/.test(part), `${r.ref}: ${part}`).toBe(false);
  }
  expect(new Set(rows.map((r) => r.ref)).size).toBe(rows.length);
}

const any = <T>(v: unknown) => v as T;

/* --- Utilidades -------------------------------------------------------------------------- */

describe("texto a prueba de datos", () => {
  it("clean y sentence aceptan lo que venga", () => {
    for (const v of [null, undefined, 2025, NaN, { a: 1 }, ["x"], true, "  hola   mundo  "]) {
      expect(() => clean(v)).not.toThrow();
      expect(() => sentence(v)).not.toThrow();
    }
    expect(clean(2025)).toBe("2025");
    expect(clean(NaN)).toBe("");
    expect(clean({ a: 1 })).toBe("");
    expect(sentence(null)).toBe("");
    expect(sentence("Hola")).toBe("Hola.");
  });

  it("noMoney quita solo las frases con dinero y cifra", () => {
    expect(noMoney("Crece la matrícula. El presupuesto fue de 1.200 millones. Se amplió el campus.")).toBe("Crece la matrícula. Se amplió el campus.");
    expect(noMoney("El presupuesto se ejecuta por proyectos.")).toBe("El presupuesto se ejecuta por proyectos.");
  });

  it("finalize descarta lo corto, lo sin título y lo repetido, y recorta", () => {
    const rows = finalize([
      { ref: "a:1", title: "Uno", body: "Un cuerpo suficiente." },
      { ref: "a:1", title: "Repetido", body: "Otro cuerpo suficiente." },
      { ref: "a:2", title: "Corto", body: "corto" },
      { ref: "a:3", title: null, body: "Sin título pero largo." },
      { ref: "a:4", title: { x: 1 }, body: "Título objeto, largo." },
      { ref: "a:5", title: "Largo", body: "Frase. ".repeat(2000), cut: "x".repeat(100), office: 42 },
      { ref: "a:6", title: "Basura", body: "Valor undefined y [object Object] y null por aquí." },
    ]);
    expect(rows.map((r) => r.ref)).toEqual(["a:1", "a:5", "a:6"]);
    expect(rows[1].body.length).toBeLessThanOrEqual(BODY_MAX);
    expect(rows[1].cut.length).toBe(60);
    expect(rows[1].office).toBe("42");
    expectClean(rows);
  });
});

/* --- UDES en Cifras ------------------------------------------------------------------ */

const indicator = (patch: Partial<Record<keyof Indicator, unknown>>): Indicator =>
  any<Indicator>({ id: "matricula", label: "Matrícula total", unit: "estudiantes", format: "entero", direction: "sube", definition: "Estudiantes matriculados.", source: "Admisiones", values: {}, ...patch });

function catalog(patch: Partial<OpenDataCatalog> = {}): OpenDataCatalog {
  return {
    period: { label: "2020–2025", startYear: 2020, endYear: 2025 },
    years: [2023, 2024, 2025],
    currentYear: 2025,
    campuses: [
      { id: "todas", name: "Todos los campus" },
      { id: "bucaramanga", name: "Bucaramanga" },
      any({ id: "cucuta", name: 123 }),
      any({ id: null, name: null }),
    ],
    illustrative: false,
    cutoffDate: "2025-12-31",
    reports: [
      any({
        slug: "poblacional",
        name: "Poblacional",
        summary: null,
        description: 2025,
        indicators: [
          indicator({ values: { 0: { todas: 900 }, 2024: { todas: 1000, bucaramanga: 600 }, 2025: { todas: 1100, bucaramanga: 700, cucuta: 400 } } }),
          indicator({ id: "gasto", label: "Presupuesto ejecutado", unit: "millones de pesos", values: { 2025: { todas: 5000 } } }),
          indicator({ id: "costo", label: "Costo por estudiante", unit: "$", values: { 2025: { todas: 12 } } }),
          indicator({ id: "sin-unidad", label: 2024, unit: null, definition: null, source: 7, values: { 2025: { todas: 3 } } }),
          indicator({ id: "roto", label: "Valores rotos", values: undefined }),
          indicator({ id: "texto", label: "Cifra en texto", values: { 2025: { todas: "abc" }, 2024: { todas: "12" } } }),
          indicator({ id: "tasa", label: "Tasa de deserción", unit: "%", format: "porcentaje", values: { 2025: { todas: 9.456 } } }),
          indicator({ id: "", label: "Sin id" }),
        ],
      }),
      any({ slug: "financiero", name: "Presupuesto institucional", summary: "Dinero.", indicators: [] }),
      any({ slug: null, name: "Sin slug", indicators: [] }),
      any({ slug: "vacio", name: "Vacío", summary: "", description: "", indicators: null }),
    ],
    ...patch,
  };
}

describe("cifrasRows", () => {
  it("arma informes e indicadores sin dinero y sin basura", () => {
    const rows = cifrasRows(catalog());
    expectClean(rows);
    const refs = rows.map((r) => r.ref);
    expect(refs).toContain("cifras:poblacional");
    expect(refs).toContain("cifras:poblacional:matricula");
    expect(refs).not.toContain("cifras:poblacional:gasto");
    expect(refs).not.toContain("cifras:poblacional:costo");
    expect(refs.some((r) => r.startsWith("cifras:financiero"))).toBe(false);
    const m = rows.find((r) => r.ref === "cifras:poblacional:matricula")!;
    expect(m.body).toContain("1.100 estudiantes en 2025");
    expect(m.body).toContain("Bucaramanga 700 estudiantes");
    expect(m.body).toContain("En 2024 fue 1.000 estudiantes");
    expect(m.cut).toBe("2025");
    expect(rows.find((r) => r.ref === "cifras:poblacional")!.body).not.toMatch(/Presupuesto|Costo/);
  });

  it("aguanta etiquetas numéricas, unidades nulas, valores rotos y cifras en texto", () => {
    const rows = cifrasRows(catalog());
    const n = rows.find((r) => r.ref === "cifras:poblacional:sin-unidad")!;
    expect(n.title).toBe("2024");
    expect(n.body).toContain("2024: 3 en 2025");
    expect(n.office).toBe("7");
    expect(rows.find((r) => r.ref === "cifras:poblacional:roto")!.body).toContain("sin cifra reportada");
    // "abc" no es cifra; "12" sí.
    const t = rows.find((r) => r.ref === "cifras:poblacional:texto")!;
    expect(t.body).toContain("12 estudiantes en 2024");
    expect(rows.find((r) => r.ref === "cifras:poblacional:tasa")!.body).toContain("9,5 %");
  });

  it("un indicador que se reporta por periodo se cuenta por periodo: el más reciente, sus comparaciones y, después, la cifra del año con su regla", () => {
    const byTerm = indicator({
      annualRule: "ultimo",
      values: { 2024: { todas: 1000 }, 2025: { todas: 1100, bucaramanga: 700 } },
      terms: { 2024: { A: { todas: 900 }, B: { todas: 1000 } }, 2025: { A: { todas: 1100, bucaramanga: 700 } } },
    });
    const rows = cifrasRows(catalog({ reports: [any({ slug: "p", name: "P", indicators: [byTerm] })] }));
    expectClean(rows);
    const m = rows.find((r) => r.ref === "cifras:p:matricula")!;
    expect(m.cut).toBe("2025-1");
    expect(m.body).toContain("Matrícula total: 1.100 estudiantes en 2025-1, el periodo más reciente con cifra, en toda la UDES.");
    expect(m.body).toContain("Por campus en 2025-1: Bucaramanga 700 estudiantes.");
    expect(m.body).toContain("En 2024-2, el periodo anterior, fue 1.000 estudiantes.");
    expect(m.body).toContain("En 2024-1, el mismo periodo del año anterior, fue 900 estudiantes.");
    expect(m.body).toContain("Cifra del año 2025 (último periodo reportado): 1.100 estudiantes.");
  });

  it("marca el catálogo ilustrativo", () => {
    const rows = cifrasRows(catalog({ illustrative: true }));
    expectClean(rows);
    const m = rows.find((r) => r.ref === "cifras:poblacional:matricula")!;
    expect(m.cut).toBe("2025 · ilustrativo");
    expect(m.body).toContain("dato ilustrativo");
    expect(rows.find((r) => r.ref === "cifras:poblacional")!.body).toContain("dato ilustrativo");
  });

  it("sin catálogo o con catálogo deforme no se cae", () => {
    expect(cifrasRows(undefined)).toEqual([]);
    expect(cifrasRows(null)).toEqual([]);
    expect(() => cifrasRows(any({ years: null, campuses: null, reports: [any({ slug: "x", name: "X", indicators: [indicator({})] })] }))).not.toThrow();
  });
});

describe("factRows (cifras en vivo, 0107)", () => {
  it("guarda la serie entera de cada indicador, sin dinero ni el corte de todo el periodo", () => {
    const rows = factRows(catalog());
    const refs = rows.map((r) => r.ref);
    expect(refs).toContain("cifras:poblacional:matricula");
    expect(refs).not.toContain("cifras:poblacional:gasto");
    expect(refs).not.toContain("cifras:poblacional:costo");
    expect(refs).not.toContain("cifras:poblacional:roto");
    const m = rows.find((r) => r.ref === "cifras:poblacional:matricula")!;
    expect(m.series).toEqual([
      { y: 2024, t: null, c: "", v: 1000 },
      { y: 2024, t: null, c: "Bucaramanga", v: 600 },
      { y: 2025, t: null, c: "", v: 1100 },
      { y: 2025, t: null, c: "Bucaramanga", v: 700 },
      { y: 2025, t: null, c: "123", v: 400 },
    ]);
    expect(m).toMatchObject({ report: "Poblacional", label: "Matrícula total", unit: "estudiantes", format: "entero", path: "/datos-abiertos/poblacional", period: "2020–2025", illustrative: false });
    // "abc" no es cifra; "12" sí.
    expect(rows.find((r) => r.ref === "cifras:poblacional:texto")!.series).toEqual([{ y: 2024, t: null, c: "", v: 12 }]);
  });

  it("incluye los periodos 1 y 2", () => {
    const rows = factRows(
      catalog({
        reports: [
          any({
            slug: "p",
            name: "P",
            indicators: [indicator({ values: { 2025: { todas: 30 } }, terms: { 2025: { A: { todas: 10, bucaramanga: 4 }, B: { todas: 20 } } } })],
          }),
        ],
      }),
    );
    expect(rows[0].series).toEqual([
      { y: 2025, t: null, c: "", v: 30 },
      { y: 2025, t: "A", c: "", v: 10 },
      { y: 2025, t: "A", c: "Bucaramanga", v: 4 },
      { y: 2025, t: "B", c: "", v: 20 },
    ]);
  });

  it("la cifra del año lleva su regla (la del portal), para que Pilo diga qué es; los periodos no", () => {
    const terms = { 2024: { A: { todas: 900 }, B: { todas: 1000 } }, 2025: { A: { todas: 1100, bucaramanga: 700 } } };
    const values = { 2024: { todas: 1000 }, 2025: { todas: 1100, bucaramanga: 700 } };
    const rows = (patch: Partial<Record<keyof Indicator, unknown>>) => factRows(catalog({ reports: [any({ slug: "p", name: "P", indicators: [indicator({ values, terms, ...patch })] })] }))[0].series;
    const last = rows({ annualRule: "ultimo", annualFrom: { 2024: { todas: "B" }, 2025: { todas: "A", bucaramanga: "A" } } });
    expect(last.filter((p) => p.t === null)).toEqual([
      { y: 2024, t: null, c: "", v: 1000, k: "p2" },
      { y: 2025, t: null, c: "", v: 1100, k: "p1" },
      { y: 2025, t: null, c: "Bucaramanga", v: 700, k: "p1" },
    ]);
    expect(last.filter((p) => p.t !== null).every((p) => !("k" in p))).toBe(true);
    expect(rows({ annualRule: "suma" }).find((p) => p.t === null)).toMatchObject({ k: "suma" });
    expect(rows({ annualRule: "promedio" }).find((p) => p.t === null)).toMatchObject({ k: "promedio" });
    // Lo que se captura aparte, o un indicador sin regla, no dice de dónde sale: no se inventa.
    expect(rows({ annualRule: "reportado" }).some((p) => "k" in p)).toBe(false);
    expect(rows({}).some((p) => "k" in p)).toBe(false);
  });

  it("sin catálogo o con catálogo deforme no se cae", () => {
    expect(factRows(undefined)).toEqual([]);
    expect(() => factRows(any({ years: null, campuses: null, reports: [any({ slug: "x", name: "X", indicators: [indicator({})] })] }))).not.toThrow();
  });
});

/* --- Boletines ----------------------------------------------------------------------- */

describe("bulletinRows", () => {
  const bundle = {
    bulletins: [
      { id: "b1", slug: "boletin-global", title: "Boletín global", settings: { cut: 2025 } },
      { id: "b2", slug: "boletin-poblacional", title: null, settings: { cut: 0, texts: { coverTitle: 2025, presentation: null, coverOffice: { x: 1 } } } },
      { id: "b3", slug: null, title: "Sin slug", settings: null },
      { id: "b4", slug: "boletin-ejecutivo", title: "Ejecutivo", settings: { cut: "2025", format: "ejecutivo", texts: { presentation: "", coverTitle: "", coverSubtitle: "", presentationTitle: "", backNote: "" } } },
      { id: "b5", slug: "boletin-raro", title: "Raro", settings: { cut: 1999 } },
      { id: null, slug: null, title: "Nada", settings: 5 },
    ],
    editions: [
      { id: "e1", title: "Boletín global", period_label: "2020–2025", cut_label: 2025, note: null, file_path: "ediciones/b1/a.pdf" },
      { id: "e2", title: null, period_label: null, cut_label: null, note: "Nota del presupuesto: 300 millones.", file_path: "ediciones/b1/b.pdf" },
      { id: "e3", title: "Sin archivo", period_label: "2020–2025", file_path: null },
    ],
  };
  const context = { periodLabel: "2020–2025", years: [2023, 2024, 2025] };

  it("sin textos usa los del boletín por defecto; el corte es año o todo el periodo", () => {
    const rows = bulletinRows(bundle, context);
    expectClean(rows);
    const global = rows.find((r) => r.ref === "boletines:boletin-global")!;
    expect(global.cut).toBe("2025");
    expect(global.body).toContain("Informe UDES en Cifras");
    expect(global.body).toContain("2020–2025");
    expect(global.office).toBe("Planeación Institucional");
    const pob = rows.find((r) => r.ref === "boletines:boletin-poblacional")!;
    expect(pob.cut).toBe("2020–2025");
    expect(pob.title).toBe("Boletín UDES en Cifras");
    expect(pob.body.startsWith("2025.")).toBe(true);
    // El nulo en presentación toma el texto por defecto.
    expect(pob.body).toContain("Cada indicador se presenta en su hoja");
    // Sin slug se usa el id.
    expect(rows.some((r) => r.ref === "boletines:b3")).toBe(true);
    // Un corte en texto o fuera del periodo es todo el periodo, como en el portal.
    expect(rows.find((r) => r.ref === "boletines:boletin-ejecutivo")!.cut).toBe("2020–2025");
    expect(rows.find((r) => r.ref === "boletines:boletin-raro")!.cut).toBe("2020–2025");
  });

  it("textos vacíos a propósito dejan la frase de respaldo", () => {
    const rows = bulletinRows(bundle, context);
    expect(rows.find((r) => r.ref === "boletines:boletin-ejecutivo")!.body).toContain("boletín estadístico de UDES en Cifras");
  });

  it("ediciones: sin archivo no entran; la nota con dinero se cae", () => {
    const rows = bulletinRows(bundle, context);
    const e1 = rows.find((r) => r.ref === "boletines:edicion:e1")!;
    expect(e1.cut).toBe("2025");
    expect(e1.path).toContain("ediciones/b1/a.pdf");
    const e2 = rows.find((r) => r.ref === "boletines:edicion:e2")!;
    expect(e2.body).not.toMatch(/millones/);
    expect(rows.some((r) => r.ref === "boletines:edicion:e3")).toBe(false);
  });

  it("sin contexto ni datos no se cae", () => {
    expect(bulletinRows(undefined)).toEqual([]);
    expect(bulletinRows({ bulletins: null, editions: undefined })).toEqual([]);
    const rows = bulletinRows({ bulletins: [{ id: "x", slug: "x", title: "X", settings: { cut: 0 } }] });
    expectClean(rows);
    expect(rows[0].cut).toBe("");
  });
});

/* --- Plan de Desarrollo ---------------------------------------------------------------- */

const pillar = (patch: Partial<Record<keyof PillarWithProgress, unknown>>): PillarWithProgress =>
  any<PillarWithProgress>({
    id: "p1",
    slug: "academia",
    numeral: "1",
    name: "Academia",
    description: "Formación de calidad.",
    focus: "Docencia",
    insight: null,
    impulsor: "",
    contributes: null,
    management_owner: "Vicerrectoría Académica",
    status: "publicado",
    progress: { progress: 42.37 },
    ...patch,
  });

const project = (patch: Partial<Record<keyof ProjectWithLinks, unknown>>): ProjectWithLinks =>
  any<ProjectWithLinks>({ id: "pr1", pillar_id: "p1", name: "Nuevo laboratorio", owner: "Facultad de Ciencias", description: "Dotación.", detail: null, progress: 10, end_date: "2026-12-31", ...patch });

describe("pdiRows", () => {
  const pillars = [
    pillar({}),
    pillar({ id: "p2", slug: "borrador", name: "Pilar en borrador", status: "borrador" }),
    pillar({ id: "p3", slug: "sin-avance", numeral: 3, name: "Sin avance", progress: undefined, description: null, management_owner: null }),
  ];
  const projects = [
    project({}),
    project({ id: "pr2", name: "Presupuesto participativo" }),
    project({ id: "pr3", pillar_id: "p2", name: "Del borrador" }),
    project({ id: "pr4", pillar_id: "p3", name: 2026, owner: null, progress: "45.5", end_date: null, description: { x: 1 } }),
    project({ id: "pr5", pillar_id: "p1", name: "Avance raro", progress: "n/a", end_date: "pronto" }),
    project({ id: "pr6", pillar_id: "zz", name: "Huérfano" }),
  ];

  it("solo lo publicado, sin dinero y sin basura", () => {
    const rows = pdiRows(pillars, projects);
    expectClean(rows);
    const refs = rows.map((r) => r.ref);
    expect(refs).toEqual(["pdi:pilar:academia", "pdi:pilar:sin-avance", "pdi:proyecto:pr1", "pdi:proyecto:pr4", "pdi:proyecto:pr5"]);
    expect(rows[0].body).toContain("42,4 %");
    expect(rows[1].title).toBe("Pilar 3 · Sin avance");
    expect(rows[1].body).toContain("todavía no tiene avance reportado");
    expect(rows[2].body).toContain("Termina el 31 de diciembre de 2026.");
    expect(rows[3].title).toBe("2026");
    expect(rows[3].body).toContain("45,5 %");
    expect(rows[4].body).toContain("todavía no tiene avance reportado");
    expect(rows[4].body).toContain("Termina el pronto.");
  });

  it("sin datos no se cae", () => {
    expect(pdiRows(undefined, undefined)).toEqual([]);
    expect(pdiRows(any([null, pillar({ slug: null })]), any([null]))).toEqual([]);
  });
});

/* --- Observatorio ---------------------------------------------------------------------- */

const topic = OBS_TOPICS[0];

function dataset(patch: Partial<Record<keyof ObsDataset, unknown>>): ObsDataset {
  return any<ObsDataset>({
    id: "d1",
    topic: topic.slug,
    title: "Estudiantes por campus",
    description: null,
    source: "Registro Académico",
    dataType: "conteo",
    temporality: "anual",
    periodLabel: 2025,
    columns: [
      { key: "campus", label: "Campus", kind: "texto" },
      { key: "n", label: "Estudiantes", kind: "cifra", format: "entero", unit: "estudiantes" },
      { key: "valor", label: "Matrícula en pesos", kind: "cifra", format: "entero", unit: "pesos" },
    ],
    rows: [
      { year: 2025, kind: "dato", label: "", cells: { campus: "Bucaramanga", n: 7000, valor: 9000000 } },
      { year: 2025, kind: "dato", label: null, cells: { campus: { raro: true }, n: 1234.567, valor: 1 } },
      { year: null, kind: "grupo", label: "Grupo", cells: {} },
      { year: 2025, kind: "total", label: "Total", cells: null },
      null,
      { year: 2025, kind: "dato", label: "", cells: { campus: null, n: "< 5" } },
    ],
    anonymization: null,
    sample: false,
    status: "publicado",
    position: 0,
    updatedAt: "2025-10-01T10:00:00Z",
    ...patch,
  });
}

const view = (datasetId: string, patch: Partial<ObsView> = {}): ObsView =>
  any<ObsView>({ id: `${datasetId}-v`, datasetId, topic: topic.slug, key: "v1", title: "Estudiantes", type: "barras", category: "campus", series: ["n"], section: "panorama", size: "media", visible: true, position: 0, ...patch });

function live(datasets: ObsDataset[], views: ObsView[]): Map<string, LiveTopic> {
  return new Map([[topic.slug, any<LiveTopic>({ config: {}, datasets: new Map(datasets.map((d) => [d.id, d])), views, sources: [], updatedAt: "" })]]);
}

describe("observatoryRows", () => {
  it("arma el tema y sus tablas sin columnas de dinero ni objetos", () => {
    const rows = observatoryRows(live([dataset({}), dataset({ id: "d2", title: "Ejemplo", sample: true })], [view("d1"), view("d2")]));
    expectClean(rows);
    expect(rows.map((r) => r.ref)).toEqual([`observatorio:${topic.slug}`, `observatorio:${topic.slug}:d1`]);
    const table = rows[1];
    expect(table.body).toContain("Columnas: Campus, Estudiantes.");
    expect(table.body).toContain("2025 | Bucaramanga | 7.000");
    expect(table.body).toContain("1.234,57");
    expect(table.body).toContain("< 5");
    expect(table.body).not.toMatch(/pesos|9\.000\.000|Grupo/);
    expect(table.cut).toBe("2025");
    expect(rows[0].cut).toBe("2025-10-01");
    expect(rows[0].body).toContain("Fuentes: Registro Académico.");
  });

  it("un tema con solo tablas de ejemplo no entra", () => {
    expect(observatoryRows(live([dataset({ sample: true })], [view("d1")]))).toEqual([]);
  });

  it("sin datos, con Map vacío o con tablas deformes no se cae", () => {
    expect(observatoryRows(undefined)).toEqual([]);
    expect(observatoryRows(new Map())).toEqual([]);
    const rows = observatoryRows(live([dataset({ columns: null, rows: "x", title: 12, updatedAt: null, source: null })], [view("d1", { series: undefined, category: undefined })]));
    expectClean(rows);
    expect(rows[0].cut).toBe("");
  });
});

/* --- Portal de Impacto ----------------------------------------------------------------- */

describe("impactRows", () => {
  const data = toPortalData({
    indicators: [
      { id: "i1", code: "INV-01", fn: "investigacion", stage: "resultado", name: "Artículos publicados", description: null, unit_label: "artículos", target_2026: 120, target_2026_num: 120, source: "Vicerrectoría de Investigación", responsible: null },
      { id: "i2", code: "EXT-02", fn: "extension", stage: "resultado", name: "Recursos de extensión", description: "Ingresos por servicios.", unit_label: "millones de pesos", target_2026: "$ 500" },
      { id: "i3", code: null, fn: "ensenanza", stage: "insumo", name: "Docentes con doctorado", description: "Docentes de planta con doctorado.", unit_label: "%", target_2026: "30" },
      { id: "i4", code: "X", name: null },
    ],
    units: [
      { id: "f1", kind: "facultad", name: "Ingenierías", slug: "ingenierias" },
      { id: "u1", parent_id: "f1", kind: "programa", name: "Ingeniería de Sistemas", slug: "ingenieria-de-sistemas" },
      { id: "u2", parent_id: "f1", kind: "programa", name: "Sin slug", slug: null },
    ],
    campuses: [{ id: "c1", slug: "bucaramanga", name: "Bucaramanga" }],
    offer: [{ program_id: "u1", campus_id: "c1" }, { program_id: "u2", campus_id: "c1" }],
    adoptions: [
      { indicator_id: "i1", program_id: "u1", campus_id: "c1", target_2026_num: 10 },
      { indicator_id: "i2", program_id: "u1", campus_id: "c1", target_2026_num: 500 },
      { indicator_id: "i3", program_id: "u2", campus_id: "c1", target_2026_num: 30 },
    ],
    values: [
      { indicator_id: "i1", year: 2025, program_id: "u1", campus_id: "c1", value_num: 5 },
      { indicator_id: "i2", year: 2025, program_id: "u1", campus_id: "c1", value_num: 100 },
    ],
  });

  it("notas y fichas sin indicadores de dinero", () => {
    const rows = impactRows(data);
    expectClean(rows);
    const refs = rows.map((r) => r.ref);
    expect(refs).toContain("impacto:metas");
    expect(refs).toContain("impacto:indicador:i1");
    expect(refs).toContain("impacto:indicador:i3");
    expect(refs).not.toContain("impacto:indicador:i2");
    expect(refs).not.toContain("impacto:indicador:i4");
    expect(refs).toContain("impacto:programa:ingenieria-de-sistemas");
    // Sin slug: la referencia usa el id, no queda «impacto:programa:».
    expect(refs).toContain("impacto:programa:u2");
    expect(rows.every((r) => !/Recursos de extensión/i.test(r.body))).toBe(true);
    const i1 = rows.find((r) => r.ref === "impacto:indicador:i1")!;
    expect(i1.body).toContain("Meta 2026: 120 artículos.");
    expect(rows.find((r) => r.ref === "impacto:indicador:i3")!.title).toBe("Docentes con doctorado");
  });

  it("un portal vacío o deforme no se cae", () => {
    expect(impactRows(undefined)).toEqual([]);
    expect(() => impactRows(toPortalData({}))).not.toThrow();
    expectClean(impactRows(toPortalData({})));
    expect(() => impactRows(any({ indicators: null, units: [{ kind: "programa", id: "u", name: "P", slug: "p" }] }))).not.toThrow();
  });
});

/* --- Armar todo ------------------------------------------------------------------------ */

describe("buildSources", () => {
  const row: MemoryRow = { ref: "pdi:pilar:x", title: "X", section: "", body: "Un cuerpo suficiente.", path: "/", cut: "", office: "" };

  it("una fuente que falla no detiene a las demás y la vacía no se envía", () => {
    const out = buildSources({
      cifras: () => {
        throw new TypeError('(s ?? "").replace is not a function');
      },
      boletines: () => [],
      pdi: () => [row],
      observatorio: () => {
        throw new Error("No se pudo leer el Observatorio.");
      },
      impacto: () => [{ ...row, ref: "impacto:metas" }],
    });
    expect(Object.keys(out.rows).sort()).toEqual(["impacto", "pdi"]);
    expect(out.rows.cifras).toBeUndefined();
    expect(out.rows.boletines).toBeUndefined();
    const bySource = Object.fromEntries(out.problems.map((p) => [p.source, p]));
    expect(bySource.cifras.kind).toBe("error");
    expect(bySource.cifras.message).toMatch(/forma inesperada/);
    expect(bySource.boletines.kind).toBe("vacia");
    expect(bySource.observatorio.message).toBe("No se pudo leer el Observatorio.");
  });

  it("una fuente demasiado grande no se envía", () => {
    const many = Array.from({ length: 5001 }, (_, i) => ({ ...row, ref: `pdi:x:${i}` }));
    const out = buildSources({ cifras: () => [row], boletines: () => [row], pdi: () => many, observatorio: () => [row], impacto: () => [row] });
    expect(out.rows.pdi).toBeUndefined();
    expect(out.problems[0]).toMatchObject({ source: "pdi", kind: "error" });
  });

  it("problemMessage da algo legible con cualquier error", () => {
    expect(problemMessage(null)).toBe("Falló sin decir por qué.");
    expect(problemMessage("La sesión caducó.")).toBe("La sesión caducó.");
    expect(problemMessage(new TypeError("Cannot read properties of null"))).toMatch(/forma inesperada/);
  });
});
