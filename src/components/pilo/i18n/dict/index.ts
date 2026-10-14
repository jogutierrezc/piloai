/* =============================================================================
   Las traducciones de las pantallas de Pilo: el español es la clave.
   Cada archivo de esta carpeta es una pantalla; aquí se juntan.
   ========================================================================== */

import { PREGUNTA_EN, PREGUNTA_PT } from "./pregunta";
import { EMBED_EN, EMBED_PT } from "./embed";
import { APP_EN, APP_PT } from "./app";
import { SERVIDOR_EN, SERVIDOR_PT } from "./servidor";
import { U_EN, U_PT } from "./u";
import { CARNET_EN, CARNET_PT } from "./carnet";
import { BIENVENIDA_EN, BIENVENIDA_PT } from "./bienvenida";

export const DICTIONARY: Record<"en" | "pt", Record<string, string>> = {
  en: { ...PREGUNTA_EN, ...EMBED_EN, ...APP_EN, ...SERVIDOR_EN, ...U_EN, ...CARNET_EN, ...BIENVENIDA_EN },
  pt: { ...PREGUNTA_PT, ...EMBED_PT, ...APP_PT, ...SERVIDOR_PT, ...U_PT, ...CARNET_PT, ...BIENVENIDA_PT },
};
