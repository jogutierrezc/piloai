import { describe, expect, it } from "vitest";
import { activeStep, badgeOf, compactThink, interruptedTurn, notesOf, originNote, originOf, reduceSteps, secondsText, showsSources, THINKING_KEEP, waitingLine } from "./answer-state";
import type { ThinkStep } from "./answer-state";
import type { AskMeta, AskResult, AskSource, AskThinkStep } from "../../components/pilo/ai/client";

const src = (n: number): AskSource => ({ n, ref: `cifras:${n}`, source: "cifras", title: `Fuente ${n}`, section: "", path: "/cifras", cut: "2024", office: "", excerpt: "" });
const answer = (over: Partial<AskResult>): AskResult => ({ kind: "ia", text: "Texto.", sources: [], trail: [], ...over });
const play = (events: AskThinkStep[]) => events.reduce<ThinkStep[]>(reduceSteps, []);

describe("la etiqueta de procedencia", () => {
  it("oficial, mixta y conocimiento general, según el grounding del servidor", () => {
    expect(badgeOf(answer({ grounding: "oficial", sources: [src(1)] }))).toMatchObject({ text: "Redactada con IA · con fuentes de la UDES", icon: "spark" });
    expect(badgeOf(answer({ grounding: "mixta", sources: [src(1)] }))?.text).toBe("Redactada con IA · parte es conocimiento general");
    expect(badgeOf(answer({ grounding: "general" }))).toEqual({ text: "Conocimiento general · no es información oficial de la UDES", tone: "general", icon: "globe" });
  });

  it("la marca de conocimiento general no depende solo del color: lleva glifo y frase", () => {
    const badge = badgeOf(answer({ grounding: "general" }));
    expect(badge?.icon).toBeTruthy();
    expect(badge?.text).toMatch(/no es información oficial/);
  });

  it("un saludo o una charla no llevan etiqueta de fuentes", () => {
    expect(badgeOf(answer({ intent: "saludo", grounding: "general" }))).toBeNull();
    expect(badgeOf(answer({ intent: "charla" }))).toBeNull();
  });

  it("ya no dice «sin IA»: las respuestas sin modelo dicen de dónde salen", () => {
    for (const kind of ["curada", "memoria", "extracto", "dato", "malla", "capciosa", "regla", "nada"] as const) {
      const badge = badgeOf(answer({ kind }));
      expect(badge?.text, kind).toBeTruthy();
      expect(badge?.text, kind).not.toMatch(/sin IA/i);
    }
    expect(badgeOf(answer({ kind: "curada" }))?.text).toBe("Respuesta oficial de la UDES");
  });

  it("las conversaciones guardadas antes (sin grounding) siguen teniendo etiqueta", () => {
    expect(badgeOf(answer({ sources: [src(1)] }))?.text).toBe("Redactada con IA · con fuentes de la UDES");
    expect(badgeOf(answer({}))?.text).toBe("Redactada con IA");
  });

  it("una respuesta interrumpida se marca como incompleta", () => {
    expect(badgeOf(answer({ grounding: "oficial" }), true)).toMatchObject({ text: "Respuesta incompleta", tone: "aviso" });
  });

  it("con conocimiento general no se muestra la lista de fuentes", () => {
    expect(showsSources(answer({ grounding: "general", sources: [src(1)] }))).toBe(false);
    expect(showsSources(answer({ grounding: "mixta", sources: [src(1)] }))).toBe(true);
    expect(showsSources(answer({ kind: "memoria", sources: [src(1)] }))).toBe(true);
    expect(showsSources(answer({ grounding: "oficial" }))).toBe(false);
  });
});

describe("las notas discretas", () => {
  it("parcial: la frase del servidor; sin ella, una propia", () => {
    expect(notesOf(answer({ partial: true, notice: "El proveedor de IA tardó demasiado: esta respuesta quedó incompleta." }))).toEqual(["El proveedor de IA tardó demasiado: esta respuesta quedó incompleta."]);
    expect(notesOf(answer({ partial: true }))).toHaveLength(1);
  });

  it("corta, y la IA no respondió", () => {
    expect(notesOf(answer({ truncated: true }))).toEqual(["La respuesta quedó corta: llegó al tope de extensión."]);
    expect(notesOf(answer({ kind: "curada", fallback: "tiempo" }))).toEqual(["La IA no respondió: esta es la respuesta oficial, tal cual."]);
    expect(notesOf(answer({ kind: "extracto", fallback: "proveedor" }))[0]).toMatch(/le muestro lo publicado, tal cual/);
    expect(notesOf(answer({ grounding: "oficial" }))).toEqual([]);
  });
});

