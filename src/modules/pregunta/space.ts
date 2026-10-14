/* =============================================================================
   Pregúntele a Pilo · los espacios (0113).

   Hay dos Pilos y una sola página. Cada espacio trae sus textos, sus fuentes,
   su ruta y sus llaves de almacenamiento; el diseño, las escenas y el
   movimiento son los mismos. El perfil «planeacion» copia, letra por letra,
   lo que la página decía antes de que hubiera espacios: /pregunta se ve, se
   comporta y recuerda igual.

   «ensenanza» es Mr. Pilo en Enseñanza: la Inteligencia Artificial de la
   Universidad de Santander para innovación educativa, políticas
   institucionales y la mirada global de la educación superior. La primera vez
   pregunta quién le habla (estudiante o profesor) y con eso cambian las
   preguntas sugeridas, la cara de partida y el ánimo de la voz.

   Todo aquí es puro (sin pantalla ni almacenamiento): se prueba en node.
   ========================================================================== */

import type { Fn, Portal, Rol, SpaceId, SpacePortal } from "../../components/pilo/ai/logic";
import type { SpaceConfig } from "../../components/pilo/ai/config";
import type { MojiMood } from "../../components/pilo/PiloMoji";
import { tr } from "../../components/pilo/i18n";

export type { Rol, SpaceId };

export interface Beat {
  say: string;
  mood: MojiMood;
  look: [number, number];
}

export interface Suggestion {
  q: string;
  hint: string;
  trick?: boolean;
}

export interface SpaceSource {
  id: string;
  code: string;
  name: string;
  session?: boolean;
  hidden?: boolean;
}

type Asked = Exclude<Rol, "general">;

export interface SpaceProfile {
  id: SpaceId;
  /** El `portal` que viaja a la función: de ahí saca el servidor el espacio. */
  portal: Portal | SpacePortal;
  /** Lo que el portal tiene en este espacio (para `canUse`). */
  fns: Fn[];
  route: string;
  embedRoute: string;
  /** El título de la bienvenida. */
  title: string;
  docTitle: string;
  /** El nombre en el menú lateral. */
  name: string;
  sub: string;
  /** La marca arriba de la bienvenida. */
  brand: { strong: string; text: string };
  crumb: { to: string; label: string };
  beats: Beat[];
  hello: { h1: string; p: string };
  suggestions: Suggestion[];
  /** Las sugeridas de cada rol cuando la administración no ha puesto las suyas. */
  roleSuggestions: Partial<Record<Asked, Suggestion[]>>;
  /** La cara y el ánimo de partida de cada rol cuando la configuración no los trae. */
  roles: Partial<Record<Asked, { expression: string; mood: string }>>;
  sources: SpaceSource[];
  /** Quién firma una fuente que no dice su oficina. */
  office: string;
  /** El acento del espacio (`data-espacio`); null = el de siempre. */
  accent: string | null;
  /** Llaves de localStorage de la página y de sessionStorage del chat emergente. */
  storagePrefix: string;
  embedPrefix: string;
  /** ¿Pregunta el rol la primera vez? (la administración puede apagarlo). */
  askRol: boolean;
  /** ¿La administración puede llevar una respuesta al catálogo desde esta página? */
  catalog: boolean;
  placeholder: string;
  note: string;
  gate: { login: string; closed: string; missing: string };
  gateFallback: { to: string; label: string };
  /** Lo que muestra la bienvenida en sus tres momentos. */
  demo: {
    questions: { q: string; trick?: boolean }[];
    mini: { badge: string; text: string; ticket: string; stamp: string };
  };
  widget: {
    frameTitle: string;
    greeting: string;
    hello: string;
    idle: string;
    suggestions: string[];
    open: string;
  };
}

