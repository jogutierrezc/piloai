/* =============================================================================
   Datos Abiertos · grupos de la ficha.

   Un separador ("Graduados") agrupa los bloques que le siguen en la ficha
   hasta el próximo separador. De esos bloques sale qué fuentes de datos son
   del grupo: los indicadores de sus tableros y los conjuntos de sus mapas,
   desgloses, tuberías, históricos, mapas de calor y tablas.

   La ficha web lo usa para su índice; el Boletín, para paginar: cada grupo
   abre página con sus hojas. Lo que ningún separador reclama queda en la parte
   general del informe, antes del primer grupo.

   Reglas de reparto, en orden (las mismas para la ficha web y el Boletín):
   · Un indicador elegido en un tablero es de ese tablero y de su grupo; un
     desglose elegido en un bloque de desgloses, igual.
   · Un tablero sin indicadores elegidos muestra los que ningún tablero eligió,
     pero solo el primero de esos tableros: así no se repiten en cada sección.
     Lo mismo con los bloques de desgloses sin elección.
   · Un mapa, tubería, histórico, mapa de calor o tabla es del grupo donde
     aparece su bloque por primera vez.
   · Una tabla personalizada elegida en un bloque de tablas es de ese bloque y
     de su grupo, y su bloque «libre» suelto deja de pintarla. El primer bloque
     de tablas sin elección muestra las que nadie eligió y que no tienen ya su
     bloque «libre» a la vista.
   ========================================================================== */

import { customViewOf } from "./custom-table";
import { DEFAULT_BLOCK_ORDER } from "./types";
import type { Report, ReportBlock } from "./types";
import { SABER_COMPETENCIES } from "./saber-pro";
import type { SaberCompetency } from "./saber-pro";
import { TYT_COMPETENCIES, isPaired } from "./saber-tyt";

/** Referencia de una competencia de un conjunto Saber PRO: "saber:<clave>:<competencia>". */
export const saberRef = (id: string, competency: SaberCompetency) => `saber:${id}:${competency}`;

export interface ReportGroup {
  /** Clave estable del separador: su slot, o su posición. */
  key: string;
  title: string;
  description?: string;
  /** Claves de indicador, en el orden del informe. */
  indicators: string[];
  /** Referencias "desglose:clave", "mapa:clave", "calor:", "tuberia:", "historico:", "tabla:", "ranking:", "saber:". */
  datasets: string[];
}

export interface ReportGrouping {
  groups: ReportGroup[];
  /** Grupo de cada indicador o conjunto; sin entrada, la parte general. */
  groupOf: (ref: string) => ReportGroup | undefined;
}

const DATASET_PREFIX: Partial<Record<ReportBlock["kind"], string>> = {
  mapa: "mapa",
  mapa_calor: "calor",
  tuberia: "tuberia",
  historico: "historico",
  tabla: "tabla",
  libre: "libre",
};

/** El conjunto Saber TyT (Motor Beta) que muestra un bloque. */
export const saberTytOf = (report: Report, block: ReportBlock) =>
  report.saberTyt?.find((t) => t.id === block.settings.saberTyt) ?? report.saberTyt?.[0];

/** El conjunto Saber PRO que muestra un bloque: el elegido o, sin elección, el primero. */
export const saberProOf = (report: Report, block: ReportBlock) =>
  report.saberPro?.find((sp) => sp.id === block.settings.saberPro) ?? report.saberPro?.[0];

/** "indicador:clave" para los indicadores; los conjuntos, con su prefijo. */
export const indicatorRef = (id: string) => `indicador:${id}`;

const visibleBlocks = (report: Report) => [...(report.blocks ?? [])].filter((b) => b.visible).sort((a, b) => a.position - b.position);
const sameBlock = (a: ReportBlock, b: ReportBlock) => a === b || (Boolean(a.uuid) && a.uuid === b.uuid);

/**
 * Qué indicadores muestra un tablero y qué desgloses un bloque de desgloses.
 * Lo elegido en el bloque; sin elección, lo que ningún bloque del mismo tipo
 * eligió, y solo en el primero de esos bloques. Un bloque que no está en la
 * ficha guardada (orden por defecto) lo muestra todo.
 */
