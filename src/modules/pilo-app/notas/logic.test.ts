import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ADVICE_COURSES,
  ADVICE_PERIODS,
  ADVICE_PERIOD_COURSES,
  CHART,
  LINK_KEY,
  GOAL,
  adviceFailure,
  adviceSummary,
  areaBars,
  goalPlan,
  gradedCredits,
  lastAverage,
  parseAdvice,
  summaryCourses,
  canUseNotas,
  chartOf,
  checkPortalRows,
  clearLink,
  courseName,
  courseState,
  evolution,
  failedCourses,
  failureOf,
  findings,
  inProgress,
  matchPortal,
  nearestIndex,
  nota,
  notasFailure,
  notasMessage,
  parseHead,
  parseHistory,
  parsePortals,
  periodLine,
  pickPortal,
  plainName,
  portalSlug,
  readLink,
  saveLink,
  settled,
  totals,
} from "./logic";
import type { LinkStore, NotaCourse, NotaPeriod, PortalInfo } from "./logic";

/* Todos los datos de estas pruebas son inventados. */

const course = (name: string, credits: number, def: number | null, over: Partial<NotaCourse> = {}): NotaCourse => ({ code: name.toLowerCase().replace(/\W+/g, "-"), name, credits, def, approved: def !== null && def >= 3, homologated: false, group: "", min: null, ...over });

const period = (id: string, courses: NotaCourse[], over: Partial<NotaPeriod> = {}): NotaPeriod => ({ id, average: null, accumulated: null, credits: 0, creditsApproved: 0, totalApproved: 0, courses, ...over });

/** Un récord de cuatro periodos: una materia reprobada en el segundo y repetida en el tercero. */
const RECORD: NotaPeriod[] = [
  period("2024A", [course("CÁLCULO DIFERENCIAL", 3, 3.4), course("LECTURA Y ESCRITURA", 2, 4.1), course("INGLÉS I", 2, 4, { homologated: true })], { average: 3.68, accumulated: 3.68, credits: 5, totalApproved: 7 }),
  period("2024B", [course("FÍSICA II", 3, 2.6), course("ÁLGEBRA LINEAL", 3, 3.2)], { average: 2.9, accumulated: 3.33, credits: 6, totalApproved: 10 }),
  period("2025A", [course("FÍSICA II", 3, 3.5), course("PROGRAMACIÓN", 3, 4.1)], { average: 3.8, accumulated: 3.5, credits: 6, totalApproved: 16 }),
  period("2025B", [course("BASES DE DATOS", 3, 4.4), course("ECONOMÍA", 2, 4)], { average: 4.24, accumulated: 3.67, credits: 5, totalApproved: 21 }),
];

function fakeStore(): LinkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const PERMIT = `v1.${"a".repeat(80)}.${"b".repeat(43)}`;
const HEAD = { program: "INGENIERÍA DE PRUEBAS", period: "2025B", creditsPercent: 40 };
const SEDE: PortalInfo = { id: "cucuta", name: "Cúcuta" };
const NOW = 1_800_000_000_000;
const LATER = NOW / 1000 + 3600;

describe("quién ve Mis notas", () => {
  it("solo un estudiante con cuenta de Pilo activa", () => {
    expect(canUseNotas({ rol: "estudiante", status: "activa" })).toBe(true);
    for (const a of [{ rol: "profesor", status: "activa" }, { rol: "estudiante", status: "suspendida" }, { rol: "otro", status: "activa" }, null, undefined]) expect(canUseNotas(a), JSON.stringify(a)).toBe(false);
  });
});

describe("el permiso, en el dispositivo", () => {
  afterEach(() => clearLink(fakeStore()));

  it("con «mantener», queda en el dispositivo; sin ella, solo en memoria", () => {
    const store = fakeStore();
    expect(saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, store).kept).toBe(true);
    expect(JSON.parse(store.data.get(LINK_KEY)!)).toEqual({ v: 1, owner: "u1", permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE });
    expect(readLink("u1", NOW, store)).toEqual({ permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE, kept: true });

    expect(saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, false, store).kept).toBe(false);
    expect(store.data.has(LINK_KEY)).toBe(false);
    expect(readLink("u1", NOW, store)).toMatchObject({ permit: PERMIT, kept: false });
  });

  it("la sede se recuerda con el permiso y se borra con él; un permiso sin sede no se entiende", () => {
    const store = fakeStore();
    saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, store);
    expect(readLink("u1", NOW, store)?.portal).toEqual({ id: "cucuta", name: "Cúcuta" });
    // De la sede se guardan el id y el nombre: nunca la dirección del portal.
    expect(store.data.get(LINK_KEY)).not.toMatch(/https|:81/);
    clearLink(store);
    expect(store.data.has(LINK_KEY)).toBe(false);
    expect(readLink("u1", NOW, store)).toBeNull();
    for (const portal of [undefined, null, { id: "Malo Id", name: "X" }, { id: "cucuta", name: "" }, "cucuta"]) {
      store.data.set(LINK_KEY, JSON.stringify({ v: 1, owner: "u1", permit: PERMIT, expires: LATER, head: HEAD, portal }));
      expect(readLink("u1", NOW, store), JSON.stringify(portal)).toBeNull();
      expect(store.data.has(LINK_KEY)).toBe(false);
    }
  });

  it("lo guardado no trae notas, ni el código, ni la contraseña", () => {
    const store = fakeStore();
    saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, store);
    expect(Object.keys(JSON.parse(store.data.get(LINK_KEY)!)).sort()).toEqual(["expires", "head", "owner", "permit", "portal", "v"]);
    expect([...store.data.keys()]).toEqual(["pilo-app:notas"]);
  });

  it("el de otra cuenta no se entrega: se borra", () => {
    const store = fakeStore();
    saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, store);
    expect(readLink("u2", NOW, store)).toBeNull();
    expect(store.data.has(LINK_KEY)).toBe(false);
    expect(readLink("u1", NOW, store)).toBeNull();
  });

  it("vencido, se borra de los dos sitios", () => {
    const store = fakeStore();
    saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, store);
    expect(readLink("u1", LATER * 1000 + 1, store)).toBeNull();
    expect(store.data.has(LINK_KEY)).toBe(false);
  });

  it("«Desconectar» lo borra de inmediato, y lo que no se entiende también se va", () => {
    const store = fakeStore();
    saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, store);
    clearLink(store);
    expect(readLink("u1", NOW, store)).toBeNull();
    for (const junk of ["{", "null", '{"v":2}', JSON.stringify({ v: 1, owner: "u1", permit: "sin-forma", expires: LATER })]) {
      store.data.set(LINK_KEY, junk);
      expect(readLink("u1", NOW, store), junk).toBeNull();
      expect(store.data.has(LINK_KEY)).toBe(false);
    }
  });

  it("sin almacenamiento, o con él lleno, queda en memoria y no falla", () => {
    expect(saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, null).kept).toBe(false);
    expect(readLink("u1", NOW, null)).toMatchObject({ kept: false });
    const full: LinkStore = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => undefined };
    expect(saveLink("u1", { permit: PERMIT, expires: LATER, head: HEAD, portal: SEDE }, true, full).kept).toBe(false);
  });
});

