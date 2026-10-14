/* =============================================================================
   Alertas de emergencia · la capa de Mr. Pilo (0138).

   Vive montada en toda la aplicación y está dormida: lee la tabla pilo_alerts
   una vez al abrir y se queda escuchando sus cambios. Cuando Aluna declara una
   emergencia (sismo, incendio, seguridad), la función `pilo-alertas` la anota
   ahí y esta capa aparece, a pantalla completa, en cualquier página y para
   cualquier persona, con o sin sesión. Al cerrarse en Aluna, se retira sola.

   El diseño es el de la alerta de Aluna (src/features/avisos de Aluna2): un
   color por clase, fondo que se mueve, marco luminoso que late, el título en
   dos líneas, las instrucciones como pasos y, al cerrarse, la pantalla verde
   de «Todo está bien». Quien ve la alerta en Pilo reconoce la de Aluna.

   La voz es la de Mr. Pilo con Fish Audio (la misma vía directa de las
   respuestas: api/pilo-voz y, si falta, la función pilo-ia). Solo si ninguna
   da audio habla la voz del navegador: en una emergencia es mejor eso que el
   silencio. Los navegadores no dejan sonar sin un toque previo; si la voz no
   arranca sola, el botón «Escuchar a Pilo» la lee.

   Tres formas:
     · completa   la emergencia sin leer: qué pasa, qué hacer, escuchar a Pilo.
     · franja     ya la leyó: queda abajo, porque la emergencia sigue.
     · despejado  Aluna dio por controlada la emergencia: «Todo está bien».

   Sin la migración 0138 la lectura falla y la capa queda dormida.
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, ReactNode } from "react";
import gsap from "gsap";
import { supabase } from "../../lib/supabase";
import { PiloAvatar } from "../pilo/PiloAvatar";
import { prefetchPilo, sayWithPilo, stopPilo } from "../pilo/ai/client";
import { COLUMNAS_ALERTA, estadoCapa, filasDe, frasesParaLeer, mensajeDespejado, presentar } from "./logic";
import type { EstadoCapa, FilaAlerta, KindAlerta } from "./logic";
import "./alertas.css";

const LEIDAS = "pilo-alertas-leidas";
const DESPEJADOS = "pilo-alertas-despejadas";

function leerSet(clave: string): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(clave) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function guardarSet(clave: string, valor: Set<string>) {
  try {
    sessionStorage.setItem(clave, JSON.stringify([...valor].slice(-50)));
  } catch {
    /* sin almacenamiento: la capa funciona igual, solo olvida lo leído al recargar */
  }
}

const reducido = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Las alertas de la tabla, al abrir y en vivo. Sin la migración, la lista queda vacía. */
export function useAlertas(): FilaAlerta[] {
  const [filas, setFilas] = useState<FilaAlerta[]>([]);

  useEffect(() => {
    let vivo = true;
    const cargar = async () => {
      const { data, error } = await supabase.from("pilo_alerts").select(COLUMNAS_ALERTA).order("emitted_at", { ascending: false }).limit(20);
      if (vivo && !error) setFilas(filasDe(data));
    };
    void cargar();
    const abrir = () =>
      supabase
        .channel("pilo-alerts")
        .on("postgres_changes", { event: "*", schema: "public", table: "pilo_alerts" }, () => void cargar())
        .subscribe();
    let canal: ReturnType<typeof abrir> | null = abrir();
    const cerrar = () => {
      if (canal) void supabase.removeChannel(canal);
      canal = null;
    };
    // Si el canal en vivo se cae (red, móvil dormido), al volver a la pestaña se vuelve a preguntar.
    const alVolver = () => {
      if (document.visibilityState === "visible") void cargar();
    };
    // Una conexión abierta saca la página de la caché de ida y vuelta del navegador (y ensucia la
    // consola): se cierra al salir y se reabre, con una lectura fresca, si la página regresa de ella.
    const alSalir = () => cerrar();
    const alRegresar = (e: PageTransitionEvent) => {
      if (!e.persisted || canal) return;
      canal = abrir();
      void cargar();
    };
    document.addEventListener("visibilitychange", alVolver);
    window.addEventListener("pagehide", alSalir);
    window.addEventListener("pageshow", alRegresar);
    return () => {
      vivo = false;
      document.removeEventListener("visibilitychange", alVolver);
      window.removeEventListener("pagehide", alSalir);
      window.removeEventListener("pageshow", alRegresar);
      cerrar();
    };
  }, []);

  return filas;
}

/* --- Los iconos (los de Aluna, dibujados aquí para no depender de una fuente) ------------------ */

