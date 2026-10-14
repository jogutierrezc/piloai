/* =============================================================================
   Intranet · Mr. Pilo con IA · «Pregúntele a Pilo» y su memoria.

   Dos secciones del módulo salen de aquí:

   PreguntaSection
   - Si la página está abierta y para quién (público, con sesión o solo
     administración), si muestra la bienvenida y si Pilo redacta con IA. Esto
     se guarda con «Guardar cambios», como el resto.
   - Cómo redacta (0110): por partes o entera, dónde va su persona, largo,
     temperatura, contexto y turnos; y el límite por visitante.
   - Lo que Pilo no supo (0109): la bandeja de preguntas sin respuesta, que no
     sirvieron, con una cifra sin fuente o contestadas de conocimiento general
     (0110). «Responder» la lleva al catálogo; desde ese momento Pilo la toma
     como base obligatoria de su redacción, también dicha con otras palabras.
   - Las respuestas guardadas: las últimas, con cuántas veces sirvieron; una
     respuesta se puede ocultar para que no se vuelva a dar.

   MemorySection
   - Qué fuentes usa, cuántos pasajes tiene cada una y el botón «Actualizar
     la memoria», que la rehace con lo publicado ahora (se aplica al momento,
     como las claves). Cada fuente va por su lado: la que falla o llega vacía
     se queda como estaba y la lista de resultados dice por qué.
   - Qué lee cada portal (0121, PortalsMatrix): la matriz portal × fuente de
     los dos Pilos, el único lugar que lo dice. Se aplica al momento.
   - Los documentos del Pilo general (0121, GeneralDocs): los paneles de
     Enseñanza montados con el espacio «planeacion».
   - Búsqueda por significado (0108): cuántos pasajes tienen su vector y el
     botón que los calcula (también corre solo después de actualizar).
   - Probar la memoria: qué pasajes encontraría Pilo para una pregunta, y si
     los halló por palabras, por significado o por ambas.
   - La malla de la memoria (MeshView): cómo se conecta lo que sabe.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../../../components/ui/Icon";
import type { Fn } from "../../../components/pilo/ai/config";
import { MEMORY_SOURCES, pendingOf, useEmbedModels, useEmbedStatus, useHideAnswer, useIndexMemory, useMemoryCounts, useMemoryInputs, useReplaceMemory, useSavedAnswers, useTryMemory } from "./memory";
import type { EmbedStatus, MemorySource, ReplaceResult, SourceProblem } from "./memory";
import { AudiencePicker } from "./sections";
import type { EditorApi } from "./sections";
import { Group, NumField, StatusMark, Switch, plural, when } from "./ui";
import { ASK_LIMITS } from "./store";
import type { SystemRole } from "./store";
import { MeshView } from "./MeshView";
import { revealList } from "./motion";
import { CatalogModal } from "./CatalogModal";
import { GeneralDocs } from "./GeneralDocs";
import { PortalsMatrix } from "./PortalsMatrix";
import { ReasoningGroup } from "./Razonamiento";
import { reasonHint, reasonLabel, useCloseInbox, useInbox } from "./inbox";
import type { InboxItem } from "./inbox";
import type { CatalogRow } from "./catalog-sheet";

/* --- Pregúntele a Pilo ---------------------------------------------------------------------- */

const SYSTEM_ROLES: { id: SystemRole; label: string; note: string }[] = [
  { id: "auto", label: "Automática", note: "Con rol «system»; si el servicio lo rechaza, la pasa dentro del primer mensaje y lo recuerda." },
  { id: "system", label: "Con rol system", note: "Siempre aparte, como instrucción del sistema. Falla si el servicio no lo acepta." },
  { id: "user", label: "Dentro del mensaje", note: "Nunca manda el rol «system»: la persona va en el primer mensaje. Para servicios que lo rechazan." },
];

