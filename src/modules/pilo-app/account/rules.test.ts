import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_BENEFITS,
  DOMAINS,
  EMPTY_REG,
  campusFixed,
  cuentaFailure,
  cuentasOff,
  emailProblem,
  emailRule,
  firstOpenStep,
  isMember,
  memberAskRol,
  parseAccount,
  passwordChecks,
  passwordProblem,
  personCard,
  prefsOf,
  prefsPatch,
  previewAnswer,
  regSteps,
  registerBody,
  registerErrorField,
  registerErrorStep,
  rolQuestion,
  stepProblem,
  suggestUsername,
  usernameProblem,
} from "./rules";
import type { PiloAccount, RegData } from "./rules";

const reg = (over: Partial<RegData> = {}): RegData => ({ ...EMPTY_REG, ...over });

const cuenta = (over: Partial<PiloAccount> = {}): PiloAccount => ({
  id: "u1",
  username: "laura.gomez",
  full_name: "Laura Gómez",
  email: "laura.gomez@mail.udes.edu.co",
  rol: "estudiante",
  campus: "bucaramanga",
  status: "activa",
  nick: "Laura",
  tone: "cercano",
  length: "normal",
  about: "",
  program: "",
  ...over,
});

describe("qué correo entra y qué admite (espejo de pilo_email_rule)", () => {
  it("solo los cinco dominios de la UDES", () => {
    expect(DOMAINS.map((d) => d.domain)).toEqual(["mail.udes.edu.co", "udes.edu.co", "bucaramanga.udes.edu.co", "cucuta.udes.edu.co", "valledupar.udes.edu.co"]);
    for (const email of ["a@gmail.com", "a@udes.edu", "a@mail.udes.edu.co.co", "a@otra.udes.edu.co", "a@bogota.udes.edu.co", "sin-arroba", "", "a b@udes.edu.co", "a@@udes.edu.co"]) {
      expect(emailRule(email), email).toBeNull();
    }
  });

  it("@mail es de estudiantes y profesores; los demás, de administrativos y profesores", () => {
    expect(emailRule("laura@mail.udes.edu.co")).toMatchObject({ roles: ["estudiante", "profesor"], campus: "" });
    for (const d of ["udes.edu.co", "bucaramanga.udes.edu.co", "cucuta.udes.edu.co", "valledupar.udes.edu.co"]) {
      expect(emailRule(`x@${d}`)?.roles, d).toEqual(["administrativo", "profesor"]);
    }
  });

  it("la sede sale del dominio cuando lo dice; si no, queda por preguntar", () => {
    expect(emailRule("x@bucaramanga.udes.edu.co")?.campus).toBe("bucaramanga");
    expect(emailRule("x@cucuta.udes.edu.co")?.campus).toBe("cucuta");
    expect(emailRule("x@valledupar.udes.edu.co")?.campus).toBe("valledupar");
    expect(emailRule("x@udes.edu.co")?.campus).toBe("");
    expect(emailRule("x@mail.udes.edu.co")?.campus).toBe("");
  });

  it("no le importan las mayúsculas ni los espacios de los lados", () => {
    expect(emailRule("  Laura.Gomez@MAIL.udes.edu.co ")?.domain).toBe("mail.udes.edu.co");
  });

  it("dice qué le falta a un correo", () => {
    expect(emailProblem("")).toMatch(/Escriba su correo/);
    expect(emailProblem("laura")).toMatch(/arroba/);
    expect(emailProblem("laura@gmail.com")).toMatch(/«@gmail\.com» no es un correo de la UDES/);
    expect(emailProblem("laura@mail.udes.edu.co")).toBe("");
  });

  it("es la misma regla que la de la base (0120)", () => {
    const sql = readFileSync(resolve(process.cwd(), "supabase/migrations/0120_pilo_usuarios.sql"), "utf8");
    for (const d of DOMAINS) {
      const line = sql.split("\n").find((l) => l.includes(`when '${d.domain}'`)) ?? "";
      expect(line, d.domain).toContain(`jsonb_build_array(${d.roles.map((r) => `'${r}'`).join(", ")})`);
      expect(line, d.domain).toContain(`'campus', '${d.campus}'`);
    }
  });

  it("Pilo pregunta según el dominio", () => {
    expect(rolQuestion(emailRule("x@mail.udes.edu.co")!)).toMatch(/estudiantes y profesores/);
    expect(rolQuestion(emailRule("x@cucuta.udes.edu.co")!)).toMatch(/sede Cúcuta/);
    expect(rolQuestion(emailRule("x@udes.edu.co")!)).toMatch(/administrativo o profesor/);
  });
});

