/* =============================================================================
   Mr. Pilo · Memoria › Lo que leyó en otros portales (0127).

   El chat de Pilo puesto en otra página puede leer esa página (data-leer="si"
   en la línea que lo carga). Lo leído no entra solo a la memoria: llega aquí,
   a la bandeja de lecturas del Pilo que la leyó, y la administración decide.

     Guardar     la página queda como un documento «web» de una colección de
                 este mismo Pilo: pasajes, lugar en el mapa y vectores, como un
                 archivo. Si esa página ya se había guardado, se actualiza.
     Descartar   se borra su texto de la bandeja y no vuelve a ofrecerse con
                 ese mismo contenido.

   Un solo cerebro, dos Pilos: una lectura solo se guarda en una colección del
   ámbito del Pilo que la leyó. Quién más la lee lo dice la matriz de «Qué lee
   cada portal», y hacia el otro ámbito solo pasa por visita o por un puente.

   Las páginas ya guardadas se listan debajo, para poder quitarlas.
   Sin la migración 0127 el panel lo dice y se apaga.
   ========================================================================== */

import { useState } from "react";
import { docCollections, usePortals } from "../../pilo/portals";
import { Group, StatusMark, plural, when } from "../../pilo/ui";
import { SPACE_SOURCES } from "../store";
import { Skeleton } from "../ui";
import { docDelete, docOutlineSave, docReplace, docSave, findWebDoc, indexPending, readingDecide, useDocs, useReadings, useRefreshMemory } from "./data";
import type { DocRow } from "./data";
import type { DocCollection, MemoryPartProps } from "./DocumentsPanel";
import { faultOf } from "./flow";
import type { Fault } from "./flow";
import { buildOutline } from "./map";
import { FaultNote, MissingNote } from "./parts";
import { readingRows, readingTitle, readingWhere } from "./readings";
import type { ReadingRow } from "./readings";

export interface ReadingsPanelProps extends MemoryPartProps {
  /** Las colecciones de este Pilo. De partida, las que dice la base o, sin ellas, las de Enseñanza. */
  collections?: DocCollection[];
}

const TEACH_COLLECTIONS: DocCollection[] = SPACE_SOURCES.filter((s) => s.id !== "moodle").map((s) => ({ id: s.id, code: s.code, name: s.name }));

