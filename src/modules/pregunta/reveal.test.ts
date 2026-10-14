// @vitest-environment jsdom
/* El fundido en vivo de AnswerText no puede dejar texto oculto.

   El fallo que vio el dueño: en modo estricto, React simula un desmontaje justo
   después de montar; la limpieza mataba el fundido con las frases en opacidad 0
   y nada volvía a animarlas: la primera frase de cada respuesta en vivo quedaba
   invisible. Aquí se monta de verdad (jsdom + GSAP) y se mira el estilo. */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createElement, StrictMode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import gsap from "gsap";
import { AnswerText, parseAnswer } from "./AnswerText";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noop = () => undefined;

function view(text: string, streaming: boolean) {
  const parsed = parseAnswer(text, { streaming });
  return createElement(AnswerText, { parsed, shown: parsed.count, typing: false, streaming, reading: null, sources: [], active: null, onSource: noop, onFinish: noop });
}

const units = (host: HTMLElement) => Array.from(host.querySelectorAll<HTMLElement>(".ap-sent, .px-block"));
/** Las unidades con opacidad en línea distinta de 1: las que no se verían (del todo). */
const hidden = (host: HTMLElement) => units(host).filter((u) => u.style.opacity !== "" && u.style.opacity !== "1");
/** Pasa el tiempo: todo fundido vivo llega a su final. Uno muerto a medias no lo hace nunca. */
const letTimePass = (host: HTMLElement) => {
  for (const t of gsap.getTweensOf(units(host))) t.progress(1);
};

describe("el fundido de una respuesta en vivo", () => {
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

  it("en modo estricto, la primera frase termina visible", () => {
    act(() => root.render(createElement(StrictMode, null, view("La UDES tiene tres sedes.", true))));
    expect(units(host)).toHaveLength(1);
    letTimePass(host);
    expect(hidden(host)).toEqual([]);
    expect(host.textContent).toContain("La UDES tiene tres sedes.");
  });

  it("sin modo estricto, cada frase nueva se funde y termina visible", () => {
    act(() => root.render(view("Primera frase.", true)));
    // Recién llegada, parte de opacidad 0: el fundido existe.
    expect(units(host)[0].style.opacity).toBe("0");
    act(() => root.render(view("Primera frase. Segunda frase.", true)));
    expect(units(host)).toHaveLength(2);
    letTimePass(host);
    expect(hidden(host)).toEqual([]);
  });

  it("al terminar la respuesta, nada queda a medio fundir aunque el tiempo no pase", () => {
    act(() => root.render(view("Primera frase. Segunda", true)));
    expect(hidden(host).length).toBeGreaterThan(0);
    // Llega `done`: el mismo componente, ya sin flujo. Ni un cuadro de animación de por medio.
    act(() => root.render(view("Primera frase. Segunda frase, ya completa.", false)));
    expect(hidden(host)).toEqual([]);
    expect(gsap.getTweensOf(units(host))).toEqual([]);
  });

  it("al terminar en modo estricto, igual", () => {
    act(() => root.render(createElement(StrictMode, null, view("Uno. Dos.", true))));
    act(() => root.render(createElement(StrictMode, null, view("Uno. Dos. Tres.", false))));
    expect(hidden(host)).toEqual([]);
  });

  it("una respuesta del historial (sin flujo) nunca se oculta", () => {
    act(() => root.render(createElement(StrictMode, null, view("Texto guardado. Con dos frases.", false))));
    expect(hidden(host)).toEqual([]);
    expect(units(host).every((u) => u.style.opacity === "")).toBe(true);
  });

  it("un número entre corchetes sin fuente se ve como texto en la respuesta terminada", () => {
    act(() => root.render(view("Aplica la norma [7].", false)));
    expect(host.textContent).toContain("[7]");
  });
});
