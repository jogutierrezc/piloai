/* =============================================================================
   Mr. Pilo · carnet · las hojas y la pantalla completa.

   · Pantalla completa: el QR grande para el lector. Mientras está abierta se pide
     al teléfono que no apague la pantalla (donde el navegador lo permite); el
     brillo no lo controla una página web, así que no se promete.
   · Google Wallet: arma el enlace en el servidor. Si la administración aún no lo
     habilitó, lo dice y no finge nada.
   · Verificación para otra persona: un código aparte que vale 5 minutos.
   · Reportar pérdida / reactivar.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Pilo } from "../../pregunta/Pilo";
import { Icon } from "../icons";
import { reducedMotion } from "../pwa";
import { Msg } from "../account/parts";
import { Glyph } from "./glyphs";
import { Sheet } from "./Sheet";
import { QrView, Ring } from "./QrView";
import { asCarnetError, fetchShare, reactivateCard, suspendCard, walletUrl } from "./api";
import { clock } from "./logic";
import type { CodeState } from "./useCarnet";
import { tr, useLang } from "../../../components/pilo/i18n";

/* --- Pantalla completa ------------------------------------------------------------------------ */

export function FullQr({ code, name, line, onClose }: { code: CodeState; name: string; line: string; onClose: () => void }) {
  useLang();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = root.current;
    if (el && !reducedMotion()) gsap.fromTo(el, { opacity: 0, scale: 0.97 }, { opacity: 1, scale: 1, duration: 0.3, ease: "power3.out", clearProps: "transform,opacity" });
    el?.focus({ preventScroll: true });
    const before = document.activeElement as HTMLElement | null;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    // La pantalla no se apaga mientras el lector la necesita (donde el navegador lo deja).
    let lock: { release: () => Promise<void> } | null = null;
    const wake = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    wake?.request("screen").then(
      (l) => {
        lock = l;
      },
      () => undefined,
    );
    return () => {
      document.removeEventListener("keydown", key);
      void lock?.release().catch(() => undefined);
      before?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const node = (
    <div className="cn-full" ref={root} role="dialog" aria-modal="true" aria-label={tr("Código QR en pantalla completa")} tabIndex={-1}>
      <div className="cn-full__top">
        <button type="button" className="cn-icon" onClick={onClose} aria-label={tr("Cerrar")}>
          {Icon.close}
        </button>
      </div>
      <div className="cn-full__mid">
        <div className="cn-full__qr">{code.token ? <QrView text={code.token} label={tr("Código QR del carnet. Cambia cada 30 segundos.")} /> : <p role="status">{code.error ? code.error.message : tr("Preparando el código…")}</p>}</div>
        <b>{name}</b>
        <span>{line}</span>
        {code.token && (
          <span className="cn-full__count">
            <Ring win={code.win} fraction={code.fraction} left={code.left} />
            {tr("Se renueva en {s} s", { s: code.left })}
          </span>
        )}
        {code.error && (
          <button type="button" className="pa-btn pa-btn--line" onClick={code.retry}>
            {tr("Intentar de nuevo")}
          </button>
        )}
      </div>
      <p className="cn-full__foot">{tr("La pantalla se mantiene encendida mientras esté abierta. Suba el brillo del teléfono si el lector no lo lee.")}</p>
    </div>
  );
  const host = document.querySelector<HTMLElement>(".pa");
  return host ? createPortal(node, host) : node;
}

/* --- Google Wallet ---------------------------------------------------------------------------- */

type WalletStep = "info" | "armando" | "listo" | "error";

export function WalletSheet({ ready, onClose }: { ready: boolean | null; onClose: () => void }) {
  return (
    <Sheet label="Google Wallet" onClose={onClose}>
      {(close) => <WalletBody ready={ready} close={close} />}
    </Sheet>
  );
}

function WalletBody({ ready, close }: { ready: boolean | null; close: () => void }) {
  useLang();
  const [step, setStep] = useState<WalletStep>("info");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!box.current || reducedMotion()) return;
    const tween = gsap.fromTo(box.current.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.34, stagger: 0.05, ease: "power3.out", clearProps: "transform,opacity" });
    return () => {
      tween.kill();
    };
  }, [step]);

  const add = async () => {
    setStep("armando");
    try {
      const out = await walletUrl();
      setLink(out.url);
      setStep("listo");
      // Se abre la página de Google; el pase queda en Wallet solo si la persona lo confirma allí.
      window.open(out.url, "_blank", "noopener,noreferrer");
    } catch (error) {
      setMessage(asCarnetError(error).message);
      setStep("error");
    }
  };

  const off = ready === false;
  return (
    <div ref={box} key={step} className="cn-wallet">
      {(step === "info" || step === "error") && (
        <>
          <h2 className="cn-h">{tr("Agregar a Google Wallet")}</h2>
          <p className="cn-lead">{tr("Su carnet queda en el teléfono, con su nombre, perfil, sede y vigencia, y lo abre sin entrar a la app. El código QR que cambia cada 30 segundos se muestra en la app de Pilo.")}</p>
          <ol className="cn-steps">
            <li>
              <i>1</i>
              <span>{tr("Pilo prepara el pase con su nombre, perfil, sede y vigencia.")}</span>
            </li>
            <li>
              <i>2</i>
              <span>{tr("Google Wallet le pide confirmar que lo quiere guardar.")}</span>
            </li>
            <li>
              <i>3</i>
              <span>{tr("Listo: lo encuentra en la app Google Wallet.")}</span>
            </li>
          </ol>
          <div className="cn-priv">
            {Glyph.shield}
            <span>{tr("No se envía su código de estudiante, su foto, su tipo de sangre ni sus notas. Google solo recibe lo que se ve en el pase.")}</span>
          </div>
          {step === "error" && (
            <Msg tone="bad" alert>
              {message}
            </Msg>
          )}
          <button type="button" className="cn-wbtn" onClick={add} disabled={off}>
            {Glyph.wallet}
            <span>{off ? tr("Aún no disponible: lo habilita la administración") : tr("Agregar a Google Wallet")}</span>
          </button>
          <button type="button" className="pa-btn pa-btn--line cn-block" onClick={close}>
            {tr("Ahora no")}
          </button>
        </>
      )}
      {step === "armando" && (
        <div className="cn-wait" role="status">
          <Pilo size={110} mood="piensa" talking label="Mr. Pilo" />
          <b>{tr("Preparando su pase…")}</b>
          <span>{tr("Pilo lo está firmando para Google Wallet.")}</span>
        </div>
      )}
      {step === "listo" && (
        <div className="cn-wait" role="status">
          <Pilo size={110} mood="feliz" label="Mr. Pilo" />
          <h2 className="cn-h">{tr("Falta un paso en Google")}</h2>
          <p className="cn-lead">{tr("Abrimos Google Wallet para que confirme. El pase se guarda cuando usted lo acepta allí; Pilo no puede saber si lo hizo.")}</p>
          <a className="pa-btn pa-btn--main cn-block" href={link} target="_blank" rel="noopener noreferrer">
            {Glyph.wallet} {tr("Abrir Google Wallet")}
          </a>
          <button type="button" className="pa-btn pa-btn--line cn-block" onClick={close}>
            {tr("Listo")}
          </button>
        </div>
      )}
    </div>
  );
}

