/* =============================================================================
   Sesión y rol.

   La sesión la emite Supabase. Dos cosas se leen de ella, y son independientes:
   · el perfil de PDI (public.profiles), que usan las pantallas públicas y la
     app de Pilo para saludar y recordar a quien ya tiene cuenta;
   · el personal de Pilo (public.pilo_staff), que decide quién entra a la
     administración y con qué rol (ver pilo-staff.ts, el contrato).
   Una cuenta de pilo_staff no tiene perfil de PDI: el acceso a la
   administración nunca depende de `profile`.

   Sin la migración de pilo_staff la lectura falla; entonces solo cuenta el
   administrador de PDI (`effectiveStaffRole`), que es como se entra hoy.

   Ojo: lo que se comprueba aquí sirve para *mostrar u ocultar* interfaz. La
   autorización real ocurre en la base de datos; si esta capa fallara, un
   usuario sin permisos vería botones que no funcionan, no datos que no debería.
   ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { canUseArea, canWorkInSpace, effectiveStaffRole, isStaffRole } from "./pilo-staff";
import type { PiloSpaceId, PiloStaffRole, PiloStaffRow, StaffArea } from "./pilo-staff";
import { safeReturnPath, shouldTouch, STAFF_HOME } from "./staff-access";
import type { Profile } from "../types/database";

export interface AuthContextValue {
  session: Session | null;
  /** Perfil de PDI, si lo tiene. Quien solo es personal de Pilo no lo tiene. */
  profile: Profile | null;
  /** Su fila de pilo_staff, si existe y se pudo leer. */
  staff: PiloStaffRow | null;
  /** Rol con el que trabaja en la administración; null = sin acceso a ella. */
  staffRole: PiloStaffRole | null;
  /** true mientras se resuelve la sesión inicial: evita parpadeos de "no autorizado". */
  loading: boolean;
  error: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  /** ¿Su rol abre esta zona de la administración? */
  canUse: (area: StaffArea) => boolean;
  /** ¿Su rol carga documentos en este espacio? */
  canWorkInSpace: (space: PiloSpaceId) => boolean;
  /** A dónde lleva el inicio de sesión: el panel de la administración. */
  home: string;
}

/** El panel de la administración. Se conserva el nombre por quien ya lo importa. */
export const INTRANET_HOME = STAFF_HOME;

/**
 * A dónde llevar a alguien que acaba de iniciar sesión. Si una guarda lo mandó
 * al login desde una pantalla interna, vuelve a ella; si no, al panel. El
 * segundo argumento se conserva por compatibilidad: ya no cambia el destino.
 */
export function afterLoginPath(from: unknown, _who?: unknown): string {
  return safeReturnPath(from, STAFF_HOME);
}

/** Exportado para montar la administración con una sesión simulada (pruebas y bancos de pruebas). */
export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Lee la fila de pilo_staff de la persona. `ok: false` = la lectura falló
 * (migración sin aplicar, RLS, red); no es lo mismo que «no tiene fila».
 */
