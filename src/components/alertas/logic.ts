/* =============================================================================
   Alertas de emergencia · lo que la capa de Pilo decide sin pantalla.

   La tabla pilo_alerts (0138) trae lo activo y lo cerrado en los últimos dos
   días. De ahí sale qué se pinta: la capa completa mientras haya una emergencia
   sin atender; una franja arriba, si la persona ya la leyó (la emergencia
   sigue: no se esconde); y, al cerrarse, un aviso corto de «todo despejado».
   ========================================================================== */

export type KindAlerta = "sismo" | "incendio" | "seguridad" | "general";

export interface FilaAlerta {
  id: string;
  source: "aluna" | "simulacro";
  code: string;
  kind: KindAlerta;
  title: string;
  body: string;
  state: "activa" | "cerrada";
  emitted_at: string;
  closed_at: string | null;
  close_note: string | null;
}

export type ModoCapa = "dormida" | "completa" | "franja" | "despejado";

export interface EstadoCapa {
  modo: ModoCapa;
  /** La alerta que manda: la activa más reciente, o la última que se cerró. */
  alerta: FilaAlerta | null;
  /** Cuántas emergencias hay activas a la vez. */
  activas: number;
}

/** Cuánto tiempo se ofrece el «todo despejado» después de cerrarse. */
export const DESPEJADO_MS = 15 * 60 * 1000;

/** Cuánto puede llevar una alerta activa y seguir cubriendo la pantalla. */
export const ACTIVA_MAX_MS = 12 * 60 * 60 * 1000;

const COLUMNAS ="id, source, code, kind, title, body, state, emitted_at, closed_at, close_note";
export { COLUMNAS as COLUMNAS_ALERTA };

const KINDS: readonly string[] = ["sismo", "incendio", "seguridad", "general"];

/** Lo que llegue de la base, sin fiarse de su forma; una fila rota se descarta. */
export function filasDe(data: unknown): FilaAlerta[] {
  if (!Array.isArray(data)) return [];
  const out: FilaAlerta[] = [];
  for (const raw of data) {
    const r = raw as Record<string, unknown> | null;
    if (!r || typeof r.id !== "string" || typeof r.title !== "string" || typeof r.emitted_at !== "string") continue;
    out.push({
      id: r.id,
      source: r.source === "simulacro" ? "simulacro" : "aluna",
      code: typeof r.code === "string" ? r.code : "",
      kind: KINDS.includes(r.kind as string) ? (r.kind as KindAlerta) : "general",
      title: r.title,
      body: typeof r.body === "string" ? r.body : "",
      state: r.state === "cerrada" ? "cerrada" : "activa",
      emitted_at: r.emitted_at,
      closed_at: typeof r.closed_at === "string" ? r.closed_at : null,
      close_note: typeof r.close_note === "string" ? r.close_note : null,
    });
  }
  return out;
}

const tiempo = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * @param leidas  los identificadores que la persona ya leyó en esta sesión (pasan a franja)
 * @param vistoDespejado  los identificadores cuyo «todo despejado» ya cerró
 */
export function estadoCapa(filas: readonly FilaAlerta[], leidas: ReadonlySet<string>, vistoDespejado: ReadonlySet<string>, ahora: number): EstadoCapa {
  // Una emergencia no dura días: un aviso que lleva más que eso «activo» es uno que Aluna dejó abierto
  // (una capacitación, una prueba) y no se le grita a toda la universidad.
  const activas = filas
    .filter((f) => f.state === "activa" && ahora - tiempo(f.emitted_at) < ACTIVA_MAX_MS)
    .sort((a, b) => tiempo(b.emitted_at) - tiempo(a.emitted_at));
  if (activas.length) {
    // Si alguna activa no se ha leído, manda la capa completa con la más reciente sin leer.
    const sinLeer = activas.find((a) => !leidas.has(a.id));
    return sinLeer ? { modo: "completa", alerta: sinLeer, activas: activas.length } : { modo: "franja", alerta: activas[0], activas: activas.length };
  }
  const cerrada = filas
    .filter((f) => f.state === "cerrada" && ahora - tiempo(f.closed_at) < DESPEJADO_MS && ahora - tiempo(f.closed_at) >= 0 && !vistoDespejado.has(f.id))
    .sort((a, b) => tiempo(b.closed_at) - tiempo(a.closed_at))[0];
  return cerrada ? { modo: "despejado", alerta: cerrada, activas: 0 } : { modo: "dormida", alerta: null, activas: 0 };
}

