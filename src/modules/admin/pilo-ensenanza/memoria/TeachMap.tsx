/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria › Mapa de conexiones (migración 0115).

   Cuatro columnas —colección → documento → tema → referencia— con una curva
   por relación (pilo_graph_overview del espacio, fuente «mapa», plegada en
   map.ts). Tocar un punto enciende sus vecinos y abre su detalle: con qué se
   conecta y los pasajes que lo sostienen (usePassage, el mismo de «Mr. Pilo
   con IA»). El buscador salta a un punto por su nombre.

   «Comprender» (pedir a la IA de qué trata cada pasaje) no se lanza aquí: vive
   en el momento «Comprender» de la Memoria y reporta al panel de Pilo. El mapa
   muestra lo comprendido y enlaza allá. Sin IA el mapa es el básico:
   estructura y normas citadas.

   MemoryProbe es «Probar la memoria» de este espacio: además de los pasajes
   que halla la búsqueda, pide los que llegan por el mapa (pilo_graph_neighbors,
   como al preguntar) y enciende en el mapa el camino usado.

   Teclado: las flechas recorren la columna (arriba y abajo) y saltan al vecino
   más cercano de la columna de al lado (izquierda y derecha); Intro elige;
   Escape suelta. Lo que se hace con el teclado no se anima.
   ========================================================================== */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { usePassage } from "../../pilo/MeshView";
import { useTryMemory } from "../../pilo/memory";
import { customOf } from "../../pilo/collections";
import { usePortals } from "../../pilo/portals";
import { clipLabel, searchNodes } from "../../pilo/mesh-view";
import type { ViewNode } from "../../pilo/mesh-view";
import { drawChain } from "../../pilo/motion";
import type { PiloSpace } from "../../pilo/space";
import { Group, StatusMark, plural } from "../../pilo/ui";
import { SPACE_SOURCES } from "../store";
import { Skeleton, Thinking, useEnter } from "../ui";
import { mapNeighbors, reading, useComprehendStatus, useDocPassages, useDocs, useProbePath, useTeachMap } from "./data";
import type { MemoryPartProps } from "./DocumentsPanel";
import { faultOf } from "./flow";
import { MAP_COLUMNS, docOf, edgeId, focusOf, layoutColumns, neighborsOf, pathOfPassages, readThinkStatus, teachGraph } from "./map";
import type { ColumnLayout, Lit, MapColumn, MapNode, TeachGraph } from "./map";
import { FaultNote, MissingNote } from "./parts";
import "../../pilo/mesh-view.css";

const COLLECTIONS = Object.fromEntries(SPACE_SOURCES.map((s) => [s.id, s.name]));
const ORDER = SPACE_SOURCES.map((s) => s.id);

const COL: Record<MapColumn, { x: number; anchor: "start" | "end"; max: number; r: number; head: string; one: string }> = {
  coleccion: { x: 200, anchor: "end", max: 26, r: 6, head: "Colecciones", one: "Colección" },
  documento: { x: 540, anchor: "end", max: 44, r: 5, head: "Documentos y cursos", one: "Documento" },
  tema: { x: 830, anchor: "end", max: 36, r: 4.5, head: "Temas", one: "Tema" },
  referencia: { x: 880, anchor: "start", max: 34, r: 4.5, head: "Referencias", one: "Referencia" },
};
const WIDTH = 1130;
const TOP = 18;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
};

const kindName = (n: MapNode) => (n.column === "documento" && n.kind === "curso" ? "Curso de Moodle" : COL[n.column].one);

