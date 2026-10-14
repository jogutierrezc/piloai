/* =============================================================================
   Mr. Pilo · funciones ampliadas (0119): ¿puede esta persona adjuntar un
   archivo o pedir código?

   pilo_extras_public() dice, por cada Pilo, para quién está cada función y el
   tamaño máximo del archivo. Aquí solo se decide si se pinta el clip: la
   función del servidor vuelve a revisarlo todo. Sin la migración 0119 no hay
   funciones ampliadas.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { extraAllowed } from "./logic";
import type { ExtraAudience } from "./logic";

export interface PublicExtras {
  filesAud: ExtraAudience;
  codeAud: ExtraAudience;
  fileMaxMb: number;
}

export const NO_EXTRAS: PublicExtras = { filesAud: "nadie", codeAud: "nadie", fileMaxMb: 10 };

const aud = (v: unknown): ExtraAudience => (v === "admin" || v === "sesion" || v === "publico" ? v : "nadie");

/** Lo que devuelve pilo_extras_public(), por espacio; lo que no se entiende queda apagado. */
export function parseExtras(raw: unknown): Record<string, PublicExtras> {
  const out: Record<string, PublicExtras> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [space, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z]{3,20}$/.test(space) || !value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const mb = Number(v.file_max_mb);
    out[space] = { filesAud: aud(v.files_aud), codeAud: aud(v.code_aud), fileMaxMb: Number.isFinite(mb) ? Math.min(25, Math.max(1, Math.round(mb))) : NO_EXTRAS.fileMaxMb };
  }
  return out;
}

/** Lo que este Pilo le permite a esta persona. `role` es el de la intranet; sin sesión, null. */
export function extrasFor(all: Record<string, PublicExtras> | null | undefined, space: string, role: string | null) {
  const mine = all?.[space] ?? NO_EXTRAS;
  return { files: extraAllowed(mine.filesAud, role), code: extraAllowed(mine.codeAud, role), fileMaxMb: mine.fileMaxMb };
}

export function usePiloExtras() {
  return useQuery({
    queryKey: ["pilo-ia", "extras"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<Record<string, PublicExtras>> => {
      const { data, error } = await supabase.rpc("pilo_extras_public");
      // Sin la migración 0119, sencillamente no hay funciones ampliadas.
      return error || !data ? {} : parseExtras(data);
    },
  });
}
