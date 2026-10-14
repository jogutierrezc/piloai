/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria › Génesis («Mis notas» de la app, 0131).

   En la app, un estudiante con cuenta de Pilo conecta Génesis con su propio
   código y contraseña y ve su histórico de notas (función pilo-genesis).
   Génesis no es un solo portal: hay uno por sede. Aquí la administración
   escribe esos portales (pilo_spaces.genesis_portals: el nombre que ve el
   estudiante y la dirección de entrada de cada uno) y decide si Mis notas
   está encendida (pilo_spaces.genesis_on). Nace apagada y sin portales.

   Aparte, y también apagado de partida, el interruptor «Recomendaciones con
   IA en Mis notas» (pilo_spaces.genesis_advice): deja que el estudiante le
   pida a Pilo recomendaciones sobre sus notas (función pilo-ia, acción
   «evolucion»). Solo entonces sale algo de las notas hacia la IA: un resumen
   sin nombre ni código, que no se guarda.

   Cada portal tiene un id corto que se le pone al guardarlo por primera vez y
   no cambia después, aunque cambie el nombre: es lo único que manda la app, y
   va dentro del permiso de cada estudiante. Cambiar la dirección de un portal
   o quitarlo deja sin efecto los permisos de quienes entraron por él: tendrán
   que entrar de nuevo.

   No hay token ni secreto que guardar: cada estudiante entra con lo suyo, y
   nada de Génesis entra a la memoria de Pilo. Este panel no llama a Génesis ni
   a la función: solo guarda la lista, revisada con la misma regla de la
   función (checkPortalRows → genesisSite: https, dominio público, sin ruta;
   puede llevar puerto). Los errores se dicen en la fila que los tiene.

   Sin la migración 0131 el panel lo dice y se apaga.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../../lib/supabase";
import { checkPortalRows } from "../../../pilo-app/notas/logic";
import { MAX_PORTALS } from "../../../pilo-app/notas/servidor-logica";
import { Group, StatusMark, Switch, plural } from "../../pilo/ui";
import { Skeleton } from "../ui";
import type { MemoryPartProps } from "./DocumentsPanel";
import { faultOf, missingMigration } from "./flow";
import type { Fault } from "./flow";
import { FaultNote, MissingNote } from "./parts";

/** La migración que le da dónde guardarse. */
const MIGRATION = "0131";

interface Saved {
  id: string;
  name: string;
  url: string;
}

interface GenesisSetup {
  /** Falta la migración: no hay dónde guardar. */
  missing: boolean;
  on: boolean;
  /** Las recomendaciones con IA de «Mi evolución». */
  advice: boolean;
  portals: Saved[];
}

/** Una fila mientras se escribe: `key` solo la distingue en pantalla; `id` vacío = portal nuevo. */
interface Row extends Saved {
  key: number;
}

const text = (v: unknown): string => (typeof v === "string" ? v : "");

async function fetchGenesis(space: string): Promise<GenesisSetup> {
  const row = await supabase.from("pilo_spaces").select("genesis_on, genesis_portals, genesis_advice").eq("id", space).maybeSingle();
  if (row.error) {
    if (missingMigration(row.error) || /genesis_/i.test(row.error.message ?? "")) return { missing: true, on: false, advice: false, portals: [] };
    throw row.error;
  }
  const r = (row.data ?? {}) as Record<string, unknown>;
  const list = Array.isArray(r.genesis_portals) ? (r.genesis_portals as Record<string, unknown>[]) : [];
  return { missing: false, on: r.genesis_on === true, advice: r.genesis_advice === true, portals: list.filter((p) => p && typeof p === "object").map((p) => ({ id: text(p.id), name: text(p.name), url: text(p.url) })) };
}

/** La lista y el interruptor viven en la ficha del espacio; se guardan al momento. */
async function saveGenesis(space: string, patch: { genesis_on?: boolean; genesis_advice?: boolean; genesis_portals?: Saved[] }): Promise<void> {
  const { error } = await supabase.from("pilo_spaces").update({ ...patch, updated_at: new Date().toISOString() } as never).eq("id", space);
  if (error) throw error;
}

const sameList = (rows: Row[], saved: Saved[]) => rows.length === saved.length && rows.every((r, i) => r.id === saved[i].id && r.name.trim() === saved[i].name && r.url.trim() === saved[i].url);

