/* Mis clases (beta) · las reglas de la página: quién entra, dónde vive el permiso, los errores y las entregas. */

import { beforeEach, describe, expect, it } from "vitest";
import { readAppPath } from "../routes";
import {
  LINK_KEY, askAbout, canUseClases, clasesFailure, clearLink, courseDeliveries, courseLine, datesText, dueIn, failureOf, groupDeliveries, groupOf, kindLabel, parseAgenda, parseCourse,
  parseSites, readLink, saveLink, siteIdShape, sortDeliveries,
} from "./logic";
import type { Delivery, LinkStore } from "./logic";

const TOKEN = "0123456789abcdef0123456789abcdef";
const SITE = { name: "Moodle UDES", user: "Laura Gómez" };
/** El Moodle elegido entre varios, y el único que había. */
const MOODLE = { id: "bucaramanga", name: "Bucaramanga", chosen: true };
const ONLY = { id: "principal", name: "Principal", chosen: false };

/** Un almacenamiento de prueba; `broken` falla al escribir (lleno o bloqueado). */
function fakeStore(broken = false): LinkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      if (broken) throw new Error("QuotaExceededError");
      data.set(key, value);
    },
    removeItem: (key) => void data.delete(key),
  };
}

describe("la ruta", () => {
  it("/app/clases es una pantalla de la app", () => {
    expect(readAppPath("/app/clases")).toEqual({ kind: "clases" });
    expect(readAppPath("/app/clases/")).toEqual({ kind: "clases" });
    expect(readAppPath("/app/clases/otra")).toEqual({ kind: "otra" });
  });
});

describe("canUseClases", () => {
  it("solo estudiantes y profesores con cuenta activa", () => {
    expect(canUseClases({ rol: "estudiante", status: "activa" })).toBe(true);
    expect(canUseClases({ rol: "profesor", status: "activa" })).toBe(true);
    expect(canUseClases({ rol: "administrativo", status: "activa" })).toBe(false);
    expect(canUseClases({ rol: "estudiante", status: "suspendida" })).toBe(false);
    expect(canUseClases(null)).toBe(false);
    expect(canUseClases(undefined)).toBe(false);
  });
});

