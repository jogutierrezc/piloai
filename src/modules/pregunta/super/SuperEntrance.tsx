/* =============================================================================
   Los modos secretos · la entrada.

   Al escribir «modo super pilo», Pilo aparece de cuerpo entero sobre la misma
   escena de la bienvenida (welcome.css) y se transforma:

     1. sube con un rebote y saluda con la mano,
     2. gira para el escaneo (las vistas aprobadas: frente, perfil, espalda),
     3. se pone el equipo del modo,
     4. despega (el Pilonator no vuela: da un pisotón).

   Al terminar, la escena se cierra en un círculo sobre la cara de la respuesta
   mientras Pilo vuela hasta ella: allí queda la cara de siempre, ya equipada.

   El dibujo no se redibuja ni se estira: es la imagen aprobada
   (public/Pilo2), cortada en piezas con recortes; cada pieza gira entera sobre
   su articulación. Se puede saltar siempre (Saltar o Escape). Con movimiento
   reducido la página no monta esta escena: el modo cambia sin ella.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef } from "react";
import gsap from "gsap";
import { SUPER } from "./modes";
import type { SuperMode } from "./modes";
import { Antenna, GLASSES_TILT, GoldHair, PixelShades, Scouter, Visor } from "./Gear";
import { superSfx } from "./sfx";
import "../welcome.css";
import "./super.css";

/** Las vistas de Pilo. Los nombres de archivo llevan un espacio. */
const art = (n: number) => `/Pilo2/Recurso%20${n}.png`;
const WAVE = art(1);

/** Las vistas del giro, cada una en su sitio para que los pies no salten. */
const TURN = [
  { id: "t2", n: 2, x: 330, y: 140, w: 783, h: 1600 },
  { id: "t3", n: 3, x: 330, y: 205, w: 784, h: 1535 },
  { id: "t4", n: 4, x: 279, y: 166, w: 742, h: 1574 },
  { id: "t5", n: 5, x: 185, y: 205, w: 784, h: 1535 },
  { id: "t6", n: 6, x: 185, y: 140, w: 783, h: 1600 },
];
const TURN_ORDER = ["t2", "t3", "t4", "t5", "t6", "t2"];
const TURN_STEP = 0.24;

/** Una pieza que gira y se escala sobre un punto del dibujo (su articulación). */
interface Pose {
  x: number;
  y: number;
  r: number;
  sx: number;
  sy: number;
  apply: () => void;
}
function pose(el: Element, cx: number, cy: number): Pose {
  const s: Pose = {
    x: 0,
    y: 0,
    r: 0,
    sx: 1,
    sy: 1,
    apply: () => el.setAttribute("transform", `translate(${s.x} ${s.y}) rotate(${s.r} ${cx} ${cy}) translate(${cx} ${cy}) scale(${s.sx} ${s.sy}) translate(${-cx} ${-cy})`),
  };
  return s;
}
const mv = (s: Pose, vars: gsap.TweenVars): gsap.TweenVars => ({ ...vars, onUpdate: s.apply });

