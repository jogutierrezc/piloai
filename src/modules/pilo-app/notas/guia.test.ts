import { describe, expect, it } from "vitest";
import {
  GOALS_KEY,
  GUIDE_STEPS,
  MOMENTS,
  accumulatedLine,
  captionWords,
  cleanGoal,
  clearGoals,
  defaultGoals,
  goalHint,
  guideName,
  guideProgress,
  guideScript,
  meterPct,
  readGoals,
  saveGoals,
  semesterHint,
  semesterLine,
  spoken,
  voiceAhead,
} from "./guia";
import { LINK_KEY, clearLink, goalPlan, readLink, saveLink } from "./logic";
import type { LinkStore } from "./logic";

/* Todos los datos de estas pruebas son inventados. */

function fakeStore(): LinkStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe("el guion de la guía", () => {
  const script = guideScript("Camila");

  it("son cinco momentos: bienvenida, permiso, cuenta, metas y despegue", () => {
    expect(MOMENTS).toEqual(["bienvenida", "permiso", "cuenta", "metas", "despegue"]);
    expect(script.map((b) => b.id)).toEqual([...MOMENTS]);
    expect(script.map((b) => b.title)).toEqual(["Hola, soy Pilo", "Primero, su permiso", "Ahora, su cuenta", "Ya tengo sus datos", "¡Excelente, Camila!"]);
    expect(GUIDE_STEPS).toHaveLength(4);
  });

  it("dice lo aprobado, y la voz dice exactamente lo que se lee", () => {
    expect(spoken(script[0])).toBe("Hola, soy Pilo. Puedo leer sus notas de Génesis y contarle cómo va. Solo leo: no cambio nada. Lo guío en cuatro pasos.");
    expect(spoken(script[1])).toBe("Primero, su permiso. Lea lo que le prometo y, si está de acuerdo, autorice.");
    expect(spoken(script[2])).toBe("Ahora, su cuenta. Elija su sede y entre a Génesis como siempre.");
    expect(spoken(script[3])).toBe("Ya tengo sus datos. Puedo analizarlos. Ahora dígame sus metas: ¿qué promedio acumulado quiere alcanzar, y cuál este semestre?");
    expect(spoken(script[4])).toBe("¡Excelente, Camila! Vamos a ver sus notas y mis recomendaciones. ¡Vamos volando juntos!");
    // Todo de usted, y frases cortas.
    for (const beat of script) {
      expect(spoken(beat), beat.id).not.toMatch(/\b(tus|tu cuenta|puedes|tienes|dime|elige|entra)\b/i);
      expect(spoken(beat).length, beat.id).toBeLessThanOrEqual(140);
      expect(captionWords(beat).join(" ")).toBe(beat.say);
    }
  });

  it("solo el despegue cambia con la persona; sin nombre, saluda igual", () => {
    const other = guideScript("Andrés");
    for (const i of [0, 1, 2, 3]) expect(other[i]).toEqual(script[i]);
    expect(other[4].title).toBe("¡Excelente, Andrés!");
    expect(guideScript("")[4].title).toBe("¡Excelente!");
    expect(spoken(guideScript()[4])).toBe("¡Excelente! Vamos a ver sus notas y mis recomendaciones. ¡Vamos volando juntos!");
  });

  it("el nombre es el de la cuenta de Pilo: el apodo o, si no, el primer nombre", () => {
    expect(guideName({ nick: "Cami", full_name: "Camila Inventada Pérez" })).toBe("Cami");
    expect(guideName({ nick: "  ", full_name: "  Camila   Inventada " })).toBe("Camila");
    expect(guideName({ nick: "María José", full_name: "" })).toBe("María José");
    // Va dentro de una frase que se lee en voz alta: solo letras, y corto.
    expect(guideName({ nick: "x_x 99 <b>", full_name: "" })).toBe("x x b");
    expect(guideName({ nick: "a".repeat(60), full_name: "" })).toHaveLength(24);
    for (const nobody of [null, undefined, {}, { nick: "", full_name: "" }, { nick: "123", full_name: "456" }]) expect(guideName(nobody)).toBe("");
  });

  it("el avance a la vista: cuatro pasos, y en el despegue, todos", () => {
    expect(guideProgress(0)).toEqual([false, false, false, false]);
    expect(guideProgress(2)).toEqual([true, true, false, false]);
    expect(guideProgress(4)).toEqual([true, true, true, true]);
  });

  it("la voz se pide por adelantado: el momento, el siguiente y el saludo con el nombre", () => {
    expect(voiceAhead(script, 0)).toEqual([spoken(script[0]), spoken(script[1]), spoken(script[4])]);
    expect(voiceAhead(script, 2)).toEqual([spoken(script[2]), spoken(script[3]), spoken(script[4])]);
    // Sin repetir, y pocos a la vez.
    expect(voiceAhead(script, 3)).toEqual([spoken(script[3]), spoken(script[4])]);
    expect(voiceAhead(script, 4)).toEqual([spoken(script[4])]);
    for (const m of [0, 1, 2, 3, 4] as const) expect(voiceAhead(script, m).length).toBeLessThanOrEqual(3);
  });
});

