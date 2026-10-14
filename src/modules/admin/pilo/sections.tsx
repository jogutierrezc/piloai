/* =============================================================================
   Intranet · Mr. Pilo con IA · las secciones de configuración.

   Conexión      el servicio de texto, su clave y la prueba.
   Voz           la voz avanzada (NVIDIA, Free.ai u otro) o la del navegador.
   Dónde aparece las cuatro funciones, la tabla portal por portal y a quién
                 más se abren los informes de Impacto (0100).
   Uso           los topes, el uso de hoy y la bitácora de pedidos.

   Todo lo que se toca aquí espera a «Guardar cambios»; las claves no, se
   guardan al momento y nunca vuelven completas. «Pregúntele a Pilo», la
   memoria y el catálogo viven en sus propios archivos.
   ========================================================================== */

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Icon } from "../../../components/ui/Icon";
import { SpeakerIcon } from "../../../components/pilo/VoiceToggle";
import { speak } from "../../../components/pilo/voice";
import { sayWithPilo } from "../../../components/pilo/ai/client";
import { PORTAL_LABEL } from "../../../components/pilo/ai/config";
import type { Fn, Portal, PortalRule } from "../../../components/pilo/ai/config";
import type { ReportKind } from "../../../components/pilo/ai/logic";
import { ASK_LIMITS, PROVIDERS, usePiloLog } from "./store";
import type { KeyStatus, PiloSettings, ProbeResult, Provider } from "./store";
import { Group, KeyField, NumField, StatusMark, Switch } from "./ui";
import type { Tone } from "./ui";
import { VoiceStyles } from "./VoiceStyles";
import { WidgetGroup } from "./WidgetGroup";
import { ExtrasGroup } from "./ExtrasGroup";
import { VoiceExpressionsEditor } from "./VoiceExpressionsEditor";

export interface EditorApi {
  s: PiloSettings;
  /** Lo que está guardado en la base. */
  saved: PiloSettings;
  setS: Dispatch<SetStateAction<PiloSettings>>;
  set: <K extends keyof PiloSettings>(key: K, value: PiloSettings[K]) => void;
  setPortal: (id: Portal, patch: Partial<PortalRule>) => void;
  dirty: boolean;
  keys: KeyStatus | null | undefined;
  saveNow?: () => void;
  isSaving?: boolean;
  saveError?: string | null;
}

export type TestState = {
  state: "idle" | "busy" | "ok" | "fail";
  text: string;
  /** Lo que dijo la prueba (0110), si la función lo devolvió. */
  probe?: ProbeResult;
};

/** Lo que la prueba descubrió del proveedor, en palabras (0110). Una función anterior no lo dice: no se inventa. */
export function probeFindings(p: ProbeResult | undefined): { id: string; tone: Tone; title: string; detail: string }[] {
  if (!p) return [];
  const out: { id: string; tone: Tone; title: string; detail: string }[] = [];
  if (p.system_role === "system") {
    out.push({ id: "rol", tone: "ok", title: "Acepta el rol «system»", detail: "La persona de Pilo viaja aparte, como instrucción del sistema." });
  } else if (p.system_role === "user") {
    out.push({
      id: "rol",
      tone: "warn",
      title: "No acepta el rol «system»",
      detail: "Pilo pone su persona dentro del primer mensaje y responde igual. Para no gastar un pedido fallido en cada arranque, fije «Persona de Pilo» en «Dentro del mensaje».",
    });
  }
  if (p.stream === "sse") {
    out.push({ id: "partes", tone: "ok", title: "Responde por partes", detail: "La página muestra la respuesta mientras se escribe." });
  } else if (p.stream === "json") {
    out.push({ id: "partes", tone: "warn", title: "Ignora el pedido de responder por partes", detail: "Contesta entera: la página la verá aparecer de una vez, sin perder nada." });
  } else if (p.stream === "error") {
    out.push({
      id: "partes",
      tone: "fail",
      title: "Falló al responder por partes",
      detail: p.stream_error || "Pilo puede seguir respondiendo entero; apague «Responder por partes» para no insistir.",
    });
  }
  if (p.reasoning === true) {
    out.push({
      id: "razonamiento",
      tone: "warn",
      title: "El modelo razona aparte",
      detail: "Ese razonamiento gasta parte del tope de la respuesta. Si salen respuestas cortas o vacías, suba «Largo de la respuesta» o use un modelo sin razonamiento.",
    });
  } else if (p.reasoning === false) {
    out.push({ id: "razonamiento", tone: "ok", title: "No manda razonamiento aparte", detail: "Todo el tope de la respuesta se usa para escribirla." });
  }
  return out;
}

