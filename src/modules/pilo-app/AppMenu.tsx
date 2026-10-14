/* =============================================================================
   Mr. Pilo · la app móvil · el menú (cajón lateral) y sus hojas.

   De arriba abajo, por lo que más se usa: la persona (su nombre lleva a su
   perfil) · con cuál Pilo · Nueva conversación · «Para estudiar» (Mis clases en
   Moodle, Mis notas en Génesis, Gemini y las respuestas guardadas) · las conversaciones de este
   teléfono (las cuatro más recientes; «Ver todas» las abre, y ahí se borran) ·
   Ajustes (el tema, la bienvenida y la política de uso), que es una hoja
   aparte: se usa poco y ya no ocupa el menú.

   La persona (0120): con cuenta de Pilo o de la intranet, encabeza el cajón;
   sin cuenta, «Crear cuenta / Entrar» queda al pie. En el escritorio este
   cajón no se usa: lo mismo vive en la barra lateral fija (AppSide).
   ========================================================================== */

import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { Link } from "react-router-dom";
import type { AskSource } from "../../components/pilo/ai/client";
import { originOf } from "../pregunta/answer-state";
import type { SpaceId, SpaceProfile } from "../pregunta/space";
import { activarAlertas, desactivarAlertas, estadoAlertas } from "./alertas";
import type { EstadoAlertas } from "./alertas";
import { APP_ACCOUNT, APP_CLASSES, APP_GEMINI, APP_GRADES, APP_LOGIN, APP_PILOS, APP_SAVED, APP_SPACES } from "./routes";
import type { AppTheme } from "./themes";
import { dayLabel } from "./saved";
import type { SavedEntry } from "./saved";
import { Layer } from "./Layer";
import { Icon } from "./icons";
import { PersonBlock, RECENT_CONVERSATIONS, StudyIcon } from "./AppSide";
import type { Person } from "./AppSide";
import { ACCOUNT_BENEFITS } from "./account/rules";
import { ThemePicker } from "./account/parts";
import { PolicyLink } from "./terms/PolicyLink";
import { APP_APK } from "./pwa";
import { tr, useLang, LangSwitch } from "../../components/pilo/i18n";

