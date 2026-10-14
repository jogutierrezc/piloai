import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { VOICE_CACHE } from "./official-voice";
import { SW_URL } from "./pwa";
import { APP_BASE, APP_PATHS } from "./routes";

/* El service worker es un archivo suelto de public/: aquí se carga tal cual, con un `self` de mentira. */
const PUBLIC = resolve(process.cwd(), "public");
const source = readFileSync(resolve(PUBLIC, SW_URL.slice(1)), "utf8");

interface SwRules {
  VERSION: string;
  PRECACHE: string[];
  SHELL: string;
  ASSETS: string;
  VOICE: string;
  kindOf: (request: { method: string; url: string; mode?: string }, origin: string) => "pasar" | "pagina" | "archivo";
  staleCaches: (names: string[]) => string[];
}

function load(): { rules: SwRules; events: string[] } {
  const events: string[] = [];
  const self: { PILO_APP_SW?: SwRules; addEventListener: (type: string) => void; location: { origin: string } } = {
    addEventListener: (type) => void events.push(type),
    location: { origin: "https://pilo.test" },
  };
  new Function("self", "caches", "fetch", source)(self, {}, () => Promise.reject(new Error("sin red")));
  return { rules: self.PILO_APP_SW as SwRules, events };
}

const { rules, events } = load();
const ORIGIN = "https://pilo.test";
const get = (path: string, mode = "no-cors") => ({ method: "GET", url: path.startsWith("http") ? path : `${ORIGIN}${path}`, mode });

