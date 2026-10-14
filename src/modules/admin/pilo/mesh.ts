/* =============================================================================
   Pregúntele a Pilo · la malla de la memoria.

   Los pasajes dicen qué hay; la malla dice dónde queda y con qué se toca.
   Cada nodo lleva el mismo id que el pasaje que lo describe, así la búsqueda
   de texto encuentra el pasaje y la malla le da su lugar (pilo-ia usa las dos).

   - Plan de Desarrollo: el mismo árbol del Mapa numerado (buildNetwork) con su
     misma numeración: P1 › AE3 › LA12 › PR4. Además de los nodos, deja un
     pasaje por área y por línea (antes no había) y uno con el mapa entero,
     para que Pilo encuentre también la estructura.
   - Las demás fuentes: su malla sale de los refs de sus pasajes
     (cifras:informe › cifras:informe:indicador, observatorio:tema › …:tabla).
   - Cada fuente tiene una raíz (fuente:pdi, fuente:cifras…) con su pasaje:
     «UDES en Cifras tiene 11 informes: …».

   Aquí también están las consultas con que la intranet dibuja la malla.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { buildNetwork } from "../../implementation/network";
import type { NetworkColumn } from "../../implementation/network";
import type { AreaWithLines, PillarWithProgress } from "../../../data/queries";
import type { ProjectWithLinks } from "../../../types/database";
import type { Mesh, MeshEdge, MeshNode } from "../../../components/pilo/ai/logic";
import { MEMORY_SOURCES, clean, finalize } from "./memory";
import type { MemoryRow, MemorySource } from "./memory";

export type { Mesh, MeshEdge, MeshNode };

/** Lo que se manda a pilo_graph_replace por fuente. */
export interface MeshPayload {
  nodes: (Omit<MeshNode, "source"> & { props?: Record<string, unknown> })[];
  edges: MeshEdge[];
  /** Pasajes nuevos que nacen de la malla (áreas, líneas, raíces). */
  rows: MemoryRow[];
}

export const ROOT_LABEL: Record<MemorySource, string> = {
  pdi: "Plan de Desarrollo Institucional 2024-2028",
  cifras: "UDES en Cifras",
  boletines: "Boletines de UDES en Cifras",
  observatorio: "Observatorio de Analítica Académica",
  impacto: "Portal de Impacto",
};

const ROOT_PATH: Record<MemorySource, string> = {
  pdi: "/implementacion",
  cifras: "/datos-abiertos",
  boletines: "/datos-abiertos/boletines",
  observatorio: "/datos-abiertos/observatorio",
  impacto: "/impacto",
};

const MONEY = /dinero|peso|\$|cop\b|millones|presupuest/i;
const TYPE_OF: Record<NetworkColumn, string> = { pilar: "pilar", area: "area", linea: "linea", proyecto: "proyecto" };

/** «1 pilar», «6 pilares». */
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const list = (names: string[], max = 20) => {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return rest > 0 ? `${shown.join("; ")} y ${rest} más` : shown.join("; ");
};

/* --- Plan de Desarrollo ------------------------------------------------------------------ */

