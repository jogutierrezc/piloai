import { describe, expect, it } from "vitest";
import { desktopApp, desktopGate, isMobileDevice } from "./desktop";
import { ACCOUNT_BEAT, APP_BEATS, DESK_HELLO, welcomeBeats, welcomeVoicePlan } from "./welcome-script";
import type { AppVoice } from "./access";

/* La app de escritorio: cuándo lo es, a quién deja pasar y cómo se presenta Pilo en ella. */

const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

describe("cuándo es la app de escritorio", () => {
  it("instalada en un computador: en su propia ventana y no en un teléfono", () => {
    expect(desktopApp({ standalone: true, userAgent: WINDOWS })).toBe(true);
    expect(desktopApp({ standalone: true, userAgent: MAC })).toBe(true);
  });

  it("en la pestaña del navegador no lo es, aunque sea un computador", () => {
    expect(desktopApp({ standalone: false, userAgent: WINDOWS })).toBe(false);
  });

  it("instalada en un teléfono o una tableta tampoco: ahí sigue el modo sin cuenta", () => {
    expect(desktopApp({ standalone: true, userAgent: ANDROID })).toBe(false);
    expect(desktopApp({ standalone: true, userAgent: IPHONE })).toBe(false);
    // Un iPad moderno dice ser Mac, pero tiene pantalla táctil.
    expect(desktopApp({ standalone: true, userAgent: MAC, maxTouchPoints: 5 })).toBe(false);
    expect(isMobileDevice(WINDOWS, 10)).toBe(false);
  });
});

describe("en el escritorio la cuenta es obligatoria", () => {
  it("fuera del escritorio nadie queda detenido", () => {
    expect(desktopGate({ desktop: false, pending: true, signedIn: false })).toBe("libre");
    expect(desktopGate({ desktop: false, pending: false, signedIn: false })).toBe("libre");
  });

  it("con la cuenta de Pilo o la sesión de la intranet, pasa", () => {
    expect(desktopGate({ desktop: true, pending: false, signedIn: true })).toBe("libre");
    expect(desktopGate({ desktop: true, pending: true, signedIn: true })).toBe("libre");
  });

  it("mientras se lee la sesión espera; sin sesión, va a la cuenta", () => {
    expect(desktopGate({ desktop: true, pending: true, signedIn: false })).toBe("espera");
    expect(desktopGate({ desktop: true, pending: false, signedIn: false })).toBe("cuenta");
  });
});

describe("la bienvenida de escritorio", () => {
  const voice: AppVoice = { portal: "pregunta", advanced: true, rate: 1, pitch: 1, expressions: true, modulation: true };

  it("en el teléfono y en el navegador es la de siempre", () => {
    expect(welcomeBeats()).toBe(APP_BEATS);
    expect(welcomeBeats({ account: true })).toBe(APP_BEATS);
  });

  it("en el computador Pilo lo dice, y sin cuenta la pide en vez de elegir Pilo", () => {
    const beats = welcomeBeats({ desktop: true, account: true });
    expect(beats.map((b) => b.id)).toEqual(["hola", "preguntar", "fuente", "cuenta"]);
    expect(beats[0]).toBe(DESK_HELLO);
    expect(beats[0].say).toContain("la Inteligencia Artificial de la Universidad de Santander");
    expect(beats[0].say).toMatch(/computador/);
    expect(beats[3]).toBe(ACCOUNT_BEAT);
    expect(beats.map((b) => Boolean(b.pick))).toEqual([false, false, false, true]);
  });

  it("quien ya entró elige Pilo, como siempre", () => {
    expect(welcomeBeats({ desktop: true, account: false }).map((b) => b.id)).toEqual(["hola", "preguntar", "fuente", "elegir"]);
  });

  it("la voz pide las frases que de verdad se dicen", () => {
    const beats = welcomeBeats({ desktop: true, account: true });
    expect(welcomeVoicePlan(voice, { beats }).map((r) => r.text)).toEqual(beats.map((b) => b.say));
    expect(welcomeVoicePlan(null, { beats })).toEqual([]);
  });
});