describe("el permiso de Moodle en el dispositivo", () => {
  beforeEach(() => clearLink(null));

  it("con «mantener», queda en el almacenamiento del dispositivo", () => {
    const store = fakeStore();
    const saved = saveLink("u1", { token: TOKEN, site: SITE }, true, store);
    expect(saved.kept).toBe(true);
    expect(JSON.parse(store.data.get(LINK_KEY)!)).toEqual({ v: 1, owner: "u1", token: TOKEN, site: SITE });
    // Como si se recargara la página: la memoria se va, lo guardado queda.
    clearLink(null);
    expect(readLink("u1", store)).toEqual({ token: TOKEN, site: SITE, kept: true });
  });

  it("sin «mantener», vive solo en memoria y no toca el almacenamiento", () => {
    const store = fakeStore();
    const saved = saveLink("u1", { token: TOKEN, site: SITE }, false, store);
    expect(saved.kept).toBe(false);
    expect(store.data.size).toBe(0);
    expect(readLink("u1", store)).toEqual({ token: TOKEN, site: SITE, kept: false });
    // Al recargar (la memoria se va), no queda nada.
    clearLink(null);
    expect(readLink("u1", store)).toBeNull();
  });

  it("conectar sin «mantener» borra el permiso que se había guardado antes", () => {
    const store = fakeStore();
    saveLink("u1", { token: TOKEN, site: SITE }, true, store);
    saveLink("u1", { token: "f".repeat(32), site: SITE }, false, store);
    expect(store.data.has(LINK_KEY)).toBe(false);
  });

  it("«Desconectar» lo borra de la memoria y del dispositivo", () => {
    const store = fakeStore();
    saveLink("u1", { token: TOKEN, site: SITE }, true, store);
    clearLink(store);
    expect(store.data.has(LINK_KEY)).toBe(false);
    expect(readLink("u1", store)).toBeNull();
  });

  it("el permiso de otra cuenta no se entrega, y se borra", () => {
    const store = fakeStore();
    saveLink("u1", { token: TOKEN, site: SITE }, true, store);
    expect(readLink("u2", store)).toBeNull();
    expect(store.data.has(LINK_KEY)).toBe(false);
    // Ni el que estaba en memoria.
    saveLink("u1", { token: TOKEN, site: SITE }, false, store);
    expect(readLink("u2", store)).toBeNull();
    expect(readLink("u1", store)).toBeNull();
  });

  it("tolera un almacenamiento que falla: queda en memoria y lo dice", () => {
    const broken = fakeStore(true);
    const saved = saveLink("u1", { token: TOKEN, site: SITE }, true, broken);
    expect(saved.kept).toBe(false);
    expect(readLink("u1", broken)).toEqual({ token: TOKEN, site: SITE, kept: false });
    const throwing: LinkStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(() => saveLink("u1", { token: TOKEN, site: SITE }, true, throwing)).not.toThrow();
    expect(() => readLink("u1", throwing)).not.toThrow();
    expect(() => clearLink(throwing)).not.toThrow();
  });

  it("sin almacenamiento (null) funciona en memoria", () => {
    expect(saveLink("u1", { token: TOKEN, site: SITE }, true, null).kept).toBe(false);
    expect(readLink("u1", null)?.token).toBe(TOKEN);
    clearLink(null);
    expect(readLink("u1", null)).toBeNull();
  });

  it("lo guardado que no se entiende se descarta y se borra", () => {
    for (const raw of ["no es json", "{}", JSON.stringify({ v: 2, owner: "u1", token: TOKEN }), JSON.stringify({ v: 1, owner: "u1", token: "corto" }), JSON.stringify({ v: 1, owner: "", token: TOKEN })]) {
      const store = fakeStore();
      store.data.set(LINK_KEY, raw);
      expect(readLink("u1", store)).toBeNull();
      expect(store.data.has(LINK_KEY)).toBe(false);
    }
  });

  it("lo que se guarda no lleva la contraseña ni nada más que el permiso y el nombre del sitio", () => {
    const store = fakeStore();
    saveLink("u1", { token: TOKEN, site: SITE, ...({ password: "secreta", courses: [1] } as object) }, true, store);
    expect(Object.keys(JSON.parse(store.data.get(LINK_KEY)!)).sort()).toEqual(["owner", "site", "token", "v"]);
    // Con su Moodle: el identificador y el nombre, y nunca una dirección.
    saveLink("u1", { token: TOKEN, site: SITE, moodle: { ...MOODLE, ...({ url: "https://moodle.udes.edu.co" } as object) } }, true, store);
    const kept = JSON.parse(store.data.get(LINK_KEY)!);
    expect(Object.keys(kept).sort()).toEqual(["moodle", "owner", "site", "token", "v"]);
    expect(kept.moodle).toEqual(MOODLE);
    expect(store.data.get(LINK_KEY)).not.toContain("https://");
  });
});

