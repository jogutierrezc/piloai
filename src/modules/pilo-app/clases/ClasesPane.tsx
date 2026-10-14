/* =============================================================================
   Mr. Pilo · Mis clases (beta) · /app/clases.

   Un estudiante o un profesor con cuenta de Pilo conecta su Moodle y Pilo le
   muestra sus cursos, sus actividades y materiales, y las fechas de entrega,
   para crearle recordatorios. Solo lectura: Pilo no entrega, no escribe ni
   presenta nada.

   Los pasos:
     1. La autorización amistosa (DataConsent, de terms/): sin la casilla, no
        se consulta nada. La segunda casilla decide si el permiso queda en
        este dispositivo o solo mientras la pestaña esté abierta.
     2. El usuario y la contraseña de Moodle: se usan una vez para pedir el
        permiso de lectura y no se guardan. La universidad tiene varios
        Moodle: si la administración ofrece más de uno, aquí se elige cuál
        (sin elegir no se conecta); con uno solo, no se pregunta nada. La
        conexión es a un Moodle a la vez: para pasar a otro, se desconecta y
        se conecta de nuevo.
     3. Conectado: las próximas entregas por fecha, con su curso, y los
        cursos. De cada entrega (y de todas las de un curso) sale un archivo
        de calendario armado aquí mismo, o la lista de fechas para copiar.
        «Preguntarle a Pilo» deja escrita una pregunta con los títulos (nunca
        con contenidos de Moodle) en la conversación de Enseñanza.

   Otros estados: el permiso venció o su Moodle ya no se ofrece (se borra y
   se pide conectar de nuevo), Mis clases aún no está disponible, y sin
   conexión.

   Los cursos y las fechas viven en la memoria de esta pantalla: no se guardan
   en el dispositivo ni en el servidor. El permiso, donde diga logic.ts.

   Movimiento: la lista entra una vez al conectar con el dedo o el ratón
   (nunca con el teclado, ni con movimiento reducido), solo con transform y
   opacidad; GSAP pone y quita el estado oculto, así que si se interrumpe no
   queda texto escondido.
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import gsap from "gsap";
import { Pilo } from "../../pregunta/Pilo";
import type { PiloMojiHandle } from "../../pregunta/Pilo";
import { APP_ACCOUNT, APP_LOGIN, APP_PATHS } from "../routes";
import { Icon } from "../icons";
import { fromKeyboard, reducedMotion } from "../pwa";
import type { AccountState } from "../account/useAccount";
import { Field, Msg } from "../account/parts";
import { DataConsent } from "../terms/DataConsent";
import { asFailure, connectMoodle, loadAgenda, loadCourse, loadSites } from "./api";
import { buildIcs, icsFileName } from "./ics";
import { askAbout, canUseClases, clearLink, courseDeliveries, courseLine, datesText, dueIn, dueLabel, failureOf, groupDeliveries, groupOf, kindLabel, readLink, saveLink } from "./logic";
import type { Agenda, ClasesFailure, Course, CourseDetail, Delivery, Link as MoodleLink, SiteRef } from "./logic";
import "./clases.css";

type Note = { tone: "ok" | "bad" | "info"; text: string };

/** Lo que Pilo promete, dicho otra vez al pie (el diseño aprobado). */
const PROMISES = [
  "Pilo solo lee: no entrega tareas, no escribe en foros, no presenta exámenes ni cambia nada en Moodle.",
  "Lo que ve en sus cursos es solo para usted: no entra a la memoria de Pilo ni lo ve otra persona.",
  "Puede desconectarlo cuando quiera; al hacerlo se borra el permiso de este dispositivo.",
];

