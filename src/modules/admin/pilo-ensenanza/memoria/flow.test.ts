import { describe, expect, it } from "vitest";
import {
  MAX_ROUNDS,
  STEP_ORDER,
  StepError,
  checkMoodleUrl,
  comprehendNext,
  comprehendShare,
  currentReading,
  docPath,
  faultFrom,
  faultLine,
  faultOf,
  missingMigration,
  moodleSiteId,
  readingReducer,
  resumePoint,
  runFrom,
  safeFileName,
  stagesOf,
  tidyDetail,
  titleFromFile,
} from "./flow";
import type { StepId } from "./flow";

const states = (doc: Parameters<typeof stagesOf>[0], job?: Parameters<typeof stagesOf>[1]) => stagesOf(doc, job).map((s) => s.state);

describe("el recorrido de un documento, paso a paso", () => {
  it("corre los pasos en orden desde donde se le pide y salta los que no tienen acción", async () => {
    const seen: StepId[] = [];
    const said: string[] = [];
    const act = (s: StepId) => async () => void seen.push(s);
    const out = await runFrom("subir", { leer: act("leer"), subir: act("subir"), pasajes: act("pasajes"), vectores: act("vectores") }, (step, i, total) => said.push(`${step} ${i + 1}/${total}`));
    expect(out).toEqual({ ok: true });
    expect(seen).toEqual(["subir", "pasajes", "vectores"]);
    expect(said).toEqual(["subir 1/3", "pasajes 2/3", "vectores 3/3"]);
  });

  it("el primer paso que falla detiene el recorrido y dice cuál fue; lo anterior queda hecho", async () => {
    const seen: StepId[] = [];
    const boom = new Error("sin conexión");
    const out = await runFrom("subir", {
      subir: async () => void seen.push("subir"),
      ficha: async () => void seen.push("ficha"),
      pasajes: async () => {
        throw boom;
      },
      mapa: async () => void seen.push("mapa"),
    });
    expect(out).toEqual({ ok: false, step: "pasajes", error: boom });
    expect(seen).toEqual(["subir", "ficha"]);
  });

  it("reintentar desde el paso que falló no repite los anteriores", async () => {
    const seen: StepId[] = [];
    const actions = Object.fromEntries(STEP_ORDER.map((s) => [s, async () => void seen.push(s)])) as Record<StepId, () => Promise<void>>;
    await runFrom("mapa", actions);
    expect(seen).toEqual(["mapa", "vectores"]);
  });
});

describe("las etapas que se ven: leído → en pasajes → entendido → en el mapa", () => {
  it("sale de la ficha: sin IA un documento llega al mapa y «entendido» queda pendiente", () => {
    expect(states({ status: "leido", passages: 0 })).toEqual(["done", "todo", "todo", "todo"]);
    expect(states({ status: "en_pasajes", passages: 12 })).toEqual(["done", "done", "todo", "todo"]);
    expect(states({ status: "en_mapa", passages: 12 })).toEqual(["done", "done", "todo", "done"]);
    expect(states({ status: "entendido", passages: 12, understood_at: "2026-10-01" })).toEqual(["done", "done", "done", "done"]);
  });

  it("un PDF escaneado no cumple ninguna etapa", () => {
    expect(states({ status: "escaneado", passages: 0 })).toEqual(["todo", "todo", "todo", "todo"]);
  });

  it("lo que corre o falla ahora se ve en su etapa, sin deshacer lo ya cumplido", () => {
    expect(states(null, { step: "subir", state: "run" })).toEqual(["run", "todo", "todo", "todo"]);
    expect(states({ status: "leido", passages: 0 }, { step: "pasajes", state: "fail" })).toEqual(["done", "fail", "todo", "todo"]);
    expect(states({ status: "en_pasajes", passages: 4 }, { step: "mapa", state: "run" })).toEqual(["done", "done", "todo", "run"]);
    // Los vectores no tienen etapa propia: si fallan, el documento sigue «en el mapa».
    expect(states({ status: "en_mapa", passages: 4 }, { step: "vectores", state: "fail" })).toEqual(["done", "done", "todo", "done"]);
  });

  it("cada etapa lleva su nombre, no solo un color", () => {
    expect(stagesOf(null).map((s) => s.label)).toEqual(["Leído", "En pasajes", "Entendido", "En el mapa"]);
  });
});

