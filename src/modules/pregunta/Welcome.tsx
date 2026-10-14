/* =============================================================================
   Pregúntele a Pilo · la bienvenida (solo la primera vez).

   Tres momentos que muestran lo que hace Pilo en vez de contarlo:
     1. qué conoce (las fuentes, con su código),
     2. cómo preguntarle (preguntas de ejemplo, una capciosa),
     3. cómo responde (una respuesta en miniatura con su cita y su boleto).
   Pilo sube con un rebote, se sorprende, mira a los lados y lo mira a usted;
   el título llega letra por letra y Pilo mueve el pico mientras aparece cada
   frase. Al final, «Hacer mi primera pregunta»: la escena se cierra en un
   círculo sobre el lugar del saludo mientras Pilo vuela hasta allí.

   Se puede saltar siempre (Saltar o Escape) y avanzar con «Siguiente»; la voz
   es opcional. Con movimiento reducido, todo son fundidos. Los colores son los
   del tema elegido (--ap-stage-*).

   La escena es una sola para todos los espacios de Pilo (space.ts): cambian
   las frases, el título y las muestras. Un espacio que pregunta el rol
   (Mr. Pilo en Enseñanza) cierra con un momento más: «¿quién pregunta?»; al
   elegir, la escena se cierra igual. Quien salta la bienvenida lo responde
   después, en el saludo de la página.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import gsap from "gsap";
import { Pilo as PiloMoji } from "./Pilo";
import type { PiloMojiHandle } from "./Pilo";
import { speak, stopSpeaking } from "../../components/pilo/voice";
import type { Tema } from "./store";
import { ASK_SPACES, ROLE_QUESTION } from "./space";
import type { Rol, SpaceProfile } from "./space";
import { RolePicker } from "./RolePicker";
import "./welcome.css";
import { tr, useLang, LangSwitch } from "../../components/pilo/i18n";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const finePointer = () => typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches;

export function Welcome({
  tema,
  target,
  onDone,
  space = ASK_SPACES.planeacion,
  askRol = false,
  rol = null,
  onRol,
}: {
  tema: Tema;
  target: RefObject<HTMLElement>;
  onDone: () => void;
  /** El espacio de Pilo: sus frases, su título y sus muestras. */
  space?: SpaceProfile;
  /** Cerrar preguntando quién habla (estudiante o profesor). */
  askRol?: boolean;
  rol?: Rol | null;
  onRol?: (rol: Rol) => void;
}) {
  useLang();
  const BEATS = space.beats;
  const TITLE = space.title;
  const total = BEATS.length + (askRol ? 1 : 0);
  const stage = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const pilo = useRef<PiloMojiHandle>(null);
  const beatTl = useRef<gsap.core.Timeline | null>(null);
  const cta = useRef<HTMLButtonElement>(null);
  const next = useRef<HTMLButtonElement>(null);
  const [beat, setBeat] = useState(-1);
  const [done, setDone] = useState(false);
  const [voiceOn, setVoiceOn] = useState(false);
  const leaving = useRef(false);

  // La entrada.
  useLayoutEffect(() => {
    const root = stage.current!;
    const ctx = gsap.context(() => {
      gsap.set(".apw-demo", { autoAlpha: 0 });
      if (reduced()) {
        gsap.from(root, { autoAlpha: 0, duration: 0.3 });
        gsap.delayedCall(0.4, () => setBeat(0));
        return;
      }
      const tl = gsap.timeline();
      tl.from(".apw-glow", { scale: 0.4, autoAlpha: 0, duration: 1.4, ease: "power2.out" }, 0)
        .from(".apw-rings i", { scale: 0.6, autoAlpha: 0, duration: 1.2, stagger: 0.12, ease: "power3.out" }, 0.1)
        .from(holder.current, { y: 160, scale: 0.82, rotation: -10, autoAlpha: 0, duration: 0.95, ease: "back.out(1.5)" }, 0.35)
        .add(() => {
          pilo.current?.mood("sorpresa");
          pilo.current?.blink();
        }, 1.05)
        .add(() => pilo.current?.look(-0.6, -0.1), 1.3)
        .add(() => pilo.current?.look(0.6, -0.1), 1.7)
        .add(() => {
          pilo.current?.look(0, 0);
          pilo.current?.mood("feliz");
        }, 2.05)
        .from(".apw-title .ch", { y: 26, autoAlpha: 0, filter: "blur(10px)", duration: 0.7, stagger: 0.028, ease: "power3.out" }, 1.25)
        .from(".apw-top > *", { autoAlpha: 0, y: -8, duration: 0.5, stagger: 0.06, ease: "power3.out" }, 1.4)
        .from(".apw-foot", { autoAlpha: 0, y: 14, duration: 0.6, ease: "power3.out" }, 1.8)
        .add(() => setBeat(0), 2.2);
    }, root);
    return () => {
      ctx.revert();
      beatTl.current?.kill();
      stopSpeaking();
    };
  }, []);

  // Cada momento: la frase palabra por palabra mientras Pilo habla, y su muestra.
  useLayoutEffect(() => {
    if (beat < 0 || done) return;
    const root = stage.current!;
    const b = BEATS[beat];
    const words = root.querySelectorAll(".apw-bubble .w");
    const perWord = reduced() ? 0 : 0.075;
    let spoken = !voiceOn;
    let typed = false;
    let cancelled = false;
    const hold = () => {
      if (cancelled || !spoken || !typed) return;
      pilo.current?.talk(false);
      if (beat === BEATS.length - 1) {
        setDone(true);
        return;
      }
      beatTl.current = gsap.timeline().to(`.apw-seg:nth-child(${beat + 1}) i`, { scaleX: 1, duration: 2.6, ease: "none" }).add(() => setBeat(beat + 1));
    };
    pilo.current?.mood(b.mood);
    pilo.current?.look(...b.look);
    pilo.current?.talk(true);
    if (voiceOn) speak(b.say, { force: true }).finally(() => ((spoken = true), hold()));

    const ctx = gsap.context(() => {
      gsap.set(".apw-seg i", { scaleX: (k: number) => (k < beat ? 1 : 0) });
      root.querySelectorAll<HTMLElement>(".apw-demo").forEach((d, k) => {
        if (k !== beat && d.style.visibility !== "hidden") gsap.to(d, { autoAlpha: 0, y: -10, filter: "blur(6px)", duration: 0.25, ease: "power2.out" });
      });
      const demo = root.querySelector<HTMLElement>(`.apw-demo[data-beat="${beat}"]`)!;
      const tl = gsap.timeline();
      tl.fromTo(words, { autoAlpha: 0, y: 8, filter: "blur(4px)" }, { autoAlpha: 1, y: 0, filter: "blur(0px)", duration: reduced() ? 0.2 : 0.35, stagger: perWord, ease: "power3.out" })
        .add(() => {
          typed = true;
          if (!voiceOn) pilo.current?.talk(false);
          hold();
        }, words.length * perWord + 0.2)
        .set(demo, { autoAlpha: 1, y: 0, filter: "blur(0px)" }, 0.15);
      const items = demo.querySelectorAll(".apw-item");
      if (reduced()) tl.from(items, { autoAlpha: 0, duration: 0.3 }, 0.2);
      else if (beat === 0) tl.from(items, { autoAlpha: 0, y: 18, scale: 0.92, duration: 0.5, stagger: 0.08, ease: "back.out(1.6)" }, 0.2);
      else if (beat === 1) {
        tl.from(items, { autoAlpha: 0, y: 24, scale: 0.9, rotation: () => gsap.utils.random(-6, 6), duration: 0.55, stagger: 0.12, ease: "back.out(1.5)" }, 0.3);
        items.forEach((c, k) => gsap.to(c, { y: k % 2 ? -5 : 5, duration: 2 + k * 0.3, ease: "sine.inOut", yoyo: true, repeat: -1, delay: 1 + k * 0.15 }));
      } else {
        tl.from(demo.querySelector(".apw-mini"), { autoAlpha: 0, y: 24, scale: 0.96, duration: 0.5, ease: "power3.out" }, 0.3)
          .from(".apw-cite", { scale: 0.4, autoAlpha: 0, duration: 0.4, ease: "back.out(3)" }, 0.9)
          .from(".apw-tick", { x: -24, autoAlpha: 0, duration: 0.5, ease: "power3.out" }, 1.1)
          .to(".apw-cite", { boxShadow: "0 0 0 6px rgba(33,102,214,.25)", duration: 0.35, yoyo: true, repeat: 3, ease: "sine.inOut" }, 1.4);
      }
    }, root);
    return () => {
      cancelled = true;
      beatTl.current?.kill();
      ctx.revert();
      stopSpeaking();
      pilo.current?.talk(false);
    };
    // La voz se reinicia desde el momento actual si se enciende a medio camino.
  }, [beat, voiceOn, done]);

  // El botón final aparece. En un espacio que pregunta el rol, en su lugar llega la pregunta con sus opciones.
  useLayoutEffect(() => {
    if (!done) return;
    const root = stage.current!;
    const ctx = gsap.context(() => {
      gsap.set(".apw-seg i", { scaleX: 1 });
      root.querySelectorAll<HTMLElement>(".apw-demo").forEach((d, k) => gsap.set(d, { autoAlpha: !askRol && k === 2 ? 1 : 0 }));
      if (!askRol) {
        gsap.fromTo(cta.current, { autoAlpha: 0, y: 14, scale: 0.96 }, { autoAlpha: 1, y: 0, scale: 1, duration: reduced() ? 0.2 : 0.5, ease: "back.out(1.8)" });
      } else if (reduced()) {
        gsap.fromTo(".apw-role", { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.2 });
      } else {
        // Solo opacidad y transform: al texto nunca se le pone desenfoque.
        gsap.fromTo(".apw-bubble .w", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.05, ease: "power3.out" });
        gsap.fromTo(".apw-role .ap-rolp__b", { autoAlpha: 0, y: 16, scale: 0.94 }, { autoAlpha: 1, y: 0, scale: 1, duration: 0.5, stagger: 0.08, delay: 0.25, ease: "back.out(1.6)" });
      }
    }, root);
    pilo.current?.mood("feliz");
    pilo.current?.look(0, 0.5);
    if (askRol) {
      root.querySelector<HTMLElement>(".apw-role button")?.focus({ preventScroll: true });
      if (voiceOn) {
        pilo.current?.talk(true);
        void speak(tr(ROLE_QUESTION), { force: true }).finally(() => pilo.current?.talk(false));
      }
    } else cta.current?.focus({ preventScroll: true });
    return () => {
      ctx.revert();
      if (askRol) stopSpeaking();
    };
    // La voz que se enciende después no repite la pregunta.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  const advance = () => {
    if (beat < 0) return;
    stopSpeaking();
    pilo.current?.talk(false);
    if (beat < BEATS.length - 1) setBeat(beat + 1);
    else setDone(true);
  };

  /* La salida: Pilo vuela a su lugar en el saludo y la escena se cierra sobre él. */
  const finish = () => {
    if (leaving.current) return;
    leaving.current = true;
    beatTl.current?.kill();
    stopSpeaking();
    pilo.current?.talk(false);
    const root = stage.current!;
    const slot = target.current;
    const fly = holder.current!;
    if (reduced() || !slot) {
      gsap.to(root, { autoAlpha: 0, duration: 0.3, onComplete: onDone });
      return;
    }
    const from = fly.getBoundingClientRect();
    const to = slot.getBoundingClientRect();
    const cx = to.left + to.width / 2;
    const cy = to.top + to.height / 2;
    const R = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy));
    gsap.set(fly, { position: "fixed", left: from.left, top: from.top, width: from.width, height: from.height, margin: 0, zIndex: 120, transformOrigin: "0 0" });
    const tl = gsap.timeline({ onComplete: onDone });
    tl.to(root.querySelectorAll(".apw-center > :not(.apw-fly-slot), .apw-foot, .apw-top, .apw-rings"), { autoAlpha: 0, y: -8, filter: "blur(6px)", duration: 0.25, ease: "power2.out" }, 0)
      .fromTo(root.querySelector(".apw-bg"), { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)`, duration: 0.75, ease: "power3.inOut" }, 0.12)
      .to(fly, { x: to.left - from.left, y: to.top - from.top, scale: to.width / from.width, duration: 0.85, ease: "power3.inOut" }, 0.08);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Quien elige su rol entra a la página por la misma salida. */
  const pick = (chosen: Rol) => {
    onRol?.(chosen);
    finish();
  };

  const b = beat >= 0 ? BEATS[beat] : null;
  const asking = done && askRol;
  const say = asking ? tr(ROLE_QUESTION) : b?.say;

  return (
    <div className="apw" ref={stage} data-tema={tema} data-espacio={space.accent ?? undefined} role="dialog" aria-modal="true" aria-labelledby="apw-title">
      <div className="apw-bg">
        <div className="apw-glow" />
        <div className="apw-rings" aria-hidden="true">
          <i style={{ width: 360, height: 360 }} />
          <i style={{ width: 560, height: 560 }} />
          <i style={{ width: 780, height: 780 }} />
        </div>
      </div>
      <header className="apw-top">
        <div className="apw-brand">
          <b>{space.brand.strong}</b>
          {space.brand.text}
        </div>
        <LangSwitch className="apw-lang" />
        <button type="button" className="apw-sbtn apw-push" aria-pressed={voiceOn} onClick={() => setVoiceOn((v) => !v)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 10v4h4l5 4V6L8 10z" />
            <path d="M16.5 9a4 4 0 0 1 0 6" />
          </svg>
          {voiceOn ? tr("Voz activada") : tr("Con voz")}
        </button>
        <button type="button" className="apw-sbtn" onClick={finish}>
          {tr("Saltar")}
        </button>
      </header>

      <div className="apw-center">
        <div className="apw-fly-slot">
          <div className="apw-fly" ref={holder}>
            <PiloMoji ref={pilo} size="100%" track={finePointer()} alive label="Mr. Pilo" />
          </div>
        </div>
        <h1 className="apw-title" id="apw-title" aria-label={TITLE}>
          {TITLE.split(" ").map((w, i) => (
            <span key={i} className="apw-word" aria-hidden="true">
              {[...w].map((c, j) => (
                <span key={j} className="ch">
                  {c}
                </span>
              ))}
            </span>
          ))}
        </h1>
        <p className="apw-bubble" aria-live="polite" key={asking ? "rol" : beat}>
          {say?.split(" ").map((w, i) => (
            <span key={i} className="w">
              {w}{" "}
            </span>
          ))}
        </p>
        <div className="apw-exhibit">
          <div className="apw-demo" data-beat="0">
            <div className="apw-knows">
              {space.sources
                .filter((s) => !s.hidden)
                .map(({ id, code, name }) => (
                  <span key={id} className="apw-know apw-item">
                    <span className="ap-code" data-s={id}>
                      {code}
                    </span>
                    {name}
                  </span>
                ))}
            </div>
          </div>
          <div className="apw-demo" data-beat="1">
            <div className="apw-qs">
              {space.demo.questions.map((x) => (
                <span key={x.q} className={x.trick ? "apw-qchip apw-qchip--trick apw-item" : "apw-qchip apw-item"}>
                  {x.q}
                </span>
              ))}
            </div>
          </div>
          <div className="apw-demo" data-beat="2">
            <div className="apw-mini">
              <span className="apw-mini__badge">{space.demo.mini.badge}</span>
              <p>
                {space.demo.mini.text} <span className="apw-cite">1</span>
              </p>
              <div className="apw-tick">
                <b>{space.demo.mini.ticket}</b>
                <em>{space.demo.mini.stamp}</em>
              </div>
            </div>
          </div>
          {asking && (
            <div className="apw-role">
              <RolePicker variant="stage" value={rol} onPick={pick} />
            </div>
          )}
        </div>
      </div>

      <footer className="apw-foot">
        <div className="apw-segs" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="apw-seg">
              <i />
            </span>
          ))}
          <small className="ap-num">
            {tr("{shown} de {total}", { shown: asking ? total : Math.max(1, beat + 1), total })}
          </small>
        </div>
        <div className="apw-actions">
          {!done && (
            <button type="button" className="apw-next" ref={next} onClick={advance}>
              {tr("Siguiente")}
            </button>
          )}
          <button type="button" className="apw-cta" ref={cta} onClick={finish} hidden={!done || askRol}>
            {tr("Hacer mi primera pregunta")}
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <span className="apw-hint">
          {tr("Solo aparece la primera vez.")}{finePointer() ? tr(" Mueva el puntero: Pilo lo sigue con la mirada.") : tr(" Toque Siguiente para avanzar.")}
        </span>
      </footer>
    </div>
  );
}
