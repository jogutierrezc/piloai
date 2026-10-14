/* =============================================================================
   Observatorio · dónde vive lo que se arma en el taller.

   Con la migración 0049 aplicada, en Supabase: cuatro tablas (obs_datasets,
   obs_views, obs_topics, obs_bulletins) con RLS. Guardar escribe de una vez,
   como en UDES en Cifras: no hay capa intermedia.

   Sin la migración, el taller no se queda en blanco: trabaja en un borrador
   local (este navegador), sembrado con los datos de ejemplo de la maqueta, y
   lo dice en un aviso. Nada del borrador llega a la base ni al portal.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { describeDatabaseError } from "../../../data/errors";
import type { DatabaseError } from "../../../data/errors";
import { defaultTopic, sampleState } from "./model";
import type { ObsBulletin, ObsDataset, ObsState, ObsTopicConfig, ObsView } from "./model";

export const obsKeys = { all: ["obs-admin"] as const };
/** Caché del portal público (observatorio/live.ts): se invalida al guardar. */
export const obsPublicKey = ["observatorio-publico"] as const;

const LOCAL_KEY = "observatorio:borrador-v1";
const MISSING = new Set(["PGRST205", "42P01"]);

/* --- Filas de la base ⇄ modelo -------------------------------------------------------- */

export interface DatasetRow {
  id: string;
  topic: string;
  title: string;
  description: string;
  source: string;
  data_type: ObsDataset["dataType"];
  temporality: ObsDataset["temporality"];
  period_label: string;
  columns: ObsDataset["columns"];
  rows: ObsDataset["rows"];
  anonymization: ObsDataset["anonymization"];
  is_sample: boolean;
  status: ObsDataset["status"];
  position: number;
  updated_at: string;
}

export interface ViewRow {
  id: string;
  dataset_id: string;
  topic: string;
  spec: Omit<ObsView, "id" | "datasetId" | "topic" | "section" | "size" | "visible" | "position">;
  section: ObsView["section"];
  size: ObsView["size"];
  visible: boolean;
  position: number;
}

export interface TopicRow {
  slug: string;
  template: ObsTopicConfig["template"];
  intro: string;
  sections: ObsTopicConfig["sections"];
  status: ObsTopicConfig["status"];
}

interface BulletinRow {
  id: string;
  title: string;
  subtitle: string;
  settings: { filters: ObsBulletin["filters"]; include: ObsBulletin["include"] };
  updated_at: string;
}

export const datasetFrom = (r: DatasetRow): ObsDataset => ({
  id: r.id,
  topic: r.topic,
  title: r.title,
  description: r.description,
  source: r.source,
  dataType: r.data_type,
  temporality: r.temporality,
  periodLabel: r.period_label,
  columns: r.columns ?? [],
  rows: r.rows ?? [],
  anonymization: r.anonymization,
  sample: r.is_sample,
  status: r.status,
  position: r.position,
  updatedAt: r.updated_at,
});

const datasetTo = (d: ObsDataset) => ({
  id: d.id,
  topic: d.topic,
  title: d.title,
  description: d.description,
  source: d.source,
  data_type: d.dataType,
  temporality: d.temporality,
  period_label: d.periodLabel,
  columns: d.columns,
  rows: d.rows,
  anonymization: d.anonymization,
  is_sample: d.sample,
  status: d.status,
  position: d.position,
});

export const viewFrom = (r: ViewRow): ObsView => ({ ...r.spec, id: r.id, datasetId: r.dataset_id, topic: r.topic, section: r.section, size: r.size, visible: r.visible, position: r.position });

const viewTo = (v: ObsView) => {
  const { id, datasetId, topic, section, size, visible, position, ...spec } = v;
  return { id, dataset_id: datasetId, topic, spec, section, size, visible, position };
};

/* --- Lectura ----------------------------------------------------------------------------- */

function readLocal(): ObsState {
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (raw) return { ...(JSON.parse(raw) as ObsState), mode: "local" };
  } catch {
    /* Almacenamiento bloqueado: se trabaja con la muestra en memoria. */
  }
  return sampleState();
}

function writeLocal(state: ObsState) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
  } catch {
    /* Sin almacenamiento, el borrador dura lo que la pestaña. */
  }
}

