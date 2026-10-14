/* =============================================================================
   Pregúntele a Pilo (/pregunta).

   Una conversación con Mr. Pilo. Pilo redacta siempre con IA y la respuesta
   se escribe en vivo (el servidor la manda por partes); mientras trabaja se
   ven los pasos reales que reporta el servidor («Pensando…»). Cada respuesta
   dice de dónde sale: información oficial de la UDES con sus fuentes
   numeradas, una mezcla, o conocimiento general. Una cita abre la fuente al
   lado, con el pasaje resaltado y el enlace a la página exacta.

   Quién entra lo decide la administración en «Mr. Pilo con IA»: público, con
   sesión o solo administración. Qué memorias usa Pilo también es interno; el
   público solo ve lo que Pilo conoce. La primera vez aparece la bienvenida
   (Welcome.tsx). El tema (blanco, soleado o negro) y las conversaciones se
   recuerdan en el navegador (store.ts).

   La misma página sirve a los dos Pilos (space.ts): /pregunta es el de
   Planeación, tal cual era, y /pilo-ensenanza es Mr. Pilo en Enseñanza, que
   además pregunta una vez quién habla (estudiante o profesor) y con eso
   cambia las preguntas sugeridas, la cara de partida y el ánimo de la voz.

   Los modos secretos (super/): escribir «modo super pilo» disfraza a Pilo de
   Pilocop, Pilonator o Súper Pilo Sayayín. La orden y la charla corta de cada
   modo se responden aquí, sin ir al servidor; lo demás viaja como siempre, con
   el modo, y la IA redacta en personaje. «Desactivar» vuelve al de siempre.
   ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import gsap from "gsap";
import { useAuth } from "../../lib/auth";
import { usePiloAiConfig } from "../../components/pilo/ai/config";
import type { SpaceConfig } from "../../components/pilo/ai/config";
import { canUse } from "../../components/pilo/ai/logic";
import type { Role } from "../../components/pilo/ai/logic";
import { askQuestionStream, buildHistory, PiloError, prefetchPilo, rateAnswer, sayWithPilo, stopPilo } from "../../components/pilo/ai/client";
import type { AskHandlers, AskKind, AskMeta, AskOptions, AskPortal, AskSource, AskStep } from "../../components/pilo/ai/client";
import { Pilo as PiloMoji } from "./Pilo";
import type { MojiMood, PiloMojiHandle } from "./Pilo";
import { markWelcome, newId, readFlag, readRol, seenWelcome, TEMAS, useConversations, useTema, writeFlag, writeRol } from "./store";
import type { Conversation, Tema, Turn } from "./store";
import { ASK_SPACES, asksRol, ROLE_QUESTION, roleView, wireRol } from "./space";
import type { Rol, SpaceId, SpaceProfile, Suggestion } from "./space";
import { RoleMenu, RolePicker } from "./RolePicker";
import { Welcome } from "./Welcome";
import { SuperContext, SuperDefs } from "./super/Gear";
import { SuperEntrance } from "./super/SuperEntrance";
import { isSuperMode, voiceTone, SUPER, superAnswer, superStep } from "./super/modes";
import type { SuperLine, SuperMode } from "./super/modes";
import { superSfx } from "./super/sfx";
import { MeshAnswer } from "./MeshAnswer";
import { AnswerText, parseAnswer, useTypewriter } from "./AnswerText";
import { extrasFor, usePiloExtras } from "../../components/pilo/ai/extras";
import { pickPassages, turnFile } from "./attach";
import { AttachButton, AttachTray, FileChip, FileFoot, FileLog, useAttachment } from "./Extras";
import { toPlain } from "./markdown";
import { badgeOf, compactThink, interruptedTurn, notesOf, originOf, reduceSteps, secondsText, seedOf, showsSources, waitingFace, waitingLine, waitingTip } from "./answer-state";
import type { Badge, ThinkStep } from "./answer-state";
import { CatalogModal } from "../admin/pilo/CatalogModal";
import type { CatalogMood } from "../admin/pilo/catalog-sheet";
import { enrichSpokenSentences } from "../../components/pilo/ai/voice-expressions";
import "./ask-pilo.css";
import { tr, trn, useLang, localizeDeep, LangSwitch, effectiveLang } from "../../components/pilo/i18n";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** Las fuentes del Pilo de siempre (los textos de cada espacio viven en space.ts). */
export const SOURCES = ASK_SPACES.planeacion.sources;

/** El espacio de la página, para lo que se pinta lejos de ella (un turno, la fuente al lado). */
const SpaceContext = createContext<SpaceProfile>(ASK_SPACES.planeacion);
const codeOf = (space: SpaceProfile, s: string) => space.sources.find((x) => x.id === s)?.code ?? "··";
const nameOf = (space: SpaceProfile, s: string) => space.sources.find((x) => x.id === s)?.name ?? s;

/** Lo que se ve de una respuesta mientras el servidor la escribe. No se guarda: al terminar pasa al turno. */
interface Live {
  turnId: string;
  text: string;
  meta: AskMeta | null;
  /** Los pasos que reporta el servidor; vacío con una función anterior. */
  steps: ThinkStep[];
  thinking: string;
  startedAt: number;
  /** Cuánto pensó antes de empezar a escribir (ms); null mientras no escribe. */
  thoughtMs: number | null;
}

/** La fuente abierta al lado: se guarda entera, porque al terminar la respuesta las citas se renumeran. */
interface OpenSource {
  turnId: string;
  q: string;
  src: AskSource;
  trigger: HTMLElement | null;
}

/** El razonamiento en vivo no crece sin límite en memoria. */
const THINKING_LIVE = 8000;

const MOOD_OF: Record<AskKind, MojiMood> = { memoria: "feliz", extracto: "atento", ia: "feliz", regla: "cuidado", nada: "duda", curada: "feliz", capciosa: "cuidado", malla: "feliz", dato: "feliz" };

/* --- Iconos (un solo trazo, 2.2) --------------------------------------------------------- */

const Svg = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);
const I = {
  plus: <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  close: <Svg><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  menu: <Svg size={20}><path d="M4 7h16M4 12h16M4 17h10" /></Svg>,
  send: <Svg size={18}><path d="M12 19V5M5 12l7-7 7 7" /></Svg>,
  chev: <Svg size={12}><path d="M6 9l6 6 6-6" /></Svg>,
  speak: <Svg><path d="M4 10v4h4l5 4V6L8 10z" /><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11" /></Svg>,
  stop: <Svg><rect x="6.5" y="6.5" width="11" height="11" rx="2" /></Svg>,
  copy: <Svg><rect x="8" y="8" width="12" height="12" rx="2.5" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></Svg>,
  up: <Svg><path d="M7 11v9H4v-9zM7 11l4-8c1.7 0 2.6 1 2.3 2.7L12.8 9H19a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.8 20H7" /></Svg>,
  ext: <Svg size={15}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>,
  replay: <Svg size={15}><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></Svg>,
  check: <Svg size={11}><path d="M5 12l5 5 9-10" /></Svg>,
  alert: <Svg size={12}><path d="M12 4 3 20h18zM12 10v4M12 17.2v.3" /></Svg>,
  dash: <Svg size={10}><path d="M6 12h12" /></Svg>,
  spark: (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" />
    </svg>
  ),
  trash: <Svg size={14}><path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Svg>,
  catalog: (
    <Svg size={14}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </Svg>
  ),
  blanco: <Svg><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></Svg>,
  soleado: (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="5" fill="currentColor" />
      <path d="M12 1.8v2.6M12 19.6v2.6M3.6 3.6l1.9 1.9M18.5 18.5l1.9 1.9M1.8 12h2.6M19.6 12h2.6M3.6 20.4l1.9-1.9M18.5 5.5l1.9-1.9" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  ),
  negro: <Svg><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" /></Svg>,
  globe: <Svg size={14}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></Svg>,
};

