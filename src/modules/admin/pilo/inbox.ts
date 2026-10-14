/* =============================================================================
   Pregúntele a Pilo · la bandeja de lo que no supo (0109).

   La función pilo-ia anota aquí las preguntas que no pudo responder, las que
   alguien marcó «No me sirvió» y las que la IA redactó con una cifra sin
   fuente. La misma pregunta suma veces. La administración la responde en el
   catálogo (y queda resuelta con esa clave) o la descarta.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { DEFAULT_SPACE, isDefaultSpace, readInSpace, spaceKey } from "./space";
import type { PiloSpace } from "./space";

export type InboxReason = "sin_respuesta" | "no_sirvio" | "revisar" | "general";

export interface InboxItem {
  id: number;
  question: string;
  reason: InboxReason;
  kind: string;
  answer: string;
  answer_id: number | null;
  times: number;
  first_at: string;
  last_at: string;
  /** Para quién era (0113): «estudiante», «profesor» o vacío. Solo en espacios con rol. */
  rol?: string;
}

export const REASON_LABEL: Record<InboxReason, string> = {
  sin_respuesta: "No encontró respuesta",
  no_sirvio: "No le sirvió a quien preguntó",
  revisar: "La IA dijo una cifra sin fuente",
  general: "Respondió de conocimiento general",
};

/** Qué quiere decir cada motivo, en una línea y con la salida que sugiere. */
export const REASON_HINT: Record<InboxReason, string> = {
  sin_respuesta: "Era sobre la universidad y no había nada publicado que la respondiera.",
  no_sirvio: "Quien preguntó marcó «No me sirvió».",
  revisar: "La IA escribió una cifra que no está en ninguna fuente: conviene revisarla.",
  general: "Pilo contestó sin fuente institucional, marcado como conocimiento general. Si es un tema que la universidad debería decir con su voz, agregue una respuesta al catálogo o los datos.",
};

/** El motivo, aunque la base traiga uno que esta pantalla aún no conoce. */
export const reasonLabel = (reason: string): string => (REASON_LABEL as Record<string, string>)[reason] ?? reason;
export const reasonHint = (reason: string): string => (REASON_HINT as Record<string, string>)[reason] ?? "";

const inboxKey = ["pilo-ia", "bandeja"] as const;

const INBOX_COLUMNS = "id, question, reason, kind, answer, answer_id, times, first_at, last_at";

/** La bandeja de un espacio (0113): cada Pilo tiene la suya. Sin 0109, null. */
export async function fetchInbox(limit = 12, space: PiloSpace = DEFAULT_SPACE): Promise<{ rows: InboxItem[]; total: number } | null> {
  const { data, error, count } = await readInSpace(space, (scoped) => {
    // «rol» solo existe con 0113: el Pilo de siempre no lo pide.
    const query = supabase.from("pilo_inbox").select(isDefaultSpace(space) ? INBOX_COLUMNS : `${INBOX_COLUMNS}, rol`, { count: "exact" }).eq("status", "pendiente");
    return (scoped ? query.eq("space", space) : query).order("times", { ascending: false }).order("last_at", { ascending: false }).limit(limit);
  });
  if (error) return null;
  return { rows: (data ?? []) as unknown as InboxItem[], total: count ?? 0 };
}

/** Lo pendiente: lo más preguntado primero. Sin 0109, null. */
export function useInbox(limit = 12, space: PiloSpace = DEFAULT_SPACE) {
  return useQuery({
    queryKey: [...inboxKey, limit, ...spaceKey(space)],
    queryFn: () => fetchInbox(limit, space),
  });
}

/** Resolver (con la clave del catálogo) o descartar. Al resolver, la respuesta guardada que no sirvió se oculta. */
export function useCloseInbox() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, key }: { id: number; status: "resuelta" | "descartada"; key?: string }) => {
      const { error } = await supabase.rpc("pilo_inbox_close", { p_id: id, p_status: status, p_key: key ?? null } as never);
      if (error) throw error;
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: inboxKey });
      void client.invalidateQueries({ queryKey: ["pilo-ia", "memoria", "respuestas"] });
    },
  });
}
