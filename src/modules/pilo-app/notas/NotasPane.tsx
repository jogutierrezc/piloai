/* =============================================================================
   Mr. Pilo · Mis notas (beta) · /app/notas.

   Un estudiante con cuenta de Pilo conecta Génesis (el portal del estudiante)
   y Pilo le muestra su histórico de notas y cómo ha evolucionado, leído
   contra las metas que él mismo se pone. Solo lectura: Pilo no cambia nada en
   Génesis.

   La entrada es una guía narrada por Pilo (guia.ts), con Pilo y su texto a un
   lado y la tarea al otro, y el avance a la vista:
     1. Bienvenida: qué va a pasar, en cuatro pasos. Se puede saltar.
     2. Permiso: la autorización amistosa (DataConsent, de terms/). Sin la
        casilla no se consulta nada; la segunda decide si el permiso queda en
        este dispositivo o solo mientras la pestaña esté abierta.
     3. Cuenta: la sede (Génesis tiene un portal por sede), el usuario y la
        contraseña de Génesis. Se usan una vez para entrar y no se guardan.
     4. Metas: qué promedio acumulado quiere alcanzar y cuál este semestre. Al
        mover cada control se le dice cuánto tendría que promediar.
     5. Despegue: Pilo lo saluda por su nombre (el de su cuenta de Pilo, nunca
        el de Génesis) y vuela de la guía a la barra de las notas.
   Quien ya está conectado y vuelve a entrar no repite la guía: va directo a
   sus notas.

   Las notas, con las metas siempre a la vista (a la izquierda en computador,
   arriba en teléfono) y tres pestañas:
     Mi histórico   un selector de periodo fijo arriba —anterior, lista y
                    siguiente; en computador, además, todos los periodos en
                    varias filas— y las materias del periodo. El polígrafo
                    oficial se descarga en PDF.
     Mi evolución   la gráfica de promedios con la meta de acumulado dibujada,
                    lo que Pilo ve en el récord (calculado aquí) y «Lo que le
                    recomiendo»: al pulsar el botón, y solo entonces, se envía
                    a la IA un resumen sin datos personales, con las metas, y
                    las recomendaciones se escriben ahí mismo con sus fuentes
                    y la gráfica de fortalezas y áreas por reforzar.
     Mi semestre    en construcción: sin datos.

   En ninguna pantalla se muestra un código ni un identificador: ni el del
   estudiante, ni el de las materias, ni ids internos.

   La voz es la de Pilo, como en la bienvenida de la app (official-voice.ts):
   respeta el interruptor de voz de la app y, si no llega, todo funciona
   igual: el texto nunca espera al audio. El aleteo (alas.ts) suena solo tras
   un gesto y con el mismo interruptor.

   Nada de las notas se guarda: viven en la memoria de esta pantalla, igual
   que las recomendaciones. En el dispositivo quedan el permiso (logic.ts) y
   las metas (guia.ts), y «Desconectar» borra los dos.

   Movimiento: GSAP con contexto y revert. El paso que entra, entra una vez
   con un desenfoque leve; lo que sale no se anima. Solo con el dedo o el
   ratón, nunca con el teclado, y con movimiento reducido todo aparece en su
   sitio. La línea de la gráfica se dibuja una vez por conexión.
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { Pilo } from "../../pregunta/Pilo";
import type { PiloMojiHandle } from "../../pregunta/Pilo";
import type { AppVoice } from "../access";
import { APP_ACCOUNT, APP_LOGIN } from "../routes";
import { Icon } from "../icons";
import { prefetchOfficial, sayOfficial, stopOfficial } from "../official-voice";
import { fromKeyboard, reducedMotion } from "../pwa";
import type { AccountState } from "../account/useAccount";
import { Field, Msg } from "../account/parts";
import { DataConsent } from "../terms/DataConsent";
import { glide, setWingsOn, wings } from "./alas";
import { asAdviceFailure, asFailure, connectGenesis, loadAdvice, loadHistory, loadPolygraphPdf, loadPortals } from "./api";
import { GUIDE_STEPS, accumulatedLine, captionWords, clearGoals, defaultGoals, goalHint, guideName, guideProgress, guideScript, meterPct, readGoals, saveGoals, semesterHint, semesterLine, spoken, voiceAhead } from "./guia";
import type { Goals, Moment } from "./guia";
import {
  CHART,
  GOAL,
  PASS_MARK,
  STATE_LABEL,
  adviceFailureOf,
  adviceSummary,
  areaBars,
  canUseNotas,
  chartOf,
  clearLink,
  courseName,
  courseState,
  evolution,
  findings,
  goalPlan,
  gradedCredits,
  inProgress,
  lastAverage,
  nearestIndex,
  nota,
  notasMessage,
  periodLine,
  pickPortal,
  readLink,
  saveLink,
  settled,
  summaryCourses,
  totals,
} from "./logic";
import type { Advice, AdviceFailure, AdviceSummary, AreaBar, CourseState, EvoRow, Finding, History, Link as GenesisLink, NotaPeriod, NotasFailure, PortalList } from "./logic";
import "../clases/clases.css";
import "./notas.css";

type Note = { tone: "ok" | "bad" | "info"; text: string };
type TabId = "historico" | "evolucion" | "semestre";
/** Cómo va «Lo que le recomiendo». El resultado vive aquí, en memoria: no se guarda en ningún lado. */
type AdviceState = { status: "reposo" } | { status: "pensando"; step: 0 | 1 } | { status: "listo"; advice: Advice; summary: AdviceSummary } | { status: "fallo"; failure: AdviceFailure };

/** Los pasos reales de un pedido de recomendaciones: lo que hace el dispositivo y lo que hace Pilo. */
const ADVICE_STEPS = ["Armando el resumen, sin su nombre ni su código", "Pilo lee los documentos de Enseñanza y escribe"];

const TABS: { id: TabId; label: string }[] = [
  { id: "historico", label: "Mi histórico" },
  { id: "evolucion", label: "Mi evolución" },
  { id: "semestre", label: "Mi semestre" },
];

const NO_PERIODS: NotaPeriod[] = [];

/** Lo que Pilo promete, dicho otra vez al pie (el diseño aprobado). */
const PROMISES = [
  "Pilo solo lee: no matricula, no cambia notas ni datos, ni toca nada en Génesis.",
  "Sus notas son solo para usted: no entran a la memoria de Pilo ni las ve otra persona.",
  "Puede desconectarlo cuando quiera; al hacerlo se borran de este dispositivo el permiso y sus metas.",
];

/** El glifo de cada estado: el mismo trazo, distinta forma. */
const STATE_GLYPH: Record<CourseState, JSX.Element> = {
  aprobada: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  reprobada: <path d="M6 6l12 12M18 6 6 18" />,
  homologada: <path d="M4 12h14M13 7l5 5-5 5" />,
  en_curso: <path d="M12 7v5l3 2M12 3.5a8.5 8.5 0 100 17 8.5 8.5 0 000-17z" />,
};

export interface NotasVoice {
  /** La voz oficial de Pilo para esta persona; null si no hay: la guía es solo texto. */
  voice: AppVoice | null;
  /** El interruptor de sonido de la app: vale para la voz y para el aleteo. */
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
}

