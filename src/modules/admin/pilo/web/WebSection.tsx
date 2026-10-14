/* =============================================================================
   Intranet · Mr. Pilo con IA · Páginas web (0129).

   La administración le da a Pilo la dirección de una página pública. Pilo la
   lee desde el servidor y la deja en su memoria como cualquier otro documento:
   pasajes, vectores (búsqueda por significado) y su lugar en el mapa, donde
   «comprender» la conecta con lo demás que Pilo sabe. Desde ese momento entra
   en sus respuestas, en la colección que se elija.

   La pantalla es una mesa: a la izquierda la dirección, la preparación paso a
   paso y las páginas ya leídas; a la derecha la malla de la página, que se
   arma mientras Pilo la lee, y debajo una consulta de prueba: qué pasajes
   encontraría y, si se pide, qué respondería (con lo que va pensando).

   No hay tubería nueva: «web» lee y guarda; indexar y comprender son los de
   Memoria. Lo que aquí se guarda se ve también en Memoria › Páginas en la
   memoria, y desde allá se quita.

   Con navegador (0132): si la administración conectó el servicio de navegador
   (abajo, en «Navegador»), cada lectura puede pedir que la página se abra con
   él: ejecuta su JavaScript y despliega pestañas y acordeones. La casilla solo
   aparece con el servicio encendido; el resultado dice cuántos despliegues
   hizo, o que se leyó sin ejecutar JavaScript y por qué.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { askQuestionStream } from "../../../../components/pilo/ai/client";
import type { AskMeta } from "../../../../components/pilo/ai/client";
import { PiloAvatar } from "../../../../components/pilo/PiloAvatar";
import type { PiloMood } from "../../../../components/pilo/PiloAvatar";
import { Icon } from "../../../../components/ui/Icon";
import { reduceSteps, secondsText, waitingLine, waitingTip } from "../../../pregunta/answer-state";
import type { ThinkStep } from "../../../pregunta/answer-state";
import { comprehendDoc, indexPending, piloStep, useDocPassages, useDocs, useRefreshMemory, useTeachMap } from "../../pilo-ensenanza/memoria/data";
import { comprehendNext, faultOf } from "../../pilo-ensenanza/memoria/flow";
import type { Fault } from "../../pilo-ensenanza/memoria/flow";
import { FaultNote } from "../../pilo-ensenanza/memoria/parts";
import { useCreateCollection } from "../collections";
import { useTryMemory } from "../memory";
import { GENERAL_COLLECTIONS, docCollections, effectiveCell, usePortals } from "../portals";
import { DEFAULT_SPACE } from "../space";
import { Group, plural, when } from "../ui";
import { BrowserService } from "./BrowserService";
import { useBrowser } from "./browser";
import { buildMesh, buildTopics, pulse, scan } from "./motion";
import { MESH_PASSAGES, browserLine, checkWebUrl, curve, hitsOf, prepRead, prepSet, prepStart, simText, topSection, topicsOf, webMesh, webWhere } from "./web";
import type { PrepId, PrepStep, WebHit, WebPageView, WebRead, WebTopic } from "./web";
import "../../pilo-ensenanza/pilo-ensenanza.css";
import "./web.css";

const SPACE = DEFAULT_SPACE;
const NEW_COLLECTION = "__paginas_web";
const NEW_NAME = "Páginas web";
/** Cuántos lotes de «comprender» se hacen de corrido por una página: lo que falte sigue en Memoria. */
const CONNECT_ROUNDS = 12;

/** El gesto de Pilo según lo que está haciendo. Nunca solo: lo acompaña la línea de al lado. */
function moodOf(steps: PrepStep[], busy: boolean, failed: boolean, tick: number): PiloMood {
  if (failed) return "duda";
  if (!busy) return steps.every((s) => s.state === "done" || s.state === "skip") && steps[0].state === "done" ? "excelente" : "feliz";
  const running = steps.find((s) => s.state === "run")?.id;
  if (running === "indexar" || running === "conectar") return tick % 2 ? "idea" : "piensa";
  return tick % 2 ? "piensa2" : "piensa";
}