export const NOMBRE_KIND: Record<KindAlerta, string> = {
  sismo: "Sismo",
  incendio: "Incendio",
  seguridad: "Seguridad",
  general: "Emergencia",
};

/**
 * Lo que se le recuerda a la persona mientras llega la indicación de su sede.
 * Es general a propósito: no reemplaza las instrucciones de las brigadas ni de
 * la persona que declaró la emergencia.
 */
export const GUIA: Record<KindAlerta, string[]> = {
  sismo: [
    "Mantenga la calma y aléjese de ventanas y de objetos que puedan caer.",
    "Protéjase bajo una mesa firme o junto a una columna hasta que pase el movimiento.",
    "Cuando termine, evacúe por las rutas señalizadas, sin usar ascensores.",
  ],
  incendio: [
    "Salga por la ruta de evacuación más cercana, sin usar ascensores.",
    "Si hay humo, agáchese y cúbrase la nariz y la boca.",
    "No regrese por sus cosas. Diríjase al punto de encuentro.",
  ],
  seguridad: [
    "Siga las instrucciones de seguridad y de las brigadas de su sede.",
    "Aléjese de la zona indicada y no se acerque a mirar.",
    "Avise a quien esté cerca y espere nuevas indicaciones.",
  ],
  general: ["Mantenga la calma y siga las instrucciones de las brigadas de su sede.", "Avise a quien esté cerca y espere nuevas indicaciones."],
};

/* --- La presentación (la de Aluna) ----------------------------------------------------------
   Cada clase es su propio mundo de color: `c1` es el fondo y `c2` el acento. Son los mismos
   de Aluna (src/features/avisos/clases.ts): quien ve la alerta en Pilo reconoce la de Aluna. */

export interface PresentacionKind {
  nombre: string;
  c1: string;
  c2: string;
  /** El título, partido en las dos líneas que entran una tras otra. */
  titulo: [string, string];
  /** Lo que dice el botón de «entendido». Cambia con lo que hay que HACER. */
  entendido: string;
  /** La palabra que completa «Simulacro de …». */
  simulacroDe: string;
}

export const PRESENTACION: Record<KindAlerta, PresentacionKind> = {
  incendio: { nombre: "Incendio", c1: "#7a1408", c2: "#ff9a52", titulo: ["Alerta de", "incendio"], entendido: "Entendido, voy al punto de encuentro", simulacroDe: "evacuación" },
  sismo: { nombre: "Sismo", c1: "#2e1065", c2: "#c9b8ff", titulo: ["Alerta de", "sismo"], entendido: "Entendido, estoy protegido", simulacroDe: "sismo" },
  seguridad: { nombre: "Seguridad", c1: "#06223f", c2: "#7cc4ff", titulo: ["Alerta de", "seguridad"], entendido: "Entendido, estoy resguardado", simulacroDe: "seguridad" },
  general: { nombre: "Alerta", c1: "#6b0f14", c2: "#ffb4a8", titulo: ["Alerta de", "emergencia"], entendido: "Entendido, sigo las instrucciones", simulacroDe: "emergencia" },
};

/** El simulacro manda sobre la clase: se ve distinto de cualquier emergencia real. */
export const SIMULACRO_COLORES = { c1: "#4f3600", c2: "#ffd23f" };

export type Ambiente = "sismo" | "incendio" | "seguridad" | "simulacro" | "otra";

/** El título sin el «Simulacro: » que algunos avisos traen: la pantalla ya lo dice. */
export function tituloLimpio(titulo: string): string {
  return titulo.replace(/^\s*simulacro\s*[:·-]\s*/i, "").trim() || titulo;
}

