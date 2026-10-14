/* =============================================================================
   Inicio de la administración · pruebas de la lógica pura.
   Qué ve cada rol, las cifras, los pendientes, el buscador y el saludo.
   ========================================================================== */

import { describe, expect, it } from "vitest";
import { STAFF_ROLES } from "../../../lib/pilo-staff";
import type { PiloStaffRole } from "../../../lib/pilo-staff";
import { buildStaffNav } from "../../../lib/staff-access";
import {
  STALE_DAYS, agoLabel, daysSince, filterEntries, firstName, fold, greetingFor, hasSearch, modulesFor, moodFor,
  pendingItems, searchableEntries, spaceStats,
} from "./launcher-logic";
import type { DocLite } from "./launcher-logic";

const NOW = Date.parse("2026-10-14T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();
const doc = (over: Partial<DocLite> = {}): DocLite => ({
  space: "planeacion", status: "entendido", passages: 10, active: true, created_at: daysAgo(2), updated_at: daysAgo(2), ...over,
});
const ids = (role: PiloStaffRole | null) => modulesFor(role).map((m) => `${m.kind}:${m.id}`);

describe("modulesFor · qué ve cada rol", () => {
  it("sin rol no hay nada", () => {
    expect(modulesFor(null)).toEqual([]);
  });
  it("docencia: solo Pilo Enseñanza, sin herramientas de administración", () => {
    expect(ids("docencia")).toEqual(["space:ensenanza"]);
  });
  it("institucional: solo Pilo Universidad", () => {
    expect(ids("institucional")).toEqual(["space:planeacion"]);
  });
  it("ambos: los dos espacios, sin herramientas", () => {
    expect(ids("ambos")).toEqual(["space:planeacion", "space:ensenanza"]);
  });
  it("admin: los dos espacios y las cinco herramientas", () => {
    expect(ids("admin")).toEqual([
      "space:planeacion", "space:ensenanza", "tool:conexion", "tool:portales", "tool:usuarios", "tool:emergencias", "tool:personal",
    ]);
  });
  it("nunca muestra una ruta que el menú del rol no tenga", () => {
    for (const role of STAFF_ROLES) {
      const menu = new Set(buildStaffNav(role).map((e) => e.to));
      for (const m of modulesFor(role)) {
        if (m.kind === "tool") expect(menu.has(m.to)).toBe(true);
        else expect(m.links.every((l) => l.to.startsWith(m.to.split("?")[0]))).toBe(true);
      }
    }
  });
});

describe("buscador", () => {
  it("solo aparece con muchas entradas: el admin sí, los demás no", () => {
    expect(hasSearch("admin")).toBe(true);
    expect(hasSearch("ambos")).toBe(false);
    expect(hasSearch("docencia")).toBe(false);
    expect(hasSearch(null)).toBe(false);
  });
  it("no incluye el propio inicio", () => {
    expect(searchableEntries("admin").some((e) => e.id === "inicio")).toBe(false);
  });
  it("ignora tildes y mayúsculas, y exige todas las palabras", () => {
    const all = searchableEntries("admin");
    expect(fold("Enseñanza")).toBe("ensenanza");
    expect(filterEntries(all, "ENSENANZA").every((e) => e.space === "ensenanza")).toBe(true);
    expect(filterEntries(all, "docu ensen").map((e) => e.id)).toEqual(["documentos-ensenanza"]);
    expect(filterEntries(all, "zzz")).toEqual([]);
    expect(filterEntries(all, "  ")).toHaveLength(all.length);
  });
});

describe("spaceStats", () => {
  it("cuenta documentos, pasajes, errores y el último cargado de ese espacio", () => {
    const docs = [
      doc({ passages: 5, created_at: daysAgo(10) }),
      doc({ passages: 7, created_at: daysAgo(3), status: "error" }),
      doc({ space: "ensenanza", passages: 100 }),
    ];
    expect(spaceStats(docs, "planeacion")).toEqual({ documents: 2, passages: 12, lastLoadedAt: daysAgo(3), errors: 1 });
  });
  it("un espacio vacío no inventa nada", () => {
    expect(spaceStats([], "ensenanza")).toEqual({ documents: 0, passages: 0, lastLoadedAt: null, errors: 0 });
  });
});

describe("tiempo", () => {
  it("daysSince y agoLabel", () => {
    expect(daysSince(daysAgo(5), NOW)).toBe(5);
    expect(daysSince(null, NOW)).toBeNull();
    expect(daysSince("basura", NOW)).toBeNull();
    expect(daysSince(new Date(NOW + 1e9).toISOString(), NOW)).toBe(0);
    expect(agoLabel(daysAgo(0), NOW)).toBe("hoy");
    expect(agoLabel(daysAgo(1), NOW)).toBe("ayer");
    expect(agoLabel(daysAgo(12), NOW)).toBe("hace 12 días");
    expect(agoLabel(daysAgo(95), NOW)).toBe("hace 3 meses");
    expect(agoLabel(daysAgo(400), NOW)).toBe("hace 1 año");
    expect(agoLabel(null, NOW)).toBe("sin cargas");
  });
});

describe("pendingItems", () => {
  it("todo al día: no hay pendientes", () => {
    expect(pendingItems([doc(), doc()], "institucional", NOW)).toEqual([]);
  });
  it("sin fichas tampoco inventa pendientes (ni «memoria vieja»)", () => {
    expect(pendingItems([], "admin", NOW)).toEqual([]);
  });
  it("detecta error, sin entender y escaneado, con singular y plural", () => {
    const items = pendingItems(
      [doc({ status: "error" }), doc({ status: "leido" }), doc({ status: "en_pasajes" }), doc({ status: "escaneado" })],
      "institucional",
      NOW,
    );
    expect(items.map((i) => [i.kind, i.count])).toEqual([["error", 1], ["sin_entender", 2], ["escaneado", 1]]);
    expect(items[0].label).toBe("1 documento con error");
    expect(items[1].label).toBe("2 documentos sin entender");
  });
  it("un documento inactivo no cuenta como «sin entender»", () => {
    expect(pendingItems([doc({ status: "leido", active: false })], "institucional", NOW)).toEqual([]);
  });
  it("memoria vieja: solo pasado el umbral", () => {
    expect(pendingItems([doc({ created_at: daysAgo(STALE_DAYS) })], "institucional", NOW)).toEqual([]);
    const old = pendingItems([doc({ created_at: daysAgo(STALE_DAYS + 1) })], "institucional", NOW);
    expect(old).toHaveLength(1);
    expect(old[0].kind).toBe("memoria_vieja");
    expect(old[0].label).toContain("hace 31 días");
  });
  it("solo mira los espacios del rol", () => {
    const docs = [doc({ space: "ensenanza", status: "error" })];
    expect(pendingItems(docs, "institucional", NOW)).toEqual([]);
    expect(pendingItems(docs, "docencia", NOW)).toHaveLength(1);
  });
  it("con dos espacios el texto nombra a cuál pertenece; con uno no", () => {
    const docs = [doc({ status: "error", space: "ensenanza" })];
    expect(pendingItems(docs, "ambos", NOW)[0].label).toBe("1 documento con error en Pilo Enseñanza");
    expect(pendingItems(docs, "docencia", NOW)[0].label).toBe("1 documento con error");
  });
  it("cada pendiente lleva a la memoria de su espacio", () => {
    expect(pendingItems([doc({ status: "error", space: "ensenanza" })], "admin", NOW)[0].to).toBe("/admin/mr-pilo-ensenanza?seccion=memoria");
  });
});

describe("saludo y ánimo de Pilo", () => {
  it("saluda según la hora", () => {
    expect(greetingFor(3)).toBe("Buenas noches");
    expect(greetingFor(9)).toBe("Buenos días");
    expect(greetingFor(15)).toBe("Buenas tardes");
    expect(greetingFor(21)).toBe("Buenas noches");
  });
  it("firstName: nombre, correo y vacío", () => {
    expect(firstName("maría fernanda ruiz")).toBe("María");
    expect(firstName("ana.perez@udes.edu.co")).toBe("Ana");
    expect(firstName("")).toBe("");
  });
  it("el ánimo sigue a lo pendiente", () => {
    const err = pendingItems([doc({ status: "error" })], "institucional", NOW);
    const soft = pendingItems([doc({ status: "leido" })], "institucional", NOW);
    expect(moodFor(err, false)).toBe("cuidado");
    expect(moodFor(soft, false)).toBe("bien");
    expect(moodFor([], false)).toBe("feliz");
    expect(moodFor(err, true)).toBe("piensa");
  });
});
