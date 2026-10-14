/* =============================================================================
   Mr. Pilo · la app móvil · quién entra a cada Pilo.

   Los permisos son los de cada espacio, los mismos de su página: el Pilo de la
   Universidad se abre con «pregunta» de la configuración pública (0094) y
   Pilo en Enseñanza con su ficha (0113). Abierto o cerrado, para quién
   (público, con sesión, administración) y si lee con la voz oficial. La
   función del servidor vuelve a revisarlo todo y aplica los cupos: esto solo
   decide qué se pinta.

   Puro: se prueba en node.
   ========================================================================== */

import { canUse } from "../../components/pilo/ai/logic";
import type { Role } from "../../components/pilo/ai/logic";
import type { PiloAiConfig, SpaceConfig } from "../../components/pilo/ai/config";
import type { AskPortal } from "../../components/pilo/ai/client";
import type { SpaceProfile } from "../pregunta/space";

export interface AppVoice {
  portal: AskPortal;
  /** La voz oficial está lista y esta persona puede usarla aquí. Sin esto, la app no habla: queda el texto. */
  advanced: boolean;
  rate: number;
  pitch: number;
  expressions: boolean;
  modulation: boolean;
  patterns?: Record<string, string[]>;
}

export interface Door {
  /** «abierto»: puede preguntar. «sesion»: está abierto, pero pide iniciar sesión. «cerrado»: no por ahora. */
  state: "abierto" | "sesion" | "cerrado";
  /** Lo que se le dice a quien no entra. */
  message: string;
  /** La ficha pública del espacio (0113); null en el Pilo de la Universidad. */
  cfg: SpaceConfig | null;
  audience: "admin" | "sesion" | "publico";
  voice: AppVoice;
}

const SILENT = { rate: 1, pitch: 1, expressions: true, modulation: true } as const;

/**
 * La puerta de un Pilo para esta persona, con la misma regla que su página (AskPilo).
 * `member`: tiene una cuenta de Pilo activa (0120). Cuenta como sesión para
 * preguntar y para la voz; nunca como rol de la intranet.
 */
export function spaceDoor(rules: PiloAiConfig | null | undefined, space: SpaceProfile, role: Role | null, member = false): Door {
  const usual = space.id === "planeacion";
  const cfg: SpaceConfig | null = usual ? null : (rules?.spaces[space.id] ?? null);
  const door = !rules ? null : usual ? rules.pregunta : cfg;
  const injected = rules && door ? { ...rules, portals: { ...rules.portals, [space.portal]: { on: door.on, aud: door.aud, fns: space.fns } } } : null;
  const voice: AppVoice = {
    portal: space.portal,
    advanced: Boolean(rules && injected && rules.speechReady && canUse(usual ? rules : injected, space.portal, "voz", role, member).ok),
    rate: rules?.voiceRate ?? SILENT.rate,
    pitch: rules?.voicePitch ?? SILENT.pitch,
    expressions: rules?.voiceExpressions ?? SILENT.expressions,
    modulation: rules?.voiceModulation ?? SILENT.modulation,
    patterns: rules?.voicePatterns,
  };
  const audience = door?.aud ?? "admin";
  if (!rules || !door || !injected) {
    const message = rules && !rules.spacesReady && !usual ? space.gate.missing : space.gate.closed;
    return { state: "cerrado", message, cfg, audience, voice: { ...voice, advanced: false } };
  }
  const allowed = canUse(injected, space.portal, "preguntar", role, member);
  if (allowed.ok) return { state: "abierto", message: "", cfg, audience, voice };
  if (door.on && door.aud === "sesion" && !role && !member) return { state: "sesion", message: space.gate.login, cfg, audience, voice: { ...voice, advanced: false } };
  return { state: "cerrado", message: !usual && !door.on ? space.gate.closed : allowed.reason, cfg, audience, voice: { ...voice, advanced: false } };
}

/**
 * Con qué «rol» se piden las funciones ampliadas (0119): el de la intranet si
 * lo hay; una cuenta de Pilo activa entra como «miembro» (vale para «Con
 * sesión», nunca para «Solo administración»); sin nada, null.
 */
export const extrasRole = (role: Role | null, member: boolean): string | null => role ?? (member ? "miembro" : null);