export function GenesisPanel({ space, disabled }: MemoryPartProps) {
  const client = useQueryClient();
  const key = ["pilo-ia", "memoria", "genesis", space] as const;
  const setup = useQuery({ queryKey: key, enabled: !disabled, queryFn: () => fetchGenesis(space) });
  const [rows, setRows] = useState<Row[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<number, { name?: string; url?: string }>>({});
  const [listBad, setListBad] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "lista" | "on" | "ia">(null);
  const [fault, setFault] = useState<{ where: string; fault: Fault } | null>(null);
  const [saved, setSaved] = useState(false);
  const nextKey = useRef(1);

  const data = setup.data;
  // Lo guardado manda: al leerlo (o al guardarlo), las filas vuelven a ser las de la base, en su orden.
  const stamp = data ? JSON.stringify(data.portals) : "";
  useEffect(() => {
    if (!data) return;
    setRows(data.portals.map((p) => ({ ...p, key: nextKey.current++ })));
    setRowErrors({});
    setListBad(null);
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: "lista" | "on" | "ia", where: string, patch: { genesis_on?: boolean; genesis_advice?: boolean; genesis_portals?: Saved[] }): Promise<boolean> => {
    if (busy) return false;
    setBusy(what);
    setFault(null);
    try {
      await saveGenesis(space, patch);
      return true;
    } catch (error) {
      setFault({ where, fault: faultOf(error) });
      return false;
    } finally {
      setBusy(null);
      void client.invalidateQueries({ queryKey: key });
    }
  };

  const change = (rowKey: number, patch: Partial<Saved>) => {
    setRows((list) => list.map((r) => (r.key === rowKey ? { ...r, ...patch } : r)));
    setRowErrors({});
    setListBad(null);
    setSaved(false);
  };

  const saveList = async () => {
    const checked = checkPortalRows(rows);
    if (!checked.ok) {
      setRowErrors(checked.errors);
      setListBad(checked.why ?? null);
      return;
    }
    setRowErrors({});
    setListBad(null);
    // Sin portales no hay a dónde llamar: se apaga con la lista.
    const ok = await act("lista", "No se guardaron los portales", { genesis_portals: checked.portals, ...(checked.portals.length === 0 ? { genesis_on: false } : {}) });
    setSaved(ok);
  };

  const count = data?.portals.length ?? 0;
  const dirty = Boolean(data) && !sameList(rows, data!.portals);
  const state = !data || data.missing ? null : !count ? (
    <StatusMark tone="off">Sin portales</StatusMark>
  ) : !data.on ? (
    <StatusMark tone="warn">{`${plural(count, "portal guardado", "portales guardados")} · apagada`}</StatusMark>
  ) : (
    <StatusMark tone="ok">{`Encendida · ${plural(count, "sede", "sedes")}`}</StatusMark>
  );

  return (
    <Group title="Génesis · Mis notas" aside={<small>{state}</small>}>
      <p className="pis-lead">
        En la app, cada estudiante entra al Génesis de su sede con su propio código y contraseña para ver su histórico de notas. Pilo solo lee, no guarda la contraseña ni las notas, y
        nada de eso entra a esta memoria. Aquí se escriben los portales de Génesis —uno por sede— y se dice si Mis notas está encendida.
      </p>

      {disabled ? (
        <p className="pis-small">Sin la migración 0113 este Pilo no tiene dónde guardar la conexión.</p>
      ) : setup.isError ? (
        <FaultNote fault={faultOf(setup.error)} lead="No se pudo leer la conexión con Génesis" onRetry={() => void setup.refetch()} />
      ) : setup.isPending || !data ? (
        <Skeleton rows={1} label="Leyendo la conexión con Génesis" />
      ) : data.missing ? (
        <MissingNote migration={MIGRATION} what="Sin ella no hay dónde guardar los portales de Génesis, y la app dice que Mis notas aún no está disponible." />
      ) : (
        <>
          <form
            className="pen-field"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void saveList();
            }}
          >
            <span className="pen-field__label">Portales de Génesis, uno por sede</span>
            {rows.length === 0 && <small>Todavía no hay ninguno. Agregue el de cada sede: Bucaramanga, Cúcuta, Valledupar, Bogotá, TEC o las que haya.</small>}
            {rows.map((row, i) => {
              const bad = rowErrors[i];
              const label = row.name.trim() || `portal ${i + 1}`;
              return (
                <div key={row.key} role="group" aria-label={`Portal ${i + 1}${row.name.trim() ? `: ${row.name.trim()}` : ""}`}>
                  <span className="pen-add">
                    <input
                      type="text"
                      value={row.name}
                      maxLength={60}
                      placeholder="Sede (como la verá el estudiante)"
                      aria-label={`Nombre de la sede del portal ${i + 1}`}
                      aria-invalid={Boolean(bad?.name) || undefined}
                      onChange={(e) => change(row.key, { name: e.target.value })}
                    />
                    <input
                      type="url"
                      inputMode="url"
                      value={row.url}
                      maxLength={300}
                      placeholder="https://…"
                      aria-label={`Dirección de Génesis de ${label}`}
                      aria-invalid={Boolean(bad?.url) || undefined}
                      onChange={(e) => change(row.key, { url: e.target.value })}
                    />
                    <button
                      type="button"
                      className="pis-link pis-link--danger"
                      disabled={Boolean(busy)}
                      aria-label={`Quitar el portal de ${label}`}
                      onClick={() => {
                        setRows((list) => list.filter((r) => r.key !== row.key));
                        setRowErrors({});
                        setListBad(null);
                        setSaved(false);
                      }}
                    >
                      Quitar
                    </button>
                  </span>
                  {(bad?.name || bad?.url) && (
                    <small role="alert">
                      <b className="pen-bad">{[bad.name, bad.url].filter(Boolean).join(" ")}</b>
                    </small>
                  )}
                </div>
              );
            })}
            <span className="pis-actions">
              <button
                type="button"
                className="button-secondary"
                disabled={Boolean(busy) || rows.length >= MAX_PORTALS}
                onClick={() => {
                  setRows((list) => [...list, { key: nextKey.current++, id: "", name: "", url: "" }]);
                  setSaved(false);
                }}
              >
                Agregar un portal
              </button>
              <button type="submit" className="button-primary" disabled={Boolean(busy) || !dirty}>
                {busy === "lista" ? "Guardando…" : "Guardar los portales"}
              </button>
              {dirty && !busy && (
                <button type="button" className="pis-link" onClick={() => (setRows(data.portals.map((p) => ({ ...p, key: nextKey.current++ }))), setRowErrors({}), setListBad(null))}>
                  Deshacer los cambios
                </button>
              )}
            </span>
            <small>
              {listBad ? (
                <b className="pen-bad">{listBad}</b>
              ) : saved && !dirty ? (
                "Portales guardados."
              ) : (
                `La dirección es la de entrada al portal del estudiante de esa sede, con https y sin ruta; puede llevar puerto (https://sitio:81). Hasta ${MAX_PORTALS}. El estudiante los ve en este orden. Se guardan al momento, aparte de «Guardar cambios».`
              )}
            </small>
          </form>

          <div className="pis-actions">
            <span className="pen-doc__switch">
              <Switch on={data.on} disabled={Boolean(busy) || count === 0} onChange={(on) => void act("on", "No se cambió Mis notas", { genesis_on: on })} label="Mis notas en la app" />
              {data.on ? "Mis notas encendida" : "Mis notas apagada"}
            </span>
            {count === 0 && <span className="pis-small">Guarde al menos un portal para poder encenderla.</span>}
          </div>

          <div className="pis-actions">
            <span className="pen-doc__switch">
              <Switch on={data.advice} disabled={Boolean(busy)} onChange={(on) => void act("ia", "No se cambiaron las recomendaciones", { genesis_advice: on })} label="Recomendaciones con IA en Mis notas" />
              {data.advice ? "Recomendaciones con IA encendidas" : "Recomendaciones con IA apagadas"}
            </span>
            <span className="pis-small">
              Encendidas, el estudiante puede pedirle a Pilo recomendaciones sobre sus notas: solo al pulsar el botón, su dispositivo envía a la IA un resumen sin nombre ni código
              (programa, periodos, materias y definitivas). Pilo busca en la memoria de Enseñanza y cita lo que encuentre. No se guarda. Hasta 5 pedidos al día por estudiante.
            </span>
          </div>

          {fault && <FaultNote fault={fault.fault} lead={fault.where} />}

          <p className="pis-note">
            <b>Antes de encenderla.</b> La única dirección que se conoce hoy es la de un ambiente de validación de Génesis, no las de producción de cada sede, y atiende en un puerto
            propio: no está comprobado que la función de Pilo pueda salir por ese puerto. Hace falta el visto bueno de TI para que Pilo entre con credenciales de estudiantes. Cambiar la
            dirección de un portal, o quitarlo, hace que quienes entraron por él tengan que entrar de nuevo. La función solo llama a cuatro rutas de Génesis (el ingreso, el polígrafo,
            el récord de notas y el polígrafo en PDF) y descarta los datos personales que trae el ingreso.
          </p>
        </>
      )}
    </Group>
  );
}