export function SuperEntrance({
  mode,
  short = false,
  sound = false,
  target,
  onDone,
}: {
  mode: SuperMode;
  /** Ya había otro modo puesto: sin el giro de escaneo. */
  short?: boolean;
  /** Con «Leer en voz alta» prendido, la entrada suena. */
  sound?: boolean;
  /** La cara de la respuesta a la que vuela Pilo al terminar. */
  target: () => HTMLElement | null;
  onDone: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const skip = useRef<() => void>(() => {});
  const done = useRef(onDone);
  done.current = onDone;
  const profile = SUPER[mode];
  const title = `Modo ${profile.name}`;

  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const q = <T extends Element>(p: string) => node.querySelector<T>(`[data-p="${p}"]`)!;
    const sfx = superSfx(sound);
    // La cara de la respuesta espera escondida a que Pilo llegue volando.
    const slot = target();
    if (slot) slot.style.visibility = "hidden";

    const S = {
      actor: pose(q("actor"), 650, 1740),
      head: pose(q("head"), 540, 470),
      hand: pose(q("hand"), 140, 603),
      visor: pose(q("visor"), 415, 237),
      antenna: pose(q("antenna"), 545, 20),
      shades: pose(q("shades"), 415, 237),
      scouter: pose(q("scouter"), 497, 233),
      hair: pose(q("hair"), 470, 215),
    };
    const fly = q<HTMLDivElement>("fly");
    const bg = q<HTMLDivElement>("bg");
    const flash = q<HTMLDivElement>("flash");
    const bubble = q<HTMLParagraphElement>("bubble");
    const chrome = [q("top"), q("title"), bubble, q("foot")];
    const segs = [...node.querySelectorAll<HTMLElement>(".apw-seg i")];
    const stage = (i: number) => () => (bubble.textContent = profile.stages[i]);
    const showFrame = (id: string | null) => {
      for (const t of TURN) q(t.id).setAttribute("visibility", t.id === id ? "visible" : "hidden");
      q("rig").setAttribute("visibility", id ? "hidden" : "visible");
    };
    const show = (p: string, at: string): [Element, gsap.TweenVars, gsap.TweenVars, string] => [q(p), { opacity: 0 }, { opacity: 1, duration: 0.1 }, at];

    let finished = false;
    let leaving = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      done.current();
    };

    const ctx = gsap.context(() => {
      /* La salida: la escena se cierra en un círculo sobre la cara mientras Pilo vuela hasta ella. */
      const exit = () => {
        if (leaving) return;
        leaving = true;
        const to = slot?.getBoundingClientRect();
        if (!to || !to.width) {
          gsap.to(node, { autoAlpha: 0, duration: 0.3, onComplete: finish });
          return;
        }
        const from = fly.getBoundingClientRect();
        const cx = to.left + to.width / 2;
        const cy = to.top + to.height / 2;
        const R = Math.hypot(Math.max(cx, window.innerWidth - cx), Math.max(cy, window.innerHeight - cy));
        gsap
          .timeline({ onComplete: finish })
          .to(chrome, { autoAlpha: 0, y: -8, duration: 0.25, ease: "power2.out" }, 0)
          .fromTo(bg, { clipPath: `circle(${R}px at ${cx}px ${cy}px)` }, { clipPath: `circle(0px at ${cx}px ${cy}px)`, duration: 0.75, ease: "power3.inOut" }, 0.12)
          .to(fly, { x: cx - (from.left + from.width / 2), y: cy - (from.top + from.height / 2), scale: (to.height / from.height) * 1.6, duration: 0.85, ease: "power3.inOut" }, 0.08)
          .to(fly, { autoAlpha: 0, duration: 0.12 }, 0.82);
      };

      const tl = gsap.timeline({ onComplete: exit });
      skip.current = () => {
        tl.kill();
        exit();
      };

      tl.addLabel("boot", 0)
        .call(() => {
          sfx.boot();
          stage(0)();
        }, undefined, "boot")
        .from(node, { autoAlpha: 0, duration: 0.25, ease: "power2.out" }, "boot")
        .from(".apw-glow", { scale: 0.4, autoAlpha: 0, duration: 1.2, ease: "power2.out" }, "boot")
        .from(".apw-rings i", { scale: 0.6, autoAlpha: 0, duration: 1, stagger: 0.12, ease: "power3.out" }, "boot+=0.1")
        .from(fly, { y: 160, scale: 0.82, rotation: -10, autoAlpha: 0, duration: 0.95, ease: "back.out(1.5)" }, "boot+=0.15")
        .from(".apw-title .ch", { y: 26, autoAlpha: 0, duration: 0.6, stagger: 0.028, ease: "power3.out" }, "boot+=0.5")
        .fromTo(S.hand, { r: -8 }, mv(S.hand, { r: 12, duration: 0.2, ease: "sine.inOut", yoyo: true, repeat: 3 }), "boot+=0.6")
        .to(S.hand, mv(S.hand, { r: 0, duration: 0.15 }))
        .to(segs[0], { scaleX: 1, duration: 1.2, ease: "none" }, "boot");

      if (short) {
        tl.set(segs[1], { scaleX: 1 });
      } else {
        // El giro de reconocimiento: las vistas del dibujo, una por una, bajo la línea de escaneo.
        const turning = TURN_ORDER.length * TURN_STEP;
        tl.addLabel("scan", 1.4).call(stage(1), undefined, "scan").to(q("ring"), { opacity: 1, duration: 0.2 }, "scan");
        TURN_ORDER.forEach((id, i) =>
          tl.call(
            () => {
              showFrame(id);
              sfx.tick();
            },
            undefined,
            `scan+=${i * TURN_STEP}`,
          ),
        );
        tl.set(q("scanline"), { opacity: 1 }, "scan")
          .fromTo(q("scanline"), { attr: { y: 150 } }, { attr: { y: 1740 }, duration: turning, ease: "none" }, "scan")
          .to(segs[1], { scaleX: 1, duration: turning, ease: "none" }, "scan")
          .set(q("scanline"), { opacity: 0 })
          .call(() => showFrame(null));
      }

      tl.addLabel("armor", "+=0.1").call(stage(2), undefined, "armor").to(segs[2], { scaleX: 1, duration: 1.4, ease: "none" }, "armor");

      if (mode === "pilocop") {
        // El visor entra de lado y encaja; la cabeza acusa el golpe. La antena salta del copete y queda vibrando.
        tl.call(sfx.servo, undefined, "armor")
          .fromTo(S.visor, { x: 340 }, mv(S.visor, { x: 0, duration: 0.28, ease: "power4.out" }), "armor")
          .fromTo(...show("visor", "armor"))
          .call(sfx.clank, undefined, "armor+=0.24")
          .to(S.head, mv(S.head, { r: 5, duration: 0.07, ease: "power2.out" }), "armor+=0.24")
          .to(S.head, mv(S.head, { r: 0, duration: 0.5, ease: "elastic.out(1.1, 0.4)" }))
          .fromTo(S.antenna, { sy: 0.3 }, mv(S.antenna, { sy: 1, duration: 0.6, ease: "elastic.out(1, 0.35)" }), "armor+=0.4")
          .fromTo(...show("antenna", "armor+=0.4"))
          .fromTo(S.antenna, { r: 14 }, mv(S.antenna, { r: 0, duration: 0.8, ease: "elastic.out(1.2, 0.25)" }), "armor+=0.45");
      } else if (mode === "pilonator") {
        // Las gafas de píxeles bajan a saltos desde arriba y aterrizan en el pico.
        tl.fromTo(...show("shades", "armor"))
          .fromTo(S.shades, { y: -520 }, mv(S.shades, { y: 0, duration: 0.9, ease: "steps(10)" }), "armor")
          .call(sfx.clank, undefined, "armor+=0.9")
          .to(S.head, mv(S.head, { r: -4, duration: 0.08, ease: "power2.out" }), "armor+=0.9")
          .to(S.head, mv(S.head, { r: 0, duration: 0.4, ease: "steps(3)" }));
      } else {
        // El rastreador se engancha, Pilo tiembla, el copete se eriza en dorado y estalla el aura.
        tl.call(sfx.servo, undefined, "armor")
          .fromTo(S.scouter, { x: 300 }, mv(S.scouter, { x: 0, duration: 0.28, ease: "power4.out" }), "armor")
          .fromTo(...show("scouter", "armor"))
          .call(sfx.lift, undefined, "armor+=0.35")
          .to(S.actor, mv(S.actor, { x: 8, duration: 0.04, ease: "none", yoyo: true, repeat: 9 }), "armor+=0.35")
          .to(S.actor, mv(S.actor, { x: 0, duration: 0.04 }))
          .fromTo(flash, { opacity: 0.8 }, { opacity: 0, duration: 0.4, ease: "power2.out" }, "armor+=0.8")
          .fromTo(...show("hair", "armor+=0.8"))
          .fromTo(S.hair, { sy: 0.6, sx: 0.9 }, mv(S.hair, { sy: 1, sx: 1, duration: 0.6, ease: "elastic.out(1.1, 0.35)" }), "armor+=0.8")
          .fromTo(q("aura"), { opacity: 0 }, { opacity: 1, duration: 0.2 }, "armor+=0.8");
      }

      // Se agacha para tomar impulso y despega; el que no vuela da un pisotón.
      tl.addLabel("liftoff", "armor+=1.4")
        .call(stage(3), undefined, "liftoff")
        .to(segs[3], { scaleX: 1, duration: 0.8, ease: "none" }, "liftoff")
        .to(S.actor, mv(S.actor, { sy: 0.96, duration: 0.14, ease: "power2.out" }), "liftoff");
      if (profile.lift) {
        tl.call(sfx.lift, undefined, "liftoff")
          .to(S.actor, mv(S.actor, { sy: 1, y: profile.lift, duration: 0.6, ease: "back.out(2.2)" }), "liftoff+=0.14")
          .to(q("shadow"), { opacity: 0.12, duration: 0.5 }, "liftoff+=0.14");
        if (mode === "pilocop") tl.to(q("thrusters"), { opacity: 1, duration: 0.1 }, "liftoff+=0.14");
      } else {
        tl.call(sfx.clank, undefined, "liftoff+=0.14").to(S.actor, mv(S.actor, { sy: 1, duration: 0.4, ease: "elastic.out(1, 0.45)" }), "liftoff+=0.14");
      }
      // Un respiro para verlo antes de volver a la conversación.
      tl.to({}, { duration: 0.9 });
    }, node);

    return () => {
      ctx.revert();
      if (slot) slot.style.visibility = "";
    };
    // La escena se monta una vez por entrada: quien la usa la desmonta al terminar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="apw aps" data-modo={mode} ref={root} role="dialog" aria-modal="true" aria-label={title}>
      <div className="apw-bg" data-p="bg">
        <div className="apw-glow" />
        <div className="apw-rings" aria-hidden="true">
          <i style={{ width: 360, height: 360 }} />
          <i style={{ width: 560, height: 560 }} />
          <i style={{ width: 780, height: 780 }} />
        </div>
        <div className="aps-flash" data-p="flash" />
      </div>
      <header className="apw-top" data-p="top">
        <div className="apw-brand">
          <b>Mr. Pilo</b>
          Modo secreto
        </div>
        <button type="button" className="apw-sbtn" onClick={() => skip.current()}>
          Saltar
        </button>
      </header>

      <div className="apw-center">
        <div className="aps-fly" data-p="fly">
          <svg viewBox="0 0 1300 1800" aria-hidden="true">
            <defs>
              <clipPath id="aps-head">
                <polygon points="215,0 700,0 700,280 672,340 648,362 640,400 600,495 480,495 450,445 428,398 408,396 385,403 360,422 330,425 215,425" />
              </clipPath>
              <clipPath id="aps-body">
                <polygon points="60,655 92,642 185,572 215,540 215,430 330,430 372,440 385,415 412,400 440,418 462,465 490,482 520,470 560,455 580,435 610,395 640,365 695,360 725,395 1023,395 1023,1550 0,1550 0,655" />
              </clipPath>
              <clipPath id="aps-hand">
                <polygon points="0,405 200,405 205,555 185,572 92,642 60,640 0,560" />
              </clipPath>
              <clipPath id="aps-wrist">
                <polygon points="60,640 92,642 185,572 205,555 190,515 30,590" />
              </clipPath>
            </defs>
            <ellipse data-p="shadow" cx="650" cy="1752" rx="300" ry="26" fill="#000" opacity=".3" />
            <ellipse data-p="ring" className="sp-ring" cx="650" cy="1752" rx="360" ry="34" fill="none" stroke="var(--ap-accent)" strokeWidth="4" strokeDasharray="40 20" opacity="0" />
            <g data-p="actor">
              <g data-p="aura" opacity="0">
                <path className="sp-aura" d="M650 1790 Q230 1500 320 900 Q290 500 520 90 Q560 340 650 50 Q730 340 800 130 Q1020 520 970 900 Q1070 1500 650 1790Z" fill="url(#sp-aura)" />
              </g>
              <g data-p="thrusters" opacity="0">
                <g className="sp-flame" transform="translate(430 1688)">
                  <path d="M-46 0 Q-30 90 0 150 Q30 90 46 0 Z" fill="url(#sp-flame)" />
                </g>
                <g className="sp-flame" transform="translate(712 1722)">
                  <path d="M-46 0 Q-30 90 0 150 Q30 90 46 0 Z" fill="url(#sp-flame)" />
                </g>
              </g>
              {/* El dibujo aprobado, cortado en piezas con recortes: la cabeza y la mano giran enteras. */}
              <g data-p="rig" transform="translate(50 190)">
                <g data-p="head">
                  <image href={WAVE} width="1023" height="1550" clipPath="url(#aps-head)" />
                  <g data-p="hair" opacity="0">
                    <GoldHair />
                  </g>
                  <g data-p="antenna" opacity="0">
                    <Antenna />
                  </g>
                  <g transform={GLASSES_TILT}>
                    <g data-p="visor" opacity="0">
                      <Visor />
                    </g>
                    <g data-p="shades" opacity="0">
                      <PixelShades />
                    </g>
                    <g data-p="scouter" opacity="0">
                      <Scouter />
                    </g>
                  </g>
                </g>
                <image href={WAVE} width="1023" height="1550" clipPath="url(#aps-body)" />
                <image href={WAVE} width="1023" height="1550" clipPath="url(#aps-wrist)" />
                <g data-p="hand">
                  <image href={WAVE} width="1023" height="1550" clipPath="url(#aps-hand)" />
                </g>
              </g>
              {TURN.map((t) => (
                <image key={t.id} data-p={t.id} href={art(t.n)} x={t.x} y={t.y} width={t.w} height={t.h} visibility="hidden" />
              ))}
            </g>
            <rect data-p="scanline" x="90" y="150" width="1120" height="8" fill="var(--ap-accent)" opacity="0" />
          </svg>
        </div>
        <div className="apw-title" data-p="title" aria-hidden="true">
          {title.split(" ").map((w, i) => (
            <span key={i} className="apw-word">
              {[...w].map((c, j) => (
                <span key={j} className="ch">
                  {c}
                </span>
              ))}
            </span>
          ))}
        </div>
        <p className="apw-bubble" data-p="bubble" aria-live="polite" />
      </div>

      <footer className="apw-foot" data-p="foot">
        <div className="apw-segs" aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="apw-seg">
              <i />
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
