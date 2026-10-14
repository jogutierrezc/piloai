/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria, en cuatro momentos.

   En vez de ocho bloques apilados, una hoja por momento, enlazable por la
   dirección (?seccion=memoria&momento=mapa):

   Alimentar    lo que entra. Fuentes (memory_sources de pilo_spaces, con sus
                pasajes por colección; se guarda con «Guardar cambios»),
                Documentos y Moodle (memoria/DocumentsPanel y MoodlePanel: cada
                uno dice qué migración le falta —0114, 0116— y se apaga sin
                romper a los demás).
   Comprender   lo que Pilo entiende. Búsqueda por significado: el índice de
                vectores de ESTE espacio (pilo-ia «indexar» con space).
                Comprensión con IA (memoria/ComprehendGroup): de qué trata cada pasaje y qué normas cita
                (pilo-ia «comprender», 0115), el tiempo de pensamiento que se
                le dé: los lotes siguen solos, un fallo espera y reintenta; se
                puede detener y retomar, lo comprendido no se pierde. Es el
                único «Comprender»: el mapa no repite el control.
   Mapa         memoria/TeachMap: colección → documento → tema → referencia.
                Un conmutador lo cambia por el mapa global de los dos Pilos.
   Probar       memoria/TeachMap › MemoryProbe: los pasajes que este Pilo
                encontraría y su camino; y las respuestas guardadas
                (pilo_answers de este espacio), que se ocultan o se pasan al
                catálogo.

   Un momento ya visitado sigue montado al cambiar a otro: un documento que se
   está leyendo o un lote en curso no se cortan. Su avance se ve en el panel de
   Pilo (almacén de actividad), no en una franja de esta página.

   Lo que no es la ficha (índice, respuestas) se aplica al momento.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Icon } from "../../../components/ui/Icon";
import { pendingOf, useEmbedStatus, useHideAnswer, useIndexMemory, useSavedAnswers } from "../pilo/memory";
import type { EmbedStatus } from "../pilo/memory";
import { CatalogModal } from "../pilo/CatalogModal";
import { customOf, useSourceCounts } from "../pilo/collections";
import { effectiveCell, usePortals, useSetCell } from "../pilo/portals";
import type { CatalogRow, CatalogRol } from "../pilo/catalog-sheet";
import { SPACE_COPY } from "../pilo/space";
// El mapa global se monta en el momento «mapa» (MapMoment), tras el conmutador «Los dos Pilos».
import { GlobalMap } from "../pilo/mapa-global/GlobalMap";
import { Group, StatusMark, Switch, plural, when } from "../pilo/ui";
import { activity } from "./actividad";
import { ComprehendGroup } from "./memoria/ComprehendGroup";
import { DocumentsPanel } from "./memoria/DocumentsPanel";
import { ReadingsPanel } from "./memoria/ReadingsPanel";
import { MoodlePanel } from "./memoria/MoodlePanel";
import { GenesisPanel } from "./memoria/GenesisPanel";
import { MemoryProbe, TeachMap } from "./memoria/TeachMap";
import { indexRun, useProbePath, useRefreshMemory } from "./memoria/data";
import { enterBlock } from "./motion";
import { momentsFor, parseMoment } from "./navegacion";
import type { MomentId } from "./navegacion";
import type { SpaceEditor } from "./PreguntaPanel";
import { SPACE_SOURCES, useSpaceMemoryCounts } from "./store";
import type { SpaceSource } from "./store";
import { RolTag, Sheet, Skeleton, useEnter } from "./ui";

