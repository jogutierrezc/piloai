/* =============================================================================
   Mr. Pilo en Enseñanza · lo que dice cada fila cerrada.

   Una fila plegada no es un título mudo: dice su valor actual, en una línea,
   para que solo haga falta abrir la que se va a cambiar. Puro, con pruebas
   (resumen.test.ts).
   ========================================================================== */

import type { RowId } from "./navegacion";
import type { Audience, RolId, SpaceSettings } from "./store";

export const AUD_TEXT: Record<Audience, string> = { admin: "solo la administración", sesion: "quien tiene sesión", publico: "el público" };

const ROL_NAME: Record<RolId, string> = { estudiante: "Estudiante", profesor: "Profesor" };

const count = (n: number, one: string, many: string) => `${n.toLocaleString("es-CO")} ${n === 1 ? one : many}`;

/** «10 minutos», «90 segundos», «2 horas»: la ventana dicha como se lee. */
export function spanOf(seconds: number): string {
  if (seconds < 120) return count(seconds, "segundo", "segundos");
  if (seconds < 7200) return count(Math.round(seconds / 60), "minuto", "minutos");
  return count(Math.round(seconds / 3600), "hora", "horas");
}

/** Un texto en una línea, con tope: lo que no cabe se corta con puntos suspensivos. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Lo que esta pantalla necesita saber de «Mr. Pilo con IA» para resumir la conexión y la voz. */
export interface SharedSummary {
  enabled: boolean;
  /** El servicio que redacta, por su nombre. */
  provider: string;
  /** «la voz del navegador», «la voz de NVIDIA»… */
  voice: string;
}

/** Con qué voz lee, dicho en palabras. */
export function voiceName(shared: { voice_engine?: string; speech_provider?: string }): string {
  if (shared.voice_engine !== "proveedor") return "la voz del navegador";
  if (shared.speech_provider === "nvidia") return "la voz de NVIDIA";
  if (shared.speech_provider === "fishaudio") return "la voz de Fish Audio";
  return "la voz de Free.ai";
}

function roleLine(s: SpaceSettings, rol: RolId): string {
  const r = s.roles[rol];
  const tone = r.tone.trim() ? clip(r.tone, 44) : "tono de partida";
  return `${ROL_NAME[rol]}: ${tone}${r.suggestions.length ? `, ${count(r.suggestions.length, "sugerida", "sugeridas")}` : ""}`;
}

/** El valor actual de una fila, en una línea. */
export function rowSummary(id: RowId, s: SpaceSettings, shared: SharedSummary | null = null): string {
  switch (id) {
    case "pagina":
      return [`Para ${AUD_TEXT[s.aud]}`, s.welcome ? "con bienvenida" : "sin bienvenida", s.ai ? "redacta con IA" : "responde con lo publicado"].join(" · ");
    case "conexion":
      if (!shared) return "Las de Mr. Pilo con IA";
      return shared.enabled ? `Redacta con ${shared.provider} · lee con ${shared.voice}` : "Mr. Pilo con IA está apagado";
    case "presenta": {
      const intro = s.intro.trim();
      return [intro ? `«${clip(intro, 64)}»` : "Sin presentación", s.focus.trim() ? "con enfoque" : "sin enfoque", s.greeting.trim() ? "saludo propio" : "saludo de partida"].join(" · ");
    }
    case "roles":
      return [roleLine(s, "estudiante"), roleLine(s, "profesor"), s.ask_rol ? "" : "no pregunta el rol"].filter(Boolean).join(" · ");
    case "cupos":
      return [
        s.daily_limit === 0 ? "Sin cupo de IA: responde con lo publicado" : `${count(s.daily_limit, "pregunta con IA al día", "preguntas con IA al día")}`,
        s.visitor_limit === 0 ? "sin límite por visitante" : `${s.visitor_limit.toLocaleString("es-CO")} por visitante cada ${spanOf(s.visitor_window_seconds)}`,
      ].join(" · ");
    case "portales":
      if (!s.widget_on) return "Apagado: solo en este portal";
      return s.widget_origins.length ? `Abierto a ${count(s.widget_origins.length, "portal", "portales")}` : "Encendido, sin portales en la lista";
  }
}
