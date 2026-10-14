/* =============================================================================
   Edge Function · pilo-alertas

   La capa de emergencias de Mr. Pilo. Aluna2 (aluna2.udesplanea.com) declara
   las emergencias del campus —sismo, incendio, seguridad— y esta función las
   trae a la tabla `pilo_alerts` (migración 0138); la capa de Pilo, en todos los
   portales, solo escucha esa tabla. Sin emergencia no hay capa ni pedidos.

   Tres caminos de entrada, los tres de servidor a servidor:

   1. EL WEBHOOK de Aluna (POST con el encabezado x-aluna-firma, que es
      sha256(secreto + cuerpo) en hexadecimal). Sin firma válida: 401 y nada
      más. Con ella, un aviso emitido que sea de un tipo permitido abre su
      alerta al momento (solo si no existía: un reenvío viejo no reabre una
      alerta ya cerrada) y, como respaldo, se consulta a Aluna para saber si
      alguna emergencia se cerró.
   2. LA CONSULTA PERIÓDICA { action: "sync" } con el encabezado x-pilo-cron
      (el secreto de función PILO_ALERTAS_CRON), que llama pg_cron cada minuto.
      Pide a Aluna GET /alertas con la clave de integración, abre lo que falte
      y CIERRA lo que Aluna ya no tiene activo. Si Aluna no responde, no cierra
      nada: no saber no es lo mismo que estar despejado.
   3. LA INTRANET, con la sesión de la administración:
        { action: "probar" } → { ok, message | error }   consulta a Aluna sin escribir nada.
        { action: "sync" }   → { ok, message | error }   consulta ahora, aunque la periódica esté apagada.

   Decisiones que conviene conocer:
     · La clave de integración y el secreto del webhook salen de la base
       (pilo_alert_secret, solo el rol de servicio). Nada de eso viaja al
       navegador ni queda en los registros: esta función no usa `console`.
     · La dirección de Aluna sale de los ajustes, solo https y con un dominio
       (nada de IP ni red interna); no se siguen redirecciones.
     · Si el interruptor general está apagado, la función no abre ni cierra nada.

   Despliegue:
     supabase functions deploy pilo-alertas --no-verify-jwt
     supabase secrets set PILO_ALERTAS_CRON=<un valor largo al azar>
   ========================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

// >>> lógica (copia exacta de src/components/alertas/servidor-logica.ts; la prueba servidor-sync la vigila)
export type KindAlerta = "sismo" | "incendio" | "seguridad" | "general";
export type TipoAviso = "informativo" | "obligatoria" | "emergencia";

export const TIPOS_AVISO: readonly TipoAviso[] = ["informativo", "obligatoria", "emergencia"];

/** Una alerta lista para guardar en pilo_alerts. */
export interface AlertaNueva {
  ext_id: string;
  code: string;
  kind: KindAlerta;
  alert_type: TipoAviso;
  title: string;
  body: string;
  emitted_at: string | null;
}

const sinTildes = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** De qué se trata, por lo que dice el aviso: Aluna no lo trae como campo. */
export function tipoDeAlerta(titulo: unknown, cuerpo: unknown): KindAlerta {
  const t = sinTildes(`${typeof titulo === "string" ? titulo : ""} ${typeof cuerpo === "string" ? cuerpo : ""}`);
  if (/\b(sismo|temblor|terremoto|telurico|replica)/.test(t)) return "sismo";
  if (/\b(incendio|fuego|humo|conato|llamas)/.test(t)) return "incendio";
  if (/\b(amenaza|bomba|explosivo|disparo|balacera|intruso|atentado|armad[oa]|seguridad|secuestro)/.test(t)) return "seguridad";
  return "general";
}

