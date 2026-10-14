/* =============================================================================
   Administración de Pilo · acceso.

   Mr. Pilo recibe a quien entra y reacciona a lo que pasa en el formulario:
   reposo, escribiendo, verificando, error, éxito (y «sin acceso»). Todo el
   movimiento sale de ../admin/motion/presets (con rama de movimiento reducido).
   La ruta sigue siendo /acceso-intranet.

   Quien decide el acceso es `staffRole` (personal de Pilo), no el perfil de PDI.
   ========================================================================== */

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { PiloAvatar } from "../../components/pilo/PiloAvatar";
import { Icon } from "../../components/ui/Icon";
import { useAuth } from "../../lib/auth";
import { isSupabaseConfigured, supabase } from "../../lib/supabase";
import { useTheme } from "../../lib/theme";
import { pageLeave, shake, useEnterCascade } from "../admin/motion/presets";
import type { MotionHandle } from "../admin/motion/presets";
import {
  ADMIN_HOME,
  PHASE_LINE,
  PHASE_MOOD,
  derivePhase,
  friendlyAuthError,
  friendlyPasswordError,
  fromOfState,
  isRecoveryRequest,
  newPasswordProblem,
  passwordRules,
  safeRedirect,
} from "./login-logic";
import "../../styles/admin-tokens.css";
import "./login.css";

/** Cuánto se espera a que llegue el rol tras iniciar sesión antes de decir «sin acceso». */
const ROLE_GRACE_MS = 1800;
/** Pilo celebra este rato antes de que la pantalla salga. */
const CELEBRATE_MS = 0.55;

