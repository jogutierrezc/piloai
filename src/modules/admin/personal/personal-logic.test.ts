/* =============================================================================
   Personal de Pilo · pruebas de la lógica pura (personal-logic.ts).
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { STAFF_ROLES, canUseArea, spacesFor } from "../../../lib/pilo-staff";
import {
  accessRows,
  activeAdmins,
  countByRole,
  dayLabel,
  emailProblem,
  escapeLike,
  normalizeEmail,
  sameEmail,
  filterStaff,
  inviteProblems,
  inviteValid,
  isDowngrade,
  isLastAdmin,
  isMigrationMissing,
  lastSeenLabel,
  nameProblem,
  parseStaffRow,
  removalConfirmed,
  rpcErrorText,
  staffErrorText,
  staffState,
} from "./personal-logic";
import type { StaffPerson } from "./personal-logic";

const person = (over: Partial<StaffPerson> & { user_id: string }): StaffPerson => ({
  email: `${over.user_id}@udes.edu.co`,
  full_name: "",
  role: "docencia",
  active: true,
  created_at: "2026-01-10T12:00:00Z",
  last_seen_at: null,
  confirmed: true,
  ...over,
});

const rows: StaffPerson[] = [
  person({ user_id: "ana", full_name: "Ana Pérez", role: "admin" }),
  person({ user_id: "luis", full_name: "Luis Gómez", role: "docencia" }),
  person({ user_id: "marta", full_name: "Marta Ñúñez", role: "institucional", active: false }),
  person({ user_id: "ines", full_name: "Inés Ruiz", role: "ambos", confirmed: false }),
];

describe("parseStaffRow", () => {
  it("lee una fila válida y normaliza el correo", () => {
    const r = parseStaffRow({ user_id: "u1", email: "ANA@UDES.EDU.CO", full_name: "Ana", role: "admin", active: true, created_at: "x", last_seen_at: null, confirmed: true });
    expect(r).toMatchObject({ user_id: "u1", email: "ana@udes.edu.co", role: "admin", confirmed: true, last_seen_at: null });
  });
  it("rechaza lo que no se entiende", () => {
    expect(parseStaffRow(null)).toBeNull();
    expect(parseStaffRow({ user_id: "u", email: "a@b.co", role: "dios" })).toBeNull();
    expect(parseStaffRow({ email: "a@b.co", role: "admin" })).toBeNull();
  });
  it("sin confirmed explícito no cuenta como confirmado", () => {
    expect(parseStaffRow({ user_id: "u", email: "a@b.co", role: "admin" })?.confirmed).toBe(false);
  });
});

describe("staffState", () => {
  it("la desactivación manda sobre lo demás", () => {
    expect(staffState({ active: false, confirmed: false })).toBe("inactivo");
    expect(staffState({ active: true, confirmed: false })).toBe("sin_confirmar");
    expect(staffState({ active: true, confirmed: true })).toBe("activo");
  });
});

describe("filterStaff", () => {
  it("sin filtros devuelve todo", () => {
    expect(filterStaff(rows, "", "todos", "")).toHaveLength(4);
  });
  it("por rol", () => {
    expect(filterStaff(rows, "admin", "todos", "").map((r) => r.user_id)).toEqual(["ana"]);
  });
  it("por estado", () => {
    expect(filterStaff(rows, "", "inactivos", "").map((r) => r.user_id)).toEqual(["marta"]);
    expect(filterStaff(rows, "", "activos", "")).toHaveLength(3);
  });
  it("busca sin tildes ni mayúsculas, en nombre, correo y rol", () => {
    expect(filterStaff(rows, "", "todos", "nunez").map((r) => r.user_id)).toEqual(["marta"]);
    expect(filterStaff(rows, "", "todos", "LUIS@").map((r) => r.user_id)).toEqual(["luis"]);
    expect(filterStaff(rows, "", "todos", "administrador").map((r) => r.user_id)).toEqual(["ana"]);
  });
  it("cada palabra debe aparecer, y el estado también se busca", () => {
    expect(filterStaff(rows, "", "todos", "sin confirmar").map((r) => r.user_id)).toEqual(["ines"]);
    expect(filterStaff(rows, "", "todos", "ana luis")).toHaveLength(0);
  });
  it("combina rol, estado y búsqueda", () => {
    expect(filterStaff(rows, "institucional", "activos", "")).toHaveLength(0);
  });
});

describe("countByRole y administradores", () => {
  it("cuenta por rol, con todos los roles aunque estén en cero", () => {
    const c = countByRole(rows);
    expect(Object.keys(c).sort()).toEqual([...STAFF_ROLES].sort());
    expect(c.admin).toEqual({ total: 1, active: 1 });
    expect(c.institucional).toEqual({ total: 1, active: 0 });
    expect(countByRole([]).ambos).toEqual({ total: 0, active: 0 });
  });
  it("detecta al último administrador activo", () => {
    expect(activeAdmins(rows)).toBe(1);
    expect(isLastAdmin(rows, "ana")).toBe(true);
    expect(isLastAdmin(rows, "luis")).toBe(false);
    const two = [...rows, person({ user_id: "otro", role: "admin" })];
    expect(isLastAdmin(two, "ana")).toBe(false);
    const inactiveSecond = [...rows, person({ user_id: "otro", role: "admin", active: false })];
    expect(isLastAdmin(inactiveSecond, "ana")).toBe(true);
    expect(isLastAdmin(rows, "no-existe")).toBe(false);
  });
});

describe("isDowngrade y removalConfirmed", () => {
  it("solo rebajar a un administrador pide confirmar", () => {
    expect(isDowngrade("admin", "docencia")).toBe(true);
    expect(isDowngrade("admin", "admin")).toBe(false);
    expect(isDowngrade("docencia", "admin")).toBe(false);
    expect(isDowngrade("docencia", "ambos")).toBe(false);
  });
  it("quitar exige escribir el correo (sin importar mayúsculas ni bordes)", () => {
    expect(removalConfirmed("  ANA@udes.edu.co ", "ana@udes.edu.co")).toBe(true);
    expect(removalConfirmed("ana@udes", "ana@udes.edu.co")).toBe(false);
    expect(removalConfirmed("", "")).toBe(false);
  });
});

describe("accessRows (sale del contrato)", () => {
  it("coincide con spacesFor y canUseArea para cada rol", () => {
    const table = accessRows();
    const universidad = table.find((r) => r.key === "espacio-planeacion");
    const ensenanza = table.find((r) => r.key === "espacio-ensenanza");
    const personal = table.find((r) => r.key === "zona-personal");
    for (const role of STAFF_ROLES) {
      expect(universidad?.roles[role]).toBe(spacesFor(role).includes("planeacion"));
      expect(ensenanza?.roles[role]).toBe(spacesFor(role).includes("ensenanza"));
      expect(personal?.roles[role]).toBe(canUseArea(role, "personal"));
    }
    expect(personal?.roles.admin).toBe(true);
    expect(personal?.roles.docencia).toBe(false);
  });
  it("lista primero los espacios y después las zonas", () => {
    const kinds = accessRows().map((r) => r.kind);
    expect(kinds.slice(0, 2)).toEqual(["espacio", "espacio"]);
    expect(new Set(kinds.slice(2))).toEqual(new Set(["zona"]));
  });
});

describe("validación del formulario", () => {
  it("correo", () => {
    expect(emailProblem("")).toMatch(/Escriba/);
    expect(emailProblem("   ")).toMatch(/Escriba/);
    expect(emailProblem("sin-arroba")).toMatch(/válido/);
    expect(emailProblem("a@b")).toMatch(/válido/);
    expect(emailProblem("a b@udes.edu.co")).toMatch(/válido/);
    expect(emailProblem(`${"x".repeat(160)}@udes.edu.co`)).toMatch(/válido/);
    expect(emailProblem("  Ana.Perez@UDES.edu.co ")).toBe("");
  });
  it("nombre", () => {
    expect(nameProblem("")).toMatch(/nombre/);
    expect(nameProblem("Al")).toMatch(/nombre/);
    expect(nameProblem("  Ana   Pérez ")).toBe("");
    expect(nameProblem("x".repeat(121))).toMatch(/largo/);
  });
  it("el conjunto exige correo, nombre y rol", () => {
    expect(inviteValid(inviteProblems({ email: "a@udes.edu.co", name: "Ana Pérez", role: "" }))).toBe(false);
    expect(inviteProblems({ email: "a@udes.edu.co", name: "Ana Pérez", role: "" }).role).toBe("Elija un rol.");
    expect(inviteValid(inviteProblems({ email: "a@udes.edu.co", name: "Ana Pérez", role: "ambos" }))).toBe(true);
  });
});

describe("traducción de errores", () => {
  it("cada código de la función tiene su frase", () => {
    for (const code of ["correo", "nombre", "rol", "existe", "cuenta", "permiso", "ultimo_admin", "no_existe", "migracion"]) {
      expect(staffErrorText(code, "texto del servidor")).not.toBe("texto del servidor");
    }
  });
  it("un código desconocido usa el mensaje del servidor, o uno general", () => {
    expect(staffErrorText("raro", "Algo falló.")).toBe("Algo falló.");
    expect(staffErrorText(undefined)).toMatch(/Intente de nuevo/);
    expect(staffErrorText(undefined, "   ")).toMatch(/Intente de nuevo/);
  });
  it("reconoce la migración sin aplicar", () => {
    expect(isMigrationMissing({ code: "PGRST202", message: "x" })).toBe(true);
    expect(isMigrationMissing({ code: "42883" })).toBe(true);
    expect(isMigrationMissing({ message: "Could not find the function public.pilo_staff_list() in the schema cache" })).toBe(true);
    expect(isMigrationMissing({ code: "42501", message: "Solo la administración ve el personal de Pilo." })).toBe(false);
    expect(isMigrationMissing(null)).toBe(false);
  });
  it("errores de rpc: migración, último admin, permiso, otros", () => {
    expect(rpcErrorText({ code: "PGRST202", message: "no" }).code).toBe("migracion");
    const last = rpcErrorText({ code: "42501", message: "Usted es el último administrador activo de Pilo: nómbre a otro antes de dejar de serlo." });
    expect(last.code).toBe("ultimo_admin");
    expect(last.text).toMatch(/último administrador/);
    expect(rpcErrorText({ code: "42501", message: "Solo la administración cambia el personal de Pilo." })).toMatchObject({ code: "permiso" });
    expect(rpcErrorText({ code: "22023", message: "Esa persona no está en el personal de Pilo." }).code).toBe("no_existe");
    expect(rpcErrorText({ code: "XX000", message: "boom" })).toEqual({ code: "otro", text: "boom" });
  });
});

describe("fechas", () => {
  it("dayLabel", () => {
    expect(dayLabel(null)).toBe("—");
    expect(dayLabel("no es fecha")).toBe("—");
    expect(dayLabel("2026-09-28T15:00:00Z")).toMatch(/^28 sept 2026$/);
  });
  it("lastSeenLabel", () => {
    const now = Date.parse("2026-10-14T12:00:00Z");
    expect(lastSeenLabel(null, now)).toBe("Nunca");
    expect(lastSeenLabel("2026-10-14T11:59:30Z", now)).toBe("hace un momento");
    expect(lastSeenLabel("2026-10-14T11:15:00Z", now)).toBe("hace 45 min");
    expect(lastSeenLabel("2026-10-14T09:00:00Z", now)).toBe("hace 3 h");
    expect(lastSeenLabel("2026-10-12T12:00:00Z", now)).toBe("hace 2 d");
    expect(lastSeenLabel("2026-07-01T12:00:00Z", now)).toMatch(/2026/);
  });
});

describe("correo exacto para dar rol a una cuenta", () => {
  it("normaliza a minúsculas y sin bordes", () => {
    expect(normalizeEmail("  Ana@UDES.edu.co ")).toBe("ana@udes.edu.co");
  });
  it("escapa los comodines de ilike", () => {
    expect(escapeLike("a_b%c\\d@x.co")).toBe("a\\_b\\%c\\\\d@x.co");
    expect(escapeLike("ana@udes.edu.co")).toBe("ana@udes.edu.co");
  });
  it("un comodín no iguala a otra cuenta", () => {
    expect(sameEmail("ana.perez@udes.edu.co", "ana_perez@udes.edu.co")).toBe(false);
    expect(sameEmail("ANA@udes.edu.co", " ana@udes.edu.co")).toBe(true);
    expect(sameEmail(null, "")).toBe(false);
  });
});