export function AppMenu({
  open,
  quick,
  onClose,
  space,
  saved,
  currentId,
  onOpen,
  onDelete,
  onNew,
  onSwitch,
  onSettings,
  person,
  getApp,
}: {
  open: boolean;
  quick: boolean;
  /** Con el evento del toque (o sin él, si fue Escape): así se sabe si cerrar deslizando o en seco. */
  onClose: (event?: MouseEvent) => void;
  space: SpaceId;
  saved: SavedEntry[];
  currentId: string | null;
  onOpen: (entry: SavedEntry) => void;
  onDelete: (entry: SavedEntry) => void;
  onNew: () => void;
  onSwitch: (space: SpaceId) => void;
  /** Abre la hoja de ajustes (el tema, la bienvenida y la política). */
  onSettings: () => void;
  /** Quién usa la app: su cuenta de Pilo, la de la intranet, o nadie. */
  person: Person;
  /** «Conseguir la app»: el APK de Android o la guía del iPhone, según donde se abra. Nada si no aplica. */
  getApp?: { label: string; hint: string; onOpen: () => void } | null;
}) {
  useLang();
  /** Todas las conversaciones a la vista: ahí, además, se borran. */
  const [all, setAll] = useState(false);
  const known = Boolean(person.card || person.intranet);
  const few = saved.length <= RECENT_CONVERSATIONS;
  const shown = all || few ? saved : saved.slice(0, RECENT_CONVERSATIONS);

  return (
    <Layer kind="menu" open={open} quick={quick} label={tr("Menú de Mr. Pilo")} onClose={onClose}>
      <div className="pa-menu-head">
        <div className="pa-menu-head__top">
          {known ? <PersonBlock person={person} onGo={() => onClose()} /> : <h2>Mr. Pilo</h2>}
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar el menú")}>
            {Icon.close}
          </button>
        </div>
        <div className="pa-two" role="group" aria-label={tr("Con cuál Pilo")}>
          {APP_SPACES.map((id) => (
            <button key={id} type="button" aria-pressed={id === space} onClick={() => onSwitch(id)}>
              {APP_PILOS[id].short}
            </button>
          ))}
        </div>
        <button type="button" className="pa-btn pa-btn--main" onClick={onNew}>
          {Icon.plus}
          {tr("Nueva conversación")}
        </button>
      </div>

      <div className="pa-menu-body">
        <section aria-labelledby="pa-m-study">
          <p className="pa-label" id="pa-m-study">
            {person.clases ? tr("Para estudiar") : tr("Mi Pilo")}
          </p>
          <div className="pa-tiles">
            {/* Mis clases (clases/) y Gemini: solo para estudiantes y profesores con cuenta. */}
            {person.clases && (
              <Link className="pa-tile" to={APP_CLASSES} onClick={() => onClose()}>
                <span className="pa-tile__top">
                  <span className="pa-tile__ico">{StudyIcon.classes}</span>
                  <em>beta</em>
                </span>
                <span>
                  <strong>{tr("Mis clases")}</strong>
                  <small>{tr("Sus cursos de Moodle y sus fechas de entrega")}</small>
                </span>
              </Link>
            )}
            {/* Mis notas (notas/): Génesis, solo para estudiantes con cuenta. */}
            {person.notas && (
              <Link className="pa-tile" to={APP_GRADES} onClick={() => onClose()}>
                <span className="pa-tile__top">
                  <span className="pa-tile__ico">{StudyIcon.grades}</span>
                  <em>beta</em>
                </span>
                <span>
                  <strong>{tr("Mis notas")}</strong>
                  <small>{tr("Su histórico de Génesis y cómo va su promedio")}</small>
                </span>
              </Link>
            )}
            {person.clases && (
              <a className="pa-tile" href={APP_GEMINI} target="_blank" rel="noopener noreferrer" onClick={() => onClose()}>
                <span className="pa-tile__top">
                  <span className="pa-tile__ico">{StudyIcon.gemini}</span>
                  <em data-new>{tr("Nuevo")}</em>
                </span>
                <span>
                  <strong>Gemini</strong>
                  <small>{tr("Se abre aparte, con su cuenta de la universidad")}</small>
                </span>
              </a>
            )}
            <Link className="pa-tile pa-tile--wide" to={APP_SAVED} onClick={() => onClose()}>
              <span className="pa-tile__ico">{Icon.mark}</span>
              <span>
                <strong>{tr("Respuestas guardadas")}</strong>
                <small>{person.card ? tr("Lo que guardó de Pilo, en su cuenta") : tr("Con cuenta, las encuentra en cualquier dispositivo")}</small>
              </span>
              {person.saved !== null && <b aria-label={`${person.saved} guardadas`}>{person.saved}</b>}
            </Link>
          </div>
        </section>

        <section aria-labelledby="pa-m-saved">
          <p className="pa-label" id="pa-m-saved">
            {tr("Conversaciones")}
          </p>
          {saved.length === 0 && <p className="pa-empty">{tr("Sus conversaciones quedan aquí, solo en este teléfono.")}</p>}
          {shown.map((entry) => (
            <div key={`${entry.space}:${entry.id}`} className="pa-row" data-plain={!(all || few) || undefined} aria-current={entry.space === space && entry.id === currentId}>
              <button type="button" className="pa-mi" onClick={() => onOpen(entry)}>
                <strong>{entry.title}</strong>
                <small>
                  {APP_PILOS[entry.space].short} · {dayLabel(entry.at)}
                </small>
              </button>
              {(all || few) && (
                <button type="button" className="pa-icon" onClick={() => onDelete(entry)} aria-label={tr("Borrar la conversación «{title}»", { title: entry.title })}>
                  {Icon.trash}
                </button>
              )}
            </div>
          ))}
          {!few && (
            <button type="button" className="pa-mi pa-mi--more" aria-expanded={all} onClick={() => setAll(!all)}>
              <strong>{all ? tr("Ver solo las recientes") : tr("Ver las {length} conversaciones", { length: saved.length })}</strong>
            </button>
          )}
        </section>


        {getApp && (
          <section aria-labelledby="pa-m-app">
            <p className="pa-label" id="pa-m-app">
              {tr("Conseguir la app")}
            </p>
            <button type="button" className="pa-tile pa-tile--wide" onClick={getApp.onOpen}>
              <span className="pa-tile__ico">{Icon.download}</span>
              <span>
                <strong>{getApp.label}</strong>
                <small>{getApp.hint}</small>
              </span>
            </button>
          </section>
        )}
      </div>

      <div className="pa-account">
        {!known && <PersonBlock person={person} onGo={() => onClose()} />}
        <button type="button" className="pa-mi pa-mi--set" onClick={onSettings}>
          {StudyIcon.settings}
          <span>
            <strong>{tr("Ajustes")}</strong>
            <small>{tr("Tema, bienvenida y política de uso")}</small>
          </span>
        </button>
      </div>
    </Layer>
  );
}

