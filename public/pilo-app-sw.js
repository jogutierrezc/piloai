/* =============================================================================
   Mr. Pilo · el service worker de la app móvil (/app).

   Pequeño y propio, sin librerías. Solo manda bajo /app (así se registra en
   src/modules/pilo-app/pwa.ts, y solo en producción).

   Qué guarda:
     - el esqueleto: la página (/app), el manifiesto, los iconos y los cuadros
       de la cara de Pilo, al instalarse;
     - los archivos del sitio (/assets/…, con su huella en el nombre) a medida
       que la app los pide, para abrir al instante y sin conexión.

   Qué no guarda NUNCA: las respuestas de Pilo ni ninguna llamada a Supabase
   o a /api. Todo lo que no es un GET de este mismo sitio pasa de largo, sin
   tocarlo: las respuestas siempre salen de la IA.

   Cada versión tiene sus cachés; al activarse una nueva, las viejas se
   borran. La del audio de la bienvenida (la llena la página, no este archivo)
   se respeta. Para publicar un cambio de este archivo, suba VERSION.

   La lista de precarga y las reglas se prueban en node
   (src/modules/pilo-app/sw.test.ts), que carga este mismo archivo.
   ========================================================================== */

const VERSION = "v3";
const PREFIX = "pilo-app-";
const SHELL = `${PREFIX}esqueleto-${VERSION}`;
const ASSETS = `${PREFIX}archivos-${VERSION}`;
/** La llena la página con el audio de la presentación (official-voice.ts). */
const VOICE = "pilo-app-voz-v1";
/** La página de la app: con ella abre cualquier ruta de /app sin conexión. */
const SHELL_URL = "/app";
/** Cuántos archivos del sitio se guardan a lo sumo; al pasarse, salen los más viejos. */
const ASSET_LIMIT = 90;

const PRECACHE = [
  SHELL_URL,
  "/manifest.webmanifest",
  "/pilo-app/icon-192.png",
  "/pilo-app/icon-512.png",
  "/pilo-app/icon-maskable-512.png",
  "/pilo-app/apple-touch-icon.png",
  "/pilo-face/open.png",
  "/pilo-face/closed.png",
  "/pilo-face/tongue.png",
  "/pilo-face/plate.png",
  "/pilo-face/pupils.png",
  "/pilo-face/white.png",
  "/pilo-face/eyes.png",
  "/pilo-face/wink.png",
  "/pilo-face/pensar.png",
  "/pilo-face/graduado.png",
  "/pilo-face/obra.png",
];

/** Lo que jamás se guarda aunque sea de este sitio: funciones, datos, sesión y voz. */
const NEVER = /^\/(api|functions|rest|auth|storage|realtime)(\/|$)/;

/**
 * Qué se hace con un pedido:
 *   «pasar»    no se toca (otro sitio —Supabase—, otro método, /api…)
 *   «pagina»   una navegación dentro de la app: red primero; sin red, el esqueleto
 *   «archivo»  una imagen de Pilo o un archivo del sitio: lo guardado primero
 */
function kindOf(request, origin) {
  if (!request || request.method !== "GET") return "pasar";
  let url;
  try {
    url = new URL(request.url);
  } catch (error) {
    return "pasar";
  }
  if (url.origin !== origin) return "pasar";
  if (NEVER.test(url.pathname)) return "pasar";
  if (request.mode === "navigate") return url.pathname === SHELL_URL || url.pathname.startsWith(`${SHELL_URL}/`) ? "pagina" : "pasar";
  if (url.search) return "pasar";
  if (PRECACHE.includes(url.pathname)) return "archivo";
  // /Pilo2: las vistas de cuerpo entero de la entrada a un modo secreto. No se precargan: se guardan al usarse.
  if (/^\/(assets|pilo-face|pilo-app|Pilo2)\//.test(url.pathname)) return "archivo";
  return "pasar";
}

/** Las cachés de la app que ya no son de esta versión. Las de otros no se tocan. */
function staleCaches(names) {
  const keep = [SHELL, ASSETS, VOICE];
  return names.filter((name) => name.startsWith(PREFIX) && !keep.includes(name));
}

// Para las pruebas: las reglas, a la vista.
self.PILO_APP_SW = { VERSION, PRECACHE, SHELL, ASSETS, VOICE, kindOf, staleCaches };

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - ASSET_LIMIT))) await cache.delete(key);
}

