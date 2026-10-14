/* Cabecera mínima de las páginas de servicio (acceso, errores): el logo de la UDES y el nombre de Pilo. */
import { Link } from "react-router-dom";

export function PiloBar() {
  return (
    <header className="pilo-bar">
      <Link to="/" className="pilo-bar__brand" aria-label="Pilo AI, inicio">
        <img src="/logo-udes.svg" alt="Universidad de Santander" height={36} />
        <span>Pilo AI</span>
      </Link>
    </header>
  );
}
