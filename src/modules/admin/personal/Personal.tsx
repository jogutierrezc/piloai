/* =============================================================================
   Personal de Pilo (/admin/personal · solo administración).

   Quién administra Pilo y con qué rol: altas, cambio de rol, activar o
   desactivar y quitar. El personal vive en `pilo_staff` (migración pilo_0146),
   aparte de los perfiles de PDI. La autorización real está en la base y en la
   función `pilo-staff`; esta pantalla solo la usa y la explica.

   De arriba abajo: nota sobre los administradores de PDI, resumen de roles
   (cada tarjeta filtra), cuadro «qué abre cada rol», formulario «Invitar»
   (panel, sin ventana), y la lista con buscador y filtros.

   Sin la migración la pantalla lo dice («Falta aplicar la migración
   pilo_0146») y queda inerte, como Usuarios de Pilo con la 0120. Los cambios de
   rol y de estado se aplican al momento (con marcha atrás si la base los
   rechaza); lo que quita acceso pide confirmar en la propia fila.

   Movimiento (presets de ../motion): entrada en cascada de las secciones y
   despliegue del panel de invitar. Filtrar y buscar no se animan. Con menos
   movimiento, solo fundidos.
   ========================================================================== */

import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../../components/ui/Icon";
import { useAuth } from "../../../lib/auth";
import { staffRoleLabels } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { AdminShell } from "../components/AdminShell";
import { useEnterCascade } from "../motion/presets";
import { InvitePanel } from "./InvitePanel";
import { RoleOverview } from "./RoleOverview";
import { StaffTable } from "./StaffTable";
import { STAFF_KEY, StaffError, listStaff, removeStaff, setStaff } from "./personal-api";
import { STATE_FILTERS, countByRole, filterStaff, peopleLabel } from "./personal-logic";
import type { StateFilter, StaffPerson } from "./personal-logic";
import "./personal.css";

