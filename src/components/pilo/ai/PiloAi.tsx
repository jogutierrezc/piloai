/* =============================================================================
   Mr. Pilo con IA · el botón y el panel en los portales.

   Aparece solo donde la administración lo activó y para quien le toca
   (usePiloAiHere). Cerrado: Mr. Pilo en la esquina, con un globo la primera
   vez. Abierto: un panel a la derecha, con la página visible al lado, que
   ofrece Escuchar la página, Resumir, Sintetizar y Explicar una gráfica.

   Todo sale de lo que hay en pantalla (page.ts) y pasa por la función del
   servidor; la voz avanzada cae a la del navegador si hace falta.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { PiloAvatar } from "../PiloAvatar";
import type { PiloMood } from "../PiloAvatar";
import { SpeakerIcon } from "../VoiceToggle";
import { useTour } from "../../tour/TourProvider";
import { publicTourFor } from "../../tour/tours";
import { askPilo, sayWithPilo, stopPilo, PiloError } from "./client";
import type { PiloResult } from "./client";
import { usePiloAiHere } from "./config";
import { collectSections, pageTitle, readingScript } from "./page";
import type { PageSection } from "./page";
import { answerText } from "./logic";
import "./pilo-ai.css";

type View = "menu" | "escuchar" | "resumir" | "sintetizar" | "explicar";
const OFFERED = "pilo-ia:ofrecido";

export function PiloAi() {
  const { pathname } = useLocation();
  const here = usePiloAiHere();
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);

  // Cambiar de página cierra el panel y calla a Pilo.
  useEffect(() => {
    setOpen(false);
    stopPilo();
  }, [pathname]);

  // El globo, una sola vez por navegador.
  useEffect(() => {
    if (!here.active) return;
    let offered = false;
    try {
      offered = window.localStorage.getItem(OFFERED) === "1";
    } catch {
      /* se ofrece igual */
    }
    if (offered) return;
    const timer = window.setTimeout(() => {
      setPeek(true);
      try {
        window.localStorage.setItem(OFFERED, "1");
      } catch {
        /* nada */
      }
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [here.active]);

  if (!here.active || !here.portal) return null;

  return createPortal(
    <div className="pai">
      {!open && (
        <div className="pai-fab">
          {peek && (
            <div className="pai-fab__peek" role="status">
              <strong>¿Le leo esta página?</strong>
              <span>Se la cuento en voz alta o se la resumo en un minuto.</span>
              <button type="button" onClick={() => setPeek(false)} aria-label="Cerrar el aviso">
                ×
              </button>
            </div>
          )}
          <button
            type="button"
            className="pai-fab__button"
            aria-label="Abrir a Mr. Pilo"
            aria-expanded={false}
            onClick={() => {
              setPeek(false);
              setOpen(true);
            }}
          >
            <PiloAvatar mood={peek ? "idea" : "feliz"} size={76} />
            <span className="pai-fab__badge" aria-hidden="true">
              <SpeakerIcon size={14} />
            </span>
          </button>
        </div>
      )}
      {open && <Panel here={here} onClose={() => setOpen(false)} />}
    </div>,
    document.body,
  );
}

