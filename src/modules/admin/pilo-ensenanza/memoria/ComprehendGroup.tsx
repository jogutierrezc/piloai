/* =============================================================================
   Mr. Pilo · Memoria › Comprensión con IA (pilo-ia «comprender», 0115).

   El único «Comprender» de cada Pilo. Lo montan «Mr. Pilo en Enseñanza» (su
   momento «Comprender») y, desde 0121, «Mr. Pilo con IA» para los documentos
   del Pilo general: por eso recibe el espacio, no la ficha, y vive en su
   propio archivo (así la otra pantalla no carga toda la Memoria de Enseñanza).
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PiloSpace } from "../../pilo/space";
import { Group, StatusMark, plural } from "../../pilo/ui";
import { activity } from "../actividad";
import { fillBar as fillBarTo } from "../motion";
import { Skeleton } from "../ui";
import { comprehend, useComprehendStatus, useRefreshMemory, useTeachMap } from "./data";
import { faultOf } from "./flow";
import type { Fault } from "./flow";
import { THINK_BUDGETS, THINK_LIMITS, readThinkStatus, thinkActive, thinkGain, thinkReduce, thinkResume, thinkShare, thinkStart } from "./map";
import type { ThinkEvent, ThinkRun } from "./map";
import { FaultNote, MissingNote } from "./parts";

/* --- La corrida ------------------------------------------------------------------------------
   La corrida dura el tiempo de pensamiento que se le dé sin que nadie la relance: la máquina de memoria/map.ts
   (thinkReduce) decide tras cada lote si sigue, si espera y reintenta —un lote
   que falla no detiene la corrida ni pierde lo hecho— o si para. El avance y
   «Detener» van al panel de Pilo; el mapa solo muestra el resultado. */

const UNDERSTAND_OWNER = "comprender";

