/* =============================================================================
   Mr. Pilo en Enseñanza · Pregúntele a Pilo.

   Seis filas plegables en una sola hoja. Cerrada, cada fila dice su valor
   actual (resumen.ts); solo se abre la que se va a cambiar, una a la vez, y la
   abierta se puede enlazar (?seccion=pregunta&fila=cupos). La que tiene
   cambios sin guardar lleva su punto, igual que la pestaña.

   Todo vive en la fila de pilo_spaces y espera a «Guardar cambios»:

   La página        aud, welcome y ai: para quién, si da la bienvenida y si
                    redacta con IA. Abierto o cerrado ("on") es el interruptor
                    del panel de Pilo.
   Conexión y voz   no hay nada que configurar aquí: son las de «Mr. Pilo con
                    IA». Se dice y se enlaza.
   Cómo se presenta intro (quién dice ser), focus (de qué habla) y greeting (el
                    saludo de la página).
   Cómo le habla    ask_rol y roles: por rol, el tono, las preguntas sugeridas,
   a cada quien     el estilo de voz (de los voice_styles de Mr. Pilo con IA),
                    la cara aprobada y el ánimo de la voz. La cara elegida se
                    mira en el panel de Pilo, a su tamaño: aquí no hay caras.
   Cupos            daily_limit, visitor_limit y visitor_window_seconds: los de
                    este Pilo, que no gastan los del otro.
   Otros portales   widget_on y widget_origins, y la línea para pegar con
                    data-pilo="ensenanza".
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Icon } from "../../../components/ui/Icon";
import type { VoiceStyle } from "../../../components/pilo/ai/logic";
import { normalizeOrigin } from "../../pilo-embed/embed";
import type { Lado, LeerModo } from "../../pilo-embed/embed";
import { TEMAS } from "../../pregunta/store";
import type { Tema } from "../../pregunta/store";
import { AudiencePicker } from "../pilo/sections";
import { PROVIDERS } from "../pilo/store";
import type { PiloSettings } from "../pilo/store";
import { NumField, StatusMark, Switch, plural } from "../pilo/ui";
import { activity } from "./actividad";
import { ROWS, dirtyRows, parseRow } from "./navegacion";
import type { RowId } from "./navegacion";
import { rowSummary, spanOf, voiceName } from "./resumen";
import type { SharedSummary } from "./resumen";
import { EXPRESSIONS, MAX_ORIGINS, MAX_SUGGESTIONS, ORAL_MOODS, ROLES, SPACE_LIMITS, TEXT_MAX, spaceSnippet } from "./store";
import type { RolId, RoleSettings, SpaceSettings } from "./store";
import { ReasoningGroup } from "../pilo/Razonamiento";
import { LeerPicker } from "../pilo/WidgetGroup";
import { FoldRow, Sheet, TextArea } from "./ui";

export interface SpaceEditor {
  s: SpaceSettings;
  saved: SpaceSettings;
  set: <K extends keyof SpaceSettings>(key: K, value: SpaceSettings[K]) => void;
  setRole: (rol: RolId, patch: Partial<RoleSettings>) => void;
  /** Falta la migración 0113: nada se puede guardar. */
  missing: boolean;
  /** La configuración de «Mr. Pilo con IA», de donde salen la conexión y la voz. */
  shared: PiloSettings | null;
  /** Personal de carga documental: ve la ficha, no cambia fuentes ni ajustes. */
  readOnly?: boolean;
}

/** Lo que el servidor le dice siempre al modelo para cada rol; el tono de aquí se suma. */
const ROLE_BASE: Record<RolId, string> = {
  estudiante: "Siempre: palabras sencillas, un ejemplo, explica la jerga y cierra con un paso concreto.",
  profesor: "Siempre: más preciso, vocabulario pedagógico y normativo, cita la política y sugiere cómo llevarlo al aula.",
};

const LADOS: { id: Lado; label: string }[] = [
  { id: "izq", label: "Izquierda" },
  { id: "der", label: "Derecha" },
];

