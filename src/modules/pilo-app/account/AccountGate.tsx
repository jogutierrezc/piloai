/* =============================================================================
   Mr. Pilo · cuentas (0120) · /app/cuenta.

   A un lado, Pilo en su escenario (la cara oficial, la entrada de la
   bienvenida, cada frase palabra por palabra, el ánimo de su voz); al otro, lo
   que se llena. Seis pantallas en una:

     registro    guiado por Pilo: correo → perfil → sede (si el correo no la
                 dice) → nombre y usuario → contraseña → cómo le habla → listo
     visita      usar Pilo sin cuenta: cómo le dice, en qué tono y con qué tema
     ingreso     usuario y contraseña
     olvidé      el correo para cambiar la contraseña
     clave       la contraseña nueva, al volver del correo (?clave=1)
     confirmada  al volver del correo de confirmación (?confirmada=1)

   La voz es la oficial o ninguna (official-voice.ts), por el mismo camino de
   la bienvenida; sin voz, queda el texto. La contraseña vive solo en la
   memoria de esta pantalla mientras se escribe: no se guarda ni se registra.
   En la dirección nunca viaja un correo ni un usuario.

   Movimiento: transform y opacidad. Cada animación se monta en un contexto de
   GSAP que, al interrumpirse, devuelve todo a su estado visible. Lo que se
   avanza con el teclado no se anima. Con movimiento reducido, solo fundidos.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { modulateVoice, normalizeMood } from "../../../components/pilo/ai/voice-expressions";
import { supabase } from "../../../lib/supabase";
import { Pilo } from "../../pregunta/Pilo";
import type { MojiMood, PiloMojiHandle } from "../../pregunta/Pilo";
import type { AppVoice } from "../access";
import { APP_PROFILE, gateMode, linkExpired } from "../routes";
import type { AppTheme } from "../themes";
import { sayOfficial, stopOfficial } from "../official-voice";
import { reducedMotion } from "../pwa";
import { isNative } from "../native";
import { Icon } from "../icons";
import { asCuentaError, checkUsername, loginAccount, recoverPassword, registerAccount, resendConfirmation } from "./api";
import { acceptPolicy } from "../terms/acceptance";
import { CONSENT_LABEL, POLICY_LINK_LABEL, RULES_TITLE } from "../terms/policy";
import { GoldenRules } from "../terms/GoldenRules";
import { PolicyLink } from "../terms/PolicyLink";
import {
  CAMPUSES,
  DOMAINS,
  EMPTY_REG,
  ROLES,
  TONES,
  USERNAME_HINT,
  campusLabel,
  cleanEmail,
  cleanUsername,
  cuentasOff,
  emailRule,
  firstName,
  passwordProblem,
  regSteps,
  registerErrorField,
  registerErrorStep,
  rolLabel,
  rolQuestion,
  stepProblem,
  suggestUsername,
  usernameProblem,
} from "./rules";
import type { Campus, CuentaCode, PiloAccount, PiloRol, RegData, RegStep, StepProblem, Tone } from "./rules";
import { readVisitor, visitorNick, visitorNickProblem, writeVisitor } from "./visitor";
import { Benefits, Field, Msg, PasswordChecklist, Seg, ThemePicker } from "./parts";
import { tr, useLang, LangSwitch } from "../../../components/pilo/i18n";

type Mode = "registro" | "visita" | "ingreso" | "olvide" | "clave" | "confirmada";
type Step = RegStep | "listo";

interface Line {
  key: number;
  text: string;
  face: MojiMood;
  /** El ánimo de la voz (los de voice-expressions) y cómo se nombra en pantalla. */
  mood: "emocionado" | "atento" | "pensar";
  label: string;
}

const MOOD_LABEL: Record<Line["mood"], string> = { emocionado: "Emocionado", atento: "Atento", pensar: "Reflexivo" };