export function NotasPane({ state, online, voice, voiceOn, onVoice }: { state: AccountState; online: boolean } & NotasVoice) {
  const { account, pending } = state;

  if (pending) {
    return (
      <p className="pc-wait" role="status">
        Pilo está revisando su cuenta…
      </p>
    );
  }

  if (!account || !canUseNotas(account)) {
    return (
      <section className="pc-sheet">
        <div className="pc-sheet__in">
          <p>
            {account
              ? account.status !== "activa"
                ? "Su cuenta de Pilo está suspendida. Escriba a la administración."
                : "Mis notas es para estudiantes: conecta a Pilo con su histórico de notas en Génesis."
              : "Mis notas es para estudiantes con cuenta de Pilo: conecta a Pilo con Génesis para ver su histórico de notas y cómo ha evolucionado."}
          </p>
          {!account && (
            <div className="pc-actions">
              <Link className="pa-btn pa-btn--line" to={APP_LOGIN}>
                Entrar
              </Link>
              <Link className="pa-btn pa-btn--main" to={APP_ACCOUNT}>
                Crear una cuenta
              </Link>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Otra cuenta en el mismo dispositivo empieza de cero. El nombre del saludo es el de la cuenta de Pilo.
  return <Notas key={account.id} owner={account.id} campus={account.campus} name={guideName(account)} online={online} voice={voice} voiceOn={voiceOn} onVoice={onVoice} />;
}

function Notas({
  owner,
  campus,
  name,
  online,
  voice,
  voiceOn,
  onVoice,
}: { owner: string; /** La sede de la cuenta de Pilo, para proponer su portal. */ campus: string; /** A quién saluda Pilo. */ name: string; online: boolean } & NotasVoice) {
  const [link, setLink] = useState<GenesisLink | null>(() => readLink(owner));
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(false);
  /** Mis notas no se puede usar todavía: el porqué. */
  const [off, setOff] = useState<string | null>(null);
  /** Un fallo que se dice donde esté la persona, con «Reintentar». */
  const [trouble, setTrouble] = useState<NotasFailure | null>(null);
  const [expired, setExpired] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  // Quien ya está conectado no repite la guía: va directo a sus notas.
  const [stage, setStage] = useState<"guia" | "notas">(() => (readLink(owner) ? "notas" : "guia"));
  const [moment, setMoment] = useState<Moment>(0);
  const [goals, setGoals] = useState<Goals | null>(() => readGoals(owner));
  /** Las metas mientras se mueven los controles; quedan al confirmar. */
  const [draft, setDraft] = useState<Goals | null>(null);

  const [granted, setGranted] = useState<{ keep: boolean } | null>(null);
  /** Las sedes en que se puede entrar; null mientras no se han leído. */
  const [sedes, setSedes] = useState<PortalList | null>(null);
  const [sedesTry, setSedesTry] = useState(0);
  const [portalId, setPortalId] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [errors, setErrors] = useState<{ sede?: string; user?: string; pass?: string }>({});
  const [connecting, setConnecting] = useState(false);

  const [tab, setTab] = useState<TabId>("historico");
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [advice, setAdvice] = useState<AdviceState>({ status: "reposo" });

  const root = useRef<HTMLDivElement>(null);
  const guideFace = useRef<PiloMojiHandle>(null);
  const guideHolder = useRef<HTMLDivElement>(null);
  const barHolder = useRef<HTMLDivElement>(null);
  const focusTo = useRef<"momento" | "pestanas" | "inicio" | "clave" | "sede" | null>(null);
  const tabList = useRef<HTMLDivElement>(null);
  const startHead = useRef<HTMLDivElement>(null);
  /** El último cambio de momento vino de un toque o un clic: se anima y suena. */
  const byHand = useRef(false);
  /** Qué acaba de cambiar con el dedo o el ratón, para animar solo eso. */
  const moved = useRef<"pestana" | "periodo" | null>(null);
  /** La línea de la gráfica ya se dibujó en esta conexión. */
  const drawn = useRef(false);
  /** De dónde despega Pilo: el sitio que ocupaba en la guía. */
  const flightFrom = useRef<DOMRect | null>(null);
  const request = useRef<AbortController | null>(null);
  const adviceRequest = useRef<AbortController | null>(null);
  /** Las recomendaciones entran animadas solo si se pidieron con el dedo o el ratón. */
  const adviceIn = useRef(false);
  const flightTimer = useRef(0);

  const script = useMemo(() => guideScript(name), [name]);
  const beat = script[moment];
  /** La voz de Pilo suena si existe para esta persona y el interruptor de la app está encendido. */
  const speaks = Boolean(voice?.advanced) && voiceOn;
  const voiceOptions = useMemo(() => (voice ? { portal: voice.portal, advanced: voice.advanced, rate: voice.rate, keep: true } : null), [voice]);

  useEffect(
    () => () => {
      request.current?.abort();
      adviceRequest.current?.abort();
      window.clearTimeout(flightTimer.current);
      stopOfficial();
    },
    [],
  );

  // El interruptor de sonido de la app manda también sobre el aleteo.
  useEffect(() => {
    setWingsOn(voiceOn);
    if (!voiceOn) stopOfficial();
  }, [voiceOn]);

  /** Lo que se borra con la conexión: el pedido en curso y las recomendaciones que hubiera. */
  const dropAdvice = useCallback(() => {
    adviceRequest.current?.abort();
    adviceIn.current = false;
    setAdvice({ status: "reposo" });
  }, []);

  /** Pasa a un momento de la guía. `hand`: vino de un toque o un clic (suena el aleteo y se anima). */
  const go = useCallback((next: Moment, hand: boolean) => {
    byHand.current = hand;
    if (hand && next > 0) wings(2);
    focusTo.current = "momento";
    setStage("guia");
    setMoment(next);
  }, []);

  /** Un fallo de la función, llevado al estado que le toca. */
  const fail = useCallback(
    (failure: NotasFailure, where: "conectar" | "leer") => {
      if (focusTo.current === "pestanas") focusTo.current = null;
      if (failure.view === "vencido") {
        clearLink();
        setLink(null);
        setHistory(null);
        setGranted(null);
        setExpired(true);
        setNote(null);
        drawn.current = false;
        dropAdvice();
        // Las metas siguen: son suyas, no del permiso. Vuelve al paso del permiso.
        byHand.current = false;
        setStage("guia");
        setMoment(1);
        focusTo.current = "inicio";
        return;
      }
      if (failure.view === "no_disponible") {
        setOff(failure.message);
        focusTo.current = "inicio";
        return;
      }
      if (failure.view === "sede") {
        // La sede elegida ya no está entre los portales: se lee la lista otra vez y se pide elegir.
        setPortalId("");
        setSedesTry((n) => n + 1);
        setErrors({ sede: failure.message });
        focusTo.current = "sede";
        return;
      }
      if (failure.view === "campo" && where === "conectar") {
        setErrors({ pass: failure.message });
        // El campo aún está deshabilitado: el foco llega cuando vuelva a estar disponible.
        focusTo.current = "clave";
        return;
      }
      setTrouble(failure);
    },
    [dropAdvice],
  );

  const fetchHistory = useCallback(
    async (permit: string) => {
      request.current?.abort();
      const ctl = new AbortController();
      request.current = ctl;
      setLoading(true);
      setTrouble(null);
      try {
        const next = await loadHistory(permit, ctl.signal);
        if (ctl.signal.aborted) return;
        setHistory(next);
        setPeriodId((current) => (current && next.periods.some((p) => p.id === current) ? current : (next.periods[next.periods.length - 1]?.id ?? null)));
        setOff(null);
        setLoading(false);
      } catch (error) {
        if (ctl.signal.aborted) return;
        setLoading(false);
        fail(asFailure(error), "leer");
      }
    },
    [fail],
  );

  // Con un permiso ya en el dispositivo (o en la memoria de la pestaña), se leen las notas al entrar.
  const permit = link?.permit;
  useEffect(() => {
    if (permit && online) void fetchHistory(permit);
  }, [permit, online, fetchHistory]);

  // Sin conectar, se leen las sedes: si Mis notas está apagada se dice de una vez, antes de pedir nada.
  useEffect(() => {
    if (permit || !online) return;
    const ctl = new AbortController();
    loadPortals(ctl.signal).then(
      (list) => {
        if (ctl.signal.aborted) return;
        setSedes(list);
        if (!list.on) return setOff(notasMessage("no_disponible"));
        // La elegida se respeta si sigue ahí; si no, la de la cuenta (o la única que haya).
        setPortalId((chosen) => (list.portals.some((p) => p.id === chosen) ? chosen : (pickPortal(list.portals, campus) ?? "")));
      },
      (error) => {
        if (!ctl.signal.aborted) fail(asFailure(error), "leer");
      },
    );
    return () => ctl.abort();
  }, [permit, online, sedesTry, campus, fail]);

  const periods = history?.periods ?? NO_PERIODS;
  const current = link?.head.period ?? "";
  const sums = useMemo(() => totals(periods), [periods]);
  const evo = useMemo(() => evolution(periods), [periods]);
  const lastAvg = useMemo(() => lastAverage(periods), [periods]);
  const graded = useMemo(() => gradedCredits(periods, current), [periods, current]);
  const seen = useMemo(() => findings(periods, link?.head), [periods, link?.head]);
  /** La cuenta de la meta de acumulado: aritmética del dispositivo. */
  const planFor = useCallback((goal: number) => goalPlan({ accumulated: sums.accumulated, graded, approved: sums.approved, percent: link?.head.creditsPercent ?? null, goal }), [sums.accumulated, sums.approved, graded, link?.head.creditsPercent]);

  // Ya llegaron sus datos: la guía pasa sola del paso de la cuenta al de las metas.
  const ready = Boolean(history);
  useEffect(() => {
    if (stage === "guia" && moment === 2 && ready && link) {
      setDraft((d) => d ?? goals ?? defaultGoals(sums.accumulated, lastAvg));
      setMoment(3);
      focusTo.current = "momento";
    }
  }, [stage, moment, ready, link, goals, sums.accumulated, lastAvg]);

  /* --- La voz de Pilo: el texto nunca la espera ------------------------------------------------ */

  // Al entrar a la guía y en cada momento: se pide por adelantado lo que viene y el saludo con el nombre.
  useEffect(() => {
    if (stage !== "guia" || !speaks || !voiceOptions) return;
    prefetchOfficial(voiceAhead(script, moment), voiceOptions);
  }, [stage, moment, speaks, voiceOptions, script]);

  // Cada momento se dice con la voz de Pilo, si la hay y está encendida. Si no llega, queda el texto.
  useEffect(() => {
    if (stage !== "guia") return;
    if (!speaks || !voiceOptions) return void stopOfficial();
    void sayOfficial(spoken(script[moment]), { ...voiceOptions, onSound: (on) => guideFace.current?.talk(on) }).catch(() => undefined);
    // El saludo del despegue sigue sonando mientras Pilo vuela a las notas: no se corta al cambiar de pantalla.
  }, [stage, moment, speaks, voiceOptions, script]);

  /* --- El foco sigue al estado ------------------------------------------------------------------ */

  useEffect(() => {
    const where = focusTo.current;
    if (!where) return;
    const el =
      where === "momento"
        ? root.current?.querySelector<HTMLElement>(".pnt-say strong")
        : where === "pestanas"
          ? tabList.current?.querySelector<HTMLElement>('[aria-selected="true"]')
          : where === "clave"
            ? document.getElementById("pnt-pass")
            : where === "sede"
              ? document.getElementById("pnt-sede")
              : startHead.current;
    if (!el || (el as HTMLInputElement).disabled) return;
    focusTo.current = null;
    el.focus({ preventScroll: false });
  });

  /* --- Movimiento ------------------------------------------------------------------------------- */

  // El momento que entra: la tarea sube con un desenfoque leve, Pilo hace un gesto y pasan las estelas.
  useLayoutEffect(() => {
    if (stage !== "guia" || !root.current) return;
    const hand = byHand.current;
    byHand.current = false;
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      // El texto se ilumina al ritmo de la voz, unas tres palabras por segundo; aparece de inmediato.
      gsap.fromTo(".pnt-caption span", { opacity: 0.45 }, { opacity: 1, duration: 0.2, ease: "none", stagger: 0.3, clearProps: "opacity" });
      if (!hand) return;
      gsap.fromTo(".pnt-step", { opacity: 0, y: 14, filter: "blur(5px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.34, ease: "expo.out", clearProps: "opacity,transform,filter" });
      gsap.fromTo(guideHolder.current, { y: 0, rotate: 0 }, { keyframes: [{ y: -9, rotate: -5, duration: 0.18 }, { y: 0, rotate: 0, duration: 0.4, ease: "bounce.out" }], clearProps: "transform" });
      if (moment > 0) gsap.fromTo(".pnt-streaks i", { xPercent: 0, opacity: 0 }, { xPercent: 460, opacity: 0.9, duration: 0.7, ease: "power2.in", stagger: 0.09, clearProps: "opacity,transform" });
    }, root);
    return () => ctx.revert();
  }, [stage, moment]);

  // El despegue: Pilo vuela, en arco, de donde estaba en la guía a la barra de las notas, y las notas suben a su encuentro.
  useLayoutEffect(() => {
    const from = flightFrom.current;
    if (stage !== "notas" || !from || !root.current) return;
    flightFrom.current = null;
    const to = barHolder.current?.getBoundingClientRect();
    if (reducedMotion() || !to || !to.width) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      // En x frena pronto y en y tarda en subir: el recorrido queda en arco, como un planeo.
      tl.fromTo(barHolder.current, { x: from.left - to.left, transformOrigin: "0 0" }, { x: 0, duration: 0.9, ease: "power3.out" }, 0);
      tl.fromTo(barHolder.current, { y: from.top - to.top, scale: from.width / to.width }, { y: 0, scale: 1, duration: 0.9, ease: "power2.inOut" }, 0);
      tl.fromTo(barHolder.current, { rotate: -14 }, { rotate: 0, duration: 0.9, ease: "power2.out", clearProps: "transform" }, 0);
      tl.fromTo("[data-in]", { opacity: 0, y: 22 }, { opacity: 1, y: 0, duration: 0.46, stagger: 0.07, clearProps: "opacity,transform" }, 0.3);
      tl.fromTo(".pnt-meter__fill", { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.7, clearProps: "transform" }, 0.5);
    }, root);
    return () => ctx.revert();
  }, [stage]);

  // Al cambiar de pestaña o de periodo con el dedo o el ratón, lo nuevo entra; con el teclado aparece en su sitio.
  useLayoutEffect(() => {
    const what = moved.current;
    moved.current = null;
    if (!what || reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      if (what === "pestana") gsap.fromTo(".pnt-panel", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.22, ease: "expo.out", clearProps: "opacity,transform" });
      else gsap.fromTo(".pnt-courses li", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.22, stagger: 0.03, ease: "expo.out", clearProps: "opacity,transform" });
    }, root);
    return () => ctx.revert();
  }, [tab, periodId]);

  // La gráfica se dibuja una sola vez por conexión: la primera vez que se abre «Mi evolución».
  useLayoutEffect(() => {
    if (stage !== "notas" || tab !== "evolucion" || !ready || drawn.current || !root.current) return;
    drawn.current = true;
    if (reducedMotion()) return;
    const ctx = gsap.context(() => {
      const line = root.current?.querySelector<SVGPathElement>(".pnt-line--avg");
      const length = line?.getTotalLength?.() ?? 0;
      const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
      // El acumulado y la meta aparecen primero, quietos: son el fondo contra el que se lee cada semestre.
      tl.fromTo(".pnt-line--acc, .pnt-goal-line", { opacity: 0 }, { opacity: 1, duration: 0.3, clearProps: "opacity" }, 0);
      if (line && length > 0) tl.fromTo(line, { strokeDasharray: length, strokeDashoffset: length }, { strokeDashoffset: 0, duration: 0.8, ease: "power1.inOut", clearProps: "strokeDasharray,strokeDashoffset" }, 0.1);
      tl.fromTo(".pnt-dot", { scale: 0.5, opacity: 0, transformOrigin: "50% 50%" }, { scale: 1, opacity: 1, duration: 0.22, stagger: 0.06, ease: "back.out(2)", clearProps: "opacity,transform" }, 0.14);
      tl.fromTo(".pnt-finds li", { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.05, ease: "expo.out", clearProps: "opacity,transform" }, 0.45);
    }, root);
    return () => ctx.revert();
  }, [stage, tab, ready]);

  // Las recomendaciones recién escritas entran una vez: suben con un desenfoque leve y las barras crecen desde su base.
  const adviceReady = advice.status === "listo";
  useLayoutEffect(() => {
    if (!adviceReady || !adviceIn.current) return;
    adviceIn.current = false;
    if (reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      tl.fromTo(".pnt-recs > li", { opacity: 0, y: 10, filter: "blur(4px)" }, { opacity: 1, y: 0, filter: "blur(0px)", duration: 0.32, stagger: 0.1, clearProps: "opacity,transform,filter" }, 0);
      tl.fromTo(".pnt-area__fill", { scaleX: 0, transformOrigin: "0% 50%" }, { scaleX: 1, duration: 0.6, stagger: 0.06, clearProps: "transform" }, 0.3);
    }, root);
    return () => ctx.revert();
  }, [adviceReady]);

  /* --- Lo que hace la persona -------------------------------------------------------------------- */

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (connecting || loading || !granted) return;
    const typed = user.trim();
    const problems = {
      sede: sedes?.portals.some((p) => p.id === portalId) ? undefined : sedes ? "Elija su sede." : "Aún no pude leer las sedes de Génesis. Intente de nuevo en un momento.",
      user: !typed ? "Escriba su usuario de Génesis." : /^\d{6,15}$/.test(typed) ? undefined : "El usuario de Génesis lleva solo números.",
      pass: pass ? undefined : "Escriba su contraseña de Génesis.",
    };
    setErrors(problems);
    if (problems.sede || problems.user || problems.pass) {
      if (problems.sede && !sedes) setSedesTry((n) => n + 1);
      document.getElementById(problems.sede ? "pnt-sede" : problems.user ? "pnt-user" : "pnt-pass")?.focus();
      return;
    }
    // Pilo lee Génesis: un aleteo y el planeo mientras tanto (el envío del formulario es un gesto).
    wings(2);
    glide(3);
    setConnecting(true);
    setTrouble(null);
    setNote(null);
    try {
      const out = await connectGenesis(portalId, typed, pass);
      const saved = saveLink(owner, out, granted.keep);
      // La contraseña y el usuario ya cumplieron: no quedan ni en el formulario.
      setPass("");
      setUser("");
      setExpired(false);
      setTab("historico");
      drawn.current = false;
      setLink(saved);
      setNote({
        tone: "ok",
        text: saved.kept
          ? "Conectado. La conexión queda guardada solo en este dispositivo."
          : granted.keep
            ? "Conectado. No se pudo guardar en este dispositivo: la conexión dura mientras esta pestaña esté abierta."
            : "Conectado solo por esta vez: al cerrar la pestaña, no queda nada guardado.",
      });
    } catch (error) {
      fail(asFailure(error), "conectar");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    request.current?.abort();
    window.clearTimeout(flightTimer.current);
    stopOfficial();
    // Con el permiso se van las metas: las dos cosas que este dispositivo guardaba.
    clearLink();
    clearGoals();
    setLink(null);
    setHistory(null);
    setGoals(null);
    setDraft(null);
    setGranted(null);
    setLoading(false);
    setTrouble(null);
    setOff(null);
    setExpired(false);
    setUser("");
    setPass("");
    setTab("historico");
    setPeriodId(null);
    setAsTable(false);
    drawn.current = false;
    dropAdvice();
    byHand.current = false;
    setStage("guia");
    setMoment(0);
    setNote({ tone: "ok", text: "Se desconectó. Se borraron de este dispositivo el permiso y sus metas." });
    focusTo.current = "inicio";
  };

  /** «Estas son mis metas»: se guardan en el dispositivo y Pilo despega hacia las notas. */
  const takeOff = (event: MouseEvent, chosen: Goals) => {
    saveGoals(owner, chosen);
    setGoals(chosen);
    setDraft(chosen);
    const hand = !fromKeyboard(event);
    go(4, hand);
    if (hand) {
      wings(3);
      glide(2.4);
    }
    window.clearTimeout(flightTimer.current);
    // Un momento para leer el saludo; después, a las notas. La voz sigue sonando en el vuelo.
    flightTimer.current = window.setTimeout(
      () => {
        flightFrom.current = hand ? (guideHolder.current?.getBoundingClientRect() ?? null) : null;
        setTab("historico");
        setStage("notas");
        focusTo.current = "pestanas";
      },
      reducedMotion() || !hand ? 1200 : 2200,
    );
  };

  /** «Cambiar»: vuelve al paso de las metas, con las de hoy puestas. */
  const editGoals = (event: MouseEvent) => {
    setDraft(goals ?? defaultGoals(sums.accumulated, lastAvg));
    go(3, !fromKeyboard(event));
  };

  /** El polígrafo oficial: llega de Génesis y se descarga aquí mismo; no se guarda en ningún otro lado. */
  const downloadPdf = async () => {
    if (!link || downloading) return;
    setDownloading(true);
    setNote(null);
    try {
      const blob = await loadPolygraphPdf(link.permit);
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = "poligrafo.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 15_000);
      setNote({ tone: "ok", text: "Se descargó su polígrafo en PDF, tal como lo entrega Génesis." });
    } catch (error) {
      const failure = asFailure(error);
      if (failure.view === "vencido" || failure.view === "no_disponible") fail(failure, "leer");
      else setNote({ tone: "bad", text: failure.message });
    } finally {
      setDownloading(false);
    }
  };

  /**
   * Pide las recomendaciones: es el único momento en que algo de las notas va a la IA, y va sin nombre, código
   * ni documento, con las dos metas. Lo que vuelve se queda en la memoria de esta pantalla.
   */
  const askAdvice = async (event: MouseEvent) => {
    if (!history || !link || advice.status === "pensando") return;
    const summary = adviceSummary(history.periods, link.head, goals);
    if (!summaryCourses(summary).length) return setAdvice({ status: "fallo", failure: adviceFailureOf("datos") });
    adviceRequest.current?.abort();
    const ctl = new AbortController();
    adviceRequest.current = ctl;
    adviceIn.current = !fromKeyboard(event);
    if (adviceIn.current) {
      // Pilo piensa: un aleteo y el planeo mientras tanto.
      wings(2);
      glide(4);
    }
    setAdvice({ status: "pensando", step: 0 });
    try {
      // El resumen ya está armado: lo que sigue es la espera de verdad.
      await Promise.resolve();
      if (ctl.signal.aborted) return;
      setAdvice({ status: "pensando", step: 1 });
      const got = await loadAdvice(summary, ctl.signal);
      if (ctl.signal.aborted) return;
      setAdvice({ status: "listo", advice: got, summary });
    } catch (error) {
      if (ctl.signal.aborted) return;
      adviceIn.current = false;
      setAdvice({ status: "fallo", failure: asAdviceFailure(error) });
    }
  };

  const pickTab = (next: TabId, pointer: boolean) => {
    if (next === tab) return;
    moved.current = pointer ? "pestana" : null;
    setTab(next);
  };

  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = TABS.findIndex((t) => t.id === tab);
    const to = e.key === "ArrowRight" ? (at + 1) % TABS.length : e.key === "ArrowLeft" ? (at - 1 + TABS.length) % TABS.length : e.key === "Home" ? 0 : e.key === "End" ? TABS.length - 1 : -1;
    if (to < 0) return;
    e.preventDefault();
    pickTab(TABS[to].id, false);
    tabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[to]?.focus();
  };

  const pickPeriod = (id: string, pointer: boolean) => {
    if (id === periodId) return;
    moved.current = pointer ? "periodo" : null;
    setPeriodId(id);
  };

  /* --- Piezas comunes ----------------------------------------------------------------------------- */

  const busy = connecting || loading;

  const live = (
    <div className="pc-live" aria-live="polite">
      {note && <Msg tone={note.tone}>{note.text}</Msg>}
    </div>
  );

  const offline = !online && (
    <div className="pc-confirm" role="status">
      <span>Estoy sin conexión. Necesito internet para leer sus notas en Génesis. {history ? "Lo que ve aquí es lo último que leí." : "Cuando vuelva la conexión, seguimos."}</span>
    </div>
  );

  const retry = trouble && (
    <div className="pc-confirm" role="alert">
      <span>{trouble.message}</span>
      {trouble.view === "cuenta" ? (
        <Link className="pc-chip" data-strong to={APP_LOGIN}>
          Entrar con mi cuenta de Pilo
        </Link>
      ) : link ? (
        <button type="button" className="pc-chip" data-strong disabled={!online || loading} onClick={() => void fetchHistory(link.permit)}>
          Reintentar
        </button>
      ) : (
        <button
          type="button"
          className="pc-chip"
          data-strong
          disabled={!online}
          onClick={() => {
            setTrouble(null);
            setSedesTry((n) => n + 1);
          }}
        >
          Reintentar
        </button>
      )}
    </div>
  );

  /** El interruptor de sonido de la app, a la mano: la voz de Pilo y el aleteo. */
  const sound = (
    <button
      type="button"
      className="pnt-chipbtn"
      aria-pressed={voiceOn}
      onClick={() => {
        const next = !voiceOn;
        setWingsOn(next);
        onVoice(next);
        // Al encenderlo, un aleteo: así se oye que quedó encendido.
        if (next) wings(1);
        else stopOfficial();
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z" />
        {voiceOn ? <path d="M15.5 9a4.2 4.2 0 0 1 0 6" /> : <path d="M16 9.5l5 5M21 9.5l-5 5" />}
      </svg>
      {voiceOn ? "Con sonido" : "Sin sonido"}
    </button>
  );

  /* Mis notas aún no está disponible. */
  if (off) {
    return (
      <div className="pcl pnt" ref={root}>
        <div ref={startHead} tabIndex={-1} className="pcl-start">
          <section className="pcl-card pcl-card--note">
            <div className="pcl-face">
              <Pilo size="100%" mood="duda" alive label="Mr. Pilo" />
            </div>
            <div>
              <h2>Mis notas aún no está disponible</h2>
              <p>{off}</p>
              <p className="pc-hint">No es algo que usted deba arreglar: depende de la administración de Génesis y de Pilo.</p>
              <div className="pcl-tools">
                <button type="button" className="pc-chip" data-strong disabled={!online} onClick={() => (link ? (setOff(null), void fetchHistory(link.permit)) : (setOff(null), setSedesTry((n) => n + 1)))}>
                  Intentar de nuevo
                </button>
                {link && (
                  <button type="button" className="pc-chip" onClick={disconnect}>
                    Desconectar
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
        {live}
      </div>
    );
  }

  /* --- La guía ------------------------------------------------------------------------------------ */

  if (stage === "guia") {
    const reading = connecting || (moment === 2 && Boolean(link) && !history);
    const goalsNow = draft ?? goals ?? defaultGoals(sums.accumulated, lastAvg);
    const lit = guideProgress(moment);
    return (
      <div className="pcl pnt" ref={root}>
        <div ref={startHead} tabIndex={-1} className="pcl-start">
          {expired && (
            <div className="pc-confirm" role="alert">
              <span>Su permiso de Génesis venció o fue retirado, y ya se borró de este dispositivo. Para seguir, autorice y conecte de nuevo.</span>
            </div>
          )}
          {offline}
        </div>

        <div className="pnt-guide">
          {/* Pilo y lo que dice: arriba en teléfono, a la izquierda en computador. */}
          <div className="pnt-scene">
            <div className="pnt-streaks" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <div className="pnt-scene__row">
              <div className="pnt-pilo" ref={guideHolder}>
                <Pilo ref={guideFace} size="100%" mood={reading ? "piensa" : beat.mood} alive label="Mr. Pilo" />
              </div>
              <div className="pnt-say">
                <strong tabIndex={-1}>{beat.title}</strong>
                {/* El texto está entero desde el primer instante; la voz lo alcanza. */}
                <p className="pnt-caption" aria-live="polite" key={moment}>
                  {captionWords(beat).map((word, i) => (
                    <span key={i}>{word} </span>
                  ))}
                </p>
              </div>
            </div>
            <div className="pnt-scene__foot">
              <span className="pnt-progress" role="img" aria-label={moment === 0 ? "Cuatro pasos por delante" : moment === 4 ? "Los cuatro pasos, listos" : `Paso ${moment} de 4`}>
                {lit.map((on, i) => (
                  <i key={i} data-on={on || moment === i + 1 || undefined} data-now={moment === i + 1 || undefined} />
                ))}
              </span>
              {sound}
            </div>
          </div>

          {/* La tarea del momento. */}
          <div className="pnt-task">
            {moment === 0 && (
              <div className="pnt-step">
                <h2>Así lo vamos a hacer</h2>
                <ol className="pnt-list">
                  {GUIDE_STEPS.map((text) => (
                    <li key={text}>{text}</li>
                  ))}
                </ol>
                <button type="button" className="pa-btn pa-btn--main" onClick={(e) => go(1, !fromKeyboard(e))}>
                  Empezar
                </button>
                <button type="button" className="pnt-link pnt-link--mid" onClick={(e) => go(1, !fromKeyboard(e))}>
                  Saltar la explicación
                </button>
              </div>
            )}

            {moment === 1 && (
              <div className="pnt-step">
                <DataConsent
                  platform="genesis"
                  className="pcl-consent"
                  onAuthorize={({ keep }) => {
                    setGranted({ keep });
                    setNote(null);
                    go(2, true);
                  }}
                />
                <button type="button" className="pnt-link pnt-link--mid" onClick={(e) => go(0, !fromKeyboard(e))}>
                  Volver a los cuatro pasos
                </button>
              </div>
            )}

            {moment === 2 && (
              <form className="pnt-step" onSubmit={(e) => void connect(e)} noValidate>
                <h2>Su cuenta de Génesis</h2>
                {!granted ? (
                  <>
                    <p className="pnt-muted">Primero necesito su permiso.</p>
                    <button type="button" className="pa-btn pa-btn--main" onClick={(e) => go(1, !fromKeyboard(e))}>
                      Ir al permiso
                    </button>
                  </>
                ) : (
                  <>
                    {/* La sede: Génesis tiene un portal por sede. Con uno solo no se pregunta. */}
                    {sedes && sedes.portals.length > 1 ? (
                      <Field id="pnt-sede" label="Sede" hint="Cada sede tiene su propio Génesis: entre al de la suya." error={errors.sede}>
                        {(aria) => (
                          <select
                            {...aria}
                            name="genesis-sede"
                            value={portalId}
                            disabled={reading}
                            onChange={(e) => {
                              setPortalId(e.target.value);
                              if (errors.sede) setErrors((x) => ({ ...x, sede: undefined }));
                            }}
                          >
                            {!portalId && <option value="">Elija su sede</option>}
                            {sedes.portals.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                              </option>
                            ))}
                          </select>
                        )}
                      </Field>
                    ) : sedes && sedes.portals.length === 1 ? (
                      <p className="pnt-muted">Entra al Génesis de {sedes.portals[0].name}.</p>
                    ) : null}
                    {errors.sede && !(sedes && sedes.portals.length > 1) && (
                      <Msg tone="bad" alert>
                        {errors.sede}
                      </Msg>
                    )}
                    <Field id="pnt-user" label="Usuario de Génesis" error={errors.user}>
                      {(aria) => (
                        <input
                          {...aria}
                          type="text"
                          name="genesis-usuario"
                          inputMode="numeric"
                          autoComplete="off"
                          autoCorrect="off"
                          spellCheck={false}
                          maxLength={15}
                          value={user}
                          disabled={reading}
                          onChange={(e) => {
                            setUser(e.target.value);
                            if (errors.user) setErrors((x) => ({ ...x, user: undefined }));
                          }}
                        />
                      )}
                    </Field>
                    <Field id="pnt-pass" label="Contraseña" error={errors.pass}>
                      {(aria) => (
                        <input
                          {...aria}
                          type="password"
                          name="genesis-clave"
                          autoComplete="off"
                          maxLength={200}
                          value={pass}
                          disabled={reading}
                          onChange={(e) => {
                            setPass(e.target.value);
                            if (errors.pass) setErrors((x) => ({ ...x, pass: undefined }));
                          }}
                        />
                      )}
                    </Field>
                    <p className="pnt-muted">Uso su contraseña una sola vez, para entrar. No la guardo: ni aquí ni en el servidor.</p>
                    {retry}
                    <button type="submit" className="pa-btn pa-btn--main" disabled={!online || reading}>
                      {reading ? "Leyendo su récord en Génesis…" : "Entrar"}
                    </button>
                    <div className="pa-sr" role="status">
                      {reading ? "Pilo está leyendo su récord en Génesis." : ""}
                    </div>
                    {!reading && (
                      <button
                        type="button"
                        className="pnt-link pnt-link--mid"
                        onClick={(e) => {
                          setGranted(null);
                          setPass("");
                          setErrors({});
                          go(1, !fromKeyboard(e));
                        }}
                      >
                        Volver al permiso
                      </button>
                    )}
                  </>
                )}
              </form>
            )}

            {moment === 3 && (
              <div className="pnt-step">
                <h2>Sus metas</h2>
                <GoalPick id="pnt-meta-acc" label="Promedio acumulado" value={goalsNow.accumulated} hint={goalHint(planFor(goalsNow.accumulated))} onChange={(v) => setDraft({ ...goalsNow, accumulated: v })} />
                <GoalPick id="pnt-meta-sem" label="Promedio de este semestre" value={goalsNow.semester} hint={semesterHint(lastAvg)} onChange={(v) => setDraft({ ...goalsNow, semester: v })} />
                <p className="pnt-origin">Sus metas se guardan solo en este dispositivo y se borran al desconectar. La cuenta es aproximada: lo que le falta sale de su avance en Génesis.</p>
                <button type="button" className="pa-btn pa-btn--main" onClick={(e) => takeOff(e, goalsNow)}>
                  Estas son mis metas
                </button>
              </div>
            )}

            {moment === 4 && (
              <div className="pnt-step">
                <p className="pnt-muted pnt-center" role="status">
                  Preparando sus notas…
                </p>
              </div>
            )}
          </div>
        </div>

        {live}
        {moment !== 2 && retry}
        <ul className="pc-hint pcl-notes">
          {PROMISES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    );
  }

  /* --- Las notas ---------------------------------------------------------------------------------- */

  if (!link) return null;
  const period = periods.find((p) => p.id === periodId) ?? periods[periods.length - 1] ?? null;
  const newestFirst = [...periods].reverse();
  const at = period ? periods.findIndex((p) => p.id === period.id) : -1;
  const accPlan = goals ? planFor(goals.accumulated) : null;

  return (
    <div className="pcl pnt" ref={root}>
      <div ref={startHead} tabIndex={-1} className="pcl-start">
        {offline}
        <header className="pnt-bar" aria-label={`Conectado a Génesis, sede ${link.portal.name}, solo lectura`}>
          <div className="pnt-bar__pilo" ref={barHolder}>
            <Pilo size="100%" mood={loading ? "piensa" : "feliz"} alive label="Mr. Pilo" />
          </div>
          <div className="pnt-bar__who">
            <strong>{name ? `Hola, ${name}` : "Sus notas"}</strong>
            <span>
              Génesis · {link.portal.name} · solo lectura{link.head.program ? ` · ${courseName(link.head.program)}` : ""}
            </span>
          </div>
          <div className="pnt-bar__tools">
            {sound}
            <button type="button" className="pnt-chipbtn" disabled={busy || !online} onClick={() => void fetchHistory(link.permit)}>
              {loading && history ? "Actualizando…" : "Actualizar"}
            </button>
            <button type="button" className="pnt-chipbtn" onClick={disconnect}>
              Desconectar
            </button>
          </div>
        </header>
      </div>

      {live}
      {retry}

      {!history ? (
        loading && (
          <div className="pnt-reading" role="status">
            <span>Pilo está leyendo su récord en Génesis</span>
            <span className="pnt-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </div>
        )
      ) : (
        <div className="pnt-body">
          {/* Las metas, siempre a la vista: a la izquierda en computador, arriba en teléfono. */}
          <aside className="pnt-rail" aria-label="Sus metas y sus totales">
            <section className="pnt-card pnt-metas" aria-labelledby="pnt-metas-h" data-in>
              <div className="pnt-metas__head">
                <h2 id="pnt-metas-h">Sus metas</h2>
                <button type="button" className="pnt-link" onClick={editGoals}>
                  {goals ? "Cambiar" : "Decir mis metas"}
                </button>
              </div>
              {goals && accPlan ? (
                <>
                  <Meter label="Acumulado" value={sums.accumulated} goal={goals.accumulated} line={accumulatedLine(accPlan, goals.accumulated)} />
                  <Meter label="Último semestre" value={lastAvg} goal={goals.semester} line={semesterLine(lastAvg, goals.semester)} />
                </>
              ) : (
                <p className="pnt-muted">Aún no me ha dicho sus metas. Con ellas le digo cuánto necesita promediar.</p>
              )}
            </section>
            <dl className="pnt-totals" data-in>
              <div>
                <dt>Créditos aprobados</dt>
                <dd>{sums.approved}</dd>
              </div>
              <div>
                <dt>Avance del plan</dt>
                <dd>{link.head.creditsPercent === null ? "—" : `${nota(link.head.creditsPercent).replace(/,0$/, "")} %`}</dd>
              </div>
              <div>
                <dt>{sums.periods === 1 ? "Periodo cursado" : "Periodos cursados"}</dt>
                <dd>{sums.periods}</dd>
              </div>
            </dl>
          </aside>

          <div className="pnt-main">
            <div className="pnt-tabs" role="tablist" aria-label="Mis notas" ref={tabList} onKeyDown={onTabKey} data-in>
              {TABS.map((t) => (
                <button key={t.id} type="button" role="tab" id={`pnt-tab-${t.id}`} aria-selected={t.id === tab} aria-controls={`pnt-panel-${t.id}`} tabIndex={t.id === tab ? 0 : -1} onClick={(e) => pickTab(t.id, !fromKeyboard(e))}>
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "historico" && (
              <div className="pnt-panel" role="tabpanel" id="pnt-panel-historico" aria-labelledby="pnt-tab-historico" tabIndex={0}>
                {periods.length === 0 || !period ? (
                  <p className="pcl-empty">Génesis no muestra periodos en su polígrafo todavía. Cuando tenga notas definitivas, aparecerán aquí.</p>
                ) : (
                  <>
                    {/* El selector de periodo: fijo arriba, siempre alcanzable. Nunca una fila que se desplace a lo ancho. */}
                    <div className="pnt-picker" data-in>
                      <div className="pnt-stepper">
                        <button type="button" aria-label="Periodo anterior" disabled={at <= 0} onClick={(e) => at > 0 && pickPeriod(periods[at - 1].id, !fromKeyboard(e))}>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m14.5 6-6 6 6 6" />
                          </svg>
                        </button>
                        <select aria-label="Periodo" value={period.id} onChange={(e) => pickPeriod(e.target.value, false)}>
                          {newestFirst.map((p, i) => (
                            <option key={p.id} value={p.id}>
                              {i === 0 ? `${p.id} · último` : p.id}
                            </option>
                          ))}
                        </select>
                        <button type="button" aria-label="Periodo siguiente" disabled={at < 0 || at >= periods.length - 1} onClick={(e) => at < periods.length - 1 && pickPeriod(periods[at + 1].id, !fromKeyboard(e))}>
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="m9.5 6 6 6-6 6" />
                          </svg>
                        </button>
                      </div>
                      {/* En computador, además, todos los periodos a la vista, en las filas que hagan falta. */}
                      <div className="pnt-periods" role="group" aria-label="Todos los periodos">
                        {newestFirst.map((p, i) => (
                          <button key={p.id} type="button" aria-pressed={p.id === period.id} onClick={(e) => pickPeriod(p.id, !fromKeyboard(e))}>
                            {i === 0 ? `${p.id} · último` : p.id}
                          </button>
                        ))}
                      </div>
                    </div>
                    <section className="pnt-card" aria-labelledby="pnt-periodo-h" data-in>
                      <div className="pnt-period-head">
                        <h2 id="pnt-periodo-h">{period.id}</h2>
                        <span className="pnt-muted">{periodLine(period)}</span>
                      </div>
                      {period.courses.length === 0 ? (
                        <p className="pnt-muted">Génesis no trae materias en este periodo.</p>
                      ) : (
                        <ul className="pnt-courses">
                          {period.courses.map((c, i) => {
                            const pending = inProgress(period, c, current);
                            const state = courseState(c, pending);
                            return (
                              // Sin códigos: de la materia se muestra su nombre y nada que la identifique por dentro.
                              <li key={i}>
                                <span className="pnt-course__name">{courseName(c.name) || "Materia sin nombre"}</span>
                                <span className="pnt-course__def">{pending ? "—" : nota(c.def)}</span>
                                <span className="pnt-course__meta">
                                  {c.credits > 0 && (
                                    <span>
                                      {c.credits} {c.credits === 1 ? "crédito" : "créditos"}
                                    </span>
                                  )}
                                  {c.min !== null && !pending && <span>Se aprueba con {nota(c.min)}</span>}
                                  <span className="pnt-state" data-s={state}>
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                      {STATE_GLYPH[state]}
                                    </svg>
                                    {STATE_LABEL[state]}
                                  </span>
                                </span>
                              </li>
                            );
                          })}
                        </ul>
                      )}
                      {!settled(period) && period.courses.length > 0 && <p className="pnt-muted">Este periodo aún no tiene definitivas en Génesis.</p>}
                    </section>
                    {!history.record && <p className="pc-hint">Génesis no dejó leer el récord de notas: se muestra el polígrafo, sin la nota mínima de cada materia.</p>}
                    <div className="pnt-pdf" data-in>
                      <button type="button" className="pc-chip" data-strong disabled={downloading || !online} onClick={() => void downloadPdf()}>
                        <svg viewBox="0 0 24 24" aria-hidden="true">
                          <path d="M7 3.5h7l4 4v13H7z" />
                          <path d="M14 3.5v4h4M12 11v6M9.5 14.5 12 17l2.5-2.5" />
                        </svg>
                        {downloading ? "Pidiendo el polígrafo…" : "Descargar mi polígrafo (PDF)"}
                      </button>
                      <span className="pnt-muted">El oficial, tal como lo entrega Génesis.</span>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === "evolucion" && (
              <div className="pnt-panel pnt-panel--two" role="tabpanel" id="pnt-panel-evolucion" aria-labelledby="pnt-tab-evolucion" tabIndex={0}>
                {evo.filter((r) => r.avg !== null || r.acc !== null).length === 0 ? (
                  <p className="pcl-empty pnt-span">Todavía no hay promedios que mostrar: aparecerán cuando Génesis tenga su primer periodo con definitivas.</p>
                ) : (
                  <>
                    <section className="pnt-card pnt-span" aria-labelledby="pnt-evo-h">
                      <h2 id="pnt-evo-h">Su promedio, periodo a periodo</h2>
                      <ul className="pnt-legend" aria-label="Series de la gráfica">
                        <li>
                          <svg width="26" height="10" aria-hidden="true">
                            <path className="pnt-line pnt-key--avg" d="M1 5h24" strokeWidth="2.5" />
                            <circle className="pnt-key-dot" cx="13" cy="5" r="3.5" />
                          </svg>
                          Promedio del semestre
                        </li>
                        <li>
                          <svg width="26" height="10" aria-hidden="true">
                            <path className="pnt-line pnt-key--acc" d="M1 5h24" strokeWidth="2.5" />
                          </svg>
                          Promedio acumulado
                        </li>
                        {goals && (
                          <li>
                            <svg width="26" height="10" aria-hidden="true">
                              <path className="pnt-goal-key" d="M1 5h24" />
                            </svg>
                            Su meta de acumulado
                          </li>
                        )}
                      </ul>
                      <EvoChart rows={evo} goal={goals?.accumulated ?? null} />
                      <button type="button" className="pnt-link" aria-expanded={asTable} aria-controls="pnt-evo-tabla" onClick={() => setAsTable((v) => !v)}>
                        {asTable ? "Ocultar la tabla" : "Ver como tabla"}
                      </button>
                      <div className="pnt-scroll" id="pnt-evo-tabla" hidden={!asTable}>
                        {asTable && <EvoTable rows={evo} goal={goals?.accumulated ?? null} />}
                      </div>
                    </section>

                    <section className="pnt-card" aria-labelledby="pnt-veo-h">
                      <h2 id="pnt-veo-h">Lo que veo en su récord</h2>
                      <FindingList items={seen} />
                      <p className="pnt-origin">Calculado en su dispositivo con las notas de su polígrafo.</p>
                    </section>

                    <AdviceCard state={advice} enabled={history.advice} online={online} hasGoals={Boolean(goals)} onAsk={(e) => void askAdvice(e)} />

                    {advice.status === "listo" && <AreasCard summary={advice.summary} advice={advice.advice} accumulated={sums.accumulated} />}
                  </>
                )}
              </div>
            )}

            {tab === "semestre" && (
              <div className="pnt-panel" role="tabpanel" id="pnt-panel-semestre" aria-labelledby="pnt-tab-semestre" tabIndex={0}>
                <section className="pnt-card pnt-soon" aria-labelledby="pnt-sem-h">
                  <span className="pnt-badge">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M12 7v6M12 17h.01M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                    </svg>
                    En construcción
                  </span>
                  <h2 id="pnt-sem-h">Mi semestre con Pilo</h2>
                  <p className="pnt-muted">Aquí verá sus notas de P1, P2 y P3 y cuánto necesita en cada corte para llegar a su meta del semestre. Todavía no está disponible.</p>
                  <div className="pnt-cuts" aria-hidden="true">
                    {["P1", "P2", "P3"].map((cut) => (
                      <div key={cut}>
                        <b>{cut}</b>
                        <i />
                        <i />
                      </div>
                    ))}
                  </div>
                  <p className="pnt-muted">Vista previa, sin datos.</p>
                </section>
              </div>
            )}
          </div>
        </div>
      )}

      <ul className="pc-hint pcl-notes">
        {PROMISES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

/* --- Las metas ------------------------------------------------------------------------------------ */

/** Un control de meta: un promedio de 3,0 a 5,0, de décima en décima, que dice al moverlo qué significa. */
function GoalPick({ id, label, value, hint, onChange }: { id: string; label: string; value: number; hint: string; onChange: (value: number) => void }) {
  return (
    <div className="pnt-goal">
      <div className="pnt-goal__top">
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id}>{nota(value)}</output>
      </div>
      <input id={id} type="range" min={GOAL.min} max={GOAL.max} step={GOAL.step} value={value} aria-valuetext={nota(value)} aria-describedby={`${id}-d`} onChange={(e) => onChange(Math.round(Number(e.target.value) * 10) / 10)} />
      <p className="pnt-muted" id={`${id}-d`} role="status">
        {hint}
      </p>
    </div>
  );
}

/**
 * Una meta a la vista: dónde va (la barra y su valor escrito), la meta marcada con una raya y su palabra, y la
 * frase de lo que necesita. El eje va de 3,0 a 5,0. Nada se dice solo con color.
 */
function Meter({ label, value, goal, line }: { label: string; value: number | null; goal: number; line: string }) {
  return (
    <div className="pnt-meter">
      <div className="pnt-meter__top">
        <span>{label}</span>
        <b>{nota(value)}</b>
      </div>
      <div className="pnt-meter__track" aria-hidden="true">
        <i className="pnt-meter__fill" style={{ width: `${meterPct(value)}%` }} />
        <u style={{ left: `${meterPct(goal)}%` }} />
      </div>
      <p>{line}</p>
    </div>
  );
}

/* --- La gráfica ---------------------------------------------------------------------------------- */

/**
 * Dos series en un solo eje: el promedio del semestre (continua, con puntos) y el acumulado (punteada), y la
 * meta de acumulado como una raya fina con su nombre. La guía de 3,0 dice con cuánto se aprueba. Al pasar o
 * tocar, una cruz y una etiqueta con los dos valores del periodo. La tabla («Ver como tabla») es la misma
 * información para quien no ve la gráfica.
 */
function EvoChart({ rows, goal }: { rows: EvoRow[]; goal: number | null }) {
  const { W, H, L, R, T, B } = CHART;
  const shape = useMemo(() => chartOf(rows, goal), [rows, goal]);
  const [at, setAt] = useState<number | null>(null);
  const svg = useRef<SVGSVGElement>(null);

  const point = (e: PointerEvent<SVGRectElement>) => {
    const box = svg.current?.getBoundingClientRect();
    if (!box || !box.width) return;
    setAt(nearestIndex(((e.clientX - box.left) / box.width) * W, rows.length));
  };

  const passAt = shape.grid.find((g) => g.value === PASS_MARK)?.y;
  const row = at === null ? null : rows[at];
  const count = `${rows.length} ${rows.length === 1 ? "periodo" : "periodos"}`;

  return (
    <div className="pnt-chart">
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Promedio del semestre y promedio acumulado en ${count}${goal !== null ? `, con su meta de acumulado en ${nota(goal)}` : ""}. La tabla trae los valores.`}>
        {shape.grid.map((g) => (
          <g key={g.value}>
            <line className="pnt-grid" data-pass={g.value === PASS_MARK || undefined} x1={L} x2={W - R} y1={g.y} y2={g.y} />
            <text x={L - 6} y={g.y + 4} textAnchor="end">
              {nota(g.value)}
            </text>
          </g>
        ))}
        {passAt !== undefined && (
          <text x={W - R} y={passAt - 5} textAnchor="end">
            se aprueba con {nota(PASS_MARK)}
          </text>
        )}
        {shape.goal !== null && goal !== null && (
          <g className="pnt-goal-line">
            <line x1={L} x2={W - R} y1={shape.goal} y2={shape.goal} />
            <text x={L + 4} y={shape.goal - 5}>
              su meta: {nota(goal)}
            </text>
          </g>
        )}
        {shape.ticks.map((t) => (
          <text key={t.index} x={t.x} y={H - 6} textAnchor={t.anchor}>
            {t.label}
          </text>
        ))}
        <path className="pnt-line pnt-line--acc" d={shape.pathAcc} />
        <path className="pnt-line pnt-line--avg" d={shape.pathAvg} />
        {shape.avg.map((y, i) => (y === null ? null : <circle key={rows[i].id} className="pnt-dot" cx={shape.xs[i]} cy={y} r={4} />))}
        {at !== null && <line className="pnt-cross" x1={shape.xs[at]} x2={shape.xs[at]} y1={T} y2={H - B} />}
        <rect className="pnt-hit" x={L - 8} y={T} width={W - L - R + 16} height={H - T - B} onPointerMove={point} onPointerDown={point} onPointerLeave={() => setAt(null)} />
      </svg>
      {row && at !== null && (
        <div className="pnt-tip" style={{ left: `clamp(64px, ${(shape.xs[at] / W) * 100}%, calc(100% - 64px))` }} aria-hidden="true">
          <b>{row.id}</b>
          Semestre {nota(row.avg)}
          <br />
          Acumulado {nota(row.acc)}
        </div>
      )}
    </div>
  );
}

function EvoTable({ rows, goal }: { rows: EvoRow[]; goal: number | null }) {
  return (
    <table className="pnt-table">
      <caption className={goal === null ? "pa-sr" : undefined}>{goal === null ? "Promedio del semestre y promedio acumulado por periodo" : `Su meta de acumulado: ${nota(goal)}`}</caption>
      <thead>
        <tr>
          <th scope="col">Periodo</th>
          <th scope="col">Semestre</th>
          <th scope="col">Acumulado</th>
          <th scope="col">Créditos</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id}>
            <th scope="row">{r.id}</th>
            <td>{nota(r.avg)}</td>
            <td>{nota(r.acc)}</td>
            <td>{r.credits || "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function FindingList({ items }: { items: Finding[] }) {
  if (!items.length) return <p className="pnt-muted">Con lo que hay en su polígrafo todavía no hay nada que señalar.</p>;
  return (
    <ul className="pnt-finds">
      {items.map((f) => (
        <li key={f.id}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 17l5-5 4 3 7-8" />
            <path d="M15 7h5v5" />
          </svg>
          <span>{f.text}</span>
        </li>
      ))}
    </ul>
  );
}

/* --- Lo que le recomiendo -------------------------------------------------------------------------- */

/**
 * Las recomendaciones, escritas aquí mismo. En reposo, el botón y qué se envía; pensando, los pasos reales;
 * con resultado, cada recomendación con su porqué, su acción y sus fuentes —o dicho con palabras que es
 * general, sin documento de la universidad—; y el error, con reintento, o el tope del día.
 */
function AdviceCard({ state, enabled, online, hasGoals, onAsk }: { state: AdviceState; enabled: boolean; online: boolean; hasGoals: boolean; onAsk: (event: MouseEvent) => void }) {
  return (
    <section className="pnt-card" aria-labelledby="pnt-rec-h">
      <h2 id="pnt-rec-h">Lo que le recomiendo</h2>

      {state.status === "reposo" &&
        (enabled ? (
          <>
            <p className="pnt-muted">
              Le envío a la IA un resumen de sus notas{hasGoals ? " y sus metas" : ""}, sin su nombre ni su código, y busco en los documentos de la universidad. No se guarda.
            </p>
            <div className="pcl-tools">
              <button type="button" className="pa-btn pa-btn--main" disabled={!online} onClick={onAsk}>
                Pedirle recomendaciones a Pilo
              </button>
            </div>
            <p className="pnt-origin">Viajan su programa, sus periodos, sus materias con créditos y definitivas{hasGoals ? ", y sus dos metas" : ""}. Solo al pulsar el botón.</p>
          </>
        ) : (
          <p className="pnt-muted">La universidad aún no ha habilitado las recomendaciones con IA en Mis notas. Lo demás sí es suyo desde ya: se calcula en su dispositivo.</p>
        ))}

      {state.status === "pensando" && (
        <div className="pnt-think" role="status">
          <span className="pnt-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <ol>
            {ADVICE_STEPS.map((text, i) => (
              <li key={text} data-s={i < state.step ? "hecho" : i === state.step ? "ahora" : "falta"}>
                {i < state.step ? Icon.check : <span aria-hidden="true">{i + 1}.</span>}
                <span>
                  {text}
                  {i < state.step ? " · listo" : i === state.step ? "…" : ""}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {state.status === "fallo" && (
        <div className="pc-confirm" role="alert">
          <span>{state.failure.message}</span>
          {state.failure.retry && (
            <button type="button" className="pc-chip" data-strong disabled={!online} onClick={onAsk}>
              Reintentar
            </button>
          )}
        </div>
      )}

      {state.status === "listo" && (
        <>
          <ol className="pnt-recs" aria-label="Recomendaciones de Pilo">
            {state.advice.recs.map((rec, i) => (
              <li key={`${i}-${rec.title}`}>
                <h3>{rec.title}</h3>
                {rec.why && <p>{rec.why}</p>}
                {rec.action && (
                  <p>
                    <b>Qué hacer: </b>
                    {rec.action}
                  </p>
                )}
                {rec.grounded ? (
                  <p className="pnt-rec__src">
                    <span>{rec.sources.length === 1 ? "Fuente:" : "Fuentes:"}</span>
                    {rec.sources.map((n) => {
                      const source = state.advice.sources.find((x) => x.n === n);
                      if (!source) return null;
                      const label = [source.title, source.section].filter(Boolean).join(" › ");
                      return source.path.startsWith("/") ? (
                        <Link key={n} to={source.path}>
                          {label}
                        </Link>
                      ) : source.path ? (
                        <a key={n} href={source.path} target="_blank" rel="noopener noreferrer">
                          {label}
                        </a>
                      ) : (
                        <span key={n}>{label}</span>
                      );
                    })}
                  </p>
                ) : (
                  <p className="pnt-rec__general">
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <circle cx="12" cy="12" r="8.5" />
                      <path d="M12 11v5M12 8h.01" />
                    </svg>
                    Recomendación general, sin documento de la universidad
                  </p>
                )}
              </li>
            ))}
          </ol>
          <p className="pnt-origin">
            Redactado por Pilo con IA, con documentos de Pilo en Enseñanza y un resumen de sus notas sin su nombre ni su código. Verifique lo que le diga: puede equivocarse. No se guarda: al
            salir de esta pantalla, se borra.
          </p>
          <div className="pcl-tools">
            <button type="button" className="pc-chip" disabled={!online} onClick={onAsk}>
              Pedirlas de nuevo
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * Fortalezas y áreas por reforzar: una barra por área con su promedio ponderado por créditos, de mayor a menor,
 * en un solo eje de 0 a 5 con la guía en 3,0. El valor va escrito junto a cada barra y el estado se dice con
 * glifo y palabra. Las áreas las agrupó la IA; los promedios son de las notas (areaBars). Sin áreas, no hay
 * tarjeta: no se inventan.
 */
function AreasCard({ summary, advice, accumulated }: { summary: AdviceSummary; advice: Advice; accumulated: number | null }) {
  const bars: AreaBar[] = useMemo(() => areaBars(summary, advice.areas, accumulated), [summary, advice, accumulated]);
  const [asTable, setAsTable] = useState(false);
  if (!bars.length) return null;
  return (
    <section className="pnt-card pnt-areas" aria-labelledby="pnt-areas-h">
      <h2 id="pnt-areas-h">Fortalezas y áreas por reforzar</h2>
      <ul aria-label="Promedio por área, de mayor a menor">
        {bars.map((b) => (
          <li key={b.name}>
            <span className="pnt-area__name">{b.name}</span>
            <span className="pnt-area__val">{nota(b.avg)}</span>
            <span className="pnt-area__track" aria-hidden="true">
              <i className="pnt-area__fill" data-strong={b.strong || undefined} style={{ width: `${Math.max(0, Math.min(100, (b.avg / 5) * 100))}%` }} />
            </span>
            <span className="pnt-area__state">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {b.strong ? <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" /> : <path d="M12 5v13M6.5 12.5 12 18l5.5-5.5" />}
              </svg>
              {b.strong ? "Fortaleza" : "Por reforzar"} · {b.count} {b.count === 1 ? "materia" : "materias"}
            </span>
          </li>
        ))}
      </ul>
      <p className="pnt-origin">
        Pilo agrupa las materias; el promedio de cada área sale de sus notas, ponderado por créditos y calculado en su dispositivo. La raya marca {nota(PASS_MARK)}: con eso se aprueba.
        «Fortaleza» es ir en su promedio acumulado o por encima.
      </p>
      <button type="button" className="pnt-link" aria-expanded={asTable} aria-controls="pnt-areas-tabla" onClick={() => setAsTable((v) => !v)}>
        {asTable ? "Ocultar la tabla" : "Ver como tabla"}
      </button>
      <div className="pnt-scroll" id="pnt-areas-tabla" hidden={!asTable}>
        {asTable && (
          <table className="pnt-table">
            <caption className="pa-sr">Promedio ponderado por créditos de cada área</caption>
            <thead>
              <tr>
                <th scope="col">Área</th>
                <th scope="col">Promedio</th>
                <th scope="col">Materias</th>
                <th scope="col">Créditos</th>
                <th scope="col">Estado</th>
              </tr>
            </thead>
            <tbody>
              {bars.map((b) => (
                <tr key={b.name}>
                  <th scope="row">{b.name}</th>
                  <td>{nota(b.avg)}</td>
                  <td>{b.count}</td>
                  <td>{b.credits}</td>
                  <td>{b.strong ? "Fortaleza" : "Por reforzar"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
