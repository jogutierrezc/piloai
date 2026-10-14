import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FAULTS,
  GENESIS_ROUTES,
  MAX_COURSES,
  MAX_PORTALS,
  PERMIT_SECONDS,
  codeShape,
  credentials,
  findPortal,
  genesisAddress,
  genesisPortals,
  genesisReply,
  genesisSite,
  grade,
  isGenesisRoute,
  keyShape,
  loginBody,
  mergeHistory,
  openPermit,
  pdfBase64,
  pdfBody,
  periodShape,
  permitPortal,
  permitShape,
  portalIdShape,
  portalMark,
  privateAddress,
  publicPortals,
  readCapped,
  recordBody,
  shapeLogin,
  shapePolygraph,
  shapeRecord,
  signPermit,
} from "./servidor-logica";
import type { PermitData } from "./servidor-logica";

/* Todos los datos de estas pruebas son inventados: ninguno sale de Génesis. */
const SITE = "https://genesis.udes.edu.co:81";
const CODE = "00000000042";
const TOKEN = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0";
const API_KEY = "0f9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e";
const ACCESS = { token: TOKEN, apiKey: API_KEY, code: CODE };
const SECRET = "un-secreto-de-prueba-de-treinta-y-dos-caracteres";
const OWNER = "11111111-2222-4333-8444-555555555555";
const NOW = 1_800_000_000;

/** Lo que responde el ingreso de Génesis, con todo lo personal que trae. */
const LOGIN = {
  access_token: TOKEN,
  api_key: API_KEY,
  ref: "ffffffffffffffffffffffffffffffffffffffff",
  user: CODE,
  user_type: "Estudiante",
  program: "INGENIERÍA DE PRUEBAS",
  name: "NOMBREINVENTADO",
  lastname: "APELLIDOFALSO OTROAPELLIDO",
  identification: "9990001112",
  phone: "6070000000",
  cellphone: "3000000000",
  email: "persona.inventada@ejemplo.test",
  complete_credits_percent: 62,
  current_info: {
    semester: "2026B",
    accumulated_average: 4.1,
    semester_average: 4.3,
    total_credits: 96,
    credits_approved: 90,
    courses: [{ code: "10101", credits: 3, def: 0, approved: false, homologation: false, semester: 7, weekly_hours: 4 }],
  },
};

const POLYGRAPH = [
  {
    semester: "2026A",
    semester_average: 3.4,
    accumulated_average: 3.8,
    credits_semester: 8,
    credits_approved_sem: 5,
    accumulated_cred: 24,
    credits_approved: 21,
    total_credits: 24,
    courses: [
      { code: "20202", name: "FÍSICA II", credits: 3, weekly_hours: 4, semester: 3, def: "2.6", approved: false, homologation: false, computing: true },
      { code: "20203", name: "ÁLGEBRA LINEAL", credits: 3, weekly_hours: 4, semester: 3, def: 3.2, approved: true, homologation: false, computing: true },
      { code: "20204", name: "INGLÉS I", credits: 2, weekly_hours: 2, semester: 1, def: 4, approved: true, homologation: true, computing: false },
    ],
  },
  {
    semester: "2025B",
    semester_average: 4.2,
    accumulated_average: 4.2,
    credits_semester: 16,
    credits_approved_sem: 16,
    accumulated_cred: 16,
    credits_approved: 16,
    total_credits: 16,
    courses: [{ code: "10101", name: "CÁLCULO DIFERENCIAL", credits: 3, weekly_hours: 4, semester: 1, def: 4.2, approved: true, homologation: false, computing: true }],
  },
];

const RECORD = [
  { "2025B": [{ code_cou: "10101", group: "CÁLCULO DIFERENCIAL", credits: 3, hours: 4, def: 4.2, apro: 3, approved: true, scale: "01", generated: true, code_alu: CODE, _id: { $oid: "0123456789abcdef01234567" } }] },
  {
    "2026A": [
      { code_cou: "20202", group: "FÍSICA II GRUPO B", credits: 3, hours: 4, def: "2.6", apro: 3.5, approved: false, scale: "02", generated: true, code_alu: CODE, _id: { $oid: "0123456789abcdef01234568" } },
      { code_cou: "20209", group: "ELECTIVA I", credits: 2, hours: 2, def: 4.5, apro: "undefined", approved: true, scale: "FP", generated: true, code_alu: CODE, _id: { $oid: "0123456789abcdef01234569" } },
    ],
  },
  { "2024B": [{ code_cou: "30303", group: "NIVELATORIO", credits: 0, hours: 2, def: 3.9, apro: 3, approved: true, scale: "01", generated: true, code_alu: CODE }] },
];

/* --- La dirección ---------------------------------------------------------------------------- */

