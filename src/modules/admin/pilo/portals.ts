/* =============================================================================
   Mr. Pilo · los portales como vistas de una sola memoria (0121).

   Hay un solo cerebro y cada portal es una vista: `pilo_portals` guarda, por
   portal, su ámbito de casa, para quién fue escrito lo suyo y la MATRIZ —por
   cada fuente, «casa», «visita» o «no»—; `pilo_sources` es el catálogo de
   fuentes. La administración los lee aquí y cambia una celda con
   `pilo_portal_update`, que revisa cada valor y devuelve su efecto.

   Lo puro va arriba (qué opciones tiene una celda, qué dice su estado y cómo se
   cuenta el efecto de un cambio); lo que habla con la base, abajo.

   La matriz nace con cada portal leyendo solo lo de su casa. Desde 0122 una
   celda de otro ámbito se puede marcar «De visita»: entra solo cuando lo de
   casa no alcanza o por un puente aprobado, después de lo de casa y diciendo
   de dónde viene. Antes de confirmar, `pilo_portal_preview` cuenta qué podrá
   leer ese portal y quién lo verá. Cada cambio lleva lo que esta pantalla veía
   en la celda (`expect`): si otra pestaña la movió, la base no escribe.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import type { PiloSpace } from "./space";

export type Cell = "casa" | "visita" | "no";
export type SourceKind = "portal" | "documentos" | "moodle" | "catalogo";

export interface PiloSource {
  id: string;
  /** Su ámbito de casa: la procedencia de sus pasajes. */
  scope: string;
  name: string;
  kind: SourceKind;
  /** Pide sesión de la intranet en cualquier portal (Impacto). */
  staff_only: boolean;
  /** No sale de su portal (los cursos de Moodle). */
  stays_home: boolean;
  sort: number;
  /** La creó la administración (0125). `undefined`: la base aún no tiene esa migración. */
  custom?: boolean;
}

export interface PiloPortal {
  id: string;
  scope: string;
  name: string;
  /** Para quién fue escrito lo de su ámbito: «preparado para…». */
  written_for: string;
  matrix: Record<string, Cell>;
  sort: number;
}

export interface PortalsData {
  portals: PiloPortal[];
  sources: PiloSource[];
}

/** El efecto de una celda que cambió, como lo devuelve `pilo_portal_update`. */
export interface CellEffect {
  source: string;
  name: string;
  from: Cell;
  to: Cell;
  passages: number;
  answers: number;
  /** Desde 0122: cuántos de esos pasajes son públicos y cuántos «con sesión», cuántos puentes aprobados hay entre los dos ámbitos, y de quién es la fuente. */
  public?: number;
  session?: number;
  bridges?: number;
  staff_only?: boolean;
  home?: string;
  written_for?: string;
}

/* --- Lo puro ------------------------------------------------------------------------------ */

const isCell = (v: unknown): v is Cell => v === "casa" || v === "visita" || v === "no";
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const whole = (v: unknown) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