describe("desde dónde se retoma un documento que quedó a medias", () => {
  const file = { origin: "archivo", file_path: "ensenanza/x/a.pdf" };
  it("sin pasajes vuelve a los pasajes; con pasajes y sin mapa, al mapa", () => {
    expect(resumePoint({ ...file, status: "leido", passages: 0 })).toBe("pasajes");
    expect(resumePoint({ ...file, status: "error", passages: 0 })).toBe("pasajes");
    expect(resumePoint({ ...file, status: "en_pasajes", passages: 9 })).toBe("mapa");
    expect(resumePoint({ ...file, status: "error", passages: 9 })).toBe("mapa");
  });
  it("lo terminado y lo escaneado no se retoman; un curso sin pasajes se vuelve a leer desde Moodle", () => {
    expect(resumePoint({ ...file, status: "en_mapa", passages: 9 })).toBeNull();
    expect(resumePoint({ ...file, status: "entendido", passages: 9 })).toBeNull();
    expect(resumePoint({ ...file, status: "escaneado", passages: 0 })).toBeNull();
    expect(resumePoint({ origin: "moodle", file_path: "", status: "leido", passages: 0 })).toBeNull();
  });
});

describe("los errores de la función, dichos en claro", () => {
  it("el código del cuerpo manda, con su consejo y si vale reintentar", () => {
    const cases: [number, string, boolean][] = [
      [400, "config", false],
      [400, "apagado", false],
      [404, "moodle", true],
      [502, "token", false],
      [502, "moodle", true],
      [502, "red", true],
      [504, "tiempo", true],
      [500, "migracion", false],
      [500, "interno", true],
    ];
    for (const [status, code, retry] of cases) {
      const f = faultFrom(status, { error: "Texto del servidor.", code });
      expect(f.code).toBe(code);
      expect(f.retry).toBe(retry);
      expect(f.title).not.toBe("");
      expect(f.hint).not.toBe("");
      expect(f.detail).toBe("Texto del servidor.");
    }
  });

  it("sin código se deduce del estado; sin respuesta es la red", () => {
    expect(faultFrom(0).code).toBe("red");
    expect(faultFrom(403, { error: "Solo la administración conecta a Pilo con Moodle." }).code).toBe("permiso");
    expect(faultFrom(400, { error: "Paso desconocido." }).code).toBe("pedido");
    expect(faultFrom(504).code).toBe("tiempo");
    expect(faultFrom(500, { error: "x", code: "raro" }).code).toBe("interno");
  });

  it("el consejo del servidor viaja pegado a su error, y la frase completa dice qué hacer", () => {
    const f = faultFrom(500, { error: "Falta la migración 0116.", advice: "Aplíquela en Supabase.", code: "migracion" });
    expect(f.detail).toBe("Falta la migración 0116. Aplíquela en Supabase.");
    expect(faultLine(f)).toContain("Falta la migración 0116.");
    expect(faultLine(f)).toContain(f.hint);
  });

  it("nunca muestra algo con forma de token", () => {
    expect(tidyDetail("falló wstoken=abcdef0123456789abcdef0123456789&x=1")).toBe("falló wstoken=…&x=1");
    expect(tidyDetail("clave 0123456789abcdef0123456789abcdef rechazada")).toBe("clave … rechazada");
  });

  it("faultOf lee un StepError, un error de la base y un fallo de red", () => {
    expect(faultOf(new StepError(faultFrom(502, { code: "token" }))).code).toBe("token");
    expect(faultOf({ code: "PGRST202", message: "Could not find the function public.pilo_doc_outline(p_doc, p_edges, p_nodes) in the schema cache" })).toMatchObject({ code: "migracion", title: "Falta la migración 0115" });
    expect(faultOf(new TypeError("Failed to fetch")).code).toBe("red");
    expect(faultOf({ code: "42501", message: "Solo la administración guarda los secretos de Pilo." }).code).toBe("permiso");
    expect(faultOf(new Error("algo raro")).code).toBe("otro");
  });
});

