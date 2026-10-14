/* =============================================================================
   Intranet · Mr. Pilo con IA · las piezas que se repiten.

   Una sola forma para cada cosa en todo el módulo: el interruptor, la hoja de
   una sección con sus grupos separados por un filete (no tarjetas dentro de
   tarjetas), la clave guardada en el servidor y el aviso de estado con glifo
   y palabra (nunca solo color).
   ========================================================================== */

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "../../../components/ui/Icon";
import { useSetKey } from "./store";
import type { KeySlot } from "./store";

export type SwitchProps = { on: boolean; onChange: (v: boolean) => void; label: string; big?: boolean; disabled?: boolean };

export function Switch({ on, onChange, label, big = false, disabled = false }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      className="pis-switch"
      data-big={big || undefined}
      disabled={disabled}
      onClick={() => onChange(!on)}
    >
      <i />
    </button>
  );
}

/** Un grupo dentro de la hoja de una sección: título, nota a la derecha y su contenido. */
export function Group({ title, aside, id, children }: { title: string; aside?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section className="pis-group" aria-label={title} id={id}>
      <header className="pis-group__head">
        <h3>{title}</h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

export type Tone = "ok" | "warn" | "fail" | "off";

/** Estado con glifo y palabra. */
export function StatusMark({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="pis-mark" data-tone={tone}>
      <i aria-hidden="true">{tone === "ok" ? <Icon name="check" size={12} /> : tone === "off" ? null : <Icon name="alert" size={12} />}</i>
      {children}
    </span>
  );
}

/** Una clave: se ve si hay y cómo termina; se cambia escribiéndola de nuevo. Se guarda al momento. */
export function KeyField({ which, label, has, last4 }: { which: KeySlot | "texto"; label: string; has: boolean; last4: string }) {
  const setKey = useSetKey();
  const [editing, setEditing] = useState(!has);
  const [value, setValue] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => setEditing(!has), [has]);

  return (
    <div className="pis-key">
      <span className="pis-key__label">
        {label}
        <small>Se guarda al momento, aparte de «Guardar cambios».</small>
      </span>
      {editing ? (
        <form
          className="pis-key__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!value.trim()) return;
            setKey.mutate({ key: value, which }, { onSuccess: () => { setValue(""); setEditing(false); } });
          }}
        >
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={value}
            placeholder="Pegue aquí la clave"
            aria-label={label}
            onChange={(e) => setValue(e.target.value)}
          />
          <button type="submit" className="button-primary" disabled={!value.trim() || setKey.isPending}>
            {setKey.isPending ? "Guardando…" : "Guardar clave"}
          </button>
          {has && (
            <button type="button" className="button-secondary" onClick={() => setEditing(false)}>
              Cancelar
            </button>
          )}
        </form>
      ) : confirmRemove ? (
        <div className="pis-key__saved pis-key__saved--confirm" role="alert">
          <span>¿Quitar la clave? Mr. Pilo deja de poder usar este servicio hasta que pegue otra.</span>
          <button type="button" className="button-secondary" onClick={() => setConfirmRemove(false)}>
            No, dejarla
          </button>
          <button
            type="button"
            className="button-primary pis-danger"
            disabled={setKey.isPending}
            onClick={() => setKey.mutate({ key: "", which }, { onSettled: () => setConfirmRemove(false) })}
          >
            Quitar la clave
          </button>
        </div>
      ) : (
        <div className="pis-key__saved">
          <Icon name="lock" size={17} />
          <span>
            Guardada en el servidor · termina en <b>••••{last4}</b>
          </span>
          <button type="button" className="button-secondary" onClick={() => setEditing(true)}>
            Cambiar clave
          </button>
          <button type="button" className="pis-link pis-link--danger" onClick={() => setConfirmRemove(true)}>
            Quitar
          </button>
        </div>
      )}
      {setKey.isError && (
        <p className="pis-error" role="alert">
          No se guardó la clave: {(setKey.error as Error).message}
        </p>
      )}
    </div>
  );
}

/**
 * Un número con margen (el mismo de la base). Lo que se escribe fuera de margen
 * no se guarda en el estado: el campo lo marca y, al salir, vuelve al último
 * valor bueno. El valor de partida se ve como sugerencia.
 */
export function NumField({
  label,
  hint,
  value,
  min,
  max,
  whole,
  step,
  def,
  disabled,
  onCommit,
}: {
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  whole: boolean;
  step?: number;
  def: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft((d) => (Number(d) === value && d.trim() !== "" ? d : String(value))), [value]);
  const n = Number(draft);
  const bad = draft.trim() === "" || !Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n));
  const range = `${min.toLocaleString("es-CO")} a ${max.toLocaleString("es-CO")}`;
  return (
    <label>
      {label}
      <input
        type="number"
        inputMode={whole ? "numeric" : "decimal"}
        min={min}
        max={max}
        step={step ?? (whole ? 1 : 0.1)}
        value={draft}
        placeholder={String(def)}
        disabled={disabled}
        aria-invalid={bad || undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          const v = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max && (!whole || Number.isInteger(v))) onCommit(v);
        }}
        onBlur={() => bad && setDraft(String(value))}
      />
      <small data-bad={bad || undefined}>
        {bad ? (
          <>
            <Icon name="alert" size={12} /> Entre {range}
            {whole ? ", sin decimales" : ""}.
          </>
        ) : (
          `${hint ? `${hint} · ` : ""}De partida ${def.toLocaleString("es-CO")} · de ${range}`
        )}
      </small>
    </label>
  );
}

export const when =(iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "nunca";

export const plural = (n: number, one: string, many: string) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;
