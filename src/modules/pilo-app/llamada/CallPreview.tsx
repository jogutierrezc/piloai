/* =============================================================================
   Mr. Pilo · la app · la llamada · el aviso previo.

   La primera vez que se toca «Llamar a Pilo», antes de abrir el micrófono, esta
   hoja dice qué hace la llamada, en qué idiomas habla y qué conviene saber.
   Activarla es lo que pide el permiso del micrófono: así el navegador nunca lo
   pide «de la nada». Si el navegador no reconoce la voz, se dice aquí y el
   botón no promete lo que no puede cumplir.

   El idioma que se elige aquí es el de todo Pilo, no uno aparte para la llamada.
   ========================================================================== */

import { useRef, useState } from "react";
import type { MouseEvent } from "react";
import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { PILO_LANGS, setLang, tr, useLang } from "../../../components/pilo/i18n";
import { unlockPiloAudio } from "../../../components/pilo/ai/voice-player";
import { Layer } from "../Layer";
import { Icon } from "../icons";
import { reducedMotion } from "../pwa";
import { CALL_FEATURES, CALL_NOTICES, recognitionSupported } from "./logic";
import "./llamada.css";

gsap.registerPlugin(useGSAP);

/** Pide el micrófono una vez, para que el permiso se resuelva aquí y no en medio de la llamada. */
async function askMicrophone(): Promise<"ok" | "negado" | "sin micrófono"> {
  if (!navigator.mediaDevices?.getUserMedia) return "ok";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return "ok";
  } catch (e) {
    return (e as DOMException).name === "NotFoundError" ? "sin micrófono" : "negado";
  }
}

export function CallPreview({
  open,
  quick,
  onClose,
  onActivate,
  available,
}: {
  open: boolean;
  quick: boolean;
  onClose: (event?: MouseEvent) => void;
  /** El micrófono y el audio ya están desbloqueados: abrir la llamada. */
  onActivate: () => void;
  /** Este Pilo tiene voz oficial; sin ella no hay llamada. */
  available: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const lang = useLang();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<"negado" | "sin micrófono" | null>(null);
  const supported = recognitionSupported();
  const ready = supported && available;

  // Al abrirse, las funciones entran una tras otra (rara vez se ve esta hoja: se puede lucir).
  useGSAP(
    () => {
      if (!open || reducedMotion()) return;
      gsap.fromTo(".pc-feat li", { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.32, ease: "power3.out", stagger: 0.05, delay: quick ? 0 : 0.12, clearProps: "transform,opacity,visibility" });
    },
    { scope: root, dependencies: [open, quick] },
  );

  const activate = async () => {
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    // Estas dos cosas necesitan el toque de la persona: se piden aquí, no después.
    unlockPiloAudio();
    const mic = await askMicrophone();
    setBusy(false);
    if (mic !== "ok") return setProblem(mic);
    onActivate();
  };

  return (
    <Layer kind="sheet" open={open} quick={quick} label={tr("Llamar a Mr. Pilo")} onClose={onClose}>
      <div className="pa-sheet__in pc-preview" ref={root}>
        <span className="pa-sheet__grip" aria-hidden="true" />
        <div className="pa-sheet__head">
          <h2>{tr("Llamar a Pilo")}</h2>
          <button type="button" className="pa-icon" onClick={onClose} aria-label={tr("Cerrar el aviso")}>
            {Icon.close}
          </button>
        </div>
        <p className="pc-lead">{tr("Una conversación hablada, como una llamada: usted habla, Pilo escucha y le responde con su voz.")}</p>

        <section aria-labelledby="pc-lang-l">
          <p className="pa-label" id="pc-lang-l">
            {tr("Idioma de la llamada")}
          </p>
          <div className="pc-lang" role="radiogroup" aria-labelledby="pc-lang-l">
            {PILO_LANGS.map((l) => (
              <button key={l.id} type="button" role="radio" aria-checked={l.id === lang} lang={l.id} onClick={() => setLang(l.id)}>
                <b aria-hidden="true">{l.code}</b>
                {l.name}
              </button>
            ))}
          </div>
        </section>

        <ul className="pc-feat">
          {CALL_FEATURES.map((f) => (
            <li key={f.id}>
              <strong>{tr(f.title)}</strong>
              <span>{tr(f.text)}</span>
            </li>
          ))}
        </ul>

        <section aria-labelledby="pc-know-l">
          <p className="pa-label" id="pc-know-l">
            {tr("Qué conviene saber")}
          </p>
          <ul className="pc-know">
            {CALL_NOTICES.map((n) => (
              <li key={n}>{tr(n)}</li>
            ))}
          </ul>
        </section>

        {!supported && (
          <p className="pc-problem" role="alert">
            {tr("Este navegador no reconoce la voz. Para llamar a Pilo use Chrome, Edge o Safari.")}
          </p>
        )}
        {supported && !available && (
          <p className="pc-problem" role="alert">
            {tr("La voz de Pilo no está disponible ahora, y sin ella no hay llamada. Puede seguir por escrito en el chat.")}
          </p>
        )}
        {problem === "negado" && (
          <p className="pc-problem" role="alert">
            {tr("El navegador no dejó usar el micrófono. Permítalo en el candado de la barra de direcciones y vuelva a tocar «Activar».")}
          </p>
        )}
        {problem === "sin micrófono" && (
          <p className="pc-problem" role="alert">
            {tr("No encuentro un micrófono. Conecte uno y vuelva a tocar «Activar».")}
          </p>
        )}

        <div className="pc-actions">
          <button type="button" className="pa-btn pa-btn--main" onClick={() => void activate()} disabled={!ready || busy} aria-busy={busy || undefined}>
            {Icon.phone}
            {busy ? tr("Pidiendo el micrófono…") : tr("Activar la llamada")}
          </button>
          <button type="button" className="pa-btn pa-btn--line" onClick={onClose}>
            {tr("Ahora no")}
          </button>
        </div>
      </div>
    </Layer>
  );
}
