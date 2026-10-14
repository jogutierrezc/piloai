/* =============================================================================
   Errores de la base de datos, en un idioma que sirva para actuar.

   PostgREST y Postgres devuelven mensajes precisos pero opacos para quien los
   lee en pantalla. Aquí se traducen los que se dan de verdad en este portal, y
   —lo que más importa— los que tienen una causa conocida se acompañan de qué
   hacer al respecto.
   ========================================================================== */

export interface DatabaseError {
  message: string;
  code?: string;
  details?: string | null;
  hint?: string | null;
}

/** Error con una explicación de qué hacer, para que la interfaz la muestre. */
export class FriendlyError extends Error {
  readonly advice?: string;
  readonly original: string;
  /**
   * Si volver a intentarlo puede dar otro resultado.
   *
   * Falta de esquema, permisos o sesión caducada no mejoran reintentando: sin
   * esta marca, quien despliega sin migrar espera tres segundos de reintentos
   * silenciosos antes de ver el error que explica el problema.
   */
  readonly retryable: boolean;

  constructor(
    message: string,
    options: { advice?: string; original?: string; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = "FriendlyError";
    this.advice = options.advice;
    this.original = options.original ?? message;
    this.retryable = options.retryable ?? true;
  }
}

/** ¿Merece la pena reintentar este error? */
export function isRetryable(error: unknown): boolean {
  return error instanceof FriendlyError ? error.retryable : true;
}

export function describeDatabaseError(error: DatabaseError): FriendlyError {
  const message = error.message ?? "";
  const code = error.code ?? "";
  const original = message;

  /* --- Instalación incompleta ------------------------------------------- */

  // PGRST205: el objeto no está en la caché de esquema de PostgREST. Casi
  // siempre significa una de dos cosas, y ninguna es "la consulta está mal".
  if (code === "PGRST205" || /schema cache/i.test(message)) {
    return new FriendlyError("La base de datos todavía no tiene las tablas del portal.", {
      advice:
        "Aplica las migraciones de supabase/migrations en orden y termina con 0007_permisos_y_cache.sql, " +
        "que recarga la caché de la API. Si ya las aplicaste, ejecuta supabase/diagnostico.sql para ver qué se creó.",
      original,
      retryable: false,
    });
  }

  if (code === "42P01" || /relation .* does not exist/i.test(message)) {
    return new FriendlyError("Falta una tabla o vista que el portal necesita.", {
      advice: "Ejecuta supabase/diagnostico.sql para ver qué se creó y aplica las migraciones que falten.",
      original,
      retryable: false,
    });
  }

  if (code === "42703" || /column .* does not exist/i.test(message)) {
    return new FriendlyError("El esquema de la base de datos está desactualizado.", {
      advice: "Falta alguna migración: aplica las de supabase/migrations que aún no hayas ejecutado.",
      original,
      retryable: false,
    });
  }

  /* --- Sesión y permisos -------------------------------------------------- */

  if (code === "PGRST301" || /JWT|token is expired/i.test(message)) {
    return new FriendlyError("Tu sesión caducó.", {
      advice: "Vuelve a iniciar sesión para continuar.",
      original,
      retryable: false,
    });
  }

  if (code === "42501" || /row-level security/i.test(message)) {
    return new FriendlyError("No tienes permiso para hacer este cambio.", {
      original,
      retryable: false,
    });
  }

  /* --- Reglas del modelo -------------------------------------------------- */

  if (code === "23505" || /duplicate key/i.test(message)) {
    return new FriendlyError("Ya existe un registro con esos datos.", { original });
  }

  if (code === "23503" || /violates foreign key/i.test(message)) {
    return new FriendlyError("No se puede eliminar: hay contenido que todavía lo usa.", { original });
  }

  if (/pillars_slug_format/i.test(message)) {
    return new FriendlyError("El identificador solo admite minúsculas, números y guiones.", { original });
  }

  if (/activities_done_is_complete/i.test(message)) {
    return new FriendlyError("Un indicador cumplido debe estar al 100 %.", { original });
  }

  if (/documents_url_scheme/i.test(message)) {
    return new FriendlyError("El enlace debe empezar por http:// o https://.", { original });
  }

  if (/pillars_accent_range/i.test(message)) {
    return new FriendlyError("El color del pilar debe ser uno de los seis validados.", { original });
  }

  /* --- Red ---------------------------------------------------------------- */

  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return new FriendlyError("No se pudo contactar con la base de datos.", {
      advice: "Comprueba tu conexión y que VITE_SUPABASE_URL apunte al proyecto correcto.",
      original,
    });
  }

  // Los mensajes de los disparadores (RAISE EXCEPTION) ya están en español.
  return new FriendlyError(message || "No se pudo completar la operación.", { original });
}