describe("qué migración falta", () => {
  it("reconoce la tabla, la función o la columna de cada una", () => {
    expect(missingMigration({ code: "PGRST205", message: "Could not find the table 'public.pilo_docs' in the schema cache" })).toBe("0114");
    expect(missingMigration({ code: "PGRST202", message: "Could not find the function public.pilo_doc_save(p_doc, p_space)" })).toBe("0114");
    expect(missingMigration({ code: "PGRST202", message: "Could not find the function public.pilo_map_status(p_space)" })).toBe("0115");
    expect(missingMigration({ code: "PGRST205", message: "Could not find the table 'public.pilo_moodle_courses'" })).toBe("0116");
    expect(missingMigration({ code: "42703", message: "column pilo_spaces.moodle_on does not exist" })).toBe("0116");
    expect(missingMigration({ code: "PGRST202", message: "Could not find the function public.pilo_space_secret_status(p_space)" })).toBe("0116");
    // Los varios sitios (0133) se reconocen antes que lo demás de Moodle.
    expect(missingMigration({ code: "PGRST205", message: "Could not find the table 'public.pilo_moodle_sites' in the schema cache" })).toBe("0133");
    expect(missingMigration({ code: "PGRST202", message: "Could not find the function public.pilo_moodle_sites_status(p_space)" })).toBe("0133");
    expect(missingMigration({ code: "PGRST202", message: "Could not find the function public.pilo_moodle_course_set(p_course, p_patch, p_site, p_space)" })).toBe("0133");
    expect(missingMigration({ message: "Bucket not found pilo-docs" })).toBe("0114");
    expect(missingMigration({ code: "PGRST205", message: "Could not find the table 'public.pilo_spaces'" })).toBe("0113");
  });
  it("otro error no es una migración que falte", () => {
    expect(missingMigration({ code: "23505", message: "duplicate key value violates unique constraint pilo_docs_hash_idx" })).toBeNull();
    expect(missingMigration({ code: "42501", message: "Solo la administración" })).toBeNull();
    expect(missingMigration(null)).toBeNull();
  });
});

describe("comprender por lotes: cuándo se pide otro", () => {
  const status = { total: 120, mapped: 84, pending: 36 };
  it("sigue mientras guarde y quede pendiente; termina cuando no queda nada", () => {
    expect(comprehendNext({ ai: true, asked: 18, saved: 18, done: false, status }, 0).next).toBe("seguir");
    expect(comprehendNext({ ai: true, asked: 6, saved: 6, done: true, status: { ...status, pending: 0 } }, 3).next).toBe("listo");
  });
  it("cualquier «stopped» detiene la repetición; con «formato» no se ofrece continuar", () => {
    const limited = comprehendNext({ ai: true, saved: 12, done: false, stopped: "limite_proveedor", status }, 1);
    expect(limited).toMatchObject({ next: "parar", again: true });
    expect(limited.why).toContain("limitó");
    const format = comprehendNext({ ai: true, saved: 0, done: false, stopped: "formato", status }, 0);
    expect(format).toMatchObject({ next: "parar", again: false });
    expect(format.why).toContain("No conviene insistir");
    for (const stopped of ["proveedor", "tiempo", "red"]) expect(comprehendNext({ ai: true, saved: 6, stopped, status }, 0)).toMatchObject({ next: "parar", again: true });
  });
  it("un lote que no guardó nada, o demasiados lotes, también paran", () => {
    expect(comprehendNext({ ai: true, asked: 18, saved: 0, failed: 18, done: false, status }, 0).next).toBe("parar");
    expect(comprehendNext({ ai: true, saved: 18, done: false, status }, MAX_ROUNDS - 1).next).toBe("parar");
  });
  it("sin IA dice que el mapa es el básico y no insiste", () => {
    const r = comprehendNext({ ai: false, done: true, note: "Sin IA, el mapa es el básico." }, 0);
    expect(r).toMatchObject({ next: "listo", again: false, why: "Sin IA, el mapa es el básico." });
  });
  it("el avance es lo comprendido sobre el total, entre 0 y 1", () => {
    expect(comprehendShare(status)).toBeCloseTo(0.7);
    expect(comprehendShare({ total: 0, mapped: 0 })).toBe(0);
    expect(comprehendShare(null)).toBe(0);
    expect(comprehendShare({ total: 5, mapped: 9 })).toBe(1);
  });
});