describe("la sede: a cuál portal de Génesis se entra", () => {
  const SEDES: PortalInfo[] = [
    { id: "bucaramanga", name: "Bucaramanga" },
    { id: "cucuta", name: "Cúcuta" },
    { id: "valledupar", name: "Valledupar" },
    { id: "bogota", name: "Bogotá" },
    { id: "tec", name: "TEC" },
  ];

  it("la lista que responde la función: solo id y nombre, y lo que no se entiende se descarta", () => {
    expect(parsePortals({ on: true, portals: [...SEDES.slice(0, 2), { id: "cucuta", name: "Repetida" }, { id: "Malo", name: "X" }, { id: "sin", name: " " }, null, { id: "tec", name: "TEC", url: "https://se-cuela.example.org" }] })).toEqual({
      on: true,
      portals: [SEDES[0], SEDES[1], { id: "tec", name: "TEC" }],
    });
    // Encendida pero sin portales, o cualquier otra cosa: no está disponible.
    expect(parsePortals({ on: true, portals: [] })).toEqual({ on: false, portals: [] });
    expect(parsePortals({ on: false, portals: SEDES })).toMatchObject({ on: false });
    for (const junk of [null, "x", [], { portals: "x" }]) expect(parsePortals(junk)).toEqual({ on: false, portals: [] });
  });

  it("la sede de la cuenta casa con el nombre del portal sin distinguir tildes ni mayúsculas", () => {
    // pilo_users.campus guarda «cucuta», «bogota»…; la administración escribe «Cúcuta», «Bogotá».
    expect(matchPortal(SEDES, "cucuta")).toEqual({ id: "cucuta", name: "Cúcuta" });
    expect(matchPortal(SEDES, "bogota")?.name).toBe("Bogotá");
    expect(matchPortal(SEDES, "BUCARAMANGA")?.id).toBe("bucaramanga");
    expect(matchPortal(SEDES, " Cúcuta ")?.id).toBe("cucuta");
    expect(plainName("  Cúcuta — SEDE  ")).toBe("cucuta sede");
    // También por el id, si la administración le puso otro nombre.
    expect(matchPortal([{ id: "valledupar", name: "Campus del Cesar" }], "valledupar")?.name).toBe("Campus del Cesar");
  });

  it("si ninguno es igual, vale el único que la trae como palabra; con dos, no se adivina", () => {
    const named: PortalInfo[] = [{ id: "sede-bga", name: "Sede Bucaramanga" }, { id: "sede-cuc", name: "UDES Cúcuta" }];
    expect(matchPortal(named, "bucaramanga")?.id).toBe("sede-bga");
    expect(matchPortal(named, "cucuta")?.id).toBe("sede-cuc");
    expect(matchPortal([...named, { id: "posg", name: "Posgrados Bucaramanga" }], "bucaramanga")).toBeNull();
    // Un trozo de palabra no cuenta.
    expect(matchPortal([{ id: "x", name: "Bucaramanguesa" }], "bucaramanga")).toBeNull();
  });

  it("sin sede en la cuenta, o con una que no tiene portal, no se preselecciona nada", () => {
    for (const campus of ["", null, undefined, "medellin", "   "]) expect(matchPortal(SEDES, campus), String(campus)).toBeNull();
    expect(pickPortal(SEDES, "")).toBeNull();
    expect(pickPortal(SEDES, "medellin")).toBeNull();
    expect(pickPortal(SEDES, "valledupar")).toBe("valledupar");
  });

  it("con un solo portal no se pregunta: es ese, sea cual sea la sede de la cuenta", () => {
    expect(pickPortal([SEDES[4]], "cucuta")).toBe("tec");
    expect(pickPortal([SEDES[4]], "")).toBe("tec");
    expect(pickPortal([], "cucuta")).toBeNull();
  });
});

describe("los portales, como los escribe la administración", () => {
  it("el id de un portal nuevo sale de su nombre, sin tildes, y no se repite", () => {
    expect(portalSlug("Cúcuta", [])).toBe("cucuta");
    expect(portalSlug("Bogotá D. C.", [])).toBe("bogota-d-c");
    expect(portalSlug("TEC", ["tec"])).toBe("tec-2");
    expect(portalSlug("TEC", ["tec", "tec-2"])).toBe("tec-3");
    expect(portalSlug("2 de Mayo", [])).toBe("sede-2-de-mayo");
    expect(portalSlug("¡!", [])).toBe("sede");
    for (const name of ["Cúcuta", "Un nombre de sede larguísimo que no cabe en ningún lado", "X", "9", ""]) expect(portalSlug(name, []), name).toMatch(/^[a-z][a-z0-9-]{1,23}$/);
  });

  it("una lista bien escrita queda lista para guardar, en su orden; lo ya guardado conserva su id", () => {
    const r = checkPortalRows([
      { id: "", name: "  Bucaramanga ", url: "https://Genesis-BGA.udes.edu.co:81/" },
      { id: "cuc", name: "Cúcuta (nuevo nombre)", url: "https://genesis-cuc.udes.edu.co:81" },
      { id: "", name: "TEC", url: "https://genesis-tec.udes.edu.co/genesis" },
    ]);
    expect(r).toEqual({
      ok: true,
      portals: [
        { id: "bucaramanga", name: "Bucaramanga", url: "https://genesis-bga.udes.edu.co:81" },
        { id: "cuc", name: "Cúcuta (nuevo nombre)", url: "https://genesis-cuc.udes.edu.co:81" },
        { id: "tec", name: "TEC", url: "https://genesis-tec.udes.edu.co" },
      ],
    });
    expect(checkPortalRows([])).toEqual({ ok: true, portals: [] });
  });

  it("un portal nuevo no toma el id de uno ya guardado", () => {
    const r = checkPortalRows([{ id: "", name: "Cúcuta", url: "https://nuevo.udes.edu.co" }, { id: "cucuta", name: "Cúcuta centro", url: "https://viejo.udes.edu.co" }]);
    expect(r.ok && r.portals.map((p) => p.id)).toEqual(["cucuta-2", "cucuta"]);
  });

  it("los errores se dicen en la fila que los tiene", () => {
    const r = checkPortalRows([
      { id: "", name: "Bucaramanga", url: "https://genesis-bga.udes.edu.co:81" },
      { id: "", name: "", url: "http://genesis.udes.edu.co" },
      { id: "", name: "BUCARAMANGÁ", url: "https://otro.udes.edu.co" },
      { id: "", name: "Cúcuta", url: "https://genesis-bga.udes.edu.co:81" },
      { id: "", name: "Interna", url: "https://10.0.0.5:81" },
      { id: "", name: "Con ruta", url: "https://genesis.udes.edu.co/portal" },
    ]);
    expect(r).toEqual({
      ok: false,
      errors: {
        1: { name: "Escriba el nombre de la sede.", url: "La dirección de Génesis debe empezar por https://." },
        2: { name: "Ya hay un portal con ese nombre." },
        3: { url: "Esa dirección ya está en otro portal." },
        4: { url: expect.stringMatching(/dominio público/) },
        5: { url: expect.stringMatching(/sin ruta/) },
      },
    });
  });

  it("no deja pasar del tope", () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ id: "", name: `Sede ${i}`, url: `https://genesis-${i}.udes.edu.co` }));
    expect(checkPortalRows(many)).toEqual({ ok: false, errors: {}, why: "Son máximo 12 portales." });
    expect(checkPortalRows(many.slice(0, 12)).ok).toBe(true);
  });
});