export function MemoriaPanel({ ed }: { ed: SpaceEditor }) {
  const { s, missing } = ed;
  const space = s.id;
  const [params, setParams] = useSearchParams();
  const readOnly = Boolean(ed.readOnly);
  const moments = momentsFor(readOnly);
  const moment = parseMoment(params.get("momento"), moments.map((m) => m.id));
  const [visited, setVisited] = useState<Set<MomentId>>(() => new Set([moment]));
  const via = useRef<"pointer" | "keyboard" | null>(null);
  const views = useRef<Record<string, HTMLDivElement | null>>({});
  const tabs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    setVisited((prev) => (prev.has(moment) ? prev : new Set([...prev, moment])));
  }, [moment]);

  // Cambiar de momento con el puntero se ve; con el teclado, no.
  useLayoutEffect(() => {
    if (via.current === "pointer") enterBlock(views.current[moment]);
    via.current = null;
  }, [moment]);

  const go = (id: MomentId, how: "pointer" | "keyboard" = "pointer") => {
    if (id === moment) return;
    via.current = how;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("momento", id);
        return next;
      },
      { replace: true },
    );
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = moments.findIndex((m) => m.id === moment);
    const to =
      e.key === "ArrowRight" ? (at + 1) % moments.length
      : e.key === "ArrowLeft" ? (at - 1 + moments.length) % moments.length
      : e.key === "Home" ? 0
      : e.key === "End" ? moments.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    go(moments[to].id, "keyboard");
    tabs.current[moments[to].id]?.focus();
  };

  const body: Record<MomentId, () => ReactNode> = {
    alimentar: () => (
      <Sheet off={missing}>
        <SourcesGroup ed={ed} />
        <DocumentsPanel space={space} disabled={missing} />
        <ReadingsPanel space={space} disabled={missing} />
        {!readOnly && <MoodlePanel space={space} disabled={missing} />}
        {!readOnly && <GenesisPanel space={space} disabled={missing} />}
      </Sheet>
    ),
    comprender: () => (
      <Sheet off={missing}>
        <SemanticGroup ed={ed} />
        <ComprehendGroup space={space} off={missing} onMap={() => go("mapa")} />
      </Sheet>
    ),
    mapa: () => <MapMoment space={space} missing={missing} onComprehend={() => go("comprender")} readOnly={readOnly} />,
    probar: () => (
      <Sheet off={missing}>
        <MemoryProbe space={space} disabled={missing} />
        <ProbeTrail onMap={() => go("mapa")} />
        <AnswersGroup ed={ed} />
      </Sheet>
    ),
  };

  return (
    <>
      <div className="pen-moments" role="tablist" aria-label="Momentos de la memoria" onKeyDown={onKey}>
        {moments.map((m, i) => {
          const on = m.id === moment;
          return (
            <button
              key={m.id}
              ref={(el) => (tabs.current[m.id] = el)}
              type="button"
              role="tab"
              id={`pen-moment-${m.id}`}
              aria-selected={on}
              aria-controls={`pen-moment-view-${m.id}`}
              tabIndex={on ? 0 : -1}
              onClick={(e) => go(m.id, e.detail === 0 ? "keyboard" : "pointer")}
            >
              <span aria-hidden="true">{i + 1}</span>
              {m.label}
            </button>
          );
        })}
      </div>

      {moments.map((m) =>
        visited.has(m.id) || m.id === moment ? (
          <div key={m.id} id={`pen-moment-view-${m.id}`} role="tabpanel" aria-labelledby={`pen-moment-${m.id}`} hidden={m.id !== moment} className="pen-moment" ref={(el) => (views.current[m.id] = el)}>
            <p className="pis-small">{m.lead}</p>
            {body[m.id]()}
          </div>
        ) : null,
      )}
    </>
  );
}

/* --- Mapa · el de este Pilo o el de los dos ------------------------------------------------ */

/**
 * Un solo mapa a la vista: el de este Pilo o, a un clic, el global de los dos
 * (src/modules/admin/pilo/mapa-global), que solo se dibuja: cada Pilo sigue
 * buscando en lo suyo. El global se lee al pedirlo; después los dos siguen
 * montados, para no perder el punto elegido al ir y volver.
 */