/* --- Verificación para otra persona ----------------------------------------------------------- */

export function ShareSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet label={tr("Verificación temporal")} onClose={onClose}>
      {(close) => <ShareBody close={close} />}
    </Sheet>
  );
}

function ShareBody({ close }: { close: () => void }) {
  useLang();
  const [made, setMade] = useState<{ token: string; until: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!made) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [made]);

  const make = async () => {
    setBusy(true);
    setMessage("");
    setCopied(false);
    try {
      const out = await fetchShare();
      setMade({ token: out.token, until: Date.now() + out.vence_en * 1000 });
      setNow(Date.now());
    } catch (error) {
      setMessage(asCarnetError(error).message);
    } finally {
      setBusy(false);
    }
  };

  const left = made ? Math.ceil((made.until - now) / 1000) : 0;
  const live = made !== null && left > 0;

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.token);
      setCopied(true);
    } catch {
      setMessage(tr("No se pudo copiar. Muestre el código QR."));
    }
  };

  return (
    <div className="cn-share">
      <h2 className="cn-h">{tr("Verificación para otra persona")}</h2>
      <p className="cn-lead">{tr("Crea un código que confirma que usted es de la UDES. Vale 5 minutos y quien lo verifique solo ve su nombre, perfil y vigencia: ni su código ni sus datos de salud.")}</p>
      {live && made ? (
        <div className="cn-share__code">
          <div className="cn-share__qr">
            <QrView text={made.token} label={tr("Código QR de verificación. Vale 5 minutos.")} />
          </div>
          <p className="cn-share__left" role="timer" aria-live="off">
            {tr("Vence en {t}", { t: clock(left) })}
          </p>
          <button type="button" className="pa-btn pa-btn--line cn-block" onClick={copy}>
            {Icon.copy} {copied ? tr("Código copiado") : tr("Copiar el código")}
          </button>
          <p className="cn-hint">{tr("Solo un profesor de la UDES con Pilo puede verificarlo.")}</p>
        </div>
      ) : (
        <>
          {made && (
            <Msg tone="info">{tr("Ese código ya venció.")}</Msg>
          )}
          {message && (
            <Msg tone="bad" alert>
              {message}
            </Msg>
          )}
          <button type="button" className="pa-btn pa-btn--main cn-block" onClick={make} disabled={busy}>
            {Glyph.share} {busy ? tr("Creando…") : made ? tr("Crear otro código") : tr("Crear un código de 5 minutos")}
          </button>
        </>
      )}
      <button type="button" className="pa-btn pa-btn--line cn-block" onClick={close}>
        {tr("Cerrar")}
      </button>
    </div>
  );
}

