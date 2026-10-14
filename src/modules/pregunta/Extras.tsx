/* =============================================================================
   Pregúntele a Pilo · funciones ampliadas (0119), lo que se ve.

   Las piezas que comparten la página y la app del teléfono:

     AttachButton   el clip: elige un archivo, que se lee en este dispositivo.
     FileChip       el archivo adjunto, con su nota y cómo quitarlo.
     FileLog        la bitácora de lo que Pilo hizo con el archivo, plegable.
     CodeBlock      un bloque de código con su barra: lenguaje y «Copiar».
     CopyButton     copia en un toque y lo confirma en su sitio.

   Los colores salen de las variables --px-*, que cada pantalla define con las
   suyas (extras.css). El bloque de código usa el escenario de Pilo: se lee
   igual en todos los temas.
   ========================================================================== */

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ATTACH_ACCEPT, fileSteps, readAttachment } from "./attach";
import type { Attachment, TurnFile } from "./attach";
import "./extras.css";
import { tr, trn, useLang } from "../../components/pilo/i18n";

const svg = (d: ReactNode) => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);
const ICON = {
  check: svg(<path d="M3 8.5l3.2 3.2L13 5" />),
  chev: svg(<path d="M6 3l5 5-5 5" />),
  copy: svg(
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M10.5 5.5v-2a1 1 0 00-1-1h-6a1 1 0 00-1 1v6a1 1 0 001 1h2" />
    </>,
  ),
  file: svg(<path d="M9 2H4.5a1 1 0 00-1 1v10a1 1 0 001 1h7a1 1 0 001-1V5L9 2zM9 2v3h3.5" />),
  clip: svg(<path d="M13 7.5l-5 5a3 3 0 01-4.3-4.2l5.4-5.4a2 2 0 012.8 2.8L6.6 11a1 1 0 01-1.4-1.4l4.6-4.6" />),
  close: svg(<path d="M4 4l8 8M12 4l-8 8" />),
  lock: svg(
    <>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
      <path d="M5.5 7V5a2.5 2.5 0 015 0v2" />
    </>,
  ),
};

/* --- Copiar ------------------------------------------------------------------------------- */

export function CopyButton({ text, label = "Copiar", what }: { text: string | (() => string); label?: string; what: string }) {
  useLang();
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    let ok = true;
    try {
      await navigator.clipboard.writeText(typeof text === "function" ? text() : text);
    } catch {
      ok = false;
    }
    setState(ok ? "done" : "fail");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };
  return (
    <button type="button" className="px-copy" data-state={state === "idle" ? undefined : state} onClick={() => void copy()} aria-label={`${tr(label)} ${tr(what)}`}>
      <span className="px-copy__idle">
        {ICON.copy}
        {tr(label)}
      </span>
      <span className="px-copy__done" aria-hidden={state === "idle"}>
        {state === "fail" ? null : ICON.check}
        {state === "fail" ? tr("No se pudo") : tr("Copiado")}
      </span>
      <span className="px-sr" role="status">
        {state === "done" ? tr("Copiado") : state === "fail" ? tr("No se pudo copiar: seleccione el texto y cópielo.") : ""}
      </span>
    </button>
  );
}

/* --- Código ------------------------------------------------------------------------------- */

const LANG_NAME: Record<string, string> = { py: "python", js: "javascript", ts: "typescript", sh: "bash", shell: "bash", yml: "yaml", excel: "excel", vba: "vba" };
const HASH = new Set(["python", "r", "bash", "yaml", "ruby", "perl", ""]);
const SLASH = new Set(["javascript", "typescript", "java", "c", "cpp", "csharp", "go", "rust", "php", "kotlin", "swift", "css"]);

export interface CodeToken {
  text: string;
  kind: "plain" | "comment" | "string" | "number";
}

export const langOf = (lang: string | undefined): string => {
  const l = (lang ?? "").toLowerCase();
  return LANG_NAME[l] ?? l;
};

/** Una línea de código en piezas: comentarios, textos y números. Sin palabras clave: sirve para cualquier lenguaje. */
export function codeTokens(line: string, lang = ""): CodeToken[] {
  const l = langOf(lang);
  const comment = l === "sql" ? "--.*$" : SLASH.has(l) ? "\\/\\/.*$" : HASH.has(l) ? "#.*$" : null;
  const pattern = new RegExp(`${comment ? `(${comment})|` : "()"}("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')|\\b(\\d+(?:\\.\\d+)?)\\b`, "g");
  const out: CodeToken[] = [];
  let at = 0;
  for (const m of line.matchAll(pattern)) {
    if (!m[0]) continue;
    const i = m.index ?? 0;
    if (i > at) out.push({ text: line.slice(at, i), kind: "plain" });
    out.push({ text: m[0], kind: m[1] ? "comment" : m[2] ? "string" : "number" });
    at = i + m[0].length;
  }
  if (at < line.length) out.push({ text: line.slice(at), kind: "plain" });
  return out;
}

