/* =============================================================================
   Aislamiento de los espacios en la función pilo-ia (0113) · prueba ESTÁTICA.

   Lee el archivo de la función y revisa cada consulta a una tabla de Pilo que
   lleva espacio y cada llamada a una función `pilo_…` de la base: o atiende el
   espacio (manda `p_space`, filtra o marca la fila con `space`), o está en la
   lista de abajo con su razón. Quien agregue una consulta nueva y olvide el
   espacio, rompe esta prueba: así no se mezclan la memoria, el catálogo, las
   respuestas guardadas, la bandeja ni la bitácora de dos Pilos.

   Desde 0121 hay una sola memoria y cada portal es una vista: el filtro lo
   aplica la base (`pilo_scope`). Por eso cada LECTURA de la memoria lleva
   además quién lee (`reader`: el portal, si es personal con sesión y si es una
   cuenta de Pilo) cuando la base tiene 0121, también en el portal de siempre.
   ========================================================================== */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../../../../supabase/functions/pilo-ia/index.ts"), "utf8").replace(/\r\n/g, "\n");
// Solo el código de la función: la copia de logic.ts no toca la base.
const code = source.slice(source.indexOf("// --- fin de la lógica"));
const lines = code.split("\n");

/** Las tablas de Pilo que tienen columna `space` desde 0113. */
const TABLES = ["pilo_memory", "pilo_answers", "pilo_catalog", "pilo_inbox", "pilo_nodes", "pilo_edges", "pilo_ai_log"];