describe("lo que responde la función", () => {
  it("cada código lleva a su estado de pantalla", () => {
    expect(notasFailure(401, { error: "x", code: "permiso" }).view).toBe("vencido");
    expect(notasFailure(503, { error: "Mis notas aún no está disponible: …", code: "no_disponible" })).toMatchObject({ view: "no_disponible", message: "Mis notas aún no está disponible: …" });
    expect(notasFailure(401, { code: "credenciales" })).toEqual({ code: "credenciales", message: notasMessage("credenciales"), view: "campo" });
    expect(notasFailure(403, { code: "no_estudiante" }).view).toBe("campo");
    expect(notasFailure(403, { code: "perfil" }).view).toBe("cuenta");
    // La sede elegida ya no está entre los portales: se dice junto a la sede.
    expect(notasFailure(400, { code: "portal" })).toEqual({ code: "portal", message: notasMessage("portal"), view: "sede" });
    expect(notasFailure(502, { code: "genesis" }).view).toBe("aviso");
    expect(notasFailure(502, { code: "pdf" }).view).toBe("aviso");
    expect(failureOf("sin_red").view).toBe("sin_conexion");
  });

  it("un código desconocido no deja pasar el texto del servidor", () => {
    expect(notasFailure(500, { error: "Traceback…", code: "raro" })).toEqual({ code: "desconocido", message: notasMessage("desconocido"), view: "aviso" });
    expect(notasFailure(404, null).code).toBe("sin_funcion");
    expect(notasFailure(401, {}).code).toBe("sesion");
    expect(notasFailure(429, { code: "limite", retry_after: 240 })).toMatchObject({ code: "limite", retryAfter: 240, message: expect.stringMatching(/4 minutos/) });
  });

  it("el encabezado y el histórico se leen con cuidado: lo que no se entiende se descarta", () => {
    expect(parseHead({ program: "X", period: "2025B", creditsPercent: 40, name: "se cuela" })).toEqual({ program: "X", period: "2025B", creditsPercent: 40 });
    expect(parseHead(null)).toEqual({ program: "", period: "", creditsPercent: null });
    expect(parseHead({ period: "malo", creditsPercent: 400 })).toEqual({ program: "", period: "", creditsPercent: null });

    const h = parseHistory({ periods: [RECORD[1], RECORD[0], { id: "malo", courses: [] }, null, { id: "2026A", average: "4", courses: [{ name: "", code: "" }, { name: "X", credits: -1, def: 99, approved: "si", extra: 1 }] }], record: true });
    expect(h.periods.map((p) => p.id)).toEqual(["2024A", "2024B", "2026A"]);
    expect(h.periods[2]).toEqual({ id: "2026A", average: null, accumulated: null, credits: 0, creditsApproved: 0, totalApproved: 0, courses: [{ code: "", name: "X", credits: 0, def: null, approved: false, homologated: false, group: "", min: null }] });
    expect(h.record).toBe(true);
    expect(h.advice).toBe(false);
    expect(parseHistory({ periods: [], advice: true }).advice).toBe(true);
    expect(parseHistory(null)).toEqual({ periods: [], record: false, advice: false });
  });
});

describe("los números y los nombres", () => {
  it("una nota se dice con coma y sin redondear a un decimal", () => {
    expect(nota(4.1)).toBe("4,1");
    expect(nota(4)).toBe("4,0");
    expect(nota(3.75)).toBe("3,75");
    // 2,95 no es 3,0: no aprobó.
    expect(nota(2.95)).toBe("2,95");
    expect(nota(null)).toBe("—");
  });

  it("los nombres en mayúsculas de Génesis se leen como texto; los romanos siguen en mayúscula", () => {
    expect(courseName("CÁLCULO DIFERENCIAL")).toBe("Cálculo diferencial");
    expect(courseName("FÍSICA II")).toBe("Física II");
    expect(courseName("INGLÉS  IV ")).toBe("Inglés IV");
    expect(courseName("ELECTIVA VI Y SEMINARIO")).toBe("Electiva VI y seminario");
    // Lo que ya viene escrito con minúsculas no se toca.
    expect(courseName("Bases de Datos II")).toBe("Bases de Datos II");
    expect(courseName("")).toBe("");
  });

  it("el estado de una materia: homologada, aprobada, reprobada o en curso", () => {
    expect(courseState(course("X", 2, 4))).toBe("aprobada");
    expect(courseState(course("X", 2, 2))).toBe("reprobada");
    expect(courseState(course("X", 2, 4, { homologated: true }))).toBe("homologada");
    expect(courseState(course("X", 2, 0), true)).toBe("en_curso");
  });

  it("una materia del periodo vigente sin definitiva está en curso, no reprobada", () => {
    const open = period("2026A", [course("SIMULACIÓN", 3, 0), course("LEGISLACIÓN", 2, null)], { average: 0, accumulated: 3.67 });
    expect(settled(open)).toBe(false);
    expect(inProgress(open, open.courses[0], "2026A")).toBe(true);
    // Aunque Génesis no diga cuál es el vigente: un periodo sin ninguna definitiva va en curso.
    expect(inProgress(open, open.courses[1], "")).toBe(true);
    // En el vigente, una ya cerrada y perdida sí es reprobada; la que sigue en cero, no.
    const mixed = period("2026A", [course("SIMULACIÓN", 3, 0), course("LEGISLACIÓN", 2, 2.1)]);
    expect(inProgress(mixed, mixed.courses[0], "2026A")).toBe(true);
    expect(inProgress(mixed, mixed.courses[1], "2026A")).toBe(false);
    // En un periodo ya cerrado, un cero es un cero.
    const closed = period("2024B", [course("FÍSICA II", 3, 0), course("ÁLGEBRA LINEAL", 3, 3.2)]);
    expect(inProgress(closed, closed.courses[0], "2026A")).toBe(false);
  });

  it("la línea de un periodo", () => {
    expect(periodLine(RECORD[0])).toBe("Promedio 3,68 · 3 materias · 5 créditos");
    expect(periodLine(period("2026A", [course("X", 3, 0)], { average: 0 }))).toBe("1 materia · 3 créditos");
  });
});

