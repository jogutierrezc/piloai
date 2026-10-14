/* =============================================================================
   Mr. Pilo · términos y política de uso · el texto, en un solo sitio.

   De aquí leen la aceptación de la app («Antes de empezar»), el paso de
   términos del registro y la página pública de la política. No hay otro
   texto: quien cambie una regla o una sección la cambia aquí, y sube
   POLICY_VERSION para que la app vuelva a pedir la aceptación.

   El texto es el del diseño aprobado por el dueño y dice solo lo que Pilo
   cumple de verdad: no se le agregan promesas. Antes de publicarse lo revisan
   jurídica y el responsable de protección de datos de la universidad.

   Marcas del texto: **negrita** y {canal} (el canal de protección de datos).

   Puro: se prueba en node.
   ========================================================================== */

/** La versión de la política. Al cambiar el texto, súbala: la app vuelve a pedir la aceptación. */
export const POLICY_VERSION = "2";

/** La fecha de esta versión, como se le muestra a la persona («1 de noviembre de 2026»). */
// POR DEFINIR por el dueño
export const POLICY_DATE: string | null = null;

/** El canal de protección de datos de la UDES (un correo o una dirección), para ejercer los derechos. */
// POR DEFINIR por el dueño
export const DATA_CHANNEL: string | null = null;

/** La página pública de la política. */
export const POLICY_PATH = "/pilo-politica";

export const POLICY_TITLE = "Política de uso de Mr. Pilo";
/** Como se llama el enlace en el menú de la app y en las páginas de Pilo. */
export const POLICY_MENU_LABEL = "Política de uso";
export const POLICY_LEAD = "Términos y condiciones de la Inteligencia Artificial de la Universidad de Santander (UDES), conforme a la normativa colombiana.";

/** «Versión 1 · fecha por definir». */
export const versionLine = (version: string = POLICY_VERSION, date: string | null = POLICY_DATE): string => `Versión ${version} · ${date?.trim() || "fecha por definir"}`;

/* --- La aceptación: «Antes de empezar» -------------------------------------------------------- */

export const GATE_TITLE = "Antes de empezar";
export const GATE_LEAD = "Soy Mr. Pilo, la Inteligencia Artificial de la Universidad de Santander. Cuatro reglas de oro y conversamos.";
/** Lo que dice Pilo cuando la política cambió desde la última aceptación (la sección 6 promete avisarlo). */
export const GATE_CHANGED_LEAD = "La política de uso de Mr. Pilo cambió. Revise las cuatro reglas de oro y acéptela de nuevo para seguir conversando.";
export const RULES_TITLE = "Las cuatro reglas de oro";
export const CONSENT_LABEL = "He leído y acepto los términos y la política de uso de Mr. Pilo.";
export const ACCEPT_LABEL = "Aceptar y conversar";
export const POLICY_LINK_LABEL = "Leer la política completa";
export const ONCE_NOTE = "Se pide una sola vez en cada dispositivo, y otra vez si la política cambia.";
/** Por qué el botón no deja seguir todavía. */
export const ACCEPT_WHY = "Para continuar, marque la casilla de aceptación.";

export type RuleIcon = "guia" | "lupa" | "balanza" | "candado";

export interface GoldenRule {
  id: string;
  icon: RuleIcon;
  title: string;
  text: string;
}

export const GOLDEN_RULES: GoldenRule[] = [
  {
    id: "apoyo",
    icon: "guia",
    title: "Pilo es un apoyo, no un experto infalible",
    text: "Sirve para aprender, orientarse y hacer seguimiento. No reemplaza su criterio ni el de sus profesores.",
  },
  {
    id: "verificar",
    icon: "lupa",
    title: "Verifique siempre las respuestas",
    text: "La inteligencia artificial puede equivocarse o estar desactualizada. Revise y contraste lo que Pilo le diga.",
  },
  {
    id: "decisiones",
    icon: "balanza",
    title: "Las decisiones son suyas",
    text: "La UDES no responde por errores o imprecisiones de Pilo. Lo que haga con sus respuestas es bajo su propio criterio.",
  },
  {
    id: "privacidad",
    icon: "candado",
    title: "Su privacidad está protegida",
    text: "Sus conversaciones se guardan en su dispositivo, no en la universidad. Pilo no las asocia a su nombre.",
  },
];

/* --- La política completa: seis secciones ----------------------------------------------------- */

export type PolicyBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "facts"; items: { term: string; text: string }[] };

export interface PolicySection {
  /** El ancla de la sección en la página (#p1 … #p6). */
  id: string;
  n: number;
  /** Como se llama en el índice. */
  short: string;
  title: string;
  blocks: PolicyBlock[];
}

