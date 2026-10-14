/* =============================================================================
   Mis clases (beta) · la función `pilo-clases`.

   Su lógica pura (servidor-logica.ts, que la función lleva copiada dentro:
   servidor-sync.test.ts vigila que sean iguales): la dirección de Moodle que
   se acepta, cuáles sitios se ofrecen y cuál atiende cada pedido, la lista
   cerrada de funciones, los pedidos, los errores y lo que queda de las
   respuestas.

   Y una prueba ESTÁTICA del archivo de la función (uno solo, con la lógica
   dentro): no escribe en ninguna tabla, no usa la bitácora ni `console`, no
   sigue redirecciones y no toma la dirección de Moodle de lo que manda el
   navegador (de él solo llega el identificador de un sitio, y la dirección
   no viaja de vuelta). Quien agregue una de esas cosas, rompe esta prueba.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLASES_ALLOWED, MAX_EVENTS, MAX_ITEMS, MAX_SITES, MAX_TEXT, MOODLE_SERVICE, OFF, SITE_GONE,
  credentials, hasPages, htmlToText, isClasesFn, loginForm, loginResult, moodleFault, moodleForm, moodleSite, openSites, pickSite, privateAddress, readCapped, safeLink,
  shapeAssignments, shapeContents, shapeCourses, shapeEvents, shapePages, shapeSite, siteIdShape, tokenShape,
} from "./servidor-logica";
import { siteIdShape as clientSiteIdShape } from "./logic";

const SITE = "https://moodle.udes.edu.co";
const TOKEN = "0123456789abcdef0123456789abcdef";

describe("la dirección de Moodle", () => {
  it("acepta un sitio público por https y fija las dos rutas", () => {
    expect(moodleSite("https://moodle.udes.edu.co")).toEqual({
      ok: true,
      site: SITE,
      host: "moodle.udes.edu.co",
      rest: `${SITE}/webservice/rest/server.php`,
      login: `${SITE}/login/token.php`,
    });
    expect(moodleSite("https://Campus.UDES.edu.co/moodle/")).toMatchObject({ ok: true, site: "https://campus.udes.edu.co/moodle", login: "https://campus.udes.edu.co/moodle/login/token.php" });
    // Quien pegó la dirección del servicio o la del permiso: se queda con el sitio.
    expect(moodleSite(`${SITE}/webservice/rest/server.php`)).toMatchObject({ ok: true, site: SITE });
    expect(moodleSite(`${SITE}/login/token.php`)).toMatchObject({ ok: true, site: SITE });
  });

  it("rechaza http y otros esquemas", () => {
    for (const raw of ["http://moodle.udes.edu.co", "ftp://moodle.udes.edu.co", "//moodle.udes.edu.co", "moodle.udes.edu.co", "javascript:alert(1)", "file:///etc/passwd", ""]) {
      expect(moodleSite(raw).ok, raw).toBe(false);
    }
    expect(moodleSite(null).ok).toBe(false);
    expect(moodleSite(42).ok).toBe(false);
  });

  it("rechaza una IP escrita de cualquier forma", () => {
    for (const raw of [
      "https://10.0.0.1", "https://127.0.0.1", "https://192.168.1.10/moodle", "https://169.254.169.254", "https://8.8.8.8", "https://2130706433", "https://0x7f000001", "https://0177.0.0.1", "https://127.1",
      "https://[::1]", "https://[fd00::1]", "https://[::ffff:10.0.0.1]",
    ]) {
      expect(moodleSite(raw).ok, raw).toBe(false);
    }
  });

  it("rechaza localhost y los nombres de red interna", () => {
    for (const raw of [
      "https://localhost", "https://moodle.local", "https://moodle.internal", "https://servidor.lan", "https://moodle.corp", "https://moodle.intranet", "https://intranet", "https://moodle",
      "https://10.0.0.1.nip.io", "https://127.0.0.1.sslip.io", "https://app.localtest.me", "https://x.lvh.me", "https://moodle.test", "https://metadata.google.internal",
    ]) {
      expect(moodleSite(raw).ok, raw).toBe(false);
    }
  });

  it("rechaza usuario, puerto, consulta, ancla y rutas raras", () => {
    for (const raw of [
      "https://user:pass@moodle.udes.edu.co", "https://moodle.udes.edu.co@10.0.0.1", "https://moodle.udes.edu.co:8443", "https://moodle.udes.edu.co/?next=https://10.0.0.1", "https://moodle.udes.edu.co/#x",
      "https://moodle.udes.edu.co/../admin", "https://moodle.udes.edu.co/a b", "https://moodle.udes.edu.co/%2e%2e/x", "https://moodle.udes.edu.co\\@10.0.0.1", `https://${"a".repeat(300)}.co`,
    ]) {
      expect(moodleSite(raw).ok, raw).toBe(false);
    }
  });

  it("privateAddress reconoce las redes internas (lo que responde el DNS)", () => {
    for (const ip of ["10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd12:3456::1", "::ffff:10.0.0.1", "64:ff9b::a00:1", "2001:db8::1", "no-es-ip", "", "999.1.1.1"]) {
      expect(privateAddress(ip), ip).toBe(true);
    }
    for (const ip of ["190.24.150.10", "8.8.8.8", "172.32.0.1", "2800:e2:1::10", "2606:4700:4700::1111"]) {
      expect(privateAddress(ip), ip).toBe(false);
    }
  });
});

describe("los sitios de Moodle", () => {
  const ROWS = [
    { id: "bucaramanga", name: "Bucaramanga", url: "https://moodle.udes.edu.co", enabled: true },
    { id: "cucuta", name: "  Cúcuta \n virtual ", url: "https://campus.udes.edu.co/moodle/", enabled: true },
  ];

  it("un identificador tiene la forma de la tabla (0133), aquí y en la página", () => {
    for (const ok of ["principal", "bucaramanga", "sede-2", "ab", `a${"b".repeat(23)}`]) {
      expect(siteIdShape(ok), ok).toBe(true);
      expect(clientSiteIdShape(ok), ok).toBe(true);
    }
    for (const bad of ["", "a", "1sede", "-sede", "Sede", "sede_2", "sede 2", `a${"b".repeat(24)}`, "sede'--", "sede/..", "https://moodle.udes.edu.co", 5, null, undefined, ["principal"], { id: "principal" }]) {
      expect(siteIdShape(bad), String(bad)).toBe(false);
      expect(clientSiteIdShape(bad), String(bad)).toBe(false);
    }
  });

  it("se ofrecen los encendidos con una dirección válida, en el orden en que llegan", () => {
    const sites = openSites([
      ...ROWS,
      { id: "apagado", name: "Apagado", url: "https://otro.udes.edu.co", enabled: false },
      { id: "sin-encender", name: "Sin decir", url: "https://otro.udes.edu.co" },
      { id: "interno", name: "Interno", url: "https://10.0.0.1", enabled: true },
      { id: "http", name: "Sin https", url: "http://moodle.udes.edu.co", enabled: true },
      { id: "vacio", name: "Sin dirección", url: "", enabled: true },
      { id: "Mal Id", name: "x", url: "https://otro.udes.edu.co", enabled: true },
      { id: "bucaramanga", name: "Repetido", url: "https://otro.udes.edu.co", enabled: true },
      "basura",
      null,
    ]);
    expect(sites.map((s) => s.id)).toEqual(["bucaramanga", "cucuta"]);
    expect(sites[0]).toEqual({ id: "bucaramanga", name: "Bucaramanga", at: moodleSite("https://moodle.udes.edu.co") });
    expect(sites[1].name).toBe("Cúcuta virtual");
    expect(sites[1].at).toMatchObject({ ok: true, site: "https://campus.udes.edu.co/moodle", host: "campus.udes.edu.co" });
    expect(openSites([{ id: "sin-nombre", name: "", url: "https://moodle.udes.edu.co", enabled: true }])[0].name).toBe("Moodle");
    expect(openSites(null)).toEqual([]);
    expect(openSites("no es una lista")).toEqual([]);
    expect(openSites(Array.from({ length: 30 }, (_, i) => ({ id: `sede-${i}`, name: `Sede ${i}`, url: "https://moodle.udes.edu.co", enabled: true })))).toHaveLength(MAX_SITES);
  });

  it("el pedido dice cuál por su identificador, y se usa la dirección de ese", () => {
    const sites = openSites(ROWS);
    const picked = pickSite(sites, "cucuta");
    expect(picked).toMatchObject({ ok: true, site: { id: "cucuta", at: { rest: "https://campus.udes.edu.co/moodle/webservice/rest/server.php" } } });
    expect(pickSite(sites, "bucaramanga")).toMatchObject({ ok: true, site: { id: "bucaramanga", at: { host: "moodle.udes.edu.co" } } });
  });

  it("un permiso de antes no trae sitio: vale si hay exactamente uno", () => {
    const one = openSites(ROWS.slice(0, 1));
    for (const none of [undefined, null, ""]) {
      expect(pickSite(one, none)).toMatchObject({ ok: true, site: { id: "bucaramanga" } });
      // Con varios, no se adivina.
      expect(pickSite(openSites(ROWS), none)).toEqual({ ok: false, fault: SITE_GONE });
    }
  });

  it("un sitio que no existe, que está apagado o que viene mal escrito es el fallo «sitio»", () => {
    const sites = openSites([...ROWS, { id: "apagado", name: "Apagado", url: "https://otro.udes.edu.co", enabled: false }]);
    expect(SITE_GONE).toMatchObject({ code: "sitio", status: 409 });
    for (const bad of ["apagado", "valledupar", "Bucaramanga", " bucaramanga", "https://moodle.udes.edu.co", "https://10.0.0.1", 0, 7, true, ["bucaramanga"], { id: "bucaramanga" }, "__proto__", "constructor"]) {
      expect(pickSite(sites, bad), String(bad)).toEqual({ ok: false, fault: SITE_GONE });
    }
    // Aunque haya uno solo: un identificador que no es el suyo no se cambia por él.
    expect(pickSite(openSites(ROWS.slice(0, 1)), "cucuta")).toEqual({ ok: false, fault: SITE_GONE });
  });

  it("sin ningún sitio encendido, Mis clases aún no está disponible", () => {
    expect(OFF).toMatchObject({ code: "no_disponible", status: 503 });
    for (const asked of [undefined, "", "bucaramanga", "Mal Id"]) expect(pickSite([], asked)).toEqual({ ok: false, fault: OFF });
    expect(pickSite(openSites([{ id: "apagado", name: "Apagado", url: "https://otro.udes.edu.co", enabled: false }]), "apagado")).toEqual({ ok: false, fault: OFF });
  });
});

describe("la lista cerrada de funciones", () => {
  it("es exactamente esta, y todas son de lectura", () => {
    expect([...CLASES_ALLOWED]).toEqual([
      "core_webservice_get_site_info",
      "core_enrol_get_users_courses",
      "core_calendar_get_action_events_by_timesort",
      "mod_assign_get_assignments",
      "core_course_get_contents",
      "mod_page_get_pages_by_courses",
    ]);
    // En Moodle, las funciones de lectura se llaman get_…; ninguna guarda, envía, crea, borra ni intenta nada.
    for (const fn of CLASES_ALLOWED) {
      expect(fn).toMatch(/_get_/);
      expect(fn).not.toMatch(/save|submit|add|create|update|delete|remove|set_|send|attempt|grade|post|upload|enrol_user|unenrol|view_|start_|process/);
    }
  });

  it("cualquier otra se rechaza: no se arma el pedido", () => {
    for (const fn of [
      "mod_assign_save_submission", "mod_assign_submit_for_grading", "mod_quiz_start_attempt", "mod_quiz_process_attempt", "mod_quiz_get_attempt_data", "mod_forum_add_discussion_post",
      "core_message_send_instant_messages", "core_user_update_users", "core_files_upload", "gradereport_user_get_grade_items", "CORE_WEBSERVICE_GET_SITE_INFO", "core_course_get_contents ", "", "constructor", "toString",
    ]) {
      expect(isClasesFn(fn), fn).toBe(false);
      expect(moodleForm(TOKEN, fn), fn).toBeNull();
    }
    expect(isClasesFn(undefined)).toBe(false);
    expect(isClasesFn(["core_course_get_contents"])).toBe(false);
  });

  it("el pedido lleva el permiso en el cuerpo y no deja cambiar la función por un parámetro", () => {
    const form = new URLSearchParams(moodleForm(TOKEN, "core_course_get_contents", { courseid: 12, wsfunction: "mod_assign_save_submission", WSTOKEN: "otro", moodlewsrestformat: "xml" })!);
    expect(form.getAll("wsfunction")).toEqual(["core_course_get_contents"]);
    expect(form.getAll("wstoken")).toEqual([TOKEN]);
    expect(form.get("WSTOKEN")).toBeNull();
    expect(form.get("moodlewsrestformat")).toBe("json");
    expect(form.get("courseid")).toBe("12");
    const many = new URLSearchParams(moodleForm(TOKEN, "mod_assign_get_assignments", { courseids: [3, 5] })!);
    expect(many.get("courseids[0]")).toBe("3");
    expect(many.get("courseids[1]")).toBe("5");
  });
});

describe("conectar", () => {
  it("pide el permiso al servicio de la app móvil, siempre el mismo", () => {
    const form = new URLSearchParams(loginForm("laura.gomez", "cl&ve=1 2"));
    expect(MOODLE_SERVICE).toBe("moodle_mobile_app");
    expect(form.get("service")).toBe("moodle_mobile_app");
    expect(form.get("username")).toBe("laura.gomez");
    expect(form.get("password")).toBe("cl&ve=1 2");
    expect([...form.keys()].sort()).toEqual(["password", "service", "username"]);
  });

  it("revisa el usuario y la contraseña antes de pedir nada", () => {
    expect(credentials({ username: " laura ", password: " con espacios " })).toEqual({ username: "laura", password: " con espacios " });
    expect(credentials({ username: "", password: "x" })).toBeNull();
    expect(credentials({ username: "laura", password: "" })).toBeNull();
    expect(credentials({ username: "a".repeat(101), password: "x" })).toBeNull();
    expect(credentials({ username: "laura", password: "x".repeat(201) })).toBeNull();
    expect(credentials({ username: "lau\nra", password: "x" })).toBeNull();
    expect(credentials({ username: ["laura"], password: { a: 1 } })).toBeNull();
  });

  it("entiende lo que responde Moodle al pedir el permiso", () => {
    expect(loginResult({ token: TOKEN, privatetoken: "x" })).toEqual({ ok: true, token: TOKEN });
    expect(loginResult({ error: "Invalid login", errorcode: "invalidlogin" })).toMatchObject({ ok: false, fault: { code: "credenciales", status: 401 } });
    expect(loginResult({ error: "Web services must be enabled", errorcode: "enablewsdescription" })).toMatchObject({ ok: false, fault: { code: "movil" } });
    expect(loginResult({ error: "x", errorcode: "servicenotavailable" })).toMatchObject({ ok: false, fault: { code: "movil" } });
    expect(loginResult({ error: "x", errorcode: "sitemaintenance" })).toMatchObject({ ok: false, fault: { code: "mantenimiento" } });
    expect(loginResult({ error: "x", errorcode: "passwordisexpired" })).toMatchObject({ ok: false, fault: { code: "clave_moodle" } });
    expect(loginResult({ token: "corto" })).toMatchObject({ ok: false, fault: { code: "moodle" } });
    expect(loginResult("<html>")).toMatchObject({ ok: false, fault: { code: "moodle" } });
  });

  it("un permiso tiene forma de permiso", () => {
    expect(tokenShape(TOKEN)).toBe(true);
    for (const bad of ["", "corto", `${TOKEN}&wsfunction=x`, `${TOKEN} `, "a".repeat(129), 123, null, undefined, { token: TOKEN }]) expect(tokenShape(bad)).toBe(false);
  });
});

describe("los errores de Moodle", () => {
  it("se traducen a un código y a un texto propio", () => {
    expect(moodleFault({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token - token not found" })).toMatchObject({ code: "permiso", status: 401 });
    expect(moodleFault({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" })).toMatchObject({ code: "funcion" });
    expect(moodleFault({ exception: "x", errorcode: "requireloginerror" })).toMatchObject({ code: "curso", status: 404 });
    expect(moodleFault({ exception: "x", errorcode: "algo_nuevo" })).toMatchObject({ code: "moodle", status: 502 });
  });

  it("lo que dice Moodle no viaja a la página: podría nombrar a la persona o a un curso", () => {
    const secret = "El usuario laura.gomez (id 991) no puede ver «Cálculo II» con el token 0123456789abcdef0123456789abcdef";
    for (const errorcode of ["invalidtoken", "accessexception", "algo_nuevo", "invalidlogin"]) {
      const fault = moodleFault({ exception: "x", errorcode, message: secret, debuginfo: secret })!;
      expect(fault.message).not.toContain("laura");
      expect(fault.message).not.toContain("Cálculo");
      expect(fault.message).not.toContain(TOKEN);
    }
  });

  it("una respuesta buena no es un error", () => {
    expect(moodleFault([{ id: 1 }])).toBeNull();
    expect(moodleFault({ events: [] })).toBeNull();
    expect(moodleFault(null)).toBeNull();
    expect(moodleFault("texto")).toBeNull();
  });
});

describe("lo que se devuelve al navegador", () => {
  const NOW = 1_790_000_000;

  it("del sitio: su nombre, la persona y qué funciones deja usar", () => {
    const site = shapeSite({ sitename: "Moodle <b>UDES</b>", fullname: "Laura Gómez", userid: 991, username: "laura.gomez", functions: [{ name: "core_enrol_get_users_courses" }, { name: "core_course_get_contents" }] });
    expect(site.info).toEqual({ name: "Moodle UDES", user: "Laura Gómez" });
    expect(site.userId).toBe(991);
    expect(site.can("core_course_get_contents")).toBe(true);
    expect(site.can("core_calendar_get_action_events_by_timesort")).toBe(false);
    // Si Moodle no dice sus funciones, se intenta.
    expect(shapeSite({ userid: 1 }).can("mod_assign_get_assignments")).toBe(true);
    expect(shapeSite(null).userId).toBe(0);
  });

  it("los cursos: visibles, los abiertos primero, con su página en Moodle", () => {
    const courses = shapeCourses(
      [
        { id: 7, fullname: "Zoología", shortname: "ZOO", visible: 1, enddate: 0 },
        { id: 5, fullname: "Historia antigua", shortname: "HIS", visible: 1, enddate: NOW - 10 },
        { id: 9, fullname: "Oculto", visible: 0 },
        { id: 3, fullname: "Álgebra &amp; <i>geometría</i>", shortname: "ALG", visible: 1, enddate: NOW + 1000 },
        { id: "x", fullname: "Sin id" },
      ],
      SITE,
      NOW,
    );
    expect(courses.map((c) => c.id)).toEqual([3, 7, 5]);
    expect(courses[0]).toEqual({ id: 3, name: "Álgebra & geometría", short: "ALG", url: `${SITE}/course/view.php?id=3`, ended: false });
    expect(courses[2].ended).toBe(true);
    expect(shapeCourses("no es una lista", SITE, NOW)).toEqual([]);
  });

  it("las entregas del calendario: título, curso, fecha y un enlace del mismo Moodle", () => {
    const courses = shapeCourses([{ id: 3, fullname: "Álgebra" }], SITE, NOW);
    const out = shapeEvents(
      {
        events: [
          { id: 11, name: "Vencimiento de Taller 1", activityname: "Taller 1", timesort: NOW + 3600, modulename: "assign", eventtype: "due", course: { id: 3, fullname: "ALG-01" }, url: `${SITE}/mod/assign/view.php?id=40` },
          { id: 12, name: "Parcial <script>x()</script>cierra", timesort: NOW + 7200, modulename: "quiz", eventtype: "close", course: { id: 8, fullname: "Física" }, url: "https://otro-sitio.com/robar", action: { url: `${SITE}/mod/quiz/view.php?id=41` } },
          { id: 13, name: "Parcial abre", timesort: NOW + 100, modulename: "quiz", eventtype: "open", course: { id: 8 } },
          { id: 14, name: "Sin fecha", course: { id: 3 } },
          { id: 15, name: "Tipo raro", timesort: NOW + 9000, modulename: "Mod Raro!", course: { id: 3 }, url: `${SITE}/webservice/pluginfile.php/1/x?token=${TOKEN}` },
        ],
      },
      SITE,
      courses,
    );
    expect(out.map((e) => e.id)).toEqual(["e11", "e12", "e15"]);
    expect(out[0]).toEqual({ id: "e11", title: "Taller 1", course: 3, courseName: "Álgebra", kind: "assign", due: NOW + 3600, url: `${SITE}/mod/assign/view.php?id=40` });
    expect(out[1]).toMatchObject({ title: "Parcial cierra", courseName: "Física", url: `${SITE}/mod/quiz/view.php?id=41` });
    expect(out[2]).toMatchObject({ kind: "", url: "" });
    expect(shapeEvents({ events: Array.from({ length: 500 }, (_, i) => ({ id: i + 1, name: "x", timesort: NOW })) }, SITE, []).length).toBe(MAX_EVENTS);
    expect(shapeEvents(null, SITE, [])).toEqual([]);
  });

  it("las tareas (camino de reserva): solo las que tienen fecha por venir", () => {
    const out = shapeAssignments(
      {
        courses: [
          {
            id: 3,
            fullname: "Álgebra",
            assignments: [
              { id: 1, cmid: 40, name: "Taller 1", duedate: NOW + 86_400 },
              { id: 2, cmid: 41, name: "Sin fecha", duedate: 0 },
              { id: 3, cmid: 42, name: "Vieja", duedate: NOW - 10 },
              { id: 4, cmid: 43, name: "Lejana", duedate: NOW + 400 * 86_400 },
            ],
          },
        ],
      },
      SITE,
      NOW,
    );
    expect(out).toEqual([{ id: "a1", title: "Taller 1", course: 3, courseName: "Álgebra", kind: "assign", due: NOW + 86_400, url: `${SITE}/mod/assign/view.php?id=40` }]);
  });

  it("un curso: secciones y actividades visibles, con el texto plano y recortado", () => {
    const contents = [
      {
        id: 1,
        name: "Semana 1",
        summary: "<p>Bienvenida al <b>curso</b>.</p>",
        modules: [
          { id: 40, name: "Taller 1", modname: "assign", modplural: "Tareas", url: `${SITE}/mod/assign/view.php?id=40`, description: "<p>Entregue el <a href='https://malo.com'>taller</a>.</p><script>alert(1)</script>", dates: [{ label: "Vence:", timestamp: NOW + 100 }, { label: "Sin fecha", timestamp: 0 }] },
          { id: 41, name: "Lectura", modname: "page", modplural: "Páginas", url: `${SITE}/mod/page/view.php?id=41` },
          { id: 42, name: "Guía", modname: "resource", contents: [{ filename: "guia.pdf", fileurl: `${SITE}/webservice/pluginfile.php/9/guia.pdf?token=${TOKEN}` }, { filename: "index.html" }] },
          { id: 43, name: "Oculta", modname: "assign", uservisible: false },
        ],
      },
      { id: 2, name: "Oculta", visible: 0, modules: [{ id: 50, name: "x", modname: "page" }] },
      { id: 3, name: "", summary: "", modules: [] },
    ];
    expect(hasPages(contents)).toBe(true);
    expect(hasPages([{ modules: [{ modname: "assign" }] }])).toBe(false);
    const pages = shapePages({ pages: [{ coursemodule: 41, content: `<h2>Tema</h2><p>${"palabra ".repeat(300)}</p>` }, { coursemodule: 0, content: "x" }] });
    const { sections, cut } = shapeContents(contents, SITE, pages);
    expect(cut).toBe(false);
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("Semana 1");
    expect(sections[0].summary).toBe("Bienvenida al curso.");
    expect(sections[0].items.map((m) => m.id)).toEqual([40, 41, 42]);
    const [task, page, file] = sections[0].items;
    expect(task).toMatchObject({ name: "Taller 1", kind: "assign", kindName: "Tareas", text: "Entregue el taller.", dates: [{ label: "Vence", at: NOW + 100 }] });
    expect(page.text.length).toBeLessThanOrEqual(MAX_TEXT + 1);
    expect(page.text.endsWith("…")).toBe(true);
    expect(page.text).not.toContain("<");
    // De un archivo, solo su nombre: nunca la dirección con el permiso.
    expect(file.files).toEqual(["guia.pdf"]);
    expect(JSON.stringify(sections)).not.toContain(TOKEN);
    expect(JSON.stringify(sections)).not.toContain("malo.com");
    expect(JSON.stringify(sections)).not.toContain("pluginfile");
  });

  it("un curso enorme se corta y lo dice", () => {
    const big = [{ id: 1, name: "Todo", modules: Array.from({ length: MAX_ITEMS + 50 }, (_, i) => ({ id: i + 1, name: `A${i}`, modname: "page" })) }];
    const { sections, cut } = shapeContents(big, SITE);
    expect(cut).toBe(true);
    expect(sections[0].items).toHaveLength(MAX_ITEMS);
  });

  it("un enlace solo se muestra si es del mismo Moodle y no lleva permiso", () => {
    expect(safeLink(`${SITE}/mod/assign/view.php?id=4`, SITE)).toBe(`${SITE}/mod/assign/view.php?id=4`);
    for (const bad of [
      "https://otro.com/x", "http://moodle.udes.edu.co/x", `${SITE}.evil.com/x`, `${SITE}/x?token=${TOKEN}`, `${SITE}/x?a=1&wstoken=${TOKEN}`, `${SITE}/webservice/pluginfile.php/1`, "javascript:alert(1)", `${SITE}/a b`, "", 5, null,
    ]) {
      expect(safeLink(bad, SITE), String(bad)).toBe("");
    }
  });

  it("htmlToText deja solo texto", () => {
    expect(htmlToText("<p>Hola <b>mundo</b></p><script>alert(1)</script><style>p{}</style>")).toBe("Hola mundo");
    expect(htmlToText("3 &lt; 5 &amp; 7 &gt; 2")).toBe("3 < 5 & 7 > 2");
    expect(htmlToText("<ul><li>uno</li><li>dos</li></ul>")).toBe("- uno\n\n- dos");
    expect(htmlToText("antes<iframe src='x'>sin cerrar y lo que sigue")).toBe("antes");
    expect(htmlToText("")).toBe("");
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

const source = readFileSync(resolve(__dirname, "../../../../supabase/functions/pilo-clases/index.ts"), "utf8").replace(/\r\n/g, "\n");
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
    // Las únicas tablas que lee: la cuenta de quien llama y la configuración de Moodle.
    expect([...code.matchAll(/\.from\(\s*"([^"]+)"/g)].map((m) => m[1]).sort()).toEqual(["pilo_moodle_sites", "pilo_users"]);
    expect(code).toMatch(/\.from\("pilo_users"\)\.select\("rol, status"\)/);
    // De los sitios: los del espacio de Enseñanza, solo los encendidos y por orden de creación. Su token no se lee.
    expect(code).toMatch(/\.from\("pilo_moodle_sites"\)\.select\("id, name, url, enabled"\)\.eq\("space", "ensenanza"\)\.eq\("enabled", true\)\.order\("created_at", \{ ascending: true \}\)\.limit\(MAX_SITES\)/);
    expect(code).not.toMatch(/pilo_spaces|moodle_on|moodle_url/);
  });

  it("la única función de la base que llama es el contador del límite, y con una huella", () => {
    expect([...code.matchAll(/\.rpc\(\s*"([^"]+)"/g)].map((m) => m[1])).toEqual(["pilo_visitor_hit"]);
    // La huella sale de la cuenta de Pilo o de la dirección de red: nunca del permiso, del usuario de Moodle ni de sus contenidos.
    const hash = code.slice(code.indexOf("const visitorId"), code.indexOf("pilo_visitor_hit"));
    expect(hash).toMatch(/sha256\(/);
    expect(hash).not.toMatch(/token|username|password|creds|body\./);
    expect(code).toMatch(/limited\(`\$\{action\}:u`, perUser, 600, userId\)/);
    expect(code).toMatch(/limited\(`\$\{action\}:i`, perIp, 600, ip\)/);
  });

  it("no usa console ni la bitácora, ni guarda secretos de Moodle", () => {
    expect(code).not.toMatch(/console\s*\./);
    expect(code).not.toMatch(/pilo_ai_log|pilo_space_secret|pilo_moodle_site_secret|pilo_memory|\blog\(/);
    expect(code).not.toMatch(/Deno\.(writeTextFile|writeFile|openKv|open)\b/);
    expect(code).not.toMatch(/localStorage|sessionStorage|caches\./);
  });

  it("un fallo inesperado no devuelve su detalle", () => {
    expect(code).not.toMatch(/detail\s*:/);
    expect(code).not.toMatch(/error\.message|String\(error/);
  });

  it("solo llama a Moodle, a dos rutas fijas, sin seguir redirecciones y con tope de tiempo", () => {
    expect([...code.matchAll(/\bfetch\(/g)]).toHaveLength(1);
    expect(code).toMatch(/redirect:\s*"error"/);
    expect(code).toMatch(/AbortSignal\.timeout\(/);
    expect(code).toMatch(/readCapped\(response\)/);
    // A dónde: solo las direcciones que arma moodleSite.
    expect([...code.matchAll(/\bpost\(([^,]+),/g)].map((m) => m[1].trim()).filter((a) => a !== "address: string").sort()).toEqual(["site.login", "site.rest"]);
    expect(code).toMatch(/privateAddress/);
    expect(code).toMatch(/resolveDns/);
  });

  it("la dirección de Moodle sale de la configuración, no del navegador", () => {
    // Los sitios salen de la tabla; cada dirección pasa por moodleSite, y la única que se usa es la del sitio elegido.
    expect(handler).toMatch(/const sites = openSites\(listed\.data\);/);
    expect(handler).toMatch(/const site = picked\.site\.at;/);
    expect(handler).not.toMatch(/moodleSite\(/);
    expect(code).toMatch(/const at = moodleSite\(r\.url\);/);
    // Del pedido solo se leen estas claves; el usuario y la contraseña, solo dentro de `credentials` (la lógica).
    expect(LOGIC_FROM).toBeGreaterThan(-1);
    expect(LOGIC_TO).toBeGreaterThan(LOGIC_FROM);
    expect([...new Set([...handler.matchAll(/\bbody\.([a-zA-Z_]+)/g)].map((m) => m[1]))].sort()).toEqual(["action", "course", "site", "token"]);
    expect([...new Set([...code.matchAll(/\bbody\.([a-zA-Z_]+)/g)].map((m) => m[1]))].sort()).toEqual(["action", "course", "password", "site", "token", "username"]);
    expect(handler).toMatch(/credentials\(body\)/);
    expect(code).not.toMatch(/body\.(url|moodle|host|address|fn|wsfunction|function)/);
    // `site` es solo un identificador: se usa una vez, para buscarlo entre los de la administración. Nunca llega a una consulta ni a una dirección.
    expect([...code.matchAll(/\bbody\.site\b/g)]).toHaveLength(1);
    expect(handler).toMatch(/const picked = pickSite\(sites, body\.site\);/);
  });

  it("de un sitio solo viajan al navegador su identificador y su nombre", () => {
    expect(handler).toMatch(/if \(action === "sitios"\) return json\(\{ sites: sites\.map\(\(s\) => \(\{ id: s\.id, name: s\.name \}\)\) \}\);/);
    expect(handler).toMatch(/json\(\{ token: login\.token, site_id: siteId, site: shapeSite\(info\.data\)\.info \}\)/);
    // Ninguna respuesta lleva la dirección revisada ni la fila de la tabla.
    for (const m of handler.matchAll(/\bjson\(([^\n]*)/g)) expect(m[1], m[1]).not.toMatch(/\bat\b|\.url\b|\.rest\b|\.login\b|\.host\b|listed|picked/);
    // Sin sitios no hay nada que listar: es el mismo «aún no disponible».
    expect(handler).toMatch(/if \(sites\.length === 0\) return fail\(OFF\);/);
    // «sitios» se atiende después de comprobar la cuenta y el límite, y antes de hablar con Moodle.
    expect(code.indexOf('account.rol !== "estudiante"')).toBeLessThan(code.indexOf('action === "sitios") return'));
    expect(code.indexOf("if (retry) return")).toBeLessThan(code.indexOf('action === "sitios") return'));
    expect(code.indexOf('action === "sitios") return')).toBeLessThan(code.indexOf("fetch("));
  });

  it("solo atiende a una cuenta de Pilo activa de estudiante o de profesor", () => {
    expect(code).toMatch(/auth\.getUser\(\)/);
    expect(code).toMatch(/account\.status !== "activa"/);
    expect(code).toMatch(/account\.rol !== "estudiante" && account\.rol !== "profesor"/);
    // La cuenta se comprueba antes de pedirle nada a Moodle.
    expect(code.indexOf('from("pilo_users")')).toBeLessThan(code.indexOf("fetch("));
    expect(code.indexOf('account.status !== "activa"')).toBeLessThan(code.indexOf('from("pilo_moodle_sites")'));
  });

  it("toda llamada al servicio de Moodle pasa por la lista cerrada", () => {
    const called = [...new Set([...code.matchAll(/\bcall\(\s*(?:login\.)?token,\s*"([^"]+)"/g)].map((m) => m[1]))];
    expect(called.length).toBeGreaterThan(0);
    for (const fn of called) expect(isClasesFn(fn), fn).toBe(true);
    // Ningún nombre de función de Moodle escrito fuera de la lista.
    for (const m of code.matchAll(/"((?:core|mod|gradereport|tool|block|enrol|message)_[a-z0-9_]+)"/g)) expect(isClasesFn(m[1]), m[1]).toBe(true);
    expect(code).toMatch(/moodleForm\(token, fn, params\)/);
  });

  it("es un solo archivo: no importa nada local", () => {
    expect(source).not.toMatch(/(?:from|import)\s*\(?\s*["']\.{1,2}\//);
  });

  it("las respuestas no se guardan en cachés", () => {
    expect(code).toMatch(/"Cache-Control":\s*"no-store"/);
  });

  it("está en config.toml con verify_jwt = false", () => {
    const config = readFileSync(resolve(__dirname, "../../../../supabase/config.toml"), "utf8").replace(/\r\n/g, "\n");
    expect(config).toMatch(/\[functions\.pilo-clases\]\n(#.*\n)*verify_jwt = false/);
  });
});