export function CodeBlock({ text, lang }: { text: string; lang?: string }) {
  useLang();
  const name = langOf(lang);
  return (
    <div className="px-block px-code">
      <div className="px-block__head">
        <span>{name || tr("código")}</span>
        <CopyButton text={text} what={tr("el código")} />
      </div>
      <pre className="px-pre" tabIndex={0}>
        <code>
          {text.split("\n").map((line, i) => (
            <span key={i} className="px-ln">
              {codeTokens(line, lang).map((t, j) => (t.kind === "plain" ? t.text : <span key={j} data-k={t.kind}>{t.text}</span>))}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}

/* --- El archivo --------------------------------------------------------------------------- */

export interface AttachState {
  attachment: Attachment | null;
  reading: string | null;
  error: string;
  pick: (file: File | null | undefined) => void;
  clear: () => void;
}

/** El archivo adjunto de la conversación: vive en memoria y se va al quitarlo o al cambiar de conversación. */
export function useAttachment(maxMb: number): AttachState {
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [reading, setReading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const turn = useRef(0);
  const pick = useCallback(
    (file: File | null | undefined) => {
      if (!file) return;
      const mine = ++turn.current;
      setError("");
      setReading(file.name);
      readAttachment(file, maxMb).then(
        (read) => {
          if (mine !== turn.current) return;
          setAttachment(read);
          setReading(null);
        },
        (e: unknown) => {
          if (mine !== turn.current) return;
          setError((e as Error)?.message || tr("No pude leer ese archivo."));
          setReading(null);
        },
      );
    },
    [maxMb],
  );
  const clear = useCallback(() => {
    turn.current += 1;
    setAttachment(null);
    setReading(null);
    setError("");
  }, []);
  return { attachment, reading, error, pick, clear };
}

export function AttachButton({ onPick, disabled, className }: { onPick: (file: File | null | undefined) => void; disabled?: boolean; className?: string }) {
  useLang();
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={ATTACH_ACCEPT}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          // El mismo archivo se puede volver a elegir.
          e.target.value = "";
        }}
      />
      <button type="button" className={className ? `px-clip ${className}` : "px-clip"} disabled={disabled} onClick={() => input.current?.click()} aria-label={tr("Adjuntar un archivo para que Pilo lo analice")} title={tr("Adjuntar un archivo (Word, Excel, CSV o PDF)")}>
        {ICON.clip}
      </button>
    </>
  );
}

/** El archivo en la caja de escribir (con quitar) o en la pregunta ya enviada (sin quitar). */
export function FileChip({ name, detail, onRemove, busy }: { name: string; detail: string; onRemove?: () => void; busy?: boolean }) {
  return (
    <span className="px-file" data-busy={busy || undefined}>
      {ICON.file}
      <span className="px-file__name">{name}</span>
      <small>{detail}</small>
      {onRemove && (
        <button type="button" onClick={onRemove} aria-label={`Quitar ${name}`}>
          {ICON.close}
        </button>
      )}
    </span>
  );
}

/** Lo que acompaña a la caja de escribir: el archivo listo, el que se está leyendo, o por qué no se pudo leer. */
export function AttachTray({ state }: { state: AttachState }) {
  useLang();
  const { attachment, reading, error, clear } = state;
  if (!attachment && !reading && !error) return null;
  return (
    <div className="px-tray" role="status">
      {reading && <FileChip name={reading} detail={tr("leyendo en este dispositivo…")} busy />}
      {attachment && !reading && <FileChip name={attachment.name} detail={trn(attachment.passages.length, tr("{n} pasaje · no se sube"), tr("{n} pasajes · no se sube"))} onRemove={clear} />}
      {error && <span className="px-tray__error">{error}</span>}
      {attachment && !reading && attachment.warnings.length > 0 && <span className="px-tray__note">{attachment.warnings[0]}</span>}
    </div>
  );
}

/** La bitácora de trabajo de una respuesta que analizó un archivo. En pantallas angostas llega plegada. */
export function FileLog({ file, seconds }: { file: TurnFile; seconds?: number }) {
  useLang();
  const id = useId();
  const [open, setOpen] = useState(() => (typeof window === "undefined" ? true : !window.matchMedia("(max-width: 640px)").matches));
  const steps = fileSteps(file);
  return (
    <div className="px-log">
      <button type="button" className="px-log__head" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        {ICON.chev}
        <span>
          {tr("Pilo trabajó con su archivo")}{seconds && seconds >= 1 ? ` · ${Math.round(seconds)} s` : ""} · {steps.length} {tr("pasos")}
        </span>
      </button>
      <ol id={id} hidden={!open}>
        {steps.map((s) => (
          <li key={s.verb}>
            {ICON.check}
            <span>
              <b>{s.verb}</b> <code>{s.target}</code>
            </span>
            <em>{s.meta}</em>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** El pie de una respuesta con archivo: no se guardó, y copiar todo el análisis. */
export function FileFoot({ text }: { text: () => string }) {
  useLang();
  return (
    <div className="px-foot">
      <span className="px-foot__mark">
        {ICON.lock}
        {tr("El archivo no se guardó")}
      </span>
      <span>{tr("Los cálculos son de Pilo sobre su archivo: verifíquelos antes de usarlos.")}</span>
      <CopyButton text={text} label={tr("Copiar todo")} what={tr("el análisis")} />
    </div>
  );
}
