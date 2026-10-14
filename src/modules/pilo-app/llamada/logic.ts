/* =============================================================================
   Mr. Pilo · la app · la llamada · lo que se decide sin pantalla.

   Una llamada es un ciclo: escucha → piensa → habla → escucha. Aquí viven las
   piezas puras de ese ciclo, para probarlas en node:

     · cortar la respuesta en frases mientras llega, para empezar a hablar con
       la primera sin esperar a la última;
     · dejar el texto listo para decirse en voz alta (sin viñetas ni enlaces);
     · el aviso previo: qué hace la llamada y qué conviene saber antes.
   ========================================================================== */

/* --- La respuesta, en frases ---------------------------------------------------------------- */

/** Una frase más corta que esto no se dice sola: se une a la siguiente (el audio sonaría entrecortado). */
export const MIN_SENTENCE = 28;
/** Una frase sin punto más larga que esto se corta en la última coma o espacio. */
export const MAX_SENTENCE = 220;

/**
 * Saca del texto que va llegando las frases ya completas. Lo que no alcanza a
 * ser una frase queda en `rest`, a la espera de más texto. Con `final`, todo lo
 * que quede se dice.
 *
 * Un punto es fin de frase si lo sigue un espacio y luego una mayúscula, un
 * número, «¿», «¡» o el fin: «2.5 %», «UDES S.A.» o «Dr. Pérez» no se cortan.
 */
export function takeSentences(buffer: string, final = false): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let text = buffer.replace(/\s+/g, " ");
  let carry = "";
  const END = /([.!?…]+["')\]»”]*)\s+(?=[A-ZÁÉÍÓÚÑ0-9¿¡"“(«])/g;
  for (;;) {
    END.lastIndex = 0;
    let cut = -1;
    for (let m = END.exec(text); m; m = END.exec(text)) {
      const upto = text.slice(0, m.index + m[1].length);
      // «Dr.», «Sr.», «Ud.» y una sigla de una letra con punto no cierran la frase.
      if (/(^|\s)(Dr|Dra|Sr|Sra|Ud|Uds|Prof|Ing|Lic|No|Mr|Mrs|Ms|St|[A-Z])\.$/.test(upto)) continue;
      cut = m.index + m[1].length;
      break;
    }
    if (cut < 0) break;
    const sentence = (carry + text.slice(0, cut)).trim();
    text = text.slice(cut).replace(/^\s+/, "");
    if (sentence.length < MIN_SENTENCE && (text || !final)) {
      carry = `${sentence} `;
      continue;
    }
    sentences.push(sentence);
    carry = "";
  }
  text = carry + text;
  // Sin punto a la vista y ya muy largo: se corta donde se pueda respirar.
  while (text.length > MAX_SENTENCE) {
    const window = text.slice(0, MAX_SENTENCE);
    const at = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(": "));
    const stop = at > MIN_SENTENCE ? at + 1 : window.lastIndexOf(" ");
    if (stop <= 0) break;
    sentences.push(text.slice(0, stop).trim());
    text = text.slice(stop).trim();
  }
  if (final && text.trim()) return { sentences: [...sentences, text.trim()], rest: "" };
  return { sentences, rest: text };
}

/** El texto de una respuesta, listo para decirse: sin marcas de formato, enlaces ni viñetas. */
export function spokenText(raw: string): string {
  return raw
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    // Las citas de las fuentes ([1], [2, 3]) se ven en pantalla; en voz no se leen.
    .replace(/\s*\[\d+(?:\s*[,;-]\s*\d+)*\]/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/[*_~>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/* --- El reloj de la llamada ------------------------------------------------------------------ */

/** «03:07», o «1:02:09» pasada la hora. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${pad(m)}:${pad(s % 60)}`;
}

/* --- El aviso previo ------------------------------------------------------------------------- */

export interface CallFeature {
  id: string;
  title: string;
  text: string;
}

/** Lo que hace la llamada, en el orden en que se nota. */
export const CALL_FEATURES: CallFeature[] = [
  { id: "voz", title: "Hable y Pilo contesta en voz alta", text: "Sin teclear. Pilo escucha, piensa y responde con su voz, en frases cortas, y vuelve a escucharle." },
  { id: "idiomas", title: "En español, inglés o portugués", text: "Elija el idioma antes de empezar o en plena llamada. Pilo entiende y contesta en el que usted escoja." },
  { id: "udes", title: "Con lo que sabe de la UDES", text: "Es el mismo Pilo del chat: responde con las cifras, los planes y las fuentes oficiales de la Universidad, no de memoria." },
  { id: "pausa", title: "Interrumpa cuando quiera", text: "Hable encima de Pilo y se calla para escucharle; también puede tocarlo. Silencie el micrófono sin colgar si necesita una pausa." },
];

/** Lo que conviene saber antes de activarla. Honesto con lo que la llamada todavía no hace. */
export const CALL_NOTICES: string[] = [
  "Es una función en prueba: puede equivocarse al oírle, sobre todo con ruido o con nombres propios.",
  "El navegador transcribe su voz; según cuál use, el audio puede pasar por el servicio de reconocimiento de su proveedor. Pilo no graba ni guarda su audio.",
  "La llamada no queda en su historial de conversaciones.",
  "Con auriculares se oye mejor: sin ellos, el micrófono puede recoger la voz de Pilo.",
];

/** ¿Este navegador reconoce la voz? Chrome, Edge y Safari sí; Firefox no. */
export function recognitionSupported(scope: { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown } = typeof window === "undefined" ? {} : (window as never)): boolean {
  return Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition);
}