describe("el Moodle del permiso", () => {
  beforeEach(() => clearLink(null));

  it("se guarda con el permiso y vuelve al leerlo, en el dispositivo y en memoria", () => {
    const store = fakeStore();
    const saved = saveLink("u1", { token: TOKEN, site: SITE, moodle: MOODLE }, true, store);
    expect(saved).toEqual({ token: TOKEN, site: SITE, moodle: MOODLE, kept: true });
    expect(JSON.parse(store.data.get(LINK_KEY)!)).toEqual({ v: 1, owner: "u1", token: TOKEN, site: SITE, moodle: MOODLE });
    clearLink(null);
    expect(readLink("u1", store)).toEqual({ token: TOKEN, site: SITE, moodle: MOODLE, kept: true });
    // Solo en memoria.
    clearLink(store);
    saveLink("u1", { token: TOKEN, site: SITE, moodle: ONLY }, false, store);
    expect(readLink("u1", store)).toEqual({ token: TOKEN, site: SITE, moodle: ONLY, kept: false });
  });

  it("un permiso guardado antes de que hubiera varios sigue leyéndose, sin sitio", () => {
    const store = fakeStore();
    store.data.set(LINK_KEY, JSON.stringify({ v: 1, owner: "u1", token: TOKEN, site: SITE }));
    const link = readLink("u1", store);
    expect(link).toEqual({ token: TOKEN, site: SITE, kept: true });
    expect(link && "moodle" in link).toBe(false);
    // Y no se borra por no traerlo.
    expect(store.data.has(LINK_KEY)).toBe(true);
  });

  it("un sitio que no se entiende no tumba el permiso: queda como los de antes", () => {
    for (const moodle of [null, "bucaramanga", {}, { id: "Con Mayúsculas", name: "x" }, { id: "a", name: "muy corto" }, { id: "https://moodle.udes.edu.co", name: "x" }, { id: 7, name: "x" }]) {
      const store = fakeStore();
      store.data.set(LINK_KEY, JSON.stringify({ v: 1, owner: "u1", token: TOKEN, site: SITE, moodle }));
      expect(readLink("u1", store)).toEqual({ token: TOKEN, site: SITE, kept: true });
    }
    // Ni al guardarlo.
    const store = fakeStore();
    const saved = saveLink("u1", { token: TOKEN, site: SITE, moodle: { id: "NO", name: "x", chosen: true } }, true, store);
    expect("moodle" in saved).toBe(false);
    expect(Object.keys(JSON.parse(store.data.get(LINK_KEY)!)).sort()).toEqual(["owner", "site", "token", "v"]);
  });

  it("el nombre se recorta y «elegido» solo vale si es verdadero", () => {
    const store = fakeStore();
    store.data.set(LINK_KEY, JSON.stringify({ v: 1, owner: "u1", token: TOKEN, site: SITE, moodle: { id: "cucuta", name: "N".repeat(200), chosen: "sí" } }));
    expect(readLink("u1", store)?.moodle).toEqual({ id: "cucuta", name: "N".repeat(60), chosen: false });
  });

  it("el de otra cuenta no se entrega, con sitio o sin él", () => {
    const store = fakeStore();
    saveLink("u1", { token: TOKEN, site: SITE, moodle: MOODLE }, true, store);
    expect(readLink("u2", store)).toBeNull();
    expect(store.data.has(LINK_KEY)).toBe(false);
  });

  it("un identificador de sitio tiene la forma de la tabla", () => {
    for (const ok of ["principal", "bucaramanga", "sede-2", "ab", `a${"b".repeat(23)}`]) expect(siteIdShape(ok), ok).toBe(true);
    for (const bad of ["", "a", "1sede", "-sede", "Sede", "sede_2", "sede 2", `a${"b".repeat(24)}`, "sede/..", 5, null, undefined, ["principal"]]) expect(siteIdShape(bad), String(bad)).toBe(false);
  });
});

