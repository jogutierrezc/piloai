/* =============================================================================
   Mr. Pilo · Memoria › Documentos › Colecciones propias (0125).

   Las colecciones de partida (las que sembró 0121) no se tocan. Aquí la
   administración crea las suyas, las renombra y, cuando están vacías, las
   borra. Una colección nueva nace apagada en «Qué lee cada portal»: lo que se
   suba en ella queda guardado y no entra en las respuestas hasta que se
   encienda; el interruptor «Que Pilo la lea desde ya» lo enciende al crearla.

   Vale para los dos Pilos: recibe de quién es la memoria (`space`) y el
   catálogo de fuentes que ya leyó el panel de documentos.
   ========================================================================== */

import { useRef, useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { COLLECTION_NAME, MAX_CUSTOM, cleanName, customOf, deleteBlock, nameProblem, useCreateCollection, useDeleteCollection, useRenameCollection } from "../../pilo/collections";
import type { PiloSource } from "../../pilo/portals";
import type { PiloSpace } from "../../pilo/space";
import { plural } from "../../pilo/ui";

interface Props {
  space: PiloSpace;
  /** El catálogo de fuentes (de los dos Pilos): sirve para repasar nombres. */
  sources: PiloSource[];
  /** Cuántos documentos tiene cada colección de este Pilo. */
  docCounts: Record<string, number>;
  /** Para decir de qué Pilo es: «Pilo en Enseñanza». */
  owner: string;
}

type Said = { tone: "ok" | "warn"; text: string } | null;

export function CollectionsEditor({ space, sources, docCounts, owner }: Props) {
  const create = useCreateCollection(space);
  const rename = useRenameCollection(space);
  const remove = useDeleteCollection(space);
  const [name, setName] = useState("");
  const [read, setRead] = useState(false);
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [said, setSaid] = useState<Said>(null);
  const input = useRef<HTMLInputElement>(null);

  const own = customOf(sources, space);
  const fixed = sources.filter((s) => s.scope === space && s.kind === "documentos" && s.custom !== true);
  const busy = create.isPending || rename.isPending || remove.isPending;
  const problem = name.trim() ? nameProblem(name, space, sources) : null;
  const full = own.length >= MAX_CUSTOM;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy || full) return;
    const clean = cleanName(name);
    const bad = nameProblem(clean, space, sources);
    if (bad) return setSaid({ tone: "warn", text: bad });
    setSaid(null);
    create.mutate(
      { name: clean, read },
      {
        onSuccess: (r) => {
          setName("");
          setRead(false);
          setSaid({
            tone: "ok",
            text: r.read
              ? `Creada «${r.name}». ${owner} ya la lee: lo que suba en ella entra en las respuestas.`
              : `Creada «${r.name}». Está apagada: lo que suba queda guardado, y ${owner} empieza a leerlo cuando la encienda (en «Qué lee cada portal»).`,
          });
          input.current?.focus();
        },
        onError: (error) => setSaid({ tone: "warn", text: error.message }),
      },
    );
  };

  const saveName = (source: PiloSource) => {
    if (!editing || busy) return;
    const clean = cleanName(editing.value);
    if (clean === source.name) return setEditing(null);
    const bad = nameProblem(clean, space, sources, source.id);
    if (bad) return setSaid({ tone: "warn", text: bad });
    setSaid(null);
    rename.mutate(
      { id: source.id, name: clean },
      {
        onSuccess: () => {
          setEditing(null);
          setSaid({ tone: "ok", text: `«${source.name}» ahora se llama «${clean}». El mapa lo refleja al volver a leerlo.` });
        },
        onError: (error) => setSaid({ tone: "warn", text: error.message }),
      },
    );
  };

  const drop = (source: PiloSource) => {
    if (busy) return;
    setSaid(null);
    remove.mutate(
      { id: source.id },
      {
        onSuccess: () => {
          setConfirming(null);
          setSaid({ tone: "ok", text: `Se borró la colección «${source.name}».` });
        },
        onError: (error) => {
          setConfirming(null);
          setSaid({ tone: "warn", text: error.message });
        },
      },
    );
  };

  return (
    <details className="pen-colls">
      <summary>
        <strong>Colecciones</strong>
        <small>{own.length ? `${plural(own.length, "propia", "propias")} · ${plural(fixed.length, "de partida", "de partida")}` : "Cree las suyas para agrupar los documentos como quiera"}</small>
      </summary>

      <div className="pen-colls__body">
        {own.length > 0 && (
          <ul className="pen-colls__list" aria-label={`Colecciones propias de ${owner}`}>
            {own.map((c) => {
              const docs = docCounts[c.id] ?? 0;
              const block = deleteBlock(docs);
              const isEditing = editing?.id === c.id;
              return (
                <li key={c.id} className="pen-colls__item">
                  {isEditing ? (
                    <form
                      className="pen-colls__edit"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveName(c);
                      }}
                    >
                      <label className="pen-field">
                        <span className="pen-field__label">Nuevo nombre de «{c.name}»</span>
                        <input
                          className="pen-input"
                          value={editing.value}
                          maxLength={COLLECTION_NAME.max}
                          autoFocus
                          onChange={(e) => setEditing({ id: c.id, value: e.target.value })}
                          onKeyDown={(e) => e.key === "Escape" && setEditing(null)}
                        />
                      </label>
                      <span className="pis-actions">
                        <button type="submit" className="button-primary" disabled={busy}>
                          {rename.isPending ? "Guardando…" : "Guardar nombre"}
                        </button>
                        <button type="button" className="button-secondary" onClick={() => setEditing(null)}>
                          Cancelar
                        </button>
                      </span>
                    </form>
                  ) : (
                    <>
                      <span className="pis-code pen-code" aria-hidden="true">
                        {c.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="pen-colls__name">
                        <b>{c.name}</b>
                        <small>{plural(docs, "documento", "documentos")}</small>
                      </span>
                      {confirming === c.id ? (
                        <span className="pen-colls__confirm" role="alert">
                          ¿Borrar «{c.name}»? No se puede deshacer.
                          <button type="button" className="button-secondary" onClick={() => setConfirming(null)}>
                            No, dejarla
                          </button>
                          <button type="button" className="button-primary pis-danger" disabled={busy} onClick={() => drop(c)}>
                            {remove.isPending ? "Borrando…" : "Borrar"}
                          </button>
                        </span>
                      ) : (
                        <span className="pen-colls__actions">
                          <button type="button" className="pis-link" disabled={busy} onClick={() => (setSaid(null), setEditing({ id: c.id, value: c.name }))}>
                            Renombrar
                          </button>
                          <button
                            type="button"
                            className="pis-link pis-link--danger"
                            disabled={busy || Boolean(block)}
                            title={block ?? undefined}
                            aria-describedby={block ? `pen-coll-block-${c.id}` : undefined}
                            onClick={() => (setSaid(null), setConfirming(c.id))}
                          >
                            Borrar
                          </button>
                        </span>
                      )}
                      {block && (
                        <small className="pen-colls__block" id={`pen-coll-block-${c.id}`}>
                          {block}
                        </small>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <form className="pen-colls__new" onSubmit={submit} noValidate>
          <label className="pen-field">
            <span className="pen-field__label">Nueva colección en {owner}</span>
            <input
              ref={input}
              className="pen-input"
              value={name}
              maxLength={COLLECTION_NAME.max}
              placeholder="Por ejemplo: Reglamentos 2026"
              disabled={full}
              aria-invalid={problem ? true : undefined}
              aria-describedby="pen-colls-hint"
              onChange={(e) => (setName(e.target.value), setSaid(null))}
            />
            <small id="pen-colls-hint" className={problem ? "pen-bad" : undefined}>
              {full
                ? `Cada Pilo admite hasta ${MAX_CUSTOM} colecciones propias.`
                : (problem ?? "Nace apagada: lo que suba queda guardado, pero no entra en las respuestas hasta que la encienda.")}
            </small>
          </label>
          <label className="pen-colls__read">
            <input type="checkbox" checked={read} disabled={full} onChange={(e) => setRead(e.target.checked)} />
            <span>Que {owner} la lea desde ya</span>
          </label>
          <span className="pis-actions">
            <button type="submit" className="button-primary" disabled={busy || full || !name.trim() || Boolean(problem)}>
              {create.isPending ? "Creando…" : "Crear colección"}
            </button>
          </span>
        </form>

        {fixed.length > 0 && (
          <p className="pis-small">
            De partida (no se renombran ni se borran): {fixed.map((s) => s.name).join(", ")}.
          </p>
        )}

        {said && (
          <p className={said.tone === "ok" ? "pen-ok" : "pis-warn"} role="status">
            {said.tone === "ok" && <Icon name="check" size={14} />} {said.text}
          </p>
        )}
      </div>
    </details>
  );
}
