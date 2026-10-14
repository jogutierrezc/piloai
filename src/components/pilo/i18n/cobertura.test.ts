/* =============================================================================
   Mr. Pilo en tres idiomas · que no quede un texto sin traducir.

   Recorre con el compilador de TypeScript las pantallas de Pilo y exige tres cosas:
     1. todo `tr("…")` / `trn(n, "…", "…")` tiene su traducción al inglés y al portugués;
     2. en las pantallas, ningún texto JSX queda fuera de `tr()` (si se olvida uno, aquí se ve);
     3. los textos que viven en constantes (etiquetas, saludos, consejos, el perfil de cada Pilo)
        también están traducidos, porque la pantalla los pasa por `tr()` o `localizeDeep()` al mostrarlos.
   Y que cada traducción conserve las mismas variables `{nombre}` que el original.
   ========================================================================== */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { DICTIONARY } from "./dict";
import { SERVIDOR_EN } from "./dict/servidor";

const ROOT = resolve(__dirname, "../../../..");

/** Las pantallas: todo su texto JSX tiene que ir por `tr()`. */
const SURFACES = [
  "src/modules/pregunta/AskPilo.tsx",
  "src/modules/pregunta/Welcome.tsx",
  "src/modules/pregunta/Extras.tsx",
  "src/modules/pregunta/RolePicker.tsx",
  "src/modules/pregunta/MeshAnswer.tsx",
  "src/modules/pilo-embed/PiloEmbed.tsx",
  "src/modules/pilo-app/AppTurn.tsx",
  "src/modules/pilo-app/AppSide.tsx",
  "src/modules/pilo-app/AppMenu.tsx",
  "src/modules/pilo-app/AppShell.tsx",
  "src/modules/pilo-app/AppTabs.tsx",
  "src/modules/pilo-app/AppWelcome.tsx",
  "src/modules/pilo-app/PiloApp.tsx",
  "src/modules/pilo-app/account/AccountGate.tsx",
  "src/modules/pilo-app/account/ProfilePane.tsx",
  "src/modules/pilo-app/carnet/CarnetPane.tsx",
  "src/modules/pilo-app/carnet/Hojas.tsx",
  "src/modules/pilo-app/carnet/Sheet.tsx",
  "src/modules/pilo-app/yo/PerfilSheet.tsx",
  "src/modules/pilo-app/yo/MisDatos.tsx",
  "src/modules/pilo-app/limites/LimitBanner.tsx",
  "src/modules/pilo-app/limites/LimitesCard.tsx",
  "src/modules/pilo-app/account/SavedPane.tsx",
  "src/modules/pilo-app/account/parts.tsx",
  "src/modules/pilo-app/llamada/CallScreen.tsx",
  "src/modules/pilo-app/u/UPane.tsx",
  "src/modules/pilo-app/u/parts.tsx",
  "src/modules/pilo-app/u/lectura.tsx",
  "src/modules/pilo-app/u/vistas-docente.tsx",
  "src/modules/pilo-app/llamada/CallPreview.tsx",
  "src/modules/pilo-app/llamada/AnuncioLlamada.tsx",
];

/** Lo que además llama a `tr()` pero no tiene JSX, o guarda sus textos en constantes. */
const DATA = [
  "src/modules/pregunta/answer-state.ts",
  "src/modules/pregunta/space.ts",
  "src/modules/pregunta/store.ts",
  "src/modules/pilo-embed/embed.ts",
  "src/modules/pilo-app/welcome-script.ts",
  "src/modules/pilo-app/themes.ts",
  "src/modules/pilo-app/account/rules.ts",
  "src/modules/pilo-app/account/answers.ts",
  "src/modules/pilo-app/account/visitor.ts",
  "src/modules/pilo-app/account/useAccount.ts",
  "src/modules/pilo-app/carnet/rules.ts",
  "src/modules/pilo-app/carnet/logic.ts",
  "src/modules/pilo-app/limites/logic.ts",
  "src/modules/pilo-app/account/AccountGate.tsx",
  "src/components/pilo/ai/client.ts",
  "src/modules/pilo-app/llamada/logic.ts",
  "src/modules/pilo-app/llamada/useCall.ts",
  "src/modules/pilo-app/u/vistas.ts",
];

