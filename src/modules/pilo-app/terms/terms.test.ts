import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_TERMS, acceptPolicy, acceptanceRecord, acceptanceState, mustAccept, needsAcceptance, parseAcceptance, readAcceptanceState } from "./acceptance";
import { AUTHORIZE_WHY, CONSENT_TEXTS, DATA_PLATFORMS, KEEP_LABEL, consentNote } from "./consent";
import {
  CONSENT_LABEL,
  DATA_CHANNEL,
  GATE_CHANGED_LEAD,
  GOLDEN_RULES,
  POLICY_DATE,
  POLICY_PATH,
  POLICY_SECTIONS,
  POLICY_VERSION,
  dataChannel,
  plainText,
  policyBack,
  policyHref,
  policyIndex,
  readingSection,
  richParts,
  sectionFromHash,
  versionLine,
} from "./policy";

const DIR = resolve(process.cwd(), "src/modules/pilo-app");
const source = (file: string) => readFileSync(resolve(DIR, file), "utf8").replace(/\r\n/g, "\n");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Un almacenamiento de mentira, como el del navegador. */
function fakeStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) } });
  return data;
}

describe("la versión y lo que sigue por definir", () => {
  it("la política tiene versión, y la fecha y el canal de datos no se inventan", () => {
    expect(POLICY_VERSION).toMatch(/\S/);
    // Mientras el dueño no los defina, la página dice «por definir»: ni una fecha ni un correo de mentira.
    if (POLICY_DATE === null) expect(versionLine()).toBe(`Versión ${POLICY_VERSION} · fecha por definir`);
    if (DATA_CHANNEL === null) expect(dataChannel()).toEqual({ text: "el canal de protección de datos de la UDES (por definir)", pending: true });
    expect(versionLine("2", "1 de noviembre de 2026")).toBe("Versión 2 · 1 de noviembre de 2026");
    expect(versionLine("2", "  ")).toBe("Versión 2 · fecha por definir");
    expect(dataChannel("datos@ejemplo.test")).toEqual({ text: "datos@ejemplo.test" });
  });

  it("lo pendiente está marcado en el código para el dueño", () => {
    const code = source("terms/policy.ts");
    expect(code.match(/\/\/ POR DEFINIR por el dueño\nexport const (POLICY_DATE|DATA_CHANNEL)/g)).toHaveLength(2);
    // Ningún correo escrito en el texto de la política.
    expect(code).not.toMatch(/[\w.]+@[\w.]+\.\w+/);
  });
});