describe("el nombre de usuario (espejo de la función)", () => {
  it("de 4 a 20: minúsculas, números, punto o guion bajo", () => {
    for (const ok of ["laura", "laura.gomez", "l_g2", "a1b2", "abcdefghijklmnopqrst"]) expect(usernameProblem(ok), ok).toBe("");
    for (const bad of ["abc", "abcdefghijklmnopqrstu", "laura gómez", "laura-gomez", "laura@x", "ñandu"]) expect(usernameProblem(bad), bad).not.toBe("");
    expect(usernameProblem("")).toMatch(/Escriba/);
  });

  it("sin punto ni guion bajo al inicio, al final ni dobles", () => {
    for (const bad of [".laura", "laura.", "_laura", "laura_", "lau..ra", "lau__ra", "lau._ra"]) expect(usernameProblem(bad), bad).toMatch(/empezar ni terminar/);
  });

  it("los nombres reservados no se entregan, tampoco disfrazados con puntos", () => {
    for (const bad of ["admin", "mrpilo", "mr.pilo", "p.i.l.o", "soporte", "intranet", "u_d_e_s"]) expect(usernameProblem(bad), bad).toMatch(/reservado/);
    expect(usernameProblem("pilo2026")).toBe("");
  });

  it("se compara en minúsculas", () => {
    expect(usernameProblem("  Laura.Gomez ")).toBe("");
  });

  it("los reservados y el formato son los de la función", () => {
    const fn = readFileSync(resolve(process.cwd(), "supabase/functions/pilo-cuentas/index.ts"), "utf8");
    const reserved = (fn.match(/const RESERVED = \[([^\]]+)\]/)?.[1] ?? "").split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(reserved.length).toBeGreaterThan(5);
    for (const name of reserved) expect(usernameProblem(name), name).not.toBe("");
    expect(fn).toContain("/^[a-z0-9._]{4,20}$/");
  });

  it("propone un usuario a partir del nombre", () => {
    expect(suggestUsername("Laura Gómez")).toBe("laura.gomez");
    expect(suggestUsername("  José   Ñáñez  Pérez ")).toBe("jose.nanez.perez");
    expect(suggestUsername("María de los Ángeles Rodríguez")).toBe("maria.de.los.angeles");
    expect(suggestUsername("O'Brien-Smith")).toBe("o.brien.smith");
    expect(suggestUsername("")).toBe("");
    // Lo propuesto, si alcanza los 4 caracteres, cumple el formato.
    for (const name of ["Laura Gómez", "José Ñáñez Pérez", "María de los Ángeles Rodríguez Hernández"]) expect(usernameProblem(suggestUsername(name)), name).toBe("");
  });
});

describe("la contraseña (espejo de la función)", () => {
  it("8 a 72, con una letra y un número", () => {
    expect(passwordProblem("corta1")).toMatch(/8 caracteres/);
    expect(passwordProblem("sololetras")).toMatch(/una letra y un número/);
    expect(passwordProblem("12345678")).toMatch(/una letra y un número/);
    expect(passwordProblem(`a1${"x".repeat(71)}`)).toMatch(/demasiado larga/);
    expect(passwordProblem("pilo2026x")).toBe("");
    expect(passwordProblem(`a1${"x".repeat(70)}`)).toBe("");
  });

  it("la lista dice qué cumple", () => {
    expect(passwordChecks("")).toEqual({ len: false, letter: false, num: false });
    expect(passwordChecks("abc")).toEqual({ len: false, letter: true, num: false });
    expect(passwordChecks("pilo2026x")).toEqual({ len: true, letter: true, num: true });
  });
});