describe("la procedencia de lo que viene de otro ámbito de Pilo (0122)", () => {
  const FROM = "De Pilo en Enseñanza · Políticas institucionales";
  const visit = (n: number, over: Partial<AskSource> = {}): AskSource => ({ ...src(n), via: "visita", from: FROM, ...over });

  it("solo la dice si el servidor la mandó: una fuente de casa no tiene procedencia", () => {
    expect(originOf(src(1))).toBeNull();
    expect(originOf({ via: "mapa" })).toBeNull();
    // La página no la deduce: sin la marca del servidor, no hay procedencia aunque venga un texto.
    expect(originOf({ from: FROM })).toBeNull();
    expect(originOf({ via: "visita" })).toBeNull();
    expect(originOf(visit(2))).toBe(FROM);
    expect(originOf(visit(2, { via: "puente" }))).toBe(FROM);
    expect(originOf(visit(2, { from: `  De   Pilo\n en Enseñanza ` }))).toBe("De Pilo en Enseñanza");
  });

  it("la nota la nombra en palabras, una vez por procedencia, y dice para quién fue preparado si el servidor lo dijo", () => {
    expect(originNote([src(1)])).toBe("");
    expect(originNote([src(1), visit(2), visit(3)])).toBe(`Parte de esta respuesta viene de otro ámbito de Pilo: ${FROM}.`);
    expect(originNote([visit(1, { written_for: "profesores y estudiantes" }), visit(2, { from: "De Pilo de la Universidad · UDES en Cifras", via: "puente" })])).toBe(
      `Parte de esta respuesta viene de otro ámbito de Pilo: ${FROM} (preparado para profesores y estudiantes); De Pilo de la Universidad · UDES en Cifras.`,
    );
    // Va con las demás notas de la respuesta, primero; y no aparece si la respuesta no muestra fuentes.
    expect(notesOf(answer({ grounding: "oficial", truncated: true, sources: [src(1), visit(2)] }))).toEqual([`Parte de esta respuesta viene de otro ámbito de Pilo: ${FROM}.`, "La respuesta quedó corta: llegó al tope de extensión."]);
    expect(notesOf(answer({ kind: "extracto", sources: [visit(1)] }))).toEqual([`Parte de esta respuesta viene de otro ámbito de Pilo: ${FROM}.`]);
    expect(notesOf(answer({ grounding: "general", sources: [visit(1)] }))).toEqual([]);
  });
});

describe("los pasos de «Pensando…»", () => {
  it("un paso empieza y luego termina, en su sitio y con su detalle", () => {
    const steps = play([
      { id: "entender", label: "Entendiendo la pregunta", state: "start" },
      { id: "entender", label: "Entendiendo la pregunta", state: "done" },
      { id: "cifras", label: "Consultando las cifras", state: "start" },
      { id: "memoria", label: "Buscando en lo que conozco", state: "start" },
      { id: "cifras", label: "Consultando las cifras", detail: "2 cifras de Permanencia 2024", state: "done" },
    ]);
    expect(steps).toEqual([
      { id: "entender", label: "Entendiendo la pregunta", state: "done" },
      { id: "cifras", label: "Consultando las cifras", detail: "2 cifras de Permanencia 2024", state: "done" },
      { id: "memoria", label: "Buscando en lo que conozco", state: "start" },
    ]);
    expect(activeStep(steps)?.id).toBe("memoria");
  });

  it("un id desconocido se pinta igual; sin etiqueta, con su id", () => {
    expect(play([{ id: "algo-nuevo", label: "Cruzando con el Observatorio", state: "start" }])).toEqual([{ id: "algo-nuevo", label: "Cruzando con el Observatorio", state: "start" }]);
    expect(play([{ id: "x9", label: "", state: "start" }])[0].label).toBe("x9");
  });

  it("un start repetido no duplica el paso ni reabre uno terminado", () => {
    const steps = play([
      { id: "memoria", label: "Buscando en lo que conozco", state: "start" },
      { id: "memoria", label: "Buscando en lo que conozco", detail: "5 pasajes", state: "start" },
      { id: "memoria", label: "Buscando en lo que conozco", state: "done" },
      { id: "memoria", label: "Buscando en lo que conozco", state: "start" },
    ]);
    expect(steps).toEqual([{ id: "memoria", label: "Buscando en lo que conozco", detail: "5 pasajes", state: "done" }]);
  });

  it("un done sin start entra ya terminado", () => {
    const steps = play([{ id: "catalogo", label: "Revisando las respuestas oficiales", detail: "1 respuesta oficial", state: "done" }]);
    expect(steps).toEqual([{ id: "catalogo", label: "Revisando las respuestas oficiales", detail: "1 respuesta oficial", state: "done" }]);
    expect(activeStep(steps)).toBeNull();
  });

  it("lo que no trae id se ignora, y no cambia la lista", () => {
    const before = play([{ id: "a", label: "A", state: "start" }]);
    expect(reduceSteps(before, { id: " ", label: "sin id", state: "start" })).toBe(before);
    expect(reduceSteps(before, {} as AskThinkStep)).toBe(before);
    expect(reduceSteps(before, { id: "b", label: "B", state: "raro" as "start" })).toHaveLength(2);
  });

  it("no cambia la lista que recibe", () => {
    const before = play([{ id: "a", label: "A", state: "start" }]);
    const after = reduceSteps(before, { id: "a", label: "A", state: "done" });
    expect(before[0].state).toBe("start");
    expect(after[0].state).toBe("done");
  });
});

