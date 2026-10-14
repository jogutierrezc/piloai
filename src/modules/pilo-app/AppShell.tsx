/* =============================================================================
   Mr. Pilo · la app móvil · la conversación con un Pilo.

   Cabecera (menú, la cara de Pilo, su nombre con el espacio y el rol, y el
   interruptor de voz), conversación y caja de escribir. Es el mismo Pilo de
   su página: pregunta a la misma función con el mismo pedido, ve escribirse la
   respuesta y la lee con su voz. Las conversaciones son las de ese espacio
   (store.ts) y se guardan en el teléfono.

   La cara de la cabecera piensa mientras Pilo piensa y mueve el pico mientras
   lee. Sin conexión, Pilo aparece en su pose «en obra» y avisa; lo guardado se
   puede leer. Si el espacio está cerrado o pide sesión, se dice aquí mismo.

   Cuentas de Pilo (0120): con cuenta, la persona guarda las respuestas
   completas en su cuenta («Guardar») y el servidor la reconoce por su sesión;
   sin cuenta, con cada pregunta viaja cómo pidió que Pilo le diga y en qué
   tono, y «Guardar» invita a registrarse. Desde 960 px de ancho, el menú deja
   de ser un cajón y queda fijo a la izquierda (AppSide).
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, MouseEvent, RefObject } from "react";
import { Link, useLocation } from "react-router-dom";
import gsap from "gsap";
import { askQuestionStream, buildHistory, PiloError, rateAnswer } from "../../components/pilo/ai/client";
import type { AskHandlers, AskMeta, AskOptions, AskSource } from "../../components/pilo/ai/client";
import { Pilo } from "../pregunta/Pilo";
import type { PiloMojiHandle } from "../pregunta/Pilo";
import { newId, readStored, storageKey, useConversations, writeStored } from "../pregunta/store";
import { APP_PREFIX } from "./themes";
import type { Conversation, Turn } from "../pregunta/store";
import { asksRol, ROLE_OPTIONS, ROLE_QUESTION, roleView, wireRol } from "../pregunta/space";
import type { Rol, SpaceId, SpaceProfile } from "../pregunta/space";
import { RolePicker } from "../pregunta/RolePicker";
import { parseAnswer } from "../pregunta/AnswerText";
import { toPlain } from "../pregunta/markdown";
import { interruptedTurn, reduceSteps } from "../pregunta/answer-state";
import type { ThinkStep } from "../pregunta/answer-state";
import { useQueryClient } from "@tanstack/react-query";
import { extrasRole } from "./access";
import type { Door } from "./access";
import type { Role } from "../../components/pilo/ai/logic";
import { APP_LOGIN, APP_PILOS, APP_SPACES } from "./routes";
import type { AppTheme } from "./themes";
import { loadSaved, nextLast, openingId, readLast, removeSaved, savedEntries, writeLast } from "./saved";
import type { SavedEntry } from "./saved";
import { prefetchOfficial, sayOfficial, stopOfficial } from "./official-voice";
import { pausePiloAudio, resumePiloAudio } from "../../components/pilo/ai/voice-player";
import { CallPreview } from "./llamada/CallPreview";
import { CallScreen } from "./llamada/CallScreen";
import { AnuncioLlamada } from "./llamada/AnuncioLlamada";
import { recognitionSupported } from "./llamada/logic";
import { NEWS_MARK, newsSeen, shouldAnnounce } from "./llamada/novedad";
import type { AccountState } from "./account/useAccount";
import { LimitBanner } from "./limites/LimitBanner";
import { APP_APK, fromKeyboard, isAndroidDevice, isStandalone, reducedMotion } from "./pwa";
import type { InstallWay } from "./pwa";
import { SuperContext, SuperDefs } from "../pregunta/super/Gear";
import { SuperEntrance } from "../pregunta/super/SuperEntrance";
import { SUPER, superAnswer, superStep } from "../pregunta/super/modes";
import type { SuperLine, SuperMode } from "../pregunta/super/modes";
import { superSfx } from "../pregunta/super/sfx";
import { AppTurn } from "./AppTurn";
import type { Live, TurnVoice } from "./AppTurn";
import { AccountSheet, AndroidSheet, AppMenu, IphoneSheet, SettingsSheet, SourcesSheet } from "./AppMenu";
import { Icon } from "./icons";
import { AppSide } from "./AppSide";
import type { Person } from "./AppSide";
import { removeSavedAnswer, saveAnswer, savedDraft, savedKey, useSavedAnswers } from "./account/answers";
import type { SavedAnswer } from "./account/answers";
import { readVisitor, visitorWire } from "./account/visitor";
import { useAuth } from "../../lib/auth";
import { extrasFor, usePiloExtras } from "../../components/pilo/ai/extras";
import { pickPassages, turnFile } from "../pregunta/attach";
import { AttachButton, AttachTray, useAttachment } from "../pregunta/Extras";
import { tr, useLang } from "../../components/pilo/i18n";

type Over = null | "menu" | "ajustes" | "fuentes" | "cuenta" | "iphone" | "android" | "llamada" | "novedad";

/** La llamada recuerda en el dispositivo que ya se activó (no se vuelve a mostrar el aviso) y el idioma elegido. */
const KEY_CALL = storageKey(APP_PREFIX, "llamada");
/** El anuncio de lanzamiento de la llamada: una sola vez por dispositivo (llamada/novedad.ts). */
const KEY_NEWS = storageKey(APP_PREFIX, "novedad-llamada");