export function blockPicks(report: Report) {
  const blocks = visibleBlocks(report);
  const pick = (
    kind: "kpis" | "desgloses" | "rankings" | "medallero" | "tablas_personalizadas",
    all: string[],
    explicit: (b: ReportBlock) => string[] | null,
    /** Lo que ya se ve en otra parte de la ficha: no entra en «lo que nadie eligió». */
    elsewhere?: Set<string>,
  ) => {
    const own = blocks.filter((b) => b.kind === kind);
    const claimed = new Set(own.flatMap((b) => explicit(b) ?? []));
    const restOwner = own.find((b) => explicit(b) === null);
    const rest = all.filter((key) => !claimed.has(key) && !elsewhere?.has(key));
    return (block: ReportBlock): string[] => {
      if (!own.some((b) => sameBlock(b, block))) return all;
      const chosen = explicit(block);
      if (chosen) return chosen.filter((key) => all.includes(key));
      return restOwner && sameBlock(restOwner, block) ? rest : [];
    };
  };
  return {
    indicators: pick(
      "kpis",
      report.indicators.map((i) => i.id),
      (b) => (b.settings.indicators?.length ? b.settings.indicators : null),
    ),
    breakdowns: pick(
      "desgloses",
      report.breakdowns.map((b) => b.id),
      (b) => (b.refKey ? [b.refKey] : b.settings.breakdowns?.length ? b.settings.breakdowns : null),
    ),
    rankings: pick(
      "rankings",
      (report.rankings ?? []).map((r) => r.id),
      (b) => (b.settings.rankings?.length ? b.settings.rankings : null),
    ),
    medals: pick(
      "medallero",
      (report.medals ?? []).map((m) => m.id),
      (b) => (b.settings.medalleros?.length ? b.settings.medalleros : null),
    ),
    // Tablas personalizadas, por la clave de su conjunto libre. Un bloque de
    // tablas dentro de un punto no se pinta: ni muestra ni reclama.
    tables: pick(
      "tablas_personalizadas",
      (report.freeSets ?? []).filter((set) => customViewOf(set)).map((set) => set.id),
      (b) => (inSectionOf(report, b) ? [] : b.settings.tablas?.length ? b.settings.tablas : null),
      looseTables(report, blocks),
    ),
  };
}

/**
 * Tablas personalizadas y sus bloques «libre»: para que ninguna salga dos veces.
 * · La que un bloque de tablas elige sale en ese bloque; su bloque «libre»
 *   suelto no la pinta (`groupedTableViews`).
 * · La que nadie eligió y tiene su bloque «libre» a la vista se queda en él: el
 *   bloque de tablas sin elección no la repite (`looseTables`).
 */

/** Vistas ("<conjunto>:<vista>") de las tablas personalizadas que un bloque de tablas eligió. */
export function groupedTableViews(report: Report, blocks: ReportBlock[]): Set<string> {
  const grouped = new Set<string>();
  for (const b of blocks) {
    if (b.kind !== "tablas_personalizadas" || !b.visible || inSectionOf(report, b)) continue;
    for (const key of b.settings.tablas ?? []) {
      const set = report.freeSets?.find((f) => f.id === key);
      const view = set && customViewOf(set);
      if (set && view) grouped.add(`${set.id}:${view.key}`);
    }
  }
  return grouped;
}

/** Conjuntos cuya tabla personalizada ya pinta un bloque «libre» de la ficha: el suyo propio o el de «todas las vistas». */
function looseTables(report: Report, blocks: ReportBlock[]): Set<string> {
  const loose = new Set<string>();
  for (const b of blocks) {
    if (b.kind !== "libre" || !b.visible || inSectionOf(report, b)) continue;
    const set = report.freeSets?.find((f) => f.id === b.refKey);
    const view = set && customViewOf(set);
    if (set && view && (!b.settings.view || b.settings.view === view.key)) loose.add(set.id);
  }
  return loose;
}

