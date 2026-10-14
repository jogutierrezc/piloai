/* =============================================================================
   Mr. Pilo · la app · la llamada · la pantalla.

   Una sola cosa en primer plano: Pilo. Alrededor de su cara, tres anillos que
   dicen en qué punto va el ciclo sin una palabra:

     escucha   respiran despacio, como quien espera
     piensa    se recogen y un anillo de trazos gira (único movimiento constante)
     habla     laten con la voz
     pausa     quietos y apagados

   Debajo, el estado, lo que se oyó y lo que Pilo va diciendo. Al pie, tres
   controles: micrófono, colgar y ver la conversación. Si usted habla mientras
   Pilo habla, Pilo se pausa y le escucha; tocarlo también lo interrumpe.

   El idioma es el de todo Pilo (los botones ES · EN · PT cambian el de la app
   entera), y todos los textos pasan por tr().

   Entra abriéndose desde el botón de la cabecera (de dónde vino) y sale más
   rápido de lo que entró. Con movimiento reducido, solo cambian la opacidad
   y el color.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PILO_LANGS, setLang, tr, useLang } from "../../../components/pilo/i18n";
import { Pilo } from "../../pregunta/Pilo";
import { useFocusTrap } from "../Layer";
import { Icon } from "../icons";
import { reducedMotion } from "../pwa";
import { clock } from "./logic";
import { useCall } from "./useCall";
import type { CallOptions, CallPhase } from "./useCall";
import "./llamada.css";

gsap.registerPlugin(useGSAP);

/** Lo que dice cada punto del ciclo, en el idioma de ahora. */
function phaseText(phase: CallPhase): string {
  switch (phase) {
    case "conectando":
      return tr("Conectando…");
    case "escucha":
      return tr("Le escucho");
    case "piensa":
      return tr("Pensando…");
    case "habla":
      return tr("Pilo habla");
    case "pausa":
      return tr("Micrófono en pausa");
    case "error":
      return tr("Se cortó la llamada");
    default:
      return tr("Llamada terminada");
  }
}

type Mood = "feliz" | "piensa" | "atento" | "duda";
const MOOD: Record<CallPhase, Mood> = { conectando: "atento", escucha: "atento", piensa: "piensa", habla: "feliz", pausa: "feliz", error: "duda", fin: "feliz" };

