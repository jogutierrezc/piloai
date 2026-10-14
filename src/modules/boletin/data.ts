/* =============================================================================
   Boletín UDES en Cifras · datos.

   Plantillas en od_bulletins, ediciones congeladas en od_bulletin_editions y
   archivos (PDF de ediciones, portadas propias) en el bucket "boletines".
   La autorización vive en RLS (0027): aquí solo se lee y se escribe.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../lib/supabase";
import { describeDatabaseError, FriendlyError } from "../../data/errors";
import type { DatabaseError } from "../../data/errors";
import type { OdBulletinEditionRow, OdBulletinRow, PublicationStatus } from "../../types/database";

export const BULLETIN_BUCKET = "boletines";
/** 50 MB, el tope del bucket. */
export const MAX_BULLETIN_BYTES = 50 * 1024 * 1024;

export const bulletinKeys = {
  all: ["boletines"] as const,
  period: (periodId: string) => [...bulletinKeys.all, "periodo", periodId] as const,
  one: (id: string) => [...bulletinKeys.all, "uno", id] as const,
  public: (periodId: string) => [...bulletinKeys.all, "publico", periodId] as const,
};

type Result<T> = { data: T | null; error: DatabaseError | null };

function unwrap<T>({ data, error }: Result<T>): T {
  if (error) throw describeDatabaseError(error);
  return data as T;
}

export interface BulletinBundle {
  bulletins: OdBulletinRow[];
  editions: OdBulletinEditionRow[];
}

async function editionsOf(ids: string[]): Promise<OdBulletinEditionRow[]> {
  if (!ids.length) return [];
  return unwrap<OdBulletinEditionRow[]>(
    await supabase.from("od_bulletin_editions").select("*").in("bulletin_id", ids).order("published_at", { ascending: false }),
  );
}

/** Intranet: plantillas y ediciones del periodo (RLS deja ver las del alcance de cada rol). */
export function useBulletins(periodId: string | undefined) {
  return useQuery({
    queryKey: bulletinKeys.period(periodId ?? "none"),
    enabled: Boolean(periodId),
    queryFn: async (): Promise<BulletinBundle> => {
      const bulletins = unwrap<OdBulletinRow[]>(
        await supabase.from("od_bulletins").select("*").eq("period_id", periodId!).order("created_at"),
      );
      return { bulletins, editions: await editionsOf(bulletins.map((b) => b.id)) };
    },
  });
}

export function useBulletin(id: string | undefined) {
  return useQuery({
    queryKey: bulletinKeys.one(id ?? "none"),
    enabled: Boolean(id),
    queryFn: async () => unwrap<OdBulletinRow | null>(await supabase.from("od_bulletins").select("*").eq("id", id!).maybeSingle()),
  });
}

/**
 * Portal: boletines en vivo del periodo publicado y sus ediciones. Para el
 * público, RLS solo devuelve lo publicado; las ediciones se leen solas porque
 * guardan su propio título.
 */
export function usePublicBulletins(periodId: string | undefined) {
  return useQuery({
    queryKey: bulletinKeys.public(periodId ?? "none"),
    enabled: Boolean(periodId),
    queryFn: async (): Promise<BulletinBundle> => {
      const bulletins = unwrap<OdBulletinRow[]>(
        await supabase.from("od_bulletins").select("*").eq("period_id", periodId!).eq("status", "publicado").order("created_at"),
      );
      const editions = unwrap<OdBulletinEditionRow[]>(
        await supabase.from("od_bulletin_editions").select("*").eq("status", "publicado").order("published_at", { ascending: false }),
      );
      return { bulletins, editions };
    },
  });
}

export function bulletinFileUrl(path: string): string {
  return supabase.storage.from(BULLETIN_BUCKET).getPublicUrl(path).data.publicUrl;
}

function safeName(name: string): string {
  return (
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase() || "archivo"
  );
}

