import { Link } from "react-router-dom";
import { PiloBar } from "../components/layout/PiloBar";
import { useAuth } from "../lib/auth";
import { forbiddenMessage } from "../lib/staff-access";

export function NotFound() {
  return (
    <>
      <PiloBar />
      <section className="u-container notfound">
        <span className="eyebrow">Error 404</span>
        <h1>Esta página no existe</h1>
        <p className="lede">El enlace puede estar desactualizado o la sección se movió.</p>
        <div className="notfound__actions">
          <Link className="button-primary" to="/">
            Hablar con Pilo <span data-arrow aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}

/** Ruta de administración sin permiso: la página existe, pero el rol no alcanza. */
export function Forbidden() {
  const { session, staffRole } = useAuth();
  return (
    <>
      <PiloBar />
      <section className="u-container notfound">
        <span className="eyebrow">Acceso restringido</span>
        <h1>No tienes permiso para esta sección</h1>
        <p className="lede">
          {session ? forbiddenMessage(staffRole) : "Inicia sesión con una cuenta autorizada para continuar."}
        </p>
        <div className="notfound__actions">
          {staffRole && (
            <Link className="button-primary" to="/admin">
              Ir al panel <span data-arrow aria-hidden="true">→</span>
            </Link>
          )}
          <Link className={staffRole ? "button-secondary" : "button-primary"} to="/">
            Volver a Pilo <span data-arrow aria-hidden="true">→</span>
          </Link>
        </div>
      </section>
    </>
  );
}
