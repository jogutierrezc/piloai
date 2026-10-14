import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_APK, isAndroidDevice } from "./pwa";

/* El APK que el chat ofrece es el mismo que compila pilo-android: la ficha de
   pwa.ts y el archivo de public/ tienen que contar la misma historia. */
const PUBLIC = resolve(process.cwd(), "public");
const apkFile = resolve(PUBLIC, APP_APK.url.slice(1));

describe("isAndroidDevice", () => {
  it("reconoce teléfonos y tabletas Android", () => {
    expect(isAndroidDevice("Mozilla/5.0 (Linux; Android 13; SM-A135F)")).toBe(true);
    expect(isAndroidDevice("Mozilla/5.0 (Linux; Android 11; K; SM-T500)")).toBe(true);
  });

  it("no confunde a los demás", () => {
    expect(isAndroidDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(false);
    expect(isAndroidDevice("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe(false);
    expect(isAndroidDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });
});

describe("APP_APK", () => {
  it("la ficha y el nombre del archivo cuentan la misma versión", () => {
    expect(APP_APK.file).toBe(`Mr-Pilo-${APP_APK.version}.apk`);
    expect(APP_APK.url).toBe(`/pilo-app/apk/${APP_APK.file}`);
    expect(APP_APK.size).toMatch(/MB$/);
  });

  it("el archivo existe en public/, donde el portal lo sirve", () => {
    expect(existsSync(apkFile)).toBe(true);
    // Un APK de verdad pesa megas; si llegara a quedar un archivo vacío, la hoja estaría ofreciendo humo.
    expect(statSync(apkFile).size).toBeGreaterThan(500_000);
    // El nombre del archivo que la hoja le dice que busque en Descargas.
    expect(readFileSync(apkFile).length).toBeGreaterThan(0);
  });
});
