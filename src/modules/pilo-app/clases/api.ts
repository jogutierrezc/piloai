/* =============================================================================
   Mr. Pilo · Mis clases (beta) · los pedidos a la función `pilo-clases`.

   Cada pedido lleva la sesión de la cuenta de Pilo (la función comprueba que
   sea de estudiante o de profesor) y, salvo «sitios» y «conectar», el permiso
   de Moodle que guarda este dispositivo. La contraseña de Moodle pasa por
   aquí hacia la función una sola vez y no se guarda en ningún sitio.

   La universidad tiene varios Moodle: de cada uno aquí solo se conoce su
   identificador y su nombre, y eso es lo que se envía (`site`). La dirección
   la pone la función. Un permiso guardado antes de que hubiera varios va sin
   `site`.

   Nada de lo que llega se escribe en el almacenamiento: los cursos y las
   fechas viven en la memoria de la pantalla mientras está abierta.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";
import { clasesFailure, failureOf, parseAgenda, parseCourse, parseSites, siteIdShape } from "./logic";
import type { Agenda, ClasesFailure, CourseDetail, SiteInfo, SiteRef } from "./logic";

export class ClasesError extends Error {
  constructor(readonly failure: ClasesFailure) {
    super(failure.message);
  }
}

export const asFailure = (error: unknown): ClasesFailure => (error instanceof ClasesError ? error.failure : failureOf("desconocido"));

async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key";
  let session: string | undefined;
  try {
    session = (await supabase.auth.getSession()).data.session?.access_token;
  } catch {
    session = undefined;
  }
  if (!session) throw new ClasesError(failureOf("sesion"));
  const address = `${base}/functions/v1/pilo-clases`;
  let response: Response;
  try {
    response = await fetch(address, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${session}` },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    // El navegador no deja leer la respuesta: o no hay red, o la función no está desplegada (la plataforma
    // responde sin las cabeceras que el navegador pide). Una consulta sin leer la respuesta distingue las dos.
    const reachable = await fetch(address, { method: "GET", mode: "no-cors", cache: "no-store" }).then(
      () => true,
      () => false,
    );
    throw new ClasesError(failureOf(reachable ? "sin_funcion" : "sin_red"));
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* sin cuerpo, o no es JSON */
  }
  if (!response.ok) throw new ClasesError(clasesFailure(response.status, parsed));
  return parsed;
}

/** Los Moodle que ofrece la administración: de cada uno, su identificador y su nombre. */
export async function loadSites(signal?: AbortSignal): Promise<SiteRef[]> {
  return parseSites(await call({ action: "sitios" }, signal));
}

/** Pide al Moodle `site` un permiso de lectura con el usuario y la contraseña de la persona. La contraseña no se guarda. */
export async function connectMoodle(site: string, username: string, password: string): Promise<{ token: string; siteId: string; site: SiteInfo }> {
  const out = (await call({ action: "conectar", site, username: username.trim(), password })) as { token?: unknown; site_id?: unknown; site?: { name?: unknown; user?: unknown } } | null;
  if (typeof out?.token !== "string" || !out.token) throw new ClasesError(failureOf("desconocido"));
  const text = (v: unknown) => (typeof v === "string" ? v.slice(0, 120) : "");
  // El sitio es el que dice la función; si no lo dice, el del pedido.
  return { token: out.token, siteId: siteIdShape(out.site_id) ? out.site_id : site, site: { name: text(out.site?.name), user: text(out.site?.user) } };
}

/** Los cursos de la persona y sus próximas entregas. `site` falta en un permiso de antes. */
export async function loadAgenda(token: string, site: string | undefined, signal?: AbortSignal): Promise<Agenda> {
  return parseAgenda(await call({ action: "agenda", site, token }, signal));
}

/** Las secciones, actividades y materiales de un curso. */
export async function loadCourse(token: string, site: string | undefined, course: number, signal?: AbortSignal): Promise<CourseDetail> {
  return parseCourse(await call({ action: "curso", site, token, course }, signal));
}
