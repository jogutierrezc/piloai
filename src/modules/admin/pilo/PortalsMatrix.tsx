/* =============================================================================
   Intranet · Mr. Pilo con IA · Memoria › «Qué lee cada portal» (0121).

   Un solo cerebro, varios portales: la memoria es una y cada portal es una
   vista. Esta matriz es el único lugar que dice qué lee cada portal de cada
   fuente:

     De casa     la fuente es del ámbito del portal: se busca siempre.
     De visita   la fuente es de otro ámbito (0122): entra solo cuando lo de
                 casa no alcanza o por un puente aprobado, después de lo de
                 casa y diciendo de dónde viene. Nace apagada: se enciende
                 celda por celda.
     No          el portal no la lee.

   Cada cambio se aplica al momento (como las claves y las funciones
   ampliadas), pero antes se confirma en el mismo sitio, nombrando la
   consecuencia; después se dice el efecto con los números que contó la base.
   Antes de marcar «De visita» la base cuenta qué podrá leer ese portal y quién
   lo verá (pilo_portal_preview), y hasta que no llega esa cuenta no se puede
   confirmar. Si otra pestaña movió la celda mientras tanto, la base no escribe.
   Los interruptores de «Fuentes» son el espejo de las celdas de casa: al
   cambiar una celda del portal de siempre, el editor se pone al día.

   Sin la migración 0121 el grupo lo dice y queda apagado: Pilo sigue leyendo
   como siempre.
   ========================================================================== */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "../../../components/ui/Icon";
import { revealList } from "./motion";
import { CELL_LABEL, atHome, cellChoices, cellOf, confirmText, effectText, effectiveCell, previewCell, unifyChanges, usePortals, useSetCell, useUnifyMemory } from "./portals";
import type { Cell, CellEffect, PiloPortal, PiloSource } from "./portals";
import { Group, StatusMark } from "./ui";

const KIND_NOTE: Record<PiloSource["kind"], string> = {
  portal: "La llenan los portales públicos",
  documentos: "Documentos que sube la administración",
  moodle: "Cursos leídos de Moodle",
  catalogo: "Respuestas oficiales del catálogo · para leer de visita",
};

const SCOPE_NAME: Record<string, string> = { planeacion: "Planeación", ensenanza: "Enseñanza" };
const scopeName = (scope: string) => SCOPE_NAME[scope] ?? scope;

interface Pending {
  portal: PiloPortal;
  source: PiloSource;
  to: Cell;
}

