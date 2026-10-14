/* =============================================================================
   Mapa numerado de relacionamiento · el modelo y el trazado

   Traduce lo que hay en la base —pilares, áreas, líneas y proyectos— a la
   rejilla de columnas del mapa: cuatro columnas, un nodo por fila y una curva
   por relación.

   Hubo una quinta columna con los ODS y se retiró. Un objetivo cuelga de varios
   proyectos repartidos por todo el alto del mapa, así que se situaba en el
   promedio de unos nodos que no tienen nada que ver entre sí y sus curvas
   cruzaban el lienzo entero: enredaba el dibujo sin responder ninguna pregunta.
   Los ODS de cada proyecto siguen a un golpe de cursor, en su ficha flotante, y
   la lectura completa —los diecisiete, con lo que aporta cada pilar— es la
   página "PDI y los ODS", que existe para eso.

   El diseño original (`Mapa_Red_Pilares_Proyectos.html`) traía las posiciones
   `y` ya calculadas dentro del HTML: alguien las había resuelto fuera y las
   pegó. Eso funciona una vez y envejece a la primera línea de acción nueva. Se
   calculan aquí, en cada carga, con la misma regla que se deduce de aquellos
   números:

     · Las líneas de acción son las hojas. Ocupan una fila cada una, a 17px,
       en el orden del plan: pilar, área, línea.
     · Un área se sitúa en el promedio de sus líneas.
     · Un pilar, en el promedio de sus áreas.
     · Un proyecto, en el promedio de todo aquello a lo que se vincula.

   Así el mapa se ordena solo y ningún nodo cruza la mitad del lienzo para
   llegar a los suyos.

   Lo que el diseño no contemplaba y la base sí permite: un área sin líneas, un
   pilar sin áreas y un proyecto vinculado a un área o a un pilar entero sin
   pasar por una línea. Todos reciben su propia fila; desaparecerlos escondería
   justamente la estructura que el mapa existe para mostrar.
   ========================================================================== */

import { accentFor, pillarsOfProject, sdgById } from "../../data/pdi";
import type { AreaWithLines, PillarWithProgress } from "../../data/queries";
import type { ProjectWithLinks } from "../../types/database";

export type NetworkColumn = "pilar" | "area" | "linea" | "proyecto";

export interface NetworkNode {
  /** Único en todo el mapa: el prefijo evita que un área y una línea con el
   *  mismo uuid —imposible, pero barato de descartar— se pisen. */
  id: string;
  column: NetworkColumn;
  /** El número del mapa: P1, AE3, LA12, PR4. */
  code: string;
  name: string;
  y: number;
  /** Color del nodo. La estructura hereda el del pilar; el proyecto lleva uno
   *  neutro, porque uno que aporta a tres pilares no puede tener el de uno. */
  color: string;
  /** A qué pilares pertenece. Un proyecto puede pertenecer a varios; el resto,
   *  a uno. */
  pillarIds: string[];
  /** Líneas del pie de la ficha flotante. */
  meta: string[];
  /** Cuánto pesa el nodo, si quien construyó el mapa pasó pesos. Cero en la
   *  pantalla pública, que no maneja cifras de dinero. */
  value: number;
}

export interface NetworkEdge {
  key: string;
  from: string;
  to: string;
  color: string;
  pillarIds: string[];
  /** El proyecto que toca la arista, si lo toca. Es lo que permite quedarse
   *  solo con las relaciones que tienen presupuesto declarado. */
  projectId: string | null;
  value: number;
}

export interface Network {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  /** Alto del lienzo, sin los márgenes. */
  height: number;
  counts: {
    pilares: number;
    areas: number;
    lineas: number;
    proyectos: number;
    relaciones: number;
  };
}

/** Alto de fila de una hoja. Del diseño original: 17px entre líneas de acción. */
const ROW = 17;

/** El color neutro de los proyectos: no pueden llevar el de un pilar porque
 *  pertenecen a varios. */
const PROJECT_COLOR = "var(--ink-faint)";

/** "AE-03" y "Flexibilidad curricular" no caben los dos en la etiqueta; el
 *  código institucional baja a la ficha flotante. */
function withCode(code: string | null | undefined, label: string): string[] {
  return code ? [`Nomenclatura del plan: ${code}`, label] : [label];
}

/** Recorta un nombre largo para que no invada la columna siguiente. El nombre
 *  completo sigue estando en la ficha flotante. */
function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