export const FNS: { id: Fn; name: string; short: string; desc: string }[] = [
  { id: "leer", name: "Escuchar", short: "Es", desc: "Lee en voz alta la página, un resumen o una explicación, con voz masculina." },
  { id: "resumir", name: "Resumir", short: "Re", desc: "Lo esencial de una página o tabla en tres a cinco frases, con su fuente." },
  { id: "sintetizar", name: "Sintetizar", short: "Si", desc: "Cruza las tablas y gráficas y saca hallazgos y preguntas para decidir." },
  { id: "explicar", name: "Explicar gráficas", short: "Ex", desc: "Cuenta cómo se lee una gráfica o tabla y qué muestra." },
];

export const PORTALS: { id: Portal; where: string }[] = [
  { id: "cifras", where: "Informes y tablas por sede" },
  { id: "pdi", where: "Pilares, proyectos y tablero" },
  { id: "observatorio", where: "Temas y boletines" },
  { id: "impacto", where: "Matriz, lazos y resultados" },
];

export const AUDIENCES = [
  ["admin", "Solo administración"],
  ["sesion", "Con sesión"],
  ["publico", "Público"],
] as const;

/** El selector de público, igual en todos los portales y en Pregúntele a Pilo. */
export function AudiencePicker({ value, label, onPick }: { value: string; label: string; onPick: (id: PortalRule["aud"]) => void }) {
  return (
    <span className="pis-seg pis-seg--sm" role="radiogroup" aria-label={label}>
      {AUDIENCES.map(([id, text]) => (
        <button key={id} type="button" role="radio" aria-checked={value === id} data-public={id === "publico" || undefined} onClick={() => onPick(id)}>
          {text}
        </button>
      ))}
    </span>
  );
}

/* --- Conexión ------------------------------------------------------------------------------ */

