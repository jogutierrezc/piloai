/* =============================================================================
   Intranet · Mr. Pilo con IA · Usuarios de Pilo (0120), lo que se calcula sin
   pantalla.

   La tabla de las cuentas que solo sirven para Pilo (`pilo_users_admin()`):
   cómo se lee una fila, en qué estado está, cómo se filtra y se busca, y a qué
   perfil y a qué sede se le puede cambiar. El perfil solo cambia a uno que su
   correo admita (la base lo exige con una restricción); la sede, solo si el
   correo no la fija.
   ========================================================================== */

import { campusLabel, emailRule, isCampus, isRol, rolLabel } from "../../pilo-app/account/rules";
import type { Campus, PiloRol } from "../../pilo-app/account/rules";

export interface PiloUserRow {
  id: string;
  username: string;
  full_name: string;
  email: string;
  rol: PiloRol;
  campus: Campus | "";
  status: "activa" | "suspendida";
  /** Confirmó su correo: hasta entonces no puede entrar. */
  confirmed: boolean;
  created_at: string;
  last_seen_at: string | null;
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Una fila de `pilo_users_admin()`; null si no se entiende. */
export function parseUserRow(row: unknown): PiloUserRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (!str(r.id) || !str(r.username) || !isRol(r.rol)) return null;
  return {
    id: str(r.id),
    username: str(r.username),
    full_name: str(r.full_name),
    email: str(r.email),
    rol: r.rol,
    campus: isCampus(r.campus) ? r.campus : "",
    status: r.status === "suspendida" ? "suspendida" : "activa",
    confirmed: r.confirmed === true,
    created_at: str(r.created_at),
    last_seen_at: str(r.last_seen_at) || null,
  };
}

export type UserState = "activa" | "sin_confirmar" | "suspendida";

/** El estado que se muestra: la suspensión manda; después, si aún no confirma el correo. */
export function userState(row: Pick<PiloUserRow, "status" | "confirmed">): UserState {
  if (row.status === "suspendida") return "suspendida";
  return row.confirmed ? "activa" : "sin_confirmar";
}

export const STATE_LABEL: Record<UserState, { label: string; tone: "ok" | "warn" | "fail" }> = {
  activa: { label: "Activa", tone: "ok" },
  sin_confirmar: { label: "Sin confirmar", tone: "warn" },
  suspendida: { label: "Suspendida", tone: "fail" },
};

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Las cuentas de un perfil (o todas) que contienen lo buscado en el usuario, el nombre, el correo o la sede. */
export function filterUsers(rows: PiloUserRow[], rol: PiloRol | "", query: string): PiloUserRow[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return rows.filter((r) => {
    if (rol && r.rol !== rol) return false;
    if (!words.length) return true;
    const hay = fold(`${r.username} ${r.full_name} ${r.email} ${campusLabel(r.campus)} ${rolLabel(r.rol)}`);
    return words.every((w) => hay.includes(w));
  });
}

/** Los perfiles a los que se puede cambiar esta cuenta: los que su correo admite. */
export const rolesFor = (email: string): PiloRol[] => emailRule(email)?.roles ?? [];

/** ¿Se le puede cambiar la sede? Solo si su correo no la fija. */
export const campusEditable = (email: string): boolean => !emailRule(email)?.campus;

/** Cuántas hay de cada perfil, para los filtros. */
export function countByRol(rows: PiloUserRow[]): Record<PiloRol, number> {
  const out: Record<PiloRol, number> = { estudiante: 0, profesor: 0, administrativo: 0 };
  for (const r of rows) out[r.rol] += 1;
  return out;
}

/** Para eliminar hay que escribir el usuario tal cual: así no se elimina por un clic de más. */
export const deleteConfirmed = (typed: string, username: string): boolean => typed.trim().toLowerCase() === username.toLowerCase() && username.length > 0;
