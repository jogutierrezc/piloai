import { describe, expect, it } from "vitest";
import { describeNode, focusMesh, isStructural, mapContext, pathTo } from "./logic";
import type { Mesh, MeshNode } from "./logic";

const n = (id: string, type: string, code: string, label: string): MeshNode => ({ id, source: "pdi", type, code, label, path: "/x" });

const mesh: Mesh = {
  nodes: [
    n("fuente:pdi", "fuente", "", "Plan de Desarrollo Institucional 2024-2028"),
    n("pdi:pilar:personalizacion", "pilar", "P1", "Personalización"),
    n("pdi:area:a1", "area", "AE1", "Acompañamiento estudiantil"),
    n("pdi:linea:l1", "linea", "LA1", "Permanencia"),
    n("pdi:linea:l2", "linea", "LA2", "Bienestar"),
    n("pdi:proyecto:r1", "proyecto", "PR1", "Tutorías"),
  ],
  edges: [
    { from: "fuente:pdi", to: "pdi:pilar:personalizacion", rel: "contiene" },
    { from: "pdi:pilar:personalizacion", to: "pdi:area:a1", rel: "contiene" },
    { from: "pdi:area:a1", to: "pdi:linea:l1", rel: "contiene" },
    { from: "pdi:area:a1", to: "pdi:linea:l2", rel: "contiene" },
    { from: "pdi:linea:l1", to: "pdi:proyecto:r1", rel: "contiene" },
    { from: "pdi:linea:l2", to: "pdi:proyecto:r1", rel: "contiene" },
  ],
};

describe("la malla de la memoria", () => {
  it("reconoce las preguntas de estructura", () => {
    expect(isStructural("¿Qué áreas tiene el pilar Personalización?")).toBe(true);
    expect(isStructural("¿A qué pilar pertenece el proyecto de tutorías?")).toBe(true);
    expect(isStructural("¿Cuántos proyectos hay?")).toBe(true);
    expect(isStructural("¿Cuál es la estructura del PDI?")).toBe(true);
    expect(isStructural("¿Cuántos estudiantes hay por sede?")).toBe(false);
  });

  it("sube por la ruta hasta la raíz", () => {
    expect(pathTo(mesh, "pdi:proyecto:r1").map((x) => x.code || x.id)).toEqual(["fuente:pdi", "P1", "AE1", "LA1", "PR1"]);
  });

  it("describe dónde queda un nodo y qué contiene", () => {
    expect(describeNode(mesh, "pdi:area:a1")).toBe(
      "«AE1 · Acompañamiento estudiantil» es un área estratégica del pilar P1 · Personalización [1]. Contiene 2 líneas de acción: LA1 · Permanencia y LA2 · Bienestar.",
    );
    expect(describeNode(mesh, "pdi:proyecto:r1")).toBe(
      "«PR1 · Tutorías» es un proyecto de la línea de acción LA1 · Permanencia, del área estratégica AE1 · Acompañamiento estudiantil, del pilar P1 · Personalización [1]. También se vincula con LA2 · Bienestar.",
    );
    expect(describeNode(mesh, "fuente:pdi")).toBe("Plan de Desarrollo Institucional 2024-2028 [1]. Tiene 1 pilar: P1 · Personalización.");
  });

  it("recorta la malla para dibujarla y da la ruta a la IA", () => {
    const f = focusMesh(mesh, "pdi:area:a1");
    expect(f.nodes.map((x) => x.id).sort()).toEqual(["fuente:pdi", "pdi:area:a1", "pdi:linea:l1", "pdi:linea:l2", "pdi:pilar:personalizacion"].sort());
    expect(mapContext(mesh, ["pdi:linea:l2"])).toBe("[1] P1 · Personalización › AE1 · Acompañamiento estudiantil › LA2 · Bienestar");
  });
});
