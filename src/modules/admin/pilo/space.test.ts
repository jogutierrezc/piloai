/* =============================================================================
   Los espacios de Mr. Pilo en la intranet (0113).

   Lo que estas pruebas vigilan:
   - «Mr. Pilo con IA» sigue pidiendo lo de «planeacion» y NO manda ningún
     parámetro nuevo a las RPC ni a la función: funciona igual sin 0113.
   - Las lecturas de tablas siempre filtran por espacio; sin la columna, solo
     el Pilo de siempre repite sin filtro.
   - Otro espacio manda su nombre en todo y nunca lee sin filtro.
   - Las claves del catálogo llevan el prefijo de su espacio.
   ========================================================================== */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Recorded {
  table: string;
  ops: [string, ...unknown[]][];
}

const fake = vi.hoisted(() => {
  const state = {
    reads: [] as { table: string; ops: [string, ...unknown[]][] }[],
    invokes: [] as { name: string; body: Record<string, unknown> }[],
    rpcs: [] as { name: string; args: Record<string, unknown> }[],
    respond: (_read: { table: string; ops: [string, ...unknown[]][] }): { data: unknown; error: { code?: string; message?: string } | null; count?: number } => ({ data: [], error: null, count: 0 }),
  };
  const from = (table: string) => {
    const read = { table, ops: [] as [string, ...unknown[]][] };
    state.reads.push(read);
    const builder: Record<string, unknown> = new Proxy(
      {},
      {
        get(_target, name: string) {
          if (name === "then") return (resolve: (v: unknown) => unknown) => Promise.resolve(state.respond(read)).then(resolve);
          return (...args: unknown[]) => {
            read.ops.push([name, ...args]);
            return builder;
          };
        },
      },
    );
    return builder;
  };
  const supabase = {
    from,
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcs.push({ name, args });
      return { data: [], error: null };
    },
    functions: {
      invoke: async (name: string, options: { body: Record<string, unknown> }) => {
        state.invokes.push({ name, body: options.body });
        return { data: { status: { model: "m", memory_total: 2, memory_done: 2 }, hits: [], saved: 0 }, error: null };
      },
    },
  };
  return { state, supabase };
});

vi.mock("../../../lib/supabase", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  supabase: fake.supabase,
}));

import { CATALOG_PREFIX, keyFitsSpace, missingSpaceColumn, nextCatalogKey, readInSpace, spaceArgs, spaceBody, spaceKey } from "./space";
import { fetchInbox } from "./inbox";
import { fetchSavedAnswers, indexStep } from "./memory";
import { fetchPiloLog } from "./store";
import { fetchCatalog, importSummary, sheetOptions } from "./CatalogCard";
import { columnsFor, parseCatalogTable, parseRolCell } from "./catalog-sheet";

const spaceFilter = (read: Recorded) => read.ops.find(([op, column]) => op === "eq" && column === "space");
const selected = (read: Recorded) => String(read.ops.find(([op]) => op === "select")?.[1] ?? "");

beforeEach(() => {
  fake.state.reads.length = 0;
  fake.state.invokes.length = 0;
  fake.state.rpcs.length = 0;
  fake.state.respond = () => ({ data: [], error: null, count: 0 });
});

describe("el espacio de partida no manda nada nuevo", () => {
  it("ni a las RPC, ni a la función, ni a las llaves de caché", () => {
    expect(spaceArgs()).toEqual({});
    expect(spaceArgs("planeacion")).toEqual({});
    expect(spaceBody("planeacion")).toEqual({});
    expect(spaceKey("planeacion")).toEqual([]);
    // Con el operador de propagación, la llamada queda idéntica a la de antes de 0113.
    expect({ p_kind: "respuesta", p_rows: [], p_replace: false, ...spaceArgs("planeacion") }).toEqual({ p_kind: "respuesta", p_rows: [], p_replace: false });
  });

  it("otro espacio sí va en todo", () => {
    expect(spaceArgs("ensenanza")).toEqual({ p_space: "ensenanza" });
    expect(spaceBody("ensenanza")).toEqual({ space: "ensenanza" });
    expect(spaceKey("ensenanza")).toEqual(["ensenanza"]);
  });

  it("«indexar» viaja sin `space` para Planeación y con él para Enseñanza", async () => {
    await indexStep({ step: "estado" });
    await indexStep({ step: "lote" }, "ensenanza");
    expect(fake.state.invokes[0]).toEqual({ name: "pilo-ia", body: { action: "indexar", step: "estado" } });
    expect(fake.state.invokes[1]).toEqual({ name: "pilo-ia", body: { action: "indexar", step: "lote", space: "ensenanza" } });
  });
});

