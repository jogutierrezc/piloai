/* =============================================================================
   Recorridos guiados · el motor.

   Un proveedor en la raíz de la aplicación: cualquier pantalla puede iniciar
   un recorrido (useTour().start) y saber si ya se hizo (isDone).

   En cada parada: si hace falta, lleva a la ruta; espera a que el elemento
   señalado aparezca (hasta 4 s), lo trae a la vista, oscurece el resto
   dejando un hueco sobre él y pone al lado el globo de Mr. Pilo, con su
   expresión. El hueco se desliza de una parada a la siguiente (GSAP, 320 ms);
   con movimiento reducido, salta. Esc sale; ← y → mueven entre paradas.

   El avance se guarda en la base para la intranet (user_tours, 0087) y en el
   navegador para los portales públicos. Un enlace con ?recorrido=<id> abre
   ese recorrido.
   ========================================================================== */

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../lib/auth";
import { Icon } from "../ui/Icon";
import { PiloAvatar } from "../pilo/PiloAvatar";
import { VoiceToggle } from "../pilo/VoiceToggle";
import { speak, stopSpeaking, useVoice } from "../pilo/voice";
import { tourById, type Tour } from "./tours";
import { placeBubble, stickyTopInset } from "./placement";
import "./tour.css";

type Status = "completado" | "descartado" | "en_curso";

interface TourContextValue {
  start: (tourId: string, fromStep?: number) => void;
  /** ¿Ya lo terminó o lo descartó? null mientras se sabe. */
  isDone: (tourId: string) => boolean | null;
  active: string | null;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour() {
  const value = useContext(TourContext);
  if (!value) throw new Error("useTour fuera de TourProvider");
  return value;
}

const LOCAL_KEY = "recorridos";
const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function readLocal(): Record<string, Status> {
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) ?? "{}") as Record<string, Status>;
  } catch {
    return {};
  }
}

