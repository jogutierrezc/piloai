/* =============================================================================
   Versión vieja del portal abierta en el navegador.

   Cada publicación cambia el nombre de los archivos que el portal carga bajo
   demanda (pdf-load-BOVKA442.js pasa a otro nombre). Quien dejó la pestaña
   abierta antes de publicar sigue con la lista vieja: al pedir uno de esos
   archivos el servidor ya no lo tiene y el navegador dice «Failed to fetch
   dynamically imported module». No es un fallo del archivo ni de la persona:
   basta recargar la página.
   ========================================================================== */

export const STALE_MESSAGE = "Hay una versión nueva del portal y esta pestaña quedó con la anterior. Recargue la página (Ctrl + F5) y vuelva a intentarlo.";

const PATTERNS = [
  /failed to fetch dynamically imported module/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  /unable to preload css/i,
];

/** ¿El error es de un archivo cargado bajo demanda que ya no existe? */
export function isStaleChunkError(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : typeof error === "string" ? error : "";
  return PATTERNS.some((p) => p.test(text));
}

/** Carga un módulo bajo demanda; si falla por ser de una versión vieja, lo dice en español. */
export async function importFresh<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isStaleChunkError(error)) throw new Error(STALE_MESSAGE);
    throw error;
  }
}

const FLAG = "pilo-stale-reload";

/**
 * Al navegar a una pantalla cuyo archivo ya no existe, recarga una sola vez
 * para traer la versión nueva. La marca evita un ciclo si el servidor sigue
 * sin el archivo; no se usa al subir documentos, donde recargar perdería lo
 * que la persona eligió (ahí `importFresh` explica qué hacer).
 */
export function reloadOnceOnStalePreload(target: Window = window): void {
  target.addEventListener("vite:preloadError", (event) => {
    try {
      if (target.sessionStorage.getItem(FLAG)) return;
      target.sessionStorage.setItem(FLAG, "1");
    } catch {
      return;
    }
    event.preventDefault();
    target.location.reload();
  });
}
