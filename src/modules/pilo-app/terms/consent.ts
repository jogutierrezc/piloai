/* =============================================================================
   Mr. Pilo · la autorización para leer Génesis o Moodle · sus textos.

   Una por plataforma, y por separado: lo que Pilo pide ver, sus cuatro
   promesas y lo que la persona autoriza. Son los textos del diseño aprobado,
   que dicen lo mismo que la sección 4 de la política (policy.ts): no se les
   agregan promesas.

   Puro: se prueba en node.
   ========================================================================== */

export type DataPlatform = "genesis" | "moodle";

export const DATA_PLATFORMS: DataPlatform[] = ["genesis", "moodle"];

export interface ConsentPromise {
  title: string;
  text: string;
}

export interface ConsentTexts {
  /** Cómo se llama la plataforma. */
  name: string;
  /** Lo que se consulta, en una palabra (para rótulos: «Génesis · notas»). */
  what: string;
  question: string;
  lead: string;
  promises: ConsentPromise[];
  /** La casilla que autoriza. */
  authorize: string;
}

const LEAD = "Solo para ayudarle a mejorar. Soy su amigo, no un cóndor al acecho.";
const YOURS: ConsentPromise = { title: "Son suyas y de nadie más", text: "Ni la universidad ni otra persona las ve o las usa a través de mí. Esto lo sabe solo usted." };
const YOU_RULE: ConsentPromise = { title: "Usted manda", text: "Puede mantener la conexión en este dispositivo o desconectarme cuando quiera." };

export const CONSENT_TEXTS: Record<DataPlatform, ConsentTexts> = {
  genesis: {
    name: "Génesis",
    what: "notas",
    question: "¿Me deja ver sus notas?",
    lead: LEAD,
    promises: [
      { title: "Solo leo", text: "Miro sus notas del periodo y su récord académico por periodo. No puedo cambiar nada." },
      { title: "No me las llevo", text: "Sus notas se quedan en Génesis. No las guardo en ningún servidor. Si me pide recomendaciones, envío a la IA un resumen de sus notas sin su nombre ni su código. No se guarda." },
      YOURS,
      YOU_RULE,
    ],
    authorize: "Autorizo a Pilo a consultar mis notas en Génesis para armar mi plan de mejoramiento.",
  },
  moodle: {
    name: "Moodle",
    what: "clases",
    question: "¿Me deja ver sus clases?",
    lead: LEAD,
    promises: [
      { title: "Solo leo", text: "Miro sus cursos, actividades, materiales y fechas de entrega. No entrego ni escribo nada." },
      { title: "No me las llevo", text: "Sus cursos se quedan en Moodle. No guardo sus contenidos en ningún servidor." },
      YOURS,
      YOU_RULE,
    ],
    authorize: "Autorizo a Pilo a consultar mis cursos en Moodle para recordarme entregas y explicarme los temas.",
  },
};

/** La segunda casilla: opcional, y la misma para las dos plataformas. */
export const KEEP_LABEL = "Mantener la conexión en este dispositivo, para no escribir mi contraseña cada vez.";
export const AUTHORIZE_LABEL = "Autorizar y continuar";
export const SEE_POLICY_LABEL = "Ver la política";
/** Por qué el botón no deja seguir todavía. */
export const AUTHORIZE_WHY = "Para continuar, marque la casilla de autorización.";

/** Lo que decide la persona al autorizar. */
export interface ConsentChoice {
  platform: DataPlatform;
  /** Pidió mantener la conexión en este dispositivo. */
  keep: boolean;
}

/** La nota bajo los botones: antes de autorizar, y lo que queda después según lo que pidió. */
export function consentNote(done: Pick<ConsentChoice, "keep"> | null): string {
  if (!done) return "Sin su autorización, Pilo no consulta nada.";
  return done.keep ? "Autorizado. La conexión queda guardada solo en este dispositivo." : "Autorizado solo por esta vez: al salir, no queda nada guardado.";
}
