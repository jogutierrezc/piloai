/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria · lo que se lee y se escribe.

   Base (0114–0116, 0133): pilo_docs, pilo_moodle_sites y pilo_moodle_courses se
   leen; todo lo demás se escribe por función (pilo_doc_save, _replace, _update,
   _delete, _outline, pilo_moodle_site_save, _set_token, _delete,
   pilo_moodle_course_set). El original va al bucket
   privado pilo-docs, en <espacio>/<id>/<nombre>.

   Función pilo-ia: «comprender» y «moodle» (anexo B del contrato). Sus errores
   llegan con `code`; aquí se convierten en un StepError legible.

   Cada lectura dice si falta su migración en vez de fallar: el panel lo
   cuenta y se apaga sin romper a los demás.
   ========================================================================== */

import { useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../../lib/supabase";
import type { PiloSpace } from "../../pilo/space";
import { indexStep, pendingOf } from "../../pilo/memory";
import type { EmbedStatus } from "../../pilo/memory";
import { spaceKeys } from "../store";
import { activity, useCurrentJob } from "../actividad";
import { StepError, faultFrom, missingMigration } from "./flow";
import type { ComprehendResult, DbError, DocStatus, ReadingJob } from "./flow";
import type { RawEdge, RawNode } from "./map";
import type { ReadingRow } from "./readings";

export const BUCKET = "pilo-docs";

/* --- Tipos ------------------------------------------------------------------------------ */

export interface DocRow {
  id: string;
  space: string;
  /** «web» (0127): una página que Pilo leyó en otro portal y la administración guardó. */
  origin: "archivo" | "moodle" | "web";
  kind: "docx" | "xlsx" | "csv" | "pdf" | "curso" | "web";
  /** La colección: una de las de su Pilo (las de Enseñanza o, desde 0121, las del general). */
  source: string;
  title: string;
  file_path: string;
  file_name: string;
  file_size: number;
  file_hash: string;
  external_id: string;
  vis: "publico" | "sesion";
  active: boolean;
  status: DocStatus;
  status_detail: string;
  pages: number;
  passages: number;
  understood_at: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CourseRow {
  space: string;
  /** De cuál sitio de Moodle es (0133): el mismo número de curso puede existir en dos. */
  site: string;
  course_id: number;
  category_id: number | null;
  category_name: string;
  shortname: string;
  fullname: string;
  selected: boolean;
  vis: "publico" | "sesion";
  doc_id: string | null;
  synced_at: string | null;
  status: string;
  error: string;
}

export interface MoodleSite {
  name?: string;
  release?: string;
  functions?: Record<string, boolean>;
}

/** Un sitio de Moodle del espacio (0133): su conexión y lo que respondió al probarlo. */
export interface MoodleSiteRow {
  id: string;
  name: string;
  on: boolean;
  url: string;
  site: MoodleSite;
  checkedAt: string | null;
  token: { has: boolean; last4: string };
}

export interface MoodleSetup {
  sites: MoodleSiteRow[];
  /** Los cursos de todos los sitios; cada uno dice de cuál es. */
  courses: CourseRow[];
}

export interface MapStatus {
  total: number;
  mapped: number;
  pending: number;
  topics: number;
  refs: number;
}

/** Una lectura que puede decir «falta la migración tal». */
export type Loaded<T> = { missing: string | null; data: T };

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** Convierte un error de la base en StepError (con la migración que falta, si es eso). */
function dbFail(error: DbError): never {
  const missing = missingMigration(error);
  if (missing) throw new StepError({ ...faultFrom(500, { code: "migracion", error: `Falta la migración ${missing}.` }), title: `Falta la migración ${missing}` });
  throw new StepError(faultFrom(error.code === "42501" ? 403 : 500, { error: error.message }));
}

/* --- Llaves ------------------------------------------------------------------------------ */

export const memoKeys = {
  docs: (space: PiloSpace) => ["pilo-ia", "memoria", "documentos", space] as const,
  readings: (space: PiloSpace) => ["pilo-ia", "memoria", "lecturas", space] as const,
  moodle: (space: PiloSpace) => ["pilo-ia", "memoria", "moodle", space] as const,
  map: (space: PiloSpace) => ["pilo-ia", "memoria", "mapa", space] as const,
  mapStatus: (space: PiloSpace) => ["pilo-ia", "memoria", "mapa-estado", space] as const,
};

/** Tras cualquier cambio en la memoria: documentos, conteos, índice y mapa se vuelven a leer. */
export function useRefreshMemory(space: PiloSpace) {
  const client = useQueryClient();
  return () => {
    void client.invalidateQueries({ queryKey: memoKeys.docs(space) });
    void client.invalidateQueries({ queryKey: memoKeys.readings(space) });
    void client.invalidateQueries({ queryKey: memoKeys.moodle(space) });
    void client.invalidateQueries({ queryKey: memoKeys.map(space) });
    void client.invalidateQueries({ queryKey: memoKeys.mapStatus(space) });
    void client.invalidateQueries({ queryKey: spaceKeys.counts(space) });
    void client.invalidateQueries({ queryKey: spaceKeys.row(space) });
    void client.invalidateQueries({ queryKey: ["pilo-ia", "memoria", "significado"] });
  };
}

/* --- Documentos ------------------------------------------------------------------------ */

export async function fetchDocs(space: PiloSpace): Promise<Loaded<DocRow[]>> {
  const { data, error } = await supabase.from("pilo_docs").select("*").eq("space", space).order("created_at", { ascending: false }).limit(500);
  if (error) {
    const missing = missingMigration(error) ?? (/pilo_docs/i.test(error.message ?? "") ? "0114" : null);
    if (missing) return { missing, data: [] };
    dbFail(error);
  }
  return { missing: null, data: (data ?? []) as unknown as DocRow[] };
}

export function useDocs(space: PiloSpace, enabled = true) {
  return useQuery({ queryKey: memoKeys.docs(space), enabled, queryFn: () => fetchDocs(space) });
}

/** La huella del archivo (SHA-256, en hexadecimal): con ella la base reconoce un archivo repetido. */
export async function hashFile(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function uploadOriginal(path: string, file: Blob, contentType: string): Promise<void> {
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: true, contentType });
  if (error) {
    if (/bucket not found/i.test(error.message)) dbFail({ code: "PGRST205", message: "pilo-docs bucket not found" });
    throw new StepError(faultFrom(500, { error: error.message }));
  }
}

/** Quita un original del bucket. No lanza: devuelve si quedó borrado. */
export async function removeOriginal(path: string): Promise<boolean> {
  if (!path) return true;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

export async function downloadOriginal(path: string): Promise<Blob> {
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error || !data) throw new StepError(faultFrom(500, { error: error?.message ?? "El original no está en el almacenamiento." }));
  return data;
}

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) dbFail({ code: error.code, message: `${error.message} ${name}` });
  return data as T;
}