export const ASK_SPACES: Record<SpaceId, SpaceProfile> = {
  planeacion: {
    id: "planeacion",
    portal: "pregunta",
    fns: ["preguntar"],
    route: "/pregunta",
    embedRoute: "/pilo-embed",
    title: "Pregúntele a Mr. Pilo",
    docTitle: "Pregúntele a Pilo · Universidad de Santander",
    name: "Pregúntele a Pilo",
    sub: "Universidad de Santander · UDES",
    brand: { strong: "Pregúntele a Pilo", text: "Universidad de Santander" },
    crumb: { to: "/", label: "Planeación Institucional" },
    beats: [
      { say: "¡Hola! Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander.", mood: "feliz", look: [0, -0.1] },
      { say: "Pregúnteme como le preguntaría a una persona: por cifras, el Plan de Desarrollo, los boletines o el Observatorio.", mood: "atento", look: [0, 0.7] },
      { say: "Le respondo sobre lo que necesite: las cifras de la UDES llevan su fuente para que la revise, y le aviso cuando algo es conocimiento general.", mood: "sorpresa", look: [0.2, 0.8] },
    ],
    hello: {
      h1: "¿Qué quiere saber de la Universidad de Santander?",
      p: "Pregunte en sus palabras, sobre la UDES o sobre lo que necesite. Redacto con IA: las cifras de la universidad salen de lo publicado y llevan su fuente, y le aviso cuando algo es conocimiento general.",
    },
    suggestions: [
      { q: "¿Cuántos estudiantes tiene la UDES por sede?", hint: "UDES en Cifras" },
      { q: "¿Cómo va el pilar Personalización del Plan de Desarrollo?", hint: "Plan de Desarrollo" },
      { q: "¿Qué dice el último boletín estadístico?", hint: "Boletines" },
      { q: "¿Cuánto presupuesto tiene el pilar Ambiente tecnológico?", hint: "Pregunta capciosa", trick: true },
    ],
    roleSuggestions: {},
    roles: {},
    sources: [
      { id: "cifras", code: "CI", name: "UDES en Cifras" },
      { id: "boletines", code: "BO", name: "Boletines" },
      { id: "pdi", code: "PD", name: "Plan de Desarrollo" },
      { id: "observatorio", code: "OB", name: "Observatorio" },
      { id: "impacto", code: "IM", name: "Portal de Impacto", session: true },
      // Las respuestas oficiales del catálogo: no es una memoria que se lista, es la universidad hablando.
      { id: "catalogo", code: "UD", name: "Universidad de Santander", hidden: true },
    ],
    office: "Universidad de Santander",
    accent: null,
    storagePrefix: "pilo-pregunta",
    embedPrefix: "pilo-embed",
    askRol: false,
    catalog: true,
    placeholder: "Pregunte por una cifra, un pilar, un boletín…",
    note: "Pilo redacta con IA. Las cifras de la UDES llevan su fuente; lo demás va marcado como conocimiento general.",
    gate: {
      login: "Por ahora, Pregúntele a Pilo es para quienes tienen cuenta en la intranet de Planeación. Inicie sesión y vuelva.",
      closed: "Pregúntele a Pilo no está abierto por ahora. Mientras tanto, las cifras oficiales están en UDES en Cifras.",
      missing: "Pregúntele a Pilo no está abierto por ahora. Mientras tanto, las cifras oficiales están en UDES en Cifras.",
    },
    gateFallback: { to: "/datos-abiertos", label: "Ir a UDES en Cifras" },
    demo: {
      questions: [
        { q: "¿Cuántos estudiantes hay por sede?" },
        { q: "¿Cómo va el pilar Personalización?" },
        { q: "¿Qué dice el último boletín?" },
        { q: "¿Cuánto presupuesto tiene el PDI?", trick: true },
      ],
      mini: {
        badge: "Con fuentes de la UDES",
        text: "El Plan de Desarrollo tiene sus pilares con avance publicado, y cada cifra dice de dónde sale",
        ticket: "Plan de Desarrollo · Implementación",
        stamp: "CON SU CORTE",
      },
    },
    widget: {
      frameTitle: "Chat con Pilo, la Inteligencia Artificial de la Universidad de Santander",
      greeting: "Hola, soy Pilo, la Inteligencia Artificial de la Universidad de Santander. Pregúnteme por las cifras de la UDES y le digo de dónde sale cada una.",
      hello: "¿Busca una cifra de la UDES? Pregúnteme.",
      idle: "Cifras de la UDES",
      suggestions: ["¿Qué es UDES en Cifras?", "¿Cómo va el Plan de Desarrollo?", "¿Qué programas ofrece la UDES?"],
      open: "Abrir Pregúntele a Pilo",
    },
  },

  ensenanza: {
    id: "ensenanza",
    portal: "ensenanza",
    fns: ["preguntar", "leer"],
    route: "/pilo-ensenanza",
    embedRoute: "/pilo-ensenanza-embed",
    title: "Mr. Pilo en Enseñanza",
    docTitle: "Mr. Pilo en Enseñanza · Universidad de Santander",
    name: "Mr. Pilo en Enseñanza",
    sub: "Universidad de Santander · UDES",
    brand: { strong: "Mr. Pilo en Enseñanza", text: "Universidad de Santander" },
    crumb: { to: "/", label: "Universidad de Santander" },
    beats: [
      { say: "¡Hola! Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander, y aquí hablamos de enseñanza.", mood: "feliz", look: [0, -0.1] },
      { say: "Pregúnteme por innovación educativa, por las políticas institucionales o por lo que pasa en la educación superior en el mundo.", mood: "atento", look: [0, 0.7] },
      { say: "Le respondo con lo que la universidad ha publicado y le muestro la fuente; cuando algo es conocimiento general, se lo digo.", mood: "sorpresa", look: [0.2, 0.8] },
    ],
    hello: {
      h1: "¿Qué quiere saber sobre enseñar y aprender en la UDES?",
      p: "Soy la Inteligencia Artificial de la Universidad de Santander. Pregunte en sus palabras por innovación educativa, políticas institucionales o la educación superior en el mundo. Redacto con IA: lo que es de la universidad sale de sus documentos y lleva su fuente, y le aviso cuando algo es conocimiento general.",
    },
    suggestions: [
      { q: "¿Qué es el aprendizaje activo y cómo se lleva a una clase?", hint: "Innovación educativa" },
      { q: "¿Qué dicen las políticas institucionales sobre la evaluación?", hint: "Políticas institucionales" },
      { q: "¿Qué son los resultados de aprendizaje?", hint: "Innovación educativa" },
      { q: "¿Qué tendencias marcan hoy la educación superior en el mundo?", hint: "Mirada global" },
    ],
    roleSuggestions: {
      estudiante: [
        { q: "¿Qué estrategias de estudio me sirven para preparar una evaluación?", hint: "Estrategias de estudio" },
        { q: "¿Cómo me afecta, como estudiante, una política institucional?", hint: "Políticas institucionales" },
        { q: "¿Cómo me evalúan en un curso por resultados de aprendizaje?", hint: "Evaluación" },
        { q: "¿Cómo organizo mi tiempo de estudio durante el semestre?", hint: "Estrategias de estudio" },
      ],
      profesor: [
        { q: "¿Cómo llevo el aprendizaje activo a una clase numerosa?", hint: "Aprendizaje activo" },
        { q: "¿Cómo evalúo por resultados de aprendizaje?", hint: "Evaluación" },
        { q: "¿Cómo diseño un curso a partir de sus resultados de aprendizaje?", hint: "Diseño de curso" },
        { q: "¿Qué pide una política institucional al planear mi curso?", hint: "Políticas institucionales" },
      ],
    },
    roles: {
      estudiante: { expression: "feliz", mood: "emocionado" },
      profesor: { expression: "graduado", mood: "atento" },
    },
    sources: [
      { id: "innovacion", code: "IN", name: "Innovación educativa" },
      { id: "politicas", code: "PO", name: "Políticas institucionales" },
      { id: "global", code: "GL", name: "Mirada global" },
      { id: "moodle", code: "MO", name: "Cursos de Moodle", session: true },
      // Las respuestas oficiales del catálogo de este espacio: es la universidad hablando.
      { id: "catalogo", code: "UD", name: "Universidad de Santander", hidden: true },
    ],
    office: "Universidad de Santander",
    accent: "ensenanza",
    storagePrefix: "pilo-ensenanza",
    embedPrefix: "pilo-ensenanza-embed",
    askRol: true,
    // El catálogo de este espacio se lleva desde su intranet (prefijos ER- y EC-), no desde esta página.
    catalog: false,
    placeholder: "Pregunte por una estrategia, una política, una tendencia…",
    note: "Pilo redacta con IA. Lo que es de la UDES lleva su fuente; lo demás va marcado como conocimiento general.",
    gate: {
      login: "Por ahora, Mr. Pilo en Enseñanza es para quienes tienen cuenta en la intranet. Inicie sesión y vuelva.",
      closed: "Mr. Pilo en Enseñanza no está abierto por ahora.",
      missing: "Mr. Pilo en Enseñanza todavía no está instalado: a la base de datos le falta la migración 0113 de los espacios. La administración debe aplicarla.",
    },
    gateFallback: { to: "/", label: "Ir al portal de Planeación" },
    demo: {
      questions: [
        { q: "¿Qué es el aprendizaje activo?" },
        { q: "¿Cómo se evalúa por resultados de aprendizaje?" },
        { q: "¿Qué pide una política institucional?" },
        { q: "¿Qué pasa en la educación superior en el mundo?" },
      ],
      mini: {
        badge: "Con fuentes de la UDES",
        text: "Lo que es de la universidad sale de sus documentos, y cada afirmación dice de dónde viene",
        ticket: "Políticas institucionales",
        stamp: "CON SU FUENTE",
      },
    },
    widget: {
      frameTitle: "Chat con Pilo, la Inteligencia Artificial de la Universidad de Santander",
      greeting: "Hola, soy Pilo, la Inteligencia Artificial de la Universidad de Santander. Pregúnteme por enseñanza, políticas institucionales o educación superior.",
      hello: "¿Una duda sobre enseñar o aprender? Pregúnteme.",
      idle: "Enseñanza · UDES",
      suggestions: ["¿Qué es el aprendizaje activo?", "¿Cómo se evalúa por resultados de aprendizaje?", "¿Qué tendencias hay en educación superior?"],
      open: "Abrir Mr. Pilo en Enseñanza",
    },
  },
};