function Icono({ nombre, tamano = 24 }: { nombre: KindAlerta | "simulacro" | "check" | "pin"; tamano?: number }) {
  const base = { width: tamano, height: tamano, viewBox: "0 0 24 24", "aria-hidden": true, focusable: false } as const;
  switch (nombre) {
    case "incendio":
      return (
        <svg {...base} fill="currentColor">
          <path d="M12.6 2.2c.4 3-1.2 4.6-2.7 6.4C8.5 10.2 7 12 7 14.6A5.2 5.2 0 0 0 12.2 20a5.2 5.2 0 0 0 5.2-5.4c0-2.2-1-3.7-2-5-.5 1-1.2 1.6-2 1.9.5-2.6.1-6-.9-9.3z" />
        </svg>
      );
    case "sismo":
      return (
        <svg {...base} fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12h4l2-6 4 12 3-9 2 3h5" />
        </svg>
      );
    case "seguridad":
      return (
        <svg {...base} fill="currentColor">
          <path d="M12 2 4 5.2V11c0 4.9 3.3 9.3 8 11 4.7-1.7 8-6.1 8-11V5.2L12 2zm-1 5h2v6h-2V7zm0 8h2v2h-2v-2z" />
        </svg>
      );
    case "simulacro":
      return (
        <svg {...base} fill="currentColor">
          <path d="M9 2h6v2h-1v5.3l5.4 9A2 2 0 0 1 17.7 21H6.3a2 2 0 0 1-1.7-2.7L10 9.3V4H9V2zm2.2 9.2L8 16.5h8l-3.2-5.3V4h-1.6v7.2z" />
        </svg>
      );
    case "check":
      return (
        <svg {...base} fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      );
    case "pin":
      return (
        <svg {...base} fill="currentColor">
          <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6a2.5 2.5 0 0 1 0 5.5z" />
        </svg>
      );
    default:
      return (
        <svg {...base} fill="currentColor">
          <path d="M12 2 1 21h22L12 2zm-1 7h2v6h-2V9zm0 8h2v2h-2v-2z" />
        </svg>
      );
  }
}

/** La onda del sismo: un trazo que tiembla en el centro y corre de lado. */
function Onda() {
  const puntos = useMemo(() => {
    let p = "";
    let x = 0;
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i <= 60; i++) {
        const a = i > 18 && i < 42 ? Math.sin(i * 1.7) * 38 * Math.sin(((i - 18) / 24) * Math.PI) : Math.sin(i * 0.9) * 4;
        p += `${x.toFixed(2)},${(50 + a).toFixed(2)} `;
        x += 100 / 60;
      }
    }
    return p;
  }, []);
  return (
    <svg className="al-onda" viewBox="0 0 200 100" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={puntos} />
    </svg>
  );
}

function cronometro(desde: string, ahora: number): string {
  const s = Math.max(0, Math.floor((ahora - (Date.parse(desde) || ahora)) / 1000));
  const ss = String(s % 60).padStart(2, "0");
  if (s >= 3600) return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${ss}`;
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${ss}`;
}

/* --- La voz de Pilo ------------------------------------------------------------------------------- */

/** Las alertas que ya se intentaron leer solas en esta visita: no se repite la lectura. */
const LEIDAS_EN_VOZ = new Set<string>();

/**
 * Lee la alerta con la voz de Mr. Pilo (Fish Audio), frase por frase. Las
 * frases se piden por adelantado para que suenen sin pausas. `solaUnaVez`
 * intenta leerla al aparecer; si el navegador no deja sonar sin un toque, el
 * botón la lee.
 */