const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Un aviso de Aluna (del webhook o de GET /alertas) como alerta de Pilo; nada si no sirve. */
export function normalizarAviso(raw: unknown): AlertaNueva | null {
  if (!raw || typeof raw !== "object") return null;
  const a = raw as Record<string, unknown>;
  const id = typeof a.id === "string" || typeof a.id === "number" ? String(a.id).trim().slice(0, 80) : "";
  const title = texto(a.titulo, 300);
  if (!id || !title) return null;
  const tipo = TIPOS_AVISO.includes(a.tipo as TipoAviso) ? (a.tipo as TipoAviso) : "emergencia";
  const body = texto(a.cuerpo, 4000);
  const at = typeof a.emitido_at === "string" && !Number.isNaN(Date.parse(a.emitido_at)) ? new Date(a.emitido_at).toISOString() : null;
  return { ext_id: id, code: texto(a.codigo, 60), kind: tipoDeAlerta(title, body), alert_type: tipo, title, body, emitted_at: at };
}

/**
 * Lo que dice GET /alertas, listo para guardar. Se saltan los avisos que
 * reemplazan a otro (son el «todo despejado»: cierran, no abren) y los de un
 * tipo que la administración no quiso mostrar.
 */
export function alertasDeLista(lista: unknown, tipos: readonly string[]): AlertaNueva[] {
  if (!Array.isArray(lista)) return [];
  const out: AlertaNueva[] = [];
  for (const item of lista) {
    const raw = item as Record<string, unknown> | null;
    if (!raw || (raw.reemplaza_a !== undefined && raw.reemplaza_a !== null)) continue;
    const a = normalizarAviso(raw);
    if (a && tipos.includes(a.alert_type)) out.push(a);
  }
  return out;
}

/** Qué hacer con lo que Aluna dice que está activo frente a lo que Pilo tiene activo (de origen Aluna). */
export function planificarSync(activasAluna: readonly AlertaNueva[], activasPilo: readonly string[]): { abrir: AlertaNueva[]; cerrar: string[] } {
  const vivas = new Set(activasAluna.map((a) => a.ext_id));
  return { abrir: [...activasAluna], cerrar: activasPilo.filter((id) => !vivas.has(id)) };
}

