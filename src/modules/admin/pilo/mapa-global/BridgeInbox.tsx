/* =============================================================================
   Mr. Pilo · el mapa global › «Puentes por revisar» (0122).

   Un puente une un punto de un Pilo con uno del otro. Los de reglas (la misma
   norma, el mismo ODS, el mismo nombre de un punto del Plan) los calcula la
   base y se aprueban solos. Los demás —un tema que los dos comparten, o una
   relación que propone la IA con su porqué— entran como PROPUESTA y esperan
   aquí: cada uno se aprueba o se rechaza por separado. No hay aprobación en
   bloque, y lo rechazado no se vuelve a proponer.

   Aprobar un puente no abre nada por sí solo: la búsqueda lo sigue únicamente
   hacia una fuente que el portal tenga «De visita» en «Qué lee cada portal».

   Sin IA la bandeja lo dice: los puentes por reglas siguen funcionando y se
   pueden recalcular. Sin la migración 0122 la bandeja no aparece (el mapa
   calcula los puentes al dibujar, como antes).
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../../../components/ui/Icon";
import { faultLine, faultOf } from "../../pilo-ensenanza/memoria/flow";
import { revealList } from "../motion";
import type { PiloSpace } from "../space";
import { StatusMark, plural } from "../ui";
import { BRIDGE_STATE_KEY, GLOBAL_MAP_KEY, bridgeCountsOf, bridgeStep, useBridgeSet, useBridgeState } from "./data";
import { ORIGIN_TEXT, STATUS_TEXT, inboxItem, inboxOf } from "./global";
import type { GNode, InboxItem, StoredBridge } from "./global";

const SPACE_SHORT: Record<PiloSpace, string> = { planeacion: "Planeación", ensenanza: "Enseñanza" };
/** Cuántos lotes seguidos pide «Proponer con IA» antes de devolver el control. */
const MAX_ROUNDS = 12;
const SHOWN = 8;

interface Said {
  tone: "ok" | "off" | "warn";
  text: string;
}

