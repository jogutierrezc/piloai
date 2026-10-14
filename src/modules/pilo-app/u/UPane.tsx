/* =============================================================================
   Mr. Pilo · Pilo U · la puerta a lo universitario de la persona.

   /app/u            el inicio: el saludo de Pilo, quién es (rol, sede, correo) y las
                     filas de su rol, cada una con DE DÓNDE SALE (Génesis, Moodle,
                     UDES) y su estado: «Conectado», «Conectar …» o «Próximamente».
   /app/u/<vista>    una vista: «volver» y su contenido.

   Datos reales hoy: Mis clases virtuales (y Mis grupos virtuales) son Mis clases
   (Moodle, solo lectura); Mis notas es Mis notas (Génesis, solo lectura); las
   presenciales salen del histórico de Génesis; el calendario es el mes con las
   entregas de Moodle. Lo demás se muestra como «Próximamente», con lo que será y
   por qué aún no, y sin una cifra de muestra (docente.ts, vistas-docente.tsx).
   ========================================================================== */

import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { gsap } from "gsap";
import { PiloAvatar } from "../../../components/pilo/PiloAvatar";
import { tr, useLang } from "../../../components/pilo/i18n";
import type { AppVoice } from "../access";
import type { AccountState } from "../account/useAccount";
import { campusLabel, rolLabel } from "../account/rules";
import type { PiloRol } from "../account/rules";
import type { Person } from "../AppSide";
import { ClasesPane } from "../clases/ClasesPane";
import { NotasPane } from "../notas/NotasPane";
import { guideName } from "../notas/guia";
import { APP_ACCOUNT, APP_GEMINI, APP_LOGIN, uPath } from "../routes";
import type { UVista } from "../routes";
import { vinculos } from "./datos";
import type { Vinculos } from "./datos";
import { DocenteContext } from "./vistas-docente";
import { AsistenciaVista, BoletinVista, Grupos, Horario, MensajeVista, RiesgoVista } from "./vistas-docente";
import { Calendario, Presenciales } from "./lectura";
import { Ico, Marco, Proximamente, calmado } from "./parts";
import { SIN_DOCENTE } from "./docente";
import type { DocenteData } from "./docente";
import { hubDe, proximamente, puedeVer, tieneGemini, vistaInfo } from "./vistas";
import type { VistaInfo } from "./vistas";
import "./u.css";

export interface UPaneProps {
  /** La vista pedida en la dirección (/app/u/<vista>); null es el inicio de Pilo U. */
  vista: UVista | null;
  state: AccountState;
  online: boolean;
  person: Person;
  /** En el computador (barra lateral) o en el teléfono (pestañas). */
  wide: boolean;
  /** La voz de Pilo, la misma de la bienvenida, con su interruptor. */
  voice: AppVoice | null;
  voiceOn: boolean;
  onVoice: (on: boolean) => void;
  /** De dónde salen los grupos, listas, notas y asistencia de quien enseña. Hoy: de ninguna parte. */
  docente?: DocenteData;
}

export function UPane({ vista, state, online, wide, voice, voiceOn, onVoice, docente = SIN_DOCENTE }: UPaneProps) {
  useLang();
  const { account, pending, member } = state;

  if (pending) {
    return (
      <div className="pu" data-wide={wide}>
        <p className="pu-wait" role="status">
          {tr("Pilo está revisando su cuenta…")}
        </p>
      </div>
    );
  }

  if (!account || !member) {
    return (
      <div className="pu" data-wide={wide}>
        <section className="pu-gate">
          <PiloAvatar mood="feliz" size={72} />
          <h1>Pilo U</h1>
          <p>
            {account
              ? tr("Su cuenta de Pilo está suspendida. Escriba a la administración.")
              : tr("Pilo U reúne sus clases, sus notas y su calendario. Para verlos, entre con su cuenta de Pilo.")}
          </p>
          {!account && (
            <div className="pu-actions">
              <Link className="pu-btn pu-btn--line" to={APP_LOGIN}>
                {tr("Entrar")}
              </Link>
              <Link className="pu-btn pu-btn--main" to={APP_ACCOUNT}>
                {tr("Crear una cuenta")}
              </Link>
            </div>
          )}
        </section>
      </div>
    );
  }

  const rol = account.rol;
  const abierta = vista && puedeVer(rol, vista) ? vista : null;

  return (
    <DocenteContext.Provider value={docente}>
      <div className="pu" data-wide={wide}>
        {abierta ? (
          <Vista key={abierta} vista={abierta} state={state} online={online} owner={account.id} voice={voice} voiceOn={voiceOn} onVoice={onVoice} />
        ) : (
          <Inicio account={account} rol={rol} wide={wide} />
        )}
      </div>
    </DocenteContext.Provider>
  );
}

/* --- El inicio ------------------------------------------------------------------------------ */

