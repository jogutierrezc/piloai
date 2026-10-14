/* =============================================================================
   Mr. Pilo · la app móvil · lo que la hace una app instalada.

   - El service worker (public/pilo-app-sw.js): solo en producción y solo bajo
     /app. Guarda el esqueleto y las imágenes de Pilo; nunca las respuestas ni
     las llamadas a Supabase.
   - «Instalar a Pilo»: el aviso propio (beforeinstallprompt, que index.html
     atrapa antes de que cargue la app) y la guía corta para iPhone, que no
     tiene ese aviso.
   - Con o sin conexión.
   - El teclado: la caja de escribir sigue al alto visible (visualViewport).
   - Si la acción vino del teclado, para no animarla.
   ========================================================================== */

import { useEffect, useState } from "react";
import type { RefObject } from "react";
import { isNative } from "./native";
import { APP_BASE, isAppPath } from "./routes";

export const SW_URL = "/pilo-app-sw.js";

/** Registra el service worker de la app. En desarrollo no hace nada. */
export function registerAppWorker() {
  // Dentro de la app de Android los archivos ya viajan en el APK: no hace falta (ni conviene) un service worker.
  if (!import.meta.env.PROD || isNative() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  if (!isAppPath(window.location.pathname)) return;
  navigator.serviceWorker
    .register(SW_URL, { scope: APP_BASE })
    .then(() => navigator.serviceWorker.ready)
    .then((registration) => {
      // Lo que esta página ya descargó antes de que el service worker mandara (la primera visita)
      // también se guarda: así la app abre sin conexión desde la segunda vez.
      const urls = performance
        .getEntriesByType("resource")
        .map((e) => e.name)
        .filter((u) => u.startsWith(window.location.origin));
      registration.active?.postMessage({ type: "guardar", urls });
    })
    .catch(() => undefined);
}

/* --- Instalar ------------------------------------------------------------------------------ */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

declare global {
  interface Window {
    /** El aviso de instalación que index.html guardó para la app. */
    __piloInstall?: InstallEvent | null;
  }
}

/** ¿Ya corre como app instalada? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone y iPad no tienen aviso de instalación: se les enseña el camino. Un iPad moderno dice ser Mac, pero tiene pantalla táctil. */
export function isIosDevice(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

export type InstallWay = "aviso" | "iphone" | null;

/* --- La app de Android (APK) ---------------------------------------------------------------

   La Universidad firma y publica un APK de Mr. Pilo para tabletas y celulares
   Android: sirve donde no hay Play Store o donde el navegador no ofrece el
   aviso de instalación. La hoja de descarga, el menú y las pruebas leen la
   ficha de aquí: un solo lugar para la versión y el tamaño. El archivo vive en
   `public/pilo-app/apk/` y NO se cachea en el service worker: solo se baja a
   propósito. */

export const APP_APK = {
  /** Ruta pública del archivo, tal como la sirve el portal. */
  url: "/pilo-app/apk/Mr-Pilo-1.2.1.apk",
  file: "Mr-Pilo-1.2.1.apk",
  version: "1.2.1",
  size: "11,9 MB",
} as const;

/** ¿Es un teléfono o tableta Android? (No las apps que ya corren instaladas: a esas no se les ofrece el APK.) */
export function isAndroidDevice(userAgent: string): boolean {
  return /Android/i.test(userAgent);
}

/** Cómo se puede instalar aquí: con el aviso del navegador, con la guía de iPhone, o no hace falta. */
export function useInstall(): { way: InstallWay; install: () => Promise<boolean> } {
  const [event, setEvent] = useState<InstallEvent | null>(() => (typeof window === "undefined" ? null : (window.__piloInstall ?? null)));
  const [installed, setInstalled] = useState(isStandalone);
  useEffect(() => {
    const onReady = () => setEvent(window.__piloInstall ?? null);
    const onInstalled = () => {
      window.__piloInstall = null;
      setEvent(null);
      setInstalled(true);
    };
    window.addEventListener("pilo-install", onReady);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("pilo-install", onReady);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);
  const way: InstallWay = installed ? null : event ? "aviso" : isIosDevice(navigator.userAgent, navigator.maxTouchPoints) ? "iphone" : null;
  const install = async () => {
    if (!event) return false;
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      // El aviso solo sirve una vez.
      window.__piloInstall = null;
      setEvent(null);
      return outcome === "accepted";
    } catch {
      return false;
    }
  };
  return { way, install };
}

/* --- Conexión ------------------------------------------------------------------------------ */

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

/* --- El teclado ---------------------------------------------------------------------------- */

/**
 * La app ocupa el alto que de verdad se ve: cuando sale el teclado, el
 * navegador encoge solo la ventana visible (visualViewport) y la caja de
 * escribir, que va al pie, sube con él. Sin animación: sigue al teclado.
 */
export function useKeyboardViewport(ref: RefObject<HTMLElement>) {
  useEffect(() => {
    const el = ref.current;
    const vv = window.visualViewport;
    if (!el || !vv) return;
    const fit = () => {
      el.style.setProperty("--pa-h", `${Math.round(vv.height)}px`);
      el.style.setProperty("--pa-top", `${Math.round(vv.offsetTop)}px`);
    };
    fit();
    vv.addEventListener("resize", fit);
    vv.addEventListener("scroll", fit);
    return () => {
      vv.removeEventListener("resize", fit);
      vv.removeEventListener("scroll", fit);
      el.style.removeProperty("--pa-h");
      el.style.removeProperty("--pa-top");
    };
  }, [ref]);
}

/* --- Movimiento ---------------------------------------------------------------------------- */

export const reducedMotion = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

/** Un clic que vino del teclado (Enter o espacio sobre el botón) no trae coordenadas: `detail` es 0. */
export const fromKeyboard = (event: { detail: number } | null | undefined): boolean => Boolean(event) && event!.detail === 0;
