/* =============================================================================
   Pilo en otros portales · el chat emergente (/pilo-embed).

   Esta página se ve dentro de un marco que pone public/pilo.js en otra página:
   un botón con la cara de Pilo, un saludo y, al abrirlo, un chat pequeño. Es
   el mismo Pilo de Pregúntele a Pilo: pregunta a la misma función, escribe la
   respuesta en vivo, cuenta en qué paso va y la lee con su voz. Lo que cambia
   es el tamaño: aquí no hay historial, mapa ni panel de fuentes; para eso se
   abre Pregúntele a Pilo en otra pestaña.

   El acceso es el de Pregúntele a Pilo: si allá no está abierto para el
   público, aquí no se pinta nada y el marco se esconde. Y solo se pinta en
   este portal o en los que la administración autorizó (0111).

   El mismo chat sirve a los dos Pilos (space.ts): /pilo-embed es el de
   siempre y /pilo-ensenanza-embed es Mr. Pilo en Enseñanza, con sus textos,
   su acceso y su lista de portales (0113). Ese, la primera vez, pregunta en
   su saludo quién habla (estudiante o profesor).

   Leer la página (0127): si la línea que lo carga lleva data-leer="si", al
   preguntar Pilo lee la página que lo aloja. Se ve en tres momentos: mientras
   lee (los títulos de la página, uno tras otro), mientras piensa (los pasos
   del servidor, como siempre) y, con la respuesta, el recibo: qué página leyó,
   cuánto de ella y si quedó enviada a Planeación para guardarla en la memoria.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import gsap from "gsap";
import { useAuth } from "../../lib/auth";
import { usePiloAiConfig } from "../../components/pilo/ai/config";
import type { SpaceConfig } from "../../components/pilo/ai/config";
import { canUse } from "../../components/pilo/ai/logic";
import type { Role } from "../../components/pilo/ai/logic";
import { askQuestionStream, buildHistory, capturePage, PiloError, prefetchPilo, sayWithPilo, stopPilo } from "../../components/pilo/ai/client";
import type { AskHandlers, AskMeta, AskOptions, AskPortal } from "../../components/pilo/ai/client";
import { enrichSpokenSentences } from "../../components/pilo/ai/voice-expressions";
import { Pilo as PiloMoji } from "../pregunta/Pilo";
import { newId, readRol, storageKey, writeRol } from "../pregunta/store";
import type { Turn } from "../pregunta/store";
import { ASK_SPACES, asksRol, ROLE_OPTIONS, ROLE_QUESTION, roleView, wireRol } from "../pregunta/space";
import type { Rol, SpaceId, SpaceProfile } from "../pregunta/space";
import { RolePicker } from "../pregunta/RolePicker";
import { AnswerText, parseAnswer, useTypewriter } from "../pregunta/AnswerText";
import { toPlain } from "../pregunta/markdown";
import { interruptedTurn, notesOf, originOf, reduceSteps, seedOf, showsSources, waitingFace, waitingLine, waitingTip } from "../pregunta/answer-state";
import type { ThinkStep } from "../pregunta/answer-state";
import { captureLine, captureStatus, frameMessage, hostLabel, hostOrigin, pageForQuestion, pageRequest, pageStamp, readHostMessage, readHostPage, readParams, sourceUrl, spaceWidget, widgetAllowed } from "./embed";
import type { CaptureStatus, FrameState, HostPage, TurnPage } from "./embed";
import "../pregunta/ask-pilo.css";
import "./pilo-embed.css";
import { tr, trn, useLang, localizeDeep, LangSwitch } from "../../components/pilo/i18n";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * La limpieza de una animación de entrada: la lleva a su final antes de
 * soltarla. Un `kill()` a secas deja el elemento como iba —oculto o
 * desenfocado— si lo interrumpe otro render o el desmontaje simulado del modo
 * estricto de React.
 */
const endVisible = (tween: gsap.core.Tween) => () => {
  tween.progress(1).kill();
};

const EASE = "expo.out";
const MAX_TURNS = 30;

const session = {
  get(key: string): string | null {
    try {
      return window.sessionStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.sessionStorage.setItem(key, value);
    } catch {
      /* sin almacenamiento: vale para esta página */
    }
  },
};

const frame = (state: FrameState) => {
  try {
    window.parent.postMessage(frameMessage(state), "*");
  } catch {
    /* fuera de un marco no hay a quién avisar */
  }
};