export const isAskSpace = (v: unknown): v is SpaceId => typeof v === "string" && Object.prototype.hasOwnProperty.call(ASK_SPACES, v);

/* --- El rol de quien pregunta ---------------------------------------------------------------- */

export const ROLE_QUESTION = "Para responderle mejor, ¿quién pregunta?";

export const ROLE_OPTIONS: { id: Rol; label: string; short: string }[] = [
  { id: "estudiante", label: "Estudiante", short: "Estudiante" },
  { id: "profesor", label: "Profesor", short: "Profesor" },
  { id: "general", label: "Prefiero no decir", short: "Sin rol" },
];

/** Lo guardado en el navegador: un rol conocido, o null si aún no ha elegido. */
export function parseStoredRol(v: unknown): Rol | null {
  const t = typeof v === "string" ? v.trim().toLowerCase() : "";
  return t === "estudiante" || t === "profesor" || t === "general" ? t : null;
}

/** El rol que viaja a la función: solo «estudiante» o «profesor»; lo demás no se manda (el servidor entiende «general»). */
export function wireRol(rol: Rol | null | undefined): Asked | undefined {
  return rol === "estudiante" || rol === "profesor" ? rol : undefined;
}

/** ¿Este espacio pregunta el rol? Lo dice el perfil y lo puede apagar la administración (`ask_rol`). */
export function asksRol(profile: SpaceProfile, cfg: Pick<SpaceConfig, "askRol"> | null | undefined): boolean {
  return profile.askRol && cfg?.askRol !== false;
}

