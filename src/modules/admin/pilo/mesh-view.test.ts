import { describe, expect, it } from "vitest";
import { chainOf, dirtySections, edgeKey, indexMesh, joinNames, layoutPdi, parseSection, routeOf, searchNodes } from "./mesh-view";
import type { ViewNode } from "./mesh-view";
import { normalizeSettings } from "./store";

const node = (id: string, type: string, code = "", label = id, source = "pdi"): ViewNode => ({ id, source, type, code, label, path: "" });

// P1 › AE1 › (LA1, LA2); P1 › AE2 (sin líneas); PR1 cuelga de LA1 y LA2; PR2 de AE2.
const mesh = indexMesh({
  nodes: [
    node("fuente:pdi", "fuente", "", "Plan"),
    node("p1", "pilar", "P1", "Personalización"),
    node("a1", "area", "AE1", "Docencia"),
    node("a2", "area", "AE2", "Investigación"),
    node("l1", "linea", "LA1", "Currículo"),
    node("l2", "linea", "LA2", "Evaluación"),
    node("pr1", "proyecto", "PR1", "Aula abierta"),
    node("pr2", "proyecto", "PR2", "Semilleros"),
    node("pr12", "proyecto", "PR12", "Otro"),
  ],
  edges: [
    { from: "fuente:pdi", to: "p1", rel: "contiene" },
    { from: "p1", to: "a1", rel: "contiene" },
    { from: "p1", to: "a2", rel: "contiene" },
    { from: "a1", to: "l1", rel: "contiene" },
    { from: "a1", to: "l2", rel: "contiene" },
    { from: "l1", to: "pr1", rel: "contiene" },
    { from: "l2", to: "pr1", rel: "contiene" },
    { from: "a2", to: "pr2", rel: "contiene" },
    { from: "a2", to: "fantasma", rel: "contiene" },
  ],
});

describe("secciones", () => {
  it("lee la sección de la dirección y vuelve a la primera si no la conoce", () => {
    expect(parseSection("memoria")).toBe("memoria");
    expect(parseSection(" MEMORIA ")).toBe("memoria");
    expect(parseSection("nada")).toBe("conexion");
    expect(parseSection(null)).toBe("conexion");
  });

  it("dice qué secciones tienen cambios sin guardar", () => {
    const saved = normalizeSettings({});
    expect(dirtySections(saved, saved)).toEqual([]);
    const now = {
      ...saved,
      voice_rate: 1.2,
      functions: { ...saved.functions, preguntar: !saved.functions.preguntar },
      portals: { ...saved.portals, cifras: { ...saved.portals.cifras, aud: "publico" as const } },
      daily_limit: saved.daily_limit + 1,
    };
    expect(dirtySections(now, saved)).toEqual(["voz", "portales", "pregunta", "uso"]);
    expect(dirtySections({ ...saved, enabled: !saved.enabled }, saved)).toEqual([]);
  });

  it("une nombres en español", () => {
    expect(joinNames(["Voz"])).toBe("Voz");
    expect(joinNames(["Voz", "Memoria"])).toBe("Voz y Memoria");
    expect(joinNames(["A", "B", "C"])).toBe("A, B y C");
  });
});

describe("malla indexada", () => {
  it("ignora relaciones hacia nodos que no llegaron", () => {
    expect(mesh.kids.get("a2")).toEqual(["pr2"]);
  });

  it("arma la ruta por el primer padre", () => {
    expect(routeOf(mesh, "pr1").map((n) => n.id)).toEqual(["fuente:pdi", "p1", "a1", "l1", "pr1"]);
  });

  it("la cadena sube por todos los padres y baja por todos los hijos", () => {
    const c = chainOf(mesh, "pr1");
    expect([...c.up].sort()).toEqual(["a1", "fuente:pdi", "l1", "l2", "p1"]);
    expect(c.nodes.has("a2")).toBe(false);
    expect(c.edges.has(edgeKey("l2", "pr1"))).toBe(true);
    const down = chainOf(mesh, "a1");
    expect(down.nodes.has("pr1")).toBe(true);
    expect(down.nodes.has("pr2")).toBe(false);
  });
});

describe("columnas del Plan", () => {
  const layout = layoutPdi(mesh, "fuente:pdi", 20);
  const y = (id: string) => layout.byId.get(id)!.y;

  it("las líneas son las hojas y el área va a su promedio", () => {
    expect(y("l1")).toBe(0);
    expect(y("l2")).toBe(20);
    expect(y("a1")).toBe(10);
  });

  it("un área sin líneas recibe su propia fila", () => {
    expect(y("a2")).toBe(40);
    expect(y("p1")).toBe(25);
  });

  it("los proyectos van al promedio de sus padres sin pisarse", () => {
    expect(y("pr1")).toBe(10);
    expect(y("pr2")).toBe(40);
    expect(y("pr12")).toBeGreaterThanOrEqual(60);
    expect(layout.columns.proyecto).toEqual(["pr1", "pr2", "pr12"]);
  });
});

describe("búsqueda", () => {
  it("el código exacto gana al que solo empieza igual", () => {
    expect(searchNodes(mesh.nodes, "pr1").map((n) => n.id)).toEqual(["pr1", "pr12"]);
    expect(searchNodes(mesh.nodes, "PR 1")[0].id).toBe("pr1");
  });

  it("busca por nombre sin tildes y no devuelve raíces", () => {
    expect(searchNodes(mesh.nodes, "investigacion").map((n) => n.id)).toEqual(["a2"]);
    expect(searchNodes(mesh.nodes, "plan")).toEqual([]);
    expect(searchNodes(mesh.nodes, "   ")).toEqual([]);
  });
});