/** La dirección de la API de Aluna: solo https, con un dominio de verdad (nada de IP ni red interna). */
export function direccionAluna(base: unknown, ruta: string): string | null {
  if (typeof base !== "string") return null;
  let u: URL;
  try {
    u = new URL(base.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash) return null;
  const host = u.hostname.toLowerCase();
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(host)) return null;
  if (/^[0-9.]+$/.test(host) || host === "localhost" || /\.(local|internal|localhost|lan|home)$/.test(host)) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}${ruta}`;
}

/** Comparar sin que el tiempo delate cuántos caracteres coinciden. */
export function igualesEnTiempoConstante(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function sha256Hex(entrada: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(entrada));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** La firma de Aluna: sha256(secreto + cuerpo) en hexadecimal, en el encabezado x-aluna-firma. */
export async function firmaAlunaValida(secreto: string, cuerpo: string, firma: string | null): Promise<boolean> {
  const dada = (firma ?? "").trim().toLowerCase();
  if (!secreto || !/^[0-9a-f]{64}$/.test(dada)) return false;
  return igualesEnTiempoConstante(await sha256Hex(secreto + cuerpo), dada);
}

// <<< fin de la lógica

/* --- La función ------------------------------------------------------------------------------ */

const ENV = (name: string) => Deno.env.get(name) ?? "";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pilo-cron",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

interface Contexto {
  enabled: boolean;
  api_url: string;
  types: string[];
  webhook_on: boolean;
  poll_on: boolean;
  api_key: string;
  webhook_secret: string;
}

type Servicio = ReturnType<typeof createClient>;

async function contexto(admin: Servicio): Promise<Contexto | null> {
  const { data, error } = await admin.rpc("pilo_alert_context");
  return error || !data ? null : (data as Contexto);
}

/** Consulta GET /alertas de Aluna. Devuelve la lista, o el motivo por el que no se pudo. */
async function consultarAluna(ctx: Contexto): Promise<{ ok: true; alertas: AlertaNueva[]; total: number } | { ok: false; error: string }> {
  const direccion = direccionAluna(ctx.api_url, "/alertas");
  if (!direccion) return { ok: false, error: "La dirección de Aluna no es válida: debe ser https y de un dominio." };
  if (!ctx.api_key) return { ok: false, error: "Falta la clave de integración de Aluna." };
  let respuesta: Response;
  try {
    respuesta = await fetch(direccion, {
      method: "GET",
      headers: { Authorization: `Bearer ${ctx.api_key}`, Accept: "application/json" },
      redirect: "manual",
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    return { ok: false, error: "Aluna no respondió a tiempo." };
  }
  if (respuesta.status === 401) return { ok: false, error: "Aluna rechazó la clave de integración." };
  if (!respuesta.ok) return { ok: false, error: `Aluna respondió con el estado ${respuesta.status}.` };
  let cuerpo: { alertas?: unknown };
  try {
    cuerpo = await respuesta.json();
  } catch {
    return { ok: false, error: "Aluna respondió algo que no es JSON." };
  }
  if (!Array.isArray(cuerpo?.alertas)) return { ok: false, error: "La respuesta de Aluna no trae la lista de alertas." };
  return { ok: true, alertas: alertasDeLista(cuerpo.alertas, ctx.types), total: cuerpo.alertas.length };
}

async function anotar(admin: Servicio, ok: boolean, detalle: string) {
  await admin.from("pilo_alert_settings").update({ last_sync_at: new Date().toISOString(), last_sync_ok: ok, last_sync_detail: detalle.slice(0, 300) }).eq("id", true);
}

/** Pone al día la tabla con lo que Aluna tiene activo. */
async function sincronizar(admin: Servicio, ctx: Contexto): Promise<{ ok: boolean; message?: string; error?: string }> {
  const lista = await consultarAluna(ctx);
  if (!lista.ok) {
    await anotar(admin, false, lista.error);
    return { ok: false, error: lista.error };
  }
  const { data: activas, error: leer } = await admin.from("pilo_alerts").select("ext_id").eq("source", "aluna").eq("state", "activa");
  if (leer) return { ok: false, error: "No se pudo leer las alertas guardadas." };
  const plan = planificarSync(lista.alertas, (activas ?? []).map((r: { ext_id: string }) => r.ext_id));

  if (plan.abrir.length) {
    const filas = plan.abrir.map((a) => ({
      source: "aluna", ext_id: a.ext_id, code: a.code, kind: a.kind, alert_type: a.alert_type, title: a.title, body: a.body,
      state: "activa", closed_at: null, close_note: null, ...(a.emitted_at ? { emitted_at: a.emitted_at } : {}),
    }));
    const { error } = await admin.from("pilo_alerts").upsert(filas, { onConflict: "source,ext_id" });
    if (error) return { ok: false, error: "No se pudo guardar las alertas." };
  }
  if (plan.cerrar.length) {
    const { error } = await admin
      .from("pilo_alerts")
      .update({ state: "cerrada", closed_at: new Date().toISOString(), close_note: "Aluna dio por controlada la emergencia." })
      .eq("source", "aluna")
      .eq("state", "activa")
      .in("ext_id", plan.cerrar);
    if (error) return { ok: false, error: "No se pudo cerrar las alertas." };
  }
  const resumen = `${plan.abrir.length} activa(s), ${plan.cerrar.length} cerrada(s) ahora.`;
  await anotar(admin, true, resumen);
  return { ok: true, message: `Aluna respondió: ${lista.total} aviso(s) activos. ${resumen}` };
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = ENV("SUPABASE_URL");
  const serviceKey = ENV("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = ENV("SUPABASE_ANON_KEY");
  if (!url || !serviceKey) return json({ error: "La función no está configurada." }, 500);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const crudo = await request.text();
  if (crudo.length > 100_000) return json({ error: "El pedido es demasiado grande." }, 413);

  /* --- 1. El webhook de Aluna ------------------------------------------------------------- */
  const firma = request.headers.get("x-aluna-firma");
  if (firma !== null) {
    const ctx = await contexto(admin);
    if (!ctx) return json({ error: "Sin configuración." }, 503);
    if (!(await firmaAlunaValida(ctx.webhook_secret, crudo, firma))) return json({ error: "Firma inválida." }, 401);
    if (!ctx.enabled || !ctx.webhook_on) return json({ ok: true, ignorado: "apagado" });
    let evento: { evento?: string; aviso?: unknown };
    try {
      evento = JSON.parse(crudo);
    } catch {
      return json({ error: "El pedido no es JSON." }, 400);
    }
    if (evento.evento !== "aviso.emitido") return json({ ok: true, ignorado: "evento" });
    const aviso = normalizarAviso(evento.aviso);
    const raw = (evento.aviso ?? {}) as Record<string, unknown>;
    // Un aviso que reemplaza a otro es el «todo despejado»: no abre, solo obliga a revisar.
    if (aviso && ctx.types.includes(aviso.alert_type) && !raw.reemplaza_a) {
      await admin.from("pilo_alerts").upsert(
        [{ source: "aluna", ext_id: aviso.ext_id, code: aviso.code, kind: aviso.kind, alert_type: aviso.alert_type, title: aviso.title, body: aviso.body, ...(aviso.emitted_at ? { emitted_at: aviso.emitted_at } : {}) }],
        { onConflict: "source,ext_id", ignoreDuplicates: true },
      );
    }
    // Respaldo: con la clave, se confirma con Aluna (y se cierra lo que ya cerró).
    if (ctx.api_key) await sincronizar(admin, ctx);
    return json({ ok: true });
  }

  let body: Record<string, unknown> = {};
  try {
    body = crudo ? JSON.parse(crudo) : {};
  } catch {
    return json({ error: "El pedido no es JSON." }, 400);
  }
  const action = String(body.action ?? "");
  if (action !== "sync" && action !== "probar") return json({ error: "Acción desconocida." }, 400);

  /* --- 2. La consulta periódica ------------------------------------------------------------- */
  const cron = request.headers.get("x-pilo-cron")?.trim() ?? "";
  const secretoCron = ENV("PILO_ALERTAS_CRON");
  let forzada = false;
  if (cron) {
    if (!secretoCron || action !== "sync" || !igualesEnTiempoConstante(cron, secretoCron)) return json({ error: "No autorizado." }, 401);
  } else {
    /* --- 3. La intranet, con la sesión de la administración --------------------------------- */
    const authorization = request.headers.get("Authorization") ?? "";
    if (!authorization.startsWith("Bearer ") || authorization.slice(7) === anonKey) return json({ error: "Falta la sesión." }, 401);
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
    const who = await caller.auth.getUser();
    if (who.error || !who.data.user) return json({ error: "Sesión inválida." }, 401);
    const { data: profile } = await caller.from("profiles").select("role, is_active").eq("id", who.data.user.id).maybeSingle();
    if (!profile?.is_active || profile.role !== "admin") return json({ error: "Solo la administración." }, 403);
    forzada = true;
  }

  const ctx = await contexto(admin);
  if (!ctx) return json({ ok: false, error: "Falta aplicar la migración 0138." });

  if (action === "probar") {
    const lista = await consultarAluna(ctx);
    if (!lista.ok) return json({ ok: false, error: lista.error });
    return json({ ok: true, message: `Aluna respondió bien: ${lista.total} aviso(s) activos, ${lista.alertas.length} de los tipos que Pilo muestra.` });
  }

  if (!ctx.enabled) return json({ ok: false, error: forzada ? "La capa está apagada: enciéndala para consultar." : "apagado" });
  if (!forzada && !ctx.poll_on) return json({ ok: true, message: "La consulta periódica está apagada." });
  return json(await sincronizar(admin, ctx));
});