describe("la dirección de Génesis", () => {
  it("acepta https con dominio público y, a diferencia de Moodle, un puerto", () => {
    expect(genesisSite("https://master-val.udes.edu.co:81")).toEqual({ ok: true, site: "https://master-val.udes.edu.co:81", host: "master-val.udes.edu.co", port: 81 });
    expect(genesisSite("  https://Genesis.UDES.edu.co/ ")).toEqual({ ok: true, site: "https://genesis.udes.edu.co", host: "genesis.udes.edu.co", port: 443 });
    // El 443 se da por dicho; el «/genesis» de sus direcciones se quita: las rutas las pone la función.
    expect(genesisSite("https://genesis.udes.edu.co:443")).toMatchObject({ ok: true, site: "https://genesis.udes.edu.co", port: 443 });
    expect(genesisSite("https://genesis.udes.edu.co:8443/genesis/")).toMatchObject({ ok: true, site: "https://genesis.udes.edu.co:8443", port: 8443 });
  });

  it("rechaza lo que no es https, lo que lleva usuario, consulta, ancla o ruta, y un puerto que no es un puerto", () => {
    for (const bad of [
      "", "   ", null, 5, "genesis.udes.edu.co:81", "http://genesis.udes.edu.co:81", "ftp://genesis.udes.edu.co", "javascript:alert(1)",
      "https://usuario:clave@genesis.udes.edu.co", "https://usuario@genesis.udes.edu.co:81", "https://genesis.udes.edu.co:81/?a=1", "https://genesis.udes.edu.co:81/#x",
      "https://genesis.udes.edu.co:81/genesis/mod_auth/login/", "https://genesis.udes.edu.co/otra", "https://genesis.udes.edu.co/../x", "https://genesis.udes.edu.co:0", "https://genesis.udes.edu.co:99999",
      "https://genesis.udes.edu.co:81a", "https://genesis.udes.edu.co/ con espacio", "https://genesis.udes.edu.co%2f", `https://${"a".repeat(300)}.co`,
    ]) {
      expect(genesisSite(bad).ok, String(bad)).toBe(false);
    }
  });

  it("rechaza las IP escritas de cualquier forma y los nombres de red interna, con puerto o sin él", () => {
    for (const bad of [
      "https://127.0.0.1:81", "https://10.0.0.5:81", "https://192.168.1.10", "https://[::1]:81", "https://[fd00::1]", "https://2130706433:81", "https://0x7f000001", "https://localhost:81",
      "https://genesis.local:81", "https://genesis.internal", "https://genesis.lan:81", "https://intranet", "https://10.0.0.1.nip.io:81", "https://servidor:81", "https://genesis.test",
    ]) {
      const r = genesisSite(bad);
      expect(r.ok, bad).toBe(false);
    }
    expect(genesisSite("https://10.0.0.5:81")).toEqual({ ok: false, reason: expect.stringMatching(/dominio público/) });
  });

  it("reconoce las direcciones de red privada, para el nombre que resuelve hacia adentro", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "172.16.0.1", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd12::1", "fe80::1", "::ffff:10.0.0.1", "no-es-ip", ""]) expect(privateAddress(ip), ip).toBe(true);
    for (const ip of ["190.0.0.1", "8.8.8.8", "2800:480::1"]) expect(privateAddress(ip), ip).toBe(false);
  });
});

/* --- Los portales ---------------------------------------------------------------------------- */

/** Lo que guarda la administración: un portal por sede. Las direcciones son inventadas. */
const CONFIG = [
  { id: "bucaramanga", name: "Bucaramanga", url: "https://genesis-bga.udes.edu.co:81" },
  { id: "cucuta", name: "Cúcuta", url: "https://genesis-cuc.udes.edu.co:81" },
  { id: "tec", name: "TEC", url: "https://genesis-tec.udes.edu.co" },
];

describe("los portales de Génesis, uno por sede", () => {
  it("salen en el orden guardado, cada uno con su dirección revisada", () => {
    expect(genesisPortals(CONFIG)).toEqual([
      { id: "bucaramanga", name: "Bucaramanga", site: "https://genesis-bga.udes.edu.co:81", host: "genesis-bga.udes.edu.co" },
      { id: "cucuta", name: "Cúcuta", site: "https://genesis-cuc.udes.edu.co:81", host: "genesis-cuc.udes.edu.co" },
      { id: "tec", name: "TEC", site: "https://genesis-tec.udes.edu.co", host: "genesis-tec.udes.edu.co" },
    ]);
  });

  it("el que no tiene id, nombre o una dirección que pase la revisión no cuenta; un id repetido, tampoco", () => {
    const messy = [
      CONFIG[0],
      { id: "bucaramanga", name: "Otra vez", url: "https://otro.udes.edu.co" },
      { id: "Malo Id", name: "X", url: "https://x.udes.edu.co" },
      { id: "sin-nombre", name: "  ", url: "https://x.udes.edu.co" },
      { id: "interna", name: "Interna", url: "https://10.0.0.5:81" },
      { id: "http", name: "Sin https", url: "http://genesis.udes.edu.co" },
      { id: "ruta", name: "Con ruta", url: "https://genesis.udes.edu.co/otra" },
      null, "texto", 5,
      CONFIG[2],
    ];
    expect(genesisPortals(messy).map((p) => p.id)).toEqual(["bucaramanga", "tec"]);
    for (const junk of [null, undefined, "x", {}, 5]) expect(genesisPortals(junk)).toEqual([]);
  });

  it("hay un tope", () => {
    const many = Array.from({ length: MAX_PORTALS + 5 }, (_, i) => ({ id: `sede-${i}`, name: `Sede ${i}`, url: `https://genesis-${i}.udes.edu.co` }));
    expect(MAX_PORTALS).toBe(12);
    expect(genesisPortals(many)).toHaveLength(MAX_PORTALS);
  });

  it("a la app solo le llegan el id y el nombre: la dirección no viaja", () => {
    const shown = publicPortals(genesisPortals(CONFIG));
    expect(shown).toEqual([{ id: "bucaramanga", name: "Bucaramanga" }, { id: "cucuta", name: "Cúcuta" }, { id: "tec", name: "TEC" }]);
    expect(JSON.stringify(shown)).not.toMatch(/https|udes\.edu|:81/);
  });

  it("el navegador manda un id; uno desconocido, o algo que no es un id, no encuentra portal", () => {
    const portals = genesisPortals(CONFIG);
    expect(findPortal(portals, "cucuta")?.site).toBe("https://genesis-cuc.udes.edu.co:81");
    for (const no of ["valledupar", "Cúcuta", "CUCUTA", "https://genesis-cuc.udes.edu.co:81", "https://malo.example.org", "", null, undefined, 1, { id: "cucuta" }, "constructor", "__proto__"]) expect(findPortal(portals, no), String(no)).toBeNull();
    expect(portalIdShape("cucuta")).toBe(true);
    for (const no of ["c", "1sede", "con espacio", "MAYUS", "a".repeat(25), "sede/../x"]) expect(portalIdShape(no), no).toBe(false);
  });
});

