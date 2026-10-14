/* =============================================================================
   Mr. Pilo en Enseñanza · Bitácora de uso.

   Uso de hoy       pilo_space_usage('ensenanza'): today contra limit (las
                    preguntas con IA, lo único que gasta su cupo) y today_voice
                    contra el cupo de voz de Mr. Pilo con IA (voice_daily_limit).
   Quién preguntó   by_rol del mismo llamado: estudiantes, profesores y sin rol.
   Pedidos          pilo_ai_log con space = 'ensenanza', por día (created_at) y
                    por rol (columna rol). Nada identifica al visitante.

   Primero lo que pide atención: si el cupo de preguntas o el de voz está por
   agotarse, se dice arriba, antes de los medidores. El uso de hoy y quién
   preguntó comparten una hoja; los pedidos van en la suya.

   Solo lectura: aquí no hay nada que guardar. Los cupos se cambian en
   «Pregúntele a Pilo».
   ========================================================================== */

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { StatusMark, Group, plural } from "../pilo/ui";
import type { SpaceEditor } from "./PreguntaPanel";
import { LOG_PAGE, ROL_FILTERS, useSpaceLog, useSpaceUsage } from "./store";
import type { RolFilter, SpaceUsage } from "./store";
import { fillBar } from "./motion";
import { Meter, RolTag, Sheet, Skeleton, useEnter } from "./ui";

const LOG_TONE = (status: string, cached: boolean) =>
  cached || status === "listo" ? ("ok" as const) : status === "revisar" || status === "limite" ? ("warn" as const) : ("fail" as const);

/** Hoy, en la fecha de quien mira (no en UTC). */
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const ACTION: Record<string, string> = { preguntar: "Pregunta", voz: "Lectura con voz", calificar: "Calificación", indexar: "Índice", comprender: "Mapa", moodle: "Moodle" };

