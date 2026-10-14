/* =============================================================================
   Mr. Pilo · la app móvil · un turno: la pregunta y lo que responde Pilo.

   La cara de Pilo va junto a cada respuesta. Mientras piensa, se lee el paso
   en el que va, en palabras (los que reporta el servidor, nunca inventados);
   la respuesta se escribe a medida que llega; al terminar aparecen sus
   fuentes, «Escuchar», «Copiar» y los votos, como en la página, y «Guardar»
   (0120): la respuesta completa queda en la cuenta de la persona.

   La lectura es con la voz oficial o no es (official-voice.ts): frase por
   frase, con la que suena resaltada. Si la voz no está disponible, avisa una
   vez y queda el texto.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import gsap from "gsap";
import type { AskKind, AskMeta, AskSource } from "../../components/pilo/ai/client";
import { enrichSpokenSentences } from "../../components/pilo/ai/voice-expressions";
import { Pilo } from "../pregunta/Pilo";
import type { MojiMood } from "../pregunta/Pilo";
import type { Turn } from "../pregunta/store";
import { AnswerText, parseAnswer, useTypewriter } from "../pregunta/AnswerText";
import { toPlain } from "../pregunta/markdown";
import { notesOf, seedOf, showsSources, waitingFace, waitingLine, waitingTip } from "../pregunta/answer-state";
import type { ThinkStep } from "../pregunta/answer-state";
import type { AppVoice } from "./access";
import { prefetchOfficial, sayOfficial, stopOfficial } from "./official-voice";
import { isSuperMode, voiceTone, SUPER } from "../pregunta/super/modes";
import { reducedMotion } from "./pwa";
import { Icon } from "./icons";
import { FileChip, FileFoot, FileLog } from "../pregunta/Extras";
import { tr, trn, useLang } from "../../components/pilo/i18n";

/** Lo que se ve de una respuesta mientras el servidor la escribe. No se guarda. */
export interface Live {
  turnId: string;
  text: string;
  meta: AskMeta | null;
  steps: ThinkStep[];
  startedAt: number;
}

export interface TurnVoice extends AppVoice {
  rol?: string;
  mood?: string;
}

const MOOD_OF: Record<AskKind, MojiMood> = { memoria: "feliz", extracto: "atento", ia: "feliz", regla: "cuidado", nada: "duda", curada: "feliz", capciosa: "cuidado", malla: "feliz", dato: "feliz" };

/** Una entrada corta: termina visible aunque algo la interrumpa. */
function useEnter(ref: React.RefObject<HTMLElement>, run: boolean, key: unknown = true) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!run || !el || reducedMotion()) return;
    const tween = gsap.fromTo(el, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.22, ease: "expo.out", clearProps: "opacity,transform" });
    return () => {
      tween.progress(1).kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, key]);
}

/** Los segundos que lleva pensando; solo corre mientras `on`. */
function useElapsed(startedAt: number | undefined, on: boolean): number {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [on]);
  return startedAt ? (Date.now() - startedAt) / 1000 : 0;
}

