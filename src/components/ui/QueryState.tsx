/* =============================================================================
   Estados de una consulta: cargando, error y vacío.

   Con datos escritos a mano ninguno de estos estados existía. Con una base de
   datos los tres son normales, y los tres tienen que verse bien: una pantalla
   en blanco mientras carga, o un error silencioso, se leen como que el portal
   está roto.

   El esqueleto de carga imita la forma del contenido que va a llegar, para que
   la página no dé un salto al aparecer.
   ========================================================================== */

import type { ReactNode } from "react";
import { Icon } from "./Icon";
import { isSupabaseConfigured } from "../../lib/supabase";
import { FriendlyError } from "../../data/errors";

export function LoadingBlock({ rows = 3, label = "Cargando" }: { rows?: number; label?: string }) {
  return (
    <div className="state-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}…</span>
      {Array.from({ length: rows }, (_, index) => (
        <span className="state-skeleton__row" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

export function CardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="state-cards" role="status" aria-live="polite">
      <span className="sr-only">Cargando contenido…</span>
      {Array.from({ length: count }, (_, index) => (
        <span className="state-cards__card" key={index} aria-hidden="true" />
      ))}
    </div>
  );
}

interface ErrorBlockProps {
  error: unknown;
  onRetry?: () => void;
  title?: string;
}

export function ErrorBlock({ error, onRetry, title = "No se pudieron cargar los datos" }: ErrorBlockProps) {
  const message = error instanceof Error ? error.message : "Error desconocido.";
  // Los errores con causa conocida traen instrucciones; mostrarlas evita que
  // alguien tenga que buscar qué significa "schema cache".
  const advice = error instanceof FriendlyError ? error.advice : undefined;
  const original = error instanceof FriendlyError ? error.original : undefined;

  // Causa más frecuente en una instalación nueva: el .env sin rellenar.
  if (!isSupabaseConfigured) {
    return (
      <div className="state-error" role="alert">
        <Icon name="alert" size={20} />
        <div>
          <strong>Falta la conexión con Supabase</strong>
          <p>
            Copia <code>.env.example</code> a <code>.env.local</code> y rellena{" "}
            <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_ANON_KEY</code> con los valores de tu
            proyecto. Después reinicia el servidor de desarrollo.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="state-error" role="alert">
      <Icon name="alert" size={20} />
      <div>
        <strong>{title}</strong>
        <p>{message}</p>
        {advice && <p className="state-error__advice">{advice}</p>}

        {/* El mensaje técnico queda a mano para quien lo necesite, sin ocupar
            la pantalla de quien solo quiere saber si puede reintentar. */}
        {original && original !== message && (
          <details className="state-error__detail">
            <summary>Detalle técnico</summary>
            <code>{original}</code>
          </details>
        )}

        {onRetry && (
          <button className="button-secondary" type="button" onClick={onRetry}>
            Reintentar
          </button>
        )}
      </div>
    </div>
  );
}

interface EmptyBlockProps {
  title: string;
  hint?: string;
  action?: ReactNode;
}

export function EmptyBlock({ title, hint, action }: EmptyBlockProps) {
  return (
    <div className="state-empty">
      <strong>{title}</strong>
      {hint && <p>{hint}</p>}
      {action}
    </div>
  );
}
