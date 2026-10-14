/* =============================================================================
   Mr. Pilo · Pilo U · las vistas de quien enseña.

   Construidas completas contra `DocenteData` (docente.ts). El proveedor de hoy
   responde «no disponible» y cada vista muestra «Próximamente» con lo que será y
   por qué aún no: nada de esto trae cifras de muestra. El día que exista el
   backend, se pasa otro proveedor por `DocenteContext` y las pantallas se llenan.

   La asistencia se guarda en Pilo y se exporta; escribirla en Génesis necesita un
   permiso que hoy no existe, y la pantalla lo dice. El escáner de carnets llega
   con el carnet digital y su verificador: por ahora solo «Por lista».
   Privacidad: solo se ve a los estudiantes de los grupos del profesor.
   ========================================================================== */

import { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { gsap } from "gsap";
import { tr, trn, useLang } from "../../../components/pilo/i18n";
import { nota } from "../notas/logic";
import { CORTES, RANGOS, SIN_DOCENTE, asistenciaCsv, boletin, boletinCsv, conteo, corteVigente, enRiesgo, hora, sesionesDelDia, siguienteMarca, todosPresentes } from "./docente";
import type { Asistencia, Corte, DocenteData, EnRiesgo, Estudiante, GrupoDoc, Marca, NotasEstudiante, Resp, Sesion } from "./docente";
import { Aviso, Cargando, Ico, Proximamente, Seg, calmado, descargar, useCarga } from "./parts";
import { proximamente, vistaInfo } from "./vistas";
import type { UVista } from "../routes";

/** De dónde salen los datos de quien enseña. Por defecto, de ninguna parte (y lo dice). */
export const DocenteContext = createContext<DocenteData>(SIN_DOCENTE);

const falla = () => tr("No se pudo leer. Revise su conexión e intente de nuevo.");
const nombreGrupo = (g: GrupoDoc) => `${g.materia} · ${g.grupo}`;

/** Lo que dice una respuesta que no llegó: «Próximamente» si no existe aún, o el aviso del fallo. */
function SinDatos({ vista, razon, onRetry }: { vista: UVista; razon: "no_disponible" | "sin_sesion" | "error"; onRetry?: () => void }) {
  if (razon === "no_disponible") {
    const p = proximamente(vista);
    return <Proximamente titulo={vistaInfo(vista).titulo} que={p.que} porque={p.porque} />;
  }
  return <Aviso texto={razon === "sin_sesion" ? tr("Entre de nuevo con su cuenta de Pilo para ver esto.") : falla()} onRetry={onRetry} />;
}

/** Lee algo del proveedor; en cualquier caso que no sea «ok» ya devuelve lo que se muestra. */
function useResp<T>(vista: UVista, leer: (d: DocenteData) => Promise<Resp<T>>, llave: string): { listo: T | null; vacio: ReactNode } {
  const d = useContext(DocenteContext);
  const { carga, recargar } = useCarga(() => leer(d), falla, `${vista}:${llave}`);
  if (carga.estado === "carga") return { listo: null, vacio: <Cargando /> };
  if (carga.estado === "error") return { listo: null, vacio: <Aviso texto={carga.mensaje} onRetry={recargar} /> };
  if (!carga.datos.ok) return { listo: null, vacio: <SinDatos vista={vista} razon={carga.datos.razon} onRetry={recargar} /> };
  return { listo: carga.datos.data, vacio: null };
}

/** Lee los grupos y deja elegir uno; lo de adentro recibe el elegido. */
function ConGrupo({ vista, children }: { vista: UVista; children: (g: GrupoDoc) => ReactNode }) {
  const { listo, vacio } = useResp(vista, (d) => d.grupos(), "grupos");
  const [id, setId] = useState("");
  if (!listo) return <>{vacio}</>;
  if (listo.length === 0) return <p className="pu-empty">{tr("No hay grupos a su nombre en este periodo.")}</p>;
  const g = listo.find((x) => x.id === id) ?? listo[0];
  return (
    <div className="pu-stack">
      {listo.length > 1 && <Seg nombre={tr("Grupo")} items={listo.map((x): [string, string] => [x.id, nombreGrupo(x)])} valor={g.id} onChange={setId} />}
      <div key={g.id} className="pu-stack">
        {children(g)}
      </div>
    </div>
  );
}

/* --- Mis grupos ----------------------------------------------------------------------------- */

export function Grupos() {
  const { listo, vacio } = useResp("grupos", (d) => d.grupos(), "grupos");
  if (!listo) return <>{vacio}</>;
  if (listo.length === 0) return <p className="pu-empty">{tr("No hay grupos a su nombre en este periodo.")}</p>;
  return (
    <ul className="pu-list">
      {listo.map((g) => (
        <li key={g.id} className="pu-item">
          <span className="pu-ico" aria-hidden="true">
            <Ico n="users" />
          </span>
          <span className="pu-item__t">
            <b>{nombreGrupo(g)}</b>
            <span>{trn(g.estudiantes, "{n} estudiante", "{n} estudiantes")}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/* --- Mi horario ----------------------------------------------------------------------------- */

export function Horario() {
  const lang = useLang();
  const { listo, vacio } = useResp("horario", (d) => d.horario(), "horario");
  const [dia, setDia] = useState(() => new Date().getDay());
  if (!listo) return <>{vacio}</>;
  const orden = [1, 2, 3, 4, 5, 6, 0];
  const nombre = (n: number, largo = false) => new Intl.DateTimeFormat(lang, { weekday: largo ? "long" : "short" }).format(new Date(2026, 0, 4 + n));
  const hoy = sesionesDelDia(listo as Sesion[], dia);
  return (
    <div className="pu-stack">
      <Seg nombre={tr("Día")} items={orden.map((n): [string, string] => [String(n), nombre(n)])} valor={String(dia)} onChange={(v) => setDia(Number(v))} />
      {hoy.length === 0 ? (
        <p className="pu-empty">{tr("Ese día no dicta clases.")}</p>
      ) : (
        <ul className="pu-list">
          {hoy.map((s, i) => (
            <li key={i} className="pu-item">
              <span className="pu-ico pu-ico--hora" aria-hidden="true">
                {hora(s.desde)}
              </span>
              <span className="pu-item__t">
                <b>{s.materia}</b>
                <span>{[tr("Grupo {grupo}", { grupo: s.grupo }), s.salon, `${hora(s.desde)} – ${hora(s.hasta)}`].filter(Boolean).join(" · ")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --- Boletín de notas ----------------------------------------------------------------------- */

function useListaYNotas(vista: UVista, g: GrupoDoc) {
  return useResp(
    vista,
    async (d): Promise<Resp<{ lista: Estudiante[]; notas: NotasEstudiante[] }>> => {
      const [l, n] = await Promise.all([d.lista(g.id), d.notas(g.id)]);
      if (!l.ok) return l;
      if (!n.ok) return n;
      return { ok: true, data: { lista: l.data, notas: n.data } };
    },
    g.id,
  );
}

export function BoletinVista() {
  return <ConGrupo vista="boletin">{(g) => <BoletinGrupo g={g} />}</ConGrupo>;
}

function BoletinGrupo({ g }: { g: GrupoDoc }) {
  const { listo, vacio } = useListaYNotas("boletin", g);
  const [elegido, setElegido] = useState<Corte | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const corte = elegido ?? (listo ? corteVigente(listo.notas) : "p1");
  const b = useMemo(() => (listo ? boletin(listo.notas, corte) : null), [listo, corte]);

  // Las barras crecen desde la izquierda al cambiar de corte.
  useLayoutEffect(() => {
    if (!raiz.current || !b || calmado()) return;
    const t = gsap.fromTo(raiz.current.querySelectorAll(".pu-bar i"), { scaleX: 0 }, { scaleX: 1, duration: 0.32, stagger: 0.05, ease: "power3.out", transformOrigin: "0 50%", clearProps: "transform" });
    return () => void t.kill();
  }, [g.id, corte, b?.conNota]);

  if (!listo || !b) return <>{vacio}</>;
  const nombres = new Map(listo.lista.map((e) => [e.id, e.nombre]));
  const mayor = Math.max(1, ...b.reparto);
  const etiqueta = (c: Corte) => c.toUpperCase();
  return (
    <div className="pu-stack" ref={raiz}>
      <Seg nombre={tr("Corte")} items={CORTES.map((c): [Corte, string] => [c, etiqueta(c)])} valor={corte} onChange={setElegido} />
      {b.conNota === 0 ? (
        <p className="pu-empty">{tr("Este corte aún no tiene notas. Cuando las registre en Génesis, el boletín se arma solo.")}</p>
      ) : (
        <>
          <div className="pu-stats">
            <p>
              <b className="pu-num">{nota(b.promedio)}</b>
              <span>{tr("promedio del grupo")}</span>
            </p>
            <p>
              <b className="pu-num">{Math.round(b.aprueba ?? 0)} %</b>
              <span>{tr("aprueba (3,0 o más)")}</span>
            </p>
          </div>
          <section className="pu-card">
            <h2>{tr("Cómo se reparten las notas")}</h2>
            {RANGOS.map((r, i) => (
              <div key={r} className="pu-hrow">
                <span>{r}</span>
                <span className="pu-bar">
                  <i style={{ width: `${(b.reparto[i] / mayor) * 100}%` }} />
                </span>
                <b className="pu-num">{b.reparto[i]}</b>
              </div>
            ))}
          </section>
          <section className="pu-card">
            <h2>{trn(b.debajo.length, "{n} estudiante por debajo de 3,0", "{n} estudiantes por debajo de 3,0")}</h2>
            {b.debajo.length > 0 && (
              <ul className="pu-plain">
                {b.debajo.map((x) => (
                  <li key={x.id}>
                    {nombres.get(x.id) ?? x.id} · <b className="pu-num">{nota(x.nota)}</b>
                    {x.antes !== null && x.antes > x.nota ? ` ${tr("(bajó desde {antes})", { antes: nota(x.antes) })}` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
      <button type="button" className="pu-btn pu-btn--line" onClick={() => descargar(`boletin-${g.grupo}.csv`, boletinCsv(listo.lista, listo.notas, nombreGrupo(g)))}>
        <Ico n="chart" />
        {tr("Exportar el boletín (Excel)")}
      </button>
      <Privacidad />
    </div>
  );
}

const Privacidad = () => (
  <p className="pu-fine">
    <Ico n="info" />
    <span>{tr("Solo ve a los estudiantes de sus grupos. Pilo no comparte esta lista con nadie.")}</span>
  </p>
);

/* --- Tomar asistencia ----------------------------------------------------------------------- */

const ESTADO: Record<Marca, { glifo: "info" | "check" | "x" | "reloj" | "cal"; texto: () => string }> = {
  "": { glifo: "info", texto: () => tr("Sin marcar") },
  P: { glifo: "check", texto: () => tr("Presente") },
  A: { glifo: "x", texto: () => tr("Ausente") },
  T: { glifo: "reloj", texto: () => tr("Tarde") },
  E: { glifo: "cal", texto: () => tr("Excusa") },
};

export function AsistenciaVista() {
  return <ConGrupo vista="asistencia">{(g) => <AsistenciaGrupo g={g} />}</ConGrupo>;
}

function AsistenciaGrupo({ g }: { g: GrupoDoc }) {
  const d = useContext(DocenteContext);
  const { listo, vacio } = useResp("asistencia", (p) => p.lista(g.id), g.id);
  const [marcas, setMarcas] = useState<Record<string, Marca>>({});
  const [estado, setEstado] = useState<"" | "guardando" | "guardada" | "error">("");
  if (!listo) return <>{vacio}</>;
  const ids = listo.map((e) => e.id);
  const c = conteo(ids, marcas);
  const fecha = (() => {
    const h = new Date();
    return `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`;
  })();
  const registro = (): Asistencia => ({ grupo: g.id, fecha, marcas });
  const cambia = (m: Record<string, Marca>) => {
    setMarcas(m);
    setEstado("");
  };
  const guardar = async () => {
    setEstado("guardando");
    const r = await d.guardarAsistencia(registro()).catch(() => null);
    setEstado(r?.ok ? "guardada" : "error");
  };
  const marcados = c.presentes + c.ausentes + c.tardeOExcusa;
  return (
    <div className="pu-stack">
      <p className="pu-count" role="status">
        <span><b className="pu-num">{c.presentes}</b>{tr("Presentes")}</span>
        <span><b className="pu-num">{c.ausentes}</b>{tr("Ausentes")}</span>
        <span><b className="pu-num">{c.tardeOExcusa}</b>{tr("Tarde o excusa")}</span>
        <span><b className="pu-num">{c.sinMarcar}</b>{tr("Sin marcar")}</span>
      </p>
      <Seg nombre={tr("Cómo toma la asistencia")} items={[["lista", tr("Por lista")]]} valor="lista" onChange={() => undefined} />
      <p className="pu-fine">
        <Ico n="scan" />
        <span>{tr("Escanear carnets llega con el carnet digital y su verificador.")}</span>
      </p>
      <button type="button" className="pu-btn pu-btn--line" onClick={() => cambia(todosPresentes(ids))}>
        {tr("Marcar a todos presentes")}
      </button>
      <ul className="pu-list">
        {listo.map((e) => {
          const m = marcas[e.id] ?? "";
          const est = ESTADO[m];
          return (
            <li key={e.id}>
              <button type="button" className="pu-mark" data-m={m || "none"} onClick={() => cambia({ ...marcas, [e.id]: siguienteMarca(m) })} aria-label={`${e.nombre}: ${est.texto()}. ${tr("Toque para cambiar")}`}>
                <span className="pu-ico" aria-hidden="true">{e.nombre.charAt(0)}</span>
                <b>{e.nombre}</b>
                <span className="pu-chip">
                  <Ico n={est.glifo} />
                  {est.texto()}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <button type="button" className="pu-btn pu-btn--main" disabled={marcados === 0 || estado === "guardando"} onClick={guardar}>
        {estado === "guardada" ? tr("Asistencia guardada") : tr("Guardar la asistencia")}
      </button>
      {estado === "error" && <Aviso texto={tr("Pilo todavía no puede guardar la asistencia. Puede exportarla y no se pierde lo marcado.")} />}
      {marcados > 0 && (
        <button type="button" className="pu-btn pu-btn--line" onClick={() => descargar(`asistencia-${g.grupo}-${fecha}.csv`, asistenciaCsv(registro(), listo))}>
          {tr("Exportar a Excel")}
        </button>
      )}
      <p className="pu-fine">
        <Ico n="info" />
        <span>{tr("La asistencia queda en Pilo. Escribirla en Génesis necesita un permiso que hoy Pilo no tiene: solo lee.")}</span>
      </p>
      <Privacidad />
    </div>
  );
}

/* --- Estudiantes en riesgo ------------------------------------------------------------------ */

interface FilaRiesgo extends EnRiesgo {
  nombre: string;
  materia: string;
}

export function RiesgoVista() {
  const { listo, vacio } = useResp(
    "riesgo",
    async (d): Promise<Resp<FilaRiesgo[]>> => {
      const gs = await d.grupos();
      if (!gs.ok) return gs;
      const filas: FilaRiesgo[] = [];
      for (const g of gs.data) {
        const [l, n, f] = await Promise.all([d.lista(g.id), d.notas(g.id), d.faltas(g.id)]);
        if (!l.ok) return l;
        if (!n.ok) return n;
        const nombres = new Map(l.data.map((e) => [e.id, e.nombre]));
        for (const r of enRiesgo(g.id, n.data, f.ok ? f.data : {})) filas.push({ ...r, nombre: nombres.get(r.id) ?? r.id, materia: nombreGrupo(g) });
      }
      return { ok: true, data: filas };
    },
    "todos",
  );
  if (!listo) return <>{vacio}</>;
  if (listo.length === 0) return <p className="pu-empty">{tr("Ningún estudiante de sus grupos tiene una nota por debajo de 3,0 ni 4 inasistencias o más.")}</p>;
  return (
    <div className="pu-stack">
      <p className="pu-lead">{trn(listo.length, "{n} estudiante con nota por debajo de 3,0 o 4 inasistencias o más.", "{n} estudiantes con nota por debajo de 3,0 o 4 inasistencias o más.")}</p>
      <ul className="pu-list">
        {listo.map((r) => (
          <li key={`${r.grupo}-${r.id}`} className="pu-item">
            <span className="pu-ico" aria-hidden="true">{r.nombre.charAt(0)}</span>
            <span className="pu-item__t">
              <b>{r.nombre}</b>
              <span>{r.materia}</span>
              <span>
                {r.motivos
                  .map((m) => (m.tipo === "nota" ? tr("Nota {nota} en {corte}", { nota: nota(m.nota), corte: m.corte.toUpperCase() }) : trn(m.n, "{n} inasistencia", "{n} inasistencias")))
                  .join(" · ")}
              </span>
            </span>
          </li>
        ))}
      </ul>
      <Privacidad />
    </div>
  );
}

/* --- Mensaje a un grupo --------------------------------------------------------------------- */

export function MensajeVista() {
  return <ConGrupo vista="mensaje">{(g) => <MensajeGrupo g={g} />}</ConGrupo>;
}

function MensajeGrupo({ g }: { g: GrupoDoc }) {
  const d = useContext(DocenteContext);
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<"" | "enviando" | "enviado" | "error">("");
  const enviar = async () => {
    setEstado("enviando");
    const r = await d.enviarMensaje(g.id, texto.trim()).catch(() => null);
    setEstado(r?.ok ? "enviado" : "error");
    if (r?.ok) setTexto("");
  };
  return (
    <div className="pu-stack">
      <label className="pu-field">
        <span>{tr("Mensaje para {grupo}", { grupo: nombreGrupo(g) })}</span>
        <textarea value={texto} rows={5} maxLength={1000} placeholder={tr("Escriba el aviso")} onChange={(e) => { setTexto(e.target.value); setEstado(""); }} />
      </label>
      <button type="button" className="pu-btn pu-btn--main" disabled={!texto.trim() || estado === "enviando"} onClick={enviar}>
        {trn(g.estudiantes, "Enviar a {n} estudiante", "Enviar a {n} estudiantes")}
      </button>
      {estado === "enviado" && <p className="pu-ok" role="status"><Ico n="check" />{tr("Aviso enviado por Moodle.")}</p>}
      {estado === "error" && <Aviso texto={tr("No se pudo enviar el aviso. Su texto sigue aquí.")} />}
    </div>
  );
}

