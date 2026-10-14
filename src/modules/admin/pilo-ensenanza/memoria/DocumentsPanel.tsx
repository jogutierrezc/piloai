/* =============================================================================
   Mr. Pilo · Memoria › Documentos (el de Enseñanza y, desde 0121, el general).

   El mismo panel sirve a los dos Pilos: recibe de quién es la memoria (`space`)
   y a qué colecciones puede ir un archivo (`collections`; de partida, las de
   Enseñanza). «Mr. Pilo con IA» lo monta con `space="planeacion"` y sus
   colecciones propias.

   La oficina sube DOCX, PDF, XLSX o CSV. El archivo se lee en el navegador
   (carpeta ingest/), se ve lo que va a quedar —pasajes, recortes, datos
   personales omitidos, PDF escaneado— y solo entonces se guarda:

     subir     el original al bucket pilo-docs: <espacio>/<id>/<nombre>
     ficha     pilo_doc_save (un archivo repetido devuelve el id que ya tenía:
               se quita lo recién subido y se dice «ya está»)
     pasajes   pilo_doc_replace                               → «en pasajes»
     mapa      pilo_doc_outline: colección › documento › secciones y las
               normas citadas, por reglas, sin IA                → «en el mapa»
     vectores  el índice por significado de lo pendiente del espacio

   Cada paso puede fallar por separado: se dice cuál, el documento queda en su
   último estado bueno y «Reintentar» sigue desde ahí. Tras recargar, un
   documento a medias ofrece «Continuar» (vuelve a leer el original guardado).

   Por documento: quién lo ve (nace «con sesión»), activo, reemplazar y borrar.
   Sin la migración 0114 el panel lo dice y se apaga. Los sube solo la
   administración (la base rechaza a cualquier otro).
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import type { DragEvent, ReactNode } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { collectionsReady } from "../../pilo/collections";
import { docCollections, usePortals } from "../../pilo/portals";
import type { PiloSpace } from "../../pilo/space";
import { Group, Switch, plural, when } from "../../pilo/ui";
import { LIMITS, SCANNED_MESSAGE, kindOf, readDocument, toPassagesReport } from "../ingest";
import type { DocKind, ParsedDocument, PassageReport } from "../ingest";
import { SPACE_SOURCES } from "../store";
import { enterBlock } from "../motion";
import { Skeleton, useEnter } from "../ui";
import {
  docDelete,
  docOutlineSave,
  docReplace,
  docSave,
  docUpdate,
  downloadOriginal,
  fetchDocPassages,
  hashFile,
  indexPending,
  reading,
  removeOriginal,
  uploadOriginal,
  useDocs,
  useRefreshMemory,
} from "./data";
import type { DocRow } from "./data";
import { MIME_OF, STEP_TEXT, StepError, docPath, faultFrom, faultOf, resumePoint, runFrom, stagesOf, titleFromFile } from "./flow";
import type { Fault, StepId } from "./flow";
import { buildOutline } from "./map";
import { FaultNote, MissingNote, Stages, VisSeg } from "./parts";
import { CollectionsEditor } from "./CollectionsEditor";

export interface MemoryPartProps {
  /** De qué Pilo es la memoria. */
  space: PiloSpace;
  /** Falta la migración que le da memoria a este Pilo: nada se puede guardar. */
  disabled: boolean;
}

/** Una colección a la que puede ir un archivo: su id en la base, su etiqueta de dos letras y su nombre. */
export interface DocCollection {
  id: string;
  code: string;
  name: string;
  /** La creó la administración (0125). */
  custom?: boolean;
}

export interface DocumentsPanelProps extends MemoryPartProps {
  /** Las colecciones de este Pilo. De partida, las que dice la base (con las propias, 0125) o, sin ellas, las de Enseñanza. */
  collections?: DocCollection[];
  /** Lo que se dice cuando está apagado. De partida, que falta la migración 0113. */
  disabledNote?: string;
  /** Un aviso propio de quien lo monta, bajo la presentación. */
  note?: ReactNode;
}

/** Las colecciones de Enseñanza a las que puede ir un archivo (la de Moodle la llena Moodle). */
const TEACH_COLLECTIONS: DocCollection[] = SPACE_SOURCES.filter((s) => s.id !== "moodle").map((s) => ({ id: s.id, code: s.code, name: s.name }));
const KIND_NAME: Record<string, string> = { docx: "Word", pdf: "PDF", xlsx: "Excel", csv: "CSV" };
const OWNER = "documentos";

