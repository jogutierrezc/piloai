/* =============================================================================
   Mr. Pilo · carnet · los ganchos de la pantalla: el perfil, el código que
   cambia y el estado de Google Wallet.

   El código se pide a la función solo mientras alguien lo está mirando (la cara
   del QR, la pantalla completa o la verificación): con la pantalla en la otra
   cara no se firma nada. Cambia con la hora del servidor: el teléfono aprende
   la diferencia de la primera respuesta, así un reloj desajustado no muestra
   un código que el servidor ya no acepta.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccountState } from "../account/useAccount";
import { CarnetError, asCarnetError, fetchToken, loadPerfil, savePerfil, walletAvailable } from "./api";
import { needsRefresh, offsetOf, ringFraction, serverNow, stillShowable } from "./logic";
import type { HeldCode } from "./logic";
import { emptyPerfil } from "./rules";
import type { PerfilForm, PerfilLoaded } from "./rules";
import { windowLeft, windowOf } from "./servidor-logica";
import type { PiloRol } from "../account/rules";

export const perfilKey = (userId: string | undefined) => ["pilo-carnet-perfil", userId ?? "nadie"];

export interface PerfilState {
  form: PerfilForm;
  suspendido: boolean;
  loading: boolean;
  error: CarnetError | null;
  save: (form: PerfilForm) => Promise<PerfilLoaded>;
  refresh: () => Promise<void>;
}

export function usePerfil(state: AccountState): PerfilState {
  const client = useQueryClient();
  const userId = state.account?.id;
  const rol = state.account?.rol as PiloRol | undefined;
  const enabled = Boolean(userId) && state.member;
  const query = useQuery({
    queryKey: perfilKey(userId),
    enabled,
    staleTime: 60_000,
    retry: false,
    queryFn: () => loadPerfil(userId as string),
  });
  const mutation = useMutation({
    mutationFn: (form: PerfilForm) => savePerfil(userId as string, rol as PiloRol, form),
    onSuccess: (next) => client.setQueryData(perfilKey(userId), next),
  });
  const refresh = useCallback(async () => {
    await client.invalidateQueries({ queryKey: perfilKey(userId) });
  }, [client, userId]);
  return {
    form: query.data?.form ?? emptyPerfil(),
    suspendido: query.data?.suspendido ?? false,
    loading: enabled && query.isPending,
    error: query.error ? asCarnetError(query.error) : null,
    save: (form) => mutation.mutateAsync(form),
    refresh,
  };
}

export interface CodeState {
  /** El código para mostrar; null mientras llega o si no se pudo. */
  token: string | null;
  /** Segundos que le quedan a la ventana (30 a 1). */
  left: number;
  /** El número de la ventana del servidor. */
  win: number;
  /** De 0 a 1, lo que falta de la ventana. */
  fraction: number;
  error: CarnetError | null;
  loading: boolean;
  retry: () => void;
}

/**
 * El código del QR. Mientras `active`, lo pide al cambiar la ventana de 30 s del servidor y cuenta
 * los segundos. Si no hay conexión no pide nada y lo dice.
 */
export function useCode(active: boolean, online: boolean): CodeState {
  const [held, setHeld] = useState<HeldCode | null>(null);
  const [error, setError] = useState<CarnetError | null>(null);
  const [tick, setTick] = useState(() => Date.now());
  const [attempt, setAttempt] = useState(0);
  const offset = useRef(0);
  const busy = useRef(false);

  useEffect(() => {
    if (!active) return;
    setTick(Date.now());
    const id = window.setInterval(() => setTick(Date.now()), 1000);
    const wake = () => setTick(Date.now());
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [active]);

  const now = serverNow(offset.current, tick);
  const win = windowOf(now);

  useEffect(() => {
    if (!active || !online || busy.current) return;
    if (!needsRefresh(held, serverNow(offset.current))) return;
    busy.current = true;
    fetchToken()
      .then((reply) => {
        offset.current = offsetOf(reply.ahora, Date.now());
        setHeld({ token: reply.token, win: windowOf(reply.ahora) });
        setError(null);
      })
      .catch((e) => setError(asCarnetError(e)))
      .finally(() => {
        busy.current = false;
      });
    // Una vez por ventana (y a mano, con «retry»): un fallo no se repite cada segundo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, online, win, attempt]);

  const showable = stillShowable(held, now);
  return {
    token: showable ? (held as HeldCode).token : null,
    left: windowLeft(now),
    win,
    fraction: ringFraction(now),
    error: !online && !showable ? new CarnetError("sin_red") : showable ? null : error,
    loading: online && !showable && !error,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

/** ¿Está habilitado Google Wallet en el servidor? null mientras se pregunta o si no se pudo saber. */
export function useWalletReady(enabled: boolean): boolean | null {
  const query = useQuery({ queryKey: ["pilo-carnet-wallet"], enabled, staleTime: 10 * 60_000, retry: false, queryFn: walletAvailable });
  return enabled && !query.isPending && !query.isError ? query.data ?? null : null;
}
