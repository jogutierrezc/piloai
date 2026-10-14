/* =============================================================================
   Observatorio · lo publicado desde el taller de la intranet.

   El portal lee de Supabase (0049) solo lo que Planeación publicó:
   · temas en estado «publicado» (su tipo de informe, presentación y secciones);
   · tablas de datos en estado «publicado» (ya agregadas y anonimizadas);
   · visores visibles sobre esas tablas.
   Los filtros van explícitos en la consulta: una persona con sesión de
   intranet también tiene permiso de leer borradores, y el portal no debe
   enseñárselos.

   Un tema está «en vivo» cuando está publicado y tiene al menos un visor que
   dibujar. Los demás siguen con la maqueta y su aviso de datos de ejemplo:
   el tablero pasa a datos reales tema por tema, sin quedar vacío nunca.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { numberOf, textOf } from "../data/free-sets";
import type { ValueFormat } from "../data/types";
import { datasetFrom, obsPublicKey, viewFrom } from "../../admin/observatorio/store";
import type { DatasetRow, TopicRow, ViewRow } from "../../admin/observatorio/store";
import type { ObsDataset, ObsTopicConfig, ObsView } from "../../admin/observatorio/model";

export interface LiveTopic {
  config: ObsTopicConfig;
  datasets: Map<string, ObsDataset>;
  /** Visores visibles, en el orden de la página (sección y posición). */
  views: ObsView[];
  sources: string[];
  updatedAt: string;
}

const MISSING = new Set(["PGRST205", "42P01"]);

async function fetchLive(): Promise<Map<string, LiveTopic>> {
  const [topics, datasets, views] = await Promise.all([
    supabase.from("obs_topics").select("slug,template,intro,sections,status").eq("status", "publicado"),
    supabase.from("obs_datasets").select("*").eq("status", "publicado").order("position"),
    supabase.from("obs_views").select("*").eq("visible", true).order("position"),
  ]);
  const errors = [topics.error, datasets.error, views.error].filter(Boolean);
  // Sin el esquema o sin red, el portal sigue con la maqueta: nunca en blanco.
  if (errors.length) {
    if (!errors.every((e) => MISSING.has(e!.code ?? ""))) console.warn("Observatorio: no se pudo leer lo publicado", errors[0]);
    return new Map();
  }
  const byTopic = new Map<string, LiveTopic>();
  const allDatasets = (datasets.data as DatasetRow[]).map(datasetFrom);
  const allViews = (views.data as ViewRow[]).map(viewFrom);
  for (const row of topics.data as TopicRow[]) {
    const config: ObsTopicConfig = { slug: row.slug, template: row.template, intro: row.intro, sections: row.sections, status: row.status };
    const own = new Map(allDatasets.filter((d) => d.topic === row.slug).map((d) => [d.id, d]));
    const order = new Map(config.sections.map((s, i) => [s, i]));
    const list = allViews
      .filter((v) => v.topic === row.slug && own.has(v.datasetId) && order.has(v.section))
      .sort((a, b) => order.get(a.section)! - order.get(b.section)! || a.position - b.position);
    if (!list.length) continue;
    const used = [...new Set(list.map((v) => v.datasetId))].map((id) => own.get(id)!);
    byTopic.set(row.slug, {
      config,
      datasets: own,
      views: list,
      sources: [...new Set(used.map((d) => d.source).filter(Boolean))],
      updatedAt: used.map((d) => d.updatedAt).sort().pop() ?? "",
    });
  }
  return byTopic;
}

export function useObservatoryLive() {
  return useQuery({ queryKey: obsPublicKey, queryFn: fetchLive, staleTime: 60_000 });
}

/* --- Resúmenes para el tablero ---------------------------------------------------------- */

const TIME = /^\s*(19|20)\d{2}(\s*[-_ ]?\s*(0?[12]|I{1,2}|[AB]))?\s*$/i;

/** Categoría → suma de una cifra (la reserva «< 5» no suma). */
export function totalsOf(dataset: ObsDataset, category: string, measure: string) {
  const sums = new Map<string, number | null>();
  for (const row of dataset.rows) {
    if (row.kind !== "dato") continue;
    const label = textOf(row.cells[category]);
    if (!label) continue;
    if (!sums.has(label)) sums.set(label, null);
    const n = numberOf(row.cells[measure]);
    if (n !== null) sums.set(label, (sums.get(label) ?? 0) + n);
  }
  return [...sums.entries()].map(([label, value]) => ({ label, value }));
}

export interface LiveSummary {
  label: string;
  value: number;
  format: ValueFormat;
  unit: string;
  /** Serie en el tiempo para la minigráfica, si el tema tiene una. */
  spark: number[] | null;
  /** Reparto para la vista previa del tablero, si el tema tiene uno. */
  share: { title: string; items: [string, number][] } | null;
}

/**
 * La cifra titular de un tema publicado: el último punto de su primera serie
 * en el tiempo o, si no la hay, el total (o la primera cifra) de su primer
 * visor con cifras.
 */
export function summarize(topic: LiveTopic): LiveSummary | null {
  let headline: Omit<LiveSummary, "share"> | null = null;
  let share: LiveSummary["share"] = null;
  for (const view of topic.views) {
    const dataset = topic.datasets.get(view.datasetId)!;
    const measure = dataset.columns.find((c) => c.key === view.series?.[0] && c.kind === "cifra");
    if (!measure) continue;
    const format = measure.format ?? "decimal";
    const unit = measure.unit ?? "";
    if (!view.category) {
      if (!headline) {
        const first = dataset.rows.find((r) => r.kind === "dato" && numberOf(r.cells[measure.key]) !== null);
        if (first) headline = { label: view.title, value: numberOf(first.cells[measure.key])!, format, unit, spark: null };
      }
      continue;
    }
    const items = totalsOf(dataset, view.category, measure.key).filter((i): i is { label: string; value: number } => i.value !== null);
    if (!items.length) continue;
    const timeLike = items.every((i) => TIME.test(i.label));
    if (timeLike) {
      const ordered = [...items].sort((a, b) => a.label.localeCompare(b.label, "es", { numeric: true }));
      const last = ordered[ordered.length - 1];
      if (!headline || !headline.spark) headline = { label: `${view.title} · ${last.label}`, value: last.value, format, unit, spark: ordered.map((i) => i.value) };
    } else {
      if (!headline) {
        const additive = format === "entero";
        headline = additive
          ? { label: view.title, value: items.reduce((s, i) => s + i.value, 0), format, unit, spark: null }
          : { label: `${view.title} · ${items[0].label}`, value: items[0].value, format, unit, spark: null };
      }
      if (!share && format === "entero" && items.length >= 2) {
        share = { title: view.title, items: [...items].sort((a, b) => b.value - a.value).slice(0, 8).map((i) => [i.label, i.value]) };
      }
    }
    if (headline?.spark && share) break;
  }
  return headline ? { ...headline, share } : null;
}
