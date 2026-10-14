/* =============================================================================
   Edge Function · pilo-cuentas
   Las cuentas de los Usuarios de Pilo (0120): registro, ingreso con nombre de
   usuario, reenvío de la confirmación y recuperación de la contraseña.

   Son cuentas aparte de la intranet: viven en `pilo_users`, no en `profiles`,
   y no abren ningún módulo. Existe como función porque:

     · el alta exige la clave de servicio (crear el usuario de auth) y es aquí
       donde se decide qué correo entra: solo dominios de la UDES, con el perfil
       que cada dominio admite (pilo_email_rule, la misma regla de la base);
     · se entra con nombre de usuario, y traducirlo a correo en el navegador
       dejaría a cualquiera averiguar el correo de un usuario;
     · los intentos se limitan por dirección y por cuenta.

   El alta no depende de que el proyecto permita registros abiertos: la crea
   esta función con la clave de servicio.

   La confirmación del correo está APAGADA por ahora (el envío de correos del
   proyecto aún no funciona): la cuenta nace confirmada y la persona entra de
   inmediato. Mientras esté apagada no se comprueba que el correo sea de quien
   se registra. Para encenderla, ponga el secreto PILO_CONFIRMAR_CORREO=si: el
   usuario se crea entonces con una invitación (la plataforma envía el correo)
   y no puede entrar hasta confirmarlo.

   Acciones (POST, JSON):
     { action: "usuario",   username }                          → { free, reason? }
     { action: "registrar", email, rol, campus?, full_name, username, password, nick?, tone? } → { ok: true }
     { action: "ingresar",  username, password }                → { session: { access_token, refresh_token } }
     { action: "reenviar",  username }                          → { ok: true }
     { action: "recuperar", username }                          → { ok: true }
     { action: "eliminar",  user_id }   (solo administración)   → { ok: true }

   Los errores llevan `error` (para la persona) y `code` (para la página).

   Despliegue:
     supabase functions deploy pilo-cuentas
   ========================================================================== */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json", ...extra } });
}

const CAMPUSES = ["bucaramanga", "cucuta", "valledupar", "bogota"];
const TONES = ["cercano", "formal", "directo"];
/** Nombres que no se entregan: se prestan para hacerse pasar por la universidad o por Pilo. */
const RESERVED = ["admin", "administrador", "pilo", "mrpilo", "mr.pilo", "udes", "soporte", "root", "sistema", "planeacion", "rectoria", "intranet"];

const USERNAME = /^[a-z0-9._]{4,20}$/;
const MAX_FAILS = 5;
const LOCK_MINUTES = 10;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Qué le falta a un nombre de usuario, o "" si sirve. */
export function usernameProblem(username: string): string {
  if (!USERNAME.test(username)) return "El usuario lleva de 4 a 20 caracteres: letras minúsculas, números, punto o guion bajo.";
  if (/^[._]|[._]$|[._]{2}/.test(username)) return "El usuario no puede empezar ni terminar con punto o guion bajo, ni llevar dos seguidos.";
  if (RESERVED.includes(username.replace(/[._]/g, "")) || RESERVED.includes(username)) return "Ese nombre de usuario está reservado. Elija otro.";
  return "";
}