describe("el service worker de la app", () => {
  it("escucha lo que debe: instalarse, activarse, los pedidos, el aviso de la página y las alertas de emergencia", () => {
    expect([...events].sort()).toEqual(["activate", "fetch", "install", "message", "notificationclick", "push"]);
  });

  it("precarga el esqueleto, el manifiesto, los iconos y los cuadros de la cara de Pilo", () => {
    expect(rules.PRECACHE[0]).toBe(APP_BASE);
    expect(rules.PRECACHE).toContain("/manifest.webmanifest");
    for (const part of ["open", "closed", "tongue", "plate", "pupils", "white", "eyes", "wink", "pensar", "graduado", "obra"]) expect(rules.PRECACHE).toContain(`/pilo-face/${part}.png`);
    for (const icon of ["icon-192.png", "icon-512.png", "icon-maskable-512.png", "apple-touch-icon.png"]) expect(rules.PRECACHE).toContain(`/pilo-app/${icon}`);
    expect(new Set(rules.PRECACHE).size).toBe(rules.PRECACHE.length);
  });

  it("todo lo que precarga existe en public/ (menos la página, que la sirve la app)", () => {
    for (const path of rules.PRECACHE.filter((p) => p !== APP_BASE)) expect(existsSync(resolve(PUBLIC, path.slice(1))), path).toBe(true);
  });

  it("la precarga no trae nada de la conversación: ni funciones, ni datos, ni otros sitios", () => {
    for (const path of rules.PRECACHE) {
      expect(path.startsWith("/")).toBe(true);
      expect(path).not.toMatch(/supabase|functions|pilo-ia|\/api\//);
    }
  });

  it("nunca toca las respuestas ni las llamadas a Supabase", () => {
    const supabase = "https://abc.supabase.co";
    expect(rules.kindOf({ method: "POST", url: `${supabase}/functions/v1/pilo-ia`, mode: "cors" }, ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get(`${supabase}/functions/v1/pilo-ia`, "cors"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get(`${supabase}/rest/v1/rpc/pilo_ai_public_config`, "cors"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get(`${supabase}/auth/v1/user`, "cors"), ORIGIN)).toBe("pasar");
    // La voz directa (Vercel) y cualquier otra función de este mismo sitio.
    expect(rules.kindOf({ method: "POST", url: `${ORIGIN}/api/pilo-voz`, mode: "cors" }, ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get("/api/pilo-voz"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get("/functions/v1/pilo-ia"), ORIGIN)).toBe("pasar");
    // Un POST a un archivo del sitio tampoco.
    expect(rules.kindOf({ method: "POST", url: `${ORIGIN}/assets/index-abc.js` }, ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get("https://fonts.googleapis.com/css2?family=Manrope"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf({ method: "GET", url: "no es una dirección" }, ORIGIN)).toBe("pasar");
  });

  it("las pantallas de la app abren con red primero y, sin red, con el esqueleto guardado", () => {
    expect(rules.kindOf(get(APP_BASE, "navigate"), ORIGIN)).toBe("pagina");
    for (const path of Object.values(APP_PATHS)) expect(rules.kindOf(get(path, "navigate"), ORIGIN)).toBe("pagina");
    // El resto del portal no es de la app.
    expect(rules.kindOf(get("/pregunta", "navigate"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get("/apple", "navigate"), ORIGIN)).toBe("pasar");
  });

  it("guarda las imágenes de Pilo y los archivos del sitio, y nada más", () => {
    expect(rules.kindOf(get("/pilo-face/open.png"), ORIGIN)).toBe("archivo");
    expect(rules.kindOf(get("/pilo-app/icon-192.png"), ORIGIN)).toBe("archivo");
    expect(rules.kindOf(get("/assets/PiloApp-a1b2c3.js"), ORIGIN)).toBe("archivo");
    expect(rules.kindOf(get("/manifest.webmanifest"), ORIGIN)).toBe("archivo");
    expect(rules.kindOf(get("/Multimedia1.mp4"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get("/datos-abiertos/algo.json"), ORIGIN)).toBe("pasar");
    expect(rules.kindOf(get("/assets/x.js?t=1"), ORIGIN)).toBe("pasar");
  });

  it("tiene versión, y al activarse borra solo sus cachés viejas", () => {
    expect(rules.VERSION).toMatch(/^v\d+$/);
    expect(rules.SHELL).toContain(rules.VERSION);
    expect(rules.ASSETS).toContain(rules.VERSION);
    const names = [rules.SHELL, rules.ASSETS, rules.VOICE, "pilo-app-esqueleto-v0", "pilo-app-archivos-v0", "otra-cosa-v1", "workbox-precache"];
    expect(rules.staleCaches(names)).toEqual(["pilo-app-esqueleto-v0", "pilo-app-archivos-v0"]);
  });

  it("respeta el audio de la bienvenida que guarda la página", () => {
    expect(rules.VOICE).toBe(VOICE_CACHE);
    expect(rules.staleCaches([VOICE_CACHE])).toEqual([]);
  });
});

describe("el manifiesto", () => {
  const manifest = JSON.parse(readFileSync(resolve(PUBLIC, "manifest.webmanifest"), "utf8")) as {
    name: string;
    start_url: string;
    scope: string;
    display: string;
    display_override?: string[];
    theme_color: string;
    background_color: string;
    icons: { src: string; sizes: string; purpose?: string }[];
    shortcuts: { name: string; url: string }[];
  };

  it("es Mr. Pilo, a pantalla completa, y abre y vive en /app", () => {
    expect(manifest.name).toBe("Mr. Pilo");
    expect(manifest.start_url).toBe(APP_BASE);
    expect(manifest.scope).toBe(APP_BASE);
    expect(manifest.display).toBe("standalone");
    // En el computador se instala igual: su propia ventana, sin la barra del navegador; lo primero que se intenta es lo de siempre.
    expect(manifest.display_override?.[0]).toBe("standalone");
    expect(manifest.display_override).not.toContain("browser");
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/);
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("trae los iconos de 192 y 512 y el enmascarable, y existen", () => {
    expect(manifest.icons.map((i) => `${i.sizes}:${i.purpose}`)).toEqual(["192x192:any", "512x512:any", "512x512:maskable"]);
    for (const icon of manifest.icons) expect(existsSync(resolve(PUBLIC, icon.src.slice(1))), icon.src).toBe(true);
  });

  it("los accesos directos son los dos Pilos, dentro de la app", () => {
    expect(manifest.shortcuts.map((s) => s.url)).toEqual([APP_PATHS.planeacion, APP_PATHS.ensenanza]);
    expect(manifest.shortcuts.map((s) => s.name)).toEqual(["Pilo de la Universidad", "Pilo en Enseñanza"]);
    for (const s of manifest.shortcuts) expect(s.url.startsWith(`${manifest.scope}/`)).toBe(true);
  });
});