/* --- Reportar pérdida o reactivar -------------------------------------------------------------- */

export function StopSheet({ stop, onClose, onDone }: { stop: boolean; onClose: () => void; onDone: (suspended: boolean) => void }) {
  return (
    <Sheet label={stop ? tr("Reportar pérdida") : tr("Reactivar")} onClose={onClose}>
      {(close) => <StopBody stop={stop} close={close} onDone={onDone} />}
    </Sheet>
  );
}

function StopBody({ stop, close, onDone }: { stop: boolean; close: () => void; onDone: (suspended: boolean) => void }) {
  useLang();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const run = async () => {
    setBusy(true);
    setMessage("");
    try {
      const out = stop ? await suspendCard() : await reactivateCard();
      onDone(out.suspendido);
      close();
    } catch (error) {
      setMessage(asCarnetError(error).message);
      setBusy(false);
    }
  };
  return (
    <div className="cn-share">
      <h2 className="cn-h">{stop ? tr("¿Suspender su carnet?") : tr("¿Reactivar su carnet?")}</h2>
      <p className="cn-lead">
        {stop
          ? tr("Su código dejará de funcionar de inmediato y nadie podrá verificarlo. Puede reactivarlo cuando lo recupere. Si lo agregó a Google Wallet, el pase no se borra solo.")
          : tr("Su código vuelve a funcionar y se puede volver a verificar.")}
      </p>
      {message && (
        <Msg tone="bad" alert>
          {message}
        </Msg>
      )}
      <button type="button" className={`pa-btn cn-block ${stop ? "cn-danger" : "pa-btn--main"}`} onClick={run} disabled={busy}>
        {busy ? tr("Un momento…") : stop ? tr("Sí, suspender") : tr("Sí, reactivar")}
      </button>
      <button type="button" className="pa-btn pa-btn--line cn-block" onClick={close}>
        {tr("Cancelar")}
      </button>
    </div>
  );
}