/* --- La hoja de ajustes ---------------------------------------------------------------------- */

/** Lo que se usa poco: el tema, las alertas de emergencia, ver la bienvenida otra vez y la política de uso. */
export function SettingsSheet({
  open,
  quick,
  onClose,
  theme,
  onTheme,
  onWelcome,
}: {
  open: boolean;
  quick: boolean;
  onClose: (event?: MouseEvent) => void;
  theme: AppTheme;
  onTheme: (theme: AppTheme, event: { detail: number }) => void;
  onWelcome: () => void;
}) {
  useLang();
  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Ajustes de Mr. Pilo")} onClose={onClose}>
      <div className="pa-sheet__in">
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pa-sheet__head">
          <h2>{tr("Ajustes")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar los ajustes")}>
            {Icon.close}
          </button>
        </div>
        <section aria-labelledby="pa-m-idioma">
          <p className="pa-label" id="pa-m-idioma">
            {tr("Idioma")}
          </p>
          <LangSwitch />
        </section>
        <section aria-labelledby="pa-m-tema">
          <p className="pa-label" id="pa-m-tema">
            {tr("Tema")}
          </p>
          <ThemePicker value={theme} onPick={onTheme} labelledBy="pa-m-tema" />
        </section>
        <AlertasEmergencia open={open} />
        <div>
          <button type="button" className="pa-mi pa-mi--line" onClick={onWelcome}>
            <strong>{tr("Ver la bienvenida")}</strong>
            <small>{tr("Pilo se presenta otra vez")}</small>
          </button>
          {/* La política de uso completa (terms/): página pública, fuera de la app. */}
          <PolicyLink className="pa-mi pa-mi--line pa-mi--go" onClick={() => onClose()}>
            <strong>{tr("Política de uso")}</strong>
            <small>{tr("Los términos de Mr. Pilo y cómo trata sus datos")}</small>
          </PolicyLink>
        </div>
      </div>
    </Layer>
  );
}

/* --- Las alertas de emergencia ----------------------------------------------------------------- */

/** Lo que se cuenta de cada estado, para nunca prometer de más. */
// Función y no constante: tr() lee el idioma de cada momento.
const alertasTexto = (): Record<EstadoAlertas, string> => ({
  activas: tr("Sismo, incendio u otra emergencia del campus: suena también en este teléfono"),
  desactivadas: tr("Sismo, incendio u otra emergencia del campus, también aquí"),
  denegado: tr("El navegador tiene el permiso bloqueado; se habilita en la configuración de notificaciones del sitio"),
  no_disponible: tr("Este navegador no puede recibirlas; instálela desde Chrome o Safari a la pantalla de inicio"),
});