function StepGlyph() {
  return (
    <svg className="pwb-glyph" viewBox="0 0 22 22" aria-hidden="true">
      <circle className="pwb-glyph__ring" cx="11" cy="11" r="7" />
      <circle className="pwb-glyph__disc" cx="11" cy="11" r="9" />
      <path className="pwb-glyph__arc" d="M11 4a7 7 0 0 1 7 7" />
      <path className="pwb-glyph__tick" d="M7 11.4l2.7 2.7L15.2 8.4" />
      <path className="pwb-glyph__dash" d="M7.5 11h7" />
      <path className="pwb-glyph__cross" d="M8 8l6 6M14 8l-6 6" />
    </svg>
  );
}

const STATE_WORD: Record<PrepStep["state"], string> = { pending: "pendiente", run: "en curso", done: "listo", skip: "queda para después", fail: "falló" };

/* --- La malla ---------------------------------------------------------------------------- */

function MeshStage({
  view,
  topics,
  lit,
  hits,
  selected,
  onSelect,
  buildKey,
  askKey,
}: {
  view: WebPageView;
  topics: WebTopic[];
  /** Cuántos pasajes (en orden) ya tienen vector. */
  lit: number;
  hits: WebHit[];
  selected: number | null;
  onSelect: (seq: number) => void;
  /** Cambia cuando la página se acaba de leer: la malla se arma. */
  buildKey: number;
  /** Cambia con cada consulta: la pregunta entra a la malla. */
  askKey: number;
}) {
  const svg = useRef<SVGSVGElement>(null);
  const mesh = useMemo(() => webMesh(view, topics), [view, topics]);
  const X = mesh.x;
  const own = useMemo(() => new Map(hits.filter((h) => h.seq !== null).map((h) => [h.seq as number, h])), [hits]);
  const asked = askKey > 0 && hits.length > 0;
  const onSections = new Set(mesh.passages.filter((p) => own.has(p.seq)).map((p) => p.section));
  const topicKey = mesh.topics.map((t) => t.id).join("|");

  useLayoutEffect(() => (buildKey ? buildMesh(svg.current) : undefined), [buildKey]);
  const hadTopics = useRef(topicKey);
  useLayoutEffect(() => {
    // Solo cuando llegan temas nuevos a una página que ya estaba en pantalla.
    const before = hadTopics.current;
    hadTopics.current = topicKey;
    return topicKey && topicKey !== before && buildKey ? buildTopics(svg.current) : undefined;
  }, [topicKey, buildKey]);
  useLayoutEffect(() => (asked ? scan(svg.current) : undefined), [askKey, asked]);

  const prevLit = useRef(lit);
  useEffect(() => {
    if (lit > prevLit.current && lit <= mesh.passages.length) pulse(svg.current?.querySelector<SVGElement>(`[data-kind="pasaje"][data-i="${lit - 1}"] .pwb-pop`) ?? null);
    prevLit.current = lit;
  }, [lit, mesh.passages.length]);

  return (
    <div className="pwb-frame" tabIndex={0} role="group" aria-label={`Malla de ${view.title}: ${mesh.sections.length} secciones, ${view.passages.length} pasajes y ${mesh.topics.length} temas`}>
      <svg ref={svg} className="pwb-mesh" viewBox={`0 0 ${mesh.width} ${mesh.height}`} data-asked={asked || undefined}>
        <text className="pwb-colhead" x={X.pagina} y={24} textAnchor="middle">Página</text>
        <text className="pwb-colhead" x={X.seccion} y={24} textAnchor="middle">Secciones</text>
        <text className="pwb-colhead" x={X.pasaje} y={24}>Pasajes</text>
        <text className="pwb-colhead" x={X.tema} y={24}>Temas y normas</text>

        <g>
          {mesh.sections.map((s, i) => (
            <path key={`ps${i}`} className="pwb-edge" data-e="ps" data-on={(asked && onSections.has(i)) || undefined} d={curve(X.pagina + 14, mesh.page.y, X.seccion, s.y)} />
          ))}
          {mesh.passages.map((p) => (
            <path key={`sp${p.seq}`} className="pwb-edge" data-e="sp" data-on={(asked && own.has(p.seq)) || undefined} d={curve(X.seccion, mesh.sections[p.section].y, X.pasaje, p.y)} />
          ))}
          {mesh.topics.flatMap((t) =>
            t.seqs.map((seq) => {
              const p = mesh.passages.find((x) => x.seq === seq);
              return p ? <path key={`pt${t.id}${seq}`} className="pwb-edge" data-e="pt" data-on={(asked && own.has(seq)) || undefined} d={curve(X.pasaje + 96, p.y, X.tema, t.y)} /> : null;
            }),
          )}
          {asked &&
            mesh.passages
              .filter((p) => own.has(p.seq))
              .map((p) => <path key={`ray${p.seq}`} className="pwb-ray" d={`M${mesh.query.x} ${mesh.query.y - 14}L${X.pasaje + 8} ${Math.round(p.y) + 3}`} />)}
        </g>

        <g className="pwb-node" data-kind="pagina" data-on={(asked && own.size > 0) || undefined}>
          <g className="pwb-pop" data-ox={X.pagina} data-oy={mesh.page.y}>
            <path className="pwb-sheet" d={`M${X.pagina - 13} ${mesh.page.y - 17}h18l8 8v26h-26z`} />
            <path className="pwb-rule" d={`M${X.pagina - 7} ${mesh.page.y - 3}h14M${X.pagina - 7} ${mesh.page.y + 3}h14M${X.pagina - 7} ${mesh.page.y + 9}h9`} />
            <text x={X.pagina} y={mesh.page.y + 36} textAnchor="middle">
              {view.title.length > 18 ? `${view.title.slice(0, 17)}…` : view.title}
            </text>
          </g>
        </g>

        {mesh.sections.map((s, i) => (
          <g key={`s${i}`} className="pwb-node" data-kind="seccion" data-on={(asked && onSections.has(i)) || undefined}>
            <g className="pwb-pop" data-ox={X.seccion} data-oy={s.y}>
              <circle className="pwb-dot" cx={X.seccion} cy={s.y} r={6} />
              <text x={X.seccion} y={s.y - 12} textAnchor="middle">
                {s.name.length > 30 ? `${s.name.slice(0, 29)}…` : s.name}
              </text>
            </g>
          </g>
        ))}

        {mesh.passages.map((p, i) => {
          const hit = own.get(p.seq);
          return (
            <g
              key={`p${p.seq}`}
              className="pwb-node"
              data-kind="pasaje"
              data-i={i}
              data-idx={i < lit || undefined}
              data-on={(asked && Boolean(hit)) || undefined}
              data-sel={selected === p.seq || undefined}
              tabIndex={0}
              role="button"
              aria-pressed={selected === p.seq}
              aria-label={`Pasaje ${p.seq}, de ${mesh.sections[p.section].name}${i < lit ? ", indexado" : ", sin indexar"}${hit ? `, ${simText(hit.sim)}` : ""}`}
              onClick={() => onSelect(p.seq)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.seq);
                }
              }}
            >
              <g className="pwb-pop" data-ox={X.pasaje} data-oy={p.y}>
                <rect className="pwb-hit" x={X.pasaje - 12} y={p.y - 12} width={112} height={24} rx={12} />
                <circle className="pwb-dot" cx={X.pasaje} cy={p.y} r={5} />
                <text className="pwb-codetext" x={X.pasaje + 11} y={p.y + 4}>
                  p{p.seq}
                </text>
                {asked && hit && (
                  <text className="pwb-score" x={X.pasaje + 38} y={p.y + 4}>
                    {hit.sim === null ? "palabras" : hit.sim.toFixed(2).replace(".", ",")}
                  </text>
                )}
              </g>
            </g>
          );
        })}

        {mesh.topics.map((t) => (
          <g key={t.id} className="pwb-node" data-kind="tema" data-norma={t.kind === "norma" || undefined} data-on={(asked && t.seqs.some((s) => own.has(s))) || undefined}>
            <g className="pwb-pop" data-ox={X.tema} data-oy={t.y}>
              <rect className="pwb-dot" x={X.tema - 5.5} y={t.y - 5.5} width={11} height={11} rx={2} transform={`rotate(45 ${X.tema} ${t.y})`} />
              <text x={X.tema + 14} y={t.y + (t.shared ? -1 : 4)}>
                {t.label.length > 26 ? `${t.label.slice(0, 25)}…` : t.label}
              </text>
              {t.shared > 0 && (
                <text className="pwb-shared" x={X.tema + 14} y={t.y + 12}>
                  también en {plural(t.shared, "documento", "documentos")}
                </text>
              )}
            </g>
          </g>
        ))}

        {asked && (
          <g className="pwb-q" data-ox={mesh.query.x} data-oy={mesh.query.y}>
            <rect x={mesh.query.x - 44} y={mesh.query.y - 14} width={88} height={28} rx={14} />
            <text x={mesh.query.x} y={mesh.query.y + 4} textAnchor="middle">Pregunta</text>
          </g>
        )}
        {mesh.more > 0 && (
          <text className="pwb-more" x={X.pasaje - 12} y={mesh.height - 58}>
            y {plural(mesh.more, "pasaje más", "pasajes más")}
          </text>
        )}
      </svg>
    </div>
  );
}

