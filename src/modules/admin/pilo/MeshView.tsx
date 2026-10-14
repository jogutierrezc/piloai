/* =============================================================================
   Intranet · Mr. Pilo con IA · la malla de la memoria.

   Los pasajes dicen qué sabe Pilo; la malla dice dónde queda cada cosa y con
   qué se toca. Aquí se ve entera, fuente por fuente:

   - El Plan de Desarrollo se dibuja como el Mapa numerado: cuatro columnas
     (Pilar › Área estratégica › Línea de acción › Proyecto) con una curva
     por relación. Es SVG: son unos cientos de nodos y el SVG deja enfocar,
     resaltar y leer cada uno sin pintar a mano.
   - Las demás fuentes son un árbol que se abre por niveles. Nada se dibuja
     hasta que se abre, y un nivel muy largo muestra 60 y ofrece el resto:
     así dos mil nodos no cuestan dos mil filas.
   - Buscar por código (P1, AE3, LA12, PR4) o por nombre salta a la fuente del
     nodo, lo elige y lo trae a la vista.
   - Elegir un nodo resalta su cadena entera —todo lo que lo contiene, por
     cualquiera de sus padres, y todo lo que cuelga de él— y abre su panel: el
     pasaje que Pilo tiene de él (tabla pilo_memory, mismo ref), su ruta, lo
     que contiene, de qué más cuelga y el enlace a su página pública.
   - El nodo elegido va en la dirección (?nodo=…): se puede compartir.
   - «Mapa global de los dos Pilos» (?vista=global) cambia esta malla por el
     mapa que la une con la de Pilo en Enseñanza (mapa-global/GlobalMap).

   Teclado: en el mapa, las flechas recorren la columna (arriba y abajo) y la
   cadena (izquierda al padre, derecha al primer hijo); Intro elige; Escape
   suelta. Lo que se hace con el teclado no se anima.
   ========================================================================== */

import { Suspense, lazy, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MutableRefObject } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { Icon } from "../../../components/ui/Icon";
import { describeNode, TYPE_LABEL } from "../../../components/pilo/ai/logic";
import { MEMORY_SOURCES } from "./memory";
import type { MemorySource } from "./memory";
import { useMeshOverview } from "./mesh";
import { chainOf, clipLabel, countBySource, edgeKey, indexMesh, layoutPdi, PDI_COLUMNS, routeOf, searchNodes } from "./mesh-view";
import type { Chain, MeshIndex, PdiColumn, PdiLayout, ViewNode } from "./mesh-view";
import { drawChain, drawerIn, drawerOut, swapPanel } from "./motion";
import { plural } from "./ui";
import { DEFAULT_SPACE, readInSpace, spaceKey } from "./space";
import type { PiloSpace } from "./space";
import "./mesh-view.css";

type Via = "pointer" | "keyboard";

const typeName = (t: string, many = false) => TYPE_LABEL[t]?.[many ? 1 : 0] ?? t;
const sourceMeta = (id: string) => MEMORY_SOURCES.find((m) => m.id === id);
const fullName = (n: ViewNode) => (n.code ? `${n.code} · ${n.label}` : n.label);

function useNarrow(query = "(max-width: 1100px)") {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(query).matches));
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}

/** El pasaje de un nodo: mismo ref en pilo_memory, dentro de su espacio (0113). Solo lectura. */
export function usePassage(ref: string | null, space: PiloSpace = DEFAULT_SPACE) {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "pasaje", ref, ...spaceKey(space)],
    enabled: Boolean(ref),
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await readInSpace(space, (scoped) => {
        const query = supabase.from("pilo_memory").select("ref, title, section, body, path, cut, office").eq("ref", ref!);
        return (scoped ? query.eq("space", space) : query).maybeSingle();
      });
      if (error) throw error;
      return data as { ref: string; title: string; section: string; body: string; path: string; cut: string; office: string } | null;
    },
  });
}

/* --- La vista ---------------------------------------------------------------------------------- */

// El mapa global usa piezas de este archivo: se carga aparte, solo cuando se pide.
const GlobalMap = lazy(() => import("./mapa-global/GlobalMap"));

