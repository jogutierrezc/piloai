/* =============================================================================
   Intranet · Mr. Pilo con IA · Usuarios de Pilo (0120).

   La tabla de las cuentas que solo sirven para Pilo: estudiantes, profesores y
   administrativos que se registraron con su correo de la UDES. Es una tabla
   aparte de los usuarios de la intranet: estas cuentas no abren ningún módulo.
   Solo la administración la ve.

   Aquí se suspende o se reactiva una cuenta, se le cambia el perfil (solo a
   uno que su correo admita) y la sede (solo si su correo no la fija), y se
   elimina. Cada cambio se aplica al momento. Eliminar pide escribir el usuario
   en la misma fila: no abre ventanas. Sin la migración 0120 la sección lo dice
   y queda apagada.
   ========================================================================== */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { CAMPUSES, ROLES, campusLabel, rolLabel } from "../../pilo-app/account/rules";
import type { Campus, PiloRol } from "../../pilo-app/account/rules";
import { deletePiloUser } from "../../pilo-app/account/api";
import { Group, StatusMark, plural, when } from "./ui";
import { STATE_LABEL, campusEditable, countByRol, deleteConfirmed, filterUsers, parseUserRow, rolesFor, userState } from "./users";
import type { PiloUserRow } from "./users";

const KEY = ["pilo-ia", "usuarios-pilo"];

const FILTERS: { id: PiloRol | ""; label: string }[] = [
  { id: "", label: "Todos" },
  { id: "estudiante", label: "Estudiantes" },
  { id: "profesor", label: "Profesores" },
  { id: "administrativo", label: "Administrativos" },
];

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];

/** «28 sept 2026»: corta, para que la tabla quepa. */
const day = (iso: string | null) => {
  const d = iso ? new Date(iso) : null;
  return d && Number.isFinite(d.getTime()) ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : "—";
};

function usePiloUsers() {
  return useQuery({
    queryKey: KEY,
    retry: false,
    queryFn: async (): Promise<PiloUserRow[] | null> => {
      const { data, error } = await supabase.rpc("pilo_users_admin");
      // Sin la migración 0120 la función no existe.
      if (error) return null;
      return ((data ?? []) as unknown[]).map(parseUserRow).filter((r): r is PiloUserRow => r !== null);
    },
  });
}

type Patch = Partial<{ status: "activa" | "suspendida"; rol: PiloRol; campus: Campus }>;

