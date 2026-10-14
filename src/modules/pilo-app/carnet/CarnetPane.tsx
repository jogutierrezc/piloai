/* =============================================================================
   Mr. Pilo · Carnet digital · /app/carnet.

   Una tarjeta de dos caras: la de identidad (nombre, perfil, sede, foto y
   vigencia) y la del código QR, que cambia cada 30 segundos con su aro de cuenta
   regresiva. Debajo, lo que se hace con ella: Google Wallet, pantalla completa
   para el lector, guardar como imagen, verificación temporal para otra persona,
   reportar la pérdida (suspende el código) y reactivar. El acceso al campus con
   NFC es una fila apagada: requiere un convenio con la universidad.

   El carnet se arma con la cuenta de Pilo (nombre, perfil y sede) y los datos
   que la persona completa en «Mis datos». Si faltan los obligatorios, la
   pantalla los pide y abre esa hoja. La foto se queda en el teléfono.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { Icon } from "../icons";
import { reducedMotion } from "../pwa";
import { APP_ACCOUNT, APP_LOGIN } from "../routes";
import { campusLabel, rolLabel } from "../account/rules";
import type { PiloRol } from "../account/rules";
import type { AccountState } from "../account/useAccount";
import type { Person } from "../AppSide";
import { useInert } from "../Layer";
import { Msg } from "../account/parts";
import { PerfilSheet } from "../yo/PerfilSheet";
import { Glyph } from "./glyphs";
import { QrView, Ring } from "./QrView";
import { FullQr, ShareSheet, StopSheet, WalletSheet } from "./Hojas";
import { deliverImage, drawCardImage } from "./imagen";
import { readPhoto, squarePhoto, writePhoto } from "./photo";
import { codeTail, detailLine, progress, rhLabel } from "./rules";
import { usePerfil, useCode, useWalletReady } from "./useCarnet";
import { tr, useLang } from "../../../components/pilo/i18n";
import "./carnet.css";

export interface CarnetPaneProps {
  state: AccountState;
  online: boolean;
  person: Person;
  wide: boolean;
}

type SheetName = null | "datos" | "wallet" | "share" | "stop" | "resume";

export function CarnetPane({ state, online, wide }: CarnetPaneProps) {
  useLang();
  const { account, member, pending } = state;

  if (pending) {
    return (
      <p className="cn-note" role="status">
        {tr("Pilo está buscando su cuenta…")}
      </p>
    );
  }
  if (!account) {
    return (
      <section className="cn-gate">
        <div className="cn-gate__in">
          <span className="cn-gate__i">{Icon.id}</span>
          <h2 className="cn-h">{tr("El carnet es para quienes tienen cuenta de Pilo")}</h2>
          <p className="cn-lead">{tr("Con su correo de la UDES crea una cuenta en un minuto y su carnet queda en el teléfono.")}</p>
          <div className="cn-gate__act">
            <Link className="pa-btn pa-btn--line" to={APP_LOGIN}>
              {tr("Entrar")}
            </Link>
            <Link className="pa-btn pa-btn--main" to={APP_ACCOUNT}>
              {tr("Crear una cuenta")}
            </Link>
          </div>
        </div>
      </section>
    );
  }
  if (!member) {
    return (
      <section className="cn-gate">
        <div className="cn-gate__in">
          <Msg tone="bad">{tr("Su cuenta de Pilo está suspendida. Escriba a la administración para reactivarla.")}</Msg>
        </div>
      </section>
    );
  }
  return <Card state={state} online={online} wide={wide} />;
}

function Card({ state, online, wide }: { state: AccountState; online: boolean; wide: boolean }) {
  const account = state.account!;
  const rol = account.rol as PiloRol;
  const perfil = usePerfil(state);
  const done = progress(rol, perfil.form);
  const walletReady = useWalletReady(done.full);

  const [flipped, setFlipped] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [full, setFull] = useState(false);
  const [photo, setPhoto] = useState<string | null>(() => readPhoto(account.id));
  const [note, setNote] = useState("");
  const asked = useRef(false);

  const suspended = perfil.suspendido;
  const code = useCode((flipped || full) && done.full && !suspended, online);

  const inner = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const front = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useInert(front, flipped);
  useInert(back, !flipped);

  // Faltan datos obligatorios: la pantalla los pide y abre «Mis datos» (una sola vez por visita).
  useEffect(() => {
    if (perfil.loading || perfil.error || asked.current) return;
    asked.current = true;
    if (!done.full) setSheet("datos");
  }, [perfil.loading, perfil.error, done.full]);

  const flip = useCallback(() => {
    if (!done.full) {
      setSheet("datos");
      return;
    }
    const to = !flipped;
    setFlipped(to);
    if (!inner.current) return;
    if (reducedMotion()) gsap.set(inner.current, { rotationY: to ? 180 : 0 });
    else gsap.to(inner.current, { rotationY: to ? 180 : 0, duration: 0.6, ease: "power3.inOut", overwrite: true });
  }, [done.full, flipped]);

  const pickPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const chosen = e.target.files?.[0];
    e.target.value = "";
    if (!chosen) return;
    const next = await squarePhoto(chosen);
    if (!next) {
      setNote(tr("No se pudo usar esa imagen. Pruebe con otra foto."));
      return;
    }
    writePhoto(account.id, next);
    setPhoto(next);
    setNote(tr("Foto agregada. Se queda en este teléfono."));
  };

  const dropPhoto = () => {
    writePhoto(account.id, null);
    setPhoto(null);
    setNote(tr("Foto quitada."));
  };

  const f = perfil.form;
  const rolText = rolLabel(account.rol);
  const campus = campusLabel(account.campus);
  const detail = detailLine(rol, f);
  const stateWord = suspended ? tr("Suspendido") : tr("Vigente");
  const foot = [f.show_codigo && f.codigo ? `${tr("Código")} ${codeTail(f.codigo)}` : "", f.show_rh && f.rh ? `RH ${rhLabel(f.rh)}` : ""].filter(Boolean).join(" · ") || rolText;
  const line = [rolText, campus].filter(Boolean).join(" · ");

  const saveImage = async () => {
    if (!card.current) return;
    const blob = await drawCardImage(card.current, { title: "UDES", subtitle: tr("Carnet digital"), name: account.full_name, role: line, detail: detail || tr("Complete sus datos"), foot, state: stateWord, photo });
    if (!blob) {
      setNote(tr("Este navegador no puede crear la imagen."));
      return;
    }
    const out = await deliverImage(blob, "carnet-udes.png");
    setNote(out === "cancelada" ? "" : out === "compartida" ? tr("Imagen lista. Sin el código QR: ese cambia cada 30 segundos.") : tr("Imagen guardada. Sin el código QR: ese cambia cada 30 segundos."));
  };

  if (perfil.loading) {
    return (
      <p className="cn-note" role="status">
        {tr("Cargando su carnet…")}
      </p>
    );
  }
  if (perfil.error) {
    return (
      <section className="cn-gate">
        <div className="cn-gate__in">
          <Msg tone="bad" alert>
            {perfil.error.message}
          </Msg>
          <button type="button" className="pa-btn pa-btn--line" onClick={() => void perfil.refresh()}>
            {tr("Intentar de nuevo")}
          </button>
        </div>
      </section>
    );
  }

  return (
    <div className="cn-pane" data-wide={wide || undefined}>
      {!done.full && (
        <button type="button" className="cn-complete" onClick={() => setSheet("datos")}>
          <span>
            <b>{tr("Complete los datos de su carnet")}</b>
            <small>{tr("{ok} de {total} listos", { ok: done.ok, total: done.total })}</small>
          </span>
          {Glyph.right}
        </button>
      )}

      <div className="cn-card" ref={card}>
        <div className="cn-inner" ref={inner}>
          <div className="cn-face cn-front" ref={front}>
            <div className="cn-top">
              <b>UDES</b>
              <span>{tr("Carnet digital")}</span>
            </div>
            <div className="cn-body">
              <button type="button" className="cn-photo" onClick={() => file.current?.click()} aria-label={photo ? tr("Cambiar la foto") : tr("Agregar una foto")}>
                {photo ? (
                  <img src={photo} alt={""} />
                ) : (
                  <>
                    <span className="cn-photo__ini">{account.full_name.trim().charAt(0).toUpperCase()}</span>
                    <small>{tr("Agregar foto")}</small>
                  </>
                )}
              </button>
              <div className="cn-who">
                <div className="cn-name">{account.full_name}</div>
                <div className="cn-role">{line}</div>
                <div className="cn-detail">{detail || tr("Complete sus datos")}</div>
              </div>
            </div>
            <div className="cn-foot">
              <span>{foot}</span>
              <span className="cn-state" data-bad={suspended || undefined}>
                {suspended ? Glyph.lock : Icon.check}
                {stateWord}
              </span>
            </div>
          </div>

          <div className="cn-face cn-back" ref={back}>
            {suspended ? (
              <div className="cn-lock">
                {Glyph.lock}
                <b>{tr("Carnet suspendido")}</b>
                <span>{tr("Reactívelo abajo para volver a mostrar su código.")}</span>
              </div>
            ) : (
              <>
                <div className="cn-qrbox">
                  {code.token ? (
                    <QrView text={code.token} label={tr("Código QR del carnet. Cambia cada 30 segundos.")} />
                  ) : code.error ? (
                    <div className="cn-qrmsg" role="alert">
                      <span>{code.error.message}</span>
                      {online && (
                        <button type="button" className="pa-btn pa-btn--line" onClick={code.retry}>
                          {tr("Intentar de nuevo")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <p className="cn-qrmsg" role="status">
                      {tr("Preparando el código…")}
                    </p>
                  )}
                </div>
                <div className="cn-qrmeta">
                  {code.token && <Ring win={code.win} fraction={code.fraction} left={code.left} />}
                  <span>
                    <b>{code.token ? tr("{s} s", { s: code.left }) : tr("Código")}</b>
                    {tr("El código se renueva solo.")}
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <input ref={file} type="file" accept="image/*" hidden onChange={pickPhoto} />

      <button type="button" className="pa-btn pa-btn--line cn-block" aria-pressed={flipped} onClick={flip}>
        {flipped ? Glyph.flip : Icon.qr}
        {flipped ? tr("Ver mi carnet") : tr("Mostrar el código QR")}
      </button>

      {walletReady === false ? (
        <div className="cn-wbtn" aria-disabled="true" role="group" aria-label="Google Wallet">
          {Glyph.wallet}
          <span>
            Google Wallet
            <small>{tr("Aún no disponible: lo habilita la administración")}</small>
          </span>
        </div>
      ) : (
        <button type="button" className="cn-wbtn" onClick={() => (done.full ? setSheet("wallet") : setSheet("datos"))}>
          {Glyph.wallet}
          <span>{tr("Agregar a Google Wallet")}</span>
        </button>
      )}

      <p className="cn-note" role="status" aria-live="polite">
        {note}
      </p>

      <section className="cn-group" aria-labelledby="cn-mas">
        <h2 id="cn-mas">{tr("Más opciones")}</h2>
        <div className="cn-list">
          <Row icon={Icon.user} title={tr("Mis datos del carnet")} text={done.full ? tr("Programa, código y datos de emergencia") : tr("{ok} de {total} datos listos", { ok: done.ok, total: done.total })} onClick={() => setSheet("datos")} />
          <Row icon={Glyph.screen} title={tr("Pantalla completa")} text={tr("QR grande para el lector")} onClick={() => (done.full ? setFull(true) : setSheet("datos"))} disabled={suspended} />
          <Row icon={Glyph.image} title={tr("Guardar como imagen")} text={tr("Su carnet sin el código QR, para mostrarlo")} onClick={saveImage} />
          {photo && <Row icon={Glyph.camera} title={tr("Quitar la foto")} text={tr("Solo estaba en este teléfono")} onClick={dropPhoto} />}
          <Row icon={Glyph.share} title={tr("Verificación para otra persona")} text={tr("Código temporal de 5 minutos, sin datos personales")} onClick={() => (done.full ? setSheet("share") : setSheet("datos"))} disabled={suspended} />
          <div className="cn-row cn-row--off" aria-disabled="true">
            <span className="cn-row__i">{Glyph.nfc}</span>
            <span className="cn-row__t">
              <b>{tr("Acceso al campus con NFC")}</b>
              <small>{tr("Abrir torniquetes con el teléfono")}</small>
            </span>
            <span className="cn-due">{tr("Requiere convenio")}</span>
          </div>
          <Row
            icon={Glyph.alert}
            title={suspended ? tr("Reactivar mi carnet") : tr("Reportar pérdida o robo")}
            text={suspended ? tr("Vuelve a mostrar su código") : tr("Suspende el carnet y su código al instante")}
            onClick={() => setSheet(suspended ? "resume" : "stop")}
            danger={!suspended}
          />
        </div>
      </section>

      {sheet === "datos" && <PerfilSheet rol={rol} perfil={perfil} onClose={() => setSheet(null)} onSaved={() => setNote(tr("Datos guardados en su cuenta."))} />}
      {sheet === "wallet" && <WalletSheet ready={walletReady} onClose={() => setSheet(null)} />}
      {sheet === "share" && <ShareSheet onClose={() => setSheet(null)} />}
      {(sheet === "stop" || sheet === "resume") && (
        <StopSheet
          stop={sheet === "stop"}
          onClose={() => setSheet(null)}
          onDone={(now) => {
            setNote(now ? tr("Carnet suspendido.") : tr("Carnet reactivado."));
            if (now) setFlipped(false);
            if (now && inner.current) gsap.set(inner.current, { rotationY: 0 });
            void perfil.refresh();
          }}
        />
      )}
      {full && <FullQr code={code} name={account.full_name} line={line} onClose={() => setFull(false)} />}
    </div>
  );
}

function Row({ icon, title, text, onClick, disabled = false, danger = false }: { icon: React.ReactNode; title: string; text: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button type="button" className="cn-row" onClick={onClick} disabled={disabled} data-danger={danger || undefined}>
      <span className="cn-row__i">{icon}</span>
      <span className="cn-row__t">
        <b>{title}</b>
        <small>{text}</small>
      </span>
      {Glyph.right}
    </button>
  );
}
