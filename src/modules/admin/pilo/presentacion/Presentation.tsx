/* =============================================================================
   Intranet · Mr. Pilo con IA · Presentación de Investigación en Innovación Educativa.

   Pieza interactiva de investigación y divulgación científica (AIED · UDES):
   «Arquitectura Cognitiva de Doble Flujo (Dual-Stream Memory) con Alineación
   Ontológica Cruzada y Razonamiento Neuronal con Gemma 4 31B».

   Explica el funcionamiento técnico de Mr. Pilo para pares académicos, comités
   curriculares e investigadores:
     1. Desacoplamiento ontológico en dos hemisferios cerebrales (Estratégico vs. Curricular).
     2. Multimodalidad y computación segura en el borde (Edge AI · Archivos y Código).
     3. Ingesta y estímulo sensorial de consultas.
     4. Autómata determinista de enrutamiento O(1) a 0 créditos de GPU.
     5. Recuperación semántica híbrida (densa vectorial + dispersa BM25/FTS).
     6. Puentes de ontología cruzada y protocolo de lectura «de visita» (0122).
     7. Inferencia profunda con Gemma 4 31B acelerada en NVIDIA TensorRT / NIM.
     8. Síntesis epistémica y anclaje factual estricto (Strict Grounding).
     9. Laboratorio interactivo de telemetría y topología de red.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { usePillars, useProjects, useStructure } from "../../../../data/queries";
import { useOpenDataCatalog } from "../../../datos-abiertos/data/open-data";
import { OBS_TOPICS } from "../../../datos-abiertos/observatorio/data";
import {
  ALL_SOURCES,
  buildModel,
  createStage,
  SOURCES,
  STEP_COUNT,
  stageTheme,
} from "./engine";
import type { PresentationData, SourceKey, StageHandle } from "./engine";
import { Pilo } from "../../../pregunta/Pilo";
import type { MojiMood } from "../../../pregunta/Pilo";
import { PiloWelcomeSpeaker } from "./PiloWelcomeSpeaker";
import "./presentation.css";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const MONEY = /dinero|peso|\$|cop\b|millones|presupuest/i;

/** Datos del plan institucional con la topología real del Mapa numerado. */
function usePresentationData(): { data: PresentationData | null; loading: boolean; error: boolean } {
  const pillars = usePillars();
  const structure = useStructure();
  const projects = useProjects();
  const catalog = useOpenDataCatalog();

  const data = useMemo(() => {
    if (!pillars.data || !structure.data || !projects.data) return null;
    const ordered = pillars.data.filter((p) => p.status === "publicado" && !MONEY.test(p.name)).sort((a, b) => a.position - b.position);
    const pIndex = new Map(ordered.map((p, i) => [p.id, i]));
    const areas = structure.data.filter((a) => pIndex.has(a.pillar_id)).sort((a, b) => pIndex.get(a.pillar_id)! - pIndex.get(b.pillar_id)! || a.position - b.position);

    const out: PresentationData = {
      pillars: ordered.map((p, i) => ({ code: `P${i + 1}`, name: p.name })),
      areas: [],
      lines: [],
      projects: [],
      reports: (catalog.data?.reports ?? []).map((r) => ({ code: r.code, name: r.name })),
      obs: OBS_TOPICS.map((t) => t.name),
    };

    const areaIndex = new Map<string, number>();
    const lineIndex = new Map<string, number>();

    for (const a of areas) {
      areaIndex.set(a.id, out.areas.length);
      out.areas.push({ code: `AE${out.areas.length + 1}`, name: a.name, p: pIndex.get(a.pillar_id)! });
      for (const l of [...(a.action_lines ?? [])].sort((x, y) => x.position - y.position)) {
        lineIndex.set(l.id, out.lines.length);
        out.lines.push({ code: `LA${out.lines.length + 1}`, name: l.name, a: areaIndex.get(a.id)! });
      }
    }

    for (const r of [...projects.data].sort((a, b) => a.position - b.position)) {
      if (MONEY.test(r.name)) continue;
      const to: ["l" | "a", number][] = [];
      for (const link of r.links ?? []) {
        if (link.action_line_id && lineIndex.has(link.action_line_id)) to.push(["l", lineIndex.get(link.action_line_id)!]);
        else if (link.area_id && areaIndex.has(link.area_id)) to.push(["a", areaIndex.get(link.area_id)!]);
      }
      if (to.length) out.projects.push({ code: `PR${out.projects.length + 1}`, name: r.name, to });
    }

    return out;
  }, [pillars.data, structure.data, projects.data, catalog.data]);

  return {
    data,
    loading: pillars.isPending || structure.isPending || projects.isPending,
    error: pillars.isError || structure.isError || projects.isError,
  };
}

