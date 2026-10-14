/* =============================================================================
   Personal de Pilo · formulario «Invitar».

   Sin ventana: es un panel que se despliega sobre la lista. Pide correo, nombre
   y rol (cada rol con su descripción del contrato). La función `pilo-staff`
   crea la cuenta y manda el correo para que la persona defina su contraseña.

   Tres desenlaces, siempre dichos con texto:
   - Enviada: se avisa y se puede invitar a otra persona.
   - No salió el correo (`sent: false`): se muestra el enlace con «Copiar»,
     para entregarlo a mano.
   - El correo ya tiene cuenta (`cuenta`, p. ej. de PDI): se ofrece «Dar rol de
     Pilo a esa cuenta», que escribe en pilo_staff con los permisos de quien
     administra. Si no se puede, se explica por qué.

   Abrir y cerrar el panel se anima poco (se usa de vez en cuando); con menos
   movimiento, solo un fundido. Un error sacude el formulario apenas.
   ========================================================================== */

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Icon } from "../../../components/ui/Icon";
import { STAFF_ROLES, staffRoleDescriptions, staffRoleLabels } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { collapse, expand, shake } from "../motion/presets";
import { StaffError, grantExistingAccount, inviteStaff } from "./personal-api";
import type { InviteResult } from "./personal-api";
import { inviteProblems, inviteValid, normalizeEmail, staffErrorText } from "./personal-logic";
import type { InviteDraft } from "./personal-logic";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Se invitó o se dio el rol: la lista se vuelve a leer y se avisa. */
  onChanged: (message: string) => void;
}

const EMPTY: InviteDraft = { email: "", name: "", role: "" };

