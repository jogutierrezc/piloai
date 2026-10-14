/* =============================================================================
   Mr. Pilo · el mapa global de conexiones.

   Lo que saben los dos Pilos, en un solo mapa y cada uno en su banda:
   Pregúntele a Pilo (Planeación) arriba y Pilo en Enseñanza abajo. De izquierda
   a derecha, de la fuente o colección al documento, informe o pilar, y de ahí a
   los temas, indicadores y referencias. Los PUENTES —el mismo ODS, la misma
   ley, el mismo nombre en los dos Pilos, o una relación que propuso la IA— se
   LEEN de la base desde 0122, cada uno con su origen y su estado: los
   aprobados van con trazo de rayas y un rombo; los que esperan revisión, con
   trazo de puntos; los rechazados no se dibujan. Arriba del mapa, la bandeja
   «Puentes por revisar» los aprueba o rechaza uno por uno. Aprobar un puente no
   abre nada por sí solo: Pilo lo sigue solo hacia una fuente que el portal
   tenga «De visita». Sin 0122 los puentes se calculan al dibujar, como antes.
   Solo administración.

   - Ver: Todo, solo Planeación o solo Enseñanza.
   - Buscar por código o nombre salta al punto, abriendo lo que lo contiene.
   - Tocar un punto enciende sus vecinos y abre su detalle: de qué Pilo es, su
     fuente y su documento, los pasajes que lo sostienen, con qué se conecta y
     por qué puente.
   - Con cientos de nodos el mapa llega plegado: «+N» abre lo que un punto
     contiene; los temas y referencias menos usados esperan tras un botón.

   Teclado: arriba y abajo recorren la columna; derecha abre (o pasa al vecino
   de la columna siguiente); izquierda pliega (o sube a quien lo contiene);
   Intro elige; Escape suelta. Lo que se hace con el teclado no se anima.
   ========================================================================== */

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";
import { PiloFace } from "../../../../components/pilo/PiloFace";
import { TYPE_LABEL } from "../../../../components/pilo/ai/logic";
import { Icon } from "../../../../components/ui/Icon";
import { teachGraph } from "../../pilo-ensenanza/memoria/map";
import { SPACE_SOURCES } from "../../pilo-ensenanza/store";
import { usePassage } from "../MeshView";
import { customOf } from "../collections";
import { MEMORY_SOURCES } from "../memory";
import { clipLabel } from "../mesh-view";
import { drawChain, swapPanel } from "../motion";
import { usePortals } from "../portals";
import type { PiloSpace } from "../space";
import { plural } from "../ui";
import { BridgeInbox } from "./BridgeInbox";
import { useDocRefs, useGlobalMap } from "./data";
import type { GlobalData } from "./data";
import { bridgeCounts, bridgeLive, bridgeState, buildGlobal, countsOf, defaultOpen, detailOf, layoutGlobal, litOf, revealOf, searchGlobal, visibleOf } from "./global";
import type { GNode, GlobalFilter, GlobalGraph, GlobalLayout, GlobalLit, Visible } from "./global";
import { lightNeighbors, showBridges } from "./motion";
import "../pilo-settings.css";
import "../mesh-view.css";
import "./global-map.css";

export interface GlobalMapProps {
  /** Con qué Pilo se abre la vista: los dos («todo», por defecto) o uno solo. Se puede cambiar dentro. */
  focus?: GlobalFilter;
  /** La cara de Pilo junto a la ayuda. En la intranet de Enseñanza va apagada: allí Pilo vive solo en su panel. */
  face?: boolean;
}

type Via = "pointer" | "keyboard";

const SPACE_NAME: Record<PiloSpace, string> = { planeacion: "Pregúntele a Pilo · Planeación", ensenanza: "Pilo en Enseñanza" };
const SPACE_SHORT: Record<PiloSpace, string> = { planeacion: "Planeación", ensenanza: "Enseñanza" };
const HEADS: Record<PiloSpace, string[]> = {
  planeacion: ["Fuentes", "Informes, pilares y temas", "Indicadores y áreas", "Detalle"],
  ensenanza: ["Colecciones", "Documentos y cursos", "Temas", "Referencias"],
};
const KIND: Record<string, string> = { coleccion: "Colección", documento: "Documento", curso: "Curso de Moodle", referencia: "Referencia", fuente: "Fuente" };
const kindName = (n: GNode) => KIND[n.kind] ?? (n.space === "ensenanza" && n.kind === "tema" ? "Tema" : TYPE_LABEL[n.kind] ? TYPE_LABEL[n.kind][0].replace(/^./, (c) => c.toUpperCase()) : n.kind);
const fullName = (n: GNode) => (n.code ? `${n.code} · ${n.label}` : n.label);

const ORDER = { planeacion: MEMORY_SOURCES.map((s) => s.id as string), ensenanza: SPACE_SOURCES.map((s) => s.id as string) };
const COLLECTIONS = Object.fromEntries(SPACE_SOURCES.map((s) => [s.id, s.name]));
const PLAN_SOURCES = Object.fromEntries(MEMORY_SOURCES.map((s) => [s.id, s.name]));

