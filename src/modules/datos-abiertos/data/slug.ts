/* =============================================================================
   Datos Abiertos · nombres de archivo.

   Un título se vuelve nombre de archivo sin tildes, en minúsculas y con
   guiones: «Matrícula por género» → "matricula-por-genero". Lo usan la imagen
   de cada gráfica y los CSV, así un mismo conjunto baja siempre con el mismo
   nombre.

   Módulo puro: no toca el DOM ni la base, para que las pruebas en node lo lean.
   ========================================================================== */

/** Largo máximo: un nombre más largo se corta en la barra de descargas. */
const MAX_LENGTH = 60;

/** Texto → trozo de nombre de archivo. Si no queda nada, `fallback`. */
export const slugify = (text: string, fallback = "grafica"): string =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, MAX_LENGTH)
    .replace(/-$/, "") || fallback;
