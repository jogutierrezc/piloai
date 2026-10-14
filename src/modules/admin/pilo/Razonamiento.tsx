/* =============================================================================
   Intranet · Mr. Pilo con IA · cómo razona Pilo (0130).

   Las piezas de pantalla de las relaciones, las premisas de las capciosas y el
   análisis antes de responder. Sirven a los dos Pilos: cada una recibe de qué
   Pilo es.

     ReasoningGroup   los tres interruptores y sus topes, en «Pregúntele a Pilo».
     PremisesGroup    en el catálogo de capciosas: cuántas tienen su premisa y
                      el botón para que la IA proponga las que faltan.
     PremiseMark      en cada capciosa de la lista: en qué va su premisa.
     PremiseEditor    en el modal de una capciosa: verla, corregirla, aprobarla.

   Todo se aplica al momento, como el catálogo: no espera a «Guardar cambios».
   Sin la migración 0130 los controles quedan apagados y se dice por qué.
   ========================================================================== */

import { useEffect, useState } from "react";
import { Icon } from "../../../components/ui/Icon";
import { PREMISE_MAX, REASON_LIMITS, TRUTH_MAX, normalizeReason, premiseCounts, premiseProblem, premiseState, reasonSummary, useClearPremise, usePremises, useProposePremises, useReason, useSavePremise, useSaveReason } from "./premises";
import type { PremiseRow, PremiseRun, ReasonValues } from "./premises";
import { DEFAULT_SPACE } from "./space";
import type { PiloSpace } from "./space";
import { Group, NumField, StatusMark, Switch, plural } from "./ui";

const NEEDS_0130 = "Falta aplicar la migración 0130 en la base. Mientras tanto Pilo pide y responde como siempre.";

/** Los interruptores de las tres piezas y sus topes, para un Pilo. */
export function ReasoningGroup({ space = DEFAULT_SPACE }: { space?: PiloSpace }) {
  const reason = useReason(space);
  const save = useSaveReason(space);
  const v = reason.data ?? normalizeReason(null);
  const off = !reason.data || Boolean(v.needs0130);
  const set = <K extends keyof ReasonValues>(key: K, value: ReasonValues[K]) => save.mutate({ ...v, [key]: value });

  return (
    <Group title="Cómo razona" aside={<small>Se aplica al momento · todo nace apagado</small>}>
      {reason.data?.needs0130 && <p className="pis-warn">{NEEDS_0130}</p>}
      <p className="pis-lead">
        Tres ayudas para que Pilo responda mejor lo difícil, cada una con su interruptor. Apagadas, el pedido a la IA es exactamente el de siempre. Ninguna le pide a la IA
        inventar conexiones: solo usa lo que ya está en la memoria, en el mapa y en el catálogo.
      </p>
      <dl className="pis-opts">
        <div>
          <dt>
            Relaciones en el pedido
            <small>La IA recibe cómo se conectan las fuentes de esa pregunta (de qué tratan, qué citan, de qué otro ámbito vienen), con la autoridad de cada conexión.</small>
          </dt>
          <dd>
            <Switch on={v.ask_relations} disabled={off} onChange={(on) => set("ask_relations", on)} label="Relaciones en el pedido" />
          </dd>
        </div>
        <div>
          <dt>
            Capciosas cercanas
            <small>
              Una pregunta que se parece a una capciosa sin dispararla va a la IA con esa capciosa como regla del catálogo y, si usted la aprobó, con su premisa y lo que es
              cierto.
            </small>
          </dt>
          <dd>
            <Switch on={v.tricky_near} disabled={off} onChange={(on) => set("tricky_near", on)} label="Capciosas cercanas" />
          </dd>
        </div>
        <div>
          <dt>
            Análisis antes de responder
            <small>
              Solo cuando hay señales y ninguna premisa aprobada: la IA analiza en tres frases y después responde. El análisis no se le muestra a quien pregunta; la
              administración lo ve en «Cómo respondí». La respuesta tarda un poco más.
            </small>
          </dt>
          <dd>
            <Switch on={v.ask_analysis} disabled={off} onChange={(on) => set("ask_analysis", on)} label="Análisis antes de responder" />
          </dd>
        </div>
      </dl>
      <details className="pis-adv">
        <summary>Opciones avanzadas</summary>
        <div className="pis-grid pis-grid--3">
          <NumField
            label="Relaciones: líneas"
            hint="Cuántas conexiones caben, como mucho"
            {...REASON_LIMITS.ask_relations_lines}
            value={v.ask_relations_lines}
            disabled={off}
            onCommit={(n) => set("ask_relations_lines", n)}
          />
          <NumField
            label="Relaciones: caracteres"
            hint="Se descuentan del contexto"
            {...REASON_LIMITS.ask_relations_chars}
            value={v.ask_relations_chars}
            disabled={off}
            onCommit={(n) => set("ask_relations_chars", n)}
          />
          <NumField
            label="Parecido con una capciosa"
            hint="Más alto, más exigente"
            {...REASON_LIMITS.tricky_near_min}
            step={0.01}
            value={v.tricky_near_min}
            disabled={off}
            onCommit={(n) => set("tricky_near_min", n)}
          />
        </div>
      </details>
      <p className="pis-small" role="status">
        {reasonSummary(v)}
      </p>
      {save.isError && (
        <p className="pis-error" role="alert">
          No se guardó: {(save.error as Error).message}
        </p>
      )}
    </Group>
  );
}