export function reportGroups(report: Report): ReportGrouping {
  const blocks = visibleBlocks(report);
  const picks = blockPicks(report);
  const grouped = groupedTableViews(report, blocks);
  const groups: ReportGroup[] = [];
  const owner = new Map<string, ReportGroup | null>();
  const claim = (ref: string, group: ReportGroup | null) => {
    if (!owner.has(ref)) owner.set(ref, group);
  };

  // Primera pasada: lo que cada bloque nombra.
  let current: ReportGroup | null = null;
  blocks.forEach((block, index) => {
    if (block.kind === "separador") {
      current = {
        key: block.settings.slot || `grupo-${index}`,
        title: block.settings.title?.trim() || "Sin título",
        description: block.settings.description?.trim() || undefined,
        indicators: [],
        datasets: [],
      };
      groups.push(current);
      return;
    }
    if (block.kind === "kpis") {
      picks.indicators(block).forEach((id) => claim(indicatorRef(id), current));
      return;
    }
    if (block.kind === "desgloses") {
      picks.breakdowns(block).forEach((key) => claim(`desglose:${key}`, current));
      return;
    }
    if (block.kind === "rankings") {
      picks.rankings(block).forEach((key) => claim(`ranking:${key}`, current));
      return;
    }
    if (block.kind === "tablas_personalizadas") {
      // En el boletín cada tabla es la hoja de su vista ("libre:<fuente>:<vista>").
      picks.tables(block).forEach((key) => {
        const set = report.freeSets?.find((f) => f.id === key);
        const view = set && customViewOf(set);
        if (set && view) claim(`libre:${set.id}:${view.key}`, current);
      });
      return;
    }
    if (block.kind === "saber_tyt") {
      // Como en Saber PRO: una hoja por competencia con las dos pruebas.
      const shown = saberTytOf(report, block);
      if (shown) TYT_COMPETENCIES.filter((c) => isPaired(c.key)).forEach((c) => claim(`tyt:${shown.id}:${c.key}`, current));
      return;
    }
    if (block.kind === "saber_pro") {
      // Una hoja del boletín por competencia: todas son del grupo del bloque.
      const shown = saberProOf(report, block);
      if (shown) SABER_COMPETENCIES.forEach((c) => claim(saberRef(shown.id, c.key), current));
      return;
    }
    const prefix = DATASET_PREFIX[block.kind];
    if (prefix && block.refKey) {
      claim(`${prefix}:${block.refKey}`, current);
      // Conjunto libre: en el boletín cada vista es su hoja ("libre:<fuente>:<vista>").
      if (block.kind === "libre") {
        const set = report.freeSets?.find((f) => f.id === block.refKey);
        // La tabla que un bloque de tablas eligió es del grupo de ese bloque, no de este.
        set?.views
          .filter((v) => (!block.settings.view || v.key === block.settings.view) && !grouped.has(`${set.id}:${v.key}`))
          .forEach((v) => claim(`libre:${set.id}:${v.key}`, current));
      }
      // Un mapa que se muestra junto a otro arrastra a su pareja.
      if (block.kind === "mapa" && block.settings.mapWith) claim(`mapa:${block.settings.mapWith}`, current);
    }
  });

  for (const [ref, group] of owner) {
    if (!group) continue;
    if (ref.startsWith("indicador:")) continue;
    group.datasets.push(ref);
  }
  report.indicators.forEach((i) => owner.get(indicatorRef(i.id))?.indicators.push(i.id));

  return { groups, groupOf: (ref) => owner.get(ref) ?? undefined };
}

/* --- Qué pinta la ficha -------------------------------------------------------------
   Reglas que comparten la ficha (OpenDataReport) y el registro de descargas
   (export-registry): qué bloques salen y en qué orden, qué mapa va dentro de
   otro y dónde cae la tabla de origen de un conjunto libre. Viven aquí para
   que el selector de CSV ofrezca, por construcción, lo que la ficha dibuja. */