describe("los pasos del registro", () => {
  it("la sede solo se pregunta si el dominio no la dice", () => {
    expect(regSteps(null)).toEqual(["correo", "perfil", "sede", "identidad", "clave", "trato"]);
    expect(regSteps(emailRule("x@mail.udes.edu.co"))).toEqual(["correo", "perfil", "sede", "identidad", "clave", "trato"]);
    expect(regSteps(emailRule("x@udes.edu.co"))).toContain("sede");
    expect(regSteps(emailRule("x@cucuta.udes.edu.co"))).toEqual(["correo", "perfil", "identidad", "clave", "trato"]);
  });

  it("cada paso dice lo primero que le falta", () => {
    expect(stepProblem("correo", reg({ email: "x@gmail.com" }))).toMatchObject({ field: "email" });
    expect(stepProblem("correo", reg({ email: "x@udes.edu.co" }))).toBeNull();
    expect(stepProblem("perfil", reg({ email: "x@mail.udes.edu.co" }))).toMatchObject({ field: "rol" });
    // Un perfil que ese correo no admite no vale.
    expect(stepProblem("perfil", reg({ email: "x@mail.udes.edu.co", rol: "administrativo" }))).toMatchObject({ field: "rol" });
    expect(stepProblem("perfil", reg({ email: "x@udes.edu.co", rol: "estudiante" }))).toMatchObject({ field: "rol" });
    expect(stepProblem("perfil", reg({ email: "x@mail.udes.edu.co", rol: "estudiante" }))).toBeNull();
    expect(stepProblem("sede", reg({ email: "x@mail.udes.edu.co" }))).toMatchObject({ field: "campus" });
    expect(stepProblem("sede", reg({ email: "x@mail.udes.edu.co", campus: "bogota" }))).toBeNull();
    expect(stepProblem("sede", reg({ email: "x@valledupar.udes.edu.co" }))).toBeNull();
    expect(stepProblem("identidad", reg({ fullName: "La", username: "laura" }))).toMatchObject({ field: "fullName" });
    expect(stepProblem("identidad", reg({ fullName: "Laura Gómez", username: "la" }))).toMatchObject({ field: "username" });
    expect(stepProblem("identidad", reg({ fullName: "Laura Gómez", username: "laura.gomez" }))).toBeNull();
    expect(stepProblem("clave", reg({ password: "corta" }))).toMatchObject({ field: "password" });
    expect(stepProblem("clave", reg({ password: "pilo2026x" }))).toBeNull();
  });

  it("sin aceptar los términos no se crea la cuenta", () => {
    // El texto que se acepta es el de terms/policy.ts (ver terms/terms.test.ts): aquí ya no hay otro.
    expect(readFileSync(resolve(process.cwd(), "src/modules/pilo-app/account/rules.ts"), "utf8")).not.toMatch(/ACCOUNT_TERMS|TERMS_VERSION/);
    expect(stepProblem("trato", reg({ nick: "Laura" }))).toMatchObject({ field: "terms" });
    expect(stepProblem("trato", reg({ nick: "x".repeat(41), terms: true }))).toMatchObject({ field: "nick" });
    expect(stepProblem("trato", reg({ nick: "Laura", terms: true }))).toBeNull();
    expect(stepProblem("trato", reg({ terms: true }))).toBeNull();
  });

  it("el primer paso incompleto es hasta donde se llega", () => {
    expect(firstOpenStep(reg())).toBe("correo");
    expect(firstOpenStep(reg({ email: "x@cucuta.udes.edu.co", rol: "profesor" }))).toBe("identidad");
    expect(firstOpenStep(reg({ email: "x@mail.udes.edu.co", rol: "profesor" }))).toBe("sede");
    const full = reg({ email: "x@mail.udes.edu.co", rol: "estudiante", campus: "bogota", fullName: "Laura Gómez", username: "laura.gomez", password: "pilo2026x", terms: true });
    expect(firstOpenStep(full)).toBeNull();
  });

  it("lo que viaja a «registrar» es lo del contrato, limpio", () => {
    const body = registerBody(reg({ email: " Laura@Cucuta.UDES.edu.co ", rol: "profesor", campus: "bogota", fullName: "  Laura   Gómez ", username: " Laura.Gomez ", password: " con espacios 1 ", nick: "", tone: "formal", terms: true }));
    expect(body).toEqual({
      email: "laura@cucuta.udes.edu.co",
      rol: "profesor",
      // La sede del dominio manda sobre la elegida.
      campus: "cucuta",
      full_name: "Laura Gómez",
      username: "laura.gomez",
      // La contraseña viaja tal cual: no se recorta.
      password: " con espacios 1 ",
      nick: "Laura",
      tone: "formal",
    });
    expect(registerBody(reg({ email: "x@mail.udes.edu.co", rol: "estudiante", campus: "bogota", fullName: "Ana Ruiz", username: "ana.ruiz", password: "pilo2026x", nick: " Anita " }))).toMatchObject({ campus: "bogota", nick: "Anita", tone: "cercano" });
  });
});