function Panel({ here, onClose }: { here: ReturnType<typeof usePiloAiHere>; onClose: () => void }) {
  const { pathname } = useLocation();
  const { start: startTour } = useTour();
  const tour = publicTourFor(pathname);
  const [view, setView] = useState<View>("menu");
  const [sections, setSections] = useState<PageSection[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PiloError | null>(null);
  const [result, setResult] = useState<PiloResult | null>(null);
  const [part, setPart] = useState<number | null>(null);
  const [reading, setReading] = useState<{ index: number; total: number; voice: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLElement>(null);
  const run = useRef(0);
  const page = pageTitle();
  const portal = here.portal!;
  const config = here.config!;
  const advanced = config.speechReady && here.actions.leer;
  const voice = { portal, advanced, rate: config.voiceRate, pitch: config.voicePitch };
  const adminOnly = config.portals[portal]?.aud === "admin";

  useEffect(() => {
    setSections(collectSections());
    panel.current?.querySelector<HTMLElement>("h2")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      stopPilo();
      mark(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    stopPilo();
    mark(null);
    onClose();
  };

  /** Resalta en la página la sección que se lee o se explica. */
  const mark = useCallback((element: HTMLElement | null) => {
    document.querySelectorAll(".pai-focus").forEach((el) => el.classList.remove("pai-focus"));
    if (element) {
      element.classList.add("pai-focus");
      element.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    }
  }, []);

  const back = () => {
    run.current += 1;
    stopPilo();
    mark(null);
    setBusy(false);
    setError(null);
    setResult(null);
    setPart(null);
    setReading(null);
    setView("menu");
  };

  const ask = async (action: "resumir" | "sintetizar" | "explicar", only?: PageSection) => {
    const mine = ++run.current;
    setView(action);
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const found = only ? [only] : sections.length ? sections : collectSections();
      if (!found.length) throw new PiloError("No encontré tablas ni gráficas que leer en esta página.", "vacio");
      const answer = await askPilo(action, portal, page, found);
      if (mine === run.current) setResult(answer);
    } catch (e) {
      if (mine === run.current) setError(e instanceof PiloError ? e : new PiloError("No pude hablar con Mr. Pilo ahora.", "red"));
    } finally {
      if (mine === run.current) setBusy(false);
    }
  };

  const listen = async () => {
    const mine = ++run.current;
    setView("escuchar");
    const script = readingScript(sections.length ? sections : collectSections());
    for (let i = 0; i < script.length; i++) {
      if (mine !== run.current) return;
      mark(script[i].section?.element ?? null);
      setReading((r) => ({ index: i, total: script.length, voice: r?.voice ?? "" }));
      const used = await sayWithPilo(script[i].text, voice);
      if (used === "cancelado" || mine !== run.current) return;
      setReading({ index: i, total: script.length, voice: used });
    }
    if (mine === run.current) {
      mark(null);
      setReading((r) => (r ? { ...r, index: r.total } : r));
    }
  };

  const readResult = () => {
    if (result) void sayWithPilo(answerText(result.answer), voice);
  };

  const copy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(answerText(result.answer));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      /* sin portapapeles */
    }
  };

  const head: Record<View, [PiloMood, string, string]> = {
    menu: ["feliz", "Mr. Pilo", "Hola, ¿le ayudo?"],
    escuchar: ["feliz", "Leyendo en voz alta", page || "Esta página"],
    resumir: [busy ? "piensa" : error ? "cuidado" : "idea", busy ? "Pensando" : "Resumen · hecho con IA", busy ? "Leo la página…" : "Lo esencial"],
    sintetizar: [busy ? "piensa" : error ? "cuidado" : "excelente", busy ? "Pensando" : "Síntesis · hecha con IA", busy ? "Cruzo las secciones…" : "Lo que dicen juntas"],
    explicar: [busy ? "piensa" : error ? "cuidado" : "piensa2", busy ? "Pensando" : "Explicar", part !== null ? sections[part]?.title ?? "La sección" : "Elija una gráfica o tabla"],
  };
  const [mood, kicker, heading] = head[view];

  const tiles = [
    here.actions.leer && { id: "escuchar", short: "Voz", name: "Escuchar la página", desc: "Se la leo en voz alta, en orden.", go: listen },
    here.actions.resumir && { id: "resumir", short: "Re", name: "Resumir esta página", desc: "Lo esencial en pocas frases.", go: () => ask("resumir") },
    here.actions.sintetizar && { id: "sintetizar", short: "Si", name: "Sintetizar", desc: "Qué dicen juntas sus tablas y gráficas.", go: () => ask("sintetizar") },
    here.actions.explicar && { id: "explicar", short: "?", name: "Explicarme una gráfica", desc: "Elija una y se la cuento.", go: () => setView("explicar") },
    tour && { id: "recorrido", short: "→", name: "Recorrido guiado", desc: "Le muestro cómo funciona este portal.", go: () => { close(); startTour(tour.id); } },
  ].filter(Boolean) as { id: string; short: string; name: string; desc: string; go: () => void }[];

  return (
    <>
      {view === "explicar" && <Markers sections={sections} active={part} onPick={(i) => { setPart(i); mark(sections[i].element); void ask("explicar", sections[i]); }} />}
      <aside ref={panel} className="pai-panel" aria-label="Mr. Pilo" data-view={view}>
        <header className="pai-panel__head">
          {view !== "menu" && (
            <button type="button" className="pai-round" onClick={back} aria-label="Volver">
              <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
          )}
          <button type="button" className="pai-round pai-round--close" onClick={close} aria-label="Cerrar a Mr. Pilo">
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          <span className="pai-panel__face" data-big={view === "menu" || undefined}>
            <PiloAvatar mood={mood} size={view === "menu" ? 92 : 60} alive={busy || Boolean(reading && reading.index < reading.total)} />
          </span>
          <div>
            <span className="pai-panel__kicker">{kicker}</span>
            <h2 tabIndex={-1}>{heading}</h2>
          </div>
        </header>

        <div className="pai-panel__body" aria-live="polite">
          {view === "menu" && (
            <>
              <p className="pai-lead">
                Estoy en <strong>{page || "esta página"}</strong>. ¿Qué hago con ella?
              </p>
              <div className="pai-tiles">
                {tiles.map((t, i) => (
                  <button key={t.id} type="button" className="pai-tile" onClick={t.go} style={{ "--i": i } as CSSProperties}>
                    <span className="pai-tile__icon" data-first={i === 0 || undefined}>
                      {t.short}
                    </span>
                    <span>
                      <strong>{t.name}</strong>
                      <small>{t.desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          {view === "escuchar" && (
            <div className="pai-listen">
              <div className="pai-wave" data-on={(reading && reading.index < reading.total) || undefined} aria-hidden="true">
                {Array.from({ length: 14 }, (_, i) => (
                  <i key={i} style={{ "--i": i } as CSSProperties} />
                ))}
              </div>
              <p>
                {reading && reading.index >= reading.total
                  ? "Terminé. ¿Le resumo lo esencial?"
                  : "Leo la página en orden: el título y cada gráfica y tabla. Lo que suena se marca en la página."}
              </p>
              {reading && (
                <div className="pai-progress">
                  <span style={{ width: `${(Math.min(reading.index + 1, reading.total) / reading.total) * 100}%` }} />
                </div>
              )}
              <small>
                {reading ? `Parte ${Math.min(reading.index + 1, reading.total)} de ${reading.total}` : "Preparando la voz…"}
                {reading?.voice === "navegador" && advanced ? " · con la voz del navegador" : ""}
              </small>
            </div>
          )}

          {(view === "resumir" || view === "sintetizar" || view === "explicar") && busy && (
            <div className="pai-skeleton" role="status">
              <i />
              <i />
              <i />
              <i />
              <span>Suele tardar unos segundos. Puede seguir mirando la página.</span>
            </div>
          )}

          {error && !busy && (
            <div className="pai-error">
              <p>{error.message}</p>
              <div>
                <button type="button" className="pai-btn" onClick={listen}>
                  Leer la página con voz
                </button>
                {error.code !== "limite" && view !== "explicar" && (
                  <button type="button" className="pai-btn pai-btn--ghost" onClick={() => ask(view as "resumir" | "sintetizar")}>
                    Reintentar
                  </button>
                )}
              </div>
            </div>
          )}

          {view === "resumir" && result && !busy && (
            <ol className="pai-points">
              {(result.answer.puntos ?? []).map((p, i) => (
                <li key={i}>
                  <span>{i + 1}</span>
                  <div>
                    <p>{p.texto}</p>
                    {p.fuente && <small>{p.fuente}</small>}
                  </div>
                </li>
              ))}
            </ol>
          )}

          {view === "sintetizar" && result && !busy && (
            <div className="pai-synth">
              {result.answer.principal && (
                <div className="pai-synth__main">
                  <small>Lo más importante</small>
                  <p>{result.answer.principal}</p>
                </div>
              )}
              {(result.answer.hallazgos ?? []).map((h) => (
                <p key={h} className="pai-synth__item">
                  {h}
                </p>
              ))}
              {(result.answer.preguntas ?? []).length > 0 && <small className="pai-label">Preguntas para decidir</small>}
              {(result.answer.preguntas ?? []).map((q) => (
                <p key={q} className="pai-synth__ask">
                  {q}
                </p>
              ))}
            </div>
          )}

          {view === "explicar" && !busy && (
            <>
              {!result && !error && <p className="pai-lead">Numeré en la página las gráficas y tablas. ¿Cuál le explico?</p>}
              {result?.answer.explicacion && <p className="pai-explain">{result.answer.explicacion}</p>}
              <div className="pai-parts">
                {sections.map((s, i) => (
                  <button
                    key={`${s.title}-${i}`}
                    type="button"
                    aria-pressed={part === i}
                    onClick={() => {
                      setPart(i);
                      mark(s.element);
                      void ask("explicar", s);
                    }}
                  >
                    <span>{i + 1}</span>
                    {s.title}
                  </button>
                ))}
                {sections.length === 0 && <p className="pai-lead">No encontré gráficas ni tablas en esta página.</p>}
              </div>
            </>
          )}

          {result && !busy && !result.verified && (
            <p className="pai-warn">
              Revise estos números antes de citarlos: no los encontré en la página ({result.unknown.join(", ")}).
            </p>
          )}
        </div>

        <footer className="pai-panel__foot">
          {result && !busy && (
            <div className="pai-actions">
              <button type="button" className="pai-btn" onClick={readResult}>
                <SpeakerIcon size={16} /> Escuchar
              </button>
              <button type="button" className="pai-btn pai-btn--ghost" onClick={copy}>
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
          )}
          {view === "escuchar" && (
            <div className="pai-actions">
              <button type="button" className="pai-btn" onClick={back}>
                Detener
              </button>
              {here.actions.resumir && (
                <button type="button" className="pai-btn pai-btn--ghost" onClick={() => ask("resumir")}>
                  Resumir
                </button>
              )}
            </div>
          )}
          <p className="pai-note">
            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12l5 5 9-10" />
            </svg>
            {result
              ? `${result.cached ? "Resumen guardado" : "Hecho con IA"} sobre las cifras publicadas en esta página.${result.verified ? " Cada número está en la página." : ""}`
              : "Uso solo lo que está publicado en esta página."}
            {adminOnly && <em>Solo administración</em>}
          </p>
        </footer>
      </aside>
    </>
  );
}

/** Los números sobre la página, para elegir qué gráfica o tabla explicar. */
function Markers({ sections, active, onPick }: { sections: PageSection[]; active: number | null; onPick: (i: number) => void }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const redraw = () => tick((n) => n + 1);
    window.addEventListener("scroll", redraw, true);
    window.addEventListener("resize", redraw);
    return () => {
      window.removeEventListener("scroll", redraw, true);
      window.removeEventListener("resize", redraw);
    };
  }, []);
  return (
    <>
      {sections.map((s, i) => {
        const r = s.element.getBoundingClientRect();
        if (r.bottom < 0 || r.top > window.innerHeight) return null;
        return (
          <button
            key={i}
            type="button"
            className="pai-marker"
            aria-label={`Explicar ${s.title}`}
            aria-pressed={active === i}
            style={{ top: Math.max(8, r.top - 12), left: Math.max(8, r.left - 12) }}
            onClick={() => onPick(i)}
          >
            {i + 1}
          </button>
        );
      })}
    </>
  );
}