const COL = [
  { x: 210, anchor: "end" as const, max: 28, r: 6 },
  { x: 550, anchor: "end" as const, max: 44, r: 5 },
  { x: 850, anchor: "end" as const, max: 38, r: 4.5 },
  { x: 910, anchor: "start" as const, max: 36, r: 4.5 },
];
/** El carril de los puentes: entre la tercera y la cuarta columna. */
const LANE = 880;
const WIDTH = 1180;
const PAD = 12;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  if (x1 === x2) return `M${x1} ${y1}C${x1 + 36} ${y1} ${x1 + 36} ${y2} ${x2} ${y2}`;
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
};
const diamond = (x: number, y: number, r: number) => `M${x} ${y - r}L${x + r} ${y}L${x} ${y + r}L${x - r} ${y}Z`;

/** Qué le falta a un lado para dibujarse, en una frase; null si se leyó. */
function sideNote(space: PiloSpace, side: GlobalData[PiloSpace]): string | null {
  if (side.data && !side.missing) return null;
  if (side.missing && side.data) return `${SPACE_NAME[space]}: falta la migración ${side.missing}; el mapa se dibuja con lo que hay, sin el estado de «comprender».`;
  if (side.missing) return `${SPACE_NAME[space]} no se puede dibujar: falta aplicar la migración ${side.missing}.`;
  return `${SPACE_NAME[space]} no se pudo leer: ${side.error ?? "error desconocido"}`;
}

