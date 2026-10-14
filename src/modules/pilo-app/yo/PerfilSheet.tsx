/* =============================================================================
   Mr. Pilo · «Mis datos»: la hoja con los datos del carnet, por perfil.

   Los obligatorios son los del perfil de la cuenta (estudiante: programa,
   semestre y jornada; profesor: facultad y vinculación; administrativo:
   dependencia y cargo). El código, el tipo de sangre y el contacto son
   opcionales; el código y el RH llevan «Mostrarlo en el carnet». Se guardan en
   la cuenta de Pilo (0141): solo su dueña los lee.
   ========================================================================== */

import { useState } from "react";
import type { FormEvent } from "react";
import { Icon } from "../icons";
import { Field, Msg, Seg } from "../account/parts";
import type { PiloRol } from "../account/rules";
import { fieldsOf, problems, rhLabel, sameForm } from "../carnet/rules";
import type { PerfilField, PerfilForm, PerfilKey } from "../carnet/rules";
import { asCarnetError } from "../carnet/api";
import type { PerfilState } from "../carnet/useCarnet";
import { Sheet } from "../carnet/Sheet";
import { tr, useLang } from "../../../components/pilo/i18n";

export function PerfilSheet({ rol, perfil, onClose, onSaved }: { rol: PiloRol; perfil: PerfilState; onClose: () => void; onSaved: () => void }) {
  return (
    <Sheet label={tr("Mis datos")} onClose={onClose}>
      {(close) => <PerfilForm rol={rol} perfil={perfil} close={close} onSaved={onSaved} />}
    </Sheet>
  );
}

function PerfilForm({ rol, perfil, close, onSaved }: { rol: PiloRol; perfil: PerfilState; close: () => void; onSaved: () => void }) {
  useLang();
  const [form, setForm] = useState<PerfilForm>(perfil.form);
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const found = problems(rol, form);
  const dirty = !sameForm(form, perfil.form);

  const set = <K extends keyof PerfilForm>(key: K, value: PerfilForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFailure("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // La hoja vive dentro del formulario de Yo en el árbol de React: su envío no debe subir hasta él.
    e.stopPropagation();
    if (saving) return;
    setTried(true);
    const first = fieldsOf(rol).find((f) => found[f.key]);
    if (first) {
      document.getElementById(`pf-${first.key}`)?.focus();
      return;
    }
    setSaving(true);
    setFailure("");
    try {
      await perfil.save(form);
      onSaved();
      close();
    } catch (err) {
      setFailure(asCarnetError(err).message);
    } finally {
      setSaving(false);
    }
  };

  const error = (f: PerfilField) => (tried && found[f.key] ? tr(found[f.key] as string) : null);

  return (
    <form className="cn-form" noValidate onSubmit={submit}>
      <h2 className="cn-h">{tr("Mis datos del carnet")}</h2>
      <p className="cn-lead">{tr("Se guardan en su cuenta de Pilo y solo usted los ve. El código y el tipo de sangre aparecen en el carnet únicamente si usted lo decide, y nunca van en el código QR ni en Google Wallet.")}</p>
      <div className="cn-fields">
        {fieldsOf(rol).map((f) => (
          <div key={f.key} className="cn-fieldwrap">
            <Field id={`pf-${f.key}`} label={f.required ? tr(f.label) : `${tr(f.label)} ${tr("(opcional)")}`} error={error(f)}>
              {(aria) => {
                const value = form[f.key];
                if (f.kind === "text") {
                  return <input {...aria} type="text" value={value} maxLength={f.key === "codigo" ? 20 : 120} placeholder={f.example ? tr(f.example) : undefined} autoComplete="off" inputMode={f.key === "codigo" ? "text" : undefined} onChange={(e) => set(f.key as PerfilKey, e.target.value)} />;
                }
                if (f.kind === "pick") {
                  return (
                    <select {...aria} value={value} onChange={(e) => set(f.key as PerfilKey, e.target.value)}>
                      <option value="">{tr("Elegir")}</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o.id} value={o.id}>
                          {f.key === "rh" ? rhLabel(o.id) : o.label}
                        </option>
                      ))}
                    </select>
                  );
                }
                return (
                  <div id={aria.id} aria-describedby={aria["aria-describedby"]}>
                    <Seg label={tr(f.label)} value={value} options={f.options ?? []} onPick={(id) => set(f.key as PerfilKey, id)} />
                  </div>
                );
              }}
            </Field>
            {f.show && (
              <button
                type="button"
                className="cn-check"
                role="checkbox"
                aria-checked={form[f.show] && form[f.key].trim() !== ""}
                disabled={form[f.key].trim() === ""}
                onClick={() => set(f.show as "show_codigo" | "show_rh", !form[f.show as "show_codigo" | "show_rh"])}
              >
                <span className="cn-check__box" aria-hidden="true">
                  {Icon.check}
                </span>
                <span>{tr("Mostrarlo en el carnet")}</span>
              </button>
            )}
          </div>
        ))}
      </div>
      {failure && (
        <Msg tone="bad" alert>
          {failure}
        </Msg>
      )}
      <button type="submit" className="pa-btn pa-btn--main cn-block" disabled={saving || (!dirty && !tried)}>
        {saving ? tr("Guardando…") : tr("Guardar mis datos")}
      </button>
    </form>
  );
}