export function LoginPortal() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [focus, setFocus] = useState<"email" | "password" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [resetting, setResetting] = useState(false);
  /** Inició sesión aquí y se espera el rol. */
  const [awaiting, setAwaiting] = useState(false);
  const [leaving, setLeaving] = useState(false);
  // Modo «Define tu contraseña»: invitación o recuperación (?clave=1 / PASSWORD_RECOVERY).
  const [recovery, setRecovery] = useState(() => isRecoveryRequest(typeof window === "undefined" ? "" : window.location.search));
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [recoveryField, setRecoveryField] = useState<"password" | "confirm" | null>(null);

  const location = useLocation();
  const navigate = useNavigate();
  const { resolved } = useTheme();
  const errorId = useId();
  const rulesId = useId();
  const auth = useAuth();
  const { session, loading, staffRole, signIn, signOut, requestPasswordReset } = auth;

  const compact = useCompact();
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const submittedHere = useRef(false);
  const leaveHandle = useRef<MotionHandle | null>(null);
  const alive = useRef(true);

  const from = safeRedirect(fromOfState(location.state), ADMIN_HOME);

  useEffect(() => {
    const previous = document.title;
    document.title = "Administración de Pilo | Universidad de Santander";
    return () => {
      document.title = previous;
    };
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      leaveHandle.current?.kill();
    };
  }, []);

  // Volver del correo: la plataforma avisa con PASSWORD_RECOVERY (puede llegar antes
  // de montar esta pantalla; por eso también cuenta ?clave=1 en la dirección).
  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Entrada coreografiada: Pilo y la voz primero, luego el formulario.
  useEnterCascade(rootRef, "[data-cascade]");

  // Llegó el rol tras iniciar sesión aquí: Pilo celebra y la pantalla sale hacia el destino.
  useEffect(() => {
    if (!submittedHere.current || recovery || loading || !staffRole || !session || leaving) return;
    setLeaving(true);
    setAwaiting(false);
    const handle = pageLeave(rootRef.current, { delay: CELEBRATE_MS });
    leaveHandle.current = handle;
    void handle.done.then(() => {
      if (alive.current) navigate(from, { replace: true });
    });
  }, [recovery, loading, staffRole, session, leaving, navigate, from]);

  // Si el rol no llega a tiempo, la cuenta no tiene acceso.
  useEffect(() => {
    if (!awaiting) return;
    const timer = window.setTimeout(() => setAwaiting(false), ROLE_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [awaiting]);

  // El error sacude la tarjeta una vez por intento.
  useEffect(() => {
    if (!error) return;
    const handle = shake(cardRef.current);
    return () => handle.kill();
  }, [error]);

  // Quien ya tiene acceso y no acaba de entrar aquí no necesita el formulario.
  // En modo recuperación NUNCA se redirige: primero se define la contraseña.
  if (!recovery && !loading && session && staffRole && !submittedHere.current) return <Navigate to={from} replace />;

  // Enlace de invitación sin sesión (venció o ya se usó): se explica y se vuelve al acceso normal.
  const linkExpired = recovery && !loading && !session;
  const inRecovery = recovery && !!session;
  const noAccess = !recovery && !loading && !!session && !staffRole && !awaiting && !pending && !leaving;
  const typing = recovery ? recoveryField !== null : focus === "password" || (focus !== null && email.length > 0);
  const phase = derivePhase({ pending: pending || awaiting, error: !!error, leaving, noAccess, typing, recovery: inRecovery });
  const busy = pending || awaiting || leaving;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setNotice("");

    if (!email.trim() || !password) {
      setError("Ingresa tu correo institucional y tu contraseña para continuar.");
      (email.trim() ? document.getElementById("password") : emailRef.current)?.focus();
      return;
    }

    setPending(true);
    setError("");
    submittedHere.current = true;
    try {
      await signIn(email, password);
      if (alive.current) setAwaiting(true);
    } catch (signInError) {
      submittedHere.current = false;
      setError(friendlyAuthError(signInError instanceof Error ? signInError.message : null));
    } finally {
      if (alive.current) setPending(false);
    }
  }

  async function handleSetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const problem = newPasswordProblem(newPass, confirmPass);
    if (problem) {
      setError(problem.message);
      document.getElementById(problem.field === "password" ? "new-password" : "confirm-password")?.focus();
      return;
    }
    setPending(true);
    setError("");
    const { error: failed } = await supabase.auth.updateUser({ password: newPass });
    if (!alive.current) return;
    setPending(false);
    if (failed) {
      setError(friendlyPasswordError(failed.message));
      return;
    }
    // Contraseña guardada: recién ahora se sale hacia el destino (si el rol ya está, corre el efecto de salida).
    submittedHere.current = true;
    setNewPass("");
    setConfirmPass("");
    setRecovery(false);
    if (!staffRole) setAwaiting(true);
  }

  async function handleReset() {
    if (resetting) return;
    if (!email.trim()) {
      setError("Escribe tu correo institucional para enviarte el enlace de recuperación.");
      emailRef.current?.focus();
      return;
    }
    setError("");
    setResetting(true);
    try {
      await requestPasswordReset(email);
      setNotice("Si el correo existe, recibirás un enlace para restablecer la contraseña.");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "No se pudo enviar el enlace.");
    } finally {
      if (alive.current) setResetting(false);
    }
  }

  async function handleSignOut() {
    submittedHere.current = false;
    try {
      await signOut();
    } finally {
      if (alive.current) {
        setPassword("");
        setError("");
      }
    }
  }

  const logo = resolved === "dark" ? "/logo-udes-oscuro.svg" : "/logo-udes.svg";

  return (
    <div className="lg" ref={rootRef} data-phase={phase}>
      <a className="skip-link" href="#acceso">
        Saltar al formulario
      </a>

      <aside className="lg-stage">
        <div className="lg-stage__pilo" data-cascade>
          <PiloAvatar mood={PHASE_MOOD[phase]} size={compact ? 84 : 230} alive />
        </div>
        <p className="lg-bubble" data-cascade aria-hidden="true">
          <span key={phase} className="lg-bubble__text">
            {PHASE_LINE[phase]}
          </span>
        </p>
      </aside>

      <main className="lg-main" id="acceso">
        <div className="lg-top" data-cascade>
          <img className="lg-logo" src={logo} alt="Universidad de Santander" width={132} height={47} />
          <ThemeToggle />
        </div>

        <div className="lg-card" ref={cardRef}>
          {inRecovery ? (
            <section aria-labelledby="lg-title">
              <header className="lg-head">
                <p className="lg-eyebrow">Primer acceso · Mr. Pilo</p>
                <h1 id="lg-title">Define tu contraseña</h1>
                <p className="lg-lede">
                  {session?.user?.email ? <>Para <strong>{session.user.email}</strong>. </> : null}Será solo tuya; la usarás cada vez que entres.
                </p>
              </header>

              <form onSubmit={handleSetPassword} noValidate aria-busy={busy}>
                <div className="lg-field">
                  <label htmlFor="new-password">Contraseña nueva</label>
                  <div className="lg-input">
                    <Icon name="lock" size={18} />
                    <input
                      id="new-password"
                      name="new-password"
                      type={revealed ? "text" : "password"}
                      value={newPass}
                      onChange={(event) => {
                        setNewPass(event.target.value);
                        if (error) setError("");
                      }}
                      onFocus={() => setRecoveryField("password")}
                      onBlur={() => setRecoveryField(null)}
                      autoComplete="new-password"
                      autoFocus
                      aria-invalid={!!error}
                      aria-describedby={`${rulesId}${error ? ` ${errorId}` : ""}`}
                      required
                    />
                    <button
                      className="lg-reveal"
                      type="button"
                      onClick={() => setRevealed((value) => !value)}
                      aria-label={revealed ? "Ocultar contraseñas" : "Mostrar contraseñas"}
                      aria-pressed={revealed}
                    >
                      {revealed ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>

                <ul className="lg-rules" id={rulesId} aria-label="La contraseña debe tener">
                  {passwordRules(newPass).map((rule) => (
                    <li key={rule.id} data-met={rule.met}>
                      <Icon name={rule.met ? "check" : "close"} size={14} />
                      <span>{rule.label}</span>
                      <span className="sr-only">{rule.met ? " (cumplido)" : " (pendiente)"}</span>
                    </li>
                  ))}
                </ul>

                <div className="lg-field">
                  <label htmlFor="confirm-password">Repite la contraseña</label>
                  <div className="lg-input">
                    <Icon name="lock" size={18} />
                    <input
                      id="confirm-password"
                      name="confirm-password"
                      type={revealed ? "text" : "password"}
                      value={confirmPass}
                      onChange={(event) => {
                        setConfirmPass(event.target.value);
                        if (error) setError("");
                      }}
                      onFocus={() => setRecoveryField("confirm")}
                      onBlur={() => setRecoveryField(null)}
                      autoComplete="new-password"
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      required
                    />
                  </div>
                </div>

                {error && (
                  <p className="lg-alert" id={errorId} role="alert">
                    <Icon name="alert" size={16} />
                    <span>{error}</span>
                  </p>
                )}

                <p className="sr-only" role="status">
                  {pending ? "Guardando tu contraseña…" : ""}
                </p>

                <button className="lg-submit" type="submit" aria-disabled={busy}>
                  {busy ? (
                    <>
                      <span className="lg-spin" aria-hidden="true" /> Guardando
                    </>
                  ) : (
                    <>
                      Guardar y entrar <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </form>
            </section>
          ) : noAccess ? (
            <section aria-labelledby="lg-title" className="lg-noaccess">
              <p className="lg-eyebrow">
                <Icon name="lock" size={14} /> Sin acceso
              </p>
              <h1 id="lg-title">Tu cuenta no tiene acceso a la administración de Pilo</h1>
              <p className="lg-lede">
                Entraste como <strong>{session?.user?.email ?? "esta cuenta"}</strong>, pero no figura en el personal de Pilo. Pide a un
                administrador que te dé acceso o entra con otra cuenta.
              </p>
              <button className="lg-submit" type="button" onClick={handleSignOut}>
                Cerrar sesión
              </button>
            </section>
          ) : (
            <section aria-labelledby="lg-title">
              <header className="lg-head">
                <p className="lg-eyebrow" data-cascade>
                  Mr. Pilo · Universidad de Santander
                </p>
                <h1 id="lg-title" data-cascade>
                  Administración de Pilo
                </h1>
                <p className="lg-lede" data-cascade>
                  Documentos, voz y usuarios de Mr. Pilo en un solo lugar.
                </p>
              </header>

              {linkExpired && (
                <p className="lg-alert" role="alert">
                  <Icon name="alert" size={16} />
                  <span>El enlace de invitación venció o ya se usó. Escribe tu correo y pulsa «¿Olvidaste tu contraseña?» para recibir uno nuevo.</span>
                </p>
              )}

              {!isSupabaseConfigured && (
                <p className="lg-alert" role="alert">
                  <Icon name="alert" size={16} />
                  <span>
                    Falta configurar la conexión con Supabase. Revisa <code>.env.local</code>.
                  </span>
                </p>
              )}

              <form onSubmit={handleSubmit} noValidate aria-busy={busy}>
                <div className="lg-field" data-cascade>
                  <label htmlFor="email">Correo institucional</label>
                  <div className="lg-input">
                    <Icon name="user" size={18} />
                    <input
                      ref={emailRef}
                      id="email"
                      name="email"
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError("");
                      }}
                      onFocus={() => setFocus("email")}
                      onBlur={() => setFocus(null)}
                      placeholder="nombre.apellido@udes.edu.co"
                      autoComplete="username"
                      autoCapitalize="none"
                      inputMode="email"
                      spellCheck={false}
                      autoFocus
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      required
                    />
                  </div>
                </div>

                <div className="lg-field" data-cascade>
                  <label htmlFor="password">Contraseña</label>
                  <div className="lg-input">
                    <Icon name="lock" size={18} />
                    <input
                      id="password"
                      name="password"
                      type={revealed ? "text" : "password"}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        if (error) setError("");
                      }}
                      onFocus={() => setFocus("password")}
                      onBlur={() => setFocus(null)}
                      placeholder="Tu contraseña"
                      autoComplete="current-password"
                      aria-invalid={!!error}
                      aria-describedby={error ? errorId : undefined}
                      required
                    />
                    <button
                      className="lg-reveal"
                      type="button"
                      onClick={() => setRevealed((value) => !value)}
                      aria-label={revealed ? "Ocultar contraseña" : "Mostrar contraseña"}
                      aria-pressed={revealed}
                    >
                      {revealed ? "Ocultar" : "Mostrar"}
                    </button>
                  </div>
                </div>

                <div className="lg-options" data-cascade>
                  <span className="lg-hint">La sesión queda abierta en este dispositivo.</span>
                  <button type="button" className="lg-link" onClick={handleReset} aria-disabled={resetting}>
                    {resetting ? "Enviando…" : "¿Olvidaste tu contraseña?"}
                  </button>
                </div>

                {error && (
                  <p className="lg-alert" id={errorId} role="alert">
                    <Icon name="alert" size={16} />
                    <span>{error}</span>
                  </p>
                )}

                {notice && (
                  <p className="lg-ok" role="status">
                    <Icon name="check" size={16} />
                    <span>{notice}</span>
                  </p>
                )}

                <p className="sr-only" role="status">
                  {phase === "verificando" ? "Verificando tus datos…" : phase === "exito" ? "Acceso correcto. Entrando a la administración." : ""}
                </p>

                <button className="lg-submit" type="submit" aria-disabled={busy} data-cascade>
                  {leaving ? (
                    <>
                      <Icon name="check" size={18} /> Entrando
                    </>
                  ) : busy ? (
                    <>
                      <span className="lg-spin" aria-hidden="true" /> Verificando
                    </>
                  ) : (
                    <>
                      Entrar <span aria-hidden="true">→</span>
                    </>
                  )}
                </button>
              </form>

              <p className="lg-restricted" data-cascade>
                <Icon name="lock" size={14} /> Acceso restringido al personal autorizado de Pilo
              </p>
            </section>
          )}
        </div>

        <p className="lg-back" data-cascade>
          <Link to="/">
            <span aria-hidden="true">←</span> Volver al portal público
          </Link>
        </p>
      </main>
    </div>
  );
}

function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const dark = resolved === "dark";
  return (
    <button className="lg-theme" type="button" onClick={toggle} aria-label={dark ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}>
      <Icon name={dark ? "sun" : "moon"} size={18} />
    </button>
  );
}

/** Pantallas estrechas: Pilo se encoge y pasa a una franja superior. */
function useCompact(): boolean {
  const query = "(max-width: 899px)";
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return compact;
}