export interface ShellProps {
  /** La cuenta de Pilo: de ella salen los límites que el chat avisa antes de agotarse. */
  account: AccountState;
  space: SpaceProfile;
  door: Door;
  /** La configuración o la sesión aún se están leyendo. */
  waking: boolean;
  online: boolean;
  /** Quién usa la app: su cuenta de Pilo, la de la intranet, o nadie. */
  person: Person;
  /** Tiene una cuenta de Pilo activa (0120): cuenta como sesión y puede guardar respuestas. */
  member: boolean;
  /** Disposición de escritorio: el menú es una barra lateral fija. */
  wide: boolean;
  theme: AppTheme;
  onTheme: (theme: AppTheme) => void;
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
  rol: Rol | null;
  onRol: (rol: Rol) => void;
  /** El lugar de la cara en la cabecera: la bienvenida vuela hasta aquí. */
  faceSlot: RefObject<HTMLDivElement>;
  /** La bienvenida está encima: la cara de la cabecera espera a que Pilo llegue. */
  welcoming: boolean;
  /** La política de uso está pendiente: lo obligatorio va antes que cualquier anuncio. */
  gating: boolean;
  onWelcome: () => void;
  onSwitch: (space: SpaceId, open?: string) => void;
  install: { way: InstallWay; dismissed: boolean; run: () => void; dismiss: () => void };
}

