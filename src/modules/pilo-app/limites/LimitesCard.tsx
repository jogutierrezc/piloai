/* =============================================================================
   Mr. Pilo · «Mis límites de Pilo» (en Yo).

   Lo que la administración le asignó a la cuenta en cada Pilo y cuánto lleva
   gastado. Un tope por ventana de tiempo se dibuja como barra con su número
   («12 de 60»); al 80 % la barra lleva un aviso con glifo y palabras, no solo
   color. Lo que no tiene tope dice «Sin tope fijo». Ver logic.ts.
   ========================================================================== */

import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { Icon } from "../icons";
import { APP_PILOS } from "../routes";
import type { SpaceId } from "../../pregunta/space";
import type { AccountState } from "../account/useAccount";
import { Glyph } from "../carnet/glyphs";
import { renewText } from "./logic";
import type { LimitRow, Meter } from "./logic";
import { useLimites } from "./useLimites";
import { tr, useLang } from "../../../components/pilo/i18n";
import "./limites.css";

function Bar({ label, meter }: { label: string; meter: Meter }) {
  return (
    <div className="lm-meter" data-warn={meter.warn || undefined}>
      <div className="lm-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={meter.max} aria-valuenow={meter.used}>
        <i style={{ width: `${Math.round(meter.pct * 100)}%` }} />
      </div>
      <p className="lm-count">{tr("{used} de {max}", { used: meter.used, max: meter.max })}</p>
      {meter.warn && (
        <p className="lm-warn">
          {Glyph.alert}
          {meter.spent ? tr("Llegó al límite. Se renueva en {t}.", { t: renewText(meter.renews) }) : tr("Le quedan {n}. Se renuevan en {t}.", { n: meter.left, t: renewText(meter.renews) })}
        </p>
      )}
    </div>
  );
}

function Row({ row }: { row: LimitRow }) {
  return (
    <div className="lm-row" data-off={row.off || undefined}>
      <div className="lm-line">
        <span>
          {row.label}
          {row.note && <small>{row.note}</small>}
        </span>
        <b>
          {row.off && Icon.close}
          {row.value}
        </b>
      </div>
      {row.meter && <Bar label={row.label} meter={row.meter} />}
    </div>
  );
}

export function LimitesCard({ state }: { state: AccountState }) {
  useLang();
  const { spaces, loading, failed, noUsage } = useLimites(state);
  const { hash } = useLocation();
  // «Ver mis límites» llega con #limites: se lleva la vista hasta aquí (sin movimiento si así se pidió).
  useEffect(() => {
    if (hash !== "#limites") return;
    document.getElementById("limites")?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [hash, spaces.length]);
  return (
    <section className="lm-card" id="limites" aria-labelledby="lm-title">
      <h2 className="pc-h" id="lm-title">
        {tr("Mis límites de Pilo")}
      </h2>
      <p className="pc-hint">{tr("Los fija la administración de Pilo para su cuenta.")}</p>
      {loading && (
        <p className="pc-hint" role="status">
          {tr("Leyendo sus límites…")}
        </p>
      )}
      {failed && !spaces.length && (
        <p className="pc-hint" role="status">
          {tr("No se pudieron leer sus límites ahora.")}
        </p>
      )}
      {spaces.map((s) => (
        <div className="lm-space" key={s.space}>
          <p className="pc-label">{tr(APP_PILOS[s.space as SpaceId]?.label ?? s.space)}</p>
          {s.rows.map((r) => (
            <Row key={r.id} row={r} />
          ))}
        </div>
      ))}
      {noUsage && spaces.length > 0 && <p className="pc-hint">{tr("Lo que lleva gastado no está disponible por ahora; se ven solo los topes.")}</p>}
    </section>
  );
}