function AlertasEmergencia({ open }: { open: boolean }) {
  const [estado, setEstado] = useState<EstadoAlertas>("desactivadas");
  const [ocupado, setOcupado] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void estadoAlertas().then(setEstado);
  }, [open]);

  const alternar = async () => {
    if (ocupado || estado === "denegado" || estado === "no_disponible") return;
    setOcupado(true);
    setFallo(null);
    try {
      setEstado(estado === "activas" ? await desactivarAlertas() : await activarAlertas());
    } catch (error) {
      // Activar y no quedar es lo único que no puede pasar en silencio.
      setFallo(error instanceof Error ? error.message : tr("No se pudo conectar con Aluna."));
    } finally {
      setOcupado(false);
    }
  };

  return (
    <section aria-labelledby="pa-m-alertas">
      <p className="pa-label" id="pa-m-alertas">
        {tr("Emergencias del campus")}
      </p>
      <button
        type="button"
        className="pa-mi pa-mi--line"
        onClick={() => void alternar()}
        disabled={ocupado || estado === "denegado" || estado === "no_disponible"}
        aria-pressed={estado === "activas"}
      >
        <strong>{estado === "activas" ? tr("Alertas activadas") : tr("Alertas de emergencia")}</strong>
        <small>{alertasTexto()[estado]}</small>
      </button>
      {fallo && (
        <p className="pa-empty" role="alert">
          {fallo}
        </p>
      )}
    </section>
  );
}

/* --- La hoja de fuentes --------------------------------------------------------------------- */

export function SourcesSheet({
  open,
  quick,
  onClose,
  sources,
  focus,
  space,
}: {
  open: boolean;
  quick: boolean;
  onClose: (event?: MouseEvent) => void;
  sources: AskSource[];
  /** La cita que se tocó en el texto, para marcarla. */
  focus: number | null;
  space: SpaceProfile;
}) {
  useLang();
  const nameOf = (id: string) => space.sources.find((x) => x.id === id)?.name ?? space.office;
  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Fuentes de la respuesta")} onClose={onClose}>
      <div className="pa-sheet__in">
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pa-sheet__head">
          <h2>{tr("De dónde sale")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar las fuentes")}>
            {Icon.close}
          </button>
        </div>
        <ul>
          {sources.map((s) => {
            const external = /^https?:/i.test(s.path);
            // De otro ámbito de Pilo: se dice de dónde viene, y no se enlaza como si fuera de este portal.
            const origin = originOf(s);
            return (
              <li key={s.n} className="pa-src-li" data-on={focus === s.n || undefined}>
                <strong>
                  {s.n}. {s.title}
                </strong>
                <small>{[origin ? "" : nameOf(s.source), s.section, s.cut ? `Corte ${s.cut}` : "", s.office].filter(Boolean).join(" · ")}</small>
                {origin && (
                  <small className="pa-from">
                    <span aria-hidden="true">↗</span> {origin}
                    {s.written_for ? tr(" · preparado para {v0}", { v0: s.written_for }) : ""}
                  </small>
                )}
                {s.excerpt && <small className="pa-excerpt">{s.excerpt}</small>}
                {s.path &&
                  (external ? (
                    <a href={s.path} target="_blank" rel="noopener noreferrer">
                      {tr("Abrir el documento")}
                    </a>
                  ) : (
                    <Link to={s.path}>{origin ? tr("Abrir la fuente") : tr("Abrir en {v0}", { v0: nameOf(s.source) })}</Link>
                  ))}
              </li>
            );
          })}
        </ul>
      </div>
    </Layer>
  );
}

/* --- La invitación a tener cuenta --------------------------------------------------------------- */

/** Lo que se abre al tocar «Guardar» sin cuenta: qué gana quien se registra, y los dos caminos. */
export function AccountSheet({ open, quick, onClose }: { open: boolean; quick: boolean; onClose: (event?: MouseEvent) => void }) {
  useLang();
  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Su cuenta de Pilo")} onClose={onClose}>
      <div className="pa-sheet__in">
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pa-sheet__head">
          <h2>{tr("Guardar es de quienes tienen cuenta")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar")}>
            {Icon.close}
          </button>
        </div>
        <p>{tr("Con una cuenta de Pilo, sus respuestas guardadas quedan en su cuenta y las encuentra en cualquier dispositivo. Además:")}</p>
        <ul>
          {ACCOUNT_BENEFITS.filter((b) => b.title !== "Guardar respuestas").map((b) => (
            <li key={b.title}>
              <strong>{b.title}</strong>
              <small>{b.text}</small>
            </li>
          ))}
        </ul>
        <Link className="pa-btn pa-btn--main" to={APP_ACCOUNT}>
          {tr("Crear una cuenta")}
        </Link>
        <Link className="pa-btn pa-btn--line" to={APP_LOGIN}>
          {tr("Ya tengo cuenta")}
        </Link>
      </div>
    </Layer>
  );
}

