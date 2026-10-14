/* =============================================================================
   Intranet · Mr. Pilo con IA · el catálogo de Pilo.

   Lo que Planeación escribe para Pilo, en Excel:
     Respuestas   preguntas con su respuesta oficial, variantes y fuente;
     Capciosas    microexpresiones rápidas que se disparan por palabras.
   Por clase: descargar la plantilla (con ejemplos) o lo que ya hay, importar
   un libro (se revisa fila por fila antes de guardar; con «reemplazar», el
   libro manda y lo que no viene se borra), y ver lo guardado, con cuántas
   veces sirvió cada entrada y un interruptor para dejarla de usar.

   Se aplica al momento, como las claves: no espera a «Guardar cambios».
   Es la sección «Catálogo» del módulo (PiloAiSettings).
   ========================================================================== */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { downloadBlob } from "../traslado/transfer";
import { workbookToTables } from "../institucion/structure-sheet";
import { EXAMPLES, ROL_LABEL, columnsFor, detectCatalogKind, fillCatalogTemplate, parseCatalogTable, SHEET_NAME } from "./catalog-sheet";
import type { CatalogKind, CatalogRol, CatalogRow, ParseResult, SheetOptions } from "./catalog-sheet";
import { Icon } from "../../../components/ui/Icon";
import { Group, StatusMark, Switch } from "./ui";
import { CatalogModal } from "./CatalogModal";
import { usePremises } from "./premises";
import { PremiseMark, PremisesGroup } from "./Razonamiento";
import { useEmbedStatus, useIndexMemory, useTryCatalog } from "./memory";
import type { EmbedStatus } from "./memory";
import { CATALOG_PREFIX, DEFAULT_SPACE, SPACE_COPY, isDefaultSpace, readInSpace, spaceArgs, spaceKey } from "./space";
import type { PiloSpace } from "./space";

interface Entry extends CatalogRow {
  kind: CatalogKind;
  hits: number;
  updated_at: string;
  /** Sirve además a los demás Pilos (0126). `undefined`: la base aún no tiene esa migración. */
  shared?: boolean;
}

const KEY = ["pilo-ia", "catalogo"] as const;
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** El catálogo de un espacio (0113): las entradas de un Pilo no aparecen en el otro. Sin su migración, null. */
export async function fetchCatalog(space: PiloSpace = DEFAULT_SPACE): Promise<Entry[] | null> {
  const { data, error } = await readInSpace(space, (scoped) => {
    const query = supabase.from("pilo_catalog").select("*");
    return (scoped ? query.eq("space", space) : query).order("key");
  });
  if (error) return null; // sin 0096 (o sin 0113, en otro espacio)
  return (data ?? []) as Entry[];
}

function useCatalog(space: PiloSpace) {
  return useQuery({
    queryKey: [...KEY, ...spaceKey(space)],
    queryFn: () => fetchCatalog(space),
  });
}

/** Lo que el Excel de un espacio tiene de propio: sus prefijos, la columna «Para quién» y el nombre de su pantalla. */
export function sheetOptions(space: PiloSpace = DEFAULT_SPACE): SheetOptions {
  return isDefaultSpace(space) ? {} : { prefix: CATALOG_PREFIX[space], rol: true, screen: SPACE_COPY[space].screen };
}

interface ImportResult {
  added: number;
  updated: number;
  removed: number;
  total: number;
  /** Claves que ya son del otro Pilo (0113): no se tocan. */
  rejected?: number;
  rejected_keys?: string[];
}

/** «Listo: 2 nuevas, 1 actualizada…», y lo que no entró por ser del otro Pilo. */
export function importSummary(r: ImportResult): string {
  const base = `Listo: ${r.added} nuevas, ${r.updated} actualizadas${r.removed ? `, ${r.removed} borradas` : ""}. Hay ${r.total} en total.`;
  if (!r.rejected) return base;
  const keys = (r.rejected_keys ?? []).slice(0, 6).join(", ");
  return `${base} ${r.rejected === 1 ? "Una clave ya es" : `${r.rejected} claves ya son`} del otro Mr. Pilo y no se ${r.rejected === 1 ? "tocó" : "tocaron"}${keys ? `: ${keys}` : ""}.`;
}