describe("el titular mientras Pilo trabaja", () => {
  const meta = (n: number): AskMeta => ({ asked: "", sources: Array.from({ length: n }, (_, i) => src(i + 1)), trail: [] });

  it("con pasos del servidor: el que está en curso, o el último terminado", () => {
    const steps = play([
      { id: "cifras", label: "Consultando las cifras", state: "done" },
      { id: "redactar", label: "Redactando la respuesta", state: "start" },
    ]);
    expect(waitingLine({ steps, meta: null, seconds: 5 })).toBe("Redactando la respuesta");
    // La redacción larga cuenta en qué anda, para que no parezca un cuelgue.
    expect(waitingLine({ steps, meta: null, seconds: 40 })).toBe("Revisando las fuentes para no inventar cifras…");
    expect(waitingLine({ steps, meta: null, seconds: 120 })).toBe("Ya casi: sigo esperando la respuesta del modelo…");
    expect(waitingLine({ steps: steps.slice(0, 1), meta: null, seconds: 1 })).toBe("Consultando las cifras");
  });

  it("sin pasos: una sola línea honesta que cambia con el tiempo", () => {
    expect(waitingLine({ steps: [], meta: null, seconds: 0 })).toBe("Buscando en lo que conozco…");
    expect(waitingLine({ steps: [], meta: null, seconds: 8 })).toBe("Redactando la respuesta…");
    expect(waitingLine({ steps: [], meta: null, seconds: 25 })).toBe("Esto está tardando más de lo normal; sigo en ello.");
  });

  it("sin pasos pero con meta: dice lo que encontró", () => {
    expect(waitingLine({ steps: [], meta: meta(4), seconds: 2 })).toBe("Encontré 4 fuentes. Redactando la respuesta…");
    expect(waitingLine({ steps: [], meta: meta(1), seconds: 2 })).toBe("Encontré 1 fuente. Redactando la respuesta…");
    expect(waitingLine({ steps: [], meta: meta(0), seconds: 2 })).toBe("Redactando la respuesta…");
  });

  it("los segundos, en palabras", () => {
    expect([secondsText(0.2), secondsText(12.4), secondsText(60), secondsText(65)]).toEqual(["1 s", "12 s", "1 min", "1 min 5 s"]);
  });
});

describe("lo que se guarda de «Pensando…»", () => {
  it("los pasos, el tiempo y solo el comienzo del razonamiento", () => {
    const think = compactThink(play([{ id: "redactar", label: "Redactando la respuesta", state: "start" }]), "razona ".repeat(400), 12.4);
    expect(think.seconds).toBe(12);
    expect(think.steps).toEqual([{ id: "redactar", label: "Redactando la respuesta", state: "done" }]);
    expect(think.thinking?.length).toBeLessThanOrEqual(THINKING_KEEP + 1);
    expect(think.thinking?.endsWith("…")).toBe(true);
  });

  it("sin razonamiento no guarda el campo", () => {
    expect(compactThink([], "  ", 3)).toEqual({ steps: [], seconds: 3 });
  });
});