/** Nombres propios y marcas: no se traducen. */
const NO_TRADUCIR = new Set(["Mr. Pilo", "Pilo", "Pilo U", "Gemini", "Génesis", "Moodle", "Google Wallet", "beta", "Bucaramanga", "Cúcuta", "Valledupar", "Bogotá", "Universidad de Santander", "UDES", "Mr. Pilo:", "Pilo:"]);

/** Cadenas de las constantes que no son texto para mostrar. */
const NO_ES_TEXTO = new Set(["sin respuesta", "pc-terminos-texto pc-terminos-error", "id, username, full_name, email, rol, campus, status, nick, tone, length, about, program", "Universidad de Santander · Pregúntele a Pilo"]);

/** Los textos que llegan del servidor y la pantalla traduce al mostrarlos (pasos de «Cómo respondí»). */
const DEL_SERVIDOR = [
  "Enrutador",
  "Página",
  "Archivo",
  "Catálogo",
  "Respuestas guardadas",
  "Entender",
  "Cifras",
  "Fuentes",
  "Mapa",
  "Malla",
  "Otros ámbitos",
  "IA",
  "Capciosa cercana",
  "Relaciones",
  "Análisis",
  "Análisis de la IA",
  "Entendiendo la pregunta",
  "Revisando las respuestas oficiales",
  "Recordando respuestas anteriores",
  "Consultando las cifras",
  "Buscando en lo que conozco",
  "Redactando la respuesta",
  "Verificando las cifras",
  "Siguiendo las conexiones",
  "Consultando otros ámbitos",
];

const WORD = /[A-Za-záéíóúñÁÉÍÓÚÑ]{2,}/;

