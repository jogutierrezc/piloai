/* =============================================================================
   Intranet · Mr. Pilo con IA · Páginas web · el movimiento.

   Tres momentos, cada uno con su línea de tiempo:
   - la malla se arma al leer una página (página › secciones › pasajes);
   - los temas llegan cuando Pilo la conecta con el resto de la memoria;
   - una consulta entra a la malla y enciende los pasajes que encontró.

   Como en el resto del módulo: solo transform, opacidad y trazo; con
   movimiento reducido, nada se mueve (la malla aparece ya armada). Lo que no
   está en una animación se ve completo: una página ya guardada no se anima.
   ========================================================================== */

import gsap from "gsap";
import { EASE_OUT, reducedMotion } from "../../../impacto/pilo/motion";

const all = (root: Element, selector: string) => Array.from(root.querySelectorAll<SVGElement>(selector));

/** El trazo de una curva, de nada a entero. */
function draw(tl: gsap.core.Timeline, paths: SVGElement[], vars: { duration: number; stagger: number }, at?: string | number) {
  if (!paths.length) return;
  for (const p of paths) {
    const len = (p as unknown as SVGPathElement).getTotalLength?.() ?? 0;
    gsap.set(p, { strokeDasharray: len, strokeDashoffset: len });
  }
  tl.to(paths, { strokeDashoffset: 0, ease: "power2.out", ...vars, clearProps: "strokeDasharray,strokeDashoffset" }, at);
}

/** Un nodo entra desde casi su tamaño: nada aparece de la nada. */
function pop(tl: gsap.core.Timeline, nodes: SVGElement[], vars: { duration: number; stagger: number }, at?: string | number) {
  if (!nodes.length) return;
  for (const n of nodes) gsap.set(n, { autoAlpha: 0, scale: 0.9, svgOrigin: `${n.dataset.ox} ${n.dataset.oy}` });
  tl.to(nodes, { autoAlpha: 1, scale: 1, ease: EASE_OUT, ...vars, clearProps: "transform,opacity,visibility" }, at);
}

/** La malla se arma: la página, sus secciones y sus pasajes. Devuelve cómo detenerla dejándola completa. */
export function buildMesh(svg: SVGSVGElement | null): () => void {
  if (!svg || reducedMotion()) return () => undefined;
  const tl = gsap.timeline();
  pop(tl, all(svg, '[data-kind="pagina"] .pwb-pop'), { duration: 0.4, stagger: 0 });
  draw(tl, all(svg, '[data-e="ps"]'), { duration: 0.45, stagger: 0.06 }, "<0.1");
  pop(tl, all(svg, '[data-kind="seccion"] .pwb-pop'), { duration: 0.32, stagger: 0.06 }, "<0.16");
  draw(tl, all(svg, '[data-e="sp"]'), { duration: 0.38, stagger: 0.035 }, "-=0.12");
  pop(tl, all(svg, '[data-kind="pasaje"] .pwb-pop'), { duration: 0.28, stagger: 0.035 }, "<0.12");
  return () => {
    tl.progress(1).kill();
  };
}

/** Los temas llegan y se conectan con los pasajes. */
export function buildTopics(svg: SVGSVGElement | null): () => void {
  if (!svg || reducedMotion()) return () => undefined;
  const tl = gsap.timeline();
  pop(tl, all(svg, '[data-kind="tema"] .pwb-pop'), { duration: 0.34, stagger: 0.07 });
  draw(tl, all(svg, '[data-e="pt"]'), { duration: 0.42, stagger: 0.03 }, "<0.12");
  return () => {
    tl.progress(1).kill();
  };
}

/** Un pasaje recién indexado late una vez. */
export function pulse(node: SVGElement | null) {
  if (!node || reducedMotion()) return;
  gsap.fromTo(node, { scale: 1.35 }, { scale: 1, duration: 0.32, ease: EASE_OUT, svgOrigin: `${node.dataset.ox} ${node.dataset.oy}`, clearProps: "transform", overwrite: true });
}

/** La consulta entra a la malla: la pregunta aparece y sus rayos llegan a los pasajes que encontró. */
export function scan(svg: SVGSVGElement | null): () => void {
  if (!svg || reducedMotion()) return () => undefined;
  const tl = gsap.timeline();
  pop(tl, all(svg, ".pwb-q"), { duration: 0.3, stagger: 0 });
  draw(tl, all(svg, ".pwb-ray"), { duration: 0.4, stagger: 0.08 }, "<0.12");
  const hit = all(svg, '[data-kind="pasaje"][data-on] .pwb-pop');
  if (hit.length) {
    tl.fromTo(hit, { scale: 1.3 }, { scale: 1, duration: 0.38, ease: EASE_OUT, stagger: 0.08, svgOrigin: (_i: number, n: Element) => `${(n as SVGElement).dataset.ox} ${(n as SVGElement).dataset.oy}`, clearProps: "transform" }, "<0.2");
  }
  return () => {
    tl.progress(1).kill();
  };
}