interface Step {
  short: string;
  phaseCode: string;
  layer?: number;
  /** La cara de Pilo en la cabecera durante la fase. */
  face: MojiMood;
  title: string;
  body: ReactNode;
  extra?: ReactNode;
}

const ICON = { width: 15, height: 15, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2.2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

export function Presentation() {
  const navigate = useNavigate();
  const { data, loading, error } = usePresentationData();
  const model = useMemo(() => (data ? buildModel(data) : null), [data]);
  const [step, setStep] = useState(0);
  /** La bienvenida de Pilo abre la presentación; se vuelve a ver tocando a Pilo en la cabecera. */
  const [welcome, setWelcome] = useState(true);
  /** Sobre blanco de partida; «noche» es la escena con que nació la presentación. */
  const [night, setNight] = useState(false);

  const initialOn = useMemo(() => {
    const map = {} as Record<SourceKey, boolean>;
    for (const k of ALL_SOURCES) map[k] = true;
    return map;
  }, []);

  const [on, setOn] = useState<Record<SourceKey, boolean>>(initialOn);
  const [bridgesOn, setBridgesOn] = useState(true);

  const canvas = useRef<HTMLCanvasElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const story = useRef<HTMLElement>(null);
  const slot = useRef<HTMLButtonElement>(null);
  const stage = useRef<StageHandle | null>(null);
  const last = useRef(-1);
  const welcomeOpen = useRef(welcome);
  welcomeOpen.current = welcome;

  useEffect(() => {
    const before = document.title;
    document.title = "Investigación AIED · La Capa Profunda de Mr. Pilo · UDES";
    return () => {
      document.title = before;
    };
  }, []);

  // La malla sigue al fondo: desde el cuadro siguiente pinta con los colores de ese fondo.
  useLayoutEffect(() => {
    stageTheme.light = !night;
  }, [night]);

  useEffect(() => {
    if (!model || !canvas.current || !host.current || !tip.current) return;
    const s = createStage(canvas.current, host.current, tip.current, model, reduced());
    stage.current = s;
    last.current = -1;
    return () => {
      s.destroy();
      stage.current = null;
    };
  }, [model]);

  useLayoutEffect(() => {
    const s = stage.current;
    if (!s) return;
    s.step(step);
    s.setExplore(step === STEP_COUNT - 1);
    const back = step < last.current;
    last.current = step;

    if (!reduced() && story.current) {
      const ctx = gsap.context(() => {
        gsap.from(story.current!.children, {
          autoAlpha: 0,
          y: back ? -8 : 10,
          duration: 0.38,
          stagger: 0.05,
          ease: "power2.out",
        });
      }, story);
      return () => ctx.revert();
    }
  }, [step, model]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Mientras Pilo da la bienvenida, las teclas son suyas.
      if (welcomeOpen.current) return;
      if (["ArrowRight", "PageDown", " "].includes(e.key)) {
        if (e.key === " " && e.target instanceof HTMLElement && e.target.closest("button, a")) return;
        e.preventDefault();
        setStep((s) => Math.min(STEP_COUNT - 1, s + 1));
      } else if (["ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        setStep((s) => Math.max(0, s - 1));
      } else if (e.key === "Home") setStep(0);
      else if (e.key === "End") setStep(STEP_COUNT - 1);
      else if (e.key === "Escape" && !document.fullscreenElement) navigate("/admin/mr-pilo?seccion=memoria");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const fullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen();
    } catch {
      /* sin pantalla completa */
    }
  };

  const toggle = (k: SourceKey) => {
    const next = !on[k];
    setOn((o) => ({ ...o, [k]: next }));
    stage.current?.toggleSource(k, next);
  };

  const toggleBridges = () => {
    const next = !bridgesOn;
    setBridgesOn(next);
    stage.current?.toggleBridges(next);
  };

  const dot = (k: SourceKey) => <i style={{ background: `var(--cpp-s-${k})` }} />;

  const steps: Step[] = model
    ? [
        // 0. Arquitectura Cognitiva de Doble Flujo
        {
          short: "Dual-Stream",
          phaseCode: "FASE 0 · ARQUITECTURA COGNITIVA",
          face: "feliz",
          title: "Desacoplamiento ontológico: arquitectura bio-inspirada de doble flujo",
          body: (
            <>
              En Inteligencia Artificial aplicada a la Educación Superior (AIED), un sistema RAG monolítico produce
              interferencias al cruzar metas de gestión directiva con lineamientos pedagógicos de aula. Mr. Pilo resuelve
              esto con una <b>arquitectura cognitiva de dos hemisferios</b>: el <b>Hemisferio Estratégico</b> (Planeación:
              PDI, SNIES/CNA, UDES en Cifras) y el <b>Hemisferio Curricular</b> (Enseñanza: innovación didáctica,
              resultados de aprendizaje y aulas Moodle).
            </>
          ),
          extra: (
            <>
              <div className="cpp-mini">
                <span>Mr. Pilo presenta esta investigación con su propia voz</span>
                <button type="button" onClick={() => setWelcome(true)}>
                  Escuchar a Mr. Pilo
                </button>
              </div>
              <div className="cpp-spec-grid">
                <div className="cpp-spec-box">
                  <span>Hemisferio Estratégico</span>
                  <b>{model.counts.nodes} nodos</b>
                  <small>PDI · Cifras · Observatorio</small>
                </div>
                <div className="cpp-spec-box">
                  <span>Hemisferio Curricular</span>
                  <b>{model.counts.teachNodes} nodos</b>
                  <small>Modelos · RA · Moodle</small>
                </div>
                <div className="cpp-spec-box">
                  <span>Sinapsis inter-dominio</span>
                  <b>{model.counts.bridges} puentes</b>
                  <small>Alineación 0122 (ODS y leyes)</small>
                </div>
                <div className="cpp-spec-box">
                  <span>Topología total</span>
                  <b>{model.counts.totalNodes} neuronas</b>
                  <small>Dual-Stream Knowledge Graph</small>
                </div>
              </div>
              <span className="cpp-hemi-title">Fuentes ontológicas mapeadas</span>
              <div className="cpp-chips">
                {ALL_SOURCES.map((k) => (
                  <span key={k} className="cpp-chip">
                    {dot(k)}
                    {SOURCES[k].name}
                  </span>
                ))}
              </div>
            </>
          ),
        },

        // 1. Multimodalidad, privacidad en el dispositivo y las capacidades nuevas
        {
          short: "Edge AI",
          phaseCode: "FASE 1 · COMPUTACIÓN EN EL BORDE",
          face: "sorpresa",
          title: "Multimodalidad en el cliente y preservación de privacidad perimetral",
          body: (
            <>
              La investigación en innovación educativa exige estricta privacidad de los datos institucionales. Mr. Pilo
              incorpora <b>computación perimetral (Edge AI)</b>: los archivos no se suben a servidores externos; se
              analizan en el navegador de la persona.
            </>
          ),
          extra: (
            <div className="cpp-actions-grid">
              <div className="cpp-action-card">
                <b>
                  <svg {...ICON}>
                    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                  </svg>
                  Edge Document Parser
                </b>
                <span>Lectura del archivo en el dispositivo (PDF o XLSX): no se guarda en el servidor.</span>
              </div>
              <div className="cpp-action-card">
                <b>
                  <svg {...ICON}>
                    <polyline points="16 18 22 12 16 6" />
                    <polyline points="8 6 2 12 8 18" />
                  </svg>
                  Learning Analytics Code
                </b>
                <span>Scripts analíticos (SQL, TypeScript, fórmulas CNA/SNIES y tasas de retención).</span>
              </div>
              <div className="cpp-action-card">
                <b>
                  <svg {...ICON}>
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  Persona Conditioning
                </b>
                <span>El tono cambia con el perfil: estudiante, profesor o administrativo.</span>
              </div>
              <div className="cpp-action-card">
                <b>
                  <svg {...ICON}>
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  Facts verificados
                </b>
                <span>Cada cifra se verifica contra pilo_facts, con su corte y su fuente.</span>
              </div>
              <div className="cpp-action-card">
                <b>
                  <svg {...ICON}>
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  Catálogo compartido
                </b>
                <span>Nuevo: una respuesta oficial puede servir a todos los Pilos y entra a la memoria.</span>
              </div>
              <div className="cpp-action-card">
                <b>
                  <svg {...ICON}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                  Colecciones propias
                </b>
                <span>Nuevo: cada oficina crea sus colecciones de documentos y decide cuándo se leen.</span>
              </div>
            </div>
          ),
        },

        // 2. Vector de entrada y estímulo sensorial
        {
          short: "Estímulo",
          phaseCode: "FASE 2 · INGESTA SENSORIAL",
          face: "piensa",
          title: "Ingesta del vector de consulta y estímulo sensorial en lenguaje natural",
          body: (
            <>
              La interacción inicia con una consulta en lenguaje natural. El estímulo se vectoriza en tiempo real
              mientras se evalúan los atajos reflejos.
            </>
          ),
          extra: (
            <>
              <div className="cpp-q">{model.question}</div>
              <div className="cpp-row">
                <span className="cpp-research-tag">Vector de entrada: 1.024 dimensiones</span>
                <span className="cpp-research-tag">Intención: PDI ↔ Currículo ↔ ODS</span>
              </div>
            </>
          ),
        },

        // 3. Autómata de enrutamiento determinista
        {
          short: "Filtros 0cr",
          phaseCode: "FASE 3 · ENRUTAMIENTO REFLEJO",
          layer: 1,
          face: "feliz",
          title: "Autómata reflejo determinista: cero consumo de GPU",
          body: (
            <>
              Gobernanza de costos en IA universitaria: antes de activar la inferencia en la nube, el{" "}
              <b>catálogo institucional</b> y el <b>motor de reglas duras</b> (protección de datos, dinero, límites
              éticos) resuelven de forma determinista.
            </>
          ),
          extra: (
            <>
              <div className="cpp-credits">
                Costo computacional: <b>0 créditos de GPU consumidos</b>
              </div>
              <div className="cpp-meter">
                <div>
                  <b>0</b>
                  <small>pedidos al modelo</small>
                </div>
                <div>
                  <b>2</b>
                  <small>vetos: dinero y datos personales</small>
                </div>
                <div>
                  <b>0,80</b>
                  <small>parecido mínimo con el catálogo</small>
                </div>
              </div>
            </>
          ),
        },

        // 4. Recuperación semántica híbrida
        {
          short: "Pasajes",
          phaseCode: "FASE 4 · RECUPERACIÓN HÍBRIDA",
          layer: 2,
          face: "piensa",
          title: "Recuperación semántica híbrida: espacio vectorial denso y concordancia dispersa",
          body: (
            <>
              Para consultas inéditas, el sistema despliega una <b>recuperación híbrida (Dense + Sparse)</b>: similitud
              coseno sobre embeddings combinada con concordancia léxica en español normalizado. Se activan las neuronas
              de memoria del hemisferio de casa.
            </>
          ),
          extra: (
            <div className="cpp-meter">
              <div>
                <b>{model.matches.size}</b>
                <small>clústeres semánticos encendidos</small>
              </div>
              <div>
                <b>{model.counts.totalNodes}</b>
                <small>neuronas en la corteza</small>
              </div>
              <div>
                <b>0,30</b>
                <small>parecido mínimo por significado</small>
              </div>
            </div>
          ),
        },

        // 5. Puentes de ontología cruzada y lectura de visita
        {
          short: "Puentes",
          phaseCode: "FASE 5 · ALINEACIÓN ONTOLÓGICA",
          layer: 3,
          face: "sorpresa",
          title: "Puentes ontológicos inter-dominio y protocolo de lectura «de visita»",
          body: (
            <>
              Aporte conceptual central del proyecto: la migración 0122 define <b>puentes ontológicos formales</b> que
              conectan el PDI con el marco pedagógico: <b>ODS 4</b>, <b>Ley 30 de 1992</b> y <b>Decreto 1330</b>. Si un
              hemisferio no tiene suficiente contexto, la señal cruza el puente con el{" "}
              <b>protocolo de lectura «de visita»</b>, preservando la procedencia.
            </>
          ),
          extra: (
            <div className="cpp-card cpp-card--amber">
              <span className="cpp-badge cpp-badge--amber">Puente ontológico formal · Protocolo 0122</span>
              <p>
                <b>PDI ↔ ODS 4 y resultados de aprendizaje.</b> Conexión formal entre las metas del Plan y las
                competencias evaluables en el aula. Los puentes que propone la IA entran como propuesta y la
                administración los aprueba uno por uno.
              </p>
              <div className="cpp-credits">
                Trazabilidad: <b>a lo sumo 2 pasajes de visita, con su procedencia</b>
              </div>
            </div>
          ),
        },

        // 6. Inferencia con Gemma 4 31B
        {
          short: "Gemma 31B",
          phaseCode: "FASE 6 · INFERENCIA NEURONAL",
          layer: 4,
          face: "piensa",
          title: "Inferencia y razonamiento relacional con Gemma 4 31B (NVIDIA NIM)",
          body: (
            <>
              Cuando la consulta requiere correlacionar evidencia dispersa entre ambos hemisferios, interviene{" "}
              <b>Gemma 4 31B</b>. Redacta con lo que Pilo encontró por delante, anclado en una barrera de{" "}
              <b>Strict Factual Grounding</b>: toda cifra o hecho de la UDES sale de los bloques y lleva su cita.
            </>
          ),
          extra: (
            <div className="cpp-card">
              <span className="cpp-badge">NVIDIA NIM · google/gemma-4-31b-it</span>
              <div className="cpp-lines">
                <div>
                  <b>Un solo pedido:</b> oficial, guardada, cifras y pasajes, numerados
                </div>
                <div>
                  <b>Contexto:</b> 3.500 tokens, lo de visita con su sitio apartado
                </div>
                <div>
                  <b>Barrera:</b> sin fuente no hay cifra institucional
                </div>
              </div>
            </div>
          ),
        },

        // 7. Síntesis y verificación
        {
          short: "Síntesis",
          phaseCode: "FASE 7 · CONSTRUCTO EPISTÉMICO",
          layer: 5,
          face: "feliz",
          title: "Síntesis epistémica multidominio con verificación factual auditada",
          body: (
            <>
              La respuesta es un constructo verificable: articula la evidencia del Hemisferio Estratégico con las
              directivas del Hemisferio Curricular. Cada afirmación lleva su cita, para que se pueda auditar.
            </>
          ),
          extra: (
            <div className="cpp-card">
              <span className="cpp-badge">Constructo epistémico · Síntesis multidominio verificada</span>
              <p>
                {model.answer} <span className="cpp-cite">1</span> <span className="cpp-cite">2</span>
              </p>
              <div className="cpp-credits">
                Auditoría: <b>citas, números y dinero se revisan antes de mostrar</b>
              </div>
            </div>
          ),
        },

        // 8. Laboratorio interactivo
        {
          short: "Laboratorio",
          phaseCode: "FASE 8 · EXPERIMENTACIÓN",
          face: "feliz",
          title: "Laboratorio interactivo de telemetría y topología de red",
          body: (
            <>
              Explore la topología del grafo cerebral: audite los puentes ontológicos, inspeccione cada nodo con el
              cursor y alterne la visibilidad de cada fuente en la malla.
            </>
          ),
          extra: (
            <>
              <div className="cpp-chips">
                <button type="button" className="cpp-chip" aria-pressed={bridgesOn} onClick={toggleBridges}>
                  <i style={{ background: "var(--cpp-amber)" }} />
                  Puentes ontológicos
                </button>
              </div>
              <span className="cpp-hemi-title">Filtrar ontologías en la malla</span>
              <div className="cpp-chips">
                {ALL_SOURCES.map((k) => (
                  <button key={k} type="button" className="cpp-chip" aria-pressed={on[k]} onClick={() => toggle(k)}>
                    {dot(k)}
                    {SOURCES[k].name}
                  </button>
                ))}
              </div>
            </>
          ),
        },
      ]
    : [];

  const current = steps[step];

  return (
    <div className="cpp" data-fondo={night ? "noche" : undefined}>
      <header className="cpp-top">
        <button
          ref={slot}
          className="cpp-pilo"
          type="button"
          aria-label="Volver a ver la bienvenida de Mr. Pilo"
          title="Volver a ver la bienvenida"
          onClick={() => setWelcome(true)}
        >
          <Pilo size={40} label="" mood={current?.face ?? "feliz"} />
        </button>
        <div className="cpp-brand">
          <b>Mr. Pilo · AIED Research Engine</b>
          <span>Investigación e Innovación Pedagógica · Universidad de Santander UDES</span>
        </div>
        <span className="cpp-tag">Dual-Stream Cognitive Architecture · Malla 0122</span>
        <button className="cpp-ghost" type="button" aria-pressed={night} onClick={() => setNight((n) => !n)}>
          {night ? "Fondo: noche" : "Fondo: blanco"}
        </button>
        <button className="cpp-ghost" type="button" onClick={fullscreen}>
          Pantalla completa
        </button>
        <Link className="cpp-ghost" to="/admin/mr-pilo?seccion=memoria">
          Salir
        </Link>
      </header>

      <section className="cpp-story" ref={story} aria-live="polite" key={step}>
        {!model ? (
          <p>
            {error
              ? "No se pudo leer la topología de la memoria. Revise la conexión a la base y vuelva a intentar."
              : loading
                ? "Compilando telemetría de la red neuronal…"
                : "No hay datos de red para proyectar."}
          </p>
        ) : current ? (
          <>
            <div className="cpp-row">
              <span className="cpp-research-tag">{current.phaseCode}</span>
              {current.layer ? (
                <div className="cpp-layer">
                  <i>{current.layer}</i>Capa cognitiva {current.layer} de 5
                </div>
              ) : null}
            </div>
            <h1>{current.title}</h1>
            <p>{current.body}</p>
            {current.extra ? <div className="cpp-extra">{current.extra}</div> : null}
          </>
        ) : null}
      </section>

      <div className="cpp-stage" ref={host}>
        <canvas ref={canvas} role="img" aria-label="Malla cerebral de Mr. Pilo: dos hemisferios de memoria, sus capas y los puentes que los unen" />
        <div className="cpp-tip" ref={tip} />
      </div>

      <nav className="cpp-rail" aria-label="Fases de la presentación de investigación">
        <div className="cpp-steps">
          {(steps.length ? steps : Array.from({ length: STEP_COUNT }, () => ({ short: "" }) as Step)).map((s, i) => (
            <button
              key={i}
              type="button"
              className="cpp-step"
              aria-current={i === step ? "step" : undefined}
              aria-label={`Fase ${i + 1}${s.short ? `: ${s.short}` : ""}`}
              style={{ ["--f" as string]: i <= step ? 1 : 0 }}
              onClick={() => setStep(i)}
            >
              <i />
              <span>{s.short}</span>
            </button>
          ))}
        </div>
        <div className="cpp-nav">
          <button className="cpp-round" type="button" aria-label="Fase anterior" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </button>
          <button
            className="cpp-round cpp-round--main"
            type="button"
            aria-label="Fase siguiente"
            disabled={step === STEP_COUNT - 1}
            onClick={() => setStep((s) => Math.min(STEP_COUNT - 1, s + 1))}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
        </div>
        <span className="cpp-keys">← → avanzar/retroceder · Espacio · Esc salir</span>
      </nav>

      {welcome ? <PiloWelcomeSpeaker target={slot} onFaceChange={(f) => stage.current?.setFace?.(f)} onDone={() => setWelcome(false)} /> : null}
    </div>
  );
}
