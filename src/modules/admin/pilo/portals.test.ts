/* La matriz portal × fuente (0121), sin red ni base: qué opciones tiene cada
   celda, qué lee de verdad un portal y cómo se cuenta el efecto de un cambio. */
import { describe, expect, it } from "vitest";
import { cellChoices, cellOf, confirmText, docCollections, effectText, effectiveCell, homeFlags, mergeSourceFlags, missing0121, missing0122, parseEffect, parsePortals, visitConfirmText } from "./portals";

const SOURCES = [
  { id: "cifras", scope: "planeacion", name: "UDES en Cifras", kind: "portal", staff_only: false, stays_home: false, sort: 1 },
  { id: "impacto", scope: "planeacion", name: "Portal de Impacto", kind: "portal", staff_only: true, stays_home: false, sort: 5 },
  { id: "normativa", scope: "planeacion", name: "Normativa", kind: "documentos", staff_only: false, stays_home: false, sort: 7 },
  { id: "politicas", scope: "ensenanza", name: "Políticas institucionales", kind: "documentos", staff_only: false, stays_home: false, sort: 12 },
  { id: "moodle", scope: "ensenanza", name: "Cursos de Moodle", kind: "moodle", staff_only: false, stays_home: true, sort: 14 },
];
const PORTALS = [
  { id: "ensenanza", scope: "ensenanza", name: "Pilo en Enseñanza", written_for: "profesores y estudiantes", sort: 2, matrix: { politicas: "casa", moodle: "casa", cifras: "no" } },
  { id: "planeacion", scope: "planeacion", name: "Pilo de la Universidad", written_for: "la dirección", sort: 1, matrix: { cifras: "casa", impacto: "casa", normativa: "no", politicas: "no", moodle: "no" } },
];

const data = parsePortals(PORTALS, SOURCES);
const [general, teach] = data.portals;
const src = (id: string) => data.sources.find((s) => s.id === id)!;

describe("leer la matriz", () => {
  it("ordena los portales y las fuentes, y lo que no reconoce no entra", () => {
    expect(data.portals.map((p) => p.id)).toEqual(["planeacion", "ensenanza"]);
    expect(data.sources.map((s) => s.id)).toEqual(["cifras", "impacto", "normativa", "politicas", "moodle"]);
    const odd = parsePortals(
      [{ id: "planeacion", scope: "planeacion", matrix: { cifras: "siempre", pdi: "casa", moodle: 1 } }, null, "x", { id: 3 }],
      [{ id: "Mala", scope: "planeacion" }, { id: "pdi", scope: "planeacion", kind: "otra" }, null],
    );
    expect(odd.portals).toHaveLength(1);
    expect(odd.portals[0].matrix).toEqual({ pdi: "casa" });
    expect(odd.portals[0].name).toBe("planeacion");
    expect(odd.sources).toEqual([{ id: "pdi", scope: "planeacion", name: "pdi", kind: "portal", staff_only: false, stays_home: false, sort: 0 }]);
    expect(parsePortals(null, undefined)).toEqual({ portals: [], sources: [] });
  });

  it("lo que no está escrito es «no»", () => {
    expect(cellOf(teach, src("normativa"))).toBe("no");
    expect(cellOf(general, src("cifras"))).toBe("casa");
  });

  it("lo que un portal lee de verdad pasa por las reglas de la base: «casa» solo en lo propio y «visita» solo en lo ajeno que puede salir", () => {
    const forced = parsePortals([{ id: "planeacion", scope: "planeacion", matrix: { cifras: "casa", politicas: "casa", moodle: "visita", normativa: "visita" } }], SOURCES).portals[0];
    expect(effectiveCell(forced, src("cifras"))).toBe("casa");
    // «casa» sobre una fuente de otro ámbito no vale.
    expect(effectiveCell(forced, src("politicas"))).toBe("no");
    // Los cursos de Moodle no salen de su portal, diga lo que diga la celda.
    expect(effectiveCell(forced, src("moodle"))).toBe("no");
    // «visita» sobre lo propio tampoco vale.
    expect(effectiveCell(forced, src("normativa"))).toBe("no");
    // «visita» sobre lo ajeno que puede salir, sí.
    const open = parsePortals([{ id: "planeacion", scope: "planeacion", matrix: { politicas: "visita" } }], SOURCES).portals[0];
    expect(effectiveCell(open, src("politicas"))).toBe("visita");
    expect(effectiveCell(open, src("cifras"))).toBe("no");
  });
});

