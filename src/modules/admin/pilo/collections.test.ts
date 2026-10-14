import { describe, expect, it } from "vitest";
import { cleanName, collectionFault, collectionId, collectionsReady, customOf, deleteBlock, nameProblem } from "./collections";
import { docCollections, parsePortals, unifyChanges } from "./portals";
import type { PiloSource } from "./portals";

const src = (over: Partial<PiloSource> & { id: string }): PiloSource => ({ scope: "ensenanza", name: over.id, kind: "documentos", staff_only: false, stays_home: false, sort: 1, ...over });

const SOURCES: PiloSource[] = [
  src({ id: "politicas", name: "Políticas institucionales", custom: false }),
  src({ id: "normativa", name: "Normativa", scope: "planeacion", custom: false }),
  src({ id: "reglamentoscacg", name: "Reglamentos 2026", custom: true }),
  src({ id: "moodle", name: "Cursos de Moodle", kind: "moodle", stays_home: true, custom: false }),
];

describe("el nombre y el id de una colección", () => {
  it("limpia espacios y pone tope", () => {
    expect(cleanName("  Guías   de  Laboratorio ")).toBe("Guías de Laboratorio");
    expect(cleanName("x".repeat(200))).toHaveLength(80);
  });

  it("el id es el de la base: sin tildes, solo letras y los dígitos pasan a letras", () => {
    expect(collectionId("Guías de Laboratorio")).toBe("guiasdelaboratorio");
    expect(collectionId("Reglamentos 2026")).toBe("reglamentoscacg");
    expect(collectionId("Año Ñandú")).toBe("anonandu");
    expect(collectionId("a".repeat(50))).toHaveLength(30);
    expect(collectionId("Reglamentos 2026")).toMatch(/^[a-z]{3,30}$/);
  });
});

describe("nameProblem", () => {
  it("acepta un nombre nuevo", () => {
    expect(nameProblem("Guías de laboratorio", "ensenanza", SOURCES)).toBeNull();
  });

  it("rechaza lo muy corto, lo reservado y lo repetido en el mismo Pilo", () => {
    expect(nameProblem("ab", "ensenanza", SOURCES)).toMatch(/tres letras/);
    expect(nameProblem("¡¡!!", "ensenanza", SOURCES)).toMatch(/tres letras/);
    expect(nameProblem("Mapa", "ensenanza", SOURCES)).toMatch(/reservado/);
    expect(nameProblem("reglamentos 2026", "ensenanza", SOURCES)).toMatch(/Ya existe «Reglamentos 2026»/);
    expect(nameProblem("Politicas", "ensenanza", SOURCES)).toMatch(/Ya existe/);
  });

  it("el mismo nombre en el otro Pilo no choca, y al renombrar no choca consigo misma", () => {
    expect(nameProblem("Normativa", "ensenanza", SOURCES)).toBeNull();
    expect(nameProblem("Reglamentos 2026", "ensenanza", SOURCES, "reglamentoscacg")).toBeNull();
  });
});

describe("el catálogo", () => {
  it("las propias de un Pilo son solo las de documentos con custom", () => {
    expect(customOf(SOURCES, "ensenanza").map((s) => s.id)).toEqual(["reglamentoscacg"]);
    expect(customOf(SOURCES, "planeacion")).toEqual([]);
  });

  it("docCollections las marca y deja fuera a Moodle", () => {
    expect(docCollections(SOURCES, "ensenanza")).toEqual([
      { id: "politicas", code: "PO", name: "Políticas institucionales", custom: false },
      { id: "reglamentoscacg", code: "RE", name: "Reglamentos 2026", custom: true },
    ]);
  });

  it("reconoce las fuentes del catálogo y no las ofrece como colecciones de documentos", () => {
    const data = parsePortals([], [
      { id: "respuestasplan", scope: "planeacion", name: "Respuestas oficiales de Planeación", kind: "catalogo", sort: 9, custom: false },
      { id: "normativa", scope: "planeacion", name: "Normativa", kind: "documentos", sort: 7, custom: false },
    ]);
    expect(data.sources.find((s) => s.id === "respuestasplan")?.kind).toBe("catalogo");
    expect(docCollections(data.sources, "planeacion").map((c) => c.id)).toEqual(["normativa"]);
  });

  it("sin la columna custom (base sin 0125) no hay gestión de colecciones", () => {
    const old = parsePortals([], [{ id: "politicas", scope: "ensenanza", name: "P", kind: "documentos", sort: 1 }]);
    expect(old.sources[0].custom).toBeUndefined();
    expect(collectionsReady(old.sources)).toBe(false);
    const now = parsePortals([], [{ id: "politicas", scope: "ensenanza", name: "P", kind: "documentos", sort: 1, custom: false }]);
    expect(collectionsReady(now.sources)).toBe(true);
    expect(collectionsReady(undefined)).toBe(false);
    expect(collectionsReady([])).toBe(false);
  });
});

