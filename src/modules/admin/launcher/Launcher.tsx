/* =============================================================================
   Inicio de la administración de Pilo (/admin).

   Lo primero al entrar: Mr. Pilo saluda a la persona por su nombre y su rol,
   dice lo que está pendiente y deja a mano dónde trabajar. Todo sale del rol:
   un cartel por espacio que puede trabajar (Pilo Universidad, Pilo Enseñanza)
   con sus cifras vivas de pilo_docs y sus acciones directas, y —solo para el
   administrador— las herramientas de Pilo. Nunca aparece lo que la persona no
   puede abrir; las rutas son las del menú (buildStaffNav), sin duplicarlas.

   Las cifras son opcionales: mientras cargan, el cartel reserva su espacio
   (sin saltos de diseño); si la lectura falla, el cartel se muestra sin cifra
   y la franja de pendientes ofrece reintentar. Lo pendiente sale solo de las
   fichas (error, sin entender, escaneado, memoria de más de 30 días).

   Con muchas entradas (el administrador) aparece un buscador: «/» lo enfoca,
   flechas y Enter eligen. Cada cartel de espacio se abre como un pequeño
   microportal con sus pantallas.

   Movimiento (GSAP, presets de ../motion): la entrada en cascada al abrir la
   pantalla y el despliegue del microportal. El buscador y la navegación con
   teclado no se animan: se usan muchas veces al día. Con movimiento reducido,
   solo fundidos.
   ========================================================================== */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Icon } from "../../../components/ui/Icon";
import type { IconName } from "../../../components/ui/Icon";
import { PiloAvatar } from "../../../components/pilo/PiloAvatar";
import { useAuth } from "../../../lib/auth";
import type { StaffNavEntry } from "../../../lib/staff-access";
import { AdminShell } from "../components/AdminShell";
import { collapse, expand, useEnterCascade } from "../motion/presets";
import { useActiveStaffCount, useLauncherDocs } from "./launcher-data";
import {
  agoLabel, filterEntries, firstName, greetingFor, hasSearch, modulesFor, moodFor, pendingItems, roleLine,
  searchableEntries, spaceStats,
} from "./launcher-logic";
import type { DocLite, PendingItem, SpaceModule, ToolModule } from "./launcher-logic";
import "./launcher.css";

const DATE = new Intl.DateTimeFormat("es-CO", { weekday: "long", day: "numeric", month: "long" });
const NUMBER = new Intl.NumberFormat("es-CO");

const TOOL_ICONS: Record<string, IconName> = {
  conexion: "key",
  portales: "compass",
  usuarios: "user",
  emergencias: "alert",
  personal: "community",
};

const PENDING_ICONS: Record<PendingItem["kind"], IconName> = {
  error: "alert",
  sin_entender: "clock",
  escaneado: "document",
  memoria_vieja: "clock",
};

function entryIcon(entry: StaffNavEntry): IconName {
  if (entry.id.startsWith("documentos")) return "layers";
  if (entry.id === "catalogo") return "table";
  if (entry.id === "memoria") return "chip";
  return TOOL_ICONS[entry.id] ?? "document";
}

