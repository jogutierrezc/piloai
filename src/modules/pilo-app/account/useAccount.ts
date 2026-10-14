/* =============================================================================
   Mr. Pilo · cuentas (0120) · la cuenta de quien tiene la app abierta.

   Un usuario de Pilo tiene sesión de Supabase pero no tiene `profiles`: para
   la intranet es «sin perfil» y no abre nada. Aquí se lee su fila propia de
   `pilo_users` (RLS: cada quien la suya). Sin sesión, con una cuenta de la
   intranet o sin la migración 0120, no hay cuenta: null.

   La lectura va atada a la sesión: entrar o salir cambia la llave y se lee de
   nuevo; guardar las preferencias deja en su sitio la fila que devuelve la
   base.
   ========================================================================== */

import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../../lib/auth";
import { supabase } from "../../../lib/supabase";
import { isMember, parseAccount, prefsPatch } from "./rules";
import type { PiloAccount, Prefs } from "./rules";
import { tr } from "../../../components/pilo/i18n";

const COLUMNS = "id, username, full_name, email, rol, campus, status, nick, tone, length, about, program";

export const accountKey = (userId: string | undefined) => ["pilo-cuenta", userId ?? "nadie"];

export interface AccountState {
  account: PiloAccount | null;
  /** Cuenta activa: vale como sesión en Pilo. */
  member: boolean;
  /** La sesión o la cuenta aún se están leyendo. */
  pending: boolean;
  /** Guarda lo que cambió y devuelve la cuenta al día. */
  save: (next: Prefs) => Promise<PiloAccount>;
  signOut: () => Promise<void>;
}

export function usePiloAccount(): AccountState {
  const { session, profile, loading, signOut: leave } = useAuth();
  const client = useQueryClient();
  const userId = session?.user.id;
  // Quien tiene perfil de intranet no es un usuario de Pilo: no hay nada que leer.
  const enabled = Boolean(userId) && !loading && !profile;
  const query = useQuery({
    queryKey: accountKey(userId),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<PiloAccount | null> => {
      const { data, error } = await supabase.from("pilo_users").select(COLUMNS).eq("id", userId as string).maybeSingle();
      // Sin la migración 0120 la tabla no existe: no hay cuentas.
      return error ? null : parseAccount(data);
    },
  });
  const account = enabled ? (query.data ?? null) : null;

  const save = useCallback(
    async (next: Prefs): Promise<PiloAccount> => {
      if (!account) throw new Error(tr("No hay una cuenta de Pilo en esta sesión."));
      const patch = prefsPatch(account, next);
      if (!Object.keys(patch).length) return account;
      const { data, error } = await supabase.rpc("pilo_user_update_prefs", { p_patch: patch });
      const row = parseAccount(Array.isArray(data) ? data[0] : data);
      if (error || !row) throw new Error(tr("No se pudieron guardar sus preferencias. Intente de nuevo."));
      client.setQueryData(accountKey(userId), row);
      return row;
    },
    [account, client, userId],
  );

  const signOut = useCallback(async () => {
    await leave();
    client.removeQueries({ queryKey: ["pilo-cuenta"] });
    client.removeQueries({ queryKey: ["pilo-guardadas"] });
  }, [leave, client]);

  return { account, member: isMember(account), pending: loading || (enabled && query.isPending), save, signOut };
}