describe("las lecturas de «Mr. Pilo con IA» piden lo de planeacion", () => {
  it("bandeja, respuestas guardadas, bitácora y catálogo filtran por su espacio", async () => {
    await fetchInbox();
    await fetchSavedAnswers();
    await fetchPiloLog();
    await fetchCatalog();
    expect(fake.state.reads.map((r) => r.table)).toEqual(["pilo_inbox", "pilo_answers", "pilo_ai_log", "pilo_catalog"]);
    for (const read of fake.state.reads) expect(spaceFilter(read)).toEqual(["eq", "space", "planeacion"]);
  });

  it("no pide la columna `rol`, que solo existe con 0113", async () => {
    await fetchInbox();
    await fetchSavedAnswers();
    expect(selected(fake.state.reads[0])).not.toMatch(/\brol\b/);
    expect(selected(fake.state.reads[1])).not.toMatch(/\brol\b/);
  });

  it("sin 0113 (la columna no existe) repite sin filtro y devuelve lo de siempre", async () => {
    fake.state.respond = (read) =>
      spaceFilter(read as Recorded)
        ? { data: null, error: { code: "42703", message: "column pilo_ai_log.space does not exist" } }
        : { data: [{ id: 1, portal: "cifras", action: "resumir" }], error: null };
    const rows = await fetchPiloLog();
    expect(rows).toHaveLength(1);
    expect(fake.state.reads).toHaveLength(2);
    expect(spaceFilter(fake.state.reads[1])).toBeUndefined();
  });

  it("otro error no se confunde con «falta la columna»: no repite", async () => {
    fake.state.respond = () => ({ data: null, error: { code: "42501", message: "permission denied" } });
    expect(await fetchPiloLog()).toEqual([]);
    expect(fake.state.reads).toHaveLength(1);
  });
});

describe("las lecturas de otro espacio nunca salen sin filtro", () => {
  it("filtran por «ensenanza» y piden el rol", async () => {
    await fetchInbox(12, "ensenanza");
    await fetchSavedAnswers("ensenanza");
    await fetchPiloLog("ensenanza");
    await fetchCatalog("ensenanza");
    for (const read of fake.state.reads) expect(spaceFilter(read)).toEqual(["eq", "space", "ensenanza"]);
    expect(selected(fake.state.reads[0])).toMatch(/\brol\b/);
    expect(selected(fake.state.reads[1])).toMatch(/\brol\b/);
  });

  it("sin 0113 se queda sin nada: no repite sin filtro (traería lo de Planeación)", async () => {
    fake.state.respond = () => ({ data: null, error: { code: "42703", message: "column pilo_catalog.space does not exist" } });
    expect(await fetchCatalog("ensenanza")).toBeNull();
    expect(await fetchInbox(12, "ensenanza")).toBeNull();
    expect(await fetchSavedAnswers("ensenanza")).toBeNull();
    expect(await fetchPiloLog("ensenanza")).toEqual([]);
    expect(fake.state.reads).toHaveLength(4);
  });

  it("readInSpace solo repite para el espacio de partida", async () => {
    const run = vi.fn(async (scoped: boolean) => ({ data: scoped ? null : "todo", error: scoped ? { code: "42703" } : null }));
    expect((await readInSpace("planeacion", run)).data).toBe("todo");
    expect(run.mock.calls.map((c) => c[0])).toEqual([true, false]);
    run.mockClear();
    expect((await readInSpace("ensenanza", run)).data).toBeNull();
    expect(run.mock.calls.map((c) => c[0])).toEqual([true]);
  });

  it("reconoce «falta la columna» por código o por mensaje", () => {
    expect(missingSpaceColumn({ code: "42703" })).toBe(true);
    expect(missingSpaceColumn({ message: "column pilo_inbox.space does not exist" })).toBe(true);
    expect(missingSpaceColumn({ code: "PGRST205", message: "Could not find the table" })).toBe(false);
    expect(missingSpaceColumn(null)).toBe(false);
  });
});

