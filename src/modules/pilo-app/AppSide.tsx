/* =============================================================================
   Mr. Pilo · la app · la barra lateral del escritorio y el marco de una página.

   Desde 960 px de ancho la app deja de ser una pantalla de teléfono: la barra
   lateral queda fija con cuál Pilo, «Nueva conversación», «Para estudiar»
   (Mis clases, Mis notas, Gemini y las guardadas), las conversaciones más recientes de
   este dispositivo, la persona (o «Crear cuenta / Entrar») y Ajustes (el
   tema, la bienvenida y la política), que se abren junto a ella. Por debajo de ese ancho, lo mismo vive en el
   cajón del menú (AppMenu).

   AppPage es el marco de las pantallas que no son la conversación (el perfil
   y las guardadas): en el teléfono, una cabecera con «volver»; en el
   escritorio, la barra lateral y la página al centro.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SpaceId } from "../pregunta/space";
import { APP_ACCOUNT, APP_CARNET, APP_CLASSES, APP_GEMINI, APP_GRADES, APP_LOGIN, APP_PILOS, APP_PROFILE, APP_SAVED, APP_SPACES, APP_U } from "./routes";
import type { AppTheme } from "./themes";
import { dayLabel } from "./saved";
import type { SavedEntry } from "./saved";
import { Icon } from "./icons";
import { ThemePicker } from "./account/parts";
import { PolicyLink } from "./terms/PolicyLink";
import { tr, useLang, LangSwitch } from "../../components/pilo/i18n";

/** Desde este ancho la app usa la disposición de escritorio. */
export const WIDE_QUERY = "(min-width: 960px)";

export function useWide(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(WIDE_QUERY).matches));
  useEffect(() => {
    const media = window.matchMedia?.(WIDE_QUERY);
    if (!media) return;
    const on = () => setWide(media.matches);
    on();
    media.addEventListener("change", on);
    return () => media.removeEventListener("change", on);
  }, []);
  return wide;
}

/** Quién usa la app, como se muestra en el menú y en la barra lateral. */
export interface Person {
  /** Con cuenta de Pilo: su nombre, su perfil y su usuario. */
  card: { name: string; under: string; initial: string } | null;
  /** Con cuenta de la intranet: su nombre. */
  intranet: string | null;
  /** Cuántas respuestas tiene guardadas; null si no tiene cuenta o aún no se sabe. */
  saved: number | null;
  /** Puede usar Mis clases (beta): estudiante o profesor con cuenta de Pilo activa. A los demás no se les muestra. */
  clases?: boolean;
  /** Puede usar Mis notas (beta): estudiante con cuenta de Pilo activa. A los demás no se les muestra. */
  notas?: boolean;
}

/** El bloque de la persona: con cuenta lleva a su perfil; sin ella, a crearla o a entrar. */
export function PersonBlock({ person, current = false, onGo }: { person: Person; current?: boolean; onGo?: () => void }) {
  useLang();
  if (person.card) {
    return (
      <Link className="pa-who" to={APP_PROFILE} aria-current={current ? "page" : undefined} onClick={onGo}>
        <span className="pa-avatar" aria-hidden="true">
          {person.card.initial}
        </span>
        <span>
          <b>{person.card.name}</b>
          <small>{person.card.under}</small>
        </span>
      </Link>
    );
  }
  if (person.intranet) {
    return (
      <Link className="pa-who" to={APP_PROFILE} aria-current={current ? "page" : undefined} onClick={onGo}>
        <span className="pa-avatar" aria-hidden="true">
          {person.intranet.trim().charAt(0).toUpperCase() || "P"}
        </span>
        <span>
          <b>{person.intranet}</b>
          <small>{tr("Cuenta de la intranet")}</small>
        </span>
      </Link>
    );
  }
  return (
    <div className="pa-join">
      <p>
        <b>{tr("Sin cuenta.")}</b> {tr("Con una, Pilo le responde a su medida, guarda respuestas y le da más cupo.")}
      </p>
      <div className="pa-join__go">
        <Link className="pa-btn pa-join__main" to={APP_ACCOUNT} onClick={onGo}>
          {tr("Crear cuenta")}
        </Link>
        <Link className="pa-btn pa-join__line" to={APP_LOGIN} onClick={onGo}>
          {tr("Entrar")}
        </Link>
      </div>
      <Link className="pa-join__prefs" to={APP_PROFILE} aria-current={current ? "page" : undefined} onClick={onGo}>
        {tr("Mis preferencias y el tema")}
      </Link>
    </div>
  );
}

/** Cuántas conversaciones se ven sin pedir «Ver todas», en el cajón y en la barra lateral. */
export const RECENT_CONVERSATIONS = 4;

