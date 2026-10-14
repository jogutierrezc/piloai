import { describe, expect, it } from "vitest";
import { U_VISTAS } from "../routes";
import { entregasPorDia, materiasEnCurso, periodoLegible, semanasDelMes, vinculos } from "./datos";
import { hubDe, proximamente, puedeVer, tieneGemini, vistaInfo, vistasDe } from "./vistas";
import { LINK_KEY as MOODLE_KEY } from "../clases/logic";
import { LINK_KEY as GENESIS_KEY } from "../notas/logic";
import type { LinkStore } from "../notas/logic";

const store = (entries: Record<string, string> = {}): LinkStore => ({
  getItem: (k) => entries[k] ?? null,
  setItem: (k, v) => void (entries[k] = v),
  removeItem: (k) => void delete entries[k],
});

describe("qué ve cada rol", () => {
  it("el estudiante: clases presenciales y virtuales, notas y calendario", () => {
    expect(vistasDe("estudiante")).toEqual(["presenciales", "virtuales", "notas", "calendario"]);
    expect(tieneGemini("estudiante")).toBe(true);
  });

  it("el profesor: grupos, evaluación y comunicación", () => {
    expect(vistasDe("profesor")).toEqual(["grupos", "gruposv", "horario", "boletin", "asistencia", "riesgo", "mensaje", "calendario"]);
    expect(tieneGemini("profesor")).toBe(true);
  });

  it("el administrativo: dependencia, calendario y avisos; sin Gemini", () => {
    expect(vistasDe("administrativo")).toEqual(["dependencia", "calendario", "avisos"]);
    expect(tieneGemini("administrativo")).toBe(false);
  });

  it("sin rol no hay nada, y una dirección de otro rol no se abre", () => {
    expect(hubDe(null)).toEqual([]);
    expect(puedeVer("estudiante", "boletin")).toBe(false);
    expect(puedeVer("profesor", "notas")).toBe(false);
    expect(puedeVer("profesor", "boletin")).toBe(true);
  });

  it("toda vista de las rutas tiene su ficha y alguien que la vea", () => {
    const vistas = new Set([...vistasDe("estudiante"), ...vistasDe("profesor"), ...vistasDe("administrativo")]);
    for (const v of U_VISTAS) {
      expect(vistaInfo(v).id).toBe(v);
      expect(vistas.has(v)).toBe(true);
    }
  });

  it("las que no tienen de dónde leer explican qué serán y por qué", () => {
    for (const v of U_VISTAS) {
      const info = vistaInfo(v);
      if (info.real) continue;
      const p = proximamente(v);
      expect(p.que.length).toBeGreaterThan(10);
      expect(p.porque.length).toBeGreaterThan(10);
    }
  });

  it("de dónde sale cada vista", () => {
    expect(vistaInfo("virtuales")).toMatchObject({ fuente: "Moodle", necesita: "moodle", real: true });
    expect(vistaInfo("notas")).toMatchObject({ fuente: "Génesis", necesita: "genesis", real: true });
    expect(vistaInfo("calendario")).toMatchObject({ fuente: "UDES", necesita: "ninguna" });
    expect(vistaInfo("gruposv").real).toBe(true);
    expect(vistaInfo("boletin").real).toBe(false);
  });
});

describe("las conexiones de la persona", () => {
  const moodle = JSON.stringify({ v: 1, owner: "u1", token: "a".repeat(32), site: { name: "Moodle", user: "ana" } });
  const permit = `v1.${"A".repeat(60)}.${"B".repeat(43)}`;
  const genesis = JSON.stringify({ v: 1, owner: "u1", permit, expires: 4_000_000_000, head: {}, portal: { id: "bga", name: "Bucaramanga" } });

  it("lee Moodle y Génesis de la cuenta", () => {
    const s = { moodle: store({ [MOODLE_KEY]: moodle }), genesis: store({ [GENESIS_KEY]: genesis }) };
    expect(vinculos("u1", 1_000, s)).toEqual({ moodle: true, genesis: true });
  });

  it("el de otra cuenta no cuenta", () => {
    const s = { moodle: store({ [MOODLE_KEY]: moodle }), genesis: store({ [GENESIS_KEY]: genesis }) };
    expect(vinculos("u2", 1_000, s)).toEqual({ moodle: false, genesis: false });
  });

  it("sin cuenta, nada", () => {
    expect(vinculos(null)).toEqual({ moodle: false, genesis: false });
  });
});

describe("las materias en curso", () => {
  const c = (code: string, def: number | null, approved = false) => ({ code, name: code === "MAT" ? "CÁLCULO II" : "Física", credits: 3, def, approved, homologated: false, group: "A1", min: null });
  const p = (id: string, courses: ReturnType<typeof c>[]) => ({ id, average: null, accumulated: null, credits: 0, creditsApproved: 0, totalApproved: 0, courses });

  it("toma las del periodo vigente sin definitiva", () => {
    const h = { periods: [p("20251", [c("OLD", 4, true)]), p("20252", [c("MAT", 0), c("FIS", null), c("YA", 3.5, true)])] };
    const r = materiasEnCurso(h, "20252");
    expect(r.periodo).toBe("20252");
    expect(r.materias.map((m) => m.name)).toEqual(["Cálculo II", "Física"]);
  });

  it("sin histórico no hay nada", () => {
    expect(materiasEnCurso({ periods: [] })).toEqual({ periodo: "", materias: [] });
  });

  it("dice el periodo legible", () => {
    expect(periodoLegible("20252")).toBe("2025-2");
    expect(periodoLegible("2025A")).toBe("2025-A");
  });
});

describe("el calendario", () => {
  it("octubre de 2026 empieza en jueves y marca el día de hoy", () => {
    const sem = semanasDelMes(2026, 9, new Date(2026, 9, 9));
    expect(sem[0].map((d) => d.dia)).toEqual([0, 0, 0, 1, 2, 3, 4]);
    expect(sem.flat().filter((d) => d.hoy).map((d) => d.dia)).toEqual([9]);
    expect(sem.every((w) => w.length === 7)).toBe(true);
    expect(sem.flat().filter((d) => d.dia).length).toBe(31);
  });

  it("otro mes no marca el día de hoy", () => {
    expect(semanasDelMes(2026, 10, new Date(2026, 9, 9)).flat().some((d) => d.hoy)).toBe(false);
  });

  it("cuenta las entregas por día del mes", () => {
    const due = (d: number) => Math.floor(new Date(2026, 9, d, 12).getTime() / 1000);
    const m = entregasPorDia([{ due: due(3) }, { due: due(3) }, { due: due(20) }, { due: Math.floor(new Date(2026, 10, 2).getTime() / 1000) }], 2026, 9);
    expect(m.get(3)).toBe(2);
    expect(m.get(20)).toBe(1);
    expect(m.size).toBe(2);
  });
});