describe("lo que responde la función, en palabras de la persona", () => {
  it("usa el texto del servidor cuando su código es conocido", () => {
    expect(cuentaFailure(409, { error: "Ese correo ya tiene una cuenta de Pilo. Entre con su usuario.", code: "existe" })).toEqual({ code: "existe", message: "Ese correo ya tiene una cuenta de Pilo. Entre con su usuario." });
    expect(cuentaFailure(403, { error: "Su cuenta de Pilo está suspendida. Escriba a la administración.", code: "suspendida" }).code).toBe("suspendida");
    expect(cuentaFailure(429, { error: "Demasiados intentos. Podrá entrar de nuevo en 9 minutos.", code: "bloqueada" })).toMatchObject({ code: "bloqueada", message: expect.stringContaining("9 minutos") });
    expect(cuentaFailure(403, { code: "sin_confirmar" }).message).toMatch(/confirmado su correo/);
  });

  it("el ingreso fallido nunca dice si el usuario existe", () => {
    const a = cuentaFailure(401, { error: "El usuario no existe.", code: "credenciales" });
    const b = cuentaFailure(401, { error: "Contraseña errada.", code: "credenciales" });
    expect(a.message).toBe("El usuario o la contraseña no coinciden.");
    expect(b.message).toBe(a.message);
  });

  it("el límite dice cuánto esperar", () => {
    expect(cuentaFailure(429, { error: "Va muy rápido: espere un momento antes de volver a intentarlo.", code: "limite", retry_after: 45 })).toMatchObject({ code: "limite", retryAfter: 45, message: expect.stringContaining("45 segundos") });
    expect(cuentaFailure(429, { code: "limite", retry_after: 600 }).message).toMatch(/10 minutos/);
    expect(cuentaFailure(429, {})).toMatchObject({ code: "limite" });
    expect(cuentaFailure(429, {}).retryAfter).toBeUndefined();
  });

  it("sin la migración o sin la función, lo dice y ofrece seguir sin cuenta", () => {
    const migration = cuentaFailure(500, { error: "Las cuentas de Pilo todavía no están instaladas: falta la migración 0120.", code: "migracion" });
    expect(migration.code).toBe("migracion");
    // A la persona no se le habla de migraciones.
    expect(migration.message).not.toMatch(/0120|migraci/);
    expect(migration.message).toMatch(/sin cuenta/);
    // La plataforma responde 404 con su propio «code» cuando la función no está desplegada.
    expect(cuentaFailure(404, { code: "NOT_FOUND", message: "Requested function was not found" })).toMatchObject({ code: "sin_funcion" });
    expect(cuentaFailure(404, null).code).toBe("sin_funcion");
    expect(cuentasOff("migracion")).toBe(true);
    expect(cuentasOff("sin_funcion")).toBe(true);
    expect(cuentasOff("credenciales")).toBe(false);
  });

  it("lo que no se entiende no se muestra en crudo", () => {
    expect(cuentaFailure(500, "<html>")).toEqual({ code: "desconocido", message: "Algo falló. Intente de nuevo en un momento." });
    expect(cuentaFailure(401, { code: 401, message: "Invalid JWT" }).code).toBe("desconocido");
    // Una eliminación que la función rechaza trae su explicación, sin código.
    expect(cuentaFailure(403, { error: "Solo la administración elimina cuentas de Pilo." }).message).toBe("Solo la administración elimina cuentas de Pilo.");
  });

  it("cada error del registro vuelve al paso de su campo", () => {
    const withSede = regSteps(emailRule("x@mail.udes.edu.co"));
    const noSede = regSteps(emailRule("x@cucuta.udes.edu.co"));
    expect(registerErrorStep("correo", withSede)).toBe("correo");
    expect(registerErrorStep("existe", withSede)).toBe("correo");
    expect(registerErrorStep("intranet", withSede)).toBe("correo");
    expect(registerErrorStep("rol", withSede)).toBe("perfil");
    expect(registerErrorStep("sede", withSede)).toBe("sede");
    expect(registerErrorStep("sede", noSede)).toBe("perfil");
    expect(registerErrorStep("nombre", withSede)).toBe("identidad");
    expect(registerErrorStep("usuario", withSede)).toBe("identidad");
    expect(registerErrorStep("clave", withSede)).toBe("clave");
    for (const code of ["correos", "alta", "limite", "migracion", "red", "desconocido"] as const) expect(registerErrorStep(code, withSede), code).toBeNull();
    expect(registerErrorField("usuario")).toBe("username");
    expect(registerErrorField("existe")).toBe("email");
    expect(registerErrorField("alta")).toBeNull();
  });
});