describe("una respuesta interrumpida", () => {
  const meta: AskMeta = { asked: "a → b", intent: "institucional", sources: [src(1), src(2), src(3)], trail: [{ step: "Enrutador", status: "ok", detail: "", ms: 3 }] };

  it("conserva lo escrito, marcado como incompleto, con las fuentes que alcanzó a citar", () => {
    const turn = interruptedTurn("En 2024 hubo 20.500 [1]. Y en Cúcuta [3]. ", meta, "Se cortó la conexión mientras Pilo escribía.");
    expect(turn.incomplete).toBe(true);
    expect(turn.error).toBe("Se cortó la conexión mientras Pilo escribía.");
    expect(turn.answer).toMatchObject({ kind: "ia", text: "En 2024 hubo 20.500 [1]. Y en Cúcuta [3].", asked: "a → b", answerId: null });
    expect(turn.answer?.sources.map((s) => s.n)).toEqual([1, 3]);
    expect(turn.answer?.grounding).toBeUndefined();
  });

  it("detenida por la persona: incompleta y sin mensaje de error", () => {
    const turn = interruptedTurn("Hola. ", null);
    expect(turn).toMatchObject({ incomplete: true, answer: { text: "Hola.", sources: [], trail: [] } });
    expect(turn.error).toBeUndefined();
  });

  it("sin nada escrito queda el mensaje, no una respuesta vacía", () => {
    expect(interruptedTurn("  ", meta, "No pude conectarme con Pilo.")).toEqual({ error: "No pude conectarme con Pilo." });
    expect(interruptedTurn("", null).error).toMatch(/Detuvo la pregunta/);
  });
});

describe("mientras espera: consejos y gestos", () => {
  it("el primer consejo tarda unos segundos y luego cambia cada tanto, sin repetirse de inmediato", async () => {
    const { TIP_AFTER, TIP_EVERY, WAIT_TIPS, waitingTip } = await import("./answer-state");
    expect(waitingTip(0)).toBeNull();
    expect(waitingTip(TIP_AFTER - 0.1)).toBeNull();
    expect(waitingTip(Number.NaN)).toBeNull();
    const first = waitingTip(TIP_AFTER);
    expect(first).toBe(WAIT_TIPS[0]);
    expect(waitingTip(TIP_AFTER + TIP_EVERY - 0.1)).toBe(first);
    expect(waitingTip(TIP_AFTER + TIP_EVERY)).toBe(WAIT_TIPS[1]);
    // La semilla del turno cambia por dónde empieza; al acabar la lista, vuelve al comienzo.
    expect(waitingTip(TIP_AFTER, 3)).toBe(WAIT_TIPS[3]);
    expect(waitingTip(TIP_AFTER, -3)).toBe(WAIT_TIPS[3]);
    expect(waitingTip(TIP_AFTER + TIP_EVERY * WAIT_TIPS.length)).toBe(WAIT_TIPS[0]);
  });

  it("los consejos hablan de cómo preguntarle a Pilo, no dan cifras ni prometen tiempos", async () => {
    const { WAIT_TIPS } = await import("./answer-state");
    expect(WAIT_TIPS.length).toBeGreaterThanOrEqual(8);
    expect(new Set(WAIT_TIPS).size).toBe(WAIT_TIPS.length);
    for (const tip of WAIT_TIPS) {
      expect(tip.length, tip).toBeLessThanOrEqual(110);
      expect(tip, tip).not.toMatch(/\d{2,}|segundos|minutos/);
    }
  });

  it("la cara vuelve siempre a pensar y entre una y otra cambia de gesto; al escribir, se emociona", async () => {
    const { FACE_EVERY, seedOf, waitingFace } = await import("./answer-state");
    expect(waitingFace(0)).toBe("pensar");
    expect(waitingFace(-5)).toBe("pensar");
    const faces = Array.from({ length: 6 }, (_, i) => waitingFace(i * FACE_EVERY));
    expect(faces).toEqual(["pensar", "neutral", "pensar", "atrevido", "pensar", "emocionado"]);
    expect(waitingFace(6 * FACE_EVERY)).toBe("pensar");
    expect(waitingFace(3, true)).toBe("emocionado");
    expect(seedOf("turno-1")).toBe(seedOf("turno-1"));
    expect(seedOf("turno-1")).not.toBe(seedOf("turno-2"));
    expect(Number.isInteger(seedOf(""))).toBe(true);
  });
});
