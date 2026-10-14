/* =============================================================================
   Edge Function · pilo-staff
   El personal administrativo de Pilo (pilo_0146): invitar y quitar personas.

   El personal vive en `pilo_staff`, no en `profiles`: no tiene perfil de PDI
   (la cuenta nace con pilo_staff='true' en sus metadatos y el disparador de
   auth.users se salta el perfil). Existe como función porque crear el usuario
   de auth y mandarle el enlace para definir su contraseña exigen la clave de
   servicio.

   Quién puede llamarla: solo un administrador de Pilo. La función verifica el
   JWT por su cuenta (el proyecto la despliega con verify_jwt = false) y le
   pregunta a la base por el rol de quien llama con pilo_staff_role(): es la
   misma lógica de las políticas (la fila activa de pilo_staff, o admin activo
   de PDI). Nada de lo que diga el cuerpo del pedido concede permisos.

   Acciones (POST, JSON, con `Authorization: Bearer <sesión>`):
     { action: "invite", email, full_name, role, redirect_path? }
         → { ok: true, user_id, sent: true }
         → { ok: true, user_id, sent: false, link }   (si el correo no salió, el
                                                       enlace de contraseña para
                                                       entregarlo a mano)
     { action: "remove", user_id }
         → { ok: true, deleted_account: boolean }

   `role` es uno de: docencia, institucional, ambos, admin.
   `redirect_path` (opcional) es la ruta de esta misma web a la que lleva el
   enlace (se une a PILO_SITE_URL, secreto de la función, nunca al Origin del pedido);
   por defecto «/acceso-intranet?clave=1». Solo se aceptan rutas
   internas (que empiecen por «/», sin «//»): el destino nunca es de otro sitio.

   «remove» solo quita a quien está en pilo_staff, nunca a otra cuenta. Si esa
   persona tiene además perfil de PDI, solo se le quita el cargo en Pilo y su
   cuenta se queda (deleted_account: false); la cuenta solo se borra si la creó
   esta función (created_by, pilo_staff=true, sin perfil de PDI ni pilo_users). El último administrador activo no
   se puede quitar.

   Los errores llevan `error` (para la persona) y `code` (para la página).

   Despliegue:
     supabase functions deploy pilo-staff
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

/** Los cuatro roles del personal (espejo de src/lib/pilo-staff.ts y del CHECK de pilo_staff). */
export const STAFF_ROLES = ["docencia", "institucional", "ambos", "admin"];

const EXISTS_MESSAGE =
  "Ese correo ya tiene una cuenta o ya está en el personal de Pilo. Si es administrador en PDI ya entra a Pilo como administrador; para darle otro rol, cámbielo desde la lista del personal.";
const EMAIL = /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const DEFAULT_REDIRECT = "/acceso-intranet?clave=1";

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Qué le falta a un correo, o "" si sirve. */
export function emailProblem(email: string): string {
  if (!email) return "Escriba el correo de la persona.";
  if (email.length > 160 || !EMAIL.test(email)) return "Ese correo no es válido.";
  return "";
}

/** Qué le falta a un nombre, o "" si sirve (la base pide hasta 120). */
export function nameProblem(name: string): string {
  if (name.length < 3) return "Escriba el nombre completo.";
  return "";
}

