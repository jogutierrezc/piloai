/* =============================================================================
   Intranet · Mr. Pilo con IA · Memoria › los documentos del Pilo general (0121).

   Hasta 0121 solo Mr. Pilo en Enseñanza tenía documentos propios. Ahora el
   Pilo de la Universidad también: documentos institucionales generales, en sus
   colecciones (las que la base tenga como «documentos» en su ámbito).

   No hay otra tubería: son los mismos paneles de Enseñanza, montados con
   `space="planeacion"`:

     DocumentsPanel    subir, ver lo que va a quedar, pasajes, estructura del
                       mapa sin IA y vectores; por documento, quién lo ve.
     ComprehendGroup   «comprender»: de qué trata cada pasaje y qué normas cita.

   Un documento subido no entra solo en las respuestas: su colección nace en
   «no» y se enciende en «Qué lee cada portal». Aquí se dice cuáles faltan.

   Sin la migración 0121 la base no acepta documentos para este Pilo: los dos
   grupos lo dicen y quedan apagados.
   ========================================================================== */

import { ComprehendGroup } from "../pilo-ensenanza/memoria/ComprehendGroup";
import { DocumentsPanel } from "../pilo-ensenanza/memoria/DocumentsPanel";
import { ReadingsPanel } from "../pilo-ensenanza/memoria/ReadingsPanel";
import { GENERAL_COLLECTIONS, docCollections, effectiveCell, usePortals } from "./portals";
import { DEFAULT_SPACE } from "./space";
// Los paneles de documentos traen su propia hoja (prefijo pen-), que no toca nada de esta pantalla.
import "../pilo-ensenanza/pilo-ensenanza.css";

const OFF_NOTE = "Falta aplicar la migración 0121 en la base: hasta entonces el Pilo de la Universidad no tiene documentos propios.";

export function GeneralDocs({ disabled = false }: { /** Falta la base de la memoria (0094): nada se puede guardar. */ disabled?: boolean }) {
  const portals = usePortals(!disabled);
  // Mientras se sabe si la base tiene 0121 no se monta nada que escriba.
  const missing = disabled || portals.data === null || portals.isError;
  const loading = portals.isPending && !disabled;
  const data = portals.data ?? null;
  const fromDb = data ? docCollections(data.sources, DEFAULT_SPACE) : [];
  const collections = fromDb.length ? fromDb : GENERAL_COLLECTIONS;
  const general = data?.portals.find((p) => p.id === DEFAULT_SPACE) ?? null;
  const unread = data && general ? data.sources.filter((s) => collections.some((c) => c.id === s.id) && effectiveCell(general, s) !== "casa") : [];

  const note =
    !missing && !loading && unread.length > 0 ? (
      <p className="pis-note" role="note">
        {unread.length === collections.length ? "Pilo todavía no lee ninguna de estas colecciones: " : `Pilo todavía no lee ${unread.map((s) => `«${s.name}»`).join(", ")}: `}
        lo que suba aquí queda guardado y listo, y entra en las respuestas cuando marque la colección como «De casa» en «Qué lee cada portal», arriba.
      </p>
    ) : null;

  return (
    <>
      <DocumentsPanel
        space={DEFAULT_SPACE}
        disabled={missing || loading}
        collections={collections}
        disabledNote={loading ? "Revisando si la base ya acepta documentos para este Pilo…" : OFF_NOTE}
        note={note}
      />
      <ReadingsPanel space={DEFAULT_SPACE} disabled={missing || loading} collections={collections} />
      <ComprehendGroup space={DEFAULT_SPACE} off={missing || loading} offNote={loading ? "Revisando el mapa de este Pilo…" : OFF_NOTE} dock={false} />
    </>
  );
}
