/* =============================================================================
   El altavoz de Mr. Pilo: prende o apaga su voz en toda la aplicación.
   Sin soporte de voz en el navegador, no se muestra.
   ========================================================================== */

import { useVoice } from "./voice";

export function SpeakerIcon({ off = false, size = 18 }: { off?: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      {off ? (
        <path d="m16 9 5 6m0-6-5 6" />
      ) : (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      )}
    </svg>
  );
}

export function VoiceToggle({ className, withLabel = false }: { className?: string; withLabel?: boolean }) {
  const { supported, enabled, speaking, setEnabled } = useVoice();
  if (!supported) return null;
  const label = enabled ? "Apagar la voz de Mr. Pilo" : "Prender la voz de Mr. Pilo";
  return (
    <button
      type="button"
      className={className}
      aria-pressed={enabled}
      aria-label={label}
      title={label}
      data-speaking={speaking || undefined}
      onClick={() => setEnabled(!enabled)}
    >
      <SpeakerIcon off={!enabled} />
      {withLabel && <span>{enabled ? "Voz" : "Sin voz"}</span>}
    </button>
  );
}
