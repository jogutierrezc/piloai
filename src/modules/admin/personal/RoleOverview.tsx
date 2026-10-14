/* =============================================================================
   Personal de Pilo · resumen de roles.

   Una tarjeta por rol con cuántas personas hay (y cuántas pueden entrar hoy);
   cada tarjeta filtra la lista al pulsarla. Debajo, el cuadro «Qué abre cada
   rol»: espacios y zonas salen del contrato (pilo-staff.ts), no de texto
   escrito aquí. Un sí es un ícono con la palabra «Sí» (para lectores de
   pantalla) y un no, un guion con «No»: nunca solo color.
   ========================================================================== */

import { useMemo } from "react";
import { Icon } from "../../../components/ui/Icon";
import { STAFF_ROLES, staffRoleDescriptions, staffRoleLabels } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { accessRows, spaceNamesFor } from "./personal-logic";
import type { RoleCount } from "./personal-logic";

interface Props {
  counts: Record<PiloStaffRole, RoleCount>;
  /** El rol por el que se está filtrando, o "" si ninguno. */
  picked: PiloStaffRole | "";
  onPick: (role: PiloStaffRole | "") => void;
  loading: boolean;
  /** Sin datos (migración sin aplicar): las tarjetas quedan apagadas. */
  inert: boolean;
}

export function RoleOverview({ counts, picked, onPick, loading, inert }: Props) {
  const rows = useMemo(accessRows, []);

  return (
    <>
      <section className="ps-section" aria-labelledby="ps-roles-h" data-cascade>
        <header className="ps-section__head">
          <h2 id="ps-roles-h">Roles</h2>
          <p>Pulse un rol para ver solo a esas personas.</p>
        </header>
        <ul className="ps-roles">
          {STAFF_ROLES.map((role) => {
            const c = counts[role];
            const on = picked === role;
            const spaces = spaceNamesFor(role);
            return (
              <li key={role}>
                <button
                  type="button"
                  className="ps-role"
                  aria-pressed={on}
                  disabled={inert}
                  onClick={() => onPick(on ? "" : role)}
                  data-role={role}
                >
                  <span className="ps-role__name">
                    {staffRoleLabels[role]}
                    {on && <Icon name="check" size={16} title="Filtro activo" />}
                  </span>
                  <span className="ps-role__count" aria-live="polite">
                    {loading || inert ? <span className="ps-skel ps-skel--num" aria-hidden="true" /> : c.total.toLocaleString("es-CO")}
                    <span className="sr-only">{loading ? "cargando" : ` ${c.total === 1 ? "persona" : "personas"}`}</span>
                  </span>
                  <span className="ps-role__sub">{loading || inert ? " " : c.total === c.active ? (c.total ? "todas activas" : "nadie aún") : `${c.active} activas`}</span>
                  <span className="ps-role__desc">{staffRoleDescriptions[role]}</span>
                  <span className="ps-role__spaces">{spaces.join(" · ")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="ps-section" aria-labelledby="ps-access-h" data-cascade>
        <header className="ps-section__head">
          <h2 id="ps-access-h">Qué abre cada rol</h2>
          <p>Lo que cada rol puede abrir en la administración. Es el mismo contrato que usa el menú.</p>
        </header>
        <div className="ps-frame">
          <table className="ps-access">
            <caption className="sr-only">Espacios y zonas que abre cada rol del personal de Pilo</caption>
            <thead>
              <tr>
                <th scope="col">Zona</th>
                {STAFF_ROLES.map((role) => (
                  <th key={role} scope="col">
                    {staffRoleLabels[role]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} data-kind={row.kind}>
                  <th scope="row">{row.label}</th>
                  {STAFF_ROLES.map((role) => (
                    <td key={role} data-label={staffRoleLabels[role]}>
                      {row.roles[role] ? (
                        <span className="ps-yes">
                          <Icon name="check" size={16} aria-hidden="true" />
                          <span className="sr-only">Sí</span>
                        </span>
                      ) : (
                        <span className="ps-no">
                          <span aria-hidden="true">—</span>
                          <span className="sr-only">No</span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