/* --- La página: quién entra --------------------------------------------------------------- */

export function AskPilo({ space = "planeacion" }: { space?: SpaceId }) {
  useLang();
  const here = localizeDeep(ASK_SPACES[space] ?? ASK_SPACES.planeacion);
  const usual = here.id === "planeacion";
  const config = usePiloAiConfig();
  const { profile, loading } = useAuth();
  const [tema, setTema] = useTema();
  const location = useLocation();
  const role = (profile?.is_active ? profile.role : null) as Role | null;

  useEffect(() => {
    const before = document.title;
    document.title = here.docTitle;
    return () => {
      document.title = before;
    };
  }, [here.docTitle]);

  if (config.isPending || loading) {
    return (
      <div className="ap" data-tema={tema} data-espacio={here.accent ?? undefined}>
        <div className="ap-gate" role="status">
          <PiloMoji size={96} mood="atento" alive />
          <p>{tr("Despertando a Pilo…")}</p>
        </div>
      </div>
    );
  }

  const rules = config.data;
  // El Pilo de siempre se abre con «pregunta» de la configuración; otro espacio, con su ficha (0113).
  const cfg: SpaceConfig | null = usual ? null : (rules?.spaces[here.id] ?? null);
  const door = !rules ? null : usual ? rules.pregunta : cfg;
  const injected = rules && door ? { ...rules, portals: { ...rules.portals, [here.portal]: { on: door.on, aud: door.aud, fns: here.fns } } } : null;
  const allowed = injected ? canUse(injected, here.portal, "preguntar", role) : rules ? ({ ok: false, reason: rules.spacesReady ? here.gate.closed : here.gate.missing } as const) : null;
  if (!rules || !injected || !door || !allowed?.ok) {
    const needsLogin = Boolean(door?.on && door.aud === "sesion" && !role);
    return (
      <div className="ap" data-tema={tema} data-espacio={here.accent ?? undefined}>
        <div className="ap-gate">
          <PiloMoji size={120} mood={needsLogin ? "atento" : "duda"} track alive />
          <h1>{needsLogin ? tr("Pilo lo espera adentro") : tr("Pilo está descansando")}</h1>
          <p>
            {needsLogin
              ? here.gate.login
              : !allowed
                ? here.gate.closed
                : allowed.ok
                  ? ""
                  : !usual && door && !door.on
                    ? here.gate.closed
                    : allowed.reason}
          </p>
          {needsLogin ? (
            <Link to="/acceso-intranet" state={{ from: location.pathname }}>
              {tr("Iniciar sesión")}
            </Link>
          ) : (
            <Link to={here.gateFallback.to}>{here.gateFallback.label}</Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <Chat
      // Cada espacio monta su propia conversación: nada de un Pilo queda en la memoria del otro.
      key={here.id}
      space={here}
      cfg={cfg}
      tema={tema}
      setTema={setTema}
      role={role}
      audience={door.aud}
      welcome={door.welcome}
      voice={{
        portal: here.portal,
        // El de siempre lee la voz con la regla de su portal; otro espacio, con la de su ficha.
        advanced: rules.speechReady && canUse(usual ? rules : injected, here.portal, "voz", role).ok,
        rate: rules.voiceRate,
        pitch: rules.voicePitch,
        expressions: rules.voiceExpressions,
        modulation: rules.voiceModulation,
        patterns: rules.voicePatterns,
      }}
    />
  );
}

/* --- La conversación ----------------------------------------------------------------------- */

interface ChatProps {
  space: SpaceProfile;
  /** La ficha pública del espacio (0113); null en el Pilo de siempre. */
  cfg: SpaceConfig | null;
  tema: Tema;
  setTema: (t: Tema) => void;
  role: Role | null;
  audience: "admin" | "sesion" | "publico";
  welcome: boolean;
  voice: {
    /** El portal que viaja con la voz, y el rol y el ánimo de partida de quien pregunta (otro espacio). */
    portal: AskPortal;
    rol?: Rol;
    mood?: string;
    advanced: boolean;
    rate: number;
    pitch: number;
    expressions?: boolean;
    modulation?: boolean;
    patterns?: Record<string, string[]>;
  };
}

function Chat({ space, cfg, tema, setTema, role, audience, welcome, voice: baseVoice }: ChatProps) {
  useLang();
  const prefix = space.storagePrefix;
  const usual = space.id === "planeacion";
  const [convs, setConvs] = useConversations(prefix);
  // Quién pregunta: solo en los espacios que lo piden. Se recuerda por navegador y por espacio.
  const askRol = asksRol(space, cfg);
  const [rol, setRol] = useState<Rol | null>(() => (askRol ? readRol(prefix) : null));
  const pickRol = (chosen: Rol) => {
    writeRol(prefix, chosen);
    setRol(chosen);
  };
  const view = useMemo(() => roleView(space, cfg, rol), [space, cfg, rol]);
  const sent = wireRol(rol);
  // Las funciones ampliadas (0119): si esta persona puede adjuntar un archivo en este Pilo. Lo decide la administración.
  const { profile: person } = useAuth();
  const extras = extrasFor(usePiloExtras().data, space.id, person?.is_active ? person.role : null);
  const attach = useAttachment(extras.fileMaxMb);
  // Lo que viaja a la función además de la pregunta. En el Pilo de siempre, nada: el pedido es el de siempre.
  // El modo secreto (super/): lo activa una orden escrita en el chat y dura lo que dure la visita.
  const [modo, setModo] = useState<SuperMode | null>(null);
  const lastModo = useRef<SuperMode>("pilocop");
  /** La entrada en curso: a qué modo va y en qué turno aterriza Pilo. */
  const [entrance, setEntrance] = useState<{ mode: SuperMode; short: boolean; said: SuperLine; convId: string; turnId: string } | null>(null);
  const wire: AskOptions | undefined = useMemo(() => {
    const base: AskOptions | null = usual ? null : { portal: space.portal, rol: sent };
    return base || modo ? { ...(base ?? {}), ...(modo ? { modo } : {}) } : undefined;
  }, [usual, space.portal, sent, modo]);
  const voice = useMemo(() => {
    const own = usual ? baseVoice : { ...baseVoice, rol: sent, mood: view.mood };
    // En un modo, la voz no antepone muletillas: el personaje ya trae las suyas.
    return modo ? { ...own, expressions: false } : own;
  }, [usual, baseVoice, sent, view.mood, modo]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [sideOpen, setSideOpen] = useState(false);
  const [source, setSource] = useState<OpenSource | null>(null);
  const [showWelcome, setShowWelcome] = useState(() => welcome && !seenWelcome(prefix));
  const [scrolled, setScrolled] = useState(false);
  // Las respuestas que acaban de llegar: «entera» se escribe palabra por palabra; «en vivo» ya se vio escribir.
  const [fresh, setFresh] = useState<Map<string, "entera" | "en vivo">>(() => new Map());
  const [live, setLive] = useState<Live | null>(null);
  // Para lectores de pantalla: se anuncia que Pilo piensa y, al final, la respuesta entera (no cada frase).
  const [status, setStatus] = useState("");
  const run = useRef<{ ctl: AbortController; convId: string; turnId: string; text: string; meta: AskMeta | null; steps: ThinkStep[]; thinking: string; startedAt: number; thoughtMs: number | null } | null>(null);
  const [catalogTurn, setCatalogTurn] = useState<Turn | null>(null);
  const [autoRead, setAutoRead] = useState(() => readFlag(prefix, "leer"));
  const toggleAutoRead = () =>
    setAutoRead((on) => {
      writeFlag(prefix, "leer", !on);
      if (on) stopPilo();
      return !on;
    });
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const hello = useRef<PiloMojiHandle>(null);
  const slot = useRef<HTMLDivElement>(null);

  const current = convs.find((c) => c.id === currentId) ?? null;

  // La página sigue a la respuesta solo si la persona está al final: si subió a leer, no se la mueve.
  const pinned = useRef(true);
  const lastTop = useRef(0);
  const followUntil = useRef(0);
  const col = useRef<HTMLDivElement>(null);
  const writing = useRef(false);
  writing.current = busy || fresh.size > 0;

  const toBottom = useCallback(() => {
    pinned.current = true;
    requestAnimationFrame(() => {
      const s = scroll.current;
      if (s) s.scrollTo({ top: s.scrollHeight, behavior: reduced() ? "auto" : "smooth" });
    });
  }, []);

  const onScroll = (s: HTMLDivElement) => {
    setScrolled(s.scrollTop > 4);
    if (s.scrollHeight - s.scrollTop - s.clientHeight < 56) pinned.current = true;
    else if (s.scrollTop < lastTop.current - 2) pinned.current = false;
    lastTop.current = s.scrollTop;
  };

  useEffect(() => {
    const s = scroll.current;
    const c = col.current;
    if (!s || !c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!pinned.current || !(writing.current || performance.now() < followUntil.current)) return;
      s.scrollTop = s.scrollHeight;
    });
    ro.observe(c);
    return () => ro.disconnect();
  }, []);

  const patchTurn = (convId: string, turnId: string, patch: Partial<Turn>) =>
    setConvs((list) => list.map((c) => (c.id !== convId ? c : { ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) })));

  const seconds = (r: { startedAt: number; thoughtMs: number | null }) => (r.thoughtMs ?? Date.now() - r.startedAt) / 1000;

  /** En qué queda el turno de un flujo que se corta: lo escrito, marcado como incompleto. */
  const settle = (r: NonNullable<typeof run.current>, message?: string): Partial<Turn> => ({
    ...interruptedTurn(r.text, r.meta, message),
    think: compactThink(r.steps, r.thinking, seconds(r)),
  });

  /** Detener: el pedido se cancela y lo escrito se conserva. */
  const stop = () => {
    const r = run.current;
    if (!r) return;
    run.current = null;
    r.ctl.abort();
    patchTurn(r.convId, r.turnId, settle(r));
    setLive(null);
    setBusy(false);
    setStatus(r.text.trim() ? tr("Detuvo la respuesta: quedó incompleta.") : tr("Detuvo la pregunta."));
    followUntil.current = performance.now() + 800;
    input.current?.focus({ preventScroll: true });
  };

  /* --- Los modos secretos ------------------------------------------------------------------- */

  /** La cara de la última respuesta: ahí aterriza Pilo al terminar su entrada. */
  const lastFace = () => {
    const all = col.current?.querySelectorAll<HTMLElement>(".ap-a__face");
    return all?.length ? all[all.length - 1] : null;
  };

  /** Un turno que responde la página (una orden o la charla de un modo). Corta lo que Pilo estuviera escribiendo. */
  const pushLocal = (q: string, mode: SuperMode, said: SuperLine | null) => {
    setSource(null);
    stopPilo();
    if (run.current) stop();
    const turn: Turn = { id: newId(), q, modo: mode, local: true, ...(said ? { answer: superAnswer(said) } : {}) };
    const convId = current?.id ?? newId();
    setConvs((list) => {
      const conv = list.find((c) => c.id === convId) ?? { id: convId, title: q.slice(0, 80), at: Date.now(), turns: [] };
      return [{ ...conv, at: Date.now(), turns: [...conv.turns, turn] }, ...list.filter((c) => c.id !== convId)];
    });
    setCurrentId(convId);
    if (said) setFresh((f) => new Map(f).set(turn.id, "entera"));
    setStatus(said ? tr("Pilo respondió: {text}", { text: said.text }) : tr("Pilo entra al modo {name}.", { name: SUPER[mode].name }));
    toBottom();
    return { convId, turnId: turn.id };
  };

  /** ¿El mensaje es cosa de los modos? Entrar, salir o la charla corta de su catálogo. Lo demás sigue al servidor. */
  const handleSuper = (q: string): boolean => {
    const step = superStep(q, { active: modo, last: lastModo.current });
    if (!step) return false;
    if (step.kind === "salir") {
      superSfx(autoRead).down();
      setModo(null);
    }
    if (step.kind !== "entrar") {
      pushLocal(q, step.mode, step.said);
      return true;
    }
    lastModo.current = step.mode;
    if (reduced()) {
      // Con movimiento reducido no hay escena: el modo cambia y Pilo lo dice.
      setModo(step.mode);
      pushLocal(q, step.mode, step.said);
      return true;
    }
    // El turno espera sin respuesta mientras Pilo entra; al aterrizar, habla.
    setEntrance({ mode: step.mode, short: step.short, said: step.said, ...pushLocal(q, step.mode, null) });
    return true;
  };

  /** Pilo llegó a la cara de la respuesta: el modo queda puesto y dice su frase de entrada. */
  const landSuper = () => {
    const e = entrance;
    if (!e) return;
    setEntrance(null);
    setModo(e.mode);
    patchTurn(e.convId, e.turnId, { answer: superAnswer(e.said) });
    setFresh((f) => new Map(f).set(e.turnId, "entera"));
    setStatus(tr("Pilo respondió: {text}", { text: e.said.text }));
    superSfx(autoRead).clank();
    followUntil.current = performance.now() + 800;
    // La cara llega con su equipo puesto y un rebote corto.
    requestAnimationFrame(() => {
      const face = lastFace();
      if (face) gsap.fromTo(face, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)", clearProps: "transform" });
    });
  };

  const ask = async (raw: string, replaceTurn?: string) => {
    const q = raw.replace(/\s+/g, " ").trim();
    if (!q) return;
    // Los modos secretos se atienden antes de llamar al servidor. Con un archivo adjunto, la pregunta es de verdad.
    if (!replaceTurn && !attach.attachment && handleSuper(q)) return;
    setSource(null);
    stopPilo();
    // Otra pregunta mientras Pilo escribe: la anterior se corta y queda como incompleta.
    const cut = run.current;
    const cutPatch = cut ? settle(cut) : null;
    if (cut) {
      run.current = null;
      cut.ctl.abort();
    }
    const patched = (turns: Turn[]) => (cut && cutPatch ? turns.map((t) => (t.id === cut.turnId ? { ...t, ...cutPatch } : t)) : turns);
    const conv: Conversation = current ?? { id: newId(), title: q.slice(0, 80), at: Date.now(), turns: [] };
    const attached = attach.attachment;
    const picked = attached ? pickPassages(attached.passages, q) : [];
    const doc = attached ? { name: attached.name, passages: picked } : null;
    // Con un modo secreto puesto, el turno lo recuerda: la voz lee la respuesta con el tono del modo.
    const turn: Turn = { id: newId(), q, ...(modo ? { modo } : {}), ...(attached ? { file: turnFile(attached, picked.length) } : {}) };
    const before = patched(conv.turns.filter((t) => t.id !== replaceTurn));
    // Lo que la persona escribió y el texto final de cada respuesta: el servidor arma el contexto.
    // Lo que respondió la página (los modos secretos) no es contexto para el servidor.
    const history = buildHistory(before.filter((t) => !t.local).map((t) => ({ q: t.q, a: t.answer?.text })));
    setConvs((list) => [{ ...conv, at: Date.now(), turns: [...before, turn] }, ...list.filter((c) => c.id !== conv.id).map((c) => (cut && c.id === cut.convId ? { ...c, turns: patched(c.turns) } : c))]);
    setCurrentId(conv.id);
    const ctl = new AbortController();
    const mine = { ctl, convId: conv.id, turnId: turn.id, text: "", meta: null as AskMeta | null, steps: [] as ThinkStep[], thinking: "", startedAt: Date.now(), thoughtMs: null as number | null };
    run.current = mine;
    const show = () => setLive({ turnId: mine.turnId, text: mine.text, meta: mine.meta, steps: mine.steps, thinking: mine.thinking, startedAt: mine.startedAt, thoughtMs: mine.thoughtMs });
    show();
    setBusy(true);
    setStatus(tr("Pilo está pensando."));
    toBottom();
    try {
      const handlers: AskHandlers = {
        signal: ctl.signal,
        onMeta: (meta) => {
          if (run.current !== mine) return;
          mine.meta = meta;
          show();
        },
        onStep: (step) => {
          if (run.current !== mine) return;
          mine.steps = reduceSteps(mine.steps, step);
          show();
        },
        onThinking: (text) => {
          if (run.current !== mine) return;
          mine.thinking = (mine.thinking + text).slice(-THINKING_LIVE);
          show();
        },
        onDelta: (text) => {
          if (run.current !== mine) return;
          if (mine.thoughtMs === null) mine.thoughtMs = Date.now() - mine.startedAt;
          mine.text += text;
          show();
        },
      };
      // Con un archivo adjunto viajan, además, los pasajes que tienen que ver con esta pregunta: el archivo no se sube.
      const answer = wire || doc ? await askQuestionStream(q, history, handlers, { ...(wire ?? {}), ...(doc ? { doc } : {}) }) : await askQuestionStream(q, history, handlers);
      if (run.current !== mine) return;
      setFresh((f) => new Map(f).set(turn.id, mine.text.trim() ? "en vivo" : "entera"));
      // Los pasos que guarda el turno son los que trae `done`; sin ellos (función anterior), los vistos en vivo.
      const { steps: doneSteps, seconds: total, ...rest } = answer;
      const kept = Array.isArray(doneSteps) && doneSteps.length ? doneSteps.reduce<ThinkStep[]>((all, s) => reduceSteps(all, { id: s.id, label: s.label, detail: s.detail, state: "done" }), []) : mine.steps;
      // «Pensó durante»: hasta la primera frase; si llegó entera, el total que dice el servidor.
      const thoughtFor = mine.thoughtMs !== null || typeof total !== "number" ? seconds(mine) : total;
      patchTurn(conv.id, turn.id, { answer: rest, think: compactThink(kept, mine.thinking, thoughtFor) });
      setStatus(tr("Pilo respondió: {v0}", { v0: toPlain(parseAnswer(answer.text)) }));
    } catch (e) {
      // Cortado por «Detener» o por otra pregunta: ya quedó resuelto.
      if (run.current !== mine) return;
      const message = (e instanceof PiloError && e.code === "cancelado" ? "" : (e as Error).message) || tr("No pude hablar con Pilo ahora.");
      patchTurn(conv.id, turn.id, settle(mine, message));
      setStatus(mine.text.trim() ? tr("La respuesta quedó incompleta.") : "");
    } finally {
      if (run.current === mine) {
        run.current = null;
        setLive(null);
        setBusy(false);
        followUntil.current = performance.now() + 800;
      }
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const v = draft;
    setDraft("");
    void ask(v);
  };

  const startNew = () => {
    stopPilo();
    attach.clear();
    setCurrentId(null);
    setSource(null);
    setSideOpen(false);
    requestAnimationFrame(() => input.current?.focus());
  };

  const remove = (id: string) => {
    if (run.current?.convId === id) {
      run.current.ctl.abort();
      run.current = null;
      setLive(null);
      setBusy(false);
    }
    setConvs((list) => list.filter((c) => c.id !== id));
    if (id === currentId) startNew();
  };

  // El campo crece con el texto.
  useLayoutEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || showWelcome) return;
      setSource(null);
      setSideOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showWelcome]);

  // Al salir de la página, el pedido en curso se cancela.
  useEffect(
    () => () => {
      run.current?.ctl.abort();
      run.current = null;
      stopPilo();
    },
    [],
  );

  const finishWelcome = () => {
    markWelcome(true, prefix);
    setShowWelcome(false);
    requestAnimationFrame(() => {
      hello.current?.nod();
      input.current?.focus({ preventScroll: true });
    });
  };

  const replayWelcome = () => {
    startNew();
    markWelcome(false, prefix);
    setShowWelcome(true);
  };

  const sessionOk = Boolean(role);

  // En otro espacio, el nombre es el que le puso la administración; las fuentes que se listan, las encendidas.
  const name = cfg?.name || space.name;
  const known = space.sources.filter((s) => !s.hidden && (!s.session || sessionOk) && (!cfg || cfg.sources[s.id] === true));

  return (
    <SpaceContext.Provider value={space}>
    <SuperContext.Provider value={modo}>
    <div className="ap" data-tema={tema} data-espacio={space.accent ?? undefined} data-modo={entrance?.mode ?? modo ?? undefined}>
      <SuperDefs />
      <aside className="ap-side" data-open={sideOpen || undefined} aria-label={name}>
        <div className="ap-side__top">
          <div>
            <div className="ap-side__name">{name}</div>
            <div className="ap-side__sub">{space.sub}</div>
          </div>
          <button type="button" className="ap-side__close" onClick={() => setSideOpen(false)} aria-label={tr("Cerrar el menú")}>
            {I.close}
          </button>
        </div>
        <button type="button" className="ap-new" onClick={startNew}>
          {I.plus}{tr("Nueva conversación")}
        </button>
        <div className="ap-side__scroll">
          <h2>{tr("Conversaciones")}</h2>
          {convs.length === 0 && <p className="ap-empty-hist">{tr("Sus preguntas quedan aquí, solo en este navegador.")}</p>}
          {convs.map((c) => (
            <div key={c.id} className="ap-hist" aria-current={c.id === currentId}>
              <button
                type="button"
                onClick={() => {
                  attach.clear();
                  setCurrentId(c.id);
                  setSource(null);
                  setSideOpen(false);
                }}
              >
                {c.title}
              </button>
              <button type="button" className="ap-hist__del" onClick={() => remove(c.id)} aria-label={tr("Borrar la conversación «{title}»", { title: c.title })}>
                {I.trash}
              </button>
            </div>
          ))}
          <h2>{tr("Lo que conoce Pilo")}</h2>
          <ul className="ap-knows">
            {known.map((s) => (
              <li key={s.id}>
                <span className="ap-code" data-s={s.id}>
                  {s.code}
                </span>
                {s.name}
                {s.session && <small>{tr("con sesión")}</small>}
              </li>
            ))}
          </ul>
        </div>
        <div className="ap-side__foot">
          <div className="ap-access">
            {I.globe}
            <span>
              {tr("Acceso")} <b>{audience === "publico" ? tr("público") : audience === "sesion" ? tr("con sesión") : tr("de administración")}</b>
            </span>
          </div>
          {welcome && (
            <button type="button" className="ap-replay" onClick={replayWelcome}>
              {I.replay}{tr("Ver la bienvenida otra vez")}
            </button>
          )}
        </div>
      </aside>

      <main className="ap-main">
        <header className="ap-bar" data-scrolled={scrolled || undefined}>
          <button type="button" className="ap-bar__menu" onClick={() => setSideOpen(true)} aria-label={tr("Abrir el menú")}>
            {I.menu}
          </button>
          <div className="ap-crumb">
            <span>
              <Link to={space.crumb.to}>{space.crumb.label}</Link> ›{" "}
            </span>
            <b>{current?.title ?? tr("Nueva conversación")}</b>
          </div>
          {modo && <span className="ap-modo">{tr("Modo")} {SUPER[modo].name}</span>}
          <button type="button" className="ap-readall" aria-pressed={autoRead} onClick={toggleAutoRead} title={tr("Leer en voz alta cada respuesta nueva")}>
            {I.speak}
            <span>{tr("Leer en voz alta")}</span>
          </button>
          {askRol && <RoleMenu value={rol} onPick={pickRol} />}
          <LangSwitch className="ap-lang" />
          <div className="ap-temas" role="group" aria-label={tr("Tema de color")}>
            {TEMAS.map((t) => (
              <button key={t.id} type="button" aria-pressed={tema === t.id} onClick={() => setTema(t.id)} title={tr(t.label)}>
                {I[t.id]}
                <span>{tr(t.label)}</span>
              </button>
            ))}
          </div>
        </header>

        <div className="ap-scroll" ref={scroll} onScroll={(e) => onScroll(e.currentTarget)}>
          <div className="ap-col" ref={col}>
            {!current ? (
              <Hello
                space={space}
                suggestions={view.suggestions}
                emotion={view.expression}
                slot={slot}
                moji={hello}
                hidden={showWelcome}
                onAsk={(q) => void ask(q)}
                rol={rol}
                onRol={askRol && rol === null && !showWelcome ? pickRol : undefined}
              />
            ) : (
              <div className="ap-msgs">
                {current.turns.map((t, i) => (
                  <TurnView
                    key={t.id}
                    turn={t}
                    live={i === current.turns.length - 1}
                    stream={live?.turnId === t.id ? live : null}
                    activeRef={source?.turnId === t.id ? source.src.ref : null}
                    onSource={(src, trigger) => setSource({ turnId: t.id, q: t.q, src, trigger })}
                    onRetry={() => void ask(t.q, t.id)}
                    fresh={fresh.get(t.id) ?? null}
                    autoRead={autoRead}
                    onTyped={() => {
                      followUntil.current = performance.now() + 800;
                      setFresh((f) => {
                        const next = new Map(f);
                        next.delete(t.id);
                        return next;
                      });
                    }}
                    onVote={(vote) => {
                      patchTurn(current.id, t.id, { vote });
                      if (t.answer) void rateAnswer({ answerId: t.answer.answerId, vote, question: t.q, text: t.answer.text, kind: t.answer.kind, ...(wire ?? {}) });
                    }}
                    voice={voice}
                    isAdmin={role === "admin"}
                    onCatalog={space.catalog ? () => setCatalogTurn(t) : undefined}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="ap-dock">
          <AttachTray state={attach} />
          <form className="ap-composer" onSubmit={submit}>
            {extras.files && <AttachButton onPick={attach.pick} disabled={Boolean(attach.reading)} />}
            <label htmlFor="ap-q" className="ap-sr">
              {tr("Su pregunta para Pilo")}
            </label>
            <textarea
              id="ap-q"
              ref={input}
              rows={1}
              value={draft}
              maxLength={500}
              placeholder={space.placeholder}
              aria-describedby="ap-note"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {busy && !draft.trim() ? (
              <button key="stop" type="button" className="ap-send" data-stop="" onClick={stop} aria-label={tr("Detener la respuesta")} title={tr("Detener la respuesta")}>
                {I.stop}
              </button>
            ) : (
              <button key="send" type="submit" className="ap-send" disabled={!draft.trim()} aria-label={busy ? tr("Detener y preguntar esto") : tr("Preguntar")}>
                {I.send}
              </button>
            )}
          </form>
          <p className="ap-note" id="ap-note">
            {space.note}
          </p>
          <div className="ap-sr" role="status" aria-live="polite">
            {status}
          </div>
        </div>

        <SourceDrawer source={source} onClose={() => setSource(null)} />
      </main>

      <div className="ap-scrim" data-on={sideOpen || (source && window.matchMedia("(max-width: 900px)").matches) || undefined} onClick={() => { setSideOpen(false); setSource(null); }} />

      {showWelcome && <Welcome tema={tema} target={slot} onDone={finishWelcome} space={space} askRol={askRol} rol={rol} onRol={pickRol} />}

      {entrance && <SuperEntrance key={entrance.turnId} mode={entrance.mode} short={entrance.short} sound={autoRead} target={lastFace} onDone={landSuper} />}

      {role === "admin" && space.catalog && (
        <CatalogModal
          open={Boolean(catalogTurn)}
          onClose={() => setCatalogTurn(null)}
          defaultKind="respuesta"
          initialEntry={
            catalogTurn
              ? {
                  kind: "respuesta",
                  question: catalogTurn.q,
                  answer: catalogTurn.answer ? toPlain(parseAnswer(catalogTurn.answer.text)) : "",
                  mood: (catalogTurn.answer?.mood as CatalogMood) || "emocionado",
                  source_title: catalogTurn.answer?.sources?.[0]?.title ?? "Universidad de Santander · Pregúntele a Pilo",
                  source_path: catalogTurn.answer?.sources?.[0]?.path ?? "/pregunta",
                  cut: catalogTurn.answer?.sources?.[0]?.cut ?? "",
                }
              : null
          }
          isEditing={false}
        />
      )}
    </div>
    </SuperContext.Provider>
    </SpaceContext.Provider>
  );
}

/* --- El saludo ----------------------------------------------------------------------------- */

function Hello({
  space,
  suggestions,
  emotion,
  slot,
  moji,
  hidden,
  onAsk,
  rol,
  onRol,
}: {
  space: SpaceProfile;
  suggestions: Suggestion[];
  /** La cara de partida del rol; sin rol, la de siempre. */
  emotion?: string;
  slot: React.RefObject<HTMLDivElement>;
  moji: React.RefObject<PiloMojiHandle>;
  hidden: boolean;
  onAsk: (q: string) => void;
  rol: Rol | null;
  /** Solo mientras falta decir quién pregunta (saltó la bienvenida, o no hay bienvenida). */
  onRol?: (rol: Rol) => void;
}) {
  const sugs = useRef<HTMLDivElement>(null);
  const shownFor = useRef(rol);
  // Al decir (o cambiar) quién pregunta, las sugeridas se relevan. La primera vez no se anima nada.
  useLayoutEffect(() => {
    if (shownFor.current === rol) return;
    shownFor.current = rol;
    const el = sugs.current;
    if (!el || reduced()) return;
    const tween = gsap.fromTo(el.children, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.04, ease: "power3.out", clearProps: "opacity,visibility,transform" });
    return () => {
      tween.progress(1).kill();
    };
  }, [rol]);

  return (
    <>
      <section className="ap-hello">
        <div className="ap-hello__slot" ref={slot} style={{ visibility: hidden ? "hidden" : undefined }}>
          <PiloMoji ref={moji} size="100%" track idle alive label="Mr. Pilo" emotion={emotion} />
        </div>
        <h1>{space.hello.h1}</h1>
        <p>{space.hello.p}</p>
        {onRol && <RolePicker variant="page" value={rol} onPick={onRol} legend={tr(ROLE_QUESTION)} />}
      </section>
      <div className="ap-sugs" ref={sugs}>
        {suggestions.map((s) => (
          <button key={s.q} type="button" className="ap-sug" onClick={() => onAsk(s.q)}>
            {s.q}
            {s.hint && <small data-trick={s.trick || undefined}>{s.hint}</small>}
          </button>
        ))}
      </div>
    </>
  );
}

/* --- Un turno: la pregunta y lo que responde Pilo -------------------------------------------- */

/** Los segundos que lleva Pilo trabajando; el reloj solo corre mientras trabaja. */
function useElapsed(startedAt: number | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return running && startedAt ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
}

/** ¿Se ve en pantalla? Fuera de ella, los indicadores de actividad se pausan. */
function useOnScreen(ref: React.RefObject<HTMLElement>, enabled: boolean): boolean {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof IntersectionObserver === "undefined") {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(([entry]) => setOn(entry.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, [ref, enabled]);
  return on;
}

const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(".", ",")} s` : `${n} ms`);

/**
 * Cómo respondió Pilo, en un solo lugar: los pasos que reportó el servidor
 * («Pensando…»), su razonamiento si el proveedor lo manda, y el rastro técnico
 * de la respuesta. Se abre y se cierra con una rejilla (0fr → 1fr), sin medir
 * alturas; los pasos nuevos entran con un escalón corto.
 */
/** En inglés y portugués el servidor manda los pasos sin detalle (lo escribe en español): esas filas no dicen nada y no se pintan. */
const spoken = (s: { detail?: string }) => effectiveLang() === "es" || Boolean(s.detail);

function ThinkBody({ id, open, steps, thinking, trail, working }: { id: string; open: boolean; steps: ThinkStep[]; thinking: string; trail: AskStep[]; working: boolean }) {
  useLang();
  const root = useRef<HTMLDivElement>(null);
  const seen = useRef(0);
  const wasOpen = useRef(open);
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = Array.from(el.querySelectorAll<HTMLElement>("li"));
    const opened = open && !wasOpen.current;
    wasOpen.current = open;
    const fresh = opened ? rows : open ? rows.slice(seen.current) : [];
    seen.current = rows.length;
    if (!fresh.length || reduced()) return;
    const tween = gsap.fromTo(fresh, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.3, stagger: 0.04, ease: "power3.out", clearProps: "opacity,visibility,transform" });
    return () => {
      tween.progress(1).kill();
    };
  }, [open, steps.length, trail.length]);

  return (
    <div className="ap-think" id={id} ref={root} data-open={open || undefined} aria-hidden={!open}>
      <div className="ap-think__in">
        {steps.length > 0 && (
          <ol className="ap-trail">
            {steps.map((s) => {
              const active = working && s.state === "start";
              return (
                <li key={s.id} data-state={active ? "start" : "done"}>
                  <span className="ap-st" data-s={active ? "now" : "ok"}>
                    {active ? <i className="ap-pulse" /> : I.check}
                  </span>
                  <span>
                    <b>{tr(s.label)}</b>
                    {s.detail ? ` · ${s.detail}` : ""}
                    <span className="ap-sr">{active ? tr(" (en curso)") : tr(" (listo)")}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
        {thinking && <p className="ap-think__text">{thinking}</p>}
        {trail.some(spoken) && (
          <ol className="ap-trail">
            {trail.filter(spoken).map((s, i) => (
              <li key={i}>
                <span className="ap-st" data-s={s.status}>
                  {s.status === "ok" ? I.check : s.status === "ai" ? I.spark : I.dash}
                </span>
                <span>
                  <b>{tr(s.step)}.</b> {s.detail}
                </span>
                <em className="ap-num">{ms(s.ms)}</em>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function TurnView({
  turn,
  live,
  stream,
  activeRef,
  onSource,
  onRetry,
  onVote,
  voice,
  fresh,
  autoRead,
  onTyped,
  isAdmin,
  onCatalog,
}: {
  turn: Turn;
  /** El último turno de la conversación. */
  live: boolean;
  /** Lo que el servidor va mandando de este turno, mientras lo escribe. */
  stream: Live | null;
  fresh: "entera" | "en vivo" | null;
  autoRead: boolean;
  onTyped: () => void;
  /** La fuente abierta al lado, por su referencia (los números cambian al terminar). */
  activeRef: string | null;
  onSource: (src: AskSource, trigger: HTMLElement) => void;
  onRetry: () => void;
  onVote: (v: "up" | "down") => void;
  voice: ChatProps["voice"];
  isAdmin?: boolean;
  onCatalog?: () => void;
}) {
  useLang();
  const space = useContext(SpaceContext);
  const [how, setHow] = useState(false);
  const [map, setMap] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  const face = useRef<PiloMojiHandle>(null);
  const howId = useId();
  const a = turn.answer;
  const pending = !a && !turn.error;
  // Pilo ya escribe: llegó la primera frase y la respuesta aún no termina.
  const streaming = pending && Boolean(stream?.text);
  const working = pending && !streaming;
  const incomplete = Boolean(a && turn.incomplete);

  const text = a?.text ?? stream?.text ?? "";
  const sources = useMemo(() => a?.sources ?? stream?.meta?.sources ?? [], [a, stream?.meta]);
  const parsed = useMemo(() => parseAnswer(text, { streaming }), [text, streaming]);
  const active = activeRef ? (sources.find((s) => s.ref === activeRef)?.n ?? null) : null;
  const openSource = (n: number, trigger: HTMLElement) => {
    const src = sources.find((s) => s.n === n);
    if (src) onSource(src, trigger);
  };

  /* «Pensando…»: solo lo que reporta el servidor. */
  const steps = stream?.steps ?? turn.think?.steps ?? [];
  const thinking = stream ? stream.thinking.slice(-1200) : (turn.think?.thinking ?? "");
  const trail = a?.trail ?? [];
  // Con pasos del servidor, el rastro técnico queda para la administración: un solo relato para quien pregunta.
  const shownTrail = steps.length > 0 && !isAdmin ? [] : trail;
  const elapsed = useElapsed(stream?.startedAt, working);
  const thought = stream ? (stream.thoughtMs === null ? null : stream.thoughtMs / 1000) : (turn.think?.seconds ?? null);
  const hasHow = steps.length > 0 || Boolean(thinking) || shownTrail.length > 0;
  const onScreen = useOnScreen(body, pending);

  // Al llegar la primera frase, el panel se recoge en una línea.
  useEffect(() => {
    if (streaming) setHow(false);
  }, [streaming]);

  const [reading, setReading] = useState<number | null>(null);
  const readRun = useRef(0);
  const after = useRef<HTMLDivElement>(null);

  // En un modo secreto cada frase se dice con su emoción (super/modes.ts) y la voz cambia de paso y de tono.
  const superMode = isSuperMode(turn.modo) ? turn.modo : null;
  const superVoice = superMode ? SUPER[superMode].voice : null;
  const toneOf = (k: number) => (superMode && a ? voiceTone(superMode, a.text, parsed.sentences[k]?.spoken ?? "") : undefined);
  const prefetch = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (spoken[k]) prefetchPilo([spoken[k]], { portal: voice.portal, advanced: voice.advanced, rol: voice.rol, tone: toneOf(k) });
  };

  const enrichedVoice = useMemo(() => {
    const raw = parsed.sentences.map((x) => x.spoken);
    return enrichSpokenSentences(raw, {
      // El ánimo de la respuesta (el del catálogo manda); en otro espacio, si no trae, el de partida del rol.
      mood: a?.mood ?? voice.mood,
      // En un modo, la voz no antepone muletillas: el personaje ya trae las suyas.
      expressionsEnabled: voice.expressions !== false && !isSuperMode(turn.modo),
      patterns: voice.patterns,
      modulationEnabled: voice.modulation !== false,
      baseRate: voice.rate,
      basePitch: voice.pitch,
    });
  }, [parsed, a?.mood, turn.modo, voice.mood, voice.expressions, voice.patterns, voice.modulation, voice.rate, voice.pitch]);

  const spoken = enrichedVoice.sentences;
  // Con «Leer en voz alta», el audio de las primeras frases se pide en cuanto la respuesta está completa.
  useEffect(() => {
    if (a && fresh && autoRead && !incomplete) prefetch(0, 2);
    // `prefetch` lee lo mismo que ya está en la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, fresh, autoRead, incomplete, spoken, voice.advanced, voice.portal, voice.rol]);

  /** Leer la respuesta frase por frase: la que suena se resalta y Pilo mueve el pico. */
  const read = async () => {
    if (reading !== null) {
      readRun.current += 1;
      stopPilo();
      setReading(null);
      face.current?.talk(false);
      return;
    }
    const mine = ++readRun.current;
    face.current?.talk(true);
    for (let k = 0; k < parsed.sentences.length; k++) {
      if (mine !== readRun.current) return;
      if (!spoken[k]?.trim()) continue;
      setReading(k);
      // Mientras suena esta frase, se piden las dos que siguen: así no hay pausas.
      prefetch(k + 1, k + 3);
      const used = await sayWithPilo(spoken[k], {
        ...voice,
        rate: enrichedVoice.rate * (superVoice?.rate ?? 1),
        pitch: enrichedVoice.pitch * (superVoice?.pitch ?? 1),
        tone: toneOf(k),
      });
      if (used === "cancelado") break;
    }
    if (mine === readRun.current) {
      setReading(null);
      face.current?.talk(false);
    }
  };

  // Otra lectura (de otra respuesta) cancela esta: sayWithPilo responde «cancelado».
  useEffect(() => () => void (readRun.current += 1), []);

  // Una respuesta que llega entera se escribe sola, breve; la que se vio escribir en vivo, no.
  const { shown, typing, finish } = useTypewriter(parsed.count, Boolean(a) && fresh === "entera", () => {
    face.current?.talk(false);
    onTyped();
    if (autoRead && !incomplete) void read();
  });

  // La que se escribió en vivo se lee una sola vez, ya completa: el texto final, no cada parte.
  const readLive = useRef(read);
  readLive.current = read;
  useEffect(() => {
    if (!a || fresh !== "en vivo") return;
    face.current?.talk(false);
    onTyped();
    if (autoRead && !incomplete) void readLive.current();
    // Solo al llegar la respuesta final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(a), fresh]);

  // Mientras busca, Pilo mira arriba pensando; mientras escribe, habla.
  useEffect(() => {
    if (!live) return;
    if (working) {
      face.current?.look(0.5, -0.7);
      return;
    }
    face.current?.look(0, 0.2);
    if (typing || streaming) face.current?.talk(true);
  }, [working, live, typing, streaming]);

  // Terminada la escritura, llega lo demás (mapa, fuentes, acciones), 50 ms entre cada cosa.
  const wasWriting = useRef(false);
  const writing = typing || streaming;
  useLayoutEffect(() => {
    if (writing) {
      wasWriting.current = true;
      return;
    }
    if (!wasWriting.current || !after.current || reduced()) return;
    wasWriting.current = false;
    const ctx = gsap.context(() => {
      gsap.from(after.current!.children, { autoAlpha: 0, y: 8, duration: 0.35, stagger: 0.05, ease: "power3.out" });
    }, after);
    return () => ctx.revert();
  }, [writing, Boolean(a)]);

  const copy = async () => {
    try {
      const listed = a && showsSources(a) ? a.sources.map((s) => `[${s.n}] ${s.title}${s.path ? ` · ${/^https?:/i.test(s.path) ? s.path : `${location.origin}${s.path}`}` : ""}`) : [];
      await navigator.clipboard.writeText([toPlain(parsed), listed.join("\n")].filter(Boolean).join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles */
    }
  };

  // Lo que respondió la página en un modo secreto lo dice con el nombre del modo: no es una respuesta oficial.
  const modeBadge: Badge | null = turn.local && isSuperMode(turn.modo) ? { text: `Modo ${SUPER[turn.modo].name}`, tone: "general", icon: null } : null;
  const badge = a ? (modeBadge ?? badgeOf(a, incomplete)) : null;
  const notes = a && !incomplete && !turn.local ? notesOf(a) : [];
  const headline = working ? waitingLine({ steps, meta: stream?.meta ?? null, seconds: elapsed }) : thought !== null ? tr("Pensó durante {v0}", { v0: secondsText(thought) }) : tr("Cómo respondí");
  // Aparte del titular: un consejo que va cambiando, para que la espera no desespere.
  const tip = working ? waitingTip(elapsed, seedOf(turn.id)) : null;
  const head = (
    <>
      {working && (
        <span className="ap-dots" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <span>{headline}</span>
      {working && elapsed >= 3 && <span className="ap-num ap-how__time">{secondsText(elapsed)}</span>}
    </>
  );

  return (
    <>
      <div className="ap-q">
        {turn.file && (
          <span className="px-asked">
            <FileChip name={turn.file.name} detail={trn(turn.file.total, tr("{n} pasaje · leído en su dispositivo"), tr("{n} pasajes · leído en su dispositivo"))} />
          </span>
        )}
        {turn.q}
      </div>
      <div className="ap-a">
        <div className="ap-a__face">
          <PiloMoji ref={face} size="100%" mood={pending ? "piensa" : a ? (incomplete ? "duda" : MOOD_OF[a.kind]) : "cuidado"} emotion={pending ? (working ? waitingFace(elapsed) : undefined) : a?.expression || a?.mood} />
        </div>
        <div className="ap-a__body" ref={body} aria-busy={pending} data-paused={pending && !onScreen ? "" : undefined}>
          {turn.error && !a && (
            <div className="ap-error" role="alert">
              <span>{turn.error}</span>
              <button type="button" onClick={onRetry}>
                {tr("Preguntar de nuevo")}
              </button>
            </div>
          )}
          {(a || pending) && (
            <>
              <div className="ap-prov" data-working={working || undefined}>
                {a && badge && (
                  <span className="ap-badge" data-kind={a.kind} data-tone={badge.tone}>
                    {badge.icon ? I[badge.icon] : null}
                    {badge.text}
                  </span>
                )}
                {a && !incomplete && a.kind === "ia" && a.verified === false && (
                  <span className="ap-badge" data-tone="aviso">
                    {I.alert}
                    {tr("Revise las cifras")}
                  </span>
                )}
                {hasHow ? (
                  <button type="button" className="ap-trail-btn ap-how" aria-expanded={how} aria-controls={howId} onClick={() => setHow((v) => !v)}>
                    {head}
                    {I.chev}
                  </button>
                ) : working || thought !== null ? (
                  <span className="ap-how">{head}</span>
                ) : null}
                {a?.graph && a.graph.nodes.length > 1 && (
                  <button type="button" className="ap-trail-btn" aria-expanded={map ?? a.kind === "malla"} onClick={() => setMap(!(map ?? a.kind === "malla"))}>
                    {tr("Ver en el mapa")} {I.chev}
                  </button>
                )}
              </div>
              {tip && (
                <p className="ap-tip" key={tip}>
                  {tip}
                </p>
              )}
              {hasHow && <ThinkBody id={howId} open={how} steps={steps} thinking={thinking} trail={shownTrail} working={working} />}
              {turn.file && <FileLog file={turn.file} seconds={turn.think?.seconds} />}
              {text && <AnswerText parsed={parsed} shown={shown} typing={typing} streaming={streaming} reading={reading} sources={sources} active={active} onSource={openSource} onFinish={finish} />}
              {turn.file && a && !typing && !incomplete && <FileFoot text={() => a.text} />}
              {notes.map((note) => (
                <p key={note} className="ap-quiet">
                  {I.dash}
                  <span>{note}</span>
                </p>
              ))}
              {a && incomplete && (
                <div className="ap-cut">
                  <span>{turn.error ? tr("{error} Lo que alcanzó a escribir quedó incompleto.", { error: turn.error }) : tr("Detuvo la respuesta: lo escrito quedó incompleto.")}</span>
                  <button type="button" onClick={onRetry}>
                    {tr("Preguntar de nuevo")}
                  </button>
                </div>
              )}
              {a && !typing && (
                <div className="ap-after" ref={after}>
                  {a.graph && a.graph.nodes.length > 1 && (map ?? a.kind === "malla") && <MeshAnswer graph={a.graph} animate={live} />}
                  {a.unknown && a.unknown.length > 0 && <p className="ap-warn">{tr("Revise estos números antes de citarlos: no los encontré en las fuentes ({numbers}).", { numbers: a.unknown.join(", ") })}</p>}
                  {showsSources(a) && (
                    <div className="ap-srcs" aria-label={tr("Fuentes")}>
                      {a.sources.map((s) => {
                        // Lo que viene de otro ámbito lo dice junto a la cita, con texto y glifo (no solo con color).
                        const origin = originOf(s);
                        return (
                          <button key={s.n} type="button" className="ap-src" data-from={origin ? "" : undefined} aria-pressed={active === s.n} onClick={(e) => onSource(s, e.currentTarget)}>
                            <span className="ap-src__n">{s.n}</span>
                            <span className="ap-code" data-s={s.source}>
                              {codeOf(space, s.source)}
                            </span>
                            <span>
                              {s.title} {s.cut && <small>· {s.cut}</small>}
                              {origin && (
                                <small className="ap-from">
                                  <span aria-hidden="true">↗</span> {origin}
                                </small>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="ap-acts">
                    <button type="button" className="ap-ic" onClick={() => void read()} aria-pressed={reading !== null} aria-label={reading !== null ? tr("Dejar de leer") : tr("Escuchar la respuesta")}>
                      {reading !== null ? I.stop : I.speak}
                      {reading !== null && <span>{tr("Leyendo")}</span>}
                    </button>
                    <button type="button" className="ap-ic" onClick={copy} aria-label={copied ? tr("Copiada") : tr("Copiar la respuesta con sus fuentes")}>
                      {I.copy}
                      {copied && <span>{tr("Copiada")}</span>}
                    </button>
                    {isAdmin && onCatalog && !incomplete && !turn.local && (
                      <button type="button" className="ap-ic" onClick={onCatalog} aria-label={tr("Agregar al catálogo de respuestas oficiales de Pilo")} title={tr("Agregar al catálogo oficial de Pilo")}>
                        {I.catalog}
                        <span>{tr("Al catálogo")}</span>
                      </button>
                    )}
                    {a.kind !== "regla" && !incomplete && !turn.local && (
                      <>
                        <button type="button" className="ap-ic" aria-pressed={turn.vote === "up"} onClick={() => onVote("up")} aria-label={tr("Me sirvió")}>
                          {I.up}
                        </button>
                        <button type="button" className="ap-ic" aria-pressed={turn.vote === "down"} onClick={() => onVote("down")} aria-label={tr("No me sirvió")}>
                          <span style={{ display: "inline-flex", transform: "scaleY(-1)" }}>{I.up}</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* --- La fuente, al lado -------------------------------------------------------------------- */

const STOP = new Set(["como", "cual", "cuales", "cuanto", "cuantos", "cuantas", "donde", "cuando", "tiene", "tienen", "esta", "estan", "para", "sobre", "entre", "desde", "hasta", "este", "esta", "esos", "esas", "universidad", "udes", "que"]);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Resalta en el pasaje las palabras de la pregunta (por su raíz) y las cifras. */
function highlight(text: string, question: string): ReactNode[] {
  const roots = fold(question)
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.slice(0, Math.max(4, w.length - 2)));
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/[\p{L}\d][\p{L}\d.,%]*/gu)) {
    const word = m[0];
    const f = fold(word);
    const hit = roots.some((r) => f.startsWith(r)) || /^\d[\d.,]*%?$/.test(word);
    if (!hit) continue;
    out.push(text.slice(last, m.index));
    out.push(<mark key={m.index}>{word}</mark>);
    last = (m.index ?? 0) + word.length;
  }
  out.push(text.slice(last));
  return out;
}

function SourceDrawer({ source, onClose }: { source: OpenSource | null; onClose: () => void }) {
  useLang();
  const space = useContext(SpaceContext);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const [shown, setShown] = useState(source);
  const s: AskSource | undefined = shown?.src;

  useEffect(() => {
    if (source) {
      setShown(source);
      const t = window.setTimeout(() => closeBtn.current?.focus({ preventScroll: true }), reduced() ? 0 : 200);
      return () => window.clearTimeout(t);
    }
  }, [source]);

  const close = () => {
    const trigger = shown?.trigger;
    onClose();
    trigger?.focus({ preventScroll: true });
  };

  const excerpt = useMemo(() => (s && shown ? highlight(s.excerpt, shown.q) : null), [s, shown]);
  const external = s ? /^https?:/i.test(s.path) : false;

  return (
    <aside className="ap-drawer" data-open={source ? "" : undefined} aria-hidden={!source} aria-label={tr("Fuente")}>
      <div className="ap-drawer__head">
        {s && <span className="ap-src__n">{s.n}</span>}
        <h2>{tr("Fuente")}</h2>
        <button ref={closeBtn} type="button" className="ap-x" onClick={close} aria-label={tr("Cerrar la fuente")}>
          {I.close}
        </button>
      </div>
      {s && (
        <div className="ap-drawer__body">
          <div className="ap-dr__portal">
            <span className="ap-code" data-s={s.source}>
              {codeOf(space, s.source)}
            </span>
            {nameOf(space, s.source)}
          </div>
          <h3 className="ap-dr__title">{s.title}</h3>
          {s.section && <p className="ap-dr__sec">{s.section}</p>}
          <p className="ap-excerpt">{excerpt}</p>
          {(s.office || s.cut) && (
            <div className="ap-ticket">
              <b>{s.office || space.office}</b>
              {s.cut && (
                <div className="ap-ticket__row">
                  <span className="ap-ticket__cut">{tr("CORTE")} {s.cut.toUpperCase()}</span>
                </div>
              )}
            </div>
          )}
          {s.path &&
            (external ? (
              <a className="ap-open" href={s.path} target="_blank" rel="noopener noreferrer">
                {tr("Abrir el documento")} {I.ext}
              </a>
            ) : (
              <Link className="ap-open" to={s.path}>
                {tr("Abrir en")} {nameOf(space, s.source)} {I.ext}
              </Link>
            ))}
        </div>
      )}
    </aside>
  );
}