describe("borrar y fallar", () => {
  it("una colección con documentos no se borra y dice cuántos", () => {
    expect(deleteBlock(0)).toBeNull();
    expect(deleteBlock(1)).toMatch(/1 documento:/);
    expect(deleteBlock(1200)).toMatch(/1\.200 documentos/);
  });

  it("los errores de la base se leen en palabras de la pantalla", () => {
    expect(collectionFault({ code: "PGRST202", message: "Could not find the function public.pilo_collection_create" })).toMatch(/migración 0125/);
    expect(collectionFault({ code: "42501", message: "Solo la administración crea colecciones de Pilo." })).toMatch(/Solo la administración/);
    expect(collectionFault({ code: "23505", message: "Ya existe una colección con ese nombre." })).toBe("Ya existe una colección con ese nombre.");
    expect(collectionFault(null)).toBe("No se pudo.");
  });
});

describe("una sola memoria", () => {
  const data = parsePortals(
    [
      { id: "planeacion", scope: "planeacion", name: "Pilo de la Universidad", matrix: { cifras: "casa", politicas: "no" } },
      { id: "ensenanza", scope: "ensenanza", name: "Pilo en Enseñanza", matrix: { politicas: "casa", cifras: "visita" } },
    ],
    [
      { id: "cifras", scope: "planeacion", name: "UDES en Cifras", kind: "portal", sort: 1 },
      { id: "impacto", scope: "planeacion", name: "Impacto", kind: "portal", staff_only: true, sort: 2 },
      { id: "politicas", scope: "ensenanza", name: "Políticas", kind: "documentos", sort: 3 },
      { id: "moodle", scope: "ensenanza", name: "Moodle", kind: "moodle", stays_home: true, sort: 4 },
    ],
  );

  it("pasa a «visita» lo ajeno que puede salir de su casa, y no toca lo propio ni Moodle", () => {
    const changes = unifyChanges(data, "visita");
    expect(changes.map((c) => [c.portal.id, c.cells])).toEqual([
      ["ensenanza", { impacto: "visita" }],
      ["planeacion", { politicas: "visita" }],
    ]);
  });

  it("separarlas devuelve a «no» solo lo que hoy dice «visita»", () => {
    expect(unifyChanges(data, "no").map((c) => [c.portal.id, c.cells])).toEqual([["ensenanza", { cifras: "no" }]]);
  });

  it("si ya está todo unido, no hay nada que cambiar", () => {
    const joined = parsePortals(
      [
        { id: "planeacion", scope: "planeacion", matrix: { politicas: "visita" } },
        { id: "ensenanza", scope: "ensenanza", matrix: { cifras: "visita", impacto: "visita" } },
      ],
      [
        { id: "cifras", scope: "planeacion", name: "C", kind: "portal", sort: 1 },
        { id: "impacto", scope: "planeacion", name: "I", kind: "portal", sort: 2 },
        { id: "politicas", scope: "ensenanza", name: "P", kind: "documentos", sort: 3 },
      ],
    );
    expect(unifyChanges(joined, "visita")).toEqual([]);
  });
});