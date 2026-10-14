/* =============================================================================
   Intranet · Mr. Pilo con IA · la voz propia de Pilo: NVIDIA (0101) o Fish
   Audio (0102).

   La voz de Pilo sale de una muestra: 3 a 10 segundos de alguien leyendo con
   calma. Cada muestra es un «estilo» (cercano, formal…): uno es el de siempre
   y Pregúntele a Pilo puede tener el suyo. Las muestras se suben o se graban
   aquí, se dejan en WAV mono de 22 kHz y van al bucket privado pilo-voz; la
   lista de estilos se guarda con «Guardar cambios», como lo demás.

   NVIDIA (Magpie TTS Zeroshot) clona la muestra en cada lectura. Fish Audio
   necesita crear antes la voz con la muestra (un botón por estilo) y además
   entiende un tono por estilo: «[calm]», «[excited]»… También sirve una voz
   ya creada en Fish Audio: se pega su id (o su enlace) sin subir muestra.
   ========================================================================== */

import { useEffect, useRef, useState } from "react";
import { FISH_MODELS, fishVoiceId, looksLikeFunctionId } from "../../../components/pilo/ai/logic";
import type { VoiceStyle } from "../../../components/pilo/ai/logic";
import { cloneFishVoice, probeVoice } from "../../../components/pilo/ai/client";
import type { EditorApi } from "./sections";
import { Group, KeyField, StatusMark } from "./ui";
import { MAX_SECONDS, prepareSample, removeSample, sampleUrl, startRecording, styleId, uploadSample } from "./voice-sample";

export type OwnVoice = "nvidia" | "fishaudio";

/** Lo que se le propone leer a quien graba: unos 6 segundos, con la entonación de Pilo. */
const SCRIPT = "Hola, soy Pilo. Te acompaño a conocer las cifras, los proyectos y los avances de la Universidad de Santander.";
const TEST_LINE = "Hola, soy Pilo. Le cuento cómo va el Plan de Desarrollo Institucional de la UDES.";

const LANGUAGES = [
  ["es-US", "Español"],
  ["en-US", "Inglés"],
] as const;

/** Las etiquetas de tono de Fish Audio que le quedan a Pilo. */
export const FISH_TONES = [
  ["", "Natural (el de la muestra)"],
  ["calm", "Tranquilo"],
  ["confident", "Seguro"],
  ["happy", "Alegre"],
  ["excited", "Entusiasta"],
  ["empathetic", "Empático"],
  ["curious", "Curioso"],
  ["relaxed", "Relajado"],
  ["proud", "Orgulloso"],
  ["soft tone", "Suave"],
] as const;

const FISH_MODEL_LABEL: Record<(typeof FISH_MODELS)[number], string> = {
  "s2.1-pro-free": "S2.1 Pro gratis (hasta el 30 nov. 2026)",
  "s2.1-pro": "S2.1 Pro (de pago)",
  "s2-pro": "S2 Pro (de pago)",
  s1: "S1 (de pago)",
};

const NAME: Record<OwnVoice, string> = { nvidia: "NVIDIA", fishaudio: "Fish Audio" };

type Note = { tone: "ok" | "fail" | "busy"; text: string } | null;

let player: HTMLAudioElement | null = null;
async function play(src: string) {
  player?.pause();
  const audio = new Audio(src);
  player = audio;
  await audio.play();
  await new Promise<void>((resolve) => {
    audio.onended = () => resolve();
    audio.onerror = () => resolve();
    audio.onpause = () => resolve();
  });
}

