/* =============================================================================
   Cliente de Supabase.

   La clave anónima es pública por diseño: viaja en el bundle y no concede nada
   por sí sola. Quien decide qué se puede leer y escribir son las políticas RLS
   de supabase/migrations/0002_rls.sql. La clave de servicio, en cambio, nunca
   debe aparecer aquí ni en ningún archivo de src/.
   ========================================================================== */

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** Falta la configuración: el portal lo dice en pantalla en vez de fallar en blanco. */
export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured && import.meta.env.DEV) {
  console.warn(
    "Faltan VITE_SUPABASE_URL o VITE_SUPABASE_ANON_KEY. " +
      "Copia .env.example a .env.local y rellena los valores del proyecto.",
  );
}

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "public-anon-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

/** Llama a la Edge Function admin-users con la sesión actual. */
export async function callAdminUsers<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("admin-users", { body });

  if (error) {
    // El cuerpo de la respuesta trae un mensaje en español; el error de la
    // librería solo dice "Edge Function returned a non-2xx status code".
    const detail = await readFunctionError(error);
    throw new Error(detail ?? error.message);
  }

  return data as T;
}

/**
 * Saca el mensaje real del cuerpo de la respuesta de una Edge Function.
 *
 * `functions.invoke` no lo hace: su `error.message` es siempre el mismo texto
 * en inglés —"Edge Function returned a non-2xx status code"— y el mensaje útil
 * se queda en `error.context`, sin leer. Toda función que se llame desde el
 * portal tiene que pasar por aquí; si no, da igual lo bien que explique sus
 * fallos, porque nadie los verá.
 */
export async function readFunctionError(error: unknown): Promise<string | null> {
  const response = (error as { context?: Response })?.context;
  if (!response || typeof response.json !== "function") return null;
  try {
    const body = (await response.json()) as { error?: string; advice?: string };
    if (!body.error) return null;
    // El consejo viaja pegado al error: es lo que dice qué hacer.
    return body.advice ? `${body.error} ${body.advice}` : body.error;
  } catch {
    return null;
  }
}
