import { describe, expect, it } from "vitest";
import { SIN_DOCENTE, asistenciaCsv, boletin, boletinCsv, conteo, corteVigente, enRiesgo, hora, rangoDe, sesionesDelDia, siguienteMarca, todosPresentes } from "./docente";
import type { DocenteData, Estudiante, NotasEstudiante } from "./docente";

const N = (id: string, p1: number | null, p2: number | null, p3: number | null = null): NotasEstudiante => ({ id, p1, p2, p3 });

/* Un proveedor falso, como el que enchufará el backend el día que exista. */
const falso: DocenteData = {
  ...SIN_DOCENTE,
  grupos: async () => ({ ok: true, data: [{ id: "g1", materia: "Cálculo II", grupo: "A1", estudiantes: 4 }] }),
  notas: async () => ({ ok: true, data: [N("a", 4.5, 4), N("b", 3, 2.5), N("c", 2, 1.5), N("d", 3.8, null)] }),
};

describe("el proveedor por defecto", () => {
  it("responde «no disponible» a todo y no inventa nada", async () => {
    for (const r of [await SIN_DOCENTE.grupos(), await SIN_DOCENTE.horario(), await SIN_DOCENTE.lista("x"), await SIN_DOCENTE.notas("x"), await SIN_DOCENTE.faltas("x"), await SIN_DOCENTE.guardarAsistencia({ grupo: "x", fecha: "2026-10-09", marcas: {} }), await SIN_DOCENTE.enviarMensaje("x", "hola")]) {
      expect(r).toEqual({ ok: false, razon: "no_disponible" });
    }
  });

  it("un proveedor falso se enchufa sin tocar la lógica", async () => {
    const g = await falso.grupos();
    expect(g.ok && g.data[0].materia).toBe("Cálculo II");
    const n = await falso.notas("g1");
    expect(n.ok && boletin(n.data, "p2").conNota).toBe(3);
  });
});

describe("los rangos", () => {
  it("reparte en cuatro", () => {
    expect([0, 1.9, 1.99, 2, 2.9, 3, 3.95, 4, 5].map(rangoDe)).toEqual([0, 0, 0, 1, 1, 2, 2, 3, 3]);
  });
});

describe("el boletín", () => {
  const notas = [N("a", 4.5, 4), N("b", 3, 2.5), N("c", 2, 1.5), N("d", 3.8, null)];

  it("calcula promedio, % que aprueba, reparto y quiénes están por debajo", () => {
    const b = boletin(notas, "p2");
    expect(b.total).toBe(4);
    expect(b.conNota).toBe(3);
    expect(b.promedio).toBe(2.67);
    expect(b.aprueba).toBe(33.3);
    expect(b.reparto).toEqual([1, 1, 0, 1]);
    expect(b.debajo).toEqual([
      { id: "c", nota: 1.5, antes: 2 },
      { id: "b", nota: 2.5, antes: 3 },
    ]);
  });

  it("3,0 aprueba y 2,99 no", () => {
    const b = boletin([N("a", 3, null), N("b", 2.99, null)], "p1");
    expect(b.aprueba).toBe(50);
    expect(b.debajo.map((x) => x.id)).toEqual(["b"]);
  });

  it("un corte sin notas no inventa promedio", () => {
    const b = boletin(notas, "p3");
    expect(b).toMatchObject({ conNota: 0, promedio: null, aprueba: null, reparto: [0, 0, 0, 0], debajo: [] });
  });

  it("ignora notas fuera de 0 a 5", () => {
    expect(boletin([N("a", 7, null), N("b", Number.NaN, null)], "p1").conNota).toBe(0);
  });

  it("el corte vigente es el último con notas", () => {
    expect(corteVigente(notas)).toBe("p2");
    expect(corteVigente([N("a", null, null)])).toBe("p1");
    expect(corteVigente([N("a", 3, 3, 3)])).toBe("p3");
  });

  it("se exporta a CSV con coma decimal y sin fórmulas", () => {
    const lista: Estudiante[] = [{ id: "a", nombre: "Ana Pérez" }, { id: "b", nombre: "=SUMA(A1)" }];
    const csv = boletinCsv(lista, notas, "Cálculo II · A1");
    expect(csv).toContain("Ana Pérez;4,5;4");
    expect(csv).toContain("'=SUMA(A1)");
    expect(csv.startsWith("﻿Grupo;Estudiante;P1;P2;P3")).toBe(true);
  });
});

describe("estudiantes en riesgo", () => {
  it("junta nota baja en el último corte e inasistencias", () => {
    const r = enRiesgo("A1", [N("a", 4, 4), N("b", 3, 2.5), N("c", 2, 1.5)], { a: 5, b: 1, c: 4 });
    expect(r.map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(r.find((x) => x.id === "c")?.motivos).toEqual([
      { tipo: "nota", corte: "p2", nota: 1.5 },
      { tipo: "faltas", n: 4 },
    ]);
    expect(r.find((x) => x.id === "a")?.motivos).toEqual([{ tipo: "faltas", n: 5 }]);
    expect(r.find((x) => x.id === "b")?.motivos).toEqual([{ tipo: "nota", corte: "p2", nota: 2.5 }]);
  });

  it("3 inasistencias y nota de 3,0 no es riesgo", () => {
    expect(enRiesgo("A1", [N("a", 3, 3)], { a: 3 })).toEqual([]);
  });
});

describe("la asistencia", () => {
  const ids = ["a", "b", "c", "d", "e"];

  it("cuenta presentes, ausentes, tarde o excusa y sin marcar", () => {
    expect(conteo(ids, { a: "P", b: "A", c: "T", d: "E" })).toEqual({ presentes: 1, ausentes: 1, tardeOExcusa: 2, sinMarcar: 1 });
  });

  it("cada toque pasa al siguiente estado y da la vuelta", () => {
    let m: ReturnType<typeof siguienteMarca> = "";
    const vistos = [] as string[];
    for (let i = 0; i < 5; i++) {
      m = siguienteMarca(m);
      vistos.push(m);
    }
    expect(vistos).toEqual(["P", "A", "T", "E", ""]);
  });

  it("marca a todos presentes", () => {
    expect(conteo(ids, todosPresentes(ids)).presentes).toBe(5);
  });

  it("se exporta a CSV con los nombres de la lista", () => {
    const csv = asistenciaCsv({ grupo: "A1", fecha: "2026-10-09", marcas: { a: "P", b: "A" } }, [{ id: "a", nombre: "Ana, M." }, { id: "b", nombre: "Beto" }, { id: "c", nombre: "Cata" }]);
    expect(csv).toContain('2026-10-09;A1;Ana, M.;Presente');
    expect(csv).toContain("Beto;Ausente");
    expect(csv).toContain("Cata;Sin marcar");
  });
});

describe("el horario", () => {
  it("ordena las sesiones de un día y dice la hora", () => {
    const s = [
      { dia: 1, desde: 9, hasta: 11, materia: "B", grupo: "1", salon: "x" },
      { dia: 1, desde: 7.5, hasta: 9, materia: "A", grupo: "1", salon: "x" },
      { dia: 2, desde: 8, hasta: 10, materia: "C", grupo: "1", salon: "x" },
    ];
    expect(sesionesDelDia(s, 1).map((x) => x.materia)).toEqual(["A", "B"]);
    expect(hora(7.5)).toBe("7:30");
    expect(hora(14)).toBe("14:00");
  });
});