async function readStaff(userId: string): Promise<{ row: PiloStaffRow | null; ok: boolean }> {
  try {
    const { data, error } = await supabase.from("pilo_staff").select("*").eq("user_id", userId).maybeSingle();
    if (error) return { row: null, ok: false };
    if (!data || !isStaffRole((data as { role?: unknown }).role)) return { row: null, ok: true };
    return { row: data as PiloStaffRow, ok: true };
  } catch {
    return { row: null, ok: false };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [staff, setStaff] = useState<PiloStaffRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /** Turno de la última lectura: una lectura vieja que termina tarde (p. ej. la
   *  de antes de cerrar sesión) no pisa a la más reciente. */
  const ticket = useRef(0);
  /** Cuándo se anotó el último ingreso (pilo_staff_touch); null = aún no. */
  const touchedAt = useRef<number | null>(null);

  /** A quién pertenecen el perfil y el personal que hay en memoria. */
  const loadedFor = useRef<string | null>(null);

  // Sesión, perfil y personal se publican de una vez: si la sesión llegara
  // antes que el rol, la guarda vería «sesión sin rol» un instante y mandaría a
  // «Sin permiso» a quien sí tiene acceso. Y si la relectura de la misma
  // persona falla (red, token en renovación), se conserva lo que ya se sabía en
  // lugar de quitarle el rol.
  const loadPerson = useCallback(async (next: Session | null) => {
    const mine = ++ticket.current;
    const userId = next?.user.id;

    if (!userId) {
      loadedFor.current = null;
      setSession(null);
      setProfile(null);
      setStaff(null);
      return;
    }

    const [profileResult, staffResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      readStaff(userId),
    ]);
    if (mine !== ticket.current) return;

    const ok = !profileResult.error && staffResult.ok;
    if (profileResult.error) setError(profileResult.error.message);
    const keepPrevious = !ok && loadedFor.current === userId;

    setSession(next);
    if (!keepPrevious) {
      const data = profileResult.error ? null : profileResult.data;
      const person = data && data.is_active ? (data as Profile) : null;
      // Releer sin cambios no debe repintar toda la administración.
      setProfile((previous) => (JSON.stringify(previous) === JSON.stringify(person) ? previous : person));
      setStaff((previous) => (JSON.stringify(previous) === JSON.stringify(staffResult.row) ? previous : staffResult.row));
      loadedFor.current = userId;
    }

    // Anota el ingreso del personal, sin esperar y como mucho cada ~10 min.
    if (staffResult.row?.active && shouldTouch(touchedAt.current, Date.now())) {
      touchedAt.current = Date.now();
      void Promise.resolve(supabase.rpc("pilo_staff_touch")).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data }) => {
      if (cancelled) return;
      await loadPerson(data.session);
      if (!cancelled) setLoading(false);
    });

    // Cubre el inicio de sesión, el cierre, la renovación del token y —lo que
    // más importa aquí— la vuelta desde un enlace de invitación o recuperación.
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, next) => {
      if (cancelled) return;
      // Fuera del callback: Supabase no admite esperar otra llamada suya dentro.
      setTimeout(() => {
        if (cancelled) return;
        void loadPerson(next).then(() => {
          if (!cancelled) setLoading(false);
        });
      }, 0);
    });

    // Un administrador puede cambiar el rol de alguien que ya tiene la
    // administración abierta. Al volver a la pestaña se relee, para que el
    // cambio se aplique sin cerrar sesión.
    const refresh = () => {
      if (document.visibilityState !== "visible") return;
      void supabase.auth.getSession().then(({ data }) => {
        if (!cancelled && data.session) void loadPerson(data.session);
      });
    };
    document.addEventListener("visibilitychange", refresh);

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [loadPerson]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      setError(null);
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        throw new Error(
          signInError.message === "Invalid login credentials"
            ? "Correo o contraseña incorrectos."
            : signInError.message,
        );
      }

      await loadPerson(data.session);
    },
    [loadPerson],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    ticket.current += 1;
    touchedAt.current = null;
    loadedFor.current = null;
    setProfile(null);
    setStaff(null);
    setSession(null);
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/acceso-intranet`,
    });
    if (resetError) throw new Error(resetError.message);
  }, []);

  // Sin sesión no hay rol, aunque quedara un perfil o una fila en memoria.
  const staffRole = useMemo(
    () =>
      session
        ? effectiveStaffRole({ staff, pdiAdmin: Boolean(profile?.is_active && profile.role === "admin") })
        : null,
    [session, staff, profile],
  );

  const canUse = useCallback((area: StaffArea) => canUseArea(staffRole, area), [staffRole]);
  const canWork = useCallback((space: PiloSpaceId) => canWorkInSpace(staffRole, space), [staffRole]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session, profile, staff, staffRole, loading, error, signIn, signOut, requestPasswordReset,
      canUse, canWorkInSpace: canWork, home: STAFF_HOME,
    }),
    [session, profile, staff, staffRole, loading, error, signIn, signOut, requestPasswordReset, canUse, canWork],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth debe usarse dentro de <AuthProvider>");
  return context;
}
