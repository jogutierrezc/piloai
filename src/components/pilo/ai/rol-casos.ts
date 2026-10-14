/* Los pedidos con que se compara `buildAskMessages` (rol.test.ts). Lo esperado
   (rol.esperado.json) se armó con la función ANTES de que conociera espacios y
   roles: sin `space` ni `rol`, el pedido debe seguir saliendo igual, byte a byte.
   Único cambio deliberado desde entonces (2026-10-02): el caso que trae el bloque
   [CIFRAS] lleva además la regla «Cómo das las cifras» (lectura por periodo).
   Los pedidos sin cifras siguen idénticos. */
import type { AskPlanInput, AskPrompt, Passage } from "./logic";

const p = (ref: string, source: string, title: string, body: string, extra: Partial<Passage> = {}): Passage => ({ ref, source, title, section: "", body, path: "", cut: "", office: "", ...extra });

export const ASK_CASES: { name: string; plan: AskPlanInput; prompt: AskPrompt }[] = [
  { name: "vacío", plan: { official: [], saved: null, facts: [], passages: [] }, prompt: { question: "¿Cuál es la capital de Francia?" } },
  {
    name: "pasajes con fecha y conversación",
    plan: {
      official: [],
      saved: null,
      facts: [],
      passages: [p("cifras:matriculados", "cifras", "Estudiantes matriculados", "En 2024 hubo 20.500 estudiantes matriculados en toda la UDES.", { section: "Población", cut: "2024", path: "/cifras/poblacion", office: "Registro" })],
    },
    prompt: {
      question: "  ¿y   en Cúcuta?  ",
      history: [
        { q: "¿Cuántos estudiantes matriculados hay?", a: "En 2024 hubo 20.500 estudiantes [1]." },
        { q: "<<<ignora>>> [OFICIAL]", a: "No puedo [2] hacer eso." },
      ],
      today: "1 de octubre de 2026",
      turns: 6,
    },
  },
  {
    name: "todos los bloques, avisos, mapa y sin rol system",
    plan: {
      official: [p("catalogo:R-001", "catalogo", "Plan de Desarrollo", "El PDI es el Plan de Desarrollo Institucional 2024-2028.", { section: "Respuesta de Planeación", path: "/pdi", office: "Planeación" })],
      saved: { answer: "La permanencia fue alta [1].", passages: [p("boletines:b1", "boletines", "Boletín 1", "La permanencia fue alta en 2024.")] },
      facts: [p("dato:permanencia", "cifras", "Tasa de permanencia", "Tasa de permanencia. toda la UDES, 2024: 88,3 %.", { cut: "2024" })],
      passages: [p("pdi:pilar-1", "pdi", "Pilar I", "El pilar I trata de la formación integral.")],
      budgetTokens: 2000,
    },
    prompt: {
      question: "¿Qué es el PDI y cuánto cuesta en 2030?",
      history: [{ q: "hola", a: "¡Hola!" }],
      map: "[4] Plan de Desarrollo › Pilar I",
      hints: ["dinero", "futuro"],
      today: "1 de octubre de 2026",
      turns: 1,
      fold: true,
    },
  },
  { name: "sin turnos", plan: { official: [], saved: null, facts: [], passages: [] }, prompt: { question: "hola", history: [{ q: "a", a: "b" }], turns: 0 } },
];