export const docSave = (space: PiloSpace, doc: Record<string, unknown>) => rpc<string>("pilo_doc_save", { p_space: space, p_doc: doc });

export const docReplace = (doc: string, rows: { seq: number; title: string; section: string; body: string; path: string; cut: string }[]) =>
  rpc<{ added: number; changed: number; removed: number; total: number; skipped: number }>("pilo_doc_replace", { p_doc: doc, p_rows: rows });

export const docUpdate = (doc: string, patch: Record<string, unknown>) => rpc<unknown>("pilo_doc_update", { p_doc: doc, p_patch: patch });

export const docDelete = (doc: string) =>
  rpc<{ file_path: string; passages: number; answers: number; nodes: number; edges: number; topics: number }>("pilo_doc_delete", { p_doc: doc });

export const docOutlineSave = (doc: string, nodes: unknown[], edges: unknown[]) =>
  rpc<{ nodes: number; edges: number; removed: number; rejected: number }>("pilo_doc_outline", { p_doc: doc, p_nodes: nodes, p_edges: edges });

/* --- Lo que leyó en otros portales (0127) ----------------------------------------------- */

/** Las lecturas pendientes de un Pilo, la más reciente primero. Solo las de su ámbito. */
export async function fetchReadings(space: PiloSpace): Promise<Loaded<ReadingRow[]>> {
  const { data, error } = await supabase.from("pilo_readings").select("*").eq("space", space).eq("status", "pendiente").order("last_seen", { ascending: false }).limit(200);
  if (error) {
    const missing = missingMigration(error) ?? (/pilo_readings/i.test(error.message ?? "") ? "0127" : null);
    if (missing) return { missing, data: [] };
    dbFail(error);
  }
  return { missing: null, data: (data ?? []) as unknown as ReadingRow[] };
}