function MapMoment({ space, missing, onComprehend, readOnly }: { space: SpaceEditor["s"]["id"]; missing: boolean; onComprehend: () => void; readOnly: boolean }) {
  const [both, setBoth] = useState(false);
  const [seen, setSeen] = useState(false);
  const show = (next: boolean) => {
    setBoth(next);
    if (next) setSeen(true);
  };
  return (
    <>
      {!readOnly && (
      <div className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Qué mapa se ve">
        <button type="button" role="radio" aria-checked={!both} onClick={() => show(false)}>
          Este Pilo
        </button>
        <button type="button" role="radio" aria-checked={both} onClick={() => show(true)}>
          Los dos Pilos
        </button>
      </div>
      )}
      <div hidden={both}>
        <Sheet off={missing}>
          <TeachMap space={space} disabled={missing} onComprehend={onComprehend} />
        </Sheet>
      </div>
      {seen && (
        <div hidden={!both}>
          <Sheet off={missing}>
            <Group title="Mapa global de los dos Pilos" aside={<small>Solo se dibuja: cada Pilo sigue buscando en lo suyo</small>}>
              {/* Sin cara: en esta intranet Pilo vive solo en su panel. */}
              {missing ? <p className="pis-small">Sin la migración 0113 este Pilo no existe todavía: no hay qué unir con el de Planeación.</p> : <GlobalMap focus="todo" face={false} />}
            </Group>
          </Sheet>
        </div>
      )}
    </>
  );
}

/* --- Alimentar · Fuentes ------------------------------------------------------------------ */

/**
 * Las colecciones que creó la administración (0125). A diferencia de las cuatro de
 * partida, su interruptor no espera a «Guardar cambios»: es la celda de este Pilo
 * en «Qué lee cada portal» y se aplica al momento.
 */
function CustomSources({ space, enabled }: { space: SpaceEditor["s"]["id"]; enabled: boolean }) {
  const portals = usePortals(enabled);
  const setCell = useSetCell();
  const portal = portals.data?.portals.find((p) => p.id === space) ?? null;
  const own = portals.data ? customOf(portals.data.sources, space) : [];
  const counts = useSourceCounts(
    space,
    own.map((c) => c.id),
    enabled,
  );
  if (!portal || own.length === 0) return null;
  return (
    <>
      {own.map((c) => {
        const on = effectiveCell(portal, c) === "casa";
        return (
          <li key={c.id} data-off={!on || undefined}>
            <span className="pis-code pen-code" aria-hidden="true">
              {c.name.slice(0, 2).toUpperCase()}
            </span>
            <span>
              <strong>{c.name}</strong>
              <small>Colección propia · se aplica al momento</small>
            </span>
            <em>{counts.data ? plural(counts.data[c.id] ?? 0, "pasaje", "pasajes") : "—"}</em>
            <Switch on={on} disabled={setCell.isPending} onChange={(v) => setCell.mutate({ portal, source: c, to: v ? "casa" : "no" })} label={`Usar ${c.name}`} />
          </li>
        );
      })}
      {setCell.isError && (
        <li className="pis-error" role="alert">
          {(setCell.error as Error).message}
        </li>
      )}
    </>
  );
}

function SourcesGroup({ ed }: { ed: SpaceEditor }) {
  const { s, set, missing } = ed;
  const counts = useSpaceMemoryCounts(s.id, !missing);
  const total = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : 0;

  return (
    <Group title="Fuentes" aside={<small>{missing ? "Sin la migración 0113" : counts.data ? `${plural(total, "pasaje", "pasajes")} · actualizada ${when(s.memory_indexed_at)}` : "Contando pasajes…"}</small>}>
      <p className="pis-lead">
        La memoria de este Pilo es solo suya: cuatro colecciones de partida y las que usted cree en «Documentos». {ed.readOnly ? "Quien administra las enciende o apaga." : "Apagar una la deja guardada, pero Pilo deja de buscar en ella."}
      </p>
      <ul className="pis-sources">
        {SPACE_SOURCES.map((m) => (
          <li key={m.id} data-off={!s.memory_sources[m.id] || undefined}>
            <span className="pis-code pen-code" data-s={m.id} aria-hidden="true">
              {m.code}
            </span>
            <span>
              <strong>{m.name}</strong>
              <small>{m.desc}</small>
            </span>
            <em>{counts.data ? plural(counts.data[m.id], "pasaje", "pasajes") : "—"}</em>
            {!ed.readOnly && (
              <Switch on={s.memory_sources[m.id]} onChange={(v) => set("memory_sources", { ...s.memory_sources, [m.id]: v } as Record<SpaceSource, boolean>)} label={`Usar ${m.name}`} />
            )}
          </li>
        ))}
        {!ed.readOnly && <CustomSources space={s.id} enabled={!missing} />}
      </ul>
      {missing ? (
        <p className="pis-small">Sin la migración 0113 este Pilo no tiene memoria propia.</p>
      ) : (
        counts.data && total === 0 && <p className="pis-small">Todavía no hay pasajes: la memoria se llena con los documentos que suba y los cursos de Moodle que elija, aquí abajo.</p>
      )}
    </Group>
  );
}