/* --- La guía para iPhone ---------------------------------------------------------------------- */

export function IphoneSheet({ open, quick, onClose }: { open: boolean; quick: boolean; onClose: (event?: MouseEvent) => void }) {
  useLang();
  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Instalar a Pilo en el iPhone")} onClose={onClose}>
      <div className="pa-sheet__in">
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pa-sheet__head">
          <h2>{tr("Instalar a Pilo")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar")}>
            {Icon.close}
          </button>
        </div>
        <p>{tr("En el iPhone se instala desde Safari, en tres pasos:")}</p>
        <ul className="pa-steps-list">
          <li>{tr("Toque «Compartir»: el cuadrado con la flecha hacia arriba.")}</li>
          <li>{tr("Elija «Añadir a pantalla de inicio».")}</li>
          <li>{tr("Toque «Añadir». Pilo queda con su icono, como una app.")}</li>
        </ul>
      </div>
    </Layer>
  );
}

/* --- La hoja de la app de Android --------------------------------------------------------------- */

/** El APK firmado de la universidad y, si el navegador lo ofrece, instalar sin descargar archivo. */
export function AndroidSheet({
  open,
  quick,
  onClose,
  canPrompt,
  onPrompt,
}: {
  open: boolean;
  quick: boolean;
  onClose: (event?: MouseEvent) => void;
  /** Si el navegador tiene listo su aviso de instalación. */
  canPrompt: boolean;
  /** Cierra la hoja y saca el aviso de instalación del navegador. */
  onPrompt: () => void;
}) {
  useLang();
  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Descargar a Pilo para Android")} onClose={onClose}>
      <div className="pa-sheet__in">
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pa-sheet__head">
          <h2>{tr("Lleve a Pilo en su Android")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar")}>
            {Icon.close}
          </button>
        </div>
        <p>{tr("Descargue la app de Mr. Pilo para tabletas y celulares Android. Es el mismo Pilo de siempre, con icono propio y sin barra del navegador.")}</p>
        <p className="pa-apk__meta">
          {tr("Versión")} {APP_APK.version} · {APP_APK.size} · <span className="pa-apk__sign">{tr("Firmada por la Universidad de Santander")}</span>
        </p>
        <div className="pa-apk__actions">
          <a className="pa-btn pa-btn--main" href={APP_APK.url} download={APP_APK.file}>
            {Icon.download}
            {tr("Descargar el archivo (APK)")}
          </a>
          {canPrompt && (
            <button type="button" className="pa-btn pa-apk__alt" onClick={onPrompt}>
              {tr("Instalar sin descargar (aviso del navegador)")}
            </button>
          )}
        </div>
        <ul className="pa-steps-list">
          <li>{tr("Toque «Descargar el archivo» y espere a que la descarga termine.")}</li>
          <li>
            {tr("Abra el archivo")} <strong>{APP_APK.file}</strong>{tr(", desde el aviso o desde Descargas.")}
          </li>
          <li>{tr("Si el sistema lo pide, permita «Instalar apps desconocidas» solo para esta descarga.")}</li>
          <li>{tr("Toque «Instalar» y abra Mr. Pilo: queda en su pantalla de inicio.")}</li>
        </ul>
        <p className="pa-apk__note">{tr("La app se actualiza sola cada vez que la universidad publica el portal. El archivo solo vuelve a bajar cuando haya una versión nueva.")}</p>
      </div>
    </Layer>
  );
}
