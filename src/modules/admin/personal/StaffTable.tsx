/* =============================================================================
   Personal de Pilo · la tabla de personas.

   Una fila por persona: nombre y correo, rol (un select que se aplica al
   momento), estado, desde cuándo y último uso, y las acciones de la fila.
   Nada abre ventanas:
   - Bajar a un administrador (a otro rol) pide confirmar en la misma fila.
   - Quitar pide escribir el correo de la persona en la misma fila.
   - El último administrador activo no se baja, no se desactiva y no se quita:
     la fila lo dice y esas acciones quedan apagadas (la base también lo exige).
   En el móvil (≤ 760 px) cada fila pasa a ser una tarjeta.
   ========================================================================== */

import { useState } from "react";
import { Icon } from "../../../components/ui/Icon";
import { STAFF_ROLES, staffRoleLabels } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { STATE_INFO, dayLabel, isDowngrade, isLastAdmin, lastSeenLabel, removalConfirmed, staffState } from "./personal-logic";
import type { StaffPerson } from "./personal-logic";

interface Props {
  /** Las filas que pasan el filtro. */
  rows: StaffPerson[];
  /** Todo el personal (para saber quién es el último administrador). */
  all: StaffPerson[];
  /** Id de quien está en sesión. */
  me: string | undefined;
  /** Hay un cambio en marcha: las acciones esperan. */
  busy: boolean;
  removing: boolean;
  onRole: (person: StaffPerson, role: PiloStaffRole) => void;
  onActive: (person: StaffPerson, active: boolean) => void;
  /** Devuelve true si se quitó (para cerrar la confirmación). */
  onRemove: (person: StaffPerson) => Promise<boolean>;
}

export function StaffTable({ rows, all, me, busy, removing, onRole, onActive, onRemove }: Props) {
  const [downgrade, setDowngrade] = useState<{ id: string; to: PiloStaffRole } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const closeRemove = () => {
    setRemoveId(null);
    setTyped("");
  };

  return (
    <div className="ps-frame">
      <table className="ps-table">
        <caption className="sr-only">Personal de Pilo: rol, estado y último uso</caption>
        <thead>
          <tr>
            <th scope="col">Persona</th>
            <th scope="col">Rol</th>
            <th scope="col">Estado</th>
            <th scope="col">Desde</th>
            <th scope="col">Último uso</th>
            <th scope="col">
              <span className="sr-only">Acciones</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const state = STATE_INFO[staffState(p)];
            const isMe = p.user_id === me;
            const last = isLastAdmin(all, p.user_id);
            const name = p.full_name || p.email;
            const nameCell = (
              <th scope="row" className="ps-who">
                <strong>
                  {name}
                  {isMe && <span className="ps-tag">Usted</span>}
                </strong>
                {p.full_name && <small className="ps-who__mail">{p.email}</small>}
              </th>
            );

            if (downgrade?.id === p.user_id) {
              return (
                <tr key={p.user_id} className="ps-row--confirm">
                  {nameCell}
                  <td colSpan={5}>
                    <div role="alert" className="ps-confirm">
                      <p>
                        {isMe ? "Es usted. " : ""}
                        {name} pasará de <strong>{staffRoleLabels[p.role]}</strong> a <strong>{staffRoleLabels[downgrade.to]}</strong> y perderá la conexión, la voz, los usuarios y el personal
                        {isMe ? ": dejará de ver esta pantalla" : ""}.
                      </p>
                      <div className="ps-confirm__actions">
                        <button type="button" className="ps-btn" autoFocus onClick={() => setDowngrade(null)}>
                          No, dejarlo como está
                        </button>
                        <button
                          type="button"
                          className="ps-btn ps-btn--danger"
                          onClick={() => {
                            onRole(p, downgrade.to);
                            setDowngrade(null);
                          }}
                        >
                          Sí, cambiar el rol
                        </button>
                      </div>
                    </div>
                  </td>
                </tr>
              );
            }

            if (removeId === p.user_id) {
              const ok = removalConfirmed(typed, p.email);
              return (
                <tr key={p.user_id} className="ps-row--confirm">
                  {nameCell}
                  <td colSpan={5}>
                    <form
                      className="ps-confirm"
                      role="alert"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (ok) void onRemove(p).then((done) => done && closeRemove());
                      }}
                    >
                      <label htmlFor={`ps-del-${p.user_id}`}>
                        Se quita a {name} del personal de Pilo y deja de poder entrar a la administración. Si solo tenía cuenta de Pilo, la cuenta se elimina; si también usa PDI, esa cuenta se queda.
                        No se puede deshacer. Para confirmar, escriba su correo:
                      </label>
                      <input id={`ps-del-${p.user_id}`} value={typed} autoComplete="off" spellCheck={false} autoFocus placeholder={p.email} onChange={(e) => setTyped(e.target.value)} />
                      <div className="ps-confirm__actions">
                        <button type="button" className="ps-btn" onClick={closeRemove}>
                          No, dejarlo
                        </button>
                        <button type="submit" className="ps-btn ps-btn--danger" disabled={!ok || removing}>
                          {removing ? "Quitando…" : "Quitar del personal"}
                        </button>
                      </div>
                    </form>
                  </td>
                </tr>
              );
            }

            return (
              <tr key={p.user_id} data-state={staffState(p)} data-mine={isMe || undefined}>
                {nameCell}
                <td data-label="Rol">
                  <select
                    className="ps-select"
                    value={p.role}
                    disabled={busy || last}
                    aria-label={`Rol de ${name}`}
                    title={last ? "Es el último administrador activo: nombre a otro antes de cambiarle el rol." : undefined}
                    onChange={(e) => {
                      const to = e.target.value as PiloStaffRole;
                      if (to === p.role) return;
                      if (isDowngrade(p.role, to)) setDowngrade({ id: p.user_id, to });
                      else onRole(p, to);
                    }}
                  >
                    {STAFF_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {staffRoleLabels[r]}
                      </option>
                    ))}
                  </select>
                  {last && <small className="ps-last">Último administrador activo</small>}
                </td>
                <td data-label="Estado">
                  <span className="ps-state" data-tone={state.tone}>
                    <Icon name={state.icon} size={14} />
                    {state.label}
                  </span>
                </td>
                <td data-label="Desde">{dayLabel(p.created_at)}</td>
                <td data-label="Último uso">{lastSeenLabel(p.last_seen_at)}</td>
                <td className="ps-acts">
                  <button
                    type="button"
                    className="ps-link"
                    disabled={busy || last}
                    title={last ? "Es el último administrador activo." : undefined}
                    onClick={() => onActive(p, !p.active)}
                  >
                    {p.active ? "Desactivar" : "Reactivar"}
                    <span className="sr-only"> a {name}</span>
                  </button>
                  <button
                    type="button"
                    className="ps-link ps-link--danger"
                    disabled={busy || last || isMe}
                    title={isMe ? "No puede quitarse del personal desde su propia sesión." : last ? "Es el último administrador activo." : undefined}
                    onClick={() => {
                      setTyped("");
                      setDowngrade(null);
                      setRemoveId(p.user_id);
                    }}
                  >
                    Quitar
                    <span className="sr-only"> a {name}</span>
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
