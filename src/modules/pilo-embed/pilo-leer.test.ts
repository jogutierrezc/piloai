// @vitest-environment jsdom
/* Leer la página anfitriona, del lado de la página: public/pilo.js.

   El cargador es un archivo suelto (ES5, sin módulos) que corre en páginas
   ajenas. Aquí se prueba el archivo de verdad, de dos maneras:
     · sus reglas de lectura (qué pide la línea y qué de lo oculto es contenido
       plegado), sacadas del archivo y corridas sin DOM;
     · el cargador entero sobre una página armada con jsdom: se le pide la
       página como se la pide el marco y se mira qué bloques manda.
   jsdom no pinta: lo oculto se marca aquí con `hidden`, aria-hidden o estilos
   en línea, que es lo que sí calcula. */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { leerModo, readHostPage } from "./embed";

const source = readFileSync(resolve(__dirname, "../../../public/pilo.js"), "utf8").replace(/\r\n/g, "\n");

interface Fold {
  role?: string;
  marks?: string;
  fixed?: boolean;
  controlled?: boolean;
  chars?: number;
}

const rules = (() => {
  const from = source.indexOf("/* --- Las reglas de lectura");
  const to = source.indexOf("/* --- fin de las reglas --- */");
  expect(from).toBeGreaterThan(0);
  expect(to).toBeGreaterThan(from);
  return new Function(`${source.slice(from, to)}\nreturn { leerModo: leerModo, plegado: plegado };`)() as { leerModo: (raw: unknown) => string; plegado: (d: Fold) => boolean };
})();

describe("las reglas de lectura de pilo.js", () => {
  it("la línea pide no leer, leer lo visible o leer todo; y el marco la entiende igual", () => {
    const cases: [unknown, string][] = [[null, "no"], ["", "no"], ["no", "no"], ["0", "no"], ["si", "si"], ["Sí", "si"], [" SI ", "si"], ["todo", "todo"], ["TODO", "todo"], [" todo ", "todo"], ["otra cosa", "no"]];
    for (const [raw, modo] of cases) {
      expect(rules.leerModo(raw), String(raw)).toBe(modo);
      expect(leerModo(raw), String(raw)).toBe(modo);
    }
  });

  it("es contenido plegado: un panel de pestaña, lo que un control abre, lo que se llama acordeón o pestaña, y un bloque oculto con texto de verdad", () => {
    expect(rules.plegado({ role: "tabpanel", chars: 5 })).toBe(true);
    expect(rules.plegado({ controlled: true, chars: 0 })).toBe(true);
    for (const marks of ["tab-pane fade", "accordion-collapse collapse", "panel-body", "faq__answer", "elementor-tab-content", "respuesta", "read-more-text", "acordeon-contenido"]) expect(rules.plegado({ marks, chars: 10 }), marks).toBe(true);
    expect(rules.plegado({ marks: "bloque", chars: 80 })).toBe(true);
    // Nombres de contenido que se parecen a los de avisos: no se confunden.
    for (const marks of ["perfil-de-ingreso", "registro-calificado", "research-lines", "headset"]) expect(rules.plegado({ marks, chars: 200 }), marks).toBe(true);
  });

  it("no es contenido: lo fijo a la ventana, avisos de cookies, modales, menús, ingreso, publicidad, copias y plantillas, ni un ícono o una etiqueta suelta", () => {
    expect(rules.plegado({ role: "tabpanel", fixed: true, chars: 900 })).toBe(false);
    for (const marks of ["cookie-banner", "modal fade", "Modal-Login", "popup-newsletter", "offcanvas-menu", "dropdown-menu", "nav-submenu panel", "sr-only", "visually-hidden", "slick-cloned", "ad ad-slot", "ads", "publicidad", "plantilla-tarjeta", "tooltip-content", "loading-overlay", "gdpr consent"]) {
      expect(rules.plegado({ marks, chars: 900, controlled: true }), marks).toBe(false);
    }
    expect(rules.plegado({ marks: "icon", chars: 12 })).toBe(false);
    expect(rules.plegado({ marks: "", chars: 79 })).toBe(false);
    expect(rules.plegado({})).toBe(false);
  });
});

/* --- El cargador entero ------------------------------------------------------------------ */