describe("clasesFailure", () => {
  it("lleva cada código a su estado de pantalla", () => {
    expect(clasesFailure(401, { code: "permiso", error: "Su permiso venció." })).toMatchObject({ code: "permiso", view: "vencido", message: "Su permiso venció." });
    // Su Moodle ya no se ofrece: como el permiso vencido, se borra y se conecta de nuevo.
    expect(clasesFailure(409, { code: "sitio", error: "Ese Moodle ya no está disponible en Pilo." })).toMatchObject({ code: "sitio", view: "vencido", message: "Ese Moodle ya no está disponible en Pilo." });
    expect(clasesFailure(409, { code: "sitio" }).message).toContain("Conecte de nuevo");
    expect(clasesFailure(503, { code: "no_disponible" }).view).toBe("no_disponible");
    expect(clasesFailure(503, { code: "movil" }).view).toBe("no_disponible");
    expect(clasesFailure(401, { code: "credenciales" }).view).toBe("campo");
    expect(clasesFailure(401, { code: "clave_moodle" }).view).toBe("campo");
    expect(clasesFailure(400, { code: "datos" }).view).toBe("campo");
    expect(clasesFailure(401, { code: "sesion" }).view).toBe("cuenta");
    expect(clasesFailure(403, { code: "perfil" }).view).toBe("cuenta");
    expect(clasesFailure(403, { code: "suspendida" }).view).toBe("cuenta");
    for (const code of ["tiempo", "red", "tamano", "moodle", "interno", "funcion", "curso", "mantenimiento"]) expect(clasesFailure(502, { code }).view).toBe("aviso");
  });

  it("la función sin desplegar (404 de la plataforma) es «aún no disponible»", () => {
    expect(clasesFailure(404, { code: "NOT_FOUND", message: "Requested function was not found" })).toMatchObject({ code: "sin_funcion", view: "no_disponible" });
    expect(clasesFailure(404, null).code).toBe("sin_funcion");
    // Un 404 de la función misma (el curso no existe) no se confunde.
    expect(clasesFailure(404, { code: "curso" }).code).toBe("curso");
  });

  it("el límite dice cuánto esperar", () => {
    const f = clasesFailure(429, { code: "limite", error: "Va muy rápido.", retry_after: 240 });
    expect(f).toMatchObject({ code: "limite", view: "aviso", retryAfter: 240 });
    expect(f.message).toContain("4 minutos");
    expect(clasesFailure(429, { code: "limite", retry_after: 12 }).message).toContain("12 segundos");
    expect(clasesFailure(429, null).code).toBe("limite");
  });

  it("un código desconocido no muestra el texto del servidor", () => {
    const f = clasesFailure(500, { code: "raro", error: "detalle interno con datos" });
    expect(f.code).toBe("desconocido");
    expect(f.message).not.toContain("detalle interno");
    expect(clasesFailure(401, {}).code).toBe("sesion");
  });

  it("sin red es «sin conexión»", () => {
    expect(failureOf("sin_red").view).toBe("sin_conexion");
  });
});