describe("las opciones de una celda", () => {
  it("en lo propio: «De casa» o «No»; nunca «De visita»", () => {
    const choices = cellChoices(general, src("cifras"));
    expect(choices.map((c) => [c.value, c.enabled])).toEqual([["casa", true], ["no", true]]);
    // Impacto dice que pide sesión de la intranet.
    expect(cellChoices(general, src("impacto"))[0].note).toMatch(/personal con sesión de la intranet/);
  });

  it("en lo ajeno: «De visita» o «No»; nunca «De casa»", () => {
    const choices = cellChoices(general, src("politicas"));
    expect(choices.map((c) => [c.value, c.label, c.enabled])).toEqual([["visita", "De visita", true], ["no", "No", true]]);
    expect(choices[0].note).toMatch(/solo si lo de casa no alcanza o por un puente aprobado, después de lo de casa y diciendo de dónde viene\.$/);
    // «De casa» no se ofrece para lo de otro ámbito.
    expect(choices.some((c) => c.value === "casa")).toBe(false);
    // Una fuente que pide sesión la sigue pidiendo de visita.
    expect(cellChoices(teach, src("impacto"))[0]).toMatchObject({ value: "visita", enabled: true, note: expect.stringMatching(/solo para el personal con sesión de la intranet/) });
  });

  it("los cursos de Moodle no salen de su portal: se dice por qué", () => {
    expect(cellChoices(general, src("moodle"))[0]).toMatchObject({ value: "visita", enabled: false, note: "Cursos de Moodle no sale de su portal." });
    expect(cellChoices(teach, src("moodle")).map((c) => c.value)).toEqual(["casa", "no"]);
  });
});