describe("Mi evolución: los promedios", () => {
  it("manda lo que calcula Génesis", () => {
    expect(evolution(RECORD)).toEqual([
      { id: "2024A", avg: 3.68, acc: 3.68, credits: 5 },
      { id: "2024B", avg: 2.9, acc: 3.33, credits: 6 },
      { id: "2025A", avg: 3.8, acc: 3.5, credits: 6 },
      { id: "2025B", avg: 4.24, acc: 3.67, credits: 5 },
    ]);
  });

  it("si Génesis no trae el promedio, se calcula ponderado por créditos y sin las homologadas", () => {
    const bare = RECORD.map((p) => ({ ...p, average: null, accumulated: null, credits: 0 }));
    const evo = evolution(bare);
    // 2024A: (3×3,4 + 2×4,1) / 5 = 3,68; la homologada no cuenta.
    expect(evo[0]).toEqual({ id: "2024A", avg: 3.68, acc: 3.68, credits: 7 });
    // 2024B: (3×2,6 + 3×3,2) / 6 = 2,9; acumulado: (18,4 + 17,4) / 11 = 3,25.
    expect(evo[1]).toMatchObject({ avg: 2.9, acc: 3.25 });
    expect(evolution([])).toEqual([]);
  });

  it("un periodo que aún no tiene definitivas no tiene promedio: no hay caída a cero", () => {
    const open = period("2026A", [course("SIMULACIÓN", 3, 0)], { average: 0, accumulated: 0, credits: 3 });
    expect(evolution([...RECORD, open]).at(-1)).toEqual({ id: "2026A", avg: null, acc: null, credits: 3 });
    // Si Génesis mantiene el acumulado, se respeta.
    expect(evolution([...RECORD, { ...open, accumulated: 3.67 }]).at(-1)).toMatchObject({ avg: null, acc: 3.67 });
  });

  it("los totales de arriba", () => {
    expect(totals(RECORD)).toEqual({ accumulated: 3.67, approved: 21, periods: 4 });
    // Sin el dato de Génesis, los créditos aprobados se cuentan de las materias.
    expect(totals(RECORD.map((p) => ({ ...p, totalApproved: 0 }))).approved).toBe(2 + 3 + 2 + 3 + 3 + 3 + 3 + 2);
    expect(totals([])).toEqual({ accumulated: null, approved: 0, periods: 0 });
  });
});

describe("Mi evolución: lo que Pilo ve en el récord", () => {
  it("sale de las notas: el acumulado y su tendencia, los extremos, lo reprobado y los créditos", () => {
    const seen = findings(RECORD, { creditsPercent: 40, period: "2025B" });
    expect(seen.map((f) => f.id)).toEqual(["acumulado", "extremos", "reciente", "reprobadas", "creditos"]);
    expect(seen[0].text).toBe("Su promedio acumulado va en 3,67: prácticamente igual que hace 3 periodos.");
    expect(seen[1].text).toBe("Su mejor periodo fue 2025B (4,24) y el más difícil, 2024B (2,9).");
    expect(seen[2].text).toBe("En 2025B su promedio (4,24) estuvo 0,78 por encima de lo que traía en los periodos anteriores.");
    expect(seen[3].text).toBe("Reprobó una vez: Física II en 2024B. La repitió y la aprobó.");
    expect(seen[4].text).toBe("Lleva 21 créditos aprobados: el 40 % de su plan de estudios.");
  });

  it("dice si el acumulado subió o bajó, y en cuántos periodos", () => {
    const rising = [3.2, 3.4, 3.6, 3.8, 4, 4.1].map((acc, i) => period(`20${20 + i}A`, [course("X", 3, acc)], { average: acc, accumulated: acc }));
    expect(findings(rising)[0].text).toBe("Su promedio acumulado va en 4,1 y ha subido 0,7 en los últimos 4 periodos.");
    expect(findings([...rising].map((p, i, all) => ({ ...p, accumulated: all[all.length - 1 - i].accumulated })))[0].text).toBe("Su promedio acumulado va en 3,2 y ha bajado 0,8 en los últimos 4 periodos.");
    expect(findings(rising.slice(0, 2))[0].text).toBe("Su promedio acumulado va en 3,4 y ha subido 0,2 en el último periodo.");
  });

  it("con un solo periodo no habla de tendencia ni de mejor y peor", () => {
    const seen = findings([RECORD[0]]);
    expect(seen.map((f) => f.id)).toEqual(["acumulado", "reprobadas", "creditos"]);
    expect(seen[0].text).toBe("Su promedio acumulado va en 3,68.");
    expect(seen[1].text).toBe("No ha reprobado ninguna materia.");
    expect(seen[2].text).toBe("Lleva 7 créditos aprobados.");
  });

  it("lo reprobado: cuántas veces, cuáles, y si ya se recuperaron", () => {
    expect(failedCourses(RECORD)).toEqual([{ period: "2024B", name: "FÍSICA II", recovered: true }]);
    const pending = [...RECORD, period("2026A", [course("ECUACIONES", 3, 2), course("QUÍMICA", 3, 1.5)], { average: 1.75, accumulated: 3.4 })];
    const text = findings(pending).find((f) => f.id === "reprobadas")!.text;
    expect(text).toBe("Reprobó 3 veces: Física II en 2024B, Ecuaciones en 2026A y Química en 2026A. De esas, 2 aún no aparecen aprobadas en su récord.");
    const only = [period("2026A", [course("QUÍMICA", 3, 1.5), course("ARTE", 2, 4)], { average: 2.5, accumulated: 2.5 })];
    expect(findings(only).find((f) => f.id === "reprobadas")!.text).toBe("Reprobó una vez: Química en 2026A. Aún no aparece aprobada en su récord.");
  });

  it("lo que sigue en curso no cuenta como reprobado", () => {
    const open = period("2026A", [course("SIMULACIÓN", 3, 0), course("LEGISLACIÓN", 2, null)], { average: 0, accumulated: 3.67 });
    expect(failedCourses([...RECORD, open], "2026A")).toEqual([{ period: "2024B", name: "FÍSICA II", recovered: true }]);
    expect(findings([open], { period: "2026A" }).map((f) => f.id)).toEqual(["acumulado"]);
  });

  it("sin periodos no hay nada que decir", () => {
    expect(findings([])).toEqual([]);
    expect(failedCourses([])).toEqual([]);
  });
});