/** La ruta interna a la que lleva el enlace: nunca un sitio de afuera. */
export function redirectPath(value: unknown): string {
  const path = typeof value === "string" ? value.trim() : "";
  if (!path || path.length > 200 || !/^\/[A-Za-z0-9/_\-?=&.%]*$/.test(path) || path.startsWith("//")) return DEFAULT_REDIRECT;
  return path;
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
  if (action !== "invite" && action !== "remove") return json({ error: "Acción desconocida." }, 400);

  // --- Quién llama: se verifica el JWT aquí y se le pregunta a la base su rol. ---
  const authorization = request.headers.get("Authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Falta la sesión." }, 401);
  const caller = createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  const who = await caller.auth.getUser();
  if (who.error || !who.data.user) return json({ error: "Sesión inválida." }, 401);
  const me = who.data.user.id;
  const roleOf = await caller.rpc("pilo_staff_role");
  if (roleOf.error) {
    const missing = /pilo_staff_role|schema cache|does not exist|no existe/i.test(roleOf.error.message ?? "");
    return missing
      ? json({ error: "El personal de Pilo todavía no está instalado: falta la migración pilo_0146.", code: "migracion" }, 500)
      : json({ error: "No pude comprobar su rol." }, 502);
  }
  if (roleOf.data !== "admin") return json({ error: "Solo la administración de Pilo maneja el personal.", code: "permiso" }, 403);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  // El destino del enlace sale de un valor fijo del servidor (PILO_SITE_URL, p. ej. https://pilo.udes.edu.co),
  // nunca del encabezado Origin, que quien llama controla. Sin él se usa la dirección del sitio de la plataforma.
  const site = (Deno.env.get("PILO_SITE_URL") ?? "").trim().replace(/\/+$/, "");
  const linkTo = (path: string) => (/^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test(site) ? `${site}${path}` : undefined);
  const audit = (event: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ fn: "pilo-staff", event, caller: me, ...extra }));

  try {
    /* --- Invitar ---------------------------------------------------------------------------- */
    if (action === "invite") {
      const email = text(body.email, 160).toLowerCase();
      const emailFault = emailProblem(email);
      if (emailFault) return json({ error: emailFault, code: "correo" }, 400);
      const fullName = text(body.full_name, 120);
      const nameFault = nameProblem(fullName);
      if (nameFault) return json({ error: nameFault, code: "nombre" }, 400);
      const role = text(body.role, 20);
      if (!STAFF_ROLES.includes(role)) return json({ error: "Elija un rol: docencia, institucional, ambos o administrador.", code: "rol" }, 400);

      const known = await admin.from("pilo_staff").select("user_id").eq("email", email).maybeSingle();
      if (known.error) return json({ error: "No pude revisar si la persona ya está en el personal." }, 500);
      if (known.data) {
        audit("invite_rechazada", { reason: "ya_es_personal", role });
        return json({ error: EXISTS_MESSAGE, code: "existe" }, 409);
      }

      // La cuenta nace confirmada, sin contraseña y con la marca del personal de Pilo:
      // así no recibe perfil de PDI (pilo_0146). Falsificar la marca no concede nada.
      const created = await admin.auth.admin.createUser({
        email,
        email_confirm: true,
        user_metadata: { pilo_staff: "true", full_name: fullName },
      });
      if (created.error || !created.data?.user) {
        const detail = created.error?.message ?? "";
        if (/already|registered|exists/i.test(detail)) {
          audit("invite_rechazada", { reason: "cuenta_existente", role });
          return json({ error: EXISTS_MESSAGE, code: "existe" }, 409);
        }
        return json({ error: "No pude crear la cuenta. Intente de nuevo en un momento.", code: "alta", detail: detail.slice(0, 200) }, 502);
      }
      const id = created.data.user.id;
      const undo = () => admin.auth.admin.deleteUser(id).catch(() => undefined);

      const saved = await admin.from("pilo_staff").insert({ user_id: id, email, full_name: fullName, role, active: true, created_by: me });
      if (saved.error) {
        await undo();
        const clash = /duplicate|unique/i.test(saved.error.message);
        return json({ error: clash ? EXISTS_MESSAGE : "No pude guardar a la persona.", code: clash ? "existe" : "alta" }, clash ? 409 : 500);
      }

      // El enlace para definir su contraseña: el correo de recuperación de la plataforma.
      const redirectTo = linkTo(redirectPath(body.redirect_path));
      const mail = await createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.resetPasswordForEmail(email, { redirectTo });
      audit("invite", { target: id, role, sent: !mail.error });
      if (!mail.error) return json({ ok: true, user_id: id, sent: true });

      // Si el correo no salió (el envío del proyecto puede estar apagado), se le da el enlace a quien invita,
      // salvo a un administrador: ese enlace entrega la cuenta de un admin y se reparte por otro canal.
      if (role === "admin") return json({ ok: true, user_id: id, sent: false, code: "sin_enlace" });
      const link = await admin.auth.admin.generateLink({ type: "recovery", email, options: { redirectTo } });
      const actionLink = link.data?.properties?.action_link;
      if (!actionLink) return json({ ok: true, user_id: id, sent: false, code: "sin_enlace" });
      return json({ ok: true, user_id: id, sent: false, link: actionLink });
    }

    /* --- Quitar ----------------------------------------------------------------------------- */
    const target = text(body.user_id, 40);
    if (!/^[0-9a-f-]{36}$/i.test(target)) return json({ error: "Falta la persona.", code: "persona" }, 400);

    // La base quita la fila con el cerrojo de admins: solo a quien es personal de Pilo, y nunca al último administrador activo.
    const gone = await admin.rpc("pilo_staff_remove_row", { p_user: target });
    if (gone.error) {
      const msg = gone.error.message ?? "";
      if (/no está en el personal/i.test(msg)) return json({ error: "Esa persona no está en el personal de Pilo.", code: "no_existe" }, 404);
      if (/último administrador/i.test(msg)) return json({ error: "Es el último administrador activo de Pilo: nombre a otro antes de quitarlo.", code: "ultimo_admin" }, 409);
      return json({ error: "No pude quitar a la persona." }, 500);
    }
    const createdBy = (gone.data as { created_by?: string | null } | null)?.created_by ?? null;

    // La cuenta de auth solo se borra si la creó esta función: la fila tiene quién la invitó, la cuenta lleva
    // pilo_staff='true', no tiene perfil de PDI y no es un Usuario de Pilo. En cualquier otro caso se queda.
    let deleteAccount = false;
    if (createdBy) {
      const [account, profile, member] = await Promise.all([
        admin.auth.admin.getUserById(target),
        admin.from("profiles").select("id").eq("id", target).maybeSingle(),
        admin.from("pilo_users").select("id").eq("id", target).maybeSingle(),
      ]);
      deleteAccount =
        !account.error && account.data?.user?.user_metadata?.pilo_staff === "true" && !profile.error && !profile.data && !member.error && !member.data;
    }
    if (deleteAccount) {
      const removed = await admin.auth.admin.deleteUser(target);
      if (removed.error) {
        audit("remove", { target, deleted_account: false, fallo: "deleteUser" });
        return json({ error: "Se quitó del personal, pero no pude borrar su cuenta.", code: "cuenta_pendiente" }, 502);
      }
    }
    audit("remove", { target, deleted_account: deleteAccount });
    return json({ ok: true, deleted_account: deleteAccount });
  } catch (error) {
    return json({ error: "Algo falló al atender el pedido.", detail: String((error as Error)?.message ?? error).slice(0, 200) }, 500);
  }
});