describe("el archivo en el almacenamiento", () => {
  it("el nombre queda sin tildes, espacios ni signos, y conserva la extensión", () => {
    expect(safeFileName("Política de evaluación (v2).PDF")).toBe("Politica-de-evaluacion-v2.pdf");
    expect(safeFileName("  ñandú  año 2026.docx")).toBe("nandu-ano-2026.docx");
    expect(safeFileName("....")).toBe("documento");
    expect(safeFileName(`${"a".repeat(300)}.xlsx`).length).toBeLessThanOrEqual(105);
  });
  it("la ruta es <espacio>/<id>/<nombre>, como exige pilo_docs", () => {
    const id = "0b9d3c1e-1111-4222-8333-444455556666";
    const path = docPath("ensenanza", id, "Guía docente.docx");
    expect(path).toBe(`ensenanza/${id}/Guia-docente.docx`);
    expect(path.startsWith(`ensenanza/${id}/`)).toBe(true);
  });
  it("el título de partida es el nombre sin extensión", () => {
    expect(titleFromFile("lineamientos_curriculares_2026.pdf")).toBe("lineamientos curriculares 2026");
    expect(titleFromFile(".pdf")).toBe("Documento");
  });
});

describe("la dirección de Moodle", () => {
  it("acepta https y la deja sin barra final", () => {
    expect(checkMoodleUrl(" https://Aula.Ejemplo.edu.co/ ")).toEqual({ ok: true, url: "https://aula.ejemplo.edu.co" });
    expect(checkMoodleUrl("https://ejemplo.edu.co/moodle/")).toEqual({ ok: true, url: "https://ejemplo.edu.co/moodle" });
    expect(checkMoodleUrl("")).toEqual({ ok: true, url: "" });
  });
  it("rechaza lo que la función también rechaza, diciendo por qué", () => {
    for (const bad of ["http://ejemplo.edu.co", "ejemplo.edu.co", "https://usuario:clave@ejemplo.edu.co", "https://ejemplo.edu.co:8443", "https://ejemplo.edu.co/?a=1", "https://ejemplo.edu.co/#x", "https://localhost", "https://10.0.0.5", "https://intranet", "https://moodle.local"]) {
      const r = checkMoodleUrl(bad);
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.why.length).toBeGreaterThan(10);
    }
  });
});

describe("el id de un sitio de Moodle nuevo", () => {
  const SHAPE = /^[a-z][a-z0-9-]{1,23}$/;
  it("sale del nombre: minúsculas, sin tildes y con guiones", () => {
    expect(moodleSiteId("Campus Cúcuta")).toBe("campus-cucuta");
    expect(moodleSiteId("  Pregrado · Bucaramanga  ")).toBe("pregrado-bucaramanga");
    expect(moodleSiteId("2026 Posgrados")).toBe("posgrados");
  });
  it("siempre cumple la forma que pide la base, también con nombres raros o largos", () => {
    for (const name of ["", "¿?", "7", "A", "Educación continua y extensión de la sede Valledupar", "---", "Ñ"]) expect(moodleSiteId(name), name).toMatch(SHAPE);
  });
  it("no repite uno que ya existe", () => {
    expect(moodleSiteId("Principal", ["principal"])).toBe("principal-2");
    expect(moodleSiteId("Principal", ["principal", "principal-2"])).toBe("principal-3");
    const long = moodleSiteId("Educación continua y extensión", []);
    const next = moodleSiteId("Educación continua y extensión", [long]);
    expect(next).not.toBe(long);
    expect(next).toMatch(SHAPE);
  });
});

describe("la franja «Pilo leyendo»", () => {
  it("un trabajo por dueño; se cuenta el último que se movió y al terminar vuelve el anterior", () => {
    let s = readingReducer({ jobs: [] }, { type: "set", job: { owner: "documentos", title: "Leyendo A", line: "" } });
    s = readingReducer(s, { type: "set", job: { owner: "moodle", title: "Leyendo curso", line: "" } });
    s = readingReducer(s, { type: "set", job: { owner: "documentos", title: "Guardando A", line: "", progress: 0.5 } });
    expect(s.jobs).toHaveLength(2);
    expect(currentReading(s)?.title).toBe("Guardando A");
    s = readingReducer(s, { type: "end", owner: "documentos" });
    expect(currentReading(s)?.title).toBe("Leyendo curso");
    s = readingReducer(s, { type: "end", owner: "moodle" });
    expect(currentReading(s)).toBeNull();
  });
});