const ORIGIN = "https://portal.example";
const VISIBLE = "Texto visible de la presentación: la universidad abre inscripciones dos veces al año para todos sus programas.";
const LONG = "Este párrafo está en la página pero no se ve hasta abrir su panel, y tiene texto de sobra para contar como contenido.";

const PAGE = `
  <nav>Menú del sitio</nav>
  <main>
    <h1>Admisiones</h1>
    <p>${VISIBLE}</p>
    <div role="tablist"><button role="tab" id="t1" aria-controls="p1" aria-selected="true">Pregrado</button><button role="tab" id="t2" aria-controls="p2">Posgrado</button></div>
    <div role="tabpanel" id="p1" aria-labelledby="t1"><p>Pregrado: la inscripción abre en octubre.</p></div>
    <div role="tabpanel" id="p2" aria-labelledby="t2" hidden><p>Posgrado: la inscripción abre en enero.</p></div>
    <details><summary>Requisitos</summary><p>Documento de identidad y diploma.</p></details>
    <h3><button aria-expanded="false" aria-controls="acc1">¿Cuánto cuesta?</button></h3>
    <div id="acc1" class="collapse" style="display:none"><p>El valor depende del programa.</p></div>
    <div style="display:none"><p>${LONG}</p></div>
    <div aria-hidden="true" class="mobile-copy"><p>${VISIBLE}</p></div>
    <span aria-hidden="true">›</span>
    <div id="cookie-banner" hidden><p>Usamos cookies para mejorar su experiencia en este sitio web de la universidad, acepte para continuar.</p></div>
    <div class="aviso" style="display:none;position:fixed"><p>Una capa fija a la ventana con bastante texto adentro, que no es contenido de la página aunque sea larga.</p></div>
    <div role="dialog" hidden><p>Inicie sesión para continuar con su proceso de inscripción en la universidad.</p></div>
    <dialog open><p>Un diálogo abierto que tapa la página.</p></dialog>
    <ul role="menu" hidden><li>Opción del menú desplegable con un texto largo para que no sea por corto que no se lee nunca.</li></ul>
    <form><label>Su nombre <input value="Ana Pérez"></label><p>Texto dentro de un formulario.</p></form>
    <div hidden><form><p>Otro formulario, oculto, con texto largo de sobra para contar como contenido si no fuera un formulario.</p></form></div>
    <p data-pilo-ignorar>Esto no se lee.</p>
    <template><p>Plantilla de tarjeta que no es contenido.</p></template>
    <button>Enviar</button>
  </main>
  <footer>Pie del sitio</footer>`;

/** Corre pilo.js en esta página con esa línea y le pide la página, como el marco. Devuelve lo que el cargador le manda. */
function load(leer: string | null, html = PAGE): { read: unknown; page: { url: string; title: string; blocks: { h: number; t: string; o?: number }[] } | null } {
  document.body.innerHTML = html;
  document.title = "Admisiones | Portal";
  for (const key of Object.keys(window)) if (key.startsWith("__piloEmbed")) delete (window as unknown as Record<string, unknown>)[key];
  const script = document.createElement("script");
  script.setAttribute("src", `${ORIGIN}/pilo.js`);
  if (leer !== null) script.setAttribute("data-leer", leer);
  Object.defineProperty(document, "currentScript", { value: script, configurable: true });
  const before = new Set(Array.from(document.querySelectorAll("iframe")));
  new Function(source)();
  const frame = Array.from(document.querySelectorAll("iframe")).find((f) => !before.has(f));
  if (!frame?.contentWindow) throw new Error("pilo.js no montó su marco");
  const sent: Record<string, unknown>[] = [];
  frame.contentWindow.postMessage = ((m: Record<string, unknown>) => void sent.push(m)) as typeof frame.contentWindow.postMessage;
  const say = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, origin: ORIGIN, source: frame.contentWindow }));
  say({ source: "pilo-embed", type: "estado", state: "abierto" });
  say({ source: "pilo-embed", type: "leer", id: "a1" });
  const state = sent.find((m) => m.type === undefined);
  const page = sent.find((m) => m.type === "pagina");
  return { read: state?.read, page: (page?.page ?? null) as ReturnType<typeof load>["page"] };
}