export function PreguntaPanel({ ed, active }: { ed: SpaceEditor; /** La pestaña está a la vista. */ active: boolean }) {
  const { s, saved, set, missing, shared } = ed;
  const [params, setParams] = useSearchParams();
  const open = parseRow(params.get("fila"));
  const changed = dirtyRows(s, saved);
  // De quién es la cara que se mira en el panel de Pilo: el último rol que se tocó.
  const [faceOf, setFaceOf] = useState<RolId>("estudiante");
  const aiOff = shared ? !shared.enabled || shared.functions.preguntar === false : false;
  const about: SharedSummary | null = shared ? { enabled: shared.enabled, provider: PROVIDERS[shared.provider].label, voice: voiceName(shared) } : null;

  const toggle = (id: RowId) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("fila", open === id ? "" : id);
        return next;
      },
      { replace: true },
    );

  // Con la fila de los roles abierta, el panel de Pilo muestra la cara elegida, a su tamaño.
  const watching = active && open === "roles";
  const expression = s.roles[faceOf].expression;
  useEffect(() => {
    if (!watching) return;
    const rol = ROLES.find((r) => r.id === faceOf)!;
    activity.preview({ expression, label: `Cara de partida para el ${rol.label.toLowerCase()}: ${EXPRESSIONS.find((e) => e.id === expression)?.label ?? expression}` });
    return () => activity.preview(null);
  }, [watching, faceOf, expression]);

  const body: Record<RowId, () => ReactNode> = {
    pagina: () => (
      <>
        <div className="pis-row">
          <p className="pis-lead">
            Una página propia donde estudiantes y profesores le preguntan a Mr. Pilo por innovación educativa, políticas institucionales y la mirada global de la educación.
            Responde solo con su memoria y su catálogo: nada de lo que sabe el Pilo de Planeación entra aquí, ni al revés.
          </p>
          <Link to="/pilo-ensenanza" className="pis-link" target="_blank" rel="noopener">
            Abrir /pilo-ensenanza <Icon name="external" size={14} />
          </Link>
        </div>
        <dl className="pis-opts">
          <div>
            <dt>
              Para quién
              <small>«Con sesión» hoy es el personal de la intranet: no hay cuentas de estudiantes. Abrirla o cerrarla es el interruptor del panel de Pilo.</small>
            </dt>
            <dd>
              <AudiencePicker value={s.aud} label="Para quién es Mr. Pilo en Enseñanza" onPick={(aud) => set("aud", aud)} />
            </dd>
          </div>
          <div>
            <dt>Bienvenida la primera vez</dt>
            <dd>
              <Switch on={s.welcome} onChange={(v) => set("welcome", v)} label="Mostrar la bienvenida" />
            </dd>
          </div>
          <div>
            <dt>
              Redactar con IA
              <small>
                {aiOff
                  ? "Mr. Pilo con IA está apagado o sin «preguntar»: este Pilo responde con lo publicado tal cual."
                  : s.ai
                    ? "Sobre su catálogo, lo guardado y su memoria."
                    : "Apagado: responde con lo publicado tal cual."}
              </small>
            </dt>
            <dd>
              <Switch on={s.ai} onChange={(v) => set("ai", v)} label="Redactar con IA en este Pilo" />
            </dd>
          </div>
        </dl>
        {s.on && s.aud === "publico" && <p className="pis-warn">Abierto al público, cada visitante gasta del cupo de este Pilo. Revise la bitácora los primeros días.</p>}
      </>
    ),

    conexion: () => (
      <div className="pis-row">
        <p className="pis-note">
          Este Pilo no tiene conexión ni voz propias: el servicio, la clave, el modelo y la voz son los de «Mr. Pilo con IA».
          {about ? ` Hoy redacta con ${about.provider} y lee con ${about.voice}.` : ""} Lo que cambie allá vale para los dos.
        </p>
        <span className="pis-actions">
          <Link className="button-secondary" to="/admin/mr-pilo?seccion=conexion">
            Ver la conexión
          </Link>
          <Link className="button-secondary" to="/admin/mr-pilo?seccion=voz">
            Ver la voz
          </Link>
        </span>
      </div>
    ),

    presenta: () => (
      <>
        <p className="pis-small">Va al modelo como dato, nunca como instrucción.</p>
        <div className="pen-grid">
          <TextArea
            label="Presentación"
            hint={
              <>
                Así completa «Soy Mr. Pilo, …». Hoy diría: <q>Soy Mr. Pilo, {s.intro.trim() || "…"}.</q>
              </>
            }
            value={s.intro}
            max={TEXT_MAX.intro}
            rows={2}
            placeholder="la Inteligencia Artificial de la Universidad de Santander"
            onChange={(v) => set("intro", v)}
          />
          <TextArea
            label="Saludo de la página"
            hint="Lo primero que lee quien entra. Vacío, saluda con el de partida."
            value={s.greeting}
            max={TEXT_MAX.greeting}
            rows={2}
            placeholder="Hola. Pregúnteme por innovación educativa o por las políticas de la universidad."
            onChange={(v) => set("greeting", v)}
          />
        </div>
        <TextArea
          label="Enfoque"
          hint="De qué habla y de qué no. Sirve para que no se salga del tema; no reemplaza la memoria ni el catálogo."
          value={s.focus}
          max={TEXT_MAX.focus}
          rows={4}
          placeholder="Innovación educativa, políticas institucionales y referentes globales de la educación superior. No da cifras de Planeación ni asesoría personal."
          onChange={(v) => set("focus", v)}
        />
      </>
    ),

    roles: () => (
      <>
        <div className="pis-row">
          <span className="pis-fn__text">
            <strong>Preguntar el rol en el primer uso</strong>
            <small>
              La bienvenida y el chat emergente preguntan «¿Es estudiante o profesor?». Se guarda en el navegador de la persona, no la identifica y se puede cambiar después.
              Apagado, todos reciben la respuesta general.
            </small>
          </span>
          <Switch on={s.ask_rol} onChange={(v) => set("ask_rol", v)} label="Preguntar el rol en el primer uso" />
        </div>
        <div className="pen-roles">
          {ROLES.map((r) => (
            <RoleCard key={r.id} rol={r.id} title={r.label} ed={ed} watched={faceOf === r.id} onWatch={() => setFaceOf(r.id)} />
          ))}
        </div>
      </>
    ),

    cupos: () => (
      <>
        <p className="pis-small">Son de este Pilo: no gastan los de Mr. Pilo con IA.</p>
        <div className="pis-grid pis-grid--3">
          <NumField
            label="Preguntas con IA por día"
            hint="Sin cupo responde con lo publicado"
            {...SPACE_LIMITS.daily_limit}
            value={s.daily_limit}
            onCommit={(v) => set("daily_limit", v)}
          />
          <NumField label="Preguntas por visitante" hint="0 quita el límite" {...SPACE_LIMITS.visitor_limit} value={s.visitor_limit} onCommit={(v) => set("visitor_limit", v)} />
          <NumField
            label="Duración de la ventana (segundos)"
            {...SPACE_LIMITS.visitor_window_seconds}
            value={s.visitor_window_seconds}
            onCommit={(v) => set("visitor_window_seconds", v)}
          />
        </div>
        <p className="pis-small" role="status">
          {s.visitor_limit === 0 ? "Sin límite por visitante." : `Cada visitante puede hacer ${plural(s.visitor_limit, "pregunta", "preguntas")} cada ${spanOf(s.visitor_window_seconds)}.`}{" "}
          Las lecturas con voz se cuentan aparte, contra el cupo de voz de Mr. Pilo con IA.
        </p>
      </>
    ),

    portales: () => <WidgetGroup ed={ed} />,
  };

  return (
    <>
      <div className="pis-sheet pen-rows">
        {ROWS.map((r) => (
          <FoldRow key={r.id} id={r.id} title={r.title} summary={rowSummary(r.id, s, about)} open={open === r.id} dirty={changed.includes(r.id)} off={missing} onToggle={() => toggle(r.id)}>
            {body[r.id]()}
          </FoldRow>
        ))}
      </div>
      {/* Cómo razona este Pilo (0130): sus interruptores son suyos y se aplican al momento, aparte de «Guardar cambios». */}
      <Sheet off={missing}>
        <ReasoningGroup space={s.id} />
      </Sheet>
    </>
  );
}