function Svg({ children, size = 18, sw = 1.9 }: { children: ReactNode; size?: number; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const I = {
  close: <Svg size={24} sw={2.4}><path d="M6 6l12 12M18 6 6 18" /></Svg>,
  down: <Svg sw={2}><path d="m6 9.5 6 6 6-6" /></Svg>,
  send: <Svg size={17} sw={2.2}><path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" /></Svg>,
  stop: <svg width="13" height="13" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3" fill="currentColor" /></svg>,
  mute: <Svg><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" /><path d="m16.5 9.5 4 5M20.5 9.5l-4 5" /></Svg>,
  sound: <Svg><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" /></Svg>,
  listen: <Svg size={13} sw={2}><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" /><path d="M15.5 9a4.2 4.2 0 0 1 0 6" /></Svg>,
  doc: <Svg size={13} sw={2}><path d="M7 3.5h7l4 4v13H7z" /><path d="M14 3.5v4h4" /></Svg>,
  out: <Svg size={13} sw={2}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></Svg>,
  fresh: <Svg><path d="M12 5v14M5 12h14" /></Svg>,
  page: <Svg size={16} sw={1.9}><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><path d="M3.5 9h17M7 13h6M7 16h9" /></Svg>,
  check: <Svg size={13} sw={2.4}><path className="pe-check" pathLength={1} d="m5 12.5 4.5 4.5L19 7.5" /></Svg>,
};

interface Voice {
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
}

interface Live {
  turnId: string;
  text: string;
  meta: AskMeta | null;
  steps: ThinkStep[];
  startedAt: number;
  /** La página que Pilo leyó para esta pregunta, si leyó alguna. */
  page: TurnPage | null;
}

/** Cuánto se espera a que la página anfitriona entregue su texto: si no llega, se pregunta sin ella. */
const PAGE_WAIT_MS = 700;

/* --- Quién entra ----------------------------------------------------------------------------- */

export function PiloEmbed({ space = "planeacion" }: { space?: SpaceId }) {
  const here = localizeDeep(ASK_SPACES[space] ?? ASK_SPACES.planeacion);
  const usual = here.id === "planeacion";
  const config = usePiloAiConfig();
  const { profile, loading } = useAuth();
  const params = useMemo(() => readParams(window.location.search, here.id), [here.id]);
  const role = (profile?.is_active ? profile.role : null) as Role | null;

  // El marco es transparente: el fondo del portal no se pinta, y su esquema de
  // color queda fijo en claro para coincidir con el que declara pilo.js.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.add("pilo-embed-doc");
    return () => root.classList.remove("pilo-embed-doc");
  }, []);

  const waiting = config.isPending || loading;
  const rules = config.data;
  // Quién aloja el marco: este portal siempre puede; otro, solo si la administración lo autorizó (0111).
  const hosted = useMemo(() => hostOrigin(window.location.ancestorOrigins, document.referrer), []);
  // El de siempre se abre con «pregunta» de la configuración; otro espacio, con su ficha (0113). Sin ficha, no se pinta.
  const cfg: SpaceConfig | null = usual ? null : (rules?.spaces[here.id] ?? null);
  const door = !rules ? null : usual ? rules.pregunta : cfg;
  const injected = rules && door ? { ...rules, portals: { ...rules.portals, [here.portal]: { on: door.on, aud: door.aud, fns: here.fns } } } : null;
  const allowed = Boolean(rules && injected && widgetAllowed(spaceWidget(rules, here.id), hosted, window.location.origin) && canUse(injected, here.portal, "preguntar", role).ok);

  useEffect(() => {
    if (!waiting && !allowed) frame("oculto");
  }, [waiting, allowed]);

  if (waiting || !rules || !injected || !allowed) return null;

  return (
    <Widget
      // Cada espacio monta su propio chat: nada de un Pilo queda en la memoria del otro.
      key={here.id}
      space={here}
      cfg={cfg}
      tema={params.tema}
      lado={params.lado}
      // Se lee la página que lo pide en su línea (data-leer), sea de otro portal o de este:
      // la página de prueba es de este portal y sin esto nunca se leía.
      host={hosted}
      voice={{
        portal: here.portal,
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

/* --- El botón, el saludo y el chat ------------------------------------------------------------- */

function loadTurns(key: string): Turn[] {
  try {
    const parsed = JSON.parse(session.get(key) ?? "[]") as Turn[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => t && typeof t.q === "string" && typeof t.id === "string" && (typeof t.answer?.text === "string" || typeof t.error === "string")).slice(-MAX_TURNS);
  } catch {
    return [];
  }
}

function Widget({ space, cfg, tema, lado, host, voice: baseVoice }: { space: SpaceProfile; cfg: SpaceConfig | null; tema: string; lado: string; host: string | null; voice: Voice }) {
  useLang();
  // Lo de esta visita (sessionStorage), bajo el prefijo del chat de este espacio: el de siempre conserva «pilo-embed:*».
  const KEY_TURNS = storageKey(space.embedPrefix, "turnos");
  const KEY_HELLO = storageKey(space.embedPrefix, "saludo");
  const KEY_READ = storageKey(space.embedPrefix, "leer");
  const KEY_PAGES = storageKey(space.embedPrefix, "paginas");
  const usual = space.id === "planeacion";
  // Quién pregunta: solo en los espacios que lo piden. Se recuerda por navegador y por espacio, igual que en la página.
  const askRol = asksRol(space, cfg);
  const [rol, setRol] = useState<Rol | null>(() => (askRol ? readRol(space.storagePrefix) : null));
  const [asking, setAsking] = useState(false);
  const pickRol = (chosen: Rol) => {
    writeRol(space.storagePrefix, chosen);
    setRol(chosen);
    setAsking(false);
    input.current?.focus({ preventScroll: true });
  };
  const view = useMemo(() => roleView(space, cfg, rol), [space, cfg, rol]);
  const sent = wireRol(rol);
  // Lo que viaja a la función además de la pregunta. En el Pilo de siempre, nada: el pedido es el de siempre.
  const wire: AskOptions | undefined = useMemo(() => (usual ? undefined : { portal: space.portal, rol: sent }), [usual, space.portal, sent]);
  const voice = useMemo(() => (usual ? baseVoice : { ...baseVoice, rol: sent, mood: view.mood }), [usual, baseVoice, sent, view.mood]);
  const suggestions = sent ? view.suggestions.slice(0, 3).map((x) => x.q) : space.widget.suggestions;
  const greeting = cfg?.greeting || space.widget.greeting;
  const home = sourceUrl(space.route, window.location.origin);

  const [open, setOpen] = useState(false);
  const [hello, setHello] = useState(false);
  const [full, setFull] = useState(false);
  // La página anfitriona dice si se deja leer (data-leer="si" en su línea).
  const [canRead, setCanRead] = useState(false);
  // Qué pasó con cada lectura de esta visita en la bandeja de la administración, por su huella.
  const [captures, setCaptures] = useState<Record<string, CaptureStatus>>(() => {
    try {
      const saved = JSON.parse(session.get(KEY_PAGES) ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(saved && typeof saved === "object" ? saved : {}).map(([k, v]) => [k, captureStatus(v)]));
    } catch {
      return {};
    }
  });
  const sending = useRef(new Set<string>());
  const [turns, setTurns] = useState<Turn[]>(() => loadTurns(KEY_TURNS));
  const [live, setLive] = useState<Live | null>(null);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [readingId, setReadingId] = useState<string | null>(null);
  const reading = readingId !== null;
  const [status, setStatus] = useState("");
  // Las respuestas que acaban de llegar: «entera» se escribe palabra por palabra; «en vivo» ya se vio escribir.
  const [fresh, setFresh] = useState<Map<string, "entera" | "en vivo">>(() => new Map());
  const [autoRead, setAutoRead] = useState(() => session.get(KEY_READ) === "1");
  const run = useRef<{ ctl: AbortController; turnId: string; text: string; meta: AskMeta | null; steps: ThinkStep[]; startedAt: number; page: TurnPage | null } | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const fab = useRef<HTMLButtonElement>(null);
  const bubble = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const pinned = useRef(true);
  // Los turnos que nacieron en esta visita entran animados; los recordados, no.
  const born = useRef(new Set<string>());

  /* El tamaño del marco sigue a lo que se ve. Al abrir se pide antes de pintar (openPanel). */
  useEffect(() => {
    if (!open) frame(hello ? "saludo" : "cerrado");
  }, [open, hello]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window.parent) return;
      const m = readHostMessage(e.data);
      if (!m) return;
      setFull(m.full);
      setCanRead(m.read === true && host !== null && e.origin === host);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [host]);

  /* --- leer la página que aloja el chat (0127) --- */

  /** Le pide a la página su texto de ahora. null si no se deja leer, no responde a tiempo o no tiene texto. */
  const requestPage = (signal: AbortSignal): Promise<HostPage | null> =>
    new Promise((resolve) => {
      if (!canRead || !host) return resolve(null);
      const id = newId();
      let timer = 0;
      const finish = (page: HostPage | null) => {
        window.clearTimeout(timer);
        window.removeEventListener("message", onReply);
        signal.removeEventListener("abort", onAbort);
        resolve(page);
      };
      const onReply = (e: MessageEvent) => {
        if (e.source !== window.parent || e.origin !== host) return;
        const reply = readHostPage(e.data, id);
        if (reply) finish(reply.page);
      };
      const onAbort = () => finish(null);
      window.addEventListener("message", onReply);
      signal.addEventListener("abort", onAbort);
      timer = window.setTimeout(() => finish(null), PAGE_WAIT_MS);
      try {
        window.parent.postMessage(pageRequest(id), host);
      } catch {
        finish(null);
      }
    });

  /** La lectura va a la bandeja de la administración una sola vez por página y contenido en la visita. */
  const sendCapture = (page: HostPage) => {
    const stamp = pageStamp(page);
    if (captures[stamp] || sending.current.has(stamp)) return;
    sending.current.add(stamp);
    void capturePage(page, space.portal).then((raw) => {
      sending.current.delete(stamp);
      setCaptures((all) => ({ ...all, [stamp]: captureStatus(raw) }));
    });
  };

  useEffect(() => {
    session.set(KEY_PAGES, JSON.stringify(captures));
    // La llave no cambia mientras el chat vive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captures]);

  /* El saludo: una vez por visita, a los pocos segundos, y se retira solo. */
  useEffect(() => {
    if (session.get(KEY_HELLO) === "1") return;
    let hide = 0;
    const show = window.setTimeout(() => {
      session.set(KEY_HELLO, "1");
      setHello(true);
      hide = window.setTimeout(() => setHello(false), 9000);
    }, 2600);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  useLayoutEffect(() => {
    if (!hello || !bubble.current || reduced()) return;
    const tween = gsap.fromTo(bubble.current, { opacity: 0, scale: 0.86, y: 8, filter: "blur(4px)" }, { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", duration: 0.34, ease: EASE, clearProps: "opacity,filter,transform" });
    return endVisible(tween);
  }, [hello]);

  useEffect(() => {
    session.set(KEY_TURNS, JSON.stringify(turns.filter((t) => t.answer || t.error).slice(-MAX_TURNS)));
    // La llave no cambia mientras el chat vive: cada espacio monta el suyo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns]);

  /* Al salir, el pedido en curso se cancela y Pilo se calla. */
  useEffect(
    () => () => {
      run.current?.ctl.abort();
      run.current = null;
      stopPilo();
    },
    [],
  );

  const toBottom = () => {
    pinned.current = true;
    requestAnimationFrame(() => {
      const s = log.current;
      if (s) s.scrollTop = s.scrollHeight;
    });
  };

  // El chat sigue a la respuesta solo si la persona está al final: si subió a leer, no se la mueve.
  useEffect(() => {
    const s = log.current;
    if (s && pinned.current) s.scrollTop = s.scrollHeight;
  }, [turns, live, open]);

  /* --- abrir y cerrar --- */

  const openPanel = () => {
    if (open) return;
    setHello(false);
    frame("abierto");
    setOpen(true);
  };

  const closePanel = () => {
    if (!open || closing.current) return;
    stopPilo();
    const done = () => {
      closing.current = false;
      setOpen(false);
      requestAnimationFrame(() => fab.current?.focus({ preventScroll: true }));
    };
    const el = panel.current;
    if (!el || reduced()) return done();
    closing.current = true;
    // Sale más rápido de lo que entró.
    gsap.to(el, { opacity: 0, scale: 0.94, y: 10, duration: 0.18, ease: "power2.out", onComplete: done });
  };

  useLayoutEffect(() => {
    const el = panel.current;
    if (!open || !el) return;
    toBottom();
    const focus = window.setTimeout(() => input.current?.focus({ preventScroll: true }), 120);
    if (reduced()) return () => window.clearTimeout(focus);
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: EASE } })
        .fromTo(el, { opacity: 0, scale: 0.88, y: 16, filter: "blur(8px)" }, { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", duration: 0.42, clearProps: "filter" })
        .fromTo(".pe-face", { opacity: 0, y: 30, scale: 0.5, rotate: -24 }, { opacity: 1, y: 0, scale: 1, rotate: 0, duration: 0.62, ease: "back.out(2.4)" }, 0.08)
        .fromTo(".pe-id > *", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05 }, 0.14)
        .fromTo(".pe-log, .pe-chips, .pe-form, .pe-foot", { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.34, stagger: 0.04 }, 0.16);
    }, el);
    return () => {
      window.clearTimeout(focus);
      ctx.revert();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closePanel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // closePanel solo lee refs y `open`, que aquí es verdadero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /* --- preguntar --- */

  const patchTurn = (id: string, patch: Partial<Turn>) => setTurns((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  /** Detener: el pedido se cancela y lo escrito se conserva. */
  const stop = () => {
    const r = run.current;
    if (!r) return;
    run.current = null;
    r.ctl.abort();
    patchTurn(r.turnId, interruptedTurn(r.text, r.meta));
    setLive(null);
    setBusy(false);
    setStatus(r.text.trim() ? tr("Detuvo la respuesta: quedó incompleta.") : tr("Detuvo la pregunta."));
  };

  const ask = async (raw: string, replaceTurn?: string) => {
    const q = raw.replace(/\s+/g, " ").trim();
    if (!q) return;
    stopPilo();
    // Otra pregunta mientras Pilo escribe: la anterior se corta y queda como incompleta.
    const cut = run.current;
    const cutPatch = cut ? interruptedTurn(cut.text, cut.meta) : null;
    if (cut) {
      run.current = null;
      cut.ctl.abort();
    }
    const before = turns.filter((t) => t.id !== replaceTurn).map((t) => (cut && cutPatch && t.id === cut.turnId ? { ...t, ...cutPatch } : t));
    const history = buildHistory(before.map((t) => ({ q: t.q, a: t.answer?.text })));
    const turn: Turn = { id: newId(), q };
    born.current.add(turn.id);
    setTurns([...before, turn].slice(-MAX_TURNS));
    const ctl = new AbortController();
    const mine = { ctl, turnId: turn.id, text: "", meta: null as AskMeta | null, steps: [] as ThinkStep[], startedAt: Date.now(), page: null as TurnPage | null };
    run.current = mine;
    const show = () => setLive({ turnId: mine.turnId, text: mine.text, meta: mine.meta, steps: mine.steps, startedAt: mine.startedAt, page: mine.page });
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
        onDelta: (text) => {
          if (run.current !== mine) return;
          mine.text += text;
          show();
        },
      };
      // La página se lee ahora, no al cargar: así vale también si cambió sin recargar.
      const hostPage = await requestPage(ctl.signal);
      if (run.current !== mine) return;
      const read = hostPage ? pageForQuestion(hostPage, q) : null;
      if (hostPage && read) {
        mine.page = read.turn;
        show();
        sendCapture(hostPage);
      }
      const answer = read
        ? await askQuestionStream(q, history, handlers, { ...wire, page: read.wire })
        : wire
          ? await askQuestionStream(q, history, handlers, wire)
          : await askQuestionStream(q, history, handlers);
      if (run.current !== mine) return;
      setFresh((f) => new Map(f).set(turn.id, mine.text.trim() ? "en vivo" : "entera"));
      // El recibo solo aparece si el servidor confirma que usó la página.
      patchTurn(turn.id, { answer, ...(answer.page && mine.page ? { page: mine.page } : {}) });
      setStatus(tr("Pilo respondió: {v0}", { v0: toPlain(parseAnswer(answer.text)) }));
    } catch (e) {
      // Cortado por «Detener» o por otra pregunta: ya quedó resuelto.
      if (run.current !== mine) return;
      const message = (e instanceof PiloError && e.code === "cancelado" ? "" : (e as Error).message) || tr("No pude hablar con Pilo ahora.");
      patchTurn(turn.id, interruptedTurn(mine.text, mine.meta, message));
      setStatus(mine.text.trim() ? tr("La respuesta quedó incompleta.") : "");
    } finally {
      if (run.current === mine) {
        run.current = null;
        setLive(null);
        setBusy(false);
      }
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return stop();
    const v = draft;
    setDraft("");
    void ask(v);
  };

  const startNew = () => {
    run.current?.ctl.abort();
    run.current = null;
    stopPilo();
    setLive(null);
    setBusy(false);
    setTurns([]);
    setStatus("");
    input.current?.focus({ preventScroll: true });
  };

  const toggleAutoRead = () =>
    setAutoRead((on) => {
      session.set(KEY_READ, on ? "0" : "1");
      if (on) stopPilo();
      return !on;
    });

  const typed = (id: string) =>
    setFresh((f) => {
      if (!f.has(id)) return f;
      const next = new Map(f);
      next.delete(id);
      return next;
    });

  const working = busy && !live?.text;
  // Mientras piensa, la cara de la cabecera cambia de gesto con los segundos.
  const waited = useElapsed(live?.startedAt, working);
  const headline = reading ? tr("Hablando") : working ? (live?.page && !live.steps.length ? tr("Leyendo la página") : tr("Pensando")) : busy ? tr("Escribiendo") : tr(space.widget.idle);
  // La primera vez (o al pedir cambiarlo), el saludo pregunta quién habla.
  const picking = askRol && (rol === null || asking);
  const who = tr(ROLE_OPTIONS.find((o) => o.id === rol)?.short ?? "") || undefined;
  const shut = open && full;

  return (
    <div className="ap pe" data-tema={tema} data-espacio={space.accent ?? undefined} data-lado={lado} data-open={open || undefined} data-full={shut || undefined} data-reading={reading || undefined}>
      {open && (
        <div className="pe-panel" ref={panel} role="dialog" aria-label={tr("Chat con Pilo")}>
          <header className="pe-head">
            <div className="pe-face">
              <PiloMoji size={64} mood={working ? "piensa" : "feliz"} emotion={working ? waitingFace(waited) : view.expression} talking={reading || (busy && !working)} alive />
            </div>
            <div className="pe-id">
              <strong>Pilo</strong>
              <span>{headline}</span>
            </div>
            <div className="pe-wave" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <LangSwitch className="pe-lang" />
            {turns.length > 0 && (
              <button type="button" className="pe-ib" onClick={startNew} aria-label={tr("Empezar una conversación nueva")} title={tr("Conversación nueva")}>
                {I.fresh}
              </button>
            )}
            <button type="button" className="pe-ib" aria-pressed={autoRead} onClick={toggleAutoRead} aria-label={tr("Leer las respuestas en voz alta")} title={tr("Leer las respuestas en voz alta")}>
              {autoRead ? I.sound : I.mute}
            </button>
            <button type="button" className="pe-ib" onClick={closePanel} aria-label={tr("Cerrar el chat")}>
              {I.down}
            </button>
          </header>

          <div
            className="pe-log"
            ref={log}
            onScroll={(e) => {
              const s = e.currentTarget;
              pinned.current = s.scrollHeight - s.scrollTop - s.clientHeight < 48;
            }}
          >
            <div className="pe-msg pe-msg--p">{greeting}</div>
            {turns.map((t) => (
              <TurnView
                key={t.id}
                turn={t}
                stream={live && live.turnId === t.id ? live : null}
                fresh={fresh.get(t.id)}
                animate={born.current.has(t.id)}
                autoRead={autoRead}
                voice={voice}
                onTyped={() => typed(t.id)}
                onRetry={() => void ask(t.q, t.id)}
                home={home}
                capture={captureLine(captures[(t.page ?? (live && live.turnId === t.id ? live.page : null))?.stamp ?? ""] ?? "no")}
                // La primera lectura de una página se cuenta entera; las siguientes, en una línea.
                firstRead={turns.findIndex((x) => x.page?.url === (live?.page?.url ?? "")) === -1}
                onReading={(on) => setReadingId((cur) => (on ? t.id : cur === t.id ? null : cur))}
              />
            ))}
            {picking && <RolePicker variant="chat" value={rol} onPick={pickRol} legend={tr(ROLE_QUESTION)} />}
          </div>

          {turns.length === 0 && (
            <div className="pe-chips">
              {suggestions.map((s) => (
                <button key={s} type="button" onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          <form className="pe-form" onSubmit={submit}>
            <input ref={input} id="pe-pregunta" type="text" value={draft} maxLength={500} autoComplete="off" placeholder={tr("Escriba su pregunta")} aria-label={tr("Su pregunta para Pilo")} onChange={(e) => setDraft(e.target.value)} />
            <button type="submit" className="pe-send" disabled={!busy && !draft.trim()} aria-label={busy ? tr("Detener la respuesta") : tr("Enviar la pregunta")}>
              {busy ? I.stop : I.send}
            </button>
          </form>
          <p className="pe-foot">
            <a href={home} target="_blank" rel="noopener">
              {space.widget.open} {I.out}
            </a>
            {askRol && rol !== null && !asking && (
              <button type="button" className="pe-rol" onClick={() => { setAsking(true); toBottom(); }} aria-label={tr("Quién pregunta: {who}. Cambiar", { who: who ?? "" })}>
                {who} {tr("· cambiar")}
              </button>
            )}
          </p>
          <div className="ap-sr" role="status" aria-live="polite">
            {status}
          </div>
        </div>
      )}

      {hello && !open && (
        <button type="button" className="pe-hello" ref={bubble} onClick={openPanel}>
          {space.widget.hello}
        </button>
      )}

      <button type="button" className="pe-fab" ref={fab} hidden={shut} aria-expanded={open} aria-label={open ? tr("Cerrar el chat con Pilo") : tr("Abrir el chat con Pilo")} onClick={open ? closePanel : openPanel}>
        <span className="pe-fab__face">
          <PiloMoji size={70} mood="feliz" alive={!open} />
        </span>
        <span className="pe-fab__x">{I.close}</span>
      </button>
    </div>
  );
}

/* --- Un turno: la pregunta y su respuesta ------------------------------------------------------ */

/** Los segundos que lleva pensando; se actualiza solo mientras `on`. */
function useElapsed(startedAt: number | undefined, on: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return startedAt ? (Date.now() - startedAt) / 1000 : 0;
}

function TurnView({
  turn,
  stream,
  fresh,
  animate,
  autoRead,
  voice,
  onTyped,
  onRetry,
  onReading,
  home,
  capture,
  firstRead,
}: {
  /** La página de este Pilo: a donde lleva una fuente que no tiene la suya. */
  home: string;
  /** Qué pasó con la lectura en la bandeja de la administración, ya en palabras; vacío si no hay nada que decir. */
  capture: string;
  /** Es la primera vez que Pilo lee esta página en la conversación. */
  firstRead: boolean;
  turn: Turn;
  stream: Live | null;
  fresh: "entera" | "en vivo" | undefined;
  animate: boolean;
  autoRead: boolean;
  voice: Voice;
  onTyped: () => void;
  onRetry: () => void;
  onReading: (on: boolean) => void;
}) {
  useLang();
  const a = turn.answer;
  const pending = !a && !turn.error;
  // Pilo ya escribe: llegó la primera frase y la respuesta aún no termina.
  const streaming = pending && Boolean(stream?.text);
  const working = pending && !streaming;
  const incomplete = Boolean(a && turn.incomplete);
  const text = a?.text ?? stream?.text ?? "";
  const sources = useMemo(() => a?.sources ?? stream?.meta?.sources ?? [], [a, stream?.meta]);
  const parsed = useMemo(() => parseAnswer(text, { streaming }), [text, streaming]);
  const elapsed = useElapsed(stream?.startedAt, working);
  const step = working ? waitingLine({ steps: stream?.steps ?? [], meta: stream?.meta ?? null, seconds: elapsed }) : "";
  const tip = working ? waitingTip(elapsed, seedOf(turn.id)) : null;

  const question = useRef<HTMLDivElement>(null);
  const think = useRef<HTMLDivElement>(null);
  const stepText = useRef<HTMLSpanElement>(null);
  const after = useRef<HTMLDivElement>(null);

  /* La pregunta sale desde la caja de texto hacia su lugar. */
  useLayoutEffect(() => {
    if (!animate || !question.current || reduced()) return;
    const tween = gsap.fromTo(question.current, { opacity: 0, y: 18, scale: 0.92 }, { opacity: 1, y: 0, scale: 1, duration: 0.3, ease: EASE, clearProps: "opacity,transform" });
    return endVisible(tween);
  }, [animate]);

  useLayoutEffect(() => {
    if (!working || !think.current || reduced()) return;
    const tween = gsap.fromTo(think.current, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.28, ease: EASE, delay: 0.12, clearProps: "opacity,transform" });
    return endVisible(tween);
  }, [working]);

  /* Cada paso releva al anterior con un fundido borroso. Si llega otro paso a medio fundido, este termina nítido antes de soltarse. */
  useLayoutEffect(() => {
    if (!step || !stepText.current || reduced()) return;
    const tween = gsap.fromTo(stepText.current, { opacity: 0, y: 7, filter: "blur(4px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.26, ease: EASE, clearProps: "opacity,filter,transform" });
    return endVisible(tween);
  }, [step]);

  /* --- la voz: frase por frase, la que suena se resalta --- */

  const [reading, setReading] = useState<number | null>(null);
  const readRun = useRef(0);
  const enriched = useMemo(
    () =>
      enrichSpokenSentences(
        parsed.sentences.map((x) => x.spoken),
        { mood: a?.mood ?? voice.mood, expressionsEnabled: voice.expressions !== false, patterns: voice.patterns, modulationEnabled: voice.modulation !== false, baseRate: voice.rate, basePitch: voice.pitch },
      ),
    [parsed, a?.mood, voice.mood, voice.expressions, voice.patterns, voice.modulation, voice.rate, voice.pitch],
  );
  const spoken = enriched.sentences;

  // Con «Leer en voz alta», el audio de las primeras frases se pide en cuanto la respuesta está completa.
  useEffect(() => {
    if (a && fresh && autoRead && !incomplete) prefetchPilo(spoken.slice(0, 2), { portal: voice.portal, advanced: voice.advanced, rol: voice.rol });
  }, [a, fresh, autoRead, incomplete, spoken, voice.advanced, voice.portal, voice.rol]);

  const read = async () => {
    if (reading !== null) {
      readRun.current += 1;
      stopPilo();
      setReading(null);
      onReading(false);
      return;
    }
    const mine = ++readRun.current;
    onReading(true);
    for (let k = 0; k < parsed.sentences.length; k++) {
      if (mine !== readRun.current) return;
      if (!spoken[k]?.trim()) continue;
      setReading(k);
      // Mientras suena esta frase, se piden las dos que siguen: así no hay pausas.
      prefetchPilo(spoken.slice(k + 1, k + 3), { portal: voice.portal, advanced: voice.advanced, rol: voice.rol });
      const used = await sayWithPilo(spoken[k], { ...voice, rate: enriched.rate, pitch: enriched.pitch });
      if (used === "cancelado") break;
    }
    if (mine === readRun.current) {
      setReading(null);
      onReading(false);
    }
  };

  // Otra lectura (de otra respuesta) cancela esta: sayWithPilo responde «cancelado».
  useEffect(
    () => () => {
      if (readRun.current > 0) onReading(false);
      readRun.current += 1;
    },
    // Solo al quitar el turno.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Una respuesta que llega entera se escribe sola, breve; la que se vio escribir en vivo, no.
  const { shown, typing, finish } = useTypewriter(parsed.count, Boolean(a) && fresh === "entera", () => {
    onTyped();
    if (autoRead && !incomplete) void read();
  });

  // La que se escribió en vivo se lee una sola vez, ya completa.
  const readLive = useRef(read);
  readLive.current = read;
  useEffect(() => {
    if (!a || fresh !== "en vivo") return;
    onTyped();
    if (autoRead && !incomplete) void readLive.current();
    // Solo al llegar la respuesta final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(a), fresh]);

  /* Terminada la escritura, llegan las fuentes y «Escuchar». */
  const wasWriting = useRef(false);
  const writing = typing || streaming;
  useLayoutEffect(() => {
    if (writing) {
      wasWriting.current = true;
      return;
    }
    if (!wasWriting.current || !after.current || reduced()) return;
    wasWriting.current = false;
    // Con principio y final dichos: un `from` a secas tomaría como final la opacidad a medio camino de otro fundido.
    const tween = gsap.fromTo(after.current.children, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.3, stagger: 0.05, ease: EASE, clearProps: "opacity,transform" });
    return endVisible(tween);
  }, [writing, Boolean(a)]);

  const open = (n: number) => {
    const src = sources.find((s) => s.n === n);
    if (src) window.open(sourceUrl(src.path, window.location.origin, new URL(home).pathname), "_blank", "noopener");
  };

  const notes = a && !incomplete ? notesOf(a) : [];
  // Varias citas pueden salir de la misma página: aquí se enlaza una sola vez.
  const links = a && showsSources(a) ? a.sources.filter((s, i, all) => all.findIndex((x) => x.title === s.title && x.path === s.path) === i).slice(0, 3) : [];

  return (
    <>
      <div className="pe-msg pe-msg--u" ref={question}>
        {turn.q}
      </div>

      {working && stream?.page && <ReadCard page={stream.page} full={firstRead} />}

      {working && (
        <div className="pe-think" ref={think}>
          <span ref={stepText}>{step}</span>
          <span className="ap-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      )}
      {tip && (
        <p className="ap-tip pe-tip" key={tip}>
          {tip}
        </p>
      )}

      {text && (
        <div className="pe-msg pe-msg--p" aria-busy={pending}>
          <AnswerText parsed={parsed} shown={shown} typing={typing} streaming={streaming} reading={reading} sources={sources} active={null} onSource={open} onFinish={finish} />
        </div>
      )}

      {turn.error && (
        <div className="pe-error" role="alert">
          <span>{a ? tr("{error} Lo que alcanzó a escribir quedó incompleto.", { error: turn.error }) : turn.error}</span>
          <button type="button" onClick={onRetry}>
            {tr("Preguntar de nuevo")}
          </button>
        </div>
      )}

      {a && !typing && (
        <div className="pe-after" ref={after}>
          {notes.map((note) => (
            <p key={note} className="pe-note">
              {note}
            </p>
          ))}
          {a.page && turn.page && <ReadTicket page={turn.page} capture={capture} />}
          {a.unknown && a.unknown.length > 0 && <p className="pe-note pe-note--warn">{tr("Revise estos números antes de citarlos: no los encontré en las fuentes ({numbers}).", { numbers: a.unknown.join(", ") })}</p>}
          <div className="pe-meta">
            {links.map((s) => (
              <a key={s.n} href={sourceUrl(s.path, window.location.origin, new URL(home).pathname)} target="_blank" rel="noopener" title={originOf(s) ? `${s.title} · ${originOf(s)}` : s.title}>
                {I.doc}
                <span>{s.title}</span>
              </a>
            ))}
            {text.trim() && (
              <button type="button" aria-pressed={reading !== null} onClick={() => void read()}>
                {I.listen}
                {reading !== null ? tr("Detener") : tr("Escuchar")}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/* --- Leer la página: mientras lee y el recibo ---------------------------------------------- */

/**
 * Pilo leyendo la página que lo aloja. La primera vez muestra sus títulos y los
 * recorre uno tras otro, como quien pasa el dedo por el renglón; las siguientes
 * preguntas sobre la misma página, una sola línea. La lectura ya ocurrió cuando
 * esto se pinta: la animación la cuenta, no hace esperar a nadie (el pedido al
 * servidor sale a la vez).
 */
function ReadCard({ page, full }: { page: TurnPage; full: boolean }) {
  useLang();
  const root = useRef<HTMLDivElement>(null);
  const lines = full ? page.headings.slice(0, 3) : [];
  const [done, setDone] = useState(lines.length === 0 || reduced());

  useLayoutEffect(() => {
    const el = root.current;
    if (!el || reduced()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: EASE }, onComplete: () => setDone(true) });
      tl.fromTo(el, { opacity: 0, y: 10, filter: "blur(4px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.28, clearProps: "opacity,filter,transform" });
      // Cada título: la marca lo recorre de izquierda a derecha y, al pasar, queda leído.
      gsap.utils.toArray<HTMLElement>(".pe-read__line", el).forEach((line, i) => {
        const at = 0.16 + i * 0.26;
        tl.fromTo(line.querySelector(".pe-read__mark"), { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: 0.34, ease: "power2.out" }, at)
          .fromTo(line.querySelector(".pe-read__text"), { opacity: 0.5 }, { opacity: 1, duration: 0.2, ease: "none", clearProps: "opacity" }, at + 0.14)
          .to(line.querySelector(".pe-read__mark"), { opacity: 0, duration: 0.3, ease: "power1.out" }, at + 0.4);
      });
    }, el);
    return () => ctx.revert();
    // Una vez por tarjeta: la página leída no cambia mientras se pinta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="pe-read" ref={root} data-done={done || undefined}>
      <span className="pe-read__icon">{I.page}</span>
      <div className="pe-read__body">
        <strong>{done ? tr("Leí esta página") : tr("Leyendo esta página")}</strong>
        <span className="pe-read__where">{hostLabel(page.url)}</span>
        {lines.length > 0 && (
          <ul className="pe-read__lines">
            {lines.map((text) => (
              <li key={text} className="pe-read__line">
                <span className="pe-read__mark" aria-hidden="true" />
                <span className="pe-read__text">{text}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * El recibo de la lectura, con la respuesta: qué página leyó, cuánto de ella
 * viajó con la pregunta y, cuando el servidor lo confirma, que la mandó a
 * Planeación para guardarla en la memoria. Es el boleto de origen del portal.
 */
function ReadTicket({ page, capture }: { page: TurnPage; capture: string }) {
  useLang();
  const sent = useRef<HTMLSpanElement>(null);

  /* La confirmación llega después que el recibo: entra de izquierda a derecha y su visto se dibuja. */
  useLayoutEffect(() => {
    const el = sent.current;
    if (!capture || !el || reduced()) return;
    const ctx = gsap.context(() => {
      gsap
        .timeline({ defaults: { ease: EASE } })
        .fromTo(el, { clipPath: "inset(0 100% 0 0)", opacity: 0 }, { clipPath: "inset(0 0% 0 0)", opacity: 1, duration: 0.36, clearProps: "clipPath,opacity" })
        .fromTo(".pe-check", { strokeDasharray: 1, strokeDashoffset: 1 }, { strokeDashoffset: 0, duration: 0.26, ease: "power2.out" }, 0.14);
    }, el);
    return () => ctx.revert();
  }, [capture]);

  return (
    <div className="ap-ticket pe-ticket">
      <b>{tr("Leí esta página")}</b>
      <span className="ap-ticket__row">
        <span className="pe-ticket__where">{hostLabel(page.url)}</span>
        <span>
          {trn(page.total, tr("{sent} de {total} pasaje"), tr("{sent} de {total} pasajes"), { sent: page.sent, total: page.total })}
        </span>
      </span>
      {capture && (
        <span className="pe-ticket__sent" ref={sent}>
          {I.check}
          {capture}
        </span>
      )}
    </div>
  );
}
