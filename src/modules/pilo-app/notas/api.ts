/* =============================================================================
   Mr. Pilo · Mis notas (beta) · los pedidos a la función `pilo-genesis`.

   Cada pedido lleva la sesión de la cuenta de Pilo (la función comprueba que
   sea de estudiante) y, salvo «conectar», el permiso firmado que guarda este
   dispositivo. La contraseña de Génesis pasa por aquí hacia la función una
   sola vez y no se guarda en ningún sitio. El código del estudiante no viaja
   después del ingreso: la función lo saca del permiso. De la sede viaja solo
   su id: la dirección de cada portal la tiene la función, no la app.

   Nada de lo que llega se escribe en el almacenamiento: las notas viven en la
   memoria de la pantalla mientras está abierta.

   Las recomendaciones son el único pedido que va a otra función (`pilo-ia`,
   acción «evolucion») y el único en que algo de las notas sale hacia la IA:
   un resumen sin datos personales, y solo cuando la persona pulsa el botón.
   ========================================================================== */

import { supabase } from "../../../lib/supabase";
import { adviceFailure, adviceFailureOf, failureOf, notasFailure, parseAdvice, parseHead, parseHistory, parsePortal, parsePortals, summaryCourses } from "./logic";
import type { Advice, AdviceFailure, AdviceSummary, History, NotasFailure, NotasHead, PortalInfo, PortalList } from "./logic";

export class NotasError extends Error {
  constructor(readonly failure: NotasFailure) {
    super(failure.message);
  }
}

export const asFailure = (error: unknown): NotasFailure => (error instanceof NotasError ? error.failure : failureOf("desconocido"));

async function call(body: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key";
  let session: string | undefined;
  try {
    session = (await supabase.auth.getSession()).data.session?.access_token;
  } catch {
    session = undefined;
  }
  if (!session) throw new NotasError(failureOf("sesion"));
  const address = `${base}/functions/v1/pilo-genesis`;
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
    throw new NotasError(failureOf(reachable ? "sin_funcion" : "sin_red"));
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* sin cuerpo, o no es JSON */
  }
  if (!response.ok) throw new NotasError(notasFailure(response.status, parsed));
  return parsed;
}

/** Las sedes en que se puede entrar (su id y su nombre) y si Mis notas está encendida. */
export async function loadPortals(signal?: AbortSignal): Promise<PortalList> {
  return parsePortals(await call({ action: "portales" }, signal));
}

/** Entra al Génesis de esa sede con el código y la contraseña de la persona y trae el permiso firmado. La contraseña no se guarda. */
export async function connectGenesis(portal: string, code: string, password: string): Promise<{ permit: string; expires: number; head: NotasHead; portal: PortalInfo }> {
  const out = (await call({ action: "conectar", portal, code: code.trim(), password })) as { permit?: unknown; expires?: unknown; head?: unknown; portal?: unknown } | null;
  const expires = Number(out?.expires);
  const where = parsePortal(out?.portal);
  // La sede es la que dice la función que usó: si no es la que se pidió, no se guarda nada.
  if (typeof out?.permit !== "string" || !out.permit || !Number.isInteger(expires) || expires <= 0 || !where || where.id !== portal) throw new NotasError(failureOf("desconocido"));
  return { permit: out.permit, expires, head: parseHead(out.head), portal: where };
}

/** El histórico: los periodos con sus promedios, sus créditos y sus materias. */
export async function loadHistory(permit: string, signal?: AbortSignal): Promise<History> {
  return parseHistory(await call({ action: "historico", permit }, signal));
}

/** El polígrafo oficial, tal como lo entrega Génesis: un PDF listo para descargar. */
export async function loadPolygraphPdf(permit: string): Promise<Blob> {
  const out = (await call({ action: "poligrafo_pdf", permit })) as { pdf?: unknown } | null;
  if (typeof out?.pdf !== "string" || !out.pdf) throw new NotasError(failureOf("pdf"));
  try {
    const raw = atob(out.pdf);
    const bytes = new Uint8Array(new ArrayBuffer(raw.length));
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    return new Blob([bytes], { type: "application/pdf" });
  } catch {
    throw new NotasError(failureOf("pdf"));
  }
}

/* --- Lo que le recomiendo ---------------------------------------------------------------------- */

export class AdviceError extends Error {
  constructor(readonly failure: AdviceFailure) {
    super(failure.message);
  }
}

export const asAdviceFailure = (error: unknown): AdviceFailure => (error instanceof AdviceError ? error.failure : adviceFailureOf("desconocido"));

/**
 * Pide las recomendaciones a Pilo (función `pilo-ia`, acción «evolucion») con
 * el resumen que armó este dispositivo: sin nombre, código ni documento. Lo
 * que vuelve no se guarda en ningún sitio: quien llama lo tiene en memoria.
 */
export async function loadAdvice(summary: AdviceSummary, signal?: AbortSignal): Promise<Advice> {
  const base = (import.meta.env.VITE_SUPABASE_URL ?? "http://localhost:54321").replace(/\/+$/, "");
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "public-anon-key";
  let session: string | undefined;
  try {
    session = (await supabase.auth.getSession()).data.session?.access_token;
  } catch {
    session = undefined;
  }
  if (!session) throw new AdviceError(adviceFailureOf("sesion"));
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/pilo-ia`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${session}` },
      body: JSON.stringify({ action: "evolucion", portal: "ensenanza", summary }),
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new AdviceError(adviceFailureOf(typeof navigator !== "undefined" && navigator.onLine === false ? "sin_red" : "red"));
  }
  let parsed: unknown = null;
  try {
    parsed = await response.json();
  } catch {
    /* sin cuerpo, o no es JSON */
  }
  if (!response.ok) throw new AdviceError(adviceFailure(response.status, parsed));
  const advice = parseAdvice(parsed, summaryCourses(summary).length);
  if (!advice.recs.length) throw new AdviceError(adviceFailureOf("vacio"));
  return advice;
}