async function fromCacheFirst(request) {
  const hit = await caches.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  // Solo lo que llegó bien y entero.
  if (response.ok && response.type === "basic") {
    const cache = await caches.open(ASSETS);
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}

async function page(request) {
  try {
    const response = await fetch(request);
    // El esqueleto se refresca con cada visita con red: así apunta a los archivos de la última versión.
    if (response.ok) (await caches.open(SHELL)).put(SHELL_URL, response.clone());
    return response;
  } catch (error) {
    const saved = await caches.match(SHELL_URL);
    if (saved) return saved;
    throw error;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // Uno por uno: si falta una imagen, lo demás se guarda igual.
      .then((cache) => Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => undefined))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleCaches(names).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const kind = kindOf(event.request, self.location.origin);
  if (kind === "pagina") event.respondWith(page(event.request));
  else if (kind === "archivo") event.respondWith(fromCacheFirst(event.request));
  // «pasar»: sin respondWith, el navegador lo pide como siempre.
});

/* La página avisa qué archivos descargó antes de que este service worker mandara (la primera visita). */
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "guardar" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(ASSETS);
      for (const url of data.urls.slice(0, ASSET_LIMIT)) {
        if (typeof url !== "string") continue;
        const request = new Request(url);
        if (kindOf(request, self.location.origin) !== "archivo") continue;
        if (await caches.match(request)) continue;
        try {
          const response = await fetch(request);
          if (response.ok && response.type === "basic") await cache.put(request, response.clone());
        } catch (error) {
          /* sin red: se guardará cuando la app lo pida */
        }
      }
      await trim(cache);
    })(),
  );
});

/* =============================================================================

   ALERTAS DE EMERGENCIA DE ALUNA (sismo, incendio, seguridad).

   Aluna es el sistema de jornada y emergencias del campus; este mismo par de
   claves VAPID firma sus push, y quien activo Alertas de emergencia en
   Ajustes (alertas.ts) registro este telefono en su tabla. La carga viaja
   cifrada y trae lo minimo:

     { clase: "aviso", id, codigo, tipo, titulo, resumen, bloquea_salida }

   Que se distinga a OIDOS es regla del proyecto: una emergencia insiste
   renovando la misma notificacion, y un comunicado no. Aqui no hay sirena
   propia: con la app cerrada suena el tono del sistema, que es lo que la
   plataforma permite a una PWA.
   ========================================================================== */

self.addEventListener("push", (event) => {
  let aviso = {};
  try {
    aviso = event.data ? event.data.json() : {};
  } catch (error) {
    aviso = {};
  }
  const esEmergencia = aviso.tipo === "emergencia";
  event.waitUntil(
    self.registration.showNotification(aviso.titulo || "Alerta de emergencia", {
      body: aviso.resumen || "Emergencia reportada en el campus. Siga las indicaciones del personal de seguridad.",
      icon: "/pilo-app/icon-192.png",
      badge: "/pilo-app/icon-192.png",
      /* El codigo agrupa: cada renovacion de la misma emergencia reemplaza
         a la anterior en la bandeja en vez de apilar copias. */
      tag: aviso.codigo || "aluna-emergencia",
      /* Solo la emergencia vuelve a alertar cuando se renueva: es lo mas
         parecido a una sirena que la bandeja de notificaciones permite. */
      renotify: esEmergencia,
      vibrate: esEmergencia ? [400, 120, 400, 120, 400] : [200],
      data: { url: "/app" },
    }),
  );
});

/* Un toque en la alerta abre (o trae al frente) la app. */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/app";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
