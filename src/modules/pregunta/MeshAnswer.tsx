/* =============================================================================
   Pregúntele a Pilo · el mapa de una respuesta.

   El tramo de la malla de la memoria que usó Pilo, dibujado como el Mapa
   numerado leído de arriba abajo: la ruta desde la fuente hasta el nodo
   (Pilar › Área estratégica › Línea de acción › Proyecto), el nodo resaltado
   y, colgando de él, lo que contiene. Si el nodo cuelga de varios lados, se
   dice con qué más se vincula. Cada nodo lleva a su página en el portal.

   Entra una sola vez, fila por fila (40 ms), con GSAP; con movimiento
   reducido aparece quieto.
   ========================================================================== */

import { useLayoutEffect, useRef } from "react";
import { Link } from "react-router-dom";
import gsap from "gsap";
import { childrenOf, nodeName, parentsOf, pathTo, TYPE_LABEL } from "../../components/pilo/ai/logic";
import type { Mesh, MeshNode } from "../../components/pilo/ai/logic";
import { tr, useLang } from "../../components/pilo/i18n";

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const kindOf = (t: string) => TYPE_LABEL[t]?.[0] ?? t;

function NodeRow({ node, depth, focus = false }: { node: MeshNode; depth: number; focus?: boolean }) {
  const inner = (
    <>
      {node.code ? <span className="apm-code">{node.code}</span> : null}
      <span className="apm-label">{node.label}</span>
      <small>{kindOf(node.type)}</small>
    </>
  );
  const external = /^https?:/i.test(node.path);
  return (
    <li className="apm-row" data-focus={focus || undefined} style={{ ["--d" as string]: depth }}>
      {node.path ? (
        external ? (
          <a href={node.path} target="_blank" rel="noopener noreferrer">
            {inner}
          </a>
        ) : (
          <Link to={node.path}>{inner}</Link>
        )
      ) : (
        <span>{inner}</span>
      )}
    </li>
  );
}

export function MeshAnswer({ graph, animate }: { graph: Mesh & { focus: string }; animate: boolean }) {
  useLang();
  const root = useRef<HTMLDivElement>(null);
  const route = pathTo(graph, graph.focus);
  const focus = route[route.length - 1];
  const kids = childrenOf(graph, graph.focus);
  const also = parentsOf(graph, graph.focus).slice(1);

  useLayoutEffect(() => {
    if (!animate || !root.current || reduced()) return;
    const ctx = gsap.context(() => {
      gsap.from(".apm-row", { autoAlpha: 0, x: -8, duration: 0.3, stagger: 0.04, ease: "power3.out" });
    }, root);
    return () => ctx.revert();
  }, [animate]);

  if (!focus) return null;
  const depthOf = (i: number) => i;
  return (
    <div className="apm" ref={root} aria-label={tr("Mapa de la memoria: {route}", { route: route.map(nodeName).join(" › ") })}>
      <ol className="apm-tree">
        {route.map((n, i) => (
          <NodeRow key={n.id} node={n} depth={depthOf(i)} focus={n.id === focus.id} />
        ))}
        {kids.slice(0, 18).map((n) => (
          <NodeRow key={n.id} node={n} depth={route.length} />
        ))}
      </ol>
      {kids.length > 18 && <p className="apm-more">Y {kids.length - 18} {tr("más en el portal.")}</p>}
      {also.length > 0 && (
        <p className="apm-more">
          {tr("También se vincula con")} {also.map(nodeName).join(", ")}.
        </p>
      )}
    </div>
  );
}