export function BridgeInbox({ rows, byId, onShow }: { /** Todos los puentes guardados. */ rows: StoredBridge[]; byId: Map<string, GNode>; /** Saltar a un punto en el mapa. */ onShow: (id: string) => void }) {
  const client = useQueryClient();
  const state = useBridgeState();
  const decide = useBridgeSet();
  const [said, setSaid] = useState<Said | null>(null);
  const [busy, setBusy] = useState<"reglas" | "ia" | null>(null);
  const [progress, setProgress] = useState("");
  const [all, setAll] = useState(false);
  const stop = useRef(false);
  const alive = useRef(true);
  const list = useRef<HTMLUListElement>(null);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stop.current = true;
    };
  }, []);

  const pending = inboxOf(rows, byId);
  const decided = rows.filter((b) => b.status !== "propuesta");
  const counts = bridgeCountsOf(state.data?.status);
  const hasAi = state.data ? state.data.ai !== false : null;

  // Las propuestas que llegan entran una vez, en su sitio; las que ya estaban no se mueven.
  useLayoutEffect(() => {
    const fresh = [...(list.current?.querySelectorAll<HTMLElement>("[data-bridge]") ?? [])].filter((el) => !seen.current.has(Number(el.dataset.bridge)));
    for (const el of fresh) seen.current.add(Number(el.dataset.bridge));
    if (fresh.length && fresh.length <= 12) revealList(fresh);
  }, [pending.length, all]);

  const reload = () => {
    void client.invalidateQueries({ queryKey: GLOBAL_MAP_KEY });
    void client.invalidateQueries({ queryKey: BRIDGE_STATE_KEY });
  };

  const set = (item: InboxItem | StoredBridge, status: "aprobada" | "rechazada") => {
    const b = "bridge" in item ? item.bridge : item;
    setSaid(null);
    decide.mutate(
      { id: b.id, status },
      {
        onSuccess: () => {
          const names = `«${b.a_label || b.a_id}» y «${b.b_label || b.b_id}»`;
          setSaid(
            status === "aprobada"
              ? { tone: "ok", text: `Aprobado el puente entre ${names}. Pilo lo sigue solo hacia las fuentes que un portal tenga «De visita» en «Qué lee cada portal».` }
              : { tone: "off", text: `Rechazado el puente entre ${names}: Pilo no lo sigue y no se vuelve a proponer.` },
          );
          void client.invalidateQueries({ queryKey: BRIDGE_STATE_KEY });
        },
      },
    );
  };

  const rules = async () => {
    setBusy("reglas");
    setSaid(null);
    try {
      const r = await bridgeStep("reglas");
      const added = Number(r.rules?.added ?? 0);
      const removed = Number(r.rules?.removed ?? 0);
      if (alive.current) setSaid({ tone: added || removed ? "ok" : "off", text: added || removed ? `Puentes por reglas al día: ${plural(added, "nuevo", "nuevos")}${removed ? ` y ${plural(removed, "retirado porque ya no aplica", "retirados porque ya no aplican")}` : ""}.` : "Los puentes por reglas ya estaban al día." });
    } catch (error) {
      if (alive.current) setSaid({ tone: "warn", text: `No se pudieron recalcular los puentes. ${faultLine(faultOf(error))}` });
    } finally {
      if (alive.current) setBusy(null);
      reload();
    }
  };

  /** Lote tras lote, hasta revisar todo, hasta que algo lo detenga o hasta que se pida parar. */
  const propose = async () => {
    setBusy("ia");
    setSaid(null);
    stop.current = false;
    let proposed = 0;
    let asked = 0;
    let end: Said | null = null;
    try {
      for (let round = 0; round < MAX_ROUNDS && !stop.current; round++) {
        if (alive.current) setProgress(`Lote ${round + 1}: Pilo compara los puntos de Planeación con lo de Enseñanza…`);
        const r = await bridgeStep("lote");
        proposed += Number(r.proposed ?? 0);
        asked += Number(r.asked ?? 0);
        if (r.ai === false) {
          end = { tone: "off", text: r.note || "Sin IA no se proponen puentes nuevos." };
          break;
        }
        if (r.stopped) {
          end = { tone: "warn", text: `La IA se detuvo. ${r.note ?? ""}`.trim() };
          break;
        }
        if (r.done || !Number(r.asked ?? 0)) {
          end = { tone: "ok", text: r.note && !Number(r.asked ?? 0) && !asked ? r.note : "" };
          break;
        }
        if (round % 2 === 1) reload();
      }
      const summary = asked ? `La IA revisó ${plural(asked, "punto", "puntos")} y propuso ${plural(proposed, "puente", "puentes")}: ${proposed ? "están abajo, para revisarlos uno por uno." : "ninguno pasó la revisión."}` : "";
      if (alive.current) setSaid({ tone: end?.tone ?? "off", text: [summary, end?.text ?? (stop.current ? "Detenido: lo propuesto quedó guardado." : "Quedan puntos por revisar: puede seguir cuando quiera.")].filter(Boolean).join(" ") || "No había puntos por revisar." });
    } catch (error) {
      if (alive.current) setSaid({ tone: "warn", text: `${proposed ? `Alcanzó a proponer ${plural(proposed, "puente", "puentes")}. ` : ""}No se pudo seguir. ${faultLine(faultOf(error))}` });
    } finally {
      if (alive.current) {
        setBusy(null);
        setProgress("");
      }
      reload();
    }
  };

  const shown = all ? pending : pending.slice(0, SHOWN);
  const end = (e: InboxItem["ends"][number]) => (
    <span className="gmap-inbox__end" key={e.space}>
      <span className="gmap-owner">{SPACE_SHORT[e.space]}</span>
      {e.node ? (
        <button type="button" className="pis-link" onClick={() => onShow(e.node!)} title="Ver este punto en el mapa">
          {e.label}
        </button>
      ) : (
        <span title="Este punto no está dibujado en el mapa">{e.label}</span>
      )}
    </span>
  );

  return (
    <section className="gmap-inbox" aria-label="Puentes por revisar">
      <header className="gmap-inbox__head">
        <h4>
          Puentes por revisar <small>{pending.length ? plural(pending.length, "propuesta", "propuestas") : "ninguno"}</small>
        </h4>
        <span className="pis-actions">
          <button type="button" className="button-secondary" onClick={() => void rules()} disabled={busy !== null}>
            {busy === "reglas" ? "Recalculando…" : "Recalcular los de reglas"}
          </button>
          {busy === "ia" ? (
            <button type="button" className="button-secondary" onClick={() => (stop.current = true)}>
              Detener
            </button>
          ) : (
            <button type="button" className="button-primary" onClick={() => void propose()} disabled={busy !== null || hasAi !== true || counts.pending === 0 || counts.targets === 0}>
              {hasAi === false ? "Proponer necesita la IA" : counts.pending === 0 && state.data ? "Todo revisado por la IA" : "Proponer con IA"}
            </button>
          )}
        </span>
      </header>

      <p className="pis-small">
        Los puentes por reglas (la misma norma, el mismo ODS, el mismo nombre de un punto del Plan) se aprueban solos. Un tema compartido o una relación que propone la IA esperan aquí: cada uno se aprueba o se
        rechaza por separado, y lo rechazado no vuelve. Aprobar no abre nada por sí solo: Pilo sigue un puente solo hacia una fuente que el portal tenga «De visita».
      </p>

      <p className="pis-small" role="status">
        {state.isPending ? (
          "Revisando si hay IA para proponer…"
        ) : state.isError ? (
          <>
            <StatusMark tone="warn">Sin estado</StatusMark> No se pudo saber si hay IA para proponer. {faultLine(faultOf(state.error))}
          </>
        ) : hasAi === false ? (
          <>
            <StatusMark tone="off">Sin IA</StatusMark> {state.data?.note ?? "Sin IA no se proponen puentes nuevos; los puentes por reglas siguen funcionando."}
          </>
        ) : busy === "ia" ? (
          <>
            <StatusMark tone="off">Proponiendo</StatusMark> {progress}
          </>
        ) : (
          <>
            <StatusMark tone={counts.pending ? "warn" : "ok"}>{counts.pending ? `Faltan ${plural(counts.pending, "punto", "puntos")}` : "Todo revisado"}</StatusMark>{" "}
            {counts.targets
              ? `La IA compara cada punto de Planeación con ${plural(counts.targets, "documento, tema o referencia", "documentos, temas y referencias")} de Enseñanza.`
              : "Enseñanza todavía no tiene documentos ni temas con los que tender puentes."}
          </>
        )}
      </p>

      {said && (
        <p className={said.tone === "warn" ? "pis-warn" : "pis-small"} role="status">
          {said.tone !== "warn" && <StatusMark tone={said.tone}>{said.tone === "ok" ? "Hecho" : "Sin cambios"}</StatusMark>} {said.text}
        </p>
      )}
      {decide.isError && (
        <p className="pis-error" role="alert">
          No se guardó la decisión: {(decide.error as Error).message}
        </p>
      )}

      {pending.length > 0 && (
        <ul className="gmap-inbox__list" ref={list}>
          {shown.map((item) => (
            <li key={item.bridge.id} data-bridge={item.bridge.id}>
              <div className="gmap-inbox__ends">
                {end(item.ends[0])}
                <span className="gmap-inbox__link" aria-hidden="true">
                  <svg width="26" height="12">
                    <path d="M0 6H26" />
                    <path d="M13 1.5L17.5 6L13 10.5L8.5 6Z" />
                  </svg>
                </span>
                <span className="sr-only"> con </span>
                {item.ends[1] && end(item.ends[1])}
              </div>
              <p className="gmap-inbox__why">{item.bridge.why || "Sin porqué."}</p>
              <div className="gmap-inbox__foot">
                <small>{item.origin}</small>
                <span className="pis-actions">
                  <button type="button" className="button-secondary" onClick={() => set(item, "rechazada")} disabled={decide.isPending}>
                    <Icon name="close" size={14} /> Rechazar
                  </button>
                  <button type="button" className="button-primary" onClick={() => set(item, "aprobada")} disabled={decide.isPending}>
                    <Icon name="check" size={14} /> Aprobar
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {pending.length > SHOWN && !all && (
        <button type="button" className="pis-link" onClick={() => setAll(true)}>
          Ver las {pending.length.toLocaleString("es-CO")} propuestas
        </button>
      )}

      {decided.length > 0 && (
        <details className="gmap-inbox__decided">
          <summary>
            Ya decididos: {plural(decided.filter((b) => b.status === "aprobada").length, "aprobado", "aprobados")} y {plural(decided.filter((b) => b.status === "rechazada").length, "rechazado", "rechazados")}
          </summary>
          <ul>
            {decided.slice(0, 200).map((b) => {
              const item = inboxItem(b, byId);
              return (
                <li key={b.id}>
                  <span>
                    <StatusMark tone={b.status === "aprobada" ? "ok" : "off"}>{STATUS_TEXT[b.status]}</StatusMark> {item.ends.map((e) => `${e.label} (${SPACE_SHORT[e.space]})`).join(" ↔ ")}
                    <small>
                      {ORIGIN_TEXT[b.origin]} · {b.why}
                    </small>
                  </span>
                  <button type="button" className="pis-link" onClick={() => set(b, b.status === "aprobada" ? "rechazada" : "aprobada")} disabled={decide.isPending}>
                    {b.status === "aprobada" ? "Rechazar" : "Aprobar"}
                  </button>
                </li>
              );
            })}
          </ul>
          {decided.length > 200 && <p className="pis-small">Se muestran los primeros 200.</p>}
        </details>
      )}
    </section>
  );
}
