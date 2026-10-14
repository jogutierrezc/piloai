/* =============================================================================
   Mr. Pilo en tres idiomas · el selector (ES · EN · PT).

   Un grupo de tres botones pequeños que hereda el color de donde se pone, así
   sirve en los tres temas de Pregúntele a Pilo, en el chat emergente y en la
   app. Su nombre accesible va en los tres idiomas: quien no lee español tiene
   que poder encontrarlo.
   ========================================================================== */

import { PILO_LANGS, setLang, useLang } from "./lang";
import "./lang-switch.css";

export function LangSwitch({ className }: { className?: string }) {
  const lang = useLang();
  return (
    <div className={`pilo-lang${className ? ` ${className}` : ""}`} role="group" aria-label="Idioma · Language · Idioma">
      {PILO_LANGS.map((l) => (
        <button key={l.id} type="button" lang={l.id} title={l.name} aria-label={l.name} aria-pressed={lang === l.id} onClick={() => setLang(l.id)}>
          {l.code}
        </button>
      ))}
    </div>
  );
}
