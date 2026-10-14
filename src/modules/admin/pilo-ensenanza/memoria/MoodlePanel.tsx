/* =============================================================================
   Mr. Pilo en Enseñanza · Memoria › Moodle.

   Pilo lee cursos de Moodle por su API de servicios web (función pilo-ia,
   acción «moodle»; migraciones 0116 y 0133). La universidad tiene varios
   Moodle: cada uno es un sitio, con su conexión y sus cursos. Aquí:

     Sitios      la lista (pilo_moodle_sites): elegir uno, agregar otro o
                 quitarlo. De un sitio a la función solo viaja su id.
     Conexión    la dirección del sitio y el token, que se escribe y no vuelve:
                 pilo_moodle_site_set_token devuelve solo sus cuatro últimos
                 caracteres. Ninguno de los dos viaja en los pedidos de esta
                 página a la función.
     Probar      paso «probar»: qué sitio respondió y cuáles funciones de
                 lectura puede usar de verdad el token.
     Elegir      paso «categorias» y «cursos» (anota los cursos de una
                 categoría); cada curso se elige o se suelta y dice quién lo ve
                 (pilo_moodle_course_set). Soltar un curso oculta sus pasajes.
     Sincronizar paso «curso», uno por llamada, y luego el índice por
                 significado. El recorrido es el de un documento.
     Guía        qué lee y qué nunca lee; los pasos en Moodle y aquí.

   Los nombres de las funciones y las rutas de menú no están comprobados contra
   el Moodle de la universidad: la guía lo dice y «Probar conexión» es quien
   responde. Sin la migración 0133 el panel lo dice y se apaga.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { MOODLE_ALLOWED } from "../../../../components/pilo/ai/logic";
import { Icon } from "../../../../components/ui/Icon";
import { Group, StatusMark, Switch, plural, when } from "../../pilo/ui";
import { Skeleton, useEnter } from "../ui";
import { courseSet, deleteMoodleSite, indexPending, moodleCategories, moodleCourse, moodleCourses, moodleProbe, reading, saveMoodleSite, saveMoodleToken, useDocs, useMoodle, useRefreshMemory } from "./data";
import type { CourseRow, DocRow, MoodleCategory, MoodleProbe, MoodleSiteRow } from "./data";
import type { MemoryPartProps } from "./DocumentsPanel";
import { MAX_MOODLE_SITES, StepError, checkMoodleUrl, faultOf, moodleSiteId, stagesOf } from "./flow";
import type { Fault } from "./flow";
import { FaultNote, MissingNote, Stages, VisSeg } from "./parts";

const OWNER = "moodle";

/** Para qué sirve cada función de la lista cerrada. Las de `mod_*` distintas de páginas están por confirmar. */
const FN_USE: Record<string, string> = {
  core_webservice_get_site_info: "Comprobar la conexión y saber qué puede usar el token.",
  core_course_get_categories: "Las categorías del sitio.",
  core_course_get_courses_by_field: "Los cursos de una categoría y los datos de un curso.",
  core_course_get_contents: "Las secciones y actividades de un curso.",
  mod_page_get_pages_by_courses: "El texto de las páginas.",
  mod_book_get_books_by_courses: "La presentación de los libros.",
  mod_label_get_labels_by_courses: "Las etiquetas con texto.",
  mod_url_get_urls_by_courses: "La presentación de los enlaces.",
  mod_resource_get_resources_by_courses: "La presentación de los recursos.",
  mod_folder_get_folders_by_courses: "La presentación de las carpetas.",
};
const CORE = new Set(["core_webservice_get_site_info", "core_course_get_categories", "core_course_get_courses_by_field", "core_course_get_contents"]);

const COURSE_STATUS: Record<string, string> = { leido: "Leído", sin_cambios: "Sin cambios desde la última lectura", vacio: "Sin contenido legible", error: "La última lectura falló" };

type Busy = null | "url" | "token" | "probe" | "cats" | `cat:${number}` | "sync" | "del";

