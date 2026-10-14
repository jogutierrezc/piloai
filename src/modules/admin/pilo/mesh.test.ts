import { describe, expect, it } from "vitest";
import { meshFromRows, pdiMesh } from "./mesh";
import { describeNode } from "../../../components/pilo/ai/logic";
import type { Mesh } from "../../../components/pilo/ai/logic";

const pillar = (id: string, slug: string, name: string, position: number, status = "publicado") =>
  ({ id, slug, name, numeral: String(position), position, status, accent_slot: position, focus: "", progress: { progress: 50, total: 3 } }) as never;
const area = (id: string, pillar_id: string, name: string, lines: [string, string][]) =>
  ({ id, pillar_id, name, code: null, position: 1, action_lines: lines.map(([lid, lname], i) => ({ id: lid, name: lname, code: null, progress: 0, position: i })) }) as never;
const project = (id: string, name: string, pillar_id: string, action_line_id: string | null) =>
  ({ id, name, pillar_id, position: 1, owner: "", sdg_goals: [], links: [{ pillar_id, area_id: null, action_line_id }] }) as never;

describe("la malla del Plan de Desarrollo", () => {
  const m = pdiMesh(
    [pillar("p1", "personalizacion", "Personalización", 1), pillar("p9", "borrador", "Borrador", 9, "borrador")],
    [area("a1", "p1", "Acompañamiento", [["l1", "Permanencia"], ["l2", "Bienestar"]]), area("a9", "p9", "Oculta", [])],
    [project("r1", "Tutorías", "p1", "l1"), project("r2", "Presupuesto participativo", "p1", "l2")],
  );
  const mesh: Mesh = { nodes: m.nodes.map((n) => ({ ...n, source: "pdi" })), edges: m.edges };

  it("usa la numeración del Mapa numerado y deja fuera borradores y dinero", () => {
    expect(m.nodes.map((n) => `${n.id}=${n.code}`)).toEqual([
      "fuente:pdi=",
      "pdi:pilar:personalizacion=P1",
      "pdi:area:a1=AE1",
      "pdi:linea:l1=LA1",
      "pdi:linea:l2=LA2",
      "pdi:proyecto:r1=PR1",
    ]);
  });

  it("deja pasajes de la estructura con su ruta", () => {
    const line = m.rows.find((r) => r.ref === "pdi:linea:l1")!;
    expect(line.body).toContain("Ruta: P1 Personalización › AE1 Acompañamiento › LA1 Permanencia.");
    expect(line.body).toContain("Proyectos vinculados: PR1 Tutorías.");
    expect(m.rows.find((r) => r.ref === "fuente:pdi")!.body).toContain("1 pilar, 1 área estratégica, 2 líneas de acción y 1 proyecto");
    expect(describeNode(mesh, "pdi:proyecto:r1")).toContain("de la línea de acción LA1 · Permanencia, del área estratégica AE1 · Acompañamiento, del pilar P1 · Personalización");
  });
});

describe("la malla de las demás fuentes", () => {
  it("cuelga cada pasaje de su padre por el ref y da un pasaje a la raíz", () => {
    const rows = [
      { ref: "cifras:poblacional", title: "Informe Poblacional", section: "", body: "Informe de población estudiantil.", path: "/datos-abiertos/poblacional", cut: "", office: "" },
      { ref: "cifras:poblacional:mat", title: "Matriculados", section: "", body: "Matriculados: 15.870 en 2025.", path: "/datos-abiertos/poblacional", cut: "2025", office: "" },
    ];
    const m = meshFromRows("cifras", rows);
    expect(m.edges).toEqual([
      { from: "fuente:cifras", to: "cifras:poblacional", rel: "contiene" },
      { from: "cifras:poblacional", to: "cifras:poblacional:mat", rel: "contiene" },
    ]);
    expect(m.nodes.find((n) => n.id === "cifras:poblacional:mat")?.type).toBe("indicador");
    expect(m.rows[0].body).toBe("UDES en Cifras tiene 1 informe: Informe Poblacional.");
  });
});