interface BuildInput {
  pillars: PillarWithProgress[];
  /** Áreas de todo el plan, con sus líneas embebidas. */
  areas: AreaWithLines[];
  projects: ProjectWithLinks[];
  /**
   * Cuánto pesa cada proyecto, por id. Solo lo pasa el módulo de presupuesto de
   * la intranet; la pantalla pública lo omite y todos los pesos quedan en cero.
   *
   * Va como parámetro y no se lee de `projects` porque el tipo público del
   * proyecto ya no trae cifras de dinero —la migración 0015 las sacó de la vista
   * que leen las páginas abiertas—, y ese es justamente el punto: el mapa
   * público no puede pintar presupuesto ni queriendo.
   */
  weights?: Map<string, number>;
}

/**
 * Arma el mapa completo.
 *
 * El orden de las filas es el del plan —`position` en cada nivel—, no el de
 * llegada de la consulta: dos cargas de la misma página tienen que dibujar el
 * mismo mapa.
 */
export function buildNetwork({ pillars, areas, projects, weights }: BuildInput): Network {
  const nodes: NetworkNode[] = [];
  const edges: NetworkEdge[] = [];

  const orderedPillars = [...pillars].sort((a, b) => a.position - b.position);
  const areasByPillar = new Map<string, AreaWithLines[]>();
  for (const area of areas) {
    const list = areasByPillar.get(area.pillar_id) ?? [];
    list.push(area);
    areasByPillar.set(area.pillar_id, list);
  }
  for (const list of areasByPillar.values()) list.sort((a, b) => a.position - b.position);

  /* --- Paso 1: las filas -------------------------------------------------
     Se recorre el árbol en el orden del plan y cada hoja consume una fila. Un
     área sin líneas y un pilar sin áreas son hojas también: si no consumieran
     fila, no tendrían dónde situarse. */
  let row = 0;
  const nextY = () => ROW * row++ + ROW / 2;

  const yByNode = new Map<string, number>();
  const pillarAccent = new Map<string, string>();

  for (const pillar of orderedPillars) {
    pillarAccent.set(pillar.id, accentFor(pillar.accent_slot));
    const ownAreas = areasByPillar.get(pillar.id) ?? [];
    const areaYs: number[] = [];

    for (const area of ownAreas) {
      const ownLines = [...(area.action_lines ?? [])].sort((a, b) => a.position - b.position);
      const lineYs: number[] = [];

      for (const line of ownLines) {
        const y = nextY();
        yByNode.set(`l:${line.id}`, y);
        lineYs.push(y);
      }

      const areaY = lineYs.length > 0 ? average(lineYs) : nextY();
      yByNode.set(`a:${area.id}`, areaY);
      areaYs.push(areaY);
    }

    yByNode.set(`p:${pillar.id}`, areaYs.length > 0 ? average(areaYs) : nextY());
  }

  const height = ROW * row;

  /* --- Paso 2: los nodos de la estructura ------------------------------- */
  let pillarNumber = 0;
  let areaNumber = 0;
  let lineNumber = 0;

  for (const pillar of orderedPillars) {
    const color = pillarAccent.get(pillar.id)!;
    const pillarId = `p:${pillar.id}`;
    pillarNumber += 1;

    nodes.push({
      id: pillarId,
      column: "pilar",
      code: `P${pillarNumber}`,
      name: pillar.name,
      y: yByNode.get(pillarId)!,
      color,
      pillarIds: [pillar.id],
      meta: [
        pillar.numeral ? `Pilar ${pillar.numeral} del PDI` : "Pilar del PDI",
        pillar.focus,
        `${pillar.progress.progress}% de avance · ${pillar.progress.total} indicadores`,
      ].filter(Boolean),
      value: 0,
    });

    for (const area of areasByPillar.get(pillar.id) ?? []) {
      const areaId = `a:${area.id}`;
      areaNumber += 1;

      nodes.push({
        id: areaId,
        column: "area",
        code: `AE${areaNumber}`,
        name: area.name,
        y: yByNode.get(areaId)!,
        color,
        pillarIds: [pillar.id],
        meta: withCode(area.code, `Área estratégica de ${pillar.name}`),
        value: 0,
      });

      edges.push(edge(pillarId, areaId, color, [pillar.id], null, 0));

      for (const line of [...(area.action_lines ?? [])].sort((a, b) => a.position - b.position)) {
        const lineId = `l:${line.id}`;
        lineNumber += 1;

        nodes.push({
          id: lineId,
          column: "linea",
          code: `LA${lineNumber}`,
          name: line.name,
          y: yByNode.get(lineId)!,
          color,
          pillarIds: [pillar.id],
          meta: withCode(line.code, `Línea de acción de ${area.name}`),
          value: 0,
        });

        edges.push(edge(areaId, lineId, color, [pillar.id], null, 0));
      }
    }
  }

  /* --- Paso 3: los proyectos --------------------------------------------
     Un proyecto se cuelga de cada vínculo que tenga, al nivel que tenga: de la
     línea si la nombra, del área si se queda ahí, del pilar entero si no
     nombra ninguna de las dos. Es la misma regla que la cascada de avance
     (migración 0014); si el mapa dibujara solo los vínculos con línea,
     enseñaría menos relaciones de las que de verdad pesan. */
  const knownPillars = new Set(orderedPillars.map((pillar) => pillar.id));
  const orderedProjects = [...projects].sort((a, b) => a.position - b.position);
  let projectNumber = 0;

  for (const project of orderedProjects) {
    const anchors: { nodeId: string; pillarId: string }[] = [];

    for (const link of project.links ?? []) {
      if (!knownPillars.has(link.pillar_id)) continue;
      const target = link.action_line_id
        ? `l:${link.action_line_id}`
        : link.area_id
          ? `a:${link.area_id}`
          : `p:${link.pillar_id}`;
      if (yByNode.has(target)) anchors.push({ nodeId: target, pillarId: link.pillar_id });
    }

    // Respaldo para un proyecto sin vínculos: su pilar de siempre.
    if (anchors.length === 0 && project.pillar_id && yByNode.has(`p:${project.pillar_id}`)) {
      anchors.push({ nodeId: `p:${project.pillar_id}`, pillarId: project.pillar_id });
    }
    if (anchors.length === 0) continue; // No cuelga de nada visible: no se dibuja.

    const projectId = `r:${project.id}`;
    projectNumber += 1;
    const value = weights?.get(project.id) ?? 0;
    const projectPillars = pillarsOfProject(project).filter((id) => knownPillars.has(id));
    const goals = [...new Set(project.sdg_goals ?? [])].filter((id) => sdgById.has(id)).sort((a, b) => a - b);

    nodes.push({
      id: projectId,
      column: "proyecto",
      code: `PR${projectNumber}`,
      name: project.name,
      y: average(anchors.map(({ nodeId }) => yByNode.get(nodeId)!)),
      color: PROJECT_COLOR,
      pillarIds: projectPillars,
      meta: [
        `${anchors.length} ${anchors.length === 1 ? "vínculo" : "vínculos"} en ${projectPillars.length} ${projectPillars.length === 1 ? "pilar" : "pilares"}`,
        goals.length > 0
          ? `ODS: ${goals.map((id) => `${id}. ${sdgById.get(id)!.label}`).join(" · ")}`
          : "Sin ODS declarados",
        project.owner ? `Responsable: ${project.owner}` : "",
      ].filter(Boolean),
      value,
    });

    // Sin repetir: dos vínculos a la misma línea son un error de captura, no
    // dos relaciones, y dibujarlos dos veces oscurecería la curva.
    const drawn = new Set<string>();
    for (const anchor of anchors) {
      if (drawn.has(anchor.nodeId)) continue;
      drawn.add(anchor.nodeId);
      edges.push(
        edge(
          anchor.nodeId,
          projectId,
          pillarAccent.get(anchor.pillarId) ?? PROJECT_COLOR,
          [anchor.pillarId],
          project.id,
          value,
        ),
      );
    }

    yByNode.set(projectId, nodes[nodes.length - 1].y);
  }

  return {
    nodes,
    edges,
    height,
    counts: {
      pilares: pillarNumber,
      areas: areaNumber,
      lineas: lineNumber,
      proyectos: projectNumber,
      relaciones: edges.length,
    },
  };
}