const texts = (r: ReturnType<typeof load>) => (r.page?.blocks ?? []).map((b) => b.t);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("pilo.js lee la página que lo aloja", () => {
  it("sin data-leer no lee nada", () => {
    const r = load(null);
    expect(r.read).toBe(false);
    expect(r.page).toBeNull();
  });

  it('con data-leer="si" lee lo visible, como siempre: nada oculto, ni formularios, ni menús', () => {
    const r = load("si");
    expect(r.read).toBe(true);
    const got = texts(r);
    expect(got).toContain("Admisiones");
    expect(got).toContain(VISIBLE);
    expect(got).toContain("Pregrado: la inscripción abre en octubre.");
    const all = got.join("\n");
    for (const hidden of ["Posgrado: la inscripción", "El valor depende", LONG, "cookies", "capa fija", "Inicie sesión", "Opción del menú", "Ana Pérez", "formulario", "Esto no se lee", "Plantilla", "Enviar", "Menú del sitio", "Pie del sitio", "¿Cuánto cuesta?"]) expect(all, hidden).not.toContain(hidden);
    expect(r.page?.blocks.every((b) => b.o === undefined)).toBe(true);
    expect(r.page?.url).toBe(`${window.location.origin}${window.location.pathname}`);
  });

  it('con data-leer="todo" lee también lo plegado, marcado, y con el nombre de su pestaña o de su botón por título', () => {
    const r = load("todo");
    expect(r.read).toBe(true);
    const blocks = r.page?.blocks ?? [];
    const at = (t: string) => blocks.find((b) => b.t === t);
    // Lo visible sigue ahí, sin marca.
    expect(at(VISIBLE)).toEqual({ h: 0, t: VISIBLE });
    expect(at("Pregrado: la inscripción abre en octubre.")?.o).toBeUndefined();
    // La pestaña sin abrir: su nombre como título y su contenido, marcados como plegados.
    const i = blocks.findIndex((b) => b.t === "Posgrado: la inscripción abre en enero.");
    expect(blocks[i]).toEqual({ h: 0, t: "Posgrado: la inscripción abre en enero.", o: 1 });
    expect(blocks[i - 1]).toEqual({ h: 1, t: "Posgrado", o: 1 });
    // El <details> cerrado: el <summary> es el título (visible) y lo de adentro va plegado.
    expect(at("Requisitos")).toEqual({ h: 1, t: "Requisitos" });
    expect(at("Documento de identidad y diploma.")?.o).toBe(1);
    // El acordeón: el botón que lo abre es su título, y el panel que controla se lee.
    expect(at("¿Cuánto cuesta?")).toEqual({ h: 1, t: "¿Cuánto cuesta?" });
    expect(at("El valor depende del programa.")?.o).toBe(1);
    // Un bloque oculto cualquiera con texto de verdad.
    expect(at(LONG)?.o).toBe(1);
  });

  it('con data-leer="todo" sigue sin leer lo que no es contenido', () => {
    const all = texts(load("todo")).join("\n");
    for (const never of ["cookies", "capa fija", "Inicie sesión", "diálogo abierto", "Opción del menú", "Ana Pérez", "Su nombre", "formulario", "Esto no se lee", "Plantilla", "Enviar", "Menú del sitio", "Pie del sitio", "›"]) expect(all, never).not.toContain(never);
  });

  it("el marco quita lo plegado que repite lo visible, y deja lo demás", () => {
    const r = load("todo");
    // La página manda la copia oculta (versión de móvil) marcada…
    expect((r.page?.blocks ?? []).filter((b) => b.t === VISIBLE)).toHaveLength(2);
    // …y el marco se queda con una.
    const seen = readHostPage({ source: "pilo-host", type: "pagina", id: "a1", page: { ...r.page, url: "https://www.udes.edu.co/admisiones" } }, "a1");
    const got = (seen?.page?.blocks ?? []).map((b) => b.t);
    expect(got.filter((t) => t === VISIBLE)).toHaveLength(1);
    expect(got).toContain("Posgrado: la inscripción abre en enero.");
    expect(seen?.page?.blocks.find((b) => b.t === "Posgrado")).toEqual({ h: true, t: "Posgrado" });
  });

  it("no cambia la página ni pulsa nada", () => {
    document.body.innerHTML = PAGE;
    const before = document.querySelector("main")?.innerHTML;
    load("todo", PAGE);
    expect(document.querySelector("main")?.innerHTML).toBe(before);
    expect(document.querySelector("#p2")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector("details")?.hasAttribute("open")).toBe(false);
    expect(document.querySelector("[aria-controls='acc1']")?.getAttribute("aria-expanded")).toBe("false");
  });
});
