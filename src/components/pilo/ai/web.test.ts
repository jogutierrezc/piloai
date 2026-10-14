/* =============================================================================
   Páginas web (0129): la dirección que Pilo acepta leer desde el servidor y
   los pasajes que saca del HTML de una página. Sin red.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { WEB_BROWSER_CLICKS, WEB_MAX_BYTES, WEB_MAX_PASSAGES, browserEndpoint, browserResult, browserWhy, webAddress, webPassages } from "./logic";

describe("la dirección de una página web", () => {
  it("acepta una página https de un dominio público y le quita lo privado", () => {
    expect(webAddress(" https://www.udes.edu.co/admisiones?utm_source=x&sede=cucuta#fechas ")).toEqual({ ok: true, url: "https://www.udes.edu.co/admisiones?sede=cucuta", host: "www.udes.edu.co" });
  });

  it("rechaza lo que no es https, las direcciones IP y los nombres de red interna", () => {
    for (const bad of ["", "http://www.udes.edu.co/", "ftp://udes.edu.co", "https://192.168.1.10/", "https://2130706433/", "https://[::1]/", "https://localhost/", "https://intranet/", "https://servidor.internal/x", "https://a.nip.io/", "https://udes.edu.co:8443/", "https://usuario@udes.edu.co/", "https://udes.edu.co/a b"]) {
      expect(webAddress(bad).ok, bad).toBe(false);
    }
    expect(webAddress(42).ok).toBe(false);
  });
});

describe("los pasajes de una página web", () => {
  const html = `<!doctype html><html><head><title>Admisiones | UDES</title><style>p{color:red}</style></head><body>
    <header><a href="/">Inicio</a> Menú del sitio que no es contenido de la página</header>
    <nav>Programas Admisiones Investigación Bienestar Contacto y más enlaces del menú</nav>
    <main>
      <h1>Admisiones de pregrado</h1>
      <p>La inscripción se hace en línea, desde el formulario de aspirantes de la universidad.</p>
      <h2>Documentos</h2>
      <p>Se pide el documento de identidad y el diploma de bachiller. Dudas al correo admisiones@udes.edu.co o al 607 651 6500.</p>
      <h3>Formato</h3>
      <p>Los documentos se cargan en PDF, legibles y completos; uno ilegible se devuelve.</p>
      <h2>Calendario</h2>
      <p>Las inscripciones abren al comienzo de cada periodo académico y cierran una semana antes.</p>
      <form><input name="q"><button>Buscar en el sitio con este formulario largo</button></form>
      <script>var secreto = "esto no se lee nunca, aunque sea largo";</script>
    </main>
    <footer>Universidad de Santander. Todos los derechos reservados. Dirección y redes.</footer>
  </body></html>`;

  it("parte la página por sus títulos y deja por fuera menús, pies, formularios y código", () => {
    const page = webPassages("https://www.udes.edu.co/admisiones", html);
    expect(page.title).toBe("Admisiones de pregrado");
    expect(page.sections).toEqual(["Presentación", "Documentos", "Calendario"]);
    expect(page.rows.map((r) => r.section)).toEqual(["Presentación", "Documentos", "Documentos › Formato", "Calendario"]);
    expect(page.rows.map((r) => r.seq)).toEqual([1, 2, 3, 4]);
    expect(page.rows.every((r) => r.title === "Admisiones de pregrado" && r.path === "https://www.udes.edu.co/admisiones")).toBe(true);
    const all = page.rows.map((r) => r.body).join("\n");
    expect(all).not.toMatch(/Menú del sitio|Programas Admisiones|derechos reservados|secreto|Buscar en el sitio|color:red/);
    expect(all).toContain("formulario de aspirantes");
  });

  it("omite correos y teléfonos, y lo cuenta", () => {
    const page = webPassages("https://www.udes.edu.co/admisiones", html);
    expect(page.rows[1].body).not.toMatch(/admisiones@udes\.edu\.co/);
    expect(page.rows[1].body).toContain("[dato omitido]");
    expect(page.redacted).toBeGreaterThanOrEqual(1);
  });

  it("sin <main>, lee el cuerpo sin la cabecera del sitio; sin título, usa el de la pestaña", () => {
    const page = webPassages("https://www.udes.edu.co/x", `<html><head><title>Biblioteca · Servicios</title></head><body><header>Menú principal del sitio con muchos enlaces</header><div><p>El préstamo de libros se hace con el carné vigente, en el mostrador.</p></div></body></html>`);
    expect(page.title).toBe("Biblioteca · Servicios");
    expect(page.rows).toHaveLength(1);
    expect(page.rows[0].body).not.toContain("Menú principal");
  });

  it("no repite un mismo párrafo, ignora lo muy corto y tiene tope", () => {
    const same = "<p>Este párrafo se repite muchas veces en la página, igual cada vez.</p>";
    const many = Array.from({ length: WEB_MAX_PASSAGES + 30 }, (_, i) => `<h2>Sección ${i}</h2><p>${"Contenido distinto de la sección número " + i + ". "}${"x".repeat(1300)}</p>`).join("");
    const page = webPassages("https://www.udes.edu.co/x", `<body>${same}${same}<p>Corto.</p>${many}</body>`);
    expect(page.rows.filter((r) => r.body.includes("se repite"))).toHaveLength(1);
    expect(page.rows.some((r) => r.body === "Corto.")).toBe(false);
    expect(page.rows).toHaveLength(WEB_MAX_PASSAGES);
    expect(page.dropped).toBeGreaterThan(0);
  });

  it("una página sin texto no deja pasajes", () => {
    expect(webPassages("https://www.udes.edu.co/x", `<body><div id="root"></div><script>render()</script></body>`).rows).toEqual([]);
  });
});

/* Lo plegado que SÍ viene en el HTML (pestañas, <details>, bloques con `hidden`
   o display:none): el lector del servidor no mira estilos ni atributos, así
   que ya lo lee. Esta prueba lo deja fijo. */
