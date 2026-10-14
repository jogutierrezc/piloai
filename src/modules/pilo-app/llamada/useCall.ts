/* =============================================================================
   Mr. Pilo · la app · la llamada · el ciclo.

   escucha → piensa → habla → escucha. El oído es el reconocimiento de voz del
   navegador; el cerebro, el mismo pedido del chat (por eso sabe lo de la UDES);
   la voz, la oficial de Pilo, frase por frase: la primera suena cuando llega,
   sin esperar a que la respuesta termine, y la siguiente se pide mientras la
   anterior suena.

   Mientras Pilo habla, el micrófono se apaga: sin auriculares recogería su
   propia voz. Para interrumpirlo se toca a Pilo (interrupt).

   Quien usa esto pone lo que cambia entre el chat y la llamada: cómo se pregunta
   (ask) y cómo se dice una frase (speak), con la voz y el espacio del Pilo
   abierto.
   ========================================================================== */

import { useCallback, useEffect, useRef, useState } from "react";
import { buildHistory } from "../../../components/pilo/ai/client";
import { tr } from "../../../components/pilo/i18n";
import { spokenText, takeSentences } from "./logic";
import { speechLang, spokenQuestion } from "./idiomas";
import type { CallLang } from "./idiomas";
import { openMeter, VoiceGate } from "./vad";
import type { Meter } from "./vad";

export type CallPhase = "conectando" | "escucha" | "piensa" | "habla" | "pausa" | "error" | "fin";

export interface CallLine {
  who: "yo" | "pilo";
  text: string;
}

interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

const recognitionCtor = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Qué se le dice a la persona cuando la llamada se corta, en palabras y con salida. En el idioma de ahora. */
export function callError(code: string): string {
  switch (code) {
    case "not-allowed":
      return tr("El navegador no dejó usar el micrófono. Permítalo en el candado de la barra de direcciones y vuelva a llamar.");
    case "service-not-allowed":
      return tr("Este navegador no deja usar el reconocimiento de voz aquí. Pruebe con Chrome, Edge o Safari.");
    case "audio-capture":
      return tr("No encuentro un micrófono. Conecte uno y vuelva a llamar.");
    case "network":
      return tr("El reconocimiento de voz perdió la conexión. Revise internet y vuelva a llamar.");
    case "sin_voz":
      return tr("La voz de Pilo no está disponible ahora. Puede seguir por escrito en el chat.");
    default:
      return tr("No pude hablar con Pilo ahora. Vuelva a intentarlo en un momento.");
  }
}

export interface CallOptions {
  lang: CallLang;
  /** Pregunta al Pilo abierto. Llama a `onDelta` con cada pedazo que llega; se cumple con la respuesta entera. */
  ask: (question: string, history: { q: string; a: string }[], onDelta: (text: string) => void, signal: AbortSignal) => Promise<string>;
  /** Dice una frase con la voz oficial. `onSound` avisa cuando empieza y cuando deja de sonar. */
  speak: (text: string, onSound: (on: boolean) => void) => Promise<"sono" | "sin voz" | "cancelado">;
  /** Calla lo que suene ahora mismo. */
  hush: () => void;
  /** Pide por adelantado el audio de una frase que aún espera su turno: así no hay pausas entre una y otra. */
  prefetch?: (text: string) => void;
  /** Pone en pausa la voz de Pilo en cuanto se oye a la persona; `resumeVoice` la retoma si era ruido o eco. */
  pauseVoice?: () => void;
  resumeVoice?: () => void;
}