function writeLocal(id: string, status: Status) {
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...readLocal(), [id]: status }));
  } catch {
    /* ventana privada: el recorrido se podrá volver a ofrecer */
  }
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, Status> | null>(null);
  const [run, setRun] = useState<{ tour: Tour; index: number } | null>(null);

  // Lo guardado: el navegador siempre; la base si hay sesión.
  useEffect(() => {
    let cancelled = false;
    const local = readLocal();
    if (!profile) {
      setStatuses(local);
      return;
    }
    setStatuses(null);
    void supabase
      .from("user_tours")
      .select("tour_id,status")
      .eq("profile_id", profile.id)
      .then(({ data, error }) => {
        if (cancelled) return;
        // Sin la migración 0087, el navegador hace de respaldo.
        const remote = error ? {} : Object.fromEntries((data ?? []).map((r: { tour_id: string; status: Status }) => [r.tour_id, r.status]));
        setStatuses({ ...local, ...remote });
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  const persist = useCallback(
    (tour: Tour, status: Status, step: number) => {
      setStatuses((s) => ({ ...(s ?? {}), [tour.id]: status }));
      writeLocal(tour.id, status);
      if (tour.scope === "intranet" && profile) {
        void supabase
          .from("user_tours")
          .upsert({ profile_id: profile.id, tour_id: tour.id, status, step }, { onConflict: "profile_id,tour_id" })
          .then(() => undefined);
      }
    },
    [profile],
  );

  const start = useCallback((tourId: string, fromStep = 0) => {
    const tour = tourById(tourId);
    if (tour) setRun({ tour, index: Math.min(fromStep, tour.steps.length - 1) });
  }, []);

  const isDone = useCallback(
    (tourId: string) => (statuses ? statuses[tourId] === "completado" || statuses[tourId] === "descartado" : null),
    [statuses],
  );

  // ?recorrido=<id> en la dirección lo abre: sirve para mandar el enlace a quien lo necesite.
  const location = useLocation();
  const navigateTo = useNavigate();
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const id = params.get("recorrido");
    if (!id || !tourById(id)) return;
    params.delete("recorrido");
    // Primero se abre y luego se limpia la dirección: si fuera al revés, el
    // cambio de dirección volvería a correr este efecto sin el parámetro.
    start(id);
    navigateTo({ pathname: location.pathname, search: params.toString() }, { replace: true });
  }, [location.search, location.pathname, navigateTo, start]);

  const value = useMemo(() => ({ start, isDone, active: run?.tour.id ?? null }), [start, isDone, run]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {run && (
        <TourOverlay
          tour={run.tour}
          index={run.index}
          onMove={(index) => setRun({ tour: run.tour, index })}
          onEnd={(status) => {
            persist(run.tour, status, run.index);
            setRun(null);
          }}
        />
      )}
    </TourContext.Provider>
  );
}

/* --- La capa del recorrido -------------------------------------------------------- */

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
/** Separación entre el anillo del hueco y el globo. */
const GAP = PAD + 16;

/** El tamaño de la ventana, al día: el globo se recoloca al girar o redimensionar. */
function useViewport() {
  const read = () => ({ width: window.innerWidth, height: window.innerHeight });
  const [viewport, setViewport] = useState(read);
  useEffect(() => {
    const update = () =>
      setViewport((v) => {
        const next = read();
        return v.width === next.width && v.height === next.height ? v : next;
      });
    window.addEventListener("resize", update);
    window.visualViewport?.addEventListener("resize", update);
    return () => {
      window.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("resize", update);
    };
  }, []);
  return viewport;
}

function TourOverlay({
  tour,
  index,
  onMove,
  onEnd,
}: {
  tour: Tour;
  index: number;
  onMove: (index: number) => void;
  onEnd: (status: Status) => void;
}) {
  const step = tour.steps[index];
  const last = index === tour.steps.length - 1;
  const navigate = useNavigate();
  const location = useLocation();
  const [box, setBox] = useState<Box | null>(null);
  const [searching, setSearching] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLElement>(null);
  const [bubbleHeight, setBubbleHeight] = useState(0);
  const previousFocus = useRef<Element | null>(null);
  const first = useRef(true);
  const viewport = useViewport();

  useEffect(() => {
    previousFocus.current = document.activeElement;
    return () => {
      (previousFocus.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  // Llevar a la ruta de la parada, si hace falta.
  useEffect(() => {
    if (step.route && location.pathname.replace(/\/+$/, "") !== step.route.replace(/\/+$/, "")) navigate(step.route);
  }, [step.route, location.pathname, navigate]);

  // Encontrar el elemento señalado (se sondea cada 100 ms, hasta 4 s) y
  // seguirlo mientras la parada dure: desplazamiento, cambio de tamaño y
  // cambios de su propia caja. Sin requestAnimationFrame, que se detiene
  // cuando la pestaña no está al frente.
  useEffect(() => {
    setSearching(true);
    setBox(null);
    if (!step.target) {
      setSearching(false);
      return;
    }
    let found: Element | null = null;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      if (!found || !found.isConnected) return;
      const r = found.getBoundingClientRect();
      if (!r.width && !r.height) return;
      setBox((b) =>
        b && Math.abs(b.top - r.top) < 0.5 && Math.abs(b.left - r.left) < 0.5 && Math.abs(b.width - r.width) < 0.5 && Math.abs(b.height - r.height) < 0.5
          ? b
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
      setSearching(false);
    };
    const started = Date.now();
    const poll = window.setInterval(() => {
      const element = document.querySelector(step.target!);
      if (element) {
        window.clearInterval(poll);
        found = element;
        bringIntoView(element, root.current);
        measure();
        observer = new ResizeObserver(measure);
        observer.observe(element);
      } else if (Date.now() - started > 4000) {
        window.clearInterval(poll);
        setSearching(false);
      }
    }, 100);
    // Mientras dura el desplazamiento suave y cargan imágenes, la caja se mueve.
    const settle = window.setInterval(measure, 250);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(settle);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      observer?.disconnect();
    };
  }, [step.target, index, location.pathname]);

  // El hueco se desliza de un elemento al siguiente.
  useLayoutEffect(() => {
    const node = hole.current;
    if (!node || !box) return;
    const target = { top: box.top - PAD, left: box.left - PAD, width: box.width + PAD * 2, height: box.height + PAD * 2 };
    if (first.current || reduced()) {
      gsap.set(node, target);
      first.current = false;
    } else {
      gsap.to(node, { ...target, duration: 0.32, ease: "power3.inOut", overwrite: true });
    }
  }, [box]);

  // Se mide el alto del globo para ubicarlo, y se vuelve a medir cuando su
  // contenido o la ventana lo cambian (texto que se parte en más líneas).
  useLayoutEffect(() => {
    const node = bubble.current;
    if (!node) return;
    const read = () => setBubbleHeight(node.scrollHeight);
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // El globo entra con cada parada. GSAP solo mueve «y»: la posición la da
  // placeBubble con top/left, sin transform. Antes el globo centrado usaba
  // translate(-50%, -50%) y GSAP se quedaba con ese -50 % en su caché
  // (xPercent/yPercent): al encontrar el elemento el globo seguía corrido
  // medio alto hacia arriba y, con el elemento arriba, se salía de la ventana.
  useLayoutEffect(() => {
    const node = bubble.current;
    if (!node) return;
    setBubbleHeight(node.scrollHeight);
    node.querySelector<HTMLElement>("h2")?.focus();
    if (reduced()) return;
    gsap.fromTo(node, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.24, ease: "expo.out", clearProps: "transform" });
  }, [index, searching]);

  // Mr. Pilo narra cada parada cuando la encuentra (si su voz está prendida).
  const { enabled: voiceOn, speaking } = useVoice();
  useEffect(() => {
    if (searching || !voiceOn) return;
    void speak(`${step.title}. ${step.body}`);
  }, [index, searching, voiceOn, step.title, step.body]);
  useEffect(() => () => stopSpeaking(), []);

  // Teclado: Esc sale; flechas mueven.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onEnd("descartado");
      else if (event.key === "ArrowRight") last ? onEnd("completado") : onMove(index + 1);
      else if (event.key === "ArrowLeft" && index > 0) onMove(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, last, onEnd, onMove]);

  // Dónde va el globo: debajo del elemento si cabe; si no, encima, a un lado
  // o, si nada cabe, en la esquina. Sin elemento, al centro. Siempre dentro
  // de la ventana (ver placement.ts).
  const spot = placeBubble({
    target: box && !searching ? box : null,
    bubbleHeight,
    viewport,
    gap: GAP,
  });
  const placement = { top: spot.top, left: spot.left, width: spot.width, maxHeight: spot.maxHeight };

  return createPortal(
    <div ref={root} className="tour" data-centered={!box || searching ? "" : undefined}>
      {/* Atrapa los clics fuera del globo: el recorrido no se rompe por un clic al aire. */}
      <div className="tour__catch" aria-hidden="true" />
      {box && !searching ? <div ref={hole} className="tour__hole" aria-hidden="true" /> : <div className="tour__dim" aria-hidden="true" />}
      <section ref={bubble} className="tour__bubble" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={placement} data-side={spot.side}>
        <header>
          <span className="tour__face">
            <PiloAvatar mood={searching ? "piensa" : step.mood ?? "feliz"} size={52} alive={speaking} />
          </span>
          <div>
            <span className="tour__count">
              {tour.title} · paso {index + 1} de {tour.steps.length}
            </span>
            <h2 id="tour-title" tabIndex={-1}>
              {step.title}
            </h2>
          </div>
          <VoiceToggle className="tour__voice" />
        </header>
        <p>{searching ? "Un momento, busco dónde está…" : step.body}</p>
        <div className="tour__dots" aria-hidden="true">
          {tour.steps.map((_, k) => (
            <i key={k} data-state={k < index ? "done" : k === index ? "current" : "todo"} />
          ))}
        </div>
        <footer>
          <button type="button" className="tour__skip" onClick={() => onEnd("descartado")}>
            Salir del recorrido
          </button>
          {index > 0 && (
            <button type="button" className="button-secondary" onClick={() => onMove(index - 1)}>
              Atrás
            </button>
          )}
          <button type="button" className="button-primary" onClick={() => (last ? onEnd("completado") : onMove(index + 1))}>
            {last ? "Terminar" : "Siguiente"} {!last && <Icon name="arrow-right" size={15} />}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}

/**
 * Trae el elemento a la vista sin dejarlo bajo la cabecera fija de la página:
 * centrado si cabe, y si es más alto que el hueco libre, con su borde de
 * arriba justo debajo de la cabecera. scroll-margin-top se pone solo para
 * esta llamada: el destino del desplazamiento se calcula en el acto.
 */
function bringIntoView(element: Element, ignore: Element | null) {
  const node = element as HTMLElement;
  const inset = stickyTopInset(document, ignore);
  const free = window.innerHeight - inset;
  const tall = element.getBoundingClientRect().height + GAP * 2 > free;
  const previous = node.style?.scrollMarginTop ?? "";
  if (node.style) node.style.scrollMarginTop = `${inset + GAP}px`;
  element.scrollIntoView({ block: tall ? "start" : "center", behavior: reduced() ? "auto" : "smooth" });
  if (node.style) node.style.scrollMarginTop = previous;
}
