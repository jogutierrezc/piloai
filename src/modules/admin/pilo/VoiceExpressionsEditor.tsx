/* =============================================================================
   Intranet · Mr. Pilo con IA · Editor de expresiones orales y naturalidad (0106).

   Permite a la administración configurar el banco de microexpresiones que
   Pilo pronuncia al hablar, organizadas por emoción (emocionado, atento,
   atrevido, cuidado, pensar), y probar cómo suena cada una con la voz actual.
   ========================================================================== */

import { useState } from "react";
import { Icon } from "../../../components/ui/Icon";
import { sayWithPilo } from "../../../components/pilo/ai/client";
import { speak } from "../../../components/pilo/voice";
import {
  DEFAULT_VOICE_PATTERNS,
  MOOD_LABELS,
  modulateVoice,
} from "../../../components/pilo/ai/voice-expressions";
import type { ExpressionMood } from "../../../components/pilo/ai/voice-expressions";
import type { Portal } from "../../../components/pilo/ai/config";
import type { EditorApi } from "./sections";

const MOODS: ExpressionMood[] = ["emocionado", "atento", "atrevido", "cuidado", "pensar"];

export function VoiceExpressionsEditor({ ed, choice }: { ed: EditorApi; choice: string }) {
  const { s, set } = ed;
  const [activeMood, setActiveMood] = useState<ExpressionMood>("emocionado");
  const [newPhrase, setNewPhrase] = useState("");
  const [testingPhrase, setTestingPhrase] = useState<string | null>(null);

  const patterns = s.voice_patterns ?? DEFAULT_VOICE_PATTERNS;
  const currentList = patterns[activeMood] ?? DEFAULT_VOICE_PATTERNS[activeMood] ?? [];

  const updateList = (mood: ExpressionMood, list: string[]) => {
    set("voice_patterns", {
      ...patterns,
      [mood]: list,
    });
  };

  const addPhrase = () => {
    const clean = newPhrase.trim().replace(/\s+/g, " ");
    if (!clean) return;
    if (currentList.includes(clean)) {
      setNewPhrase("");
      return;
    }
    updateList(activeMood, [...currentList, clean]);
    setNewPhrase("");
  };

  const removePhrase = (phrase: string) => {
    updateList(
      activeMood,
      currentList.filter((p) => p !== phrase),
    );
  };

  const restoreDefaults = () => {
    updateList(activeMood, [...DEFAULT_VOICE_PATTERNS[activeMood]]);
  };

  const testPhrase = async (phrase: string) => {
    setTestingPhrase(phrase);
    try {
      const { rate, pitch } = s.voice_modulation
        ? modulateVoice(activeMood, s.voice_rate, s.voice_pitch)
        : { rate: s.voice_rate, pitch: s.voice_pitch };

      if (choice !== "navegador") {
        await sayWithPilo(phrase, {
          portal: "prueba" as Portal,
          advanced: true,
          rate,
          pitch,
        });
      } else {
        await speak(phrase, { force: true, rate, pitch });
      }
    } finally {
      setTestingPhrase(null);
    }
  };

  return (
    <div className="pis-patterns" aria-label="Editor de microexpresiones orales">
      <div className="pis-patterns__head">
        <h4>Banco de microexpresiones por emoción</h4>
        <button
          type="button"
          className="button-secondary"
          onClick={restoreDefaults}
          title="Restablecer las frases sugeridas para esta emoción"
          style={{ minHeight: "32px", fontSize: "var(--text-xs)", padding: "0 0.75rem" }}
        >
          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" />
          </svg>
          Restablecer sugeridas
        </button>
      </div>

      <div className="pis-patterns__tabs" role="tablist" aria-label="Emociones de Pilo">
        {MOODS.map((m) => {
          const count = (patterns[m] ?? DEFAULT_VOICE_PATTERNS[m] ?? []).length;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={activeMood === m}
              className="pis-patterns__tab"
              onClick={() => {
                setActiveMood(m);
                setNewPhrase("");
              }}
            >
              {MOOD_LABELS[m].label.split(" / ")[0]}
              <span>({count})</span>
            </button>
          );
        })}
      </div>

      <p className="pis-patterns__desc">{MOOD_LABELS[activeMood].desc}</p>

      <ul className="pis-patterns__list">
        {currentList.map((phrase, idx) => (
          <li key={idx} className="pis-patterns__item">
            <span>{phrase}</span>
            <div className="pis-patterns__actions">
              <button
                type="button"
                className="button-secondary"
                onClick={() => void testPhrase(phrase)}
                disabled={testingPhrase !== null}
                title="Escuchar cómo suena con la voz actual"
              >
                {testingPhrase === phrase ? "Leyendo…" : "Escuchar"}
              </button>
              <button
                type="button"
                className="button-secondary"
                onClick={() => removePhrase(phrase)}
                title="Quitar esta expresión"
                aria-label={`Quitar expresión «${phrase}»`}
              >
                <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                </svg>
              </button>
            </div>
          </li>
        ))}
        {currentList.length === 0 && (
          <li className="pis-patterns__item" style={{ color: "var(--ink-muted)" }}>
            <span>No hay frases configuradas para esta emoción. Agregue una abajo o restablezca las sugeridas.</span>
          </li>
        )}
      </ul>

      <div className="pis-patterns__add">
        <input
          type="text"
          value={newPhrase}
          maxLength={100}
          placeholder={`Nueva frase para ${MOOD_LABELS[activeMood].label.toLowerCase()} (ej: ¡Claro que sí!)`}
          onChange={(e) => setNewPhrase(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addPhrase();
            }
          }}
        />
        <button
          type="button"
          className="button-primary"
          onClick={addPhrase}
          disabled={!newPhrase.trim()}
        >
          <Icon name="plus" size={14} />
          Agregar
        </button>
      </div>
    </div>
  );
}