describe("la aceptación guardada en el dispositivo", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("guarda la versión y cuándo", () => {
    const raw = acceptanceRecord("1", new Date("2026-10-02T15:00:00Z"));
    expect(parseAcceptance(raw)).toEqual({ version: "1", at: "2026-10-02T15:00:00.000Z" });
    expect(parseAcceptance(acceptanceRecord())?.version).toBe(POLICY_VERSION);
  });

  it("lo que no se entiende es «no ha aceptado»", () => {
    for (const raw of [null, undefined, "", "1", "si", "{", "null", "[]", '{"v":1}', '{"v":""}', '{"at":"2026-10-02"}']) {
      expect(parseAcceptance(raw), String(raw)).toBeNull();
      expect(mustAccept(raw), String(raw)).toBe(true);
      expect(acceptanceState(raw), String(raw)).toBe("nunca");
    }
  });

  it("no se vuelve a pedir a quien aceptó esta versión", () => {
    expect(mustAccept(acceptanceRecord("1"), "1")).toBe(false);
    expect(acceptanceState(acceptanceRecord("1"), "1")).toBe("vigente");
    expect(mustAccept(acceptanceRecord())).toBe(false);
  });

  it("si la versión cambia, se vuelve a pedir, y se sabe que es un cambio", () => {
    const old = acceptanceRecord("1");
    expect(mustAccept(old, "2")).toBe(true);
    expect(acceptanceState(old, "2")).toBe("cambio");
    // También si se vuelve a una anterior: lo aceptado es esa versión y no otra.
    expect(mustAccept(acceptanceRecord("2"), "1")).toBe(true);
    // La sección 6 promete avisar el cambio: la puerta tiene ese aviso.
    expect(GATE_CHANGED_LEAD).toMatch(/cambió/);
    expect(source("terms/TermsGate.tsx")).toContain("changed ? GATE_CHANGED_LEAD : GATE_LEAD");
  });

  it("se anota en el dispositivo, bajo la llave de la app, y sin almacenamiento no falla", () => {
    const data = fakeStorage();
    expect(needsAcceptance()).toBe(true);
    expect(readAcceptanceState()).toBe("nunca");
    expect(acceptPolicy(new Date("2026-10-02T15:00:00Z"))).toBe(true);
    expect(KEY_TERMS).toBe("pilo-app:terminos");
    expect([...data.keys()]).toEqual(["pilo-app:terminos"]);
    expect(JSON.parse(data.get(KEY_TERMS)!)).toEqual({ v: POLICY_VERSION, at: "2026-10-02T15:00:00.000Z" });
    expect(needsAcceptance()).toBe(false);
    // Aceptada una versión vieja: se pide otra vez.
    data.set(KEY_TERMS, acceptanceRecord(`${POLICY_VERSION}-anterior`));
    expect(readAcceptanceState()).toBe("cambio");
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(needsAcceptance()).toBe(true);
    expect(acceptPolicy()).toBe(false);
  });

  it("no viaja al servidor: ni la puerta ni lo guardado llaman a la base", () => {
    for (const file of ["terms/acceptance.ts", "terms/TermsGate.tsx", "terms/DataConsent.tsx", "terms/consent.ts", "terms/policy.ts", "terms/PolicyPage.tsx"]) {
      expect(source(file), file).not.toMatch(/supabase|fetch\(/);
    }
  });
});

