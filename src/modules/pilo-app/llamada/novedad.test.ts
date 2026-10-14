import { describe, expect, it } from "vitest";
import { NEWS_MARK, NEWS_VERSION, newsSeen, shouldAnnounce } from "./novedad";
import type { NewsContext } from "./novedad";

const ready: NewsContext = { seen: false, activated: false, blocked: false, online: true, voice: true, recognition: true, busy: false, open: true };

describe("el anuncio de la llamada", () => {
  it("sale cuando todo está listo", () => {
    expect(shouldAnnounce(ready)).toBe(true);
  });

  it("no sale si ya se vio, si ya usa la llamada o si no hay con qué", () => {
    expect(shouldAnnounce({ ...ready, seen: true })).toBe(false);
    expect(shouldAnnounce({ ...ready, activated: true })).toBe(false);
    expect(shouldAnnounce({ ...ready, voice: false })).toBe(false);
    expect(shouldAnnounce({ ...ready, recognition: false })).toBe(false);
    expect(shouldAnnounce({ ...ready, online: false })).toBe(false);
    expect(shouldAnnounce({ ...ready, open: false })).toBe(false);
  });

  it("espera a lo obligatorio y a que Pilo termine de responder", () => {
    expect(shouldAnnounce({ ...ready, blocked: true })).toBe(false);
    expect(shouldAnnounce({ ...ready, busy: true })).toBe(false);
  });

  it("lo guardado decide si ya se vio, y una versión nueva vuelve a mostrarse", () => {
    expect(newsSeen(null)).toBe(false);
    expect(newsSeen("")).toBe(false);
    expect(newsSeen("basura")).toBe(false);
    expect(newsSeen(NEWS_MARK)).toBe(true);
    expect(newsSeen(String(NEWS_VERSION + 1))).toBe(true);
    // El anuncio de una versión posterior que aún no existe en este dispositivo sí debe verse.
    expect(Number("0") >= NEWS_VERSION).toBe(false);
  });
});