/* --- Un rol --------------------------------------------------------------------------------- */

function RoleCard({ rol, title, ed, watched, onWatch }: { rol: RolId; title: string; ed: SpaceEditor; /** Su cara es la que se mira en el panel de Pilo. */ watched: boolean; onWatch: () => void }) {
  const { s, setRole, shared } = ed;
  const r = s.roles[rol];
  const styles: VoiceStyle[] = shared?.voice_styles ?? [];
  // Un estilo guardado que ya no existe en Mr. Pilo con IA se muestra, para poder cambiarlo.
  const orphan = r.voice_style && !styles.some((v) => v.id === r.voice_style);
  const [draft, setDraft] = useState("");
  const full = r.suggestions.length >= MAX_SUGGESTIONS;

  const add = (e: FormEvent) => {
    e.preventDefault();
    const q = draft.replace(/\s+/g, " ").trim().slice(0, TEXT_MAX.suggestion);
    if (!q || full || r.suggestions.includes(q)) return;
    setRole(rol, { suggestions: [...r.suggestions, q] });
    setDraft("");
  };

  return (
    <section className="pen-role" aria-label={`Cómo le habla al ${title.toLowerCase()}`} onFocusCapture={onWatch} onPointerDownCapture={onWatch}>
      <header className="pen-role__head">
        <h4>{title}</h4>
        <small>{ROLE_BASE[rol]}</small>
      </header>

      <TextArea
        label="Tono"
        hint="Se suma a lo de arriba. Ejemplo: «cercano, con ejemplos de la vida universitaria»."
        value={r.tone}
        max={TEXT_MAX.tone}
        rows={3}
        onChange={(v) => setRole(rol, { tone: v })}
      />

      <div className="pen-field">
        <span className="pen-field__label">
          Preguntas sugeridas
          <small>
            {r.suggestions.length} de {MAX_SUGGESTIONS}
          </small>
        </span>
        {r.suggestions.length > 0 && (
          <ul className="pen-chips">
            {r.suggestions.map((q) => (
              <li key={q}>
                <span>{q}</span>
                <button type="button" aria-label={`Quitar «${q}»`} onClick={() => setRole(rol, { suggestions: r.suggestions.filter((x) => x !== q) })}>
                  <Icon name="close" size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="pen-add" onSubmit={add}>
          <input
            value={draft}
            maxLength={TEXT_MAX.suggestion}
            disabled={full}
            placeholder={rol === "estudiante" ? "¿Cómo se evalúa por competencias?" : "¿Qué dice la política de evaluación?"}
            aria-label={`Nueva pregunta sugerida para ${title.toLowerCase()}`}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button type="submit" className="button-secondary" disabled={full || !draft.trim()}>
            Agregar
          </button>
        </form>
        <small>{full ? "Ya están las seis que caben en la página." : "Aparecen en la página cuando la persona eligió este rol."}</small>
      </div>

      <div className="pen-role__pair">
        <label className="pen-field">
          <span className="pen-field__label">Estilo de voz</span>
          <select value={r.voice_style} onChange={(e) => setRole(rol, { voice_style: e.target.value })}>
            <option value="">El estilo general de Mr. Pilo con IA</option>
            {styles.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
            {orphan && <option value={r.voice_style}>{r.voice_style} (ya no existe)</option>}
          </select>
          <small>
            {orphan
              ? "Ese estilo ya no está en Mr. Pilo con IA: sonará el general hasta que elija otro."
              : styles.length
                ? "Los estilos se graban en Mr. Pilo con IA › Voz."
                : "Mr. Pilo con IA aún no tiene estilos de voz grabados: sonará el general."}
          </small>
        </label>
        <label className="pen-field">
          <span className="pen-field__label">Ánimo de la voz</span>
          <select value={r.mood} onChange={(e) => setRole(rol, { mood: e.target.value as RoleSettings["mood"] })}>
            {ORAL_MOODS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <small>{ORAL_MOODS.find((m) => m.id === r.mood)?.note}</small>
        </label>
      </div>

      <div className="pen-field">
        <span className="pen-field__label" id={`pen-cara-${rol}`}>
          Cara de partida
        </span>
        <span className="pis-seg pis-seg--sm" role="radiogroup" aria-labelledby={`pen-cara-${rol}`}>
          {EXPRESSIONS.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={r.expression === e.id} onClick={() => setRole(rol, { expression: e.id })}>
              {e.label}
            </button>
          ))}
        </span>
        <small>
          {watched ? "Se ve ahora en el panel de Pilo, a su tamaño. " : "Tóquela para verla en el panel de Pilo. "}
          Las caras son las aprobadas por la universidad. La del catálogo, cuando una entrada trae su emoción, manda sobre esta.
        </small>
      </div>
    </section>
  );
}

/* --- Este Pilo en otros portales ------------------------------------------------------------- */

function WidgetGroup({ ed }: { ed: SpaceEditor }) {
  const { s, set } = ed;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [tema, setTema] = useState<Tema>("blanco");
  const [lado, setLado] = useState<Lado>("der");
  const [copied, setCopied] = useState<"si" | "no" | null>(null);
  const code = useRef<HTMLElement>(null);

  const origins = s.widget_origins;
  const [leer, setLeer] = useState<LeerModo>("no");
  const snippet = spaceSnippet(window.location.origin, s.id, tema, lado, leer);
  const openToAll = s.on && s.aud === "publico";

  const add = (e: FormEvent) => {
    e.preventDefault();
    const origin = normalizeOrigin(draft);
    if (!origin) return setError("Escriba la dirección del portal, por ejemplo https://aulavirtual.udes.edu.co.");
    if (origin === window.location.origin) return setError("Este portal ya puede mostrar a Pilo: no hace falta agregarlo.");
    if (origins.includes(origin)) return setError("Ese portal ya está en la lista.");
    if (origins.length >= MAX_ORIGINS) return setError(`La lista admite hasta ${MAX_ORIGINS} portales.`);
    set("widget_origins", [...origins, origin]);
    setDraft("");
    setError("");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied("si");
    } catch {
      // Sin portapapeles: el texto queda seleccionado para copiarlo a mano.
      const el = code.current;
      if (el) window.getSelection()?.selectAllChildren(el);
      setCopied("no");
    }
    window.setTimeout(() => setCopied(null), 2500);
  };

  return (
    <>
      <p className="pis-small">
        El mismo chat emergente de siempre, pero con este Pilo: un botón con su cara en la esquina de otra página (el aula virtual, por ejemplo). Quien administra ese portal solo
        pega una línea. Cada pregunta gasta del cupo de este Pilo.
      </p>

      <div className="pis-row">
        <span className="pis-fn__text">
          <strong>Permitir que otros portales lo muestren</strong>
          <small>Apagado, el chat emergente de este Pilo solo se ve dentro de este portal.</small>
        </span>
        <Switch on={s.widget_on} onChange={(v) => set("widget_on", v)} label="Permitir que otros portales muestren a Mr. Pilo en Enseñanza" />
      </div>

      <div className="pis-origins">
        <strong>Portales autorizados</strong>
        {origins.length ? (
          <ul>
            {origins.map((o) => (
              <li key={o}>
                <span>{o}</span>
                <button type="button" className="pis-link" aria-label={`Quitar ${o}`} onClick={() => set("widget_origins", origins.filter((x) => x !== o))}>
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pis-small">Aún no hay ninguno. Agregue la dirección de cada portal que va a mostrar a este Pilo.</p>
        )}
        <form className="pis-grid pis-origins__add" onSubmit={add}>
          <label>
            Dirección del portal
            <input
              value={draft}
              spellCheck={false}
              autoComplete="off"
              inputMode="url"
              placeholder="https://aulavirtual.udes.edu.co"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "pen-widget-origin-error" : undefined}
              onChange={(e) => {
                setDraft(e.target.value);
                setError("");
              }}
            />
          </label>
          <button type="submit" className="button-secondary" disabled={!draft.trim()}>
            Agregar
          </button>
        </form>
        {error && (
          <p className="pis-error" id="pen-widget-origin-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="pis-snippet">
        <strong>La línea para pegar en el otro portal</strong>
        <p className="pis-small">
          Va antes de cerrar &lt;/body&gt;. <code>data-pilo="{s.id}"</code> es lo que dice que es este Pilo y no el de Planeación.
        </p>
        <div className="pis-actions">
          <span className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Tema del chat">
            {TEMAS.map((t) => (
              <button key={t.id} type="button" role="radio" aria-checked={tema === t.id} onClick={() => setTema(t.id)}>
                {t.label}
              </button>
            ))}
          </span>
          <span className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Esquina del botón">
            {LADOS.map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={lado === l.id} onClick={() => setLado(l.id)}>
                {l.label}
              </button>
            ))}
          </span>
        </div>
        <LeerPicker value={leer} onChange={setLeer} />
        <pre tabIndex={0}>
          <code ref={code}>{snippet}</code>
        </pre>
        <div className="pis-actions">
          <button type="button" className="button-primary" onClick={copy}>
            <Icon name="check" size={16} />
            Copiar la línea
          </button>
          <span role="status">
            {copied === "si" && <StatusMark tone="ok">Copiada</StatusMark>}
            {copied === "no" && <StatusMark tone="warn">No se pudo copiar: quedó seleccionada para copiarla a mano</StatusMark>}
          </span>
        </div>
      </div>

      {s.widget_on && !openToAll && (
        <p className="pis-warn">Este Pilo no está abierto al público, y en otro portal nadie tiene sesión: el botón no aparecerá hasta abrirlo con el interruptor del panel de Pilo y elegir «el público» en «La página».</p>
      )}
    </>
  );
}