export function TeachMap({ space, disabled, onComprehend }: MemoryPartProps & { /** Lleva al momento «Comprender». */ onComprehend?: () => void }) {
  const map = useTeachMap(space, !disabled);
  const docs = useDocs(space, !disabled);
  const portals = usePortals(!disabled);
  const own = useMemo(() => customOf(portals.data?.sources ?? [], space), [portals.data, space]);
  const names = useMemo(() => ({ ...COLLECTIONS, ...Object.fromEntries(own.map((c) => [c.id, c.name])) }), [own]);
  const order = useMemo(() => [...ORDER, ...own.map((c) => c.id)], [own]);
  const missing = map.data?.missing ?? null;
  const ai = useComprehendStatus(space, !disabled && map.data !== undefined && !missing);
  const probe = useProbePath();
  const [selected, setSelected] = useState<string | null>(null);
  const via = useRef<"pointer" | "keyboard">("pointer");

  const courses = useMemo(() => new Set((docs.data?.data ?? []).filter((d) => d.origin === "moodle").map((d) => `doc:${d.id}`)), [docs.data]);
  const graph = useMemo(() => teachGraph(map.data?.data ?? { nodes: [], edges: [] }, names, courses), [map.data, names, courses]);
  const layout = useMemo(() => layoutColumns(graph, order), [graph, order]);
  const node = selected ? graph.byId.get(selected) ?? null : null;
  const lit: Lit | null = useMemo(() => {
    if (node) return focusOf(graph, node.id);
    if (!probe) return null;
    const path = pathOfPassages(graph, [...probe.direct, ...probe.viaMap]);
    return path.nodes.size ? path : null;
  }, [graph, node, probe]);

  // Una prueba nueva suelta lo elegido: lo que se ve es su camino.
  useEffect(() => {
    if (probe) {
      via.current = "pointer";
      setSelected(null);
    }
  }, [probe?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const status = readThinkStatus(ai.data?.status) ?? readThinkStatus(map.data?.data.status);
  const hasAi = ai.data ? ai.data.ai !== false : null;
  const pending = status?.pending ?? 0;

  const select = (id: string | null, how: "pointer" | "keyboard" = "pointer") => {
    via.current = how;
    setSelected(id);
  };

  const counts = MAP_COLUMNS.map((c) => layout.columns[c].length);
  const empty = graph.nodes.length === 0;

  return (
    <Group
      title="Mapa de conexiones"
      aside={
        <span className="pen-legend" aria-hidden="true">
          <span>
            <i data-k="documento" /> Documento
          </span>
          <span>
            <i data-k="curso" /> Curso de Moodle
          </span>
          <span>
            <i data-k="tema" /> Tema
          </span>
          <span>
            <i data-k="referencia" /> Referencia
          </span>
        </span>
      }
    >
      {disabled ? (
        <p className="pis-small">Sin la migración 0113 este Pilo no tiene mapa.</p>
      ) : missing ? (
        <MissingNote migration={missing} what="Sin ella no hay mapa: los documentos quedan en pasajes y Pilo responde igual, pero sin seguir conexiones." />
      ) : map.isError ? (
        <FaultNote fault={faultOf(map.error)} lead="No se pudo leer el mapa" onRetry={() => void map.refetch()} />
      ) : map.isPending ? (
        <Skeleton rows={3} label="Leyendo el mapa" />
      ) : (
        <>
          <div className="pis-row">
            <p className="pis-note">
              Pilo arma estas conexiones al leer: de qué colección es cada documento, de qué temas trata y qué normas o referentes cita. Al responder, sigue el mapa para traer
              pasajes vecinos a los que encontró.
              {hasAi === false ? " Sin IA, el mapa es el básico: estructura y normas citadas." : ""}
            </p>
          </div>

          {status && (
            <p className="pis-small" role="status">
              <StatusMark tone={hasAi === false ? "off" : pending ? "warn" : "ok"}>{hasAi === false ? "Mapa básico" : pending ? "Falta comprender" : "Comprendido"}</StatusMark>{" "}
              {plural(status.mapped, "pasaje comprendido", "pasajes comprendidos")} de {status.total.toLocaleString("es-CO")} · {plural(status.topics, "tema", "temas")} ·{" "}
              {plural(status.refs, "referencia", "referencias")}
              {pending ? ` · faltan ${pending.toLocaleString("es-CO")}` : ""}.
              {pending > 0 && hasAi !== false && onComprehend && (
                <>
                  {" "}
                  <button type="button" className="pis-link" onClick={onComprehend}>
                    Comprender lo que falta
                  </button>
                </>
              )}
            </p>
          )}
          {ai.isError && <FaultNote fault={faultOf(ai.error)} lead="No se pudo saber cuánto se ha comprendido" onRetry={() => void ai.refetch()} />}

          {empty ? (
            <div className="pen-soon" role="note">
              <Icon name="layers" size={20} />
              <p>El mapa está vacío. Se arma solo al guardar un documento o al leer un curso de Moodle: primero la estructura y las normas citadas; los temas, al comprender con IA.</p>
            </div>
          ) : (
            <>
              <div className="pen-map__bar">
                <MapSearch graph={graph} onPick={(id) => select(id, "pointer")} />
                <small className="msh-meta">
                  {counts[1]} {counts[1] === 1 ? "documento" : "documentos"} · {counts[2]} {counts[2] === 1 ? "tema" : "temas"} · {counts[3]} {counts[3] === 1 ? "referencia" : "referencias"} · {plural(graph.edges.length, "relación", "relaciones")}
                </small>
              </div>
              <MapCanvas graph={graph} layout={layout} lit={lit} selected={node?.id ?? null} viaMap={!node && probe ? probe.viaMap : []} via={via} probeAt={!node && probe ? probe.at : 0} onSelect={select} />
              {node ? (
                <NodeDetail space={space} graph={graph} node={node} onSelect={select} />
              ) : (
                <p className="pen-map__detail">
                  {lit && probe
                    ? `Camino de la última prueba: ${plural(probe.direct.length, "pasaje hallado", "pasajes hallados")} por la búsqueda${probe.viaMap.length ? ` y ${plural(probe.viaMap.length, "pasaje que llegó", "pasajes que llegaron")} por el mapa (marcados con un anillo)` : ""}.`
                    : "Toque un punto del mapa para ver con qué se conecta y los pasajes que lo sostienen."}
                </p>
              )}
            </>
          )}
        </>
      )}
    </Group>
  );
}

/* --- Buscar un punto ---------------------------------------------------------------------------- */

function MapSearch({ graph, onPick }: { graph: TeachGraph; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  // searchNodes es el de la malla: las colecciones (tipo «fuente») no se buscan.
  const nodes = useMemo<ViewNode[]>(() => graph.nodes.map((n) => ({ id: n.id, source: "mapa", type: n.column === "coleccion" ? "fuente" : n.column, code: "", label: n.label, path: "" })), [graph]);
  const results = useMemo(() => searchNodes(nodes, q, 10), [nodes, q]);
  const show = open && q.trim().length > 0;
  const pick = (id: string | undefined) => {
    if (!id) return;
    onPick(id);
    setOpen(false);
    setQ("");
  };

  return (
    <div className="msh-search">
      <Icon name="search" size={16} />
      <input
        type="search"
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && results[active] ? `${listId}-${active}` : undefined}
        aria-label="Buscar un documento, un tema o una referencia"
        placeholder="Buscar un documento, un tema o una norma"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === "Enter") (e.preventDefault(), pick(results[active]?.id));
          else if (e.key === "Escape" && show) (e.stopPropagation(), setOpen(false));
        }}
      />
      {show && (
        <ul className="msh-search__list" role="listbox" id={listId} aria-label="Puntos encontrados">
          {results.length === 0 ? (
            <li className="msh-search__none" role="option" aria-selected={false} aria-disabled="true">
              Ningún punto del mapa tiene ese nombre.
            </li>
          ) : (
            results.map((n, i) => (
              <li key={n.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(n.id)}>
                <i className="pen-dot" data-k={graph.byId.get(n.id)?.kind === "curso" ? "curso" : n.type} aria-hidden="true" />
                <span>
                  <strong>{n.label}</strong>
                  <small>{graph.byId.get(n.id) ? kindName(graph.byId.get(n.id)!) : ""}</small>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* --- El mapa -------------------------------------------------------------------------------------- */

function MapCanvas({
  graph,
  layout,
  lit,
  selected,
  viaMap,
  via,
  probeAt,
  onSelect,
}: {
  graph: TeachGraph;
  layout: ColumnLayout;
  lit: Lit | null;
  selected: string | null;
  /** Pasajes que llegaron por el mapa en la última prueba: sus documentos llevan un anillo. */
  viaMap: string[];
  via: { current: "pointer" | "keyboard" };
  probeAt: number;
  onSelect: (id: string | null, how?: "pointer" | "keyboard") => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const height = layout.height + TOP * 2;
  const tabStop = (selected && layout.byId.has(selected) ? selected : null) ?? focusId ?? layout.columns.documento[0] ?? layout.placed[0]?.id ?? null;
  const ringed = useMemo(() => new Set(viaMap.map((r) => docOf(r)).filter(Boolean) as string[]), [viaMap]);
  const colIndex = (el: Element) => MAP_COLUMNS.indexOf((el.getAttribute("data-from-col") ?? "coleccion") as MapColumn);
  const pathsOf = (query: string) => [...(svg.current?.querySelectorAll<SVGPathElement>(query) ?? [])].sort((a, b) => colIndex(a) - colIndex(b));

  // Al llegar, el mapa se traza una vez (si no es enorme).
  const traced = useRef(false);
  useLayoutEffect(() => {
    if (traced.current || !layout.placed.length) return;
    traced.current = true;
    const all = pathsOf("path");
    if (all.length <= 400) drawChain(all);
  }, [layout]); // eslint-disable-line react-hooks/exhaustive-deps

  // El camino elegido (o el de una prueba) se traza de izquierda a derecha, solo con el puntero.
  useLayoutEffect(() => {
    if (!lit || via.current !== "pointer") return;
    drawChain(pathsOf("path[data-on]"));
  }, [selected, probeAt]); // eslint-disable-line react-hooks/exhaustive-deps

  // El punto elegido desde fuera (el buscador, el detalle) se trae a la vista.
  useEffect(() => {
    const f = frame.current;
    const p = selected ? layout.byId.get(selected) : null;
    if (!f || !p) return;
    const top = p.y + TOP + 40;
    const x = COL[p.column].x;
    const inY = top > f.scrollTop + 40 && top < f.scrollTop + f.clientHeight - 40;
    const inX = x > f.scrollLeft + 40 && x < f.scrollLeft + f.clientWidth - 40;
    if (inY && inX) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    f.scrollTo({ top: inY ? f.scrollTop : Math.max(0, top - f.clientHeight / 2), left: inX ? f.scrollLeft : Math.max(0, x - f.clientWidth / 2), behavior: reduce || via.current === "keyboard" ? "auto" : "smooth" });
  }, [selected, layout, via]);

  const move = (id: string | null | undefined) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() => svg.current?.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
  };

  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    const p = id ? layout.byId.get(id) : null;
    if (!id || !p) return;
    const col = layout.columns[p.column];
    const at = col.indexOf(id);
    const side = (step: 1 | -1) => {
      const target = MAP_COLUMNS[MAP_COLUMNS.indexOf(p.column) + step];
      if (!target) return null;
      const linked = [...focusOf(graph, id).nodes].filter((n) => layout.byId.get(n)?.column === target);
      const pool = linked.length ? linked : layout.columns[target];
      return pool.reduce<string | null>((best, c) => (!best || Math.abs(layout.byId.get(c)!.y - p.y) < Math.abs(layout.byId.get(best)!.y - p.y) ? c : best), null);
    };
    let handled = true;
    if (e.key === "ArrowDown") move(col[Math.min(col.length - 1, at + 1)]);
    else if (e.key === "ArrowUp") move(col[Math.max(0, at - 1)]);
    else if (e.key === "Home") move(col[0]);
    else if (e.key === "End") move(col[col.length - 1]);
    else if (e.key === "ArrowLeft") move(side(-1));
    else if (e.key === "ArrowRight") move(side(1));
    else if (e.key === "Enter" || e.key === " ") onSelect(id === selected ? null : id, "keyboard");
    else if (e.key === "Escape" && selected) onSelect(null, "keyboard");
    else handled = false;
    if (handled) e.preventDefault();
  };

  return (
    <div className="msh-frame pen-map" ref={frame}>
      <div className="msh-heads" style={{ width: WIDTH }} aria-hidden="true">
        {MAP_COLUMNS.map((c) => (
          <span key={c} data-anchor={COL[c].anchor} style={COL[c].anchor === "end" ? { right: WIDTH - COL[c].x - 8 } : { left: COL[c].x - 8 }}>
            {COL[c].head} <b>{layout.columns[c].length}</b>
          </span>
        ))}
      </div>
      <svg
        ref={svg}
        className="msh-svg"
        width={WIDTH}
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="group"
        aria-label="Mapa de conexiones: colecciones, documentos y cursos, temas y referencias"
        data-focus={lit ? "" : undefined}
        onKeyDown={onKey}
        onClick={(e) => {
          const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
          if (id) {
            setFocusId(id);
            onSelect(id === selected ? null : id, "pointer");
          }
        }}
      >
        <g className="msh-edges">
          {graph.edges.map((e) => {
            const a = layout.byId.get(e.from);
            const b = layout.byId.get(e.to);
            if (!a || !b) return null;
            return <path key={edgeId(e.from, e.to)} d={curve(COL[a.column].x, a.y + TOP, COL[b.column].x, b.y + TOP)} pathLength={1} data-on={lit?.edges.has(edgeId(e.from, e.to)) || undefined} data-from-col={a.column} />;
          })}
        </g>
        <g className="msh-nodes">
          {layout.placed.map((p) => {
            const n = graph.byId.get(p.id)!;
            const c = COL[p.column];
            const tx = c.anchor === "end" ? -(c.r + 6) : c.r + 6;
            const ring = ringed.has(p.id);
            return (
              <g
                key={p.id}
                className="msh-node pen-node"
                data-id={p.id}
                data-col={p.column}
                data-k={n.kind}
                data-on={lit?.nodes.has(p.id) || undefined}
                data-sel={p.id === selected || undefined}
                transform={`translate(${c.x} ${p.y + TOP})`}
                tabIndex={p.id === tabStop ? 0 : -1}
                role="button"
                aria-pressed={p.id === selected}
                aria-label={`${kindName(n)} ${n.label}${ring ? ", llegó por el mapa en la última prueba" : ""}`}
                onFocus={() => setFocusId(p.id)}
              >
                <title>{n.label}</title>
                <rect className="msh-node__hit" x={c.anchor === "end" ? -(c.max * 6.4) - 12 : -8} y={-10} width={c.max * 6.4 + 20} height={20} rx={4} />
                {ring && <circle className="pen-node__ring" r={c.r + 5} />}
                {p.column === "documento" ? <rect className="pen-node__doc" x={-c.r} y={-c.r} width={c.r * 2} height={c.r * 2} rx={2} /> : <circle r={c.r} />}
                <text x={tx} dy="0.34em" textAnchor={c.anchor}>
                  {clipLabel(n.label, c.max)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/* --- El detalle de un punto ---------------------------------------------------------------- */

const SHOWN = 8;

function NodeDetail({ space, graph, node, onSelect }: { space: PiloSpace; graph: TeachGraph; node: MapNode; onSelect: (id: string | null, how?: "pointer" | "keyboard") => void }) {
  const near = useMemo(() => neighborsOf(graph, node.id), [graph, node.id]);
  const docId = node.column === "documento" ? node.id.slice(4) : null;
  const own = useDocPassages(space, docId);
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const passage = usePassage(open, space);
  useEffect(() => {
    setOpen(null);
    setAll(false);
  }, [node.id]);

  // Los pasajes que lo sostienen: los suyos (un documento) o los que lo tratan o citan.
  const refs = docId ? (own.data ?? []).map((p) => ({ ref: p.ref, label: p.section || `Pasaje ${p.seq}` })) : node.passages.map((ref) => ({ ref, label: `${graph.byId.get(docOf(ref) ?? "")?.label ?? "Documento"} · pasaje ${ref.slice(ref.lastIndexOf(":") + 1)}` }));
  const shown = all ? refs : refs.slice(0, SHOWN);
  const groups = MAP_COLUMNS.filter((c) => near[c].length > 0);

  return (
    <div className="pen-map__detail" aria-live="polite">
      <div className="pen-map__detail-head">
        <strong>
          {kindName(node)} · {node.label}
        </strong>
        <button type="button" className="pis-link" onClick={() => onSelect(null)}>
          Soltar
        </button>
      </div>
      {groups.length === 0 ? (
        <p className="pis-small">Todavía no se conecta con nada.</p>
      ) : (
        groups.map((c) => (
          <p key={c} className="pen-map__links">
            <small>{COL[c].head}</small>
            {near[c].slice(0, 14).map((n) => (
              <button key={n.id} type="button" className="pen-chip" onClick={() => onSelect(n.id)}>
                {clipLabel(n.label, 44)}
              </button>
            ))}
            {near[c].length > 14 && <em>y {near[c].length - 14} más</em>}
          </p>
        ))
      )}

      {node.column !== "coleccion" && (
        <div className="pen-map__passages">
          <small>
            {docId && own.isPending ? "Leyendo sus pasajes…" : refs.length ? `${plural(refs.length, "pasaje lo sostiene", "pasajes lo sostienen")}${docId && node.sections ? ` · ${plural(node.sections, "sección", "secciones")}` : ""}` : "Sin pasajes propios en el mapa."}
          </small>
          {shown.map((r) => (
            <button key={r.ref} type="button" className="pen-chip" aria-pressed={open === r.ref} onClick={() => setOpen(open === r.ref ? null : r.ref)}>
              {clipLabel(r.label, 60)}
            </button>
          ))}
          {refs.length > SHOWN && !all && (
            <button type="button" className="pis-link" onClick={() => setAll(true)}>
              Ver los {refs.length}
            </button>
          )}
        </div>
      )}

      {open &&
        (passage.isPending ? (
          <p className="pis-small">Leyendo el pasaje…</p>
        ) : passage.data ? (
          <div className="pen-map__passage">
            <p className="msh-passage__meta">
              <strong>{passage.data.title}</strong>
              {passage.data.section}
            </p>
            <p className="msh-passage">{passage.data.body}</p>
          </div>
        ) : (
          <p className="pis-small">Ese pasaje ya no está en la memoria (o está oculto).</p>
        ))}
    </div>
  );
}

/* --- Probar la memoria, con el camino en el mapa --------------------------------------------- */

const VIA = { palabras: "por palabras", significado: "por significado", ambas: "por palabras y significado" } as const;
const sourceOf = (id: string) => SPACE_SOURCES.find((m) => m.id === id);

interface ProbeHit {
  ref: string;
  source: string;
  title: string;
  section: string;
  detail: string;
  rank: number | null;
  viaMap: boolean;
}

export function MemoryProbe({ space, disabled }: MemoryPartProps) {
  const tryIt = useTryMemory(space);
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ at: number; hits: ProbeHit[]; semantic: boolean; note?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const list = useEnter<HTMLOListElement>(state ? state.at : null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reading.end("prueba");
      reading.probe(null);
    };
  }, []);

  const go = async () => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError(null);
    reading.set({ owner: "prueba", title: "Pilo está buscando en su memoria", line: "Por palabras y por significado, solo en lo suyo." });
    try {
      const found = await tryIt.mutateAsync(text);
      const direct = found.hits.map((h) => h.ref);
      reading.set({ owner: "prueba", title: "Pilo está siguiendo las conexiones", line: "Busca en el mapa los pasajes vecinos de lo que encontró." });
      const near = (await mapNeighbors(space, direct)).filter((n) => !direct.includes(n.ref));
      if (!alive.current) return;
      const hits: ProbeHit[] = [
        ...found.hits.map((h) => ({
          ref: h.ref,
          source: h.source as string,
          title: h.title,
          section: h.section,
          detail: [h.cut, h.via ? VIA[h.via] : "", typeof h.sim === "number" ? `parecido ${Math.round(h.sim * 100)} %` : ""].filter(Boolean).join(" · "),
          rank: Math.round(h.rank * 100),
          viaMap: false,
        })),
        ...near.map((n) => ({ ref: n.ref, source: n.source, title: n.title, section: n.section, detail: `llegó por el mapa${n.shared ? ` · ${plural(n.shared, "tema o referencia en común", "temas o referencias en común")}` : ""}`, rank: null, viaMap: true })),
      ];
      const at = Date.now();
      setState({ at, hits, semantic: found.semantic, note: found.note });
      reading.probe({ direct, viaMap: near.map((n) => n.ref), at });
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : "No se pudo buscar.");
    } finally {
      reading.end("prueba");
      if (alive.current) setBusy(false);
    }
  };

  return (
    <Group title="Probar la memoria" aside={<small>Los pasajes que este Pilo encontraría y el camino que siguió</small>}>
      <form
        className="pis-probe"
        onSubmit={(e) => {
          e.preventDefault();
          void go();
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escriba una pregunta como la haría un estudiante o un profesor" aria-label="Pregunta de prueba" />
        <button type="submit" className="button-secondary" disabled={disabled || !q.trim() || busy}>
          {busy ? "Buscando…" : "Probar la memoria"}
        </button>
      </form>
      {busy && <Thinking detail="Por palabras y por significado; luego, los vecinos por el mapa.">Pilo está buscando</Thinking>}
      {error && (
        <p className="pis-error" role="alert">
          {error}
        </p>
      )}
      {!busy && state && !state.semantic && <p className="pis-small">Solo por palabras{state.note ? `: ${state.note}` : "."}</p>}
      {!busy &&
        state &&
        (state.hits.length === 0 ? (
          <p className="pis-small">Ningún pasaje responde: este Pilo diría que no lo encontró.</p>
        ) : (
          <ol className="pis-hits" ref={list}>
            {state.hits.map((h) => (
              <li key={h.ref} data-via={h.viaMap ? "mapa" : undefined}>
                <span className="pis-code pen-code" data-s={h.source} title={sourceOf(h.source)?.name}>
                  {sourceOf(h.source)?.code ?? "··"}
                </span>
                <span>
                  <strong>{h.title}</strong>
                  <small>{[h.section, h.detail].filter(Boolean).join(" · ")}</small>
                </span>
                {h.viaMap ? <em className="pen-via">Por el mapa</em> : <em title="Qué tanto se parece a la pregunta">{h.rank}</em>}
              </li>
            ))}
          </ol>
        ))}
      {!busy && state && state.hits.length > 0 && <p className="pis-small">El camino de estos pasajes quedó encendido en el momento «Mapa de conexiones».</p>}
    </Group>
  );
}