/** Ya hubo un toque o una tecla en esta página: el dispositivo deja sonar. */
const touched = () => typeof navigator !== "undefined" && Boolean((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive);

const FIELD_ID: Record<StepProblem["field"], string> = { email: "pc-correo", rol: "pc-perfil", campus: "pc-sede", fullName: "pc-nombre", username: "pc-usuario", password: "pc-clave", nick: "pc-trato", terms: "pc-terminos" };

const TONE_OPTIONS = TONES.map((t) => ({ id: t.id, label: t.label }));

const OPENING: Record<Mode, [string, MojiMood, Line["mood"], string?]> = {
  registro: ["¡Hola! Soy Mr. Pilo. Para crear su cuenta, empecemos por su correo de la UDES.", "feliz", "emocionado"],
  visita: ["También puede usarme sin cuenta. Solo dígame cómo le digo y en qué tono le hablo.", "feliz", "atento"],
  ingreso: ["¡Qué bueno verle de nuevo! Entre con su usuario de Pilo.", "feliz", "emocionado"],
  olvide: ["No pasa nada. Dígame su usuario y le envío un correo para cambiar la contraseña.", "atento", "atento"],
  clave: ["Escriba su contraseña nueva. Que sea solo para Pilo.", "cuidado", "atento", "De cuidado"],
  confirmada: ["Un momento, estoy revisando su cuenta.", "piensa", "pensar"],
};

export interface GateProps {
  /** La voz oficial con que habla Pilo aquí; null si no está disponible (queda el texto). */
  voice: AppVoice | null;
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
  theme: AppTheme;
  onTheme: (theme: AppTheme) => void;
  account: PiloAccount | null;
  /** La sesión o la cuenta aún se están leyendo. */
  pending: boolean;
  /** Hay una sesión de Supabase (de Pilo o de la intranet). */
  hasSession: boolean;
  /** El nombre de quien entró con su cuenta de la intranet; null si no. */
  intranetName: string | null;
  /** A dónde se vuelve a conversar. */
  home: string;
  /** La app de escritorio (desktop.ts): la cuenta es obligatoria, no se ofrece usar a Pilo sin ella. */
  required?: boolean;
}

/** Con la cuenta obligatoria, lo que Pilo dice al abrir el registro y el ingreso. */
const OPENING_REQUIRED: Partial<Record<Mode, string>> = {
  registro: "En el computador trabajo con su cuenta de Pilo. Para crearla, empecemos por su correo de la UDES.",
  ingreso: "¡Qué bueno verle! Entre con su usuario de Pilo para usarme en este computador.",
};

/** Lo mismo, en la app de Android: allí Pilo vive en el teléfono. */
const OPENING_PHONE: Partial<Record<Mode, string>> = {
  registro: "En el teléfono trabajo con su cuenta de Pilo. Para crearla, empecemos por su correo de la UDES.",
  ingreso: "¡Qué bueno verle! Entre con su usuario de Pilo para usarme en este teléfono.",
};

/** Segundos que se espera para reenviar el correo de confirmación. */
const RESEND_WAIT = 30;

export function AccountGate({ voice, voiceOn, onVoice, theme, onTheme, account, pending, hasSession, intranetName, home, required = false }: GateProps) {
  useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const asked = useMemo(() => {
    const mode = gateMode(location.search);
    // Con la cuenta obligatoria no hay «sin cuenta»: quien llega ahí ve el registro.
    return required && mode === "visita" ? "registro" : mode;
  }, [location.search, required]);
  // Lo que la plataforma dejó en la dirección al volver de un enlace vencido: se mira una vez, al llegar.
  const [expired] = useState(() => (typeof window === "undefined" ? false : linkExpired(window.location.hash, window.location.search)));

  const [mode, setMode] = useState<Mode>(asked);
  const [data, setData] = useState<RegData>(EMPTY_REG);
  const [step, setStep] = useState<Step>("correo");
  const [error, setError] = useState<StepProblem | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "bad" | "info"; text: string } | null>(null);
  const [off, setOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [userEdited, setUserEdited] = useState(false);
  const [userCheck, setUserCheck] = useState<{ state: "idle" | "checking" | "free" | "taken" | "unknown"; reason?: string }>({ state: "idle" });
  const [done, setDone] = useState<{ username: string; email: string; rol: string; campus: string; nick: string; after: "entro" | "ingresar" | "confirmar" } | null>(null);
  // La espera entre un envío del correo y el siguiente: corre mientras se ve «Revise su correo».
  const [wait, setWait] = useState(0);
  const phone = useMemo(() => required && isNative(), [required]);
  const openingOf = (m: Mode) => (required && ((phone ? OPENING_PHONE[m] : undefined) ?? OPENING_REQUIRED[m])) || OPENING[m][0];
  // Ingreso, olvido y contraseña nueva.
  const [login, setLogin] = useState({ username: "", password: "" });
  const [loginError, setLoginError] = useState<{ code: CuentaCode; message: string } | null>(null);
  const [sent, setSent] = useState(false);
  const [newPass, setNewPass] = useState("");
  const [passError, setPassError] = useState("");
  const [changed, setChanged] = useState(false);
  // Sin cuenta.
  const [guest, setGuest] = useState(() => readVisitor() ?? { nick: "", tone: "cercano" as Tone });
  const [guestError, setGuestError] = useState("");

  const rule = useMemo(() => emailRule(data.email), [data.email]);
  const steps = useMemo(() => regSteps(rule), [rule]);

  /* --- Pilo en su escenario --------------------------------------------------------------- */

  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const pilo = useRef<PiloMojiHandle>(null);
  const body = useRef<HTMLElement | null>(null);
  /** El paso que se ve (un formulario o un bloque): ahí va el foco al cambiar. */
  const setBody = (el: HTMLElement | null) => {
    body.current = el;
  };
  const pointerAt = useRef(0);
  const first = useRef(true);
  const [armed, setArmed] = useState(touched);
  const [silent, setSilent] = useState(false);
  const [line, setLine] = useState<Line>(() => {
    const [text, face, mood, label] = OPENING[asked];
    return { key: 0, text: openingOf(asked) || text, face, mood, label: label ?? MOOD_LABEL[mood] };
  });
  const say = (text: string, face: MojiMood = "feliz", mood: Line["mood"] = "atento", label?: string) => setLine((l) => ({ key: l.key + 1, text: tr(text), face, mood, label: tr(label ?? MOOD_LABEL[mood]) }));
  const speaks = Boolean(voice) && voiceOn && armed && !silent;

  // El primer toque (o tecla) estrena el audio: desde ahí Pilo puede sonar.
  useEffect(() => {
    if (armed) return;
    const arm = () => setArmed(true);
    window.addEventListener("pointerup", arm, { once: true });
    window.addEventListener("keyup", arm, { once: true });
    return () => {
      window.removeEventListener("pointerup", arm);
      window.removeEventListener("keyup", arm);
    };
  }, [armed]);

  // La entrada: la misma de la bienvenida.
  useLayoutEffect(() => {
    const root = stage.current!;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.from(root, { autoAlpha: 0, duration: 0.3 });
        return;
      }
      gsap
        .timeline()
        .from(".pc-glow", { scale: 0.4, autoAlpha: 0, duration: 1.1, ease: "power2.out" }, 0)
        .from(".pc-rings i", { scale: 0.6, autoAlpha: 0, duration: 1, stagger: 0.12, ease: "power3.out" }, 0.1)
        .from(holder.current, { y: 140, scale: 0.82, rotation: -10, autoAlpha: 0, duration: 0.9, ease: "back.out(1.5)" }, 0.2)
        .add(() => {
          pilo.current?.mood("sorpresa");
          pilo.current?.blink();
        }, 0.8)
        .add(() => pilo.current?.look(-0.9, -0.1), 1.05)
        .add(() => pilo.current?.look(0.9, -0.1), 1.4)
        .add(() => {
          pilo.current?.look(0, 0);
          pilo.current?.mood("feliz");
        }, 1.7);
    }, root);
    return () => {
      // Interrumpida (o desmontada), todo vuelve a verse.
      ctx.revert();
      stopOfficial();
    };
  }, []);

  // Cada frase: palabra por palabra mientras Pilo habla, con su cara.
  useLayoutEffect(() => {
    const root = stage.current!;
    const still = reducedMotion();
    const words = root.querySelectorAll(".pc-bubble .wd");
    const perWord = still ? 0 : speaks ? 0.2 : 0.06;
    let cancelled = false;
    pilo.current?.mood(line.face);
    if (speaks && voice) {
      const rate = voice.modulation ? modulateVoice(normalizeMood(line.mood), voice.rate, voice.pitch).rate : voice.rate;
      void sayOfficial(line.text, {
        portal: voice.portal,
        advanced: voice.advanced,
        rate,
        // El pico se mueve con el audio de verdad: cuando empieza y hasta que calla.
        onSound: (on) => !cancelled && pilo.current?.talk(on),
      }).then((result) => {
        // Sin audio no hay otra voz: queda el texto.
        if (!cancelled && result === "sin voz") setSilent(true);
      });
    } else {
      pilo.current?.talk(true);
    }
    const ctx = gsap.context(() => {
      const tl = gsap.timeline();
      if (words.length) tl.fromTo(words, { autoAlpha: 0, y: still ? 0 : 8 }, { autoAlpha: 1, y: 0, duration: still ? 0.2 : 0.32, stagger: perWord, ease: "power3.out" }, 0);
      tl.add(() => {
        if (!speaks) pilo.current?.talk(false);
      }, words.length * perWord + 0.3);
    }, root);
    return () => {
      cancelled = true;
      ctx.revert();
      stopOfficial();
      pilo.current?.talk(false);
    };
    // `voice` no cambia a media frase de un modo que importe: manda `speaks`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line.key, speaks]);

  /* --- Cambiar de pantalla y de paso ------------------------------------------------------- */

  // El foco va al paso nuevo, que entra deslizando y desvaneciéndose (hacia adelante desde la derecha, hacia atrás desde la izquierda).
  // Corto (menos de 320 ms) y se puede interrumpir: otro paso lo deja terminado y visible.
  const lastAt = useRef(0);
  useLayoutEffect(() => {
    const at = mode === "registro" ? (step === "listo" ? steps.length : Math.max(0, steps.indexOf(step))) : 0;
    const dir = at >= lastAt.current ? 1 : -1;
    lastAt.current = at;
    if (first.current) {
      first.current = false;
      return;
    }
    const el = body.current;
    if (!el) return;
    (el.querySelector<HTMLElement>("[data-first]") ?? el.querySelector<HTMLElement>("h2"))?.focus({ preventScroll: true });
    el.scrollIntoView({ block: "nearest" });
    if (reducedMotion()) {
      const fade = gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.15, clearProps: "opacity" });
      return () => {
        fade.progress(1).kill();
      };
    }
    const tween = gsap.fromTo(el, { opacity: 0, x: dir * 28 }, { opacity: 1, x: 0, duration: 0.3, ease: "expo.out", clearProps: "opacity,transform" });
    return () => {
      tween.progress(1).kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, step]);

  // La espera para reenviar el correo baja de a un segundo.
  useEffect(() => {
    if (wait <= 0) return;
    const timer = window.setTimeout(() => setWait((w) => Math.max(0, w - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [wait]);

  const stepLine = (next: Step, d: RegData = data) => {
    const r = emailRule(d.email);
    if (next === "correo") say(tr(openingOf("registro")), "feliz", "emocionado");
    else if (next === "perfil" && r) say(rolQuestion(r), "feliz", "atento");
    else if (next === "sede") say(tr("¿En cuál sede está? Así le respondo con lo de su sede."), "feliz", "atento");
    else if (next === "identidad") say(tr("Mucho gusto. ¿Cómo se llama? Le propongo un usuario para entrar; cámbielo si quiere."), "feliz", "atento");
    else if (next === "clave") say(tr("Ahora una contraseña solo para Pilo. No use la de su correo ni la de Moodle."), "cuidado", "atento", tr("De cuidado"));
    else if (next === "trato") say(tr("Casi listo. Dígame cómo le digo y en qué tono prefiere que le hable."), "feliz", "emocionado");
  };

  const goStep = (next: Step, d: RegData = data) => {
    setError(null);
    setNotice(null);
    setStep(next);
    stepLine(next, d);
  };

  const goMode = (next: Mode) => {
    setError(null);
    setNotice(null);
    setLoginError(null);
    setSent(false);
    setGuestError("");
    setMode(next);
    if (next === "registro") {
      const at = step === "listo" ? "correo" : step;
      if (step === "listo") {
        setData(EMPTY_REG);
        setUserEdited(false);
        setStep("correo");
      }
      stepLine(at);
    } else {
      const [text, face, mood, label] = OPENING[next];
      say(tr(openingOf(next) || text), face, mood, label ? tr(label) : label);
    }
  };

  // La dirección cambia de pantalla (el menú lleva a «entrar» o a «sin cuenta» estando ya aquí).
  const seen = useRef(asked);
  useEffect(() => {
    if (seen.current === asked) return;
    seen.current = asked;
    goMode(asked);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked]);

  // Volver de «Olvidé mi contraseña»: la plataforma avisa con PASSWORD_RECOVERY, aunque la dirección ya no lo diga.
  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setMode("clave");
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Al volver del correo de confirmación: con la sesión ya iniciada, Pilo celebra; sin ella, se entra con el usuario.
  const greeted = useRef(false);
  useEffect(() => {
    if (mode !== "confirmada" || pending || greeted.current) return;
    greeted.current = true;
    if (account) {
      const name = account.nick || firstName(account.full_name);
      say(name ? tr("¡Listo, {name}! Su correo quedó confirmado. Ya puede guardar respuestas y recibir respuestas a su medida.", { name }) : tr("¡Listo! Su correo quedó confirmado. Ya puede guardar respuestas y recibir respuestas a su medida."), "sorpresa", "emocionado");
      return;
    }
    setMode("ingreso");
    setNotice(
      expired
        ? { tone: "info", text: tr("Ese enlace venció o ya se usó. Si ya confirmó su correo, entre con su usuario; si no, escriba su usuario y pida otro correo con «Reenviar el correo».") }
        : { tone: "info", text: tr("Si ya abrió el enlace de su correo, su cuenta quedó confirmada: entre con su usuario y su contraseña.") },
    );
    say(expired ? tr("Ese enlace ya no sirve. Entre con su usuario, o pida otro correo.") : tr("Ya casi. Entre con su usuario de Pilo para terminar."), expired ? "atento" : "feliz", expired ? "atento" : "emocionado");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, pending, account]);

  /* --- El usuario: se propone a partir del nombre y se comprueba con una espera entre teclas --- */

  const username = cleanUsername(data.username);
  useEffect(() => {
    if (mode !== "registro" || step !== "identidad" || usernameProblem(username)) {
      setUserCheck({ state: "idle" });
      return;
    }
    setUserCheck({ state: "checking" });
    let cancelled = false;
    const timer = window.setTimeout(() => {
      checkUsername(username)
        .then((r) => !cancelled && setUserCheck(r.free ? { state: "free" } : { state: "taken", reason: r.reason || tr("Ese usuario no está disponible. Pruebe con otro.") }))
        .catch((e) => {
          if (cancelled) return;
          const err = asCuentaError(e);
          setUserCheck({ state: "unknown" });
          if (cuentasOff(err.code)) {
            setOff(true);
            setNotice({ tone: "bad", text: err.message });
          }
        });
    }, 450);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mode, step, username]);

  const focusField = (field: StepProblem["field"]) => window.requestAnimationFrame(() => document.getElementById(FIELD_ID[field])?.focus({ preventScroll: false }));

  const fail = (problem: StepProblem, said: string) => {
    setError(problem);
    focusField(problem.field);
    say(said, "atento", "atento", tr("De cuidado"));
  };

  const advance = async () => {
    if (busy || step === "listo") return;
    setNotice(null);
    const problem = stepProblem(step, data);
    if (problem) {
      const said =
        step === "correo" ? tr("Ese correo no me sirve. Solo puedo crear cuentas con un correo de la UDES.") : step === "identidad" ? (problem.field === "fullName" ? tr("Me falta su nombre.") : tr("Ese usuario no sirve. Revise la nota de abajo.")) : step === "clave" ? tr("A la contraseña le falta algo de la lista.") : problem.field === "terms" ? tr("Antes de crear la cuenta, lea y acepte los términos.") : tr("Elija una opción para seguir.");
      return fail(problem, said);
    }
    if (step === "correo" && rule) {
      // Otro correo puede admitir otros perfiles u otra sede: lo elegido antes solo se conserva si sigue sirviendo.
      const next: RegData = { ...data, email: cleanEmail(data.email), rol: data.rol && rule.roles.includes(data.rol) ? data.rol : "", campus: rule.campus || data.campus };
      setData(next);
      return goStep("perfil", next);
    }
    if (step === "identidad") {
      // Si la comprobación aún no terminó, se hace ahora; si no se pudo comprobar, lo dirá el servidor al crear la cuenta.
      let check = userCheck;
      if (check.state !== "free" && check.state !== "taken") {
        setBusy(true);
        try {
          const r = await checkUsername(username);
          check = r.free ? { state: "free" } : { state: "taken", reason: r.reason };
        } catch {
          check = { state: "unknown" };
        } finally {
          setBusy(false);
        }
        setUserCheck(check);
      }
      if (check.state === "taken") return fail({ field: "username", message: check.reason || tr("Ese usuario no está disponible. Pruebe con otro.") }, tr("Ese usuario no está disponible. Pruebe con otro."));
      const next = { ...data, nick: data.nick || firstName(data.fullName) };
      setData(next);
      return goStep("clave", next);
    }
    if (step === "trato") return create();
    goStep(steps[steps.indexOf(step) + 1] ?? "trato");
  };

  const create = async () => {
    setBusy(true);
    try {
      const after = await registerAccount(data);
      // Aceptó la política al crear la cuenta: la app no se la vuelve a pedir en este dispositivo.
      acceptPolicy();
      const nick = data.nick.trim() || firstName(data.fullName);
      // Si aún no entra (falta confirmar o abrir sesión), conversa sin cuenta: Pilo ya le dice como pidió.
      writeVisitor({ nick: visitorNick(nick), tone: data.tone });
      setDone({ username, email: cleanEmail(data.email), rol: rolLabel(data.rol), campus: campusLabel(rule?.campus || data.campus), nick, after });
      if (after === "confirmar") setWait(RESEND_WAIT);
      // La contraseña no se queda en la memoria de la página.
      setData((d) => ({ ...d, password: "" }));
      setReveal(false);
      setStep("listo");
      say(after === "confirmar" ? tr("¡Listo, {nick}! Ya tiene cuenta en Pilo. Revise su correo para confirmarla.", { nick }) : tr("¡Listo, {nick}! Ya tiene cuenta en Pilo. Conversemos.", { nick }), "sorpresa", "emocionado");
    } catch (e) {
      const err = asCuentaError(e);
      const target = registerErrorStep(err.code, steps);
      const field = registerErrorField(err.code);
      if (cuentasOff(err.code)) setOff(true);
      if (target && field) {
        setStep(target);
        setError({ field, message: err.message });
        setNotice(null);
        focusField(field);
        say(err.code === "existe" || err.code === "intranet" ? tr("Ese correo ya tiene cuenta.") : tr("Hay algo por corregir antes de crear la cuenta."), "atento", "atento", tr("De cuidado"));
      } else {
        setNotice({ tone: "bad", text: err.message });
        say(tr("No pude crear la cuenta ahora."), "duda", "atento", tr("De cuidado"));
      }
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    if (step === "correo" || step === "listo") return goMode("ingreso");
    goStep(steps[Math.max(0, steps.indexOf(step) - 1)]);
  };

  const pickRol = (rol: PiloRol) => {
    const next = { ...data, rol };
    setData(next);
    goStep(steps[steps.indexOf("perfil") + 1], next);
  };

  const pickCampus = (campus: Campus) => {
    const next = { ...data, campus };
    setData(next);
    goStep("identidad", next);
  };

  const resend = async (who: string) => {
    if (usernameProblem(who)) return setNotice({ tone: "bad", text: tr("Escriba su usuario para reenviarle el correo.") });
    setBusy(true);
    try {
      await resendConfirmation(who);
      setWait(RESEND_WAIT);
      setNotice({ tone: "ok", text: tr("Si esa cuenta está por confirmar, le enviamos el correo otra vez. Revise también el correo no deseado.") });
    } catch (e) {
      setNotice({ tone: "bad", text: asCuentaError(e).message });
    } finally {
      setBusy(false);
    }
  };

  /* --- Ingreso, olvido y contraseña nueva ---------------------------------------------------- */

  const enter = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setNotice(null);
    if (!login.username.trim() || !login.password) {
      setLoginError({ code: "credenciales", message: tr("Escriba su usuario y su contraseña.") });
      return;
    }
    setBusy(true);
    setLoginError(null);
    try {
      await loginAccount(login.username, login.password);
      setLogin({ username: "", password: "" });
      navigate(home, { replace: true });
    } catch (err) {
      const failure = asCuentaError(err);
      if (cuentasOff(failure.code)) setOff(true);
      setLoginError({ code: failure.code, message: failure.message });
      // La contraseña errada no se queda escrita.
      setLogin((l) => ({ ...l, password: "" }));
      say(failure.code === "credenciales" ? tr("No coinciden. Revise el usuario y la contraseña.") : failure.code === "sin_confirmar" ? tr("Le falta confirmar su correo.") : tr("Ahora no puedo dejarle entrar."), "atento", "atento", tr("De cuidado"));
      window.requestAnimationFrame(() => document.getElementById(failure.code === "credenciales" ? "pc-entrar-clave" : "pc-entrar-usuario")?.focus());
    } finally {
      setBusy(false);
    }
  };

  const recover = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (usernameProblem(login.username)) {
      setLoginError({ code: "usuario", message: tr("Escriba su nombre de usuario de Pilo.") });
      return;
    }
    setBusy(true);
    setLoginError(null);
    try {
      await recoverPassword(login.username);
      setSent(true);
      say(tr("Listo. Si ese usuario tiene cuenta, el correo va en camino."), "feliz", "atento");
    } catch (err) {
      setLoginError({ code: asCuentaError(err).code, message: asCuentaError(err).message });
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(newPass);
    if (problem) {
      setPassError(problem);
      document.getElementById("pc-nueva")?.focus();
      return;
    }
    setBusy(true);
    setPassError("");
    const { error: failed } = await supabase.auth.updateUser({ password: newPass });
    setBusy(false);
    if (failed) {
      setPassError(/different|same/i.test(failed.message) ? tr("La contraseña nueva debe ser distinta de la anterior.") : /session|expired|invalid/i.test(failed.message) ? tr("El enlace venció. Pida otro correo para cambiar la contraseña.") : tr("No se pudo cambiar la contraseña. Intente de nuevo."));
      return;
    }
    setNewPass("");
    setReveal(false);
    setChanged(true);
    say(tr("¡Hecho! Su contraseña nueva ya está guardada."), "sorpresa", "emocionado");
  };

  const enterAsGuest = (e: FormEvent) => {
    e.preventDefault();
    const problem = visitorNickProblem(guest.nick);
    if (problem) {
      setGuestError(problem);
      document.getElementById("pc-visita-nombre")?.focus();
      return;
    }
    writeVisitor({ nick: visitorNick(guest.nick), tone: guest.tone });
    navigate(home, { replace: true });
  };

  /* --- Quien ya entró no llena un registro --------------------------------------------------- */

  const leaving = mode === "clave" || mode === "confirmada";
  if (!pending && account && !leaving) return <Navigate to={APP_PROFILE} replace />;

  const at = step === "listo" ? steps.length : steps.indexOf(step);
  const moodLine = !voice || silent ? tr("La voz de Pilo no está disponible: lea a Pilo") : !voiceOn ? tr("Voz apagada") : !armed ? tr("Toque la pantalla para oír a Pilo") : tr("Voz de Pilo · {label}", { label: line.label });
  const voiceLabel = !voice || silent ? tr("La voz de Pilo no está disponible ahora") : voiceOn ? tr("Voz de Pilo activada. Apagar") : tr("Voz de Pilo apagada. Activar");
  const errorOf = (field: StepProblem["field"]) => (error?.field === field ? error.message : null);
  const liveUser = !errorOf("username") && data.username ? usernameProblem(username) : "";

  const guestDoor = (
    <button type="button" className="pc-quiet" onClick={() => goMode("visita")}>
      {tr("Usar Pilo sin cuenta")}
    </button>
  );

  let form: ReactNode;

  if (intranetName) {
    form = (
      <div className="pc-step" ref={setBody}>
        <h2 tabIndex={-1}>{tr("Ya tiene sesión")}</h2>
        <p>
          {tr("Entró con su cuenta de la intranet ({name}). Esa cuenta ya le sirve en Pilo: no necesita otra.", { name: intranetName })}
        </p>
        <div className="pc-actions">
          <span />
          <Link className="pa-btn pa-btn--main" to={home} replace>
            {tr("Conversar con Pilo")}
          </Link>
        </div>
      </div>
    );
  } else if (mode === "registro") {
    form = (
      <>
        <div className="pc-segs" aria-label={step === "listo" ? tr("Registro completo") : tr("Paso {n} de {total}", { n: at + 1, total: steps.length })} role="img">
          {steps.map((s, i) => (
            <span key={s} data-on={i < at || (step !== "listo" && i === at) || undefined}>
              <i />
            </span>
          ))}
          <small aria-hidden="true">{step === "listo" ? tr("Listo") : tr("{n} de {total}", { n: at + 1, total: steps.length })}</small>
        </div>

        {step === "listo" ? (
          <div className="pc-step" ref={setBody}>
            <h2 tabIndex={-1}>{done?.after === "confirmar" ? tr("Revise su correo") : tr("Cuenta creada")}</h2>
            <p>
              {done?.after === "confirmar"
                ? tr("Le enviamos un enlace a {email}. Ábralo para confirmar que el correo es suyo; después entre con su usuario.", { email: done.email })
                : done?.after === "ingresar"
                  ? tr("Su cuenta quedó lista. Entre con su usuario y su contraseña para guardar respuestas y recibir respuestas a su medida.")
                  : tr("Su cuenta quedó lista y ya entró con ella: puede guardar respuestas y Pilo le responde a su medida.")}
            </p>
            {done?.after === "confirmar" && !required && <p>{tr("Hasta que lo confirme puede conversar con Pilo sin cuenta; entrar, guardar respuestas y las respuestas a su medida se activan al confirmar.")}</p>}
            <dl className="pc-rows">
              <div>
                <dt>{tr("Usuario")}</dt>
                <dd>
                  <code>{done?.username}</code>
                </dd>
              </div>
              <div>
                <dt>{tr("Perfil")}</dt>
                <dd>{done?.rol}</dd>
              </div>
              <div>
                <dt>{tr("Sede")}</dt>
                <dd>{done?.campus}</dd>
              </div>
            </dl>
            {notice && <Msg tone={notice.tone}>{notice.text}</Msg>}
            <div className="pc-actions">
              {done?.after === "confirmar" && (
                <button type="button" className="pc-quiet" disabled={busy || wait > 0} onClick={() => done && void resend(done.username)}>
                  {busy ? tr("Enviando…") : wait > 0 ? tr("Reenviar en {s} s", { s: wait }) : tr("Reenviar el correo")}
                </button>
              )}
              {required && done?.after !== "entro" ? (
                <button type="button" className="pa-btn pa-btn--main" onClick={() => goMode("ingreso")}>
                  {done?.after === "confirmar" ? tr("Ya abrí el enlace: entrar") : tr("Entrar con mi usuario")}
                </button>
              ) : (
                <Link className="pa-btn pa-btn--main" to={home} replace>
                  {tr("Conversar con Pilo")}
                </Link>
              )}
            </div>
          </div>
        ) : (
          <form
            className="pc-step"
            noValidate
            ref={setBody}
            onSubmit={(e) => {
              e.preventDefault();
              void advance();
            }}
          >
            {step === "correo" && (
              <>
                <h2 tabIndex={-1}>{tr("Su correo de la UDES")}</h2>
                <p>{tr("Con él Pilo sabe a qué parte de la universidad pertenece. Esta cuenta es solo para Pilo: no da acceso a la intranet.")}</p>
                <Field id={FIELD_ID.email} label={tr("Correo institucional")} error={errorOf("email")}>
                  {(aria) => (
                    <input
                      {...aria}
                      data-first
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      autoCapitalize="none"
                      spellCheck={false}
                      placeholder={tr("nombre@mail.udes.edu.co")}
                      value={data.email}
                      maxLength={160}
                      onChange={(e) => {
                        setData({ ...data, email: e.target.value });
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <div>
                  <p className="pc-label">{tr("Correos que acepta Pilo")}</p>
                  <ul className="pc-domains">
                    {DOMAINS.map((d) => (
                      <li key={d.domain}>@{d.domain}</li>
                    ))}
                  </ul>
                </div>
              </>
            )}

            {step === "perfil" && rule && (
              <>
                <h2 tabIndex={-1} id={FIELD_ID.rol}>
                  {tr("¿Quién es usted en la universidad?")}
                </h2>
                <p>{rolQuestion(rule)}</p>
                <div className="pc-opts" role="group" aria-labelledby={FIELD_ID.rol}>
                  {rule.roles.map((r) => (
                    <button key={r} type="button" className="pc-opt" aria-pressed={data.rol === r} onClick={() => pickRol(r)}>
                      {tr(ROLES[r].label)}
                      <small>{tr(ROLES[r].hint)}</small>
                    </button>
                  ))}
                </div>
                {errorOf("rol") && (
                  <Msg tone="bad" alert>
                    {errorOf("rol")}
                  </Msg>
                )}
              </>
            )}

            {step === "sede" && (
              <>
                <h2 tabIndex={-1} id={FIELD_ID.campus}>
                  {tr("¿En cuál sede está?")}
                </h2>
                <p>{tr("Su correo no dice la sede. Pilo la usa para responderle con lo de su sede.")}</p>
                <div className="pc-opts" role="group" aria-labelledby={FIELD_ID.campus}>
                  {CAMPUSES.map((c) => (
                    <button key={c.id} type="button" className="pc-opt" aria-pressed={data.campus === c.id} onClick={() => pickCampus(c.id)}>
                      {c.label}
                    </button>
                  ))}
                </div>
                {errorOf("campus") && (
                  <Msg tone="bad" alert>
                    {errorOf("campus")}
                  </Msg>
                )}
              </>
            )}

            {step === "identidad" && (
              <>
                <h2 tabIndex={-1}>{tr("Su nombre y su usuario")}</h2>
                <p>{tr("Entrará a Pilo con su usuario, no con el correo.")}</p>
                <Field id={FIELD_ID.fullName} label={tr("Nombre completo")} error={errorOf("fullName")}>
                  {(aria) => (
                    <input
                      {...aria}
                      data-first
                      autoComplete="name"
                      value={data.fullName}
                      maxLength={120}
                      onChange={(e) => {
                        const fullName = e.target.value;
                        setData({ ...data, fullName, username: userEdited ? data.username : suggestUsername(fullName) });
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <Field id={FIELD_ID.username} label={tr("Nombre de usuario")} hint={tr(USERNAME_HINT)} error={errorOf("username")}>
                  {(aria) => (
                    <input
                      {...aria}
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      value={data.username}
                      maxLength={20}
                      onChange={(e) => {
                        setUserEdited(true);
                        setData({ ...data, username: e.target.value.toLowerCase().replace(/\s+/g, "") });
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                {/* La disponibilidad se anuncia con calma, mientras se escribe. */}
                <div aria-live="polite" className="pc-live">
                  {liveUser ? (
                    <Msg tone="info">{liveUser}</Msg>
                  ) : userCheck.state === "checking" ? (
                    <Msg tone="info">{tr("Comprobando si está libre…")}</Msg>
                  ) : userCheck.state === "free" ? (
                    <Msg tone="ok">{tr("Disponible")}</Msg>
                  ) : userCheck.state === "taken" && !errorOf("username") ? (
                    <Msg tone="bad">{userCheck.reason}</Msg>
                  ) : null}
                </div>
              </>
            )}

            {step === "clave" && (
              <>
                <h2 tabIndex={-1}>{tr("Una contraseña para Pilo")}</h2>
                <p>{tr("Distinta de la de su correo y de la de Moodle.")}</p>
                {/* Para que el navegador guarde la contraseña junto a su usuario. */}
                <input className="pa-sr" type="text" autoComplete="username" value={username} readOnly tabIndex={-1} aria-hidden="true" />
                <Field id={FIELD_ID.password} label={tr("Contraseña")} error={errorOf("password")}>
                  {(aria) => (
                    <div className="pc-pass">
                      <input
                        {...aria}
                        aria-describedby={[aria["aria-describedby"], "pc-clave-pide"].filter(Boolean).join(" ")}
                        data-first
                        type={reveal ? "text" : "password"}
                        autoComplete="new-password"
                        value={data.password}
                        maxLength={72}
                        onChange={(e) => {
                          setData({ ...data, password: e.target.value });
                          if (error) setError(null);
                        }}
                      />
                      <button type="button" className="pc-reveal" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
                        {reveal ? tr("Ocultar") : tr("Mostrar")}
                      </button>
                    </div>
                  )}
                </Field>
                <PasswordChecklist password={data.password} id="pc-clave-pide" />
              </>
            )}

            {step === "trato" && (
              <>
                <h2 tabIndex={-1}>{tr("¿Cómo quiere que le hable Pilo?")}</h2>
                <p>{tr("Lo puede cambiar después en su perfil.")}</p>
                <Field id={FIELD_ID.nick} label={tr("¿Cómo le digo?")} hint={tr("Su nombre o uno abreviado.")} error={errorOf("nick")}>
                  {(aria) => <input {...aria} data-first autoComplete="nickname" value={data.nick} maxLength={40} onChange={(e) => setData({ ...data, nick: e.target.value })} />}
                </Field>
                <div>
                  <p className="pc-label">{tr("Tono")}</p>
                  <Seg
                    label={tr("Tono")}
                    value={data.tone}
                    options={TONE_OPTIONS}
                    onPick={(tone) => {
                      setData({ ...data, tone });
                      say(TONES.find((t) => t.id === tone)!.says, "feliz", tone === "formal" ? "atento" : "emocionado");
                    }}
                  />
                </div>
                <div className="pc-terms">
                  {/* Los mismos términos de la app (terms/policy.ts): las cuatro reglas de oro y la política completa. */}
                  <p className="pc-label" id="pc-terminos-titulo">
                    {RULES_TITLE}
                  </p>
                  <GoldenRules id="pc-terminos-texto" labelledBy="pc-terminos-titulo" />
                  {/* En otra pestaña: lo ya escrito en el registro no se pierde. */}
                  <PolicyLink className="pc-quiet" newTab>
                    {POLICY_LINK_LABEL}
                  </PolicyLink>
                  <label className="pc-check" htmlFor={FIELD_ID.terms}>
                    <input
                      id={FIELD_ID.terms}
                      type="checkbox"
                      checked={data.terms}
                      aria-invalid={errorOf("terms") ? true : undefined}
                      aria-describedby={errorOf("terms") ? "pc-terminos-texto pc-terminos-error" : "pc-terminos-texto"}
                      onChange={(e) => {
                        setData({ ...data, terms: e.target.checked });
                        if (error) setError(null);
                      }}
                    />
                    <span>{CONSENT_LABEL}</span>
                  </label>
                  {errorOf("terms") && (
                    <Msg tone="bad" id="pc-terminos-error" alert>
                      {errorOf("terms")}
                    </Msg>
                  )}
                </div>
              </>
            )}

            {notice && (
              <Msg tone={notice.tone} alert={notice.tone === "bad"}>
                {notice.text}
              </Msg>
            )}

            <div className="pc-actions">
              <button type="button" className="pc-quiet" onClick={back} disabled={busy}>
                {step === "correo" ? tr("Ya tengo cuenta") : tr("Atrás")}
              </button>
              {step !== "perfil" && step !== "sede" && (
                <button type="submit" className="pa-btn pa-btn--main" disabled={busy}>
                  {step === "trato" ? (busy ? tr("Creando su cuenta…") : tr("Crear mi cuenta")) : busy ? tr("Un momento…") : tr("Continuar")}
                </button>
              )}
            </div>
          </form>
        )}

        {step !== "listo" && required && (
          <div className="pc-aside" data-strong={off || undefined}>
            <p>{off ? tr("Las cuentas de Pilo no están disponibles ahora. Intente de nuevo en un momento.") : tr("¿Ya tiene cuenta de Pilo?")}</p>
            {!off && (
              <button type="button" className="pc-quiet" onClick={() => goMode("ingreso")}>
                {tr("Entrar con mi usuario")}
              </button>
            )}
          </div>
        )}
        {step !== "listo" && !required && (
          <div className="pc-aside" data-strong={off || undefined}>
            <p>{off ? tr("Mientras tanto, Pilo le responde sin cuenta.") : tr("¿Prefiere no registrarse? Pilo también responde sin cuenta.")}</p>
            {guestDoor}
          </div>
        )}
      </>
    );
  } else if (mode === "visita") {
    form = (
      <form className="pc-step" noValidate ref={setBody} onSubmit={enterAsGuest}>
        <h2 tabIndex={-1}>{tr("Usar Pilo sin cuenta")}</h2>
        <p>{tr("Solo dos cosas, que quedan en este dispositivo y puede cambiar cuando quiera.")}</p>
        <Field id="pc-visita-nombre" label={tr("¿Cómo quiere que le diga Pilo?")} hint={tr("Su nombre o uno abreviado. Si lo deja vacío, Pilo no usa nombre.")} error={guestError || null}>
          {(aria) => (
            <input
              {...aria}
              data-first
              autoComplete="nickname"
              value={guest.nick}
              maxLength={30}
              onChange={(e) => {
                setGuest({ ...guest, nick: e.target.value });
                if (guestError) setGuestError("");
              }}
            />
          )}
        </Field>
        <div>
          <p className="pc-label">{tr("Tono")}</p>
          <Seg
            label={tr("Tono")}
            value={guest.tone}
            options={TONE_OPTIONS}
            onPick={(tone) => {
              setGuest({ ...guest, tone });
              say(TONES.find((t) => t.id === tone)!.says, "feliz", tone === "formal" ? "atento" : "emocionado");
            }}
          />
        </div>
        <div>
          <p className="pc-label" id="pc-visita-tema">
            {tr("Tema de la app")}
          </p>
          <ThemePicker value={theme} onPick={onTheme} labelledBy="pc-visita-tema" />
        </div>
        <Benefits title={tr("Con una cuenta, además")} />
        <div className="pc-actions">
          <button type="button" className="pc-quiet" onClick={() => goMode("registro")}>
            {tr("Crear una cuenta")}
          </button>
          <button type="submit" className="pa-btn pa-btn--main">
            {tr("Entrar a conversar")}
          </button>
        </div>
      </form>
    );
  } else if (mode === "ingreso") {
    form = (
      <form className="pc-step" noValidate ref={setBody} onSubmit={enter}>
        <h2 tabIndex={-1}>{tr("Entrar a Pilo")}</h2>
        <p>{tr("Con su usuario de Pilo. Si es personal con cuenta en la intranet, esa cuenta es aparte.")}</p>
        {notice && <Msg tone={notice.tone}>{notice.text}</Msg>}
        <Field id="pc-entrar-usuario" label={tr("Nombre de usuario")}>
          {(aria) => (
            <input
              {...aria}
              data-first
              aria-invalid={loginError ? true : undefined}
              aria-describedby={loginError ? "pc-entrar-error" : undefined}
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={login.username}
              maxLength={40}
              onChange={(e) => {
                setLogin({ ...login, username: e.target.value });
                if (loginError) setLoginError(null);
              }}
            />
          )}
        </Field>
        <Field id="pc-entrar-clave" label={tr("Contraseña")}>
          {(aria) => (
            <div className="pc-pass">
              <input
                {...aria}
                aria-invalid={loginError ? true : undefined}
                aria-describedby={loginError ? "pc-entrar-error" : undefined}
                type={reveal ? "text" : "password"}
                autoComplete="current-password"
                value={login.password}
                maxLength={72}
                onChange={(e) => {
                  setLogin({ ...login, password: e.target.value });
                  if (loginError) setLoginError(null);
                }}
              />
              <button type="button" className="pc-reveal" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
                {reveal ? tr("Ocultar") : tr("Mostrar")}
              </button>
            </div>
          )}
        </Field>
        {loginError && (
          <Msg tone="bad" id="pc-entrar-error" alert>
            {loginError.message}
          </Msg>
        )}
        <div className="pc-links">
          <button type="button" className="pc-quiet" onClick={() => goMode("olvide")}>
            {tr("Olvidé mi contraseña")}
          </button>
          {(loginError?.code === "sin_confirmar" || expired) && (
            <button type="button" className="pc-quiet" disabled={busy} onClick={() => void resend(login.username)}>
              {tr("Reenviar el correo")}
            </button>
          )}
        </div>
        <div className="pc-actions">
          <button type="button" className="pc-quiet" onClick={() => goMode("registro")}>
            {tr("Crear una cuenta")}
          </button>
          <button type="submit" className="pa-btn pa-btn--main" disabled={busy}>
            {busy ? tr("Entrando…") : tr("Entrar")}
          </button>
        </div>
        {required ? (
          off && (
            <div className="pc-aside" data-strong>
              <p>{tr("Las cuentas de Pilo no están disponibles ahora. Intente de nuevo en un momento.")}</p>
            </div>
          )
        ) : (
          <div className="pc-aside" data-strong={off || undefined}>
            <p>{off ? tr("Mientras tanto, Pilo le responde sin cuenta.") : tr("¿Sin cuenta? Pilo también responde.")}</p>
            {guestDoor}
          </div>
        )}
      </form>
    );
  } else if (mode === "olvide") {
    form = (
      <form className="pc-step" noValidate ref={setBody} onSubmit={recover}>
        <h2 tabIndex={-1}>{tr("Olvidé mi contraseña")}</h2>
        <p>{tr("Escriba su usuario de Pilo. Le enviamos un correo con un enlace para poner una contraseña nueva.")}</p>
        {sent ? (
          <Msg tone="ok">{tr("Si ese usuario tiene una cuenta, le enviamos el correo. Revise también el correo no deseado; el enlace abre esta misma app.")}</Msg>
        ) : (
          <Field id="pc-olvide-usuario" label={tr("Nombre de usuario")} error={loginError?.message ?? null}>
            {(aria) => (
              <input
                {...aria}
                data-first
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={login.username}
                maxLength={40}
                onChange={(e) => {
                  setLogin({ ...login, username: e.target.value });
                  if (loginError) setLoginError(null);
                }}
              />
            )}
          </Field>
        )}
        <div className="pc-actions">
          <button type="button" className="pc-quiet" onClick={() => goMode("ingreso")}>
            {tr("Volver a entrar")}
          </button>
          {!sent && (
            <button type="submit" className="pa-btn pa-btn--main" disabled={busy}>
              {busy ? tr("Enviando…") : tr("Enviar el correo")}
            </button>
          )}
        </div>
      </form>
    );
  } else if (mode === "clave") {
    form = pending ? (
      <div className="pc-step" ref={setBody}>
        <h2 tabIndex={-1}>{tr("Un momento…")}</h2>
        <p role="status">{tr("Pilo está revisando el enlace de su correo.")}</p>
      </div>
    ) : changed ? (
      <div className="pc-step" ref={setBody}>
        <h2 tabIndex={-1}>{tr("Contraseña cambiada")}</h2>
        <p>{tr("Desde ahora entra a Pilo con su usuario y esta contraseña nueva.")}</p>
        <div className="pc-actions">
          <span />
          <Link className="pa-btn pa-btn--main" to={home} replace>
            {tr("Conversar con Pilo")}
          </Link>
        </div>
      </div>
    ) : !hasSession ? (
      <div className="pc-step" ref={setBody}>
        <h2 tabIndex={-1}>{tr("El enlace venció")}</h2>
        <p>{tr("El enlace para cambiar la contraseña sirve una sola vez y por poco tiempo. Pida otro correo y ábralo en este mismo dispositivo.")}</p>
        <div className="pc-actions">
          <button type="button" className="pc-quiet" onClick={() => goMode("ingreso")}>
            {tr("Volver a entrar")}
          </button>
          <button type="button" className="pa-btn pa-btn--main" onClick={() => goMode("olvide")}>
            {tr("Pedir otro correo")}
          </button>
        </div>
      </div>
    ) : (
      <form className="pc-step" noValidate ref={setBody} onSubmit={changePassword}>
        <h2 tabIndex={-1}>{tr("Su contraseña nueva")}</h2>
        <p>{tr("Distinta de la de su correo y de la de Moodle.")}</p>
        <input className="pa-sr" type="text" autoComplete="username" value={account?.username ?? ""} readOnly tabIndex={-1} aria-hidden="true" />
        <Field id="pc-nueva" label={tr("Contraseña nueva")} error={passError || null}>
          {(aria) => (
            <div className="pc-pass">
              <input
                {...aria}
                aria-describedby={[aria["aria-describedby"], "pc-nueva-pide"].filter(Boolean).join(" ")}
                data-first
                type={reveal ? "text" : "password"}
                autoComplete="new-password"
                value={newPass}
                maxLength={72}
                onChange={(e) => {
                  setNewPass(e.target.value);
                  if (passError) setPassError("");
                }}
              />
              <button type="button" className="pc-reveal" aria-pressed={reveal} onClick={() => setReveal(!reveal)}>
                {reveal ? tr("Ocultar") : tr("Mostrar")}
              </button>
            </div>
          )}
        </Field>
        <PasswordChecklist password={newPass} id="pc-nueva-pide" />
        <div className="pc-actions">
          <span />
          <button type="submit" className="pa-btn pa-btn--main" disabled={busy}>
            {busy ? tr("Guardando…") : tr("Guardar la contraseña")}
          </button>
        </div>
      </form>
    );
  } else {
    // «confirmada»: mientras se lee la cuenta, y cuando ya se sabe que entró.
    form = (
      <div className="pc-step" ref={setBody}>
        <h2 tabIndex={-1}>{account ? tr("Cuenta confirmada") : tr("Un momento…")}</h2>
        {account ? (
          <>
            <p>{tr("Ya puede entrar con su usuario en cualquier dispositivo. Pilo le responde a su medida y guarda lo que usted le pida guardar.")}</p>
            <dl className="pc-rows">
              <div>
                <dt>{tr("Usuario")}</dt>
                <dd>
                  <code>{account.username}</code>
                </dd>
              </div>
              <div>
                <dt>{tr("Perfil")}</dt>
                <dd>{rolLabel(account.rol)}</dd>
              </div>
              <div>
                <dt>{tr("Sede")}</dt>
                <dd>{campusLabel(account.campus) || tr("Sin sede")}</dd>
              </div>
            </dl>
            <div className="pc-actions">
              <Link className="pc-quiet" to={APP_PROFILE} replace>
                {tr("Ver mi perfil")}
              </Link>
              <Link className="pa-btn pa-btn--main" to={home} replace>
                {tr("Conversar con Pilo")}
              </Link>
            </div>
          </>
        ) : (
          <p role="status">{tr("Pilo está revisando su cuenta.")}</p>
        )}
      </div>
    );
  }

  return (
    <div className="pc-gate" onPointerDownCapture={() => (pointerAt.current = performance.now())}>
      <section className="pc-stage" ref={stage} aria-label="Mr. Pilo">
        <div className="pc-stage-bg" aria-hidden="true">
          <span className="pc-glow" />
          <span className="pc-rings">
            <i style={{ width: 260, height: 260 }} />
            <i style={{ width: 420, height: 420 }} />
            <i style={{ width: 600, height: 600 }} />
          </span>
        </div>
        <header className="pc-stage-top">
          {/* Con la cuenta obligatoria y sin entrar no hay conversación a la que volver. */}
          {required && !account && !intranetName ? (
            <span />
          ) : (
            <Link className="pa-sbtn" to={home} replace aria-label={tr("Volver a conversar con Pilo")}>
              {Icon.back}
              {tr("Volver")}
            </Link>
          )}
          <div className="pa-w-brand">
            <b>Mr. Pilo</b>
            {tr("Universidad de Santander")}
          </div>
          <LangSwitch className="pa-lang" />
          <button
            type="button"
            className="pa-sbtn pa-sbtn--icon"
            aria-pressed={Boolean(voice) && !silent && voiceOn}
            aria-disabled={!voice || silent || undefined}
            aria-label={voiceLabel}
            title={voiceLabel}
            onClick={() => {
              if (!voice || silent) return;
              if (voiceOn) stopOfficial();
              onVoice(!voiceOn);
            }}
          >
            {Boolean(voice) && !silent && voiceOn ? Icon.voice : Icon.mute}
          </button>
        </header>
        <div className="pc-face">
          <div className="pc-face__in" ref={holder}>
            <Pilo ref={pilo} size="100%" alive label="Mr. Pilo" />
          </div>
        </div>
        <span className="pa-w-mood">
          <i aria-hidden="true" />
          <span>{moodLine}</span>
        </span>
        {/* Lo que se ve aparece palabra por palabra; lo que se anuncia, la frase entera de una vez. */}
        <p className="pa-sr" aria-live="polite">
          {line.text}
        </p>
        <p className="pc-bubble" aria-hidden="true">
          {line.text.split(" ").map((w, i) => (
            <span key={`${line.key}:${i}`} className="wd">
              {w}{" "}
            </span>
          ))}
        </p>
      </section>

      <main className="pc-form">{form}</main>
    </div>
  );
}