export const POLICY_SECTIONS: PolicySection[] = [
  {
    id: "p1",
    n: 1,
    short: "Qué es Pilo",
    title: "Naturaleza y propósito",
    blocks: [
      {
        kind: "p",
        text: "Mr. Pilo es una herramienta basada en un modelo de lenguaje grande (LLM), adaptada y personalizada por la Universidad de Santander. Su propósito es **académico**: un instrumento para el aprendizaje, la guía, el apoyo y el seguimiento de la comunidad universitaria.",
      },
      { kind: "p", text: "Pilo no sustituye el juicio crítico, la investigación rigurosa ni las fuentes académicas oficiales." },
    ],
  },
  {
    id: "p2",
    n: 2,
    short: "Uso responsable",
    title: "Uso responsable y exención de responsabilidad",
    blocks: [
      {
        kind: "p",
        text: "Pilo genera respuestas con algoritmos predictivos que pueden incurrir en «alucinaciones» (respuestas con apariencia lógica pero falsas), omisiones o imprecisiones. Por eso:",
      },
      {
        kind: "list",
        items: [
          "Es obligación del usuario **revisar, verificar y validar** cualquier dato, código o texto generado antes de usarlo.",
          "La Universidad de Santander se exime de responsabilidad civil, administrativa o disciplinaria por errores, fallas del sistema, sesgos o lógicas erradas de Pilo.",
          "El uso de lo que Pilo genera es bajo el propio riesgo del usuario.",
          "Pilo es un tutor: explica y orienta. No resuelve exámenes ni tareas calificables por el estudiante.",
        ],
      },
    ],
  },
  {
    id: "p3",
    n: 3,
    short: "Privacidad y datos",
    title: "Privacidad y tratamiento de datos",
    blocks: [
      { kind: "p", text: "En cumplimiento de la Ley 1581 de 2012 y sus decretos reglamentarios, así se trata la información al usar Pilo:" },
      {
        kind: "facts",
        items: [
          { term: "Sus conversaciones", text: "Se guardan en **su dispositivo**. La universidad no conserva el historial de sus conversaciones." },
          {
            term: "Su identidad",
            text: "Las preguntas no se asocian a su nombre ni a su cuenta. Los límites de uso se llevan con una huella que cambia cada día y no permite identificarlo.",
          },
          {
            term: "Para responderle",
            text: "El texto de su pregunta se envía a un proveedor de inteligencia artificial que redacta la respuesta. No se le envía su nombre ni su correo.",
          },
          {
            term: "Para mejorar a Pilo",
            text: "Se conservan, sin su nombre, preguntas que Pilo no supo responder y respuestas verificadas con fuentes de la universidad, que pueden servirle a otra persona.",
          },
          {
            term: "Si tiene cuenta",
            text: "Se guardan sus datos de registro, sus preferencias y **solo las respuestas que usted decida guardar**. Las ve únicamente usted.",
          },
          {
            term: "Archivos que adjunte",
            text: "Se leen en su dispositivo. A la IA viajan solo los pasajes necesarios, sin correos, teléfonos ni documentos. El archivo no se guarda.",
          },
        ],
      },
      {
        kind: "p",
        text: "**Datos sensibles.** No ingrese datos personales sensibles (salud, orientación política, datos financieros y similares), propios o de terceros, conforme al artículo 5 de la Ley 1581 de 2012.",
      },
      { kind: "p", text: "**Sus derechos.** Puede conocer, actualizar, rectificar y suprimir sus datos, y revocar su autorización, por {canal}." },
    ],
  },
  {
    id: "p4",
    n: 4,
    short: "Génesis y Moodle",
    title: "Conexión con Génesis y Moodle",
    blocks: [
      {
        kind: "p",
        text: "Algunas funciones leen información suya en plataformas de la universidad: en Génesis, sus notas del periodo y su récord académico por periodo (promedios, créditos y la definitiva de cada materia); en Moodle, sus cursos. Para eso rigen estas reglas:",
      },
      {
        kind: "list",
        items: [
          "**Siempre con su autorización.** Ninguna consulta se hace sin que el estudiante o el profesor la autorice de forma expresa, y puede retirarla cuando quiera.",
          "**Solo lectura.** Pilo consulta; no escribe, no entrega tareas, no presenta exámenes ni cambia nada en esas plataformas.",
          "**Nada se aloja en Pilo.** Sus notas, su récord académico y los contenidos de sus cursos permanecen en la plataforma institucional. Pilo los consulta en el momento y no los guarda en sus servidores. Si usted le pide recomendaciones sobre sus notas, y solo al pedirlas, Pilo envía a la IA un resumen de ellas sin su nombre ni su código; ese resumen no se guarda.",
          "**Solo para usted.** Ni la universidad ni otra persona usa o ve esa información a través de Pilo.",
          "**La conexión es suya.** Si decide mantenerla, queda guardada en su dispositivo. Al desconectar, se borra.",
        ],
      },
    ],
  },
  {
    id: "p5",
    n: 5,
    short: "Propiedad intelectual",
    title: "Propiedad intelectual y probidad académica",
    blocks: [
      {
        kind: "p",
        text: "Los textos que genera Pilo no constituyen creaciones con derechos de autor a favor del usuario. Su uso en trabajos, proyectos de grado o investigaciones debe citarse según las normas institucionales y de estilo (APA, IEEE u otras) sobre asistencia por inteligencia artificial, para garantizar la probidad académica y evitar el fraude.",
      },
    ],
  },
  {
    id: "p6",
    n: 6,
    short: "Aceptación",
    title: "Aceptación y cambios",
    blocks: [
      {
        kind: "p",
        text: "Al usar a Pilo, el usuario declara haber leído, entendido y aceptado esta política, y se somete a los lineamientos éticos, disciplinarios y legales de la Universidad de Santander y de la República de Colombia.",
      },
      { kind: "p", text: "Si la política cambia, Pilo lo avisa y pide aceptarla de nuevo antes de continuar." },
    ],
  },
];

