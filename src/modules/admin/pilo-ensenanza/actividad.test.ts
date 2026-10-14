import { afterEach, describe, expect, it, vi } from "vitest";
import { IDLE_ACTIVITY, IDLE_LINE, IDLE_TITLE, activity, activityReducer, currentJob, dockView, isWorking, jobShare } from "./actividad";
import type { ActivityState } from "./actividad";

const job = (owner: string, title: string, extra: Record<string, unknown> = {}) => ({ owner, title, line: "", ...extra });

describe("la actividad de Pilo: un trabajo por dueño, y se cuenta el último que se movió", () => {
  it("sin trabajo no hay nada que contar", () => {
    expect(currentJob(IDLE_ACTIVITY)).toBeNull();
    expect(isWorking(IDLE_ACTIVITY, "documentos")).toBe(false);
  });

  it("cada dueño tiene un solo trabajo; volver a reportar lo reemplaza y lo pone al frente", () => {
    let s = activityReducer(IDLE_ACTIVITY, { type: "set", job: job("documentos", "Leyendo A") });
    s = activityReducer(s, { type: "set", job: job("moodle", "Leyendo curso") });
    s = activityReducer(s, { type: "set", job: job("documentos", "Guardando A", { progress: 0.5 }) });
    expect(s.jobs).toHaveLength(2);
    expect(currentJob(s)?.title).toBe("Guardando A");
    expect(isWorking(s, "moodle")).toBe(true);
  });

  it("al terminar un dueño vuelve a contarse el que seguía en curso", () => {
    let s = activityReducer(IDLE_ACTIVITY, { type: "set", job: job("moodle", "Leyendo curso") });
    s = activityReducer(s, { type: "set", job: job("indice", "Indexando") });
    s = activityReducer(s, { type: "end", owner: "indice" });
    expect(currentJob(s)?.title).toBe("Leyendo curso");
    s = activityReducer(s, { type: "end", owner: "moodle" });
    expect(currentJob(s)).toBeNull();
  });

  it("terminar algo que no estaba en curso no cambia nada (ni el objeto)", () => {
    const s = activityReducer(IDLE_ACTIVITY, { type: "set", job: job("mapa", "Comprendiendo") });
    expect(activityReducer(s, { type: "end", owner: "prueba" })).toBe(s);
  });

  it("la cara que se mira no toca los trabajos, y repetir la misma no cambia el estado", () => {
    const working = activityReducer(IDLE_ACTIVITY, { type: "set", job: job("mapa", "Comprendiendo") });
    const a = activityReducer(working, { type: "preview", preview: { expression: "feliz", label: "Cara del estudiante" } });
    expect(a.jobs).toBe(working.jobs);
    expect(a.preview?.expression).toBe("feliz");
    expect(activityReducer(a, { type: "preview", preview: { expression: "feliz", label: "Cara del estudiante" } })).toBe(a);
    expect(activityReducer(a, { type: "preview", preview: null }).preview).toBeNull();
    expect(activityReducer(IDLE_ACTIVITY, { type: "preview", preview: null })).toBe(IDLE_ACTIVITY);
  });
});

describe("el avance de un trabajo", () => {
  it("sin avance conocido no se inventa un porcentaje", () => {
    expect(jobShare(null)).toBeUndefined();
    expect(jobShare(job("prueba", "Buscando"))).toBeUndefined();
    expect(jobShare(job("prueba", "Buscando", { progress: Number.NaN }))).toBeUndefined();
  });

  it("queda siempre entre 0 y 1", () => {
    expect(jobShare(job("indice", "Indexando", { progress: 0.4 }))).toBe(0.4);
    expect(jobShare(job("indice", "Indexando", { progress: -2 }))).toBe(0);
    expect(jobShare(job("indice", "Indexando", { progress: 7 }))).toBe(1);
  });
});

describe("lo que muestra el panel de Pilo", () => {
  it("sin trabajo: su cara de siempre y la frase de reposo", () => {
    expect(dockView(IDLE_ACTIVITY)).toMatchObject({ expression: "graduado", busy: false, title: IDLE_TITLE, line: IDLE_LINE, share: undefined, canStop: false, preview: null, waiting: 0 });
  });

  it("sin trabajo y eligiendo la cara de un rol: esa cara, y dice de quién es", () => {
    const s: ActivityState = { jobs: [], preview: { expression: "emocionado", label: "Cara de partida para el estudiante: Emocionado" } };
    expect(dockView(s)).toMatchObject({ expression: "emocionado", busy: false, preview: "Cara de partida para el estudiante: Emocionado" });
  });

  it("trabajando: piensa, cuenta el trabajo y su avance; la cara que se elegía espera", () => {
    const s: ActivityState = {
      jobs: [job("moodle", "Leyendo curso"), job("comprender", "Pilo está comprendiendo sus pasajes", { line: "86 de 240 pasajes", progress: 0.36, counter: "Lote 3", stop: () => undefined })],
      preview: { expression: "feliz", label: "Cara del estudiante" },
    };
    expect(dockView(s)).toMatchObject({ expression: "pensar", busy: true, title: "Pilo está comprendiendo sus pasajes", line: "86 de 240 pasajes", counter: "Lote 3", share: 0.36, waiting: 1, preview: null, canStop: true });
  });

  it("«Detener» solo se ofrece si el trabajo dice cómo detenerse", () => {
    const s: ActivityState = { jobs: [job("prueba", "Pilo está buscando en su memoria")], preview: null };
    expect(dockView(s)).toMatchObject({ busy: true, canStop: false, share: undefined, counter: null });
  });
});

describe("el almacén", () => {
  afterEach(() => {
    for (const j of activity.get().jobs) activity.end(j.owner);
    activity.preview(null);
  });

  it("guarda lo que le reportan y detiene el trabajo que se cuenta", () => {
    const stop = vi.fn();
    activity.set(job("moodle", "Leyendo curso"));
    activity.set(job("indice", "Indexando", { stop }));
    expect(currentJob(activity.get())?.owner).toBe("indice");
    activity.stop();
    expect(stop).toHaveBeenCalledTimes(1);
    activity.end("indice");
    // El que queda no dice cómo detenerse: «Detener» no hace nada.
    expect(() => activity.stop()).not.toThrow();
    expect(currentJob(activity.get())?.owner).toBe("moodle");
  });
});
