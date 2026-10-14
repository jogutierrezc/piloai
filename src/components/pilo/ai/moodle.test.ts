/* =============================================================================
   Moodle (0116) · la lógica pura.

   Qué funciones del servicio web se pueden llamar (una lista cerrada), a qué
   dirección (https, pública, con la ruta fija), cómo se arma el pedido (el
   token en el cuerpo), cómo se limpia un error para que el token nunca salga,
   y cómo el HTML de un curso se vuelve pasajes de texto: solo estructura y
   contenido. La función de punta a punta está en funcion-preguntar.test.ts.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import {
  MOODLE_ALLOWED,
  MOODLE_CALLS,
  MOODLE_CALL_MS,
  MOODLE_EXTRA,
  MOODLE_MAX_PASSAGES,
  MOODLE_PATH,
  MOODLE_TOTAL_MS,
  htmlToText,
  isMoodleFn,
  moodleClean,
  moodleEndpoint,
  moodleExtras,
  moodleFault,
  moodleForm,
  moodleModnames,
  moodlePassages,
  moodleSite,
  privateAddress,
  redactContacts,
} from "./logic";

const TOKEN = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("MOODLE_ALLOWED: una lista cerrada, solo de lectura de cursos", () => {
  it("son exactamente las funciones del plan", () => {
    expect([...MOODLE_ALLOWED]).toEqual([
      "core_webservice_get_site_info",
      "core_course_get_categories",
      "core_course_get_courses_by_field",
      "core_course_get_contents",
      "mod_page_get_pages_by_courses",
      "mod_book_get_books_by_courses",
      "mod_label_get_labels_by_courses",
      "mod_url_get_urls_by_courses",
      "mod_resource_get_resources_by_courses",
      "mod_folder_get_folders_by_courses",
    ]);
    for (const [, fn] of MOODLE_EXTRA) expect(MOODLE_ALLOWED).toContain(fn);
  });

  it("nada de matrícula, notas, entregas, mensajes, foros ni escritura", () => {
    for (const fn of MOODLE_ALLOWED) expect(fn).not.toMatch(/enrol|grade|user|assign|submission|message|forum|quiz|create|update|delete|add|set_|upload|login|token/);
    for (const fn of [
      "core_enrol_get_enrolled_users",
      "gradereport_user_get_grade_items",
      "mod_assign_get_submissions",
      "core_message_get_messages",
      "mod_forum_get_forum_discussions",
      "core_user_get_users_by_field",
      "core_course_delete_courses",
      "CORE_COURSE_GET_CONTENTS",
      "core_course_get_contents ",
      "",
      null,
      42,
    ]) {
      expect(isMoodleFn(fn), String(fn)).toBe(false);
      expect(moodleForm(TOKEN, String(fn))).toBeNull();
    }
  });

  it("los topes de un curso: 5 pedidos de 20 s, 90 s en total y 400 pasajes", () => {
    expect([MOODLE_CALLS, MOODLE_CALL_MS, MOODLE_TOTAL_MS, MOODLE_MAX_PASSAGES]).toEqual([5, 20_000, 90_000, 400]);
  });
});

describe("moodleForm: el token va en el cuerpo", () => {
  it("formulario con token, función, formato y los parámetros; las listas, con índice", () => {
    const form = new URLSearchParams(moodleForm(TOKEN, "mod_page_get_pages_by_courses", { courseids: [42, 43] }) ?? "");
    expect([...form]).toEqual([["wstoken", TOKEN], ["wsfunction", "mod_page_get_pages_by_courses"], ["moodlewsrestformat", "json"], ["courseids[0]", "42"], ["courseids[1]", "43"]]);
    expect(moodleForm(TOKEN, "core_course_get_courses_by_field", { field: "category", value: 3 })).toBe(`wstoken=${TOKEN}&wsfunction=core_course_get_courses_by_field&moodlewsrestformat=json&field=category&value=3`);
  });

  it("un parámetro no puede cambiar la función, el token ni el formato", () => {
    const form = new URLSearchParams(moodleForm(TOKEN, "core_course_get_contents", { courseid: 42, wsfunction: "core_enrol_get_enrolled_users", WSTOKEN: "otro", moodlewsrestformat: "xml" }) ?? "");
    expect(form.getAll("wsfunction")).toEqual(["core_course_get_contents"]);
    expect(form.getAll("wstoken")).toEqual([TOKEN]);
    expect(form.getAll("moodlewsrestformat")).toEqual(["json"]);
    expect(form.has("WSTOKEN")).toBe(false);
  });
});

describe("moodleEndpoint: solo https, solo un dominio público y la ruta fija", () => {
  it("acepta el sitio, con o sin carpeta, y le pone la ruta del servicio", () => {
    expect(moodleEndpoint("https://campus.udes.edu.co")).toEqual({ ok: true, url: `https://campus.udes.edu.co${MOODLE_PATH}`, site: "https://campus.udes.edu.co", host: "campus.udes.edu.co" });
    expect(moodleEndpoint(" https://Campus.UDES.edu.co/moodle/ ")).toMatchObject({ ok: true, url: "https://campus.udes.edu.co/moodle/webservice/rest/server.php", site: "https://campus.udes.edu.co/moodle" });
    // Si pegaron la dirección del servicio entera, no se duplica.
    expect(moodleEndpoint("https://campus.udes.edu.co/moodle/webservice/rest/server.php")).toMatchObject({ ok: true, url: "https://campus.udes.edu.co/moodle/webservice/rest/server.php" });
    expect(MOODLE_PATH).toBe("/webservice/rest/server.php");
  });

  it("rechaza lo que no es https, las IP escritas de cualquier forma, localhost y las redes internas", () => {
    const bad = [
      "",
      "campus.udes.edu.co",
      "http://campus.udes.edu.co",
      "ftp://campus.udes.edu.co",
      "javascript:alert(1)",
      "file:///etc/passwd",
      // IP literal, privada o no.
      "https://192.168.1.10",
      "https://10.0.0.5/moodle",
      "https://172.16.0.1",
      "https://127.0.0.1",
      "https://169.254.169.254/latest/meta-data",
      "https://8.8.8.8",
      // La misma IP en decimal, hexadecimal, octal o abreviada.
      "https://2130706433",
      "https://0x7f000001",
      "https://0x7f.0.0.1",
      "https://0177.0.0.1",
      "https://127.1",
      "https://3232235777",
      // IPv6, también con una IPv4 dentro.
      "https://[::1]",
      "https://[::ffff:127.0.0.1]",
      "https://[::ffff:7f00:1]",
      "https://[fd00::1]",
      "https://[fe80::1]",
      "https://[2001:db8::1]",
      // Nombres de red interna y comodines que resuelven a una IP.
      "https://localhost",
      "https://LOCALHOST/moodle",
      "https://moodle",
      "https://moodle.local",
      "https://moodle.internal",
      "https://app.localhost",
      "https://moodle.intranet",
      "https://127.0.0.1.nip.io",
      "https://10-0-0-1.sslip.io",
      // Usuario, puerto, consulta, ancla y trucos de escritura.
      "https://admin:clave@campus.udes.edu.co",
      "https://campus.udes.edu.co@127.0.0.1",
      "https://campus.udes.edu.co:8443",
      "https://campus.udes.edu.co/?wstoken=x",
      "https://campus.udes.edu.co/#x",
      "https://campus.udes.edu.co/a b",
      "https://campus.udes.edu.co\\@127.0.0.1",
      "https://campus.udes.edu.co/%2e%2e/admin",
      "https://campus.udes.edu.co/moodle/../../admin",
      "https://127.0.0.1%2Ecampus.udes.edu.co",
      "https://campus.udes.edu.co/" + "a".repeat(300),
      null,
      42,
      { url: "https://campus.udes.edu.co" },
    ];
    for (const site of bad) {
      const out = moodleEndpoint(site);
      expect(out.ok, String(site)).toBe(false);
      if (!out.ok) expect(out.reason.length, String(site)).toBeGreaterThan(10);
    }
    // El punto final de un nombre absoluto se quita: es el mismo sitio público.
    expect(moodleEndpoint("https://campus.udes.edu.co./moodle")).toMatchObject({ ok: true, host: "campus.udes.edu.co" });
  });

  it("la dirección que resulta nunca lleva consulta, usuario ni otra ruta que la del servicio", () => {
    for (const site of ["https://campus.udes.edu.co", "https://campus.udes.edu.co/moodle", "https://aula.virtual.udes.edu.co/a/b"]) {
      const out = moodleEndpoint(site);
      expect(out.ok).toBe(true);
      if (!out.ok) continue;
      const u = new URL(out.url);
      expect([u.protocol, u.username, u.password, u.port, u.search, u.hash]).toEqual(["https:", "", "", "", "", ""]);
      expect(u.pathname.endsWith(MOODLE_PATH)).toBe(true);
    }
  });
});

describe("privateAddress: adónde no puede llevar un nombre", () => {
  it("privadas, locales y reservadas, en IPv4 y en IPv6", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "999.1.1.1"]) expect(privateAddress(ip), ip).toBe(true);
    for (const ip of ["::1", "::", "[::1]", "fd12:3456::1", "fc00::1", "fe80::1%eth0", "ff02::1", "::ffff:10.0.0.1", "::ffff:a00:1", "64:ff9b::a00:1", "2001:db8::1", "0:0:0:0:0:0:0:1"]) expect(privateAddress(ip), ip).toBe(true);
    // Lo que no se entiende no pasa.
    for (const ip of ["", "localhost", "no es una ip", "1.2.3", "12345"]) expect(privateAddress(ip), ip).toBe(true);
  });

  it("las públicas pasan", () => {
    for (const ip of ["8.8.8.8", "190.85.1.1", "172.32.0.1", "172.15.0.1", "100.63.0.1", "2800:e2:1::10", "2607:f8b0:4005:80a::200e"]) expect(privateAddress(ip), ip).toBe(false);
  });
});

describe("moodleClean: el token no sale en ningún error", () => {
  it("lo quita escrito tal cual, como parámetro, en una dirección y aunque sea otro", () => {
    const other = "ffeeddccbbaa99887766554433221100";
    const samples: unknown[] = [
      `Invalid token - token ${TOKEN} not found`,
      `POST https://campus.udes.edu.co/webservice/rest/server.php?wstoken=${TOKEN}&wsfunction=core_course_get_contents failed`,
      `wstoken=${TOKEN}&wsfunction=x`,
      `{"wstoken":"${TOKEN}","debuginfo":"token ${other}"}`,
      new TypeError(`fetch failed: https://campus.udes.edu.co/webservice/rest/server.php?wstoken=${TOKEN}`),
      { exception: "x", debuginfo: `SELECT * FROM mdl_external_tokens WHERE token = '${TOKEN}'` },
      `https://campus.udes.edu.co/login/index.php?token=${other}#${TOKEN}`,
      encodeURIComponent(`clave ${TOKEN}`),
    ];
    for (const s of samples) {
      const out = moodleClean(s, TOKEN);
      expect(out, String(s)).not.toContain(TOKEN);
      expect(out).not.toContain(other);
      expect(out).not.toMatch(/\?/);
      expect(out.length).toBeLessThanOrEqual(240);
    }
    expect(moodleClean(`Invalid token - token ${TOKEN} not found`, TOKEN)).toBe("Invalid token - token [token] not found");
    // Un token corto o raro (no de 32 hexadecimales) también se quita si es el guardado.
    expect(moodleClean("el token tok-CORTO-1 no sirve", "tok-CORTO-1")).toBe("el token [token] no sirve");
    // Sin saber el token, lo que se parece a uno se quita igual.
    expect(moodleClean(`token ${TOKEN}`)).toBe("token [token]");
    expect(moodleClean("x".repeat(1000), TOKEN)).toHaveLength(240);
    expect(moodleClean(undefined, TOKEN)).toBe("undefined");
  });

  it("moodleFault reconoce el error que llega con 200 y lo dice sin el token", () => {
    expect(moodleFault({ exception: "moodle_exception", errorcode: "invalidtoken", message: `Invalid token - token ${TOKEN} not found` }, TOKEN)).toEqual({
      code: "invalidtoken",
      message: "Moodle no aceptó el token: revise que sea el del usuario técnico y que no haya vencido",
    });
    const odd = moodleFault({ exception: "dml_exception", errorcode: "dmlreadexception", message: `Error reading ?wstoken=${TOKEN}`, debuginfo: TOKEN }, TOKEN);
    expect(odd?.code).toBe("dmlreadexception");
    expect(JSON.stringify(odd)).not.toContain(TOKEN);
    expect(moodleFault({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" })?.message).toContain("no tiene permiso");
    expect(moodleFault({ exception: "x" })).toEqual({ code: "x", message: "Moodle respondió con un error" });
    // Una respuesta normal no es un error.
    for (const ok of [[], [{ id: 1 }], { courses: [] }, { sitename: "Campus" }, null, "texto", 3]) expect(moodleFault(ok)).toBeNull();
  });

  it("moodleSite dice qué funciones de la lista puede usar el token, y nada del usuario", () => {
    const site = moodleSite({ sitename: "Campus <b>UDES</b>", release: "4.1.2", username: "pilo_ws", userid: 99, fullname: "Pilo Técnico", userprivateaccesskey: TOKEN, functions: [{ name: "core_webservice_get_site_info" }, { name: "core_course_get_contents" }, { name: "core_enrol_get_enrolled_users" }, null, "x"] });
    expect(site.name).toBe("Campus UDES");
    expect(site.usable).toEqual(["core_webservice_get_site_info", "core_course_get_contents"]);
    expect(site.missing).toHaveLength(MOODLE_ALLOWED.length - 2);
    expect(Object.keys(site.functions)).toEqual([...MOODLE_ALLOWED]);
    const text = JSON.stringify(site);
    for (const hidden of ["pilo_ws", "99", "Pilo Técnico", TOKEN, "core_enrol_get_enrolled_users"]) expect(text).not.toContain(hidden);
    expect(moodleSite(null).usable).toEqual([]);
    expect(moodleSite({ functions: "todas" }).usable).toEqual([]);
  });
});

describe("htmlToText: el HTML de Moodle como texto plano", () => {
  it("quita scripts, estilos y marcos con todo lo que llevan dentro", () => {
    const html =
      '<style>p { color: red }</style><p>Antes</p><script type="text/javascript">alert("x"); document.write("<p>inyectado</p>")</script>' +
      '<iframe src="https://externo.example/video"><p>dentro del marco</p></iframe><noscript>sin script</noscript><!-- un comentario --><p>Después</p>';
    expect(htmlToText(html)).toBe("Antes\n\nDespués");
    // Uno sin cerrar se lleva lo que sigue.
    expect(htmlToText("<p>Visible</p><script>var a = 1; <p>no debe salir</p>")).toBe("Visible");
    expect(htmlToText("<p>Visible</p><SCRIPT SRC=x>malo()</SCRIPT ><p>Fin</p>")).toBe("Visible\n\nFin");
    expect(htmlToText("Texto <!-- comentario sin cerrar <p>oculto</p>")).toBe("Texto");
  });

  it("los bloques son saltos de línea; las listas y las tablas se leen", () => {
    expect(htmlToText("<h2>Título</h2><p>Uno<br>dos<br/>tres</p><div>Cuatro</div>")).toBe("Título\n\nUno\ndos\ntres\n\nCuatro");
    expect(htmlToText("<ul><li>Primero</li><li>Segundo</li></ul>")).toBe("- Primero\n\n- Segundo");
    expect(htmlToText("<table><tr><th>Corte</th><th>Peso</th></tr><tr><td>P1</td><td>30 %</td></tr></table>")).toBe("Corte · Peso\n\nP1 · 30 %");
    expect(htmlToText("<p>  Muchos   espacios \n\n\n y   saltos </p>")).toBe("Muchos espacios\n\ny saltos");
  });

  it("lee las entidades", () => {
    expect(htmlToText("Educaci&oacute;n &amp; did&aacute;ctica &#8212; a&ntilde;o&nbsp;2026 &#x2713; &iquest;s&iacute;? &lt;b&gt; &quot;cita&quot;")).toBe('Educación & didáctica — año 2026 ✓ ¿sí? <b> "cita"');
    // No se decodifica dos veces, y una entidad desconocida o inválida no rompe nada.
    expect(htmlToText("&amp;lt;script&amp;gt; &noexiste; &#0; &#x110000; &#55357;")).toBe("&lt;script&gt; &noexiste;");
  });

  it("de un enlace queda su texto, sin la dirección; de una imagen, nada", () => {
    expect(htmlToText('<p>Lea <a href="https://externo.example/doc.pdf?token=abc" target="_blank">el reglamento</a> y <a href=\'javascript:alert(1)\'>pulse aquí</a>.</p>')).toBe("Lea el reglamento y pulse aquí.");
    expect(htmlToText('<p>Foto: <img src="https://campus.udes.edu.co/pluginfile.php/1/foto.png" alt="Aula" onerror="x()"></p>')).toBe("Foto:");
    expect(htmlToText('<a href="https://x.example"')).toBe("");
  });

  it("no falla con lo que no es HTML", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("Texto simple, con 3 < 5 y 5 > 3.")).toBe("Texto simple, con 3 < 5 y 5 > 3.");
    expect(htmlToText(undefined as unknown as string)).toBe("");
    expect(htmlToText(42 as unknown as string)).toBe("42");
  });
});

describe("redactContacts", () => {
  it("quita correos, teléfonos y documentos, y cuenta cuántos", () => {
    const out = redactContacts("Escriba a ana.perez@udes.edu.co o llame al 300 123 4567 (fijo 607 651 6500). C.C. 1.098.765.432. El curso tiene 3 créditos, es de 2026 y sigue la Ley 30 de 1992.");
    expect(out.text).toBe("Escriba a [dato omitido] o llame al [dato omitido] (fijo [dato omitido]). [dato omitido]. El curso tiene 3 créditos, es de 2026 y sigue la Ley 30 de 1992.");
    expect(out.count).toBe(4);
    expect(redactContacts("Sin datos de nadie.")).toEqual({ text: "Sin datos de nadie.", count: 0 });
  });
});

const SITE = "https://campus.udes.edu.co";
const course = { id: 42, fullname: "Didáctica <b>general</b>", shortname: "DID-01", summary: "<p>Curso sobre cómo enseñar y evaluar en la universidad, con ejemplos de aula.</p>", url: `${SITE}/course/view.php?id=42` };
const contents = [
  {
    id: 1,
    name: "",
    summary: "",
    modules: [{ id: 500, name: "Avisos", modname: "forum", url: `${SITE}/mod/forum/view.php?id=500`, description: "" }],
  },
  {
    id: 2,
    name: "Unidad <i>1</i>",
    summary: "<p>La unidad presenta la evaluación formativa y sus momentos.</p>",
    modules: [
      { id: 501, name: "Lectura: evaluar para aprender", modname: "page", url: `${SITE}/mod/page/view.php?id=501`, description: "<p>Lectura obligatoria de la semana, con una guía de preguntas.</p>" },
      {
        id: 502,
        name: "Foro de dudas",
        modname: "forum",
        url: `${SITE}/mod/forum/view.php?id=502`,
        description: "<p>Use este foro para plantear las dudas de la unidad. Tutor: tutor@udes.edu.co</p>",
        discussions: [{ author: "Ana Pérez", message: "Mi nota fue 2,5." }],
        contents: [{ filename: "notas.xlsx", fileurl: `${SITE}/pluginfile.php/9/notas.xlsx?token=abc`, author: "Luis Gómez" }],
      },
      { id: 503, name: "Tarea 1", modname: "assign", url: "http://inseguro.example/x", description: "<p>Entregue un plan de clase con una actividad de evaluación formativa.</p>", dates: [{ label: "Vence", timestamp: 1790000000 }], submissions: [{ userid: 7, grade: 4.5 }] },
      { id: 504, name: "Borrador oculto", modname: "book", visible: 0, description: "<p>Esto está oculto para los estudiantes y no debe entrar a la memoria.</p>" },
      { id: 505, name: "Solo para tutores", modname: "page", uservisible: false, description: "<p>Esto no lo ve el usuario técnico y tampoco debe entrar a la memoria.</p>" },
      { id: 506, name: "Enlace sin descripción", modname: "url", url: `${SITE}/mod/url/view.php?id=506` },
    ],
  },
  { id: 3, name: "Unidad oculta", visible: 0, summary: "<p>Sección oculta con contenido que no debe entrar a la memoria.</p>", modules: [{ id: 601, name: "Página oculta", modname: "page", description: "<p>Contenido de una sección oculta, que no debe leerse.</p>" }] },
];

describe("moodlePassages: solo estructura y contenido", () => {
  const extras = moodleExtras({ pages: [{ coursemodule: 501, intro: "<p>Lectura obligatoria de la semana, con una guía de preguntas.</p>", content: "<h2>Evaluar para aprender</h2><p>La Ley 30 de 1992 organiza la educación superior.</p><script>x()</script>", contentfiles: [{ fileurl: "x", author: "Luis Gómez" }], timemodified: 1 }], warnings: [] });
  const built = moodlePassages(course, contents, extras);

  it("título = el curso, sección = sección › actividad, ruta = la dirección de la actividad", () => {
    expect(built.rows.map((r) => [r.seq, r.title, r.section, r.path])).toEqual([
      [1, "Didáctica general", "Presentación", `${SITE}/course/view.php?id=42`],
      [2, "Didáctica general", "General", `${SITE}/course/view.php?id=42`],
      [3, "Didáctica general", "Unidad 1", `${SITE}/course/view.php?id=42`],
      [4, "Didáctica general", "Unidad 1 › Lectura: evaluar para aprender", `${SITE}/mod/page/view.php?id=501`],
      [5, "Didáctica general", "Unidad 1 › Foro de dudas", `${SITE}/mod/forum/view.php?id=502`],
      // Una dirección que no es https no se guarda: queda la del curso.
      [6, "Didáctica general", "Unidad 1 › Tarea 1", `${SITE}/course/view.php?id=42`],
    ]);
    expect(built.rows.every((r) => r.cut === "")).toBe(true);
    expect(built.activities).toBe(3);
    expect(built.dropped).toBe(0);
  });

  it("el cuerpo es texto: la sección dice qué actividades tiene, y la página trae su contenido una sola vez", () => {
    expect(built.rows[1].body).toBe("General\nActividades de esta sección: Avisos.");
    expect(built.rows[2].body).toBe("Unidad 1\nLa unidad presenta la evaluación formativa y sus momentos.\nActividades de esta sección: Lectura: evaluar para aprender; Foro de dudas; Tarea 1; Enlace sin descripción.");
    expect(built.rows[3].body).toBe("Lectura obligatoria de la semana, con una guía de preguntas.\nEvaluar para aprender\nLa Ley 30 de 1992 organiza la educación superior.");
  });

  it("de un foro y de una tarea, solo el nombre y la descripción; nada de personas, notas, entregas, archivos ni fechas", () => {
    expect(built.rows[4].body).toBe("Use este foro para plantear las dudas de la unidad. Tutor: [dato omitido]");
    expect(built.rows[5].body).toBe("Entregue un plan de clase con una actividad de evaluación formativa.");
    expect(built.redacted).toBe(1);
    const text = JSON.stringify(built);
    for (const bad of ["Ana Pérez", "Mi nota", "Luis Gómez", "notas.xlsx", "pluginfile", "4.5", "1790000000", "tutor@", "x()", "<p>", "<h2>", "inseguro.example"]) expect(text, bad).not.toContain(bad);
  });

  it("lo oculto no entra: ni la actividad, ni la sección, ni lo que el usuario técnico no ve", () => {
    const text = JSON.stringify(built);
    for (const bad of ["Borrador oculto", "Solo para tutores", "Unidad oculta", "Página oculta", "no debe entrar", "no debe leerse"]) expect(text, bad).not.toContain(bad);
    expect(moodleModnames(contents).sort()).toEqual(["assign", "forum", "page", "url"]);
  });

  it("moodleExtras solo lee la presentación y el contenido, por id de módulo", () => {
    expect(Object.keys(extras)).toEqual(["501"]);
    expect(extras["501"]).not.toContain("Luis Gómez");
    expect(moodleExtras({ books: [{ coursemodule: 7, intro: "<p>Un libro</p>" }, { coursemodule: "x", intro: "malo" }, { coursemodule: 8, intro: "" }], labels: "no", urls: [{ coursemodule: 9, intro: "<p>Un enlace</p>", externalurl: "https://externo.example" }] })).toEqual({ "7": "<p>Un libro</p>", "9": "<p>Un enlace</p>" });
    for (const bad of [null, [], "texto", { exception: "x" }]) expect(moodleExtras(bad)).toEqual({});
  });

  it("parte lo largo, corta en 400 pasajes y no falla con datos raros", () => {
    const long = moodlePassages({ id: 1, fullname: "Curso largo" }, [{ name: "Unidad", modules: [{ id: 1, name: "Página", modname: "page", description: `<p>${"Una frase de relleno para el curso. ".repeat(200)}</p>` }] }]);
    expect(long.rows.length).toBeGreaterThan(4);
    for (const r of long.rows) expect(r.body.length).toBeLessThanOrEqual(1400);
    const huge = moodlePassages({ id: 1, fullname: "Curso enorme" }, Array.from({ length: 450 }, (_, i) => ({ name: `Unidad ${i + 1}`, summary: "<p>Una unidad con su resumen, lo bastante larga para contar.</p>", modules: [] })));
    expect(huge.rows).toHaveLength(400);
    expect(huge.dropped).toBe(50);
    expect(huge.rows.map((r) => r.seq)).toEqual(Array.from({ length: 400 }, (_, i) => i + 1));
    for (const bad of [null, "texto", { exception: "x" }, [null, 3, "x", { modules: "no" }, { name: 7, modules: [null, { name: null }, { id: 1, name: "Sin texto" }] }]]) {
      expect(() => moodlePassages({ id: 9, fullname: "" }, bad)).not.toThrow();
    }
    expect(moodlePassages({ id: 9, fullname: "" }, []).rows).toEqual([]);
    expect(moodlePassages({ id: 9, fullname: "", summary: `<p>${"Presentación del curso. ".repeat(3)}</p>` }, []).rows[0]).toMatchObject({ title: "Curso 9", section: "Presentación", path: "" });
  });
});