/* --- El índice -------------------------------------------------------------------------------- */

export interface IndexEntry {
  id: string;
  href: string;
  label: string;
}

/** El índice lateral: «1. Qué es Pilo» … en el orden del documento. */
export const policyIndex = (sections: PolicySection[] = POLICY_SECTIONS): IndexEntry[] => sections.map((s) => ({ id: s.id, href: `#${s.id}`, label: `${s.n}. ${s.short}` }));

/** La sección que pide un ancla (#p3); null si no es de la política. */
export function sectionFromHash(hash: string, sections: PolicySection[] = POLICY_SECTIONS): string | null {
  const id = hash.replace(/^#/, "");
  return sections.some((s) => s.id === id) ? id : null;
}

/**
 * La sección que se está leyendo: la última cuyo comienzo ya pasó la línea de
 * lectura (`tops` va en el orden del documento, `top` medido desde el borde de
 * la ventana). Al final de la página es la última, aunque no alcance la línea.
 */
export function readingSection(tops: { id: string; top: number }[], line: number, atBottom = false): string | null {
  if (!tops.length) return null;
  if (atBottom) return tops[tops.length - 1].id;
  let current = tops[0].id;
  for (const s of tops) if (s.top <= line) current = s.id;
  return current;
}

/* --- El texto con sus marcas ------------------------------------------------------------------ */

export interface RichPart {
  text: string;
  strong?: boolean;
  /** Algo que el dueño aún no ha definido: se muestra sobrio, sin inventarlo. */
  pending?: boolean;
}

/** Cómo se nombra el canal de protección de datos: el definido, o que está por definir. */
export const dataChannel = (channel: string | null = DATA_CHANNEL): RichPart =>
  channel?.trim() ? { text: channel.trim() } : { text: "el canal de protección de datos de la UDES (por definir)", pending: true };

/** Parte un texto en trozos: lo normal, lo que va en **negrita** y {canal}. */
export function richParts(text: string, channel: string | null = DATA_CHANNEL): RichPart[] {
  const parts: RichPart[] = [];
  for (const piece of text.split(/(\*\*[^*]+\*\*|\{canal\})/)) {
    if (!piece) continue;
    if (piece === "{canal}") parts.push(dataChannel(channel));
    else if (piece.startsWith("**")) parts.push({ text: piece.slice(2, -2), strong: true });
    else parts.push({ text: piece });
  }
  return parts;
}

/** El texto sin marcas (para buscar, o para leerlo en voz alta). */
export const plainText = (text: string, channel: string | null = DATA_CHANNEL): string =>
  richParts(text, channel)
    .map((p) => p.text)
    .join("");

/* --- De dónde se llega a la política, para volver --------------------------------------------- */

export type PolicyOrigin = "app" | "pregunta" | "ensenanza";

const ORIGINS: Record<PolicyOrigin, { href: string; label: string }> = {
  app: { href: "/app", label: "Volver a Mr. Pilo" },
  pregunta: { href: "/pregunta", label: "Volver a Pregúntele a Pilo" },
  ensenanza: { href: "/pilo-ensenanza", label: "Volver a Pilo en Enseñanza" },
};

/** El enlace a la política desde una superficie de Pilo: la página sabe a dónde volver. */
export const policyHref = (from: PolicyOrigin = "app"): string => (from === "app" ? POLICY_PATH : `${POLICY_PATH}?desde=${from}`);

/** A dónde vuelve la página de la política, según `?desde=`; sin nada (o con algo desconocido), a la app. */
export function policyBack(search: string): { href: string; label: string } {
  const from = new URLSearchParams(search).get("desde");
  return from === "pregunta" || from === "ensenanza" ? ORIGINS[from] : ORIGINS.app;
}