const LEAD: Record<CatalogKind, string> = {
  respuesta:
    "Preguntas con la respuesta oficial de Planeación. Cuando la pregunta se parece a la escrita o a una de sus variantes, es la base obligatoria de lo que redacta la IA: Pilo no la contradice y cita la fuente si la tiene. Tal cual sale solo si no hay IA.",
  capciosa:
    "Microexpresiones: respuestas cortas para preguntas capciosas (salarios, la vida personal de Pilo, bromas). Cuando la pregunta trae las palabras de un disparador o se le parece por significado, la IA responde con esa microexpresión como base y con la emoción elegida. Tal cual sale solo si no hay IA.",
};

export function CatalogSection({
  space = DEFAULT_SPACE,
  examples,
  lead,
}: {
  /** De qué Pilo es el catálogo (0113). */
  space?: PiloSpace;
  /** Los ejemplos de la plantilla de este espacio; sin ellos, los de siempre. */
  examples?: typeof EXAMPLES;
  /** Qué es cada clase, dicho para este espacio; sin él, el texto de siempre. */
  lead?: Record<CatalogKind, string>;
}) {
  const client = useQueryClient();
  const catalog = useCatalog(space);
  const own = !isDefaultSpace(space);
  const sheet = sheetOptions(space);
  const copy = SPACE_COPY[space];
  const [kind, setKind] = useState<CatalogKind>("capciosa");
  const [parsed, setParsed] = useState<{ file: string; result: ParseResult } | null>(null);
  const [replace, setReplace] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<Entry | null>(null);

  // Las premisas de las capciosas (0130): en qué va cada una. Sin esa migración, null y no se pinta nada.
  const premises = usePremises();
  const trickyInUse = useMemo(() => (catalog.data ?? []).filter((e) => e.kind === "capciosa" && e.active).map((e) => e.key), [catalog.data]);
  const rows = useMemo(() => (catalog.data ?? []).filter((e) => e.kind === kind), [catalog.data, kind]);
  const count = (k: CatalogKind) => (catalog.data ?? []).filter((e) => e.kind === k).length;

  const importRows = useMutation({
    mutationFn: async ({ k, valid, all }: { k: CatalogKind; valid: CatalogRow[]; all: boolean }) => {
      const { data, error } = await supabase.rpc("pilo_catalog_import", { p_kind: k, p_rows: valid as never, p_replace: all, ...spaceArgs(space) });
      if (error) throw error;
      return data as ImportResult;
    },
    onSuccess: (r) => {
      setMessage({ ok: !r.rejected, text: importSummary(r) });
      setParsed(null);
      setReplace(false);
      void client.invalidateQueries({ queryKey: KEY });
    },
    onError: (e) => setMessage({ ok: false, text: `No se importó: ${(e as Error).message}` }),
  });

  const toggle = useMutation({
    mutationFn: async ({ key, active }: { key: string; active: boolean }) => {
      const { error } = await supabase.from("pilo_catalog").update({ active }).eq("key", key);
      if (error) throw error;
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });

  /** Compartir una entrada con los demás Pilos (0126): se aplica al momento y la base revisa que sea para todos los roles. */
  const share = useMutation({
    mutationFn: async ({ key, shared }: { key: string; shared: boolean }) => {
      const { error } = await supabase.rpc("pilo_catalog_share" as never, { p_key: key, p_shared: shared } as never);
      if (error) throw new Error(/could not find the function|schema cache/i.test(error.message) ? "Falta aplicar la migración 0126 en la base." : error.message);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: KEY }),
  });

  async function download(which: "plantilla" | "actual") {
    setBusy(which);
    setMessage(null);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      book.creator = "Planeación Institucional · UDES";
      fillCatalogTemplate(book, kind, which === "plantilla" ? (examples ?? EXAMPLES)[kind] : rows, sheet);
      const buffer = await book.xlsx.writeBuffer();
      const name = kind === "respuesta" ? "respuestas" : "capciosas";
      downloadBlob(new Blob([buffer], { type: XLSX }), which === "plantilla" ? `${copy.file}-${name}-plantilla.xlsx` : `${copy.file}-${name}.xlsx`);
    } catch (e) {
      setMessage({ ok: false, text: `No se pudo armar el archivo: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  async function read(file: File | undefined) {
    if (!file) return;
    setBusy("leer");
    setMessage(null);
    try {
      const { default: ExcelJS } = await import("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const tables = workbookToTables(book);
      const targetKind = detectCatalogKind(tables) ?? kind;
      if (targetKind !== kind) setKind(targetKind);
      setParsed({ file: file.name, result: parseCatalogTable(targetKind, tables, sheet) });
    } catch (e) {
      setParsed(null);
      setMessage({ ok: false, text: `No se pudo leer el archivo: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

  const errors = parsed ? [...parsed.result.problems, ...parsed.result.rows.flatMap((r) => r.errors)] : [];
  const missing = catalog.data === null;

  return (
    <>
      {missing && <p className="pis-warn">Falta aplicar la migración {copy.migration} en la base para guardar el catálogo.</p>}

      <Group title="Clase" aside={<small>Se aplica al momento, como las claves</small>}>
        <div className="pis-seg" role="radiogroup" aria-label="Clase del catálogo">
          {(["capciosa", "respuesta"] as CatalogKind[]).map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => {
                setKind(k);
                setParsed(null);
                setMessage(null);
              }}
            >
              {SHEET_NAME[k]} <span className="pis-seg__n">{count(k)}</span>
            </button>
          ))}
        </div>
        <p className="pis-lead">{(lead ?? LEAD)[kind]}</p>
      </Group>

      <CatalogMemory space={space} />

      {kind === "capciosa" && <PremisesGroup space={space} active={trickyInUse} />}

      <Group title="Agregar o importar">
        <div className="pis-actions">
          <button
            type="button"
            className="button-primary"
            onClick={() => {
              setEditingEntry(null);
              setModalOpen(true);
            }}
          >
            <Icon name="plus" size={16} />
            {kind === "respuesta" ? "Nueva respuesta" : "Nueva capciosa"}
          </button>
          <button type="button" className="button-secondary" onClick={() => download("plantilla")} disabled={Boolean(busy)}>
            <Icon name="download" size={16} />
            {busy === "plantilla" ? "Armando…" : "Descargar plantilla"}
          </button>
          <button type="button" className="button-secondary" onClick={() => download("actual")} disabled={Boolean(busy) || rows.length === 0}>
            <Icon name="download" size={16} />
            {busy === "actual" ? "Armando…" : "Descargar lo que hay"}
          </button>
          <label className="button-secondary pis-file" aria-disabled={missing || Boolean(busy) || undefined}>
            <Icon name="upload" size={16} />
            {busy === "leer" ? "Leyendo…" : "Importar Excel"}
            <input
              type="file"
              accept=".xlsx"
              disabled={missing || Boolean(busy)}
              onChange={(e) => {
                void read(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <p className="pis-small">
          Cree respuestas directamente o impórtelas en Excel con columnas: {columnsFor(kind, sheet).map((c) => c.header).join(" · ")}.
          {own ? ` Las claves de este Pilo empiezan por ${CATALOG_PREFIX[space][kind]}- (las del otro no se pisan).` : ""}
        </p>

        {parsed && (
          <div className="pis-preview" role="status">
            <p className="pis-preview__head">
              <StatusMark tone={errors.length ? "warn" : "ok"}>{parsed.file}</StatusMark>
              {parsed.result.valid.length} {parsed.result.valid.length === 1 ? "fila lista" : "filas listas"}
              {errors.length ? ` · ${errors.length} ${errors.length === 1 ? "error" : "errores"}` : ""}
            </p>
            {errors.length > 0 && (
              <ul className="pis-preview__errors">
                {errors.slice(0, 12).map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
                {errors.length > 12 && <li>… y {errors.length - 12} más.</li>}
              </ul>
            )}
            <label className="pis-preview__replace" data-on={replace || undefined}>
              <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
              Reemplazar: borrar las {kind === "respuesta" ? "respuestas" : "capciosas"} guardadas que no vengan en este libro
            </label>
            <div className="pis-actions">
              <button type="button" className="button-secondary" onClick={() => setParsed(null)}>
                Cancelar
              </button>
              <button
                type="button"
                className="button-primary"
                disabled={!parsed.result.valid.length || importRows.isPending}
                onClick={() => importRows.mutate({ k: kind, valid: parsed.result.valid, all: replace })}
              >
                {importRows.isPending ? "Importando…" : `Importar ${parsed.result.valid.length}${errors.length ? " (sin las que tienen error)" : ""}`}
              </button>
            </div>
          </div>
        )}
        {message && (
          <p className="pis-result" role="status">
            <StatusMark tone={message.ok ? "ok" : "fail"}>{message.text}</StatusMark>
          </p>
        )}
      </Group>

      <Group
        title={kind === "respuesta" ? "Respuestas guardadas" : "Capciosas guardadas"}
        aside={rows.length ? <small>{rows.filter((e) => e.active).length} en uso de {rows.length}</small> : null}
      >
        {(toggle.isError || share.isError) && (
          <p className="pis-error" role="alert">
            No se cambió: {((toggle.error ?? share.error) as Error).message}
          </p>
        )}
        {rows.length === 0 ? (
          <p className="pis-small">Todavía no hay {kind === "respuesta" ? "respuestas" : "capciosas"}. Cree una con «+ Nueva {kind === "respuesta" ? "respuesta" : "capciosa"}» o descargue la plantilla para importarlas en Excel.</p>
        ) : (
          <ul className="pis-cat">
            {rows.map((e) => (
              <li key={e.key} data-off={!e.active || undefined}>
                <code>{e.key}</code>
                <span>
                  <strong>{kind === "respuesta" ? e.question : e.question || e.triggers.join(" · ")}</strong>
                  <small>{e.answer}</small>
                  {e.triggers && e.triggers.length > 0 && (
                    <small>Disparadores: {e.triggers.join(" · ")}</small>
                  )}
                  {kind === "capciosa" && <PremiseMark row={premises.data?.[e.key]} known={Boolean(premises.data)} />}
                  {kind === "respuesta" && e.variants && e.variants.length > 0 && (
                    <small>Variantes: {e.variants.join(" · ")}</small>
                  )}
                  {kind === "respuesta" && e.source_title && (
                    <small>Fuente: {e.source_title} {e.source_path ? `(${e.source_path})` : ""}</small>
                  )}
                </span>
                <em>
                  {own ? `${ROL_LABEL[(e.rol ?? "") as CatalogRol] ?? "Todos"} · ` : ""}
                  {e.mood} · {e.hits} {e.hits === 1 ? "uso" : "usos"}
                  {e.shared ? " · en todos los Pilos" : ""}
                </em>
                <div className="pis-cat__actions">
                  {typeof e.shared === "boolean" && (e.rol ?? "") === "" && (
                    <label className="pis-cat__share" title="La entrada sirve también en los demás Pilos">
                      <Switch on={e.shared} disabled={share.isPending} onChange={(shared) => share.mutate({ key: e.key, shared })} label={`Compartir ${e.key} con los demás Pilos`} />
                      <span>Todos los Pilos</span>
                    </label>
                  )}
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => {
                      setEditingEntry(e);
                      setModalOpen(true);
                    }}
                    title={`Editar ${e.key}`}
                  >
                    Editar
                  </button>
                  <Switch on={e.active} onChange={(active) => toggle.mutate({ key: e.key, active })} label={`Usar ${e.key}`} />
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
          setEditingEntry(null);
        }}
        defaultKind={kind}
        initialEntry={editingEntry}
        isEditing={Boolean(editingEntry)}
        existingKeys={(catalog.data ?? []).map((e) => e.key)}
        space={space}
        onSaved={() => {
          void client.invalidateQueries({ queryKey: KEY });
        }}
      />
    </>
  );
}

const VIA_LABEL = { palabras: "por palabras", significado: "por significado" } as const;

/**
 * El catálogo dentro de la memoria de Pilo: cuántas entradas tienen su vector
 * (0112: respuestas y capciosas), el botón que sincroniza las que faltan y una
 * prueba que dice qué entradas encontraría Pilo para una pregunta.
 */
function CatalogMemory({ space }: { space: PiloSpace }) {
  const status = useEmbedStatus(true, space);
  const indexer = useIndexMemory(space);
  const tryIt = useTryCatalog(space);
  const [progress, setProgress] = useState<EmbedStatus | null>(null);
  const [probe, setProbe] = useState("");
  const now = progress ?? status.data ?? null;
  const pending = now ? Math.max(0, now.catalog_total - now.catalog_done) : 0;
  const synced = Boolean(now) && pending === 0;

  return (
    <Group title="Memoria de Pilo" aside={<small>{now?.model ? `Modelo ${now.model}` : "Búsqueda por significado"}</small>}>
      <div className="pis-row">
        <p className="pis-note">
          Cada entrada del catálogo guarda un vector con su pregunta, sus variantes y sus disparadores. Así Pilo la encuentra aunque le pregunten con otras palabras, y la IA la
          usa como base de su respuesta. Sincronice después de agregar, importar o cambiar entradas.
        </p>
        <button
          type="button"
          className="button-secondary"
          onClick={() => indexer.mutate(setProgress, { onSettled: () => setProgress(null) })}
          disabled={indexer.isPending || status.isPending || status.isError || !now || synced}
        >
          {indexer.isPending ? "Sincronizando…" : synced ? "Al día" : "Sincronizar con la memoria"}
        </button>
      </div>
      {status.isError ? (
        <p className="pis-warn">{(status.error as Error).message}</p>
      ) : now ? (
        <p className="pis-small" role="status">
          <StatusMark tone={synced ? "ok" : "warn"}>{synced ? "Sincronizado" : "Falta sincronizar"}</StatusMark> {now.catalog_done.toLocaleString("es-CO")} de{" "}
          {now.catalog_total.toLocaleString("es-CO")} entradas activas están en la memoria
          {pending ? ` · faltan ${pending.toLocaleString("es-CO")}` : " · todo al día"}.
        </p>
      ) : (
        <p className="pis-small">{status.isPending ? "Revisando la memoria…" : "Sin datos de la memoria."}</p>
      )}
      {indexer.isError && (
        <p className="pis-error" role="alert">
          No terminó de sincronizar: {(indexer.error as Error).message}
        </p>
      )}

      <form
        className="pis-probe"
        onSubmit={(e) => {
          e.preventDefault();
          if (probe.trim()) tryIt.mutate(probe.trim());
        }}
      >
        <input value={probe} onChange={(e) => setProbe(e.target.value)} placeholder="Pruebe una pregunta como la haría el público" aria-label="Pregunta para probar el catálogo" />
        <button type="submit" className="button-secondary" disabled={!probe.trim() || tryIt.isPending}>
          {tryIt.isPending ? "Buscando…" : "Probar el catálogo"}
        </button>
      </form>
      {tryIt.isError && (
        <p className="pis-error" role="alert">
          {(tryIt.error as Error).message}
        </p>
      )}
      {tryIt.data && !tryIt.data.semantic && <p className="pis-small">Solo por palabras{tryIt.data.note ? `: ${tryIt.data.note}` : "."}</p>}
      {tryIt.data &&
        (tryIt.data.hits.length === 0 ? (
          <p className="pis-small">Ninguna entrada del catálogo coincide: Pilo respondería con el resto de su memoria y con la IA.</p>
        ) : (
          <ol className="pis-hits">
            {tryIt.data.hits.map((h) => (
              <li key={h.key}>
                <span className="pis-code">{h.key}</span>
                <span>
                  <strong>{h.question}</strong>
                  <small>
                    {SHEET_NAME[h.kind]} · {VIA_LABEL[h.via]} · {h.used ? "Pilo la usaría como base" : `no alcanza el ${Math.round(tryIt.data.min * 100)} % que hace falta`}
                  </small>
                </span>
                <em title="Qué tanto se parece a la pregunta">{Math.round(h.score * 100)}</em>
              </li>
            ))}
          </ol>
        ))}
    </Group>
  );
}