export function useReadings(space: PiloSpace, enabled = true) {
  return useQuery({ queryKey: memoKeys.readings(space), enabled, queryFn: () => fetchReadings(space) });
}

/** El documento «web» de una página en este Pilo, si ya se guardó antes: se actualiza en vez de duplicarse. */
export async function findWebDoc(space: PiloSpace, urlHash: string): Promise<string | null> {
  const { data, error } = await supabase.from("pilo_docs").select("id").eq("space", space).eq("origin", "web").eq("external_id", urlHash).maybeSingle();
  if (error) dbFail(error);
  return (data as { id?: string } | null)?.id ?? null;
}

export const readingDecide = (id: string, status: "guardada" | "descartada", doc: string | null = null) =>
  rpc<unknown>("pilo_reading_decide", { p_id: id, p_status: status, p_doc: doc });

/** Los pasajes de un documento, para rehacer su estructura o listarlos. */
export async function fetchDocPassages(space: PiloSpace, doc: string): Promise<{ ref: string; seq: number; section: string; body: string }[]> {
  const { data, error } = await supabase.from("pilo_memory").select("ref, section, body").eq("space", space).eq("doc_id", doc).limit(450);
  if (error) dbFail(error);
  return ((data ?? []) as { ref: string; section: string; body: string }[])
    .map((r) => ({ ...r, seq: Number(r.ref.slice(r.ref.lastIndexOf(":") + 1)) || 0 }))
    .sort((a, b) => a.seq - b.seq);
}

export function useDocPassages(space: PiloSpace, doc: string | null) {
  return useQuery({ queryKey: ["pilo-ia", "memoria", "pasajes-de", space, doc], enabled: Boolean(doc), staleTime: 60_000, queryFn: () => fetchDocPassages(space, doc!) });
}

/**
 * Indexa por significado lo pendiente del espacio, lote por lote. Igual que
 * «Indexar por significado»: un lote que no guarda nada detiene la repetición.
 */
export async function indexPending(space: PiloSpace, onProgress?: (pending: number) => void): Promise<number> {
  let left = 0;
  for (let round = 0; round < 200; round++) {
    const r = await indexStep<{ saved?: number; status?: EmbedStatus }>({ step: "lote" }, space);
    const s = (r.status ?? null) as EmbedStatus | null;
    left = pendingOf(s);
    onProgress?.(left);
    if (!left || !r.saved) break;
  }
  return left;
}

/**
 * Lo mismo, contando el estado entero y pudiendo detenerse: `stopped` se
 * consulta entre lote y lote, así lo indexado nunca queda a medias.
 */
export async function indexRun(space: PiloSpace, opts: { onStatus?: (status: EmbedStatus) => void; stopped?: () => boolean } = {}): Promise<{ left: number; halted: boolean }> {
  let left = 0;
  for (let round = 0; round < 200; round++) {
    if (opts.stopped?.()) return { left, halted: true };
    const r = await indexStep<{ saved?: number; status?: EmbedStatus }>({ step: "lote" }, space);
    const s = (r.status ?? null) as EmbedStatus | null;
    left = pendingOf(s);
    if (s) opts.onStatus?.(s);
    if (!left || !r.saved) break;
  }
  return { left, halted: false };
}

/* --- La función pilo-ia ---------------------------------------------------------------- */

/** Un paso de «comprender», de «moodle» o de «web». El espacio va siempre en el cuerpo. */
export async function piloStep<T>(action: "comprender" | "moodle" | "web", space: PiloSpace, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>("pilo-ia", { body: { action, space, ...body } });
  if (!error) return data as T;
  const response = (error as { context?: Response }).context;
  let parsed: { error?: unknown; advice?: unknown; code?: unknown } | null = null;
  let status = 0;
  if (response && typeof response.json === "function") {
    status = response.status;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
  }
  throw new StepError(faultFrom(status, parsed));
}

export const comprehend = (space: PiloSpace, step: "estado" | "lote") => piloStep<ComprehendResult>("comprender", space, { step });