export function AppTurn({
  turn,
  stream,
  fresh,
  animate,
  autoRead,
  voice,
  expression,
  onTyped,
  onRetry,
  onVote,
  onSources,
  onSound,
  onVoiceLost,
  saved = false,
  saving = false,
  onSave,
}: {
  turn: Turn;
  /** Lo que el servidor va mandando de este turno, mientras lo escribe. */
  stream: Live | null;
  fresh: "entera" | "en vivo" | undefined;
  /** Nació en esta visita: entra animado. Lo guardado, no. */
  animate: boolean;
  autoRead: boolean;
  voice: TurnVoice;
  /** La cara de partida del rol (Enseñanza). */
  expression?: string;
  onTyped: () => void;
  onRetry: () => void;
  onVote: (vote: "up" | "down") => void;
  onSources: (sources: AskSource[], focus: number | null, trigger: HTMLElement) => void;
  /** Pilo suena o calla: la cara de la cabecera mueve el pico con el audio. */
  onSound: (on: boolean) => void;
  onVoiceLost: () => void;
  /** Esta respuesta está entre las guardadas de la cuenta. */
  saved?: boolean;
  /** Se está guardando o quitando. */
  saving?: boolean;
  /** Guardar o quitar de las guardadas. Sin cuenta, quien lo recibe invita a registrarse. */
  onSave?: (trigger: HTMLElement, viaKeyboard: boolean) => void;
}) {
  useLang();
  const a = turn.answer;
  const pending = !a && !turn.error;
  const streaming = pending && Boolean(stream?.text);
  const working = pending && !streaming;
  const incomplete = Boolean(a && turn.incomplete);
  const text = a?.text ?? stream?.text ?? "";
  const sources = useMemo(() => a?.sources ?? stream?.meta?.sources ?? [], [a, stream?.meta]);
  const parsed = useMemo(() => parseAnswer(text, { streaming }), [text, streaming]);
  const elapsed = useElapsed(stream?.startedAt, working);
  const step = working ? waitingLine({ steps: stream?.steps ?? [], meta: stream?.meta ?? null, seconds: elapsed }) : "";
  const tip = working ? waitingTip(elapsed, seedOf(turn.id)) : null;

  const question = useRef<HTMLDivElement>(null);
  const answer = useRef<HTMLDivElement>(null);
  const stepText = useRef<HTMLSpanElement>(null);
  useEnter(question, animate);
  useEnter(answer, animate);
  // Cada paso releva al anterior con un fundido corto.
  useLayoutEffect(() => {
    const el = stepText.current;
    if (!step || !el || reducedMotion()) return;
    const tween = gsap.fromTo(el, { opacity: 0, y: 6 }, { opacity: 1, y: 0, duration: 0.2, ease: "expo.out", clearProps: "opacity,transform" });
    return () => {
      tween.progress(1).kill();
    };
  }, [step]);

  /* --- La voz: frase por frase, la que suena se resalta ----------------------------------- */

  const [reading, setReading] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);
  const readRun = useRef(0);
  const enriched = useMemo(
    () =>
      enrichSpokenSentences(
        parsed.sentences.map((x) => x.spoken),
        // En un modo secreto, la voz no antepone muletillas: el personaje ya trae las suyas.
        { mood: a?.mood ?? voice.mood, expressionsEnabled: voice.expressions && !isSuperMode(turn.modo), patterns: voice.patterns, modulationEnabled: voice.modulation, baseRate: voice.rate, basePitch: voice.pitch },
      ),
    [parsed, a?.mood, turn.modo, voice.mood, voice.expressions, voice.patterns, voice.modulation, voice.rate, voice.pitch],
  );
  const spoken = enriched.sentences;
  // En un modo secreto cada frase se dice con su emoción (pregunta/super/modes.ts) y la voz cambia de paso.
  const superMode = isSuperMode(turn.modo) ? turn.modo : null;
  const toneOf = (k: number) => (superMode && a ? voiceTone(superMode, a.text, parsed.sentences[k]?.spoken ?? "") : undefined);
  const saidAt = (k: number) => ({ portal: voice.portal, advanced: voice.advanced, rol: voice.rol, tone: toneOf(k) });
  const prefetch = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (spoken[k]) prefetchOfficial([spoken[k]], saidAt(k));
  };

  // Con la voz encendida, el audio de las primeras frases se pide en cuanto la respuesta está completa.
  useEffect(() => {
    if (a && fresh && autoRead && !incomplete) prefetch(0, 2);
    // `prefetch` lee lo mismo que ya está en la lista.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, fresh, autoRead, incomplete, spoken, voice.advanced, voice.portal, voice.rol]);

  const read = async () => {
    if (reading !== null) {
      readRun.current += 1;
      stopOfficial();
      setReading(null);
      onSound(false);
      return;
    }
    const mine = ++readRun.current;
    for (let k = 0; k < parsed.sentences.length; k++) {
      if (mine !== readRun.current) return;
      if (!spoken[k]?.trim()) continue;
      setReading(k);
      // Mientras suena esta frase, se piden las dos que siguen: así no hay pausas.
      prefetch(k + 1, k + 3);
      const result = await sayOfficial(spoken[k], { ...saidAt(k), rate: enriched.rate * (superMode ? SUPER[superMode].voice.rate : 1), onSound: (on) => mine === readRun.current && onSound(on) });
      if (result === "cancelado") break;
      if (result === "sin voz") {
        // Nunca otra voz: se avisa y queda el texto.
        if (mine === readRun.current) onVoiceLost();
        break;
      }
    }
    if (mine === readRun.current) {
      setReading(null);
      onSound(false);
    }
  };

  // Al quitar el turno, su lectura se suelta.
  useEffect(
    () => () => {
      if (readRun.current > 0) onSound(false);
      readRun.current += 1;
    },
    // Solo al desmontar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Una respuesta que llega entera se escribe sola, breve; la que se vio escribir en vivo, no.
  const { shown, typing, finish } = useTypewriter(parsed.count, Boolean(a) && fresh === "entera", () => {
    onTyped();
    if (autoRead && !incomplete) void read();
  });

  // La que se escribió en vivo se lee una sola vez, ya completa.
  const readLive = useRef(read);
  readLive.current = read;
  useEffect(() => {
    if (!a || fresh !== "en vivo") return;
    onTyped();
    if (autoRead && !incomplete) void readLive.current();
    // Solo al llegar la respuesta final.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Boolean(a), fresh]);

  const copy = async () => {
    try {
      const listed = a && showsSources(a) ? a.sources.map((s) => `[${s.n}] ${s.title}${s.path ? ` · ${/^https?:/i.test(s.path) ? s.path : `${window.location.origin}${s.path}`}` : ""}`) : [];
      await navigator.clipboard.writeText([toPlain(parsed), listed.join("\n")].filter(Boolean).join("\n\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* sin portapapeles */
    }
  };

  // Lo que respondió la app en un modo secreto no es una respuesta oficial: sin notas, sin guardar y sin voto.
  const notes = a && !incomplete && !turn.local ? notesOf(a) : [];
  const listed = a && showsSources(a) ? a.sources : [];
  const mood: MojiMood = pending ? "piensa" : a ? (incomplete ? "duda" : MOOD_OF[a.kind]) : "cuidado";

  return (
    <>
      <div className="pa-me" ref={question}>
        <span className="pa-sr">{tr("Usted:")} </span>
        {turn.file && (
          <span className="px-asked">
            <FileChip name={turn.file.name} detail={trn(turn.file.total, tr("{n} pasaje · leído aquí"), tr("{n} pasajes · leído aquí"))} />
          </span>
        )}
        {turn.q}
      </div>

      <div className="pa-msg" ref={answer}>
        <div className="pa-msg__face">
          <Pilo size="100%" mood={mood} emotion={pending ? (working ? waitingFace(elapsed) : undefined) : a?.expression || a?.mood || expression} talking={reading !== null} />
        </div>
        <div className="pa-msg__body">
          <span className="pa-sr">Mr. Pilo: </span>
          {working && (
            <div className="pa-steps">
              <span ref={stepText}>{step}</span>
              <span className="ap-dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
            </div>
          )}
          {tip && (
            <p className="ap-tip" key={tip}>
              {tip}
            </p>
          )}

          {turn.file && <FileLog file={turn.file} />}

          {text && (
            <div className="pa-bubble" aria-busy={pending}>
              <AnswerText
                parsed={parsed}
                shown={shown}
                typing={typing}
                streaming={streaming}
                reading={reading}
                sources={sources}
                active={null}
                onSource={(n, trigger) => onSources(sources, n, trigger)}
                onFinish={finish}
              />
            </div>
          )}

          {turn.error && (
            <div className="pa-warn" role="alert">
              <span>{a ? tr("{error} Lo que alcanzó a escribir quedó incompleto.", { error: turn.error }) : turn.error}</span>
              <button type="button" onClick={onRetry}>
                {tr("Preguntar de nuevo")}
              </button>
            </div>
          )}

          {a && incomplete && !turn.error && (
            <div className="pa-warn">
              <span>{tr("Detuvo la respuesta: lo escrito quedó incompleto.")}</span>
              <button type="button" onClick={onRetry}>
                {tr("Preguntar de nuevo")}
              </button>
            </div>
          )}

          {a && !typing && (
            <>
              {turn.file && !incomplete && <FileFoot text={() => a.text} />}
              {notes.map((note) => (
                <p key={note} className="pa-note">
                  {note}
                </p>
              ))}
              {a.unknown && a.unknown.length > 0 && <p className="pa-note">{tr("Revise estos números antes de citarlos: no los encontré en las fuentes ({numbers}).", { numbers: a.unknown.join(", ") })}</p>}
              <div className="pa-after">
                {listed.length > 0 && (
                  <button type="button" className="pa-src" aria-label={`${tr("Fuentes")} (${listed.length}): ${listed[0].title}`} onClick={(e) => onSources(listed, null, e.currentTarget)}>
                    <span className="pa-src__t">{listed[0].title}</span>
                    {listed.length > 1 && <span className="pa-src__n">+{listed.length - 1}</span>}
                  </button>
                )}
                {listed.length === 0 && a.grounding === "general" && !incomplete && !turn.local && !turn.error && text.trim() && <span className="pa-gen">{tr("Orientación general · sin fuente UDES")}</span>}
                {onSave && !incomplete && !turn.error && !turn.local && text.trim() && (
                  <button type="button" className="pa-src pa-keep" aria-pressed={saved} aria-busy={saving || undefined} disabled={saving} onClick={(e) => onSave(e.currentTarget, e.detail === 0)}>
                    {saved ? Icon.check : Icon.mark}
                    {saved ? tr("Guardada") : tr("Guardar")}
                  </button>
                )}
                {voice.advanced && text.trim() && (
                  <button type="button" className="pa-act" aria-pressed={reading !== null} aria-label={reading !== null ? tr("Dejar de leer") : tr("Escuchar la respuesta con la voz de Pilo")} onClick={() => void read()}>
                    {reading !== null ? Icon.stop : Icon.listen}
                  </button>
                )}
                <button type="button" className="pa-act" aria-label={copied ? tr("Copiada") : tr("Copiar la respuesta con sus fuentes")} aria-pressed={copied} onClick={copy}>
                  {copied ? Icon.check : Icon.copy}
                </button>
                {a.kind !== "regla" && !incomplete && !turn.local && (
                  <>
                    <button type="button" className="pa-act" aria-pressed={turn.vote === "up"} aria-label={tr("Me sirvió")} onClick={() => onVote("up")}>
                      {Icon.up}
                    </button>
                    <button type="button" className="pa-act" aria-pressed={turn.vote === "down"} aria-label={tr("No me sirvió")} onClick={() => onVote("down")}>
                      {Icon.down}
                    </button>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
