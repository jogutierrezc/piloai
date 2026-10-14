/* =============================================================================
   Mr. Pilo · Mis notas (beta) · la guía de Pilo y las metas de la persona.

   La entrada a Mis notas es una guía narrada por Pilo en cinco momentos:
   bienvenida, permiso, cuenta, metas y despegue. Aquí está su guion (lo que
   se lee en pantalla y lo que dice la voz, que es lo mismo), a quién saluda,
   qué audio se pide por adelantado para que la voz no haga esperar, y las
   metas de promedio: cómo se guardan y qué frase le dicen a la persona.

   El nombre del saludo es el de la cuenta de Pilo (el apodo si lo tiene, si
   no el primer nombre). Nunca sale de Génesis.

   Las metas son preferencias de la persona, no notas: se guardan en este
   dispositivo, atadas a su cuenta de Pilo, y «Desconectar» las borra. Las
   frases de lo que necesita promediar salen de goalPlan (logic.ts): aritmética
   del dispositivo, nunca de la IA.

   Puro: se prueba en node.
   ========================================================================== */

import { GOAL, TOP_MARK, nota } from "./logic";
import type { GoalPlan, LinkStore } from "./logic";
import { deviceStore } from "./logic";

/* --- El guion ------------------------------------------------------------------------------- */

/** Los cinco momentos de la guía, en orden. */
export type Moment = 0 | 1 | 2 | 3 | 4;
export const MOMENTS = ["bienvenida", "permiso", "cuenta", "metas", "despegue"] as const;
export type MomentId = (typeof MOMENTS)[number];

export interface GuideBeat {
  id: MomentId;
  /** Lo que Pilo dice en grande. */
  title: string;
  /** Lo que sigue diciendo: frases cortas, una idea cada una. */
  say: string;
  /** Con qué cara lo dice. */
  mood: "feliz" | "atento" | "sorpresa" | "piensa";
}

/** Los cuatro pasos que Pilo anuncia en la bienvenida. */
export const GUIDE_STEPS = [
  "Usted me da su permiso para leer sus notas.",
  "Entra con su cuenta de Génesis.",
  "Me cuenta sus metas de promedio.",
  "Vemos juntos su histórico, su evolución y mis recomendaciones.",
];

/**
 * A quién saluda Pilo: el apodo de la cuenta de Pilo o, si no tiene, su primer
 * nombre. Solo letras (y un espacio o guion), y corto: va dentro de una frase
 * que se lee en voz alta. Vacío si no hay con qué.
 */