describe("las metas", () => {
  it("una meta va entre 3,0 y 5,0, de décima en décima", () => {
    expect(cleanGoal(4.24)).toBe(4.2);
    expect(cleanGoal(4.96)).toBe(5);
    expect(cleanGoal(7)).toBe(5);
    expect(cleanGoal(1)).toBe(3);
    for (const no of ["4", null, undefined, NaN, {}]) expect(cleanGoal(no), String(no)).toBeNull();
  });

  it("la primera vez abren un poco por encima de donde va", () => {
    expect(defaultGoals(3.67, 4.24)).toEqual({ accumulated: 4, semester: 4.5 });
    expect(defaultGoals(4.9, 4.9)).toEqual({ accumulated: 5, semester: 5 });
    expect(defaultGoals(null, null)).toEqual({ accumulated: 4, semester: 4.2 });
    expect(defaultGoals(3.5, null)).toEqual({ accumulated: 3.8, semester: 3.8 });
  });

  it("se guardan en el dispositivo, por cuenta: dos números y nada de las notas", () => {
    const store = fakeStore();
    expect(readGoals("u1", store)).toBeNull();
    expect(saveGoals("u1", { accumulated: 4.2, semester: 4.5 }, store)).toBe(true);
    expect(JSON.parse(store.data.get(GOALS_KEY)!)).toEqual({ v: 1, owner: "u1", accumulated: 4.2, semester: 4.5 });
    expect([...store.data.keys()]).toEqual(["pilo-app:notas-metas"]);
    expect(readGoals("u1", store)).toEqual({ accumulated: 4.2, semester: 4.5 });
    // Lo guardado se acota al leerlo y al guardarlo.
    saveGoals("u1", { accumulated: 9, semester: 4.449 }, store);
    expect(readGoals("u1", store)).toEqual({ accumulated: 5, semester: 4.4 });
  });

  it("las de otra cuenta no se entregan: se borran; y lo que no se entiende, también", () => {
    const store = fakeStore();
    saveGoals("u1", { accumulated: 4.2, semester: 4.5 }, store);
    expect(readGoals("u2", store)).toBeNull();
    expect(store.data.has(GOALS_KEY)).toBe(false);
    for (const junk of ["{", "null", '{"v":2,"owner":"u1","accumulated":4,"semester":4}', '{"v":1,"owner":"u1","accumulated":"4","semester":4}']) {
      store.data.set(GOALS_KEY, junk);
      expect(readGoals("u1", store), junk).toBeNull();
      expect(store.data.has(GOALS_KEY)).toBe(false);
    }
  });

  it("sin almacenamiento no falla: las metas quedan en la pantalla", () => {
    expect(saveGoals("u1", { accumulated: 4, semester: 4 }, null)).toBe(false);
    expect(readGoals("u1", null)).toBeNull();
    const full: LinkStore = { getItem: () => null, setItem: () => { throw new Error("QuotaExceeded"); }, removeItem: () => undefined };
    expect(saveGoals("u1", { accumulated: 4, semester: 4 }, full)).toBe(false);
    expect(() => clearGoals(null)).not.toThrow();
  });

  it("qué se guarda y qué se borra al desconectar: el permiso y las metas, y nada más", () => {
    const store = fakeStore();
    const permit = `v1.${"a".repeat(80)}.${"b".repeat(43)}`;
    saveLink("u1", { permit, expires: 2_000_000_000, head: { program: "X", period: "2025B", creditsPercent: 60 }, portal: { id: "cucuta", name: "Cúcuta" } }, true, store);
    saveGoals("u1", { accumulated: 4.2, semester: 4.5 }, store);
    // En el dispositivo hay dos cosas: el permiso (con su sede) y las metas. Ni notas, ni usuario, ni contraseña.
    expect([...store.data.keys()].sort()).toEqual([LINK_KEY, GOALS_KEY].sort());
    expect([...store.data.values()].join(" ")).not.toMatch(/def|courses|average|password|"code"/);
    // «Desconectar» borra las dos.
    clearLink(store);
    clearGoals(store);
    expect([...store.data.keys()]).toEqual([]);
    expect(readLink("u1", 1_800_000_000_000, store)).toBeNull();
    expect(readGoals("u1", store)).toBeNull();
  });
});

