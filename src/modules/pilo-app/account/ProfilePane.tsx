/* =============================================================================
   Mr. Pilo · cuentas (0120) · /app/perfil.

   Con cuenta: arriba, quién es (nombre, usuario, perfil y sede). Después, la
   manera en que Pilo le habla y le responde (cómo le dice, el tono, la
   extensión, lo que Pilo debe saber de usted, su programa y, si el correo no
   la fija, la sede), con la muestra de cómo respondería Pilo a la vista
   mientras se ajusta: al lado en el escritorio, justo encima en el teléfono.
   Al final y aparte, la cuenta (lo que no se cambia aquí) y «Cerrar sesión».
   Se guarda con `pilo_user_update_prefs`; «Guardar» aparece cuando hay algo
   que guardar. El tema de la app (doce, en tres grupos) está aquí, bajo el
   encabezado, y también en Ajustes (el menú).

   Sin cuenta: las dos preferencias de un visitante (cómo le dice y el tono),
   que quedan en este dispositivo, y lo que gana quien se registra.

   Sin cuenta, además, el tema de la app.
   ========================================================================== */

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { Pilo } from "../../pregunta/Pilo";
import { APP_ACCOUNT, APP_LOGIN } from "../routes";
import { reducedMotion } from "../pwa";
import type { AppTheme } from "../themes";
import { Icon } from "../icons";
import { CAMPUSES, LENGTHS, TONES, campusFixed, campusLabel, isCampus, personCard, prefsOf, prefsPatch, previewAnswer, rolLabel } from "./rules";
import type { Prefs, Tone } from "./rules";
import type { AccountState } from "./useAccount";
import { readVisitor, visitorNick, visitorNickProblem, writeVisitor } from "./visitor";
import { Benefits, Field, Msg, Seg, ThemePicker } from "./parts";
import { tr, useLang } from "../../../components/pilo/i18n";
import { MisDatos } from "../yo/MisDatos";
import { LimitesCard } from "../limites/LimitesCard";

gsap.registerPlugin(useGSAP);

const TONE_OPTIONS = TONES.map((t) => ({ id: t.id, label: t.label }));

export function ProfilePane({
  state,
  theme,
  onTheme,
  intranetName,
  onWelcome,
}: {
  state: AccountState;
  theme: AppTheme;
  onTheme: (theme: AppTheme) => void;
  /** El nombre de quien entró con su cuenta de la intranet; null si no. */
  intranetName: string | null;
  onWelcome: () => void;
}) {
  useLang();
  const { account, member, pending } = state;

  const look = (
    <section className="pc-sheet" aria-labelledby="pc-p-tema">
      <div className="pc-sheet__in">
        <p className="pc-label" id="pc-p-tema">
          {tr("Tema de la app")}
        </p>
        <ThemePicker value={theme} onPick={onTheme} labelledBy="pc-p-tema" />
        <button type="button" className="pc-quiet" onClick={onWelcome}>
          {tr("Ver la bienvenida otra vez")}
        </button>
      </div>
    </section>
  );

  if (pending) {
    return (
      <p className="pc-wait" role="status">
        {tr("Pilo está buscando su cuenta…")}
      </p>
    );
  }

  if (!account) {
    return (
      <>
        {intranetName ? (
          <section className="pc-sheet">
            <div className="pc-sheet__in">
              <p className="pc-label">{tr("Sesión de la intranet")}</p>
              <p>{tr("Entró con su cuenta de la intranet ({name}). Esa cuenta ya le sirve en Pilo; sus conversaciones quedan en este dispositivo.", { name: intranetName })}</p>
            </div>
          </section>
        ) : (
          <GuestPrefs />
        )}
        {look}
      </>
    );
  }

  if (!member) {
    return (
      <>
        <section className="pc-sheet">
          <div className="pc-sheet__in">
            <Msg tone="bad">{tr("Su cuenta de Pilo está suspendida. Escriba a la administración para reactivarla.")}</Msg>
            <p>{tr("Mientras tanto puede conversar con Pilo sin cuenta.")}</p>
            <div className="pc-actions">
              <span />
              <button type="button" className="pa-btn pa-btn--line" onClick={() => void state.signOut()}>
                {tr("Cerrar sesión")}
              </button>
            </div>
          </div>
        </section>
        {look}
      </>
    );
  }

  return <MemberPrefs state={state} theme={theme} onTheme={onTheme} />;
}