export function pdiMesh(
  pillars: PillarWithProgress[] | null | undefined,
  areas: AreaWithLines[] | null | undefined,
  projects: ProjectWithLinks[] | null | undefined,
): MeshPayload {
  const published = (pillars ?? []).filter((p) => p?.status === "publicado" && clean(p.slug) && clean(p.name) && !MONEY.test(p.name));
  const pillarIds = new Set(published.map((p) => p.id));
  const net = buildNetwork({
    pillars: published,
    areas: (areas ?? []).filter((a) => a && pillarIds.has(a.pillar_id)),
    projects: (projects ?? []).filter((r) => r && clean(r.name) && !MONEY.test(r.name)),
  });
  const slugOf = new Map(published.map((p) => [p.id, clean(p.slug)]));
  const idOf = (netId: string): string => {
    const [kind, uuid] = [netId.slice(0, 1), netId.slice(2)];
    if (kind === "p") return `pdi:pilar:${slugOf.get(uuid) ?? uuid}`;
    if (kind === "a") return `pdi:area:${uuid}`;
    if (kind === "l") return `pdi:linea:${uuid}`;
    return `pdi:proyecto:${uuid}`;
  };
  const pathOf = (pillarIdsOfNode: string[]) => {
    const slug = pillarIdsOfNode.map((id) => slugOf.get(id)).find(Boolean);
    return slug ? `/implementacion/pilar/${slug}` : "/implementacion";
  };

  const root = "fuente:pdi";
  const nodes: MeshPayload["nodes"] = [{ id: root, type: "fuente", code: "", label: ROOT_LABEL.pdi, path: ROOT_PATH.pdi }];
  const edges: MeshEdge[] = [];
  for (const n of net.nodes) {
    nodes.push({ id: idOf(n.id), type: TYPE_OF[n.column], code: n.code, label: clean(n.name), path: pathOf(n.pillarIds), props: { meta: n.meta.map(clean).filter(Boolean) } });
    if (n.column === "pilar") edges.push({ from: root, to: idOf(n.id), rel: "contiene" });
  }
  for (const e of net.edges) edges.push({ from: idOf(e.from), to: idOf(e.to), rel: "contiene" });

  // Los pasajes de la estructura: la raíz, cada área y cada línea, con su ruta y lo que contienen.
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = (id: string) => edges.filter((e) => e.from === id).map((e) => byId.get(e.to)!).filter(Boolean);
  const parents = (id: string) => edges.filter((e) => e.to === id).map((e) => byId.get(e.from)!).filter(Boolean);
  const name = (n: { code: string; label: string }) => (n.code ? `${n.code} ${n.label}` : n.label);
  const route = (id: string): string => {
    const out: string[] = [];
    let current = byId.get(id);
    const seen = new Set<string>();
    while (current && current.type !== "fuente" && !seen.has(current.id)) {
      seen.add(current.id);
      out.unshift(name(current));
      current = parents(current.id)[0];
    }
    return out.join(" › ");
  };
  const rows: Partial<MemoryRow>[] = [];
  const pillarsNodes = kids(root);
  rows.push({
    ref: root,
    title: "Mapa numerado del Plan de Desarrollo Institucional",
    section: ROOT_LABEL.pdi,
    body: [
      `El Plan de Desarrollo Institucional tiene ${count(net.counts.pilares, "pilar", "pilares")}, ${count(net.counts.areas, "área estratégica", "áreas estratégicas")}, ${count(net.counts.lineas, "línea de acción", "líneas de acción")} y ${count(net.counts.proyectos, "proyecto", "proyectos")}, numerados como en el Mapa numerado (Pilar › Área estratégica › Línea de acción › Proyecto).`,
      ...pillarsNodes.map((p) => {
        const areasOf = kids(p.id);
        return `${name(p)}: ${areasOf.length} ${areasOf.length === 1 ? "área estratégica" : "áreas estratégicas"} (${list(areasOf.map(name), 12)}).`;
      }),
    ].join(" "),
    path: "/implementacion#mapa",
    cut: String(new Date().getFullYear()),
    office: "Oficina de Planeación Institucional",
  });
  for (const n of nodes) {
    if (n.type !== "area" && n.type !== "linea") continue;
    const children = kids(n.id);
    const lines = children.filter((c) => c.type === "linea");
    const projectsOf = children.filter((c) => c.type === "proyecto");
    rows.push({
      ref: n.id,
      title: `${n.code} · ${n.label}`,
      section: `${n.type === "area" ? "Área estratégica" : "Línea de acción"} del Plan de Desarrollo`,
      body: [
        `${n.type === "area" ? "Área estratégica" : "Línea de acción"} ${name(n)}. Ruta: ${route(n.id)}.`,
        lines.length ? `Tiene ${lines.length} ${lines.length === 1 ? "línea de acción" : "líneas de acción"}: ${list(lines.map(name))}.` : "",
        projectsOf.length ? `Proyectos vinculados: ${list(projectsOf.map(name))}.` : n.type === "linea" ? "Aún no tiene proyectos vinculados." : "",
      ]
        .filter(Boolean)
        .join(" "),
      path: n.path,
      cut: String(new Date().getFullYear()),
      office: "",
    });
  }
  return { nodes, edges, rows: finalize(rows) };
}

/* --- Las demás fuentes, desde sus pasajes --------------------------------------------------- */

