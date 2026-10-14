/* =============================================================================
   Pregúntele a Pilo · el texto de una respuesta.

   El texto trae Markdown básico (markdown.ts): párrafos, saltos de línea,
   negritas, cursivas, listas, títulos modestos, código y enlaces http(s). Se
   parte en bloques, frases y piezas (palabras, espacios y citas [n]) y se
   pinta con elementos de React, nunca como HTML. Eso sirve para tres cosas:
     · la escritura en vivo: mientras el servidor manda la respuesta, cada
       frase nueva aparece con un fundido corto y un cursor al final;
     · la escritura de una respuesta que llega entera: palabra por palabra, en
       a lo sumo 2,4 s; un clic sobre el texto la completa;
     · la lectura: Pilo lee frase por frase y la frase que suena se resalta.
   Con movimiento reducido, el texto aparece sin fundidos ni escritura.
   Las citas son botones que abren su fuente, dentro de cualquier bloque.

   El texto nunca depende de que una animación termine para verse: el fundido
   en vivo parte de opacidad 0, así que todo lo que lo interrumpe (la respuesta
   termina, el componente se desmonta, React en modo estricto simula un
   desmontaje) lo lleva primero a su final y limpia el estilo en línea. Un
   `kill()` a secas dejaría la frase invisible.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CodeBlock } from "./Extras";
import type { ReactNode } from "react";
import gsap from "gsap";
import type { AskSource } from "../../components/pilo/ai/client";
import { parseMarkdown } from "./markdown";
import type { Block, Parsed, ParseOptions, Piece, Sentence } from "./markdown";

export type { Block, Parsed, Piece, Sentence };

/** Parte la respuesta. Las citas [n] se quedan en la frase que las lleva. */
export function parseAnswer(text: string, options?: ParseOptions): Parsed {
  return parseMarkdown(text, options);
}

const reduced = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/** La escritura: cuántas piezas se ven. `run` false = todo visible. */
export function useTypewriter(count: number, run: boolean, onDone?: () => void) {
  const [shown, setShown] = useState(run ? 0 : count);
  const tween = useRef<gsap.core.Tween | null>(null);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (!run) {
      setShown(count);
      return;
    }
    if (reduced() || count === 0) {
      setShown(count);
      done.current?.();
      return;
    }
    const state = { n: 0 };
    setShown(0);
    tween.current = gsap.to(state, {
      n: count,
      duration: Math.min(2.4, Math.max(0.5, count * 0.034)),
      ease: "none",
      onUpdate: () => setShown(Math.floor(state.n)),
      onComplete: () => {
        setShown(count);
        done.current?.();
      },
    });
    return () => {
      tween.current?.kill();
      tween.current = null;
    };
  }, [count, run]);
  const finish = () => {
    if (!tween.current?.isActive()) return;
    tween.current.progress(1);
  };
  // Sin escritura (historial, o una respuesta que se vio llegar en vivo) todo se ve desde el primer cuadro.
  const visible = run ? Math.min(shown, count) : count;
  return { shown: visible, typing: visible < count, finish };
}

function styled(p: Piece): ReactNode {
  let node: ReactNode = p.value;
  if (p.code) node = <code>{node}</code>;
  if (p.italic) node = <em>{node}</em>;
  if (p.bold) node = <strong>{node}</strong>;
  return node;
}