function edge(
  from: string,
  to: string,
  color: string,
  pillarIds: string[],
  projectId: string | null,
  value: number,
): NetworkEdge {
  return { key: `${from}__${to}`, from, to, color, pillarIds, projectId, value };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

/* --- Consulta del mapa ------------------------------------------------------
   Dado un nodo, qué se ilumina. Sube hasta el pilar y baja hasta los proyectos,
   que es lo que hace legible una maraña de doscientas curvas: al posar el
   cursor sobre una línea de acción se ve su cadena entera, no su vecindad
   inmediata.
   -------------------------------------------------------------------------- */

export interface NetworkIndex {
  byId: Map<string, NetworkNode>;
  /** Aristas que salen de cada nodo y que entran en él. */
  out: Map<string, NetworkEdge[]>;
  into: Map<string, NetworkEdge[]>;
}

export function indexNetwork(network: Network): NetworkIndex {
  const byId = new Map(network.nodes.map((node) => [node.id, node]));
  const out = new Map<string, NetworkEdge[]>();
  const into = new Map<string, NetworkEdge[]>();

  const push = (map: Map<string, NetworkEdge[]>, key: string, item: NetworkEdge) => {
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  };

  for (const item of network.edges) {
    push(out, item.from, item);
    push(into, item.to, item);
  }

  return { byId, out, into };
}

export interface Related {
  nodes: Set<string>;
  edges: Set<string>;
}

/** La cadena completa de un nodo: todo lo que hay aguas arriba y aguas abajo. */
export function relatedTo(index: NetworkIndex, id: string): Related {
  const nodes = new Set<string>([id]);
  const edges = new Set<string>();

  const walk = (current: string, direction: "up" | "down") => {
    const list = direction === "up" ? (index.into.get(current) ?? []) : (index.out.get(current) ?? []);
    for (const item of list) {
      if (edges.has(item.key)) continue;
      edges.add(item.key);
      const next = direction === "up" ? item.from : item.to;
      nodes.add(next);
      walk(next, direction);
    }
  };

  walk(id, "up");
  walk(id, "down");
  return { nodes, edges };
}

/** Todo lo que cuelga de un pilar, para aislarlo desde la leyenda. */
export function relatedToPillar(network: Network, pillarId: string): Related {
  const nodes = new Set<string>();
  const edges = new Set<string>();

  for (const node of network.nodes) {
    if (node.pillarIds.includes(pillarId)) nodes.add(node.id);
  }
  for (const item of network.edges) {
    if (item.pillarIds.includes(pillarId)) edges.add(item.key);
  }
  return { nodes, edges };
}

/**
 * Lo que casa con la búsqueda, con su cadena entera.
 *
 * Null = sin consulta, el mapa se ve entero. Un resultado vacío sí es una
 * respuesta: "no hay nada con ese nombre", y el mapa se apaga para decirlo.
 */
export function search(network: Network, index: NetworkIndex, query: string): Related | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const nodes = new Set<string>();
  const edges = new Set<string>();

  for (const node of network.nodes) {
    if (!`${node.code} ${node.name}`.toLowerCase().includes(needle)) continue;
    const related = relatedTo(index, node.id);
    for (const id of related.nodes) nodes.add(id);
    for (const key of related.edges) edges.add(key);
  }

  return { nodes, edges };
}