function typeFor(source: MemorySource, ref: string): string {
  const parts = ref.split(":");
  if (source === "cifras") return parts.length > 2 ? "indicador" : "informe";
  if (source === "boletines") return parts[1] === "edicion" ? "edicion" : "boletin";
  if (source === "observatorio") return parts.length > 2 ? "tabla" : "tema";
  if (source === "impacto") return parts[1] === "programa" ? "programa" : parts[1] === "indicador" ? "indicador" : "tema";
  return "nodo";
}

/**
 * La malla de una fuente a partir de sus pasajes: la raíz contiene lo de
 * primer nivel y cada ref «a:b:c» cuelga de «a:b» si existe.
 */
export function meshFromRows(source: MemorySource, rows: MemoryRow[]): MeshPayload {
  const root = `fuente:${source}`;
  const refs = new Set(rows.map((r) => r.ref));
  const nodes: MeshPayload["nodes"] = [{ id: root, type: "fuente", code: "", label: ROOT_LABEL[source], path: ROOT_PATH[source] }];
  const edges: MeshEdge[] = [];
  for (const r of rows) {
    if (r.ref === root) continue;
    nodes.push({ id: r.ref, type: typeFor(source, r.ref), code: "", label: r.title, path: r.path, props: r.cut ? { cut: r.cut } : {} });
    const parts = r.ref.split(":");
    const parent = parts.length > 2 ? parts.slice(0, 2).join(":") : null;
    edges.push({ from: parent && refs.has(parent) ? parent : root, to: r.ref, rel: "contiene" });
  }
  const top = edges.filter((e) => e.from === root).map((e) => nodes.find((n) => n.id === e.to)!).filter(Boolean);
  const kinds = new Map<string, string[]>();
  for (const n of top) kinds.set(n.type, [...(kinds.get(n.type) ?? []), n.label]);
  const LABEL: Record<string, [string, string]> = {
    informe: ["informe", "informes"],
    boletin: ["boletín en línea", "boletines en línea"],
    edicion: ["edición en PDF", "ediciones en PDF"],
    tema: ["tema", "temas"],
    programa: ["programa", "programas"],
    indicador: ["indicador", "indicadores"],
  };
  const rootRow = finalize([
    {
      ref: root,
      title: ROOT_LABEL[source],
      section: "Lo que conoce Pilo",
      body: [...kinds].map(([type, names]) => `${ROOT_LABEL[source]} tiene ${count(names.length, ...(LABEL[type] ?? [type, type]))}: ${list(names, 30)}.`).join(" "),
      path: ROOT_PATH[source],
      cut: "",
      office: "Oficina de Planeación Institucional",
    },
  ]);
  return { nodes, edges, rows: rootRow };
}

/* --- Las consultas de la intranet --------------------------------------------------------- */

interface RawMesh {
  nodes?: (MeshNode & { props?: Record<string, unknown> })[] | null;
  edges?: MeshEdge[] | null;
}

const toMesh = (raw: unknown): Mesh & { nodes: (MeshNode & { props?: Record<string, unknown> })[] } => {
  const r = (raw ?? {}) as RawMesh;
  return { nodes: Array.isArray(r.nodes) ? r.nodes : [], edges: Array.isArray(r.edges) ? r.edges : [] };
};

/**
 * Toda la malla de los portales (o la de unas fuentes). Sin 0097: null. Se piden las fuentes por su
 * nombre: desde 0121 el ámbito tiene además el mapa de sus documentos (fuente «mapa»), que no es
 * parte de esta malla.
 */
export function useMeshOverview(sources?: MemorySource[]) {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "malla", sources ?? "todas"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pilo_graph_overview", { p_sources: (sources ?? MEMORY_SOURCES.map((s) => s.id)) as never });
      if (error) return null;
      return toMesh(data);
    },
    staleTime: 60_000,
  });
}

/** Un trozo de malla alrededor de unos nodos: su ruta hacia arriba y lo que contienen. */
export function useMeshAround(ids: string[], depthDown = 1) {
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "malla", "alrededor", ids, depthDown],
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("pilo_graph_around", { p_ids: ids, p_sources: null as never, p_up: 6, p_down: depthDown, p_limit: 160 });
      if (error) return null;
      return toMesh(data);
    },
  });
}
