/* =============================================================================
   Mr. Pilo · alertas de emergencia del campus (Aluna).

   Aluna es el sistema de jornada y emergencias de la universidad. Este módulo
   conecta este teléfono a su difusión: la persona activa el interruptor en
   Ajustes, el navegador se suscribe con la MISMA clave pública VAPID con la
   que Aluna firma sus push, y el dispositivo queda registrado en la tabla de
   Aluna (suscripciones_push_apps) para recibir sismo, incendio y seguridad.

   Las variables de entorno (ver .env.example):
     VITE_ALUNA_ALERTAS_URL — la Edge Function api-alertas de Aluna
     VITE_ALUNA_VAPID_KEY   — la clave VAPID pública de Aluna (VITE_VAPID_PUBLIC_KEY allá)

   Qué significa cada estado, para contarlo sin engañar:
     activas        — hay suscripción y quedó registrada en Aluna.
     desactivadas   — sin suscripción (o la persona cerró el aviso del permiso).
     denegado       — el permiso está bloqueado; solo se recupera desde la
                      configuración de notificaciones del navegador.
     no_disponible  — este navegador no puede (en desarrollo, sin service
                      worker, o un Safari sin instalar). Mejor decírselo que
                      fingir que va a avisar.
   ========================================================================== */

export type EstadoAlertas = "activas" | "desactivadas" | "denegado" | "no_disponible";

/** Dónde vive la API de alertas de Aluna (Edge Function `api-alertas`). */
const API_ALERTAS = import.meta.env.VITE_ALUNA_ALERTAS_URL as string | undefined;
/** La clave VAPID pública de Aluna: la misma con la que se suscribe su personal. */
const VAPID_ALUNA = import.meta.env.VITE_ALUNA_VAPID_KEY as string | undefined;

/** Cómo se presenta este teléfono en la tabla de Aluna. */
const APP = "mr-pilo";

function soportaPush(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** El service worker de la app, ya registrado. Null si aún no existe (desarrollo, primera visita antes de registrarse). */
async function worker(): Promise<ServiceWorkerRegistration | null> {
  if (!soportaPush()) return null;
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

/** La clave VAPID viaja base64url; `applicationServerKey` la quiere en bytes. */
function aBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const relleno = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + relleno;
  const binario = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(binario.length));
  for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
  return bytes;
}

/** ¿Cómo está este teléfono frente a las alertas? No lanza nunca: lo que no se puede saber, se dice. */
export async function estadoAlertas(): Promise<EstadoAlertas> {
  if (!soportaPush() || !API_ALERTAS || !VAPID_ALUNA) return "no_disponible";
  if (Notification.permission === "denied") return "denegado";
  const registro = await worker();
  if (!registro) return "desactivadas";
  try {
    return (await registro.pushManager.getSubscription()) ? "activas" : "desactivadas";
  } catch {
    return "desactivadas";
  }
}

/**
 * Suscribir este teléfono a la difusión de emergencias de Aluna.
 * Lanza si Aluna no responde: quien activó tiene que saber que no quedó.
 */
export async function activarAlertas(): Promise<EstadoAlertas> {
  if (!soportaPush() || !API_ALERTAS || !VAPID_ALUNA) return "no_disponible";
  if (Notification.permission === "denied") return "denegado";

  if (Notification.permission !== "granted") {
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") return permiso === "denied" ? "denegado" : "desactivadas";
  }

  const registro = await worker();
  if (!registro) return "no_disponible";

  // Si ya había suscripción se reutiliza: el navegador la renovó solo y solo
  // hay que volver a registrar el endpoint en Aluna.
  const sub =
    (await registro.pushManager.getSubscription()) ??
    (await registro.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: aBytes(VAPID_ALUNA),
    }));

  const { keys } = sub.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error("La suscripción del navegador vino incompleta.");

  const r = await fetch(`${API_ALERTAS}/dispositivos`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      app: APP,
      endpoint: sub.endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      dispositivo: navigator.userAgent.slice(0, 120),
    }),
  });
  if (!r.ok) throw new Error(`Aluna respondió ${r.status}.`);

  return "activas";
}

/** Quitar este teléfono de la difusión: se baja en Aluna y se desuscribe el navegador. */
export async function desactivarAlertas(): Promise<EstadoAlertas> {
  const registro = await worker();
  const sub = registro ? await registro.pushManager.getSubscription() : null;

  if (sub) {
    // Se avisa a Aluna aunque el navegador luego falle la baja local: una
    // suscripción que nadie usa del otro lado es la que vuelve a sonar.
    await fetch(`${API_ALERTAS}/dispositivos`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }

  return "desactivadas";
}