describe("Mi evolución: la gráfica", () => {
  const evo = evolution(RECORD);
  const { W, H, L, R, T, B } = CHART;

  it("un solo eje para las dos series, de 2,5 a 5, con la guía de 3,0", () => {
    const c = chartOf(evo);
    expect([c.y0, c.y1]).toEqual([2.5, 5]);
    expect(c.grid.map((g) => g.value)).toEqual([3, 4, 5]);
    expect(c.xs[0]).toBe(L);
    expect(c.xs.at(-1)).toBe(W - R);
    // 5 arriba, 2,5 abajo; un promedio más alto queda más arriba.
    expect(c.grid.at(-1)!.y).toBe(T);
    for (const y of [...c.avg, ...c.acc]) {
      expect(y!).toBeGreaterThanOrEqual(T);
      expect(y!).toBeLessThanOrEqual(H - B);
    }
    expect(c.avg[3]!).toBeLessThan(c.avg[1]!);
    expect(c.pathAvg).toMatch(/^M30 \d+(\.\d)?( L\d+(\.\d)? \d+(\.\d)?){3}$/);
    expect(c.pathAcc.split(" L")).toHaveLength(4);
  });

  it("si hay un promedio por debajo de 2,5, el eje baja; nunca se sale del lienzo", () => {
    const low = chartOf([{ id: "2024A", avg: 1.8, acc: 1.8, credits: 3 }, { id: "2024B", avg: 3.9, acc: 2.9, credits: 3 }]);
    expect(low.y0).toBe(1);
    expect(low.grid.map((g) => g.value)).toEqual([2, 3, 4, 5]);
    expect(low.avg[0]!).toBeLessThanOrEqual(H - B);
  });

  it("un periodo sin promedio corta la línea en vez de bajarla a cero", () => {
    const c = chartOf([...evo, { id: "2026A", avg: null, acc: null, credits: 3 }, { id: "2026B", avg: 4, acc: 3.7, credits: 3 }]);
    expect(c.avg[4]).toBeNull();
    expect(c.pathAvg.match(/M/g)).toHaveLength(2);
    expect(c.pathAvg).not.toMatch(/NaN|null|undefined/);
  });

  it("con un periodo, o con ninguno, no se rompe", () => {
    const one = chartOf([evo[0]]);
    expect(one.xs).toEqual([L + (W - L - R) / 2]);
    expect(one.ticks).toEqual([{ index: 0, x: one.xs[0], label: "2024A", anchor: "middle" }]);
    expect(chartOf([])).toMatchObject({ xs: [], pathAvg: "", pathAcc: "", ticks: [] });
  });

  it("en el eje caben pocos nombres: el primero y el último siempre, y ninguno pegado al último", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `${2015 + Math.floor(i / 2)}${i % 2 ? "B" : "A"}`, avg: 4, acc: 4, credits: 15 }));
    const ticks = chartOf(many).ticks;
    expect(ticks.length).toBeLessThanOrEqual(6);
    expect(ticks[0]).toMatchObject({ index: 0, anchor: "start" });
    expect(ticks.at(-1)).toMatchObject({ index: 11, label: "2020B", anchor: "end" });
    expect(ticks.at(-1)!.index - ticks.at(-2)!.index).toBeGreaterThanOrEqual(3);
  });

  it("el dedo o el ratón eligen el periodo más cercano", () => {
    expect(nearestIndex(L, 4)).toBe(0);
    expect(nearestIndex(W - R, 4)).toBe(3);
    expect(nearestIndex(-50, 4)).toBe(0);
    expect(nearestIndex(9999, 4)).toBe(3);
    expect(nearestIndex(L + (W - L - R) / 3 + 2, 4)).toBe(1);
    expect(nearestIndex(100, 1)).toBe(0);
  });
});

describe("qué necesita para llegar a su meta", () => {
  // Va en 3,5 con 60 créditos que pesan; lleva 60 aprobados y eso es el 60 % del plan: le faltan 40.
  const base = { accumulated: 3.5, graded: 60, approved: 60, percent: 60 };

  it("dice cuánto debe promediar en los créditos que le faltan", () => {
    // (4,0 × 100 − 3,5 × 60) / 40 = 4,75.
    expect(goalPlan({ ...base, goal: 4 })).toEqual({ status: "posible", needed: 4.75, remaining: 40, best: 4.1, accumulated: 3.5 });
    // Hacia arriba, a la centésima: con lo que se muestra, alcanza.
    expect(goalPlan({ accumulated: 3.5, graded: 61, approved: 61, percent: 61, goal: 3.8 })).toMatchObject({ status: "posible", remaining: 39, needed: 4.27 });
  });

  it("meta cumplida: ya va ahí o por encima, y dice con qué la mantiene", () => {
    expect(goalPlan({ ...base, goal: 3.4 })).toMatchObject({ status: "cumplida", needed: 3.25, remaining: 40 });
    expect(goalPlan({ ...base, goal: 3.5 })).toMatchObject({ status: "cumplida", needed: 3.5 });
  });

  it("meta inalcanzable: pediría más de 5,0, y dice a lo más que llega", () => {
    // (4,2 × 100 − 210) / 40 = 5,25; sacando 5,0 en todo llega a (210 + 200) / 100 = 4,1.
    expect(goalPlan({ ...base, goal: 4.2 })).toMatchObject({ status: "inalcanzable", best: 4.1, remaining: 40 });
    // Justo en 5,0 todavía se puede.
    expect(goalPlan({ ...base, goal: 4.1 })).toMatchObject({ status: "posible", needed: 5 });
  });

  it("sin con qué calcular, lo dice; y sin créditos por cursar, también", () => {
    for (const missing of [{ accumulated: null }, { percent: null }, { percent: 0 }, { approved: 0 }, { graded: 0 }]) expect(goalPlan({ ...base, goal: 4, ...missing }), JSON.stringify(missing)).toEqual({ status: "sin_datos" });
    expect(goalPlan({ ...base, percent: 100, goal: 4 })).toEqual({ status: "terminado", accumulated: 3.5 });
    expect(goalPlan({ ...base, percent: 99.9, goal: 4 })).toEqual({ status: "terminado", accumulated: 3.5 });
  });

  it("la meta se acota entre 3,0 y 5,0", () => {
    expect(goalPlan({ ...base, goal: 9 })).toEqual(goalPlan({ ...base, goal: 5 }));
    expect(goalPlan({ ...base, goal: 1 })).toEqual(goalPlan({ ...base, goal: 3 }));
    expect(GOAL).toEqual({ min: 3, max: 5, step: 0.1 });
  });

  it("los créditos que pesan en el promedio: con definitiva, sin homologadas ni lo que va en curso", () => {
    // 2024A: 3 + 2 (la homologada no); 2024B: 3 + 3; 2025A: 3 + 3; 2025B: 3 + 2.
    expect(gradedCredits(RECORD, "2025B")).toBe(22);
    const open = period("2026A", [course("SIMULACIÓN", 3, 0)], { average: 0 });
    expect(gradedCredits([...RECORD, open], "2026A")).toBe(22);
    expect(lastAverage([...RECORD, open])).toBe(4.24);
    expect(lastAverage([])).toBeNull();
  });
});