describe("lo plegado que viene en el HTML", () => {
  it("se lee aunque esté oculto: paneles de pestaña, <details> cerrados y bloques con hidden o display:none", () => {
    const page = webPassages(
      "https://www.udes.edu.co/admisiones",
      `<body><main>
        <h1>Admisiones</h1>
        <div role="tabpanel" id="p1"><p>Pregrado: la inscripción abre en octubre de cada año, en línea.</p></div>
        <div role="tabpanel" id="p2" hidden><p>Posgrado: la inscripción abre en enero de cada año, en línea.</p></div>
        <details><summary>Requisitos</summary><p>Documento de identidad y diploma de bachiller, en PDF.</p></details>
        <div class="collapse" style="display:none"><p>El valor de la matrícula depende del programa elegido.</p></div>
        <div aria-hidden="true"><p>La sede de Cúcuta atiende de lunes a sábado en horario continuo.</p></div>
      </main></body>`,
    );
    const all = page.rows.map((r) => r.body).join("\n");
    for (const text of ["Pregrado: la inscripción", "Posgrado: la inscripción", "Requisitos", "Documento de identidad", "El valor de la matrícula", "La sede de Cúcuta"]) expect(all, text).toContain(text);
  });
});

/* --- Con navegador (0132) ----------------------------------------------------------------- */

describe("la dirección del servicio de navegador", () => {
  it("acepta https con dominio público, con puerto y ruta de base, y dice a dónde se pide", () => {
    expect(browserEndpoint(" https://navegador.udes.edu.co/ ")).toEqual({ ok: true, url: "https://navegador.udes.edu.co/leer", base: "https://navegador.udes.edu.co", host: "navegador.udes.edu.co" });
    expect(browserEndpoint("https://servicios.udes.edu.co:8443/pilo/navegador")).toEqual({ ok: true, url: "https://servicios.udes.edu.co:8443/pilo/navegador/leer", base: "https://servicios.udes.edu.co:8443/pilo/navegador", host: "servicios.udes.edu.co" });
    // Si pegaron la dirección con /leer, es la misma.
    expect(browserEndpoint("https://navegador.udes.edu.co/leer")).toMatchObject({ ok: true, url: "https://navegador.udes.edu.co/leer" });
  });

  it("rechaza lo que no es https, las IP, los nombres de red interna, el usuario, la consulta y el ancla", () => {
    for (const bad of ["", "navegador.udes.edu.co", "http://navegador.udes.edu.co", "https://10.0.0.5:8787", "https://127.0.0.1", "https://[::1]:8787", "https://localhost:8787", "https://navegador", "https://navegador.internal", "https://a.nip.io", "https://clave@navegador.udes.edu.co", "https://navegador.udes.edu.co/?a=1", "https://navegador.udes.edu.co/#x", "https://navegador.udes.edu.co/a/../b", "https://navegador.udes.edu.co/a b"]) {
      expect(browserEndpoint(bad).ok, bad).toBe(false);
    }
    expect(browserEndpoint(null).ok).toBe(false);
  });
});

