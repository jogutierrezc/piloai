/* =============================================================================
   Mr. Pilo · la autorización para leer Génesis o Moodle.

   La tarjeta amistosa del diseño: «¿Me deja ver…?», las cuatro promesas y dos
   casillas (la que autoriza, y la opcional de mantener la conexión en el
   dispositivo). Se pide por separado para cada plataforma y cada vez que se
   conecta: sin la primera casilla no se continúa.

   Es una pieza suelta: no consulta nada ni guarda nada. Avisa con
   `onAuthorize({ platform, keep })` cuando la persona autoriza, y quien la
   monta decide qué sigue (pedir la contraseña, consultar, guardar el permiso
   en el dispositivo si `keep`). Va dentro de la app (`.pa`): sus colores son
   los del tema.

     <DataConsent platform="moodle" onAuthorize={({ keep }) => conectar(keep)} />
   ========================================================================== */

import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Pilo } from "../../pregunta/Pilo";
import type { PiloMojiHandle } from "../../pregunta/Pilo";
import { reducedMotion } from "../pwa";
import { AUTHORIZE_LABEL, AUTHORIZE_WHY, CONSENT_TEXTS, KEEP_LABEL, SEE_POLICY_LABEL, consentNote } from "./consent";
import type { ConsentChoice, DataPlatform } from "./consent";
import { POLICY_PATH } from "./policy";
import { TermsIcon } from "./GoldenRules";
import "./terms.css";

export function DataConsent({
  platform,
  onAuthorize,
  busy = false,
  headingLevel = 2,
  policyHref = `${POLICY_PATH}#p4`,
  className,
}: {
  platform: DataPlatform;
  /** La persona autorizó la consulta; `keep` dice si pidió mantener la conexión en este dispositivo. */
  onAuthorize: (choice: ConsentChoice) => void;
  /** Quien la monta está conectando: el botón espera. */
  busy?: boolean;
  /** El nivel del título, según dónde se monte. */
  headingLevel?: 2 | 3;
  /** A dónde lleva «Ver la política» (por defecto, a la sección de Génesis y Moodle). Se abre en otra pestaña. */
  policyHref?: string;
  className?: string;
}) {
  const id = useId();
  const pilo = useRef<PiloMojiHandle>(null);
  const box = useRef<HTMLInputElement>(null);
  const pointerAt = useRef(0);
  const [ok, setOk] = useState(false);
  const [keep, setKeep] = useState(false);
  const [missed, setMissed] = useState(false);
  const [done, setDone] = useState<ConsentChoice | null>(null);
  const t = CONSENT_TEXTS[platform];
  const Heading = `h${headingLevel}` as "h2" | "h3";

  // Cada plataforma se autoriza por separado: al cambiar, se empieza de cero.
  useEffect(() => {
    setOk(false);
    setKeep(false);
    setMissed(false);
    setDone(null);
    pilo.current?.mood("feliz");
  }, [platform]);

  const toggle = (on: boolean) => {
    setOk(on);
    if (on) setMissed(false);
    // Retirar la casilla retira lo autorizado.
    else setDone(null);
    pilo.current?.mood(on ? "sorpresa" : "feliz");
    if (on && performance.now() - pointerAt.current < 900 && !reducedMotion()) pilo.current?.nod();
  };

  const authorize = () => {
    if (busy) return;
    if (!ok) {
      setMissed(true);
      box.current?.focus();
      return;
    }
    const choice: ConsentChoice = { platform, keep };
    setDone(choice);
    onAuthorize(choice);
  };

  return (
    <section className={className ? `pt-card ${className}` : "pt-card"} aria-labelledby={`${id}-h`} onPointerDownCapture={() => (pointerAt.current = performance.now())}>
      <header className="pt-card__head">
        {/* La cara oficial, entera y a su proporción. */}
        <div className="pt-card__face">
          <Pilo ref={pilo} size="100%" alive label="Mr. Pilo" />
        </div>
        <div>
          <Heading id={`${id}-h`}>{t.question}</Heading>
          <p>{t.lead}</p>
        </div>
      </header>
      <div className="pt-card__body">
        <ul className="pt-promise" aria-label={`Lo que Pilo promete al consultar ${t.name}`}>
          {t.promises.map((p) => (
            <li key={p.title}>
              <TermsIcon>
                <path d="M3.5 9.5l3.5 3.5 7.5-7.5" />
              </TermsIcon>
              <div>
                <b>{p.title}</b>
                <span>{p.text}</span>
              </div>
            </li>
          ))}
        </ul>
        <label className="pt-consent" htmlFor={`${id}-ok`}>
          <input
            ref={box}
            id={`${id}-ok`}
            type="checkbox"
            checked={ok}
            aria-invalid={missed || undefined}
            aria-describedby={missed ? `${id}-why` : undefined}
            onChange={(e) => toggle(e.target.checked)}
          />
          <span>{t.authorize}</span>
        </label>
        <label className="pt-consent pt-consent--plain" htmlFor={`${id}-keep`}>
          <input
            id={`${id}-keep`}
            type="checkbox"
            checked={keep}
            onChange={(e) => {
              setKeep(e.target.checked);
              // Lo ya autorizado se vuelve a confirmar con lo que ahora pide.
              setDone(null);
            }}
          />
          <span>{KEEP_LABEL}</span>
        </label>
        <div className="pt-row">
          <button type="button" className="pa-btn pa-btn--main pt-go" aria-disabled={!ok || busy} aria-describedby={ok ? undefined : `${id}-why`} onClick={authorize}>
            {busy ? "Un momento…" : AUTHORIZE_LABEL}
          </button>
          <Link className="pt-link" to={policyHref} target="_blank" rel="noopener">
            {SEE_POLICY_LABEL}
          </Link>
        </div>
        {!ok && missed && (
          <p className="pt-hint" id={`${id}-why`} data-missed role="alert">
            {AUTHORIZE_WHY}
          </p>
        )}
        {!ok && !missed && (
          <p className="pa-sr" id={`${id}-why`}>
            {AUTHORIZE_WHY}
          </p>
        )}
        <p className="pt-hint" aria-live="polite">
          {consentNote(done)}
        </p>
      </div>
    </section>
  );
}