export function Personal() {
  const { session } = useAuth();
  const me = session?.user.id;
  const client = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);
  useEnterCascade(rootRef, "[data-cascade]", []);

  const list = useQuery({ queryKey: STAFF_KEY, queryFn: listStaff, retry: false });
  const missing = list.error instanceof StaffError && list.error.code === "migracion";
  const failed = list.isError && !missing;
  const all = useMemo(() => list.data ?? [], [list.data]);

  const [role, setRole] = useState<PiloStaffRole | "">("");
  const [state, setState] = useState<StateFilter>("todos");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const shown = useMemo(() => filterStaff(all, role, state, query), [all, role, state, query]);
  const counts = useMemo(() => countByRole(all), [all]);
  const filtering = role !== "" || state !== "todos" || query.trim() !== "";
  const clearFilters = () => {
    setRole("");
    setState("todos");
    setQuery("");
  };

  const refresh = () => void client.invalidateQueries({ queryKey: STAFF_KEY });

  // Cambio de rol o de estado: se ve al instante y se deshace si la base lo rechaza.
  const change = useMutation({
    mutationFn: ({ person, patch }: { person: StaffPerson; patch: { role?: PiloStaffRole; active?: boolean } }) => setStaff(person.user_id, patch),
    onMutate: async ({ person, patch }) => {
      await client.cancelQueries({ queryKey: STAFF_KEY });
      const before = client.getQueryData<StaffPerson[]>(STAFF_KEY);
      client.setQueryData<StaffPerson[]>(STAFF_KEY, (rows) => rows?.map((r) => (r.user_id === person.user_id ? { ...r, ...patch } : r)));
      return { before };
    },
    onError: (_error, _vars, ctx) => {
      if (ctx?.before) client.setQueryData(STAFF_KEY, ctx.before);
    },
    onSuccess: (_data, { person, patch }) => {
      const name = person.full_name || person.email;
      setNotice(patch.role ? `Rol de ${name}: ${staffRoleLabels[patch.role]}.` : patch.active ? `${name} quedó activo.` : `${name} quedó inactivo y ya no puede entrar.`);
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (person: StaffPerson) => removeStaff(person.user_id),
    onSuccess: (result, person) => {
      const name = person.full_name || person.email;
      setNotice(result.deletedAccount ? `${name} salió del personal y su cuenta se eliminó.` : `${name} salió del personal de Pilo; su cuenta de PDI sigue igual.`);
    },
    onSettled: refresh,
  });

  const busy = change.isPending || remove.isPending;
  const status = missing ? "Falta aplicar la migración pilo_0146" : list.isPending ? "Cargando…" : failed ? "No se pudo leer" : busy ? "Guardando…" : `${shown.length.toLocaleString("es-CO")} de ${peopleLabel(all.length)}`;

  return (
    <AdminShell
      section="personal"
      kicker="Administración"
      title="Personal de Pilo"
      description="Quién administra Pilo y qué puede abrir cada persona."
      actions={
        <button type="button" className="ps-btn ps-btn--primary" disabled={missing || list.isPending} aria-expanded={inviteOpen} onClick={() => setInviteOpen((v) => !v)}>
          <Icon name="plus" size={16} />
          Invitar
        </button>
      }
    >
      <div ref={rootRef} className="ps">
        <p className="ps-aside" data-cascade>
          <Icon name="shield" size={18} />
          <span>
            Quienes son administradores en PDI entran a Pilo como administradores aunque no aparezcan en esta lista. Esta lista
            solo muestra al personal registrado en Pilo; a quien es administrador de PDI se le cambia el acceso desde PDI.
          </span>
        </p>

        {missing && (
          <div className="ps-note ps-note--warn" role="alert">
            <Icon name="alert" size={18} />
            <p>
              <strong>Falta aplicar la migración pilo_0146.</strong> Hasta que se aplique en la base no hay personal de Pilo que mostrar ni se puede invitar a nadie. Pida al equipo técnico
              que la aplique y vuelva a cargar esta pantalla.
            </p>
          </div>
        )}

        <RoleOverview counts={counts} picked={role} onPick={setRole} loading={list.isPending} inert={missing || failed} />

        <InvitePanel
          open={inviteOpen && !missing}
          onClose={() => setInviteOpen(false)}
          onChanged={(message) => {
            setNotice(message);
            refresh();
          }}
        />

        <section className="ps-section" aria-labelledby="ps-list-h" data-cascade>
          <header className="ps-section__head">
            <h2 id="ps-list-h">Personas</h2>
            <small role="status" className="ps-count">
              {status}
            </small>
          </header>

          <div className="ps-bar">
            <div className="ps-seg" role="radiogroup" aria-label="Filtrar por estado">
              {STATE_FILTERS.map((f) => (
                <button key={f.id} type="button" role="radio" aria-checked={state === f.id} disabled={missing || failed} onClick={() => setState(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
            <label className="ps-search">
              <span className="sr-only">Buscar por nombre, correo o rol</span>
              <Icon name="search" size={16} />
              <input type="search" value={query} disabled={missing || failed} placeholder="Buscar por nombre, correo o rol" onChange={(e) => setQuery(e.target.value)} />
            </label>
            {role && (
              <button type="button" className="ps-chip" onClick={() => setRole("")}>
                Rol: {staffRoleLabels[role]}
                <Icon name="close" size={14} />
                <span className="sr-only">Quitar el filtro de rol</span>
              </button>
            )}
          </div>

          <p className="sr-only" role="status" aria-live="polite">
            {notice}
          </p>
          {notice && (
            <p className="ps-notice" aria-hidden="true">
              <Icon name="check" size={14} />
              {notice}
            </p>
          )}

          {list.isPending && (
            <div className="ps-skeleton" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <span key={i} className="ps-skel ps-skel--row" />
              ))}
            </div>
          )}

          {failed && (
            <div className="ps-empty" role="alert">
              <Icon name="alert" size={22} />
              <p>
                <strong>No se pudo leer el personal.</strong> {(list.error as Error).message}
              </p>
              <button type="button" className="ps-btn" onClick={() => void list.refetch()} disabled={list.isFetching}>
                {list.isFetching ? "Leyendo…" : "Reintentar"}
              </button>
            </div>
          )}

          {!missing && !failed && !list.isPending && all.length === 0 && (
            <div className="ps-empty">
              <Icon name="community" size={22} />
              <p>
                <strong>Todavía no hay personal registrado en Pilo.</strong> Invite a la primera persona con su correo y su rol; recibirá un correo para definir su contraseña.
              </p>
              <button type="button" className="ps-btn ps-btn--primary" onClick={() => setInviteOpen(true)}>
                <Icon name="plus" size={16} />
                Invitar a alguien
              </button>
            </div>
          )}

          {!missing && !failed && all.length > 0 && shown.length === 0 && (
            <div className="ps-empty">
              <Icon name="search" size={22} />
              <p>
                <strong>Nadie coincide</strong> con los filtros y la búsqueda.
              </p>
              {filtering && (
                <button type="button" className="ps-btn" onClick={clearFilters}>
                  Quitar los filtros
                </button>
              )}
            </div>
          )}

          {shown.length > 0 && (
            <StaffTable
              rows={shown}
              all={all}
              me={me}
              busy={busy}
              removing={remove.isPending}
              onRole={(person, next) => {
                remove.reset();
                change.mutate({ person, patch: { role: next } });
              }}
              onActive={(person, active) => {
                remove.reset();
                change.mutate({ person, patch: { active } });
              }}
              onRemove={async (person) => {
                change.reset();
                try {
                  await remove.mutateAsync(person);
                  return true;
                } catch {
                  return false;
                }
              }}
            />
          )}

          {change.isError && (
            <p className="ps-error" role="alert">
              <Icon name="alert" size={16} />
              No se guardó: {(change.error as Error).message}
            </p>
          )}
          {remove.isError && (
            <p className="ps-error" role="alert">
              <Icon name="alert" size={16} />
              No se quitó: {(remove.error as Error).message}
            </p>
          )}

          <p className="ps-small">
            Una persona inactiva conserva su cuenta pero no puede entrar a la administración; se reactiva cuando quiera. «Sin confirmar» es quien aún no abre el enlace que recibió para
            definir su contraseña. Quitar a alguien es definitivo.
          </p>
        </section>
      </div>
    </AdminShell>
  );
}