/** Las filas de la base, leídas con cuidado: lo que no se reconoce no entra. */
export function parsePortals(portalRows: unknown, sourceRows: unknown): PortalsData {
  const sources: PiloSource[] = (Array.isArray(sourceRows) ? sourceRows : [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .filter((r) => typeof r.id === "string" && /^[a-z]{3,30}$/.test(r.id) && typeof r.scope === "string")
    .map((r) => ({
      id: r.id as string,
      scope: r.scope as string,
      name: text(r.name, 80) || (r.id as string),
      kind: (r.kind === "documentos" || r.kind === "moodle" || r.kind === "catalogo" ? r.kind : "portal") as SourceKind,
      staff_only: r.staff_only === true,
      stays_home: r.stays_home === true,
      sort: whole(r.sort),
      ...("custom" in r ? { custom: r.custom === true } : {}),
    }))
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  const portals: PiloPortal[] = (Array.isArray(portalRows) ? portalRows : [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === "object")
    .filter((r) => typeof r.id === "string" && typeof r.scope === "string")
    .map((r) => {
      const raw = r.matrix && typeof r.matrix === "object" && !Array.isArray(r.matrix) ? (r.matrix as Record<string, unknown>) : {};
      return {
        id: r.id as string,
        scope: r.scope as string,
        name: text(r.name, 120) || (r.id as string),
        written_for: text(r.written_for, 200),
        matrix: Object.fromEntries(Object.entries(raw).filter(([, v]) => isCell(v))) as Record<string, Cell>,
        sort: whole(r.sort),
      };
    })
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id));
  return { portals, sources };
}

/** Lo que dice la matriz de una celda. Lo que no está escrito es «no». */
export const cellOf = (portal: PiloPortal, source: PiloSource): Cell => portal.matrix[source.id] ?? "no";

/** ¿La fuente es de la casa de ese portal? */
export const atHome = (portal: PiloPortal, source: PiloSource) => source.scope === portal.scope;

/**
 * Lo que ese portal lee DE VERDAD de esa fuente: la celda, pasada por las reglas
 * que la base aplica siempre. «casa» solo vale en lo propio; «visita», solo en
 * lo de otro ámbito que puede salir de su casa. Así la pantalla no promete lo
 * que el filtro no hace.
 */
export function effectiveCell(portal: PiloPortal, source: PiloSource): Cell {
  const cell = cellOf(portal, source);
  if (cell === "casa") return atHome(portal, source) ? "casa" : "no";
  if (cell === "visita") return !atHome(portal, source) && !source.stays_home ? "visita" : "no";
  return "no";
}

export interface CellChoice {
  value: Cell;
  label: string;
  enabled: boolean;
  /** Por qué no se puede elegir (o qué hace). */
  note: string;
}

export const CELL_LABEL: Record<Cell, string> = { casa: "De casa", visita: "De visita", no: "No" };

/**
 * Las opciones de una celda. En lo propio: «De casa» o «No». En lo ajeno: «No»
 * y «De visita», salvo en lo que no sale de su portal (los cursos de Moodle),
 * donde se ve pero no se puede marcar.
 */
export function cellChoices(portal: PiloPortal, source: PiloSource): CellChoice[] {
  if (atHome(portal, source)) {
    return [
      { value: "casa", label: CELL_LABEL.casa, enabled: true, note: source.staff_only ? "Se busca siempre, solo para el personal con sesión de la intranet." : "Se busca siempre y se cita sin aclaración." },
      { value: "no", label: CELL_LABEL.no, enabled: true, note: "Este portal no la lee." },
    ];
  }
  return [
    {
      value: "visita",
      label: CELL_LABEL.visita,
      enabled: !source.stays_home,
      note: source.stays_home
        ? `${source.name} no sale de su portal.`
        : `Es de otro ámbito: entra solo si lo de casa no alcanza o por un puente aprobado, después de lo de casa y diciendo de dónde viene${source.staff_only ? "; solo para el personal con sesión de la intranet" : ""}.`,
    },
    { value: "no", label: CELL_LABEL.no, enabled: true, note: "Este portal no la lee: es de otro ámbito." },
  ];
}

const count = (n: number, one: string, many: string) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;

/** Lo que se pregunta antes de cambiar una celda: nombra la consecuencia. */
export function confirmText(portal: PiloPortal, source: PiloSource, to: Cell, effect: CellEffect | null = null): string {
  if (to === "visita") return visitConfirmText(portal, source, effect);
  if (!atHome(portal, source)) {
    return `¿«${portal.name}» deja de leer ${source.name} de visita? Sus pasajes siguen en su portal; aquí ya no entran en ninguna respuesta, ni por un puente aprobado.`;
  }
  if (to === "casa") {
    return `¿«${portal.name}» vuelve a leer ${source.name}? Sus pasajes entran de nuevo en las respuestas${source.staff_only ? ", solo para el personal con sesión de la intranet" : ""}.`;
  }
  return `¿«${portal.name}» deja de leer ${source.name}? Sus pasajes siguen guardados, pero no entran en ninguna respuesta de este portal, y las respuestas guardadas que los citan dejan de servirse.`;
}

/** Quién recibirá los pasajes de una fuente leída de visita, según su visibilidad: nunca más de lo que ya ve en su portal. */
function visitReaders(source: PiloSource, effect: CellEffect): string {
  const pub = effect.public ?? 0;
  const ses = effect.session ?? 0;
  if (source.staff_only) return `Solo los verá el personal con sesión de la intranet (${count(pub + ses, "pasaje", "pasajes")}): esa fuente pide sesión en cualquier portal.`;
  const parts = [
    pub ? `${count(pub, "es público y lo verá", "son públicos y los verá")} cualquiera que pregunte en este portal` : "",
    ses ? `${count(ses, "es «con sesión» y solo lo verá", "son «con sesión» y solo los verá")} el personal con sesión de la intranet (una cuenta de Pilo no)` : "",
  ].filter(Boolean);
  return parts.length ? `${parts.join("; ")}.` : "Esa fuente todavía no tiene pasajes: entrarán en cuanto se carguen.";
}

/**
 * Lo que se pregunta antes de marcar «De visita», con lo que contó la base: cuántos
 * pasajes de qué fuente podrá leer ese portal, quién los verá y cómo entran.
 * Mientras llega la cuenta (`effect` null), dice lo que no depende de ella.
 */
export function visitConfirmText(portal: PiloPortal, source: PiloSource, effect: CellEffect | null): string {
  const head = `¿«${portal.name}» podrá leer ${source.name} de visita?`;
  const how = "Entran solo cuando lo de casa no alcanza o cuando los trae un puente aprobado, después de lo de casa y a lo sumo 2 por respuesta.";
  if (!effect) return `${head} ${how} Contando qué podrá leer…`;
  const home = effect.home ? `«${effect.home}»` : "otro portal";
  const who = effect.written_for ? ` y, a quien no sea de ese público, que fue preparado para ${effect.written_for}` : "";
  const bridges = effect.bridges ? ` Hay ${count(effect.bridges, "puente aprobado", "puentes aprobados")} entre los dos ámbitos.` : " Todavía no hay puentes aprobados entre los dos ámbitos.";
  return `${head} ${visitReaders(source, effect)} ${how}${bridges} Pilo dirá que vienen de ${home}${who}. Lo que cite algo de visita no se guarda como respuesta.`;
}

/** Lo que pasó al cambiar una celda, con los números que devolvió la base. */
export function effectText(portal: PiloPortal, effect: CellEffect): string {
  const passages = count(effect.passages, "pasaje", "pasajes");
  if (effect.to === "visita") {
    return effect.passages
      ? `«${portal.name}» ya puede leer ${effect.name} de visita: ${passages}, cada uno con su visibilidad. ${effect.passages === 1 ? "Entra" : "Entran"} solo si lo de casa no alcanza o por un puente aprobado.`
      : `«${portal.name}» ya puede leer ${effect.name} de visita, que todavía no tiene pasajes.`;
  }
  if (effect.from === "visita") return `«${portal.name}» ya no lee ${effect.name} de visita: sus pasajes siguen en su portal y aquí no entran por ningún camino.`;
  if (effect.to === "casa") {
    return effect.passages
      ? `«${portal.name}» ya lee ${effect.name}: ${passages} ${effect.passages === 1 ? "entra" : "entran"} en sus respuestas desde ahora.`
      : `«${portal.name}» ya lee ${effect.name}, que todavía no tiene pasajes: entrarán en cuanto se carguen.`;
  }
  const answers = effect.answers ? ` ${count(effect.answers, "respuesta guardada que la citaba deja", "respuestas guardadas que la citaban dejan")} de servirse.` : "";
  return `«${portal.name}» ya no lee ${effect.name}: ${effect.passages ? `${passages} ${effect.passages === 1 ? "queda guardado" : "quedan guardados"}, pero no ${effect.passages === 1 ? "entra" : "entran"} en sus respuestas.` : "no tenía pasajes."}${answers}`;
}

/** Los interruptores de siempre (`memory_sources`) que corresponden a la matriz de un portal: sus celdas de casa. */
export function homeFlags(portal: PiloPortal, sources: PiloSource[]): Record<string, boolean> {
  return Object.fromEntries(sources.filter((s) => atHome(portal, s)).map((s) => [s.id, effectiveCell(portal, s) === "casa"]));
}

/**
 * Los interruptores de «Fuentes» que una pestaña debe guardar de verdad.
 *
 * «Guardar cambios» manda la ficha entera, y los interruptores son el espejo de
 * las celdas de casa de la matriz: una pestaña abierta desde antes devolvería a
 * su valor viejo una celda que otra pestaña acaba de cambiar. Por eso solo se
 * guardan los interruptores que ESTA pestaña movió, sobre lo que la base tiene
 * ahora:
 *   `edited`   lo que tiene el editor;
 *   `loaded`   lo que esta pestaña leyó de la base al abrir;
 *   `current`  lo que la base tiene en este momento.
 * `null`: esta pestaña no tocó ninguno; no se manda nada.
 */
export function mergeSourceFlags(edited: Record<string, boolean>, loaded: Record<string, boolean> | null | undefined, current: unknown): Record<string, boolean> | null {
  // Sin saber qué había al abrir, no hay cómo distinguir: se guarda lo del editor, como siempre.
  if (!loaded) return edited;
  const changed = Object.keys(edited).filter((k) => edited[k] !== loaded[k]);
  if (!changed.length) return null;
  const now = current && typeof current === "object" && !Array.isArray(current) ? Object.fromEntries(Object.entries(current as Record<string, unknown>).filter(([, v]) => typeof v === "boolean")) : loaded;
  return { ...(now as Record<string, boolean>), ...Object.fromEntries(changed.map((k) => [k, edited[k]])) };
}

/** Las colecciones a las que puede ir un documento en un ámbito, con un código de dos letras para su etiqueta. `custom`: la creó la administración (0125). */
export function docCollections(sources: PiloSource[], scope: string): { id: string; code: string; name: string; custom: boolean }[] {
  return sources
    .filter((s) => s.scope === scope && s.kind === "documentos")
    .map((s) => ({ id: s.id, code: DOC_CODE[s.id] ?? s.id.slice(0, 2).toUpperCase(), name: s.name, custom: s.custom === true }));
}

const DOC_CODE: Record<string, string> = { institucional: "DI", normativa: "NO", lineamientos: "LG", innovacion: "IE", politicas: "PO", global: "GL" };

/** Las colecciones de documentos del Pilo general si la base aún no las da (sin 0121 no se usan: el panel queda apagado). */
export const GENERAL_COLLECTIONS: { id: string; code: string; name: string }[] = [
  { id: "institucional", code: "DI", name: "Documentos institucionales" },
  { id: "normativa", code: "NO", name: "Normativa" },
  { id: "lineamientos", code: "LG", name: "Lineamientos y guías" },
];

/* --- Lo que habla con la base ------------------------------------------------------------- */

export const portalKeys = { all: ["pilo-ia", "portales"] as const };

interface DbError {
  code?: string;
  message?: string;
}

/** ¿El error dice que la tabla o la función no existen? (base sin 0121) */
export const missing0121 = (error: DbError | null | undefined): boolean =>
  Boolean(error) &&
  (["PGRST205", "PGRST202", "42P01", "42883"].includes(error!.code ?? "") || /could not find the (table|function)|does not exist|schema cache/i.test(error!.message ?? ""));

/** La matriz y el catálogo de fuentes. Sin la migración 0121: null. */
export async function fetchPortals(): Promise<PortalsData | null> {
  const columns = "id, scope, name, kind, staff_only, stays_home, sort";
  const readSources = async () => {
    const withCustom = await supabase.from("pilo_sources" as never).select(`${columns}, custom`);
    // Sin 0125 la columna no existe: se lee el catálogo de antes, sin colecciones propias.
    if (withCustom.error && /custom/i.test(withCustom.error.message ?? "")) return supabase.from("pilo_sources" as never).select(columns);
    return withCustom;
  };
  const [portals, sources] = await Promise.all([supabase.from("pilo_portals" as never).select("id, scope, name, written_for, matrix, sort"), readSources()]);
  // El personal de carga documental lee las colecciones de su espacio, pero no los portales (pilo_0146):
  // sin permiso sobre pilo_portals se sigue con el catálogo y sin matriz.
  const portalsDenied = portals.error?.code === "42501" || /permission denied/i.test(portals.error?.message ?? "");
  const error = (portalsDenied ? null : portals.error) ?? sources.error;
  if (error) {
    if (missing0121(error)) return null;
    throw new Error(error.message);
  }
  return parsePortals(portalsDenied ? [] : portals.data, sources.data);
}

export function usePortals(enabled = true) {
  return useQuery({ queryKey: portalKeys.all, enabled, retry: false, queryFn: fetchPortals });
}

export interface CellChange {
  portal: PiloPortal;
  source: PiloSource;
  to: Cell;
}

/** El efecto de una celda, como lo cuenta la base (al cambiarla o antes, con `pilo_portal_preview`). null si no se reconoce. */
export function parseEffect(e: unknown): CellEffect | null {
  if (!e || typeof e !== "object") return null;
  const r = e as Record<string, unknown>;
  if (!isCell(r.from) || !isCell(r.to) || typeof r.source !== "string") return null;
  return {
    source: r.source,
    name: text(r.name, 80) || r.source,
    from: r.from,
    to: r.to,
    passages: whole(r.passages),
    answers: whole(r.answers),
    // Lo que la base cuenta desde 0122; con una base anterior no viene y no se inventa.
    ...("public" in r ? { public: whole(r.public), session: whole(r.session), bridges: whole(r.bridges), staff_only: r.staff_only === true, home: text(r.home, 120), written_for: text(r.written_for, 200) } : {}),
  };
}

/** ¿El error dice que la base aún no deja leer de visita? (0121 sin 0122) */
export const missing0122 = (error: DbError | null | undefined): boolean =>
  Boolean(error) && (missing0121(error) || /todavía no está disponible/i.test(error!.message ?? ""));

/**
 * Lo que pasaría al cambiar una celda, sin cambiarla: lo cuenta la base. Se pide
 * antes de confirmar «De visita», para decir cuántos pasajes de qué fuente podrá
 * leer ese portal y quién los verá.
 */
export async function previewCell({ portal, source, to }: CellChange): Promise<CellEffect> {
  const { data, error } = await supabase.rpc("pilo_portal_preview" as never, { p_portal: portal.id, p_source: source.id, p_value: to } as never);
  if (error) throw new Error(missing0122(error) ? "Falta aplicar la migración 0122 en la base: hasta entonces no se puede leer de visita." : error.message);
  const effect = parseEffect(data);
  if (!effect) throw new Error("La base no devolvió el efecto de ese cambio.");
  return effect;
}

/**
 * Cambia una celda. Se aplica al momento; devuelve el efecto que contó la base.
 * Manda lo que esta pantalla veía en la celda (`expect`): si otra pestaña ya la
 * movió, la base no escribe y lo dice, en vez de devolverla a un valor viejo.
 */
export function useSetCell() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ portal, source, to }: CellChange): Promise<{ matrix: Record<string, Cell>; effects: CellEffect[] }> => {
      const patch = { matrix: { [source.id]: to }, expect: { [source.id]: cellOf(portal, source) } };
      const { data, error } = await supabase.rpc("pilo_portal_update" as never, { p_portal: portal.id, p_patch: patch } as never);
      if (error) {
        if (missing0121(error)) throw new Error("Falta aplicar la migración 0121 en la base.");
        if (to === "visita" && missing0122(error)) throw new Error("Falta aplicar la migración 0122 en la base: hasta entonces no se puede leer de visita.");
        throw new Error(error.message);
      }
      const r = (data ?? {}) as { matrix?: unknown; effects?: unknown };
      const matrix = r.matrix && typeof r.matrix === "object" ? (Object.fromEntries(Object.entries(r.matrix as Record<string, unknown>).filter(([, v]) => isCell(v))) as Record<string, Cell>) : {};
      const effects = (Array.isArray(r.effects) ? r.effects : []).map(parseEffect).filter((e): e is CellEffect => e !== null);
      return { matrix, effects };
    },
    onSettled: (_data, _error, change) => {
      void client.invalidateQueries({ queryKey: portalKeys.all });
      // La ficha del otro Pilo refleja la matriz en sus interruptores: se vuelve a leer.
      // (La de «Mr. Pilo con IA» no se invalida: su editor se pone al día sin perder lo que está a medio escribir.)
      if (change.portal.id !== "planeacion") void client.invalidateQueries({ queryKey: ["pilo-ia", "espacio", change.portal.id as PiloSpace, "ficha"] });
    },
  });
}

