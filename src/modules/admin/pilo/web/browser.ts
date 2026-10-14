/* =============================================================================
   Intranet · Mr. Pilo con IA · Páginas web · el navegador (0132).

   La conexión con el servicio de navegador (navegador/, en la raíz del
   repositorio): su dirección, su interruptor y su clave. Es una sola para todo
   el portal y nace apagada. La clave se escribe y no vuelve: la base devuelve
   solo sus cuatro últimos caracteres (pilo_browser_set_key), igual que las
   claves de la IA y el token de Moodle.

   Aquí: leer y guardar esa conexión, y lo que se calcula sin pantalla (la
   revisión de la dirección y de la clave antes de mandarlas).
   ========================================================================== */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browserEndpoint } from "../../../../components/pilo/ai/logic";
import { supabase } from "../../../../lib/supabase";

export interface BrowserSetup {
  /** Falta la migración 0132: no hay dónde guardar la conexión. */
  missing: boolean;
  enabled: boolean;
  url: string;
  key: { has: boolean; last4: string };
  /** Encendido, con dirección y con clave: se puede pedir «con navegador». */
  ready: boolean;
}

export const BROWSER_KEY_MIN = 24;
export const browserKey = ["pilo-ia", "navegador"] as const;

const EMPTY: BrowserSetup = { missing: false, enabled: false, url: "", key: { has: false, last4: "" }, ready: false };

/** Lo que devuelve pilo_browser_status, venga como venga. «ready» se calcula aquí: no se le cree a un campo suelto. */
export function parseBrowser(data: unknown): BrowserSetup {
  const d = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const k = (d.key && typeof d.key === "object" ? d.key : {}) as Record<string, unknown>;
  const url = typeof d.url === "string" ? d.url : "";
  const key = { has: k.has === true, last4: typeof k.last4 === "string" ? k.last4.slice(-4) : "" };
  const enabled = d.enabled === true;
  return { missing: false, enabled, url, key, ready: enabled && key.has && browserEndpoint(url).ok };
}

/** La dirección del servicio que se puede guardar, o por qué no. La misma revisión que hace la función. */
export function checkBrowserUrl(raw: string): { ok: true; url: string } | { ok: false; why: string } {
  const checked = browserEndpoint(raw);
  return checked.ok ? { ok: true, url: checked.base } : { ok: false, why: checked.reason };
}

/** La clave que se puede guardar (sin espacios), o por qué no. */
export function checkBrowserKey(raw: string): { ok: true; key: string } | { ok: false; why: string } {
  const key = raw.replace(/\s/g, "");
  if (key.length < BROWSER_KEY_MIN) return { ok: false, why: `La clave debe tener al menos ${BROWSER_KEY_MIN} caracteres: la misma de NAVEGADOR_CLAVE en el servicio.` };
  if (key.length > 200) return { ok: false, why: "La clave es demasiado larga." };
  return { ok: true, key };
}

const gone = (error: { code?: string; message?: string }) =>
  ["PGRST202", "PGRST205", "42883", "42P01"].includes(error.code ?? "") || /could not find|does not exist|schema cache/i.test(error.message ?? "");

async function call(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw Object.assign(new Error(gone(error) ? "Falta aplicar la migración 0132 en la base." : error.message), { code: error.code, missing: gone(error) });
  return data;
}

export async function fetchBrowser(): Promise<BrowserSetup> {
  try {
    return parseBrowser(await call("pilo_browser_status"));
  } catch (error) {
    if ((error as { missing?: boolean }).missing) return { ...EMPTY, missing: true };
    throw error;
  }
}

/** La conexión con el navegador. Solo se pregunta donde hace falta (la administración). */
export function useBrowser(enabled = true) {
  return useQuery({ queryKey: browserKey, enabled, retry: false, staleTime: 60_000, queryFn: fetchBrowser });
}

export function useRefreshBrowser() {
  const client = useQueryClient();
  return () => void client.invalidateQueries({ queryKey: browserKey });
}

/** Guarda el interruptor o la dirección; lo que va en null se deja como está. */
export const saveBrowser = async (patch: { enabled?: boolean; url?: string }) => parseBrowser(await call("pilo_browser_save", { p_enabled: patch.enabled ?? null, p_url: patch.url ?? null }));

/** Guarda la clave (o la quita, con vacío). Devuelve solo sus cuatro últimos caracteres. */
export const saveBrowserKey = async (value: string) => String((await call("pilo_browser_set_key", { p_value: value })) ?? "");