export function ConnectionSection({ ed, test, onTest }: { ed: EditorApi; test: TestState; onTest: () => void }) {
  const { s, setS, set, keys } = ed;
  const connected = Boolean(keys?.has_key && s.base_url);
  const findings = probeFindings(test.probe);
  const pickProvider = (p: Provider) =>
    setS((prev) => {
      const before = PROVIDERS[prev.provider];
      const next = PROVIDERS[p];
      return {
        ...prev,
        provider: p,
        // Si la dirección o el modelo eran los del proveedor anterior, se cambian por los del nuevo.
        base_url: !prev.base_url || prev.base_url === before.base ? next.base : prev.base_url,
        text_model: !prev.text_model || prev.text_model === before.model ? next.model : prev.text_model,
      };
    });
  const otherKeys = (Object.keys(PROVIDERS) as Provider[])
    .filter((p) => p !== s.provider && keys?.keys?.[p]?.has)
    .map((p) => `${PROVIDERS[p].label} (••••${keys?.keys?.[p]?.last4})`);

  return (
    <>
      <Group title="Servicio de texto" aside={<small>Elija el servicio y pegue su clave</small>}>
        <div className="pis-seg" role="radiogroup" aria-label="Servicio de texto">
          {(Object.keys(PROVIDERS) as Provider[]).map((p) => (
            <button key={p} type="button" role="radio" aria-checked={s.provider === p} onClick={() => pickProvider(p)}>
              {PROVIDERS[p].label}
            </button>
          ))}
        </div>
        <p className="pis-lead">{PROVIDERS[s.provider].hint}</p>

        {keys?.keys ? (
          <KeyField
            key={s.provider}
            which={s.provider}
            label={`Clave de ${PROVIDERS[s.provider].label}`}
            has={keys.keys[s.provider]?.has ?? false}
            last4={keys.keys[s.provider]?.last4 ?? ""}
          />
        ) : (
          <>
            <p className="pis-warn">Falta aplicar la migración 0091 para guardar una clave por servicio. Mientras tanto hay una sola clave.</p>
            <KeyField which="texto" label={`Clave de ${PROVIDERS[s.provider].label}`} has={keys?.has_key ?? false} last4={keys?.last4 ?? ""} />
          </>
        )}
        {otherKeys.length > 0 && <p className="pis-small">También hay clave guardada de {otherKeys.join(" y ")}.</p>}

        {(s.provider !== ed.saved.provider || s.text_model !== ed.saved.text_model) && (
          <div
            style={{
              margin: "1rem 0",
              padding: "0.85rem 1.1rem",
              background: "#eff6ff",
              border: "1.5px solid #2563eb",
              borderRadius: "8px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "0.75rem",
            }}
          >
            <div>
              <strong style={{ color: "#1d4ed8", display: "block", fontSize: "0.95rem" }}>
                ⚠️ Cambios pendientes de guardar en este servicio:
              </strong>
              <div style={{ fontSize: "0.85rem", color: "#334155", marginTop: "0.3rem", lineHeight: 1.5 }}>
                <div>Activo en el servidor: <strong>{PROVIDERS[ed.saved.provider]?.label}</strong> — modelo <code>{ed.saved.text_model || PROVIDERS[ed.saved.provider]?.model}</code></div>
                <div>Seleccionado en pantalla: <strong>{PROVIDERS[s.provider]?.label}</strong> — modelo <code>{s.text_model || PROVIDERS[s.provider]?.model}</code></div>
              </div>
            </div>
            {ed.saveNow && (
              <button
                type="button"
                className="button-primary"
                disabled={ed.isSaving}
                onClick={ed.saveNow}
                style={{ padding: "0.5rem 1rem", fontWeight: 600 }}
              >
                {ed.isSaving ? "Guardando en servidor…" : `💾 Guardar ${PROVIDERS[s.provider]?.label} ahora`}
              </button>
            )}
          </div>
        )}
        {ed.saveError && (
          <p className="pis-warn" style={{ marginTop: "0.5rem" }}>
            No se pudo guardar: {ed.saveError}
          </p>
        )}

        {s.provider === "otro" ? (
          <div className="pis-grid pis-grid--3">
            <label>
              Dirección del servicio
              <input type="url" value={s.base_url} placeholder="https://…/v1" onChange={(e) => set("base_url", e.target.value.trim())} />
            </label>
            <label>
              Modelo
              <input value={s.text_model} placeholder="Nombre del modelo" onChange={(e) => set("text_model", e.target.value.trim())} />
            </label>
            <label>
              Ruta
              <input value={s.chat_path} onChange={(e) => set("chat_path", e.target.value.trim())} />
            </label>
          </div>
        ) : (
          <details className="pis-adv" open={Boolean(s.text_model && s.text_model !== PROVIDERS[s.provider].model)}>
            <summary>Opciones avanzadas y velocidad del modelo</summary>
            <div className="pis-grid">
              <label>
                Modelo (vacío: {PROVIDERS[s.provider].model})
                <input
                  value={s.text_model === PROVIDERS[s.provider].model ? "" : s.text_model}
                  placeholder={PROVIDERS[s.provider].model}
                  onChange={(e) => set("text_model", e.target.value.trim() || PROVIDERS[s.provider].model)}
                />
              </label>
            </div>
            {s.provider === "nvidia" && (
              <div style={{ marginTop: "0.5rem" }}>
                <p className="pis-small" style={{ marginBottom: "0.4rem" }}>
                  <strong>Acelerar respuesta (NVIDIA NIM):</strong>
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  <button
                    type="button"
                    className="button-subtle"
                    style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                    onClick={() => set("text_model", "meta/llama-3.1-8b-instruct")}
                  >
                    ⚡ meta/llama-3.1-8b-instruct (~1-3 s)
                  </button>
                  <button
                    type="button"
                    className="button-subtle"
                    style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                    onClick={() => set("text_model", "mistralai/mistral-7b-instruct-v0.3")}
                  >
                    ⚡ mistralai/mistral-7b-instruct-v0.3 (~2-4 s)
                  </button>
                  <button
                    type="button"
                    className="button-subtle"
                    style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                    onClick={() => set("text_model", "google/gemma-4-31b-it")}
                  >
                    🐢 google/gemma-4-31b-it (Lento ~40-60 s)
                  </button>
                </div>
              </div>
            )}
            {s.provider === "mistral" && (
              <div style={{ marginTop: "0.5rem" }}>
                <p className="pis-small" style={{ marginBottom: "0.4rem" }}>
                  <strong>Modelos en Mistral:</strong>
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  <button
                    type="button"
                    className="button-subtle"
                    style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                    onClick={() => set("text_model", "mistral-small-latest")}
                  >
                    ⚡ mistral-small-latest (Recomendado)
                  </button>
                  <button
                    type="button"
                    className="button-subtle"
                    style={{ fontSize: "0.78rem", padding: "0.25rem 0.55rem" }}
                    onClick={() => set("text_model", "ministral-8b-latest")}
                  >
                    ⚡ ministral-8b-latest (Ultra-rápido)
                  </button>
                </div>
              </div>
            )}
          </details>
        )}
      </Group>

      <Group title="Probar la conexión">
        <div className="pis-row">
          <p className="pis-note">
            Las claves nunca llegan al navegador: cada pedido pasa por la función del servidor, que revisa quién pregunta, en qué portal y cuánto se ha usado hoy.
          </p>
          <button type="button" className="button-primary" onClick={onTest} disabled={test.state === "busy" || !connected}>
            {test.state === "busy" ? "Probando…" : "Probar conexión"}
          </button>
        </div>
        {!connected && <p className="pis-small">Para probar hace falta una clave guardada y la dirección del servicio.</p>}
        {(test.state === "ok" || test.state === "fail") && (
          <div role="status" className="pis-result">
            <StatusMark tone={test.state === "ok" ? "ok" : "fail"}>{test.text}</StatusMark>
            {findings.length > 0 && (
              <ul className="pis-findings" aria-label="Lo que la prueba encontró">
                {findings.map((f) => (
                  <li key={f.id}>
                    <StatusMark tone={f.tone}>{f.title}</StatusMark>
                    <small>{f.detail}</small>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Group>
    </>
  );
}

/* --- Voz ----------------------------------------------------------------------------------- */

export function VoiceSection({ ed }: { ed: EditorApi }) {
  const { s, setS, set, dirty, keys } = ed;
  const choice: "freeai" | "nvidia" | "fishaudio" | "navegador" =
    s.voice_engine !== "proveedor" ? "navegador" : s.speech_provider === "nvidia" || s.speech_provider === "fishaudio" ? s.speech_provider : "freeai";
  const who = choice === "nvidia" ? "NVIDIA" : choice === "fishaudio" ? "Fish Audio" : "Free.ai";
  const [sampling, setSampling] = useState(false);
  const [sampleText, setSampleText] = useState("Escuche cómo suena Mr. Pilo.");
  const pick = (next: typeof choice) =>
    setS((prev) =>
      next === "navegador"
        ? { ...prev, voice_engine: "navegador" }
        : { ...prev, voice_engine: "proveedor", speech_provider: next !== "freeai" ? next : prev.speech_provider === "otro" ? "otro" : "freeai" },
    );
  const sample = async () => {
    const line = "Hola, soy Mr. Pilo. Le leo las cifras de la universidad.";
    setSampling(true);
    try {
      if (choice !== "navegador" && !dirty) {
        setSampleText(`Pidiendo la voz a ${who}…`);
        const used = await sayWithPilo(line, { portal: "prueba" as Portal, advanced: true, rate: s.voice_rate, pitch: s.voice_pitch });
        setSampleText(used === "proveedor" ? `Sonó la voz de ${who}.` : `${who} no respondió: sonó la voz del navegador. Revise la clave de ${who}.`);
      } else {
        setSampleText(choice !== "navegador" ? `Guarde los cambios para oír la voz de ${who}. Ahora suena la del navegador.` : "Voz del navegador.");
        await speak(line, { force: true, rate: s.voice_rate, pitch: s.voice_pitch });
      }
    } finally {
      setSampling(false);
    }
  };

  return (
    <>
      <Group title="Con qué voz lee">
        <div className="pis-choice" role="radiogroup" aria-label="Voz">
          <button type="button" role="radio" aria-checked={choice === "nvidia"} onClick={() => pick("nvidia")}>
            <strong>Voz de NVIDIA</strong>
            <span>La voz propia de Pilo, clonada de una muestra (Magpie TTS Zeroshot). Usa la clave de NVIDIA.</span>
          </button>
          <button type="button" role="radio" aria-checked={choice === "fishaudio"} onClick={() => pick("fishaudio")}>
            <strong>Voz de Fish Audio</strong>
            <span>La voz propia de Pilo, clonada de la misma muestra, con un tono por estilo (tranquilo, entusiasta…). Gratis hasta el 30 de noviembre de 2026.</span>
          </button>
          <button type="button" role="radio" aria-checked={choice === "freeai"} onClick={() => pick("freeai")}>
            <strong>Voz de Free.ai</strong>
            <span>Masculina y natural (em_alex). Usa la clave de Free.ai y su cupo.</span>
          </button>
          <button type="button" role="radio" aria-checked={choice === "navegador"} onClick={() => pick("navegador")}>
            <strong>Voz del navegador</strong>
            <span>Gratis, sin clave. Siempre es el respaldo si la otra no responde.</span>
          </button>
        </div>
        {choice === "freeai" && s.speech_provider !== "otro" && keys?.keys && !keys.keys.freeai?.has && (
          <KeyField which="freeai" label="Clave de Free.ai (hace falta para su voz)" has={false} last4="" />
        )}
      </Group>

      {(choice === "nvidia" || choice === "fishaudio") && <VoiceStyles key={choice} ed={ed} provider={choice} />}

      <Group title="Cómo suena">
        <div className="pis-grid pis-grid--3">
          <label>
            Velocidad · {s.voice_rate.toLocaleString("es-CO", { minimumFractionDigits: 1 })}×
            <input type="range" min={0.7} max={1.3} step={0.1} value={s.voice_rate} onChange={(e) => set("voice_rate", Number(e.target.value))} />
          </label>
          <label>
            Tono de la voz del navegador · {s.voice_pitch < 0.95 ? "más grave" : s.voice_pitch > 1.05 ? "más agudo" : "natural"}
            <input type="range" min={0.8} max={1.2} step={0.1} value={s.voice_pitch} onChange={(e) => set("voice_pitch", Number(e.target.value))} />
          </label>
          <div className="pis-sample">
            <button type="button" aria-label="Escuchar una muestra" onClick={sample} disabled={sampling}>
              <SpeakerIcon size={18} />
            </button>
            <span role="status">{sampleText}</span>
          </div>
        </div>
        {choice === "nvidia" && (
          <p className="pis-small">Con NVIDIA, el tono y la manera de hablar los pone la muestra: para otro tono, grabe otro estilo. La velocidad sí se aplica.</p>
        )}
        {choice === "fishaudio" && (
          <p className="pis-small">Con Fish Audio, la voz la pone la muestra y el tono se elige en cada estilo. La velocidad sí se aplica; el tono de arriba es solo del navegador.</p>
        )}

        {choice === "freeai" && (
          <details className="pis-adv">
            <summary>Opciones avanzadas de la voz</summary>
            <div className="pis-grid pis-grid--3">
              <label>
                Modelo de voz (vacío: kokoro)
                <input value={s.speech_model} placeholder="kokoro" onChange={(e) => set("speech_model", e.target.value.trim())} />
              </label>
              <label>
                Voz (vacío: em_alex, masculina)
                <input value={s.speech_voice} placeholder="em_alex" onChange={(e) => set("speech_voice", e.target.value.trim())} />
              </label>
            </div>
            <KeyField
              which="voz"
              label="Clave solo para la voz (opcional, si es distinta de la de Free.ai)"
              has={keys?.keys?.voz?.has ?? false}
              last4={keys?.keys?.voz?.last4 ?? ""}
            />
          </details>
        )}
      </Group>

      <Group
        title="Expresiones y naturalidad oral"
        aside={<small>Entonaciones y microexpresiones según el ánimo</small>}
      >
        <p className="pis-lead">
          Pilo puede pronunciar expresiones orales naturales antes de leer cada respuesta (ej: «¡Claro que sí!», «Veamos...») y adaptar su velocidad y tono a la emoción del tema, sin alterar el texto oficial de la pantalla.
        </p>

        <dl className="pis-opts">
          <div>
            <dt>Microexpresiones al hablar</dt>
            <dd>
              <Switch
                on={s.voice_expressions}
                onChange={(v) => set("voice_expressions", v)}
                label="Usar microexpresiones orales al hablar"
              />
            </dd>
          </div>
          <div>
            <dt>
              Modulación emocional automática
              <small>Ajusta el ritmo y la entonación sutilmente si la respuesta es entusiasta, reflexiva o de cuidado.</small>
            </dt>
            <dd>
              <Switch
                on={s.voice_modulation}
                onChange={(v) => set("voice_modulation", v)}
                label="Modulación emocional automática"
              />
            </dd>
          </div>
        </dl>

        {s.voice_expressions && <VoiceExpressionsEditor ed={ed} choice={choice} />}
      </Group>
    </>
  );
}

/* --- Dónde aparece ------------------------------------------------------------------------- */

export function PortalsSection({ ed }: { ed: EditorApi }) {
  const { s, set, setPortal } = ed;
  return (
    <>
      <Group title="Qué puede hacer" aside={<small>Apagar una función la quita de todos los portales</small>}>
        <ul className="pis-fns">
          {FNS.map((f) => (
            <li key={f.id} className="pis-fn" data-on={s.functions[f.id] || undefined}>
              <span className="pis-fn__icon" aria-hidden="true">
                {f.short}
              </span>
              <span className="pis-fn__text">
                <strong>{f.name}</strong>
                <small>{f.desc}</small>
              </span>
              <Switch on={s.functions[f.id]} onChange={(v) => set("functions", { ...s.functions, [f.id]: v })} label={f.name} />
            </li>
          ))}
        </ul>
      </Group>

      <Group title="Portal por portal" aside={<small>Por defecto, solo la administración lo ve</small>}>
        <div className="pis-table-frame">
          <table className="pis-table">
            <caption className="sr-only">Dónde aparece Mr. Pilo y para quién</caption>
            <thead>
              <tr>
                <th scope="col">Portal</th>
                <th scope="col">Activo</th>
                {FNS.map((f) => (
                  <th scope="col" key={f.id}>
                    {f.name.split(" ")[0]}
                  </th>
                ))}
                <th scope="col">Para quién</th>
              </tr>
            </thead>
            <tbody>
              {PORTALS.map((p) => {
                const rule = s.portals[p.id] ?? { on: false, aud: "admin", fns: [] };
                return (
                  <tr key={p.id} data-off={!rule.on || undefined}>
                    <th scope="row">
                      <strong>{PORTAL_LABEL[p.id]}</strong>
                      <small>{p.where}</small>
                    </th>
                    <td>
                      <Switch on={rule.on} onChange={(v) => setPortal(p.id, { on: v })} label={`Activar en ${PORTAL_LABEL[p.id]}`} />
                    </td>
                    {FNS.map((f) => {
                      const has = rule.fns.includes(f.id);
                      const blocked = has && !s.functions[f.id];
                      return (
                        <td key={f.id}>
                          <button
                            type="button"
                            className="pis-check"
                            aria-pressed={has}
                            aria-label={`${f.name} en ${PORTAL_LABEL[p.id]}${blocked ? " (la función está apagada)" : ""}`}
                            title={blocked ? "Marcada, pero la función está apagada arriba: no aparecerá." : undefined}
                            data-off={blocked || undefined}
                            onClick={() => setPortal(p.id, { fns: has ? rule.fns.filter((x) => x !== f.id) : [...rule.fns, f.id] })}
                          >
                            {has ? <Icon name="check" size={16} /> : <span aria-hidden="true" className="pis-check__dash" />}
                          </button>
                        </td>
                      );
                    })}
                    <td>
                      <AudiencePicker value={rule.aud} label={`Para quién en ${PORTAL_LABEL[p.id]}`} onPick={(aud) => setPortal(p.id, { aud })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="pis-warn">«Público» gasta cupo con cada visitante. Conviene empezar con «Solo administración», revisar la bitácora una semana y abrir portal por portal.</p>
      </Group>

      <WidgetGroup ed={ed} />
      <ExtrasGroup />

      <ReportsGroup ed={ed} />
    </>
  );
}

/* --- Informes de Impacto (0100) --------------------------------------------------------------- */

const REPORT_ACTORS: { id: ReportKind; name: string; desc: string }[] = [
  { id: "programa", name: "Programas", desc: "La dirección y el equipo de cada programa, sobre su programa (y la decanatura, sobre los de su facultad)." },
  { id: "facultad", name: "Decanaturas", desc: "Cada decanatura, sobre su facultad: sus programas lado a lado, función por función." },
  { id: "vicerrectoria", name: "Vicerrectorías", desc: "Cada vicerrectoría u oficina, sobre su función en toda la universidad y por facultad." },
];

/**
 * Quién más, además de la administración, pide el «Informe con Pilo» en
 * Indicadores de Impacto. Cada quien solo sobre su unidad: lo decide la base.
 */
function ReportsGroup({ ed }: { ed: EditorApi }) {
  const { s, set } = ed;
  const opened = REPORT_ACTORS.filter((a) => s.impacto_report[a.id]).length;
  return (
    <Group title="Informes de Impacto con Pilo" aside={<small>{opened ? `Abiertos a ${opened} de 3` : "Solo la administración"}</small>}>
      <p className="pis-small">
        El botón «Informe con Pilo» de Indicadores de Impacto escribe el informe de un programa, una facultad o una vicerrectoría. La administración siempre lo
        tiene; aquí se abre a los demás, cada quien sobre las unidades a las que pertenece. Cada informe gasta una llamada por capítulo y una por el cierre.
      </p>
      <ul className="pis-fns">
        {REPORT_ACTORS.map((a) => (
          <li key={a.id} className="pis-fn" data-on={s.impacto_report[a.id] || undefined}>
            <span className="pis-fn__icon" aria-hidden="true">
              {a.name.slice(0, 2)}
            </span>
            <span className="pis-fn__text">
              <strong>{a.name}</strong>
              <small>{a.desc}</small>
            </span>
            <Switch
              on={s.impacto_report[a.id]}
              disabled={s.needs0100}
              onChange={(v) => set("impacto_report", { ...s.impacto_report, [a.id]: v })}
              label={`Abrir los informes de Impacto a ${a.name.toLowerCase()}`}
            />
          </li>
        ))}
      </ul>
      {s.needs0100 && <p className="pis-warn">Falta aplicar la migración 0100 en la base para abrir los informes a los demás.</p>}
      {!s.enabled && <p className="pis-warn">Mr. Pilo con IA está apagado: nadie puede escribir informes hasta encenderlo.</p>}
    </Group>
  );
}

/* --- Uso y bitácora ------------------------------------------------------------------------- */

/** Un contador de hoy contra su tope: el número, la barra y lo que pasa al llegar. */
function Meter({ label, used, limit, unit, full }: { label: string; used: number; limit: number; unit: string; full: string }) {
  const share = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const high = limit === 0 ? used > 0 : share >= 90;
  return (
    <div className="pis-usage">
      <div>
        <strong>
          {used.toLocaleString("es-CO")}{" "}
          <span>
            de {limit.toLocaleString("es-CO")} {unit}
          </span>
        </strong>
        <small>{limit === 0 ? <StatusMark tone="warn">{`Tope en 0. ${full}`}</StatusMark> : high ? <StatusMark tone="warn">{`Casi en el tope. ${full}`}</StatusMark> : "Se reinicia cada día."}</small>
      </div>
      <i role="meter" aria-valuemin={0} aria-valuemax={limit} aria-valuenow={used} aria-label={label}>
        <span style={{ transform: `scaleX(${share / 100})` }} data-high={high || undefined} />
      </i>
    </div>
  );
}

const LOG_TONE = (status: string, cached: boolean) =>
  cached || status === "listo" ? ("ok" as const) : status === "revisar" || status === "limite" ? ("warn" as const) : ("fail" as const);

export function UsageSection({ ed }: { ed: EditorApi }) {
  const { s, set, keys } = ed;
  const log = usePiloLog();
  const today = keys?.today ?? 0;
  // Sin 0110 la función no cuenta la voz aparte: «today» trae las dos juntas.
  const voice = keys?.today_voice;
  return (
    <>
      <Group title="Uso de hoy" aside={voice === undefined && keys ? <small>Texto y voz juntos, hasta aplicar 0110</small> : undefined}>
        <Meter
          label="Uso de texto de hoy"
          used={today}
          limit={s.daily_limit}
          unit={voice === undefined ? "pedidos" : "pedidos de texto"}
          full="Sin cupo, Pilo no redacta con IA: responde con el catálogo, lo guardado y la memoria, y lo dice."
        />
        {voice !== undefined && (
          <Meter
            label="Uso de voz de hoy"
            used={voice}
            limit={s.voice_daily_limit}
            unit="lecturas con voz"
            full="Sin cupo, Mr. Pilo lee con la voz del navegador y lo dice."
          />
        )}
      </Group>

      <Group title="Límites y cuidado">
        <div className="pis-grid pis-grid--3">
          <label>
            Pedidos de texto por día
            <input type="number" min={0} value={s.daily_limit} onChange={(e) => set("daily_limit", Math.max(0, Number(e.target.value)))} />
          </label>
          <NumField
            label="Lecturas con voz por día"
            hint="Aparte del cupo de texto"
            {...ASK_LIMITS.voice_daily_limit}
            value={s.voice_daily_limit}
            disabled={s.needs0110}
            onCommit={(v) => set("voice_daily_limit", v)}
          />
          <label>
            Filas máx. por pedido
            <input type="number" min={10} max={5000} value={s.max_rows} onChange={(e) => set("max_rows", Number(e.target.value))} />
          </label>
          <label>
            Guardar resúmenes (días)
            <input type="number" min={0} max={365} value={s.cache_days} onChange={(e) => set("cache_days", Number(e.target.value))} />
          </label>
        </div>
        {s.needs0110 && <p className="pis-warn">Falta aplicar la migración 0110 en la base para fijar el cupo de la voz aparte del de texto.</p>}
        <ul className="pis-list">
          <li>Solo se envía lo que está publicado en la página: nunca nombres, códigos ni datos personales.</li>
          <li>Cada resumen dice «hecho con IA» y de qué tabla o gráfica sale.</li>
          <li>Mr. Pilo revisa que cada número del resumen esté en la página; si no, lo advierte.</li>
          <li>Si el servicio no responde, lee con la voz del navegador y lo dice.</li>
        </ul>
      </Group>

      <Group title="Últimos pedidos" aside={<small>Los 20 más recientes</small>}>
        {(log.data ?? []).length === 0 ? (
          <p className="pis-small">Todavía no hay pedidos.</p>
        ) : (
          <ul className="pis-log">
            {(log.data ?? []).map((r) => (
              <li key={r.id}>
                <span>{new Date(r.created_at).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
                <span>
                  <strong>{r.action}</strong> · {PORTAL_LABEL[r.portal as Portal] ?? r.portal}
                  <small>{r.subject}</small>
                </span>
                <StatusMark tone={LOG_TONE(r.status, r.cached)}>{r.cached ? "guardado" : r.status}</StatusMark>
              </li>
            ))}
          </ul>
        )}
      </Group>
    </>
  );
}
