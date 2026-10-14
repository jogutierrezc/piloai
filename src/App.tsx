/* =============================================================================
   Enrutado de Pilo AI.
   Público: /pregunta (Pilo Universidad), /pilo-ensenanza, /app (instalable),
   /pilo-embed (el chat emergente para otros portales) y /pilo-politica.
   Administración (personal de Pilo, con sesión): /admin (inicio), /admin/mr-pilo,
   /admin/mr-pilo-ensenanza y /admin/personal; cada una con su guarda por zona.
   La guarda decide qué interfaz se muestra; la autorización real está en las
   políticas RLS de la base de datos.
   ========================================================================== */

import { Suspense, lazy } from "react";
import type { ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AlertaEmergencia } from "./components/alertas/AlertaEmergencia";
import { useAuth } from "./lib/auth";
import type { PiloSpaceId, StaffArea } from "./lib/pilo-staff";
import { guardDecision } from "./lib/staff-access";

const AskPilo = lazy(() => import("./modules/pregunta/AskPilo").then((m) => ({ default: m.AskPilo })));
const PiloEmbed = lazy(() => import("./modules/pilo-embed/PiloEmbed").then((m) => ({ default: m.PiloEmbed })));
const PiloApp = lazy(() => import("./modules/pilo-app/PiloApp").then((m) => ({ default: m.PiloApp })));
const PiloPolicy = lazy(() => import("./modules/pilo-app/terms/PolicyPage").then((m) => ({ default: m.PolicyPage })));
const LoginPortal = lazy(() => import("./modules/login/LoginPortal").then((m) => ({ default: m.LoginPortal })));
const NotFound = lazy(() => import("./routes/NotFound").then((m) => ({ default: m.NotFound })));
const Forbidden = lazy(() => import("./routes/NotFound").then((m) => ({ default: m.Forbidden })));
const PiloAiSettings = lazy(() =>
  import("./modules/admin/pilo/PiloAiSettings").then((m) => ({ default: m.PiloAiSettings })),
);
const PiloEnsenanzaSettings = lazy(() =>
  import("./modules/admin/pilo-ensenanza/PiloEnsenanza").then((m) => ({ default: m.PiloEnsenanzaSettings })),
);
const Launcher = lazy(() => import("./modules/admin/launcher/Launcher").then((m) => ({ default: m.Launcher })));
const Personal = lazy(() => import("./modules/admin/personal/Personal").then((m) => ({ default: m.Personal })));
const PiloPresentation = lazy(() =>
  import("./modules/admin/pilo/presentacion/Presentation").then((m) => ({ default: m.Presentation })),
);

export function RouteFallback() {
  return (
    <div className="route-fallback" role="status" aria-live="polite">
      <span className="route-fallback__spinner" aria-hidden="true" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}

/**
 * Guarda de la administración: sin sesión, al acceso; con sesión pero sin la
 * zona (o el espacio) que pide la ruta, a «sin permiso». Quien tiene sesión y
 * ningún rol de Pilo se trata como sin acceso.
 */
function RequireStaff({
  area,
  space,
  children,
}: {
  area: StaffArea;
  space?: PiloSpaceId;
  children: ReactElement;
}) {
  const { loading, session, staffRole } = useAuth();
  const location = useLocation();
  const decision = guardDecision({ loading, signedIn: Boolean(session), role: staffRole, area, space });
  if (decision === "wait") return <RouteFallback />;
  if (decision === "login") return <Navigate to="/acceso-intranet" replace state={{ from: location.pathname + location.search }} />;
  if (decision === "forbidden") return <Navigate to="/sin-permiso" replace state={{ from: location.pathname }} />;
  return children;
}

export default function App() {
  return (
    <>
      {/* La capa de emergencias: dormida hasta que Aluna declare una, y entonces cubre cualquier página. */}
      <AlertaEmergencia />
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to="/pregunta" replace />} />
          <Route path="/pregunta" element={<AskPilo />} />
          <Route path="/pilo-ensenanza" element={<AskPilo key="ensenanza" space="ensenanza" />} />
          <Route path="/pilo-embed" element={<PiloEmbed />} />
          <Route path="/pilo-ensenanza-embed" element={<PiloEmbed key="ensenanza" space="ensenanza" />} />
          <Route path="/app/*" element={<PiloApp />} />
          <Route path="/pilo-politica" element={<PiloPolicy />} />
          <Route path="/acceso-intranet" element={<LoginPortal />} />

          <Route
            path="/admin"
            element={
              <RequireStaff area="inicio">
                <Launcher />
              </RequireStaff>
            }
          />
          {/* La pantalla de Pilo Universidad: la abren quienes trabajan el espacio «planeacion». */}
          <Route
            path="/admin/mr-pilo"
            element={
              <RequireStaff area="documentos" space="planeacion">
                <PiloAiSettings />
              </RequireStaff>
            }
          />
          <Route
            path="/admin/mr-pilo-ensenanza"
            element={
              <RequireStaff area="documentos" space="ensenanza">
                <PiloEnsenanzaSettings />
              </RequireStaff>
            }
          />
          <Route
            path="/admin/mr-pilo/presentacion"
            element={
              <RequireStaff area="conexion">
                <PiloPresentation />
              </RequireStaff>
            }
          />
          <Route
            path="/admin/personal"
            element={
              <RequireStaff area="personal">
                <Personal />
              </RequireStaff>
            }
          />
          <Route path="/sin-permiso" element={<Forbidden />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Suspense>
    </>
  );
}