describe("las claves del catálogo, por espacio", () => {
  it("cada espacio tiene sus prefijos", () => {
    expect(CATALOG_PREFIX.planeacion).toEqual({ respuesta: "R", capciosa: "C" });
    expect(CATALOG_PREFIX.ensenanza).toEqual({ respuesta: "ER", capciosa: "EC" });
  });

  it("la siguiente clave sale de las de su prefijo, sin mirar las del otro Pilo", () => {
    const keys = ["R-001", "R-007", "C-002", "ER-003", "EC-010"];
    expect(nextCatalogKey("planeacion", "respuesta", keys)).toBe("R-008");
    expect(nextCatalogKey("planeacion", "capciosa", keys)).toBe("C-003");
    expect(nextCatalogKey("ensenanza", "respuesta", keys)).toBe("ER-004");
    expect(nextCatalogKey("ensenanza", "capciosa", keys)).toBe("EC-011");
    expect(nextCatalogKey("ensenanza", "respuesta", [])).toBe("ER-001");
    // «ER-003» no cuenta como una R de Planeación.
    expect(nextCatalogKey("planeacion", "respuesta", ["ER-900"])).toBe("R-001");
  });

  it("Enseñanza exige su prefijo; Planeación acepta cualquiera, como siempre", () => {
    expect(keyFitsSpace("ensenanza", "respuesta", "ER-001")).toBe(true);
    expect(keyFitsSpace("ensenanza", "respuesta", "R-001")).toBe(false);
    expect(keyFitsSpace("ensenanza", "capciosa", "ER-001")).toBe(false);
    expect(keyFitsSpace("planeacion", "respuesta", "LO-QUE-SEA")).toBe(true);
  });

  it("el Excel de Planeación no cambia; el de Enseñanza gana «Para quién» y su prefijo", () => {
    expect(sheetOptions()).toEqual({});
    expect(columnsFor("respuesta").map((c) => c.id)).not.toContain("rol");
    const opts = sheetOptions("ensenanza");
    expect(opts).toMatchObject({ prefix: { respuesta: "ER", capciosa: "EC" }, rol: true });
    const ids = columnsFor("respuesta", opts).map((c) => c.id);
    expect(ids.indexOf("rol")).toBe(ids.indexOf("active") - 1);
  });

  it("al leer un libro de Enseñanza: rol por fila, clave generada con ER- y rechazo de la que no lo lleva", () => {
    const table = [
      ["Clave", "Pregunta", "Respuesta", "Para quién", "Activa"],
      ["ER-001", "¿Qué es la evaluación formativa?", "Es la que acompaña el aprendizaje.", "Profesores", "SI"],
      ["", "¿Cómo pido una revisión de nota?", "Con la solicitud ante su programa.", "estudiante", ""],
      ["R-009", "¿Qué es el PDI?", "El plan de desarrollo.", "", ""],
      ["ER-004", "¿Y esto?", "Una respuesta cualquiera.", "egresados", ""],
    ];
    const r = parseCatalogTable("respuesta", { Respuestas: table }, sheetOptions("ensenanza"));
    expect(r.valid.map((v) => [v.key, v.rol])).toEqual([
      ["ER-001", "profesor"],
      ["ER-002", "estudiante"],
    ]);
    const errors = r.rows.flatMap((x) => x.errors).join(" | ");
    expect(errors).toMatch(/«R-009» debe empezar por ER-/);
    expect(errors).toMatch(/Para quién.*todos, estudiante o profesor/);
  });

  it("al leer un libro de Planeación, igual que antes: sin rol y con R-", () => {
    const table = [
      ["Clave", "Pregunta", "Respuesta"],
      ["", "¿Qué es el PDI?", "El plan de desarrollo."],
      ["LIBRE-1", "¿Dónde están las cifras?", "En UDES en Cifras."],
    ];
    const r = parseCatalogTable("respuesta", { Respuestas: table });
    expect(r.valid.map((v) => v.key)).toEqual(["R-001", "LIBRE-1"]);
    expect(r.valid[0]).not.toHaveProperty("rol");
  });

  it("«todos», vacío, plurales y «docente» se entienden; lo demás no", () => {
    expect(parseRolCell("")).toBe("");
    expect(parseRolCell("Todos")).toBe("");
    expect(parseRolCell("Estudiantes")).toBe("estudiante");
    expect(parseRolCell("docente")).toBe("profesor");
    expect(parseRolCell("egresado")).toBeNull();
  });

  it("al importar, dice cuántas claves eran del otro Pilo y no se tocaron", () => {
    expect(importSummary({ added: 2, updated: 1, removed: 0, total: 9 })).toBe("Listo: 2 nuevas, 1 actualizadas. Hay 9 en total.");
    expect(importSummary({ added: 1, updated: 0, removed: 0, total: 3, rejected: 2, rejected_keys: ["R-001", "R-002"] })).toMatch(/2 claves ya son del otro Mr\. Pilo y no se tocaron: R-001, R-002\./);
  });
});
