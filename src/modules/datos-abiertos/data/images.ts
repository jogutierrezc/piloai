/* =============================================================================
   UDES en Cifras · las imágenes de un informe.

   El bloque «Grid de imágenes» guarda rutas, no archivos: la fotografía vive
   en el bucket «informes» (migración 0053) y en `od_blocks.settings` queda su
   ruta con el texto alternativo y el pie.

   La ruta admite tres formas, y por eso hay una función y no una plantilla de
   cadena: una ruta del bucket, una ruta de `/public` —para una imagen que ya
   estaba en el repositorio— o una URL completa, que es como se cargaron las
   portadas de los informes antes de que existiera el bucket.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";

export const REPORT_BUCKET = "informes";

/** Una fotografía dentro de un grid. No confundir con `ReportImage`,
 *  que es la portada del informe y vive en `types.ts`. */
export interface GridImage {
  /** Ruta en el bucket, ruta de /public o URL completa. */
  path: string;
  /** Qué se ve. Sin esto la imagen no existe para quien no la ve. */
  alt: string;
  /** Pie opcional: la fecha, el lugar, quién aparece. */
  caption?: string;
}

export function reportImageUrl(path: string | null | undefined): string | null {
  const value = (path ?? "").trim();
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("/") || value.startsWith("data:")) return value;
  return supabase.storage.from(REPORT_BUCKET).getPublicUrl(value).data.publicUrl;
}

/** Las imágenes de un bloque, ya sin las que perdieron su ruta. */
export const imagesOf = (list: GridImage[] | undefined): GridImage[] =>
  (list ?? []).filter((image) => image.path?.trim());