export function UsersSection() {
  const client = useQueryClient();
  const users = usePiloUsers();
  const [rol, setRol] = useState<PiloRol | "">("");
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const change = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Patch }) => {
      const { error } = await supabase.from("pilo_users").update(patch).eq("id", id);
      if (error) throw new Error(/pilo_users_email/.test(error.message) ? "Ese perfil no corresponde al correo de la cuenta." : error.message);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: KEY }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePiloUser(id),
    onSuccess: () => {
      setRemoving(null);
      setTyped("");
    },
    onSettled: () => void client.invalidateQueries({ queryKey: KEY }),
  });

  const missing = users.data === null;
  const all = useMemo(() => users.data ?? [], [users.data]);
  const shown = useMemo(() => filterUsers(all, rol, query), [all, rol, query]);
  const counts = useMemo(() => countByRol(all), [all]);
  const busy = change.isPending || remove.isPending;

  return (
    <Group
      title="Cuentas registradas"
      aside={
        <small role="status">
          {missing ? (
            <StatusMark tone="warn">Falta la migración 0120</StatusMark>
          ) : users.isPending ? (
            "Cargando…"
          ) : busy ? (
            "Guardando…"
          ) : (
            `${shown.length.toLocaleString("es-CO")} de ${plural(all.length, "cuenta", "cuentas")}`
          )}
        </small>
      }
    >
      <p className="pis-lead">
        Una tabla aparte de los usuarios de la intranet: estas cuentas solo sirven para Pilo y no dan acceso a ningún módulo. Se crean solas, desde la app, con un correo de la
        UDES; el perfil y la sede salen del dominio del correo. Lo que cada persona guarda de Pilo solo lo ve ella.
      </p>
      {missing && <p className="pis-warn">Falta aplicar la migración 0120 en la base: hasta entonces no hay cuentas de Pilo y nadie puede registrarse.</p>}

      <div className="pis-users__bar">
        <div className="pis-seg" role="radiogroup" aria-label="Filtrar por perfil">
          {FILTERS.map((f) => (
            <button key={f.id || "todos"} type="button" role="radio" aria-checked={rol === f.id} disabled={missing} onClick={() => setRol(f.id)}>
              {f.label}
              <span className="pis-seg__n">{f.id ? counts[f.id] : all.length}</span>
            </button>
          ))}
        </div>
        <label className="pis-users__search">
          <span className="sr-only">Buscar por usuario, nombre, correo o sede</span>
          <input type="search" value={query} disabled={missing} placeholder="Buscar por usuario, nombre, correo o sede" onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>

      {!missing && !users.isPending && all.length === 0 && <p className="pis-small">Todavía no hay cuentas de Pilo. Aparecen aquí cuando alguien se registra desde la app.</p>}
      {!missing && all.length > 0 && shown.length === 0 && <p className="pis-small">Ninguna cuenta coincide con el filtro y la búsqueda.</p>}

      {shown.length > 0 && (
        <div className="pis-table-frame">
          <table className="pis-table pis-users">
            <caption className="sr-only">Usuarios de Pilo: perfil, sede, estado y último uso</caption>
            <thead>
              <tr>
                <th scope="col">Usuario</th>
                <th scope="col">Correo</th>
                <th scope="col">Perfil</th>
                <th scope="col">Sede</th>
                <th scope="col">Estado</th>
                <th scope="col">Creada</th>
                <th scope="col">Último uso</th>
                <th scope="col">
                  <span className="sr-only">Acciones</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((u) => {
                const state = STATE_LABEL[userState(u)];
                const roles = rolesFor(u.email);
                const suspended = u.status === "suspendida";
                return removing === u.id ? (
                  <tr key={u.id} className="pis-users__confirm">
                    <th scope="row">
                      <strong>{u.username}</strong>
                      <small>{u.full_name}</small>
                    </th>
                    <td colSpan={7}>
                      <form
                        role="alert"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (deleteConfirmed(typed, u.username)) remove.mutate(u.id);
                        }}
                      >
                        <label htmlFor={`pis-del-${u.id}`}>
                          Se elimina la cuenta de «{u.username}» y todo lo que guardó de Pilo. No se puede deshacer. Para confirmar, escriba su usuario:
                        </label>
                        <input id={`pis-del-${u.id}`} value={typed} autoComplete="off" spellCheck={false} autoFocus onChange={(e) => setTyped(e.target.value)} />
                        <button
                          type="button"
                          className="button-secondary"
                          onClick={() => {
                            setRemoving(null);
                            setTyped("");
                          }}
                        >
                          No, dejarla
                        </button>
                        <button type="submit" className="button-primary pis-danger" disabled={!deleteConfirmed(typed, u.username) || remove.isPending}>
                          {remove.isPending ? "Eliminando…" : "Eliminar la cuenta"}
                        </button>
                      </form>
                    </td>
                  </tr>
                ) : (
                  <tr key={u.id}>
                    <th scope="row">
                      <strong>{u.username}</strong>
                      <small>{u.full_name}</small>
                    </th>
                    <td className="pis-users__mail">{u.email}</td>
                    <td>
                      {roles.length > 1 ? (
                        <select value={u.rol} disabled={busy} aria-label={`Perfil de ${u.username}`} onChange={(e) => change.mutate({ id: u.id, patch: { rol: e.target.value as PiloRol } })}>
                          {roles.map((r) => (
                            <option key={r} value={r}>
                              {ROLES[r].label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        rolLabel(u.rol)
                      )}
                    </td>
                    <td>
                      {campusEditable(u.email) ? (
                        <select value={u.campus} disabled={busy} aria-label={`Sede de ${u.username}`} onChange={(e) => e.target.value && change.mutate({ id: u.id, patch: { campus: e.target.value as Campus } })}>
                          {!u.campus && <option value="">Sin sede</option>}
                          {CAMPUSES.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span title="La fija el correo">{campusLabel(u.campus) || "—"}</span>
                      )}
                    </td>
                    <td>
                      <StatusMark tone={state.tone}>{state.label}</StatusMark>
                    </td>
                    <td>{day(u.created_at)}</td>
                    <td>{u.last_seen_at ? when(u.last_seen_at) : "Nunca"}</td>
                    <td className="pis-users__acts">
                      <button type="button" className="pis-link" disabled={busy} onClick={() => change.mutate({ id: u.id, patch: { status: suspended ? "activa" : "suspendida" } })}>
                        {suspended ? "Reactivar" : "Suspender"}
                      </button>
                      <button
                        type="button"
                        className="pis-link pis-link--danger"
                        disabled={busy}
                        onClick={() => {
                          setTyped("");
                          remove.reset();
                          setRemoving(u.id);
                        }}
                      >
                        Eliminar
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="pis-small">
        Una cuenta suspendida no puede entrar ni guardar; su dueño sigue pudiendo usar a Pilo sin cuenta. «Sin confirmar» es quien aún no abre el enlace que recibió en su correo. El
        perfil solo cambia a uno que el correo admita: @mail.udes.edu.co es de estudiantes y profesores; los demás, de administrativos y profesores.
      </p>
      {change.isError && (
        <p className="pis-error" role="alert">
          No se guardó: {(change.error as Error).message}
        </p>
      )}
      {remove.isError && (
        <p className="pis-error" role="alert">
          No se eliminó: {(remove.error as Error).message}
        </p>
      )}
    </Group>
  );
}