export function MoodlePanel({ space, disabled }: MemoryPartProps) {
  const setup = useMoodle(space, !disabled);
  const docs = useDocs(space, !disabled);
  const refresh = useRefreshMemory(space);
  const [current, setCurrent] = useState<string | null>(null);
  // Mientras un sitio lee o guarda, no se cambia de sitio: la lectura seguiría sin nadie mirándola.
  const [locked, setLocked] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [addBad, setAddBad] = useState<string | null>(null);
  const [addFault, setAddFault] = useState<Fault | null>(null);
  const [saving, setSaving] = useState(false);

  const data = setup.data?.data;
  const missing = setup.data?.missing ?? null;
  const sites = data?.sites ?? [];
  const site = sites.find((s) => s.id === current) ?? sites[0] ?? null;
  const lit = sites.filter((s) => s.on).length;
  const docById = new Map((docs.data?.data ?? []).map((d) => [d.id, d]));
  const showAdd = adding || (Boolean(data) && sites.length === 0);

  const add = async () => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return setAddBad("Escriba un nombre para el sitio.");
    if (clean.length > 60) return setAddBad("El nombre es demasiado largo: hasta 60 caracteres.");
    if (sites.some((s) => s.name.toLowerCase() === clean.toLowerCase())) return setAddBad("Ya hay un sitio con ese nombre.");
    const checked = checkMoodleUrl(newUrl);
    if (!checked.ok) return setAddBad(checked.why);
    setAddBad(null);
    setAddFault(null);
    setSaving(true);
    const id = moodleSiteId(clean, sites.map((s) => s.id));
    try {
      await saveMoodleSite(space, id, { name: clean, url: checked.url });
      setCurrent(id);
      setAdding(false);
      setName("");
      setNewUrl("");
      refresh();
    } catch (error) {
      setAddFault(faultOf(error));
    } finally {
      setSaving(false);
    }
  };

  const state = !data ? null : sites.length === 0 ? (
    <StatusMark tone="off">Sin sitios</StatusMark>
  ) : (
    <StatusMark tone={lit ? "ok" : "warn"}>{`${plural(sites.length, "sitio", "sitios")} · ${lit === 0 ? "ninguno encendido" : plural(lit, "encendido", "encendidos")}`}</StatusMark>
  );

  return (
    <Group title="Moodle" aside={<small>{state}</small>}>
      <p className="pis-lead">
        Pilo entra por la API de servicios web con un usuario de solo lectura y lee la estructura y el contenido de los cursos que usted elija. Nunca estudiantes, notas, entregas,
        mensajes ni foros. Cada Moodle de la universidad es un sitio aparte, con su conexión y sus cursos.
      </p>

      {disabled ? (
        <p className="pis-small">Sin la migración 0113 este Pilo no tiene memoria propia.</p>
      ) : missing ? (
        <MissingNote migration={missing} what="Sin ella no hay dónde guardar los sitios de Moodle, sus tokens ni sus cursos." />
      ) : setup.isError ? (
        <FaultNote fault={faultOf(setup.error)} lead="No se pudo leer la conexión con Moodle" onRetry={() => void setup.refetch()} />
      ) : setup.isPending || !data ? (
        <Skeleton rows={2} label="Leyendo la conexión con Moodle" />
      ) : (
        <>
          {/* --- Los sitios ---------------------------------------------------------------- */}
          <div className="pen-moodle__sites">
            {sites.length > 0 && (
              <div className="pis-seg" role="radiogroup" aria-label="Sitio de Moodle">
                {sites.map((s) => (
                  <button key={s.id} type="button" role="radio" aria-checked={s.id === site?.id} disabled={locked && s.id !== site?.id} onClick={() => setCurrent(s.id)}>
                    {s.name}
                    {s.on ? "" : <span className="pis-seg__n"> · apagado</span>}
                  </button>
                ))}
              </div>
            )}
            {!showAdd && sites.length < MAX_MOODLE_SITES && (
              <button type="button" className="button-secondary pen-refresh" disabled={locked} onClick={() => setAdding(true)}>
                <Icon name="plus" size={14} /> Agregar sitio
              </button>
            )}
          </div>

          {showAdd && (
            <form
              className="pen-moodle__new"
              onSubmit={(e) => {
                e.preventDefault();
                void add();
              }}
            >
              {sites.length === 0 && <p className="pis-small">Todavía no hay ningún sitio de Moodle. Agregue el primero: después podrá sumar los demás, hasta {MAX_MOODLE_SITES}.</p>}
              <div className="pen-moodle__conn">
                <label className="pen-field">
                  <span className="pen-field__label">Nombre del sitio</span>
                  <input
                    className="pen-input"
                    type="text"
                    value={name}
                    maxLength={60}
                    placeholder="Por ejemplo, Pregrado Bucaramanga"
                    aria-invalid={Boolean(addBad) || undefined}
                    onChange={(e) => {
                      setName(e.target.value);
                      setAddBad(null);
                    }}
                  />
                  <small>Como lo verá la gente al elegir su Moodle en «Mis clases».</small>
                </label>
                <label className="pen-field">
                  <span className="pen-field__label">Dirección de Moodle</span>
                  <input
                    className="pen-input"
                    type="url"
                    inputMode="url"
                    value={newUrl}
                    placeholder="https://…"
                    aria-invalid={Boolean(addBad) || undefined}
                    onChange={(e) => {
                      setNewUrl(e.target.value);
                      setAddBad(null);
                    }}
                  />
                  <small>La de entrada al sitio, con https. Puede dejarla para después.</small>
                </label>
              </div>
              {addBad && (
                <p className="pis-small" role="alert">
                  <b className="pen-bad">{addBad}</b>
                </p>
              )}
              {addFault && <FaultNote fault={addFault} lead="No se agregó el sitio" />}
              <div className="pis-actions">
                <button type="submit" className="button-primary" disabled={saving}>
                  {saving ? "Agregando…" : "Agregar sitio"}
                </button>
                {sites.length > 0 && (
                  <button type="button" className="button-secondary" disabled={saving} onClick={() => (setAdding(false), setAddBad(null), setAddFault(null))}>
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          )}

          {site && (
            <MoodleSite
              key={site.id}
              space={space}
              data={site}
              courses={data.courses.filter((c) => c.site === site.id)}
              docById={docById}
              several={sites.length > 1}
              onBusy={setLocked}
            />
          )}
        </>
      )}

      <MoodleGuide />
    </Group>
  );
}

/* --- Un sitio: su conexión y sus cursos ------------------------------------------------------- */

interface MoodleSiteProps {
  space: MemoryPartProps["space"];
  data: MoodleSiteRow;
  courses: CourseRow[];
  docById: Map<string, DocRow>;
  /** Hay más sitios: los textos nombran este. */
  several: boolean;
  onBusy: (busy: boolean) => void;
}

function MoodleSite({ space, data, courses, docById, several, onBusy }: MoodleSiteProps) {
  const refresh = useRefreshMemory(space);
  const [url, setUrl] = useState("");
  const [confirmDel, setConfirmDel] = useState(false);
  const [token, setToken] = useState("");
  const [editToken, setEditToken] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [fault, setFault] = useState<{ where: string; fault: Fault; retry?: () => void } | null>(null);
  const [urlBad, setUrlBad] = useState<string | null>(null);
  const [probe, setProbe] = useState<MoodleProbe | null>(null);
  const [cats, setCats] = useState<MoodleCategory[] | null>(null);
  const [rowBusy, setRowBusy] = useState<number | null>(null);
  const [syncing, setSyncing] = useState<number | null>(null);
  const [results, setResults] = useState<Record<number, { tone: "ok" | "warn"; text: string } | { fault: Fault }>>({});
  // Cuántos cursos quedaron sin leer la última vez que se detuvo la sincronización.
  const [stopped, setStopped] = useState(0);
  const alive = useRef(true);
  // «Detener» (en el panel de Pilo) corta la fila de cursos al terminar el que se está leyendo.
  const halt = useRef(false);

  const chosen = courses.filter((c) => c.selected);
  const list = useEnter<HTMLUListElement>(courses.map((c) => c.course_id).join());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      reading.end(OWNER);
      onBusy(false);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    onBusy(Boolean(busy));
  }, [busy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setUrl(data.url);
  }, [data.url]);

  /** Corre algo que habla con la base o la función: marca qué está ocupado y deja el error donde pasó. */
  const act = async (what: Busy, where: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(what);
    setFault(null);
    setStopped(0);
    try {
      await fn();
    } catch (error) {
      if (alive.current) setFault({ where, fault: faultOf(error), retry: () => void act(what, where, fn) });
    } finally {
      reading.end(OWNER);
      if (alive.current) setBusy(null);
      refresh();
    }
  };

  const saveUrl = () => {
    const checked = checkMoodleUrl(url);
    if (!checked.ok) return setUrlBad(checked.why);
    setUrlBad(null);
    void act("url", "No se guardó la dirección", async () => {
      await saveMoodleSite(space, data.id, { url: checked.url });
      // Otra dirección es otro sitio: lo que respondió el anterior ya no vale.
      if (alive.current) setProbe(null);
    });
  };

  const remove = () =>
    act("del", "No se quitó el sitio", async () => {
      await deleteMoodleSite(space, data.id);
    });

  const test = () =>
    act("probe", "La prueba de conexión falló", async () => {
      reading.set({ owner: OWNER, title: "Pilo está llamando a Moodle", line: "Pide los datos del sitio y revisa qué funciones de lectura puede usar el token." });
      const r = await moodleProbe(space, data.id);
      if (alive.current) setProbe(r);
    });

  const loadCats = () =>
    act("cats", "No se pudieron leer las categorías", async () => {
      reading.set({ owner: OWNER, title: "Pilo está leyendo las categorías de Moodle", line: "Solo las visibles." });
      const r = await moodleCategories(space, data.id);
      if (alive.current) setCats(r.categories ?? []);
    });

  const loadCourses = (c: MoodleCategory) =>
    act(`cat:${c.id}`, `No se pudieron leer los cursos de «${c.name}»`, async () => {
      reading.set({ owner: OWNER, title: `Pilo está leyendo los cursos de «${c.name}»`, line: "Los anota para que usted elija; no lee su contenido todavía." });
      await moodleCourses(space, data.id, c.id);
    });

  /** Un curso: lo lee la función (un pedido), y luego se indexa lo nuevo. Devuelve si salió bien. */
  const syncOne = async (c: CourseRow, index = 0, total = 1): Promise<Fault | null> => {
    const counter = total > 1 ? `${index + 1} de ${total}` : undefined;
    const progress = total > 1 ? index / total : undefined;
    const line = "Pide a Moodle sus secciones y actividades, las parte en pasajes y las ubica en el mapa.";
    // Solo con más cursos por delante hay algo que detener.
    const stop =
      index < total - 1 && !halt.current
        ? () => {
            halt.current = true;
            reading.set({ owner: OWNER, title: `Pilo termina «${c.fullname}» y se detiene`, line: "Los cursos que faltan quedan sin leer; lo leído queda guardado.", progress, counter });
          }
        : undefined;
    setSyncing(c.course_id);
    reading.set({ owner: OWNER, title: `Pilo está leyendo «${c.fullname}»`, line, progress, counter, stop });
    try {
      const r = await moodleCourse(space, data.id, c.course_id);
      const notes = [
        r.empty ? r.note || "El curso no tiene contenido legible." : r.unchanged ? "Sin cambios desde la última lectura." : `${plural(r.passages ?? 0, "pasaje", "pasajes")}: ${r.added ?? 0} nuevos, ${r.changed ?? 0} cambiados, ${r.removed ?? 0} quitados.`,
        r.redacted ? `${plural(r.redacted, "dato personal omitido", "datos personales omitidos")}.` : "",
        r.dropped ? `${plural(r.dropped, "pasaje pasó", "pasajes pasaron")} del tope y no se guardaron.` : "",
        r.skipped?.length ? `No se pudo usar: ${r.skipped.join(", ")} (el curso se leyó con lo demás).` : "",
        r.mapped === false && !r.empty ? "No entró al mapa: falta la migración 0115." : "",
        r.selected === false ? "El curso no está elegido: sus pasajes quedan ocultos hasta que lo elija." : "",
      ].filter(Boolean);
      let warn = Boolean(r.empty || r.dropped || r.skipped?.length || r.mapped === false);
      if (!r.empty && !r.unchanged) {
        if (!halt.current) reading.set({ owner: OWNER, title: `Indexando por significado: «${c.fullname}»`, line: "Para que Pilo lo encuentre aunque le pregunten con otras palabras.", progress, counter, stop });
        try {
          const left = await indexPending(space);
          if (left > 0) throw new Error("incompleto");
        } catch {
          warn = true;
          notes.push("El índice por significado no quedó completo: el curso ya responde por palabras; use «Indexar por significado», en el momento «Comprender».");
        }
      }
      if (alive.current) setResults((prev) => ({ ...prev, [c.course_id]: { tone: warn ? "warn" : "ok", text: notes.join(" ") } }));
      return null;
    } catch (error) {
      const failed = faultOf(error);
      if (alive.current) setResults((prev) => ({ ...prev, [c.course_id]: { fault: failed } }));
      return failed;
    } finally {
      if (alive.current) setSyncing(null);
    }
  };

  const sync = (list: CourseRow[]) =>
    act("sync", "La sincronización se detuvo", async () => {
      halt.current = false;
      for (let i = 0; i < list.length; i++) {
        const failed = await syncOne(list[i], i, list.length);
        refresh();
        if (!alive.current) return;
        if (halt.current && i < list.length - 1) {
          setStopped(list.length - i - 1);
          return;
        }
        // Un token rechazado o una conexión mal puesta fallarían igual en los demás: se para ahí.
        if (failed && ["token", "config", "apagado", "permiso", "migracion"].includes(failed.code) && i < list.length - 1) {
          throw new StepError({ ...failed, detail: `${failed.detail} Quedaron ${list.length - i - 1} sin leer.`.trim() });
        }
      }
    });

  const setCourse = async (c: CourseRow, patch: { selected?: boolean; vis?: "publico" | "sesion" }) => {
    setRowBusy(c.course_id);
    try {
      await courseSet(space, data.id, c.course_id, patch);
      refresh();
    } catch (error) {
      if (alive.current) setResults((prev) => ({ ...prev, [c.course_id]: { fault: faultOf(error) } }));
    } finally {
      if (alive.current) setRowBusy(null);
    }
  };

  /* --- Pintar ---------------------------------------------------------------------------------- */

  const site = probe?.site ?? (data.site.name ? { name: data.site.name, release: data.site.release } : null);
  const functions = probe?.functions ?? data.site.functions ?? null;
  const ready = Boolean(data.url) && data.token.has;
  const connected = ready && Boolean(data.checkedAt);
  const lastSync = courses.reduce<string | null>((latest, c) => (c.synced_at && (!latest || c.synced_at > latest) ? c.synced_at : latest), null);
  const byCategory = new Map<string, CourseRow[]>();
  for (const c of courses) byCategory.set(c.category_name || "Sin categoría", [...(byCategory.get(c.category_name || "Sin categoría") ?? []), c]);

  const state = !ready ? (
    <StatusMark tone="off">Sin conectar</StatusMark>
  ) : !connected ? (
    <StatusMark tone="warn">Sin probar</StatusMark>
  ) : !data.on ? (
    <StatusMark tone="warn">Conexión probada · lectura apagada</StatusMark>
  ) : (
    <StatusMark tone="ok">{`Conectado · probado ${when(data.checkedAt)}`}</StatusMark>
  );

  return (
    <section className="pen-moodle__site" aria-label={`Sitio de Moodle: ${data.name}`}>
      <header className="pis-row">
        <h4 className="pen-moodle__name">{data.name}</h4>
        <small>{state}</small>
      </header>
          {/* --- Conexión ------------------------------------------------------------- */}
          <div className="pen-moodle__conn">
            <form
              className="pen-field"
              onSubmit={(e) => {
                e.preventDefault();
                saveUrl();
              }}
            >
              <span className="pen-field__label">Dirección de Moodle</span>
              <span className="pen-add">
                <input
                  type="url"
                  inputMode="url"
                  value={url}
                  placeholder="https://…"
                  aria-label="Dirección de Moodle"
                  aria-invalid={Boolean(urlBad) || undefined}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    setUrlBad(null);
                  }}
                />
                <button type="submit" className="button-secondary" disabled={Boolean(busy) || url.trim() === data.url}>
                  {busy === "url" ? "Guardando…" : "Guardar dirección"}
                </button>
              </span>
              <small>{urlBad ? <b className="pen-bad">{urlBad}</b> : "La de entrada al sitio, con https. Se guarda al momento, aparte de «Guardar cambios»."}</small>
            </form>

            <div className="pis-key">
              <span className="pis-key__label">
                Token del servicio
                <small>Se escribe una vez y no vuelve a mostrarse: solo sus cuatro últimos caracteres.</small>
              </span>
              {editToken || !data.token.has ? (
                <form
                  className="pis-key__form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!token.trim()) return;
                    void act("token", "No se guardó el token", async () => {
                      await saveMoodleToken(space, data.id, token);
                      if (alive.current) {
                        setToken("");
                        setEditToken(false);
                      }
                    });
                  }}
                >
                  <input type="password" autoComplete="off" spellCheck={false} value={token} placeholder="Pegue aquí el token" aria-label="Token del servicio de Moodle" onChange={(e) => setToken(e.target.value)} />
                  <button type="submit" className="button-primary" disabled={!token.trim() || Boolean(busy)}>
                    {busy === "token" ? "Guardando…" : "Guardar token"}
                  </button>
                  {data.token.has && (
                    <button type="button" className="button-secondary" onClick={() => (setEditToken(false), setToken(""))}>
                      Cancelar
                    </button>
                  )}
                </form>
              ) : (
                <div className="pis-key__saved">
                  <Icon name="lock" size={17} />
                  <span>
                    Guardado en el servidor · termina en <b>••••{data.token.last4}</b>
                  </span>
                  <button type="button" className="button-secondary" onClick={() => setEditToken(true)}>
                    Cambiar token
                  </button>
                  <button type="button" className="pis-link pis-link--danger" disabled={Boolean(busy)} onClick={() => void act("token", "No se quitó el token", async () => void (await saveMoodleToken(space, data.id, "")))}>
                    Quitar
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="pis-actions">
            <button type="button" className="button-primary" onClick={() => void test()} disabled={!ready || Boolean(busy)}>
              {busy === "probe" ? "Probando…" : "Probar conexión"}
            </button>
            <span className="pen-doc__switch">
              <Switch
                on={data.on}
                disabled={Boolean(busy) || (!data.on && !data.url)}
                onChange={(on) => void act("url", "No se cambió la lectura de Moodle", async () => void (await saveMoodleSite(space, data.id, { enabled: on })))}
                label={`Leer cursos de ${data.name}`}
              />
              {data.on ? "Lectura encendida" : "Lectura apagada"}
            </span>
            {!ready && <span className="pis-small">Guarde la dirección y el token para probar.</span>}
          </div>
          <p className="pis-small">Encendido, este sitio también es uno de los que la app ofrece en «Mis clases», donde cada persona entra con su propia cuenta de Moodle.</p>

          {stopped > 0 && !busy && <p className="pis-small">Se detuvo: {plural(stopped, "curso quedó", "cursos quedaron")} sin leer. Lo leído queda guardado; vuelva a sincronizar cuando quiera.</p>}
          {fault && <FaultNote fault={fault.fault} lead={fault.where} onRetry={fault.fault.retry ? fault.retry : undefined} busy={Boolean(busy)} />}

          {site && functions && (
            <div className="pen-moodle__probe">
              <p className="pis-small">
                <b>{site.name || "El sitio"}</b>
                {site.release ? ` · Moodle ${site.release}` : ""}
                {probe?.ms ? ` · respondió en ${probe.ms.toLocaleString("es-CO")} ms` : data.checkedAt ? ` · probado ${when(data.checkedAt)}` : ""}. Esto es lo que el token puede leer de verdad:
              </p>
              <ul className="pis-findings" aria-label="Funciones de lectura">
                {MOODLE_ALLOWED.map((fn) => (
                  <li key={fn}>
                    <StatusMark tone={functions[fn] ? "ok" : CORE.has(fn) ? "fail" : "warn"}>
                      <code>{fn}</code>
                    </StatusMark>
                    <small>
                      {functions[fn] ? "Puede usarla. " : CORE.has(fn) ? "No puede usarla y hace falta: agréguela al servicio. " : "No puede usarla: ese tipo de actividad se leerá solo por nombre y descripción. "}
                      {FN_USE[fn]}
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* --- Elegir ------------------------------------------------------------------ */}
          <div className="pen-moodle__pick">
            <div className="pis-row">
              <p className="pis-note">
                <b>Qué puede leer Pilo.</b> Traiga las categorías, abra una para anotar sus cursos y marque los que Pilo puede leer. «Público» deja usar ese curso con cualquier
                visitante; si no, solo con sesión iniciada. Soltar un curso oculta sus pasajes sin borrarlos.
              </p>
              <button type="button" className="button-secondary" onClick={() => void loadCats()} disabled={!ready || !data.on || Boolean(busy)}>
                {busy === "cats" ? "Leyendo…" : cats ? "Volver a traer las categorías" : "Traer las categorías"}
              </button>
            </div>
            {!data.on && ready && <p className="pis-small">Encienda la lectura para traer categorías y cursos.</p>}

            {cats && cats.length === 0 && <p className="pis-small">Moodle no devolvió ninguna categoría visible para este token.</p>}
            {cats && cats.length > 0 && (
              <ul className="pen-cats" aria-label="Categorías de Moodle">
                {cats.map((c) => (
                  <li key={c.id} style={{ paddingLeft: `${Math.max(0, Math.min(4, (c.depth || 1) - 1)) * 20}px` }}>
                    <span>
                      <strong>{c.name}</strong>
                      <small>{plural(c.courses ?? 0, "curso", "cursos")}</small>
                    </span>
                    <button type="button" className="button-secondary pen-refresh" onClick={() => void loadCourses(c)} disabled={Boolean(busy)}>
                      {busy === `cat:${c.id}` ? "Anotando…" : "Anotar sus cursos"}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* --- Los cursos -------------------------------------------------------------- */}
          {courses.length === 0 ? (
            <p className="pis-small">Todavía no hay cursos anotados.</p>
          ) : (
            <>
              <div className="pis-row">
                <p className="pis-small">
                  {plural(courses.length, "curso anotado", "cursos anotados")} · {plural(chosen.length, "elegido", "elegidos")}
                  {lastSync ? ` · última lectura ${when(lastSync)}` : " · ninguno leído todavía"}. La lectura se pide desde aquí: no hay sincronización automática.
                </p>
                <button type="button" className="button-primary" onClick={() => void sync(chosen)} disabled={!data.on || !ready || Boolean(busy) || chosen.length === 0}>
                  {busy === "sync" ? "Sincronizando…" : `Sincronizar ${chosen.length === 1 ? "el elegido" : `los ${chosen.length} elegidos`}`}
                </button>
              </div>
              <ul className="pen-docs" ref={list}>
                {[...byCategory].map(([category, items]) => (
                  <li key={category} className="pen-cat">
                    <h5>{category}</h5>
                    <ul>
                      {items.map((c) => {
                        const doc = c.doc_id ? docById.get(c.doc_id) ?? null : null;
                        const res = results[c.course_id];
                        const running = syncing === c.course_id;
                        const lock = rowBusy === c.course_id || Boolean(busy);
                        return (
                          <li key={c.course_id} className="pen-doc" data-off={!c.selected || undefined}>
                            <header>
                              <button
                                type="button"
                                className="pis-check"
                                aria-pressed={c.selected}
                                aria-label={`${c.selected ? "Soltar" : "Elegir"} el curso ${c.fullname}`}
                                disabled={lock}
                                onClick={() => void setCourse(c, { selected: !c.selected })}
                              >
                                <Icon name="check" size={14} />
                              </button>
                              <b>{c.fullname || c.shortname}</b>
                              <small>
                                {c.shortname}
                                {doc ? ` · ${plural(doc.passages, "pasaje", "pasajes")}` : ""}
                                {c.synced_at ? ` · leído ${when(c.synced_at)}` : " · sin leer"}
                                {c.status && COURSE_STATUS[c.status] ? ` · ${COURSE_STATUS[c.status]}` : ""}
                                {c.selected ? "" : " · sin elegir: Pilo no lo usa"}
                              </small>
                            </header>
                            {(doc || running) && <Stages stages={stagesOf(doc, running ? { step: "pasajes", state: "run" } : res && "fault" in res ? { step: "pasajes", state: "fail" } : null)} label={c.fullname} />}
                            {res && "fault" in res ? (
                              <FaultNote fault={res.fault} lead="No se leyó el curso" onRetry={res.fault.retry ? () => void sync([c]) : undefined} busy={Boolean(busy)} />
                            ) : res ? (
                              <p className={res.tone === "ok" ? "pen-ok" : "pis-warn"} role="status">
                                {res.tone === "ok" && <Icon name="check" size={14} />} {res.text}
                              </p>
                            ) : c.status === "error" && c.error ? (
                              <p className="pis-warn">La última lectura falló: {c.error}</p>
                            ) : null}
                            <div className="pen-doc__controls">
                              <VisSeg value={c.vis} label={c.fullname} disabled={lock} onChange={(vis) => void setCourse(c, { vis })} />
                              <button type="button" className="button-secondary pen-refresh" onClick={() => void sync([c])} disabled={!data.on || !ready || Boolean(busy)}>
                                {running ? "Leyendo…" : c.synced_at ? "Volver a leer" : "Leer ahora"}
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </>
          )}

          {/* --- Quitar el sitio ------------------------------------------------------------ */}
          <div className="pis-row pen-moodle__remove">
            <p className="pis-small">
              Quitar {several ? `«${data.name}»` : "este sitio"} borra su token, sus cursos anotados y lo que Pilo leyó de ellos. Quien lo tenga conectado en «Mis clases» tendrá que conectar de nuevo.
            </p>
            {confirmDel ? (
              <span className="pis-actions">
                <button type="button" className="button-secondary pen-refresh" disabled={Boolean(busy)} onClick={() => setConfirmDel(false)}>
                  Cancelar
                </button>
                <button type="button" className="pis-link pis-link--danger" disabled={Boolean(busy)} onClick={() => void remove()}>
                  {busy === "del" ? "Quitando…" : `Sí, quitar «${data.name}»`}
                </button>
              </span>
            ) : (
              <button type="button" className="pis-link pis-link--danger" disabled={Boolean(busy)} onClick={() => setConfirmDel(true)}>
                Quitar este sitio
              </button>
            )}
          </div>
    </section>
  );
}

/* --- La guía ------------------------------------------------------------------------------------ */

function MoodleGuide() {
  return (
    <details className="pen-guide">
      <summary>
        <Icon name="chevron-down" size={16} />
        Cómo se conecta Moodle: qué lee Pilo y los pasos
      </summary>

      <div className="pen-yesno">
        <div>
          <h5>Lo que Pilo lee</h5>
          <ul>
            <li>
              <Icon name="check" size={14} /> Las categorías y los cursos que la oficina elija.
            </li>
            <li>
              <Icon name="check" size={14} /> El nombre y el resumen del curso y de cada sección.
            </li>
            <li>
              <Icon name="check" size={14} /> De cada actividad, su nombre y su descripción; de las páginas, su contenido. De un foro o una tarea, solo nombre y descripción.
            </li>
          </ul>
        </div>
        <div data-no>
          <h5>Lo que Pilo nunca lee</h5>
          <ul>
            <li>
              <Icon name="close" size={14} /> Matrícula, participantes o perfiles.
            </li>
            <li>
              <Icon name="close" size={14} /> Notas, entregas o intentos.
            </li>
            <li>
              <Icon name="close" size={14} /> Mensajes, publicaciones de foro, archivos ni fechas.
            </li>
            <li>
              <Icon name="close" size={14} /> Lo que el curso tiene oculto.
            </li>
          </ul>
        </div>
      </div>
      <p className="pis-note">
        <b>Quién ve lo que viene de Moodle.</b> El contenido de un curso se ofrece solo a quien inició sesión, salvo que la oficina marque ese curso como público. La función de Pilo
        solo puede llamar a las funciones de lectura de la lista de abajo: cualquier otra se rechaza antes de salir.
      </p>

      <h5 className="pen-guide__title">En Moodle</h5>
      <p className="pis-small">
        Lo hace quien administra el sitio. Los nombres y las rutas de los menús cambian según la versión de Moodle: tome estos pasos como una orientación y confirme cada uno en su
        sitio. Los nombres del usuario y del servicio los decide quien administra Moodle.
      </p>
      <ol className="pen-mg">
        <li>
          <h6>Habilite los servicios web y el protocolo REST</h6>
          <p>Están en la administración del sitio (servicios web o características avanzadas, según la versión). REST es el único protocolo que usa Pilo.</p>
        </li>
        <li>
          <h6>Cree un usuario solo para Pilo, con un rol de solo lectura</h6>
          <p>Un usuario dedicado con un rol que le permita usar los servicios web por REST y ver los cursos y sus actividades, sin acceso a participantes, calificaciones ni mensajes. Asígnelo donde Pilo pueda leer, no como profesor ni como estudiante.</p>
        </li>
        <li>
          <h6>Cree un servicio externo con las funciones de lectura</h6>
          <p>Restringido a usuarios autorizados, con el usuario del paso anterior y solo estas funciones:</p>
          <ul className="pen-fnlist">
            {MOODLE_ALLOWED.map((fn) => (
              <li key={fn}>
                <code>{fn}</code>
                <span>
                  {FN_USE[fn]}
                  {CORE.has(fn) || fn === "mod_page_get_pages_by_courses" ? "" : " Por confirmar en su versión."}
                </span>
              </li>
            ))}
          </ul>
          <p>Si alguna no existe en su versión, omítala: «Probar conexión» dirá cuáles puede usar el token y Pilo leerá con las que haya.</p>
        </li>
        <li>
          <h6>Genere un token para ese usuario y ese servicio</h6>
          <p>Si su Moodle lo permite, limítelo y póngale fecha de vencimiento; al vencer, se genera otro y se pega aquí.</p>
        </li>
      </ol>

      <h5 className="pen-guide__title">En la intranet</h5>
      <ol className="pen-mg" style={{ counterReset: "mg 4" }}>
        <li>
          <h6>Agregue el sitio, guarde su dirección y su token, y pruebe la conexión</h6>
          <p>Cada Moodle de la universidad es un sitio aparte, con su propio token: repita los pasos de arriba en cada uno. La dirección es la de entrada al sitio, con https. «Probar conexión» funciona con la lectura apagada y muestra qué funciones puede usar el token.</p>
        </li>
        <li>
          <h6>Encienda la lectura, elija los cursos y sincronice</h6>
          <p>Traiga las categorías, anote los cursos de las que le interesen, marque los que Pilo puede leer y quién los ve, y pulse «Sincronizar». Cada curso se lee en un pedido aparte.</p>
        </li>
      </ol>
    </details>
  );
}