export function GlobalMap({ focus = "todo", face = true }: GlobalMapProps) {
  const query = useGlobalMap();
  const portals = usePortals();
  const own = useMemo(() => customOf(portals.data?.sources ?? [], "ensenanza"), [portals.data]);
  const [filter, setFilter] = useState<GlobalFilter>(focus);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const [allHubs, setAllHubs] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const via = useRef<Via>("pointer");

  const graph = useMemo(() => {
    const d = query.data;
    if (!d) return null;
    const teach = d.ensenanza.data ? teachGraph(d.ensenanza.data, { ...COLLECTIONS, ...Object.fromEntries(own.map((c) => [c.id, c.name])) }, new Set(d.ensenanza.data.courses)) : null;
    // Con 0122 los puentes se leen de la base; sin ella (data: null) se calculan al dibujar.
    return buildGlobal({ planeacion: d.planeacion.data, ensenanza: teach, order: { ...ORDER, ensenanza: [...ORDER.ensenanza, ...own.map((c) => c.id)] }, bridges: d.bridges.data });
  }, [query.data, own]);

  // Al llegar el mapa se abren solo las fuentes y colecciones pequeñas.
  const seeded = useRef<GlobalGraph | null>(null);
  useEffect(() => {
    if (!graph || seeded.current) return;
    seeded.current = graph;
    setOpen(defaultOpen(graph));
  }, [graph]);

  const visible = useMemo(() => (graph ? visibleOf(graph, { filter, open, pinned, allHubs }) : null), [graph, filter, open, pinned, allHubs]);
  const layout = useMemo(() => (graph && visible ? layoutGlobal(graph, visible) : null), [graph, visible]);
  const node = selected && graph ? graph.byId.get(selected) ?? null : null;
  const lit = useMemo(() => (graph && visible && node ? litOf(graph, visible, node.id) : null), [graph, visible, node]);
  const counts = useMemo(() => (graph ? countsOf(graph) : null), [graph]);

  const select = (id: string | null, how: Via = "pointer") => {
    via.current = how;
    setSelected(id);
    const n = id && graph ? graph.byId.get(id) : null;
    if (!n || !graph) return;
    if (filter !== "todo" && n.space !== filter) setFilter("todo");
    const reveal = revealOf(graph, n.id);
    // Lo muy profundo no se dibuja: basta abrir hasta quien lo contiene en el mapa.
    const need = reveal.open.filter((o) => (graph.byId.get(o)?.depth ?? 9) < 3);
    if (need.some((o) => !open.has(o))) setOpen((prev) => new Set([...prev, ...need]));
    if (reveal.pin && !pinned.has(reveal.pin)) setPinned((prev) => new Set([...prev, reveal.pin!]));
  };

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (query.isPending) {
    return (
      <div className="msh-state" aria-busy="true" role="status">
        <span className="msh-skeleton" />
        <p>Leyendo lo que saben los dos Pilos…</p>
      </div>
    );
  }
  if (query.isError || !query.data || !graph || !visible || !layout || !counts) {
    return (
      <div className="msh-state" role="alert">
        <Icon name="alert" size={20} />
        <div>
          <strong>No se pudo leer el mapa global.</strong>
          <p>{query.error instanceof Error ? query.error.message : "Revise la conexión y vuelva a intentar."}</p>
          <button type="button" className="button-secondary" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </div>
      </div>
    );
  }

  const { planeacion, ensenanza } = query.data;
  const notes = [sideNote("planeacion", planeacion), sideNote("ensenanza", ensenanza)].filter((n): n is string => Boolean(n));
  if (!planeacion.data && !ensenanza.data) {
    return (
      <div className="msh-state" role="note">
        <Icon name="alert" size={20} />
        <div>
          <strong>Todavía no hay mapa que dibujar.</strong>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          <p>Las migraciones las aplica quien administra la base. Con ellas aplicadas, este mapa se arma solo con lo que cada Pilo ya tiene en su memoria.</p>
        </div>
      </div>
    );
  }
  if (graph.nodes.length === 0) {
    return (
      <div className="msh-state" role="note">
        <Icon name="layers" size={20} />
        <div>
          <strong>El mapa global está vacío.</strong>
          <p>
            Pregúntele a Pilo arma su malla con «Actualizar la memoria» (en «Mr. Pilo con IA» › Memoria). Pilo en Enseñanza arma su mapa al guardar un documento o leer un curso de Moodle, y sus temas al
            «Comprender con IA».
          </p>
          {notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      </div>
    );
  }

  const status = ensenanza.data?.status ?? null;
  const stored = query.data.bridges.data;
  const drawn = bridgeCounts(graph);
  const bridgeNote = query.data.bridges.missing
    ? "Falta aplicar la migración 0122: los puentes se calculan al dibujar y no se guardan, así que Pilo todavía no puede seguir ninguno. Con ella aparece aquí la bandeja para aprobarlos."
    : query.data.bridges.error
      ? `No se pudieron leer los puentes guardados: ${query.data.bridges.error} El mapa los calcula al dibujar.`
      : null;
  const emptySide = (["planeacion", "ensenanza"] as PiloSpace[]).filter((s) => query.data[s].data && counts[s] === 0 && graph.roots[s].length === 0);

  return (
    <div
      className="gmap"
      onKeyDown={(e) => {
        if (e.key === "Escape" && node && !e.defaultPrevented) select(null, "keyboard");
      }}
    >
      <div className="gmap-bar">
        <div className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Qué Pilo se ve">
          {(
            [
              ["todo", "Todo", counts.planeacion + counts.ensenanza],
              ["planeacion", "Solo Planeación", counts.planeacion],
              ["ensenanza", "Solo Enseñanza", counts.ensenanza],
            ] as [GlobalFilter, string, number][]
          ).map(([id, label, n]) => (
            <button key={id} type="button" role="radio" aria-checked={filter === id} onClick={() => setFilter(id)}>
              {label} <span className="pis-seg__n">{n.toLocaleString("es-CO")}</span>
            </button>
          ))}
        </div>
        <GlobalSearch graph={graph} filter={filter} onPick={(id) => select(id, "pointer")} />
      </div>

      <p className="msh-meta" role="status">
        {plural(counts.planeacion, "punto", "puntos")} de Planeación · {plural(counts.ensenanza, "punto", "puntos")} de Enseñanza ·{" "}
        {counts.puentes ? plural(counts.puentes, "puente entre los dos", "puentes entre los dos") : "todavía ningún puente entre los dos"}
        {graph.stored && counts.puentes ? ` (${plural(drawn.aprobados, "aprobado", "aprobados")}, ${plural(drawn.propuestos, "por revisar", "por revisar")})` : ""}
        {graph.offMap ? ` · ${plural(graph.offMap, "puente más une puntos que este mapa no dibuja", "puentes más unen puntos que este mapa no dibuja")}` : ""}
        {status ? ` · Enseñanza ha comprendido ${status.mapped.toLocaleString("es-CO")} de ${status.total.toLocaleString("es-CO")} pasajes` : ""}.
      </p>

      <ul className="gmap-legend" aria-label="Cómo leer el mapa">
        <li>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="5" style={{ fill: "var(--brand-navy)" }} />
          </svg>
          Fuente, informe, pilar o tema
        </li>
        <li>
          <svg width="12" height="12" aria-hidden="true">
            <rect x="1" y="1" width="10" height="10" rx="2" style={{ fill: "var(--od-line-1)" }} />
          </svg>
          Documento
        </li>
        <li>
          <svg width="12" height="12" aria-hidden="true">
            <rect x="1" y="1" width="10" height="10" rx="2" style={{ fill: "var(--od-line-3)" }} />
          </svg>
          Curso de Moodle
        </li>
        <li>
          <svg width="12" height="12" aria-hidden="true">
            <circle cx="6" cy="6" r="4.5" style={{ fill: "var(--surface)", stroke: "var(--ink-secondary)", strokeWidth: 1.5 }} />
          </svg>
          Referencia o norma
        </li>
        <li>
          <svg width="34" height="12" aria-hidden="true">
            <path d="M0 6H34" style={{ stroke: "var(--brand-navy)", strokeWidth: 1.2, strokeDasharray: "5 4", fill: "none" }} />
            <path d={diamond(17, 6, 4.5)} style={{ fill: "var(--surface)", stroke: "var(--brand-navy)", strokeWidth: 1.5 }} />
          </svg>
          {graph.stored ? "Puente aprobado (rayas y rombo)" : "Puente entre los dos Pilos (rayas y rombo)"}
        </li>
        {graph.stored && (
          <li>
            <svg width="34" height="12" aria-hidden="true">
              <path d="M0 6H34" style={{ stroke: "var(--ink-muted)", strokeWidth: 1.4, strokeDasharray: "1 4", strokeLinecap: "round", fill: "none" }} />
              <path d={diamond(17, 6, 4.5)} style={{ fill: "var(--surface)", stroke: "var(--ink-muted)", strokeWidth: 1.5, strokeDasharray: "2 2" }} />
            </svg>
            Puente por revisar (puntos): Pilo aún no lo sigue
          </li>
        )}
        <li>
          <svg width="24" height="14" aria-hidden="true">
            <rect x="0.5" y="0.5" width="23" height="13" rx="6.5" style={{ fill: "var(--surface-3)", stroke: "var(--line-strong)" }} />
            <text x="12" y="10.5" textAnchor="middle" style={{ fill: "var(--ink-secondary)", fontSize: 10, fontWeight: 800 }}>
              +8
            </text>
          </svg>
          Abre lo que contiene
        </li>
      </ul>

      {(notes.length > 0 || bridgeNote || emptySide.length > 0 || (counts.puentes === 0 && counts.planeacion > 0 && counts.ensenanza > 0)) && (
        <div className="gmap-notes">
          {notes.map((n) => (
            <p key={n} className="pis-warn">
              {n}
            </p>
          ))}
          {bridgeNote && <p className="pis-warn">{bridgeNote}</p>}
          {emptySide.map((s) => (
            <p key={s} className="pis-small">
              {s === "planeacion"
                ? "Pregúntele a Pilo aún no tiene malla: se arma con «Actualizar la memoria»."
                : "Pilo en Enseñanza aún no tiene mapa: se arma al guardar un documento o leer un curso de Moodle."}
            </p>
          ))}
          {counts.puentes === 0 && counts.planeacion > 0 && counts.ensenanza > 0 && (
            <p className="pis-small">
              {graph.stored
                ? "Todavía no hay puentes guardados entre estos puntos: «Recalcular los de reglas», abajo, los busca (la misma norma, el mismo ODS, el mismo nombre de un punto del Plan)."
                : "Todavía no hay puentes: ningún tema o referencia de Enseñanza nombra lo mismo que un punto de Planeación (un ODS, una ley, un pilar). Aparecen solos cuando Enseñanza comprende más pasajes."}
            </p>
          )}
        </div>
      )}

      {stored && <BridgeInbox rows={stored} byId={graph.byId} onShow={(id) => select(id, "pointer")} />}

      <div className="msh-body">
        <div className="msh-stage">
          <GlobalCanvas graph={graph} visible={visible} layout={layout} lit={lit} selected={node?.id ?? null} open={open} via={via} onSelect={select} onToggle={toggle} />
          {(visible.hiddenHubs > 0 || allHubs) && (
            <p className="pis-small">
              {allHubs ? "Se ven todos los temas y referencias de Enseñanza. " : `${plural(visible.hiddenHubs, "tema o referencia menos usado no se dibuja", "temas y referencias menos usados no se dibujan")}: el buscador los encuentra igual. `}
              <button type="button" className="pis-link" onClick={() => setAllHubs((v) => !v)}>
                {allHubs ? "Ver solo los más usados" : "Ver todos"}
              </button>
            </p>
          )}
        </div>
        <aside className="msh-panel" aria-label="Detalle del punto">
          {node ? (
            <GlobalDetail graph={graph} node={node} open={open} animate={via.current === "pointer"} onSelect={select} onToggle={toggle} />
          ) : (
            <div className="gmap-hint">
              {face && <PiloFace size={84} expression="pensar" label="Mr. Pilo, pensando" />}
              <p>
                <strong>Un solo cerebro, dos portales.</strong> Arriba, lo que sabe Pregúntele a Pilo; abajo, lo que sabe Pilo en Enseñanza. Cada uno busca en lo suyo; los puentes muestran dónde hablan de lo
                mismo. Pilo solo sigue un puente aprobado, y solo hacia una fuente que el portal tenga «De visita».
              </p>
              <p>Toque un punto para ver de qué Pilo es, su fuente, sus pasajes y con qué se conecta.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default GlobalMap;

/* --- Buscar un punto ---------------------------------------------------------------------------- */

function GlobalSearch({ graph, filter, onPick }: { graph: GlobalGraph; filter: GlobalFilter; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  // Se busca en los dos Pilos aunque se vea uno: elegir un punto del otro vuelve a «Todo».
  const results = useMemo(() => searchGlobal(graph, q, "todo", 12), [graph, q]);
  const show = isOpen && q.trim().length > 0;
  const pick = (n: GNode | undefined) => {
    if (!n) return;
    onPick(n.id);
    setIsOpen(false);
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
        aria-label="Buscar un punto de cualquiera de los dos Pilos"
        placeholder="Buscar: un tema, una ley, ODS 4, P1…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setIsOpen(true);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)));
          else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
          else if (e.key === "Enter" && show) (e.preventDefault(), pick(results[active]));
          else if (e.key === "Escape" && show) (e.stopPropagation(), e.preventDefault(), setIsOpen(false));
        }}
      />
      {show && (
        <ul className="msh-search__list" role="listbox" id={listId} aria-label="Puntos encontrados">
          {results.length === 0 ? (
            <li className="msh-search__none" role="option" aria-selected={false} aria-disabled="true">
              Ningún punto de los dos Pilos tiene ese código o nombre.
            </li>
          ) : (
            results.map((n, i) => (
              <li key={n.id} id={`${listId}-${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(n)}>
                <span className="gmap-owner">{SPACE_SHORT[n.space]}</span>
                <span>
                  <strong>{fullName(n)}</strong>
                  <small>
                    {kindName(n)}
                    {filter !== "todo" && n.space !== filter ? " · del otro Pilo" : ""}
                  </small>
                </span>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/* --- El plano ------------------------------------------------------------------------------------- */

function GlobalCanvas({
  graph,
  visible,
  layout,
  lit,
  selected,
  open,
  via,
  onSelect,
  onToggle,
}: {
  graph: GlobalGraph;
  visible: Visible;
  layout: GlobalLayout;
  lit: GlobalLit | null;
  selected: string | null;
  open: ReadonlySet<string>;
  via: MutableRefObject<Via>;
  onSelect: (id: string | null, how?: Via) => void;
  onToggle: (id: string) => void;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const height = layout.height + PAD * 2;
  const at = selected ? visible.anchor(selected) : null;
  const tabStop = at ?? (focusId && visible.ids.has(focusId) ? focusId : null) ?? layout.bands[0]?.columns.find((c) => c.length)?.[0] ?? null;
  const xy = (id: string) => ({ x: COL[graph.byId.get(id)!.col].x, y: (layout.y.get(id) ?? 0) + PAD });
  const foldable = (n: GNode) => n.col < 3 && n.kids.length > 0;
  const fromCol = (el: Element) => Number(el.getAttribute("data-from-col") ?? 0);
  const pathsOf = (q: string) => [...(svg.current?.querySelectorAll<SVGPathElement>(q) ?? [])].sort((a, b) => fromCol(a) - fromCol(b));

  // Al llegar, el mapa se traza una vez (si no es enorme) y luego aparecen los puentes.
  const traced = useRef(false);
  useLayoutEffect(() => {
    if (traced.current || !visible.nodes.length) return;
    traced.current = true;
    const all = pathsOf(".gmap-edges path");
    if (all.length <= 400) {
      drawChain(all);
      showBridges([...(svg.current?.querySelectorAll(".gmap-bridge") ?? [])]);
    }
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Lo elegido con el puntero: sus relaciones se trazan y sus vecinos se encienden.
  useLayoutEffect(() => {
    if (!lit || via.current !== "pointer") return;
    drawChain(pathsOf(".gmap-edges path[data-on]"));
    lightNeighbors([...(svg.current?.querySelectorAll(".gmap-node[data-on]:not([data-sel]) .gmap-glyph") ?? [])]);
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps

  // El punto elegido desde fuera (el buscador, el detalle) se trae a la vista.
  useEffect(() => {
    const f = frame.current;
    if (!f || !at || !layout.y.has(at)) return;
    const p = xy(at);
    const inY = p.y > f.scrollTop + 40 && p.y < f.scrollTop + f.clientHeight - 40;
    const inX = p.x > f.scrollLeft + 40 && p.x < f.scrollLeft + f.clientWidth - 40;
    if (inY && inX) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    f.scrollTo({ top: inY ? f.scrollTop : Math.max(0, p.y - f.clientHeight / 2), left: inX ? f.scrollLeft : Math.max(0, p.x - f.clientWidth / 2), behavior: reduce || via.current === "keyboard" ? "auto" : "smooth" });
  }, [at, layout]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = (id: string | null | undefined) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() => svg.current?.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
  };

  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    const n = id ? graph.byId.get(id) : null;
    const band = n ? layout.bands.find((b) => b.space === n.space) : null;
    if (!id || !n || !band) return;
    const column = band.columns[n.col];
    const i = column.indexOf(id);
    const y = layout.y.get(id) ?? 0;
    const nearest = (pool: string[]) => pool.reduce<string | null>((best, c) => (!best || Math.abs(layout.y.get(c)! - y) < Math.abs(layout.y.get(best)! - y) ? c : best), null);
    const side = (step: 1 | -1) => {
      for (let c = n.col + step; c >= 0 && c <= 3; c += step) {
        const linked = [...(litOf(graph, visible, id)?.nodes ?? [])].filter((x) => graph.byId.get(x)?.space === n.space && graph.byId.get(x)?.col === c);
        const pool = linked.length ? linked : band.columns[c];
        if (pool.length) return nearest(pool);
      }
      return null;
    };
    let handled = true;
    if (e.key === "ArrowDown") move(column[Math.min(column.length - 1, i + 1)]);
    else if (e.key === "ArrowUp") move(column[Math.max(0, i - 1)]);
    else if (e.key === "Home") move(column[0]);
    else if (e.key === "End") move(column[column.length - 1]);
    else if (e.key === "ArrowRight") {
      if (foldable(n) && !open.has(id)) onToggle(id);
      else move(side(1));
    } else if (e.key === "ArrowLeft") {
      if (foldable(n) && open.has(id)) onToggle(id);
      else move(n.parent && visible.ids.has(n.parent) ? n.parent : side(-1));
    } else if (e.key === "Enter" || e.key === " ") onSelect(id === selected ? null : id, "keyboard");
    else if (e.key === "Escape" && selected) onSelect(null, "keyboard");
    else handled = false;
    if (handled) e.preventDefault();
  };

  return (
    <div className="msh-frame gmap-frame" ref={frame}>
      <svg
        ref={svg}
        className="msh-svg"
        width={WIDTH}
        height={height}
        viewBox={`0 0 ${WIDTH} ${height}`}
        role="group"
        aria-label="Mapa global: arriba lo que sabe Pregúntele a Pilo, abajo lo que sabe Pilo en Enseñanza, y los puentes entre los dos"
        data-focus={lit ? "" : undefined}
        onKeyDown={onKey}
        onClick={(e) => {
          const target = e.target as Element;
          const fold = target.closest("[data-toggle]")?.getAttribute("data-toggle");
          if (fold) return onToggle(fold);
          const id = target.closest("[data-id]")?.getAttribute("data-id");
          if (id) {
            setFocusId(id);
            onSelect(id === selected ? null : id, "pointer");
          }
        }}
      >
        {layout.bands.map((b) => (
          <g key={b.space} className="gmap-band" data-space={b.space}>
            <rect x={6} y={b.top + PAD - 6} width={WIDTH - 12} height={b.bottom - b.top} rx={8} />
            <text className="gmap-band__name" x={22} y={b.top + PAD + 16}>
              {SPACE_NAME[b.space]}
              <tspan className="gmap-band__count" dx={8}>
                {plural(b.columns.reduce((sum, c) => sum + c.length, 0), "punto a la vista", "puntos a la vista")}
              </tspan>
            </text>
            {HEADS[b.space].map((h, c) => (
              <text key={h} className="gmap-band__head" x={COL[c].anchor === "end" ? COL[c].x + 8 : COL[c].x - 8} y={b.top + PAD + 36} textAnchor={COL[c].anchor}>
                {h} · {b.columns[c].length}
              </text>
            ))}
          </g>
        ))}

        <g className="msh-edges gmap-edges">
          {visible.edges.map((e) => {
            if (!layout.y.has(e.from) || !layout.y.has(e.to)) return null;
            const a = xy(e.from);
            const z = xy(e.to);
            return (
              <path
                key={e.key}
                d={curve(a.x, a.y, z.x, z.y)}
                pathLength={1}
                data-kind={e.kind}
                data-on={lit?.edges.has(e.key) || undefined}
                data-from-col={graph.byId.get(e.from)!.col}
                style={e.weight > 1 ? { strokeWidth: Math.min(3, 1 + Math.log2(e.weight) * 0.5) } : undefined}
              />
            );
          })}
        </g>

        <g className="gmap-bridges">
          {visible.bridges.map((b) => {
            if (!layout.y.has(b.a) || !layout.y.has(b.b)) return null;
            const a = xy(b.a);
            const z = xy(b.b);
            // Guardados (0122): si alguno de los que resume está aprobado, va de rayas; si todos esperan revisión, de puntos.
            const state = b.items.some((i) => !i.status) ? undefined : b.items.some(bridgeLive) ? "aprobada" : "propuesta";
            return (
              <g key={b.key} className="gmap-bridge" data-status={state} data-on={lit?.bridges.has(b.key) || undefined}>
                <title>{b.items.length === 1 ? `Puente: ${b.items[0].why} (${bridgeState(b.items[0])})` : `${b.items.length} puentes entre estos dos puntos`}</title>
                <path d={`M${a.x} ${a.y}C${LANE} ${a.y} ${LANE} ${z.y} ${z.x} ${z.y}`} />
                <path className="gmap-mark" d={diamond((a.x + 6 * LANE + z.x) / 8, (a.y + z.y) / 2, 4.5)} style={{ strokeDasharray: "none" }} />
              </g>
            );
          })}
        </g>

        <g className="msh-nodes">
          {visible.nodes.map((n) => {
            if (!layout.y.has(n.id)) return null;
            const c = COL[n.col];
            const p = xy(n.id);
            const tx = c.anchor === "end" ? -(c.r + 6) : c.r + 6;
            const bridged = visible.bridges.filter((b) => b.a === n.id || b.b === n.id).reduce((sum, b) => sum + b.items.length, 0);
            const isOpen = open.has(n.id);
            const label = clipLabel(n.label, c.max - (n.code ? n.code.length + 1 : 0));
            const boxed = n.kind === "documento" || n.kind === "curso";
            return (
              <g
                key={n.id}
                className="msh-node gmap-node"
                data-id={n.id}
                data-col={n.col}
                data-kind={n.kind}
                data-space={n.space}
                data-on={lit?.nodes.has(n.id) || undefined}
                data-sel={n.id === at || undefined}
                transform={`translate(${p.x} ${p.y})`}
                tabIndex={n.id === tabStop ? 0 : -1}
                role="button"
                aria-pressed={n.id === at}
                aria-expanded={foldable(n) ? isOpen : undefined}
                aria-label={`${kindName(n)} ${fullName(n)}, de ${SPACE_NAME[n.space]}${bridged ? `, con ${plural(bridged, "puente", "puentes")} al otro Pilo` : ""}${foldable(n) && !isOpen ? `, contiene ${n.kids.length}` : ""}`}
                onFocus={() => setFocusId(n.id)}
              >
                <title>{fullName(n)}</title>
                <rect className="msh-node__hit" x={c.anchor === "end" ? -(c.max * 6.4) - 12 : -8} y={-10} width={c.max * 6.4 + 20} height={20} rx={4} />
                {boxed ? <rect className="gmap-glyph" x={-c.r} y={-c.r} width={c.r * 2} height={c.r * 2} rx={2} /> : <circle className="gmap-glyph" r={c.r} />}
                {bridged > 0 && <path className="gmap-mark" d={diamond(c.anchor === "end" ? c.r + 8 : -(c.r + 8), 0, 4)} />}
                <text x={tx} dy="0.34em" textAnchor={c.anchor}>
                  {n.code && <tspan className="msh-node__code">{n.code} </tspan>}
                  {label}
                </text>
                {foldable(n) && (
                  <g className="gmap-toggle" data-toggle={n.id} transform={`translate(${c.r + (bridged ? 16 : 6)} -8)`} aria-hidden="true">
                    <title>{isOpen ? "Plegar lo que contiene" : `Abrir lo que contiene (${n.kids.length})`}</title>
                    <rect width={isOpen ? 16 : 14 + String(n.kids.length).length * 6} height={16} rx={8} />
                    <text x={isOpen ? 8 : (14 + String(n.kids.length).length * 6) / 2} y={11.5} textAnchor="middle">
                      {isOpen ? "–" : `+${n.kids.length}`}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/* --- El detalle de un punto ---------------------------------------------------------------- */

const SHOWN = 14;

function GlobalDetail({
  graph,
  node,
  open,
  animate,
  onSelect,
  onToggle,
}: {
  graph: GlobalGraph;
  node: GNode;
  open: ReadonlySet<string>;
  animate: boolean;
  onSelect: (id: string | null, how?: Via) => void;
  onToggle: (id: string) => void;
}) {
  const body = useRef<HTMLDivElement>(null);
  const detail = useMemo(() => detailOf(graph, node.id)!, [graph, node.id]);
  const isPlan = node.space === "planeacion";
  const isDoc = node.kind === "documento" || node.kind === "curso";
  const own = usePassage(isPlan ? node.raw : null, "planeacion");
  const docRefs = useDocRefs(isDoc ? node.raw.slice("doc:".length) : null);
  const [openRef, setOpenRef] = useState<string | null>(null);
  const [more, setMore] = useState<Record<string, boolean>>({});
  const [fullText, setFullText] = useState(false);
  const passage = usePassage(openRef, "ensenanza");

  useLayoutEffect(() => {
    setOpenRef(null);
    setMore({});
    setFullText(false);
    if (animate) swapPanel(body.current);
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = detail.route[0];
  const docNode = detail.route.find((n) => n.kind === "documento" || n.kind === "curso");
  const sourceName = source ? (source.kind === "fuente" ? PLAN_SOURCES[source.source] ?? source.label : source.label) : "";
  const docLabel = (ref: string) => graph.byId.get(`e|${ref.slice(0, ref.lastIndexOf(":")).toLowerCase()}`)?.label ?? "Documento";
  const refs: { ref: string; label: string }[] = isPlan
    ? []
    : isDoc
      ? (docRefs.data ?? []).map((p) => ({ ref: p.ref, label: p.section || `Pasaje ${p.seq}` }))
      : node.passages.map((ref) => ({ ref, label: `${docLabel(ref)} · pasaje ${ref.slice(ref.lastIndexOf(":") + 1)}` }));
  const text = own.data?.body ?? "";
  const canFold = node.col < 3 && node.kids.length > 0;

  const chips = (key: string, list: GNode[]) => (
    <div className="gmap-chips">
      {(more[key] ? list : list.slice(0, SHOWN)).map((n) => (
        <button key={n.id} type="button" className="gmap-chip" onClick={() => onSelect(n.id)} title={fullName(n)}>
          {clipLabel(fullName(n), 44)}
        </button>
      ))}
      {list.length > SHOWN && !more[key] && (
        <button type="button" className="pis-link" onClick={() => setMore((m) => ({ ...m, [key]: true }))}>
          Ver los {list.length.toLocaleString("es-CO")}
        </button>
      )}
    </div>
  );

  return (
    <div className="msh-detail" ref={body}>
      <header className="msh-detail__head">
        <span className="msh-detail__kind">
          <span className="gmap-owner">{SPACE_NAME[node.space]}</span>
          {kindName(node)}
          {node.code ? <b>{node.code}</b> : null}
        </span>
        <h4>{node.label}</h4>
        <button type="button" className="msh-close" aria-label="Soltar el punto" onClick={() => onSelect(null)}>
          <Icon name="close" size={16} />
        </button>
      </header>

      {detail.route.length > 1 && (
        <nav className="msh-route" aria-label="De dónde viene">
          <ol>
            {detail.route.map((r, i) => (
              <li key={r.id}>
                {i === detail.route.length - 1 ? (
                  <span aria-current="location">{r.code || clipLabel(r.label, 28)}</span>
                ) : (
                  <button type="button" onClick={() => onSelect(r.id)} title={fullName(r)}>
                    {i === 0 ? clipLabel(sourceName, 28) : r.code || clipLabel(r.label, 28)}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      <p className="pis-small">
        {isPlan ? "Fuente" : "Colección"}: <strong>{sourceName || (isPlan ? "sin fuente" : "varias: es de todos los documentos que lo tratan")}</strong>
        {docNode && docNode.id !== node.id ? (
          <>
            {" "}
            · Documento: <strong>{docNode.label}</strong>
          </>
        ) : null}
        {node.inside > 0 ? ` · ${plural(node.inside, "punto dentro", "puntos dentro")}` : ""}
      </p>

      {canFold && (
        <button type="button" className="button-secondary gmap-fold" onClick={() => onToggle(node.id)}>
          {open.has(node.id) ? "Plegar lo que contiene" : `Abrir en el mapa lo que contiene (${node.kids.length})`}
        </button>
      )}

      <section className="msh-detail__block" aria-label="Puentes con el otro Pilo">
        <h5>
          Puentes con {isPlan ? "Pilo en Enseñanza" : "Pregúntele a Pilo"} <small>{detail.bridges.length ? plural(detail.bridges.length, "puente", "puentes") : "ninguno"}</small>
        </h5>
        {detail.bridges.length === 0 ? (
          <p className="pis-small">
            {graph.stored
              ? "Ningún puente guardado une este punto con el otro Pilo. Los de reglas salen de la misma referencia o del mismo nombre; los demás los propone la IA y se revisan en «Puentes por revisar»."
              : "Nada del otro Pilo nombra lo mismo. Sin la migración 0122 los puentes se calculan por nombre o por la referencia que se cita; no se guardan en la base."}
          </p>
        ) : (
          <>
            <ul className="gmap-bridges">
              {(more.puentes ? detail.bridges : detail.bridges.slice(0, 6)).map((b) => (
                <li key={b.id ?? b.other.id} data-status={b.status}>
                  <button type="button" onClick={() => onSelect(b.other.id)}>
                    {fullName(b.other)}
                  </button>
                  <small>
                    {kindName(b.other)} de {SPACE_SHORT[b.other.space]} · {b.why}
                  </small>
                  {/* El estado y el origen, con glifo y texto: nunca solo con el trazo. */}
                  <small className="gmap-bridge-state">
                    <Icon name={b.status === "aprobada" ? "check" : "alert"} size={12} /> {bridgeState(b)}
                    {b.status === "propuesta" ? ": Pilo aún no lo sigue" : ""}
                  </small>
                </li>
              ))}
            </ul>
            {detail.bridges.length > 6 && !more.puentes && (
              <button type="button" className="pis-link" onClick={() => setMore((m) => ({ ...m, puentes: true }))}>
                Ver los {detail.bridges.length.toLocaleString("es-CO")} puentes
              </button>
            )}
          </>
        )}
      </section>

      {detail.links.map((group) => (
        <section key={group.title} className="msh-detail__block" aria-label={group.title}>
          <h5>
            {group.title} <small>{group.nodes.length.toLocaleString("es-CO")}</small>
          </h5>
          {chips(group.title, group.nodes)}
        </section>
      ))}

      {detail.kids.length > 0 && (
        <section className="msh-detail__block" aria-label="Lo que contiene">
          <h5>
            Contiene <small>{detail.kids.length.toLocaleString("es-CO")}</small>
          </h5>
          {chips("contiene", detail.kids)}
        </section>
      )}

      {isPlan ? (
        <section className="msh-detail__block" aria-label="Pasaje en la memoria">
          <h5>El pasaje que Pilo tiene</h5>
          {own.isPending ? (
            <div className="msh-lines" aria-busy="true">
              <span />
              <span />
              <span />
            </div>
          ) : own.isError ? (
            <p className="pis-error">No se pudo leer el pasaje: {(own.error as Error).message}</p>
          ) : !own.data ? (
            <p className="pis-small">Este punto no tiene pasaje propio: Pilo lo conoce solo por la malla.</p>
          ) : (
            <>
              <p className="msh-passage__meta">
                <strong>{own.data.title}</strong>
                {[own.data.section, own.data.cut && `Corte ${own.data.cut}`, own.data.office].filter(Boolean).join(" · ")}
              </p>
              <p className="msh-passage" data-clamped={!fullText && text.length > 520 ? "" : undefined}>
                {text}
              </p>
              {text.length > 520 && (
                <button type="button" className="pis-link" onClick={() => setFullText((v) => !v)}>
                  {fullText ? "Ver menos" : "Ver el pasaje completo"}
                </button>
              )}
            </>
          )}
        </section>
      ) : (
        node.kind !== "coleccion" && (
          <section className="msh-detail__block" aria-label="Pasajes que lo sostienen">
            <h5>
              Pasajes que lo sostienen <small>{isDoc && docRefs.isPending ? "leyendo…" : refs.length.toLocaleString("es-CO")}</small>
            </h5>
            {isDoc && docRefs.isError ? (
              <p className="pis-error">No se pudieron leer sus pasajes.</p>
            ) : refs.length === 0 && !(isDoc && docRefs.isPending) ? (
              <p className="pis-small">Sin pasajes en el mapa todavía.</p>
            ) : (
              <div className="gmap-chips">
                {(more.pasajes ? refs : refs.slice(0, 8)).map((r) => (
                  <button key={r.ref} type="button" className="gmap-chip" aria-pressed={openRef === r.ref} onClick={() => setOpenRef(openRef === r.ref ? null : r.ref)}>
                    {clipLabel(r.label, 48)}
                  </button>
                ))}
                {refs.length > 8 && !more.pasajes && (
                  <button type="button" className="pis-link" onClick={() => setMore((m) => ({ ...m, pasajes: true }))}>
                    Ver los {refs.length.toLocaleString("es-CO")}
                  </button>
                )}
              </div>
            )}
            {openRef &&
              (passage.isPending ? (
                <p className="pis-small">Leyendo el pasaje…</p>
              ) : passage.data ? (
                <>
                  <p className="msh-passage__meta">
                    <strong>{passage.data.title}</strong>
                    {passage.data.section}
                  </p>
                  <p className="msh-passage">{passage.data.body}</p>
                </>
              ) : (
                <p className="pis-small">Ese pasaje ya no está en la memoria (o está oculto).</p>
              ))}
          </section>
        )
      )}
    </div>
  );
}