describe("las cuatro reglas de oro y las seis secciones", () => {
  it("son cuatro reglas, con su título y su texto", () => {
    expect(GOLDEN_RULES.map((r) => r.title)).toEqual(["Pilo es un apoyo, no un experto infalible", "Verifique siempre las respuestas", "Las decisiones son suyas", "Su privacidad está protegida"]);
    expect(new Set(GOLDEN_RULES.map((r) => r.id)).size).toBe(4);
    for (const r of GOLDEN_RULES) expect(r.text.length, r.id).toBeGreaterThan(40);
  });

  it("son seis secciones numeradas, en orden y con ancla propia", () => {
    expect(POLICY_SECTIONS.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(POLICY_SECTIONS.map((s) => s.id)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    for (const s of POLICY_SECTIONS) expect(s.blocks.length, s.id).toBeGreaterThan(0);
  });

  it("el índice nombra cada sección y enlaza a su ancla", () => {
    expect(policyIndex()).toEqual([
      { id: "p1", href: "#p1", label: "1. Qué es Pilo" },
      { id: "p2", href: "#p2", label: "2. Uso responsable" },
      { id: "p3", href: "#p3", label: "3. Privacidad y datos" },
      { id: "p4", href: "#p4", label: "4. Génesis y Moodle" },
      { id: "p5", href: "#p5", label: "5. Propiedad intelectual" },
      { id: "p6", href: "#p6", label: "6. Aceptación" },
    ]);
    expect(sectionFromHash("#p4")).toBe("p4");
    expect(sectionFromHash("p4")).toBe("p4");
    for (const hash of ["", "#", "#p7", "#toc", "#P1"]) expect(sectionFromHash(hash), hash).toBeNull();
  });

  it("el índice marca la sección que se lee", () => {
    const at = (tops: number[]) => tops.map((top, i) => ({ id: `p${i + 1}`, top }));
    // Arriba del todo: la primera, aunque todavía no llegue a la línea de lectura.
    expect(readingSection(at([400, 900, 1500]), 240)).toBe("p1");
    // La última cuyo comienzo ya pasó la línea.
    expect(readingSection(at([-600, 100, 700]), 240)).toBe("p2");
    expect(readingSection(at([-900, -300, 240]), 240)).toBe("p3");
    // Al final de la página, la última, aunque sea corta y no alcance la línea.
    expect(readingSection(at([-900, -300, 500]), 240, true)).toBe("p3");
    expect(readingSection([], 240)).toBeNull();
  });

  it("dice solo lo que Pilo cumple: las frases de privacidad son las ajustadas", () => {
    const all = POLICY_SECTIONS.flatMap((s) => s.blocks.flatMap((b) => (b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.items.map((f) => `${f.term}: ${f.text}`))))
      .map((t) => plainText(t))
      .join("\n");
    expect(all).toContain("Se guardan en su dispositivo. La universidad no conserva el historial de sus conversaciones.");
    expect(all).toContain("El texto de su pregunta se envía a un proveedor de inteligencia artificial");
    expect(all).toContain("Se conservan, sin su nombre, preguntas que Pilo no supo responder");
    expect(all).toContain("Siempre con su autorización.");
    // La sección 4 dice lo mismo que la autorización de Génesis: las notas del periodo y el récord por periodo.
    expect(all).toContain("en Génesis, sus notas del periodo y su récord académico por periodo");
    expect(all).toContain("Si usted le pide recomendaciones sobre sus notas, y solo al pedirlas, Pilo envía a la IA un resumen de ellas sin su nombre ni su código; ese resumen no se guarda.");
    expect(all).toContain("Si la política cambia, Pilo lo avisa y pide aceptarla de nuevo antes de continuar.");
    // Las promesas que se retiraron del borrador porque Pilo no las cumple no vuelven a colarse.
    expect(all).not.toMatch(/efímero|anonimiza|no rastre|ningún servidor de terceros/i);
    // Todo de usted.
    expect(all).not.toMatch(/\b(tus|tu cuenta|puedes|tienes)\b/i);
  });

  it("el texto parte en trozos: lo normal, la negrita y lo que está por definir", () => {
    expect(richParts("Su propósito es **académico**: aprender.")).toEqual([{ text: "Su propósito es " }, { text: "académico", strong: true }, { text: ": aprender." }]);
    expect(richParts("por {canal}.", null)).toEqual([{ text: "por " }, { text: "el canal de protección de datos de la UDES (por definir)", pending: true }, { text: "." }]);
    expect(richParts("por {canal}.", "el correo x")).toEqual([{ text: "por " }, { text: "el correo x" }, { text: "." }]);
    expect(plainText("**Solo lectura.** Pilo consulta.")).toBe("Solo lectura. Pilo consulta.");
    // Ninguna marca queda a la vista en el documento.
    for (const s of POLICY_SECTIONS) for (const b of s.blocks) for (const t of b.kind === "p" ? [b.text] : b.kind === "list" ? b.items : b.items.map((f) => f.text)) expect(plainText(t), s.id).not.toMatch(/\*\*|\{|\}/);
  });
});

describe("el registro y la puerta usan el mismo texto", () => {
  const gate = source("terms/TermsGate.tsx");
  const account = source("account/AccountGate.tsx");
  const rules = source("terms/GoldenRules.tsx");

  it("las reglas se pintan desde policy.ts, en un solo componente", () => {
    expect(rules).toMatch(/import \{ GOLDEN_RULES \} from "\.\/policy"/);
    expect(gate).toContain("<GoldenRules");
    expect(account).toContain("<GoldenRules");
  });

  it("la casilla dice lo mismo en los dos sitios", () => {
    expect(CONSENT_LABEL).toBe("He leído y acepto los términos y la política de uso de Mr. Pilo.");
    expect(gate).toContain("{CONSENT_LABEL}");
    expect(account).toContain("{CONSENT_LABEL}");
  });

  it("no queda otro texto de términos escrito a mano", () => {
    expect(source("account/rules.ts")).not.toMatch(/ACCOUNT_TERMS|TERMS_VERSION/);
    expect(account).not.toMatch(/ACCOUNT_TERMS|Términos de la cuenta/);
    for (const r of GOLDEN_RULES) {
      expect(gate, r.id).not.toContain(r.title);
      expect(account, r.id).not.toContain(r.title);
    }
  });

  it("quien acepta en el registro no vuelve a aceptar en la app", () => {
    // Al crear la cuenta se anota la misma aceptación que deja la puerta.
    expect(account).toMatch(/await registerAccount\(data\);\s*(\/\/[^\n]*\s*)?acceptPolicy\(\);/);
    expect(gate).toContain("acceptPolicy();");
    // Y la app vuelve a mirar lo guardado al cambiar de pantalla.
    expect(source("PiloApp.tsx")).toMatch(/readAcceptanceState\(\)\), \[acceptedNow, location\.pathname\]/);
  });
});

describe("la autorización de Génesis y Moodle", () => {
  it("una por plataforma, con su pregunta, cuatro promesas y lo que autoriza", () => {
    expect(DATA_PLATFORMS).toEqual(["genesis", "moodle"]);
    expect(CONSENT_TEXTS.genesis.question).toBe("¿Me deja ver sus notas?");
    expect(CONSENT_TEXTS.moodle.question).toBe("¿Me deja ver sus clases?");
    for (const p of DATA_PLATFORMS) {
      const t = CONSENT_TEXTS[p];
      expect(t.promises.map((x) => x.title), p).toEqual(["Solo leo", "No me las llevo", "Son suyas y de nadie más", "Usted manda"]);
      expect(t.authorize, p).toContain(`en ${t.name}`);
      expect(t.authorize, p).toMatch(/^Autorizo a Pilo a consultar/);
      // Lo que promete nombra su plataforma, no la otra.
      const other = CONSENT_TEXTS[p === "genesis" ? "moodle" : "genesis"].name;
      expect(`${t.question} ${t.authorize} ${t.promises.map((x) => x.text).join(" ")}`, p).not.toContain(other);
      expect(t.promises[1].text, p).toContain(`se quedan en ${t.name}`);
    }
    expect(CONSENT_TEXTS.genesis.promises[0].text).toBe("Miro sus notas del periodo y su récord académico por periodo. No puedo cambiar nada.");
    expect(CONSENT_TEXTS.moodle.promises[0].text).toMatch(/cursos, actividades, materiales y fechas de entrega/);
    // Lo único de las notas que sale hacia la IA, dicho expresamente: el resumen de las recomendaciones.
    expect(CONSENT_TEXTS.genesis.promises[1].text).toBe("Sus notas se quedan en Génesis. No las guardo en ningún servidor. Si me pide recomendaciones, envío a la IA un resumen de sus notas sin su nombre ni su código. No se guarda.");
    expect(CONSENT_TEXTS.moodle.promises[1].text).not.toMatch(/recomendaciones|IA/);
    expect(CONSENT_TEXTS.genesis.authorize).toMatch(/plan de mejoramiento/);
    expect(CONSENT_TEXTS.moodle.authorize).toMatch(/recordarme entregas/);
  });

  it("dice qué queda según lo que pidió la persona", () => {
    expect(consentNote(null)).toBe("Sin su autorización, Pilo no consulta nada.");
    expect(consentNote({ keep: true })).toBe("Autorizado. La conexión queda guardada solo en este dispositivo.");
    expect(consentNote({ keep: false })).toBe("Autorizado solo por esta vez: al salir, no queda nada guardado.");
    expect(KEEP_LABEL).toMatch(/Mantener la conexión en este dispositivo/);
    expect(AUTHORIZE_WHY).toMatch(/marque la casilla/);
  });

  it("avisa con la plataforma y si pidió mantener la conexión, y aún no está montada en ninguna pantalla", () => {
    const card = source("terms/DataConsent.tsx");
    expect(card).toContain("const choice: ConsentChoice = { platform, keep };");
    expect(card).toContain("onAuthorize(choice);");
    // Queda lista para unirla después: ninguna pantalla de la app la usa todavía.
    for (const file of ["PiloApp.tsx", "AppShell.tsx", "AppMenu.tsx", "AppSide.tsx", "account/AccountGate.tsx"]) expect(source(file), file).not.toContain("DataConsent");
  });
});

describe("la página de la política y sus enlaces", () => {
  it("vive en /pilo-politica y sabe a dónde volver", () => {
    expect(POLICY_PATH).toBe("/pilo-politica");
    expect(readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8")).toContain(`path="${POLICY_PATH}"`);
    expect(policyHref()).toBe("/pilo-politica");
    expect(policyHref("pregunta")).toBe("/pilo-politica?desde=pregunta");
    expect(policyHref("ensenanza")).toBe("/pilo-politica?desde=ensenanza");
    expect(policyBack("")).toEqual({ href: "/app", label: "Volver a Mr. Pilo" });
    expect(policyBack("?desde=pregunta").href).toBe("/pregunta");
    expect(policyBack("?desde=ensenanza").href).toBe("/pilo-ensenanza");
    // Nunca lleva a una dirección que venga escrita en el enlace.
    expect(policyBack("?desde=https://ejemplo.test").href).toBe("/app");
  });

  it("se abre desde el menú de la app y desde la aceptación", () => {
    expect(source("AppMenu.tsx")).toContain("<PolicyLink");
    expect(source("AppSide.tsx")).toContain("<PolicyLink");
    expect(source("terms/TermsGate.tsx")).toContain("to={POLICY_PATH}");
  });

  it("el índice marca la sección con aria-current y los encabezados van en orden", () => {
    const page = source("terms/PolicyPage.tsx");
    expect(page).toContain('aria-current={entry.id === current ? "location" : undefined}');
    expect(page.indexOf("<h1>")).toBeGreaterThan(-1);
    expect(page.indexOf("<h1>")).toBeLessThan(page.indexOf("<h2 "));
    expect(page).not.toMatch(/<h[3-6]/);
    // Un documento: sin animaciones de adorno.
    expect(page).not.toMatch(/gsap/);
  });
});

describe("las hojas de estilo", () => {
  const terms = strip(source("terms/terms.css"));
  const page = strip(source("terms/policy-page.css"));
  const rule = (css: string, selector: string) => css.split("}").find((block) => block.split("{")[0].split(",").some((s) => s.trim() === selector))?.split("{")[1] ?? "";

  it.each([
    ["terms/terms.css", terms],
    ["terms/policy-page.css", page],
  ])("ningún color escrito a mano (%s)", (_file, css) => {
    expect([...css.matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g)].map((m) => m[0])).toEqual([]);
  });

  it("en la app, los colores son los del tema; en la página pública, los del sitio", () => {
    expect(terms).toMatch(/var\(--c-ink\)/);
    expect(terms).not.toMatch(/var\(--(ink|surface|page|brand-[a-z-]+)\)/);
    expect(page).toMatch(/var\(--surface\)/);
    expect(page).not.toMatch(/var\(--(c|s)-[a-z0-9-]+\)/);
  });

  it("lo que se toca mide 44 px o más", () => {
    for (const selector of [".pt-consent", ".pt-link"]) expect(Number(rule(terms, selector).match(/min-height:\s*(\d+)px/)?.[1] ?? 0), selector).toBeGreaterThanOrEqual(44);
    for (const selector of [".pp-back", ".pp-toc a"]) expect(Number(rule(page, selector).match(/min-height:\s*(\d+)px/)?.[1] ?? 0), selector).toBeGreaterThanOrEqual(44);
  });

  it("solo se anima transform (y bordes): nada de tamaño ni posición, y se respeta el movimiento reducido", () => {
    for (const css of [terms, page]) {
      for (const [, value] of css.matchAll(/transition:\s*([^;]+);/g)) expect(value).not.toMatch(/\b(all|width|height|top|left|margin|padding)\b/);
      expect(css).toMatch(/prefers-reduced-motion: reduce/);
      expect(css).toMatch(/scale\(0\.97\)/);
    }
    expect(page).toMatch(/@media print/);
  });
});
