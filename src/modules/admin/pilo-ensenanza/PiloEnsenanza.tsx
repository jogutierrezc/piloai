/* =============================================================================
   Intranet · Mr. Pilo en Enseñanza (solo administración).

   El segundo Pilo: innovación educativa, políticas institucionales y mirada
   global. Una mesa de trabajo en dos partes:

     El panel de Pilo    a la izquierda (arriba en el móvil): su cara, entera y
     (PiloDock)          a buen tamaño, el estado en palabras, el interruptor,
                         tres datos y toda la actividad larga. Es el único
                         lugar donde aparece Pilo.
     La hoja de trabajo  una sección a la vez, por las pestañas del riel de la
                         cabecera, enlazables por la dirección:

       Pregúntele a Pilo  ?seccion=pregunta&fila=cupos   filas plegables.
       Memoria            ?seccion=memoria&momento=mapa  cuatro momentos.
       Catálogo           lo que Pilo no supo, primero; luego el catálogo.
       Bitácora de uso    el uso de hoy y los pedidos.

   No hay pestañas de Conexión ni de Voz: el servicio, la clave, el modelo y la
   voz son los de «Mr. Pilo con IA», y se dice con un enlace.

   Su catálogo, sus respuestas guardadas, su bandeja y su bitácora son suyos:
   todo lo que esta pantalla lee o escribe lleva space = 'ensenanza'.

   La ficha (pilo_spaces) espera a «Guardar cambios»; el catálogo, la bandeja y
   el índice se aplican al momento. Sin la migración 0113 la pantalla se pinta
   con los valores de partida, lo dice arriba y deja los controles apagados.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useAuth } from "../../../lib/auth";
import { AdminShell } from "../components/AdminShell";
import { ErrorBlock, LoadingBlock } from "../../../components/ui/QueryState";
import { usePiloSettings } from "../pilo/store";
import { joinNames } from "../pilo/mesh-view";
import { StatusMark, plural } from "../pilo/ui";
import "../pilo/pilo-settings.css";
import { PreguntaPanel } from "./PreguntaPanel";
import type { SpaceEditor } from "./PreguntaPanel";
import { MemoriaPanel } from "./MemoriaPanel";
import { CatalogoPanel } from "./CatalogoPanel";
import { BitacoraPanel } from "./BitacoraPanel";
import { PiloDock } from "./PiloDock";
import type { DockFact } from "./PiloDock";
import { AUD_TEXT } from "./resumen";
import { SPACE, dirtyTabs, parseTab, tabsFor, useSaveSpace, useSpace, useSpaceMemoryCounts, useSpaceUsage } from "./store";
import type { RolId, RoleSettings, SpaceLoad, SpaceSettings, TabId } from "./store";
import { confirmSave, revealSection } from "./motion";
import "./pilo-ensenanza.css";

const SHELL = {
  section: "pilo_ensenanza" as const,
  kicker: "Sistema",
  title: "Mr. Pilo en Enseñanza",
  description: "El segundo Mr. Pilo: innovación educativa, políticas institucionales y mirada global. Con su propia memoria, catálogo y bitácora.",
};

const SHELL_STAFF = { ...SHELL, description: "Los documentos, las fuentes y el catálogo de la memoria de Pilo Enseñanza." };

/**
 * Quien administra (zona «conexion») ve todo. Docencia, Institucional y ambos
 * solo cargan documentos; y quien no trabaja en este espacio no lo abre.
 */
export function PiloEnsenanzaSettings() {
  const { canUse, canWorkInSpace } = useAuth();
  if (!canWorkInSpace(SPACE)) {
    return (
      <AdminShell {...SHELL_STAFF}>
        <p className="pis-warn" role="status">
          Su rol no trabaja en Pilo Enseñanza.
        </p>
      </AdminShell>
    );
  }
  // pilo_spaces_staff deja al personal del espacio LEER su ficha (no cambiarla, ni leer las claves): se lee
  // para mostrar el estado de la memoria; sin «conexion» no hay guardado ni interruptor.
  return <Gate limited={!canUse("conexion")} />;
}

function Gate({ limited }: { limited: boolean }) {
  const space = useSpace(SPACE);
  if (space.data) return <Editor load={space.data} limited={limited} />;
  return (
    <AdminShell {...SHELL}>
      {space.isPending ? <LoadingBlock rows={6} label="Cargando a Mr. Pilo en Enseñanza" /> : <ErrorBlock error={space.error} onRetry={() => space.refetch()} />}
    </AdminShell>
  );
}

/* --- Las pestañas ------------------------------------------------------------------------------ */