describe("lo que le recomiendo: el resumen que se envía", () => {
  const head = { program: "INGENIERÍA DE PRUEBAS", period: "2025B" };
  const goals = { accumulated: 4.2, semester: 4.5 };

  it("lleva el programa, las dos metas y, por periodo, promedios y materias: nada que identifique a la persona", () => {
    const s = adviceSummary(RECORD, head, goals);
    expect(s.program).toBe("Ingeniería de pruebas");
    expect(s.goals).toEqual({ accumulated: 4.2, semester: 4.5 });
    expect(s.periods.map((p) => p.id)).toEqual(["2024A", "2024B", "2025A", "2025B"]);
    expect(s.periods[1]).toEqual({ id: "2024B", average: 2.9, accumulated: 3.33, courses: [{ name: "Física II", credits: 3, def: 2.6, state: "reprobada" }, { name: "Álgebra lineal", credits: 3, def: 3.2, state: "aprobada" }] });
    expect(s.periods[0].courses[2]).toEqual({ name: "Inglés I", credits: 2, def: 4, state: "homologada" });
    // Solo estas llaves: ni el código de las materias ni ningún otro identificador.
    expect(Object.keys(s).sort()).toEqual(["goals", "periods", "program"]);
    expect(Object.keys(s.periods[0].courses[0]).sort()).toEqual(["credits", "def", "name", "state"]);
    expect(JSON.stringify(s)).not.toMatch(/"code"|"group"|"min"|fisica-ii/);
    expect(summaryCourses(s)).toHaveLength(9);
    expect(summaryCourses(s)[3]).toMatchObject({ name: "Física II", period: "2024B" });
  });

  it("sin metas, van vacías; y lo que va en curso viaja sin definitiva", () => {
    const open = period("2026A", [course("SIMULACIÓN", 3, 0)], { average: 0, accumulated: 3.67 });
    const s = adviceSummary([...RECORD, open], { period: "2026A" });
    expect(s.goals).toEqual({ accumulated: null, semester: null });
    expect(s.periods.at(-1)).toEqual({ id: "2026A", average: null, accumulated: 3.67, courses: [{ name: "Simulación", credits: 3, def: null, state: "en_curso" }] });
  });

  it("tiene topes, y se quedan los periodos más recientes", () => {
    const many = Array.from({ length: 40 }, (_, i) => period(`${2000 + i}A`, Array.from({ length: 20 }, (_, k) => course(`MATERIA ${k}`, 3, 3.5)), { average: 3.5, accumulated: 3.5 }));
    const s = adviceSummary(many, head, goals);
    expect(summaryCourses(s).length).toBeLessThanOrEqual(ADVICE_COURSES);
    expect(s.periods.length).toBeLessThanOrEqual(ADVICE_PERIODS);
    for (const p of s.periods) expect(p.courses.length).toBeLessThanOrEqual(ADVICE_PERIOD_COURSES);
    expect(s.periods.at(-1)!.id).toBe("2039A");
    expect(adviceSummary([], head, goals).periods).toEqual([]);
  });
});

describe("lo que le recomiendo: lo que vuelve", () => {
  const summary = adviceSummary(RECORD, { program: "X", period: "2025B" }, null);
  const body = {
    courses: 9,
    areas: [{ name: "Ciencias", courses: [3, 5] }, { name: "Matemáticas", courses: [0, 4, 3] }, { name: "Profesional", courses: [6, 7, 99, -1] }, { name: "Idiomas", courses: [2] }, { name: "ciencias", courses: [8] }],
    recs: [
      { title: "Refuerce Física II", why: "Fue su nota más baja.", action: "Pida una monitoría.", sources: [1, 9], grounded: true },
      { title: "Siga así", why: "Va subiendo.", action: "", sources: [], grounded: true },
      { title: "", why: "sin título", action: "x" },
    ],
    sources: [{ n: 1, title: "Guía de monitorías", section: "Cómo pedir una", path: "/pilo-ensenanza" }, { n: 2, title: "Otra", path: "javascript:alert(1)" }, { n: 1, title: "Repetida" }],
  };

  it("cada materia queda en una sola área y las recomendaciones solo citan fuentes que vinieron", () => {
    const a = parseAdvice(body, 9);
    expect(a.areas).toEqual([{ name: "Ciencias", courses: [3, 5] }, { name: "Matemáticas", courses: [0, 4] }, { name: "Profesional", courses: [6, 7] }, { name: "Idiomas", courses: [2] }]);
    expect(a.recs).toEqual([
      { title: "Refuerce Física II", why: "Fue su nota más baja.", action: "Pida una monitoría.", sources: [1], grounded: true },
      // Dice «con documento» pero no cita ninguno: es general.
      { title: "Siga así", why: "Va subiendo.", action: "", sources: [], grounded: false },
    ]);
    // Un enlace que no es una ruta del portal ni https no se enlaza.
    expect(a.sources).toEqual([{ n: 1, title: "Guía de monitorías", section: "Cómo pedir una", path: "/pilo-ensenanza" }, { n: 2, title: "Otra", section: "", path: "" }]);
  });

  it("si la función contó otras materias, las áreas no valen: no se dibuja una gráfica con números corridos", () => {
    expect(parseAdvice({ ...body, courses: 8 }, 9).areas).toEqual([]);
    expect(parseAdvice({ ...body, courses: 8 }, 9).recs).toHaveLength(2);
    expect(parseAdvice(null, 9)).toEqual({ areas: [], recs: [], sources: [] });
  });

  it("las barras por área: el promedio lo ponen las notas, ponderado por créditos, de mayor a menor", () => {
    const bars = areaBars(summary, parseAdvice(body, 9).areas, 3.67);
    expect(bars).toEqual([
      // Programación 4,1 y Bases de datos 4,4, tres créditos cada una.
      { name: "Profesional", avg: 4.25, credits: 6, count: 2, strong: true },
      { name: "Matemáticas", avg: 3.3, credits: 6, count: 2, strong: false },
      // Física II dos veces: 2,6 y 3,5.
      { name: "Ciencias", avg: 3.05, credits: 6, count: 2, strong: false },
    ]);
    // «Idiomas» solo tenía una homologada: no tiene promedio y no sale.
    expect(bars.map((b) => b.name)).not.toContain("Idiomas");
  });

  it("sin áreas de la IA, o con una sola, no hay gráfica: no se inventan", () => {
    expect(areaBars(summary, [], 3.67)).toEqual([]);
    expect(areaBars(summary, [{ name: "Todo", courses: [0, 1, 3] }], 3.67)).toEqual([]);
  });

  it("cada fallo se dice en palabras de la app, y se sabe si vale reintentar", () => {
    expect(adviceFailure(403, { code: "apagado", error: "texto del servidor" })).toEqual({ code: "apagado", message: "La universidad aún no ha habilitado las recomendaciones con IA en Mis notas.", retry: false });
    expect(adviceFailure(429, { code: "tope" })).toMatchObject({ code: "tope", retry: false });
    expect(adviceFailure(429, { code: "limite" })).toMatchObject({ code: "limite", retry: false });
    expect(adviceFailure(502, { code: "vacio" })).toMatchObject({ code: "vacio", retry: true });
    expect(adviceFailure(504, { code: "tiempo" })).toMatchObject({ code: "tiempo", retry: true });
    expect(adviceFailure(403, { error: "sin código" })).toMatchObject({ code: "perfil", retry: false });
    expect(adviceFailure(503, null)).toMatchObject({ code: "proveedor", retry: true });
    expect(adviceFailure(500, { code: "raro", error: "Traceback…" })).toEqual({ code: "desconocido", message: expect.not.stringContaining("Traceback"), retry: true });
  });
});

