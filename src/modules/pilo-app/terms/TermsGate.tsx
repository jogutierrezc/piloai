/* =============================================================================
   Mr. Pilo · la app · «Antes de empezar»: la aceptación de la política.

   La primera vez que alguien abre la app en un dispositivo (con o sin cuenta),
   y otra vez cuando la política cambia de versión: Pilo en su escenario, las
   cuatro reglas de oro, la casilla y «Aceptar y conversar». Sin aceptar no se
   llega a la conversación: esta capa la tapa y la deja inerte (PiloApp).

   Va después de la bienvenida. Mientras la bienvenida está encima (`active`
   en falso) solo existe su fondo, para que al irse no se asome la
   conversación; el contenido se monta, y entra, cuando le toca.

   La aceptación se anota en el dispositivo (acceptance.ts), no en el servidor.

   Movimiento: transform y opacidad. La entrada de Pilo es la de la bienvenida
   y las reglas llegan escalonadas una sola vez, dentro de un contexto de GSAP
   que al interrumpirse devuelve todo a su estado visible: ningún texto queda
   oculto. Lo que se hace con el teclado no se anima. Con movimiento reducido,
   solo fundidos.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { Pilo } from "../../pregunta/Pilo";
import type { PiloMojiHandle } from "../../pregunta/Pilo";
import { useFocusTrap, useInert } from "../Layer";
import { reducedMotion } from "../pwa";
import { acceptPolicy } from "./acceptance";
import { ACCEPT_LABEL, ACCEPT_WHY, CONSENT_LABEL, GATE_CHANGED_LEAD, GATE_LEAD, GATE_TITLE, ONCE_NOTE, POLICY_LINK_LABEL, POLICY_PATH, RULES_TITLE } from "./policy";
import { GoldenRules } from "./GoldenRules";
import "./terms.css";

/** Cuánto después de un toque una acción sigue siendo «del puntero» (lo demás vino del teclado). */
const POINTER_WINDOW = 900;