/** Los iconos de «Para estudiar» y de Ajustes: el mismo trazo de los demás (icons.tsx). */
export const StudyIcon = {
  classes: (
    <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 5.5C8.5 4.3 6.5 4 3.5 4v11c3 0 5 .3 6.5 1.5 1.5-1.2 3.5-1.5 6.5-1.5V4c-3 0-5 .3-6.5 1.5zM10 5.5v11" />
    </svg>
  ),
  grades: (
    <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 16.5h13M4 13l3.5-4 3 2.5L16 5M12.5 5H16v3.5" />
    </svg>
  ),
  gemini: (
    <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 3c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6z" />
    </svg>
  ),
  settings: (
    <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="2.6" />
      <path d="M10 3v2M10 15v2M3 10h2M15 10h2M5 5l1.5 1.5M13.5 13.5L15 15M5 15l1.5-1.5M13.5 6.5L15 5" />
    </svg>
  ),
  policy: (
    <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4.5" y="9" width="11" height="7.5" rx="1.5" />
      <path d="M7 9V6.5a3 3 0 016 0V9" />
    </svg>
  ),
};

export function AppSide({
  space,
  saved,
  currentId,
  active,
  person,
  onOpen,
  onDelete,
  onNew,
  onSwitch,
  theme,
  onTheme,
  onWelcome,
}: {
  /** El Pilo abierto. */
  space: SpaceId;
  saved: SavedEntry[];
  currentId: string | null;
  /** La pantalla que se está viendo. */
  active: "chat" | "guardadas" | "perfil" | "clases" | "notas" | "u" | "carnet";
  person: Person;
  onOpen: (entry: SavedEntry) => void;
  onDelete: (entry: SavedEntry) => void;
  onNew: () => void;
  onSwitch: (space: SpaceId) => void;
  /** Los ajustes (el tema, la bienvenida y la política), en un menú junto a la persona. */
  theme: AppTheme;
  onTheme: (theme: AppTheme) => void;
  onWelcome: () => void;
}) {
  useLang();
  const [all, setAll] = useState(false);
  const [settings, setSettings] = useState(false);
  const pop = useRef<HTMLDivElement>(null);
  const gear = useRef<HTMLButtonElement>(null);
  const few = saved.length <= RECENT_CONVERSATIONS;
  const shown = all || few ? saved : saved.slice(0, RECENT_CONVERSATIONS);

  // El menú de ajustes se cierra con Escape o al tocar fuera de él.
  useEffect(() => {
    if (!settings) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !gear.current?.contains(t)) setSettings(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setSettings(false);
      gear.current?.focus();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [settings]);

  return (
    <aside className="pa-side" aria-label="Mr. Pilo">
      <div className="pa-side__top">
        <p className="pa-side__brand">
          Mr. Pilo
          <small>{tr("Universidad de Santander")}</small>
        </p>
        <div className="pa-side__two" role="group" aria-label={tr("Con cuál Pilo")}>
          {APP_SPACES.map((id) => (
            <button key={id} type="button" aria-pressed={active === "chat" && id === space} onClick={() => onSwitch(id)}>
              {APP_PILOS[id].short}
            </button>
          ))}
        </div>
        <button type="button" className="pa-sl pa-sl--new" onClick={onNew}>
          {Icon.plus}
          <span>{tr("Nueva conversación")}</span>
        </button>
      </div>

      <nav className="pa-side__nav" aria-label={tr("Secciones de la app")}>
        <p className="pa-side__label">{person.clases ? tr("Para estudiar") : tr("Mi Pilo")}</p>
        <Link className="pa-sl" to={APP_U} aria-current={active === "u" ? "page" : undefined}>
          {Icon.cap}
          <span>{tr("Pilo U")}</span>
        </Link>
        <Link className="pa-sl" to={APP_CARNET} aria-current={active === "carnet" ? "page" : undefined}>
          {Icon.id}
          <span>{tr("Carnet digital")}</span>
        </Link>
        {/* Mis clases (clases/) y Gemini: solo para estudiantes y profesores con cuenta. */}
        {person.clases && (
          <Link className="pa-sl" to={APP_CLASSES} aria-current={active === "clases" ? "page" : undefined}>
            {StudyIcon.classes}
            <span>{tr("Mis clases")}</span>
            <em>beta</em>
          </Link>
        )}
        {/* Mis notas (notas/): Génesis, solo para estudiantes con cuenta. */}
        {person.notas && (
          <Link className="pa-sl" to={APP_GRADES} aria-current={active === "notas" ? "page" : undefined}>
            {StudyIcon.grades}
            <span>{tr("Mis notas")}</span>
            <em>beta</em>
          </Link>
        )}
        {person.clases && (
          <a className="pa-sl" href={APP_GEMINI} target="_blank" rel="noopener noreferrer" title={tr("Se abre aparte, con su cuenta de la universidad")}>
            {StudyIcon.gemini}
            <span>Gemini</span>
            <em data-new>{tr("Nuevo")}</em>
          </a>
        )}
        <Link className="pa-sl" to={APP_SAVED} aria-current={active === "guardadas" ? "page" : undefined}>
          {Icon.mark}
          <span>{tr("Guardadas")}</span>
          {person.saved !== null && <em aria-label={`${person.saved} guardadas`}>{person.saved}</em>}
        </Link>

        <p className="pa-side__label" id="pa-s-convs">
          {tr("Conversaciones")}
        </p>
        {saved.length === 0 && <p className="pa-side__empty">{tr("Sus conversaciones quedan aquí, solo en este dispositivo.")}</p>}
        <ul aria-labelledby="pa-s-convs">
          {shown.map((entry) => {
            const on = active === "chat" && entry.space === space && entry.id === currentId;
            return (
              <li key={`${entry.space}:${entry.id}`} className="pa-side__row">
                <button type="button" className="pa-sl" aria-current={on ? "true" : undefined} title={entry.title} onClick={() => onOpen(entry)}>
                  {Icon.chat}
                  <span>
                    {entry.title}
                    <small>
                      {APP_PILOS[entry.space].short} · {dayLabel(entry.at)}
                    </small>
                  </span>
                </button>
                <button type="button" className="pa-icon" onClick={() => onDelete(entry)} aria-label={tr("Borrar la conversación «{title}»", { title: entry.title })}>
                  {Icon.trash}
                </button>
              </li>
            );
          })}
        </ul>
        {!few && (
          <button type="button" className="pa-sl pa-sl--more" aria-expanded={all} onClick={() => setAll(!all)}>
            <span>{all ? tr("Ver solo las recientes") : tr("Ver las {length} conversaciones", { length: saved.length })}</span>
          </button>
        )}
      </nav>

      <div className="pa-side__me">
        <PersonBlock person={person} current={active === "perfil"} />
        <button
          ref={gear}
          type="button"
          className="pa-sl pa-sl--set"
          aria-expanded={settings}
          aria-controls="pa-s-ajustes"
          onClick={() => setSettings(!settings)}
        >
          {StudyIcon.settings}
          <span>{tr("Ajustes")}</span>
        </button>
        {settings && (
          <div className="pa-side__pop" id="pa-s-ajustes" ref={pop} role="group" aria-label={tr("Ajustes")}>
            <p className="pa-side__label" id="pa-s-idioma">
              {tr("Idioma")}
            </p>
            <LangSwitch />
            <p className="pa-side__label" id="pa-s-tema">
              {tr("Tema")}
            </p>
            <ThemePicker value={theme} onPick={(id) => onTheme(id)} labelledBy="pa-s-tema" />
            <button
              type="button"
              className="pa-sl"
              onClick={() => {
                setSettings(false);
                onWelcome();
              }}
            >
              {Icon.listen}
              <span>{tr("Ver la bienvenida")}</span>
            </button>
            {/* La política de uso completa (terms/): página pública, fuera de la app. */}
            <PolicyLink className="pa-sl">
              {StudyIcon.policy}
              <span>{tr("Política de uso")}</span>
            </PolicyLink>
          </div>
        )}
      </div>
    </aside>
  );
}

/** El marco de una pantalla que no es la conversación. */
export function AppPage({ title, tag, lead, home, side, children }: { title: string; /** Una etiqueta junto al título («Beta»). */ tag?: string; lead: string; home: string; side: ReactNode; children: ReactNode }) {
  useLang();
  return (
    <div className="pa-frame pa-frame--page">
      {side}
      <header className="pa-bar pa-bar--page">
        <div className="pa-bar__in">
          <Link className="pa-icon" to={home} aria-label={tr("Volver a conversar con Pilo")}>
            {Icon.back}
          </Link>
          <div className="pa-bar-id">
            <strong>{title}</strong>
            <span>Mr. Pilo</span>
          </div>
        </div>
      </header>
      <main className="pa-msgs pc-page">
        <div className="pc-pane">
          <header className="pc-pane__head">
            <h1>
              {title}
              {tag && <span className="pcl-beta">{tag}</span>}
            </h1>
            <p>{lead}</p>
          </header>
          {children}
        </div>
      </main>
    </div>
  );
}
