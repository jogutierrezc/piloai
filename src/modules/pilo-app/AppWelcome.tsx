/* =============================================================================
   Mr. Pilo · la app móvil · la bienvenida.

   La de Pregúntele a Pilo (Welcome.tsx), a la medida del teléfono y para los
   dos Pilos a la vez: luz y anillos crecen, Pilo salta a escena, se sorprende
   y mira a los lados; el título llega letra por letra y cada frase palabra por
   palabra mientras habla. Al final pregunta con cuál Pilo se quiere hablar, y
   Pilo en Enseñanza pregunta además quién habla. La salida: el escenario se
   cierra en círculo sobre la cabecera mientras Pilo vuela hasta ella.

   La voz es la oficial o ninguna (official-voice.ts). Se pide por adelantado
   y se guarda en el teléfono; suena solo después de un toque, que es cuando
   el teléfono deja; el pico se mueve mientras suena el audio de verdad. Sin
   voz, el pico acompaña a las palabras mientras aparecen.

   La guía son cinco momentos en el teléfono con cuenta obligatoria (hola, una
   pregunta de ejemplo que se toca, la fuente, con cuál Pilo y la cuenta): se
   avanza con «Siguiente», con «Atrás» o deslizando. «Saltar guía» lleva a la
   cuenta, que no se salta. La pregunta de ejemplo es un ejemplo (lleva la marca)
   con respuestas verdaderas de PRODUCT.md, nunca datos inventados.

   Movimiento: transform y opacidad, y clip-path solo para el cierre. Cada
   animación se monta en un contexto de GSAP que, al interrumpirse (otra frase,
   Saltar, desmontaje), devuelve todo a su estado visible: ningún texto queda
   oculto. Con movimiento reducido, solo fundidos.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import gsap from "gsap";
import { Pilo } from "../pregunta/Pilo";
import type { PiloMojiHandle } from "../pregunta/Pilo";
import { RolePicker } from "../pregunta/RolePicker";
import type { Rol, SpaceId } from "../pregunta/space";
import type { AppVoice } from "./access";
import { APP_PILOS, APP_SPACES } from "./routes";
import { APP_KNOWS, APP_TITLE, ROLE_BEAT, WELCOME_EXAMPLES, voiceRequest, welcomeBeats, welcomeVoicePlan } from "./welcome-script";
import { keepOnlyVoices, prefetchOfficial, sayOfficial, stopOfficial } from "./official-voice";
import { useFocusTrap } from "./Layer";
import { reducedMotion } from "./pwa";
import { tr, useLang, localizeDeep, LangSwitch } from "../../components/pilo/i18n";

/** Ya hubo un toque o una tecla en esta página: el teléfono deja sonar. */
const touched = () => typeof navigator !== "undefined" && Boolean((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive);

const VoiceIcon = ({ on }: { on: boolean }) => (
  <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M3 8v4h3l4 3V5L6 8H3z" />
    {on ? <path d="M13 7.5a3.5 3.5 0 010 5M15.5 5a7 7 0 010 10" /> : <path d="M13.5 8l4 4M17.5 8l-4 4" />}
  </svg>
);

const DocIcon = () => (
  <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
    <path d="M5 3.5h7l3 3v10H5zM12 3.5v3h3M7.5 10h5M7.5 13h5" />
  </svg>
);

/** La respuesta de ejemplo: marcada «Ejemplo», palabra por palabra, con su fuente. */
function ExampleAnswer({ id }: { id: string }) {
  const q = WELCOME_EXAMPLES.find((e) => e.id === id);
  if (!q) return null;
  const text = tr(q.a);
  return (
    <div className="pa-ex">
      <span className="pa-ex-tag">{tr("Ejemplo")}</span>
      <p className="pa-sr">{text}</p>
      <p aria-hidden="true">
        {text.split(" ").map((w, i) => (
          <span key={`${id}:${i}`} className="wd">
            {w}{" "}
          </span>
        ))}
      </p>
      <span className="pa-ex-src pa-srcchip">
        <DocIcon />
        {tr(q.source)}
      </span>
    </div>
  );
}

export function AppWelcome({
  target,
  voice,
  voiceOn,
  onVoice,
  asksRol,
  fallback,
  onChoose,
  onRol,
  onDone,
  desktop = false,
  native = false,
  needsAccount = false,
  onAccount,
}: {
  /** El lugar de Pilo en la cabecera: hasta ahí vuela al salir. */
  target: RefObject<HTMLElement>;
  /** La voz oficial con que se presenta; null si no está disponible (queda el texto). */
  voice: AppVoice | null;
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
  /** ¿Ese Pilo pregunta quién habla, y aún no se le ha dicho? */
  asksRol: (space: SpaceId) => boolean;
  /** El Pilo que se abre si se salta la bienvenida. */
  fallback: SpaceId;
  onChoose: (space: SpaceId) => void;
  onRol: (rol: Rol) => void;
  onDone: () => void;
  /** La app de escritorio (desktop.ts): Pilo se presenta para el computador. */
  desktop?: boolean;
  /** La app de Android (native.ts): Pilo se presenta en el teléfono y pide la cuenta, que allí es obligatoria. */
  native?: boolean;
  /** En el escritorio y sin haber entrado: al final Pilo pide la cuenta en vez de elegir Pilo. */
  needsAccount?: boolean;
  /** Crear la cuenta o entrar con ella, desde la última parte. */
  onAccount?: (way: "registro" | "ingreso") => void;
}) {
  useLang();
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const pilo = useRef<PiloMojiHandle>(null);
  const hold = useRef<gsap.core.Tween | null>(null);
  const intro = useRef<gsap.core.Timeline | null>(null);
  const leaving = useRef(false);
  const [beat, setBeat] = useState(-1);
  const [asking, setAsking] = useState(false);
  const [armed, setArmed] = useState(touched);
  const [silent, setSilent] = useState(false);
  /** La pregunta de ejemplo tocada (momento 2) y el Pilo elegido (momento 4). */
  const [example, setExample] = useState<string | null>(null);
  const [chosen, setChosen] = useState<SpaceId | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const beats = useMemo(() => welcomeBeats({ desktop, native, account: needsAccount }), [desktop, native, needsAccount]);
  const current = asking ? localizeDeep(ROLE_BEAT) : beat >= 0 ? beats[beat] : null;
  // Habla si hay voz oficial, está encendida, ya hubo un toque y el servicio no ha fallado.
  const speaks = Boolean(voice) && voiceOn && armed && !silent;

  /* El audio de la presentación se pide por adelantado y se guarda en el teléfono. */
  const plan = useMemo(() => welcomeVoicePlan(voice, { askRol: !needsAccount && APP_SPACES.some(asksRol), beats }), [voice, asksRol, beats, needsAccount]);
  useEffect(() => {
    if (!voice || !voiceOn || !plan.length) return;
    prefetchOfficial(plan.map((r) => r.text), { portal: voice.portal, advanced: voice.advanced, keep: true });
    void keepOnlyVoices(plan.map((r) => r.key));
  }, [voice, voiceOn, plan]);

  /* El primer toque (o tecla) estrena el audio: desde ahí Pilo puede sonar. */
  useEffect(() => {
    if (armed) return;
    const arm = () => setArmed(true);
    // Al soltar, no al tocar: si el toque fue en «Siguiente», la frase que suena es ya la nueva.
    window.addEventListener("pointerup", arm, { once: true });
    window.addEventListener("keyup", arm, { once: true });
    return () => {
      window.removeEventListener("pointerup", arm);
      window.removeEventListener("keyup", arm);
    };
  }, [armed]);

  /* La entrada. */
  useLayoutEffect(() => {
    const root = stage.current!;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.from(root, { autoAlpha: 0, duration: 0.3 });
        gsap.delayedCall(0.4, () => setBeat(0));
        return;
      }
      intro.current = gsap
        .timeline()
        .from(".pa-w-glow", { scale: 0.4, autoAlpha: 0, duration: 1.2, ease: "power2.out" }, 0)
        .from(".pa-w-rings i", { scale: 0.6, autoAlpha: 0, duration: 1.1, stagger: 0.12, ease: "power3.out" }, 0.1)
        .from(holder.current, { y: 160, scale: 0.82, rotation: -10, autoAlpha: 0, duration: 0.95, ease: "back.out(1.5)" }, 0.3)
        .add(() => {
          pilo.current?.mood("sorpresa");
          pilo.current?.blink();
        }, 0.95)
        .add(() => pilo.current?.look(-0.9, -0.1), 1.2)
        .add(() => pilo.current?.look(0.9, -0.1), 1.6)
        .add(() => {
          pilo.current?.look(0, 0);
          pilo.current?.mood("feliz");
        }, 1.95)
        // Letra por letra. Sin desenfoque: al texto solo se le anima posición y opacidad.
        .from(".pa-w-title .ch", { y: 24, autoAlpha: 0, duration: 0.7, stagger: 0.028, ease: "power3.out" }, 1.1)
        .from(".pa-w-top > *", { autoAlpha: 0, y: -8, duration: 0.5, stagger: 0.06, ease: "power3.out" }, 1.3)
        .from([".pa-w-mood", ".pa-w-foot"], { autoAlpha: 0, y: 14, duration: 0.6, ease: "power3.out" }, 1.6)
        .add(() => setBeat(0), 2.1);
    }, root);
    return () => {
      // Interrumpida (o desmontada), todo vuelve a verse.
      ctx.revert();
      hold.current?.kill();
      stopOfficial();
    };
  }, []);

  /* Cada frase: palabra por palabra mientras Pilo habla, con su cara, su mirada y su muestra. */
  useLayoutEffect(() => {
    if (!current || leaving.current) return;
    const root = stage.current!;
    const b = current;
    const still = reducedMotion();
    const words = root.querySelectorAll(".pa-w-bubble .wd");
    // Con voz las palabras llegan al paso del habla; sin ella, al de la lectura.
    const perWord = still ? 0 : speaks ? 0.22 : 0.075;
    let typed = false;
    let spoken = !speaks;
    let cancelled = false;
    const next = () => {
      if (cancelled || !typed || !spoken) return;
      pilo.current?.talk(false);
      // Donde se elige o se toca algo, la guía espera a la persona.
      if (b.pick || b.touch) return;
      const i = beats.indexOf(b);
      const seg = root.querySelectorAll(".pa-segs span i")[i];
      // La barra del segmento marca la pausa antes de la frase siguiente.
      hold.current = gsap.to(seg, { scaleX: 1, duration: 2.4, ease: "none", onComplete: () => setBeat(i + 1) });
    };

    pilo.current?.mood(b.face);
    pilo.current?.look(...b.look);
    if (speaks && voice) {
      const request = voiceRequest(b, voice);
      void sayOfficial(request.text, {
        portal: voice.portal,
        advanced: voice.advanced,
        rate: request.rate,
        keep: true,
        // El pico se mueve con el audio de verdad: cuando empieza y hasta que calla.
        onSound: (on) => !cancelled && pilo.current?.talk(on),
      }).then((result) => {
        if (cancelled || result === "cancelado") return;
        // Sin audio no hay otra voz: la bienvenida sigue en texto.
        if (result === "sin voz") setSilent(true);
        spoken = true;
        next();
      });
    } else {
      pilo.current?.talk(true);
    }

    const ctx = gsap.context(() => {
      const segs = root.querySelectorAll(".pa-segs span i");
      const at = asking ? beats.length : beat;
      gsap.set(segs, { scaleX: (k: number) => (k < at ? 1 : 0) });
      const tl = gsap.timeline();
      if (words.length) tl.fromTo(words, { autoAlpha: 0, y: still ? 0 : 8 }, { autoAlpha: 1, y: 0, duration: still ? 0.2 : 0.35, stagger: perWord, ease: "power3.out" }, 0);
      tl.add(() => {
        typed = true;
        if (!speaks) pilo.current?.talk(false);
        next();
      }, words.length * perWord + 0.3);
      const items = root.querySelectorAll(".pa-w-demo > *");
      if (items.length) {
        if (still) tl.fromTo(items, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 }, 0);
        else tl.fromTo(items, { autoAlpha: 0, y: 16, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.08, ease: "back.out(1.6)" }, 0.2);
      }
    }, root);

    if (b.pick) root.querySelector<HTMLElement>(".pa-w-demo button")?.focus({ preventScroll: true });

    return () => {
      cancelled = true;
      hold.current?.kill();
      hold.current = null;
      ctx.revert();
      stopOfficial();
      pilo.current?.talk(false);
    };
    // `voice` no cambia a media frase de un modo que importe: manda `speaks`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beat, asking, speaks]);

  /* El ejemplo tocado: la respuesta llega palabra por palabra y, si hay voz y ya hubo un toque, Pilo la dice. */
  useLayoutEffect(() => {
    const picked = WELCOME_EXAMPLES.find((e) => e.id === example);
    if (!picked || leaving.current) return;
    const root = stage.current!;
    const still = reducedMotion();
    let cancelled = false;
    const per = still ? 0 : speaks ? 0.12 : 0.04;
    const ctx = gsap.context(() => {
      const words = root.querySelectorAll(".pa-ex .wd");
      const tl = gsap.timeline();
      tl.fromTo(root.querySelector(".pa-ex"), { autoAlpha: 0, y: still ? 0 : 12 }, { autoAlpha: 1, y: 0, duration: still ? 0.2 : 0.3, ease: "expo.out" }, 0);
      if (words.length) tl.fromTo(words, { autoAlpha: 0 }, { autoAlpha: 1, duration: still ? 0.15 : 0.25, stagger: per, ease: "power2.out" }, 0.1);
      tl.fromTo(root.querySelector(".pa-ex-src"), { autoAlpha: 0, y: still ? 0 : 6 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "expo.out" }, words.length * per + 0.2);
    }, root);
    pilo.current?.mood("feliz");
    if (speaks && voice) {
      pilo.current?.talk(true);
      void sayOfficial(tr(picked.a), { portal: voice.portal, advanced: voice.advanced, rate: voice.rate, keep: true, onSound: (on) => !cancelled && pilo.current?.talk(on) }).then((result) => {
        if (cancelled) return;
        if (result === "sin voz") setSilent(true);
        pilo.current?.talk(false);
      });
    }
    return () => {
      cancelled = true;
      // Interrumpida (otra pregunta, otro momento), la respuesta queda entera y visible.
      ctx.revert();
      stopOfficial();
      pilo.current?.talk(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [example]);

  /* La salida: Pilo vuela a la cabecera y el escenario se cierra sobre él. */
  const finish = () => {
    if (leaving.current) return;
    leaving.current = true;
    hold.current?.kill();
    stopOfficial();
    pilo.current?.talk(false);
    const root = stage.current;
    const slot = target.current;
    const fly = holder.current;
    if (!root || !fly) return onDone();
    // Si la entrada no había terminado, termina ya: Pilo vuela desde su sitio, entero y visible.
    intro.current?.progress(1);
    if (reducedMotion() || !slot) {
      gsap.to(root, { autoAlpha: 0, duration: 0.3, onComplete: onDone });
      return;
    }
    const frame = root.getBoundingClientRect();
    const from = fly.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    const cx = to.left + to.width / 2 - frame.left;
    const cy = to.top + to.height / 2 - frame.top;
    const R = Math.hypot(frame.width, frame.height);
    gsap.killTweensOf([fly, root.querySelectorAll(".pa-w-center > *, .pa-w-top, .pa-w-foot, .pa-w-bubble .wd, .pa-segs span i")]);
    gsap.set(fly, { transformOrigin: "0 0" });
    gsap
      .timeline({ onComplete: onDone })
      .to(root.querySelectorAll(".pa-w-center > :not(.pa-w-slot), .pa-w-top, .pa-w-foot, .pa-w-rings"), { autoAlpha: 0, y: -8, duration: 0.25, ease: "power2.out" }, 0)
      .fromTo(root.querySelector(".pa-w-bg"), { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)`, duration: 0.75, ease: "power3.inOut" }, 0.12)
      .to(fly, { x: to.left - from.left, y: to.top - from.top, scale: to.width / from.width, rotation: 0, duration: 0.85, ease: "power3.inOut" }, 0.08);
  };

  // Escape salta la bienvenida; el foco no sale de ella mientras está.
  useFocusTrap(stage, true, () => skip());

  const skip = () => {
    // Sin cuenta no hay conversación a la que ir: saltar la guía lleva a su último momento, la cuenta, que no se salta.
    if (needsAccount) {
      setAsking(false);
      setBeat(beats.length - 1);
      return;
    }
    onChoose(fallback);
    finish();
  };

  const advance = () => {
    if (beat < 0 || beat >= beats.length - 1) return;
    setBeat(beat + 1);
  };

  const back = () => {
    if (beat > 0) setBeat(beat - 1);
  };

  /** Deslizar: a la izquierda avanza, a la derecha vuelve (los botones hacen lo mismo). */
  const onSwipeEnd = (e: ReactPointerEvent) => {
    const from = swipe.current;
    swipe.current = null;
    if (!from || asking || leaving.current) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
    if (dx < 0 && !current?.pick) advance();
    else if (dx > 0) back();
  };

  const choose = (space: SpaceId) => {
    onChoose(space);
    setChosen(space);
    // Con la cuenta obligatoria la guía sigue a la cuenta (el perfil lo da la cuenta); si no, Pilo en Enseñanza pregunta quién habla.
    if (needsAccount && beat < beats.length - 1) setBeat(beat + 1);
    else if (asksRol(space)) setAsking(true);
    else finish();
  };

  const pickRol = (rol: Rol) => {
    onRol(rol);
    finish();
  };

  /** A la cuenta: la bienvenida se funde (no hay cabecera a la que volar) y sigue la pantalla de la cuenta. */
  const toAccount = (way: "registro" | "ingreso") => {
    if (leaving.current) return;
    leaving.current = true;
    hold.current?.kill();
    stopOfficial();
    pilo.current?.talk(false);
    const go = () => {
      // Primero a dónde ir: al cerrarse la bienvenida, la app lleva ahí.
      onAccount?.(way);
      onDone();
    };
    if (!stage.current) return go();
    gsap.to(stage.current, { autoAlpha: 0, duration: reducedMotion() ? 0.2 : 0.3, ease: "power2.out", onComplete: go });
  };

  const shown = Math.min(beat < 0 ? 0 : beat, beats.length - 1) + 1;
  const moodLine = !voice || silent ? tr("La voz de Pilo no está disponible: lea a Pilo") : !voiceOn ? tr("Voz apagada") : !armed ? tr("Toque la pantalla para oír a Pilo") : tr("Voz de Pilo · {mood}", { mood: tr(current?.label ?? "Emocionado") });
  const voiceLabel = !voice || silent ? tr("La voz de Pilo no está disponible ahora") : voiceOn ? tr("Voz de Pilo activada. Apagar") : tr("Voz de Pilo apagada. Activar");

  return (
    <div className="pa-w" ref={stage} data-escritorio={desktop || undefined} data-momento={asking ? "rol" : current?.id} role="dialog" aria-modal="true" aria-label={tr("Bienvenida de Mr. Pilo")} tabIndex={-1}>
      <div className="pa-w-bg">
        <div className="pa-w-glow" />
        <div className="pa-w-rings" aria-hidden="true">
          <i style={{ width: 250, height: 250 }} />
          <i style={{ width: 400, height: 400 }} />
          <i style={{ width: 570, height: 570 }} />
        </div>
      </div>

      <header className="pa-w-top">
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
          onClick={() => voice && !silent && onVoice(!voiceOn)}
        >
          <VoiceIcon on={Boolean(voice) && !silent && voiceOn} />
        </button>
        {!(needsAccount && current?.id === "cuenta") && (
          <button type="button" className="pa-sbtn" onClick={skip}>
            {tr("Saltar guía")}
          </button>
        )}
      </header>

      <div className="pa-w-center" onPointerDown={(e) => (swipe.current = { x: e.clientX, y: e.clientY })} onPointerUp={onSwipeEnd} onPointerCancel={() => (swipe.current = null)}>
        <div className="pa-w-slot">
          <div className="pa-w-fly" ref={holder}>
            <Pilo ref={pilo} size="100%" alive label="Mr. Pilo" />
          </div>
        </div>
        <h1 className="pa-w-title" aria-label={tr(APP_TITLE)}>
          {tr(APP_TITLE).split(" ").map((word, i) => (
            <span key={i} className="pa-w-word" aria-hidden="true">
              {[...word].map((c, j) => (
                <span key={j} className="ch">
                  {c}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <span className="pa-w-mood">
          <i aria-hidden="true" />
          <span>{moodLine}</span>
        </span>
        {/* Lo que se ve aparece palabra por palabra; lo que se anuncia, la frase entera de una vez. */}
        <p className="pa-sr" aria-live="polite">
          {current?.say}
        </p>
        <p className="pa-w-bubble" aria-hidden="true">
          {current?.say.split(" ").map((w, i) => (
            <span key={`${current.id}:${i}`} className="wd">
              {w}{" "}
            </span>
          ))}
        </p>
        <div className="pa-w-exhibit">
          {current?.id === "hola" && (
            <div className="pa-w-demo">
              {APP_KNOWS.map((k) => (
                <span key={k} className="pa-know">
                  {tr(k)}
                </span>
              ))}
            </div>
          )}
          {current?.id === "preguntar" && (
            <>
              <div className="pa-w-demo" role="group" aria-label={tr("Preguntas de ejemplo")}>
                {WELCOME_EXAMPLES.map((q) => (
                  <button key={q.id} type="button" className="pa-qchip" aria-pressed={example === q.id} onClick={() => setExample(q.id)}>
                    {tr(q.q)}
                  </button>
                ))}
              </div>
              {example && <ExampleAnswer id={example} />}
            </>
          )}
          {current?.id === "fuente" && (
            <div className="pa-w-demo">
              <div className="pa-ticket">
                {tr("Cada respuesta dice de dónde viene")}
                <span className="pa-ticket-row">
                  <span className="pa-srcchip">
                    <DocIcon />
                    {tr("UDES en Cifras")}
                  </span>
                  <em>{tr("Orientación general · sin fuente UDES")}</em>
                </span>
              </div>
            </div>
          )}
          {current?.id === "elegir" && (
            <div className="pa-w-demo">
              <div className="pa-choose" role="group" aria-label={current.say}>
                {APP_SPACES.map((space) => (
                  <button key={space} type="button" aria-pressed={chosen === space} onClick={() => choose(space)}>
                    {APP_PILOS[space].label}
                    <small>{APP_PILOS[space].hint}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
          {current?.id === "cuenta" && (
            <div className="pa-w-demo">
              <div className="pa-choose" role="group" aria-label={current.say}>
                <button type="button" onClick={() => toAccount("registro")}>
                  {tr("Crear mi cuenta")}
                  <small>{tr("Con su correo de la UDES")}</small>
                </button>
                <button type="button" onClick={() => toAccount("ingreso")}>
                  {tr("Ya tengo cuenta")}
                  <small>{tr("Entrar con mi usuario")}</small>
                </button>
              </div>
            </div>
          )}
          {current?.id === "rol" && (
            <div className="pa-w-demo">
              <RolePicker variant="stage" value={null} onPick={pickRol} />
            </div>
          )}
        </div>
      </div>

      <footer className="pa-w-foot">
        <div className="pa-segs">
          {beats.map((b) => (
            <span key={b.id} aria-hidden="true">
              <i />
            </span>
          ))}
          <small aria-label={tr("Parte {shown} de {length}", { shown, length: beats.length })}>
            {tr("{shown} de {total}", { shown, total: beats.length })}
          </small>
        </div>
        <div className="pa-w-actions">
          {beat > 0 && !asking && (
            <button type="button" className="pa-w-back" onClick={back}>
              {tr("Atrás")}
            </button>
          )}
          {!current?.pick && (
            <button type="button" className="pa-w-next" onClick={advance} disabled={beat < 0}>
              {tr("Siguiente")}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}