/* --- Los pedidos ----------------------------------------------------------------------------- */

describe("los pedidos a Génesis", () => {
  it("la lista de rutas es cerrada: el ingreso y tres lecturas", () => {
    expect(Object.keys(GENESIS_ROUTES)).toEqual(["ingreso", "poligrafo", "record", "poligrafo_pdf"]);
    expect(Object.values(GENESIS_ROUTES).map((r) => r.path)).toEqual([
      "/genesis/mod_auth/login/",
      "/genesis/mod_polygraph/polygraph/student/{codigo}/",
      "/genesis/mod_scores_hist/scores_hist/get_scores/",
      "/genesis/mod_polygraph/polygraph/student/download/",
    ]);
    for (const r of Object.values(GENESIS_ROUTES)) expect(r.path).toMatch(/^\/genesis\/mod_(auth|polygraph|scores_hist)\//);
    expect(isGenesisRoute("poligrafo")).toBe(true);
    for (const no of ["matricula", "constructor", "toString", "", null, 3]) expect(isGenesisRoute(no), String(no)).toBe(false);
  });

  it("arma la dirección con la ruta fija, el código del permiso y el permiso en la consulta", () => {
    expect(genesisAddress(SITE, "ingreso")).toBe(`${SITE}/genesis/mod_auth/login/`);
    expect(genesisAddress(SITE, "poligrafo", ACCESS)).toBe(`${SITE}/genesis/mod_polygraph/polygraph/student/${CODE}/?token=${TOKEN}&api_key=${API_KEY}`);
    expect(genesisAddress(SITE, "record", ACCESS)).toBe(`${SITE}/genesis/mod_scores_hist/scores_hist/get_scores/?token=${TOKEN}&api_key=${API_KEY}`);
    expect(genesisAddress(SITE, "poligrafo_pdf", ACCESS)).toBe(`${SITE}/genesis/mod_polygraph/polygraph/student/download/?token=${TOKEN}&api_key=${API_KEY}`);
  });

  it("fuera de la lista, o sin un acceso con buena forma, no hay dirección", () => {
    expect(genesisAddress(SITE, "mod_enrollment/enroll", ACCESS)).toBeNull();
    expect(genesisAddress(SITE, "poligrafo")).toBeNull();
    // Un código que intente cambiar la ruta o la consulta no pasa.
    for (const code of ["../../mod_auth/login", "42/?x=1", "00000000042&token=x", "abc", "", "1"]) expect(genesisAddress(SITE, "poligrafo", { ...ACCESS, code }), code).toBeNull();
    for (const token of ["", "corto", `${TOKEN}&x=1`, "con espacio dentro del permiso de génesis"]) expect(genesisAddress(SITE, "record", { ...ACCESS, token }), token).toBeNull();
    expect(genesisAddress(SITE, "record", { ...ACCESS, apiKey: "x" })).toBeNull();
  });

  it("los cuerpos son los del portal del estudiante", () => {
    expect(JSON.parse(loginBody(CODE, "una clave"))).toEqual({ login: CODE, password: "una clave" });
    expect(JSON.parse(recordBody(CODE))).toEqual({ code: CODE });
    expect(JSON.parse(pdfBody(CODE, "2026B"))).toEqual({ period: "2026B", code: CODE, name_doc: `poligrafo_${CODE}.pdf`, type: ".pdf", exists_doc: false });
  });

  it("lo que escribe la persona: un código de solo números y una contraseña", () => {
    expect(credentials({ code: ` ${CODE} `, password: " con espacios " })).toEqual({ code: CODE, password: " con espacios " });
    for (const bad of [{}, { code: CODE }, { password: "x" }, { code: "abc", password: "x" }, { code: "42", password: "x" }, { code: `${CODE}/../x`, password: "x" }, { code: CODE, password: "" }, { code: CODE, password: "x".repeat(201) }, { code: 42, password: "x" }]) {
      expect(credentials(bad as Record<string, unknown>), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
    expect(codeShape(CODE)).toBe(true);
    expect(keyShape(TOKEN)).toBe(true);
    expect(periodShape("2026B")).toBe(true);
    for (const p of ["2026", "26B", "2026-B", "", null]) expect(periodShape(p), String(p)).toBe(false);
  });
});

/* --- Las respuestas -------------------------------------------------------------------------- */

describe("lo que responde Génesis", () => {
  it("un 401 en el ingreso es la contraseña; en una consulta, el permiso", () => {
    expect(genesisReply(401, { msg: "Usuario no existe.", code: 401 }, "ingreso")).toEqual({ ok: false, fault: FAULTS.credenciales });
    expect(genesisReply(401, { msg: "Token inválido", code: 401 }, "consulta")).toEqual({ ok: false, fault: FAULTS.permiso });
    expect(genesisReply(200, { msg: "sin permiso", code: 403 }, "consulta")).toEqual({ ok: false, fault: FAULTS.permiso });
  });

  it("con 200 entrega lo que trae; lo demás es un fallo de Génesis, y su texto nunca viaja", () => {
    expect(genesisReply(200, { msg: [1], code: 200 }, "consulta")).toEqual({ ok: true, msg: [1] });
    for (const [status, data] of [[500, { msg: "Traceback con datos de la persona", code: 500 }], [200, { code: 200 }], [200, null], [200, "texto"], [302, { msg: "x" }], [200, { msg: "x", code: 500 }]] as [number, unknown][]) {
      const r = genesisReply(status, data, "consulta");
      expect(r).toEqual({ ok: false, fault: FAULTS.genesis });
      expect(JSON.stringify(r)).not.toMatch(/Traceback|persona/);
    }
  });
});

describe("el ingreso: lo personal no pasa", () => {
  it("quedan el acceso, el código y el encabezado; nada que identifique a la persona", () => {
    const r = shapeLogin(LOGIN, CODE);
    expect(r).toEqual({ ok: true, access: ACCESS, head: { program: "INGENIERÍA DE PRUEBAS", period: "2026B", creditsPercent: 62 } });
    const out = JSON.stringify(r);
    for (const personal of [LOGIN.name, LOGIN.lastname, "APELLIDOFALSO", LOGIN.identification, LOGIN.phone, LOGIN.cellphone, LOGIN.email, LOGIN.ref]) expect(out, personal).not.toContain(personal);
    // Solo estas llaves salen del encabezado.
    expect(r.ok && Object.keys(r.head).sort()).toEqual(["creditsPercent", "period", "program"]);
  });

  it("si Génesis dice que no es estudiante, no hay permiso", () => {
    for (const type of ["Docente", "Administrativo", "", undefined, 5]) expect(shapeLogin({ ...LOGIN, user_type: type }, CODE), String(type)).toEqual({ ok: false, fault: FAULTS.no_estudiante });
    expect(shapeLogin({ ...LOGIN, user_type: " ESTUDIANTE " }, CODE).ok).toBe(true);
  });

  it("si el código que devuelve no es el que se escribió, o falta el acceso, tampoco", () => {
    expect(shapeLogin({ ...LOGIN, user: "00000000099" }, CODE)).toEqual({ ok: false, fault: FAULTS.genesis });
    expect(shapeLogin({ ...LOGIN, access_token: "corto" }, CODE)).toEqual({ ok: false, fault: FAULTS.genesis });
    expect(shapeLogin({ ...LOGIN, api_key: undefined }, CODE)).toEqual({ ok: false, fault: FAULTS.genesis });
    for (const junk of [null, "x", [], 7]) expect(shapeLogin(junk, CODE).ok).toBe(false);
  });

  it("un encabezado incompleto no rompe el ingreso", () => {
    expect(shapeLogin({ ...LOGIN, program: 5, complete_credits_percent: "62", current_info: null }, CODE)).toEqual({ ok: true, access: ACCESS, head: { program: "", period: "", creditsPercent: null } });
  });
});

describe("el polígrafo y el récord", () => {
  it("una nota puede llegar como número o como texto", () => {
    expect(grade(3.5)).toBe(3.5);
    expect(grade("3.5")).toBe(3.5);
    expect(grade("3,75")).toBe(3.75);
    expect(grade(0)).toBe(0);
    expect(grade(4.123456)).toBe(4.12);
    for (const no of ["", "undefined", "A", null, undefined, -1, 11, NaN, {}, "3.5.1"]) expect(grade(no), String(no)).toBeNull();
  });

  it("el polígrafo queda por periodo, del más antiguo al más reciente", () => {
    const p = shapePolygraph(POLYGRAPH);
    expect(p.map((x) => x.id)).toEqual(["2025B", "2026A"]);
    expect(p[1]).toMatchObject({ average: 3.4, accumulated: 3.8, credits: 8, creditsApproved: 5, totalApproved: 21 });
    expect(p[1].courses[0]).toEqual({ code: "20202", name: "FÍSICA II", credits: 3, def: 2.6, approved: false, homologated: false, group: "", min: null });
    expect(p[1].courses[2]).toMatchObject({ name: "INGLÉS I", homologated: true, approved: true });
    // Solo salen estas llaves: lo demás de Génesis (horas, semestre del plan…) se queda.
    expect(Object.keys(p[0]).sort()).toEqual(["accumulated", "average", "courses", "credits", "creditsApproved", "id", "totalApproved"]);
    expect(Object.keys(p[0].courses[0]).sort()).toEqual(["approved", "code", "credits", "def", "group", "homologated", "min", "name"]);
  });

  it("lo que no tiene forma de polígrafo se descarta sin romper", () => {
    for (const junk of [null, "x", {}, 5, [null, "x", { semester: "malo" }, { semester: 2026 }]]) expect(shapePolygraph(junk)).toEqual([]);
    const many = [{ semester: "2026A", courses: Array.from({ length: MAX_COURSES + 9 }, (_, i) => ({ code: String(1000 + i), name: `MATERIA ${i}`, credits: 2, def: 3, approved: true })) }];
    expect(shapePolygraph(many)[0].courses).toHaveLength(MAX_COURSES);
    // Un periodo repetido cuenta una vez.
    expect(shapePolygraph([POLYGRAPH[0], POLYGRAPH[0]])).toHaveLength(1);
  });

  it("el récord queda por periodo, sin el código del estudiante", () => {
    const r = shapeRecord(RECORD);
    expect([...r.keys()].sort()).toEqual(["2024B", "2025B", "2026A"]);
    expect(r.get("2026A")).toEqual([
      { code: "20202", group: "FÍSICA II GRUPO B", credits: 3, def: 2.6, approved: false, min: 3.5 },
      { code: "20209", group: "ELECTIVA I", credits: 2, def: 4.5, approved: true, min: null },
    ]);
    expect(JSON.stringify([...r])).not.toContain(CODE);
    expect(JSON.stringify([...r])).not.toContain("$oid");
    for (const junk of [null, "x", {}, [null, 5, { malo: [] }, { "2026A": "x" }]]) expect([...shapeRecord(junk).values()].flat()).toEqual([]);
  });

  it("se fusionan por periodo y código de materia", () => {
    const merged = mergeHistory(shapePolygraph(POLYGRAPH), shapeRecord(RECORD));
    expect(merged.map((p) => p.id)).toEqual(["2024B", "2025B", "2026A"]);
    // El récord completa: la nota mínima y, si dice algo distinto del nombre, el grupo.
    expect(merged[2].courses.find((c) => c.code === "20202")).toEqual({ code: "20202", name: "FÍSICA II", credits: 3, def: 2.6, approved: false, homologated: false, group: "FÍSICA II GRUPO B", min: 3.5 });
    expect(merged[1].courses[0]).toMatchObject({ name: "CÁLCULO DIFERENCIAL", group: "", min: 3 });
    // Lo que el récord no trae queda como lo dijo el polígrafo.
    expect(merged[2].courses.find((c) => c.code === "20203")).toMatchObject({ min: null, group: "", def: 3.2 });
    // Una materia que solo está en el récord también sale; un periodo que solo está en el récord, sin promedios.
    expect(merged[2].courses.find((c) => c.code === "20209")).toEqual({ code: "20209", name: "ELECTIVA I", credits: 2, def: 4.5, approved: true, homologated: false, group: "", min: null });
    expect(merged[0]).toEqual({ id: "2024B", average: null, accumulated: null, credits: 0, creditsApproved: 0, totalApproved: 0, courses: [{ code: "30303", name: "NIVELATORIO", credits: 0, def: 3.9, approved: true, homologated: false, group: "", min: 3 }] });
  });

  it("fusionar no cambia lo que recibió, y sin récord queda el polígrafo", () => {
    const polygraph = shapePolygraph(POLYGRAPH);
    const before = JSON.stringify(polygraph);
    mergeHistory(polygraph, shapeRecord(RECORD));
    expect(JSON.stringify(polygraph)).toBe(before);
    expect(mergeHistory(polygraph, new Map())).toEqual(polygraph);
  });

  it("el PDF solo pasa si es un PDF en base64", () => {
    const pdf = `JVBERi0xLjQK${"A".repeat(400)}`;
    expect(pdfBase64(pdf)).toBe(pdf);
    expect(pdfBase64(`data:application/pdf;base64,${pdf}\n`)).toBe(pdf);
    for (const no of ["", "JVBER", `PGh0bWw+${"A".repeat(400)}`, `JVBERi0x<script>${"A".repeat(400)}`, null, 5, { pdf }]) expect(pdfBase64(no), String(no).slice(0, 20)).toBeNull();
  });
});

/* --- El permiso firmado ---------------------------------------------------------------------- */

describe("el permiso firmado", () => {
  const PORTALS = genesisPortals(CONFIG);
  const MARK = "AAAAAAAAAAAAAAAA";
  const data: PermitData = { ...ACCESS, portal: "cucuta", mark: MARK, period: "2026B", owner: OWNER, exp: NOW + PERMIT_SECONDS };
  /** Un permiso como el que firma la función al entrar por una sede. */
  const forSede = async (id: string, portals = PORTALS): Promise<PermitData> => ({ ...data, portal: id, mark: await portalMark(findPortal(portals, id)!.site) });

  /** Cambia los datos de un permiso sin rehacer la firma. */
  const forge = (permit: string, change: (d: Record<string, unknown>) => void) => {
    const [v, body, mac] = permit.split(".");
    const d = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    change(d);
    return `${v}.${Buffer.from(JSON.stringify(d)).toString("base64url")}.${mac}`;
  };

  it("se firma y se abre con el mismo secreto", async () => {
    const permit = await signPermit(data, SECRET);
    expect(permitShape(permit)).toBe(true);
    expect(await openPermit(permit, SECRET, OWNER, NOW)).toEqual({ ok: true, data });
    // Firmar dos veces lo mismo da lo mismo: no hay nada al azar que guardar.
    expect(await signPermit(data, SECRET)).toBe(permit);
  });

  it("manipulado, se rechaza: ni el código, ni el vencimiento, ni la cuenta se pueden cambiar", async () => {
    const permit = await signPermit(data, SECRET);
    expect(await openPermit(forge(permit, (d) => (d.c = "00000000099")), SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
    expect(await openPermit(forge(permit, (d) => (d.e = NOW + 10 * PERMIT_SECONDS)), SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
    expect(await openPermit(forge(permit, (d) => (d.o = "otra-cuenta")), SECRET, "otra-cuenta", NOW)).toEqual({ ok: false, why: "firma" });
    // Tampoco la sede: un permiso de Cúcuta no se convierte en uno de Bucaramanga.
    expect(await openPermit(forge(permit, (d) => (d.s = "bucaramanga")), SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
    expect(await openPermit(forge(permit, (d) => (d.m = "BBBBBBBBBBBBBBBB")), SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
    // La firma de otro permiso tampoco sirve.
    const other = await signPermit({ ...data, code: "00000000099" }, SECRET);
    expect(await openPermit(`${permit.split(".").slice(0, 2).join(".")}.${other.split(".")[2]}`, SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
    // Ni uno firmado con otro secreto.
    expect(await openPermit(await signPermit(data, "otro-secreto-distinto-de-prueba-000"), SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
  });

  it("vencido, se rechaza", async () => {
    const permit = await signPermit(data, SECRET);
    expect(await openPermit(permit, SECRET, OWNER, data.exp - 1)).toMatchObject({ ok: true });
    expect(await openPermit(permit, SECRET, OWNER, data.exp)).toEqual({ ok: false, why: "vencido" });
    expect(await openPermit(permit, SECRET, OWNER, data.exp + 86_400)).toEqual({ ok: false, why: "vencido" });
  });

  it("es de la cuenta de Pilo que lo pidió: otra no lo puede usar", async () => {
    const permit = await signPermit(data, SECRET);
    expect(await openPermit(permit, SECRET, "99999999-2222-4333-8444-555555555555", NOW)).toEqual({ ok: false, why: "cuenta" });
  });

  it("va a su portal y a ningún otro: el de la sede en que se entró", async () => {
    const cucuta = await forSede("cucuta");
    const opened = await openPermit(await signPermit(cucuta, SECRET), SECRET, OWNER, NOW);
    expect(opened).toMatchObject({ ok: true, data: { portal: "cucuta" } });
    expect((await permitPortal(PORTALS, cucuta))?.site).toBe("https://genesis-cuc.udes.edu.co:81");
    // La marca es de la dirección de ESE portal: la de otro no es la misma, y la dirección no va dentro.
    expect(cucuta.mark).toMatch(/^[A-Za-z0-9_-]{16}$/);
    expect(cucuta.mark).not.toBe((await forSede("bucaramanga")).mark);
    expect(await signPermit(cucuta, SECRET)).not.toContain(Buffer.from("genesis-cuc").toString("base64url").slice(0, 10));
    expect(Buffer.from((await signPermit(cucuta, SECRET)).split(".")[1], "base64url").toString("utf8")).not.toMatch(/https|udes\.edu/);
  });

  it("un permiso de una sede usado contra otra no encuentra portal", async () => {
    const cucuta = await forSede("cucuta");
    // Con la sede cambiada a mano (y aunque la firma se rehiciera), la marca es de otra dirección.
    expect(await permitPortal(PORTALS, { portal: "bucaramanga", mark: cucuta.mark })).toBeNull();
    expect(await permitPortal(PORTALS, { portal: "tec", mark: cucuta.mark })).toBeNull();
  });

  it("si quitan el portal o le cambian la dirección, el permiso deja de valer", async () => {
    const cucuta = await forSede("cucuta");
    const without = genesisPortals(CONFIG.filter((p) => p.id !== "cucuta"));
    expect(await permitPortal(without, cucuta)).toBeNull();
    const moved = genesisPortals(CONFIG.map((p) => (p.id === "cucuta" ? { ...p, url: "https://otro-genesis.udes.edu.co:81" } : p)));
    expect(await permitPortal(moved, cucuta)).toBeNull();
    // Cambiarle solo el nombre no lo afecta: el id y la dirección son los mismos.
    const renamed = genesisPortals(CONFIG.map((p) => (p.id === "cucuta" ? { ...p, name: "Campus Cúcuta" } : p)));
    expect((await permitPortal(renamed, cucuta))?.name).toBe("Campus Cúcuta");
    expect(await permitPortal([], cucuta)).toBeNull();
  });

  it("un permiso sin sede, o con una que no tiene forma de id, no se abre", async () => {
    const permit = await signPermit(data, SECRET);
    const [v, , mac] = permit.split(".");
    const body = JSON.parse(Buffer.from(permit.split(".")[1], "base64url").toString("utf8"));
    delete body.s;
    // Aunque estuviera bien firmado: sin sede no se sabría a qué portal va.
    const bare = await signPermit({ ...data, portal: "" }, SECRET);
    expect(await openPermit(bare, SECRET, OWNER, NOW)).toEqual({ ok: false, why: "forma" });
    expect(await openPermit(await signPermit({ ...data, portal: "https://malo.example.org" }, SECRET), SECRET, OWNER, NOW)).toEqual({ ok: false, why: "forma" });
    expect(await openPermit(`${v}.${Buffer.from(JSON.stringify(body)).toString("base64url")}.${mac}`, SECRET, OWNER, NOW)).toEqual({ ok: false, why: "firma" });
  });

  it("lo que no tiene forma de permiso ni se intenta abrir", async () => {
    for (const junk of ["", "v1.a.b", TOKEN, null, undefined, 5, { permit: "x" }, `v2.${"a".repeat(60)}.${"b".repeat(43)}`]) expect(await openPermit(junk, SECRET, OWNER, NOW), String(junk)).toEqual({ ok: false, why: "forma" });
  });

  it("no se firma sin un secreto de verdad, ni lo firmado trae campos de más", async () => {
    await expect(signPermit(data, "")).rejects.toThrow();
    await expect(signPermit(data, "corto")).rejects.toThrow();
    const permit = await signPermit(data, SECRET);
    expect(Object.keys(JSON.parse(Buffer.from(permit.split(".")[1], "base64url").toString("utf8"))).sort()).toEqual(["c", "e", "k", "m", "o", "p", "s", "t"]);
    expect(permit).not.toContain(SECRET);
  });

  it("dura doce horas", () => {
    expect(PERMIT_SECONDS).toBe(12 * 3600);
  });
});

describe("el tamaño de la respuesta", () => {
  it("lee hasta el tope y, si se pasa, no entrega nada", async () => {
    expect(await readCapped(new Response("hola ñ"), 100)).toBe("hola ñ");
    expect(await readCapped(new Response("x".repeat(5000)), 1000)).toBeNull();
    expect(await readCapped(new Response(null), 10)).toBe("");
  });
});

/* --- La función, leída como texto --------------------------------------------------------------- */

const source = readFileSync(resolve(__dirname, "../../../../supabase/functions/pilo-genesis/index.ts"), "utf8").replace(/\r\n/g, "\n");
/** Solo el código: sin los comentarios, que sí nombran lo que no se hace. */
const strip = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/** Todo el archivo, con la lógica que lleva dentro: lo prohibido lo es en todo él. */
const code = strip(source);
/** Lo que queda fuera de la lógica pegada: lo que atiende el pedido. */
const LOGIC_FROM = source.indexOf("// --- lógica: copia exacta de");
const LOGIC_TO = source.indexOf("// --- fin de la lógica");
const handler = strip(source.slice(0, LOGIC_FROM) + source.slice(LOGIC_TO));

describe("la función no guarda nada", () => {
  it("no escribe en ninguna tabla", () => {
    expect(code).not.toMatch(/\.(insert|update|upsert|delete)\s*\(/);
    // Las únicas tablas que lee: la cuenta de quien llama y la configuración de Génesis.
    expect([...code.matchAll(/\.from\(\s*"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["pilo_spaces", "pilo_users"]);
    expect(code).toMatch(/\.from\("pilo_users"\)\.select\("rol, status"\)/);
    expect(code).toMatch(/\.from\("pilo_spaces"\)\.select\("genesis_on, genesis_portals, genesis_advice"\)/);
    // A la app solo le dice si las recomendaciones con IA están encendidas: esta función no llama a ninguna IA.
    expect(handler).toMatch(/return json\(\{ periods, record: record\.ok, advice: row\?\.genesis_advice === true \}\);/);
    expect(code).not.toMatch(/pilo-ia|chat\/completions|max_tokens/);
  });

  it("la única función de la base que llama es el contador del límite, y con una huella", () => {
    expect([...code.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1])).toEqual(["pilo_visitor_hit"]);
    // La huella sale de la cuenta de Pilo o de la dirección de red: nunca del permiso, del código del estudiante ni de sus notas.
    const hash = code.slice(code.indexOf("const visitorId"), code.indexOf("pilo_visitor_hit"));
    expect(hash).toMatch(/sha256\(/);
    expect(hash).not.toMatch(/token|permit|password|creds|access|portal|code\b|body\./);
    expect(code).toMatch(/limited\(`\$\{action\}:u`, perUser, 600, userId\)/);
    expect(code).toMatch(/limited\(`\$\{action\}:i`, perIp, 600, ip\)/);
  });

  it("no usa console ni la bitácora, ni guarda nada de Génesis", () => {
    expect(code).not.toMatch(/console\s*\./);
    expect(code).not.toMatch(/pilo_ai_log|pilo_space_secret|pilo_memory|\blog\(/);
    expect(code).not.toMatch(/Deno\.(writeTextFile|writeFile|openKv|open)\b/);
    expect(code).not.toMatch(/localStorage|sessionStorage|caches\./);
  });

  it("un fallo inesperado no devuelve su detalle, ni viaja lo que diga Génesis", () => {
    expect(code).not.toMatch(/detail\s*:/);
    expect(code).not.toMatch(/error\.message|String\(error/);
    // Los textos de error son los de la función: de la respuesta de Génesis solo se usa `msg` cuando salió bien.
    expect(handler).not.toMatch(/error:\s*[a-z]+\.msg|message:\s*[a-z]+\.msg/);
  });

  it("solo llama a Génesis, a sus rutas fijas, sin seguir redirecciones y con tope de tiempo y de tamaño", () => {
    expect([...code.matchAll(/\bfetch\(/g)]).toHaveLength(1);
    expect(code).toMatch(/redirect:\s*"error"/);
    expect(code).toMatch(/AbortSignal\.timeout\(/);
    expect(code).toMatch(/readCapped\(response, max\)/);
    // A dónde: solo lo que arma genesisAddress con la dirección revisada y una ruta de la lista.
    expect(handler).toMatch(/const address = genesisAddress\(target\.site, route, access\);/);
    expect(handler).toMatch(/fetch\(address,/);
    const called = [...new Set([...handler.matchAll(/\bask\("([^"]+)"/g)].map((m) => m[1]))].sort();
    expect(called).toEqual(["ingreso", "poligrafo", "poligrafo_pdf", "record"]);
    for (const route of called) expect(isGenesisRoute(route), route).toBe(true);
    // Ninguna ruta de Génesis escrita fuera de la lista.
    expect(handler).not.toMatch(/\/genesis\/|mod_[a-z_]+\//);
    expect(code).toMatch(/privateAddress/);
    expect(code).toMatch(/resolveDns/);
  });

  it("la dirección de Génesis sale de la configuración, no del navegador: del navegador solo llega el id de la sede", () => {
    expect(handler).toMatch(/row\.genesis_on !== true \? \[\] : genesisPortals\(row\.genesis_portals\)/);
    // Al conectar, el portal se busca por el id; después, es el del permiso. No hay otro camino a una dirección.
    expect(handler).toMatch(/site = findPortal\(portals, body\.portal\);\s*if \(!site\) return fail\(FAULTS\.portal\);/);
    expect(handler).toMatch(/site = await permitPortal\(portals, opened\);\s*if \(!site\) return fail\(FAULTS\.permiso\);/);
    expect([...handler.matchAll(/\bsite = /g)]).toHaveLength(2);
    expect(handler).toMatch(/const target = site;/);
    expect(handler).toMatch(/dns\(target\.host, type\)/);
    // La lista que ve la app: solo lo público, y nunca una dirección.
    expect(handler).toMatch(/if \(action === "portales"\) return json\(\{ on: portals\.length > 0, portals: publicPortals\(portals\) \}\);/);
    expect(handler).not.toMatch(/json\([^)]*\.(site|host|url)\b/);
    expect(LOGIC_FROM).toBeGreaterThan(-1);
    expect(LOGIC_TO).toBeGreaterThan(LOGIC_FROM);
    // Del pedido solo se leen estas claves; el código y la contraseña, solo dentro de `credentials` (la lógica) y solo al conectar.
    expect([...new Set([...handler.matchAll(/\bbody\.([a-zA-Z_]+)/g)].map((m) => m[1]))].sort()).toEqual(["action", "permit", "portal"]);
    expect([...new Set([...code.matchAll(/\bbody\.([a-zA-Z_]+)/g)].map((m) => m[1]))].sort()).toEqual(["action", "code", "password", "permit", "portal"]);
    expect([...handler.matchAll(/credentials\(body\)/g)]).toHaveLength(1);
    expect(code).not.toMatch(/body\.(url|site|genesis|host|route|path|period|student|login)/);
  });

  it("el código del estudiante y el portal de cada consulta salen del permiso firmado", () => {
    expect(handler).toMatch(/const read = await openPermit\(body\.permit, secret, userId, Math\.floor\(Date\.now\(\) \/ 1000\)\);/);
    expect(handler).toMatch(/if \(!read\.ok\) return fail\(FAULTS\.permiso\);/);
    expect(handler).toMatch(/const access: GenesisAccess = \{ token: opened\.token, apiKey: opened\.apiKey, code: opened\.code \};/);
    // El permiso se abre (firma, vencimiento, cuenta) antes de buscar su portal.
    expect(handler.indexOf("await openPermit(")).toBeLessThan(handler.indexOf("await permitPortal("));
    // Después del ingreso, toda consulta usa ese acceso.
    const after = handler.slice(handler.indexOf("if (!opened) return fail(FAULTS.permiso);"));
    expect(after.length).toBeGreaterThan(200);
    for (const m of after.matchAll(/\bask\("[a-z_]+",\s*([^,]+),/g)) expect(m[1].trim()).toBe("access");
    expect(after).toMatch(/recordBody\(access\.code\)/);
    expect(after).toMatch(/pdfBody\(access\.code, opened\.period\)/);
    // El permiso se firma con lo que dijo Génesis (shapeLogin), la sede en que se entró, la cuenta de Pilo y el vencimiento.
    expect(handler).toMatch(/signPermit\(\{ \.\.\.login\.access, portal: target\.id, mark: await portalMark\(target\.site\), period: login\.head\.period, owner: userId, exp: expires \}, secret\)/);
    expect(handler).toMatch(/Deno\.env\.get\("PILO_GENESIS_SECRET"\) \|\| serviceKey/);
  });

  it("del ingreso solo sale lo que deja shapeLogin: el permiso firmado y el encabezado", () => {
    expect(handler).toMatch(/const login = shapeLogin\(entered\.msg, creds\.code\);/);
    expect(handler).toMatch(/return json\(\{ permit, expires, head: login\.head, portal: \{ id: target\.id, name: target\.name \} \}\);/);
    // Lo crudo de Génesis no se devuelve nunca: solo lo que pasó por la lógica.
    expect(handler).not.toMatch(/json\(\s*(entered|polygraph|record|file)\.msg/);
    expect(handler).not.toMatch(/json\(\{[^}]*\.msg\b/);
    for (const personal of ["lastname", "identification", "cellphone", "phone", "email"]) expect(code, personal).not.toMatch(new RegExp(`\\b${personal}\\b`));
    // Del ingreso (`m`, en shapeLogin) no se lee el nombre: el único `name` que se lee es el de una materia.
    expect(code).not.toMatch(/\bm\.name\b/);
  });

  it("solo atiende a una cuenta de Pilo activa de estudiante", () => {
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).toMatch(/account\.status !== "activa"/);
    expect(code).toMatch(/account\.rol !== "estudiante"\)/);
    // La cuenta se comprueba antes de pedirle nada a Génesis.
    expect(code.indexOf('from("pilo_users")')).toBeLessThan(code.lastIndexOf("fetch("));
    expect(handler.indexOf('account.status !== "activa"')).toBeLessThan(handler.indexOf('from("pilo_spaces")'));
    expect(handler.indexOf('from("pilo_spaces")')).toBeLessThan(handler.indexOf("fetch(address"));
  });

  it("es un solo archivo: no importa nada local", () => {
    expect(source).not.toMatch(/(?:from|import)\s*\(?\s*["']\.{1,2}\//);
  });

  it("las respuestas no se guardan en cachés", () => {
    expect(code).toMatch(/"Cache-Control":\s*"no-store"/);
  });

  it("está en config.toml con verify_jwt = false", () => {
    const config = readFileSync(resolve(__dirname, "../../../../supabase/config.toml"), "utf8").replace(/\r\n/g, "\n");
    expect(config).toMatch(/\[functions\.pilo-genesis\]\n(#.*\n)*verify_jwt = false/);
  });
});
