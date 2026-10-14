/* =============================================================================
   Mr. Pilo · Pilo U · lo del estudiante que sale de las conexiones que ya hay.

   Mis clases presenciales: las materias del periodo en curso que Génesis ya
   entrega en el histórico (el horario con salones llegará cuando Génesis lo
   entregue; aquí no se inventa ninguna hora ni salón).
   Calendario académico: el mes con el día de hoy y, si la persona ya conectó
   Moodle, sus entregas. Las fechas oficiales de cortes aún no se publican en Pilo.
   ========================================================================== */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { tr, trn, useLang } from "../../../components/pilo/i18n";
import { loadAgenda } from "../clases/api";
import { readLink as readMoodle } from "../clases/logic";
import { asFailure, loadHistory } from "../notas/api";
import { readLink as readGenesis } from "../notas/logic";
import { uPath } from "../routes";
import { entregasPorDia, materiasEnCurso, periodoLegible, semanasDelMes } from "./datos";
import { Aviso, Cargando, Ico, useCarga } from "./parts";

/* --- Mis clases presenciales ---------------------------------------------------------------- */

export function Presenciales({ owner }: { owner: string }) {
  const link = readGenesis(owner);
  if (!link) {
    return (
      <section className="pu-gate">
        <p>{tr("Conecte Génesis y Pilo le muestra las materias que cursa este periodo. Pilo solo lee: no cambia nada en Génesis.")}</p>
        <Link className="pu-btn pu-btn--main" to={uPath("notas")}>
          {tr("Conectar Génesis")}
        </Link>
      </section>
    );
  }
  return <PresencialesLista permit={link.permit} periodo={link.head.period} />;
}

function PresencialesLista({ permit, periodo }: { permit: string; periodo: string }) {
  const { carga, recargar } = useCarga(
    async (señal) => materiasEnCurso(await loadHistory(permit, señal), periodo),
    (e) => asFailure(e).message,
    permit,
  );
  if (carga.estado === "carga") return <Cargando texto={tr("Pilo está leyendo Génesis…")} />;
  if (carga.estado === "error") return <Aviso texto={carga.mensaje} onRetry={recargar} />;
  const { materias, periodo: id } = carga.datos;
  return (
    <div className="pu-stack">
      <p className="pu-lead">{id ? tr("Periodo {periodo}, según Génesis.", { periodo: periodoLegible(id) }) : tr("Según Génesis.")}</p>
      {materias.length === 0 ? (
        <p className="pu-empty">{tr("Génesis no muestra materias en curso para este periodo todavía.")}</p>
      ) : (
        <ul className="pu-list">
          {materias.map((m) => (
            <li key={`${m.code}-${m.name}`} className="pu-item">
              <span className="pu-ico" aria-hidden="true">
                <Ico n="book" />
              </span>
              <span className="pu-item__t">
                <b>{m.name}</b>
                <span>
                  {[m.group ? tr("Grupo {grupo}", { grupo: m.group }) : "", m.credits ? trn(m.credits, "{n} crédito", "{n} créditos") : ""].filter(Boolean).join(" · ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="pu-fine">
        <Ico n="info" />
        <span>{tr("El horario con las horas y los salones llegará cuando Génesis lo entregue a Pilo.")}</span>
      </p>
    </div>
  );
}

/* --- Calendario académico ------------------------------------------------------------------- */

export function Calendario({ owner }: { owner: string }) {
  const lang = useLang();
  const hoy = useMemo(() => new Date(), []);
  const [vista, setVista] = useState({ anio: hoy.getFullYear(), mes: hoy.getMonth() });
  const link = readMoodle(owner);
  const { carga } = useCarga(
    async (señal) => (link ? (await loadAgenda(link.token, link.moodle?.id, señal)).deliveries : []),
    () => "",
    link?.token ?? "sin",
  );
  const entregas = carga.estado === "ok" ? carga.datos : [];
  const porDia = useMemo(() => entregasPorDia(entregas, vista.anio, vista.mes), [entregas, vista]);
  const semanas = semanasDelMes(vista.anio, vista.mes, hoy);
  const fecha = new Date(vista.anio, vista.mes, 1);
  const nombreMes = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(fecha);
  // Lunes primero: 5 de enero de 2026 fue lunes.
  const dias = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(lang, { weekday: "short" }).format(new Date(2026, 0, 5 + i)));
  const delMes = entregas.filter((e) => {
    const f = new Date(e.due * 1000);
    return f.getFullYear() === vista.anio && f.getMonth() === vista.mes;
  });
  const mueve = (d: number) => setVista((v) => {
    const f = new Date(v.anio, v.mes + d, 1);
    return { anio: f.getFullYear(), mes: f.getMonth() };
  });
  const hora = new Intl.DateTimeFormat(lang, { weekday: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="pu-stack">
      <div className="pu-month">
        <button type="button" className="pu-round" onClick={() => mueve(-1)} aria-label={tr("Mes anterior")}>
          <Ico n="left" />
        </button>
        <h2 aria-live="polite">{nombreMes}</h2>
        <button type="button" className="pu-round" onClick={() => mueve(1)} aria-label={tr("Mes siguiente")}>
          <Ico n="right" />
        </button>
      </div>
      <table className="pu-cal">
        <thead>
          <tr>
            {dias.map((d) => (
              <th key={d} scope="col">
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {semanas.map((s, i) => (
            <tr key={i}>
              {s.map((d, j) => {
                const n = d.dia ? (porDia.get(d.dia) ?? 0) : 0;
                return (
                  <td key={j} data-hoy={d.hoy || undefined} data-entrega={n > 0 || undefined} aria-current={d.hoy ? "date" : undefined}>
                    {d.dia > 0 && (
                      <>
                        <span>{d.dia}</span>
                        {n > 0 && (
                          <>
                            <i aria-hidden="true" />
                            <span className="pu-sr">{trn(n, "{n} entrega", "{n} entregas")}</span>
                          </>
                        )}
                      </>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {link ? (
        carga.estado === "carga" ? (
          <Cargando texto={tr("Pilo está leyendo sus entregas de Moodle…")} />
        ) : delMes.length ? (
          <ul className="pu-list">
            {delMes.map((e) => (
              <li key={e.id} className="pu-item">
                <span className="pu-ico" aria-hidden="true">
                  <Ico n="cal" />
                </span>
                <span className="pu-item__t">
                  <b>{e.title}</b>
                  <span>{[e.courseName, hora.format(new Date(e.due * 1000))].filter(Boolean).join(" · ")}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="pu-empty">{tr("No hay entregas de Moodle en este mes.")}</p>
        )
      ) : (
        <p className="pu-fine">
          <Ico n="info" />
          <span>
            {tr("Si conecta Moodle, sus entregas aparecen aquí.")} <Link to={uPath("virtuales")}>{tr("Ir a Mis clases virtuales")}</Link>
          </span>
        </p>
      )}
      <p className="pu-fine">
        <Ico n="info" />
        <span>{tr("Las fechas oficiales de cortes y vacaciones aún no se publican en Pilo.")}</span>
      </p>
    </div>
  );
}