describe("las metas, dichas", () => {
  // Va en 3,5 con 60 créditos que pesan; lleva 60 aprobados, el 60 % del plan: le faltan 40.
  const plan = (goal: number, over: Record<string, unknown> = {}) => goalPlan({ accumulated: 3.5, graded: 60, approved: 60, percent: 60, goal, ...over });

  it("lo que necesita promediar", () => {
    expect(accumulatedLine(plan(4), 4)).toBe("Meta 4,0: necesita promediar 4,75 en los 40 créditos que le faltan.");
    expect(goalHint(plan(4))).toBe("Hoy va en 3,5. Para llegar, tendría que promediar 4,75 en lo que le falta.");
    // Con un solo crédito por delante: (3,5 × 40 − 3,48 × 39) / 1 = 4,28.
    expect(accumulatedLine(plan(3.5, { accumulated: 3.48, approved: 39, graded: 39, percent: 97.5 }), 3.5)).toBe("Meta 3,5: necesita promediar 4,28 en el crédito que le falta.");
  });

  it("meta cumplida", () => {
    expect(accumulatedLine(plan(3.4), 3.4)).toBe("Ya está en su meta de 3,4. Manténgala.");
    expect(goalHint(plan(3.4))).toBe("Hoy va en 3,5. Ya está ahí.");
  });

  it("meta inalcanzable", () => {
    expect(accumulatedLine(plan(4.2), 4.2)).toBe("Meta 4,2: con los 40 créditos que le faltan no alcanza. Lo máximo posible es 4,1.");
    expect(goalHint(plan(4.2))).toBe("Hoy va en 3,5. Con lo que le falta, esa meta no alcanza.");
  });

  it("cuando no hay con qué calcular, o ya no quedan créditos, lo dice", () => {
    expect(accumulatedLine(plan(4, { percent: null }), 4)).toBe("Meta 4,0. Aún no puedo calcular cuánto le falta: Génesis no trae su avance en el plan.");
    expect(goalHint(plan(4, { accumulated: null }))).toMatch(/Aún no puedo calcular/);
    expect(accumulatedLine(plan(4, { percent: 100 }), 4)).toBe("Meta 4,0. Ya no le quedan créditos por cursar: su promedio queda en 3,5.");
    expect(goalHint(plan(4, { percent: 100 }))).toBe("Hoy va en 3,5. Ya no le quedan créditos por cursar.");
  });

  it("la meta del semestre se lee contra su último semestre con definitivas", () => {
    expect(semesterLine(3.8, 4.5)).toBe("Meta 4,5: le faltan 0,7 frente a su último semestre.");
    expect(semesterLine(4.6, 4.5)).toBe("Su último semestre ya llegó a 4,5.");
    expect(semesterLine(4.5, 4.5)).toBe("Su último semestre ya llegó a 4,5.");
    expect(semesterLine(null, 4.5)).toBe("Meta 4,5. Aún no hay un semestre con definitivas para comparar.");
    expect(semesterHint(4.24)).toBe("Su último semestre fue 4,24.");
    expect(semesterHint(null)).toBe("Aún no hay un semestre con definitivas para comparar.");
  });

  it("la barra de una meta va de 3,0 a 5,0", () => {
    expect(meterPct(3)).toBe(0);
    expect(meterPct(4)).toBe(50);
    expect(meterPct(5)).toBe(100);
    expect(meterPct(2.1)).toBe(0);
    expect(meterPct(5.5)).toBe(100);
    expect(meterPct(null)).toBe(0);
  });
});
