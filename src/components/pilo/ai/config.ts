/* =============================================================================
   Mr. Pilo con IA · ¿aparece aquí?

   pilo_ai_public_config() dice si está encendido, qué funciones tiene y en qué
   portal y para quién. Aquí se traduce la ruta a su portal y se decide si esta
   persona ve a Pilo. La función del servidor vuelve a revisarlo todo: esto
   solo evita pintar un botón que no va a funcionar.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { supabase } from "../../../lib/supabase";
import { useAuth } from "../../../lib/auth";
import { canUse } from "./logic";
import type { Action, Fn, Portal, PortalRule, Role, Rules } from "./logic";
import { DEFAULT_VOICE_PATTERNS } from "./voice-expressions";

export type { Fn, Portal, PortalRule, Rules };

export interface PiloAiConfig extends Rules {
  voiceEngine: "proveedor" | "navegador";
  /** Hay proveedor, modelo y clave de voz: si no, se lee con el navegador. */
  speechReady: boolean;
  voiceRate: number;
  voicePitch: number;
  /** Expresiones y microexpresiones orales de Mr. Pilo (0106). */
  voiceExpressions: boolean;
  voiceModulation: boolean;
  voicePatterns: Record<string, string[]>;
  /** Pregúntele a Pilo (0094): abierta o no, para quién, con bienvenida y con IA. */
  pregunta: { on: boolean; aud: PortalRule["aud"]; welcome: boolean; ai: boolean };
  /** El chat emergente en otros portales (0111): si se permite y en cuáles. */
  widget: { on: boolean; origins: string[] };
  /** Los otros espacios de Pilo (0113), por su id: hoy, «ensenanza». Vacío sin la migración. */
  spaces: Record<string, SpaceConfig>;
  /** La configuración pública ya trae `spaces`: la migración 0113 está aplicada. */
  spacesReady: boolean;
}

/** Lo que cambia con el rol de quien pregunta, tal como lo deja la administración. */
export interface SpaceRoleConfig {
  suggestions: string[];
  expression: string;
  mood: string;
}

/** Lo público de un espacio (0113): ni el enfoque, ni el tono, ni el estilo de voz, ni los cupos. */
export interface SpaceConfig {
  on: boolean;
  aud: PortalRule["aud"];
  welcome: boolean;
  ai: boolean;
  name: string;
  greeting: string;
  askRol: boolean;
  roles: { estudiante: SpaceRoleConfig; profesor: SpaceRoleConfig };
  /** Las fuentes de memoria encendidas. */
  sources: Record<string, boolean>;
  widget: { on: boolean; origins: string[] };
}

const record = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const words = (v: unknown, max: number): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Una cara o un ánimo: una sola palabra en minúsculas, como las acepta el servidor. */
const face = (v: unknown): string => (typeof v === "string" && /^[a-z][a-z_-]{0,29}$/.test(v.trim()) ? v.trim() : "");

function parseRole(v: unknown): SpaceRoleConfig {
  const r = record(v);
  const suggestions = Array.isArray(r.suggestions) ? r.suggestions.map((s) => words(s, 160)).filter(Boolean).slice(0, 6) : [];
  return { suggestions, expression: face(r.expression), mood: face(r.mood) };
}

/** `spaces` de pilo_ai_public_config(), con valores de partida seguros: cerrado y solo para la administración. */
export function parseSpaces(raw: unknown): Record<string, SpaceConfig> {
  const out: Record<string, SpaceConfig> = {};
  for (const [id, value] of Object.entries(record(raw))) {
    if (!/^[a-z]{3,20}$/.test(id)) continue;
    const s = record(value);
    const roles = record(s.roles);
    const widget = record(s.widget);
    const flags = record(s.sources);
    out[id] = {
      on: s.on === true,
      aud: s.aud === "publico" || s.aud === "sesion" ? s.aud : "admin",
      welcome: s.welcome !== false,
      ai: s.ai === true,
      name: words(s.name, 120),
      greeting: words(s.greeting, 300),
      askRol: s.ask_rol !== false,
      roles: { estudiante: parseRole(roles.estudiante), profesor: parseRole(roles.profesor) },
      sources: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, v === true])),
      widget: { on: widget.on === true, origins: Array.isArray(widget.origins) ? widget.origins.filter((o): o is string => typeof o === "string") : [] },
    };
  }
  return out;
}

