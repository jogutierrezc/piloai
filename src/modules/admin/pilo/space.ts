/* =============================================================================
   Mr. Pilo · los espacios en la intranet (0113).

   Hay dos Pilos: el de siempre («planeacion») y «Mr. Pilo en Enseñanza»
   («ensenanza»). Cada uno tiene su catálogo, sus respuestas guardadas, su
   bandeja, su índice y su bitácora, y nunca se mezclan. Aquí vive la regla,
   una sola vez, para todos los ganchos de este módulo:

   - A una RPC o a la función se le manda el espacio SOLO si no es el de
     partida. Así «Mr. Pilo con IA» llama exactamente como antes y sigue
     funcionando aunque la migración 0113 no esté aplicada.
   - Al leer una tabla, siempre se filtra por espacio: sin el filtro, el Pilo
     de siempre mostraría filas de Enseñanza. Si la columna no existe (sin
     0113), el Pilo de siempre repite la lectura sin filtro —todo lo que hay es
     suyo—; otro espacio se queda sin nada.
   - Las llaves de caché del espacio de partida son las de siempre; las de otro
     espacio llevan su nombre al final.
   ========================================================================== */

export type PiloSpace = "planeacion" | "ensenanza";

export const DEFAULT_SPACE: PiloSpace = "planeacion";

export const isDefaultSpace = (space: PiloSpace) => space === DEFAULT_SPACE;

/** Lo que se suma a los argumentos de una RPC: nada en el espacio de partida. */
export const spaceArgs = (space: PiloSpace = DEFAULT_SPACE): { p_space?: PiloSpace } => (isDefaultSpace(space) ? {} : { p_space: space });

/** Lo que se suma al cuerpo de un pedido a la función pilo-ia: nada en el espacio de partida. */
export const spaceBody = (space: PiloSpace = DEFAULT_SPACE): { space?: PiloSpace } => (isDefaultSpace(space) ? {} : { space });

/** El final de una llave de caché: vacío en el espacio de partida. */
export const spaceKey = (space: PiloSpace = DEFAULT_SPACE): PiloSpace[] => (isDefaultSpace(space) ? [] : [space]);

interface ReadError {
  code?: string;
  message?: string;
}

/** ¿El error dice que la columna `space` no existe? (base sin 0113) */
export function missingSpaceColumn(error: ReadError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "42703" || error.code === "PGRST204" || /column .*space.* does not exist|'space' column/i.test(error.message ?? "");
}

/**
 * Lee una tabla dentro de un espacio. `run(true)` debe filtrar por espacio y
 * `run(false)` no. Solo el espacio de partida repite sin filtro, y solo cuando
 * la base dice que la columna no existe.
 */
export async function readInSpace<R extends { error: ReadError | null }>(space: PiloSpace, run: (scoped: boolean) => PromiseLike<R>): Promise<R> {
  const first = await run(true);
  if (isDefaultSpace(space) && missingSpaceColumn(first.error)) return run(false);
  return first;
}

/* --- El catálogo de cada espacio ---------------------------------------------------- */

export type CatalogPrefix = Record<"respuesta" | "capciosa", string>;

/** La clave del catálogo es global: cada espacio tiene sus prefijos para no chocar. */
export const CATALOG_PREFIX: Record<PiloSpace, CatalogPrefix> = {
  planeacion: { respuesta: "R", capciosa: "C" },
  ensenanza: { respuesta: "ER", capciosa: "EC" },
};

/** La siguiente clave libre de una clase: R-001, C-004, ER-012… */
export function nextCatalogKey(space: PiloSpace, kind: "respuesta" | "capciosa", keys: string[]): string {
  const prefix = CATALOG_PREFIX[space][kind];
  const pattern = new RegExp(`^${prefix}-(\\d+)$`, "i");
  let max = 0;
  for (const k of keys) {
    const m = k.match(pattern);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(3, "0")}`;
}

/** ¿La clave lleva el prefijo de su espacio? El de partida acepta cualquiera, como siempre. */
export function keyFitsSpace(space: PiloSpace, kind: "respuesta" | "capciosa", key: string): boolean {
  if (isDefaultSpace(space)) return true;
  return key.toUpperCase().startsWith(`${CATALOG_PREFIX[space][kind]}-`);
}

/** Cómo se nombra cada espacio en los textos del catálogo. */
export const SPACE_COPY: Record<PiloSpace, { screen: string; owner: string; sourceTitle: string; sourcePath: string; file: string; migration: string }> = {
  planeacion: { screen: "Mr. Pilo con IA", owner: "Planeación", sourceTitle: "Planeación Institucional · Pregúntele a Pilo", sourcePath: "/pregunta", file: "pilo", migration: "0096" },
  ensenanza: { screen: "Mr. Pilo en Enseñanza", owner: "la universidad", sourceTitle: "Mr. Pilo en Enseñanza", sourcePath: "/pilo-ensenanza", file: "pilo-ensenanza", migration: "0113" },
};