/* --- La sección ---------------------------------------------------------------------------- */

interface Answer {
  q: string;
  text: string;
  steps: ThinkStep[];
  thinking: string;
  meta: AskMeta | null;
  startedAt: number;
  done: boolean;
  error: string;
  seconds: number;
}

export function WebSection() {
  const portals = usePortals();
  const loading = portals.isPending;
  const missing = portals.data === null || portals.isError;
  const data = portals.data ?? null;
  const fromDb = data ? docCollections(data.sources, SPACE) : [];
  const collections = fromDb.length ? fromDb : GENERAL_COLLECTIONS;
  const general = data?.portals.find((p) => p.id === SPACE) ?? null;
  const off = missing || loading;

  const docs = useDocs(SPACE, !off);
  const map = useTeachMap(SPACE, !off);
  const refresh = useRefreshMemory(SPACE);
  const create = useCreateCollection(SPACE);
  const tryIt = useTryMemory(SPACE);
  // El servicio de navegador (0132): la casilla solo se ofrece si está encendido y completo.
  const browser = useBrowser(!off);
  const browserReady = browser.data?.ready === true;
  const [withBrowser, setWithBrowser] = useState(false);

  const pages = useMemo(() => (docs.data?.data ?? []).filter((d) => d.origin === "web"), [docs.data]);
  const hasWebCollection = collections.some((c) => c.name.toLowerCase() === NEW_NAME.toLowerCase());

  const [url, setUrl] = useState("");
  const [collection, setCollection] = useState("");
  const [urlNote, setUrlNote] = useState("");
  const [steps, setSteps] = useState<PrepStep[]>(prepStart);
  const [busy, setBusy] = useState(false);
  const [fault, setFault] = useState<Fault | null>(null);
  const [notice, setNotice] = useState("");
  // La página en pantalla: la recién leída, o una ya guardada que se eligió de la lista.
  const [fresh, setFresh] = useState<WebPageView | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [buildKey, setBuildKey] = useState(0);
  const [lit, setLit] = useState<number | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<WebHit[]>([]);
  const [askKey, setAskKey] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [tick, setTick] = useState(0);
  const stop = useRef(false);
  const asking = useRef<AbortController | null>(null);
  const live = useRef<HTMLParagraphElement>(null);

  // La colección de partida: «Páginas web» si existe; si no, crearla.
  useEffect(() => {
    if (collection || off) return;
    const web = collections.find((c) => c.name.toLowerCase() === NEW_NAME.toLowerCase());
    setCollection(web?.id ?? NEW_COLLECTION);
  }, [collection, collections, off]);

  const savedPassages = useDocPassages(SPACE, picked && fresh?.doc !== picked ? picked : null);
  const pickedDoc = pages.find((d) => d.id === picked) ?? null;
  const view: WebPageView | null = useMemo(() => {
    if (fresh && (!picked || fresh.doc === picked)) return fresh;
    if (pickedDoc && savedPassages.data) return { doc: pickedDoc.id, url: pickedDoc.file_name, title: pickedDoc.title, passages: savedPassages.data.map((p) => ({ seq: p.seq, section: p.section, text: p.body })) };
    return null;
  }, [fresh, picked, pickedDoc, savedPassages.data]);

  const topics = useMemo(() => (view && map.data?.data ? topicsOf(map.data.data, view.doc) : []), [view, map.data]);
  const working = busy || (answer !== null && !answer.done);

  // Mientras Pilo trabaja, el reloj mueve su gesto y los consejos.
  useEffect(() => {
    if (!working) return;
    const t = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [working]);
  useEffect(() => () => asking.current?.abort(), []);

  const say = (id: PrepId, state: PrepStep["state"], detail?: string) => {
    setSteps((s) => prepSet(s, id, state, detail));
    if (live.current && state !== "run") live.current.textContent = `${steps.find((x) => x.id === id)?.label ?? ""}: ${detail || STATE_WORD[state]}`;
  };

  const clearAsk = () => {
    asking.current?.abort();
    setHits([]);
    setAskKey(0);
    setAnswer(null);
    tryIt.reset();
  };

  const open = (doc: string) => {
    if (busy) return;
    clearAsk();
    setPicked(doc);
    setSelected(null);
    setLit(null);
    setFault(null);
    setNotice("");
    setSteps(prepStart());
    const d = pages.find((x) => x.id === doc);
    if (d) {
      setUrl(d.file_name);
      if (collections.some((c) => c.id === d.source)) setCollection(d.source);
    }
  };

  async function read(target = url) {
    const address = checkWebUrl(target);
    if (!address.ok) {
      setUrlNote(address.reason);
      return;
    }
    setUrlNote("");
    setFault(null);
    setNotice("");
    clearAsk();
    setBusy(true);
    stop.current = false;
    setSteps(prepSet(prepStart(), "traer", "run", webWhere(address.url)));
    let at: PrepId = "traer";
    try {
      let into = collection;
      if (!into || into === NEW_COLLECTION) {
        const made = await create.mutateAsync({ name: NEW_NAME, read: true });
        into = made.id;
        setCollection(made.id);
      }
      const r = await piloStep<WebRead>("web", SPACE, { step: "leer", url: address.url, collection: into, ...(withBrowser && browserReady ? { browser: true } : {}) });
      setSteps((s) => prepRead(s, r));
      setUrl(r.url);
      setFresh({ doc: r.doc, url: r.url, title: r.title, passages: r.passages });
      setPicked(r.doc);
      setSelected(null);
      setLit(0);
      setBuildKey((k) => k + 1);

      // Los vectores: con ellos Pilo la encuentra por significado, no solo por palabras.
      at = "indexar";
      say("indexar", "run", "Calculando vectores…");
      const shown = Math.min(r.passages.length, MESH_PASSAGES);
      let first: number | null = null;
      const left = await indexPending(SPACE, (pending) => {
        if (first === null) first = Math.max(pending, 1);
        const share = first ? Math.min(1, Math.max(0, 1 - pending / Math.max(first, pending))) : 1;
        setLit(Math.round(shown * share));
        setSteps((s) => prepSet(s, "indexar", "run", pending ? `Faltan ${plural(pending, "pasaje", "pasajes")} de toda la memoria` : "Listo"));
      });
      if (left === 0) {
        setLit(shown);
        say("indexar", "done", `${plural(r.total, "pasaje", "pasajes")} con vector`);
      } else {
        say("indexar", "skip", `Quedaron ${plural(left, "pasaje", "pasajes")} sin indexar: mientras tanto se buscan por palabras. Termine en Memoria › Búsqueda por significado.`);
      }

      // El mapa: de qué trata cada pasaje, para unirlo con lo demás que Pilo sabe.
      at = "conectar";
      say("conectar", "run", "Leyendo de qué trata cada pasaje…");
      let closing: { state: PrepStep["state"]; detail: string } = { state: "skip", detail: "Quedó en su colección y en el mapa por su estructura. «Comprender», en Memoria, la une por temas." };
      for (let round = 0; round < CONNECT_ROUNDS; round++) {
        if (stop.current) {
          closing = { state: "skip", detail: "Lo dejó para después: «Comprender», en Memoria, continúa donde quedó." };
          break;
        }
        const c = await comprehendDoc(SPACE, r.doc);
        const next = comprehendNext(c, round);
        const mapped = Number(c.status?.mapped) || 0;
        const total = Number(c.status?.total) || 0;
        if (next.next === "seguir") {
          setSteps((s) => prepSet(s, "conectar", "run", total ? `${mapped} de ${total} pasajes comprendidos` : "Comprendiendo…"));
          continue;
        }
        closing = next.next === "listo" ? { state: c.ai === false ? "skip" : "done", detail: next.why || `Temas y normas enlazados con el resto de la memoria` } : { state: "skip", detail: next.why };
        break;
      }
      say("conectar", closing.state, closing.detail);
      const reads = general && data?.sources.find((s) => s.id === into) ? effectiveCell(general, data.sources.find((s) => s.id === into)!) === "casa" : true;
      setNotice(
        `«${r.title}» quedó en la memoria de Pilo${r.unchanged ? " (no había cambiado)" : ""}.${reads ? " Ya entra en sus respuestas." : " Pilo todavía no lee esa colección: enciéndala en Memoria › Qué lee cada portal."}${r.browser?.asked && !r.browser.used ? ` Ojo: ${browserLine(r.browser)}.` : ""}`,
      );
    } catch (error) {
      setFault(faultOf(error));
      say(at, "fail", "");
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function search(question: string) {
    if (!view) return;
    asking.current?.abort();
    setAnswer(null);
    setSelected(null);
    try {
      const found = await tryIt.mutateAsync(question);
      const mine = hitsOf(found.hits, view.doc);
      setHits(mine);
      setAskKey((k) => k + 1);
      const first = mine.find((h) => h.seq !== null);
      if (first) setSelected(first.seq);
    } catch {
      setHits([]);
    }
  }

  async function respond() {
    const question = q.trim();
    if (!question) return;
    asking.current?.abort();
    const ctl = new AbortController();
    asking.current = ctl;
    const mine: Answer = { q: question, text: "", steps: [], thinking: "", meta: null, startedAt: Date.now(), done: false, error: "", seconds: 0 };
    const show = () => setAnswer({ ...mine, steps: [...mine.steps] });
    show();
    try {
      const result = await askQuestionStream(
        question,
        [],
        {
          signal: ctl.signal,
          onMeta: (meta) => {
            mine.meta = meta;
            show();
          },
          onStep: (step) => {
            mine.steps = reduceSteps(mine.steps, step);
            show();
          },
          onThinking: (text) => {
            mine.thinking = `${mine.thinking}${text}`.slice(-700);
            show();
          },
          onDelta: (text) => {
            mine.text += text;
            show();
          },
        },
        { portal: "pregunta" },
      );
      if (asking.current !== ctl) return;
      mine.text = result.text;
      mine.done = true;
      mine.seconds = (Date.now() - mine.startedAt) / 1000;
      show();
    } catch (error) {
      if (ctl.signal.aborted) return;
      mine.done = true;
      mine.error = error instanceof Error ? error.message : "Pilo no pudo responder ahora.";
      show();
    }
  }

  const selectedPassage = view && selected !== null ? view.passages.find((p) => p.seq === selected) ?? null : null;
  const ownHits = hits.filter((h) => h.seq !== null);
  const otherHits = hits.filter((h) => h.seq === null);
  const waited = answer && !answer.done ? (Date.now() - answer.startedAt) / 1000 : 0;
  const writing = Boolean(answer && !answer.done && answer.text);
  const collectionName = (id: string) => collections.find((c) => c.id === id)?.name ?? id;
  const mood = moodOf(steps, busy, Boolean(fault), tick);
  const running = steps.find((s) => s.state === "run");

  if (missing && !loading) {
    return (
      <Group title="Leer una página">
        <p className="pis-note" role="note">
          Falta aplicar la migración 0121 en la base: hasta entonces el Pilo de la Universidad no tiene documentos propios, y las páginas web se guardan como documentos.
        </p>
      </Group>
    );
  }

  return (
    <div className="pwb">
      <div className="pwb-rail">
        <Group title="Leer una página">
          <form
            className="pwb-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (!busy) void read();
            }}
          >
            <label className="pwb-field">
              <span>Dirección de la página</span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                placeholder="https://www.udes.edu.co/…"
                aria-describedby="pwb-url-note"
                aria-invalid={Boolean(urlNote)}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (urlNote) setUrlNote("");
                }}
              />
            </label>
            <label className="pwb-field">
              <span>Colección donde queda</span>
              <select value={collection} onChange={(e) => setCollection(e.target.value)} disabled={busy || off}>
                {!hasWebCollection && <option value={NEW_COLLECTION}>Crear «{NEW_NAME}»</option>}
                {collections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {browserReady && (
              <label className="pwb-check">
                <input type="checkbox" checked={withBrowser} disabled={busy} onChange={(e) => setWithBrowser(e.target.checked)} />
                <span>
                  Abrir con navegador (ejecuta JavaScript y despliega pestañas)
                  <small>Tarda más. Úselo si la página llega vacía o le falta lo que está en pestañas, acordeones o «ver más».</small>
                </span>
              </label>
            )}
            <div className="pis-actions">
              <button type="submit" className="button-primary" disabled={busy || off || !url.trim()}>
                <Icon name="document" size={16} />
                {busy ? "Leyendo…" : "Leer página"}
              </button>
              {busy && running?.id === "conectar" && (
                <button type="button" className="button-secondary" onClick={() => (stop.current = true)}>
                  Dejar para después
                </button>
              )}
            </div>
            <p className={urlNote ? "pis-error" : "pis-small"} id="pwb-url-note" role={urlNote ? "alert" : undefined}>
              {urlNote || "Solo páginas públicas con https. Pilo lee el texto: nunca menús, formularios ni lo que pide iniciar sesión."}
            </p>
          </form>
        </Group>

        <Group title="Preparación">
          <div className="pwb-pilo">
            <PiloAvatar mood={mood} size={56} alive={busy} label="" />
            <p aria-hidden={!busy}>
              {busy
                ? running?.label ?? "Trabajando…"
                : fault
                  ? "Algo no salió. Abajo está qué pasó."
                  : steps[0].state === "done"
                    ? "Página lista. Pruébela con una consulta."
                    : "Deme una dirección y le muestro cómo la leo."}
            </p>
          </div>
          <ol className="pwb-steps">
            {steps.map((s) => (
              <li key={s.id} data-state={s.state}>
                <StepGlyph />
                <div>
                  <b>
                    {s.label}
                    <span className="pwb-sr"> · {STATE_WORD[s.state]}</span>
                  </b>
                  <span>{s.detail}</span>
                </div>
              </li>
            ))}
          </ol>
          {fault && <FaultNote fault={fault} lead="No se pudo leer la página" onRetry={fault.retry ? () => void read() : undefined} busy={busy} />}
          {notice && (
            <p className="pis-note" role="status">
              {notice}
            </p>
          )}
          <p className="pwb-sr" ref={live} aria-live="polite" />
        </Group>

        <Group title="Páginas leídas" aside={<small>{pages.length ? plural(pages.length, "página", "páginas") : ""}</small>}>
          {docs.isPending && !off ? (
            <p className="pis-small">Cargando las páginas de la memoria…</p>
          ) : pages.length === 0 ? (
            <p className="pis-small">Todavía no hay páginas web en la memoria. La primera que lea aparece aquí.</p>
          ) : (
            <ul className="pwb-pages">
              {pages.map((d) => (
                <li key={d.id}>
                  <button type="button" aria-pressed={picked === d.id} disabled={busy} onClick={() => open(d.id)}>
                    <strong>{d.title}</strong>
                    <em>
                      {webWhere(d.file_name)} · {plural(d.passages, "pasaje", "pasajes")}
                    </em>
                    <em>
                      {collectionName(d.source)} · leída {when(d.updated_at)}
                      {d.understood_at ? " · comprendida" : ""}
                    </em>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="pis-small">Para quitar una página o cambiar quién la ve: Memoria › Páginas en la memoria.</p>
        </Group>

        <BrowserService enabled={!off} />
      </div>

      <div className="pwb-work">
        <Group
          title="La malla de esta página"
          aside={
            <span className="pwb-key" aria-hidden="true">
              <span><i className="pwb-key__pag" />Página</span>
              <span><i />Sección</span>
              <span><i className="pwb-key__pas" />Pasaje sin indexar</span>
              <span><i />Indexado</span>
              <span><i className="pwb-key__tem" />Tema</span>
            </span>
          }
        >
          {view ? (
            <>
              <p className="pwb-meta">
                <strong>{view.title}</strong> · {webWhere(view.url)} · {plural(view.passages.length, "pasaje", "pasajes")}
                {topics.length ? ` · ${plural(topics.length, "tema o norma", "temas y normas")}` : ""}
              </p>
              <MeshStage
                view={view}
                topics={topics}
                lit={lit ?? Math.min(view.passages.length, MESH_PASSAGES)}
                hits={hits}
                selected={selected}
                onSelect={setSelected}
                buildKey={fresh && view.doc === fresh.doc ? buildKey : 0}
                askKey={askKey}
              />
              {!topics.length && !busy && (
                <p className="pis-small">
                  Sin temas todavía: «Comprender», en Memoria, lee de qué trata cada pasaje y lo une con los demás documentos.
                </p>
              )}
            </>
          ) : picked && savedPassages.isPending ? (
            <p className="pis-small">Trayendo los pasajes de la página…</p>
          ) : (
            <div className="pwb-empty">
              <p>
                <strong>Aquí se arma la malla de la página.</strong>
              </p>
              <p>Al leer una dirección, Pilo la parte en secciones y pasajes, les calcula su vector y los une por temas con lo que ya sabe. Elija una página leída para ver la suya.</p>
            </div>
          )}
        </Group>

        <Group title="Consultar esta página" aside={<small>Lo que Pilo encontraría y, si quiere, lo que respondería</small>}>
          <form
            className="pis-probe"
            onSubmit={(e) => {
              e.preventDefault();
              if (q.trim() && view) void search(q.trim());
            }}
          >
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={view ? "Pregunte algo que diga esta página" : "Primero lea o elija una página"} aria-label="Pregunta sobre esta página" disabled={!view || busy} />
            <button type="submit" className="button-secondary" disabled={!view || busy || !q.trim() || tryIt.isPending}>
              {tryIt.isPending ? "Buscando…" : "Buscar pasajes"}
            </button>
            <button type="button" className="button-primary" disabled={!view || busy || !q.trim() || (answer !== null && !answer.done)} onClick={() => void respond()}>
              Que Pilo responda
            </button>
          </form>
          {tryIt.isError && (
            <p className="pis-error" role="alert">
              {(tryIt.error as Error).message}
            </p>
          )}

          {view && (
            <div className="pwb-answer">
              <div>
                {askKey === 0 && !answer && <p className="pis-small">«Buscar pasajes» muestra cuáles encontraría Pilo y qué tan cerca quedan de la pregunta. «Que Pilo responda» le hace la pregunta de verdad.</p>}
                {askKey > 0 && (
                  <>
                    <h4>Pasajes de esta página</h4>
                    {ownHits.length === 0 ? (
                      <p className="pis-small">Ninguno de los pasajes más cercanos es de esta página{otherHits.length ? ": Pilo respondería con otras fuentes." : ": Pilo diría que no lo encontró."}</p>
                    ) : (
                      <ul className="pwb-cites">
                        {ownHits.map((h) => (
                          <li key={h.ref}>
                            <button type="button" aria-pressed={selected === h.seq} onClick={() => setSelected(h.seq)}>
                              <b>p{h.seq}</b>
                              <span>{topSection(h.section)}</span>
                              <em>{simText(h.sim)}</em>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {otherHits.length > 0 && (
                      <>
                        <h4>También encontró en el resto de la memoria</h4>
                        <ul className="pwb-others">
                          {otherHits.map((h) => (
                            <li key={h.ref}>
                              <strong>{h.title}</strong>
                              <small>
                                {h.section} · {simText(h.sim)}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    {tryIt.data && !tryIt.data.semantic && <p className="pis-small">Solo por palabras{tryIt.data.note ? `: ${tryIt.data.note}` : "."}</p>}
                  </>
                )}

                {answer && (
                  <div className="pwb-said" aria-busy={!answer.done}>
                    <h4>
                      {answer.done ? (answer.error ? "Pilo no respondió" : `Pilo respondió en ${secondsText(answer.seconds)}`) : waitingLine({ steps: answer.steps, meta: answer.meta, seconds: waited })}
                      {!answer.done && (
                        <span className="pwb-dots" aria-hidden="true">
                          <i />
                          <i />
                          <i />
                        </span>
                      )}
                    </h4>
                    {!answer.done && !writing && waitingTip(waited, answer.startedAt) && (
                      <p className="pwb-tip" key={waitingTip(waited, answer.startedAt)}>
                        {waitingTip(waited, answer.startedAt)}
                      </p>
                    )}
                    {!answer.done && !writing && answer.thinking && (
                      <p className="pwb-thinking">
                        <b>Lo que va pensando: </b>
                        {answer.thinking.slice(-320)}
                      </p>
                    )}
                    {answer.error ? (
                      <p className="pis-error" role="alert">
                        {answer.error}
                      </p>
                    ) : (
                      answer.text && <p className="pwb-text">{answer.text}</p>
                    )}
                    {answer.done && !answer.error && (
                      <p className="pis-small">Respondió con toda su memoria, no solo con esta página: así se ve si la página quedó conectada.</p>
                    )}
                  </div>
                )}
              </div>

              <div className="pwb-passage" aria-live="polite">
                {selectedPassage ? (
                  <>
                    <strong>
                      Pasaje p{selectedPassage.seq} · {selectedPassage.section}
                    </strong>
                    <p>{selectedPassage.text}</p>
                  </>
                ) : (
                  <>
                    <strong>Pasajes</strong>
                    <p>Elija un pasaje en la malla para leerlo.</p>
                  </>
                )}
              </div>
            </div>
          )}
        </Group>
      </div>
    </div>
  );
}