export const PORTAL_LABEL: Record<Portal, string> = {
  cifras: "UDES en Cifras",
  pdi: "Plan de Desarrollo",
  observatorio: "Observatorio",
  impacto: "Portal de Impacto",
  pregunta: "Pregúntele a Pilo",
};

/** El portal de una ruta, o null si Mr. Pilo con IA no tiene nada que hacer ahí. */
export function portalForPath(pathname: string): Portal | null {
  const p = pathname.replace(/\/+$/, "") || "/";
  if (p.startsWith("/datos-abiertos/observatorio") || p.startsWith("/datos-abiertos/boletines")) return "observatorio";
  if (p.startsWith("/datos-abiertos")) return "cifras";
  if (p.startsWith("/impacto")) return "impacto";
  if (/^\/(pdi|implementacion|tablero|facultades|campus|ods|desarrollo-tecnologico)(\/|$)/.test(p)) return "pdi";
  return null;
}

export function usePiloAiConfig() {
  return useQuery({
    queryKey: ["pilo-ia", "config"],
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: async (): Promise<PiloAiConfig | null> => {
      const { data, error } = await supabase.rpc("pilo_ai_public_config");
      // Sin la migración 0089, sencillamente no hay Pilo con IA.
      if (error || !data) return null;
      const raw = data as Record<string, unknown>;
      return {
        enabled: Boolean(raw.enabled),
        functions: (raw.functions ?? {}) as Rules["functions"],
        portals: (raw.portals ?? {}) as Rules["portals"],
        voiceEngine: raw.voice_engine === "navegador" ? "navegador" : "proveedor",
        speechReady: Boolean(raw.speech_ready),
        voiceRate: Number(raw.voice_rate ?? 1),
        voicePitch: Number(raw.voice_pitch ?? 1),
        voiceExpressions: raw.voice_expressions === undefined ? true : Boolean(raw.voice_expressions),
        voiceModulation: raw.voice_modulation === undefined ? true : Boolean(raw.voice_modulation),
        voicePatterns: (raw.voice_patterns && typeof raw.voice_patterns === "object" ? raw.voice_patterns : DEFAULT_VOICE_PATTERNS) as Record<string, string[]>,
        pregunta: (() => {
          const p = (raw.pregunta ?? {}) as Record<string, unknown>;
          const aud = p.aud === "admin" || p.aud === "sesion" ? p.aud : "publico";
          return { on: Boolean(p.on), aud, welcome: p.welcome !== false, ai: Boolean(p.ai) };
        })(),
        widget: (() => {
          const w = (raw.widget ?? {}) as Record<string, unknown>;
          return { on: w.on === true, origins: Array.isArray(w.origins) ? w.origins.filter((o): o is string => typeof o === "string") : [] };
        })(),
        spaces: parseSpaces(raw.spaces),
        spacesReady: Boolean(raw.spaces && typeof raw.spaces === "object"),
      };
    },
  });
}

/** Lo que Mr. Pilo con IA puede hacer aquí, para esta persona. */
export function usePiloAiHere() {
  const { pathname } = useLocation();
  const { profile } = useAuth();
  const config = usePiloAiConfig().data ?? null;
  const portal = portalForPath(pathname);
  const role = (profile?.is_active ? profile.role : null) as Role | null;
  const may = (action: Action) => Boolean(config && portal && canUse(config, portal, action, role).ok);
  const actions = {
    leer: may("voz"),
    resumir: may("resumir"),
    sintetizar: may("sintetizar"),
    explicar: may("explicar"),
  };
  const any = actions.leer || actions.resumir || actions.sintetizar || actions.explicar;
  return { config, portal, actions, active: Boolean(any) };
}