/** Comprender solo los pasajes de un documento (una página web recién leída, por ejemplo). */
export const comprehendDoc = (space: PiloSpace, doc: string) => piloStep<ComprehendResult>("comprender", space, { step: "lote", doc });

export interface MoodleProbe {
  site?: { name?: string; release?: string; url?: string };
  functions?: Record<string, boolean>;
  usable?: string[];
  missing?: string[];
  ms?: number;
}

export interface MoodleCategory {
  id: number;
  name: string;
  parent: number;
  depth: number;
  courses: number;
}

export interface MoodleCourseRead {
  course?: { id: number; fullname: string; shortname: string };
  selected?: boolean;
  doc?: string;
  unchanged?: boolean;
  empty?: boolean;
  note?: string;
  passages?: number;
  added?: number;
  changed?: number;
  removed?: number;
  mapped?: boolean;
  activities?: number;
  dropped?: number;
  redacted?: number;
  skipped?: string[];
}

// De cuál sitio (0133) viaja solo su id: la dirección y el token los pone la función.
export const moodleProbe = (space: PiloSpace, site: string) => piloStep<MoodleProbe>("moodle", space, { site, step: "probar" });
export const moodleCategories = (space: PiloSpace, site: string) => piloStep<{ categories?: MoodleCategory[] }>("moodle", space, { site, step: "categorias" });
export const moodleCourses = (space: PiloSpace, site: string, category: number) => piloStep<{ saved?: number; courses?: unknown[] }>("moodle", space, { site, step: "cursos", category });
export const moodleCourse = (space: PiloSpace, site: string, course: number) => piloStep<MoodleCourseRead>("moodle", space, { site, step: "curso", course });

/* --- Moodle: la conexión y los cursos -------------------------------------------------- */

export async function fetchMoodle(space: PiloSpace): Promise<Loaded<MoodleSetup>> {
  const empty: MoodleSetup = { sites: [], courses: [] };
  const rows = await supabase.from("pilo_moodle_sites" as never).select("*").eq("space", space).order("created_at").order("id");
  if (rows.error) {
    const missing = missingMigration(rows.error);
    if (missing) return { missing, data: empty };
    dbFail(rows.error);
  }
  const courses = await supabase.from("pilo_moodle_courses").select("*").eq("space", space).order("category_name").order("fullname").limit(2000);
  if (courses.error) {
    const missing = missingMigration(courses.error) ?? "0116";
    return { missing, data: empty };
  }
  const secret = await supabase.rpc("pilo_moodle_sites_status" as never, { p_space: space } as never);
  if (secret.error && missingMigration({ code: secret.error.code, message: `${secret.error.message} pilo_moodle_sites_status` })) return { missing: "0133", data: empty };
  const tokens = (secret.data ?? {}) as Record<string, { has?: boolean; last4?: string } | undefined>;
  return {
    missing: null,
    data: {
      sites: ((rows.data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
        const id = String(r.id ?? "");
        return {
          id,
          name: typeof r.name === "string" ? r.name : id,
          on: r.enabled === true,
          url: typeof r.url === "string" ? r.url : "",
          site: r.site && typeof r.site === "object" ? (r.site as MoodleSite) : {},
          checkedAt: typeof r.checked_at === "string" ? r.checked_at : null,
          token: { has: tokens[id]?.has === true, last4: typeof tokens[id]?.last4 === "string" ? (tokens[id]?.last4 as string) : "" },
        };
      }),
      courses: ((courses.data ?? []) as unknown as CourseRow[]).map((c) => ({ ...c, site: String(c.site ?? ""), course_id: num(c.course_id) })),
    },
  };
}

export function useMoodle(space: PiloSpace, enabled = true) {
  return useQuery({ queryKey: memoKeys.moodle(space), enabled, queryFn: () => fetchMoodle(space) });
}

/** Crea un sitio (con `name`) o cambia su nombre, su dirección o su interruptor; se guarda al momento. */
export const saveMoodleSite = (space: PiloSpace, site: string, patch: { name?: string; url?: string; enabled?: boolean }) =>
  rpc<unknown>("pilo_moodle_site_save", { p_space: space, p_site: site, p_patch: patch });