/* Las fechas se arman en la hora del dispositivo, como las ve la persona. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => Math.floor(new Date(y, m - 1, d, h, min).getTime() / 1000);
const NOW = new Date(2026, 9, 2, 10, 0).getTime(); // viernes 2 de octubre de 2026, 10:00
const delivery = (id: string, due: number, patch: Partial<Delivery> = {}): Delivery => ({ id, title: `Tarea ${id}`, course: 1, courseName: "Didáctica", kind: "assign", due, url: "", ...patch });

describe("las entregas", () => {
  const list = [
    delivery("d", at(2026, 10, 20)),
    delivery("b", at(2026, 10, 2, 23, 59)),
    delivery("a", at(2026, 10, 2, 8)),
    delivery("c", at(2026, 10, 5), { course: 2, courseName: "Programación II" }),
    delivery("e", at(2026, 10, 9, 23, 59)),
    delivery("f", at(2026, 10, 10, 0, 0)),
  ];

  it("se ordenan por fecha; a igual fecha, por curso y por título", () => {
    expect(sortDeliveries(list).map((d) => d.id)).toEqual(["a", "b", "c", "e", "f", "d"]);
    const same = [delivery("z", 100, { courseName: "B", title: "Uno" }), delivery("y", 100, { courseName: "A", title: "Dos" }), delivery("x", 100, { courseName: "A", title: "Ábaco" })];
    expect(sortDeliveries(same).map((d) => d.id)).toEqual(["x", "y", "z"]);
    // No cambia la lista que recibe.
    expect(list[0].id).toBe("d");
  });

  it("cada una cae en su grupo: ya venció, hoy, esta semana o más adelante", () => {
    expect(groupOf(at(2026, 10, 2, 8), NOW)).toBe("vencidas");
    expect(groupOf(at(2026, 10, 2, 23, 59), NOW)).toBe("hoy");
    expect(groupOf(at(2026, 10, 3, 0, 0), NOW)).toBe("semana");
    expect(groupOf(at(2026, 10, 9, 23, 59), NOW)).toBe("semana");
    expect(groupOf(at(2026, 10, 10, 0, 0), NOW)).toBe("despues");
  });

  it("se agrupan en el orden en que se leen y sin grupos vacíos", () => {
    const groups = groupDeliveries(list, NOW);
    expect(groups.map((g) => g.id)).toEqual(["hoy", "semana", "despues", "vencidas"]);
    expect(groups.map((g) => g.label)).toEqual(["Hoy", "Esta semana", "Más adelante", "Ya vencieron"]);
    expect(groups.map((g) => g.items.map((d) => d.id))).toEqual([["b"], ["c", "e"], ["f", "d"], ["a"]]);
    expect(groupDeliveries([delivery("x", at(2026, 11, 20))], NOW).map((g) => g.id)).toEqual(["despues"]);
    expect(groupDeliveries([], NOW)).toEqual([]);
  });

  it("las de un curso, sin las vencidas", () => {
    expect(courseDeliveries(list, 1, NOW).map((d) => d.id)).toEqual(["b", "e", "f", "d"]);
    expect(courseDeliveries(list, 2, NOW).map((d) => d.id)).toEqual(["c"]);
    expect(courseDeliveries(list, 3, NOW)).toEqual([]);
  });

  it("la línea de un curso dice qué hay por entregar", () => {
    expect(courseLine(list, 1, NOW)).toBe("Esta semana: 2 entregas");
    expect(courseLine(list, 2, NOW)).toBe("Esta semana: 1 entrega");
    expect(courseLine([delivery("x", at(2026, 11, 20))], 1, NOW)).toBe("Sin entregas esta semana · 1 más adelante");
    expect(courseLine(list, 9, NOW)).toBe("Sin entregas a la vista");
  });

  it("dice cuánto falta", () => {
    expect(dueIn(at(2026, 10, 2, 8), NOW)).toBe("ya venció");
    expect(dueIn(at(2026, 10, 2, 23, 59), NOW)).toBe("vence hoy");
    expect(dueIn(at(2026, 10, 3, 9), NOW)).toBe("vence mañana");
    expect(dueIn(at(2026, 10, 4, 9), NOW)).toBe("en 2 días");
    expect(dueIn(at(2026, 10, 9, 23, 59), NOW)).toBe("en 7 días");
  });

  it("la lista para copiar va por fecha, con el curso y la actividad", () => {
    const text = datesText([list[3], list[1]], NOW).split("\n");
    expect(text[0]).toBe("Mis entregas (Moodle)");
    expect(text).toHaveLength(3);
    expect(text[1]).toContain("Didáctica · Tarea b");
    expect(text[2]).toContain("Programación II · Tarea c");
    expect(text[1]).toMatch(/^- .*2.*oct/i);
    expect(datesText([], NOW)).toBe("");
  });

  it("nombra el tipo de actividad", () => {
    expect(kindLabel("assign")).toBe("Tarea");
    expect(kindLabel("quiz")).toBe("Cuestionario");
    expect(kindLabel("raro", "Juegos")).toBe("Juegos");
    expect(kindLabel("raro")).toBe("");
  });
});

describe("lo que llega de la función", () => {
  it("parseSites deja el identificador y el nombre de cada Moodle, en su orden", () => {
    const sites = parseSites({
      sites: [
        { id: "bucaramanga", name: "Bucaramanga", url: "https://moodle.udes.edu.co", enabled: true },
        { id: "cucuta", name: "  Cúcuta  " },
        { id: "bucaramanga", name: "Repetido" },
        { id: "Mal Id", name: "x" },
        { id: "valledupar", name: "" },
        { id: "bogota", name: "N".repeat(200) },
        "basura",
        null,
      ],
    });
    expect(sites).toEqual([{ id: "bucaramanga", name: "Bucaramanga" }, { id: "cucuta", name: "Cúcuta" }, { id: "valledupar", name: "Moodle" }, { id: "bogota", name: "N".repeat(60) }]);
    // De un sitio no pasa nada más: ni su dirección.
    expect(JSON.stringify(sites)).not.toContain("https://");
    expect(parseSites(null)).toEqual([]);
    expect(parseSites({ sites: "no es una lista" })).toEqual([]);
    expect(parseSites({ sites: Array.from({ length: 30 }, (_, i) => ({ id: `sede-${i}`, name: `Sede ${i}` })) })).toHaveLength(12);
  });

  it("parseAgenda descarta lo que no se entiende y ordena las entregas", () => {
    const agenda = parseAgenda({
      site: { name: "Moodle UDES", user: "Laura" },
      courses: [{ id: 3, name: "Didáctica", short: "DID", url: "https://m.udes.edu.co/course/view.php?id=3", ended: false }, { id: 0, name: "sin id" }, "basura", { id: 4, name: "Vieja", url: "javascript:alert(1)", ended: true }],
      deliveries: [
        { id: "e2", title: "B", course: 3, courseName: "Didáctica", kind: "assign", due: 200, url: "http://inseguro" },
        { id: "e1", title: "A", course: 3, courseName: "Didáctica", kind: "quiz", due: 100, url: "https://m.udes.edu.co/mod/quiz/view.php?id=1" },
        { id: "e3", title: "", due: 300 },
        { id: "e4", title: "Sin fecha" },
      ],
      from: "calendario",
    });
    expect(agenda.courses.map((c) => c.id)).toEqual([3, 4]);
    expect(agenda.courses[1]).toMatchObject({ url: "", ended: true });
    expect(agenda.deliveries.map((d) => d.id)).toEqual(["e1", "e2"]);
    expect(agenda.deliveries[1].url).toBe("");
    expect(agenda.from).toBe("calendario");
    expect(parseAgenda(null)).toEqual({ site: { name: "", user: "" }, courses: [], deliveries: [], from: "ninguna" });
    expect(parseAgenda({ from: "otra" }).from).toBe("ninguna");
  });

  it("parseCourse deja secciones y actividades con lo justo", () => {
    const detail = parseCourse({
      sections: [{ name: "Semana 1", summary: "Inicio", items: [{ id: 5, name: "Lectura", kind: "page", kindName: "Páginas", url: "https://m.udes.edu.co/mod/page/view.php?id=5", text: "x".repeat(2000), dates: [{ label: "Vence", at: 100 }, { label: "", at: 0 }], files: ["a.pdf", 7] }, { id: 0, name: "sin id" }] }],
      cut: true,
    });
    expect(detail.cut).toBe(true);
    expect(detail.sections).toHaveLength(1);
    expect(detail.sections[0].items).toHaveLength(1);
    const item = detail.sections[0].items[0];
    expect(item.text.length).toBe(700);
    expect(item.dates).toEqual([{ label: "Vence", at: 100 }]);
    expect(item.files).toEqual(["a.pdf"]);
    expect(parseCourse(undefined)).toEqual({ sections: [], cut: false });
  });
});

describe("askAbout", () => {
  it("nombra el curso y la actividad, y nada más", () => {
    expect(askAbout("Didáctica general", "Taller 1")).toBe("En mi curso «Didáctica general» tengo la actividad «Taller 1». ¿Me orienta sobre cómo abordarla y cómo organizar mi tiempo?");
    expect(askAbout("Didáctica general")).toBe("Estoy en el curso «Didáctica general». ¿Me ayuda a organizarme con lo que tengo pendiente?");
    expect(askAbout("", "Taller 1")).toContain("«Taller 1»");
    expect(askAbout("", "")).toBe("");
  });

  it("cabe en la caja de la conversación y no deja romper las comillas", () => {
    const q = askAbout("C".repeat(400), "A".repeat(400));
    expect(q.length).toBeLessThanOrEqual(500);
    expect(askAbout("Curso «raro»\ncon salto", "Act \"x\"")).toBe("En mi curso «Curso raro con salto» tengo la actividad «Act x». ¿Me orienta sobre cómo abordarla y cómo organizar mi tiempo?");
  });
});