export function ClasesPane({ state, online }: { state: AccountState; online: boolean }) {
  const { account, pending } = state;

  if (pending) {
    return (
      <p className="pc-wait" role="status">
        Pilo está revisando su cuenta…
      </p>
    );
  }

  if (!account || !canUseClases(account)) {
    return (
      <section className="pc-sheet">
        <div className="pc-sheet__in">
          <p>
            {account
              ? account.status !== "activa"
                ? "Su cuenta de Pilo está suspendida. Escriba a la administración."
                : "Mis clases es para estudiantes y profesores: conecta a Pilo con sus cursos de Moodle."
              : "Mis clases es para estudiantes y profesores con cuenta de Pilo: conecta a Pilo con sus cursos de Moodle para recordarle sus entregas."}
          </p>
          {!account && (
            <div className="pc-actions">
              <Link className="pa-btn pa-btn--line" to={APP_LOGIN}>
                Entrar
              </Link>
              <Link className="pa-btn pa-btn--main" to={APP_ACCOUNT}>
                Crear una cuenta
              </Link>
            </div>
          )}
        </div>
      </section>
    );
  }

  // Otra cuenta en el mismo dispositivo empieza de cero.
  return <Clases key={account.id} owner={account.id} online={online} />;
}

function Clases({ owner, online }: { owner: string; online: boolean }) {
  const navigate = useNavigate();
  const [link, setLink] = useState<MoodleLink | null>(() => readLink(owner));
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [loading, setLoading] = useState(false);
  /** Mis clases no se puede usar todavía: el porqué. */
  const [off, setOff] = useState<string | null>(null);
  /** Un fallo que se dice donde esté la persona, con «Reintentar». */
  const [trouble, setTrouble] = useState<ClasesFailure | null>(null);
  /** El permiso se borró y hay que conectar de nuevo: el porqué. */
  const [expired, setExpired] = useState<string | null>(null);
  const [note, setNote] = useState<Note | null>(null);

  // El paso 1 (autorizar) y el paso 2 (cuál Moodle, si hay varios, y su usuario y contraseña).
  const [granted, setGranted] = useState<{ keep: boolean } | null>(null);
  /** Los Moodle entre los que se elige; null mientras no se han leído. */
  const [sites, setSites] = useState<SiteRef[] | null>(null);
  const [siteId, setSiteId] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [errors, setErrors] = useState<{ site?: string; user?: string; pass?: string }>({});
  const [connecting, setConnecting] = useState(false);

  const [openCourse, setOpenCourse] = useState<number | null>(null);
  const [details, setDetails] = useState<Record<number, CourseDetail | ClasesFailure | "cargando">>({});
  const [showEnded, setShowEnded] = useState(false);

  const root = useRef<HTMLDivElement>(null);
  const face = useRef<PiloMojiHandle>(null);
  const focusTo = useRef<"paso" | "entregas" | "inicio" | "clave" | null>(null);
  const stepHead = useRef<HTMLHeadingElement>(null);
  const dueHead = useRef<HTMLHeadingElement>(null);
  const startHead = useRef<HTMLDivElement>(null);
  /** La lista entra animada solo si se conectó con el dedo o el ratón. */
  const animateNext = useRef(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => request.current?.abort(), []);

  /** Un fallo de la función, llevado al estado que le toca. */
  const fail = useCallback((failure: ClasesFailure, where: "conectar" | "leer") => {
    // No hubo entregas que enfocar.
    if (focusTo.current === "entregas") focusTo.current = null;
    if (failure.view === "vencido") {
      clearLink();
      setLink(null);
      setAgenda(null);
      setGranted(null);
      setSites(null);
      setSiteId("");
      setExpired(
        failure.code !== "sitio"
          ? "Su permiso de Moodle venció o fue retirado, y ya se borró de este dispositivo. Para seguir, autorice y conecte de nuevo."
          : where === "conectar"
            ? "Ese Moodle ya no está disponible en Pilo. Autorice de nuevo y elija su Moodle."
            : "Su conexión con Moodle ya no sirve: ese Moodle ya no está disponible en Pilo, o ahora hay que elegir entre varios. El permiso ya se borró de este dispositivo. Para seguir, autorice y conecte de nuevo.",
      );
      setNote(null);
      focusTo.current = "inicio";
      return;
    }
    if (failure.view === "no_disponible") {
      setOff(failure.message);
      focusTo.current = "inicio";
      return;
    }
    if (failure.view === "campo" && where === "conectar") {
      setErrors({ pass: failure.message });
      // El campo aún está deshabilitado: el foco llega cuando vuelva a estar disponible.
      focusTo.current = "clave";
      return;
    }
    setTrouble(failure);
  }, []);

  /** Los Moodle que ofrece la administración: se leen al autorizar, antes de pedir el usuario y la contraseña. */
  const fetchSites = useCallback(async () => {
    request.current?.abort();
    const ctl = new AbortController();
    request.current = ctl;
    setSites(null);
    setSiteId("");
    setTrouble(null);
    try {
      const next = await loadSites(ctl.signal);
      if (ctl.signal.aborted) return;
      if (next.length === 0) return fail(failureOf("no_disponible"), "leer");
      setSites(next);
      // Con uno solo no hay nada que elegir.
      setSiteId(next.length === 1 ? next[0].id : "");
    } catch (error) {
      if (ctl.signal.aborted) return;
      fail(asFailure(error), "leer");
    }
  }, [fail]);

  const fetchAgenda = useCallback(
    async (token: string, site: string | undefined) => {
      request.current?.abort();
      const ctl = new AbortController();
      request.current = ctl;
      setLoading(true);
      setTrouble(null);
      try {
        const next = await loadAgenda(token, site, ctl.signal);
        if (ctl.signal.aborted) return;
        setNow(Date.now());
        setAgenda(next);
        setOff(null);
      } catch (error) {
        if (ctl.signal.aborted) return;
        fail(asFailure(error), "leer");
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    },
    [fail],
  );

  // Con un permiso ya en el dispositivo (o en la memoria de la pestaña), se leen las clases al entrar.
  const token = link?.token;
  /** El Moodle del permiso; uno guardado antes de que hubiera varios no lo dice. */
  const linkSite = link?.moodle?.id;
  useEffect(() => {
    if (token && online) void fetchAgenda(token, linkSite);
  }, [token, linkSite, online, fetchAgenda]);

  // El foco sigue al estado: al paso nuevo, a las entregas recién leídas, o al comienzo si hubo que volver.
  useEffect(() => {
    const where = focusTo.current;
    if (!where) return;
    const el = where === "paso" ? stepHead.current : where === "entregas" ? dueHead.current : where === "clave" ? document.getElementById("pcl-pass") : startHead.current;
    if (!el || (el as HTMLInputElement).disabled) return;
    focusTo.current = null;
    el.focus({ preventScroll: false });
  });

  // Las filas entran una vez, al conectar. GSAP pone y quita el estado oculto: interrumpido, queda todo a la vista.
  useLayoutEffect(() => {
    if (!agenda || !animateNext.current) return;
    animateNext.current = false;
    if (reducedMotion() || !root.current) return;
    const ctx = gsap.context(() => {
      const rows = gsap.utils.toArray<HTMLElement>("[data-in]").slice(0, 7);
      if (rows.length) gsap.fromTo(rows, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.24, stagger: 0.035, ease: "expo.out", clearProps: "opacity,transform" });
    }, root);
    return () => ctx.revert();
  }, [agenda]);

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (connecting || !granted || !sites) return;
    const chosen = sites.find((s) => s.id === siteId);
    const problems = { site: chosen ? undefined : "Elija su Moodle.", user: user.trim() ? undefined : "Escriba su usuario de Moodle.", pass: pass ? undefined : "Escriba su contraseña de Moodle." };
    setErrors(problems);
    if (!chosen || problems.user || problems.pass) {
      animateNext.current = false;
      document.getElementById(problems.site ? "pcl-site" : problems.user ? "pcl-user" : "pcl-pass")?.focus();
      return;
    }
    setConnecting(true);
    setTrouble(null);
    setNote(null);
    try {
      const out = await connectMoodle(chosen.id, user, pass);
      const name = sites.find((s) => s.id === out.siteId)?.name ?? chosen.name;
      const saved = saveLink(owner, { token: out.token, site: out.site, moodle: { id: out.siteId, name, chosen: sites.length > 1 } }, granted.keep);
      // La contraseña ya cumplió: no queda ni en el formulario.
      setPass("");
      setExpired(null);
      setLink(saved);
      setNote({
        tone: "ok",
        text: saved.kept
          ? "Conectado. La conexión queda guardada solo en este dispositivo."
          : granted.keep
            ? "Conectado. No se pudo guardar en este dispositivo: la conexión dura mientras esta pestaña esté abierta."
            : "Conectado solo por esta vez: al cerrar la pestaña, no queda nada guardado.",
      });
      focusTo.current = "entregas";
      if (animateNext.current) face.current?.nod();
    } catch (error) {
      animateNext.current = false;
      fail(asFailure(error), "conectar");
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = () => {
    request.current?.abort();
    clearLink();
    setLink(null);
    setAgenda(null);
    setGranted(null);
    setDetails({});
    setOpenCourse(null);
    setLoading(false);
    setTrouble(null);
    setOff(null);
    setExpired(null);
    setSites(null);
    setSiteId("");
    setErrors({});
    setUser("");
    setPass("");
    setNote({ tone: "ok", text: "Se desconectó y se borró el permiso de este dispositivo." });
    focusTo.current = "inicio";
  };

  /* --- Recordatorios: todo ocurre en el navegador --------------------------------------------- */

  const host = useMemo(() => {
    try {
      return new URL(agenda?.courses[0]?.url || "https://moodle.invalid").hostname;
    } catch {
      return "moodle";
    }
  }, [agenda]);

  const toCalendar = (entries: Delivery[], label: string) => {
    if (!entries.length) return;
    try {
      const blob = new Blob([buildIcs(entries, { now: Date.now(), host })], { type: "text/calendar;charset=utf-8" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = icsFileName(label);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 15_000);
      setNote({ tone: "ok", text: `Se descargó el recordatorio${entries.length === 1 ? "" : ` con ${entries.length} entregas`}: ábralo para agregarlo a su calendario. Le avisará el día anterior.` });
    } catch {
      setNote({ tone: "bad", text: "No se pudo crear el archivo de calendario en este navegador. Copie las fechas." });
    }
  };

  const copyDates = async (entries: Delivery[]) => {
    try {
      await navigator.clipboard.writeText(datesText(entries, now));
      setNote({ tone: "ok", text: "Fechas copiadas: péguelas en su agenda o en un mensaje." });
    } catch {
      setNote({ tone: "bad", text: "No se pudo copiar en este navegador." });
    }
  };

  /** Deja la pregunta escrita en la conversación de Enseñanza: solo títulos. */
  const ask = (course: string, activity = "") => navigate(APP_PATHS.ensenanza, { state: { nueva: true, pregunta: askAbout(course, activity) } });

  const toggleCourse = (course: Course) => {
    if (openCourse === course.id) return setOpenCourse(null);
    setOpenCourse(course.id);
    const have = details[course.id];
    if (!link || (have && have !== "cargando" && "sections" in have)) return;
    setDetails((d) => ({ ...d, [course.id]: "cargando" }));
    loadCourse(link.token, link.moodle?.id, course.id).then(
      (detail) => setDetails((d) => ({ ...d, [course.id]: detail })),
      (error) => {
        const failure = asFailure(error);
        if (failure.view === "vencido") return fail(failure, "leer");
        setDetails((d) => ({ ...d, [course.id]: failure }));
      },
    );
  };

  /* --- Lo que se ve --------------------------------------------------------------------------- */

  const upcoming = useMemo(() => (agenda ? agenda.deliveries.filter((d) => d.due * 1000 >= now) : []), [agenda, now]);
  const groups = useMemo(() => (agenda ? groupDeliveries(agenda.deliveries, now) : []), [agenda, now]);
  const current = agenda ? agenda.courses.filter((c) => !c.ended) : [];
  const ended = agenda ? agenda.courses.filter((c) => c.ended) : [];
  const busy = connecting || loading;

  const live = (
    <div className="pc-live" aria-live="polite">
      {note && <Msg tone={note.tone}>{note.text}</Msg>}
    </div>
  );

  const offline = !online && (
    <section className="pcl-card pcl-card--note" role="status">
      <div className="pcl-face">
        <Pilo size="100%" emotion="obra" alive label="Mr. Pilo, en obra" />
      </div>
      <div>
        <h2>Estoy sin conexión</h2>
        <p>Necesito internet para leer sus clases en Moodle. {agenda ? "Lo que ve aquí es lo último que leí." : "Cuando vuelva la conexión, seguimos."}</p>
      </div>
    </section>
  );

  const retry = trouble && (
    <div className="pc-confirm" role="alert">
      <span>{trouble.message}</span>
      {trouble.view === "cuenta" ? (
        <Link className="pc-chip" data-strong to={APP_LOGIN}>
          Entrar con mi cuenta de Pilo
        </Link>
      ) : link ? (
        <button type="button" className="pc-chip" data-strong disabled={!online || loading} onClick={() => void fetchAgenda(link.token, link.moodle?.id)}>
          Reintentar
        </button>
      ) : (
        // Sin la lista de los Moodle no se puede conectar: se vuelve a pedir.
        granted &&
        !sites && (
          <button type="button" className="pc-chip" data-strong disabled={!online} onClick={() => void fetchSites()}>
            Reintentar
          </button>
        )
      )}
    </div>
  );

  /** «Intentar de nuevo» cuando Mis clases no está disponible: las clases, o la lista de los Moodle. */
  const retryOff = () => {
    setOff(null);
    if (link) void fetchAgenda(link.token, link.moodle?.id);
    else if (granted) void fetchSites();
  };

  /* Mis clases aún no está disponible. */
  if (off) {
    return (
      <div className="pcl" ref={root}>
        <div ref={startHead} tabIndex={-1} className="pcl-start">
          <section className="pcl-card pcl-card--note">
            <div className="pcl-face">
              <Pilo size="100%" mood="duda" alive label="Mr. Pilo" />
            </div>
            <div>
              <h2>Mis clases aún no está disponible</h2>
              <p>{off}</p>
              <p className="pc-hint">No es algo que usted deba arreglar: depende de la administración de Moodle y de Pilo.</p>
              <div className="pcl-tools">
                <button type="button" className="pc-chip" data-strong disabled={!online} onClick={retryOff}>
                  Intentar de nuevo
                </button>
                {link && (
                  <button type="button" className="pc-chip" onClick={disconnect}>
                    Desconectar
                  </button>
                )}
              </div>
            </div>
          </section>
        </div>
        {live}
      </div>
    );
  }

  /* Sin conectar: autorizar y, después, el usuario y la contraseña de Moodle. */
  if (!link) {
    return (
      <div className="pcl" ref={root}>
        <div ref={startHead} tabIndex={-1} className="pcl-start">
          {expired && (
            <div className="pc-confirm" role="alert">
              <span>{expired}</span>
            </div>
          )}
          {offline}
          {!granted ? (
            <DataConsent
              platform="moodle"
              className="pcl-consent"
              onAuthorize={({ keep }) => {
                setGranted({ keep });
                setNote(null);
                setErrors({});
                focusTo.current = "paso";
                void fetchSites();
              }}
            />
          ) : (
            <section className="pcl-card" aria-labelledby="pcl-paso-h">
              <header className="pcl-card__head">
                <div className="pcl-face">
                  <Pilo ref={face} size="100%" mood={connecting ? "piensa" : "feliz"} alive label="Mr. Pilo" />
                </div>
                <div>
                  <h2 id="pcl-paso-h" ref={stepHead} tabIndex={-1}>
                    Entre a su Moodle
                  </h2>
                  <p>Con su usuario y su contraseña de Moodle le pido a Moodle un permiso de solo lectura.</p>
                </div>
              </header>
              <form className="pcl-card__body" onSubmit={(e) => void connect(e)} noValidate>
                <p className="pcl-granted">
                  {Icon.check}
                  <span>
                    Autorizó a Pilo a consultar sus cursos. {granted.keep ? "La conexión quedará guardada solo en este dispositivo." : "Solo por esta vez: al cerrar la pestaña, no queda nada guardado."}
                  </span>
                </p>
                {sites && sites.length > 1 && (
                  <Field id="pcl-site" label="Su Moodle" hint="La universidad tiene varios Moodle: elija el de sus clases. Pilo se conecta a uno a la vez; para pasar a otro, desconecte y conecte de nuevo." error={errors.site}>
                    {(aria) => (
                      <select
                        {...aria}
                        name="moodle-sitio"
                        required
                        value={siteId}
                        disabled={connecting}
                        onChange={(e) => {
                          setSiteId(e.target.value);
                          if (errors.site) setErrors((x) => ({ ...x, site: undefined }));
                        }}
                      >
                        {!siteId && <option value="">Elija su Moodle</option>}
                        {sites.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                )}
                <Field id="pcl-user" label="Usuario de Moodle" error={errors.user}>
                  {(aria) => (
                    <input
                      {...aria}
                      type="text"
                      name="moodle-usuario"
                      autoComplete="off"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={100}
                      value={user}
                      disabled={connecting}
                      onChange={(e) => {
                        setUser(e.target.value);
                        if (errors.user) setErrors((x) => ({ ...x, user: undefined }));
                      }}
                    />
                  )}
                </Field>
                <Field id="pcl-pass" label="Contraseña de Moodle" hint="Se usa una sola vez para pedirle el permiso a Moodle y no se guarda: ni aquí ni en el servidor." error={errors.pass}>
                  {(aria) => (
                    <input
                      {...aria}
                      type="password"
                      name="moodle-clave"
                      autoComplete="off"
                      maxLength={200}
                      value={pass}
                      disabled={connecting}
                      onChange={(e) => {
                        setPass(e.target.value);
                        if (errors.pass) setErrors((x) => ({ ...x, pass: undefined }));
                      }}
                    />
                  )}
                </Field>
                {retry}
                <div className="pcl-row">
                  <button
                    type="submit"
                    className="pa-btn pa-btn--main"
                    disabled={connecting || !online || !sites}
                    onClick={(e) => {
                      // Con Enter o con el teclado, la lista aparece en su sitio, sin recorrido.
                      animateNext.current = !fromKeyboard(e);
                    }}
                  >
                    {connecting ? "Conectando…" : "Conectar con Moodle"}
                  </button>
                  <button
                    type="button"
                    className="pc-quiet"
                    disabled={connecting}
                    onClick={() => {
                      setGranted(null);
                      setPass("");
                      setErrors({});
                      focusTo.current = "inicio";
                    }}
                  >
                    Volver a la autorización
                  </button>
                </div>
                <div className="pa-sr" role="status">
                  {connecting ? "Pilo está pidiendo el permiso a Moodle." : !sites && !trouble ? "Pilo está preparando la conexión con Moodle." : ""}
                </div>
              </form>
            </section>
          )}
        </div>
        {live}
        <ul className="pc-hint pcl-notes">
          {PROMISES.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    );
  }

  /* Conectado. */
  const delivery = (d: Delivery) => {
    const past = groupOf(d.due, now) === "vencidas";
    const kind = kindLabel(d.kind);
    return (
      <li key={d.id} data-in>
        <div className="pcl-item__main">
          <strong>{d.title}</strong>
          <small>{[d.courseName, kind].filter(Boolean).join(" · ")}</small>
          <span className="pcl-when" data-past={past || undefined}>
            {dueLabel(d.due, now)} · {dueIn(d.due, now)}
          </span>
        </div>
        <div className="pcl-tools">
          {!past && (
            <button type="button" className="pc-chip" onClick={() => toCalendar([d], d.title)} aria-label={`Agregar a mi calendario: ${d.title}`}>
              Agregar a mi calendario
            </button>
          )}
          <button type="button" className="pc-chip" onClick={() => ask(d.courseName, d.title)} aria-label={`Preguntarle a Pilo sobre ${d.title}`}>
            Preguntarle a Pilo
          </button>
          {d.url && (
            <a className="pc-chip" href={d.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir en Moodle: ${d.title}`}>
              Abrir en Moodle
            </a>
          )}
        </div>
      </li>
    );
  };

  const course = (c: Course) => {
    const mine = courseDeliveries(agenda?.deliveries ?? [], c.id, now);
    const isOpen = openCourse === c.id;
    const detail = details[c.id];
    return (
      <li key={c.id} data-in>
        <div className="pcl-item__main">
          <strong>{c.name}</strong>
          <small>{c.ended ? "Curso terminado" : courseLine(agenda?.deliveries ?? [], c.id, now)}</small>
        </div>
        <div className="pcl-tools">
          <button type="button" className="pc-chip" aria-expanded={isOpen} aria-controls={`pcl-c-${c.id}`} onClick={() => toggleCourse(c)} aria-label={`${isOpen ? "Ocultar" : "Ver"} el curso ${c.name}`}>
            {isOpen ? "Ocultar el curso" : "Ver el curso"}
          </button>
          {mine.length > 0 && (
            <button type="button" className="pc-chip" onClick={() => toCalendar(mine, c.name)} aria-label={`Agregar a mi calendario las entregas de ${c.name}`}>
              Agregar sus entregas
            </button>
          )}
          <button type="button" className="pc-chip" onClick={() => ask(c.name)} aria-label={`Preguntarle a Pilo sobre ${c.name}`}>
            Preguntarle a Pilo
          </button>
          {c.url && (
            <a className="pc-chip" href={c.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir en Moodle: ${c.name}`}>
              Abrir en Moodle
            </a>
          )}
        </div>
        <div id={`pcl-c-${c.id}`} className="pcl-course" hidden={!isOpen}>
          {isOpen && <CourseBody name={c.name} detail={detail} now={now} onAsk={ask} />}
        </div>
      </li>
    );
  };

  return (
    <div className="pcl" ref={root}>
      <div ref={startHead} tabIndex={-1} className="pcl-start">
        {offline}
        <section className="pcl-state" aria-label="Estado de la conexión con Moodle">
          <div className="pcl-state__who">
            <div className="pcl-face pcl-face--sm">
              <Pilo ref={face} size="100%" mood={loading ? "piensa" : "feliz"} alive label="Mr. Pilo" />
            </div>
            <p>
              <span className="pc-tag" data-t="ok">
                {Icon.check}
                Conectado
              </span>
              <b>{[link.site.name || "Moodle", link.site.user].filter(Boolean).join(" · ")}</b>
              {link.moodle?.chosen && link.moodle.name && <small>Está conectado a «{link.moodle.name}». Para cambiar de Moodle, desconecte y conecte al otro.</small>}
              <small>{link.kept ? "La conexión está guardada solo en este dispositivo." : "La conexión dura mientras esta pestaña esté abierta."}</small>
            </p>
          </div>
          <div className="pcl-tools">
            <button type="button" className="pc-chip" disabled={busy || !online} onClick={() => void fetchAgenda(link.token, link.moodle?.id)}>
              {loading && agenda ? "Actualizando…" : "Actualizar"}
            </button>
            <button type="button" className="pc-chip" onClick={disconnect}>
              Desconectar
            </button>
          </div>
        </section>
      </div>

      {live}
      {retry}

      {!agenda ? (
        loading && (
          <p className="pc-wait" role="status">
            Pilo está leyendo sus clases en Moodle…
          </p>
        )
      ) : (
        <>
          <section className="pcl-block" aria-labelledby="pcl-due-h">
            <div className="pcl-block__head">
              <h2 id="pcl-due-h" ref={dueHead} tabIndex={-1}>
                Próximas entregas
              </h2>
              {upcoming.length > 0 && (
                <div className="pcl-tools">
                  <button type="button" className="pc-chip" data-strong onClick={() => toCalendar(upcoming, "mis-clases")}>
                    Agregar todas a mi calendario
                  </button>
                  <button type="button" className="pc-chip" onClick={() => void copyDates(upcoming)}>
                    {Icon.copy}
                    Copiar fechas
                  </button>
                </div>
              )}
            </div>
            {groups.length === 0 ? (
              <p className="pcl-empty">
                {agenda.from === "ninguna"
                  ? "Este Moodle no dejó leer el calendario ni las tareas, así que no puedo mostrarle fechas. Sus cursos sí están abajo."
                  : "No hay entregas con fecha en los próximos tres meses. Cuando sus profesores publiquen una, aparecerá aquí."}
              </p>
            ) : (
              groups.map((g) => (
                <div key={g.id} className="pcl-group">
                  <h3>
                    {g.label} <span>{g.items.length}</span>
                  </h3>
                  <ul className="pcl-list">{g.items.map(delivery)}</ul>
                </div>
              ))
            )}
            {agenda.from === "tareas" && <p className="pc-hint">Este Moodle no dejó leer el calendario: se muestran solo las tareas con fecha de entrega.</p>}
            <p className="pc-hint">Las horas se muestran en la hora de este dispositivo. La fecha que manda es la de Moodle.</p>
          </section>

          <section className="pcl-block" aria-labelledby="pcl-cursos-h">
            <div className="pcl-block__head">
              <h2 id="pcl-cursos-h">Mis cursos</h2>
            </div>
            {current.length === 0 && ended.length === 0 ? (
              <p className="pcl-empty">Moodle no muestra cursos en los que usted esté inscrito.</p>
            ) : (
              <ul className="pcl-list">{current.map(course)}</ul>
            )}
            {ended.length > 0 && (
              <>
                <button type="button" className="pc-quiet" aria-expanded={showEnded} aria-controls="pcl-terminados" onClick={() => setShowEnded((v) => !v)}>
                  {showEnded ? "Ocultar los cursos terminados" : `Ver ${ended.length} ${ended.length === 1 ? "curso terminado" : "cursos terminados"}`}
                </button>
                <ul className="pcl-list" id="pcl-terminados" hidden={!showEnded}>
                  {showEnded && ended.map(course)}
                </ul>
              </>
            )}
          </section>
        </>
      )}

      <ul className="pc-hint pcl-notes">
        {PROMISES.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </div>
  );
}

/** Las secciones de un curso: títulos, fechas, el texto recortado de sus páginas y los nombres de sus archivos. */
function CourseBody({ name, detail, now, onAsk }: { name: string; detail: CourseDetail | ClasesFailure | "cargando" | undefined; now: number; onAsk: (course: string, activity?: string) => void }) {
  if (!detail || detail === "cargando") {
    return (
      <p className="pc-wait" role="status">
        Pilo está leyendo el curso…
      </p>
    );
  }
  if (!("sections" in detail)) return <Msg tone="bad">{detail.message}</Msg>;
  if (detail.sections.length === 0) return <p className="pcl-empty">Este curso aún no tiene actividades ni materiales a la vista.</p>;
  return (
    <>
      {detail.sections.map((s, i) => (
        <section key={`${i}-${s.name}`} className="pcl-section">
          <h4>{s.name}</h4>
          {s.summary && <p className="pcl-text">{s.summary}</p>}
          {s.items.length > 0 && (
            <ul>
              {s.items.map((m) => {
                const kind = kindLabel(m.kind, m.kindName);
                return (
                  <li key={m.id}>
                    <strong>{m.name}</strong>
                    {kind && <small>{kind}</small>}
                    {m.dates.map((d) => (
                      <span key={`${d.label}-${d.at}`} className="pcl-when">
                        {d.label ? `${d.label}: ` : ""}
                        {dueLabel(d.at, now)}
                      </span>
                    ))}
                    {m.text && <p className="pcl-text">{m.text}</p>}
                    {m.files.length > 0 && <small>Archivos: {m.files.join(", ")}</small>}
                    <div className="pcl-tools">
                      <button type="button" className="pc-chip" onClick={() => onAsk(name, m.name)} aria-label={`Preguntarle a Pilo sobre ${m.name}`}>
                        Preguntarle a Pilo
                      </button>
                      {m.url && (
                        <a className="pc-chip" href={m.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir en Moodle: ${m.name}`}>
                          Abrir en Moodle
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      {detail.cut && <p className="pc-hint">El curso es más largo: aquí va lo primero. El resto está en Moodle.</p>}
    </>
  );
}