/** Orden de la ficha: el de la intranet, o el de siempre si el informe no declara bloques. */
export function orderedBlocks(report: Report): ReportBlock[] {
  if (report.blocks && report.blocks.length > 0) {
    return [...report.blocks].filter((block) => block.visible).sort((x, y) => x.position - y.position);
  }
  const blocks: ReportBlock[] = [];
  for (const kind of DEFAULT_BLOCK_ORDER) {
    if (kind === "mapa") {
      (report.maps ?? []).forEach((m) => blocks.push({ kind, refKey: m.id, visible: true, position: blocks.length, settings: {} }));
    } else if (kind === "tuberia") {
      (report.pipelines ?? []).forEach((p) => blocks.push({ kind, refKey: p.id, visible: true, position: blocks.length, settings: {} }));
    } else if (kind === "historico") {
      (report.histories ?? []).forEach((h) => blocks.push({ kind, refKey: h.id, visible: true, position: blocks.length, settings: {} }));
    } else if (kind === "mapa_calor") {
      (report.heatmaps ?? []).forEach((h) => blocks.push({ kind, refKey: h.id, visible: true, position: blocks.length, settings: {} }));
    } else {
      blocks.push({ kind, refKey: null, visible: true, position: blocks.length, settings: {} });
    }
  }
  return blocks;
}

/**
 * Un mapa emparejado con otro (combinado o lado a lado) sale en el bloque que
 * lo pide; su propio bloque se omite. Si dos bloques se piden mutuamente, gana
 * el primero en el orden de la ficha. Devuelve las claves de los mapas que
 * van dentro de otro bloque.
 */
export function pairedMaps(blocks: ReportBlock[]): Set<string> {
  const paired = new Set<string>();
  for (const b of blocks) {
    if (b.kind === "mapa" && b.refKey && !paired.has(b.refKey) && b.settings.mapWith && b.settings.mapWith !== b.refKey) {
      paired.add(b.settings.mapWith);
    }
  }
  return paired;
}

/**
 * Conjuntos libres: las vistas con bloque propio ("<conjunto>:<vista>"). Una
 * vista así no se repite en el bloque de «todas las vistas» del mismo conjunto.
 */
export function ownFreeViews(blocks: ReportBlock[]): Set<string> {
  return new Set(blocks.filter((b) => b.kind === "libre" && b.refKey && b.settings.view).map((b) => `${b.refKey}:${b.settings.view}`));
}

/**
 * Conjuntos libres: el último bloque que dibuja algo de cada conjunto. Debajo
 * de ese va, una sola vez, la tabla de origen.
 */
export function lastFreeBlock(report: Report, blocks: ReportBlock[]): Map<string, ReportBlock> {
  const own = ownFreeViews(blocks);
  const grouped = groupedTableViews(report, blocks);
  const last = new Map<string, ReportBlock>();
  for (const b of blocks) {
    const set = b.kind === "libre" ? report.freeSets?.find((f) => f.id === b.refKey) : undefined;
    if (!set) continue;
    const mine = (key: string) => !grouped.has(`${set.id}:${key}`);
    const draws = b.settings.view ? mine(b.settings.view) && set.views.some((v) => v.key === b.settings.view) : set.views.some((v) => !own.has(`${set.id}:${v.key}`) && mine(v.key));
    if (draws) last.set(set.id, b);
  }
  return last;
}

/** ¿El bloque va dentro de un punto del informe? Si su punto no existe, es de toda la ficha. */
export function inSectionOf(report: Report, block: ReportBlock): boolean {
  return Boolean(block.sectionKey) && (report.sections ?? []).some((s) => s.key === block.sectionKey);
}

/**
 * Los bloques en el orden en que se leen: primero los de cada punto, punto a
 * punto, y después los de toda la ficha.
 */
export function pageBlocks(report: Report, blocks: ReportBlock[] = orderedBlocks(report)): { block: ReportBlock; inSection: boolean }[] {
  const inPoints = (report.sections ?? []).flatMap((section) => blocks.filter((b) => b.sectionKey === section.key));
  const loose = blocks.filter((b) => !inSectionOf(report, b));
  return [...inPoints.map((block) => ({ block, inSection: true })), ...loose.map((block) => ({ block, inSection: false }))];
}