/* --- Una sola memoria: todos los portales leen lo de los demás, de visita ------------------- */

export interface UnifyChange {
  portal: PiloPortal;
  /** Las celdas que cambian y a qué valor. */
  cells: Record<string, Cell>;
}

/**
 * Qué celdas habría que mover para que cada portal lea de visita todo lo que puede
 * salir de su casa (`to: "visita"`), o para volver a separarlos (`to: "no"`: solo
 * las que hoy dicen «visita»). Lo que no sale de su portal (Moodle) y lo propio de
 * cada portal no se toca.
 */
export function unifyChanges(data: PortalsData, to: "visita" | "no" = "visita"): UnifyChange[] {
  return data.portals
    .map((portal) => {
      const cells: Record<string, Cell> = {};
      for (const source of data.sources) {
        if (atHome(portal, source) || source.stays_home) continue;
        const now = cellOf(portal, source);
        if (to === "visita" ? now !== "visita" : now === "visita") cells[source.id] = to;
      }
      return { portal, cells };
    })
    .filter((c) => Object.keys(c.cells).length > 0);
}

/**
 * Aplica `unifyChanges`, un portal a la vez y cada uno con lo que esta pantalla veía
 * (`expect`). Devuelve cuántas celdas cambió.
 */
export function useUnifyMemory() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ data, to }: { data: PortalsData; to: "visita" | "no" }): Promise<number> => {
      let changed = 0;
      for (const { portal, cells } of unifyChanges(data, to)) {
        const expect = Object.fromEntries(Object.keys(cells).map((id) => [id, portal.matrix[id] ?? "no"]));
        const { error } = await supabase.rpc("pilo_portal_update" as never, { p_portal: portal.id, p_patch: { matrix: cells, expect } } as never);
        if (error) {
          if (missing0121(error)) throw new Error("Falta aplicar la migración 0121 en la base.");
          if (to === "visita" && missing0122(error)) throw new Error("Falta aplicar la migración 0122 en la base: hasta entonces no se puede leer de visita.");
          throw new Error(changed ? `${error.message} (ya se cambiaron ${changed} celdas de los portales anteriores)` : error.message);
        }
        changed += Object.keys(cells).length;
      }
      return changed;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: portalKeys.all });
      void client.invalidateQueries({ queryKey: ["pilo-ia", "espacio"] });
    },
  });
}