/** En qué va la premisa de una capciosa, para la lista del catálogo. Sin 0130, nada. */
export function PremiseMark({ row, known }: { row: PremiseRow | undefined; /** Las premisas ya se leyeron de la base. */ known: boolean }) {
  if (!known) return null;
  const state = premiseState(row);
  return (
    <small>
      <StatusMark tone={state.tone}>{state.label}</StatusMark>
      {row?.premise ? ` · ${row.premise}` : ""}
    </small>
  );
}

/** Las premisas de las capciosas de un Pilo: cuántas hay y el botón para que la IA proponga las que faltan. */
export function PremisesGroup({ space = DEFAULT_SPACE, active }: { space?: PiloSpace; /** Las claves de las capciosas activas de este Pilo. */ active: string[] }) {
  const premises = usePremises();
  const propose = useProposePremises(space);
  const [progress, setProgress] = useState<PremiseRun | null>(null);
  const missing = premises.data === null;
  const counts = premiseCounts(active, premises.data ?? {});
  const run = propose.data ?? null;

  return (
    <Group title="Qué da por cierto cada capciosa" aside={<small>La IA propone · usted aprueba</small>}>
      {missing && <p className="pis-warn">{NEEDS_0130}</p>}
      <div className="pis-row">
        <p className="pis-note">
          Una capciosa trae una trampa: algo que da por cierto sin serlo. Aquí queda escrito, una sola vez y revisado, cuál es esa premisa y qué es lo cierto. La IA lo
          propone; usted lo corrige y lo aprueba en «Editar». Solo lo aprobado llega a Pilo, y solo con «Capciosas cercanas» encendido en Pregúntele a Pilo › Cómo razona.
        </p>
        <button
          type="button"
          className="button-secondary"
          disabled={missing || premises.isPending || propose.isPending || counts.pending === 0}
          onClick={() => propose.mutate(setProgress, { onSettled: () => setProgress(null) })}
        >
          <Icon name="spark" size={16} />
          {propose.isPending ? "Proponiendo…" : counts.pending === 0 ? "Nada por proponer" : "Proponer con la IA"}
        </button>
      </div>
      {!missing && (
        <p className="pis-small" role="status">
          <StatusMark tone={counts.total > 0 && counts.approved === counts.total ? "ok" : counts.approved > 0 ? "warn" : "off"}>
            {counts.approved.toLocaleString("es-CO")} de {plural(counts.total, "capciosa en uso", "capciosas en uso")} con premisa aprobada
          </StatusMark>
          {counts.proposed ? ` · ${plural(counts.proposed, "propuesta por revisar", "propuestas por revisar")}` : ""}
          {counts.pending ? ` · ${plural(counts.pending, "sin revisar por la IA", "sin revisar por la IA")}` : ""}
          {progress ? ` · van ${progress.asked.toLocaleString("es-CO")}` : ""}
        </p>
      )}
      {run && !propose.isPending && (
        <p className="pis-result" role="status">
          <StatusMark tone={run.note ? "warn" : "ok"}>
            {run.asked === 0 && run.note
              ? run.note
              : `La IA revisó ${plural(run.asked, "capciosa", "capciosas")}: propuso ${plural(run.proposed, "premisa", "premisas")}${run.empty ? ` y en ${run.empty.toLocaleString("es-CO")} no halló ninguna` : ""}.${run.note ? ` ${run.note}` : " Revíselas y apruébelas en «Editar»."}`}
          </StatusMark>
        </p>
      )}
      {propose.isError && (
        <p className="pis-error" role="alert">
          No terminó de proponer: {(propose.error as Error).message}
        </p>
      )}
    </Group>
  );
}