describe("lo que se dice de un cambio", () => {
  it("antes: la pregunta nombra la consecuencia", () => {
    expect(confirmText(general, src("cifras"), "no")).toBe(
      "¿«Pilo de la Universidad» deja de leer UDES en Cifras? Sus pasajes siguen guardados, pero no entran en ninguna respuesta de este portal, y las respuestas guardadas que los citan dejan de servirse.",
    );
    expect(confirmText(general, src("impacto"), "casa")).toMatch(/vuelve a leer Portal de Impacto\? .*solo para el personal con sesión de la intranet/);
    expect(confirmText(general, src("normativa"), "casa")).not.toMatch(/sesión/);
  });

  it("antes de marcar «De visita»: cuántos pasajes de qué fuente podrá leer ese portal y quién los verá", () => {
    const effect = parseEffect({ source: "politicas", name: "Políticas institucionales", from: "no", to: "visita", passages: 38, public: 37, session: 1, answers: 0, bridges: 12, staff_only: false, home: "Pilo en Enseñanza", written_for: "profesores y estudiantes" })!;
    expect(confirmText(general, src("politicas"), "visita", effect)).toBe(
      "¿«Pilo de la Universidad» podrá leer Políticas institucionales de visita? 37 son públicos y los verá cualquiera que pregunte en este portal; 1 es «con sesión» y solo lo verá el personal con sesión de la intranet (una cuenta de Pilo no). " +
        "Entran solo cuando lo de casa no alcanza o cuando los trae un puente aprobado, después de lo de casa y a lo sumo 2 por respuesta. Hay 12 puentes aprobados entre los dos ámbitos. " +
        "Pilo dirá que vienen de «Pilo en Enseñanza» y, a quien no sea de ese público, que fue preparado para profesores y estudiantes. Lo que cite algo de visita no se guarda como respuesta.",
    );
    // Mientras la base cuenta, se dice lo que no depende de la cuenta, y que se está contando.
    expect(visitConfirmText(general, src("politicas"), null)).toMatch(/^¿«Pilo de la Universidad» podrá leer Políticas institucionales de visita\? .* Contando qué podrá leer…$/);
    // Una fuente que pide sesión: solo el personal, sea cual sea la visibilidad del pasaje.
    const impact = parseEffect({ source: "impacto", name: "Portal de Impacto", from: "no", to: "visita", passages: 9, public: 9, session: 0, answers: 0, bridges: 0, staff_only: true, home: "Pilo de la Universidad", written_for: "" })!;
    const said = confirmText(teach, src("impacto"), "visita", impact);
    expect(said).toMatch(/Solo los verá el personal con sesión de la intranet \(9 pasajes\)/);
    expect(said).toMatch(/Todavía no hay puentes aprobados entre los dos ámbitos\./);
    expect(said).not.toMatch(/fue preparado para/);
    // Sin pasajes todavía.
    expect(confirmText(general, src("politicas"), "visita", { ...effect, passages: 0, public: 0, session: 0 })).toMatch(/Esa fuente todavía no tiene pasajes/);
    // Apagar una celda de visita no habla de respuestas guardadas: lo de visita nunca se guardó.
    expect(confirmText(general, src("politicas"), "no")).toBe("¿«Pilo de la Universidad» deja de leer Políticas institucionales de visita? Sus pasajes siguen en su portal; aquí ya no entran en ninguna respuesta, ni por un puente aprobado.");
  });

  it("después: el efecto, con los números de la base", () => {
    expect(effectText(general, { source: "politicas", name: "Políticas institucionales", from: "no", to: "visita", passages: 38, answers: 0 })).toBe(
      "«Pilo de la Universidad» ya puede leer Políticas institucionales de visita: 38 pasajes, cada uno con su visibilidad. Entran solo si lo de casa no alcanza o por un puente aprobado.",
    );
    expect(effectText(general, { source: "politicas", name: "Políticas institucionales", from: "visita", to: "no", passages: 38, answers: 0 })).toBe(
      "«Pilo de la Universidad» ya no lee Políticas institucionales de visita: sus pasajes siguen en su portal y aquí no entran por ningún camino.",
    );
    expect(effectText(general, { source: "cifras", name: "UDES en Cifras", from: "casa", to: "no", passages: 214, answers: 3 })).toBe(
      "«Pilo de la Universidad» ya no lee UDES en Cifras: 214 pasajes quedan guardados, pero no entran en sus respuestas. 3 respuestas guardadas que la citaban dejan de servirse.",
    );
    expect(effectText(general, { source: "cifras", name: "UDES en Cifras", from: "casa", to: "no", passages: 1, answers: 1 })).toBe(
      "«Pilo de la Universidad» ya no lee UDES en Cifras: 1 pasaje queda guardado, pero no entra en sus respuestas. 1 respuesta guardada que la citaba deja de servirse.",
    );
    expect(effectText(general, { source: "normativa", name: "Normativa", from: "no", to: "casa", passages: 0, answers: 0 })).toBe(
      "«Pilo de la Universidad» ya lee Normativa, que todavía no tiene pasajes: entrarán en cuanto se carguen.",
    );
    expect(effectText(general, { source: "normativa", name: "Normativa", from: "no", to: "casa", passages: 1240, answers: 0 })).toBe(
      "«Pilo de la Universidad» ya lee Normativa: 1.240 pasajes entran en sus respuestas desde ahora.",
    );
    expect(effectText(teach, { source: "politicas", name: "Políticas institucionales", from: "casa", to: "no", passages: 0, answers: 0 })).toBe("«Pilo en Enseñanza» ya no lee Políticas institucionales: no tenía pasajes.");
  });
});