export function CallScreen({
  ask,
  speak,
  hush,
  prefetch,
  pauseVoice,
  resumeVoice,
  onEnd,
  online,
}: Omit<CallOptions, "lang"> & {
  onEnd: () => void;
  online: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const rings = useRef<SVGSVGElement>(null);
  const lang = useLang();
  const call = useCall({ lang, ask, speak, hush, prefetch, pauseVoice, resumeVoice });
  const { phase, sounding } = call;
  const [log, setLog] = useState(false);
  const [seconds, setSeconds] = useState(0);

  useFocusTrap(root, true, call.end);

  // La llamada empieza al abrirse la pantalla.
  useEffect(() => {
    call.start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sin internet no hay llamada que valga.
  useEffect(() => {
    if (!online) call.end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  const running = phase !== "conectando" && phase !== "error" && phase !== "fin";
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  /* --- Entrar y salir ------------------------------------------------------------------------ */

  // Entra abriéndose desde el botón de la cabecera (arriba a la derecha), que es de donde vino.
  useGSAP(
    () => {
      if (reducedMotion()) return;
      gsap.fromTo(root.current, { clipPath: "circle(0px at calc(100% - 44px) 44px)" }, { clipPath: "circle(160vmax at calc(100% - 44px) 44px)", duration: 0.55, ease: "power3.out", clearProps: "clipPath" });
      gsap.from(".pc-top, .pc-bar", { autoAlpha: 0, y: (i) => (i ? 12 : -8), duration: 0.35, ease: "power3.out", delay: 0.2 });
    },
    { scope: root },
  );

  // Colgar: sale más rápido de lo que entró.
  const left = useRef(false);
  useEffect(() => {
    if (phase !== "fin" || left.current) return;
    left.current = true;
    if (reducedMotion() || !root.current) return onEnd();
    gsap.to(root.current, { autoAlpha: 0, scale: 0.98, duration: 0.2, ease: "power2.out", onComplete: onEnd });
  }, [phase, onEnd]);

  /* --- Los anillos ----------------------------------------------------------------------------- */

  useGSAP(
    () => {
      const svg = rings.current;
      if (!svg || reducedMotion()) return;
      const circles = gsap.utils.toArray<SVGCircleElement>(".pc-ring:not(.pc-ring--think)", svg);
      const dashed = svg.querySelector<SVGCircleElement>(".pc-ring--think");
      gsap.set(circles, { scale: 1, opacity: (i) => 0.55 - i * 0.14, transformOrigin: "50% 50%" });
      if (phase === "escucha") {
        gsap.to(circles, { scale: (i) => 1.045 + i * 0.03, duration: 2.1, ease: "sine.inOut", yoyo: true, repeat: -1, stagger: 0.28 });
      } else if (phase === "piensa") {
        gsap.to(circles, { scale: 0.965, opacity: (i) => 0.3 - i * 0.06, duration: 0.45, ease: "power3.out" });
        if (dashed) gsap.fromTo(dashed, { rotation: 0, opacity: 0 }, { rotation: 360, opacity: 0.9, duration: 5, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
      } else if (phase === "habla") {
        // Late con la voz: tres frecuencias que no coinciden, para que no suene a metrónomo.
        const base = [0.034, 0.05, 0.068];
        const tick = () => {
          const now = gsap.ticker.time;
          const level = sounding ? 0.5 + 0.5 * Math.sin(now * 9.1) * Math.sin(now * 3.7 + 1.2) : 0.12;
          circles.forEach((c, i) => gsap.set(c, { scale: 1 + level * base[i] * (1 + 0.35 * Math.sin(now * (4.2 + i * 1.9))) + 0.012 * i, opacity: 0.62 - i * 0.12 }));
        };
        gsap.ticker.add(tick);
        return () => gsap.ticker.remove(tick);
      } else {
        gsap.to(circles, { opacity: (i) => 0.22 - i * 0.05, duration: 0.3 });
      }
    },
    { scope: root, dependencies: [phase, sounding], revertOnUpdate: true },
  );

  const canTap = phase === "habla" || phase === "piensa";
  const failed = phase === "error";

  return (
    <div className="pc" ref={root} role="dialog" aria-modal="true" aria-label="Mr. Pilo" data-phase={phase} data-log={log || undefined} tabIndex={-1}>
      <header className="pc-top">
        <p className="pc-live">
          <i aria-hidden="true" />
          <span>{tr("En llamada")}</span>
          <time dateTime={`PT${seconds}S`}>{clock(seconds)}</time>
        </p>
        <div className="pc-langs" role="radiogroup" aria-label={tr("Idioma de la llamada")}>
          {PILO_LANGS.map((l) => (
            <button key={l.id} type="button" role="radio" aria-checked={l.id === lang} lang={l.id} title={l.name} onClick={() => setLang(l.id)}>
              {l.code}
            </button>
          ))}
        </div>
      </header>

      <main className="pc-stage">
        <button type="button" className="pc-orb" onClick={call.interrupt} disabled={!canTap} aria-label={canTap ? tr("Toque a Pilo para interrumpir") : phaseText(phase)}>
          <svg ref={rings} className="pc-rings" viewBox="0 0 240 240" aria-hidden="true">
            <circle className="pc-ring" cx="120" cy="120" r="84" />
            <circle className="pc-ring" cx="120" cy="120" r="100" />
            <circle className="pc-ring" cx="120" cy="120" r="116" />
            <circle className="pc-ring pc-ring--think" cx="120" cy="120" r="108" />
          </svg>
          <span className="pc-face">
            <Pilo size="100%" mood={MOOD[phase]} talking={sounding} alive />
          </span>
        </button>

        <h2 className="pc-state" aria-live="polite">
          {phaseText(phase)}
        </h2>
        <p className="pc-hint" aria-hidden="true" data-on={canTap || undefined}>
          {tr("Toque a Pilo para interrumpir")}
        </p>

        {failed ? (
          <div className="pc-fail" role="alert">
            <p>{call.error}</p>
            <div>
              <button type="button" className="pa-btn pc-btn" onClick={call.start}>
                {tr("Volver a llamar")}
              </button>
              <button type="button" className="pa-btn pc-btn pc-btn--line" onClick={call.end}>
                {tr("Cerrar")}
              </button>
            </div>
          </div>
        ) : (
          <div className="pc-caption" lang={lang}>
            <p className="pc-heard" data-empty={!call.heard || undefined}>
              {call.heard}
            </p>
            <p className="pc-said" data-empty={!call.said || undefined}>
              {call.said}
            </p>
          </div>
        )}
      </main>

      <section className="pc-log" aria-label={tr("La conversación")} hidden={!log}>
        {call.lines.length === 0 ? (
          <p className="pc-log__empty">{tr("Aún no hay nada dicho.")}</p>
        ) : (
          <ol>
            {call.lines.map((l, i) => (
              <li key={i} data-who={l.who} lang={lang}>
                <b>{l.who === "yo" ? tr("Usted") : "Pilo"}</b>
                <span>{l.text}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <footer className="pc-bar">
        <button type="button" className="pc-ctl" aria-pressed={call.muted} onClick={() => call.mute(!call.muted)} aria-label={call.muted ? tr("Activar el micrófono") : tr("Silenciar el micrófono")} disabled={failed}>
          {call.muted ? Icon.micOff : Icon.mic}
        </button>
        <button type="button" className="pc-ctl pc-ctl--end" onClick={call.end} aria-label={tr("Colgar")}>
          {Icon.hangup}
        </button>
        <button type="button" className="pc-ctl" aria-pressed={log} onClick={() => setLog((v) => !v)} aria-label={tr("Ver la conversación")}>
          {Icon.chat}
        </button>
      </footer>
    </div>
  );
}