/** Qué le falta a una contraseña, o "" si sirve. */
export function passwordProblem(password: string): string {
  if (password.length < 8) return "La contraseña lleva 8 caracteres o más.";
  if (password.length > 72) return "La contraseña es demasiado larga: hasta 72 caracteres.";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "La contraseña lleva al menos una letra y un número.";
  return "";
}

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return json({ error: "La función no está configurada correctamente." }, 500);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return json({ error: "El pedido no es JSON." }, 400);
  }
  if (!body || typeof body !== "object") return json({ error: "El pedido no es JSON." }, 400);
  const action = String(body.action ?? "");

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  /** Un cliente sin sesión, como el del navegador: con él se prueba la contraseña. */
  const visitor = () => createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // --- El límite por dirección: de quien llama solo queda una huella con sal diaria (como en pilo-ia). ---
  const ip = (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "sin-direccion";
  const limited = async (scope: string, limit: number, windowSeconds: number, key = ip): Promise<number | null> => {
    const salt = Deno.env.get("PILO_VISITOR_SALT") || serviceKey;
    const now = Date.now();
    const start = Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;
    const visitorId = (await sha256(`${salt}|${new Date().toISOString().slice(0, 10)}|cuentas:${scope}|${key}`)).slice(0, 40);
    const { data, error } = await admin.rpc("pilo_visitor_hit", { p_visitor: visitorId, p_window_start: new Date(start).toISOString() });
    // Sin la tabla del límite (0110) no se limita: mejor atender que dejar a todos fuera.
    if (error) return null;
    return Number(data ?? 0) > limit ? Math.max(1, Math.ceil((start + windowSeconds * 1000 - now) / 1000)) : null;
  };
  const tooFast = (retry: number) =>
    json({ error: "Va muy rápido: espere un momento antes de volver a intentarlo.", code: "limite", retry_after: retry }, 429, { "Retry-After": String(retry) });

  const origin = request.headers.get("Origin") ?? "";
  const redirectTo = (path: string) => (/^https?:\/\/[^/]+$/.test(origin) ? `${origin}${path}` : undefined);

  const missing = (error: { message?: string } | null) => /pilo_users|pilo_email_rule/.test(error?.message ?? "") && /does not exist|could not find|schema cache|no existe/i.test(error?.message ?? "");
  const noMigration = () => json({ error: "Las cuentas de Pilo todavía no están instaladas: falta la migración 0120.", code: "migracion" }, 500);

  try {
    /* --- ¿Está libre este nombre de usuario? ------------------------------------------------ */
    if (action === "usuario") {
      const retry = await limited("u", 60, 600);
      if (retry) return tooFast(retry);
      const username = text(body.username, 40).toLowerCase();
      const problem = usernameProblem(username);
      if (problem) return json({ free: false, reason: problem });
      const { data, error } = await admin.from("pilo_users").select("id").eq("username", username).maybeSingle();
      if (error) return missing(error) ? noMigration() : json({ error: "No pude revisar ese usuario." }, 500);
      return json(data ? { free: false, reason: "Ese usuario ya está tomado. Pruebe con otro." } : { free: true });
    }

    /* --- Registrar -------------------------------------------------------------------------- */
    if (action === "registrar") {
      const retry = await limited("r", 6, 3600);
      if (retry) return tooFast(retry);

      const email = text(body.email, 160).toLowerCase();
      const rule = await admin.rpc("pilo_email_rule", { p_email: email });
      if (rule.error) return missing(rule.error) ? noMigration() : json({ error: "No pude revisar ese correo." }, 500);
      const allowed = rule.data as { roles: string[]; campus: string } | null;
      if (!allowed) return json({ error: "Ese correo no es de la UDES. Solo se aceptan correos institucionales.", code: "correo" }, 400);

      const rol = text(body.rol, 20).toLowerCase();
      if (!allowed.roles.includes(rol)) return json({ error: "Ese perfil no corresponde a su correo.", code: "rol" }, 400);

      // La sede: la del dominio si la dice; si no, la que la persona eligió.
      const campus = allowed.campus || text(body.campus, 20).toLowerCase();
      if (!CAMPUSES.includes(campus)) return json({ error: "Elija su sede: Bucaramanga, Cúcuta, Valledupar o Bogotá.", code: "sede" }, 400);

      const fullName = text(body.full_name, 120);
      if (fullName.length < 3) return json({ error: "Escriba su nombre completo.", code: "nombre" }, 400);

      const username = text(body.username, 40).toLowerCase();
      const userProblem = usernameProblem(username);
      if (userProblem) return json({ error: userProblem, code: "usuario" }, 400);

      const password = typeof body.password === "string" ? body.password : "";
      const passProblem = passwordProblem(password);
      if (passProblem) return json({ error: passProblem, code: "clave" }, 400);

      const nick = text(body.nick, 40) || fullName.split(" ")[0];
      const tone = TONES.includes(String(body.tone)) ? String(body.tone) : "cercano";

      const [byEmail, byUser] = await Promise.all([
        admin.from("pilo_users").select("id").eq("email", email).maybeSingle(),
        admin.from("pilo_users").select("id").eq("username", username).maybeSingle(),
      ]);
      const lookup = byEmail.error ?? byUser.error;
      if (lookup) return missing(lookup) ? noMigration() : json({ error: "No pude revisar si la cuenta ya existe." }, 500);
      if (byEmail.data) return json({ error: "Ese correo ya tiene una cuenta de Pilo. Entre con su usuario.", code: "existe" }, 409);
      if (byUser.data) return json({ error: "Ese usuario ya está tomado. Pruebe con otro.", code: "usuario" }, 409);

      // El usuario de auth nace con la marca de Pilo: así no recibe perfil de intranet (0120).
      // Con la confirmación apagada nace confirmado y con su contraseña; encendida, con una invitación.
      const confirm = Deno.env.get("PILO_CONFIRMAR_CORREO") === "si";
      // El perfil y la sede viajan con la cuenta: la bienvenida se envía antes de guardar pilo_users,
      // y la función `correos` los necesita para escoger el mensaje de ese perfil.
      const marks = { pilo: true, full_name: fullName, rol, campus };
      const invited = confirm
        ? await admin.auth.admin.inviteUserByEmail(email, { data: marks, redirectTo: redirectTo("/app/cuenta?confirmada=1") })
        : await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: marks });
      if (invited.error || !invited.data?.user) {
        const detail = invited.error?.message ?? "";
        // El correo ya es de alguien con cuenta en la intranet: esa cuenta ya le sirve en Pilo.
        if (/already|registered|exists/i.test(detail)) {
          return json({ error: "Ese correo ya tiene una cuenta en la intranet de la universidad. Entre a Pilo con esa cuenta.", code: "intranet" }, 409);
        }
        if (/rate limit/i.test(detail)) return json({ error: "Se enviaron muchos correos en poco tiempo. Intente de nuevo en unos minutos.", code: "correos" }, 429);
        return json({ error: "No pude crear la cuenta. Intente de nuevo en un momento.", code: "alta", detail: detail.slice(0, 200) }, 502);
      }
      const id = invited.data.user.id;
      const undo = () => admin.auth.admin.deleteUser(id).catch(() => undefined);

      const withPassword = confirm ? await admin.auth.admin.updateUserById(id, { password }) : { error: null };
      if (withPassword.error) {
        await undo();
        return json({ error: "No pude guardar la contraseña. Intente de nuevo.", code: "clave" }, 502);
      }
      const saved = await admin.from("pilo_users").insert({ id, username, full_name: fullName, email, rol, campus, nick, tone });
      if (saved.error) {
        await undo();
        const clash = /duplicate|unique/i.test(saved.error.message);
        return json({ error: clash ? "Ese usuario ya está tomado. Pruebe con otro." : "No pude guardar la cuenta. Intente de nuevo.", code: clash ? "usuario" : "alta" }, clash ? 409 : 500);
      }
      if (confirm) return json({ ok: true, confirm: true });
      // Sin confirmación, la persona entra de una vez: se le devuelve su sesión. Si no se pudo abrir, entra con su usuario.
      const signed = await visitor().auth.signInWithPassword({ email, password });
      const session = signed.data?.session;
      if (session) await admin.from("pilo_users").update({ last_seen_at: new Date().toISOString() }).eq("id", id);
      return json({ ok: true, confirm: false, ...(session ? { session: { access_token: session.access_token, refresh_token: session.refresh_token } } : {}) });
    }

    /* --- Ingresar con nombre de usuario ----------------------------------------------------- */
    if (action === "ingresar") {
      const retry = await limited("i", 30, 600);
      if (retry) return tooFast(retry);
      const username = text(body.username, 40).toLowerCase();
      const password = typeof body.password === "string" ? body.password : "";
      // La misma respuesta para «no existe» y «contraseña errada»: no se dice cuál de los dos.
      const wrong = () => json({ error: "El usuario o la contraseña no coinciden.", code: "credenciales" }, 401);
      if (!USERNAME.test(username) || !password || password.length > 72) return wrong();

      const found = await admin.from("pilo_users").select("id, email, status, failed_logins, locked_until").eq("username", username).maybeSingle();
      if (found.error) return missing(found.error) ? noMigration() : json({ error: "No pude revisar esa cuenta." }, 500);
      const user = found.data as { id: string; email: string; status: string; failed_logins: number; locked_until: string | null } | null;
      if (!user) return wrong();
      if (user.locked_until && new Date(user.locked_until).getTime() > Date.now()) {
        const wait = Math.ceil((new Date(user.locked_until).getTime() - Date.now()) / 60000);
        return json({ error: `Demasiados intentos. Podrá entrar de nuevo en ${wait} ${wait === 1 ? "minuto" : "minutos"}.`, code: "bloqueada" }, 429);
      }

      const signed = await visitor().auth.signInWithPassword({ email: user.email, password });
      if (signed.error || !signed.data.session) {
        if (/not confirmed/i.test(signed.error?.message ?? "")) {
          return json({ error: "Aún no ha confirmado su correo. Revise su bandeja y abra el enlace que le enviamos.", code: "sin_confirmar" }, 403);
        }
        const fails = (user.failed_logins ?? 0) + 1;
        const lock = fails >= MAX_FAILS;
        await admin
          .from("pilo_users")
          .update({ failed_logins: lock ? 0 : fails, locked_until: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null })
          .eq("id", user.id);
        return wrong();
      }
      if (user.status !== "activa") {
        await admin.auth.admin.signOut(signed.data.session.access_token).catch(() => undefined);
        return json({ error: "Su cuenta de Pilo está suspendida. Escriba a la administración.", code: "suspendida" }, 403);
      }
      await admin.from("pilo_users").update({ failed_logins: 0, locked_until: null, last_seen_at: new Date().toISOString() }).eq("id", user.id);
      return json({ session: { access_token: signed.data.session.access_token, refresh_token: signed.data.session.refresh_token } });
    }

    /* --- Reenviar la confirmación y recuperar la contraseña --------------------------------- */
    // Siempre responden lo mismo: no dicen si el usuario existe.
    if (action === "reenviar" || action === "recuperar") {
      const retry = await limited(action === "reenviar" ? "c" : "p", 4, 3600);
      if (retry) return tooFast(retry);
      const username = text(body.username, 40).toLowerCase();
      const done = () => json({ ok: true });
      if (!USERNAME.test(username)) return done();
      const { data } = await admin.from("pilo_users").select("email, full_name").eq("username", username).maybeSingle();
      const user = data as { email: string; full_name: string } | null;
      if (!user) return done();
      if (action === "recuperar") {
        await visitor().auth.resetPasswordForEmail(user.email, { redirectTo: redirectTo("/app/cuenta?clave=1") });
        return done();
      }
      // La confirmación viaja como invitación: se vuelve a invitar; si la plataforma no lo admite, se reenvía el alta.
      const again = await admin.auth.admin.inviteUserByEmail(user.email, { data: { pilo: true, full_name: user.full_name }, redirectTo: redirectTo("/app/cuenta?confirmada=1") });
      if (again.error) await visitor().auth.resend({ type: "signup", email: user.email, options: { emailRedirectTo: redirectTo("/app/cuenta?confirmada=1") } });
      return done();
    }

    /* --- Eliminar una cuenta (solo administración) ------------------------------------------ */
    if (action === "eliminar") {
      const authorization = request.headers.get("Authorization") ?? "";
      if (!authorization.startsWith("Bearer ")) return json({ error: "Falta la sesión." }, 401);
      const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
      const who = await caller.auth.getUser();
      if (who.error || !who.data.user) return json({ error: "Sesión inválida." }, 401);
      const { data: profile } = await caller.from("profiles").select("role, is_active").eq("id", who.data.user.id).maybeSingle();
      if (!profile?.is_active || profile.role !== "admin") return json({ error: "Solo la administración elimina cuentas de Pilo." }, 403);
      const id = text(body.user_id, 40);
      // Solo se elimina lo que es un usuario de Pilo: nunca una cuenta de la intranet.
      const { data: target } = await admin.from("pilo_users").select("id").eq("id", id).maybeSingle();
      if (!target) return json({ error: "Esa cuenta de Pilo no existe." }, 404);
      const removed = await admin.auth.admin.deleteUser(id);
      if (removed.error) return json({ error: "No pude eliminar la cuenta." }, 502);
      return json({ ok: true });
    }

    return json({ error: "Acción desconocida." }, 400);
  } catch (error) {
    return json({ error: "Algo falló al atender el pedido.", detail: String((error as Error)?.message ?? error).slice(0, 200) }, 500);
  }
});