function useVozDeAlerta(alerta: FilaAlerta, solaUnaVez: boolean) {
  const [leyendo, setLeyendo] = useState(false);
  const vivo = useRef(true);
  const turno = useRef(0);

  const leer = useCallback(async () => {
    const mio = ++turno.current;
    const frases = frasesParaLeer(alerta);
    const opciones = { portal: "pregunta" as const, advanced: true, tone: "confident" };
    setLeyendo(true);
    prefetchPilo(frases, opciones);
    for (const frase of frases) {
      const como = await sayWithPilo(frase, opciones);
      if (como === "cancelado" || mio !== turno.current) break;
    }
    if (vivo.current && mio === turno.current) setLeyendo(false);
  }, [alerta]);

  const parar = useCallback(() => {
    turno.current += 1;
    stopPilo();
    setLeyendo(false);
  }, []);

  useEffect(() => {
    vivo.current = true;
    if (solaUnaVez && !LEIDAS_EN_VOZ.has(alerta.id)) {
      LEIDAS_EN_VOZ.add(alerta.id);
      void leer();
    }
    return () => {
      vivo.current = false;
      turno.current += 1;
      stopPilo();
    };
    // Una lectura por alerta; `leer` cambia con ella.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alerta.id]);

  return { leyendo, alternar: () => (leyendo ? parar() : void leer()) };
}

/* --- La alerta a pantalla completa -------------------------------------------------------------- */

function CapaCompleta({ alerta, activas, vistaPrevia, onLeida }: { alerta: FilaAlerta; activas: number; vistaPrevia: boolean; onLeida: (id: string) => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  const p = useMemo(() => presentar(alerta), [alerta]);
  const [ahora, setAhora] = useState(() => Date.now());
  const voz = useVozDeAlerta(alerta, true);

  useEffect(() => {
    const t = window.setInterval(() => setAhora(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // El teléfono vibra una vez al aparecer (nunca en la vista previa).
  useEffect(() => {
    if (vistaPrevia) return;
    try {
      navigator.vibrate?.([300, 150, 300, 150, 600]);
    } catch {
      /* no todos los dispositivos vibran */
    }
  }, [vistaPrevia, alerta.id]);

  // Entrada: destello, el fondo se abre desde el icono y el contenido llega en orden.
  useLayoutEffect(() => {
    const nodo = raiz.current;
    if (!nodo) return;
    nodo.querySelector<HTMLButtonElement>(".al-btn")?.focus({ preventScroll: true });
    if (reducido()) return;
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });
      // Como mucho dos destellos, y separados: nunca más de dos por segundo.
      tl.to(".al-flash", { opacity: 0.6, duration: 0.06 }).to(".al-flash", { opacity: 0, duration: 0.3 });
      tl.fromTo(nodo, { clipPath: "circle(0% at 12% 30%)" }, { clipPath: "circle(150% at 12% 30%)", duration: 0.75, ease: "power3.out", clearProps: "clipPath" }, 0)
        .from(".al-ico", { scale: 0.5, rotate: -18, opacity: 0, duration: 0.6, ease: "back.out(2.2)" }, 0.2)
        .from(".al-tit .al-ln > span", { yPercent: 110, duration: 0.7, stagger: 0.09 }, 0.28)
        .from(".al-top", { opacity: 0, y: -10, duration: 0.4 }, 0.25)
        .from(".al-paso", { opacity: 0, x: -24, duration: 0.5, stagger: 0.12, clearProps: "opacity,transform" }, 0.55)
        .from(".al-btn", { opacity: 0, y: 18, duration: 0.45, stagger: 0.08, clearProps: "opacity,transform" }, "-=0.2");
      // El icono respira mientras la alerta siga viva.
      gsap.to(".al-ico", { scale: 1.06, duration: 0.8, ease: "sine.inOut", repeat: -1, yoyo: true, delay: 1.6 });
    }, nodo);
    return () => ctx.revert();
  }, [alerta.id]);

  // El foco no sale de la alerta: debajo está la aplicación entera.
  const alTeclear = (e: KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const botones = Array.from(raiz.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? []);
    if (!botones.length) return;
    const primero = botones[0];
    const ultimo = botones[botones.length - 1];
    if (e.shiftKey && document.activeElement === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && document.activeElement === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  };

  return (
    <div
      ref={raiz}
      className={`al-capa al-${p.ambiente}`}
      style={{ "--c1": p.c1, "--c2": p.c2 } as CSSProperties}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="al-titulo"
      aria-describedby="al-cuerpo"
      onKeyDown={alTeclear}
    >
      <div className="al-amb" aria-hidden="true">
        <i />
        <i />
      </div>
      {p.ambiente === "sismo" && <Onda />}
      <div className="al-baliza" aria-hidden="true" />
      <div className="al-flash" aria-hidden="true" />

      <div className="al-cont">
        <div className="al-top">
          <span>{p.simulacro ? "Simulacro · no es una emergencia real" : "Emergencia · Universidad de Santander"}</span>
          <span className="al-cron" aria-label="Tiempo desde la emisión">
            {cronometro(alerta.emitted_at, ahora)}
          </span>
        </div>

        <div className="al-cab">
          <div className="al-ico">
            <Icono nombre={p.simulacro ? "simulacro" : alerta.kind} tamano={56} />
          </div>
          <div className="al-cab__texto">
            <h2 id="al-titulo" className={`al-tit${p.lineas.length === 1 ? " al-libre" : ""}`}>
              {p.lineas.map((l) => (
                <span key={l} className="al-ln">
                  <span>{l}</span>
                </span>
              ))}
            </h2>
            {p.subtitulo && <p className="al-sub">{p.subtitulo}</p>}
          </div>
        </div>

        <div id="al-cuerpo" className="al-cuerpo">
          <ol className="al-pasos">
            {p.simulacro && (
              <li className="al-paso">
                <b>
                  <Icono nombre="simulacro" tamano={18} />
                </b>
                Esto es un simulacro. Actúe como si fuera real.
              </li>
            )}
            {p.pasos.map((paso, i) => (
              <li key={i} className="al-paso">
                <b>{i + 1}</b>
                {paso}
              </li>
            ))}
          </ol>
          {p.alcance && (
            <p className="al-nota">
              <Icono nombre="pin" tamano={18} />
              {p.alcance}
            </p>
          )}
          <p className="al-nota">
            {activas > 1 ? `Hay ${activas} emergencias activas. ` : ""}
            Siga siempre las instrucciones de las brigadas y de la seguridad de su sede.
          </p>
          <div className="al-pilo">
            <PiloAvatar mood="cuidado" size={46} alive={voz.leyendo} className="al-pilo__cara" />
            <span>{voz.leyendo ? "Mr. Pilo le está leyendo la alerta…" : "Mr. Pilo puede leerle la alerta en voz alta."}</span>
          </div>
          <div className="al-acc">
            <button type="button" className="al-btn" onClick={() => onLeida(alerta.id)}>
              {p.entendido}
            </button>
            <button type="button" className="al-btn al-sec" onClick={voz.alternar} aria-pressed={voz.leyendo}>
              {voz.leyendo ? "Detener a Pilo" : "Escuchar a Pilo"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --- La emergencia minimizada --------------------------------------------------------------------- */

function Franja({ alerta, activas, onReabrir }: { alerta: FilaAlerta; activas: number; onReabrir: (id: string) => void }) {
  const p = presentar(alerta);
  return (
    <div className={`al-franja${p.simulacro ? " al-franja-sim" : ""}`} role="status">
      <span className="al-franja__ico" aria-hidden="true">
        <Icono nombre={p.simulacro ? "simulacro" : alerta.kind} tamano={22} />
      </span>
      <div>
        <b>
          {p.simulacro ? "Simulacro en curso" : "Emergencia en curso"} · {p.lineas.join(" ")}
        </b>
        <small>{activas > 1 ? `${activas} emergencias activas` : "Siga las instrucciones de su sede"}</small>
      </div>
      <button type="button" onClick={() => onReabrir(alerta.id)}>
        Abrir la alerta
      </button>
    </div>
  );
}

/* --- «Todo está bien» ------------------------------------------------------------------------------ */

/** La pantalla verde del fin de la emergencia. Se cierra sola; el botón es para quien no quiera esperar. */
function Despejado({ alerta, onCerrar }: { alerta: FilaAlerta; onCerrar: (id: string) => void }) {
  const raiz = useRef<HTMLDivElement>(null);
  const mensaje = mensajeDespejado(alerta);

  useEffect(() => {
    const t = window.setTimeout(() => onCerrar(alerta.id), reducido() ? 6000 : 12000);
    return () => window.clearTimeout(t);
  }, [alerta.id, onCerrar]);

  // Pilo da la buena noticia con su voz, una vez.
  useEffect(() => {
    if (LEIDAS_EN_VOZ.has(`despejado-${alerta.id}`)) return;
    LEIDAS_EN_VOZ.add(`despejado-${alerta.id}`);
    void sayWithPilo(`Todo está bien. ${mensaje}`, { portal: "pregunta", advanced: true, tone: "warm" });
    return () => stopPilo();
  }, [alerta.id, mensaje]);

  useLayoutEffect(() => {
    const f = raiz.current;
    if (!f) return;
    f.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    if (reducido()) return;
    const ctx = gsap.context(() => {
      gsap.set("circle", { strokeDasharray: 208, strokeDashoffset: 208, rotation: -90, transformOrigin: "50% 50%" });
      gsap.set("path.al-fin__marca", { strokeDasharray: 44, strokeDashoffset: 44 });
      gsap
        .timeline()
        .fromTo(f, { clipPath: "circle(0% at 50% 50%)" }, { clipPath: "circle(150% at 50% 50%)", duration: 0.7, ease: "power3.out", clearProps: "clipPath" })
        .to("circle", { strokeDashoffset: 0, duration: 0.6, ease: "power2.inOut" }, "-=0.3")
        .to("path.al-fin__marca", { strokeDashoffset: 0, duration: 0.35, ease: "power3.out" }, "-=0.15")
        .from("h2, p, button", { opacity: 0, y: 18, duration: 0.5, ease: "expo.out", stagger: 0.08, clearProps: "opacity,transform" }, "-=0.3");
    }, f);
    return () => ctx.revert();
  }, []);

  return (
    <div ref={raiz} className="al-fin" role="status" aria-live="assertive">
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r="33" />
        <path className="al-fin__marca" d="M22 37.5l9.5 9.5L51 27" />
      </svg>
      <h2>Todo está bien</h2>
      <p>{mensaje}</p>
      <button type="button" onClick={() => onCerrar(alerta.id)}>
        Cerrar
      </button>
    </div>
  );
}

/* --- La capa --------------------------------------------------------------------------------------- */

interface CapaProps {
  estado: EstadoCapa;
  onLeida: (id: string) => void;
  onReabrir: (id: string) => void;
  onDespejado: (id: string) => void;
  /** Vista previa de la administración: no es una emergencia y no vibra. */
  vistaPrevia?: boolean;
}

export function AlertaCapa({ estado, onLeida, onReabrir, onDespejado, vistaPrevia = false }: CapaProps): ReactNode {
  const { modo, alerta } = estado;
  if (modo === "dormida" || !alerta) return null;
  if (modo === "franja") return <Franja alerta={alerta} activas={estado.activas} onReabrir={onReabrir} />;
  if (modo === "despejado") return <Despejado alerta={alerta} onCerrar={onDespejado} />;
  // Una `key` por alerta: cada una entra con su propia animación y su propia lectura.
  return <CapaCompleta key={alerta.id} alerta={alerta} activas={estado.activas} vistaPrevia={vistaPrevia} onLeida={onLeida} />;
}

/** El contenedor: lee las alertas, recuerda lo que la persona ya leyó y pinta la capa. */
export function AlertaEmergencia() {
  const filas = useAlertas();
  const [leidas, setLeidas] = useState<Set<string>>(() => leerSet(LEIDAS));
  const [despejados, setDespejados] = useState<Set<string>>(() => leerSet(DESPEJADOS));

  const estado = useMemo(() => estadoCapa(filas, leidas, despejados, Date.now()), [filas, leidas, despejados]);

  const marcar = useCallback((clave: string, set: Set<string>, cambiar: (s: Set<string>) => void, id: string, poner: boolean) => {
    const next = new Set(set);
    if (poner) next.add(id);
    else next.delete(id);
    guardarSet(clave, next);
    cambiar(next);
  }, []);

  return (
    <AlertaCapa
      estado={estado}
      onLeida={(id) => marcar(LEIDAS, leidas, setLeidas, id, true)}
      onReabrir={(id) => marcar(LEIDAS, leidas, setLeidas, id, false)}
      onDespejado={(id) => marcar(DESPEJADOS, despejados, setDespejados, id, true)}
    />
  );
}

/** Para la administración: cómo se ve la capa, sin tocar la base ni avisar a nadie. */
export function AlertaVistaPrevia({ kind, simulacro = false, onClose }: { kind: KindAlerta; simulacro?: boolean; onClose: () => void }) {
  const [leida, setLeida] = useState(false);
  const [despejada, setDespejada] = useState(false);
  const alerta: FilaAlerta = useMemo(
    () => ({
      id: `vista-previa-${kind}-${simulacro ? "s" : "r"}`,
      source: simulacro ? "simulacro" : "aluna",
      code: "VISTA PREVIA",
      kind,
      title: kind === "general" ? "Emergencia en el campus" : `Alerta de ${kind}`,
      body: "",
      state: despejada ? "cerrada" : "activa",
      emitted_at: new Date().toISOString(),
      closed_at: despejada ? new Date().toISOString() : null,
      close_note: null,
    }),
    [kind, simulacro, despejada],
  );
  const estado: EstadoCapa = despejada ? { modo: "despejado", alerta, activas: 0 } : { modo: leida ? "franja" : "completa", alerta, activas: 1 };
  return (
    <>
      <AlertaCapa estado={estado} vistaPrevia onLeida={() => setLeida(true)} onReabrir={() => setLeida(false)} onDespejado={onClose} />
      <div className="alerta-previa-barra">
        <span>Vista previa · nadie más la ve</span>
        {!despejada && (
          <button type="button" onClick={() => setDespejada(true)}>
            Ver «Todo está bien»
          </button>
        )}
        <button type="button" onClick={onClose}>
          Cerrar la vista previa
        </button>
      </div>
    </>
  );
}