function Tabs({ tabs, current, dirty, onPick }: { tabs: ReturnType<typeof tabsFor>; current: TabId; dirty: TabId[]; onPick: (id: TabId, via: "pointer" | "keyboard") => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = tabs.findIndex((t) => t.id === current);
    const to =
      e.key === "ArrowRight" ? (at + 1) % tabs.length
      : e.key === "ArrowLeft" ? (at - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(tabs[to].id, "keyboard");
    refs.current[tabs[to].id]?.focus();
  };
  return (
    <div className="admin-rail pis-tabs" role="tablist" aria-label="Secciones de Mr. Pilo en Enseñanza" onKeyDown={onKey}>
      {tabs.map((t) => {
        const on = t.id === current;
        return (
          <button
            key={t.id}
            ref={(el) => (refs.current[t.id] = el)}
            type="button"
            role="tab"
            id={`pen-tab-${t.id}`}
            aria-selected={on}
            aria-controls={`pen-panel-${t.id}`}
            aria-current={on ? "page" : undefined}
            tabIndex={on ? 0 : -1}
            className="admin-rail__tab"
            onClick={() => onPick(t.id, "pointer")}
          >
            {t.label}
            {dirty.includes(t.id) && (
              <span className="pis-tabs__dot" title="Cambios sin guardar">
                <span className="sr-only">(cambios sin guardar)</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --- El editor ------------------------------------------------------------------------------------ */

function Editor({ load, limited = false }: { load: SpaceLoad; limited?: boolean }) {
  const { canUse, canWorkInSpace } = useAuth();
  const tabs = useMemo(() => tabsFor(canUse), [canUse]);
  const { settings: initial, missing } = load;
  const [s, setS] = useState<SpaceSettings>(initial);
  const [saved, setSaved] = useState(initial);
  const save = useSaveSpace(initial.id);
  const shared = usePiloSettings(!limited);
  const usage = useSpaceUsage(initial.id, !missing && !limited);
  const counts = useSpaceMemoryCounts(initial.id, !missing);
  const [params, setParams] = useSearchParams();
  const tab = parseTab(params.get("seccion"), tabs.map((x) => x.id));
  const [visited, setVisited] = useState<Set<TabId>>(() => new Set([tab]));
  const via = useRef<"pointer" | "keyboard" | null>(null);
  const panels = useRef<Record<string, HTMLDivElement | null>>({});
  const mark = useRef<HTMLSpanElement>(null);
  const [justSaved, setJustSaved] = useState(0);

  useEffect(() => {
    setS(initial);
    setSaved(initial);
  }, [initial]);

  useEffect(() => {
    setVisited((prev) => (prev.has(tab) ? prev : new Set([...prev, tab])));
  }, [tab]);

  // Cambiar de pestaña con el puntero se ve; con el teclado, no.
  useLayoutEffect(() => {
    if (via.current === "pointer") revealSection(panels.current[tab]);
    via.current = null;
  }, [tab]);

  // El guardado se confirma una vez: la marca del pie y, en su panel, un asentimiento de Pilo.
  useLayoutEffect(() => {
    if (justSaved) confirmSave(mark.current);
  }, [justSaved]);

  /** Cambia de pestaña; `extra` lleva además a una fila o a un momento (fila=cupos, momento=mapa). */
  const go = (id: TabId, how: "pointer" | "keyboard" = "pointer", extra?: Record<string, string>) => {
    if (id === tab && !extra) return;
    if (id !== tab) via.current = how;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("seccion", id);
        for (const [k, v] of Object.entries(extra ?? {})) next.set(k, v);
        return next;
      },
      { replace: true },
    );
  };

  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved]);
  const changed = useMemo(() => dirtyTabs(s, saved), [s, saved]);
  const set: SpaceEditor["set"] = (key, value) => setS((prev) => ({ ...prev, [key]: value }));
  const setRole = (rol: RolId, patch: Partial<RoleSettings>) => setS((prev) => ({ ...prev, roles: { ...prev.roles, [rol]: { ...prev.roles[rol], ...patch } } }));
  const ed: SpaceEditor = { s, saved, set, setRole, missing, shared: shared.data ?? null, readOnly: limited };

  // Lo que dice la franja de estado.
  const aiReady = Boolean(shared.data?.enabled) && shared.data?.functions.preguntar !== false;
  const status = missing ? "Falta aplicar la migración 0113" : !s.on ? "Cerrado: nadie puede preguntarle" : `Abierto para ${AUD_TEXT[s.aud]}`;
  const today = usage.data?.today ?? 0;
  const share = saved.daily_limit > 0 ? Math.min(1, today / saved.daily_limit) : 0;
  const passages = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : null;
  const names = changed.map((id) => tabs.find((t) => t.id === id)?.label ?? id);
  const after = s.on ? `abierto para ${AUD_TEXT[s.aud]}` : "cerrado";

  const footer = limited ? undefined : (
    <div className="pis-save" role="region" aria-label="Guardar">
      <span className="pis-save__msg" role="status">
        {missing ? (
          <StatusMark tone="warn">Falta aplicar la migración 0113: no hay dónde guardar todavía.</StatusMark>
        ) : save.isError ? (
          <StatusMark tone="fail">No se guardó: {(save.error as Error).message}</StatusMark>
        ) : dirty ? (
          <StatusMark tone="warn">
            Cambios sin guardar{names.length ? ` en ${joinNames(names)}` : ""}. Al guardar, este Pilo queda {after}.
          </StatusMark>
        ) : (
          <span ref={mark} className="pen-saved">
            <StatusMark tone={s.on ? "ok" : "off"}>Todo guardado. Mr. Pilo en Enseñanza está {after}.</StatusMark>
          </span>
        )}
      </span>
      <span className="pis-save__actions">
        <button type="button" className="button-secondary" disabled={missing || !dirty || save.isPending} onClick={() => setS(saved)}>
          Descartar
        </button>
        <button
          type="button"
          className="button-primary"
          disabled={missing || !dirty || save.isPending}
          onClick={() =>
            save.mutate(s, {
              onSuccess: () => {
                setSaved(s);
                setJustSaved((n) => n + 1);
              },
            })
          }
        >
          {save.isPending ? "Guardando…" : "Guardar cambios"}
        </button>
      </span>
    </div>
  );

  const body: Record<TabId, () => ReactNode> = {
    pregunta: () => <PreguntaPanel ed={ed} active={tab === "pregunta"} />,
    memoria: () => <MemoriaPanel ed={ed} />,
    catalogo: () => <CatalogoPanel ed={ed} />,
    bitacora: () => <BitacoraPanel ed={ed} onQuotas={() => go("pregunta", "pointer", { fila: "cupos" })} />,
  };

  // Los tres datos del panel de Pilo; cada uno lleva a donde se cambia o se mira.
  const memoryFact: DockFact = {
    id: "memoria",
    label: "Memoria",
    value: <StatusMark tone={passages === null ? "off" : passages === 0 ? "warn" : "ok"}>{passages === null ? "Sin contar" : plural(passages, "pasaje", "pasajes")}</StatusMark>,
    detail: passages === 0 ? "Se llena con documentos y Moodle" : undefined,
    onClick: () => go("memoria"),
  };
  const facts: DockFact[] = limited ? [memoryFact] : [
    {
      id: "ia",
      label: "Redacta con IA",
      value: <StatusMark tone={!shared.data ? "off" : aiReady && s.ai ? "ok" : "warn"}>{!shared.data ? "Revisando" : aiReady && s.ai ? "Sí" : "No"}</StatusMark>,
      detail: !shared.data ? undefined : aiReady ? (s.ai ? undefined : "Apagado en este Pilo: responde con lo publicado") : "Mr. Pilo con IA está apagado: responde con lo publicado",
      onClick: () => go("pregunta", "pointer", { fila: "pagina" }),
    },
    {
      id: "uso",
      label: "Uso de hoy",
      value: (
        <StatusMark tone={missing || !usage.data ? "off" : share >= 0.9 ? "warn" : "ok"}>
          {missing || !usage.data ? "Sin contar" : `${today.toLocaleString("es-CO")} de ${saved.daily_limit.toLocaleString("es-CO")}`}
        </StatusMark>
      ),
      share: missing || !usage.data ? undefined : share,
      detail: !missing && usage.data && share >= 0.9 ? "Casi en el tope" : undefined,
      onClick: () => go("bitacora"),
    },
    memoryFact,
  ];

  return (
    <AdminShell {...(limited ? SHELL_STAFF : SHELL)} rail={<Tabs tabs={tabs} current={tab} dirty={changed} onPick={go} />} footer={footer}>
      <div className="pis pen">
        {missing && (
          <p className="pis-warn" role="status">
            <strong>Falta aplicar la migración 0113</strong> en la base. Hasta entonces este Pilo no existe: lo de abajo son sus valores de partida y los controles están
            apagados. «Mr. Pilo con IA» sigue funcionando como siempre.
          </p>
        )}

        <div className="pen-app">
          <PiloDock status={limited ? "Carga de documentos" : status} on={s.on} disabled={missing} onToggle={(v) => set("on", v)} facts={facts} nod={justSaved} limited={limited} otherSpace={canWorkInSpace("planeacion")} />

          <div className="pen-work">
            {tabs.map((t) =>
              visited.has(t.id) || t.id === tab ? (
                <div key={t.id} id={`pen-panel-${t.id}`} role="tabpanel" aria-labelledby={`pen-tab-${t.id}`} hidden={t.id !== tab} className="pis-panel" ref={(el) => (panels.current[t.id] = el)}>
                  <header className="pis-panel__head">
                    <h2>{t.title}</h2>
                    <p>{t.lead}</p>
                  </header>
                  {/* Cada panel arma sus hojas (ui › Sheet, FoldRow): sin 0113 se apagan sus controles, no la navegación. */}
                  {body[t.id]()}
                </div>
              ) : null,
            )}
          </div>
        </div>
      </div>
    </AdminShell>
  );
}
