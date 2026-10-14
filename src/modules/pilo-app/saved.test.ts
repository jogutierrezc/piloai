import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadConversations, saveConversations, SAVED_LIMIT, storableConversations } from "../pregunta/store";
import type { Conversation } from "../pregunta/store";
import { dayLabel, loadSaved, nextLast, NO_LAST, openingId, parseLast, readLast, removeSaved, savedEntries, writeLast } from "./saved";

/** Un localStorage de mentira, con cupo: pasado de `quota` caracteres, falla como uno lleno. */
function fakeStorage(initial: Record<string, string> = {}, quota = Infinity) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k: string) => (data.has(k) ? (data.get(k) as string) : null),
    setItem: (k: string, v: string) => {
      if (String(v).length > quota) throw new Error("QuotaExceededError");
      data.set(k, String(v));
    },
    removeItem: (k: string) => void data.delete(k),
  };
}

const answered = (id: string, at: number, title = `Pregunta ${id}`): Conversation => ({
  id,
  title,
  at,
  turns: [{ id: `${id}-t`, q: title, answer: { kind: "ia", text: "Respuesta.", sources: [], trail: [] } }],
});

describe("la lista del menú", () => {
  it("junta las de los dos Pilos, la más reciente primero, con su espacio", () => {
    const list = savedEntries({ planeacion: [answered("a", 10), answered("b", 30)], ensenanza: [answered("c", 20)] });
    expect(list.map((e) => `${e.space}:${e.id}`)).toEqual(["planeacion:b", "ensenanza:c", "planeacion:a"]);
    expect(list[0]).toEqual({ space: "planeacion", id: "b", title: "Pregunta b", at: 30 });
  });

  it("no lista lo que no se puede leer: sin turnos terminados, sin id, o dañado", () => {
    const pending: Conversation = { id: "p", title: "En curso", at: 5, turns: [{ id: "t", q: "¿…?" }] };
    const broken = [null, { id: "", title: "x", at: 1, turns: [] }, { id: "z", title: "x", at: 1 }] as unknown as Conversation[];
    expect(savedEntries({ planeacion: [pending, ...broken], ensenanza: undefined })).toEqual([]);
  });

  it("una conversación sin título se nombra, y una que terminó en aviso también se lista", () => {
    const failed: Conversation = { id: "f", title: "  ", at: 7, turns: [{ id: "t", q: "¿…?", error: "No pude hablar con Pilo ahora." }] };
    expect(savedEntries({ ensenanza: [failed] })).toEqual([{ space: "ensenanza", id: "f", title: "Conversación sin título", at: 7 }]);
  });
});

describe("la fecha, en palabras", () => {
  const now = new Date(2026, 9, 2, 15, 0).getTime();

  it("hoy, ayer, hace unos días y, después, la fecha", () => {
    expect(dayLabel(new Date(2026, 9, 2, 0, 5).getTime(), now)).toBe("hoy");
    expect(dayLabel(new Date(2026, 9, 1, 23, 59).getTime(), now)).toBe("ayer");
    expect(dayLabel(new Date(2026, 8, 29, 9, 0).getTime(), now)).toBe("hace 3 días");
    expect(dayLabel(new Date(2026, 8, 20, 9, 0).getTime(), now)).toBe("20 de septiembre");
    expect(dayLabel(new Date(2025, 11, 24, 9, 0).getTime(), now)).toBe("24 de diciembre de 2025");
  });

  it("una fecha que no se entiende no rompe la lista", () => {
    expect(dayLabel(Number.NaN, now)).toBe("sin fecha");
    expect(dayLabel(0, now)).toBe("sin fecha");
    // Un reloj adelantado no dice «hace −1 días».
    expect(dayLabel(now + 86_400_000, now)).toBe("hoy");
  });
});

