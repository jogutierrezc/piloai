/* =============================================================================
   Mr. Pilo · la app móvil · sus rutas.

   Una app, dos Pilos:
     /app              la bienvenida la primera vez; después, la última conversación
     /app/universidad  Pilo de la Universidad (espacio «planeacion», el de /pregunta)
     /app/ensenanza    Pilo en Enseñanza      (espacio «ensenanza», el de /pilo-ensenanza)

   Las dos últimas son también los accesos directos del icono (manifest).
   Todo aquí es puro: se prueba en node.
   ========================================================================== */

import type { SpaceId } from "../pregunta/space";

export const APP_BASE = "/app";

/** La ruta de cada Pilo dentro de la app. */
export const APP_PATHS: Record<SpaceId, string> = {
  planeacion: "/app/universidad",
  ensenanza: "/app/ensenanza",
};

/** Cómo se llama cada Pilo en la app (el menú, la cabecera, la elección de la bienvenida). */
export const APP_PILOS: Record<SpaceId, { label: string; short: string; hint: string; under: string }> = {
  planeacion: { label: "Pilo de la Universidad", short: "Universidad", hint: "Cifras, planes e impacto", under: "Universidad de Santander" },
  ensenanza: { label: "Pilo en Enseñanza", short: "Enseñanza", hint: "Enseñar y aprender", under: "Enseñanza" },
};

export const APP_SPACES: SpaceId[] = ["planeacion", "ensenanza"];

/** Las pantallas de la cuenta (0120): registro e ingreso, el perfil y las respuestas guardadas. */
export const APP_ACCOUNT = "/app/cuenta";
export const APP_PROFILE = "/app/perfil";
export const APP_SAVED = "/app/guardadas";
/** Mis clases (beta): Moodle con la cuenta de la persona, solo lectura. Solo para estudiantes y profesores con cuenta. */
export const APP_CLASSES = "/app/clases";
/** Mis notas (beta): Génesis con la cuenta de la persona, solo lectura. Solo para estudiantes con cuenta. */
export const APP_GRADES = "/app/notas";
/** Directo al ingreso, o a usar Pilo sin cuenta. Nunca viaja un correo ni un usuario en la dirección. */
export const APP_LOGIN = `${APP_ACCOUNT}?entrar=1`;
export const APP_GUEST = `${APP_ACCOUNT}?visita=1`;

/** Pilo U: lo universitario de la persona (clases, notas, calendario; grupos y asistencia para quien enseña). */
export const APP_U = "/app/u";
/** Las vistas de Pilo U: /app/u/<vista>. Cuáles ve cada quien lo decide su rol (u/vistas.ts). */
export const U_VISTAS = ["presenciales", "virtuales", "notas", "calendario", "grupos", "gruposv", "horario", "boletin", "asistencia", "riesgo", "mensaje", "dependencia", "avisos"] as const;
export type UVista = (typeof U_VISTAS)[number];
export const uPath = (vista?: UVista | null): string => (vista ? `${APP_U}/${vista}` : APP_U);
/** El carnet digital: tarjeta con código que cambia, datos del perfil y Google Wallet. */
export const APP_CARNET = "/app/carnet";

export type AppPlace = { kind: "inicio" } | { kind: "pilo"; space: SpaceId } | { kind: "cuenta" } | { kind: "perfil" } | { kind: "guardadas" } | { kind: "clases" } | { kind: "notas" } | { kind: "u"; vista: UVista | null } | { kind: "carnet" } | { kind: "otra" };

/** Qué pantalla de la app pide una dirección. «otra» = no es de la app, o no existe dentro de ella. */
export function readAppPath(pathname: string): AppPlace {
  const p = (pathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "").toLowerCase() || "/";
  if (p === APP_BASE) return { kind: "inicio" };
  for (const space of APP_SPACES) if (p === APP_PATHS[space]) return { kind: "pilo", space };
  if (p === APP_ACCOUNT) return { kind: "cuenta" };
  if (p === APP_PROFILE) return { kind: "perfil" };
  if (p === APP_SAVED) return { kind: "guardadas" };
  if (p === APP_CLASSES) return { kind: "clases" };
  if (p === APP_GRADES) return { kind: "notas" };
  if (p === APP_U) return { kind: "u", vista: null };
  if (p.startsWith(`${APP_U}/`)) {
    const vista = p.slice(APP_U.length + 1);
    return (U_VISTAS as readonly string[]).includes(vista) ? { kind: "u", vista: vista as UVista } : { kind: "otra" };
  }
  if (p === APP_CARNET) return { kind: "carnet" };
  return { kind: "otra" };
}

export type GateMode = "registro" | "visita" | "ingreso" | "clave" | "confirmada";

/** Con qué pantalla abre /app/cuenta, según lo que traiga la dirección (los enlaces del correo traen `clave` o `confirmada`). */
export function gateMode(search: string): GateMode {
  const q = new URLSearchParams(search);
  if (q.get("clave") === "1") return "clave";
  if (q.get("confirmada") === "1") return "confirmada";
  if (q.get("entrar") === "1") return "ingreso";
  if (q.get("visita") === "1") return "visita";
  return "registro";
}

/** El enlace del correo llegó vencido o ya usado: la plataforma lo dice en la dirección. */
export function linkExpired(hash: string, search = ""): boolean {
  return /error(_code|_description)?=/.test(hash) || /[?&]error(_code)?=/.test(search);
}

/** ¿Esta dirección es de la app? (para registrar el service worker solo ahí). */
export const isAppPath = (pathname: string): boolean => {
  const p = pathname.split(/[?#]/)[0] || "/";
  return p === APP_BASE || p.startsWith(`${APP_BASE}/`);
};

/**
 * Qué abre /app: la bienvenida la primera vez; después, el Pilo de la última
 * conversación (el de la Universidad si no hay ninguna).
 */
export function startTarget(input: { seen: boolean; last: SpaceId | null | undefined }): "bienvenida" | SpaceId {
  if (!input.seen) return "bienvenida";
  return input.last === "ensenanza" ? "ensenanza" : "planeacion";
}

/**
 * Gemini, para estudiantes y profesores con cuenta: un acceso que se abre aparte, con la cuenta de
 * Google de la universidad. Pilo no le pasa nada ni lee lo que allí se conversa.
 */
export const APP_GEMINI = "https://gemini.google.com/app";