/** Cómo se ve que una consulta atiende el espacio. */
const HANDLES = /\bp_space\b|"space"|\binSpace\(|\bspace,|\.\.\.reader\b/;
/** Cuántas líneas abarca una consulta, contando la suya. */
const WINDOW = 4;

interface Allowed {
  /** La tabla o la función. */
  name: string;
  /** Un trozo de la misma línea, para saber cuál de las llamadas es. */
  near: string;
  why: string;
}

/**
 * Lo que no lleva espacio, y por qué. Cada entrada vale para UNA línea: la que
 * nombra esa tabla o función y contiene `near`.
 */
const ALLOWED: Allowed[] = [
  // Sin cambio de firma en 0113 (plan §1): trabajan por llave, y la llave es única entre espacios.
  { name: "pilo_visitor_hit", near: "p_visitor: visitor", why: "el espacio va dentro de la huella (visitorSeed), no como parámetro" },
  { name: "pilo_embed_save", near: "p_rows: payload", why: "guarda por (tipo, ref): las filas salen de pilo_embed_pending, que sí lleva p_space" },
  { name: "pilo_catalog_hit", near: "p_key: key", why: "la clave del catálogo es global (prefijos ER-/EC-) y sale del catálogo ya filtrado por espacio" },
  { name: "pilo_answer_vote", near: "p_id: id", why: "vota por id; antes se comprueba que la respuesta es de este espacio (eq space)" },
  // Las cifras en vivo (0107) son una fuente más de la matriz. Con 0122 llevan quién lee (`...who`, que es `reader`)
  // y la base revisa la celda «cifras»; sin 0122 solo corren si la vista del portal trae «cifras» de casa.
  { name: "pilo_facts_search", near: "p_q: q, p_limit: 3, ...who", why: "lleva quién lee cuando la base tiene 0122 (who = reader); sin ella, solo corre si las fuentes de casa incluyen «cifras»" },
  { name: "pilo_facts_semantic", near: "p_limit: 3, p_min: SEMANTIC_MIN, ...who", why: "igual que pilo_facts_search" },
  // Los puentes (0122) van de un ámbito a otro: no son de un espacio. Solo la administración los calcula y los propone.
  { name: "pilo_bridges_sync", near: "// de un ámbito a otro: sin espacio", why: "calcula los puentes por reglas entre todos los ámbitos, sin parámetros: quien llama no decide qué se une" },
  { name: "pilo_bridges_status", near: '"pilo_bridges_status", from', why: "cuenta los puentes y lo que falta por revisar del ámbito de partida (p_scope)" },
  { name: "pilo_bridge_targets", near: "...from, p_limit: BRIDGE_TARGETS", why: "los puntos de los OTROS ámbitos, que es justo lo que un puente une; solo administración" },
  { name: "pilo_bridge_candidates", near: "...from, p_limit: BRIDGE_CALL", why: "los puntos del ámbito de partida sin revisar (p_scope); solo administración" },
  { name: "pilo_bridges_propose", near: "// cada fila dice sus dos ámbitos", why: "cada propuesta nombra sus dos ámbitos y la base comprueba que cada extremo exista en el suyo" },
  { name: "pilo_facts_campuses", near: 'admin.from("campuses")', why: "los nombres de las sedes, para entender la pregunta: no es contenido de ningún espacio" },
  // El análisis de los boletines es del Pilo de siempre: su acción nunca sale del espacio de partida.
  { name: "pilo_memory_search", near: 'p_sources: ["pdi"]', why: "«analizar» (boletines e Impacto): siempre planeacion, que es el valor de partida de p_space" },
  // Sin 0113 no hay columna que mirar: es la consulta de siempre, y solo corre para planeacion.
  { name: "pilo_answers", near: "if (!row) row =", why: "calificar sin 0113; con 0113 la fila ya se leyó arriba con eq space" },
  // Moodle (0116): trabajan por id de documento, y ese id acaba de salir de pilo_doc_save, que sí lleva p_space y rechaza el documento de otro espacio.
  { name: "pilo_doc_replace", near: "p_doc: docId, p_rows: built.rows", why: "sin parámetro de espacio (0114): los pasajes heredan el espacio del documento, que pilo_doc_save creó o halló con p_space" },
  { name: "pilo_doc_outline", near: "p_doc: docId, p_nodes: outline.nodes", why: "sin parámetro de espacio (0115): el mapa se escribe en el espacio del documento, que pilo_doc_save creó o halló con p_space" },
  { name: "pilo_doc_replace", near: "p_doc: docId, p_rows: page.rows", why: "igual: la página web se guardó con pilo_doc_save y p_space justo antes; el id es de ese documento" },
  // La espera (0128): trabaja por tiquete, no por espacio; el portal solo sirve para saber de quién es la respuesta.
  { name: "pilo_wait_open", near: "p_ticket: ticket, p_portal: portal", why: "abre el tiquete de una respuesta en curso: lleva el portal y la llave es el tiquete" },
  { name: "pilo_wait_close", near: "p_ticket: ticket, p_status: status", why: "cierra el mismo tiquete con la respuesta ya calculada en su espacio" },
  { name: "pilo_wait_read", near: "p_ticket: ticket", why: "lee por tiquete (llave única); no hay contenido de un espacio por consultar" },
];

const calls = lines.flatMap((line, i) => {
  const found: { kind: "tabla" | "función"; name: string; line: number; text: string; window: string }[] = [];
  for (const m of line.matchAll(/\.from\("(pilo_[a-z_]+)"\)/g)) if (TABLES.includes(m[1])) found.push({ kind: "tabla", name: m[1], line: i, text: line, window: lines.slice(i, i + WINDOW).join("\n") });
  for (const m of line.matchAll(/\.rpc\("(pilo_[a-z_]+)"/g)) found.push({ kind: "función", name: m[1], line: i, text: line, window: lines.slice(i, i + WINDOW).join("\n") });
  return found;
});

const allowedFor = (c: (typeof calls)[number]) => ALLOWED.find((a) => a.name === c.name && c.text.includes(a.near));

describe("ninguna consulta de la función olvida el espacio", () => {
  it("la prueba ve las consultas de verdad", () => {
    // Si el archivo cambia de forma y esto deja de encontrar las consultas, que se note.
    expect(calls.length).toBeGreaterThanOrEqual(25);
    for (const name of ["pilo_memory_search", "pilo_memory_semantic", "pilo_answer_candidates", "pilo_catalog_active", "pilo_catalog_semantic", "pilo_catalog_near", "pilo_graph_around", "pilo_embed_status", "pilo_embed_pending", "pilo_inbox_add"]) {
      expect(calls.some((c) => c.name === name), name).toBe(true);
    }
    for (const table of ["pilo_memory", "pilo_answers", "pilo_ai_log"]) expect(calls.some((c) => c.kind === "tabla" && c.name === table), table).toBe(true);
  });

  it("cada tabla con espacio y cada función pilo_… atiende el espacio o está en la lista, con su razón", () => {
    const loose = calls.filter((c) => !HANDLES.test(c.window) && !allowedFor(c)).map((c) => `${c.kind} ${c.name} · ${c.text.trim().slice(0, 140)}`);
    expect(loose).toEqual([]);
  });

  it("la lista no tiene entradas de sobra ni sin razón", () => {
    for (const a of ALLOWED) {
      expect(a.why.length, a.name).toBeGreaterThan(10);
      expect(calls.filter((c) => c.name === a.name && c.text.includes(a.near)).length, `${a.name} · ${a.near}`).toBeGreaterThanOrEqual(1);
    }
  });

  it("las funciones con p_space en 0113 lo mandan en todas sus llamadas (salvo las de la lista)", () => {
    const WITH_SPACE = ["pilo_memory_search", "pilo_memory_semantic", "pilo_answer_candidates", "pilo_catalog_active", "pilo_catalog_semantic", "pilo_catalog_near", "pilo_graph_around", "pilo_embed_status", "pilo_embed_pending", "pilo_inbox_add"];
    const missing = calls.filter((c) => WITH_SPACE.includes(c.name) && !/\bp_space\b/.test(c.window) && !allowedFor(c)).map((c) => `${c.name} · ${c.text.trim().slice(0, 120)}`);
    expect(missing).toEqual([]);
  });

  it("sin 0121 el espacio nunca se manda al de partida: va dentro de inSpace(…) o de la vista del portal", () => {
    // `p_space: space` suelto le llegaría al Pilo de siempre aunque la base no tenga 0121 (y una base
    // sin 0113 no conoce ese parámetro). Solo puede ir dentro de inSpace(…) o donde ya hay vista (`reader`).
    const bare = lines.filter((l) => /p_space:/.test(l) && !/inSpace\(\{[^}]*p_space:/.test(l) && !/\breader = view \? \{ p_space: space,/.test(l)).map((l) => l.trim().slice(0, 120));
    expect(bare).toEqual([]);
    // inSpace solo se abre fuera del espacio de partida, o cuando la administración lo nombró (el mapa).
    expect(code).toMatch(/const inSpace = .*\(spaced \|\| upkeep \? extra : \{\}\)/);
    // Y la vista solo existe si la base respondió pilo_scope: sin 0121, `reader` es null.
    expect(code).toMatch(/const reader = view \? \{ p_space: space, p_public_only: publicOnly, p_member: Boolean\(member\) \} : null;/);
    expect(code).toMatch(/const view = error \? null : portalView\(space, data\);/);
  });

  it("con 0121, cada lectura de la memoria al preguntar lleva quién lee, para que filtre la base", () => {
    // Las dos lecturas de visita (0122) son las únicas que traen algo de otro ámbito: también llevan quién lee.
    const READS = ["pilo_memory_search", "pilo_memory_semantic", "pilo_answer_candidates", "pilo_graph_neighbors", "pilo_graph_around", "pilo_memory_readable", "pilo_memory_visit", "pilo_bridge_neighbors"];
    for (const name of READS) expect(calls.some((c) => c.name === name), name).toBe(true);
    // Fuera de «preguntar»: la prueba de la memoria de la administración (su espacio, con sesión) y el análisis de los boletines.
    const elsewhere = (c: (typeof calls)[number]) => /p_public_only: false \}\)/.test(c.text) || c.text.includes('p_sources: ["pdi"]');
    // `scope` es la vista o, sin ella, lo de antes: las dos búsquedas lo llevan entero.
    expect(code).toMatch(/const scope = reader \?\? inSpace\(\{ p_space: space, p_public_only: publicOnly \}\);/);
    const blind = calls.filter((c) => READS.includes(c.name) && !/\breader\b|\.\.\.scope\b/.test(c.window) && !elsewhere(c)).map((c) => `${c.name} · ${c.text.trim().slice(0, 120)}`);
    expect(blind).toEqual([]);
    // La vista sale del portal y de la sesión que el servidor comprobó, nunca de un campo de la página.
    expect(code).toMatch(/admin\.rpc\("pilo_scope", \{ p_portal: space, p_session: Boolean\(role\), p_member: Boolean\(member\) \}\)/);
    // La tabla de pasajes solo se lee directo sin 0121: con la vista, esas dos lecturas van por pilo_memory_readable.
    expect(calls.filter((c) => c.kind === "tabla" && c.name === "pilo_memory")).toHaveLength(2);
    expect(calls.filter((c) => c.name === "pilo_memory_readable")).toHaveLength(2);
    expect(code).not.toMatch(/p_session: (true|body|Boolean\(member)/);
  });

  it("lo de otro ámbito se lee solo por los dos caminos de visita, una vez cada uno, y siempre con quién lee", () => {
    for (const name of ["pilo_memory_visit", "pilo_bridge_neighbors"]) {
      const found = calls.filter((c) => c.name === name);
      expect(found, name).toHaveLength(1);
      expect(found[0].text, name).toMatch(/\.\.\.reader\b/);
    }
    // El camino «alcance» solo corre si lo de casa no alcanza; el de los puentes, solo desde pasajes de casa.
    expect(code).toMatch(/short \? admin\.rpc\("pilo_memory_visit"/);
    expect(code).toMatch(/admin\.rpc\("pilo_bridge_neighbors", \{ p_refs: memory\.slice\(0, 3\)/);
    // Sin celdas «De visita» en la vista no se llama a nada.
    expect(code).toMatch(/if \(!view \|\| !reader \|\| !view\.visiting\.length \|\| chatty\) return NO_VISIT;/);
    // Lo que cita algo de otro ámbito no se guarda.
    expect(code).toMatch(/!fin\.passages\.some\(\(p\) => p\.visit\)/);
  });

  it("el espacio sale del portal, nunca de un campo de la página (salvo «indexar», de la administración)", () => {
    const reads = lines.filter((l) => /body\.space\b/.test(l));
    expect(reads.length).toBeGreaterThan(0);
    const start = lines.findIndex((l) => l.includes('if (action === "indexar" && body.space !== undefined'));
    expect(start).toBeGreaterThan(-1);
    const block = lines.slice(start, start + 5).join("\n");
    expect(block).toContain("!staffRole");
    expect(block).toContain("isSpace(body.space)");
    // Todas las lecturas de body.space están en ese bloque.
    for (const l of reads) expect(block).toContain(l.trim());
    expect(code).not.toMatch(/body\.sources/);
  });
});

/* =============================================================================
   El personal de Pilo (pilo_0146) en la función. Sin perfil de PDI, la persona de
   `pilo_staff` se reconoce por su fila activa y cada acción administrativa se
   autoriza por su rol y su espacio. Se ejecuta el bloque real del archivo (sin
   tipos) para probar la matriz acción × rol.
   ========================================================================== */

import ts from "typescript";

const staffBlock = (() => {
  const from = code.indexOf("type StaffRole =");
  const to = code.indexOf("\n// El origen permitido");
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  const js = ts.transpileModule(code.slice(from, to), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function(`${js}; return { effectiveStaff, staffAllows, STAFF_SCOPE };`)() as {
    effectiveStaff: (row: unknown, pdiAdmin: boolean) => string | null;
    staffAllows: (staff: string | null, action: string, step: string, space: string | null, portal?: string) => { ok: boolean };
    STAFF_SCOPE: Record<string, string>;
  };
})();

describe("el personal de pilo_staff en la función", () => {
  const { effectiveStaff, staffAllows } = staffBlock;
  const ok = (staff: string | null, action: string, space: string | null, step = "estado", portal = "") => staffAllows(staff, action, step, space, portal).ok;

  it("el rol efectivo sigue el contrato: la fila activa manda, sin ella el admin de PDI es admin", () => {
    expect(effectiveStaff({ role: "docencia", active: true }, false)).toBe("docencia");
    expect(effectiveStaff({ role: "docencia", active: true }, true)).toBe("docencia");
    expect(effectiveStaff({ role: "admin", active: true }, false)).toBe("admin");
    expect(effectiveStaff({ role: "admin", active: false }, true)).toBe("admin");
    expect(effectiveStaff({ role: "admin", active: false }, false)).toBeNull();
    expect(effectiveStaff({ role: "root", active: true }, false)).toBeNull();
    expect(effectiveStaff(null, true)).toBe("admin");
    expect(effectiveStaff(null, false)).toBeNull();
  });

  it("acciones de un espacio: cada rol solo el suyo; admin, los dos; nadie, ninguno", () => {
    for (const action of ["indexar", "comprender", "web", "premisas"]) {
      expect(ok("docencia", action, "ensenanza"), action).toBe(true);
      expect(ok("docencia", action, "planeacion"), action).toBe(false);
      expect(ok("institucional", action, "planeacion"), action).toBe(true);
      expect(ok("institucional", action, "ensenanza"), action).toBe(false);
      for (const space of ["planeacion", "ensenanza"]) {
        expect(ok("ambos", action, space), action).toBe(true);
        expect(ok("admin", action, space), action).toBe(true);
        expect(ok(null, action, space), action).toBe(false);
      }
      expect(ok("ambos", action, null), action).toBe(false);
    }
  });

  it("indexar: solo el estado y el lote son de un espacio; modelos, probar y catalogo son de admin", () => {
    for (const step of ["estado", "lote"]) expect(ok("docencia", "indexar", "ensenanza", step)).toBe(true);
    for (const step of ["modelos", "probar", "catalogo", "otro"]) {
      expect(ok("docencia", "indexar", "ensenanza", step), step).toBe(false);
      expect(ok("ambos", "indexar", "planeacion", step), step).toBe(false);
      expect(ok("admin", "indexar", "planeacion", step), step).toBe(true);
    }
  });

  it("conexión, Moodle, puentes y la voz de prueba: solo admin", () => {
    for (const [action, portal] of [["moodle", ""], ["puentes", ""], ["probar", ""], ["voz", "prueba"]]) {
      for (const role of ["docencia", "institucional", "ambos", null]) expect(ok(role, action, "ensenanza", "probar", portal), `${action} ${role}`).toBe(false);
      expect(ok("admin", action, "ensenanza", "probar", portal), action).toBe(true);
    }
  });

  it("lo que no es administrativo no entra en la matriz (la voz de lectura, preguntar…)", () => {
    for (const action of ["preguntar", "voz", "resumir", "analizar", "evolucion"]) expect(ok("admin", action, "planeacion"), action).toBe(false);
  });

  it("la función reconoce al personal sin perfil y no abre más de lo que ya abría", () => {
    // La fila activa se consulta con la clave de servicio, por el id del JWT, y solo en las acciones administrativas.
    expect(code).toMatch(/admin\.from\("pilo_staff"\)\.select\("role, active"\)\.eq\("user_id", data\.user\.id\)\.eq\("active", true\)\.maybeSingle\(\)/);
    expect(code).toMatch(/const wantsStaff = STAFF_SCOPE\[action\] !== undefined \|\| \(action === "voz" && String\(body\.portal \?\? ""\) === "prueba"\);/);
    // El rol de PDI (`role`) no cambia: el personal no se vuelve «admin» de la intranet, solo pasa canUse en lo administrativo.
    expect(code).toMatch(/let gateRole: Role \| null = role;/);
    expect(code).toMatch(/if \(wantsStaff && staffRole\) \{\s*const verdict = staffAllows\(staffRole, action, String\(body\.step \?\? "estado"\), space, portal\);\s*if \(!verdict\.ok\) return json\(\{ error: verdict\.reason \}, 403\);\s*gateRole = "admin";/);
    expect(code).toMatch(/canUse\(rulesOf, portal, action, gateRole, Boolean\(member\)\)/);
    // Las dos puertas de espacio piden pertenecer al personal, no «admin de PDI».
    expect(code).not.toMatch(/if \(role !== "admin"\) \{\s*const reason/);
    expect(code).not.toMatch(/if \(role !== "admin"\) return json\(\{ error: "Solo la administración indexa/);
  });
});