export function AppShell({ account, space, door, waking, online, person, member, wide, theme, onTheme, voiceOn, onVoice, rol, onRol, faceSlot, welcoming, gating, onWelcome, onSwitch, install }: ShellProps) {
  useLang();
  const prefix = space.storagePrefix;
  const usual = space.id === "planeacion";
  const location = useLocation();
  const [convs, setConvs] = useConversations(prefix);
  const [currentId, setCurrentId] = useState<string | null>(() => {
    // La que se pidió desde el menú del otro Pilo; si no, la última de este.
    const state = location.state as { open?: unknown; nueva?: unknown } | null;
    const asked = state?.open;
    if (typeof asked === "string" && convs.some((c) => c.id === asked)) return asked;
    // «Nueva conversación», pedida desde el perfil o las guardadas.
    if (state?.nueva === true) return null;
    return openingId(readLast(), space.id, convs);
  });
  const current = convs.find((c) => c.id === currentId) ?? null;

  // Al abrir la app otra vez, se vuelve a esta conversación.
  useEffect(() => {
    writeLast(nextLast(readLast(), space.id, currentId));
  }, [space.id, currentId]);

  /* --- Quién pregunta, y lo que cambia con eso ---------------------------------------------- */

  const askRol = asksRol(space, door.cfg);
  const who = askRol ? rol : null;
  const view = useMemo(() => roleView(space, door.cfg, who), [space, door.cfg, who]);
  const sent = wireRol(who);
  // Las funciones ampliadas (0119): si esta persona puede adjuntar un archivo en este Pilo. Lo decide la administración.
  // Una cuenta de Pilo activa entra como «miembro»: vale para «Con sesión», nunca para «Solo administración».
  const { profile, session } = useAuth();
  const userId = session?.user.id;
  const extras = extrasFor(usePiloExtras().data, space.id, extrasRole((profile?.is_active ? profile.role : null) as Role | null, member));
  const attach = useAttachment(extras.fileMaxMb);
  // Lo que viaja a la función además de la pregunta. En el Pilo de la Universidad, nada: el pedido es el de siempre.
  // El modo secreto (pregunta/super): lo activa una orden escrita en el chat y dura lo que dure la visita.
  const [modo, setModo] = useState<SuperMode | null>(null);
  const lastModo = useRef<SuperMode>("pilocop");
  /** La entrada en curso: a qué modo va, qué dirá Pilo al llegar y en qué turno. */
  const [entrance, setEntrance] = useState<{ mode: SuperMode; short: boolean; said: SuperLine; convId: string; turnId: string } | null>(null);
  const wire: AskOptions | undefined = useMemo(() => {
    const base: AskOptions | null = usual ? null : { portal: space.portal, rol: sent };
    return base || modo ? { ...(base ?? {}), ...(modo ? { modo } : {}) } : undefined;
  }, [usual, space.portal, sent, modo]);
  const voice: TurnVoice = useMemo(() => {
    const own: TurnVoice = usual ? door.voice : { ...door.voice, rol: sent, mood: view.mood };
    // En un modo, la voz no antepone muletillas: el personaje ya trae las suyas.
    return modo ? { ...own, expressions: false } : own;
  }, [usual, door.voice, sent, view.mood, modo]);

  const open = door.state === "abierto";
  const can = open && online && !waking;
  const autoRead = voiceOn && voice.advanced;

  /* --- La llamada ------------------------------------------------------------------------------- */

  // La primera vez, el aviso previo; después, directo a la llamada.
  const [calling, setCalling] = useState(false);
  const startCall = (event: MouseEvent) => {
    if (readStored(KEY_CALL) === "1") {
      stopOfficial();
      setCalling(true);
      return;
    }
    show("llamada", event);
  };
  const activateCall = () => {
    writeStored(KEY_CALL, "1");
    stopOfficial();
    setOver(null);
    setCalling(true);
  };
  // La llamada pregunta lo mismo que el chat: el mismo Pilo, el mismo pedido, las mismas fuentes.
  const callAsk = async (question: string, history: { q: string; a: string }[], onDelta: (text: string) => void, signal: AbortSignal) => {
    const visitor = visitorWire(readVisitor(), member);
    const options = { ...(wire ?? {}), ...(visitor ? { visitor } : {}) };
    const result = await askQuestionStream(question, history, { signal, onDelta }, options);
    return result.text;
  };
  const callVoice = { portal: voice.portal, advanced: voice.advanced, rol: voice.rol };
  const callSpeak = (text: string, onSound: (on: boolean) => void) => sayOfficial(text, { ...callVoice, onSound });
  const callPrefetch = (text: string) => prefetchOfficial([text], callVoice);

  /* --- Estado de la conversación -------------------------------------------------------------- */

  const [busy, setBusy] = useState(false);
  // Una pregunta que llega ya escrita (Mis clases › «Preguntarle a Pilo»): queda en la caja para que la persona la lea y la envíe.
  const [draft, setDraft] = useState(() => {
    const asked = (location.state as { pregunta?: unknown } | null)?.pregunta;
    return typeof asked === "string" ? asked.slice(0, 500) : "";
  });
  const [live, setLive] = useState<Live | null>(null);
  const [fresh, setFresh] = useState<Map<string, "entera" | "en vivo">>(() => new Map());
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [sounding, setSounding] = useState(false);
  const [over, setOver] = useState<Over>(null);
  const [quick, setQuick] = useState(false);
  const [shownSources, setShownSources] = useState<{ sources: AskSource[]; focus: number | null }>({ sources: [], focus: null });
  const [others, setOthers] = useState<Partial<Record<SpaceId, Conversation[]>>>({});
  const run = useRef<{ ctl: AbortController; convId: string; turnId: string; text: string; meta: AskMeta | null; steps: ThinkStep[]; startedAt: number } | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const face = useRef<PiloMojiHandle>(null);
  const pinned = useRef(true);
  // Los turnos que nacieron en esta visita entran animados; los guardados, no.
  const born = useRef(new Set<string>());

  /* --- Las respuestas guardadas en la cuenta (0120) -------------------------------------------- */

  const client = useQueryClient();
  const keptList = useSavedAnswers(userId, member);
  const kept = useMemo(() => new Set((keptList.data ?? []).map((s) => s.id)), [keptList.data]);
  const [keeping, setKeeping] = useState<string | null>(null);

  const toBottom = useCallback(() => {
    pinned.current = true;
    requestAnimationFrame(() => {
      const s = scroll.current;
      if (s) s.scrollTop = s.scrollHeight;
    });
  }, []);

  // La conversación sigue a la respuesta solo si la persona está al final: si subió a leer, no se la mueve.
  useEffect(() => {
    const s = scroll.current;
    if (s && pinned.current) s.scrollTop = s.scrollHeight;
  }, [convs, live, currentId]);

  // El campo crece con el texto, hasta su tope.
  useLayoutEffect(() => {
    const t = input.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${Math.min(t.scrollHeight + 2, 132)}px`;
  }, [draft]);

  // Al salir, el pedido en curso se cancela y Pilo se calla.
  useEffect(
    () => () => {
      run.current?.ctl.abort();
      run.current = null;
      stopOfficial();
    },
    [],
  );

  const patchTurn = (convId: string, turnId: string, patch: Partial<Turn>) =>
    setConvs((list) => list.map((c) => (c.id !== convId ? c : { ...c, turns: c.turns.map((t) => (t.id === turnId ? { ...t, ...patch } : t)) })));

  /** Detener: el pedido se cancela y lo escrito se conserva. */
  const stop = () => {
    const r = run.current;
    if (!r) return;
    run.current = null;
    r.ctl.abort();
    patchTurn(r.convId, r.turnId, interruptedTurn(r.text, r.meta));
    setLive(null);
    setBusy(false);
    setStatus(r.text.trim() ? tr("Detuvo la respuesta: quedó incompleta.") : tr("Detuvo la pregunta."));
  };

  /* --- Los modos secretos ------------------------------------------------------------------- */

  /** Un turno que responde la app (una orden o la charla de un modo). Corta lo que Pilo estuviera escribiendo. */
  const pushLocal = (q: string, mode: SuperMode, said: SuperLine | null) => {
    stopOfficial();
    setNote("");
    if (run.current) stop();
    const turn: Turn = { id: newId(), q, modo: mode, local: true, ...(said ? { answer: superAnswer(said) } : {}) };
    born.current.add(turn.id);
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
    if (reducedMotion()) {
      // Con movimiento reducido no hay escena: el modo cambia y Pilo lo dice.
      setModo(step.mode);
      pushLocal(q, step.mode, step.said);
      return true;
    }
    // El turno espera sin respuesta mientras Pilo entra; al aterrizar en la barra, habla.
    setEntrance({ mode: step.mode, short: step.short, said: step.said, ...pushLocal(q, step.mode, null) });
    return true;
  };

  /** Pilo llegó a su lugar en la barra: el modo queda puesto y dice su frase de entrada. */
  const landSuper = () => {
    const e = entrance;
    if (!e) return;
    setEntrance(null);
    setModo(e.mode);
    patchTurn(e.convId, e.turnId, { answer: superAnswer(e.said) });
    setFresh((f) => new Map(f).set(e.turnId, "entera"));
    setStatus(tr("Pilo respondió: {text}", { text: e.said.text }));
    superSfx(autoRead).clank();
    // La cara llega con su equipo puesto y un rebote corto.
    const slot = faceSlot.current;
    if (slot) gsap.fromTo(slot, { scale: 0.7 }, { scale: 1, duration: 0.5, ease: "back.out(2.4)", clearProps: "transform" });
  };

  const ask = async (raw: string, replaceTurn?: string) => {
    const q = raw.replace(/\s+/g, " ").trim();
    if (!q || !can) return;
    // Los modos secretos se atienden antes de llamar al servidor. Con un archivo adjunto, la pregunta es de verdad.
    if (!replaceTurn && !attach.attachment && handleSuper(q)) return;
    stopOfficial();
    setNote("");
    // Otra pregunta mientras Pilo escribe: la anterior se corta y queda como incompleta.
    const cut = run.current;
    const cutPatch = cut ? interruptedTurn(cut.text, cut.meta) : null;
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
    born.current.add(turn.id);
    const before = patched(conv.turns.filter((t) => t.id !== replaceTurn));
    // Lo que la persona escribió y el texto final de cada respuesta: el servidor arma el contexto.
    // Lo que respondió la app (los modos secretos) no es contexto para el servidor.
    const history = buildHistory(before.filter((t) => !t.local).map((t) => ({ q: t.q, a: t.answer?.text })));
    setConvs((list) => [{ ...conv, at: Date.now(), turns: [...before, turn] }, ...list.filter((c) => c.id !== conv.id).map((c) => (cut && c.id === cut.convId ? { ...c, turns: patched(c.turns) } : c))]);
    setCurrentId(conv.id);
    const ctl = new AbortController();
    const mine = { ctl, convId: conv.id, turnId: turn.id, text: "", meta: null as AskMeta | null, steps: [] as ThinkStep[], startedAt: Date.now() };
    run.current = mine;
    const show = () => setLive({ turnId: mine.turnId, text: mine.text, meta: mine.meta, steps: mine.steps, startedAt: mine.startedAt });
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
      // Con un archivo adjunto viajan, además, los pasajes que tienen que ver con esta pregunta: el archivo no se sube.
      // Sin cuenta viaja, además, cómo pidió que Pilo le diga y en qué tono. Con cuenta, nada: el servidor la reconoce por su sesión.
      const visitor = visitorWire(readVisitor(), member);
      const answer =
        wire || doc || visitor
          ? await askQuestionStream(q, history, handlers, { ...(wire ?? {}), ...(doc ? { doc } : {}), ...(visitor ? { visitor } : {}) })
          : await askQuestionStream(q, history, handlers);
      if (run.current !== mine) return;
      setFresh((f) => new Map(f).set(turn.id, mine.text.trim() ? "en vivo" : "entera"));
      // Los pasos y los segundos del flujo no se guardan con la respuesta.
      const rest = { ...answer };
      delete rest.steps;
      delete rest.seconds;
      patchTurn(conv.id, turn.id, { answer: rest });
      setStatus(tr("Pilo respondió: {v0}", { v0: toPlain(parseAnswer(answer.text)) }));
    } catch (e) {
      // Cortado por «Detener» o por otra pregunta: ya quedó resuelto.
      if (run.current !== mine) return;
      const message = (e instanceof PiloError && e.code === "cancelado" ? "" : (e as Error).message) || tr("No pude hablar con Pilo ahora.");
      patchTurn(conv.id, turn.id, interruptedTurn(mine.text, mine.meta, message));
      setStatus(mine.text.trim() ? tr("La respuesta quedó incompleta.") : message);
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
    if (busy && !draft.trim()) return stop();
    const v = draft;
    setDraft("");
    void ask(v);
  };

  const cancelRun = () => {
    run.current?.ctl.abort();
    run.current = null;
    setLive(null);
    setBusy(false);
  };

  /** «Guardar» junto a una respuesta completa: la guarda en la cuenta, o la quita. Sin cuenta, invita a registrarse. */
  const keep = async (t: Turn, viaKeyboard: boolean) => {
    if (!member) {
      setQuick(viaKeyboard);
      setOver("cuenta");
      return;
    }
    if (!current || !t.answer || keeping) return;
    setKeeping(t.id);
    setNote("");
    try {
      if (t.savedId && kept.has(t.savedId)) {
        const id = t.savedId;
        await removeSavedAnswer(id);
        client.setQueryData<SavedAnswer[]>(savedKey(userId), (list) => (list ?? []).filter((s) => s.id !== id));
        patchTurn(current.id, t.id, { savedId: undefined });
        setStatus(tr("Se quitó de sus guardadas."));
      } else {
        const draft = savedDraft(space.id, t.q, t.answer);
        if (!draft) return;
        const row = await saveAnswer(draft);
        client.setQueryData<SavedAnswer[]>(savedKey(userId), (list) => [row, ...(list ?? [])]);
        patchTurn(current.id, t.id, { savedId: row.id });
        setStatus(tr("Guardada en su cuenta."));
        if (!viaKeyboard) face.current?.nod();
      }
    } catch (e) {
      setNote((e as Error).message || tr("No se pudo guardar la respuesta."));
    } finally {
      setKeeping(null);
    }
  };

  /* --- Menú y hojas --------------------------------------------------------------------------- */

  // En el escritorio el menú está siempre a la vista: las conversaciones del otro Pilo se leen al entrar.
  useEffect(() => {
    if (wide) setOthers(Object.fromEntries(APP_SPACES.filter((s) => s !== space.id).map((s) => [s, loadSaved(s)])));
  }, [wide, space.id]);

  /** En un Android que aún no corre como app instalada: el APK de la universidad es también una opción. */
  const androidOffer = !wide && !isStandalone() && isAndroidDevice(navigator.userAgent);

  const show = (which: Exclude<Over, null>, event?: MouseEvent | null) => {
    setQuick(fromKeyboard(event));
    if (which === "menu") setOthers(Object.fromEntries(APP_SPACES.filter((s) => s !== space.id).map((s) => [s, loadSaved(s)])));
    setOver(which);
  };
  /** Con Escape (o Enter sobre «Cerrar») se cierra en seco; con un toque, deslizando. */
  const hide = (event?: MouseEvent | null) => {
    setQuick(event === undefined ? true : fromKeyboard(event));
    setOver(null);
  };

  /* --- El anuncio de la llamada: una sola vez ---------------------------------------------------- */

  const [newsDone, setNewsDone] = useState(() => newsSeen(readStored(KEY_NEWS)));
  const [hint, setHint] = useState(false);
  const announce = shouldAnnounce({
    seen: newsDone,
    activated: readStored(KEY_CALL) === "1",
    blocked: welcoming || gating || over !== null || calling,
    online,
    voice: voice.advanced,
    recognition: recognitionSupported(),
    busy,
    open: can,
  });
  // Sale un momento después de que todo lo demás quedó en calma.
  useEffect(() => {
    if (!announce) return;
    const id = window.setTimeout(() => {
      setQuick(false);
      setOver("novedad");
    }, 900);
    return () => window.clearTimeout(id);
  }, [announce]);
  // Cerrarlo de cualquier forma (los dos botones, tocar fuera, Escape) cuenta como verlo: no vuelve.
  const wasNews = useRef(false);
  useEffect(() => {
    if (over === "novedad") wasNews.current = true;
    else if (wasNews.current) {
      wasNews.current = false;
      writeStored(KEY_NEWS, NEWS_MARK);
      setNewsDone(true);
      // Si no pasó a probar la llamada, el botón del teléfono late dos veces para mostrar dónde está.
      if (over === null) {
        setHint(true);
        window.setTimeout(() => setHint(false), 4200);
      }
    }
  }, [over]);
  /** «Probar la llamada» desde el anuncio: pasa al aviso de funciones, donde se pide el micrófono. */
  const tryCallFromNews = () => {
    setQuick(false);
    setOver("llamada");
  };

  const startNew = () => {
    stopOfficial();
    cancelRun();
    attach.clear();
    setCurrentId(null);
    setNote("");
    setOver(null);
  };

  const openSaved = (entry: SavedEntry) => {
    stopOfficial();
    setOver(null);
    if (entry.space !== space.id) return onSwitch(entry.space, entry.id);
    cancelRun();
    attach.clear();
    setCurrentId(entry.id);
    toBottom();
  };

  const deleteSaved = (entry: SavedEntry) => {
    if (entry.space !== space.id) {
      setOthers((o) => ({ ...o, [entry.space]: removeSaved(entry.space, entry.id) }));
      return;
    }
    if (run.current?.convId === entry.id) cancelRun();
    setConvs((list) => list.filter((c) => c.id !== entry.id));
    if (entry.id === currentId) {
      stopOfficial();
      attach.clear();
    setCurrentId(null);
    }
  };

  const saved = useMemo(() => savedEntries({ ...others, [space.id]: convs }), [others, space.id, convs]);

  /* --- La cara de la cabecera -------------------------------------------------------------------- */

  const working = busy && !live?.text;
  const writing = busy && !working;

  // Cambiar de tema: un pulso de la cara lo confirma (entera, sin deformarla).
  const pulse = (event: { detail: number }) => {
    const el = faceSlot.current;
    if (!el || reducedMotion() || fromKeyboard(event)) return;
    gsap.fromTo(el, { scale: 0.96 }, { scale: 1, duration: 0.22, ease: "power3.out", overwrite: true, clearProps: "transform" });
  };

  // Al llegar de la bienvenida, Pilo asiente desde su sitio.
  const wasWelcoming = useRef(welcoming);
  useEffect(() => {
    // No se enfoca el campo: en un teléfono eso sube el teclado sin que nadie lo pida.
    if (wasWelcoming.current && !welcoming) face.current?.nod();
    wasWelcoming.current = welcoming;
  }, [welcoming]);

  const toggleVoice = () => {
    if (!voice.advanced) {
      setNote(tr("La voz de Pilo no está disponible ahora: queda el texto."));
      return;
    }
    if (voiceOn) stopOfficial();
    setNote("");
    onVoice(!voiceOn);
  };

  const roleName = tr(ROLE_OPTIONS.find((o) => o.id === who && o.id !== "general")?.short ?? "") || undefined;
  const under = APP_PILOS[space.id].under + (roleName ? ` · ${roleName}` : "");
  const voiceLabel = !voice.advanced ? tr("La voz de Pilo no está disponible ahora") : voiceOn ? tr("Pilo lee las respuestas con su voz. Apagar") : tr("Leer las respuestas con la voz de Pilo");
  const needsRol = askRol && rol === null && !welcoming && open;
  const placeholder = !online ? tr("Sin conexión") : waking ? tr("Despertando a Pilo…") : !open ? tr("Pilo no está disponible aquí") : tr("Escriba su pregunta");

  const shown = { ...person, saved: member ? (keptList.data?.length ?? null) : null };
  /** Pilo se presenta otra vez: calla lo que suene, corta la respuesta en curso y cierra lo que esté encima. */
  const showWelcome = () => {
    stopOfficial();
    cancelRun();
    setOver(null);
    onWelcome();
  };

  return (
    <SuperContext.Provider value={modo}>
      <SuperDefs />
      {wide && (
        <AppSide
          space={space.id}
          saved={saved}
          currentId={currentId}
          active="chat"
          person={shown}
          onOpen={openSaved}
          onDelete={deleteSaved}
          onNew={startNew}
          onSwitch={(id) => id !== space.id && onSwitch(id)}
          theme={theme}
          onTheme={onTheme}
          onWelcome={showWelcome}
        />
      )}
      <header className="pa-bar">
        <div className="pa-bar__in" data-wide={wide || undefined}>
          {!wide && (
            <button type="button" className="pa-icon" onClick={(e) => show("menu", e)} aria-label={tr("Abrir el menú")} aria-haspopup="dialog" aria-expanded={over === "menu"}>
              {Icon.menu}
            </button>
          )}
          <div className="pa-bar-face" ref={faceSlot} style={{ visibility: welcoming ? "hidden" : undefined }}>
            <Pilo ref={face} size="100%" mood={working ? "piensa" : "feliz"} emotion={working ? undefined : !online ? "obra" : view.expression} talking={sounding || writing} alive label="Mr. Pilo" />
          </div>
          <div className="pa-bar-id">
            <strong>Mr. Pilo</strong>
            <span>{working ? tr("Pensando…") : sounding ? tr("Hablando") : writing ? tr("Escribiendo…") : modo ? tr("Modo {name}", { name: SUPER[modo].name }) : under}</span>
          </div>
          <button type="button" className="pa-icon" disabled={!can || welcoming} data-hint={hint || undefined} aria-haspopup="dialog" aria-label={tr("Llamar a Pilo")} title={tr("Llamar a Pilo")} onClick={startCall}>
            {Icon.phone}
          </button>
          <button type="button" className="pa-icon" aria-pressed={autoRead} aria-disabled={!voice.advanced || undefined} aria-label={voiceLabel} title={voiceLabel} onClick={toggleVoice}>
            {autoRead ? Icon.voice : Icon.mute}
          </button>
        </div>
      </header>

      <div
        className="pa-msgs"
        ref={scroll}
        onScroll={(e) => {
          const s = e.currentTarget;
          pinned.current = s.scrollHeight - s.scrollTop - s.clientHeight < 48;
        }}
      >
        <div className="pa-col">
          {!online && (
            <section className="pa-card" role="status">
              <div className="pa-card__face">
                <Pilo size="100%" emotion="obra" alive label={tr("Mr. Pilo, en obra")} />
              </div>
              <h2>{tr("Estoy sin conexión")}</h2>
              <p>{tr("Necesito internet para responder. Mientras vuelve, sus conversaciones guardadas se pueden leer desde el menú.")}</p>
            </section>
          )}

          {online && !waking && !open && (
            <section className="pa-card">
              <div className="pa-card__face">
                <Pilo size="100%" mood={door.state === "sesion" ? "atento" : "duda"} alive label="Mr. Pilo" />
              </div>
              <h2>{door.state === "sesion" ? tr("Pilo lo espera adentro") : tr("Pilo está descansando")}</h2>
              <p>{tr(door.message)}</p>
              {door.state === "sesion" && (
                <>
                  <Link className="pa-btn pa-btn--main" to={APP_LOGIN}>
                    {tr("Entrar con mi cuenta de Pilo")}
                  </Link>
                  <Link className="pa-card__alt" to="/acceso-intranet" state={{ from: location.pathname }}>
                    {tr("Soy personal con cuenta en la intranet")}
                  </Link>
                </>
              )}
            </section>
          )}

          {!current ? (
            (open || waking) && (
              <div className="pa-msg">
                <div className="pa-msg__face">
                  <Pilo size="100%" mood="feliz" emotion={view.expression} />
                </div>
                <div className="pa-msg__body">
                  <div className="pa-bubble">
                    <p>{space.hello.h1}</p>
                  </div>
                  <p className="pa-hint">{space.note}</p>
                  {needsRol && <RolePicker variant="chat" value={rol} onPick={onRol} legend={tr(ROLE_QUESTION)} />}
                </div>
              </div>
            )
          ) : (
            current.turns.map((t) => (
              <AppTurn
                key={t.id}
                turn={t}
                stream={live && live.turnId === t.id ? live : null}
                fresh={fresh.get(t.id)}
                animate={born.current.has(t.id)}
                autoRead={autoRead}
                voice={voice}
                expression={view.expression}
                onTyped={() =>
                  setFresh((f) => {
                    if (!f.has(t.id)) return f;
                    const next = new Map(f);
                    next.delete(t.id);
                    return next;
                  })
                }
                onRetry={() => void ask(t.q, t.id)}
                onVote={(vote) => {
                  patchTurn(current.id, t.id, { vote });
                  if (t.answer) void rateAnswer({ answerId: t.answer.answerId, vote, question: t.q, text: t.answer.text, kind: t.answer.kind, ...(wire ?? {}) });
                }}
                onSources={(sources, focus) => {
                  setShownSources({ sources, focus });
                  setQuick(false);
                  setOver("fuentes");
                }}
                onSound={setSounding}
                onVoiceLost={() => setNote(tr("La voz de Pilo no está disponible ahora: queda el texto."))}
                saved={Boolean(t.savedId && kept.has(t.savedId))}
                saving={keeping === t.id}
                onSave={(_trigger, viaKeyboard) => void keep(t, viaKeyboard)}
              />
            ))
          )}

          {note && (
            <p className="pa-note" role="status">
              {note}
            </p>
          )}
        </div>
      </div>

      <div className="pa-dock">
        <div className="pa-dock__in">
          {member && <LimitBanner state={account} space={space.id} refreshKey={current?.turns.length ?? 0} />}
          {!current && can && (
            <div className="pa-sugs" role="group" aria-label={tr("Preguntas sugeridas")}>
              {view.suggestions.map((s) => (
                <button key={s.q} type="button" className="pa-sug" onClick={() => void ask(s.q)}>
                  {s.q}
                </button>
              ))}
            </div>
          )}

          {!current && !welcoming && !install.dismissed && (install.way || androidOffer) && (
            <div className="pa-install">
              <span>{wide ? tr("Instale a Pilo en su computador.") : androidOffer ? tr("Pilo también vive como app en su Android.") : tr("Lleve a Pilo en su teléfono.")}</span>
              <button
                type="button"
                className="pa-btn pa-btn--main"
                onClick={(e) => (androidOffer ? show("android", e) : install.way === "iphone" ? show("iphone", e) : install.run())}
              >
                {androidOffer ? tr("Conseguir la app") : tr("Instalar a Pilo")}
              </button>
              <button type="button" className="pa-icon" onClick={install.dismiss} aria-label={tr("Ahora no")}>
                {Icon.close}
              </button>
            </div>
          )}

          <AttachTray state={attach} />
          <form className="pa-compose" data-clip={extras.files && can ? "" : undefined} onSubmit={submit}>
            {extras.files && can && <AttachButton onPick={attach.pick} disabled={Boolean(attach.reading)} />}
            <label htmlFor="pa-q" className="pa-sr">
              {tr("Su pregunta para Pilo")}
            </label>
            <textarea
              id="pa-q"
              ref={input}
              rows={1}
              value={draft}
              maxLength={500}
              disabled={!can}
              placeholder={placeholder}
              autoComplete="off"
              enterKeyHint="send"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
            />
            {can && !welcoming && !busy && !draft.trim() ? (
              // Sin nada escrito, el botón es el micrófono: habla con Pilo por voz (la misma llamada del encabezado).
              <button type="button" className="pa-send" data-mic aria-haspopup="dialog" aria-label={tr("Hablar con Pilo por voz")} title={tr("Hablar con Pilo por voz")} onClick={startCall}>
                {Icon.mic}
              </button>
            ) : (
            <button type="submit" className="pa-send" disabled={!can || (!busy && !draft.trim())} aria-label={busy && !draft.trim() ? tr("Detener la respuesta") : busy ? tr("Detener y preguntar esto") : tr("Enviar la pregunta")}>
              {busy && !draft.trim() ? Icon.stop : Icon.send}
            </button>
            )}
          </form>
        </div>
        <div className="pa-sr" role="status" aria-live="polite">
          {status}
        </div>
      </div>

      <div className="pa-scrim" data-open={(over !== null && !(wide && over === "menu")) || undefined} data-quick={quick || undefined} onClick={(e) => hide(e)} aria-hidden="true" />

      {/* En el escritorio el menú es la barra lateral: el cajón no se monta. */}
      {!wide && (
        <AppMenu
          open={over === "menu"}
          quick={quick}
          onClose={hide}
          space={space.id}
          saved={saved}
          currentId={currentId}
          onOpen={openSaved}
          onDelete={deleteSaved}
          onNew={startNew}
          onSwitch={(id) => {
            setOver(null);
            if (id !== space.id) onSwitch(id);
          }}
          onSettings={() => setOver("ajustes")}
          getApp={
            androidOffer
              ? { label: tr("Descargar para Android"), hint: tr("Tabletas y celulares · versión {version} · {size}", { version: APP_APK.version, size: APP_APK.size }), onOpen: () => setOver("android") }
              : install.way === "iphone"
                ? { label: tr("Instalar en el iPhone"), hint: tr("Desde Safari, «Añadir a pantalla de inicio»"), onOpen: () => setOver("iphone") }
                : null
          }
          person={shown}
        />
      )}
      <SettingsSheet
        open={over === "ajustes"}
        quick={quick}
        onClose={hide}
        theme={theme}
        onTheme={(id, e) => {
          onTheme(id);
          pulse(e);
        }}
        onWelcome={showWelcome}
      />
      <SourcesSheet open={over === "fuentes"} quick={quick} onClose={hide} sources={shownSources.sources} focus={shownSources.focus} space={space} />
      <AccountSheet open={over === "cuenta"} quick={quick} onClose={hide} />
      <IphoneSheet open={over === "iphone"} quick={quick} onClose={hide} />
      <AndroidSheet open={over === "android"} quick={quick} onClose={hide} canPrompt={install.way === "aviso"} onPrompt={() => {
        setOver(null);
        install.run();
      }} />
      <CallPreview open={over === "llamada"} quick={quick} onClose={hide} onActivate={activateCall} available={voice.advanced} />
      <AnuncioLlamada open={over === "novedad"} quick={quick} onClose={hide} onTry={tryCallFromNews} />
      {calling && (
        <CallScreen
          ask={callAsk}
          speak={callSpeak}
          hush={stopOfficial}
          prefetch={callPrefetch}
          pauseVoice={pausePiloAudio}
          resumeVoice={resumePiloAudio}
          online={online}
          onEnd={() => {
            stopOfficial();
            setSounding(false);
            setCalling(false);
          }}
        />
      )}
      {entrance && <SuperEntrance key={entrance.turnId} mode={entrance.mode} short={entrance.short} sound={autoRead} target={() => faceSlot.current} onDone={landSuper} />}
    </SuperContext.Provider>
  );
}