export function InvitePanel({ open, onClose, onChanged }: Props) {
  const uid = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const first = useRef(true);
  const [draft, setDraft] = useState<InviteDraft>(EMPTY);
  const [tried, setTried] = useState(false);
  const [done, setDone] = useState<{ result: InviteResult; email: string } | null>(null);
  const [granted, setGranted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Abrir despliega; cerrar repliega. La primera vez no se anima (nace cerrado).
  useEffect(() => {
    const el = panelRef.current;
    if (first.current) {
      first.current = false;
      if (el) el.hidden = !open;
      return;
    }
    if (open) {
      const handle = expand(el);
      emailRef.current?.focus({ preventScroll: false });
      return () => handle.kill();
    }
    const handle = collapse(el);
    return () => handle.kill();
  }, [open]);

  const problems = inviteProblems(draft);
  const invite = useMutation({
    mutationFn: () => inviteStaff({ email: draft.email, name: draft.name, role: draft.role as PiloStaffRole }),
    onSuccess: (result) => {
      setDone({ result, email: normalizeEmail(draft.email) });
      onChanged(`${draft.name.trim()} se agregó al personal.`);
    },
    onError: () => {
      shake(formRef.current);
    },
  });
  const grant = useMutation({
    mutationFn: () => grantExistingAccount({ email: draft.email, name: draft.name, role: draft.role as PiloStaffRole }),
    onSuccess: () => {
      setGranted(normalizeEmail(draft.email));
      invite.reset();
      onChanged(`${draft.name.trim()} ya tiene rol de Pilo.`);
    },
  });

  const reset = () => {
    setDraft(EMPTY);
    setTried(false);
    setDone(null);
    setGranted(null);
    setCopied(false);
    invite.reset();
    grant.reset();
    emailRef.current?.focus();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!inviteValid(problems)) {
      shake(formRef.current);
      return;
    }
    grant.reset();
    invite.mutate();
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2400);
    } catch {
      // Sin permiso del portapapeles: se deja el enlace seleccionado para copiarlo a mano.
      document.getElementById(`${uid}-link`)?.focus();
      (document.getElementById(`${uid}-link`) as HTMLInputElement | null)?.select();
    }
  };

  const inviteError = invite.error instanceof StaffError ? invite.error : invite.isError ? new StaffError("otro", staffErrorText(undefined)) : null;
  const finished = done !== null || granted !== null;

  return (
    <div ref={panelRef} className="ps-invite" hidden>
      <div className="ps-invite__inner">
        <header className="ps-section__head">
          <h2 id={`${uid}-h`}>Invitar a una persona</h2>
          <button type="button" className="ps-btn ps-btn--quiet" onClick={onClose}>
            <Icon name="close" size={16} />
            Cerrar
          </button>
        </header>

        {granted ? (
          <div className="ps-note ps-note--ok" role="status">
            <Icon name="check" size={18} />
            <p>
              <strong>{granted}</strong> ya tiene el rol de {staffRoleLabels[draft.role as PiloStaffRole]} en Pilo. Entra con la contraseña de su cuenta de siempre.
            </p>
            <button type="button" className="ps-btn" onClick={reset}>
              Invitar a otra persona
            </button>
          </div>
        ) : done ? (
          <div className="ps-done">
            {done.result.sent ? (
              <div className="ps-note ps-note--ok" role="status">
                <Icon name="mail" size={18} />
                <p>
                  Se envió la invitación a <strong>{done.email}</strong>. Recibirá un correo para definir su contraseña.
                </p>
              </div>
            ) : done.result.link ? (
              <div className="ps-note ps-note--warn" role="status">
                <Icon name="alert" size={18} />
                <div>
                  <p>
                    La cuenta de <strong>{done.email}</strong> se creó, pero el correo no salió. Entréguele este enlace para que defina su contraseña:
                  </p>
                  <div className="ps-copy">
                    <label className="sr-only" htmlFor={`${uid}-link`}>
                      Enlace para definir la contraseña
                    </label>
                    <input id={`${uid}-link`} readOnly value={done.result.link} onFocus={(e) => e.currentTarget.select()} />
                    <button type="button" className="ps-btn ps-btn--primary" onClick={() => void copy(done.result.link ?? "")}>
                      {copied ? "Copiado" : "Copiar"}
                    </button>
                  </div>
                  <small>El enlace es personal y caduca: no lo comparta por canales abiertos.</small>
                </div>
              </div>
            ) : (
              <div className="ps-note ps-note--warn" role="status">
                <Icon name="alert" size={18} />
                <p>{staffErrorText(done.result.note ?? "sin_enlace")}</p>
              </div>
            )}
            <button type="button" className="ps-btn" onClick={reset}>
              Invitar a otra persona
            </button>
          </div>
        ) : (
          <form ref={formRef} onSubmit={submit} noValidate aria-labelledby={`${uid}-h`}>
            <div className="ps-grid">
              <div className="ps-field">
                <label htmlFor={`${uid}-email`}>Correo</label>
                <input
                  id={`${uid}-email`}
                  ref={emailRef}
                  type="email"
                  inputMode="email"
                  autoComplete="off"
                  spellCheck={false}
                  value={draft.email}
                  aria-invalid={tried && !!problems.email}
                  aria-describedby={tried && problems.email ? `${uid}-email-e` : undefined}
                  onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                />
                {tried && problems.email && (
                  <small id={`${uid}-email-e`} className="ps-field__error">
                    {problems.email}
                  </small>
                )}
              </div>
              <div className="ps-field">
                <label htmlFor={`${uid}-name`}>Nombre completo</label>
                <input
                  id={`${uid}-name`}
                  autoComplete="off"
                  value={draft.name}
                  aria-invalid={tried && !!problems.name}
                  aria-describedby={tried && problems.name ? `${uid}-name-e` : undefined}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
                {tried && problems.name && (
                  <small id={`${uid}-name-e`} className="ps-field__error">
                    {problems.name}
                  </small>
                )}
              </div>
            </div>

            <fieldset className="ps-pick" aria-describedby={tried && problems.role ? `${uid}-role-e` : undefined}>
              <legend>Rol</legend>
              <div className="ps-pick__list">
                {STAFF_ROLES.map((role) => (
                  <label key={role} className="ps-pick__opt">
                    <input type="radio" name={`${uid}-role`} value={role} checked={draft.role === role} onChange={() => setDraft({ ...draft, role })} />
                    <span>
                      <strong>{staffRoleLabels[role]}</strong>
                      <small>{staffRoleDescriptions[role]}</small>
                    </span>
                  </label>
                ))}
              </div>
              {tried && problems.role && (
                <small id={`${uid}-role-e`} className="ps-field__error">
                  {problems.role}
                </small>
              )}
            </fieldset>

            {inviteError && (
              <div className="ps-note ps-note--fail" role="alert">
                <Icon name="alert" size={18} />
                <div>
                  <p>{inviteError.message}</p>
                  {inviteError.code === "cuenta" && (
                    <>
                      <p>
                        Si la persona ya trabaja con su cuenta de PDI, puede darle el rol de Pilo a esa misma cuenta.
                      </p>
                      <button type="button" className="ps-btn" disabled={grant.isPending} onClick={() => grant.mutate()}>
                        {grant.isPending ? "Dando el rol…" : "Dar rol de Pilo a esa cuenta"}
                      </button>
                    </>
                  )}
                </div>
              </div>
            )}
            {grant.isError && (
              <div className="ps-note ps-note--fail" role="alert">
                <Icon name="alert" size={18} />
                <p>{(grant.error as Error).message}</p>
              </div>
            )}

            <div className="ps-invite__actions">
              <button type="button" className="ps-btn" onClick={onClose}>
                Cancelar
              </button>
              <button type="submit" className="ps-btn ps-btn--primary" disabled={invite.isPending || grant.isPending || finished}>
                {invite.isPending ? "Enviando…" : "Enviar invitación"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