export function BitacoraPanel({ ed, onQuotas }: { ed: SpaceEditor; onQuotas: () => void }) {
  const { s, saved, missing, shared } = ed;
  const client = useQueryClient();
  const usage = useSpaceUsage(s.id, !missing);
  const [day, setDay] = useState("");
  const [rol, setRol] = useState<RolFilter>("todos");
  const log = useSpaceLog(s.id, { day, rol }, !missing);
  const rows = log.data ?? [];
  // Entra cuando cambia lo que se ve (otro filtro, pedidos nuevos), no en cada relectura.
  const list = useEnter<HTMLUListElement>(log.data && !log.isPlaceholderData ? `${day}|${rol}|${rows.map((r) => r.id).join()}` : null);
  const u = usage.data;

  const refresh = () => client.invalidateQueries({ queryKey: ["pilo-ia", "espacio", s.id] });

  // Lo que pide atención: un cupo en el tope o a punto de llegar.
  const voiceLimit = shared?.voice_daily_limit ?? 0;
  const near = (used: number, limit: number) => (limit > 0 ? used / limit >= 0.9 : used > 0);
  const alerts = !u || missing ? [] : [near(u.today, saved.daily_limit) ? "preguntas con IA" : "", near(u.todayVoice, voiceLimit) ? "lecturas con voz" : ""].filter(Boolean);

  return (
    <>
      <Sheet off={missing}>
      {alerts.length > 0 && (
        <p className="pis-warn" role="status">
          <strong>El cupo de {alerts.join(" y de ")} de hoy está en el tope o por llegar.</strong> Al agotarse, Pilo sigue respondiendo, pero sin IA o con la voz del navegador, y lo dice.
        </p>
      )}
      <Group
        title="Uso de hoy"
        aside={
          <button type="button" className="button-secondary pen-refresh" onClick={refresh} disabled={missing || usage.isFetching || log.isFetching}>
            {usage.isFetching || log.isFetching ? "Actualizando…" : "Actualizar"}
          </button>
        }
      >
        {missing ? (
          <p className="pis-small">Sin la migración 0113 este Pilo no tiene bitácora propia.</p>
        ) : usage.isPending ? (
          <Skeleton rows={2} label="Contando el uso de hoy" />
        ) : !u ? (
          <p className="pis-warn">No se pudo leer el uso de hoy (pilo_space_usage). Revise que la migración 0113 esté aplicada completa.</p>
        ) : (
          <>
            <Meter
              label="Preguntas con IA de hoy"
              used={u.today}
              // El tope que cuenta es el guardado: uno sin guardar todavía no rige.
              limit={saved.daily_limit}
              unit="preguntas con IA"
              full="Sin cupo, este Pilo responde con su catálogo y su memoria tal cual, y lo dice."
            />
            <Meter
              label="Lecturas con voz de hoy"
              used={u.todayVoice}
              limit={voiceLimit}
              unit="lecturas con voz"
              full="Sin cupo, lee con la voz del navegador y lo dice."
            />
            <p className="pis-small">
              El cupo de preguntas es de este Pilo y se cambia en{" "}
              <button type="button" className="pis-link" onClick={onQuotas}>
                Pregúntele a Pilo › Cupos
              </button>
              . El de voz es el de Mr. Pilo con IA, contado aparte para cada Pilo.
            </p>
          </>
        )}
      </Group>

      {u && !missing && <ByRol usage={u} />}
      </Sheet>

      <Sheet off={missing}>
      <Group title="Pedidos" aside={<small>Los {LOG_PAGE} más recientes del filtro</small>}>
        <div className="pen-filters">
          <label>
            Día
            <input type="date" value={day} max={today()} onChange={(e) => setDay(e.target.value)} />
          </label>
          {day && (
            <button type="button" className="pis-link" onClick={() => setDay("")}>
              Todos los días
            </button>
          )}
          <span className="pis-seg pis-seg--sm" role="radiogroup" aria-label="Quién preguntó">
            {ROL_FILTERS.map((f) => (
              <button key={f.id} type="button" role="radio" aria-checked={rol === f.id} onClick={() => setRol(f.id)}>
                {f.label}
              </button>
            ))}
          </span>
        </div>

        {missing ? (
          <p className="pis-small">Sin la migración 0113 no hay pedidos de este Pilo.</p>
        ) : log.isPending ? (
          <Skeleton rows={4} label="Leyendo la bitácora" />
        ) : log.data === null ? (
          <p className="pis-warn">No se pudo leer la bitácora de este Pilo.</p>
        ) : rows.length === 0 ? (
          <p className="pis-small">{day || rol !== "todos" ? "Ningún pedido con ese filtro." : "Todavía no hay pedidos de este Pilo."}</p>
        ) : (
          <ul className="pis-log pen-log" ref={list} data-stale={log.isPlaceholderData || undefined}>
            {rows.map((r) => (
              <li key={r.id}>
                <span>{new Date(r.created_at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span>
                  <strong>{ACTION[r.action] ?? r.action}</strong>
                  <small>{r.subject}</small>
                </span>
                <RolTag rol={r.rol} />
                <StatusMark tone={LOG_TONE(r.status, r.cached)}>{r.cached ? "guardado" : r.status}</StatusMark>
              </li>
            ))}
          </ul>
        )}
      </Group>
      </Sheet>
    </>
  );
}

/** El reparto por rol de las preguntas con IA de hoy: tres barras contra el total. */
function ByRol({ usage }: { usage: SpaceUsage }) {
  const parts = [
    { id: "estudiante", label: "Estudiantes", n: usage.byRol.estudiante },
    { id: "profesor", label: "Profesores", n: usage.byRol.profesor },
    { id: "general", label: "Sin rol", n: usage.byRol.general },
  ];
  const total = Math.max(1, usage.today);
  return (
    <Group title="Quién preguntó hoy" aside={<small>{plural(usage.today, "pregunta con IA", "preguntas con IA")}</small>}>
      {usage.today === 0 ? (
        <p className="pis-small">Hoy nadie ha preguntado todavía.</p>
      ) : (
        <ul className="pen-split">
          {parts.map((p) => (
            <SplitRow key={p.id} id={p.id} label={p.label} n={p.n} share={p.n / total} />
          ))}
        </ul>
      )}
      <p className="pis-small">«Sin rol» son quienes no eligieron o cerraron la pregunta del primer uso. El rol lo dice la persona; nada la identifica.</p>
    </Group>
  );
}

function SplitRow({ id, label, n, share }: { id: string; label: string; n: number; share: number }) {
  const bar = useRef<HTMLSpanElement>(null);
  const started = useRef(false);
  useLayoutEffect(() => {
    fillBar(bar.current, share, started.current ? undefined : 0);
    started.current = true;
  }, [share]);
  return (
    <li data-rol={id}>
      <span>{label}</span>
      <i aria-hidden="true">
        <span ref={bar} />
      </i>
      <strong>
        {n.toLocaleString("es-CO")} <small>{Math.round(share * 100)} %</small>
      </strong>
    </li>
  );
}