/* --- Comprender · Búsqueda por significado ------------------------------------------------ */

const INDEX_OWNER = "indice";

function SemanticGroup({ ed }: { ed: SpaceEditor }) {
  const { s, missing } = ed;
  const space = s.id;
  const status = useEmbedStatus(!missing, space);
  const refresh = useRefreshMemory(space);
  const [progress, setProgress] = useState<EmbedStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const halt = useRef(false);
  const alive = useRef(true);
  const now = progress ?? status.data ?? null;
  const pending = pendingOf(now);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      halt.current = true;
      activity.end(INDEX_OWNER);
    };
  }, []);

  /** Lote tras lote, hasta quedar al día; el avance es el de ESTA corrida. */
  const run = async () => {
    if (running || !now) return;
    const start = pending;
    halt.current = false;
    setRunning(true);
    setNote(null);
    setError(null);
    const say = (st: EmbedStatus | null, stopping = false) => {
      const left = pendingOf(st);
      const total = st ? st.memory_total + st.catalog_total : 0;
      const done = st ? st.memory_done + st.catalog_done : 0;
      activity.set({
        owner: INDEX_OWNER,
        title: stopping ? "Pilo termina el lote y se detiene" : "Pilo está indexando su memoria",
        line: st ? `${done.toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")} con su vector · faltan ${left.toLocaleString("es-CO")}.` : "Pidiendo el primer lote…",
        progress: start > 0 ? (start - left) / start : undefined,
        stop: stopping
          ? undefined
          : () => {
              halt.current = true;
              say(st, true);
            },
      });
    };
    say(now);
    try {
      const r = await indexRun(space, {
        stopped: () => halt.current,
        onStatus: (st) => {
          if (alive.current) setProgress(st);
          say(st, halt.current);
        },
      });
      if (alive.current && r.halted) setNote("Se detuvo. Lo indexado queda guardado: puede retomarlo cuando quiera.");
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "No se pudo indexar.");
    } finally {
      activity.end(INDEX_OWNER);
      refresh();
      if (alive.current) {
        setProgress(null);
        setRunning(false);
      }
    }
  };

  return (
    <Group title="Búsqueda por significado" aside={<small>{now?.model ? `Modelo ${now.model}` : "El índice de este Pilo"}</small>}>
      <div className="pis-row">
        <p className="pis-note">
          Cada pasaje y cada entrada del catálogo de este Pilo guardan un vector que dice de qué hablan: así encuentra «evaluación formativa» cuando le preguntan «¿cómo
          califico sin examen?». Usa el modelo y la clave de Mr. Pilo con IA, pero su índice es aparte.
        </p>
        <button type="button" className="button-secondary" onClick={() => void run()} disabled={missing || running || status.isPending || status.isError || !now || pending === 0}>
          {running ? "Indexando…" : pending === 0 && now ? "Al día" : note ? "Retomar el índice" : "Indexar por significado"}
        </button>
      </div>

      {missing ? (
        <p className="pis-small">Sin la migración 0113 este Pilo no tiene índice.</p>
      ) : status.isError ? (
        <p className="pis-warn">{(status.error as Error).message}</p>
      ) : status.isPending ? (
        <Skeleton rows={1} label="Revisando el índice" />
      ) : now ? (
        <p className="pis-small">
          <StatusMark tone={running ? "off" : pending ? "warn" : "ok"}>{running ? "Indexando" : pending ? "Falta indexar" : "Al día"}</StatusMark> {plural(now.memory_done, "pasaje", "pasajes")} de{" "}
          {now.memory_total.toLocaleString("es-CO")}
          {now.catalog_total ? ` y ${plural(now.catalog_done, "entrada del catálogo", "entradas del catálogo")} de ${now.catalog_total.toLocaleString("es-CO")}` : ""} tienen su vector
          {pending ? ` · faltan ${pending.toLocaleString("es-CO")}` : ""}.{running ? " El avance se ve en el panel de Pilo; puede seguir trabajando en otra sección." : ""}
        </p>
      ) : (
        <p className="pis-small">Sin datos del índice.</p>
      )}
      {note && !running && <p className="pis-small">{note}</p>}
      {error && (
        <p className="pis-error" role="alert">
          No terminó de indexar: {error}
        </p>
      )}
    </Group>
  );
}

