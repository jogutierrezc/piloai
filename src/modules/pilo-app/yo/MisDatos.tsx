/* =============================================================================
   Mr. Pilo · Yo · «Mis datos»: la fila que abre la hoja de los datos del carnet.

   Dice cuántos datos obligatorios del perfil están listos y, tocándola, abre la
   hoja. Los mismos datos alimentan el carnet (/app/carnet).
   ========================================================================== */

import { useState } from "react";
import { Icon } from "../icons";
import type { AccountState } from "../account/useAccount";
import type { PiloRol } from "../account/rules";
import { Glyph } from "../carnet/glyphs";
import { progress } from "../carnet/rules";
import { usePerfil } from "../carnet/useCarnet";
import { PerfilSheet } from "./PerfilSheet";
import { tr, useLang } from "../../../components/pilo/i18n";
import "../carnet/carnet.css";

export function MisDatos({ state }: { state: AccountState }) {
  useLang();
  const perfil = usePerfil(state);
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState(false);
  const account = state.account;
  if (!account) return null;
  const done = progress(account.rol as PiloRol, perfil.form);
  const text = perfil.error ? perfil.error.message : perfil.loading ? tr("Leyendo sus datos…") : done.full ? tr("Todo listo") : tr("{ok} de {total} datos listos", { ok: done.ok, total: done.total });
  return (
    <section className="pc-sheet" aria-labelledby="yo-datos">
      <div className="pc-sheet__in">
        <h2 className="pc-h" id="yo-datos">
          {tr("Mis datos")}
        </h2>
        <div className="cn-list">
          <button type="button" className="cn-row" onClick={() => setOpen(true)} disabled={Boolean(perfil.error)}>
            <span className="cn-row__i">{Icon.id}</span>
            <span className="cn-row__t">
              <b>{tr("Mi perfil y datos del carnet")}</b>
              <small>{text}</small>
            </span>
            {Glyph.right}
          </button>
        </div>
        <p className="pc-hint" role="status">
          {saved ? tr("Datos guardados en su cuenta.") : tr("Solo usted los ve. El código y el tipo de sangre salen en el carnet únicamente si usted lo decide.")}
        </p>
      </div>
      {open && <PerfilSheet rol={account.rol as PiloRol} perfil={perfil} onClose={() => setOpen(false)} onSaved={() => setSaved(true)} />}
    </section>
  );
}