export function useCall({ lang, ask, speak, hush, prefetch, pauseVoice, resumeVoice }: CallOptions) {
  const [phase, setPhase] = useState<CallPhase>("conectando");
  const [heard, setHeard] = useState("");
  const [said, setSaid] = useState("");
  const [lines, setLines] = useState<CallLine[]>([]);
  const [sounding, setSounding] = useState(false);
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);

  // Todo lo que cambia sin que la pantalla tenga que pintarse vive aquí.
  const live = useRef({
    epoch: 0,
    phase: "conectando" as CallPhase,
    rec: null as Recognition | null,
    ctl: null as AbortController | null,
    history: [] as { q: string; a: string }[],
    muted: false,
    lang,
    ask,
    speak,
    hush,
    prefetch,
    pauseVoice,
    resumeVoice,
    // El micrófono que escucha mientras Pilo habla, para callarlo cuando la persona empieza.
    meter: null as Meter | null,
    meterTimer: 0,
    lastTick: 0,
    gate: new VoiceGate(),
    barge: null as { at: number; level: number; samples: number; hits: number; from: CallPhase; timer: number } | null,
    open: true,
  });
  live.current.lang = lang;
  live.current.ask = ask;
  live.current.speak = speak;
  live.current.hush = hush;
  live.current.prefetch = prefetch;
  live.current.pauseVoice = pauseVoice;
  live.current.resumeVoice = resumeVoice;

  const go = useCallback((next: CallPhase) => {
    live.current.phase = next;
    setPhase(next);
  }, []);

  const closeEar = useCallback(() => {
    const rec = live.current.rec;
    live.current.rec = null;
    if (!rec) return;
    rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* ya estaba cerrado */
    }
  }, []);

  const stopMeter = useCallback(() => {
    const run = live.current;
    window.clearInterval(run.meterTimer);
    window.clearTimeout(run.barge?.timer);
    run.barge = null;
    run.meter?.stop();
    run.meter = null;
  }, []);

  const fail = useCallback(
    (code: string) => {
      live.current.epoch += 1;
      stopMeter();
      closeEar();
      live.current.ctl?.abort();
      live.current.hush();
      setSounding(false);
      setError(callError(code));
      go("error");
    },
    [closeEar, go, stopMeter],
  );

  /** Pilo piensa y habla. Termina cuando dijo la última frase, y entonces vuelve a escuchar. */
  const answer = useCallback(
    async (heardText: string, listen: () => void) => {
      const run = live.current;
      const mine = ++run.epoch;
      const alive = () => run.epoch === mine;
      const ctl = new AbortController();
      run.ctl = ctl;
      closeEar();
      go("piensa");
      setHeard(heardText);
      setSaid("");
      setLines((l) => [...l, { who: "yo", text: heardText }]);

      let pending = "";
      let raw = "";
      let finished = false;
      let spoken = "";
      const queue: string[] = [];
      let waiting: (() => void) | null = null;
      const wake = () => waiting?.();

      // La voz: una frase tras otra, sin dejar silencios entre ellas.
      const talker = (async () => {
        for (;;) {
          while (!queue.length) {
            if (finished || !alive()) return;
            await new Promise<void>((resolve) => {
              waiting = resolve;
            });
            waiting = null;
          }
          if (!alive()) return;
          const sentence = queue.shift() as string;
          if (run.phase !== "habla") go("habla");
          spoken = spoken ? `${spoken} ${sentence}` : sentence;
          setSaid(spoken);
          const outcome = await run.speak(sentence, (on) => alive() && setSounding(on));
          if (!alive()) return;
          if (outcome === "sin voz") {
            // Sin voz no hay llamada: lo que queda se lee en pantalla.
            queue.length = 0;
            fail("sin_voz");
            return;
          }
        }
      })();

      try {
        const full = await run.ask(
          spokenQuestion(heardText, run.lang),
          run.history,
          (piece) => {
            if (!alive()) return;
            raw += piece;
            pending += piece;
            // El espacio del final se conserva: el pedazo siguiente empieza donde este terminó.
            const out = takeSentences(spokenText(pending) + (/\s$/.test(pending) ? " " : ""), false);
            pending = out.rest;
            if (out.sentences.length) {
              queue.push(...out.sentences);
              out.sentences.forEach((s) => run.prefetch?.(s));
              wake();
            }
          },
          ctl.signal,
        );
        if (!alive()) return;
        // Si la respuesta llegó entera de una vez (sin pedazos), todo está aún por decir.
        if (!raw && full) pending = full;
        raw = raw || full;
        const tail = takeSentences(spokenText(pending), true).sentences;
        queue.push(...tail);
        tail.forEach((s) => run.prefetch?.(s));
        finished = true;
        wake();
        run.history = buildHistory([...run.history, { q: heardText, a: raw }]);
        await talker;
        if (!alive()) return;
        setLines((l) => [...l, { who: "pilo", text: spokenText(raw) }]);
        setSounding(false);
        if (run.muted) go("pausa");
        else listen();
      } catch (e) {
        finished = true;
        wake();
        if (!alive() || (e as { code?: string }).code === "cancelado" || (e as Error).name === "AbortError") return;
        fail("pilo");
      }
    },
    [closeEar, fail, go],
  );

  /** Abre el oído: una frase de la persona, y se pasa al cerebro. */
  const listen = useCallback(() => {
    const run = live.current;
    const Ctor = recognitionCtor();
    if (!Ctor) return fail("service-not-allowed");
    closeEar();
    const rec = new Ctor();
    rec.lang = speechLang(run.lang);
    rec.continuous = false;
    rec.interimResults = true;
    let finalText = "";
    let restarts = 0;
    run.rec = rec;
    go("escucha");
    setHeard("");
    rec.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const piece = e.results[i][0]?.transcript ?? "";
        if (e.results[i].isFinal) finalText += `${piece} `;
        else interim += piece;
      }
      setHeard((finalText + interim).trim());
    };
    rec.onerror = (e) => {
      // Silencio o nada que oír: se vuelve a abrir el oído, sin molestar.
      if (e.error === "no-speech" || e.error === "aborted") return;
      fail(e.error);
    };
    rec.onend = () => {
      if (run.rec !== rec) return;
      const text = finalText.replace(/\s+/g, " ").trim();
      run.rec = null;
      if (text) return void answer(text, listen);
      // Nadie habló: se vuelve a escuchar, con un tope para no girar en falso si el navegador cierra en seco.
      if (run.phase === "escucha" && !run.muted && restarts++ < 50) window.setTimeout(() => run.phase === "escucha" && !run.rec && listen(), 250);
    };
    try {
      rec.start();
    } catch {
      /* ya estaba abierto */
    }
  }, [answer, closeEar, fail, go]);

  /* --- Hablar encima de Pilo ------------------------------------------------------------------- */

  /** Hay una voz mientras Pilo habla o piensa: se lo pausa y se abre el oído, y a los 340 ms se decide. */
  const beginBarge = useCallback(
    (level: number) => {
      const run = live.current;
      if (run.barge) return;
      const from = run.phase;
      run.pauseVoice?.();
      setSounding(false);
      listen();
      run.barge = { at: performance.now(), level, samples: 0, hits: 0, from, timer: window.setTimeout(() => settleBarge(), 340) };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listen],
  );

  /** Pausado Pilo, ¿sigue la voz? Si sí, era la persona: Pilo cede el turno. Si no, era eco o ruido: Pilo sigue. */
  const settleBarge = useCallback(() => {
    const run = live.current;
    const b = run.barge;
    run.barge = null;
    if (!b) return;
    const real = b.samples >= 3 && b.hits / b.samples >= 0.6;
    if (real) {
      run.epoch += 1;
      run.ctl?.abort();
      run.hush();
      setSounding(false);
      return;
    }
    // Eco o ruido: el umbral aprende ese nivel para no volver a caer en lo mismo.
    run.gate.floor = Math.max(run.gate.floor, b.level / 2.2);
    closeEar();
    go(b.from);
    run.resumeVoice?.();
  }, [closeEar, go]);

  const tickMeter = () => {
    const run = live.current;
    const meter = run.meter;
    if (!meter) return;
    const now = performance.now();
    const dt = now - run.lastTick;
    run.lastTick = now;
    const level = meter.level();
    const event = run.gate.push(level, dt);
    const b = run.barge;
    if (b) {
      // Se cuenta solo lo que suena después de pausar a Pilo: lo anterior puede ser su propio eco.
      if (now - b.at > 120) {
        b.samples += 1;
        if (run.gate.loud(level)) b.hits += 1;
      }
      return;
    }
    if (event === "voz" && !run.muted && (run.phase === "habla" || run.phase === "piensa")) beginBarge(level);
  };

  /** Empezar: el primer turno es de la persona. */
  const start = useCallback(() => {
    live.current.muted = false;
    setMuted(false);
    setError("");
    setLines([]);
    live.current.history = [];
    live.current.open = true;
    listen();
    // Con el micrófono abierto durante toda la llamada, Pilo se calla en cuanto la persona habla.
    if (!live.current.meter) {
      void openMeter().then((meter) => {
        const run = live.current;
        if (!meter) return;
        if (!run.open || run.meter) return meter.stop();
        run.meter = meter;
        run.lastTick = performance.now();
        run.gate = new VoiceGate();
        run.meterTimer = window.setInterval(() => tickMeter(), 40);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listen]);

  /** Tocar a Pilo mientras habla o piensa: se calla y escucha. */
  const interrupt = useCallback(() => {
    const run = live.current;
    if (run.phase !== "habla" && run.phase !== "piensa") return;
    run.epoch += 1;
    run.ctl?.abort();
    run.hush();
    setSounding(false);
    if (run.muted) go("pausa");
    else listen();
  }, [go, listen]);

  const mute = useCallback(
    (on: boolean) => {
      const run = live.current;
      run.muted = on;
      setMuted(on);
      if (on && run.barge) {
        window.clearTimeout(run.barge.timer);
        run.barge = null;
      }
      if (on) {
        if (run.phase === "escucha") {
          closeEar();
          go("pausa");
        }
      } else if (run.phase === "pausa") listen();
    },
    [closeEar, go, listen],
  );

  const end = useCallback(() => {
    const run = live.current;
    run.epoch += 1;
    run.open = false;
    stopMeter();
    closeEar();
    run.ctl?.abort();
    run.hush();
    setSounding(false);
    go("fin");
  }, [closeEar, go, stopMeter]);

  // Si la pantalla se cierra por cualquier camino, todo se calla.
  useEffect(
    () => () => {
      const run = live.current;
      run.epoch += 1;
      run.open = false;
      stopMeter();
      closeEar();
      run.ctl?.abort();
      run.hush();
    },
    [closeEar, stopMeter],
  );

  // Cambiar de idioma en plena llamada: el oído se vuelve a abrir en el nuevo.
  const firstLang = useRef(lang);
  useEffect(() => {
    if (firstLang.current === lang) return;
    firstLang.current = lang;
    if (live.current.phase === "escucha") listen();
  }, [lang, listen]);

  return { phase, heard, said, lines, sounding, error, muted, start, interrupt, mute, end };
}
