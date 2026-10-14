/* =============================================================================
   Mr. Pilo · cuentas (0120) · las respuestas guardadas.

   Lo que una persona guarda de Pilo vive en su cuenta (`pilo_user_saved`, RLS:
   solo su dueño con la cuenta activa) y lo encuentra en cualquier dispositivo.
   Hasta 300; la base avisa al pasar el tope.

   Lo de arriba es puro (qué se guarda, cómo se busca, cómo se nombra): se
   prueba en node. Lo de abajo habla con la base.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import type { AskSource } from "../../../components/pilo/ai/client";
import { isAskSpace } from "../../pregunta/space";
import type { SpaceId } from "../../pregunta/space";
import { tr } from "../../../components/pilo/i18n";

export interface SavedSource {
  n: number;
  title: string;
  path: string;
  section: string;
}

export interface SavedAnswer {
  id: number;
  space: SpaceId;
  question: string;
  answer: string;
  sources: SavedSource[];
  created_at: string;
}

export interface SavedDraft {
  space: SpaceId;
  question: string;
  answer: string;
  sources: SavedSource[];
}

export const SAVED_LIMIT = 300;
const QUESTION_MAX = 600;
const ANSWER_MAX = 12_000;
/** La base admite 16.000 bytes de fuentes: se deja margen para los acentos. */
const SOURCES_MAX = 9_000;

const text = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function sourcesOf(raw: unknown): SavedSource[] {
  if (!Array.isArray(raw)) return [];
  const out: SavedSource[] = [];
  for (const s of raw as Partial<AskSource>[]) {
    if (!s || typeof s !== "object") continue;
    const title = text(s.title, 200);
    if (!title) continue;
    out.push({ n: Number.isFinite(Number(s.n)) ? Number(s.n) : out.length + 1, title, path: text(s.path, 400), section: text(s.section, 160) });
  }
  while (out.length && JSON.stringify(out).length > SOURCES_MAX) out.pop();
  return out;
}

/** Lo que se guarda de una respuesta completa; null si no hay nada que guardar. */
export function savedDraft(space: SpaceId, question: string, answer: { text?: string; sources?: unknown } | null | undefined, withSources = true): SavedDraft | null {
  const q = question.replace(/\s+/g, " ").trim().slice(0, QUESTION_MAX);
  const a = text(answer?.text, ANSWER_MAX);
  if (!q || !a) return null;
  return { space, question: q, answer: a, sources: withSources ? sourcesOf(answer?.sources) : [] };
}

/** Una fila de `pilo_user_saved`; null si no se entiende. */
export function parseSaved(row: unknown): SavedAnswer | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = Number(r.id);
  if (!Number.isFinite(id) || typeof r.question !== "string" || typeof r.answer !== "string") return null;
  return { id, space: isAskSpace(r.space) ? r.space : "planeacion", question: r.question, answer: r.answer, sources: sourcesOf(r.sources), created_at: typeof r.created_at === "string" ? r.created_at : "" };
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Busca en la pregunta, la respuesta y los títulos de las fuentes: todas las palabras, sin importar acentos ni mayúsculas. */
export function searchSaved(list: SavedAnswer[], query: string): SavedAnswer[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((item) => {
    const hay = fold(`${item.question} ${item.answer} ${item.sources.map((s) => s.title).join(" ")}`);
    return words.every((w) => hay.includes(w));
  });
}

const DAY = 86_400_000;

/** «guardada hoy», «guardada ayer», «guardada hace 3 días», «guardada el 12 de marzo». */
export function savedWhen(iso: string, now: number = Date.now()): string {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "guardada";
  const start = (ms: number) => {
    const d = new Date(ms);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((start(now) - start(at)) / DAY);
  if (days <= 0) return tr("guardada hoy");
  if (days === 1) return tr("guardada ayer");
  if (days < 7) return tr("guardada hace {days} días", { days });
  const d = new Date(at);
  const month = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"][d.getMonth()];
  const year = d.getFullYear() === new Date(now).getFullYear() ? "" : tr(" de {v0}", { v0: d.getFullYear() });
  return tr("guardada el {v0} de {month}{year}", { v0: d.getDate(), month, year });
}

/** La línea de debajo de cada guardada: «Enseñanza · guardada ayer · con 2 fuentes». */
export function savedMeta(item: SavedAnswer, spaceName: string, now: number = Date.now()): string {
  const n = item.sources.length;
  return [spaceName, savedWhen(item.created_at, now), n ? `con ${n} ${n === 1 ? "fuente" : "fuentes"}` : ""].filter(Boolean).join(" · ");
}

/** Lo que se copia: la pregunta, la respuesta en texto llano y sus fuentes. */
export function savedCopyText(item: Pick<SavedAnswer, "question" | "sources">, plain: string, origin: string): string {
  const listed = item.sources.map((s) => `[${s.n}] ${s.title}${s.path ? ` · ${/^https?:/i.test(s.path) ? s.path : `${origin}${s.path}`}` : ""}`);
  return [item.question, plain, listed.join("\n")].filter(Boolean).join("\n\n");
}

/** Lo que dice la base al fallar un guardado, en palabras de la persona. */
export function saveProblem(message: string | null | undefined): string {
  const m = message ?? "";
  if (/300 respuestas/i.test(m)) return tr("Ya tiene 300 respuestas guardadas: quite alguna para guardar otra.");
  if (/pilo_user_saved|does not exist|schema cache/i.test(m)) return tr("Guardar respuestas todavía no está disponible.");
  return tr("No se pudo guardar la respuesta. Intente de nuevo.");
}

/* --- La base ----------------------------------------------------------------------------------- */

export const savedKey = (userId: string | undefined) => ["pilo-guardadas", userId ?? "nadie"];

export async function listSaved(): Promise<SavedAnswer[]> {
  const { data, error } = await supabase.from("pilo_user_saved").select("id, space, question, answer, sources, created_at").order("created_at", { ascending: false }).limit(SAVED_LIMIT);
  if (error) throw new Error(saveProblem(error.message));
  return ((data ?? []) as unknown[]).map(parseSaved).filter((x): x is SavedAnswer => x !== null);
}

export async function saveAnswer(draft: SavedDraft): Promise<SavedAnswer> {
  const { data, error } = await supabase.from("pilo_user_saved").insert(draft).select("id, space, question, answer, sources, created_at").single();
  const row = parseSaved(data);
  if (error || !row) throw new Error(saveProblem(error?.message));
  return row;
}

export async function removeSavedAnswer(id: number): Promise<void> {
  const { error } = await supabase.from("pilo_user_saved").delete().eq("id", id);
  if (error) throw new Error(tr("No se pudo quitar la respuesta. Intente de nuevo."));
}

/** Las guardadas de la cuenta; sin cuenta activa no se pide nada. */
export function useSavedAnswers(userId: string | undefined, member: boolean) {
  return useQuery({ queryKey: savedKey(userId), enabled: member && Boolean(userId), staleTime: 60_000, retry: false, queryFn: listSaved });
}