export function AnswerText({
  parsed,
  shown,
  typing,
  streaming = false,
  reading,
  sources,
  active,
  onSource,
  onFinish,
}: {
  parsed: Parsed;
  shown: number;
  typing: boolean;
  /** El servidor aún manda la respuesta: lo nuevo entra con un fundido y el cursor va al final. */
  streaming?: boolean;
  /** La frase que suena, o null. */
  reading: number | null;
  sources: AskSource[];
  active: number | null;
  onSource: (n: number, trigger: HTMLElement) => void;
  onFinish: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const index = useMemo(() => new Map(parsed.sentences.map((s, i) => [s, i])), [parsed]);
  const last = parsed.sentences[parsed.sentences.length - 1];
  let caretPlaced = false;

  // En vivo: solo lo que acaba de llegar se funde; lo ya escrito no se mueve.
  const seen = useRef(0);
  const tweens = useRef<gsap.core.Tween[]>([]);
  /** Todo lo que se estaba fundiendo queda visible ya: los fundidos van a su final y no queda opacidad en línea. */
  const settle = (units?: HTMLElement[]) => {
    for (const t of tweens.current) t.progress(1).kill();
    tweens.current = [];
    const all = units ?? Array.from(root.current?.querySelectorAll<HTMLElement>(".ap-sent, .px-block") ?? []);
    if (!all.length) return;
    gsap.killTweensOf(all, "opacity,filter");
    gsap.set(all, { clearProps: "opacity,filter" });
  };
  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const units = Array.from(el.querySelectorAll<HTMLElement>(".ap-sent, .px-block"));
    if (!streaming) {
      // La respuesta ya no se escribe (terminó, se cortó o viene del historial): nada puede quedar a medio fundir.
      seen.current = units.length;
      settle(units);
      return;
    }
    const fresh = units.slice(seen.current);
    seen.current = units.length;
    if (!fresh.length || reduced()) return;
    tweens.current = tweens.current.filter((t) => t.progress() < 1);
    // `overwrite: true`: si React reutilizó un nodo que aún se fundía, este fundido lo releva entero.
    tweens.current.push(gsap.fromTo(fresh, { opacity: 0 }, { opacity: 1, duration: 0.4, stagger: 0.06, ease: "power3.out", overwrite: true, clearProps: "opacity,filter" }));
  }, [parsed, streaming]);
  // Al desmontar —de verdad o en el desmontaje simulado del modo estricto de React, donde el
  // nodo sigue en pantalla— los fundidos terminan y la cuenta vuelve a cero para el remontaje.
  useLayoutEffect(
    () => () => {
      settle();
      seen.current = 0;
    },
    // Solo al desmontar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const cite = (p: Piece, key: number) => {
    const n = Number(p.value);
    const src = sources.find((x) => x.n === n);
    // Un número entre corchetes que no es una fuente: mientras se escribe se calla (el servidor lo
    // quita al terminar); en una respuesta terminada es texto y se ve como texto.
    if (!src) return streaming ? null : <span key={key}>[{p.value}]</span>;
    return (
      <button
        key={key}
        type="button"
        className="ap-cite"
        aria-pressed={active === n}
        aria-label={`Fuente ${n}: ${src.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onSource(n, e.currentTarget);
        }}
      >
        {n}
      </button>
    );
  };

  const sentence = (s: Sentence, si: number, more: boolean) => {
    const k = index.get(s)!;
    const nodes: ReactNode[] = [];
    for (let j = 0; j < s.pieces.length; j++) {
      const p = s.pieces[j];
      const prev = s.pieces[j - 1];
      // Un espacio o un salto se ve si la pieza anterior ya se ve.
      const visible = p.order >= 0 ? p.order < shown : Boolean(prev) && prev.order < shown;
      if (p.link && p.href) {
        // Las piezas seguidas de un mismo enlace van en un solo <a>.
        const inside: ReactNode[] = [];
        const first = j;
        while (j < s.pieces.length && s.pieces[j].link === p.link) {
          const q = s.pieces[j];
          if (q.kind === "space") inside.push(s.pieces[j - 1]?.order < shown && j > first ? " " : null);
          else if (q.order < shown) inside.push(<span key={j}>{styled(q)}</span>);
          j += 1;
        }
        j -= 1;
        if (visible)
          nodes.push(
            <a key={`a${first}`} className="ap-link" href={p.href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
              {inside}
            </a>,
          );
        continue;
      }
      if (!visible) continue;
      if (p.kind === "space") nodes.push(" ");
      else if (p.kind === "break") nodes.push(<br key={j} />);
      else if (p.kind === "cite") nodes.push(cite(p, j));
      else nodes.push(<span key={j}>{styled(p)}</span>);
    }
    // El cursor va justo después de la última pieza escrita.
    const endsHere = !caretPlaced && ((typing && s.pieces.some((p) => p.order === shown - 1)) || (streaming && !typing && s === last));
    if (endsHere) caretPlaced = true;
    return (
      <span key={si} className="ap-sent" data-reading={reading === k || undefined}>
        {nodes}
        {endsHere && <i className="ap-caret" aria-hidden="true" />}
        {more ? " " : null}
      </span>
    );
  };

  const seenGroup = (group: Sentence[]) => group.some((s) => s.pieces.some((p) => p.order >= 0 && p.order < shown));
  const group = (sentences: Sentence[]) => sentences.map((s, si) => sentence(s, si, si < sentences.length - 1));

  const block = (b: Block, bi: number) => {
    if (b.kind === "code") {
      if (b.order >= shown) return null;
      return <CodeBlock key={bi} text={b.text} lang={b.lang} />;
    }
    if (b.kind === "list") {
      const items = b.items.filter((item) => seenGroup(item.sentences));
      if (!items.length) return null;
      const List = b.ordered ? "ol" : "ul";
      let n = b.start;
      return (
        <List key={bi} className="ap-list">
          {b.items.map((item, ii) => {
            const value = b.ordered && item.depth === 0 ? n++ : undefined;
            if (!seenGroup(item.sentences)) return null;
            return (
              <li key={ii} value={value} data-depth={item.depth || undefined}>
                {group(item.sentences)}
              </li>
            );
          })}
        </List>
      );
    }
    if (!seenGroup(b.sentences)) return null;
    // Los títulos son modestos: no compiten con el saludo ni rompen la jerarquía de la página.
    if (b.kind === "h")
      return (
        <p key={bi} className="ap-h" role="heading" aria-level={Math.min(6, b.level + 2)}>
          {group(b.sentences)}
        </p>
      );
    return <p key={bi}>{group(b.sentences)}</p>;
  };

  return (
    <div ref={root} className="ap-a__text" data-typing={typing || undefined} onClick={typing ? onFinish : undefined}>
      {parsed.blocks.map(block)}
    </div>
  );
}