/** «10 minutos», «90 segundos», «2 horas»: la ventana dicha como se lee. */
function spanOf(seconds: number): string {
  if (seconds < 120) return plural(seconds, "segundo", "segundos");
  if (seconds < 7200) return plural(Math.round(seconds / 60), "minuto", "minutos");
  return plural(Math.round(seconds / 3600), "hora", "horas");
}

export function PreguntaSection({ ed }: { ed: EditorApi }) {
  const { s, set, setPortal } = ed;
  const rule = s.portals.pregunta ?? { on: false, aud: "publico", fns: ["preguntar"] };
  // «Leer» en Pregúntele a Pilo: las respuestas suenan con la voz de IA (la de Voz), no con la del navegador.
  const speaks = rule.fns.includes("leer");
  const fns = (voice: boolean): Fn[] => (voice ? ["preguntar", "leer"] : ["preguntar"]);
  const voiceName = s.voice_engine !== "proveedor" ? "" : s.speech_provider === "nvidia" ? "NVIDIA" : s.speech_provider === "fishaudio" ? "Fish Audio" : "Free.ai";
  const answers = useSavedAnswers();
  const hide = useHideAnswer();
  const [modalOpen, setModalOpen] = useState(false);
  const [catalogEntry, setCatalogEntry] = useState<Partial<CatalogRow> | null>(null);
  const inbox = useInbox();
  const closeInbox = useCloseInbox();
  // La pregunta de la bandeja que se está respondiendo: al guardar en el catálogo, queda resuelta.
  const [answering, setAnswering] = useState<number | null>(null);
  const embedStatus = useEmbedStatus(!s.needs0094);
  const indexer = useIndexMemory();

  const answerInbox = (item: InboxItem) => {
    setAnswering(item.id);
    setCatalogEntry({
      kind: "respuesta",
      question: item.question,
      // Lo que la IA redactó con una cifra dudosa suele servir de borrador; lo que no sirvió, no.
      answer: item.reason === "revisar" ? item.answer.replace(/\s*\[\d+\]/g, "").trim() : "",
      source_title: "Planeación Institucional · Pregúntele a Pilo",
      source_path: "/pregunta",
    });
    setModalOpen(true);
  };

  const promoteToCatalog = (a: { question: string; answer: string }) => {
    const cleanAnswer = a.answer.replace(/\s*\[\d+\]/g, "").trim();
    setCatalogEntry({
      kind: "respuesta",
      question: a.question,
      answer: cleanAnswer,
      source_title: "Planeación Institucional · Pregúntele a Pilo",
      source_path: "/pregunta",
    });
    setModalOpen(true);
  };

  return (
    <>
      {s.needs0094 && <p className="pis-warn">Falta aplicar la migración 0094 en la base para abrir la página y guardar su memoria.</p>}

      <Group
        title="La página"
        aside={
          <Link to="/pregunta" className="pis-link" target="_blank" rel="noopener">
            Abrir /pregunta <Icon name="external" size={14} />
          </Link>
        }
      >
        <p className="pis-lead">
          Una página pública donde cualquiera le pregunta a Pilo por la Planeación de la UDES. Pilo siempre redacta con IA: parte de las respuestas del catálogo (la base
          obligatoria), las respuestas guardadas, las cifras en vivo y la memoria. Los temas generales también los contesta, marcados como conocimiento general. Si la IA
          está apagada o sin cupo, responde con lo publicado tal cual.
        </p>
        <dl className="pis-opts">
          <div>
            <dt>Página abierta</dt>
            <dd>
              <Switch on={rule.on} onChange={(v) => setPortal("pregunta", { on: v, fns: fns(speaks) })} label="Pregúntele a Pilo abierta" />
            </dd>
          </div>
          <div>
            <dt>Para quién</dt>
            <dd>
              <AudiencePicker value={rule.aud} label="Para quién es Pregúntele a Pilo" onPick={(aud) => setPortal("pregunta", { aud, fns: fns(speaks) })} />
            </dd>
          </div>
          <div>
            <dt>
              Leer las respuestas con la voz de Pilo
              <small>
                {!voiceName
                  ? "En Voz está elegida la del navegador: elija NVIDIA o Free.ai para que suene la de Pilo."
                  : `Con la voz de ${voiceName} y su estilo; si no responde, con la del navegador.`}
              </small>
            </dt>
            <dd>
              <Switch on={speaks} onChange={(v) => setPortal("pregunta", { fns: fns(v) })} label="Leer las respuestas con la voz de Pilo" />
            </dd>
          </div>
          <div>
            <dt>Bienvenida la primera vez</dt>
            <dd>
              <Switch on={s.pregunta_welcome} onChange={(v) => set("pregunta_welcome", v)} label="Mostrar la bienvenida" />
            </dd>
          </div>
          <div>
            <dt>
              Redactar con IA
              <small>
                {!s.enabled
                  ? "Mr. Pilo con IA está apagado: responde con lo publicado tal cual."
                  : s.functions.preguntar === false
                    ? "Apagado: responde con lo publicado tal cual."
                    : "Siempre, sobre el catálogo, lo guardado, las cifras y la memoria."}
              </small>
            </dt>
            <dd>
              <Switch on={s.functions.preguntar !== false} onChange={(v) => set("functions", { ...s.functions, preguntar: v })} label="Redactar siempre con IA" />
            </dd>
          </div>
        </dl>
      </Group>

      <Group title="Cómo redacta" aside={<small>Valores de partida si no cambia nada</small>}>
        {s.needs0110 && <p className="pis-warn">Falta aplicar la migración 0110 en la base para cambiar cómo redacta Pilo. Mientras tanto usa los valores de partida.</p>}
        <dl className="pis-opts">
          <div>
            <dt>
              Responder por partes
              <small>La página muestra la respuesta mientras se escribe. Apagado: aparece entera, de una vez.</small>
            </dt>
            <dd>
              <Switch on={s.ask_stream} disabled={s.needs0110} onChange={(v) => set("ask_stream", v)} label="Responder por partes" />
            </dd>
          </div>
          <div>
            <dt>
              Persona de Pilo
              <small>{SYSTEM_ROLES.find((r) => r.id === s.system_role)?.note}</small>
            </dt>
            <dd>
              <span className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Dónde va la persona de Pilo">
                {SYSTEM_ROLES.map((r) => (
                  <button key={r.id} type="button" role="radio" aria-checked={s.system_role === r.id} disabled={s.needs0110} onClick={() => set("system_role", r.id)}>
                    {r.label}
                  </button>
                ))}
              </span>
            </dd>
          </div>
        </dl>
        <div className="pis-grid pis-grid--3">
          <NumField
            label="Largo de la respuesta (tokens)"
            hint="Un token son unas cuatro letras"
            {...ASK_LIMITS.ask_max_tokens}
            value={s.ask_max_tokens}
            disabled={s.needs0110}
            onCommit={(v) => set("ask_max_tokens", v)}
          />
          <NumField
            label="Temperatura"
            hint="0 repite lo mismo; 1 varía más"
            {...ASK_LIMITS.ask_temperature}
            step={0.1}
            value={s.ask_temperature}
            disabled={s.needs0110}
            onCommit={(v) => set("ask_temperature", v)}
          />
        </div>
        <details className="pis-adv">
          <summary>Opciones avanzadas</summary>
          <div className="pis-grid pis-grid--3">
            <NumField
              label="Contexto (tokens)"
              hint="Cuánto del catálogo, las cifras y la memoria cabe en el pedido"
              {...ASK_LIMITS.ask_context_tokens}
              value={s.ask_context_tokens}
              disabled={s.needs0110}
              onCommit={(v) => set("ask_context_tokens", v)}
            />
            <NumField
              label="Turnos de conversación"
              hint="Cuántos turnos anteriores recuerda"
              {...ASK_LIMITS.ask_history_turns}
              value={s.ask_history_turns}
              disabled={s.needs0110}
              onCommit={(v) => set("ask_history_turns", v)}
            />
          </div>
          <p className="pis-small" style={{ marginTop: "0.5rem" }}>
            💡 <strong>Consejo de velocidad:</strong> Bajar el contexto a 1800–2200 tokens y el largo a 400–500 tokens reduce el tiempo de procesamiento del proveedor.
          </p>
        </details>
      </Group>

      <ReasoningGroup />

      <Group title="Límite por visitante" aside={<small>Solo la página pública</small>}>
        <p className="pis-small">
          Frena a quien pregunta sin pausa y cuida el cupo de todos. Se cuenta por una huella que cambia cada día, nunca por la dirección IP. La administración no tiene límite;
          una misma red admite diez veces más, por las oficinas y salones donde varias personas comparten dirección.
        </p>
        <div className="pis-grid pis-grid--3">
          <NumField
            label="Preguntas por visitante"
            hint="0 quita el límite"
            {...ASK_LIMITS.visitor_limit}
            value={s.visitor_limit}
            disabled={s.needs0110}
            onCommit={(v) => set("visitor_limit", v)}
          />
          <NumField
            label="Duración de la ventana (segundos)"
            {...ASK_LIMITS.visitor_window_seconds}
            value={s.visitor_window_seconds}
            disabled={s.needs0110}
            onCommit={(v) => set("visitor_window_seconds", v)}
          />
        </div>
        <p className="pis-small" role="status">
          {s.visitor_limit === 0
            ? "Sin límite por visitante."
            : `Cada visitante puede hacer ${plural(s.visitor_limit, "pregunta", "preguntas")} cada ${spanOf(s.visitor_window_seconds)}.`}
        </p>
      </Group>

      <Group title="Lo que Pilo no supo" aside={inbox.data ? <small>{plural(inbox.data.total, "pendiente", "pendientes")}</small> : null}>
        {s.needs0109 || inbox.data === null ? (
          <p className="pis-small">Falta aplicar la migración 0109 para que Pilo anote lo que no supo responder.</p>
        ) : !inbox.data || inbox.data.rows.length === 0 ? (
          <p className="pis-small">
            Nada pendiente. Aquí llegan las preguntas que Pilo no pudo responder, las que alguien marcó «No me sirvió», las que la IA redactó con una cifra sin fuente y las
            que contestó de conocimiento general.
          </p>
        ) : (
          <>
            <p className="pis-small">
              Responda las más preguntadas: la respuesta entra al catálogo y desde ese momento Pilo parte de ella (es la base obligatoria de su redacción), aunque la
              pregunten con otras palabras.
            </p>
            {inbox.data.rows.some((r) => r.reason === "general") && (
              <p className="pis-small">
                <StatusMark tone="warn">Conocimiento general</StatusMark> {reasonHint("general")}
              </p>
            )}
            <ul className="pis-answers">
              {inbox.data.rows.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{item.question}</strong>
                    <small>
                      {reasonLabel(item.reason)}
                      {item.answer ? ` · Pilo dijo: ${item.answer.replace(/\s*\[\d+\]/g, "").slice(0, 140)}${item.answer.length > 140 ? "…" : ""}` : ""}
                    </small>
                  </span>
                  <em>
                    {item.times === 1 ? "1 vez" : `${item.times.toLocaleString("es-CO")} veces`} · {when(item.last_at)}
                  </em>
                  <div className="pis-cat__actions">
                    <button type="button" className="button-secondary pis-to-cat" onClick={() => answerInbox(item)} title="Escribir la respuesta oficial en el catálogo">
                      <Icon name="spark" size={14} />
                      Responder
                    </button>
                    <button
                      type="button"
                      className="button-secondary"
                      onClick={() => closeInbox.mutate({ id: item.id, status: "descartada" })}
                      disabled={closeInbox.isPending}
                      title="No hace falta responderla (una prueba, algo fuera de tema)"
                    >
                      Descartar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
        {closeInbox.isError && (
          <p className="pis-error" role="alert">
            No se pudo cerrar: {(closeInbox.error as Error).message}
          </p>
        )}
      </Group>

      <Group title="Respuestas guardadas" aside={answers.data ? <small>{plural(answers.data.total, "en total", "en total")}</small> : null}>
        {!answers.data || answers.data.rows.length === 0 ? (
          <p className="pis-small">Todavía no hay respuestas guardadas. Se guardan las que redacta la IA con todas sus cifras verificadas.</p>
        ) : (
          <ul className="pis-answers">
            {answers.data.rows.map((a) => (
              <li key={a.id} data-hidden={a.hidden || undefined}>
                <span>
                  <strong>{a.question}</strong>
                  <small>{a.answer.replace(/\s*\[\d+\]/g, "").slice(0, 160)}</small>
                </span>
                <em>
                  {when(a.created_at)} · sirvió {a.up} · no sirvió {a.down}
                  {a.hidden ? " · oculta" : ""}
                </em>
                <div className="pis-cat__actions">
                  <button
                    type="button"
                    className="button-secondary pis-to-cat"
                    onClick={() => promoteToCatalog(a)}
                    title="Agregar esta respuesta al catálogo oficial de Pilo"
                  >
                    <Icon name="spark" size={14} />
                    Al catálogo
                  </button>
                  <button type="button" className="button-secondary" onClick={() => hide.mutate({ id: a.id, hidden: !a.hidden })} disabled={hide.isPending}>
                    {a.hidden ? "Volver a usar" : "Ocultar"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Group>

      <CatalogModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setCatalogEntry(null);
          setAnswering(null);
        }}
        defaultKind="respuesta"
        initialEntry={catalogEntry}
        isEditing={false}
        onSaved={(entry) => {
          if (answering !== null) closeInbox.mutate({ id: answering, status: "resuelta", key: entry.key });
          // La respuesta nueva se reconoce por significado en cuanto tenga su vector.
          if (embedStatus.isSuccess && !indexer.isPending) indexer.mutate(undefined);
        }}
      />
    </>
  );
}

/* --- La memoria ------------------------------------------------------------------------------ */

export function MemorySection({
  ed,
  indexedAt,
  onIndexed,
  onSourceApplied,
  readOnly = false,
}: {
  ed: EditorApi;
  /** Personal sin la zona de conexión/portales: sin interruptores de fuentes, sin la matriz de portales, sin modelo ni capa profunda. */
  readOnly?: boolean;
  indexedAt: string | null;
  onIndexed: (iso: string) => void;
  /** Una celda de casa cambió en la matriz (ya aplicada en la base): el interruptor de «Fuentes» se pone al día, en lo editado y en lo guardado. */
  onSourceApplied?: (source: string, on: boolean) => void;
}) {
  const { s, set } = ed;
  const counts = useMemoryCounts();
  const inputs = useMemoryInputs();
  const replace = useReplaceMemory();
  const tryIt = useTryMemory();
  const embedStatus = useEmbedStatus(!s.needs0094);
  const indexer = useIndexMemory();
  const [progress, setProgress] = useState<EmbedStatus | null>(null);
  const runIndex = () => indexer.mutate(setProgress, { onSettled: () => setProgress(null) });
  const [probe, setProbe] = useState("");
  const [results, setResults] = useState<{ done: ReplaceResult[]; problems: SourceProblem[]; at: number } | null>(null);
  const resultsRef = useRef<HTMLUListElement>(null);
  const refreshRef = useRef<HTMLButtonElement>(null);
  const [, setParams] = useSearchParams();
  // Un pasaje encontrado es también un nodo (mismo ref): se abre en la malla.
  const showInMesh = (ref: string) => {
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("nodo", ref);
      return next;
    }, { replace: true });
    document.getElementById("pis-malla")?.scrollIntoView({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  // Cada actualización nueva entra una vez, fila por fila.
  useEffect(() => {
    if (results && resultsRef.current) revealList([...resultsRef.current.children]);
  }, [results?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    // Lo que no se armó bien no se envía: una lista vacía borraría esa fuente.
    const { rows, problems, meshes, facts } = inputs.build();
    if (!Object.keys(rows).length) {
      setResults({ done: [], problems, at: Date.now() });
      return;
    }
    replace.mutate(
      { rows, meshes, facts },
      {
        onSuccess: (r) => {
          setResults({ done: r.done, problems: [...problems, ...r.failed], at: Date.now() });
          if (r.done.length) onIndexed(new Date().toISOString());
          // Lo nuevo o cambiado se indexa por significado enseguida, si el proveedor lo permite.
          if (r.done.length && embedStatus.isSuccess && !indexer.isPending) runIndex();
        },
      },
    );
  };

  const total = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : 0;
  const nameOf = (id: MemorySource) => MEMORY_SOURCES.find((m) => m.id === id)?.name ?? id;

  return (
    <>
      {s.needs0094 && <p className="pis-warn">Falta aplicar la migración 0094 en la base para guardar la memoria de Pilo.</p>}

      <Group
        title="Fuentes"
        aside={<small>{counts.data ? `${plural(total, "pasaje", "pasajes")} · actualizada ${when(indexedAt ?? s.memory_indexed_at)}` : "Contando pasajes…"}</small>}
      >
        <ul className="pis-sources">
          {MEMORY_SOURCES.map((m) => (
            <li key={m.id} data-off={!s.memory_sources[m.id] || undefined}>
              <span className="pis-code" data-s={m.id} aria-hidden="true">
                {m.code}
              </span>
              <span>
                <strong>{m.name}</strong>
                <small>
                  {m.desc}
                  {m.session ? " · solo con sesión, como su portal" : ""}
                </small>
              </span>
              <em>{counts.data ? plural(counts.data[m.id], "pasaje", "pasajes") : "—"}</em>
              {!readOnly && (
                <Switch
                  on={s.memory_sources[m.id]}
                  onChange={(v) => set("memory_sources", { ...s.memory_sources, [m.id]: v } as Record<MemorySource, boolean>)}
                  label={`Usar ${m.name}`}
                />
              )}
            </li>
          ))}
        </ul>
        {!readOnly && (
          <>
          <div className="pis-row">
            <p className="pis-note">
              «Actualizar la memoria» lee los portales como los ve el público y rehace los pasajes y la malla. Lo que cambió deja de servirse en las respuestas guardadas.
              Conviene hacerlo después de publicar un corte o un boletín. Se aplica al momento.
            </p>
            <button ref={refreshRef} id="pis-refresh" type="button" className="button-primary" onClick={refresh} disabled={inputs.loading || replace.isPending || s.needs0094}>
              {replace.isPending ? "Actualizando…" : inputs.loading ? "Leyendo los portales…" : "Actualizar la memoria"}
            </button>
          </div>
          {replace.isError && (
            <p className="pis-error" role="alert">
              No se actualizó: {(replace.error as Error).message}
            </p>
          )}
          {results && (
            <ul className="pis-results" role="status" ref={resultsRef} aria-label="Resultado de la actualización">
              {results.done.map((r) => (
                <li key={r.source}>
                  <StatusMark tone={r.meshError || r.factsError ? "warn" : "ok"}>{nameOf(r.source)}</StatusMark>
                  <span>
                    {plural(r.total, "pasaje", "pasajes")} · {r.added} nuevos · {r.changed} cambiaron · {r.removed} salieron
                    {r.nodes !== undefined ? ` · malla: ${plural(r.nodes, "nodo", "nodos")} y ${plural(r.edges ?? 0, "relación", "relaciones")}` : ""}
                    {r.meshError ? ` · ${r.meshError}` : ""}
                    {r.facts !== undefined ? ` · cifras en vivo: ${plural(r.facts, "indicador", "indicadores")}` : ""}
                    {r.factsError ? ` · ${r.factsError}` : ""}
                  </span>
                </li>
              ))}
              {MEMORY_SOURCES.filter((m) => results.problems.some((p) => p.source === m.id)).map((m) => {
                const p = results.problems.find((x) => x.source === m.id)!;
                return (
                  <li key={m.id}>
                    <StatusMark tone={p.kind === "error" ? "fail" : "warn"}>{m.name}</StatusMark>
                    <span>
                      {p.kind === "error" ? "No se actualizó" : "Sin cambios"}: {p.message}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          </>
        )}
      </Group>

      {!readOnly && <PortalsMatrix onHomeSource={onSourceApplied} />}

      <GeneralDocs disabled={s.needs0094} />

      <SemanticGroup
        model={s.embed_model}
        onModel={readOnly || s.needs0109 ? undefined : (v) => set("embed_model", v)}
        status={embedStatus.data ?? null} error={embedStatus.error as Error | null} loading={embedStatus.isPending} progress={progress} running={indexer.isPending} runError={indexer.error as Error | null} onRun={runIndex} />

      {!readOnly && (
        <Group
          title="Malla de la memoria"
          aside={
            <span className="pis-malla__aside">
              <small>Cómo se conecta lo que sabe Pilo</small>
              {!readOnly && (
                <Link className="button-secondary" to="/admin/mr-pilo/presentacion">
                  Presentar la capa profunda
                </Link>
              )}
            </span>
          }
          id="pis-malla"
        >
          <MeshView onAskRefresh={() => refreshRef.current?.focus()} />
        </Group>
      )}

      {!readOnly && (
        <Group title="Probar la memoria" aside={<small>Los cinco pasajes que Pilo encontraría</small>}>
          <form
            className="pis-probe"
            onSubmit={(e) => {
              e.preventDefault();
              if (probe.trim()) tryIt.mutate(probe.trim());
            }}
          >
            <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Escriba una pregunta como la haría el público" aria-label="Pregunta de prueba" />
            <button type="submit" className="button-secondary" disabled={!probe.trim() || tryIt.isPending}>
              {tryIt.isPending ? "Buscando…" : "Buscar"}
            </button>
          </form>
          {tryIt.isError && (
            <p className="pis-error" role="alert">
              {(tryIt.error as Error).message}
            </p>
          )}
          {tryIt.data && !tryIt.data.semantic && (
            <p className="pis-small">Solo por palabras{tryIt.data.note ? `: ${tryIt.data.note}` : "."}</p>
          )}
          {tryIt.data &&
            (tryIt.data.hits.length === 0 ? (
              <p className="pis-small">Ningún pasaje responde: Pilo diría que no lo encontró.</p>
            ) : (
              <ol className="pis-hits">
                {tryIt.data.hits.map((h) => (
                  <li key={h.ref}>
                    <span className="pis-code" data-s={h.source} title={nameOf(h.source)}>
                      {MEMORY_SOURCES.find((m) => m.id === h.source)?.code}
                    </span>
                    <span>
                      <strong>{h.title}</strong>
                      <small>
                        {h.section}
                        {h.cut ? ` · ${h.cut}` : ""}
                        {h.via ? ` · ${VIA[h.via]}` : ""}
                        {typeof h.sim === "number" ? ` (parecido ${Math.round(h.sim * 100)} %)` : ""}
                      </small>
                    </span>
                    <em title="Qué tanto se parece a la pregunta">{Math.round(h.rank * 100)}</em>
                    <button type="button" className="pis-link" onClick={() => showInMesh(h.ref)}>
                      Ver en la malla
                    </button>
                  </li>
                ))}
              </ol>
            ))}
        </Group>
      )}
    </>
  );
}

const VIA = { palabras: "por palabras", significado: "por significado", ambas: "por palabras y significado" } as const;

/** Búsqueda por significado: cuánto está indexado y el botón que indexa lo que falta. */
function SemanticGroup({
  model,
  onModel,
  status,
  error,
  loading,
  progress,
  running,
  runError,
  onRun,
}: {
  model: string;
  /** Sin 0109 no hay dónde guardar otro modelo. */
  onModel?: (v: string) => void;
  status: EmbedStatus | null;
  error: Error | null;
  loading: boolean;
  progress: EmbedStatus | null;
  running: boolean;
  runError: Error | null;
  onRun: () => void;
}) {
  const now = progress ?? status;
  const pending = pendingOf(now);
  const list = useEmbedModels();
  const total = now ? now.memory_total + now.facts_total + now.catalog_total : 0;
  return (
    <Group title="Búsqueda por significado" aside={<small>{now?.model ? `Modelo ${now.model}` : "Embeddings del proveedor"}</small>}>
      <div className="pis-row">
        <p className="pis-note">
          Cada pasaje y cada indicador guardan un vector que dice de qué hablan. Así Pilo encuentra «tasa de deserción» cuando le preguntan «¿cuántos se fueron?», aunque no
          compartan palabras. Se combina con la búsqueda por palabras. Funciona con NVIDIA o Mistral y usa la misma clave.
        </p>
        <button type="button" className="button-secondary" onClick={onRun} disabled={running || loading || Boolean(error) || !now || pending === 0}>
          {running ? "Indexando…" : pending === 0 && now ? "Al día" : "Indexar por significado"}
        </button>
      </div>
      {error ? (
        <p className="pis-warn">{error.message}</p>
      ) : now ? (
        <p className="pis-small" role="status">
          {plural(now.memory_done, "pasaje", "pasajes")} de {now.memory_total.toLocaleString("es-CO")} y {plural(now.facts_done, "indicador", "indicadores")} de{" "}
          {now.facts_total.toLocaleString("es-CO")}
          {now.catalog_total ? ` y ${plural(now.catalog_done, "respuesta oficial", "respuestas oficiales")} de ${now.catalog_total.toLocaleString("es-CO")}` : ""} tienen su vector
          {pending ? ` · faltan ${pending.toLocaleString("es-CO")}${running ? ` de ${total.toLocaleString("es-CO")}` : ""}` : " · todo al día"}.
        </p>
      ) : (
        <p className="pis-small">{loading ? "Revisando el índice…" : "Sin datos del índice."}</p>
      )}
      {runError && (
        <p className="pis-error" role="alert">
          No terminó de indexar: {runError.message}
        </p>
      )}
      {onModel && (
        <details className="pis-adv">
          <summary>Opciones avanzadas</summary>
          <div className="pis-grid">
            <label>
              Modelo de embeddings (vacío: el de partida del proveedor)
              <input value={model} onChange={(e) => onModel(e.target.value.trim())} placeholder={status?.model || "nvidia/llama-nemotron-embed-1b-v2"} spellCheck={false} />
            </label>
          </div>
          <p className="pis-small">
            Solo si el proveedor retira el de partida. Debe dar vectores de 1024 dimensiones o más (los más largos se recortan). Al cambiarlo, guarde los cambios y vuelva a
            indexar.
          </p>
          <div className="pis-row">
            <button type="button" className="button-secondary" onClick={() => list.mutate()} disabled={list.isPending}>
              {list.isPending ? "Preguntando al proveedor…" : "Ver modelos disponibles"}
            </button>
          </div>
          {list.isError && (
            <p className="pis-error" role="alert">
              {(list.error as Error).message}
            </p>
          )}
          {list.data &&
            (list.data.models.length === 0 ? (
              <p className="pis-small">El proveedor no listó modelos de embeddings con esta clave.</p>
            ) : (
              <ul className="pis-hits" aria-label="Modelos de embeddings disponibles">
                {list.data.models.map((id) => (
                  <li key={id}>
                    <span>
                      <strong>{id}</strong>
                      {id === list.data.current && <small>En uso</small>}
                    </span>
                    <button type="button" className="pis-link" onClick={() => onModel(id)} disabled={id === (model || list.data.current)}>
                      Usar este
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </details>
      )}
    </Group>
  );
}
