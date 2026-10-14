/* =============================================================================
   Mr. Pilo con IA · qué hay en esta página para leer.

   Se toma de la pantalla, no de cada módulo: así funciona igual en UDES en
   Cifras, el Plan de Desarrollo, el Observatorio y el Portal de Impacto.
   - Si una sección se marca con data-pilo-section (y data-pilo-title), manda.
   - Si no, cada bloque de <main> con un título (h2/h3) y una tabla, una
     gráfica o texto es una sección.
   Las tablas viajan fila por fila («a | b | c»); las gráficas, con su texto
   alternativo y lo que muestren escrito. Solo lo que se ve publicado.
   ========================================================================== */

import type { Section } from "./logic";

export interface PageSection extends Section {
  element: HTMLElement;
}

const clean = (text: string) => text.replace(/[ \t]+/g, " ").replace(/\n{2,}/g, "\n").trim();

function tableText(table: HTMLTableElement): string {
  return [...table.rows]
    .map((row) => [...row.cells].map((c) => clean(c.innerText || c.textContent || "")).join(" | "))
    .filter((line) => line.replace(/[|\s]/g, ""))
    .join("\n");
}

function sectionText(element: HTMLElement): { kind: Section["kind"]; text: string } {
  const tables = [...element.querySelectorAll("table")];
  if (tables.length) return { kind: "tabla", text: tables.map(tableText).join("\n") };
  const chart = element.querySelector("svg[role='img'], [role='img'], canvas, figure");
  const label = chart?.getAttribute("aria-label") ?? chart?.querySelector("title")?.textContent ?? "";
  const text = clean(element.innerText || element.textContent || "");
  return { kind: chart ? "grafica" : "texto", text: clean(`${label}\n${text}`) };
}

function titleOf(element: HTMLElement): string {
  const explicit = element.getAttribute("data-pilo-title");
  if (explicit) return explicit;
  const heading = element.querySelector("h1, h2, h3, caption, figcaption, strong");
  return clean(heading?.textContent ?? "") || "Sección";
}

/** Las secciones legibles de la página, de arriba abajo. */
export function collectSections(root: ParentNode = document): PageSection[] {
  const main = (root.querySelector("main") ?? document.body) as HTMLElement;
  const marked = [...main.querySelectorAll<HTMLElement>("[data-pilo-section]")];
  let candidates = marked;
  if (!candidates.length) {
    const headings = [...main.querySelectorAll<HTMLElement>("h2, h3")];
    const blocks = new Set<HTMLElement>();
    for (const h of headings) {
      const block = h.closest<HTMLElement>("section, article, figure, [class*='card']") ?? h.parentElement;
      if (block && block !== main) blocks.add(block);
    }
    // Si un bloque contiene a otro, se queda el de adentro: es más preciso.
    candidates = [...blocks].filter((b) => ![...blocks].some((other) => other !== b && b.contains(other)));
  }
  return candidates
    .filter((el) => !el.closest(".pai") && el.offsetParent !== null)
    .map((element) => ({ element, title: titleOf(element), ...sectionText(element) }))
    .filter((s) => s.text.length > 20);
}

/** El nombre de la página, para el pedido y la bitácora. */
export const pageTitle = () => clean(document.querySelector("main h1")?.textContent ?? document.title.split("|")[0] ?? "");

/** Todo lo legible de la página, en orden, para leerlo en voz alta. */
export function readingScript(sections: PageSection[]): { section: PageSection | null; text: string }[] {
  const intro = document.querySelector<HTMLElement>("main h1");
  const lede = intro?.parentElement?.querySelector("p");
  const parts: { section: PageSection | null; text: string }[] = [];
  const head = [intro?.textContent, lede?.textContent].filter(Boolean).join(". ");
  if (head) parts.push({ section: null, text: clean(head) });
  for (const s of sections) {
    const body = s.kind === "tabla" ? `${s.title}. Una tabla.` : `${s.title}. ${s.text.split("\n").slice(1, 4).join(". ")}`;
    parts.push({ section: s, text: clean(body).slice(0, 600) });
  }
  return parts;
}