const HINT: Record<Asked, string> = { estudiante: "Para estudiantes", profesor: "Para profesores" };

/**
 * Lo que cambia con el rol en la página: las preguntas sugeridas, la cara de
 * partida y el ánimo de la voz. Manda lo que puso la administración en la
 * configuración pública; si no hay, lo fijo del perfil. Sin rol (o «prefiero
 * no decir»), las sugeridas generales y nada más.
 */
export function roleView(
  profile: SpaceProfile,
  cfg: Pick<SpaceConfig, "roles"> | null | undefined,
  rol: Rol | null | undefined,
): { suggestions: Suggestion[]; expression?: string; mood?: string } {
  const asked = wireRol(rol);
  if (!asked) return { suggestions: profile.suggestions };
  const set = cfg?.roles?.[asked];
  const own = (set?.suggestions ?? []).map((q) => q.trim()).filter(Boolean).slice(0, 4);
  const fixed = profile.roles[asked];
  const expression = set?.expression || fixed?.expression;
  const mood = set?.mood || fixed?.mood;
  return {
    suggestions: own.length ? own.map((q) => ({ q, hint: tr(HINT[asked]) })) : (profile.roleSuggestions[asked] ?? profile.suggestions),
    ...(expression ? { expression } : {}),
    ...(mood ? { mood } : {}),
  };
}