/**
 * La premisa de una capciosa, en su modal: verla, corregirla y aprobarla. Va
 * dentro del formulario de la capciosa, pero se guarda aparte y al momento
 * (sus botones no envían el formulario).
 */
export function PremiseEditor({ entryKey }: { entryKey: string }) {
  const premises = usePremises();
  const save = useSavePremise();
  const clear = useClearPremise();
  const row = premises.data?.[entryKey];
  const savedPremise = row?.premise ?? "";
  const savedTruth = row?.truth ?? "";
  const [premise, setPremise] = useState(savedPremise);
  const [truth, setTruth] = useState(savedTruth);
  // Lo que llega de la base (otra capciosa, o lo recién guardado) reemplaza lo escrito.
  useEffect(() => {
    setPremise(savedPremise);
    setTruth(savedTruth);
  }, [entryKey, savedPremise, savedTruth]);

  if (premises.data === null) return <p className="pis-warn">{NEEDS_0130}</p>;
  if (!premises.data) return null;

  const state = premiseState(row);
  const dirty = premise.trim() !== savedPremise || truth.trim() !== savedTruth;
  const busy = save.isPending || clear.isPending;
  const draftProblem = premiseProblem(premise, truth, false);
  const approveProblem = premiseProblem(premise, truth, true);
  const error = (save.error ?? clear.error) as Error | null;

  return (
    <div className="pis-modal-field">
      <label htmlFor="cat-premise">
        Lo que la pregunta da por cierto <small>({state.label.toLowerCase()})</small>
      </label>
      <textarea
        id="cat-premise"
        rows={2}
        maxLength={PREMISE_MAX}
        value={premise}
        placeholder="Da por hecho que Pilo es una persona y tiene vida sentimental."
        onChange={(e) => setPremise(e.target.value)}
      />
      <label htmlFor="cat-truth">Lo que es cierto</label>
      <textarea
        id="cat-truth"
        rows={2}
        maxLength={TRUTH_MAX}
        value={truth}
        placeholder="Pilo es la Inteligencia Artificial de la universidad: no tiene vida personal."
        onChange={(e) => setTruth(e.target.value)}
      />
      <small>
        Con «Capciosas cercanas» encendido, Pilo usa estas dos frases como regla del catálogo cuando la pregunta dispara esta capciosa o se le parece. Solo si están
        aprobadas. Se guardan al momento, aparte del resto de la capciosa; si después cambia el tema, los disparadores o la respuesta, vuelven a revisión.
      </small>
      <div className="pis-actions">
        <button
          type="button"
          className="button-primary"
          disabled={busy || Boolean(approveProblem) || (row?.status === "aprobada" && !dirty)}
          onClick={() => save.mutate({ key: entryKey, premise, truth, approve: true })}
        >
          {save.isPending && save.variables?.approve ? "Aprobando…" : row?.status === "aprobada" && !dirty ? "Aprobada" : "Aprobar"}
        </button>
        <button
          type="button"
          className="button-secondary"
          disabled={busy || Boolean(draftProblem) || (!dirty && row?.status !== "aprobada")}
          onClick={() => save.mutate({ key: entryKey, premise, truth, approve: false })}
        >
          {row?.status === "aprobada" ? "Dejar sin aprobar" : "Guardar sin aprobar"}
        </button>
        {row && (
          <button type="button" className="button-ghost" disabled={busy} onClick={() => clear.mutate(entryKey)}>
            Quitar
          </button>
        )}
      </div>
      {(draftProblem || (dirty && approveProblem && premise.trim() && truth.trim())) && <small data-bad>{draftProblem ?? approveProblem}</small>}
      {error && (
        <p className="pis-error" role="alert">
          No se guardó: {error.message}
        </p>
      )}
    </div>
  );
}