/* --- Con cuenta ----------------------------------------------------------------------------- */

/** La opacidad de reposo de cada anillo, de dentro hacia fuera. */
const RING_OPACITY = [0.6, 0.44, 0.28];

function MemberPrefs({ state, theme, onTheme }: { state: AccountState; theme: AppTheme; onTheme: (theme: AppTheme) => void }) {
  useLang();
  const account = state.account!;
  const card = personCard(account);
  const [prefs, setPrefs] = useState<Prefs>(() => prefsOf(account));
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [talking, setTalking] = useState(false);
  const timer = useRef<number>();
  const fixed = campusFixed(account);
  const dirty = useMemo(() => Object.keys(prefsPatch(account, prefs)).length > 0, [account, prefs]);
  const sample = previewAnswer(prefs.nick, prefs.tone, prefs.length);
  const head = useRef<HTMLElement>(null);
  const seenTheme = useRef(theme);

  // Un solo movimiento: al cambiar de tema, los anillos salen de Pilo (no al entrar, solo al cambiar).
  useGSAP(
    () => {
      if (seenTheme.current === theme) return;
      seenTheme.current = theme;
      if (reducedMotion()) return;
      const rings = gsap.utils.toArray<SVGCircleElement>(".pc-me__rings circle");
      gsap.fromTo(
        rings,
        { scale: 0.78, opacity: 0, transformOrigin: "50% 50%" },
        { scale: 1, opacity: (i: number) => RING_OPACITY[i] ?? 0.3, duration: 0.9, ease: "power3.out", stagger: 0.1, overwrite: true, clearProps: "transform,opacity,transformOrigin" },
      );
    },
    { dependencies: [theme], scope: head },
  );

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const change = (patch: Partial<Prefs>, speak = false) => {
    setPrefs((p) => ({ ...p, ...patch }));
    setResult(null);
    if (!speak) return;
    // Pilo dice la muestra: mueve el pico un momento.
    setTalking(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setTalking(false), 900);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving || !dirty) return;
    setSaving(true);
    setResult(null);
    try {
      const row = await state.save(prefs);
      setPrefs(prefsOf(row));
      setResult({ tone: "ok", text: tr("Guardado. Pilo ya le responde así.") });
    } catch (err) {
      setResult({ tone: "bad", text: (err as Error).message || tr("No se pudieron guardar sus preferencias.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="pc-profile pc-profile--v2" noValidate onSubmit={submit}>
      {/* Quién es: lo que no cambia, dicho una vez y arriba, con la cara de Pilo y sus anillos. */}
      <header className="pc-me" ref={head}>
        <div className="pc-me__orb" aria-hidden="true">
          <svg className="pc-me__rings" viewBox="0 0 240 240">
            <circle cx="120" cy="120" r="64" />
            <circle cx="120" cy="120" r="88" />
            <circle cx="120" cy="120" r="112" />
          </svg>
          <span className="pc-me__face">
            <Pilo size="100%" mood="feliz" talking={talking} />
          </span>
        </div>
        <div className="pc-me__who">
          <h2>{card.name}</h2>
          <p>@{account.username}</p>
          <div className="pc-me__tags">
            <span className="pc-tag">{rolLabel(account.rol)}</span>
            {campusLabel(prefs.campus) && <span className="pc-tag">{campusLabel(prefs.campus)}</span>}
          </div>
        </div>
      </header>

      <section className="pc-line" aria-labelledby="pc-p-tema">
        <h2 className="pc-h" id="pc-p-tema">
          {tr("Tema de la app")}
        </h2>
        <p className="pc-hint">{tr("Los colores salen de la paleta institucional. Se recuerda en este dispositivo.")}</p>
        <ThemePicker value={theme} onPick={(id) => onTheme(id)} labelledBy="pc-p-tema" />
      </section>

      <div className="pc-cols">
        <div className="pc-edit">
          <section className="pc-sheet" aria-labelledby="pc-p-habla">
            <div className="pc-sheet__in">
              <h2 className="pc-h" id="pc-p-habla">
                {tr("Cómo le habla Pilo")}
              </h2>
              <Field id="pc-p-trato" label={tr("¿Cómo le dice Pilo?")} hint={tr("Su nombre o uno abreviado.")}>
                {(aria) => <input {...aria} autoComplete="nickname" value={prefs.nick} maxLength={40} onChange={(e) => change({ nick: e.target.value }, true)} />}
              </Field>
              <div>
                <p className="pc-label">{tr("Tono")}</p>
                <Seg label={tr("Tono")} value={prefs.tone} options={TONE_OPTIONS} onPick={(tone) => change({ tone }, true)} />
              </div>
              <div>
                <p className="pc-label">{tr("Extensión de las respuestas")}</p>
                <Seg label={tr("Extensión de las respuestas")} value={prefs.length} options={LENGTHS} onPick={(length) => change({ length }, true)} />
              </div>
              <Field id="pc-p-sobre" label={tr("Lo que Pilo debe saber de usted")} hint={tr("Opcional. Por ejemplo: «Estudio de noche y prefiero ejemplos de programación». {length} de 400.", { length: prefs.about.length })}>
                {(aria) => <textarea {...aria} rows={3} value={prefs.about} maxLength={400} onChange={(e) => change({ about: e.target.value })} />}
              </Field>
              {!fixed && (
                <Field id="pc-p-sede" label={tr("Sede")}>
                  {(aria) => (
                    <select {...aria} value={prefs.campus} onChange={(e) => isCampus(e.target.value) && change({ campus: e.target.value })}>
                      {!prefs.campus && <option value="">{tr("Elija su sede")}</option>}
                      {CAMPUSES.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.label}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
              )}
              <Field id="pc-p-programa" label={tr("Programa o dependencia")} hint={tr("Por ejemplo: Ingeniería de Software, o Bienestar Universitario.")}>
                {(aria) => <input {...aria} autoComplete="organization-title" value={prefs.program} maxLength={120} onChange={(e) => change({ program: e.target.value })} />}
              </Field>
            </div>
          </section>

          {/* «Guardar» aparece cuando hay algo que guardar: en el teléfono, la barra sube con el primer cambio. */}
          <div className="pc-save" data-on={dirty || saving || result ? "" : undefined}>
            <div className="pc-save__msg">
              {result ? (
                <Msg tone={result.tone} alert={result.tone === "bad"}>
                  {result.text}
                </Msg>
              ) : dirty ? (
                <p className="pc-hint">{tr("Hay cambios sin guardar.")}</p>
              ) : null}
            </div>
            <button type="submit" className="pa-btn pa-btn--main" disabled={saving || !dirty}>
              {saving ? tr("Guardando…") : tr("Guardar")}
            </button>
          </div>
        </div>

        <div className="pc-aside">
          {/* Los datos del carnet y lo que la administración le asignó a su cuenta. */}
          <MisDatos state={state} />
          <LimitesCard state={state} />

          {/* La muestra acompaña a los controles: al lado en el escritorio, justo encima en el teléfono. */}
          <section className="pc-sheet pc-sample" aria-labelledby="pc-p-muestra">
            <div className="pc-sheet__in">
              <p className="pc-label" id="pc-p-muestra">
                {tr("Así le respondería Pilo")}
              </p>
              <div className="pc-sample__turn">
                <div className="pc-preview__face">
                  <Pilo size="100%" mood="feliz" talking={talking} label="Mr. Pilo" />
                </div>
                <p className="pc-sample__bubble" aria-live="polite">
                  <span key={sample}>{sample}</span>
                </p>
              </div>
              <p className="pc-hint">{tr("Es una muestra: cambia con el nombre, el tono y la extensión.")}</p>
            </div>
          </section>

          {/* La cuenta, al final y aparte: lo que no se cambia aquí, y la salida. */}
          <section className="pc-sheet pc-account" aria-labelledby="pc-p-cuenta">
            <div className="pc-sheet__in">
              <h2 className="pc-h" id="pc-p-cuenta">
                {tr("Su cuenta")}
              </h2>
              <dl className="pc-facts">
                <div>
                  <dt>{tr("Correo")}</dt>
                  <dd>
                    <span className="pc-break">{account.email}</span>{" "}
                    <span className="pc-tag" data-t="ok">
                      {Icon.check}
                      {tr("Confirmado")}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{tr("Perfil")}</dt>
                  <dd>
                    {rolLabel(account.rol)}
                    <small>{tr("Lo fija su correo; para cambiarlo, escriba a la administración.")}</small>
                  </dd>
                </div>
                {fixed && (
                  <div>
                    <dt>{tr("Sede")}</dt>
                    <dd>
                      {campusLabel(account.campus) || tr("Sin sede")}
                      <small>{tr("La fija su correo.")}</small>
                    </dd>
                  </div>
                )}
              </dl>
              <button type="button" className="pa-btn pa-btn--line pc-out" onClick={() => void state.signOut()}>
                {tr("Cerrar sesión")}
              </button>
            </div>
          </section>
        </div>
      </div>
    </form>
  );
}

/* --- Sin cuenta ------------------------------------------------------------------------------ */

function GuestPrefs() {
  useLang();
  const [guest, setGuest] = useState(() => readVisitor() ?? { nick: "", tone: "cercano" as Tone });
  const [problem, setProblem] = useState("");
  const [saved, setSaved] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const bad = visitorNickProblem(guest.nick);
    if (bad) {
      setProblem(bad);
      document.getElementById("pc-v-nombre")?.focus();
      return;
    }
    writeVisitor({ nick: visitorNick(guest.nick), tone: guest.tone });
    setSaved(true);
  };

  return (
    <>
      <form className="pc-sheet" noValidate onSubmit={submit} aria-label={tr("Cómo le habla Pilo")}>
        <div className="pc-sheet__in">
          <p>{tr("Usa a Pilo sin cuenta. Estas dos preferencias quedan en este dispositivo.")}</p>
          <Field id="pc-v-nombre" label={tr("¿Cómo quiere que le diga Pilo?")} hint={tr("Su nombre o uno abreviado. Si lo deja vacío, Pilo no usa nombre.")} error={problem || null}>
            {(aria) => (
              <input
                {...aria}
                autoComplete="nickname"
                value={guest.nick}
                maxLength={30}
                onChange={(e) => {
                  setGuest({ ...guest, nick: e.target.value });
                  setProblem("");
                  setSaved(false);
                }}
              />
            )}
          </Field>
          <div>
            <p className="pc-label">{tr("Tono")}</p>
            <Seg
              label={tr("Tono")}
              value={guest.tone}
              options={TONE_OPTIONS}
              onPick={(tone) => {
                setGuest({ ...guest, tone });
                setSaved(false);
              }}
            />
          </div>
          <div className="pc-save">
            <div className="pc-save__msg">{saved && <Msg tone="ok">{tr("Guardado en este dispositivo.")}</Msg>}</div>
            <button type="submit" className="pa-btn pa-btn--main">
              {tr("Guardar")}
            </button>
          </div>
        </div>
      </form>

      <section className="pc-sheet" aria-label={tr("Crear una cuenta")}>
        <div className="pc-sheet__in">
          <Benefits title={tr("Con una cuenta de Pilo")} />
          <div className="pc-actions">
            <Link className="pa-btn pa-btn--line" to={APP_LOGIN}>
              {tr("Entrar")}
            </Link>
            <Link className="pa-btn pa-btn--main" to={APP_ACCOUNT}>
              {tr("Crear una cuenta")}
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
