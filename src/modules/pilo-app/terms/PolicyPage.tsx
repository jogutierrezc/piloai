/* =============================================================================
   Mr. Pilo · la política de uso completa · página pública (/pilo-politica).

   Un documento: índice lateral que marca la sección que se lee (en el
   teléfono, una franja horizontal pegada arriba), seis secciones numeradas,
   la versión y un enlace de vuelta a Pilo. Se lee sin sesión y se puede
   enlazar a una sección (#p3). El texto sale de policy.ts.

   Usa los tokens del sitio (tokens.css), no los temas de la app: sigue el
   tema claro u oscuro del portal. Es un documento: no tiene animaciones de
   adorno; solo el desplazamiento suave al elegir una sección, que se apaga
   con movimiento reducido. En papel sale el texto, sin el índice ni los
   enlaces.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { POLICY_LEAD, POLICY_SECTIONS, POLICY_TITLE, policyBack, policyIndex, readingSection, richParts, sectionFromHash, versionLine } from "./policy";
import type { PolicyBlock } from "./policy";
import "./policy-page.css";

const INDEX = policyIndex();
/** La línea de lectura: a esta fracción del alto de la ventana. */
const READING_LINE = 0.3;
/** Tras elegir una sección, cuánto se respeta la elección mientras la página llega a ella. */
const CLICK_HOLD = 1000;

const still = () => typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);

function Rich({ text }: { text: string }) {
  return (
    <>
      {richParts(text).map((part, i) =>
        part.strong ? (
          <strong key={i}>{part.text}</strong>
        ) : part.pending ? (
          <span key={i} className="pp-pending">
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

function Block({ block }: { block: PolicyBlock }) {
  if (block.kind === "list") {
    return (
      <ul>
        {block.items.map((item) => (
          <li key={item}>
            <Rich text={item} />
          </li>
        ))}
      </ul>
    );
  }
  if (block.kind === "facts") {
    return (
      <dl className="pp-facts">
        {block.items.map((fact) => (
          <div key={fact.term}>
            <dt>{fact.term}</dt>
            <dd>
              <Rich text={fact.text} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return (
    <p>
      <Rich text={block.text} />
    </p>
  );
}

export function PolicyPage() {
  const location = useLocation();
  const back = policyBack(location.search);
  const strip = useRef<HTMLOListElement>(null);
  const holdUntil = useRef(0);
  const [current, setCurrent] = useState<string>(() => (typeof window === "undefined" ? null : sectionFromHash(window.location.hash)) ?? INDEX[0].id);

  /* El nombre de la pestaña es el del documento mientras está abierto. */
  useEffect(() => {
    const before = document.title;
    document.title = `${POLICY_TITLE} · Universidad de Santander`;
    return () => {
      document.title = before;
    };
  }, []);

  /* Quien llega con un ancla (#p4) empieza en esa sección. */
  useEffect(() => {
    const id = sectionFromHash(window.location.hash);
    if (id) document.getElementById(id)?.scrollIntoView({ behavior: "auto", block: "start" });
  }, []);

  /* El índice marca la sección que se lee. */
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      if (performance.now() < holdUntil.current) return;
      const tops = INDEX.map((entry) => ({ id: entry.id, top: document.getElementById(entry.id)?.getBoundingClientRect().top ?? Number.POSITIVE_INFINITY }));
      const doc = document.documentElement;
      const scrollable = doc.scrollHeight > window.innerHeight + 2;
      const atBottom = scrollable && window.scrollY + window.innerHeight >= doc.scrollHeight - 2;
      const id = readingSection(tops, window.innerHeight * READING_LINE, atBottom);
      if (id) setCurrent(id);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(read);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  /* En el teléfono el índice es una franja: la sección marcada queda a la vista dentro de ella. */
  useEffect(() => {
    const list = strip.current;
    const link = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (!list || !link || list.scrollWidth <= list.clientWidth) return;
    const left = link.offsetLeft - list.offsetLeft - 16;
    list.scrollTo({ left: Math.max(0, left), behavior: "auto" });
  }, [current]);

  const go = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    const target = document.getElementById(id);
    if (!target) return;
    event.preventDefault();
    holdUntil.current = performance.now() + CLICK_HOLD;
    setCurrent(id);
    // El ancla queda en la dirección (se puede copiar) sin que el portal recoloque la página.
    window.history.replaceState(window.history.state, "", `${location.pathname}${location.search}#${id}`);
    target.scrollIntoView({ behavior: still() ? "auto" : "smooth", block: "start" });
    // El foco sigue a la lectura: quien usa el teclado continúa desde la sección.
    target.focus({ preventScroll: true });
  };

  return (
    <div className="pp">
      <div className="pp-in">
        <header className="pp-top">
          <Link className="pp-back" to={back.href}>
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M16 10H4M9 5l-5 5 5 5" />
            </svg>
            {back.label}
          </Link>
          <p className="pp-brand">
            <b>Mr. Pilo</b> Universidad de Santander
          </p>
        </header>

        <div className="pp-doc">
          <nav className="pp-toc" aria-label="Contenido de la política">
            <p className="pp-toc__label">Contenido</p>
            <ol ref={strip}>
              {INDEX.map((entry) => (
                <li key={entry.id}>
                  <a href={entry.href} aria-current={entry.id === current ? "location" : undefined} onClick={(e) => go(e, entry.id)}>
                    {entry.label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <main className="pp-text">
            <header>
              <h1>{POLICY_TITLE}</h1>
              <p>{POLICY_LEAD}</p>
              <p className="pp-version">{versionLine()}</p>
            </header>

            {POLICY_SECTIONS.map((section) => (
              <section key={section.id} className="pp-sec" id={section.id} tabIndex={-1} aria-labelledby={`${section.id}-t`}>
                <h2 id={`${section.id}-t`}>
                  <span>{section.n}</span>
                  {section.title}
                </h2>
                {section.blocks.map((block, i) => (
                  <Block key={i} block={block} />
                ))}
              </section>
            ))}

            <footer className="pp-foot">
              <Link className="pp-back" to={back.href}>
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="M16 10H4M9 5l-5 5 5 5" />
                </svg>
                {back.label}
              </Link>
            </footer>
          </main>
        </div>
      </div>
    </div>
  );
}
