/* =============================================================================
   Mr. Pilo · la app · la llamada · el anuncio de lanzamiento.

   Se muestra una sola vez por dispositivo. Cualquier forma de cerrarlo cuenta
   como visto. La marca lleva versión: un anuncio nuevo (NEWS_VERSION + 1) puede
   mostrarse sin que se repita este. Todo aquí es puro: se prueba en node.
   ========================================================================== */

/** La versión de este anuncio. Subirla vuelve a mostrar el anuncio a quien ya vio el anterior. */
export const NEWS_VERSION = 1;

/** ¿Lo guardado en el dispositivo dice que este anuncio ya se vio? */
export const newsSeen = (stored: string | null | undefined): boolean => Number(stored) >= NEWS_VERSION;

/** Lo que se guarda al verlo. */
export const NEWS_MARK = String(NEWS_VERSION);

export interface NewsContext {
  /** Ya se vio este anuncio (o uno posterior) en este dispositivo. */
  seen: boolean;
  /** Ya activó la llamada antes: no hace falta anunciarle lo que ya usa. */
  activated: boolean;
  /** La bienvenida o la política de uso están encima: lo obligatorio va primero. */
  blocked: boolean;
  online: boolean;
  /** Pilo tiene voz oficial aquí. */
  voice: boolean;
  /** El navegador reconoce la voz. */
  recognition: boolean;
  /** Pilo está respondiendo ahora mismo: nunca se le atraviesa a una pregunta en curso. */
  busy: boolean;
  /** El Pilo está abierto a esta persona. */
  open: boolean;
}

/** ¿Toca mostrar el anuncio? Solo si la función existe y se puede usar ahora, y nada más importante está en pantalla. */
export function shouldAnnounce(c: NewsContext): boolean {
  return !c.seen && !c.activated && !c.blocked && c.online && c.voice && c.recognition && !c.busy && c.open;
}