/* --- Probar · el camino de la última prueba ------------------------------------------------ */

/** La prueba deja su camino encendido en el mapa, que ahora es otro momento: se enlaza. */
function ProbeTrail({ onMap }: { onMap: () => void }) {
  const probe = useProbePath();
  if (!probe || probe.direct.length + probe.viaMap.length === 0) return null;
  return (
    <p className="pen-trail">
      <Icon name="layers" size={16} />
      <span>El camino de la última prueba está encendido en el mapa.</span>
      <button type="button" className="button-secondary" onClick={onMap}>
        Ver el camino en el mapa
      </button>
    </p>
  );
}

/* --- Probar · Respuestas guardadas ---------------------------------------------------------- */

function AnswersGroup({ ed }: { ed: SpaceEditor }) {
  const { s, missing } = ed;
  const space = s.id;
  const answers = useSavedAnswers(space);
  const hide = useHideAnswer();
  const indexer = useIndexMemory(space);
  const [entry, setEntry] = useState<Partial<CatalogRow> | null>(null);
  const list = useEnter<HTMLUListElement>(answers.data ? answers.data.rows.map((a) => a.id).join() : null);

  const promote = (a: { question: string; answer: string; rol?: string }) =>
    setEntry({
      kind: "respuesta",
      question: a.question,
      answer: a.answer.replace(/\s*\[\d+\]/g, "").trim(),
      source_title: SPACE_COPY[space].sourceTitle,
      source_path: SPACE_COPY[space].sourcePath,
      rol: (a.rol === "estudiante" || a.rol === "profesor" ? a.rol : "") as CatalogRol,
    });

  return (
    <Group title="Respuestas guardadas" aside={answers.data ? <small>{plural(answers.data.total, "en total", "en total")}</small> : null}>
      {missing ? (
        <p className="pis-small">Sin la migración 0113 este Pilo no guarda respuestas.</p>
      ) : answers.isPending ? (
        <Skeleton rows={3} label="Leyendo las respuestas guardadas" />
      ) : !answers.data || answers.data.rows.length === 0 ? (
        <p className="pis-small">
          Todavía no hay respuestas guardadas. Se guardan las que redacta la IA con todo verificado, separadas por rol: lo que se le dijo a un estudiante no se le sirve a un
          profesor.
        </p>
      ) : (
        <ul className="pis-answers" ref={list}>
          {answers.data.rows.map((a) => (
            <li key={a.id} data-hidden={a.hidden || undefined}>
              <span>
                <strong>{a.question}</strong>
                <small>{a.answer.replace(/\s*\[\d+\]/g, "").slice(0, 160)}</small>
              </span>
              <em>
                <RolTag rol={a.rol} /> {when(a.created_at)} · sirvió {a.up} · no sirvió {a.down}
                {a.hidden ? " · oculta" : ""}
              </em>
              <div className="pis-cat__actions">
                <button type="button" className="button-secondary pis-to-cat" onClick={() => promote(a)} title="Agregar esta respuesta al catálogo de este Pilo">
                  <Icon name="spark" size={14} />
                  Al catálogo
                </button>
                <button type="button" className="button-secondary" onClick={() => hide.mutate({ id: a.id, hidden: !a.hidden })} disabled={hide.isPending}>
                  {a.hidden ? "Volver a usar" : "Ocultar"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {hide.isError && (
        <p className="pis-error" role="alert">
          No se cambió: {(hide.error as Error).message}
        </p>
      )}

      <CatalogModal
        open={entry !== null}
        onClose={() => setEntry(null)}
        defaultKind="respuesta"
        initialEntry={entry}
        isEditing={false}
        space={space}
        onSaved={() => {
          // La respuesta nueva se reconoce por significado en cuanto tenga su vector.
          if (!indexer.isPending) indexer.mutate(undefined);
        }}
      />
    </Group>
  );
}
