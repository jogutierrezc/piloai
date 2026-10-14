/* =============================================================================
   Mr. Pilo · la app de Android · lo que solo existe dentro de la envoltura nativa.

   La app de Android es esta misma web dentro de Capacitor (capacitor.config.ts).
   Todo lo de aquí se apaga solo en el navegador y en la PWA: sin la envoltura
   no hay `window.Capacitor` y ninguna función hace nada. Los plugins se piden
   bajo demanda, así que el portal en el navegador no descarga ni una línea de
   ellos.

   Qué hace dentro de la app:
   - «/» no es la portada del portal: es Pilo, y abre en /app.
   - El botón «atrás» del teléfono retrocede por la app; en la primera pantalla la cierra.
   - La barra de estado va en el azul de la UDES.
   - La pantalla de inicio nativa se oculta cuando Pilo ya está listo.
   - Vibración suave en los gestos que lo piden.
   ========================================================================== */

type PuenteNativo = { isNativePlatform?: () => boolean; getPlatform?: () => string };
type VentanaNativa = Window & { Capacitor?: PuenteNativo };

/** ¿Estamos dentro de la app nativa? */
export function isNative(): boolean {
  return typeof window !== "undefined" && Boolean((window as VentanaNativa).Capacitor?.isNativePlatform?.());
}

/** Antes de montar React: en la app, «/» abre Pilo y no la portada del portal. */
export function enterAppIfNative(): void {
  if (!isNative()) return;
  const { pathname } = window.location;
  if (pathname === "/" || pathname === "/index.html") window.history.replaceState(null, "", "/app");
}

/** Prepara la envoltura: botón atrás, barra de estado y pantalla de inicio. Un fallo aquí nunca debe tumbar la app. */
export async function startNative(): Promise<void> {
  if (!isNative()) return;
  try {
    const [{ App }, { StatusBar, Style }, { SplashScreen }] = await Promise.all([import("@capacitor/app"), import("@capacitor/status-bar"), import("@capacitor/splash-screen")]);
    await App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else void App.exitApp();
    });
    await StatusBar.setStyle({ style: Style.Dark }).catch(() => undefined);
    await StatusBar.setBackgroundColor({ color: "#0a2d63" }).catch(() => undefined);
    await SplashScreen.hide({ fadeOutDuration: 220 }).catch(() => undefined);
  } catch {
    /* sin envoltura completa, la web sigue funcionando */
  }
}

/** Vibración corta. Los gestos frecuentes no la usan: solo confirmar, avisar o terminar. */
export async function haptic(kind: "ligera" | "media" | "exito" | "error" = "ligera"): Promise<void> {
  if (!isNative()) return;
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import("@capacitor/haptics");
    if (kind === "exito") await Haptics.notification({ type: NotificationType.Success });
    else if (kind === "error") await Haptics.notification({ type: NotificationType.Error });
    else await Haptics.impact({ style: kind === "media" ? ImpactStyle.Medium : ImpactStyle.Light });
  } catch {
    /* sin vibración, nada pasa */
  }
}