export function Launcher() {
  const { staff, profile, session, staffRole, canUse } = useAuth();
  const root = useRef<HTMLDivElement>(null);

  const modules = useMemo(() => modulesFor(staffRole), [staffRole]);
  const spaces = useMemo(() => modules.filter((m): m is SpaceModule => m.kind === "space"), [modules]);
  const tools = useMemo(() => modules.filter((m): m is ToolModule => m.kind === "tool"), [modules]);

  const docsQuery = useLauncherDocs(useMemo(() => spaces.map((s) => s.id), [spaces]));
  const staffCount = useActiveStaffCount(canUse("personal"));

  const docs: DocLite[] | undefined = docsQuery.data;
  const now = useMemo(() => Date.now(), [docsQuery.dataUpdatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = useMemo(() => (docs ? pendingItems(docs, staffRole, now) : []), [docs, staffRole, now]);
  const loading = spaces.length > 0 && docsQuery.isPending;
  const failed = docsQuery.isError;

  const name = staff?.full_name || profile?.full_name || staff?.email || profile?.email || session?.user.email || "";

  // La pantalla entra una vez, en cascada. Solo transform y opacidad.
  useEnterCascade(root, "[data-cascade]", [staffRole]);

  return (
    <AdminShell section="inicio" kicker="Inicio" title="Inicio">
      <div className="lz" ref={root}>
        <Hero name={name} role={roleLine(staffRole)} mood={moodFor(pending, loading || failed)} pending={pending} loading={loading} failed={failed} />

        <PendingStrip items={pending} loading={loading} failed={failed} onRetry={() => void docsQuery.refetch()} retrying={docsQuery.isFetching} />

        {spaces.length > 0 && (
          <section className="lz-wall" aria-labelledby="lz-spaces" data-count={spaces.length}>
            <h2 id="lz-spaces" className="lz-h">
              Tus espacios
            </h2>
            <div className="lz-posters">
              {spaces.map((space) => (
                <Poster key={space.id} space={space} docs={docs} loading={loading} failed={failed} now={now} />
              ))}
            </div>
          </section>
        )}

        {tools.length > 0 && (
          <section className="lz-wall" aria-labelledby="lz-tools">
            <h2 id="lz-tools" className="lz-h">
              Administración de Pilo
            </h2>
            <ul className="lz-tools">
              {tools.map((tool) => (
                <li key={tool.id} data-cascade>
                  <Link className="lz-tool" to={tool.to}>
                    <span className="lz-tool__icon" aria-hidden="true">
                      <Icon name={TOOL_ICONS[tool.id] ?? "document"} size={20} />
                    </span>
                    <span className="lz-tool__body">
                      <strong>{tool.label}</strong>
                      {tool.text && <span>{tool.text}</span>}
                    </span>
                    {tool.id === "personal" && staffCount.data !== undefined && (
                      <span className="lz-tool__live">
                        <b>{NUMBER.format(staffCount.data)}</b> {staffCount.data === 1 ? "activo" : "activos"}
                      </span>
                    )}
                    <Icon name="arrow-right" size={16} className="lz-tool__go" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {modules.length === 0 && (
          <p className="lz-empty" role="status">
            Tu cuenta aún no tiene espacios asignados. Pide a un administrador que te dé acceso.
          </p>
        )}
      </div>
    </AdminShell>
  );
}

/* --- Saludo ------------------------------------------------------------------------------------ */

function Hero({
  name, role, mood, pending, loading, failed,
}: {
  name: string;
  role: string;
  mood: "feliz" | "piensa" | "cuidado" | "bien";
  pending: PendingItem[];
  loading: boolean;
  failed: boolean;
}) {
  const { staffRole } = useAuth();
  const first = firstName(name);
  const today = DATE.format(new Date());
  const summary = loading
    ? "Revisando cómo va la memoria de Pilo…"
    : failed
      ? "No pude leer el estado de los documentos; el resto funciona."
      : pending.length === 0
        ? "Todo al día: no hay nada pendiente."
        : `Hay ${pending.length === 1 ? "1 cosa" : `${pending.length} cosas`} por revisar.`;

  return (
    <header className="lz-hero" data-cascade>
      <div className="lz-hero__face">
        <PiloAvatar mood={mood} size={84} alive />
      </div>
      <div className="lz-hero__copy">
        <p className="lz-hero__date">{today}</p>
        <h2 className="lz-hero__hello">
          {greetingFor(new Date().getHours())}
          {first ? `, ${first}` : ""}
        </h2>
        <p className="lz-hero__line">
          {role && <span className="lz-role">{role}</span>}
          <span aria-live="polite">{summary}</span>
        </p>
      </div>
      {hasSearch(staffRole) && <Search />}
    </header>
  );
}

/* --- Buscador ---------------------------------------------------------------------------------- */

/**
 * Buscador de pantallas: «/» lo enfoca; flechas mueven; Enter abre; Esc cierra.
 * Patrón combobox con lista: el foco se queda en el campo y la opción activa se
 * anuncia con aria-activedescendant.
 */
function Search() {
  const { staffRole } = useAuth();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [hit, setHit] = useState(0);

  const all = useMemo(() => searchableEntries(staffRole), [staffRole]);
  const results = useMemo(() => filterEntries(all, query), [all, query]);
  const active = results[Math.min(hit, results.length - 1)];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
      const el = event.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function go(entry: StaffNavEntry) {
    setOpen(false);
    setQuery("");
    navigate(entry.to);
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setHit((h) => (results.length === 0 ? 0 : (Math.min(h, results.length - 1) + step + results.length) % results.length));
    } else if (event.key === "Enter") {
      if (open && active) {
        event.preventDefault();
        go(active);
      }
    } else if (event.key === "Escape") {
      if (open || query) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuery("");
      } else {
        inputRef.current?.blur();
      }
    }
  }

  return (
    <div className="lz-search">
      <label className="lz-search__label" htmlFor={`${listId}-in`}>
        Buscar una pantalla
      </label>
      <div className="lz-search__field">
        <Icon name="search" size={16} />
        <input
          id={`${listId}-in`}
          ref={inputRef}
          type="text"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
          placeholder="Buscar: usuarios, voz, documentos…"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && active ? `${listId}-${active.id}` : undefined}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHit(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        <kbd className="lz-kbd" aria-hidden="true">
          /
        </kbd>
      </div>
      <div className="lz-search__pop" hidden={!open}>
        <ul id={listId} role="listbox" aria-label="Pantallas">
          {results.map((entry, at) => (
            <li
              key={entry.id}
              id={`${listId}-${entry.id}`}
              role="option"
              aria-selected={entry === active}
              data-active={entry === active || undefined}
              // mousedown, no click: el campo pierde el foco antes del click y cerraría la lista.
              onMouseDown={(e) => {
                e.preventDefault();
                go(entry);
              }}
              onMouseEnter={() => setHit(at)}
            >
              <Icon name={entryIcon(entry)} size={16} />
              <span>{entry.label}</span>
            </li>
          ))}
        </ul>
        {results.length === 0 && (
          <p className="lz-search__none" role="status">
            Nada coincide con «{query.trim()}».
          </p>
        )}
      </div>
    </div>
  );
}

/* --- Pendientes -------------------------------------------------------------------------------- */

function PendingStrip({
  items, loading, failed, onRetry, retrying,
}: {
  items: PendingItem[];
  loading: boolean;
  failed: boolean;
  onRetry: () => void;
  retrying: boolean;
}) {
  // Alto reservado: la franja ocupa lo mismo cargando, vacía o con cosas.
  return (
    <section className="lz-pending" aria-labelledby="lz-pending-h" data-cascade aria-busy={loading}>
      <h2 id="lz-pending-h" className="lz-h">
        Lo pendiente
      </h2>
      {loading ? (
        <div className="lz-pending__row" aria-hidden="true">
          <span className="lz-skel lz-skel--chip" />
          <span className="lz-skel lz-skel--chip" />
        </div>
      ) : failed ? (
        <p className="lz-note">
          <Icon name="alert" size={16} />
          <span>No se pudo leer el estado de los documentos.</span>
          <button type="button" className="lz-link" onClick={onRetry} disabled={retrying}>
            {retrying ? "Reintentando…" : "Reintentar"}
          </button>
        </p>
      ) : items.length === 0 ? (
        <p className="lz-note lz-note--ok">
          <Icon name="check" size={16} />
          <span>Nada pendiente: los documentos están leídos y la memoria tiene cargas recientes.</span>
        </p>
      ) : (
        <ul className="lz-pending__row">
          {items.map((item) => (
            <li key={item.id}>
              <Link className="lz-chip" data-kind={item.kind} to={item.to}>
                <Icon name={PENDING_ICONS[item.kind]} size={16} />
                <span>{item.label}</span>
                <Icon name="arrow-right" size={14} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* --- Cartel de un espacio ---------------------------------------------------------------------- */

function Poster({
  space, docs, loading, failed, now,
}: {
  space: SpaceModule;
  docs: DocLite[] | undefined;
  loading: boolean;
  failed: boolean;
  now: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const stats = docs ? spaceStats(docs, space.id) : null;
  const ready = stats !== null;
  const dash = failed ? "—" : "";

  function toggle(event: ReactMouseEvent<HTMLButtonElement>) {
    // detail === 0: se activó con el teclado; no se hace esperar a nadie.
    const instant = event.detail === 0;
    const next = !open;
    setOpen(next);
    if (next) expand(panel.current, { instant });
    else collapse(panel.current, { instant });
  }

  return (
    <article className="lz-poster" data-space={space.id} data-cascade aria-busy={loading}>
      <div className="lz-poster__head">
        <h3>{space.label}</h3>
        <p>{space.text}</p>
      </div>

      <div className="lz-poster__big" aria-live="polite">
        {loading ? (
          <span className="lz-skel lz-skel--num" aria-hidden="true" />
        ) : (
          <span className="lz-poster__num">{ready ? NUMBER.format(stats.documents) : dash}</span>
        )}
        <span className="lz-poster__unit">{ready && stats.documents === 1 ? "documento" : "documentos"}</span>
        {loading && <span className="lz-sr">Cargando cifras</span>}
        {failed && <span className="lz-sr">Cifras no disponibles</span>}
      </div>

      <dl className="lz-facts">
        <div>
          <dt>Pasajes</dt>
          <dd>{loading ? <span className="lz-skel lz-skel--txt" /> : ready ? NUMBER.format(stats.passages) : "—"}</dd>
        </div>
        <div>
          <dt>Último cargado</dt>
          <dd>{loading ? <span className="lz-skel lz-skel--txt" /> : ready ? agoLabel(stats.lastLoadedAt, now) : "—"}</dd>
        </div>
        <div>
          <dt>Con error</dt>
          <dd>
            {loading ? (
              <span className="lz-skel lz-skel--txt" />
            ) : ready ? (
              stats.errors > 0 ? (
                <span className="lz-flag lz-flag--bad">
                  <Icon name="alert" size={13} /> {NUMBER.format(stats.errors)}
                </span>
              ) : (
                <span className="lz-flag">
                  <Icon name="check" size={13} /> Ninguno
                </span>
              )
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>

      <div className="lz-poster__actions">
        <Link className="lz-btn lz-btn--primary" to={space.uploadTo}>
          <Icon name="upload" size={16} /> Subir documento
        </Link>
        <Link className="lz-btn" to={space.docsTo}>
          Ver documentos
        </Link>
        <button type="button" className="lz-btn lz-btn--quiet" aria-expanded={open} aria-controls={`lz-panel-${space.id}`} onClick={toggle}>
          Más del espacio <Icon name="chevron-down" size={14} className="lz-chev" />
        </button>
      </div>

      <div ref={panel} id={`lz-panel-${space.id}`} className="lz-poster__panel" hidden>
        <ul>
          {space.links.map((link) => (
            <li key={link.label}>
              <Link to={link.to}>
                {link.label} <Icon name="arrow-right" size={14} />
              </Link>
            </li>
          ))}
          <li>
            <Link to={space.to}>
              Abrir {space.label} <Icon name="arrow-right" size={14} />
            </Link>
          </li>
        </ul>
      </div>
    </article>
  );
}