export function ComprehendGroup({
  space,
  off,
  onMap,
  offNote = "Sin la migración 0113 este Pilo no tiene nada que comprender.",
  dock = true,
}: {
  /** De qué Pilo son los pasajes. */
  space: PiloSpace;
  /** Falta la migración que le da documentos a este Pilo. */
  off: boolean;
  /** Lleva al mapa de conexiones, donde lo haya. */
  onMap?: () => void;
  offNote?: string;
  /** La pantalla tiene el panel de Pilo, que cuenta el avance. Donde no lo hay, el avance es el de este grupo. */
  dock?: boolean;
}) {
  const map = useTeachMap(space, !off);
  const missing = map.data?.missing ?? null;
  const ai = useComprehendStatus(space, !off && map.data !== undefined && !missing);
  const refresh = useRefreshMemory(space);
  // La corrida: en un ref para el bucle (que sobrevive a los pintados) y en estado para verla.
  const [think, setThink] = useState<ThinkRun | null>(null);
  const thinkRef = useRef<ThinkRun | null>(null);
  const [budget, setBudget] = useState("60");
  const [fault, setFault] = useState<Fault | null>(null);
  const wake = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      wake.current?.();
      activity.end(UNDERSTAND_OWNER);
    };
  }, []);

  const running = thinkActive(think);
  // Mientras corre (y hasta que la base responde de nuevo) manda lo que dijo el último lote.
  const status = (think && (running || ai.isFetching || map.isFetching) ? think.status : null) ?? readThinkStatus(ai.data?.status) ?? readThinkStatus(map.data?.data.status);
  const hasAi = ai.data ? ai.data.ai !== false : null;
  const pending = status?.pending ?? 0;

  const put = (next: ThinkRun) => {
    thinkRef.current = next;
    if (alive.current) setThink(next);
  };

  /** Lo que Pilo cuenta de la corrida en su panel. Mientras se detiene ya no ofrece «Detener». */
  const tell = (run: ThinkRun) => {
    const g = thinkGain(run);
    const st = run.status;
    activity.set({
      owner: UNDERSTAND_OWNER,
      title: run.phase === "esperando" ? "Pilo espera para reintentar" : run.phase === "deteniendo" ? "Pilo termina el lote y se detiene" : "Pilo está comprendiendo sus pasajes",
      line:
        run.phase === "esperando"
          ? run.why
          : st
            ? `${st.mapped.toLocaleString("es-CO")} de ${st.total.toLocaleString("es-CO")} pasajes comprendidos · ${plural(g.topics, "tema nuevo", "temas nuevos")} · ${plural(g.refs, "referencia nueva", "referencias nuevas")}.`
            : "Pregunta a la IA de qué trata cada pasaje y qué normas cita.",
      progress: thinkShare(st),
      counter: `Lote ${run.rounds + 1}`,
      stop: run.phase === "deteniendo" ? undefined : halt,
    });
  };

  /** Detener: el lote en curso termina y se guarda; una espera se corta ya. */
  function halt() {
    if (!thinkRef.current || !thinkActive(thinkRef.current)) return;
    const next = thinkReduce(thinkRef.current, { type: "detener" });
    put(next);
    if (thinkActive(next)) tell(next);
    wake.current?.();
  }

  /** Lote tras lote, el tiempo que se le dio: sigue, espera y reintenta, o para (thinkReduce). */
  const understand = async () => {
    if (thinkActive(thinkRef.current)) return;
    const limits = { ...THINK_LIMITS, maxMs: THINK_BUDGETS.find((b) => b.id === budget)?.ms ?? THINK_LIMITS.maxMs };
    const prev = thinkRef.current;
    const apply = (event: ThinkEvent) => {
      const next = thinkReduce(thinkRef.current!, event, limits);
      put(next);
      return next;
    };
    setFault(null);
    put(prev && prev.again && prev.phase !== "listo" ? thinkResume(prev, status, Date.now()) : thinkStart(status, Date.now()));
    try {
      while (alive.current && thinkActive(thinkRef.current)) {
        const now = thinkRef.current!;
        tell(now);
        if (now.phase === "esperando") {
          await new Promise<void>((resolve) => {
            const timer = window.setTimeout(resolve, now.waitMs);
            wake.current = () => {
              window.clearTimeout(timer);
              resolve();
            };
          });
          wake.current = null;
          apply({ type: "esperado", now: Date.now() });
          continue;
        }
        try {
          const result = await comprehend(space, "lote");
          const after = apply({ type: "lote", result, now: Date.now() });
          // Cada pocos lotes el mapa se vuelve a leer: los temas nuevos se ven llegar.
          if (alive.current && thinkActive(after) && after.rounds % 4 === 0) void map.refetch();
        } catch (error) {
          const f = faultOf(error);
          const after = apply({ type: "fallo", retry: f.retry, why: `${f.title}.${f.detail && f.detail !== f.title ? ` ${f.detail}` : ""}`, now: Date.now() });
          if (after.phase === "detenido" && alive.current) setFault(f);
        }
      }
    } finally {
      activity.end(UNDERSTAND_OWNER);
      refresh();
    }
  };

  const gain = thinkGain(think);
  const runLine = think
    ? `${plural(gain.mapped, "pasaje comprendido", "pasajes comprendidos")}, ${plural(gain.topics, "tema nuevo", "temas nuevos")} y ${plural(gain.refs, "referencia nueva", "referencias nuevas")} en ${plural(think.rounds, "lote", "lotes")}${think.failed ? ` (${plural(think.failed, "falló y se reintentó", "fallaron y se reintentaron")})` : ""}`
    : "";
  const bar = useRef<HTMLSpanElement>(null);
  const share = thinkShare(status);

  return (
    <Group title="Comprensión con IA" aside={<small>{status ? `${plural(status.topics, "tema", "temas")} · ${plural(status.refs, "referencia", "referencias")}` : "De qué trata cada pasaje"}</small>}>
      {off ? (
        <p className="pis-small">{offNote}</p>
      ) : missing ? (
        <MissingNote migration={missing} what="Sin ella Pilo no guarda temas ni referencias: los documentos quedan en pasajes y responde igual, pero sin seguir conexiones." />
      ) : map.isError ? (
        <FaultNote fault={faultOf(map.error)} lead="No se pudo leer el estado de la comprensión" onRetry={() => void map.refetch()} />
      ) : map.isPending ? (
        <Skeleton rows={2} label="Revisando lo comprendido" />
      ) : (
        <>
          <div className="pis-row">
            <p className="pis-note">
              Pilo le pregunta a la IA de qué trata cada pasaje y qué normas o referentes cita; con eso arma los temas y las referencias del mapa. Trabaja en lotes largos y sigue
              solo durante el tiempo de pensamiento que le dé; si un lote falla, espera y reintenta. Puede detenerlo y retomarlo: lo ya comprendido no se pierde.
              {hasAi === false ? " Sin IA, el mapa es el básico: estructura y normas citadas." : ""}
            </p>
            <span className="msh-think">
              <label>
                Tiempo de pensamiento
                <select value={budget} onChange={(e) => setBudget(e.target.value)} disabled={running}>
                  {THINK_BUDGETS.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </label>
              {/* El mismo botón inicia y detiene: en el móvil el panel de Pilo queda arriba, fuera de la vista. */}
              <button
                type="button"
                className={running ? "button-secondary" : "button-primary"}
                onClick={() => (running ? halt() : void understand())}
                disabled={running ? think?.phase === "deteniendo" : hasAi !== true || pending === 0}
              >
                {running
                  ? think?.phase === "deteniendo"
                    ? "Deteniendo…"
                    : "Detener"
                  : hasAi === false
                    ? "Comprender necesita la IA"
                    : pending === 0 && status
                      ? "Todo comprendido"
                      : think?.again
                        ? "Retomar"
                        : status && status.mapped > 0
                          ? "Continuar comprendiendo"
                          : "Comprender lo que falta"}
              </button>
            </span>
          </div>

          {status && (
            <>
              <p className="pis-small">
                <StatusMark tone={hasAi === false ? "off" : running ? "off" : pending ? "warn" : "ok"}>
                  {hasAi === false ? "Mapa básico" : running ? "Comprendiendo" : pending ? `Faltan ${plural(pending, "pasaje", "pasajes")}` : "Todo comprendido"}
                </StatusMark>{" "}
                {status.mapped.toLocaleString("es-CO")} de {plural(status.total, "pasaje comprendido", "pasajes comprendidos")}.
                {running ? (dock ? " El avance se ve en el panel de Pilo; puede seguir trabajando en otra sección." : " Puede seguir trabajando en otra sección: la corrida no se corta.") : ""}
              </p>
              <ShareBar bar={bar} share={share} label="Pasajes comprendidos" />
            </>
          )}
          {think && !running && think.rounds > 0 && <p className="pis-small">Última corrida: {runLine}.</p>}
          {think && !running && think.why && !fault && <p className={think.phase === "pausado" ? "pis-small" : "pis-warn"}>{think.why}</p>}
          {fault && !running && <FaultNote fault={fault} lead="Comprender se detuvo" onRetry={fault.retry ? () => void understand() : undefined} />}
          {ai.isError && !running && <FaultNote fault={faultOf(ai.error)} lead="No se pudo saber si este Pilo tiene IA para comprender" onRetry={() => void ai.refetch()} />}
          {onMap && (
            <p className="pis-small">
              Los temas y las referencias que salen de aquí se ven en el{" "}
              <button type="button" className="pis-link" onClick={onMap}>
                Mapa de conexiones
              </button>
              .
            </p>
          )}
        </>
      )}
    </Group>
  );
}

/** Una barra de avance que va a su valor. */
function ShareBar({ bar, share, label }: { bar: RefObject<HTMLSpanElement>; share: number; label: string }) {
  const started = useRef(false);
  useLayoutEffect(() => {
    fillBarTo(bar.current, share, started.current ? undefined : 0);
    started.current = true;
  }, [bar, share]);
  return (
    <i className="pen-bar" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
      <span ref={bar} />
    </i>
  );
}
