/* =============================================================================
   Personal de Pilo · llamadas a la base y a la función `pilo-staff`.

   - Lista y cambios: las funciones `pilo_staff_list` y `pilo_staff_set` (solo
     administración; las valida la base).
   - Invitar y quitar: la Edge Function `pilo-staff` (crear la cuenta y mandar
     el enlace exigen la clave de servicio). Sus errores traen `code`, que aquí
     se lee del cuerpo de la respuesta (readFunctionError solo devuelve el
     texto, y la pantalla necesita el código para ofrecer «Dar rol»).
   - Dar rol a una cuenta que ya existe (la de PDI): inserta en `pilo_staff`
     con la política RLS de administración.

   Todo fallo sale como `StaffError` con su código y una frase en español.
   ========================================================================== */

import { supabase, readFunctionError } from "../../../lib/supabase";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { escapeLike, isStaffErrorCode, sameEmail, normalizeEmail, normalizeName, parseStaffRow, rpcErrorText, staffErrorText } from "./personal-logic";
import type { StaffErrorCode, StaffPerson } from "./personal-logic";

export class StaffError extends Error {
  code: StaffErrorCode | "otro";
  constructor(code: StaffErrorCode | "otro", message: string) {
    super(message);
    this.name = "StaffError";
    this.code = code;
  }
}

export const STAFF_KEY = ["pilo-staff", "personal"] as const;

/** Todo el personal. Si falta la migración lanza StaffError con código «migracion». */
export async function listStaff(): Promise<StaffPerson[]> {
  const { data, error } = await supabase.rpc("pilo_staff_list");
  if (error) {
    const { code, text } = rpcErrorText(error);
    throw new StaffError(code, text);
  }
  return ((data ?? []) as unknown[]).map(parseStaffRow).filter((r): r is StaffPerson => r !== null);
}

/** Cambia el rol y/o el estado de una persona. */
export async function setStaff(userId: string, patch: { role?: PiloStaffRole; active?: boolean }): Promise<void> {
  const { error } = await supabase.rpc("pilo_staff_set", { p_user: userId, p_role: patch.role ?? null, p_active: patch.active ?? null });
  if (error) {
    const { code, text } = rpcErrorText(error);
    throw new StaffError(code, text);
  }
}

/** Lee `{ error, code }` del cuerpo de una respuesta de la función, o cae al texto que dé readFunctionError. */
async function functionError(error: unknown): Promise<StaffError> {
  const response = (error as { context?: Response })?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = (await response.clone().json()) as { error?: string; code?: string };
      return new StaffError(isStaffErrorCode(body.code) ? body.code : "otro", staffErrorText(body.code, body.error));
    } catch {
      /* El cuerpo no era JSON: se intenta con el lector común. */
    }
  }
  const detail = await readFunctionError(error);
  return new StaffError("otro", detail ?? "No se pudo comunicar con el servidor. Revise la conexión e intente de nuevo.");
}

export interface InviteResult {
  user_id: string;
  /** El correo con el enlace salió. Si no, `link` es el enlace para entregarlo a mano. */
  sent: boolean;
  link?: string;
  /** Pasó algo menos grave que un fallo (p. ej. no hubo ni correo ni enlace). */
  note?: StaffErrorCode;
}

export async function inviteStaff(input: { email: string; name: string; role: PiloStaffRole }): Promise<InviteResult> {
  const { data, error } = await supabase.functions.invoke("pilo-staff", {
    body: { action: "invite", email: normalizeEmail(input.email), full_name: normalizeName(input.name), role: input.role },
  });
  if (error) throw await functionError(error);
  const body = (data ?? {}) as { ok?: boolean; user_id?: string; sent?: boolean; link?: string; code?: string };
  if (!body.ok || !body.user_id) throw new StaffError("otro", staffErrorText(undefined));
  return { user_id: body.user_id, sent: body.sent === true, link: body.link, note: body.code === "sin_enlace" ? "sin_enlace" : undefined };
}

export async function removeStaff(userId: string): Promise<{ deletedAccount: boolean }> {
  const { data, error } = await supabase.functions.invoke("pilo-staff", { body: { action: "remove", user_id: userId } });
  if (error) throw await functionError(error);
  const body = (data ?? {}) as { ok?: boolean; deleted_account?: boolean };
  if (!body.ok) throw new StaffError("otro", staffErrorText(undefined));
  return { deletedAccount: body.deleted_account === true };
}

/**
 * Da rol de Pilo a una cuenta que ya existe (la de PDI): busca su perfil por
 * correo y la inserta en `pilo_staff`. Como administración puede escribir en esa
 * tabla; si no hay perfil con ese correo o la base lo rechaza, lo dice claro.
 */
export async function grantExistingAccount(input: { email: string; name: string; role: PiloStaffRole }): Promise<void> {
  const email = normalizeEmail(input.email);
  // ilike sin comodines (escapados) = igualdad sin distinguir mayúsculas; después se
  // verifica a mano que el perfil sea exactamente el correo escrito.
  const found = await supabase.from("profiles").select("id,email,full_name").ilike("email", escapeLike(email)).limit(5);
  if (found.error) {
    throw new StaffError("otro", "No pude buscar esa cuenta en los perfiles de PDI. Pídale al equipo técnico que le dé el rol desde la base.");
  }
  const profile = ((found.data ?? []) as { id: string; email: string | null; full_name: string | null }[]).find((p) => sameEmail(p.email, email));
  if (!profile) {
    throw new StaffError(
      "otro",
      "Esa cuenta no tiene un perfil de PDI que pueda enlazar desde aquí (la cuenta puede ser de otro tipo). Use otro correo o pídale al equipo técnico que la enlace.",
    );
  }
  const { error } = await supabase.from("pilo_staff").insert({
    user_id: profile.id,
    email: normalizeEmail(profile.email ?? ""),
    full_name: normalizeName(input.name) || profile.full_name || "",
    role: input.role,
    active: true,
  });
  if (error) {
    if (error.code === "23505") throw new StaffError("existe", staffErrorText("existe"));
    if (error.code === "42501") throw new StaffError("permiso", "La base no dejó dar el rol desde aquí. Pídale al equipo técnico que lo haga.");
    const { code, text } = rpcErrorText(error);
    throw new StaffError(code, text);
  }
}
