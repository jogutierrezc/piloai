import { describe, expect, it } from "vitest";
import { audioKey, voiceBody } from "../../components/pilo/ai/client";
import type { AppVoice } from "./access";
import { APP_BEATS, APP_TITLE, NATIVE_ACCOUNT_BEAT, NATIVE_HELLO, ROLE_BEAT, WELCOME_EXAMPLES, voiceRequest, welcomeBeats, welcomeVoice, welcomeVoicePlan } from "./welcome-script";
import { voiceCacheUrl } from "./official-voice";
import { isIosDevice } from "./pwa";

const voice = (over: Partial<AppVoice> = {}): AppVoice => ({ portal: "pregunta", advanced: true, rate: 1, pitch: 1, expressions: true, modulation: true, ...over });

describe("lo que dice la bienvenida", () => {
  it("Pilo se presenta como la Inteligencia Artificial de la Universidad de Santander y habla por toda la universidad", () => {
    expect(APP_TITLE).toBe("Hola, soy Mr. Pilo");
    expect(APP_BEATS[0].say).toContain("la Inteligencia Artificial de la Universidad de Santander");
    const all = APP_BEATS.map((b) => b.say).join(" ");
    // No se presenta como de una oficina.
    expect(all).not.toMatch(/Planeaci[oó]n/i);
    expect(all).toMatch(/enseñar y aprender/);
  });

  it("cuatro partes, y solo la última pide elegir", () => {
    expect(APP_BEATS.map((b) => b.id)).toEqual(["hola", "preguntar", "fuente", "elegir"]);
    expect(APP_BEATS.map((b) => Boolean(b.pick))).toEqual([false, false, false, true]);
    expect(APP_BEATS[3].say).toBe("¿Con cuál Pilo quiere hablar hoy?");
    expect(ROLE_BEAT.pick).toBe(true);
    for (const b of [...APP_BEATS, ROLE_BEAT]) expect(b.label.length).toBeGreaterThan(0);
  });
});

describe("la bienvenida de la app de Android", () => {
  it("son cinco momentos: se elige Pilo y al final se pide la cuenta, sin salida", () => {
    const beats = welcomeBeats({ native: true, account: true });
    expect(beats.map((b) => b.id)).toEqual(["hola", "preguntar", "fuente", "elegir", "cuenta"]);
    expect(beats[0]).toBe(NATIVE_HELLO);
    expect(beats[0].say).toMatch(/teléfono/);
    expect(beats[4]).toBe(NATIVE_ACCOUNT_BEAT);
    expect(beats[4].say).toMatch(/necesito su cuenta/);
    expect(beats.map((b) => Boolean(b.pick))).toEqual([false, false, false, true, true]);
  });

  it("quien ya entró, o el navegador, ve los cuatro de siempre", () => {
    expect(welcomeBeats({ native: true, account: false })).toBe(APP_BEATS);
    expect(welcomeBeats({ native: false, account: true })).toBe(APP_BEATS);
  });

  it("la pregunta de ejemplo se toca: no avanza sola", () => {
    expect(APP_BEATS[1].touch).toBe(true);
  });

  it("los ejemplos traen fuente, y ninguno inventa una cifra", () => {
    expect(WELCOME_EXAMPLES.length).toBeGreaterThanOrEqual(2);
    for (const e of WELCOME_EXAMPLES) {
      expect(e.source.length).toBeGreaterThan(0);
      expect(e.a.length).toBeGreaterThan(20);
      // Solo el nombre del plan lleva números.
      expect(e.a.replace(/2024-2028/g, "")).not.toMatch(/\d/);
    }
  });
});

