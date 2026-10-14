/* =============================================================================
   Esqueleto de la administración de Pilo.
   Las pantallas internas no repiten su barra lateral, su cabecera ni su pie de
   guardado: viven aquí una sola vez. Aquí también se decide qué entradas del
   menú ve cada rol, y lo decide el contrato (pilo-staff.ts) a través de
   buildStaffNav: si el rol no abre una zona, su entrada no existe.

   El menú tiene tres anchos, que se recuerdan en este navegador:
   · completo  rótulos y grupos.
   · íconos    una columna estrecha: ícono con su nombre al pasar o enfocar.
   · oculto    todo el ancho para el trabajo; el botón de la cabecera lo devuelve.
   En el móvil (≤ 900 px) el menú es un cajón y estos modos no aplican.

   La cabecera lleva la ruta, la pantalla, la persona con su rol, el tema y el
   cierre de sesión. El menú se usa muchas veces al día: no se anima. Solo el
   cajón del móvil, que se abre de vez en cuando, entra con GSAP (y sin
   movimiento si la persona pidió menos).
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { gsap } from "gsap";
import { Icon } from "../../../components/ui/Icon";
import type { IconName } from "../../../components/ui/Icon";
import { useTheme } from "../../../lib/theme";
import { useAuth } from "../../../lib/auth";
import { staffRoleLabels } from "../../../lib/pilo-staff";
import { NAV_GROUP_LABELS, STAFF_HOME, activeNavId, buildStaffNav, initials } from "../../../lib/staff-access";
import type { NavGroupId, StaffNavEntry } from "../../../lib/staff-access";
import "../../../styles/admin-tokens.css";
import "../admin.css";

/** Las pantallas de la administración. Las dos primeras ya existen; el resto es para las nuevas. */
export type AdminSection = "inicio" | "pilo" | "pilo_ensenanza" | "personal" | (string & {});

type NavMode = "completo" | "iconos" | "oculto";
const NAV_MODE_KEY = "pilo-admin:menu";
const GROUP_ORDER: NavGroupId[] = ["trabajo", "pilo", "administracion"];

const ICONS: Record<string, IconName> = {
  inicio: "grid",
  catalogo: "table",
  memoria: "chip",
  conexion: "key",
  portales: "compass",
  usuarios: "user",
  emergencias: "alert",
  personal: "community",
};

function iconFor(entry: StaffNavEntry): IconName {
  return entry.id.startsWith("documentos") ? "layers" : ICONS[entry.id] ?? "document";
}

function readMode(): NavMode {
  try {
    const stored = window.localStorage.getItem(NAV_MODE_KEY);
    return stored === "iconos" || stored === "oculto" ? stored : "completo";
  } catch {
    return "completo";
  }
}

function storeMode(mode: NavMode) {
  try {
    window.localStorage.setItem(NAV_MODE_KEY, mode);
  } catch {
    /* Sin almacenamiento (ventana privada): el menú vuelve a su ancho al recargar. */
  }
}

export interface AdminShellProps {
  /** Qué pantalla es. Hoy solo documenta; el menú marca la entrada por la dirección. */
  section?: AdminSection;
  /** Rótulo corto sobre el título; también es el último tramo de la ruta. */
  kicker?: string;
  title: string;
  description?: string;
  /** Botonera de la cabecera. */
  actions?: ReactNode;
  /** Riel de la pantalla: sus vistas o estaciones, en el borde bajo de la
      cabecera (ver AdminRail). Así no ocupan una fila propia en el contenido. */
  rail?: ReactNode;
  /** Barra fija inferior de guardado. */
  footer?: ReactNode;
  children: ReactNode;
}