async function upload(folder: string, file: File, allowed: string[]): Promise<{ path: string; size: number }> {
  const ext = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  if (!allowed.includes(ext)) {
    throw new FriendlyError(`El archivo debe ser ${allowed.join(", ")}.`, { original: `Formato no admitido: ${ext || "sin extensión"}` });
  }
  if (file.size > MAX_BULLETIN_BYTES) {
    throw new FriendlyError("El archivo pasa de 50 MB, el tope del almacenamiento de boletines.", { original: `Tamaño ${file.size}` });
  }
  const path = `${folder}/${Date.now()}-${safeName(file.name)}`;
  const { error } = await supabase.storage.from(BULLETIN_BUCKET).upload(path, file, { upsert: false, contentType: file.type || undefined });
  if (error) throw new FriendlyError("No se pudo subir el archivo. Revisa la conexión y que el bucket «boletines» exista (migración 0027).", { original: error.message, retryable: true });
  return { path, size: file.size };
}

function useBulletinMutation<TInput, TResult = unknown>(fn: (input: TInput) => Promise<TResult>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => client.invalidateQueries({ queryKey: bulletinKeys.all }),
  });
}

/** Crea o actualiza una plantilla. */
export function useSaveBulletin() {
  return useBulletinMutation(async (row: Partial<OdBulletinRow> & { period_id: string }) => {
    const { id, ...rest } = row;
    if (id) {
      return unwrap<OdBulletinRow>(await supabase.from("od_bulletins").update(rest).eq("id", id).select().single());
    }
    return unwrap<OdBulletinRow>(await supabase.from("od_bulletins").insert(rest).select().single());
  });
}

export function useSetBulletinStatus() {
  return useBulletinMutation(async ({ id, status }: { id: string; status: PublicationStatus }) =>
    unwrap(await supabase.from("od_bulletins").update({ status }).eq("id", id)),
  );
}

export function useDeleteBulletin() {
  return useBulletinMutation(async ({ id, files }: { id: string; files: string[] }) => {
    unwrap(await supabase.from("od_bulletins").delete().eq("id", id));
    if (files.length) await supabase.storage.from(BULLETIN_BUCKET).remove(files);
  });
}

/** Sube una imagen de plantilla (portada o contraportada) y devuelve su URL pública. */
export function useUploadBulletinImage() {
  return useMutation({
    mutationFn: async ({ bulletinId, file }: { bulletinId: string; file: File }) => {
      const { path } = await upload(`plantillas/${bulletinId}`, file, [".webp", ".png", ".jpg", ".jpeg"]);
      return bulletinFileUrl(path);
    },
  });
}

/** Congela una edición: sube el PDF y la deja publicada. */
export function useCreateEdition() {
  return useBulletinMutation(
    async ({ bulletin, file, label, cutLabel, periodLabel, note }: {
      bulletin: OdBulletinRow; file: File; label: string; cutLabel: string; periodLabel: string; note: string;
    }) => {
      const { path, size } = await upload(`ediciones/${bulletin.id}`, file, [".pdf"]);
      try {
        return unwrap<OdBulletinEditionRow>(
          await supabase
            .from("od_bulletin_editions")
            .insert({ bulletin_id: bulletin.id, title: bulletin.title, period_label: periodLabel, label, cut_label: cutLabel, file_path: path, file_size: size, note })
            .select()
            .single(),
        );
      } catch (error) {
        // Sin fila, el archivo quedaría huérfano en Storage.
        await supabase.storage.from(BULLETIN_BUCKET).remove([path]);
        throw error;
      }
    },
  );
}

export function useSetEditionStatus() {
  return useBulletinMutation(async ({ id, status }: { id: string; status: OdBulletinEditionRow["status"] }) =>
    unwrap(await supabase.from("od_bulletin_editions").update({ status }).eq("id", id)),
  );
}

export function useDeleteEdition() {
  return useBulletinMutation(async (edition: OdBulletinEditionRow) => {
    unwrap(await supabase.from("od_bulletin_editions").delete().eq("id", edition.id));
    await supabase.storage.from(BULLETIN_BUCKET).remove([edition.file_path]);
  });
}