export function VoiceStyles({ ed, provider }: { ed: EditorApi; provider: OwnVoice }) {
  const { s, setS, set, dirty, keys } = ed;
  const [name, setName] = useState("");
  const [fishName, setFishName] = useState("");
  const [fishInput, setFishInput] = useState("");
  const [note, setNote] = useState<Note>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [recording, setRecording] = useState<{ stop: () => Promise<Blob>; cancel: () => void; since: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const fish = provider === "fishaudio";
  const who = NAME[provider];

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setElapsed((Date.now() - recording.since) / 1000), 200);
    return () => window.clearInterval(timer);
  }, [recording]);
  useEffect(() => () => recording?.cancel(), [recording]);

  const functionIdOk = !s.speech_function_id || looksLikeFunctionId(s.speech_function_id);
  const main = s.voice_styles.find((x) => x.id === s.voice_style) ?? s.voice_styles[0];
  const patchStyle = (id: string, patch: Partial<VoiceStyle>) =>
    setS((prev) => ({ ...prev, voice_styles: prev.voice_styles.map((x) => (x.id === id ? { ...x, ...patch } : x)) }));

  /** Prepara, sube y agrega el estilo. */
  async function add(file: Blob) {
    const label = name.trim() || (s.voice_styles.length === 0 ? "Pilo" : `Estilo ${s.voice_styles.length + 1}`);
    setBusy("subir");
    setNote({ tone: "busy", text: "Preparando la muestra…" });
    try {
      const sample = await prepareSample(file);
      setNote({ tone: "busy", text: "Subiendo la muestra…" });
      const style = await uploadSample(
        styleId(
          label,
          s.voice_styles.map((x) => x.id),
        ),
        label,
        sample,
      );
      setS((prev) => ({ ...prev, voice_styles: [...prev.voice_styles, style], voice_style: prev.voice_style || style.id }));
      setName("");
      setNote({
        tone: "ok",
        text: `Lista «${style.name}»: ${style.seconds.toLocaleString("es-CO")} s${sample.cut ? ` (se dejaron los primeros ${MAX_SECONDS})` : ""}. Guarde los cambios${fish ? " y cree su voz en Fish Audio" : " para que Pilo la use"}.`,
      });
    } catch (error) {
      setNote({ tone: "fail", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  /** Una voz ya creada en Fish Audio: un estilo sin muestra, con su id. */
  function addExisting() {
    const id = fishVoiceId(fishInput);
    if (!id) {
      setNote({ tone: "fail", text: "Pegue el id de la voz (32 letras y números) o su enlace de fish.audio." });
      return;
    }
    const label = fishName.trim() || (s.voice_styles.length === 0 ? "Pilo" : `Estilo ${s.voice_styles.length + 1}`);
    const style: VoiceStyle = {
      id: styleId(
        label,
        s.voice_styles.map((x) => x.id),
      ),
      name: label,
      path: "",
      seconds: 0,
      fish_id: id,
    };
    setS((prev) => ({ ...prev, voice_styles: [...prev.voice_styles, style], voice_style: prev.voice_style || style.id }));
    setFishName("");
    setFishInput("");
    setNote({ tone: "ok", text: `Agregada «${style.name}» con la voz ${id.slice(0, 8)}… de Fish Audio. Guarde los cambios y pruébela.` });
  }

  async function record() {
    if (recording) {
      const current = recording;
      setRecording(null);
      await add(await current.stop());
      return;
    }
    try {
      const rec = await startRecording();
      setElapsed(0);
      setRecording({ ...rec, since: Date.now() });
      setNote({ tone: "busy", text: `Grabando: lea la frase de abajo con calma. Se detiene sola a los ${MAX_SECONDS + 2} s.` });
    } catch (error) {
      const denied = (error as Error).name === "NotAllowedError";
      setNote({ tone: "fail", text: denied ? "El navegador no dio permiso para usar el micrófono." : (error as Error).message });
    }
  }

  async function listen(style: VoiceStyle) {
    setBusy(`oir:${style.id}`);
    try {
      await play(await sampleUrl(style.path));
    } catch (error) {
      setNote({ tone: "fail", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function test(style: VoiceStyle) {
    if (dirty) {
      setNote({ tone: "fail", text: "Guarde los cambios para probar la voz: la función del servidor usa lo guardado." });
      return;
    }
    setBusy(`probar:${style.id}`);
    setNote({ tone: "busy", text: `Pidiendo a ${who} la voz «${style.name}»…` });
    const result = await probeVoice(TEST_LINE, style.id);
    if ("error" in result) {
      setNote({ tone: "fail", text: result.error });
    } else {
      setNote({ tone: "ok", text: `Sonó la voz de ${who} «${style.name}» (${(result.ms / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1 })} s).` });
      const url = URL.createObjectURL(result.audio);
      try {
        await play(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    setBusy(null);
  }

  async function clone(style: VoiceStyle) {
    if (!ed.saved.voice_styles.some((x) => x.id === style.id && x.path === style.path)) {
      setNote({ tone: "fail", text: "Guarde los cambios primero: Fish Audio toma la muestra guardada." });
      return;
    }
    setBusy(`clonar:${style.id}`);
    setNote({ tone: "busy", text: `Creando en Fish Audio la voz «${style.name}»…` });
    try {
      const made = await cloneFishVoice(style.id);
      patchStyle(style.id, { fish_id: made.id });
      const training = made.state && made.state !== "trained";
      setNote({ tone: "ok", text: `Voz creada en Fish Audio${training ? " (se está preparando: pruébela en un minuto)" : ""}. Guarde los cambios.` });
    } catch (error) {
      setNote({ tone: "fail", text: (error as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function remove(style: VoiceStyle) {
    setS((prev) => {
      const styles = prev.voice_styles.filter((x) => x.id !== style.id);
      const portals = Object.fromEntries(Object.entries(prev.voice_portal_styles).filter(([, id]) => id !== style.id));
      return { ...prev, voice_styles: styles, voice_style: prev.voice_style === style.id ? (styles[0]?.id ?? "") : prev.voice_style, voice_portal_styles: portals };
    });
    // Si nunca se guardó, el archivo no lo usa nadie: se borra ya.
    if (style.path && !ed.saved.voice_styles.some((x) => x.path === style.path)) void removeSample(style.path);
  }

  const missing = s.needs0101 ? "0101" : fish && s.needs0102 ? "0102" : "";
  if (missing) {
    return (
      <Group title={`Voz de ${who}`}>
        <p className="pis-warn">Falta aplicar la migración {missing} en la base para guardar la voz de {who} y sus muestras.</p>
      </Group>
    );
  }

  return (
    <Group title={`Voz de ${who}`} aside={<small>{fish ? "Clona la voz de una muestra · tono por estilo" : "Magpie TTS Zeroshot · clona la voz de una muestra"}</small>}>
      <p className="pis-lead">
        Pilo habla con la voz de una muestra de 3 a 10 segundos. Use una grabación con permiso de quien habla, sin ruido ni música, leída con el tono que quiere para
        Pilo.
      </p>

      {fish ? (
        <>
          <KeyField which="fishaudio" label="Clave de Fish Audio (fish.audio › API Keys)" has={keys?.keys?.fishaudio?.has ?? false} last4={keys?.keys?.fishaudio?.last4 ?? ""} />
          <div className="pis-grid">
            <label>
              Modelo
              <select value={s.fish_model} onChange={(e) => set("fish_model", e.target.value)}>
                {FISH_MODELS.map((m) => (
                  <option key={m} value={m}>
                    {FISH_MODEL_LABEL[m]}
                  </option>
                ))}
              </select>
              <small className="pis-small">El gratuito tiene uso razonable, sin tope de caracteres. Después del 30 de noviembre, Fish Audio avisará las condiciones.</small>
            </label>
          </div>
        </>
      ) : (
        <>
          <KeyField which="nvidia" label="Clave de NVIDIA (build.nvidia.com, la misma del texto)" has={keys?.keys?.nvidia?.has ?? false} last4={keys?.keys?.nvidia?.last4 ?? ""} />
          <div className="pis-grid pis-grid--3">
            <label>
              Function-id de Magpie TTS Zeroshot
              <input
                value={s.speech_function_id}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                spellCheck={false}
                aria-invalid={!functionIdOk || undefined}
                onChange={(e) => set("speech_function_id", e.target.value.trim())}
              />
              <small className={functionIdOk ? "pis-small" : "pis-error"}>
                {functionIdOk ? "En build.nvidia.com › magpie-tts-zeroshot, en el ejemplo de la API (function-id)." : "Debe ser un UUID como el del ejemplo de la API."}
              </small>
            </label>
            <label>
              Idioma
              <select value={s.voice_language} onChange={(e) => set("voice_language", e.target.value)}>
                {LANGUAGES.map(([id, text]) => (
                  <option key={id} value={id}>
                    {text} ({id})
                  </option>
                ))}
              </select>
            </label>
            <label>
              Parecido a la muestra · {s.voice_quality}
              <input type="range" min={1} max={40} step={1} value={s.voice_quality} onChange={(e) => set("voice_quality", Number(e.target.value))} />
              <small className="pis-small">Más alto: más parecida y más lenta. 20 es un buen punto.</small>
            </label>
          </div>
        </>
      )}

      <div className="pis-voices">
        <h4>Estilos de voz</h4>
        {s.voice_styles.length === 0 ? (
          <p className="pis-small">Todavía no hay muestras. Suba o grabe la primera: será la voz de Pilo.</p>
        ) : (
          <ul>
            {s.voice_styles.map((style) => {
              const ready = fish ? Boolean(style.fish_id) : Boolean(s.speech_function_id && style.path);
              return (
                <li key={style.id} data-main={style.id === main?.id || undefined}>
                  <label className="pis-voices__main">
                    <input type="radio" name="voz-principal" checked={style.id === main?.id} onChange={() => set("voice_style", style.id)} />
                    <span>
                      <strong>{style.name}</strong>
                      <small>
                        {style.path ? `${style.seconds.toLocaleString("es-CO")} s` : "Voz de Fish Audio, sin muestra"}
                        {style.id === main?.id ? " · la de siempre" : ""}
                        {s.voice_portal_styles.pregunta === style.id ? " · Pregúntele a Pilo" : ""}
                        {fish ? (style.fish_id ? ` · voz ${style.fish_id.slice(0, 8)}…` : " · falta su voz en Fish Audio") : ""}
                        {!fish && !style.path ? " · solo sirve con Fish Audio" : ""}
                      </small>
                    </span>
                  </label>
                  {fish && (
                    <label className="pis-voices__tone">
                      <span className="sr-only">Tono de «{style.name}»</span>
                      <select value={style.tone ?? ""} onChange={(e) => patchStyle(style.id, { tone: e.target.value })}>
                        {FISH_TONES.map(([id, text]) => (
                          <option key={id} value={id}>
                            {text}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <span className="pis-voices__actions">
                    <button type="button" className="button-secondary" onClick={() => listen(style)} disabled={busy !== null || !style.path}>
                      {busy === `oir:${style.id}` ? "Sonando…" : "Oír muestra"}
                    </button>
                    {fish && style.path && (
                      <button type="button" className="button-secondary" onClick={() => clone(style)} disabled={busy !== null || !keys?.keys?.fishaudio?.has}>
                        {busy === `clonar:${style.id}` ? "Creando…" : style.fish_id ? "Crear de nuevo" : "Crear voz en Fish Audio"}
                      </button>
                    )}
                    <button type="button" className="button-primary" onClick={() => test(style)} disabled={busy !== null || !ready}>
                      {busy === `probar:${style.id}` ? "Probando…" : "Probar con Pilo"}
                    </button>
                    <button type="button" className="pis-link pis-link--danger" onClick={() => remove(style)} disabled={busy !== null}>
                      Quitar
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="pis-voices__add">
          <label>
            Nombre del estilo
            <input value={name} maxLength={40} placeholder={s.voice_styles.length === 0 ? "Pilo" : "Cercano, formal, entusiasta…"} onChange={(e) => setName(e.target.value)} />
          </label>
          <button type="button" className="button-secondary" onClick={() => fileInput.current?.click()} disabled={busy !== null || recording !== null}>
            {busy === "subir" ? "Preparando…" : "Subir audio"}
          </button>
          <button type="button" className={recording ? "button-primary pis-danger" : "button-secondary"} onClick={record} disabled={busy !== null}>
            {recording ? `Detener · ${elapsed.toLocaleString("es-CO", { maximumFractionDigits: 0 })} s` : "Grabar"}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="audio/*,.wav,.mp3,.m4a,.ogg"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void add(file);
            }}
          />
        </div>
        {fish && (
          <div className="pis-voices__add">
            <label>
              Nombre
              <input value={fishName} maxLength={40} placeholder="Pilo" onChange={(e) => setFishName(e.target.value)} />
            </label>
            <label>
              Voz ya creada en Fish Audio (id o enlace)
              <input value={fishInput} spellCheck={false} placeholder="https://fish.audio/m/… o el id" onChange={(e) => setFishInput(e.target.value)} />
            </label>
            <button type="button" className="button-secondary" onClick={addExisting} disabled={busy !== null || !fishInput.trim()}>
              Usar esta voz
            </button>
          </div>
        )}
        <p className="pis-small">
          Para grabar, lea: <q>{SCRIPT}</q> WAV, MP3 u OGG; se deja en WAV mono de 22 kHz, sin los silencios de los extremos y con máximo {MAX_SECONDS} s.
        </p>
      </div>

      {s.voice_styles.length > 1 && (
        <label className="pis-voices__portal">
          Estilo en Pregúntele a Pilo
          <select
            value={s.voice_portal_styles.pregunta ?? ""}
            onChange={(e) => {
              const { pregunta: _old, ...rest } = s.voice_portal_styles;
              set("voice_portal_styles", e.target.value ? { ...rest, pregunta: e.target.value } : rest);
            }}
          >
            <option value="">El de siempre ({main?.name})</option>
            {s.voice_styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name}
              </option>
            ))}
          </select>
        </label>
      )}

      {note && (
        <p role="status" className="pis-result">
          {note.tone === "busy" ? note.text : <StatusMark tone={note.tone}>{note.text}</StatusMark>}
        </p>
      )}
    </Group>
  );
}