/**
 * Las instrucciones, como pasos: una frase, un paso. El texto llega como un
 * párrafo («Evacúa por la escalera. No uses el ascensor.») y a pantalla
 * completa se lee mejor como lista. Aluna añade al final el alcance
 * —«Bloques: …», «Oficinas: …»—, que no es una instrucción y va aparte.
 */
export function pasosDe(cuerpo: string): { pasos: string[]; alcance: string | null } {
  const partes = cuerpo.split(/\n\s*\n(?=(?:Bloques|Oficinas):)/);
  const principal = partes[0] ?? "";
  const alcance = partes.slice(1).join(" ").replace(/\s+/g, " ").trim() || null;
  const pasos = principal
    .split(/\n+|(?<=[.!?…])\s+(?=[A-ZÁÉÍÓÚÑ¿¡0-9])/u)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  // Más de cinco pasos no se leen corriendo: los últimos se juntan en uno.
  if (pasos.length > 5) return { pasos: [...pasos.slice(0, 4), pasos.slice(4).join(" ")], alcance };
  return { pasos, alcance };
}

export interface Presentada {
  c1: string;
  c2: string;
  ambiente: Ambiente;
  simulacro: boolean;
  /** El título en sus líneas. */
  lineas: string[];
  /** Si el título que escribió quien emitió dice algo más que la clase, va debajo. */
  subtitulo: string | null;
  pasos: string[];
  alcance: string | null;
  entendido: string;
}

/** Todo lo que la pantalla necesita saber de una alerta para pintarla. */
export function presentar(a: Pick<FilaAlerta, "kind" | "title" | "body" | "source">): Presentada {
  const k = PRESENTACION[a.kind];
  const simulacro = a.source === "simulacro";
  const limpio = tituloLimpio(a.title);
  // La clase la deduce Pilo del texto: un aviso «general» conserva el título que escribió quien lo emitió.
  const lineas = simulacro ? ["Simulacro de", k.simulacroDe] : a.kind === "general" ? [limpio] : k.titulo;
  const mismo = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const subtitulo = !simulacro && a.kind !== "general" && mismo(limpio) !== mismo(k.titulo.join(" ")) ? limpio : null;
  // El texto de un simulacro habla del simulacro, no de qué hacer: ahí valen los pasos de la clase.
  const leidos = simulacro ? { pasos: [], alcance: null } : pasosDe(a.body);
  const pasos = leidos.pasos.length ? leidos.pasos : GUIA[a.kind];
  const ambiente: Ambiente = simulacro ? "simulacro" : a.kind === "general" ? "otra" : a.kind;
  return {
    c1: simulacro ? SIMULACRO_COLORES.c1 : k.c1,
    c2: simulacro ? SIMULACRO_COLORES.c2 : k.c2,
    ambiente,
    simulacro,
    lineas,
    subtitulo,
    pasos,
    alcance: leidos.alcance,
    entendido: k.entendido,
  };
}

/** Lo que Pilo dice en voz alta, en frases cortas: cada una es un audio (la voz directa admite hasta 600 caracteres). */
export function frasesParaLeer(a: Pick<FilaAlerta, "kind" | "title" | "body" | "source">): string[] {
  const p = presentar(a);
  const intro = p.simulacro ? `Esto es un simulacro de ${PRESENTACION[a.kind].simulacroDe}. No es una emergencia real.` : `Atención. ${p.lineas.join(" ")}.`;
  return [intro, ...p.pasos, "Siga siempre las instrucciones de las brigadas de su sede."].map((f) => f.replace(/\s+/g, " ").trim().slice(0, 500)).filter(Boolean);
}

/** El mensaje del «todo está bien». */
export function mensajeDespejado(a: Pick<FilaAlerta, "source">): string {
  return a.source === "simulacro" ? "El simulacro terminó. Gracias por participar; puede volver a su puesto." : "La alerta terminó. Puede regresar a su puesto con calma.";
}

/** Hace cuánto empezó, en palabras. */
export function haceCuanto(iso: string, ahora: number): string {
  const min = Math.floor((ahora - tiempo(iso)) / 60000);
  if (!Number.isFinite(min) || min < 1) return "ahora mismo";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  return h < 24 ? `hace ${h} h` : "hace más de un día";
}