export function guideName(account: { nick?: string | null; full_name?: string | null } | null | undefined): string {
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/[^\p{L}\s'-]/gu, " ").replace(/\s+/g, " ").trim() : "");
  const nick = clean(account?.nick);
  const first = clean(account?.full_name).split(" ")[0] ?? "";
  return (nick || first).slice(0, 24).trim();
}

/** El guion de la guía. Solo el último momento cambia con la persona: la saluda por su nombre. */
export function guideScript(name = ""): GuideBeat[] {
  const who = name.trim();
  return [
    { id: "bienvenida", title: "Hola, soy Pilo", say: "Puedo leer sus notas de Génesis y contarle cómo va. Solo leo: no cambio nada. Lo guío en cuatro pasos.", mood: "feliz" },
    { id: "permiso", title: "Primero, su permiso", say: "Lea lo que le prometo y, si está de acuerdo, autorice.", mood: "atento" },
    { id: "cuenta", title: "Ahora, su cuenta", say: "Elija su sede y entre a Génesis como siempre.", mood: "atento" },
    { id: "metas", title: "Ya tengo sus datos", say: "Puedo analizarlos. Ahora dígame sus metas: ¿qué promedio acumulado quiere alcanzar, y cuál este semestre?", mood: "feliz" },
    { id: "despegue", title: who ? `¡Excelente, ${who}!` : "¡Excelente!", say: "Vamos a ver sus notas y mis recomendaciones. ¡Vamos volando juntos!", mood: "sorpresa" },
  ];
}

/** Lo que dice la voz en un momento: exactamente lo que se lee en pantalla, el título y lo que sigue. */
export const spoken = (beat: Pick<GuideBeat, "title" | "say">): string => `${beat.title}${/[.!?…]$/.test(beat.title) ? "" : "."} ${beat.say}`;

/** Las palabras de lo que Pilo dice, para irlas iluminando. */
export const captionWords = (beat: Pick<GuideBeat, "say">): string[] => beat.say.split(/\s+/).filter(Boolean);

/** El avance a la vista: cuatro pasos, y cuáles ya quedaron atrás. En el despegue, todos. */
export const guideProgress = (moment: Moment): boolean[] => [0, 1, 2, 3].map((k) => k < moment);

/**
 * El audio que se pide por adelantado al llegar a un momento, para que la voz
 * no haga esperar: el de ese momento, el del siguiente (mientras suena el
 * actual) y, siempre, el saludo con el nombre, que es el único que no está
 * guardado de antes. Pocos a la vez: cada uno gasta del cupo de la voz.
 */
export function voiceAhead(script: GuideBeat[], moment: Moment): string[] {
  const wanted = [script[moment], script[moment + 1], script[script.length - 1]].filter(Boolean);
  return [...new Set(wanted.map(spoken))];
}

/* --- Las metas ------------------------------------------------------------------------------ */

export interface Goals {
  /** El promedio acumulado que quiere alcanzar. */
  accumulated: number;
  /** El promedio que quiere este semestre. */
  semester: number;
}

export const GOALS_KEY = "pilo-app:notas-metas";

/** Una meta bien puesta: entre 3,0 y 5,0, de décima en décima. `null` si no es un número. */
export function cleanGoal(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return Math.round(Math.min(GOAL.max, Math.max(GOAL.min, v)) * 10) / 10;
}

/** Con qué metas abre el paso la primera vez: un poco por encima de donde va hoy. */
export function defaultGoals(accumulated: number | null, lastAverage: number | null): Goals {
  const up = (v: number | null, fallback: number) => cleanGoal((v ?? fallback) + 0.3) ?? fallback;
  return { accumulated: up(accumulated, 3.7), semester: up(lastAverage ?? accumulated, 3.9) };
}

const dropGoals = (store: LinkStore | null) => {
  try {
    store?.removeItem(GOALS_KEY);
  } catch {
    /* sin almacenamiento: no hay nada que borrar */
  }
};

/** Las metas de la cuenta `owner` guardadas en este dispositivo. Las de otra cuenta no se entregan: se borran. */
export function readGoals(owner: string, store: LinkStore | null = deviceStore()): Goals | null {
  let raw: string | null = null;
  try {
    raw = store?.getItem(GOALS_KEY) ?? null;
  } catch {
    raw = null;
  }
  if (!raw) return null;
  try {
    const d = JSON.parse(raw) as { v?: unknown; owner?: unknown; accumulated?: unknown; semester?: unknown };
    const accumulated = cleanGoal(d?.accumulated);
    const semester = cleanGoal(d?.semester);
    if (d?.v === 1 && d.owner === owner && accumulated !== null && semester !== null) return { accumulated, semester };
  } catch {
    /* no se entiende: fuera */
  }
  dropGoals(store);
  return null;
}

/** Guarda las metas de la cuenta `owner` en este dispositivo: dos números, nada de sus notas. Dice si quedaron. */
export function saveGoals(owner: string, goals: Goals, store: LinkStore | null = deviceStore()): boolean {
  const accumulated = cleanGoal(goals.accumulated);
  const semester = cleanGoal(goals.semester);
  if (!store || accumulated === null || semester === null) return false;
  try {
    store.setItem(GOALS_KEY, JSON.stringify({ v: 1, owner, accumulated, semester }));
    return true;
  } catch {
    return false;
  }
}

/** «Desconectar» (y salir de la cuenta): las metas se borran de este dispositivo. */
export function clearGoals(store: LinkStore | null = deviceStore()): void {
  dropGoals(store);
}

/* --- Las metas, dichas ---------------------------------------------------------------------- */

const creditsLeft = (n: number) => `${n === 1 ? "el crédito que le falta" : `los ${n} créditos que le faltan`}`;

/** Bajo el control de la meta de acumulado, al moverlo: dónde va hoy y cuánto tendría que promediar. */
export function goalHint(plan: GoalPlan): string {
  if (plan.status === "sin_datos") return "Aún no puedo calcular cuánto le falta: Génesis no trae su avance en el plan.";
  if (plan.status === "terminado") return `Hoy va en ${nota(plan.accumulated)}. Ya no le quedan créditos por cursar.`;
  const today = `Hoy va en ${nota(plan.accumulated)}.`;
  if (plan.status === "cumplida") return `${today} Ya está ahí.`;
  if (plan.status === "inalcanzable") return `${today} Con lo que le falta, esa meta no alcanza.`;
  return `${today} Para llegar, tendría que promediar ${nota(plan.needed)} en lo que le falta.`;
}

/** Bajo el control de la meta del semestre. */
export const semesterHint = (lastAverage: number | null): string => (lastAverage === null ? "Aún no hay un semestre con definitivas para comparar." : `Su último semestre fue ${nota(lastAverage)}.`);

/** La frase de la meta de acumulado que queda siempre a la vista en las notas. */
export function accumulatedLine(plan: GoalPlan, goal: number): string {
  const g = nota(goal);
  if (plan.status === "sin_datos") return `Meta ${g}. Aún no puedo calcular cuánto le falta: Génesis no trae su avance en el plan.`;
  if (plan.status === "terminado") return `Meta ${g}. Ya no le quedan créditos por cursar: su promedio queda en ${nota(plan.accumulated)}.`;
  if (plan.status === "cumplida") return `Ya está en su meta de ${g}. Manténgala.`;
  if (plan.status === "inalcanzable") return `Meta ${g}: con ${creditsLeft(plan.remaining)} no alcanza. Lo máximo posible es ${nota(plan.best)}.`;
  return `Meta ${g}: necesita promediar ${nota(plan.needed)} en ${creditsLeft(plan.remaining)}.`;
}

/** La frase de la meta del semestre: contra su último semestre con definitivas. */
export function semesterLine(lastAverage: number | null, goal: number): string {
  const g = nota(goal);
  if (lastAverage === null) return `Meta ${g}. Aún no hay un semestre con definitivas para comparar.`;
  if (lastAverage >= goal) return `Su último semestre ya llegó a ${g}.`;
  return `Meta ${g}: le faltan ${nota(Math.round((goal - lastAverage) * 100) / 100)} frente a su último semestre.`;
}

/** Dónde cae un promedio en la barra de una meta: un eje de 3,0 a 5,0, en porcentaje. */
export const meterPct = (v: number | null): number => (v === null ? 0 : Math.max(0, Math.min(100, ((v - GOAL.min) / (TOP_MARK - GOAL.min)) * 100)));