/** La malla de Pregúntele a Pilo o, a un clic, el mapa global de los dos Pilos. */
export function MeshView({ onAskRefresh }: { onAskRefresh: () => void }) {
  const [params, setParams] = useSearchParams();
  const global = params.get("vista") === "global";
  const show = (next: boolean) =>
    setParams(
      (prev) => {
        const out = new URLSearchParams(prev);
        if (next) out.set("vista", "global");
        else out.delete("vista");
        out.delete("nodo");
        return out;
      },
      { replace: true },
    );

  return (
    <div className="msh">
      <div className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Qué mapa se ve">
        <button type="button" role="radio" aria-checked={!global} onClick={() => show(false)}>
          Malla de Pregúntele a Pilo
        </button>
        <button type="button" role="radio" aria-checked={global} onClick={() => show(true)}>
          Mapa global de los dos Pilos
        </button>
      </div>
      {global ? (
        <Suspense
          fallback={
            <div className="msh-state" aria-busy="true">
              <span className="msh-skeleton" />
              <p>Abriendo el mapa global…</p>
            </div>
          }
        >
          <GlobalMap focus="todo" />
        </Suspense>
      ) : (
        <OwnMesh onAskRefresh={onAskRefresh} />
      )}
    </div>
  );
}

function OwnMesh({ onAskRefresh }: { onAskRefresh: () => void }) {
  const overview = useMeshOverview();
  const [params, setParams] = useSearchParams();
  const selected = params.get("nodo");
  const index = useMemo(() => (overview.data ? indexMesh(overview.data) : null), [overview.data]);
  const counts = useMemo(() => (index ? countBySource(index.nodes) : {}), [index]);
  const available = MEMORY_SOURCES.filter((m) => (counts[m.id] ?? 0) > 0);
  const [source, setSource] = useState<MemorySource | null>(null);
  const via = useRef<Via>("pointer");
  const narrow = useNarrow();

  const selectedNode = selected && index ? index.byId.get(selected) ?? null : null;
  // La fuente: la del nodo elegido; si no, la que se eligió; si no, el Plan (la vitrina) o la primera con nodos.
  const current: MemorySource | null =
    (selectedNode?.source as MemorySource | undefined) ?? source ?? (available.some((m) => m.id === "pdi") ? "pdi" : available[0]?.id ?? null);

  const select = useCallback(
    (id: string | null, how: Via = "pointer") => {
      via.current = how;
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id) next.set("nodo", id);
          else next.delete("nodo");
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const chain = useMemo(() => (index && selectedNode ? chainOf(index, selectedNode.id) : null), [index, selectedNode]);

  if (overview.isPending) {
    return (
      <div className="msh-state" aria-busy="true">
        <span className="msh-skeleton" />
        <p>Leyendo la malla…</p>
      </div>
    );
  }
  if (overview.data === null || overview.isError) {
    return (
      <div className="msh-state" role="note">
        <Icon name="alert" size={20} />
        <div>
          <strong>La malla aún no existe en la base.</strong>
          <p>Falta aplicar la migración 0097. Los pasajes siguen sirviendo; cuando esté aplicada, «Actualizar la memoria» arma la malla de cada fuente.</p>
        </div>
      </div>
    );
  }
  if (!index || available.length === 0) {
    return (
      <div className="msh-state" role="note">
        <Icon name="layers" size={20} />
        <div>
          <strong>La malla está vacía.</strong>
          <p>Se arma al actualizar la memoria: cada fuente deja sus nodos (pilares, informes, temas…) y cómo se contienen.</p>
          <button type="button" className="button-secondary" onClick={onAskRefresh}>
            Ir a «Actualizar la memoria»
          </button>
        </div>
      </div>
    );
  }

  const sourceNodes = index.nodes.filter((n) => n.source === current);
  const sourceEdges = index.edges.filter((e) => index.byId.get(e.from)?.source === current).length;

  return (
    <div
      className="msh"
      onKeyDown={(e) => {
        if (e.key === "Escape" && selectedNode && !e.defaultPrevented) select(null, "keyboard");
      }}
    >
      <div className="msh-bar">
        <div className="msh-sources" role="radiogroup" aria-label="Fuente de la malla">
          {MEMORY_SOURCES.map((m) => {
            const n = counts[m.id] ?? 0;
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={current === m.id}
                disabled={n === 0}
                title={n === 0 ? "Sin malla todavía" : undefined}
                onClick={() => {
                  setSource(m.id);
                  if (selectedNode && selectedNode.source !== m.id) select(null);
                }}
              >
                <span className="pis-code" data-s={m.id} aria-hidden="true">
                  {m.code}
                </span>
                {m.name}
                <span className="msh-count">{n.toLocaleString("es-CO")}</span>
              </button>
            );
          })}
        </div>
        <MeshSearch
          index={index}
          onPick={(id) => {
            const n = index.byId.get(id);
            if (n) setSource(n.source as MemorySource);
            select(id, "pointer");
          }}
        />
      </div>
      <p className="msh-meta">
        {sourceMeta(current ?? "")?.name}: {plural(sourceNodes.length - 1, "nodo", "nodos")} y {plural(sourceEdges, "relación", "relaciones")}.
        {current === "pdi" ? " Elija un nodo o recorra el mapa con las flechas." : " Abra un nivel para ver lo que contiene."}
      </p>

      <div className="msh-body" data-has-panel={Boolean(selectedNode) || undefined}>
        <div className="msh-stage">
          {current === "pdi" ? (
            <PdiCanvas index={index} chain={chain} selected={selectedNode?.id ?? null} via={via} onSelect={select} />
          ) : current ? (
            <MeshTree index={index} root={`fuente:${current}`} chain={chain} selected={selectedNode?.id ?? null} onSelect={select} />
          ) : null}
        </div>
        {narrow ? (
          selectedNode && <NodeDrawer index={index} node={selectedNode} onSelect={select} />
        ) : (
          <aside className="msh-panel" aria-label="Detalle del nodo">
            {selectedNode ? (
              <NodePanel index={index} node={selectedNode} onSelect={select} animate={via.current === "pointer"} />
            ) : (
              <div className="msh-panel__hint">
                <Icon name="compass" size={22} />
                <p>Elija un nodo para ver el pasaje que Pilo tiene de él, su ruta, lo que contiene y su página pública.</p>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/* --- Buscar un nodo ------------------------------------------------------------------------------ */

export function MeshSearch({ index, onPick }: { index: MeshIndex; onPick: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const results = useMemo(() => searchNodes(index.nodes, q, 12), [index, q]);
  const show = open && q.trim().length > 0;

  const pick = (n: ViewNode | undefined) => {
    if (!n) return;
    onPick(n.id);
    setOpen(false);
    setQ(n.code || n.label);
  };

  const onKey = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => Math.min(results.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      if (show) {
        e.preventDefault();
        pick(results[active]);
      }
    } else if (e.key === "Escape") {
      if (show) {
        e.stopPropagation();
        setOpen(false);
      } else setQ("");
    }
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
        aria-label="Buscar un nodo por código o nombre"
        placeholder="Buscar: P1, AE3, LA12, PR4 o un nombre"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
      />
      {show && (
        <ul className="msh-search__list" role="listbox" id={listId} aria-label="Nodos encontrados">
          {results.length === 0 ? (
            <li className="msh-search__none" role="option" aria-selected={false} aria-disabled="true">
              Ningún nodo tiene ese código o nombre.
            </li>
          ) : (
            results.map((n, i) => (
              <li
                key={n.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(n)}
              >
                <span className="pis-code" data-s={n.source} aria-hidden="true">
                  {sourceMeta(n.source)?.code}
                </span>
                <span>
                  <strong>{fullName(n)}</strong>
                  <small>
                    {typeName(n.type)} · {sourceMeta(n.source)?.name ?? n.source}
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

/* --- El Plan en columnas --------------------------------------------------------------------------- */

const COL: Record<PdiColumn, { x: number; anchor: "start" | "end"; max: number; r: number; head: string }> = {
  pilar: { x: 236, anchor: "end", max: 32, r: 6, head: "Pilares" },
  area: { x: 560, anchor: "end", max: 44, r: 4.5, head: "Áreas estratégicas" },
  linea: { x: 1010, anchor: "end", max: 66, r: 3.5, head: "Líneas de acción" },
  proyecto: { x: 1070, anchor: "start", max: 62, r: 5, head: "Proyectos" },
};
const WIDTH = 1500;
const TOP = 18;

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M${x1} ${y1}C${mx} ${y1} ${mx} ${y2} ${x2} ${y2}`;
};

function PdiCanvas({
  index,
  chain,
  selected,
  via,
  onSelect,
}: {
  index: MeshIndex;
  chain: Chain | null;
  selected: string | null;
  via: MutableRefObject<Via>;
  onSelect: (id: string | null, how?: Via) => void;
}) {
  const layout: PdiLayout = useMemo(() => layoutPdi(index), [index]);
  const frame = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const height = layout.height + TOP * 2;
  const tabStop = (selected && layout.byId.has(selected) ? selected : null) ?? focusId ?? layout.columns.pilar[0] ?? null;

  // La cadena se dibuja de la raíz hacia abajo, solo si se eligió con el puntero.
  useLayoutEffect(() => {
    if (!svg.current || !chain) return;
    const order = (el: Element) => PDI_COLUMNS.indexOf((el.getAttribute("data-from-col") ?? "pilar") as PdiColumn);
    const paths = [...svg.current.querySelectorAll<SVGPathElement>("path[data-on]")].sort((a, b) => order(a) - order(b));
    if (via.current === "pointer") drawChain(paths);
  }, [chain, via]);

  // El nodo elegido desde fuera (búsqueda, panel, dirección) se trae a la vista.
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
    f.scrollTo({
      top: inY ? f.scrollTop : Math.max(0, top - f.clientHeight / 2),
      left: inX ? f.scrollLeft : Math.max(0, x - f.clientWidth / 2),
      behavior: reduce || via.current === "keyboard" ? "auto" : "smooth",
    });
  }, [selected, layout, via]);

  const move = (id: string | null) => {
    if (!id) return;
    setFocusId(id);
    requestAnimationFrame(() => svg.current?.querySelector<SVGGElement>(`[data-id="${CSS.escape(id)}"]`)?.focus());
  };

  const onKey = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    const id = (e.target as Element).closest("[data-id]")?.getAttribute("data-id");
    if (!id) return;
    const p = layout.byId.get(id);
    if (!p) return;
    const col = layout.columns[p.column];
    const at = col.indexOf(id);
    const nearest = (target: string[]) => target.reduce<string | null>((best, c) => {
      const cy = layout.byId.get(c)!.y;
      return !best || Math.abs(cy - p.y) < Math.abs(layout.byId.get(best)!.y - p.y) ? c : best;
    }, null);
    let handled = true;
    if (e.key === "ArrowDown") move(col[Math.min(col.length - 1, at + 1)]);
    else if (e.key === "ArrowUp") move(col[Math.max(0, at - 1)]);
    else if (e.key === "Home") move(col[0]);
    else if (e.key === "End") move(col[col.length - 1]);
    else if (e.key === "ArrowLeft") {
      const up = (index.parents.get(id) ?? []).filter((x) => layout.byId.has(x));
      move(up.length ? nearest(up) : null);
    } else if (e.key === "ArrowRight") {
      const down = (index.kids.get(id) ?? []).filter((x) => layout.byId.has(x));
      move(down.length ? nearest(down) : null);
    } else if (e.key === "Enter" || e.key === " ") onSelect(id === selected ? null : id, "keyboard");
    else if (e.key === "Escape" && selected) onSelect(null, "keyboard");
    else handled = false;
    if (handled) e.preventDefault();
  };

  if (!layout.placed.length) return <p className="pis-small">El Plan de Desarrollo aún no tiene nodos en la malla.</p>;

  return (
    <div className="msh-frame" ref={frame}>
      <div className="msh-heads" style={{ width: WIDTH }} aria-hidden="true">
        {PDI_COLUMNS.map((c) => (
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
        aria-label="Mapa del Plan de Desarrollo: pilares, áreas estratégicas, líneas de acción y proyectos"
        data-focus={chain ? "" : undefined}
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
          {layout.edges.map((e) => {
            const a = layout.byId.get(e.from)!;
            const b = layout.byId.get(e.to)!;
            const on = chain?.edges.has(edgeKey(e.from, e.to)) || undefined;
            return (
              <path
                key={edgeKey(e.from, e.to)}
                d={curve(COL[a.column].x, a.y + TOP, COL[b.column].x, b.y + TOP)}
                pathLength={1}
                data-on={on}
                data-from-col={a.column}
              />
            );
          })}
        </g>
        <g className="msh-nodes">
          {layout.placed.map((p) => {
            const n = index.byId.get(p.id)!;
            const c = COL[p.column];
            const text = clipLabel(n.label, c.max - (n.code?.length ?? 0));
            const tx = c.anchor === "end" ? -(c.r + 6) : c.r + 6;
            return (
              <g
                key={p.id}
                className="msh-node"
                data-id={p.id}
                data-col={p.column}
                data-on={chain?.nodes.has(p.id) || undefined}
                data-sel={p.id === selected || undefined}
                transform={`translate(${c.x} ${p.y + TOP})`}
                tabIndex={p.id === tabStop ? 0 : -1}
                role="button"
                aria-pressed={p.id === selected}
                aria-label={`${typeName(n.type)} ${fullName(n)}`}
                onFocus={() => setFocusId(p.id)}
              >
                <title>{fullName(n)}</title>
                <rect className="msh-node__hit" x={c.anchor === "end" ? -(c.max * 6.4) - 12 : -8} y={-9} width={c.max * 6.4 + 20} height={18} rx={4} />
                <circle r={c.r} />
                <text x={tx} dy="0.34em" textAnchor={c.anchor}>
                  {n.code && <tspan className="msh-node__code">{n.code} </tspan>}
                  {text}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

/* --- Las demás fuentes: un árbol ------------------------------------------------------------------ */

const PAGE = 60;

export function MeshTree({
  index,
  root,
  chain,
  selected,
  onSelect,
}: {
  index: MeshIndex;
  root: string;
  chain: Chain | null;
  selected: string | null;
  onSelect: (id: string | null, how?: Via) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const [shown, setShown] = useState<Record<string, number>>({});
  const rowRef = useRef<HTMLDivElement>(null);

  // Lo que contiene al nodo elegido se abre solo, y el nodo se trae a la vista.
  useEffect(() => {
    if (!chain || !selected) return;
    setOpen((prev) => new Set([...prev, ...chain.up]));
    setShown((prev) => {
      const next = { ...prev };
      for (const up of chain.up) {
        const list = index.kids.get(up) ?? [];
        const at = list.indexOf(selected);
        if (at >= (next[up] ?? PAGE)) next[up] = at + 1;
      }
      return next;
    });
  }, [chain, selected, index]);

  useEffect(() => {
    if (!selected) return;
    const id = requestAnimationFrame(() => {
      rowRef.current?.querySelector(`[data-id="${CSS.escape(selected)}"]`)?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(id);
  }, [selected, open]);

  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderLevel = (parent: string, depth: number): JSX.Element | null => {
    const kids = index.kids.get(parent) ?? [];
    if (!kids.length) return null;
    const limit = shown[parent] ?? PAGE;
    return (
      <ul className="msh-tree__level" role={depth === 0 ? "list" : undefined}>
        {kids.slice(0, limit).map((id) => {
          const n = index.byId.get(id);
          if (!n) return null;
          const count = index.kids.get(id)?.length ?? 0;
          const isOpen = open.has(id);
          return (
            <li key={id}>
              <div className="msh-tree__row" data-id={id} data-sel={id === selected || undefined} data-chain={chain?.nodes.has(id) || undefined}>
                {count > 0 ? (
                  <button type="button" className="msh-tree__caret" aria-expanded={isOpen} aria-label={`${isOpen ? "Cerrar" : "Abrir"} ${n.label}`} onClick={() => toggle(id)}>
                    <Icon name="chevron-down" size={14} />
                  </button>
                ) : (
                  <span className="msh-tree__caret" aria-hidden="true" />
                )}
                <button type="button" className="msh-tree__name" aria-pressed={id === selected} onClick={() => onSelect(id === selected ? null : id)}>
                  <strong>{fullName(n)}</strong>
                  <small>
                    {typeName(n.type)}
                    {count ? ` · ${plural(count, "elemento", "elementos")}` : ""}
                  </small>
                </button>
              </div>
              {isOpen && renderLevel(id, depth + 1)}
            </li>
          );
        })}
        {kids.length > limit && (
          <li>
            <button type="button" className="pis-link msh-tree__more" onClick={() => setShown((prev) => ({ ...prev, [parent]: limit + PAGE }))}>
              Mostrar {Math.min(PAGE, kids.length - limit)} más de {kids.length.toLocaleString("es-CO")}
            </button>
          </li>
        )}
      </ul>
    );
  };

  return (
    <div className="msh-tree" ref={rowRef}>
      {renderLevel(root, 0) ?? <p className="pis-small">Esta fuente aún no tiene nodos en la malla.</p>}
    </div>
  );
}

/* --- El panel del nodo ---------------------------------------------------------------------------- */

const KIDS_SHOWN = 24;

export function NodePanel({
  index,
  node,
  onSelect,
  animate,
  space = DEFAULT_SPACE,
}: {
  index: MeshIndex;
  node: ViewNode;
  onSelect: (id: string | null, how?: Via) => void;
  animate: boolean;
  /** De qué Pilo es la malla (0113): su pasaje se busca en ese espacio. */
  space?: PiloSpace;
}) {
  const body = useRef<HTMLDivElement>(null);
  const passage = usePassage(node.id, space);
  const [allKids, setAllKids] = useState(false);
  const [fullText, setFullText] = useState(false);
  const route = useMemo(() => routeOf(index, node.id), [index, node.id]);
  const kids = useMemo(() => (index.kids.get(node.id) ?? []).map((k) => index.byId.get(k)!).filter(Boolean), [index, node.id]);
  const alsoIn = useMemo(() => (index.parents.get(node.id) ?? []).slice(1).map((k) => index.byId.get(k)!).filter(Boolean), [index, node.id]);
  const links = index.links.get(node.id) ?? [];
  const said = useMemo(() => describeNode({ nodes: index.nodes, edges: index.edges }, node.id).replace(/\s*\[\d+\]/g, ""), [index, node.id]);

  useLayoutEffect(() => {
    setAllKids(false);
    setFullText(false);
    if (animate) swapPanel(body.current);
  }, [node.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const byType = new Map<string, ViewNode[]>();
  for (const k of kids) byType.set(k.type, [...(byType.get(k.type) ?? []), k]);
  const shownKids = allKids ? kids : kids.slice(0, KIDS_SHOWN);
  const external = /^https?:/i.test(node.path ?? "");
  const text = passage.data?.body ?? "";

  return (
    <div className="msh-detail" ref={body}>
      <header className="msh-detail__head">
        <span className="msh-detail__kind">
          <span className="pis-code" data-s={node.source} aria-hidden="true">
            {sourceMeta(node.source)?.code}
          </span>
          {typeName(node.type)}
          {node.code ? <b>{node.code}</b> : null}
        </span>
        <h4>{node.label}</h4>
        <button type="button" className="msh-close" aria-label="Soltar el nodo" onClick={() => onSelect(null)}>
          <Icon name="close" size={16} />
        </button>
      </header>

      {route.length > 1 && (
        <nav className="msh-route" aria-label="Ruta del nodo">
          <ol>
            {route.map((r, i) => (
              <li key={r.id}>
                {i === route.length - 1 ? (
                  <span aria-current="location">{r.code || clipLabel(r.label, 28)}</span>
                ) : (
                  <button type="button" onClick={() => onSelect(r.id)} title={fullName(r)}>
                    {r.type === "fuente" ? sourceMeta(r.source)?.name ?? r.label : r.code || clipLabel(r.label, 28)}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </nav>
      )}

      {node.path && (
        <p className="msh-detail__link">
          {external ? (
            <a href={node.path} target="_blank" rel="noopener noreferrer" className="pis-link">
              Ver su página pública <Icon name="external" size={14} />
            </a>
          ) : (
            <Link to={node.path} target="_blank" rel="noopener" className="pis-link">
              Ver su página pública <Icon name="external" size={14} />
            </Link>
          )}
          <code>{node.path}</code>
        </p>
      )}

      <section className="msh-detail__block" aria-label="Pasaje en la memoria">
        <h5>El pasaje que Pilo tiene</h5>
        {passage.isPending ? (
          <div className="msh-lines" aria-busy="true">
            <span />
            <span />
            <span />
          </div>
        ) : passage.isError ? (
          <p className="pis-error">No se pudo leer el pasaje: {(passage.error as Error).message}</p>
        ) : !passage.data ? (
          <p className="pis-small">Este nodo no tiene pasaje propio: Pilo lo conoce solo por la malla. Se crea al actualizar la memoria si la fuente lo publica.</p>
        ) : (
          <>
            <p className="msh-passage__meta">
              <strong>{passage.data.title}</strong>
              {[passage.data.section, passage.data.cut && `Corte ${passage.data.cut}`, passage.data.office].filter(Boolean).join(" · ")}
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

      {said && (
        <section className="msh-detail__block" aria-label="Lo que diría Pilo">
          <h5>Si le preguntan dónde queda</h5>
          <p className="msh-said">{said}</p>
        </section>
      )}

      <section className="msh-detail__block" aria-label="Lo que contiene">
        <h5>
          Contiene{" "}
          <small>{kids.length ? [...byType].map(([t, l]) => `${l.length.toLocaleString("es-CO")} ${typeName(t, l.length !== 1)}`).join(" · ") : "nada por debajo"}</small>
        </h5>
        {kids.length > 0 && (
          <ul className="msh-links">
            {shownKids.map((k) => (
              <li key={k.id}>
                <button type="button" onClick={() => onSelect(k.id)}>
                  {k.code ? <b>{k.code}</b> : null}
                  {k.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        {kids.length > KIDS_SHOWN && (
          <button type="button" className="pis-link" onClick={() => setAllKids((v) => !v)}>
            {allKids ? "Ver menos" : `Ver los ${kids.length.toLocaleString("es-CO")}`}
          </button>
        )}
      </section>

      {(alsoIn.length > 0 || links.length > 0) && (
        <section className="msh-detail__block" aria-label="Lo que lo enlaza">
          <h5>También cuelga de</h5>
          <ul className="msh-links">
            {alsoIn.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => onSelect(p.id)}>
                  {p.code ? <b>{p.code}</b> : null}
                  {p.label}
                </button>
              </li>
            ))}
            {links.map((l) => {
              const other = index.byId.get(l.from === node.id ? l.to : l.from);
              return other ? (
                <li key={`${l.from}-${l.rel}-${l.to}`}>
                  <button type="button" onClick={() => onSelect(other.id)}>
                    <small>{l.rel}</small>
                    {fullName(other)}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
        </section>
      )}
    </div>
  );
}

/** En pantallas estrechas el panel es un cajón a la derecha. */
function NodeDrawer({ index, node, onSelect }: { index: MeshIndex; node: ViewNode; onSelect: (id: string | null, how?: Via) => void }) {
  const ref = useRef<HTMLElement>(null);
  const closing = useRef(false);

  useLayoutEffect(() => {
    drawerIn(ref.current);
    ref.current?.querySelector<HTMLButtonElement>(".msh-close")?.focus({ preventScroll: true });
  }, []);

  const close = useCallback(
    (next: string | null) => {
      if (next) return onSelect(next);
      if (closing.current) return;
      closing.current = true;
      void drawerOut(ref.current).then(() => {
        closing.current = false;
        onSelect(null);
      });
    },
    [onSelect],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <aside className="msh-drawer" ref={ref} aria-label="Detalle del nodo">
      <NodePanel index={index} node={node} onSelect={(id) => close(id)} animate />
    </aside>
  );
}