describe("lo que devuelve el servicio de navegador", () => {
  const good = { url: "https://www.udes.edu.co/admisiones?utm_source=x#a", title: "Admisiones", html: "<main><p>Hola</p></main>", clicks: [{ what: "pestaña · Posgrado", ok: true }, { what: "  ver   más · Ver más ", ok: false }, { what: 7, ok: "sí" }, null], cut: false, ms: 900 };

  it("se acepta con la dirección final revisada y los clics limpios", () => {
    expect(browserResult(good)).toEqual({
      ok: true,
      page: { url: "https://www.udes.edu.co/admisiones", html: "<main><p>Hola</p></main>", cut: false, clicks: [{ what: "pestaña · Posgrado", ok: true }, { what: "ver más · Ver más", ok: false }, { what: "", ok: false }, { what: "", ok: false }] },
    });
  });

  it("si el navegador terminó en una dirección que Pilo no lee, o no trajo página, no vale", () => {
    for (const url of ["http://www.udes.edu.co/", "https://192.168.1.10/", "https://localhost/", "https://intranet/", "", undefined]) expect(browserResult({ ...good, url }), String(url)).toMatchObject({ ok: false });
    for (const html of ["", "   ", undefined, 42]) expect(browserResult({ ...good, html }), String(html)).toMatchObject({ ok: false, reason: "el navegador no devolvió la página" });
    for (const junk of [null, undefined, "texto", 7, []]) expect(browserResult(junk).ok).toBe(false);
  });

  it("tiene topes: el HTML se recorta y los clics también", () => {
    const big = browserResult({ ...good, html: "x".repeat(WEB_MAX_BYTES + 10), clicks: Array.from({ length: 500 }, () => ({ what: "y".repeat(500), ok: true })) });
    expect(big.ok && big.page.html.length).toBe(WEB_MAX_BYTES);
    expect(big.ok && big.page.cut).toBe(true);
    expect(big.ok && big.page.clicks.length).toBe(WEB_BROWSER_CLICKS);
    expect(big.ok && big.page.clicks[0].what.length).toBe(120);
    expect(browserResult({ ...good, cut: true })).toMatchObject({ ok: true, page: { cut: true } });
  });

  it("el HTML del navegador se vuelve pasajes como cualquier página", () => {
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Admisiones | UDES</title></head><body><main>
<h1>Admisiones</h1>
<p>La inscripción se hace en línea, desde el formulario de aspirantes de la universidad.</p>
<h2>Posgrado</h2>
<p>Este texto solo aparece al pulsar la pestaña «Posgrado»: abre en enero. Dudas a posgrados@udes.edu.co.</p>
</main></body></html>`;
    const read = browserResult({ ...good, html });
    const page = read.ok ? webPassages(read.page.url, read.page.html) : null;
    expect(page?.title).toBe("Admisiones");
    expect(page?.rows.map((r) => r.section)).toEqual(["Presentación", "Posgrado"]);
    expect(page?.rows[1].body).toContain("abre en enero");
    expect(page?.rows[1].body).toContain("[dato omitido]");
    expect(page?.rows[1].path).toBe("https://www.udes.edu.co/admisiones");
  });

  it("por qué no se pudo, dicho sin la clave ni lo que respondió el servicio", () => {
    expect(browserWhy(401, "clave")).toBe("el navegador rechazó la clave");
    expect(browserWhy(403, "otro")).toBe("el navegador rechazó la clave");
    // El servicio responde 403 cuando robots.txt no deja: eso no es la clave.
    expect(browserWhy(403, "robots")).toBe("el sitio no deja entrar a MrPiloBot (robots.txt)");
    expect(browserWhy(429, undefined)).toBe("el navegador está ocupado");
    expect(browserWhy(504, "tiempo")).toBe("la página tardó demasiado en el navegador");
    expect(browserWhy(400, "direccion")).toBe("el navegador no acepta esa dirección");
    expect(browserWhy(502, { raro: true })).toBe("el navegador no pudo abrir la página");
  });
});