export function PortalsMatrix({ onHomeSource }: { /** Una celda de casa del portal de siempre cambió: el editor pone al día su interruptor. */ onHomeSource?: (source: string, on: boolean) => void }) {
  const query = usePortals();
  const setCell = useSetCell();
  const unify = useUnifyMemory();
  const [unifying, setUnifying] = useState<"visita" | "no" | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [said, setSaid] = useState<{ tone: "ok" | "off"; text: string } | null>(null);
  // Lo que la base cuenta ANTES de marcar «De visita»: sin esa cuenta no se confirma.
  const [preview, setPreview] = useState<{ effect: CellEffect | null; error: string | null }>({ effect: null, error: null });
  const confirmRef = useRef<HTMLDivElement>(null);
  const missing = query.data === null;
  const data = query.data ?? null;

  // La confirmación entra una vez, en su sitio.
  useLayoutEffect(() => {
    if (pending && confirmRef.current) revealList([confirmRef.current]);
  }, [pending?.portal.id, pending?.source.id, pending?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const ask = (portal: PiloPortal, source: PiloSource, to: Cell) => {
    if (setCell.isPending || cellOf(portal, source) === to) return;
    setSaid(null);
    setCell.reset();
    setPreview({ effect: null, error: null });
    setPending({ portal, source, to });
  };

  // Al pedir «De visita», la base cuenta qué podrá leer ese portal. Si la pregunta cambia antes de que llegue, se descarta.
  useEffect(() => {
    if (!pending || pending.to !== "visita") return;
    let current = true;
    previewCell(pending).then(
      (effect) => current && setPreview({ effect, error: null }),
      (error: unknown) => current && setPreview({ effect: null, error: error instanceof Error ? error.message : "No se pudo contar." }),
    );
    return () => {
      current = false;
    };
  }, [pending]);

  const counting = pending?.to === "visita" && !preview.effect && !preview.error;

  const apply = () => {
    if (!pending) return;
    const { portal, source, to } = pending;
    setCell.mutate(pending, {
      onSuccess: (r) => {
        const effect = r.effects.find((e) => e.source === source.id);
        setSaid(effect ? { tone: "ok", text: effectText(portal, effect) } : { tone: "off", text: `«${portal.name}» ya estaba así: no cambió nada.` });
        if (portal.id === "planeacion" && atHome(portal, source)) onHomeSource?.(source.id, to === "casa");
        setPending(null);
      },
      // Si no se aplicó (la celda cambió en otra pestaña, falta una migración), la matriz se vuelve a leer y la pregunta se cierra.
      onError: () => setPending(null),
    });
  };

  const groups = data ? [...new Set(data.sources.map((s) => s.scope))].map((scope) => ({ scope, sources: data.sources.filter((s) => s.scope === scope) })) : [];
  const toJoin = data ? unifyChanges(data, "visita") : [];
  const toSplit = data ? unifyChanges(data, "no") : [];
  const cellsOf = (list: typeof toJoin) => list.reduce((n, c) => n + Object.keys(c.cells).length, 0);

  const applyUnify = (to: "visita" | "no") => {
    if (!data) return;
    setSaid(null);
    unify.mutate(
      { data, to },
      {
        onSuccess: (n) => {
          setUnifying(null);
          setSaid({
            tone: n ? "ok" : "off",
            text: n
              ? to === "visita"
                ? `Una sola memoria: ${n === 1 ? "1 celda pasó" : `${n} celdas pasaron`} a «De visita». Cada portal busca primero en lo suyo y, si no alcanza, lee lo del otro diciendo de dónde viene.`
                : `Memorias separadas: ${n === 1 ? "1 celda volvió" : `${n} celdas volvieron`} a «No».`
              : "No había nada que cambiar.",
          });
        },
        onError: () => setUnifying(null),
      },
    );
  };

  return (
    <Group
      title="Qué lee cada portal"
      aside={
        <small role="status">
          {missing ? <StatusMark tone="warn">Falta la migración 0121</StatusMark> : setCell.isPending ? "Aplicando…" : "Cada cambio se aplica al momento"}
        </small>
      }
      id="pis-portales-memoria"
    >
      <p className="pis-lead">
        Pilo tiene una sola memoria y cada portal es una vista sobre ella. Aquí se decide qué lee cada portal de cada fuente. De partida cada uno lee solo lo de su casa: nada
        cambia para quien pregunta hasta que usted cambie una celda.
      </p>

      <dl className="pis-legend">
        <div>
          <dt>De casa</dt>
          <dd>La fuente es del ámbito del portal: se busca siempre y se cita sin aclaración.</dd>
        </div>
        <div>
          <dt>De visita</dt>
          <dd>
            La fuente es de otro ámbito: entra solo cuando lo de casa no alcanza o cuando la trae un puente aprobado, después de lo de casa, y Pilo dice de dónde viene. Cada pasaje
            conserva su visibilidad.
          </dd>
        </div>
        <div>
          <dt>No</dt>
          <dd>El portal no la lee: ni al buscar, ni por el mapa, ni en una respuesta guardada.</dd>
        </div>
      </dl>

      {missing ? (
        <p className="pis-warn">
          Falta aplicar la migración 0121 en la base. Hasta entonces Pilo lee como siempre —cada portal, sus fuentes encendidas— y esta matriz no se puede cambiar.
        </p>
      ) : query.isError ? (
        <p className="pis-error" role="alert">
          No se pudo leer la matriz: {(query.error as Error).message}{" "}
          <button type="button" className="pis-link" onClick={() => void query.refetch()}>
            Reintentar
          </button>
        </p>
      ) : !data ? (
        <p className="pis-small" role="status">
          Leyendo qué lee cada portal…
        </p>
      ) : (
        <>
          <div className="pis-unify" role="group" aria-label="Una sola memoria">
            <p className="pis-small">
              <strong>Una sola memoria.</strong>{" "}
              {toJoin.length
                ? "Que cada portal lea también lo de los demás, de visita, de un solo paso. Sigue buscando primero en lo suyo; solo si no alcanza (o si un puente aprobado lo trae) lee lo del otro, y dice de dónde viene."
                : "Todos los portales ya leen de visita lo que puede salir de su casa."}
            </p>
            {unifying ? (
              <div className="pis-key__saved pis-key__saved--confirm" role="alert">
                <span>
                  {unifying === "visita"
                    ? `¿Pasar ${cellsOf(toJoin)} ${cellsOf(toJoin) === 1 ? "celda" : "celdas"} a «De visita»? Respeta quién puede ver cada pasaje: lo «con sesión» no llega a visitantes ni a cuentas de Pilo, Impacto sigue solo para el personal y Moodle no sale de su portal. Se puede deshacer.`
                    : `¿Volver ${cellsOf(toSplit)} ${cellsOf(toSplit) === 1 ? "celda" : "celdas"} de «De visita» a «No»? Cada portal vuelve a leer solo lo suyo.`}
                </span>
                <button type="button" className="button-secondary" onClick={() => setUnifying(null)} disabled={unify.isPending}>
                  No, dejarlo como está
                </button>
                <button type="button" className="button-primary" onClick={() => applyUnify(unifying)} disabled={unify.isPending}>
                  {unify.isPending ? "Aplicando…" : unifying === "visita" ? "Sí, unir las memorias" : "Sí, separarlas"}
                </button>
              </div>
            ) : (
              <span className="pis-actions">
                {toJoin.length > 0 && (
                  <button type="button" className="button-primary" onClick={() => (setSaid(null), unify.reset(), setUnifying("visita"))} disabled={setCell.isPending}>
                    Unir las memorias
                  </button>
                )}
                {toSplit.length > 0 && (
                  <button type="button" className="pis-link" onClick={() => (setSaid(null), unify.reset(), setUnifying("no"))} disabled={setCell.isPending}>
                    Separarlas otra vez
                  </button>
                )}
              </span>
            )}
            {unify.isError && (
              <p className="pis-error" role="alert">
                No se aplicó: {(unify.error as Error).message}
              </p>
            )}
          </div>
        <div className="pis-extras pis-matrix" role="table" aria-label="Qué lee cada portal de cada fuente">
          <div role="row" className="pis-extras__head">
            <span role="columnheader">Fuente</span>
            {data.portals.map((p) => (
              <span key={p.id} role="columnheader">
                {p.name}
                {p.written_for && <small>Lo suyo fue preparado para {p.written_for}</small>}
              </span>
            ))}
          </div>

          {groups.map((g) => (
            <div key={g.scope} role="rowgroup" aria-label={`Fuentes del ámbito de ${scopeName(g.scope)}`}>
              <p className="pis-matrix__scope">Del ámbito de {scopeName(g.scope)}</p>
              {g.sources.map((source) => {
                const asking = pending?.source.id === source.id ? pending : null;
                return (
                  <div key={source.id} role="row" className="pis-matrix__row">
                    <span role="rowheader">
                      <strong>{source.name}</strong>
                      <small>
                        {KIND_NOTE[source.kind]}
                        {source.staff_only ? " · pide sesión de la intranet en cualquier portal" : ""}
                        {source.stays_home ? " · no sale de su portal" : ""}
                      </small>
                    </span>
                    {data.portals.map((portal) => {
                      const now = cellOf(portal, source);
                      const choices = cellChoices(portal, source);
                      // Una celda escrita a mano con un valor que la base no aplica («casa» sobre lo ajeno, «visita» sobre lo que no sale): se dice, y se dice qué lee de verdad.
                      const odd = effectiveCell(portal, source) !== now;
                      return (
                        <span key={portal.id} role="cell">
                          <div className="pis-seg pis-seg--sm" role="radiogroup" aria-label={`${source.name} en ${portal.name}`}>
                            {choices.map((c) => (
                              <button
                                key={c.value}
                                type="button"
                                role="radio"
                                aria-checked={now === c.value}
                                disabled={!c.enabled || setCell.isPending}
                                title={c.note}
                                onClick={() => ask(portal, source, c.value)}
                              >
                                {now === c.value && <Icon name="check" size={12} />}
                                {c.label}
                                {!c.enabled && <span className="sr-only"> (no disponible: {c.note})</span>}
                              </button>
                            ))}
                          </div>
                          {odd && (
                            <small className="pis-matrix__odd">
                              <Icon name="alert" size={12} /> La celda dice «{CELL_LABEL[now]}», pero este portal {effectiveCell(portal, source) === "no" ? "no la lee" : "la lee"}.
                            </small>
                          )}
                        </span>
                      );
                    })}
                    {asking && (
                      <div className="pis-key__saved pis-key__saved--confirm pis-matrix__confirm" role="alert" ref={confirmRef}>
                        <span aria-busy={counting || undefined}>
                          {preview.error && asking.to === "visita" ? `No se pudo contar qué leería este portal: ${preview.error}` : confirmText(asking.portal, asking.source, asking.to, preview.effect)}
                        </span>
                        <button type="button" className="button-secondary" onClick={() => setPending(null)} disabled={setCell.isPending}>
                          No, dejarlo como está
                        </button>
                        {/* «De visita» no se confirma a ciegas: hasta que la base no cuenta el efecto, el botón espera. */}
                        <button type="button" className="button-primary" onClick={apply} disabled={setCell.isPending || counting || (asking.to === "visita" && !preview.effect)}>
                          {setCell.isPending ? "Aplicando…" : counting ? "Contando…" : asking.to === "casa" ? "Sí, que la lea" : asking.to === "visita" ? "Sí, que la lea de visita" : "Sí, que deje de leerla"}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        </>
      )}

      {said && (
        <p className="pis-small pis-matrix__said" role="status">
          <StatusMark tone={said.tone}>{said.tone === "ok" ? "Aplicado" : "Sin cambios"}</StatusMark> {said.text}
        </p>
      )}
      {setCell.isError && (
        <p className="pis-error" role="alert">
          No se aplicó: {(setCell.error as Error).message}
        </p>
      )}
      {data && (
        <p className="pis-small">
          Las celdas de casa son los mismos interruptores de «Fuentes» (aquí y en Mr. Pilo en Enseñanza): cambiar uno cambia el otro; las «De visita» solo se cambian aquí. El
          catálogo, las respuestas guardadas, la bandeja y la bitácora siguen siendo de cada portal, lo que cita algo de visita no se guarda, y lo que Pilo nunca dice —dinero y datos
          personales— no depende de esta matriz. Los puentes se revisan en el mapa global.
        </p>
      )}
    </Group>
  );
}