function Inicio({ account, rol, wide }: { account: NonNullable<AccountState["account"]>; rol: PiloRol; wide: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const conexiones = vinculos(account.id);
  const grupos = hubDe(rol);
  const nombre = guideName(account);
  const dominio = account.email.includes("@") ? account.email.slice(account.email.indexOf("@")) : "";

  // Los grupos suben y aparecen, una sola vez al abrir.
  useLayoutEffect(() => {
    if (!ref.current || calmado()) return;
    const t = gsap.fromTo(ref.current.children, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.28, stagger: 0.05, ease: "power3.out", clearProps: "transform,opacity" });
    return () => void t.kill();
  }, []);

  return (
    <div className="pu-hub" ref={ref}>
      <header className="pu-head">
        <PiloAvatar mood="idea" size={wide ? 72 : 64} alive />
        <div>
          <h1>{nombre ? tr("Hola, {nombre}", { nombre }) : tr("Hola")}</h1>
          <p>{resumen(rol)}</p>
        </div>
      </header>
      <p className="pu-chips">
        <span className="pu-chip">
          <Ico n="users" />
          {rolLabel(rol)}
        </span>
        {account.campus && <span className="pu-chip">{campusLabel(account.campus)}</span>}
        {dominio && <span className="pu-chip">{dominio}</span>}
      </p>
      <div className="pu-groups">
        {grupos.map((g) => (
          <section key={g.titulo} className="pu-group" aria-label={g.titulo}>
            <h2>{g.titulo}</h2>
            <ul>
              {g.vistas.map((v) => (
                <li key={v.id}>
                  <Fila v={v} conexiones={conexiones} />
                </li>
              ))}
            </ul>
          </section>
        ))}
        {tieneGemini(rol) && (
          <section className="pu-group" aria-label={tr("Otras herramientas")}>
            <h2>{tr("Otras herramientas")}</h2>
            <ul>
              <li>
                <a className="pu-row" href={APP_GEMINI} target="_blank" rel="noopener noreferrer">
                  <span className="pu-ico" aria-hidden="true">
                    <Ico n="gemini" />
                  </span>
                  <span className="pu-row__t">
                    <b>Gemini</b>
                    <span>{tr("Se abre aparte, con su cuenta de la universidad")}</span>
                  </span>
                  <span className="pu-chip pu-chip--mut">
                    <Ico n="ext" />
                    {tr("Se abre aparte")}
                  </span>
                </a>
              </li>
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

function resumen(rol: PiloRol): string {
  if (rol === "estudiante") return tr("Sus clases, sus notas y su calendario, con Pilo.");
  if (rol === "profesor") return tr("Sus grupos, la evaluación y su calendario, con Pilo.");
  return tr("Estos son sus servicios de la universidad.");
}

/** Una fila del inicio: qué es, de dónde sale y en qué estado está. */
function Fila({ v, conexiones }: { v: VistaInfo; conexiones: Vinculos }) {
  return (
    <Link className="pu-row" to={uPath(v.id)}>
      <span className="pu-ico" aria-hidden="true">
        <Ico n={v.icono} />
      </span>
      <span className="pu-row__t">
        <b>{v.titulo}</b>
        <span>{v.pista}</span>
      </span>
      <Estado v={v} conexiones={conexiones} />
    </Link>
  );
}

function Estado({ v, conexiones }: { v: VistaInfo; conexiones: Vinculos }) {
  if (!v.real) {
    return (
      <span className="pu-chip pu-chip--mut">
        <Ico n="reloj" />
        {tr("Próximamente")}
      </span>
    );
  }
  if (v.necesita === "ninguna") return <span className="pu-chip pu-chip--mut">{v.fuente}</span>;
  const conectado = v.necesita === "genesis" ? conexiones.genesis : conexiones.moodle;
  return conectado ? (
    <span className="pu-chip pu-chip--ok">
      <Ico n="check" />
      {tr("Conectado")} · {v.fuente}
    </span>
  ) : (
    <span className="pu-chip pu-chip--go">{v.necesita === "genesis" ? tr("Conectar Génesis") : tr("Conectar Moodle")}</span>
  );
}

/* --- Una vista ------------------------------------------------------------------------------ */

function Vista({ vista, state, online, owner, voice, voiceOn, onVoice }: { vista: UVista; state: AccountState; online: boolean; owner: string; voice: AppVoice | null; voiceOn: boolean; onVoice: (on: boolean) => void }) {
  const info = vistaInfo(vista);
  const cuerpo = (() => {
    switch (vista) {
      case "presenciales":
        return <Presenciales owner={owner} />;
      case "virtuales":
      case "gruposv":
        return <ClasesPane state={state} online={online} />;
      case "notas":
        return <NotasPane state={state} online={online} voice={voice} voiceOn={voiceOn} onVoice={onVoice} />;
      case "calendario":
        return <Calendario owner={owner} />;
      case "grupos":
        return <Grupos />;
      case "horario":
        return <Horario />;
      case "boletin":
        return <BoletinVista />;
      case "asistencia":
        return <AsistenciaVista />;
      case "riesgo":
        return <RiesgoVista />;
      case "mensaje":
        return <MensajeVista />;
      default: {
        const p = proximamente(vista);
        return <Proximamente titulo={info.titulo} que={p.que} porque={p.porque} />;
      }
    }
  })();
  return <Marco info={info}>{cuerpo}</Marco>;
}
