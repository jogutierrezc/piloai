/* =============================================================================
   Páginas web · el navegador (0132) · lo que se calcula sin pantalla: cómo se
   lee el estado que devuelve la base y qué dirección y qué clave se dejan
   guardar.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { BROWSER_KEY_MIN, checkBrowserKey, checkBrowserUrl, parseBrowser } from "./browser";

describe("el estado de la conexión", () => {
  it("venga como venga, nace apagada y sin clave", () => {
    for (const junk of [null, undefined, "x", 7, [], {}]) expect(parseBrowser(junk), String(junk)).toEqual({ missing: false, enabled: false, url: "", key: { has: false, last4: "" }, ready: false });
  });

  it("está lista solo encendida, con una dirección que sirve y con clave", () => {
    const full = { enabled: true, url: "https://navegador.udes.edu.co", key: { has: true, last4: "WXYZ" }, ready: true };
    expect(parseBrowser(full)).toEqual({ missing: false, enabled: true, url: "https://navegador.udes.edu.co", key: { has: true, last4: "WXYZ" }, ready: true });
    expect(parseBrowser({ ...full, enabled: false }).ready).toBe(false);
    expect(parseBrowser({ ...full, key: { has: false, last4: "" } }).ready).toBe(false);
    // «ready» no se le cree a la base si la dirección no pasa la revisión de la función.
    expect(parseBrowser({ ...full, url: "https://10.0.0.5:8787" }).ready).toBe(false);
    expect(parseBrowser({ ...full, url: "" }).ready).toBe(false);
    expect(parseBrowser({ ...full, enabled: "true" }).ready).toBe(false);
    // De la clave solo llegan cuatro caracteres, aunque la base mandara más.
    expect(parseBrowser({ ...full, key: { has: true, last4: "clave-entera-WXYZ" } }).key.last4).toBe("WXYZ");
  });
});

describe("lo que se deja guardar", () => {
  it("la dirección: https, dominio público; queda sin barra final ni /leer", () => {
    expect(checkBrowserUrl(" https://navegador.udes.edu.co/ ")).toEqual({ ok: true, url: "https://navegador.udes.edu.co" });
    expect(checkBrowserUrl("https://servicios.udes.edu.co:8443/pilo/leer")).toEqual({ ok: true, url: "https://servicios.udes.edu.co:8443/pilo" });
    for (const bad of ["", "http://navegador.udes.edu.co", "https://localhost:8787", "https://192.168.1.5", "https://navegador.udes.edu.co/?a=1"]) {
      const r = checkBrowserUrl(bad);
      expect(r.ok, bad).toBe(false);
      expect(!r.ok && r.why.length, bad).toBeGreaterThan(10);
    }
  });

  it("la clave: sin espacios y con el mínimo del servicio", () => {
    const key = "k".repeat(BROWSER_KEY_MIN);
    expect(checkBrowserKey(`  ${key}\n`)).toEqual({ ok: true, key });
    expect(checkBrowserKey("k".repeat(BROWSER_KEY_MIN - 1))).toMatchObject({ ok: false });
    expect(checkBrowserKey("")).toMatchObject({ ok: false });
    expect(checkBrowserKey("k".repeat(201))).toMatchObject({ ok: false, why: "La clave es demasiado larga." });
  });
});