function parse(file: string) {
  const src = readFileSync(resolve(ROOT, file), "utf8");
  return ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

const isTrCall = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && (n.expression.text === "tr" || n.expression.text === "trn");

interface Found {
  used: string[];
  /** Cadenas que parecen texto para mostrar y no están en tr(). */
  loose: { text: string; line: number }[];
  /** Texto JSX que no pasa por tr(). */
  jsx: { text: string; line: number }[];
  /** tr() con algo que no es una cadena fija. */
  dynamic: number[];
}

function scan(file: string): Found {
  const sf = parse(file);
  const out: Found = { used: [], loose: [], jsx: [], dynamic: [] };
  const line = (n: ts.Node) => sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
  const ignoredAttr = (name: string) => ["className", "key", "id", "role", "type", "name", "htmlFor", "href", "src", "style", "viewBox", "d", "fill", "stroke", "rel", "target", "lang", "autoComplete", "inputMode", "to", "variant", "kind", "mode", "tone", "width", "height", "points", "transform", "loading", "value", "pattern", "method", "action", "sizes", "alt", "emotion", "mood", "face", "size", "side", "place", "step", "phase", "state", "theme", "icon", "tema", "ref", "label", "legend", "lead", "tag", "hint", "help", "caption", "heading", "detail", "summary", "description", "subtitle", "message", "cta", "placeholder", "title"].includes(name) || name.startsWith("data-") || name.startsWith("aria-") ? !["aria-label", "label", "legend", "lead", "tag", "hint", "help", "caption", "heading", "detail", "summary", "description", "subtitle", "message", "cta", "placeholder", "title", "alt"].includes(name) : false;
  function visit(n: ts.Node) {
    if (ts.isImportDeclaration(n) || ts.isExportDeclaration(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return;
    if (isTrCall(n)) {
      const fn = (n.expression as ts.Identifier).text;
      const lits = fn === "tr" ? [n.arguments[0]] : [n.arguments[1], n.arguments[2]];
      for (const a of lits) {
        if (a && (ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) out.used.push(a.text);
        else if (a) out.dynamic.push(line(a));
      }
      // Los argumentos que son otras llamadas se siguen recorriendo, no las cadenas ya contadas.
      n.arguments.forEach((a) => {
        if (!(ts.isStringLiteral(a) || ts.isNoSubstitutionTemplateLiteral(a))) visit(a);
      });
      return;
    }
    if (ts.isJsxText(n)) {
      const t = n.getText().replace(/\s+/g, " ").trim();
      if (WORD.test(t) && !/^[{}()·|•—–:.,;-]+$/.test(t)) out.jsx.push({ text: t, line: line(n) });
    } else if (ts.isJsxAttribute(n) && n.initializer && ts.isStringLiteral(n.initializer)) {
      const name = n.name.getText();
      if (!ignoredAttr(name) && ["aria-label", "label", "legend", "lead", "tag", "hint", "help", "caption", "heading", "detail", "summary", "description", "subtitle", "message", "cta", "placeholder", "title", "alt"].includes(name)) out.jsx.push({ text: n.initializer.text, line: line(n) });
      return;
    } else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) {
      const p = n.parent;
      if (ts.isLiteralTypeNode(p) || ts.isJsxAttribute(p) || (ts.isPropertyAssignment(p) && p.name === n) || ts.isCaseClause(p) || ts.isElementAccessExpression(p)) return;
      if (ts.isBinaryExpression(p) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return;
      if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ["includes", "startsWith", "endsWith", "test", "has", "get", "set", "add", "delete", "getItem", "setItem", "removeItem", "querySelector", "querySelectorAll", "addEventListener", "removeEventListener", "matchMedia", "postMessage", "split", "join", "padStart", "padEnd", "replace", "match", "indexOf", "toLocaleString", "toLocaleDateString", "toLocaleTimeString", "getAttribute", "setAttribute", "createElement", "fetch", "from", "invoke", "rpc", "select", "eq", "order"].includes(p.expression.name.text)) return;
      const t = n.text.replace(/\s+/g, " ").trim();
      if (t.length < 3) return;
      if (/^[\w./:#@%\-[\]*=&?,;()|<>+~^$!{}\\"']+$/.test(t) && !/^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+$/.test(t)) return;
      if (/^(\.|#|rgb|hsl|var\(|https?:|\/|data:|[a-z]+-[a-z-]+$)/.test(t)) return;
      out.loose.push({ text: t, line: line(n) });
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
  return out;
}

const dictOk = (lang: "en" | "pt", key: string) => typeof DICTIONARY[lang][key] === "string" && DICTIONARY[lang][key].trim().length > 0;
const vars = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

const surfaces = SURFACES.map((f) => ({ file: f, ...scan(f) }));
const data = DATA.map((f) => ({ file: f, ...scan(f) }));

/** Todo lo que el diccionario tiene que traer. */
const required = new Map<string, string>();
for (const s of [...surfaces, ...data]) {
  for (const k of s.used) required.set(k, s.file);
}
for (const s of data) {
  for (const l of s.loose) if (!NO_TRADUCIR.has(l.text) && !NO_ES_TEXTO.has(l.text)) required.set(l.text, `${s.file}:${l.line}`);
}
for (const k of DEL_SERVIDOR) required.set(k, "servidor");
for (const k of Object.keys(SERVIDOR_EN)) required.set(k, "servidor");

describe("las pantallas de Pilo en inglés y portugués", () => {
  it("ningún texto JSX se queda fuera de tr()", () => {
    const loose = surfaces.flatMap((s) => s.jsx.filter((j) => !NO_TRADUCIR.has(j.text)).map((j) => `${s.file}:${j.line} «${j.text}»`));
    expect(loose).toEqual([]);
  });

  it("cada texto tiene su traducción al inglés y al portugués", () => {
    if (process.env.PILO_I18N_DUMP) writeFileSync(process.env.PILO_I18N_DUMP, JSON.stringify([...required.entries()].map(([k, w]) => ({ k, w })), null, 1));
    const missingEn = [...required.keys()].filter((k) => !dictOk("en", k));
    const missingPt = [...required.keys()].filter((k) => !dictOk("pt", k));
    if (process.env.PILO_I18N_MISSING) writeFileSync(process.env.PILO_I18N_MISSING, JSON.stringify(missingEn, null, 1));
    expect({ en: missingEn.length, pt: missingPt.length, ejemplo: missingEn.slice(0, 8) }).toEqual({ en: 0, pt: 0, ejemplo: [] });
  });

  it("cada traducción conserva las variables del original", () => {
    const bad: string[] = [];
    for (const lang of ["en", "pt"] as const) {
      for (const [k, v] of Object.entries(DICTIONARY[lang])) if (vars(k) !== vars(v)) bad.push(`${lang}: «${k}» → «${v}»`);
    }
    expect(bad).toEqual([]);
  });

  it("el diccionario no guarda traducciones de textos que ya no existen", () => {
    const keys = new Set(required.keys());
    const extra = Object.keys(DICTIONARY.en).filter((k) => !keys.has(k));
    expect(extra).toEqual([]);
  });
});
