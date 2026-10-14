/* =============================================================================
   Mr. Pilo · «Le quedan N preguntas · Ver mis límites».

   Un aviso pequeño para el chat. Solo aparece cuando la cuenta lleva el 80 % o
   más de su tope de preguntas (o ya lo agotó); con `always` se muestra siempre
   que haya un tope. Sin tope fijo, sin cuenta o sin uso conocido, no dice nada:
   nunca muestra una cifra que el servidor no tenga.

   Se monta dentro del chat, así:
     <LimitBanner state={cuenta} space={space.id} refreshKey={turnos.length} />
   «Ver mis límites» lleva a /app/perfil#limites (o llama a `onOpen`).
   ========================================================================== */

import { Link } from "react-router-dom";
import { APP_PROFILE } from "../routes";
import type { AccountState } from "../account/useAccount";
import { Glyph } from "../carnet/glyphs";
import { bannerText } from "./logic";
import { useLimites } from "./useLimites";
import { tr, useLang } from "../../../components/pilo/i18n";
import "./limites.css";

export function LimitBanner({ state, space, refreshKey = 0, always = false, onOpen }: { state: AccountState; space: string; refreshKey?: number | string; always?: boolean; onOpen?: () => void }) {
  useLang();
  const { spaces } = useLimites(state, refreshKey);
  const text = bannerText(spaces.find((s) => s.space === space)?.questions ?? null, always);
  if (!text) return null;
  const link = tr("Ver mis límites");
  return (
    <p className="lm-banner" role="status">
      {Glyph.info}
      <span>{text}</span>
      {onOpen ? (
        <button type="button" onClick={onOpen}>
          {link}
        </button>
      ) : (
        <Link to={`${APP_PROFILE}#limites`}>{link}</Link>
      )}
    </p>
  );
}