export function AdminShell({ kicker, title, description, actions, rail, footer, children }: AdminShellProps) {
  const { staff, staffRole, profile, session, signOut } = useAuth();
  const { resolved, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();

  const [navOpen, setNavOpen] = useState(false);
  const [navMode, setNavModeState] = useState<NavMode>(readMode);
  const setNavMode = (mode: NavMode) => {
    setNavModeState(mode);
    storeMode(mode);
  };

  const shellRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const opened = useRef(false);

  const entries = useMemo(() => buildStaffNav(staffRole), [staffRole]);
  const activeId = activeNavId(entries, location.pathname, location.search);
  const activeEntry = entries.find((entry) => entry.id === activeId);
  const groups = GROUP_ORDER.map((id) => ({ id, label: NAV_GROUP_LABELS[id], items: entries.filter((e) => e.group === id) })).filter(
    (group) => group.items.length > 0,
  );

  const name = staff?.full_name || profile?.full_name || staff?.email || profile?.email || session?.user.email || "Sesión";
  const email = staff?.email || profile?.email || session?.user.email || "";
  const roleLabel = staffRole ? staffRoleLabels[staffRole] : "";

  // La cabecera es fija y su alto cambia con la descripción y el ancho. Las
  // cabeceras pegajosas de las pantallas se colocan debajo leyendo --admin-topbar-h.
  useEffect(() => {
    const shell = shellRef.current;
    const topbar = topbarRef.current;
    if (!shell || !topbar || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      shell.style.setProperty("--admin-bar-h", "0px");
      shell.style.setProperty("--admin-topbar-h", `${Math.round(topbar.getBoundingClientRect().height)}px`);
    });
    observer.observe(topbar);
    return () => observer.disconnect();
  }, []);

  // El cajón del móvil entra con GSAP. Se abre de vez en cuando, así que admite
  // movimiento; con «reducir movimiento» solo aparece, sin desplazarse.
  useEffect(() => {
    if (!navOpen) {
      opened.current = false;
      return;
    }
    const sidebar = sidebarRef.current;
    const scrim = scrimRef.current;
    if (!sidebar || opened.current) return;
    opened.current = true;
    const mm = gsap.matchMedia();
    mm.add("(max-width: 900px) and (prefers-reduced-motion: no-preference)", () => {
      gsap.fromTo(sidebar, { xPercent: -100 }, { xPercent: 0, duration: 0.26, ease: "power3.out", clearProps: "transform" });
      if (scrim) gsap.fromTo(scrim, { opacity: 0 }, { opacity: 1, duration: 0.2, ease: "power1.out", clearProps: "opacity" });
    });
    return () => mm.revert();
  }, [navOpen]);

  // Navegar o pulsar Escape cierra el cajón: en una aplicación de escritorio
  // nadie busca el ratón para eso.
  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    if (!navOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navOpen]);

  useEffect(() => {
    const before = document.title;
    document.title = `${title} | Administración de Pilo`;
    return () => {
      document.title = before;
    };
  }, [title]);

  // En el modo de íconos el nombre sale al lado del ícono. Se coloca a la altura
  // de la entrada leyendo su posición: es una caja `fixed` y no puede heredarla.
  function placeTip(event: { target: EventTarget }) {
    const tipped = (event.target as HTMLElement).closest?.<HTMLElement>("[data-tip]");
    if (!tipped) return;
    const box = tipped.getBoundingClientRect();
    sidebarRef.current?.style.setProperty("--tip-y", `${Math.round(box.top + box.height / 2)}px`);
  }

  async function handleSignOut() {
    await signOut();
    navigate("/acceso-intranet", { replace: true });
  }

  const crumbs = [activeEntry ? NAV_GROUP_LABELS[activeEntry.group] : "", kicker ?? ""].filter(
    (label, at, all) => label && label !== all[at - 1],
  );

  return (
    <div ref={shellRef} className={`admin-shell${navOpen ? " nav-open" : ""}`} data-nav={navMode}>
      <a className="skip-link" href="#admin-contenido">
        Saltar al contenido
      </a>

      <aside ref={sidebarRef} className="admin-sidebar" id="admin-nav" onPointerOver={placeTip} onFocusCapture={placeTip}>
        <div className="admin-sidebar__head">
          <Link className="admin-brand" to={STAFF_HOME} aria-label="Administración de Pilo · inicio">
            <img src="/pilo-96.webp" alt="" width={36} height={36} />
            <span className="admin-brand__text">
              <strong>Pilo</strong>
              <small>Administración</small>
            </span>
          </Link>
          <button
            type="button"
            className="admin-sidebar__btn admin-sidebar__fold"
            aria-label={navMode === "iconos" ? "Expandir el menú" : "Contraer el menú a íconos"}
            title={navMode === "iconos" ? "Expandir el menú" : "Contraer a íconos"}
            aria-pressed={navMode === "iconos"}
            onClick={() => setNavMode(navMode === "iconos" ? "completo" : "iconos")}
          >
            <Icon name="sidebar" size={17} />
          </button>
        </div>

        <nav className="admin-nav" aria-label="Navegación de la administración">
          {groups.map((group) => (
            <div className="admin-nav__group" key={group.id}>
              <p className="admin-nav__group-label" id={`admin-nav-${group.id}`}>
                {group.label}
              </p>
              <ul aria-labelledby={`admin-nav-${group.id}`}>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <Link
                      to={item.to}
                      className={item.id === activeId ? "is-active" : undefined}
                      aria-current={item.id === activeId ? "page" : undefined}
                      data-tip={item.label}
                    >
                      <Icon name={iconFor(item)} size={18} />
                      <span className="admin-nav__text">{item.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="admin-sidebar__foot">
          <button
            type="button"
            className="admin-sidebar__btn admin-sidebar__hide"
            onClick={() => setNavMode("oculto")}
            data-tip="Ocultar el menú"
          >
            <Icon name="eye-off" size={17} />
            <span className="admin-nav__text">Ocultar el menú</span>
          </button>
        </div>
      </aside>

      {navOpen && (
        <button ref={scrimRef} className="admin-scrim" type="button" aria-label="Cerrar menú" onClick={() => setNavOpen(false)} />
      )}

      <div className="admin-body">
        <header ref={topbarRef} className="admin-topbar" data-rail={rail ? "" : undefined}>
          <div className="admin-topbar__row">
            <button
              className="icon-button admin-nav-toggle"
              type="button"
              aria-expanded={navOpen}
              aria-controls="admin-nav"
              aria-label={navOpen ? "Cerrar menú" : "Abrir menú"}
              onClick={() => setNavOpen((open) => !open)}
            >
              <Icon name={navOpen ? "close" : "menu"} size={18} />
            </button>
            {navMode === "oculto" && (
              <button
                className="icon-button admin-nav-restore"
                type="button"
                aria-controls="admin-nav"
                aria-label="Mostrar el menú"
                title="Mostrar el menú"
                onClick={() => setNavMode("completo")}
              >
                <Icon name="sidebar" size={18} />
              </button>
            )}

            <div className="admin-topbar__copy">
              <nav className="admin-crumbs" aria-label="Ruta">
                <ol>
                  {crumbs.map((label) => (
                    <li key={label}>{label}</li>
                  ))}
                </ol>
              </nav>
              <h1>{title}</h1>
              {/* Una línea, no un párrafo: el texto entero queda en el título del elemento. */}
              {description && (
                <p className="admin-topbar__meta" title={description}>
                  {description}
                </p>
              )}
            </div>

            <div className="admin-topbar__actions">
              {actions}
              <div className="admin-who" title={email || undefined}>
                <span className="admin-who__av" aria-hidden="true">
                  {initials(name, email)}
                </span>
                <span className="admin-who__id">
                  <span className="admin-who__name">{name}</span>
                  {roleLabel && <span className="admin-who__role">{roleLabel}</span>}
                </span>
              </div>
              <button
                className="icon-button theme-toggle"
                type="button"
                onClick={toggle}
                aria-label={resolved === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}
                title={resolved === "dark" ? "Tema claro" : "Tema oscuro"}
              >
                <Icon name={resolved === "dark" ? "sun" : "moon"} size={17} />
              </button>
              <button className="icon-button admin-signout" type="button" onClick={handleSignOut} aria-label="Cerrar sesión" title="Cerrar sesión">
                <Icon name="arrow-left" size={17} />
              </button>
            </div>
          </div>
          {rail && <div className="admin-topbar__rail">{rail}</div>}
        </header>

        <main className="admin-main" id="admin-contenido">
          {children}
        </main>

        {footer && <footer className="admin-savebar">{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * El riel de una pantalla: sus vistas o estaciones, colgadas del borde bajo de
 * la cabecera. Va en la prop `rail` de AdminShell.
 */
export function AdminRail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <nav className="admin-rail" aria-label={label}>
      {children}
    </nav>
  );
}

export function AdminRailTab({
  current,
  count,
  to,
  onSelect,
  children,
}: {
  current: boolean;
  /** Cuántos hay detrás, si importa saberlo antes de entrar. */
  count?: number;
  /** Con dirección es un enlace; si no, un botón que cambia la vista. */
  to?: string;
  onSelect?: () => void;
  children: ReactNode;
}) {
  const content = (
    <>
      {children}
      {count !== undefined && count > 0 && <span className="admin-rail__count">{count}</span>}
    </>
  );
  return to ? (
    <Link to={to} className="admin-rail__tab" aria-current={current ? "page" : undefined}>
      {content}
    </Link>
  ) : (
    <button type="button" className="admin-rail__tab" aria-current={current ? "page" : undefined} onClick={onSelect}>
      {content}
    </button>
  );
}

/** Aviso reutilizable para quien solo puede leer. */
export function ReadOnlyNotice({ children }: { children?: ReactNode }) {
  return (
    <p className="admin-readonly" role="note">
      <Icon name="lock" size={15} />
      {children ?? "Tu rol permite consultar esta información, no modificarla."}
    </p>
  );
}