describe("guardar en el teléfono", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("solo se guardan los turnos terminados y las últimas conversaciones", () => {
    const many = Array.from({ length: SAVED_LIMIT + 5 }, (_, i) => answered(`c${i}`, 1000 - i));
    const half: Conversation = {
      id: "h",
      title: "A medias",
      at: 2000,
      turns: [
        { id: "t1", q: "ya", answer: { kind: "ia", text: "Sí.", sources: [], trail: [] } },
        { id: "t2", q: "en curso" },
      ],
    };
    const kept = storableConversations([half, { id: "vacia", title: "", at: 1, turns: [{ id: "t", q: "?" }] }, ...many]);
    expect(kept).toHaveLength(SAVED_LIMIT);
    expect(kept[0].turns.map((t) => t.id)).toEqual(["t1"]);
    expect(kept.some((c) => c.id === "vacia")).toBe(false);
  });

  it("cada Pilo guarda lo suyo, y lo que se guarda se vuelve a leer", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage() });
    expect(saveConversations("pilo-pregunta", [answered("u", 1)])).toBe(true);
    expect(saveConversations("pilo-ensenanza", [answered("e", 2)])).toBe(true);
    expect(loadSaved("planeacion").map((c) => c.id)).toEqual(["u"]);
    expect(loadSaved("ensenanza").map((c) => c.id)).toEqual(["e"]);
  });

  it("con el almacenamiento lleno se quedan las más recientes, en vez de no guardar nada", () => {
    const list = Array.from({ length: 8 }, (_, i) => answered(`c${i}`, 100 - i));
    const one = JSON.stringify([list[0]]).length;
    vi.stubGlobal("window", { localStorage: fakeStorage({}, one * 2 + 10) });
    expect(saveConversations("pilo-pregunta", list)).toBe(true);
    expect(loadConversations("pilo-pregunta").map((c) => c.id)).toEqual(["c0", "c1"]);
  });

  it("sin almacenamiento (modo privado, bloqueado) no falla: dice que no guardó y lee vacío", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(saveConversations("pilo-pregunta", [answered("u", 1)])).toBe(false);
    expect(loadSaved("planeacion")).toEqual([]);
    expect(readLast()).toEqual(NO_LAST);
    expect(() => writeLast({ space: "planeacion", ids: { planeacion: "u" } })).not.toThrow();
  });

  it("lo guardado dañado se lee como vacío", () => {
    vi.stubGlobal("window", { localStorage: fakeStorage({ "pilo-pregunta:conversaciones": "{no es json", "pilo-ensenanza:conversaciones": '{"a":1}' }) });
    expect(loadSaved("planeacion")).toEqual([]);
    expect(loadSaved("ensenanza")).toEqual([]);
  });

  it("borrar una conversación del otro Pilo la quita de su almacén y deja las demás", () => {
    const storage = fakeStorage({
      "pilo-ensenanza:conversaciones": JSON.stringify([answered("e1", 2), answered("e2", 1)]),
      "pilo-pregunta:conversaciones": JSON.stringify([answered("u", 3)]),
    });
    vi.stubGlobal("window", { localStorage: storage });
    expect(removeSaved("ensenanza", "e1").map((c) => c.id)).toEqual(["e2"]);
    expect(loadSaved("ensenanza").map((c) => c.id)).toEqual(["e2"]);
    expect(loadSaved("planeacion").map((c) => c.id)).toEqual(["u"]);
  });
});

describe("la última conversación abierta", () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal("window", { localStorage: storage });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("se recuerda por Pilo, y el último Pilo con que se habló", () => {
    let last = nextLast(NO_LAST, "planeacion", "u1");
    last = nextLast(last, "ensenanza", "e1");
    expect(last).toEqual({ space: "ensenanza", ids: { planeacion: "u1", ensenanza: "e1" } });
    writeLast(last);
    expect(storage.data.get("pilo-app:ultima")).toBeTruthy();
    expect(readLast()).toEqual(last);
  });

  it("«Nueva conversación» olvida la de ese Pilo, no la del otro", () => {
    const last = nextLast({ space: "ensenanza", ids: { planeacion: "u1", ensenanza: "e1" } }, "ensenanza", null);
    expect(last).toEqual({ space: "ensenanza", ids: { planeacion: "u1" } });
  });

  it("solo se reabre si la conversación sigue guardada", () => {
    const last = { space: "planeacion" as const, ids: { planeacion: "u1" } };
    expect(openingId(last, "planeacion", [{ id: "u1" }, { id: "u2" }])).toBe("u1");
    expect(openingId(last, "planeacion", [{ id: "u2" }])).toBeNull();
    expect(openingId(last, "ensenanza", [{ id: "u1" }])).toBeNull();
  });

  it("lo que no se entiende es «ninguna»", () => {
    expect(parseLast(null)).toEqual(NO_LAST);
    expect(parseLast("")).toEqual(NO_LAST);
    expect(parseLast("{roto")).toEqual(NO_LAST);
    expect(parseLast("[1,2]")).toEqual({ space: null, ids: {} });
    expect(parseLast(JSON.stringify({ space: "otro", ids: { planeacion: 7, ensenanza: "e1", x: "y" } }))).toEqual({ space: null, ids: { ensenanza: "e1" } });
  });
});