describe("qué se pide para la voz de la bienvenida", () => {
  it("sin voz oficial no se pide nada: queda el texto", () => {
    expect(welcomeVoicePlan(null)).toEqual([]);
    expect(welcomeVoicePlan(voice({ advanced: false }))).toEqual([]);
  });

  it("se pide cada frase tal como se lee, por el mismo camino que una respuesta", () => {
    const plan = welcomeVoicePlan(voice());
    expect(plan.map((r) => r.beat)).toEqual(["hola", "preguntar", "fuente", "elegir"]);
    for (const [i, r] of plan.entries()) {
      // El texto es el de pantalla: sin muletillas añadidas.
      expect(r.text).toBe(APP_BEATS[i].say);
      // La misma acción, el mismo portal y sin estilo propio: el cuerpo de `voz` de siempre.
      expect(r.body).toEqual(voiceBody(APP_BEATS[i].say, "pregunta"));
      expect(r.body).toEqual({ action: "voz", portal: "pregunta", text: APP_BEATS[i].say, style: undefined });
      // La misma llave de caché que usa la lectura de respuestas.
      expect(r.key).toBe(audioKey(APP_BEATS[i].say, "pregunta"));
    }
  });

  it("la pregunta del rol solo se pide si Pilo en Enseñanza la va a hacer", () => {
    expect(welcomeVoicePlan(voice(), { askRol: false }).some((r) => r.beat === "rol")).toBe(false);
    const plan = welcomeVoicePlan(voice(), { askRol: true });
    expect(plan).toHaveLength(5);
    expect(plan[4]).toMatchObject({ beat: "rol", text: ROLE_BEAT.say });
  });

  it("el ánimo de cada frase cambia la velocidad, como al leer una respuesta", () => {
    const [hola, preguntar, fuente] = welcomeVoicePlan(voice({ rate: 1 }));
    expect(hola.rate).toBe(1.04); // emocionado
    expect(preguntar.rate).toBe(1); // atento
    expect(fuente.rate).toBe(0.96); // reflexivo
    // Con la modulación apagada en la configuración, todas a la velocidad de base.
    expect(welcomeVoicePlan(voice({ rate: 1.1, modulation: false })).map((r) => r.rate)).toEqual([1.1, 1.1, 1.1, 1.1]);
  });

  it("habla con la voz del primer Pilo abierto que la tenga: primero la Universidad", () => {
    const u = voice({ portal: "pregunta" });
    const e = voice({ portal: "ensenanza" });
    expect(welcomeVoice({ planeacion: { state: "abierto", voice: u }, ensenanza: { state: "abierto", voice: e } })?.portal).toBe("pregunta");
    expect(welcomeVoice({ planeacion: { state: "cerrado", voice: u }, ensenanza: { state: "abierto", voice: e } })?.portal).toBe("ensenanza");
    expect(welcomeVoice({ planeacion: { state: "abierto", voice: { ...u, advanced: false } }, ensenanza: { state: "abierto", voice: e } })?.portal).toBe("ensenanza");
    expect(welcomeVoice({ planeacion: { state: "sesion", voice: u }, ensenanza: { state: "cerrado", voice: e } })).toBeNull();
    expect(welcomeVoice({})).toBeNull();
  });

  it("la voz de otro portal pide con ese portal", () => {
    const r = voiceRequest(APP_BEATS[0], voice({ portal: "ensenanza" }));
    expect(r.body).toMatchObject({ action: "voz", portal: "ensenanza" });
    expect(r.key).toBe(audioKey(APP_BEATS[0].say, "ensenanza"));
  });
});

describe("el audio guardado en el teléfono", () => {
  it("cada frase tiene su propia dirección, estable y de este sitio", () => {
    const keys = welcomeVoicePlan(voice(), { askRol: true }).map((r) => voiceCacheUrl(r.key));
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^\/__pilo-voz__\/[0-9a-f]{8}-\d+$/);
    expect(voiceCacheUrl("a")).toBe(voiceCacheUrl("a"));
    expect(voiceCacheUrl("pregunta||hola")).not.toBe(voiceCacheUrl("ensenanza||hola"));
  });
});

describe("la guía de instalación", () => {
  it("reconoce el iPhone y el iPad (que dice ser Mac, pero es táctil)", () => {
    expect(isIosDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 5)).toBe(true);
    expect(isIosDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", 0)).toBe(false);
    expect(isIosDevice("Mozilla/5.0 (Linux; Android 14; Pixel 8)", 5)).toBe(false);
  });
});
