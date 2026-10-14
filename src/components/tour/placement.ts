/* =============================================================================
   Recorridos guiados · dónde va el globo de Mr. Pilo.

   Una función pura (sin DOM) para poder probarla: recibe la caja del elemento
   señalado, el tamaño del globo y el de la ventana, y devuelve una posición
   que SIEMPRE cabe en la ventana con su margen.

   Orden de preferencia: debajo del elemento; encima; a su derecha; a su
   izquierda; y si nada cabe (un elemento que ocupa casi toda la pantalla), en
   la esquina inferior derecha, encima del elemento. Si el globo es más alto
   que la ventana (teléfono apaisado, texto largo), se limita su alto y su
   contenido se desplaza por dentro.
   ========================================================================== */

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface BubblePlacement {
  top: number;
  left: number;
  width: number;
  /** Alto máximo: el globo nunca es más alto que la ventana menos sus márgenes. */
  maxHeight: number;
  side: "below" | "above" | "right" | "left" | "overlay" | "center";
}

export interface PlaceOptions {
  /** Caja del elemento señalado en coordenadas de la ventana; null = sin elemento. */
  target: Rect | null;
  /** Alto natural del globo (0 si aún no se ha medido). */
  bubbleHeight: number;
  viewport: { width: number; height: number };
  /** Ancho deseado del globo. */
  preferredWidth?: number;
  /** Distancia mínima a los bordes de la ventana. */
  margin?: number;
  /** Separación entre el elemento (con su anillo) y el globo. */
  gap?: number;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function placeBubble({
  target,
  bubbleHeight,
  viewport,
  preferredWidth = 400,
  margin = 16,
  gap = 24,
}: PlaceOptions): BubblePlacement {
  const vw = viewport.width;
  const vh = viewport.height;
  const width = Math.max(0, Math.min(preferredWidth, vw - margin * 2));
  const maxHeight = Math.max(0, vh - margin * 2);
  const height = Math.min(bubbleHeight > 0 ? bubbleHeight : 280, maxHeight);

  // El borde superior nunca queda por encima del margen, aunque el globo no
  // quepa: el título y los botones son lo que no se puede perder.
  const fitTop = (top: number) => Math.max(margin, Math.min(top, vh - height - margin));
  const fitLeft = (left: number) => Math.max(margin, Math.min(left, vw - width - margin));

  if (!target) {
    return { top: fitTop((vh - height) / 2), left: fitLeft((vw - width) / 2), width, maxHeight, side: "center" };
  }

  const bottom = target.top + target.height;
  const right = target.left + target.width;
  const centeredLeft = fitLeft(target.left + target.width / 2 - width / 2);
  const centeredTop = fitTop(target.top + target.height / 2 - height / 2);

  const spaceBelow = vh - margin - (bottom + gap);
  const spaceAbove = target.top - gap - margin;
  const spaceRight = vw - margin - (right + gap);
  const spaceLeft = target.left - gap - margin;

  if (height <= spaceBelow) return { top: fitTop(bottom + gap), left: centeredLeft, width, maxHeight, side: "below" };
  if (height <= spaceAbove) return { top: fitTop(target.top - gap - height), left: centeredLeft, width, maxHeight, side: "above" };
  if (width <= spaceRight) return { top: centeredTop, left: fitLeft(right + gap), width, maxHeight, side: "right" };
  if (width <= spaceLeft) return { top: centeredTop, left: fitLeft(target.left - gap - width), width, maxHeight, side: "left" };

  return { top: fitTop(vh - height - margin), left: fitLeft(vw - width - margin), width, maxHeight, side: "overlay" };
}

/**
 * Cuánto tapa la parte de arriba de la ventana una barra fija o pegajosa
 * (la cabecera de los portales, la de la intranet). Sirve para que, al traer
 * el elemento a la vista, no quede debajo de ella.
 */
export function stickyTopInset(doc: Document = document, ignore?: Element | null): number {
  const view = doc.defaultView;
  if (!view || typeof doc.elementsFromPoint !== "function") return 0;
  let inset = 0;
  const seen = new Set<Element>();
  for (const x of [view.innerWidth / 2, 24, view.innerWidth - 24]) {
    for (const hit of doc.elementsFromPoint(x, 1)) {
      for (let el: Element | null = hit; el && el !== doc.body && el !== doc.documentElement; el = el.parentElement) {
        if (seen.has(el)) break;
        seen.add(el);
        if (ignore && ignore.contains(el)) break;
        const position = view.getComputedStyle(el).position;
        if (position === "fixed" || position === "sticky") {
          const r = el.getBoundingClientRect();
          // Una capa que cubre toda la pantalla no es una barra.
          if (r.top <= 1 && r.height < view.innerHeight * 0.5) inset = Math.max(inset, r.bottom);
          break;
        }
      }
    }
  }
  return Math.round(inset);
}
