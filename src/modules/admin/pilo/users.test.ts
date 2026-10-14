import { describe, expect, it } from "vitest";
import { STATE_LABEL, campusEditable, countByRol, deleteConfirmed, filterUsers, parseUserRow, rolesFor, userState } from "./users";
import type { PiloUserRow } from "./users";

const row = (over: Partial<PiloUserRow> = {}): PiloUserRow => ({
  id: "u1",
  username: "laura.gomez",
  full_name: "Laura Gómez",
  email: "laura.gomez@mail.udes.edu.co",
  rol: "estudiante",
  campus: "bucaramanga",
  status: "activa",
  confirmed: true,
  created_at: "2026-10-01T10:00:00Z",
  last_seen_at: null,
  ...over,
});

const ROWS = [
  row(),
  row({ id: "u2", username: "c.rojas", full_name: "Carlos Rojas", email: "c.rojas@mail.udes.edu.co", rol: "profesor", campus: "cucuta" }),
  row({ id: "u3", username: "m.diaz", full_name: "Marta Díaz", email: "m.diaz@valledupar.udes.edu.co", rol: "administrativo", campus: "valledupar", confirmed: false }),
  row({ id: "u4", username: "j.perez", full_name: "Julián Pérez", email: "j.perez@udes.edu.co", rol: "profesor", campus: "bogota", status: "suspendida" }),
];

describe("la tabla de Usuarios de Pilo", () => {
  it("una fila de pilo_users_admin() se lee; lo que no se entiende se descarta", () => {
    expect(parseUserRow({ id: "u1", username: "laura", full_name: "Laura", email: "l@mail.udes.edu.co", rol: "estudiante", campus: "bogota", status: "activa", confirmed: true, created_at: "2026-10-01", last_seen_at: null })).toMatchObject({
      username: "laura",
      campus: "bogota",
      confirmed: true,
      last_seen_at: null,
    });
    expect(parseUserRow({ id: "u1", username: "laura", rol: "estudiante", campus: "marte", status: "rara", confirmed: "sí" })).toMatchObject({ campus: "", status: "activa", confirmed: false });
    for (const bad of [null, {}, { id: "u1", username: "x", rol: "rector" }, { username: "x", rol: "profesor" }]) expect(parseUserRow(bad)).toBeNull();
  });

  it("el estado: la suspensión manda; después, si no ha confirmado el correo", () => {
    expect(userState(row())).toBe("activa");
    expect(userState(row({ confirmed: false }))).toBe("sin_confirmar");
    expect(userState(row({ status: "suspendida" }))).toBe("suspendida");
    expect(userState(row({ status: "suspendida", confirmed: false }))).toBe("suspendida");
    // Cada estado lleva su palabra y su tono: nunca solo color.
    expect(Object.values(STATE_LABEL).map((s) => s.label)).toEqual(["Activa", "Sin confirmar", "Suspendida"]);
  });

  it("filtra por perfil y busca por usuario, nombre, correo o sede", () => {
    expect(filterUsers(ROWS, "", "")).toHaveLength(4);
    expect(filterUsers(ROWS, "profesor", "").map((r) => r.id)).toEqual(["u2", "u4"]);
    expect(filterUsers(ROWS, "", "diaz").map((r) => r.id)).toEqual(["u3"]);
    expect(filterUsers(ROWS, "", "CUCUTA").map((r) => r.id)).toEqual(["u2"]);
    expect(filterUsers(ROWS, "", "bogotá").map((r) => r.id)).toEqual(["u4"]);
    expect(filterUsers(ROWS, "", "mail.udes").map((r) => r.id)).toEqual(["u1", "u2"]);
    expect(filterUsers(ROWS, "profesor", "julian perez").map((r) => r.id)).toEqual(["u4"]);
    expect(filterUsers(ROWS, "estudiante", "rojas")).toEqual([]);
  });

  it("cuenta por perfil", () => {
    expect(countByRol(ROWS)).toEqual({ estudiante: 1, profesor: 2, administrativo: 1 });
    expect(countByRol([])).toEqual({ estudiante: 0, profesor: 0, administrativo: 0 });
  });

  it("el perfil solo cambia a uno que su correo admita", () => {
    expect(rolesFor("x@mail.udes.edu.co")).toEqual(["estudiante", "profesor"]);
    expect(rolesFor("x@udes.edu.co")).toEqual(["administrativo", "profesor"]);
    expect(rolesFor("x@cucuta.udes.edu.co")).toEqual(["administrativo", "profesor"]);
    expect(rolesFor("x@gmail.com")).toEqual([]);
  });

  it("la sede solo cambia si el correo no la fija", () => {
    expect(campusEditable("x@mail.udes.edu.co")).toBe(true);
    expect(campusEditable("x@udes.edu.co")).toBe(true);
    expect(campusEditable("x@valledupar.udes.edu.co")).toBe(false);
  });

  it("eliminar pide escribir el usuario tal cual", () => {
    expect(deleteConfirmed("laura.gomez", "laura.gomez")).toBe(true);
    expect(deleteConfirmed("  Laura.Gomez ", "laura.gomez")).toBe(true);
    expect(deleteConfirmed("laura", "laura.gomez")).toBe(false);
    expect(deleteConfirmed("", "laura.gomez")).toBe(false);
    expect(deleteConfirmed("", "")).toBe(false);
  });
});