const sizeText = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toLocaleString("es-CO", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("es-CO")} KB`);

interface Draft {
  file: File;
  kind: DocKind;
  parsed: ParsedDocument;
  report: PassageReport;
  title: string;
  source: string;
  /** Si reemplaza a un documento que ya está. */
  replace: DocRow | null;
}

/** Lo que un recorrido lleva consigo, para poder retomarlo sin volver a empezar. */
interface Ctx {
  id: string;
  title: string;
  source: string;
  kind: DocKind;
  path: string;
  file: File | null;
  pages: number;
  hash: string;
  rows: { seq: number; title: string; section: string; body: string; path: string; cut: string }[] | null;
  /** La ficha ya existe en la base. */
  saved: boolean;
  replace: DocRow | null;
  notes: string[];
}

interface Job {
  ctx: Ctx;
  step: StepId;
  state: "run" | "fail";
  fault?: Fault;
}

class Duplicate extends Error {}

export function DocumentsPanel({ space, disabled, collections: given, disabledNote = "Sin la migración 0113 este Pilo no tiene memoria propia.", note }: DocumentsPanelProps) {
  const portals = usePortals(!disabled);
  const catalog = portals.data?.sources ?? [];
  const fromCatalog = docCollections(catalog, space);
  const collections: DocCollection[] = given ?? (fromCatalog.length ? fromCatalog : TEACH_COLLECTIONS);
  const owner = portals.data?.portals.find((p) => p.id === space)?.name || (space === "ensenanza" ? "Pilo en Enseñanza" : "Pilo de la Universidad");
  const collectionOf = (id: string) => collections.find((c) => c.id === id) ?? SPACE_SOURCES.find((s) => s.id === id);
  const collectionName = (id: string) => collectionOf(id)?.name ?? id;
  const docs = useDocs(space, !disabled);
  const refresh = useRefreshMemory(space);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const [openFault, setOpenFault] = useState<string | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn"; text: string } | null>(null);
  const [over, setOver] = useState(false);
  const [pendingRow, setPendingRow] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [rowFault, setRowFault] = useState<{ id: string; fault: Fault } | null>(null);
  const preview = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  // Soltar un archivo puede avisar dos veces (el campo y la zona): solo se abre uno.
  const opened = useRef(false);

  const missing = docs.data?.missing ?? null;
  const rows = (docs.data?.data ?? []).filter((d) => d.origin === "archivo");
  const off = disabled || Boolean(missing) || docs.isError;
  const docCounts = rows.reduce<Record<string, number>>((acc, d) => ((acc[d.source] = (acc[d.source] ?? 0) + 1), acc), {});
  const canManage = portals.data ? collectionsReady(catalog) : null;
  const busy = job?.state === "run" || Boolean(opening);
  const list = useEnter<HTMLUListElement>(docs.data ? rows.map((d) => d.id).join() : null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reading.end(OWNER);
    };
  }, []);

  useEffect(() => {
    if (draft) enterBlock(preview.current);
  }, [draft?.file]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --- Leer el archivo y mostrar lo que va a quedar ----------------------------------- */

  const open = async (file: File | undefined, replace: DocRow | null = null) => {
    if (!file || busy || off || opened.current) return;
    opened.current = true;
    try {
      await openFile(file, replace);
    } finally {
      opened.current = false;
    }
  };

  const openFile = async (file: File, replace: DocRow | null) => {
    setOpenFault(null);
    setNotice(null);
    const kind = kindOf(file);
    if (!kind) return setOpenFault("Formato no admitido: use Word (.docx), Excel (.xlsx), CSV o PDF.");
    setOpening(file.name);
    reading.set({ owner: OWNER, title: `Pilo está leyendo «${file.name}»`, line: "Se lee aquí, en su navegador: todavía no se guarda nada." });
    try {
      const parsed = await readDocument(file);
      const title = replace?.title ?? titleFromFile(file.name);
      const report = toPassagesReport(parsed, { title });
      if (alive.current) setDraft({ file, kind, parsed, report, title, source: replace?.source ?? collections[0]?.id ?? "", replace });
    } catch (error) {
      if (alive.current) setOpenFault(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    } finally {
      reading.end(OWNER);
      if (alive.current) setOpening(null);
    }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length > 1) setNotice({ tone: "warn", text: "Se toma un archivo a la vez: se abrió el primero." });
    void open(e.dataTransfer.files[0]);
  };

  /* --- El recorrido ------------------------------------------------------------------------ */

  const run = async (ctx: Ctx, from: StepId) => {
    const say = (step: StepId, index: number, total: number) => {
      if (alive.current) setJob({ ctx, step, state: "run" });
      reading.set({ owner: OWNER, title: `${STEP_TEXT[step].doing}: «${ctx.title}»`, line: `Paso ${index + 1} de ${total}.`, progress: index / total, counter: ctx.rows ? plural(ctx.rows.length, "pasaje", "pasajes") : undefined });
    };

    const outcome = await runFrom(
      from,
      {
        // Solo al retomar sin el archivo a mano: se vuelve a leer el original guardado.
        leer: ctx.rows
          ? undefined
          : async () => {
              const blob = ctx.file ?? (await downloadOriginal(ctx.path));
              const file = blob instanceof File ? blob : new File([blob], ctx.path.split("/").pop() ?? "documento", { type: MIME_OF[ctx.kind] });
              const parsed = await readDocument(file);
              if (parsed.scanned) throw new StepError({ ...faultFrom(422, { error: SCANNED_MESSAGE }), title: "El PDF es una imagen", hint: "Reemplácelo por una versión en Word o con OCR.", retry: false });
              ctx.pages = parsed.pages;
              ctx.rows = toPassagesReport(parsed, { title: ctx.title }).passages.map((p) => ({ ...p, path: "" }));
            },
        subir: ctx.file
          ? async () => {
              if (!ctx.hash) ctx.hash = await hashFile(ctx.file!);
              // Lo que ya se sabe repetido no se sube (la base lo vuelve a revisar al guardar la ficha).
              const twin = rows.find((d) => d.file_hash === ctx.hash && d.id !== ctx.id);
              if (twin) throw new Duplicate(twin.id);
              await uploadOriginal(ctx.path, ctx.file!, ctx.file!.type || MIME_OF[ctx.kind]);
            }
          : undefined,
        ficha: ctx.file
          ? async () => {
              let id: string;
              try {
                id = await docSave(space, {
                  id: ctx.id,
                  origin: "archivo",
                  kind: ctx.kind,
                  source: ctx.source,
                  title: ctx.title,
                  file_path: ctx.path,
                  file_name: ctx.file!.name.slice(0, 300),
                  file_size: ctx.file!.size,
                  file_hash: ctx.hash,
                  pages: ctx.pages,
                });
              } catch (error) {
                // Al reemplazar, la huella puede ser la de OTRO documento del espacio.
                if (/pilo_docs_hash_idx|duplicate key/i.test(error instanceof Error ? error.message : "")) {
                  await removeOriginal(ctx.path === ctx.replace?.file_path ? "" : ctx.path);
                  throw new StepError({ ...faultFrom(409, { error: "Ese mismo archivo ya está en la memoria como otro documento." }), title: "El archivo ya está", hint: "No hace falta subirlo otra vez.", retry: false });
                }
                throw error;
              }
              if (id !== ctx.id) {
                await removeOriginal(ctx.path);
                throw new Duplicate(id);
              }
              ctx.saved = true;
              if (ctx.replace && ctx.replace.file_path && ctx.replace.file_path !== ctx.path) void removeOriginal(ctx.replace.file_path);
            }
          : undefined,
        pasajes: async () => {
          const r = await docReplace(ctx.id, ctx.rows ?? []);
          if (r.skipped > 0) ctx.notes.push(`${plural(r.skipped, "pasaje pasó", "pasajes pasaron")} del tope de ${LIMITS.passages} y no se guardaron.`);
          if (r.total === 0) throw new StepError({ ...faultFrom(422, { error: "El documento no dejó ningún pasaje con texto suficiente." }), title: "No quedó ningún pasaje", hint: "Revise el archivo o reemplácelo.", retry: false });
        },
        mapa: async () => {
          const rowsForMap = ctx.rows ?? (await fetchDocPassages(space, ctx.id));
          const outline = buildOutline({ id: ctx.id, source: ctx.source, title: ctx.title }, collectionName(ctx.source), rowsForMap);
          try {
            await docOutlineSave(ctx.id, outline.nodes, outline.edges);
            if (outline.trimmed) ctx.notes.push("La estructura es muy larga: el mapa guarda la primera parte.");
          } catch (error) {
            // Sin 0115 no hay mapa: el documento queda «en pasajes», que ya sirve para responder.
            if (faultOf(error).code !== "migracion") throw error;
            ctx.notes.push("Falta la migración 0115: el documento quedó en pasajes y entrará al mapa cuando se aplique (use «Continuar»).");
          }
        },
        vectores: async () => {
          const left = await indexPending(space, (pending) =>
            reading.set({ owner: OWNER, title: `${STEP_TEXT.vectores.doing}: «${ctx.title}»`, line: pending ? `Faltan ${pending.toLocaleString("es-CO")} vectores en este espacio.` : "Índice al día." }),
          );
          if (left > 0) throw new StepError({ ...faultFrom(502, { error: `Quedaron ${left.toLocaleString("es-CO")} sin vector.` }), title: "El índice no quedó completo", hint: "El documento ya responde por palabras. Reintente, o use «Indexar por significado», en «Búsqueda por significado».", retry: true });
        },
      },
      say,
    );

    reading.end(OWNER);
    refresh();
    if (!alive.current) return;

    if (outcome.ok) {
      setJob(null);
      setNotice({ tone: ctx.notes.length ? "warn" : "ok", text: [`«${ctx.title}» quedó en la memoria.`, ...ctx.notes].join(" ") });
      void docUpdate(ctx.id, { status_detail: ctx.notes.join(" ").slice(0, 600) }).catch(() => undefined);
      return;
    }
    if (outcome.error instanceof Duplicate) {
      const twinId = outcome.error.message;
      const existing = rows.find((d) => d.id === twinId);
      setJob(null);
      setNotice({ tone: "warn", text: `Ese archivo ya está en la memoria${existing ? ` como «${existing.title}»` : ""}: no se guardó otra vez.` });
      return;
    }
    const fault = faultOf(outcome.error);
    setJob({ ctx, step: outcome.step, state: "fail", fault });
    // La ficha conserva su último estado bueno; solo se anota qué paso falló.
    if (ctx.saved) void docUpdate(ctx.id, { status_detail: `${STEP_TEXT[outcome.step].failed}: ${fault.detail || fault.title}`.slice(0, 600) }).catch(() => undefined);
  };

  const save = () => {
    if (!draft || busy) return;
    const id = draft.replace?.id ?? crypto.randomUUID();
    const title = draft.title.trim() || titleFromFile(draft.file.name);
    const ctx: Ctx = {
      id,
      title,
      source: draft.source,
      kind: draft.kind,
      path: docPath(space, id, draft.file.name),
      file: draft.file,
      pages: draft.parsed.pages,
      hash: "",
      rows: draft.report.passages.map((p) => ({ ...p, title: p.title || title, path: "" })),
      saved: Boolean(draft.replace),
      replace: draft.replace,
      notes: [],
    };
    setDraft(null);
    setNotice(null);
    void run(ctx, "subir");
  };

  /** Un documento que quedó a medias (por ejemplo, tras recargar): sigue desde su último estado bueno. */
  const resume = (d: DocRow) => {
    const from = resumePoint(d);
    if (!from || busy) return;
    const kind = (d.kind === "curso" ? "docx" : d.kind) as DocKind;
    void run({ id: d.id, title: d.title, source: d.source, kind, path: d.file_path, file: null, pages: d.pages, hash: d.file_hash, rows: null, saved: true, replace: null, notes: [] }, from === "pasajes" ? "leer" : from);
  };

  const dismiss = () => {
    // Lo subido sin ficha no debe quedar suelto en el bucket.
    if (job && !job.ctx.saved) void removeOriginal(job.ctx.path);
    setJob(null);
  };

  /* --- Cambios de un documento ---------------------------------------------------------- */

  const patch = async (d: DocRow, change: Record<string, unknown>): Promise<boolean> => {
    setPendingRow(d.id);
    setRowFault(null);
    try {
      await docUpdate(d.id, change);
      refresh();
      return true;
    } catch (error) {
      if (alive.current) setRowFault({ id: d.id, fault: faultOf(error) });
      return false;
    } finally {
      if (alive.current) setPendingRow(null);
    }
  };

  const move = async (d: DocRow, source: string) => {
    if (source === d.source || !(await patch(d, { source })) || !alive.current) return;
    setNotice({ tone: "ok", text: `«${d.title}» pasó a «${collectionName(source)}». Pilo lo lee según lo que ese portal tenga encendido para esa colección.` });
  };

  const remove = async (d: DocRow) => {
    setPendingRow(d.id);
    setRowFault(null);
    try {
      const r = await docDelete(d.id);
      const gone = await removeOriginal(r.file_path);
      if (!alive.current) return;
      setConfirmDelete(null);
      setNotice({
        tone: gone ? "ok" : "warn",
        text: `Se borró «${d.title}»: ${plural(r.passages, "pasaje", "pasajes")}, ${plural(r.answers, "respuesta guardada que lo citaba", "respuestas guardadas que lo citaban")} y ${plural(r.topics, "tema o referencia que quedó sin uso", "temas o referencias que quedaron sin uso")}.${gone ? "" : " El archivo original no se pudo quitar del almacenamiento: bórrelo a mano en el bucket pilo-docs."}`,
      });
      refresh();
    } catch (error) {
      if (alive.current) setRowFault({ id: d.id, fault: faultOf(error) });
    } finally {
      if (alive.current) setPendingRow(null);
    }
  };

  /* --- Pintar ---------------------------------------------------------------------------------- */

  const warnings = draft ? [...new Set([...draft.parsed.warnings, ...draft.report.warnings])] : [];
  const canSave = Boolean(draft) && !draft!.parsed.scanned && draft!.report.passages.length > 0;
  const pagesWord = (kind: string, n: number) => (n ? ` · ${plural(n, kind === "xlsx" ? "hoja" : "página", kind === "xlsx" ? "hojas" : "páginas")}` : "");

  return (
    <Group
      title="Documentos"
      aside={
        <span className="pen-types" aria-label="Formatos admitidos">
          <span>DOCX</span>
          <span>PDF</span>
          <span>XLSX</span>
          <span>CSV</span>
        </span>
      }
    >
      <p className="pis-lead">
        Súbalos tal como están. Pilo los lee aquí mismo, los parte en pasajes, omite correos, teléfonos y documentos de identidad, y los ubica en el mapa. Cada documento nace
        visible solo con sesión iniciada.
      </p>
      {note}

      {disabled ? (
        <p className="pis-small">{disabledNote}</p>
      ) : missing ? (
        <MissingNote migration={missing} what="Sin ella no existen la ficha de los documentos ni el almacenamiento de los originales." />
      ) : docs.isError ? (
        <FaultNote fault={faultOf(docs.error)} lead="No se pudieron leer los documentos" onRetry={() => void docs.refetch()} />
      ) : (
        <>
          {canManage ? (
            <CollectionsEditor space={space} sources={catalog} docCounts={docCounts} owner={owner} />
          ) : (
            canManage === false && <p className="pis-small">Para crear colecciones propias falta aplicar la migración 0125 en la base.</p>
          )}
          <label className="pen-drop" data-over={over || undefined} aria-disabled={busy || undefined} onDragOver={(e) => (e.preventDefault(), setOver(true))} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <Icon name="upload" size={20} />
            <span>
              <strong>{opening ? `Leyendo «${opening}»…` : "Suelte un archivo aquí o elíjalo"}</strong>
              <small>Word, PDF, Excel o CSV · hasta 25 MB · primero verá lo que va a quedar</small>
            </span>
            <input type="file" accept=".docx,.pdf,.xlsx,.csv" disabled={busy} aria-label="Elegir un documento" onChange={(e) => (void open(e.target.files?.[0]), (e.target.value = ""))} />
          </label>

          {openFault && (
            <p className="pis-error" role="alert">
              {openFault}
            </p>
          )}

          {draft && (
            <div className="pis-preview pen-preview" ref={preview}>
              <div className="pen-preview__head">
                <strong>{draft.replace ? `Reemplazar «${draft.replace.title}» con este archivo` : "Antes de guardar"}</strong>
                <small>
                  {draft.file.name} · {KIND_NAME[draft.kind]} · {sizeText(draft.file.size)}
                  {pagesWord(draft.kind, draft.parsed.pages)}
                </small>
              </div>
              <div className="pen-grid">
                <label className="pen-field">
                  <span className="pen-field__label">Título</span>
                  <input className="pen-input" value={draft.title} maxLength={300} disabled={Boolean(draft.replace)} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                </label>
                <label className="pen-field">
                  <span className="pen-field__label">Colección</span>
                  <select value={draft.source} disabled={Boolean(draft.replace)} onChange={(e) => setDraft({ ...draft, source: e.target.value })}>
                    {collections.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              {draft.parsed.scanned ? (
                <FaultNote fault={{ code: "pedido", title: "Este PDF es una imagen", detail: SCANNED_MESSAGE, hint: "No se guarda: no hay texto que leer.", retry: false }} />
              ) : (
                <>
                  <ul className="pen-facts-line">
                    <li>
                      <b>{draft.report.passages.length.toLocaleString("es-CO")}</b> {draft.report.passages.length === 1 ? "pasaje" : "pasajes"}
                    </li>
                    <li>
                      <b>{draft.report.redacted.toLocaleString("es-CO")}</b> {draft.report.redacted === 1 ? "dato personal omitido" : "datos personales omitidos"}
                    </li>
                    <li>
                      <b>{warnings.length.toLocaleString("es-CO")}</b> {warnings.length === 1 ? "aviso" : "avisos"}
                    </li>
                  </ul>
                  {warnings.length > 0 && (
                    <ul className="pen-warnings">
                      {warnings.map((w) => (
                        <li key={w}>
                          <Icon name="alert" size={13} /> {w}
                        </li>
                      ))}
                    </ul>
                  )}
                  {draft.report.passages.length === 0 ? (
                    <p className="pis-error">No se halló texto suficiente para guardar ningún pasaje.</p>
                  ) : (
                    <ol className="pen-sample" aria-label="Los primeros pasajes">
                      {draft.report.passages.slice(0, 3).map((p) => (
                        <li key={p.seq}>
                          <small>{p.section || p.title}</small>
                          <span>{p.body.length > 240 ? `${p.body.slice(0, 240).trimEnd()}…` : p.body}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </>
              )}

              {draft.replace && <p className="pis-small">Al reemplazar, los pasajes que no cambian conservan su vector y sus temas; los que cambian se vuelven a indexar. El título y la colección no cambian.</p>}
              <div className="pis-actions">
                <button type="button" className="button-primary" onClick={save} disabled={!canSave || busy}>
                  {draft.replace ? "Reemplazar" : "Guardar en la memoria"}
                </button>
                <button type="button" className="button-secondary" onClick={() => setDraft(null)}>
                  Descartar
                </button>
              </div>
            </div>
          )}

          {notice && (
            <p className={notice.tone === "ok" ? "pen-ok" : "pis-warn"} role="status">
              {notice.tone === "ok" && <Icon name="check" size={14} />} {notice.text}
            </p>
          )}

          {/* Un archivo nuevo que aún no tiene ficha: su recorrido se ve aquí. */}
          {job && !rows.some((d) => d.id === job.ctx.id) && (
            <div className="pen-doc" data-new>
              <header>
                <b>{job.ctx.title}</b>
                <small>{job.state === "run" ? `${STEP_TEXT[job.step].doing}…` : STEP_TEXT[job.step].failed}</small>
              </header>
              <Stages stages={stagesOf(null, job)} label={job.ctx.title} />
              {job.state === "fail" && job.fault && (
                <FaultNote fault={job.fault} lead={STEP_TEXT[job.step].failed} onRetry={job.fault.retry ? () => void run(job.ctx, job.step) : undefined}>
                  <button type="button" className="pis-link" onClick={dismiss}>
                    Descartar
                  </button>
                </FaultNote>
              )}
            </div>
          )}

          {docs.isPending ? (
            <Skeleton rows={2} label="Leyendo los documentos" />
          ) : rows.length === 0 && !job ? (
            <p className="pis-small">Todavía no hay documentos en la memoria de este Pilo.</p>
          ) : (
            <ul className="pen-docs" ref={list}>
              {rows.map((d) => {
                const mine = job?.ctx.id === d.id ? job : null;
                const from = mine ? null : resumePoint(d);
                const rowBusy = pendingRow === d.id || mine?.state === "run";
                return (
                  <li key={d.id} className="pen-doc" data-off={!d.active || undefined}>
                    <header>
                      <span className="pis-code pen-code" data-s={d.source} title={collectionName(d.source)}>
                        {collectionOf(d.source)?.code ?? "··"}
                      </span>
                      <b>{d.title}</b>
                      <small>
                        {KIND_NAME[d.kind] ?? d.kind}
                        {pagesWord(d.kind, d.pages)} · {plural(d.passages, "pasaje", "pasajes")} · {when(d.updated_at)}
                        {d.active ? "" : " · inactivo: Pilo no lo usa"}
                      </small>
                    </header>
                    <Stages stages={stagesOf(d, mine)} label={d.title} />

                    {mine?.state === "fail" && mine.fault ? (
                      <FaultNote fault={mine.fault} lead={STEP_TEXT[mine.step].failed} onRetry={mine.fault.retry ? () => void run(mine.ctx, mine.step) : undefined}>
                        <button type="button" className="pis-link" onClick={dismiss}>
                          Cerrar el aviso
                        </button>
                      </FaultNote>
                    ) : from && !mine ? (
                      <div className="pen-fault" role="note">
                        <Icon name="alert" size={16} />
                        <p>
                          {d.status_detail || "Este documento quedó a medias."} Quedó «{stagesOf(d).filter((s) => s.state === "done").pop()?.label.toLowerCase() ?? "sin leer"}».
                        </p>
                        <span className="pis-actions">
                          <button type="button" className="button-secondary" onClick={() => resume(d)} disabled={busy}>
                            Continuar
                          </button>
                        </span>
                      </div>
                    ) : d.status_detail && !mine ? (
                      <p className="pis-small">{d.status_detail}</p>
                    ) : null}

                    {rowFault?.id === d.id && <FaultNote fault={rowFault.fault} lead="No se aplicó el cambio" />}

                    {confirmDelete === d.id ? (
                      <div className="pis-key__saved pis-key__saved--confirm" role="alert">
                        <span>
                          ¿Borrar «{d.title}»? Se borran sus {plural(d.passages, "pasaje", "pasajes")}, su lugar en el mapa, las respuestas guardadas que lo citan, los temas que queden sin
                          uso y el archivo original. No se puede deshacer.
                        </span>
                        <button type="button" className="button-secondary" onClick={() => setConfirmDelete(null)}>
                          No, dejarlo
                        </button>
                        <button type="button" className="button-primary pis-danger" disabled={rowBusy} onClick={() => void remove(d)}>
                          {pendingRow === d.id ? "Borrando…" : "Borrar"}
                        </button>
                      </div>
                    ) : (
                      <div className="pen-doc__controls">
                        <VisSeg value={d.vis} label={d.title} disabled={rowBusy} onChange={(vis) => void patch(d, { vis })} />
                        {collections.length > 1 && (
                          <label className="pen-doc__move">
                            Colección
                            <select value={d.source} disabled={rowBusy || busy} aria-label={`Colección de «${d.title}»`} onChange={(e) => void move(d, e.target.value)}>
                              {!collections.some((c) => c.id === d.source) && <option value={d.source}>{collectionName(d.source)}</option>}
                              {collections.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          </label>
                        )}
                        <span className="pen-doc__switch">
                          <Switch on={d.active} disabled={rowBusy} onChange={(active) => void patch(d, { active })} label={`Usar «${d.title}»`} />
                          {d.active ? "Activo" : "Inactivo"}
                        </span>
                        <label className="pis-file pis-link" aria-disabled={busy || rowBusy || undefined}>
                          Reemplazar
                          <input type="file" accept=".docx,.pdf,.xlsx,.csv" disabled={busy || rowBusy} aria-label={`Reemplazar «${d.title}»`} onChange={(e) => (void open(e.target.files?.[0], d), (e.target.value = ""))} />
                        </label>
                        <button type="button" className="pis-link pis-link--danger" disabled={rowBusy} onClick={() => setConfirmDelete(d.id)}>
                          Borrar
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Group>
  );
}