describe("la pantalla", () => {
  const DIR = resolve(process.cwd(), "src/modules/pilo-app");
  const source = (file: string) => readFileSync(resolve(DIR, file), "utf8").replace(/\r\n/g, "\n");
  const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
  const pane = source("notas/NotasPane.tsx");
  /** Lo que se pinta: sin los comentarios, que sí nombran lo que no se muestra. */
  const shown = pane.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const css = strip(source("notas/notas.css"));
  const rule = (selector: string) => css.split("}").find((block) => block.split("{")[0].split(",").some((s) => s.trim() === selector))?.split("{")[1] ?? "";

  it("es una guía de Pilo en cinco momentos, y quien ya está conectado no la repite", () => {
    expect(pane).toContain("const script = useMemo(() => guideScript(name), [name]);");
    for (const m of [0, 1, 2, 3, 4]) expect(pane, `momento ${m}`).toContain(`{moment === ${m} && (`);
    expect(pane).toContain('useState<"guia" | "notas">(() => (readLink(owner) ? "notas" : "guia"))');
    // Se puede saltar la explicación.
    expect(pane).toContain("Saltar la explicación");
    // El nombre del saludo es el de la cuenta de Pilo: nunca sale de Génesis.
    expect(pane).toContain("name={guideName(account)}");
    expect(shown).not.toMatch(/head\.(name|user|nombre)/);
  });

  it("pide la autorización de Génesis antes de la cuenta, y la sede antes del usuario y la contraseña", () => {
    expect(pane).toContain('<DataConsent\n                  platform="genesis"');
    expect(pane.indexOf("<DataConsent")).toBeLessThan(pane.indexOf('id="pnt-sede"'));
    expect(pane.indexOf('id="pnt-sede"')).toBeLessThan(pane.indexOf('id="pnt-user"'));
    expect(pane.indexOf('id="pnt-user"')).toBeLessThan(pane.indexOf('id="pnt-pass"'));
    expect(pane).toMatch(/if \(connecting \|\| loading \|\| !granted\) return;/);
    expect(pane).toMatch(/\{sedes && sedes\.portals\.length > 1 \? \(/);
    // La que viene elegida es la de la cuenta de Pilo, si casa con un portal.
    expect(pane).toMatch(/pickPortal\(list\.portals, campus\)/);
    expect(pane).toContain("await connectGenesis(portalId, typed, pass);");
    expect(source("notas/api.ts")).toContain('call({ action: "conectar", portal, code: code.trim(), password })');
    // La app nunca arma ni conoce una dirección de Génesis.
    for (const file of ["notas/NotasPane.tsx", "notas/api.ts", "notas/guia.ts"]) expect(source(file), file).not.toMatch(/genesis_url|genesis_portals|genesisSite|\/genesis\//);
  });

  it("no muestra ningún código ni identificador: ni el del estudiante, ni el de las materias", () => {
    expect(shown).not.toMatch(/\.code\b|\bcode\}/);
    expect(shown).not.toMatch(/\.group\b|portal\.id\}|\{owner\}|link\.permit\}/);
    expect(shown).not.toMatch(/C[oó]digo de estudiante|su c[oó]digo de/i);
    // Para entrar se pide el usuario de Génesis.
    expect(pane).toContain('<Field id="pnt-user" label="Usuario de Génesis"');
    expect(pane).toContain('"Materia sin nombre"');
    // En la barra se dice la sede por su nombre.
    expect(pane).toContain("Génesis · {link.portal.name} · solo lectura");
    // Tampoco en los textos de los fallos.
    for (const code of ["datos", "credenciales"] as const) expect(notasMessage(code)).not.toMatch(/c[oó]digo/i);
  });

  it("las metas mandan: quedan a la vista, se dibujan en la gráfica y viajan en el resumen", () => {
    expect(pane).toContain('<Meter label="Acumulado" value={sums.accumulated} goal={goals.accumulated} line={accumulatedLine(accPlan, goals.accumulated)} />');
    expect(pane).toContain('<Meter label="Último semestre" value={lastAvg} goal={goals.semester} line={semesterLine(lastAvg, goals.semester)} />');
    expect(pane).toContain('{goals ? "Cambiar" : "Decir mis metas"}');
    expect(pane).toMatch(/const editGoals = [\s\S]{0,140}go\(3, !fromKeyboard\(event\)\);/);
    expect(pane).toContain("<EvoChart rows={evo} goal={goals?.accumulated ?? null} />");
    expect(pane).toContain("const summary = adviceSummary(history.periods, link.head, goals);");
    // No hay un control de meta aparte dentro de «Mi evolución».
    const evolucion = pane.slice(pane.indexOf('{tab === "evolucion"'), pane.indexOf('{tab === "semestre"'));
    expect(evolucion).not.toMatch(/type="range"|GoalPick/);
  });

  it("no guarda las notas ni la contraseña: en el dispositivo quedan el permiso y las metas, y «Desconectar» borra los dos", () => {
    for (const file of ["notas/NotasPane.tsx", "notas/api.ts", "notas/alas.ts"]) expect(source(file), file).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
    expect(source("notas/logic.ts").match(/\.setItem\(/g)).toHaveLength(1);
    expect(source("notas/guia.ts").match(/\.setItem\(/g)).toHaveLength(1);
    expect(pane).toMatch(/setPass\(""\);\s*setUser\(""\);/);
    expect(pane).not.toMatch(/console\./);
    expect(pane).toMatch(/const disconnect = \(\) => \{[\s\S]*?clearLink\(\);\s*clearGoals\(\);/);
    expect(source("PiloApp.tsx")).toMatch(/if \(!loading && !session\) \{\s*clearLink\(\);\s*clearNotasLink\(\);\s*clearNotasGoals\(\);/);
  });

  it("el selector de periodo no se puede ocultar: fijo arriba, con anterior, lista y siguiente, y nunca a lo ancho", () => {
    expect(pane).toContain('aria-label="Periodo anterior"');
    expect(pane).toContain('<select aria-label="Periodo" value={period.id}');
    expect(pane).toContain('aria-label="Periodo siguiente"');
    expect(rule(".pnt-picker")).toMatch(/position:\s*sticky/);
    expect(rule(".pnt-periods")).toMatch(/flex-wrap:\s*wrap/);
    expect(rule(".pnt-periods")).not.toMatch(/overflow/);
    // Fuera de las tablas («Ver como tabla»), nada se desplaza a lo ancho.
    expect([...css.matchAll(/([^{}]+)\{[^}]*overflow-x:\s*auto/g)].map((m) => m[1].trim())).toEqual([".pnt-scroll"]);
  });

  it("sirve en teléfono y en computador: la disposición sale del ancho de la pantalla, no del de un teléfono", () => {
    expect(rule(".pnt")).toMatch(/container-type:\s*inline-size/);
    expect(css).toMatch(/@container pnt \(min-width: 760px\)/);
    const wide = css.slice(css.indexOf("@container pnt (min-width: 760px)"));
    expect(wide).toMatch(/\.pnt-guide \{[^}]*grid-template-columns/);
    expect(wide).toMatch(/\.pnt-body \{[^}]*grid-template-columns:\s*300px/);
    expect(wide).toMatch(/\.pnt-rail \{[^}]*position:\s*sticky/);
    expect(wide).toMatch(/\.pnt-periods \{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.pnt-panel--two \{[^}]*grid-template-columns:\s*repeat\(2/);
    // Ninguna regla pregunta por el ancho de la ventana: todas, por el de esta pantalla.
    expect(css).not.toMatch(/@media[^{]*(max|min)-width/);
  });

  it("la voz es la de Pilo, con el interruptor de la app, y el texto nunca la espera", () => {
    expect(pane).toMatch(/import \{ prefetchOfficial, sayOfficial, stopOfficial \} from "\.\.\/official-voice";/);
    expect(pane).toContain("const speaks = Boolean(voice?.advanced) && voiceOn;");
    expect(pane).toContain("prefetchOfficial(voiceAhead(script, moment), voiceOptions);");
    expect(pane).toMatch(/void sayOfficial\(spoken\(script\[moment\]\), \{ \.\.\.voiceOptions,/);
    // El audio de la guía se guarda en el dispositivo por su texto, como el de la bienvenida.
    expect(pane).toMatch(/keep: true \}/);
    // Ni la voz del navegador ni un caché propio.
    for (const file of ["notas/NotasPane.tsx", "notas/guia.ts", "notas/alas.ts"]) expect(source(file), file).not.toMatch(/speechSynthesis|caches\.open/);
    // El texto está entero en el JSX: no depende de que el audio llegue.
    expect(pane).toContain("{captionWords(beat).map((word, i) => (");
    expect(source("PiloApp.tsx")).toContain("<NotasPane state={cuenta} online={online} voice={greeting} voiceOn={voiceOn} onVoice={pickVoice} />");
  });

  it("el aleteo es un módulo aparte, obedece al interruptor de sonido y solo suena desde un gesto", () => {
    const alas = source("notas/alas.ts");
    expect(alas).not.toMatch(/^import /m);
    expect(alas).not.toMatch(/fetch\(|prefers-reduced-motion/);
    expect(alas).toMatch(/if \(!on \|\| typeof window === "undefined"\) return null;/);
    expect(pane).toMatch(/useEffect\(\(\) => \{\s*setWingsOn\(voiceOn\);/);
    // Nunca dentro de un efecto: solo en lo que responde a un toque, un clic o el envío de un formulario.
    for (const m of pane.matchAll(/use(Layout)?Effect\(\(\) => \{[\s\S]*?\n  \}, \[[^\]]*\]\);/g)) expect(m[0]).not.toMatch(/\b(wings|glide)\(/);
    expect(pane.match(/\bwings\(/g)!.length).toBeGreaterThanOrEqual(4);
    expect(pane.match(/\bglide\(/g)!.length).toBeGreaterThanOrEqual(3);
  });

  it("«Mi semestre» no trae datos ni llama a nada: solo su aviso", () => {
    const panel = pane.slice(pane.indexOf('{tab === "semestre"'), pane.indexOf("PROMISES.map", pane.indexOf('{tab === "semestre"')));
    expect(panel).toContain("En construcción");
    expect(panel).toContain("Vista previa, sin datos.");
    expect(panel).not.toMatch(/periods|history|fetch|load[A-Z]|nota\(/);
  });

  it("las recomendaciones se escriben ahí mismo: no mandan al chat, y solo se piden al pulsar", () => {
    expect(pane).not.toMatch(/useNavigate|navigate\(|APP_PATHS/);
    expect(pane).toContain("const got = await loadAdvice(summary, ctl.signal);");
    // El único que llama a loadAdvice es el botón.
    expect(pane.match(/loadAdvice\(/g)).toHaveLength(1);
    expect(pane).toContain("onAsk={(e) => void askAdvice(e)}");
    expect(source("notas/api.ts")).toContain('body: JSON.stringify({ action: "evolucion", portal: "ensenanza", summary }),');
    expect(pane).toContain("Recomendación general, sin documento de la universidad");
    // La gráfica de áreas no se muestra sin áreas de la IA.
    expect(pane).toContain("if (!bars.length) return null;");
  });

  it("el estado de una materia lleva glifo y palabra; las series, además del color, distinto trazo", () => {
    expect(pane).toMatch(/\{STATE_GLYPH\[state\]\}\s*<\/svg>\s*\{STATE_LABEL\[state\]\}/);
    expect(css).toMatch(/\.pnt-line--acc,\s*\.pnt-key--acc \{[^}]*stroke-dasharray/);
    expect(pane).toContain('className="pnt-dot"');
    expect(shown.match(/Ver como tabla/g)!.length).toBe(2);
    expect(pane).toContain('{b.strong ? "Fortaleza" : "Por reforzar"}');
    // Los textos de las gráficas van en tinta, nunca del color de la serie.
    for (const m of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) if (/text|__val|__top b|caption/.test(m[1])) expect(m[2], m[1]).not.toMatch(/var\(--c-s[12]\)/);
  });

  it("los colores son los del tema, lo que se toca mide 44 px y solo se anima transform y opacidad", () => {
    expect([...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0])).toEqual([]);
    expect(css).toMatch(/var\(--c-s1\)/);
    expect(css).toMatch(/var\(--c-s2\)/);
    for (const selector of [".pnt-tabs button", ".pnt-periods button", ".pnt-link", ".pnt-chipbtn", ".pnt-goal input"]) expect(Number(rule(selector).match(/min-height:\s*(\d+)px/)?.[1] ?? 0), selector).toBeGreaterThanOrEqual(44);
    for (const selector of [".pnt-stepper button", ".pnt-stepper select"]) expect(Number(rule(selector).match(/[^-]height:\s*(\d+)px/)?.[1] ?? 0), selector).toBeGreaterThanOrEqual(44);
    for (const [, value] of css.matchAll(/transition:\s*([^;]+);/g)) expect(value).not.toMatch(/\b(all|width|height|top|left|margin|padding)\b/);
    expect(css).toMatch(/prefers-reduced-motion: reduce/);
    expect(css).toMatch(/scale\(0\.97\)/);
  });

  it("el movimiento se revierte, respeta el movimiento reducido y la línea se dibuja una vez por conexión", () => {
    expect(pane.match(/gsap\.context\(/g)!.length).toBe(pane.match(/ctx\.revert\(\)/g)!.length);
    expect(pane.match(/gsap\.context\(/g)!.length).toBe(5);
    expect(pane.match(/reducedMotion\(\)/g)!.length).toBeGreaterThanOrEqual(6);
    expect(pane).toMatch(/if \(stage !== "notas" \|\| tab !== "evolucion" \|\| !ready \|\| drawn\.current \|\| !root\.current\) return;\s*drawn\.current = true;/);
    // Solo una conexión nueva (o desconectar, o que el permiso venza) deja dibujarla otra vez.
    expect(pane.match(/drawn\.current = false;/g)).toHaveLength(3);
    // Entradas cortas; lo más largo es el vuelo del despegue, que se ve una vez.
    for (const [, d] of pane.matchAll(/duration: (\d\.\d+)/g)) expect(Number(d)).toBeLessThanOrEqual(0.9);
    // El despegue: Pilo vuela de su sitio en la guía a la barra, en arco (x y y con curvas distintas).
    expect(pane).toMatch(/x: from\.left - to\.left[\s\S]{0,120}ease: "power3\.out"/);
    expect(pane).toMatch(/y: from\.top - to\.top[\s\S]{0,140}ease: "power2\.inOut"/);
  });
});
