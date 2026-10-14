/* La lógica del servidor del carnet: el código firmado, su vigencia, lo que ve quien verifica y el pase de Google Wallet. */

import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  TOLERANCE,
  VERIFY_SECONDS,
  WINDOW_SECONDS,
  checkToken,
  fromBase64Url,
  perfilLine,
  rateWindow,
  signRs256,
  signToken,
  toBase64Url,
  verificationCard,
  vigencia,
  visitorSeed,
  walletClaims,
  walletEnv,
  walletLink,
  walletObject,
  windowLeft,
  windowOf,
} from "./servidor-logica";

const SECRET = "secreto-de-prueba-de-treinta-y-dos-caracteres-o-mas";
const USER = "00000000-0000-4000-c000-000000000011";
const OTHER = "00000000-0000-4000-c000-000000000012";
const T0 = Date.UTC(2026, 9, 9, 15, 0, 7);

describe("el código del carnet", () => {
  it("lleva el prefijo, el tipo, un identificador sin datos legibles y una firma", async () => {
    const token = (await signToken(SECRET, "r", USER, windowOf(T0)))!;
    expect(token.split(".")).toHaveLength(5);
    expect(token.startsWith("UP1.r.")).toBe(true);
    expect(token).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(token.length).toBeLessThan(80);
    // Nada legible: ni el uuid, ni nombre alguno.
    expect(token).not.toContain(USER);
  });

  it("cambia en cada ventana de 30 s y es el mismo dentro de una", async () => {
    const a = await signToken(SECRET, "r", USER, windowOf(T0));
    const b = await signToken(SECRET, "r", USER, windowOf(T0 + 5_000));
    const c = await signToken(SECRET, "r", USER, windowOf(T0 + WINDOW_SECONDS * 1000));
    expect(windowOf(T0)).toBe(windowOf(T0 + 5_000));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("se verifica y devuelve a su dueño", async () => {
    const token = await signToken(SECRET, "r", USER, windowOf(T0));
    expect(await checkToken(SECRET, token, T0)).toEqual({ ok: true, userId: USER, kind: "r" });
  });

  it("tolera ±1 ventana y una captura vence en 60 s como máximo", async () => {
    expect(TOLERANCE).toBe(1);
    const token = await signToken(SECRET, "r", USER, windowOf(T0));
    const step = WINDOW_SECONDS * 1000;
    expect((await checkToken(SECRET, token, T0 + step)).ok).toBe(true);
    expect((await checkToken(SECRET, token, T0 - step)).ok).toBe(true);
    expect(await checkToken(SECRET, token, T0 + 2 * step)).toEqual({ ok: false, reason: "vencido" });
    expect(await checkToken(SECRET, token, T0 - 2 * step)).toEqual({ ok: false, reason: "vencido" });
    // Desde que nace (inicio de su ventana) hasta que vence: menos de 90 s en el peor caso, 60 s contado desde el final de su ventana.
    const born = windowOf(T0) * step;
    expect((await checkToken(SECRET, token, born + 2 * step - 1)).ok).toBe(true);
    expect((await checkToken(SECRET, token, born + 2 * step)).ok).toBe(false);
  });

  it("rechaza una firma ajena, un secreto distinto y una persona cambiada", async () => {
    const token = (await signToken(SECRET, "r", USER, windowOf(T0)))!;
    expect(await checkToken("otro-secreto-otro-secreto-otro-secreto-xx", token, T0)).toEqual({ ok: false, reason: "firma" });
    const parts = token.split(".");
    const forged = [parts[0], parts[1], toBase64Url(new Uint8Array(16).fill(7)), parts[3], parts[4]].join(".");
    expect(await checkToken(SECRET, forged, T0)).toEqual({ ok: false, reason: "firma" });
    const swapped = (await signToken(SECRET, "r", OTHER, windowOf(T0)))!.split(".");
    expect(await checkToken(SECRET, [parts[0], parts[1], swapped[2], parts[3], parts[4]].join("."), T0)).toEqual({ ok: false, reason: "firma" });
    const kind = [parts[0], "v", parts[2], parts[3], parts[4]].join(".");
    expect((await checkToken(SECRET, kind, T0)).ok).toBe(false);
  });

  it("rechaza lo que no es un código", async () => {
    for (const bad of [undefined, null, 5, "", "hola", "UP1.r.x.y", "UP1.x.AAAA.1.AAAA", "x".repeat(300), "UP1.r.%%.1.AAAA"]) {
      expect(await checkToken(SECRET, bad, T0)).toMatchObject({ ok: false, reason: "formato" });
    }
  });

  it("no firma con un identificador inválido ni sin secreto", async () => {
    expect(await signToken(SECRET, "r", "no-es-uuid", 1)).toBeNull();
    expect(await signToken("", "r", USER, 1)).toBeNull();
  });

  it("la verificación para un tercero dura 5 minutos", async () => {
    expect(VERIFY_SECONDS).toBe(300);
    const exp = Math.floor(T0 / 1000) + VERIFY_SECONDS;
    const token = await signToken(SECRET, "v", USER, exp);
    expect(await checkToken(SECRET, token, T0 + 299_000)).toEqual({ ok: true, userId: USER, kind: "v" });
    expect(await checkToken(SECRET, token, T0 + 301_000)).toEqual({ ok: false, reason: "vencido" });
  });

  it("la cuenta regresiva", () => {
    expect(windowLeft(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe(30);
    expect(windowLeft(Date.UTC(2026, 0, 1, 0, 0, 29))).toBe(1);
    expect(windowLeft(Date.UTC(2026, 0, 1, 0, 0, 30))).toBe(30);
  });

  it("base64url hace ida y vuelta", () => {
    const bytes = Uint8Array.from([0, 250, 251, 252, 253, 254, 255, 1, 2, 3]);
    expect([...fromBase64Url(toBase64Url(bytes))!]).toEqual([...bytes]);
    expect(fromBase64Url("a+b")).toBeNull();
  });
});

describe("lo que ve quien verifica", () => {
  const laura = { full_name: "Laura Gómez", rol: "estudiante", campus: "bucaramanga", status: "activa" };
  const perfil = { programa: "Ingeniería de Software", semestre: 5, jornada: "diurna", suspendido_en: null, codigo: "2260000", rh: "O+", contacto: "Ana 300" } as never;

  it("solo nombre, perfil, sede y vigencia: nunca código, RH, contacto, foto ni correo", () => {
    const card = verificationCard(laura, perfil);
    expect(card).toEqual({ nombre: "Laura Gómez", perfil: "Estudiante", detalle: "Ingeniería de Software · 5.º semestre", sede: "Bucaramanga", vigente: true, motivo: "" });
    const text = JSON.stringify(card);
    for (const secret of ["2260000", "O+", "Ana 300", "@"]) expect(text).not.toContain(secret);
  });

  it("el detalle según el perfil", () => {
    expect(perfilLine("profesor", { facultad: "Ingenierías", vinculacion: "catedra" })).toBe("Ingenierías · Cátedra");
    expect(perfilLine("administrativo", { dependencia: "Planeación", cargo: "Profesional" })).toBe("Planeación · Profesional");
    expect(perfilLine("estudiante", null)).toBe("");
  });

  it("la vigencia: suspendido por pérdida o cuenta suspendida", () => {
    expect(vigencia(laura, null)).toEqual({ vigente: true, motivo: "" });
    expect(vigencia(laura, { suspendido_en: "2026-10-01T00:00:00Z" })).toEqual({ vigente: false, motivo: "suspendido" });
    expect(vigencia({ ...laura, status: "suspendida" }, null)).toEqual({ vigente: false, motivo: "cuenta" });
  });
});

describe("los contadores del límite", () => {
  it("la huella no lleva el espacio en el de partida, y sí en los demás", () => {
    expect(visitorSeed("s", "2026-10-09", "p", "m:1")).toBe("s|2026-10-09|p|m:1");
    expect(visitorSeed("s", "2026-10-09", "p", "m:1", "ensenanza")).toBe("s|2026-10-09|p|ensenanza|m:1");
  });
  it("la ventana fija", () => {
    const w = rateWindow(Date.UTC(2026, 0, 1, 0, 3, 10), 600);
    expect(w.start).toBe("2026-01-01T00:00:00.000Z");
    expect(w.retryAfter).toBe(410);
  });
});

describe("Google Wallet", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const base: Record<string, string> = {
    GOOGLE_WALLET_ISSUER_ID: "3388000000012345678",
    GOOGLE_WALLET_SA_EMAIL: "wallet@proyecto.iam.gserviceaccount.com",
    GOOGLE_WALLET_SA_KEY: pem,
    GOOGLE_WALLET_CLASS_ID: "carnet_udes",
    ALLOWED_ORIGIN: "https://planeacion.udes.edu.co",
  };
  const card = verificationCard({ full_name: "Laura Gómez", rol: "estudiante", campus: "bucaramanga", status: "activa" }, { programa: "Ingeniería de Software", semestre: 5 });

  it("sin alguna variable obligatoria no hay configuración", () => {
    expect(walletEnv((n) => base[n])).not.toBeNull();
    for (const name of ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SA_EMAIL", "GOOGLE_WALLET_SA_KEY", "GOOGLE_WALLET_CLASS_ID"]) {
      expect(walletEnv((n) => (n === name ? "" : base[n]))).toBeNull();
    }
    expect(walletEnv(() => undefined)).toBeNull();
    expect(walletEnv((n) => (n === "GOOGLE_WALLET_ISSUER_ID" ? "abc" : base[n]))).toBeNull();
  });

  it("completa la clase con el emisor y acepta la llave con \\n escritos", () => {
    const env = walletEnv((n) => (n === "GOOGLE_WALLET_SA_KEY" ? pem.replace(/\n/g, "\\n") : base[n]))!;
    expect(env.classId).toBe("3388000000012345678.carnet_udes");
    expect(env.serviceKey).toContain("\n");
    expect(walletEnv((n) => (n === "GOOGLE_WALLET_CLASS_ID" ? "3388000000012345678.otra" : base[n]))!.classId).toBe("3388000000012345678.otra");
  });

  it("el objeto solo lleva nombre, perfil, sede y vigencia", async () => {
    const env = walletEnv((n) => base[n])!;
    const object = await walletObject(env, "secreto-secreto-secreto-secreto-secreto", USER, card, "2026-10-09");
    expect(object.id).toMatch(/^3388000000012345678\.[0-9a-f]{24}$/);
    expect(object.id).not.toContain(USER.replace(/-/g, ""));
    expect(object.classId).toBe("3388000000012345678.carnet_udes");
    expect(object.state).toBe("ACTIVE");
    expect(object.header.defaultValue.value).toBe("Laura Gómez");
    const text = JSON.stringify(object);
    expect(text).toContain("Ingeniería de Software");
    expect(text).toContain("Bucaramanga");
    expect(text).toContain("Vigente al 2026-10-09");
    // Sin código QR, sin foto, sin identificador de la cuenta.
    expect(object).not.toHaveProperty("barcode");
    expect(object).not.toHaveProperty("heroImage");
    expect(text).not.toContain(USER);
  });

  it("el JWT es RS256, con las reclamaciones del enlace, y la firma verifica con la llave pública", async () => {
    const env = walletEnv((n) => base[n])!;
    const object = await walletObject(env, "secreto-secreto-secreto-secreto-secreto", USER, card, "2026-10-09");
    const jwt = (await signRs256(walletClaims(env, object, 1_790_000_000), env.serviceKey))!;
    const [head, body, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    const claims = JSON.parse(Buffer.from(body, "base64url").toString());
    expect(claims).toMatchObject({ iss: "wallet@proyecto.iam.gserviceaccount.com", aud: "google", typ: "savetowallet", iat: 1_790_000_000, origins: ["https://planeacion.udes.edu.co"] });
    expect(claims.payload.genericObjects).toHaveLength(1);
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      await crypto.subtle.importKey("spki", publicKey.export({ type: "spki", format: "der" }), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]),
      Buffer.from(sig, "base64url"),
      new TextEncoder().encode(`${head}.${body}`),
    );
    expect(ok).toBe(true);
    expect(walletLink(jwt)).toBe(`https://pay.google.com/gp/v/save/${jwt}`);
  });

  it("una llave que no sirve no firma", async () => {
    expect(await signRs256({}, "no es una llave")).toBeNull();
    expect(await signRs256({}, "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----")).toBeNull();
  });
});