export function TermsGate({
  active,
  changed = false,
  onAccept,
}: {
  /** Ya le toca: la bienvenida no está encima. */
  active: boolean;
  /** La persona había aceptado otra versión: Pilo avisa que la política cambió. */
  changed?: boolean;
  /** Aceptó (ya quedó anotado en el dispositivo): se abre la conversación. */
  onAccept: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLInputElement>(null);
  const pilo = useRef<PiloMojiHandle>(null);
  const intro = useRef<gsap.core.Timeline | null>(null);
  const pointerAt = useRef(0);
  const leaving = useRef(false);
  /** Se montó debajo de la bienvenida, esperando su turno. */
  const waited = useRef(!active);
  const [checked, setChecked] = useState(false);
  /** Se intentó seguir sin marcar la casilla: el porqué se anuncia. */
  const [missed, setMissed] = useState(false);

  const byPointer = () => performance.now() - pointerAt.current < POINTER_WINDOW;

  // El foco no sale de la aceptación mientras está; no se cierra con Escape: solo aceptando.
  useFocusTrap(root, active, () => {});
  useInert(root, !active);

  // Al entrar, el foco va al título: así se oye primero qué es esto, y después las reglas.
  useEffect(() => {
    if (active) heading.current?.focus({ preventScroll: true });
  }, [active]);

  /* La entrada: Pilo salta a escena como en la bienvenida; las reglas, escalonadas, una sola vez. */
  useLayoutEffect(() => {
    const el = root.current;
    if (!active || !el) return;
    const ctx = gsap.context(() => {
      if (reducedMotion()) {
        gsap.from(el.querySelectorAll(".pt-stage > :not(.pt-stage__bg), .pt-accept > *"), { opacity: 0, duration: 0.3 });
        return;
      }
      const tl = gsap.timeline();
      intro.current = tl;
      // Si esperó debajo de la bienvenida, su fondo ya estaba a la vista: no vuelve a crecer.
      if (!waited.current) {
        tl.from(".pt-glow", { scale: 0.4, autoAlpha: 0, duration: 1.1, ease: "power2.out" }, 0).from(".pt-rings i", { scale: 0.6, autoAlpha: 0, duration: 1, stagger: 0.12, ease: "power3.out" }, 0.1);
      }
      tl.from(holder.current, { y: 140, scale: 0.82, rotation: -10, autoAlpha: 0, duration: 0.9, ease: "back.out(1.5)" }, 0.15)
        .add(() => {
          pilo.current?.mood("sorpresa");
          pilo.current?.blink();
        }, 0.75)
        .add(() => pilo.current?.look(-0.9, -0.1), 1)
        .add(() => pilo.current?.look(0.9, -0.1), 1.35)
        .add(() => {
          pilo.current?.look(0, 0);
          pilo.current?.mood("feliz");
        }, 1.65)
        // El texto solo baja la opacidad (nunca `visibility`): así el título recibe el foco y se lee desde el primer momento.
        .from(".pt-stage h1, .pt-stage p", { y: 12, opacity: 0, duration: 0.4, stagger: 0.06, ease: "expo.out" }, 0.3)
        .from(".pt-rules li", { y: 12, opacity: 0, duration: 0.32, stagger: 0.07, ease: "expo.out" }, 0.4);
    }, el);
    return () => {
      // Interrumpida (o desmontada), todo vuelve a verse.
      intro.current = null;
      ctx.revert();
    };
  }, [active]);

  const toggle = (on: boolean) => {
    setChecked(on);
    if (on) setMissed(false);
    pilo.current?.mood(on ? "sorpresa" : "feliz");
    // El gesto acompaña al toque; con el teclado solo cambia la cara.
    if (on && byPointer() && !reducedMotion()) pilo.current?.nod();
  };

  const accept = () => {
    if (leaving.current) return;
    if (!checked) {
      setMissed(true);
      box.current?.focus();
      return;
    }
    leaving.current = true;
    acceptPolicy();
    const el = root.current;
    // Con el teclado, la conversación aparece en su sitio, sin recorrido.
    if (!el || !byPointer()) return onAccept();
    // Si la entrada no había terminado, termina ya: nada se va a medio aparecer.
    intro.current?.progress(1);
    // La salida es más corta que la entrada, y fuerte.
    if (reducedMotion()) gsap.to(el, { autoAlpha: 0, duration: 0.15, ease: "none", onComplete: onAccept });
    else gsap.to(el, { autoAlpha: 0, scale: 0.98, duration: 0.2, ease: "power3.out", onComplete: onAccept });
  };

  return (
    <div
      className="pt-gate"
      ref={root}
      role="dialog"
      aria-modal="true"
      aria-label={GATE_TITLE}
      aria-hidden={!active || undefined}
      tabIndex={-1}
      onPointerDownCapture={() => (pointerAt.current = performance.now())}
    >
      <section className="pt-stage">
        <div className="pt-stage__bg" aria-hidden="true">
          <span className="pt-glow" />
          <span className="pt-rings">
            <i style={{ width: 260, height: 260 }} />
            <i style={{ width: 420, height: 420 }} />
            <i style={{ width: 600, height: 600 }} />
          </span>
        </div>
        {active && (
          <>
            {/* La cara oficial, entera y a su proporción: solo cambia el tamaño de su caja. */}
            <div className="pt-face">
              <div className="pt-face__in" ref={holder}>
                <Pilo ref={pilo} size="100%" alive label="Mr. Pilo" />
              </div>
            </div>
            <h1 ref={heading} tabIndex={-1}>
              {GATE_TITLE}
            </h1>
            <p>{changed ? GATE_CHANGED_LEAD : GATE_LEAD}</p>
          </>
        )}
      </section>

      <div className="pt-accept">
        {active && (
          <>
            <h2 id="pt-reglas">{RULES_TITLE}</h2>
            <GoldenRules labelledBy="pt-reglas" />
            <label className="pt-consent" htmlFor="pt-acepto">
              <input ref={box} id="pt-acepto" type="checkbox" checked={checked} aria-invalid={missed || undefined} aria-describedby={missed ? "pt-porque" : undefined} onChange={(e) => toggle(e.target.checked)} />
              <span>{CONSENT_LABEL}</span>
            </label>
            <div className="pt-row">
              {/* Deshabilitado «de palabra»: sigue en el recorrido del teclado y dice por qué no deja seguir. */}
              <button type="button" className="pa-btn pa-btn--main pt-go" aria-disabled={!checked} aria-describedby={checked ? undefined : "pt-porque"} onClick={accept}>
                {ACCEPT_LABEL}
              </button>
              <Link className="pt-link" to={POLICY_PATH}>
                {POLICY_LINK_LABEL}
              </Link>
            </div>
            {!checked && (
              <p className="pt-hint" id="pt-porque" data-missed={missed || undefined} role={missed ? "alert" : undefined}>
                {ACCEPT_WHY}
              </p>
            )}
            <p className="pt-hint">{ONCE_NOTE}</p>
          </>
        )}
      </div>
    </div>
  );
}