describe("la cuenta", () => {
  it("lee la fila propia; lo que no se entiende es «sin cuenta»", () => {
    expect(parseAccount(null)).toBeNull();
    expect(parseAccount({})).toBeNull();
    expect(parseAccount({ id: "u1", username: "laura", rol: "rector" })).toBeNull();
    expect(parseAccount({ id: "u1", username: "laura", rol: "profesor", campus: "marte", tone: "gritón", length: "eterna" })).toMatchObject({ rol: "profesor", campus: "", tone: "cercano", length: "normal", status: "activa" });
    expect(parseAccount({ id: "u1", username: "laura", rol: "estudiante", status: "suspendida" })?.status).toBe("suspendida");
  });

  it("solo la cuenta activa cuenta como sesión", () => {
    expect(isMember(cuenta())).toBe(true);
    expect(isMember(cuenta({ status: "suspendida" }))).toBe(false);
    expect(isMember(null)).toBe(false);
  });

  it("en Enseñanza el rol es el de la cuenta; un administrativo entra sin rol", () => {
    expect(memberAskRol(cuenta({ rol: "estudiante" }))).toBe("estudiante");
    expect(memberAskRol(cuenta({ rol: "profesor" }))).toBe("profesor");
    expect(memberAskRol(cuenta({ rol: "administrativo", email: "x@udes.edu.co" }))).toBe("general");
  });

  it("la sede solo se cambia si el correo no la fija", () => {
    expect(campusFixed(cuenta())).toBe(false);
    expect(campusFixed(cuenta({ email: "x@cucuta.udes.edu.co" }))).toBe(true);
    const free = cuenta();
    expect(prefsPatch(free, { ...prefsOf(free), campus: "bogota" })).toEqual({ campus: "bogota" });
    const fixed = cuenta({ email: "x@cucuta.udes.edu.co", rol: "profesor", campus: "cucuta" });
    expect(prefsPatch(fixed, { ...prefsOf(fixed), campus: "bogota" })).toEqual({});
  });

  it("solo viaja lo que cambió, limpio y con sus topes", () => {
    const a = cuenta();
    expect(prefsPatch(a, prefsOf(a))).toEqual({});
    expect(prefsPatch(a, { ...prefsOf(a), nick: "  Lau  ", tone: "directo", length: "corta", about: `  ${"x".repeat(500)}`, program: " Ingeniería   de Software " })).toEqual({
      nick: "Lau",
      tone: "directo",
      length: "corta",
      about: "x".repeat(400),
      program: "Ingeniería de Software",
    });
    // Nunca el perfil, el usuario ni el correo.
    expect(Object.keys(prefsPatch(a, { ...prefsOf(a), nick: "Otra" }))).toEqual(["nick"]);
  });

  it("la persona en el menú: nombre, perfil y usuario", () => {
    expect(personCard(cuenta())).toEqual({ name: "Laura Gómez", under: "Estudiante · @laura.gomez", initial: "L" });
    expect(personCard(cuenta({ full_name: "", nick: "" })).name).toBe("laura.gomez");
  });

  it("la muestra cambia con el nombre, el tono y la extensión", () => {
    expect(previewAnswer("Laura", "cercano", "corta")).toBe("¡Claro, Laura! Una rúbrica dice qué se evalúa y con qué niveles.");
    expect(previewAnswer("Laura", "formal", "corta")).toMatch(/^Con gusto, Laura\./);
    expect(previewAnswer("Laura", "directo", "corta")).toMatch(/^Laura:/);
    expect(previewAnswer("", "directo", "corta")).toBe("Una rúbrica dice qué se evalúa y con qué niveles.");
    expect(previewAnswer("Laura", "cercano", "detallada").length).toBeGreaterThan(previewAnswer("Laura", "cercano", "normal").length);
  });

  it("dice con claridad qué gana quien se registra", () => {
    const all = ACCOUNT_BENEFITS.map((b) => b.title).join(" | ");
    expect(all).toMatch(/Funciones ampliadas/);
    expect(all).toMatch(/a su medida/);
    expect(all).toMatch(/Guardar respuestas/);
    expect(all).toMatch(/Más cupo/);
  });
});