async function fetchState(): Promise<ObsState> {
  const [datasets, views, topics, bulletins] = await Promise.all([
    supabase.from("obs_datasets").select("*").order("position"),
    supabase.from("obs_views").select("*").order("position"),
    supabase.from("obs_topics").select("*"),
    supabase.from("obs_bulletins").select("*").order("updated_at", { ascending: false }),
  ]);
  const errors = [datasets.error, views.error, topics.error, bulletins.error].filter(Boolean) as DatabaseError[];
  if (errors.some((e) => MISSING.has(e.code ?? ""))) return readLocal();
  if (errors.length) throw describeDatabaseError(errors[0]);
  return {
    mode: "base",
    datasets: (datasets.data as DatasetRow[]).map(datasetFrom),
    views: (views.data as ViewRow[]).map(viewFrom),
    topics: (topics.data as TopicRow[]).map((t) => ({ slug: t.slug, template: t.template, intro: t.intro, sections: t.sections, status: t.status })),
    bulletins: (bulletins.data as BulletinRow[]).map((b) => ({ id: b.id, title: b.title, subtitle: b.subtitle, filters: b.settings.filters, include: b.settings.include, updatedAt: b.updated_at })),
  };
}

export function useObsState() {
  return useQuery({ queryKey: obsKeys.all, queryFn: fetchState, staleTime: 30_000 });
}

/* --- Escritura ----------------------------------------------------------------------------- */

export type ObsOp =
  | { kind: "dataset"; value: ObsDataset }
  | { kind: "dataset-delete"; id: string }
  | { kind: "view"; value: ObsView }
  | { kind: "views"; value: ObsView[] }
  | { kind: "view-delete"; id: string }
  | { kind: "topic"; value: ObsTopicConfig }
  | { kind: "bulletin"; value: ObsBulletin }
  | { kind: "bulletin-delete"; id: string }
  | { kind: "reset-local" };

const upsertBy = <T extends { id: string }>(list: T[], value: T) => (list.some((x) => x.id === value.id) ? list.map((x) => (x.id === value.id ? value : x)) : [...list, value]);

/** El mismo cambio sobre el estado en memoria (borrador local). */
function applyLocal(state: ObsState, op: ObsOp): ObsState {
  const now = new Date().toISOString();
  switch (op.kind) {
    case "dataset":
      return { ...state, datasets: upsertBy(state.datasets, { ...op.value, updatedAt: now }) };
    case "dataset-delete":
      return { ...state, datasets: state.datasets.filter((d) => d.id !== op.id), views: state.views.filter((v) => v.datasetId !== op.id) };
    case "view":
      return { ...state, views: upsertBy(state.views, op.value) };
    case "views":
      return { ...state, views: op.value.reduce((list, v) => upsertBy(list, v), state.views) };
    case "view-delete":
      return { ...state, views: state.views.filter((v) => v.id !== op.id) };
    case "topic":
      return { ...state, topics: [...state.topics.filter((t) => t.slug !== op.value.slug), op.value] };
    case "bulletin":
      return { ...state, bulletins: upsertBy(state.bulletins, { ...op.value, updatedAt: now }) };
    case "bulletin-delete":
      return { ...state, bulletins: state.bulletins.filter((b) => b.id !== op.id) };
    case "reset-local":
      return sampleState();
  }
}

async function applyBase(op: ObsOp) {
  const check = ({ error }: { error: DatabaseError | null }) => {
    if (error) throw describeDatabaseError(error);
  };
  switch (op.kind) {
    case "dataset":
      return check(await supabase.from("obs_datasets").upsert(datasetTo(op.value)));
    case "dataset-delete":
      return check(await supabase.from("obs_datasets").delete().eq("id", op.id));
    case "view":
      return check(await supabase.from("obs_views").upsert(viewTo(op.value)));
    case "views":
      return check(await supabase.from("obs_views").upsert(op.value.map(viewTo)));
    case "view-delete":
      return check(await supabase.from("obs_views").delete().eq("id", op.id));
    case "topic":
      return check(await supabase.from("obs_topics").upsert({ ...op.value }));
    case "bulletin":
      return check(
        await supabase.from("obs_bulletins").upsert({ id: op.value.id, title: op.value.title, subtitle: op.value.subtitle, settings: { filters: op.value.filters, include: op.value.include } }),
      );
    case "bulletin-delete":
      return check(await supabase.from("obs_bulletins").delete().eq("id", op.id));
    case "reset-local":
      return;
  }
}

export function useObsCommit() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (op: ObsOp) => {
      const state = client.getQueryData<ObsState>(obsKeys.all);
      if (!state || state.mode === "local") {
        const next = applyLocal(state ?? readLocal(), op);
        writeLocal(next);
        return next;
      }
      await applyBase(op);
      return null;
    },
    onSuccess: (next) => {
      if (next) client.setQueryData(obsKeys.all, next);
      else {
        void client.invalidateQueries({ queryKey: obsKeys.all });
        void client.invalidateQueries({ queryKey: obsPublicKey });
      }
    },
  });
}

export { defaultTopic };