describe("dos pestañas abiertas: los interruptores de «Fuentes» no devuelven una celda que otra pestaña cambió", () => {
  const loaded = { cifras: true, boletines: true, pdi: true };

  it("si esta pestaña no tocó ninguno, no se manda nada", () => {
    expect(mergeSourceFlags({ cifras: true, boletines: true, pdi: true }, loaded, { cifras: true, boletines: true, pdi: false })).toBeNull();
  });

  it("solo viajan los que esta pestaña movió, sobre lo que la base tiene ahora", () => {
    // Otra pestaña apagó el Plan en la matriz; esta apaga los boletines. El Plan sigue apagado.
    expect(mergeSourceFlags({ cifras: true, boletines: false, pdi: true }, loaded, { cifras: true, boletines: true, pdi: false, normativa: true })).toEqual({ cifras: true, boletines: false, pdi: false, normativa: true });
    // Lo que la base tenga y no sea un interruptor no se arrastra.
    expect(mergeSourceFlags({ cifras: false }, { cifras: true }, { cifras: true, pdi: "quizá", politicas: "visita" })).toEqual({ cifras: false });
  });

  it("si no se pudo leer lo de ahora, se parte de lo que esta pestaña leyó; sin eso, se guarda lo del editor", () => {
    expect(mergeSourceFlags({ cifras: true, boletines: false, pdi: true }, loaded, null)).toEqual({ cifras: true, boletines: false, pdi: true });
    expect(mergeSourceFlags({ cifras: false }, null, { cifras: true })).toEqual({ cifras: false });
  });
});

describe("lo que se deriva de la matriz", () => {
  it("los interruptores de siempre son las celdas de casa del portal, y nada de lo ajeno", () => {
    expect(homeFlags(general, data.sources)).toEqual({ cifras: true, impacto: true, normativa: false });
    expect(homeFlags(teach, data.sources)).toEqual({ politicas: true, moodle: true });
  });

  it("las colecciones de documentos de un ámbito: sin las fuentes de portal ni Moodle", () => {
    expect(docCollections(data.sources, "planeacion")).toEqual([{ id: "normativa", code: "NO", name: "Normativa", custom: false }]);
    expect(docCollections(data.sources, "ensenanza")).toEqual([{ id: "politicas", code: "PO", name: "Políticas institucionales", custom: false }]);
    expect(docCollections([{ ...src("normativa"), id: "actas", name: "Actas", custom: true }], "planeacion")).toEqual([{ id: "actas", code: "AC", name: "Actas", custom: true }]);
  });

  it("reconoce que falta la migración", () => {
    expect(missing0121({ code: "PGRST205", message: "Could not find the table 'public.pilo_portals' in the schema cache" })).toBe(true);
    expect(missing0121({ code: "PGRST202", message: "Could not find the function public.pilo_portal_update" })).toBe(true);
    expect(missing0121({ message: 'relation "pilo_portals" does not exist' })).toBe(true);
    expect(missing0121({ code: "42501", message: "permission denied" })).toBe(false);
    expect(missing0121(null)).toBe(false);
    // Con 0121 pero sin 0122, la base todavía rechaza «visita»: se reconoce para decir qué falta.
    expect(missing0122({ code: "22023", message: "La lectura «de visita» todavía no está disponible: por ahora cada portal lee solo lo de su casa." })).toBe(true);
    expect(missing0122({ code: "PGRST202", message: "Could not find the function public.pilo_portal_preview" })).toBe(true);
    expect(missing0122({ code: "40001", message: "Esa celda cambió mientras tanto" })).toBe(false);
  });

  it("el efecto que cuenta la base se lee con cuidado; lo de antes de 0122 no trae la cuenta por visibilidad", () => {
    expect(parseEffect({ source: "pdi", name: "Plan de Desarrollo", from: "casa", to: "no", passages: "12", answers: 3 })).toEqual({ source: "pdi", name: "Plan de Desarrollo", from: "casa", to: "no", passages: 12, answers: 3 });
    expect(parseEffect({ source: "pdi", from: "casa", to: "siempre" })).toBeNull();
    expect(parseEffect(null)).toBeNull();
    expect(parseEffect({ source: "politicas", from: "no", to: "visita", passages: 2, public: 1, session: 1, answers: 0, bridges: -3, staff_only: "sí", home: " Pilo  en Enseñanza ", written_for: 7 })).toEqual({
      source: "politicas", name: "politicas", from: "no", to: "visita", passages: 2, answers: 0, public: 1, session: 1, bridges: 0, staff_only: false, home: "Pilo en Enseñanza", written_for: "",
    });
  });
});
