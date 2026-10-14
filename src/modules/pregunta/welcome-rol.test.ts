// @vitest-environment jsdom
/* La bienvenida, montada de verdad (jsdom + GSAP): la de siempre no cambia, y
   la de un espacio que pregunta el rol cierra con «¿quién pregunta?». */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, createRef, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import gsap from "gsap";
import { Welcome } from "./Welcome";
import { RoleMenu, RolePicker } from "./RolePicker";
import { ASK_SPACES, ROLE_QUESTION } from "./space";
import type { Rol } from "./space";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Pasa el tiempo: toda animación viva llega a su final (y dispara lo que tenía pendiente). */
const letTimePass = () =>
  act(() => {
    for (let i = 0; i < 6; i++) for (const t of gsap.globalTimeline.getChildren(true, true, true)) t.progress(1);
  });

const button = (host: HTMLElement, label: string) => Array.from(host.querySelectorAll("button")).find((b) => b.textContent?.trim() === label);
const click = (el: Element | undefined) => act(() => void el?.dispatchEvent(new MouseEvent("click", { bubbles: true })));

describe("la bienvenida", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("la de Pregúntele a Pilo es la de siempre: su título, tres momentos y el botón final, sin rol", () => {
    const onDone = vi.fn();
    act(() => root.render(createElement(StrictMode, null, createElement(Welcome, { tema: "blanco", target: createRef<HTMLElement>(), onDone }))));
    letTimePass();
    expect(host.querySelector("#apw-title")?.getAttribute("aria-label")).toBe("Pregúntele a Mr. Pilo");
    expect(host.querySelector(".apw-brand")?.textContent).toBe("Pregúntele a PiloUniversidad de Santander");
    expect(host.querySelectorAll(".apw-seg")).toHaveLength(3);
    expect(host.querySelector(".apw-segs small")?.textContent).toMatch(/de 3$/);
    expect(host.querySelectorAll(".apw-know")).toHaveLength(5);
    expect(host.querySelector(".apw-mini p")?.textContent).toBe("El Plan de Desarrollo tiene sus pilares con avance publicado, y cada cifra dice de dónde sale 1");
    click(button(host, "Siguiente"));
    click(button(host, "Siguiente"));
    click(button(host, "Siguiente"));
    expect(host.querySelector(".apw-role")).toBeNull();
    expect(host.querySelector(".ap-rolp")).toBeNull();
    const cta = host.querySelector<HTMLButtonElement>(".apw-cta");
    expect(cta?.hidden).toBe(false);
    expect(cta?.textContent).toContain("Hacer mi primera pregunta");
    click(cta ?? undefined);
    letTimePass();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("la de Enseñanza se presenta como la IA de la Universidad de Santander y cierra preguntando el rol", () => {
    const onDone = vi.fn();
    const onRol = vi.fn<(rol: Rol) => void>();
    act(() =>
      root.render(createElement(StrictMode, null, createElement(Welcome, { tema: "blanco", target: createRef<HTMLElement>(), onDone, space: ASK_SPACES.ensenanza, askRol: true, rol: null, onRol }))),
    );
    letTimePass();
    expect(host.querySelector("#apw-title")?.getAttribute("aria-label")).toBe("Mr. Pilo en Enseñanza");
    expect(host.querySelector(".apw")?.getAttribute("data-espacio")).toBe("ensenanza");
    expect(host.querySelector(".apw-bubble")?.textContent).toContain("la Inteligencia Artificial de la Universidad de Santander");
    expect(host.querySelectorAll(".apw-seg")).toHaveLength(4);
    expect(host.querySelectorAll(".apw-know")).toHaveLength(4);
    click(button(host, "Siguiente"));
    click(button(host, "Siguiente"));
    expect(host.querySelector(".apw-role")).toBeNull();
    click(button(host, "Siguiente"));
    // El cuarto momento: la pregunta y las tres opciones; el botón final no aparece.
    expect(host.querySelector(".apw-bubble")?.textContent?.replace(/\s+/g, " ").trim()).toBe(ROLE_QUESTION);
    expect(host.querySelector(".apw-segs small")?.textContent).toBe("4 de 4");
    expect(Array.from(host.querySelectorAll(".apw-role button")).map((b) => b.textContent)).toEqual(["Estudiante", "Profesor", "Prefiero no decir"]);
    expect(host.querySelector<HTMLButtonElement>(".apw-cta")?.hidden).toBe(true);
    letTimePass();
    // Nada de la pregunta queda oculto ni desenfocado cuando la animación termina.
    for (const el of host.querySelectorAll<HTMLElement>(".apw-bubble .w, .apw-role button")) {
      expect(el.style.opacity === "" || el.style.opacity === "1").toBe(true);
      expect(el.style.filter).toBe("");
    }
    click(button(host, "Profesor"));
    expect(onRol).toHaveBeenCalledWith("profesor");
    letTimePass();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("saltar la bienvenida no elige rol: se pregunta después, en la página", () => {
    const onDone = vi.fn();
    const onRol = vi.fn();
    act(() => root.render(createElement(Welcome, { tema: "negro", target: createRef<HTMLElement>(), onDone, space: ASK_SPACES.ensenanza, askRol: true, rol: null, onRol })));
    click(button(host, "Saltar"));
    letTimePass();
    expect(onRol).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

describe("quién pregunta", () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("las tres opciones avisan cuál se eligió y marcan la actual", () => {
    const onPick = vi.fn();
    act(() => root.render(createElement(RolePicker, { value: "estudiante", onPick, legend: ROLE_QUESTION })));
    expect(host.querySelector(".ap-rolp__q")?.textContent).toBe(ROLE_QUESTION);
    expect(button(host, "Estudiante")?.getAttribute("aria-pressed")).toBe("true");
    expect(button(host, "Profesor")?.getAttribute("aria-pressed")).toBe("false");
    click(button(host, "Prefiero no decir"));
    expect(onPick).toHaveBeenCalledWith("general");
  });

  it("el control de la barra dice el rol, se abre, deja cambiarlo y se cierra visible", () => {
    const onPick = vi.fn();
    act(() => root.render(createElement(StrictMode, null, createElement(RoleMenu, { value: "profesor", onPick }))));
    const trigger = host.querySelector<HTMLButtonElement>(".ap-rol__btn");
    expect(trigger?.textContent).toBe("Profesor");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelector(".ap-rol__panel")).toBeNull();
    click(trigger ?? undefined);
    expect(trigger?.getAttribute("aria-expanded")).toBe("true");
    letTimePass();
    const panel = host.querySelector<HTMLElement>(".ap-rol__panel");
    expect(panel).not.toBeNull();
    expect(panel?.style.opacity).toBe("");
    expect(panel?.style.visibility).toBe("");
    click(button(host, "Estudiante"));
    expect(onPick).toHaveBeenCalledWith("estudiante");
    expect(host.querySelector(".ap-rol__panel")).toBeNull();
  });

  it("sin rol elegido, el control lo pregunta", () => {
    act(() => root.render(createElement(RoleMenu, { value: null, onPick: () => undefined })));
    expect(host.querySelector(".ap-rol__btn")?.textContent).toBe("¿Quién pregunta?");
  });
});