export { clip };

/* --- El mapa visto desde el presupuesto -------------------------------------
   El segundo mapa del diseño (`Mapa_Red_Declarado_vs_Presupuesto.html`) compara
   el modelo declarado con el que tiene dinero detrás, cambiando el juego de
   aristas línea–proyecto y atenuando lo que se queda sin conexión.

   Aquí las tres pestañas son:

     · declarado  todas las relaciones capturadas, tengan cifra o no.
     · estimado   solo las de los proyectos que declaran un valor total.
     · ejecutado  ninguna. El portal no tiene dónde registrar ejecución
                  presupuestal, y dibujar cualquier otra cosa sería inventarla.
                  La pestaña existe para que el día que ese dato entre no haya
                  que rehacer el mapa, y mientras tanto para que se vea, con la
                  estructura entera apagada, cuánto falta por conciliar.

   La estructura —pilar, área, línea— se queda siempre: es el plan, y no cambia
   porque cambie de dónde se mira el dinero.
   -------------------------------------------------------------------------- */

export type BudgetMode = "declarado" | "estimado" | "ejecutado";

export interface BudgetView {
  network: Network;
  /** Nodos que esta pestaña deja sin relación de proyecto. */
  dimmed: Set<string>;
  /** Suma de lo que la pestaña deja en pie, sin repetir proyectos. */
  total: number;
  /** Proyectos con relación en esta pestaña. */
  projects: number;
}

export function budgetView(network: Network, mode: BudgetMode): BudgetView {
  const keep = (item: NetworkEdge) => {
    if (item.projectId === null) return true; // La estructura no se toca.
    if (mode === "declarado") return true;
    if (mode === "ejecutado") return false;
    return item.value > 0;
  };

  const edges = network.edges.filter(keep);

  // Con qué se queda cada nodo. Una línea sin proyecto y un proyecto sin línea
  // se atenúan: siguen en el mapa —el hueco es el dato— pero dejan de competir
  // por la atención.
  const linked = new Set<string>();
  for (const item of edges) {
    if (item.projectId === null) continue;
    linked.add(item.from);
    linked.add(item.to);
  }

  const dimmed = new Set<string>();
  for (const node of network.nodes) {
    if (node.column === "pilar" || node.column === "area") continue;
    if (!linked.has(node.id)) dimmed.add(node.id);
  }

  const counted = new Set<string>();
  let total = 0;
  for (const item of edges) {
    if (item.projectId === null || counted.has(item.projectId)) continue;
    counted.add(item.projectId);
    total += item.value;
  }

  return {
    network: {
      ...network,
      edges,
      counts: { ...network.counts, relaciones: edges.length },
    },
    dimmed,
    total,
    projects: counted.size,
  };
}