/** Quita un sitio con su token, sus cursos y lo que Pilo leyó de ellos. */
export const deleteMoodleSite = (space: PiloSpace, site: string) => rpc<{ courses?: number; docs?: number }>("pilo_moodle_site_delete", { p_space: space, p_site: site });

/** Guarda el token de un sitio (o lo quita, con vacío). Devuelve solo sus cuatro últimos caracteres. */
export const saveMoodleToken = (space: PiloSpace, site: string, value: string) => rpc<string>("pilo_moodle_site_set_token", { p_space: space, p_site: site, p_value: value });

export const courseSet = (space: PiloSpace, site: string, course: number, patch: { selected?: boolean; vis?: "publico" | "sesion" }) =>
  rpc<unknown>("pilo_moodle_course_set", { p_space: space, p_site: site, p_course: course, p_patch: patch });

/* --- El mapa ----------------------------------------------------------------------------- */

export async function fetchMap(space: PiloSpace): Promise<Loaded<{ nodes: RawNode[]; edges: RawEdge[]; status: MapStatus | null }>> {
  const none = { nodes: [], edges: [], status: null };
  const status = await supabase.rpc("pilo_map_status" as never, { p_space: space } as never);
  if (status.error) {
    const missing = missingMigration({ code: status.error.code, message: `${status.error.message} pilo_map_status` });
    if (missing) return { missing, data: none };
    dbFail(status.error);
  }
  const mesh = await supabase.rpc("pilo_graph_overview" as never, { p_sources: ["mapa"], p_space: space } as never);
  if (mesh.error) dbFail({ code: mesh.error.code, message: `${mesh.error.message} pilo_graph_overview p_space` });
  const m = (mesh.data ?? {}) as { nodes?: RawNode[]; edges?: RawEdge[] };
  const s = (status.data ?? {}) as Record<string, unknown>;
  return {
    missing: null,
    data: {
      nodes: Array.isArray(m.nodes) ? m.nodes : [],
      edges: Array.isArray(m.edges) ? m.edges : [],
      status: { total: num(s.total), mapped: num(s.mapped), pending: num(s.pending), topics: num(s.topics), refs: num(s.refs) },
    },
  };
}

export function useTeachMap(space: PiloSpace, enabled = true) {
  return useQuery({ queryKey: memoKeys.map(space), enabled, queryFn: () => fetchMap(space) });
}

/** Si este Pilo tiene IA para comprender (y el estado del mapa según la función). Un error se queda en `error`. */
export function useComprehendStatus(space: PiloSpace, enabled = true) {
  return useQuery({ queryKey: memoKeys.mapStatus(space), enabled, retry: false, queryFn: () => comprehend(space, "estado") });
}

/** Los pasajes que llegan por el mapa a partir de los que encontró la búsqueda (hasta 3, como al preguntar). */
export async function mapNeighbors(space: PiloSpace, refs: string[]): Promise<{ ref: string; source: string; title: string; section: string; shared: number }[]> {
  if (!refs.length) return [];
  const { data, error } = await supabase.rpc("pilo_graph_neighbors" as never, { p_refs: refs.slice(0, 3), p_space: space, p_sources: null, p_public_only: false, p_limit: 3 } as never);
  if (error) return [];
  return (data ?? []) as { ref: string; source: string; title: string; section: string; shared: number }[];
}

/* --- La actividad de Pilo y el camino de la prueba -------------------------------------
   Lo que Pilo está haciendo ya no vive en una franja de la Memoria: se reporta
   al almacén de actividad (../actividad) y lo cuenta el panel de Pilo. `reading`
   conserva su forma para los paneles que ya lo usaban. */

/** El camino de la última prueba de la memoria: lo que halló la búsqueda y lo que llegó por el mapa. */
export type ProbePath = { direct: string[]; viaMap: string[]; at: number };

let probePath: ProbePath | null = null;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/** Un panel dice qué está haciendo Pilo; al terminar, lo quita. */
export const reading = {
  set: (job: ReadingJob) => activity.set(job),
  end: (owner: string) => activity.end(owner),
  probe: (probe: ProbePath | null) => {
    probePath = probe;
    for (const l of listeners) l();
  },
};

export const useReading = (): ReadingJob | null => useCurrentJob();
export const useProbePath = () => useSyncExternalStore(subscribe, () => probePath);