export function ReadingsPanel({ space, disabled, collections: given }: ReadingsPanelProps) {
  const portals = usePortals(!disabled);
  const fromCatalog = docCollections(portals.data?.sources ?? [], space);
  const collections: DocCollection[] = given ?? (fromCatalog.length ? fromCatalog : TEACH_COLLECTIONS);
  const readings = useReadings(space, !disabled);
  const docs = useDocs(space, !disabled);
  const refresh = useRefreshMemory(space);
  const [target, setTarget] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<{ id: string; line: string } | null>(null);
  const [fault, setFault] = useState<{ id: string; fault: Fault } | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const missing = readings.data?.missing ?? null;
  const pending = readings.data?.data ?? [];
  const saved = (docs.data?.data ?? []).filter((d) => d.origin === "web");
  const off = disabled || Boolean(missing) || readings.isError;
  const collectionName = (id: string) => collections.find((c) => c.id === id)?.name ?? id;
  const chosen = (r: ReadingRow) => target[r.id] ?? collections[0]?.id ?? "";

  /** Guardar: ficha, pasajes, lugar en el mapa, la decisión en la bandeja y, al final, los vectores. */
  const save = async (r: ReadingRow) => {
    const source = chosen(r);
    if (!source || busy) return;
    setFault(null);
    setNotice(null);
    const title = readingTitle(r);
    const notes: string[] = [];
    try {
      setBusy({ id: r.id, line: "Partiendo la página en pasajes…" });
      const rows = readingRows(r, title);
      if (!rows.length) throw new Error("La página no dejó ningún pasaje con texto suficiente.");
      const existing = await findWebDoc(space, r.url_hash);
      const id = await docSave(space, {
        ...(existing ? { id: existing } : {}),
        origin: "web",
        kind: "web",
        source,
        title,
        // La dirección se guarda como «nombre del archivo»: es lo que se muestra y se enlaza.
        file_name: r.url,
        external_id: r.url_hash,
        content_hash: r.content_hash,
        // Lo leyó cualquiera que pasó por esa página: es público.
        vis: "publico",
      });
      setBusy({ id: r.id, line: "Guardando los pasajes…" });
      const replaced = await docReplace(id, rows);
      if (replaced.skipped > 0) notes.push(`${plural(replaced.skipped, "pasaje pasó", "pasajes pasaron")} del tope y no se guardaron.`);
      try {
        const outline = buildOutline({ id, source, title }, collectionName(source), rows);
        await docOutlineSave(id, outline.nodes, outline.edges);
      } catch (error) {
        // Sin 0115 no hay mapa: la página queda en pasajes, que ya sirve para responder.
        if (faultOf(error).code !== "migracion") throw error;
        notes.push("Falta la migración 0115: quedó en pasajes y entrará al mapa cuando se aplique.");
      }
      await readingDecide(r.id, "guardada", id);
      setBusy({ id: r.id, line: "Indexando por significado…" });
      const left = await indexPending(space).catch(() => -1);
      if (left !== 0) notes.push("Ya responde por palabras; el índice por significado no quedó completo: use «Indexar por significado».");
      setNotice({ tone: notes.length ? "warn" : "ok", text: [`«${title}» quedó en la memoria, en «${collectionName(source)}». «Comprender» la conecta con el resto del mapa.`, ...notes].join(" ") });
    } catch (error) {
      setFault({ id: r.id, fault: faultOf(error) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const discard = async (r: ReadingRow) => {
    if (busy) return;
    setFault(null);
    setNotice(null);
    setBusy({ id: r.id, line: "Descartando…" });
    try {
      await readingDecide(r.id, "descartada");
    } catch (error) {
      setFault({ id: r.id, fault: faultOf(error) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const remove = async (d: DocRow) => {
    if (busy) return;
    setFault(null);
    setBusy({ id: d.id, line: "Quitando…" });
    try {
      await docDelete(d.id);
      setConfirmDelete(null);
      setNotice({ tone: "ok", text: `«${d.title}» salió de la memoria.` });
    } catch (error) {
      setFault({ id: d.id, fault: faultOf(error) });
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const aside = off ? null : pending.length ? <StatusMark tone="warn">{plural(pending.length, "lectura por revisar", "lecturas por revisar")}</StatusMark> : <StatusMark tone="off">Nada por revisar</StatusMark>;

  return (
    <Group title="Lo que leyó en otros portales" aside={aside} id={`pen-lecturas-${space}`}>
      <p className="pis-small">
        Cuando el chat de este Pilo está en otra página con <code>data-leer="si"</code>, lee esa página para responder y la deja aquí. Nada de esto entra a la
        memoria hasta que usted lo guarde. Guardada, queda en una colección de este Pilo; el otro Pilo solo la lee si la matriz o un puente lo permiten.
      </p>

      {missing ? (
        <MissingNote migration={missing} what="Sin ella, Pilo puede leer la página para responder, pero la lectura no llega aquí." />
      ) : disabled ? (
        <p className="pis-small">Este Pilo todavía no tiene memoria propia: no hay dónde guardar lo que lea.</p>
      ) : readings.isError ? (
        <FaultNote fault={faultOf(readings.error)} lead="No se pudieron leer las lecturas" onRetry={() => void readings.refetch()} />
      ) : (
        <>
          <div role="status">{notice && <p className={notice.tone === "ok" ? "pis-note" : "pis-warn"}>{notice.text}</p>}</div>

          {readings.isPending ? (
            <Skeleton rows={2} label="Leyendo la bandeja de lecturas" />
          ) : pending.length === 0 ? (
            <p className="pis-small">
              No hay lecturas por revisar. Llegan cuando alguien le pregunta a Pilo en una página de un portal autorizado que lleve <code>data-leer="si"</code> en su
              línea.
            </p>
          ) : (
            <ul className="pen-docs">
              {pending.map((r) => {
                const mine = busy?.id === r.id ? busy : null;
                return (
                  <li key={r.id} className="pen-doc">
                    <header>
                      <span className="pis-code pen-code" title="Página web">
                        WB
                      </span>
                      <b>{readingTitle(r)}</b>
                      <small>
                        {plural(r.sections, "título", "títulos")} · {r.chars.toLocaleString("es-CO")} caracteres · leída {plural(r.seen, "vez", "veces")} · {when(r.last_seen)}
                      </small>
                    </header>
                    <p className="pis-small pen-reading__where">
                      <a className="pis-link" href={r.url} target="_blank" rel="noopener noreferrer">
                        {readingWhere(r.url)}
                      </a>
                      {r.omitted > 0 && ` · ${plural(r.omitted, "dato personal tapado", "datos personales tapados")}`}
                    </p>
                    <details className="pen-reading__text">
                      <summary>Ver lo que leyó</summary>
                      <pre tabIndex={0}>{r.body}</pre>
                    </details>

                    {fault?.id === r.id && <FaultNote fault={fault.fault} lead="No se pudo guardar la lectura" onRetry={fault.fault.retry ? () => void save(r) : undefined} />}

                    <div className="pen-doc__controls">
                      <label className="pen-doc__move">
                        Guardar en
                        <select id={`pen-lectura-${r.id}`} value={chosen(r)} disabled={Boolean(busy)} aria-label={`Colección para «${readingTitle(r)}»`} onChange={(e) => setTarget((t) => ({ ...t, [r.id]: e.target.value }))}>
                          {collections.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button type="button" className="button-primary" disabled={Boolean(busy) || !collections.length} onClick={() => void save(r)}>
                        {mine && mine.line !== "Descartando…" ? mine.line : "Guardar en la memoria"}
                      </button>
                      <button type="button" className="pis-link pis-link--danger" disabled={Boolean(busy)} onClick={() => void discard(r)}>
                        {mine?.line === "Descartando…" ? "Descartando…" : "Descartar"}
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {saved.length > 0 && (
            <>
              <strong className="pen-reading__title">Páginas en la memoria</strong>
              <ul className="pen-docs">
                {saved.map((d) => (
                  <li key={d.id} className="pen-doc" data-off={!d.active || undefined}>
                    <header>
                      <span className="pis-code pen-code" data-s={d.source} title={collectionName(d.source)}>
                        WB
                      </span>
                      <b>{d.title}</b>
                      <small>
                        {collectionName(d.source)} · {plural(d.passages, "pasaje", "pasajes")} · {when(d.updated_at)}
                      </small>
                    </header>
                    {/^https?:\/\//i.test(d.file_name) && (
                      <p className="pis-small pen-reading__where">
                        <a className="pis-link" href={d.file_name} target="_blank" rel="noopener noreferrer">
                          {readingWhere(d.file_name)}
                        </a>
                      </p>
                    )}
                    {fault?.id === d.id && <FaultNote fault={fault.fault} lead="No se pudo quitar la página" />}
                    {confirmDelete === d.id ? (
                      <div className="pis-key__saved pis-key__saved--confirm" role="alert">
                        <span>
                          ¿Quitar «{d.title}» de la memoria? Se borran sus {plural(d.passages, "pasaje", "pasajes")}, su lugar en el mapa y las respuestas guardadas que la
                          citan. No se puede deshacer.
                        </span>
                        <button type="button" className="button-secondary" onClick={() => setConfirmDelete(null)}>
                          No, dejarla
                        </button>
                        <button type="button" className="button-primary pis-danger" disabled={Boolean(busy)} onClick={() => void remove(d)}>
                          {busy?.id === d.id ? "Quitando…" : "Quitar"}
                        </button>
                      </div>
                    ) : (
                      <div className="pen-doc__controls">
                        <button type="button" className="pis-link pis-link--danger" disabled={Boolean(busy)} onClick={() => setConfirmDelete(d.id)}>
                          Quitar de la memoria
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Group>
  );
}
