/* =============================================================================
   Mr. Pilo · colecciones de documentos propias (0125).

   Una colección es una fila de `pilo_sources` (kind «documentos»). La
   administración crea las suyas en cualquiera de los dos Pilos, las renombra y,
   vacías, las borra; las de partida no se tocan. Nacen en «no» en la matriz de
   «Qué lee cada portal»: lo que se suba no entra en las respuestas hasta que se
   encienda (o hasta que se pida leerla desde ya al crearla).

   Lo puro va arriba (el nombre, el id que saldrá de él y cuándo se puede
   borrar); lo que habla con la base, abajo. Las reglas de la base se repiten
   aquí solo para avisar antes de pedir: la base vuelve a revisarlas.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { portalKeys } from "./portals";
import type { PiloSource } from "./portals";
import type { PiloSpace } from "./space";

export const COLLECTION_NAME = { min: 3, max: 80 } as const;
/** Cuántas colecciones propias admite cada Pilo. */
export const MAX_CUSTOM = 30;

/** El nombre como lo guarda la base: espacios sobrantes fuera y con tope. */
export const cleanName = (value: string): string => value.replace(/\s+/g, " ").trim().slice(0, COLLECTION_NAME.max);

/**
 * El id interno que saldrá del nombre (pilo_collection_slug): sin tildes, en
 * minúsculas y solo letras; los dígitos pasan a letras (0→a … 9→j).
 */
export function collectionId(name: string): string {
  const plain = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return plain.replace(/[0-9]/g, (d) => "abcdefghij"[Number(d)]).slice(0, 30);
}

const RESERVED = new Set(["mapa", "tema", "ref", "doc", "fuente"]);

/** Por qué este nombre no sirve para una colección nueva del Pilo `scope`; `null` si sirve. */
export function nameProblem(raw: string, scope: string, sources: PiloSource[], ignore?: string): string | null {
  const name = cleanName(raw);
  const id = collectionId(name);
  if (name.length < COLLECTION_NAME.min || id.length < COLLECTION_NAME.min) return "Escriba un nombre de al menos tres letras o números.";
  if (RESERVED.has(id)) return "Ese nombre está reservado: elija otro.";
  const twin = sources.find((s) => s.scope === scope && s.id !== ignore && (s.id === id || s.name.toLowerCase() === name.toLowerCase()));
  if (twin) return `Ya existe «${twin.name}» en este Pilo.`;
  return null;
}

/** Las colecciones propias de un Pilo, en el orden del catálogo. */
export const customOf = (sources: PiloSource[], scope: string): PiloSource[] => sources.filter((s) => s.scope === scope && s.kind === "documentos" && s.custom === true);

/** ¿La base ya tiene 0125? Se sabe porque el catálogo trae la columna `custom`. */
export const collectionsReady = (sources: PiloSource[] | undefined): boolean => Boolean(sources?.length) && sources!.every((s) => typeof s.custom === "boolean");

/** Por qué una colección propia no se puede borrar todavía; `null` si está vacía. */
export function deleteBlock(docs: number): string | null {
  if (docs <= 0) return null;
  return `Tiene ${docs.toLocaleString("es-CO")} ${docs === 1 ? "documento" : "documentos"}: muévalos a otra colección o bórrelos antes.`;
}

/* --- Lo que habla con la base ------------------------------------------------------------- */

interface DbError {
  code?: string;
  message?: string;
}

const MISSING_0125 = "Falta aplicar la migración 0125 en la base: hasta entonces no se pueden crear colecciones propias.";

/** El mensaje de un error de las funciones de colecciones, en palabras de la pantalla. */
export function collectionFault(error: DbError | null | undefined): string {
  if (!error) return "No se pudo.";
  if (["PGRST202", "42883"].includes(error.code ?? "") || /could not find the function|schema cache/i.test(error.message ?? "")) return MISSING_0125;
  if (error.code === "42501" || /permission denied/i.test(error.message ?? "")) return "Solo la administración maneja las colecciones de Pilo.";
  return (error.message ?? "").trim() || "No se pudo.";
}

async function call<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(collectionFault(error));
  return data as T;
}

/** Tras cualquier cambio: el catálogo (y con él la matriz y los selectores de colección) se vuelve a leer. */
function useAfterChange() {
  const client = useQueryClient();
  return (space: PiloSpace) => {
    void client.invalidateQueries({ queryKey: portalKeys.all });
    void client.invalidateQueries({ queryKey: ["pilo-ia", "memoria"] });
    void client.invalidateQueries({ queryKey: ["pilo-ia", "espacio", space, "ficha"] });
  };
}

export interface CreatedCollection {
  id: string;
  scope: string;
  name: string;
  read: boolean;
}

export function useCreateCollection(space: PiloSpace) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: ({ name, read }: { name: string; read: boolean }) => call<CreatedCollection>("pilo_collection_create", { p_scope: space, p_name: cleanName(name), p_read: read }),
    onSettled: () => after(space),
  });
}

export function useRenameCollection(space: PiloSpace) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => call<{ id: string; name: string }>("pilo_collection_rename", { p_id: id, p_name: cleanName(name) }),
    onSettled: () => after(space),
  });
}

export function useDeleteCollection(space: PiloSpace) {
  const after = useAfterChange();
  return useMutation({
    mutationFn: ({ id }: { id: string }) => call<{ id: string; name: string }>("pilo_collection_delete", { p_id: id }),
    onSettled: () => after(space),
  });
}

/** Cuántos pasajes tiene cada una de esas fuentes en el Pilo. Sirve a las colecciones propias, que no están en la lista fija de Enseñanza. */
export function useSourceCounts(space: PiloSpace, ids: string[], enabled = true) {
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["pilo-ia", "memoria", "conteo-colecciones", space, key] as const,
    enabled: enabled && ids.length > 0,
    queryFn: async (): Promise<Record<string, number>> => {
      const out: Record<string, number> = {};
      for (const id of ids) {
        const { count, error } = await supabase.from("pilo_memory").select("ref", { count: "exact", head: true }).eq("space", space).eq("source", id);
        if (error) throw new Error(error.message);
        out[id] = count ?? 0;
      }
      return out;
    },
  });
}
