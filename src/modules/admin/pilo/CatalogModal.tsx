/* =============================================================================
   Modal para crear o editar una entrada en el catálogo de Pilo.

   Permite agregar directamente una respuesta oficial o una microexpresión
   capciosa desde:
   1. El módulo Catálogo (+ Nueva respuesta / + Nueva capciosa, o Editar).
   2. Pregúntele a Pilo (botón "Al catálogo" en cualquier respuesta).
   3. La sección de Respuestas Guardadas (botón "Hacer parte del catálogo").
   4. La bandeja de lo que Pilo no supo (0109): «Responder».

   La clave sugerida (R-001, C-001…) sale de las claves que ya existen. Si
   quien abre el modal no las pasa, el modal las consulta: una clave repetida
   reemplazaría en silencio la entrada que ya la tiene.

   Guarda a través del RPC pilo_catalog_import o inserción directa (0105).
   ========================================================================== */

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { Modal } from "../../../components/ui/Modal";
import { Switch } from "./ui";
import { PremiseEditor } from "./Razonamiento";
import { CATALOG_ROLES, MOODS, ROL_LABEL } from "./catalog-sheet";
import type { CatalogKind, CatalogMood, CatalogRol, CatalogRow } from "./catalog-sheet";
import { CATALOG_PREFIX, DEFAULT_SPACE, SPACE_COPY, isDefaultSpace, keyFitsSpace, nextCatalogKey, spaceArgs } from "./space";
import type { PiloSpace } from "./space";
import { extractKeywords } from "../../../components/pilo/ai/logic";
import "./pilo-settings.css";

export interface CatalogModalProps {
  open: boolean;
  onClose: () => void;
  defaultKind?: CatalogKind;
  initialEntry?: Partial<CatalogRow> | null;
  isEditing?: boolean;
  existingKeys?: string[];
  onSaved?: (entry: CatalogRow) => void;
  /** De qué Pilo es la entrada (0113): decide el prefijo de la clave y si se pregunta «para quién». */
  space?: PiloSpace;
}

export function CatalogModal({
  open,
  onClose,
  defaultKind = "respuesta",
  initialEntry,
  isEditing = false,
  existingKeys,
  onSaved,
  space = DEFAULT_SPACE,
}: CatalogModalProps) {
  const own = !isDefaultSpace(space);
  const client = useQueryClient();
  // Sin claves de quien abre el modal, se leen de la base (cuelga de ["pilo-ia", "catalogo"]: se refresca al guardar).
  const ownKeys = useQuery({
    queryKey: ["pilo-ia", "catalogo", "claves"],
    enabled: open && !existingKeys,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase.from("pilo_catalog").select("key");
      if (error) return [];
      return ((data ?? []) as { key: string }[]).map((r) => r.key);
    },
  });
  const keys = useMemo(() => existingKeys ?? ownKeys.data ?? [], [existingKeys, ownKeys.data]);
  const [kind, setKind] = useState<CatalogKind>(defaultKind);
  const [key, setKey] = useState("");
  const [question, setQuestion] = useState("");
  const [variantsText, setVariantsText] = useState("");
  const [triggersText, setTriggersText] = useState("");
  const [answer, setAnswer] = useState("");
  const [mood, setMood] = useState<CatalogMood>("emocionado");
  const [sourceTitle, setSourceTitle] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [cut, setCut] = useState("");
  const [office, setOffice] = useState("");
  const [active, setActive] = useState(true);
  const [rol, setRol] = useState<CatalogRol>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Calcula la siguiente clave sugerida (R-001, C-001...)
  const suggestedKey = useMemo(() => nextCatalogKey(space, kind, keys), [space, kind, keys]);

  useEffect(() => {
    if (!open) return;
    const k = initialEntry?.kind ?? defaultKind;
    setKind(k);
    setKey(initialEntry?.key ?? (isEditing ? "" : suggestedKey));
    setQuestion(initialEntry?.question ?? "");
    setVariantsText((initialEntry?.variants ?? []).join("\n"));

    // Si viene disparadores los usa; si es respuesta nueva sugiere palabras clave de la pregunta
    if (initialEntry?.triggers && initialEntry.triggers.length > 0) {
      setTriggersText(initialEntry.triggers.join(", "));
    } else if (initialEntry?.question && k === "respuesta") {
      const suggested = extractKeywords(initialEntry.question);
      setTriggersText(suggested.join(", "));
    } else {
      setTriggersText("");
    }

    setAnswer(initialEntry?.answer ?? "");
    setMood(initialEntry?.mood ?? (k === "capciosa" ? "atrevido" : "emocionado"));
    setSourceTitle(initialEntry?.source_title ?? "");
    setSourcePath(initialEntry?.source_path ?? "");
    setCut(initialEntry?.cut ?? "");
    setOffice(initialEntry?.office ?? "");
    setActive(initialEntry?.active ?? true);
    setRol(CATALOG_ROLES.find((r) => r === initialEntry?.rol) ?? "");
    setError(null);
  }, [open, defaultKind, initialEntry, isEditing, suggestedKey]);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const cleanKey = (key || suggestedKey).toUpperCase().trim();
    if (!cleanKey) {
      setError("Ingrese una clave única para la entrada (ej: R-001).");
      return;
    }
    if (!/^[A-Z0-9._-]{1,40}$/.test(cleanKey)) {
      setError("La clave solo puede tener letras, números, guion o punto, sin espacios.");
      return;
    }
    if (!isEditing && !keyFitsSpace(space, kind, cleanKey)) {
      const prefix = CATALOG_PREFIX[space][kind];
      setError(`En ${SPACE_COPY[space].screen} las claves empiezan por ${prefix}- (por ejemplo ${suggestedKey}): así no chocan con las del otro Mr. Pilo.`);
      return;
    }
    if (!isEditing && keys.some((k) => k.toUpperCase() === cleanKey)) {
      setError(`Ya hay una entrada con la clave ${cleanKey}: elija otra para no reemplazarla.`);
      return;
    }

    const cleanAnswer = answer.trim().replace(/\s+/g, " ");
    if (cleanAnswer.length < 2) {
      setError("La respuesta debe tener al menos 2 caracteres.");
      return;
    }
    if (cleanAnswer.length > 2000) {
      setError(`La respuesta tiene ${cleanAnswer.length} caracteres (el máximo permitido es 2.000).`);
      return;
    }
    if (/\$\s?\d|\bpesos\b|\bcop\b|millones de pesos/i.test(cleanAnswer)) {
      setError("No se publican cifras de dinero en las respuestas oficiales.");
      return;
    }

    if (kind === "respuesta" && question.trim().length < 3) {
      setError("La pregunta oficial debe tener al menos 3 caracteres.");
      return;
    }

    const parsedTriggers = triggersText
      .split(/\r?\n|[,;|]/)
      .map((t) => t.trim())
      .filter(Boolean);

    if (kind === "capciosa" && !parsedTriggers.length) {
      setError("Las preguntas capciosas requieren al menos un disparador.");
      return;
    }

    if (sourcePath && !/^(\/|https?:\/\/)/i.test(sourcePath.trim())) {
      setError("La ruta de la fuente debe empezar con / (enlace interno) o con https://.");
      return;
    }

    const parsedVariants = variantsText
      .split(/\r?\n|\|/)
      .map((v) => v.trim())
      .filter(Boolean);

    const cleanRow: CatalogRow = {
      key: cleanKey,
      question: question.trim(),
      variants: parsedVariants,
      triggers: parsedTriggers,
      answer: cleanAnswer,
      mood,
      source_title: kind === "respuesta" ? sourceTitle.trim() : "",
      source_path: kind === "respuesta" ? sourcePath.trim() : "",
      cut: kind === "respuesta" ? cut.trim() : "",
      office: kind === "respuesta" ? office.trim() : "",
      active,
      ...(own ? { rol } : {}),
    };

    setBusy(true);
    try {
      const { data: saved, error: rpcErr } = await supabase.rpc("pilo_catalog_import", {
        p_kind: kind,
        p_rows: [cleanRow] as never,
        p_replace: false,
        ...spaceArgs(space),
      });

      // En otro espacio no hay camino alterno: escribir directo podría pisar una clave del otro Pilo.
      if (rpcErr && own) throw rpcErr;
      if (own && Number((saved as { rejected?: number } | null)?.rejected ?? 0) > 0) {
        throw new Error(`La clave ${cleanKey} ya es del otro Mr. Pilo: elija otra.`);
      }

      if (rpcErr) {
        // Si falla por RLS o falta de función, intentar upsert directo con migración 0105
        const { error: directErr } = await supabase.from("pilo_catalog").upsert({
          ...cleanRow,
          kind,
          updated_at: new Date().toISOString(),
        });
        if (directErr) throw directErr;
      }

      await client.invalidateQueries({ queryKey: ["pilo-ia", "catalogo"] });
      await client.invalidateQueries({ queryKey: ["pilo-ia", "memoria", "respuestas"] });
      onSaved?.(cleanRow);
      onClose();
    } catch (err) {
      setError((err as Error).message || "No se pudo guardar la entrada en el catálogo.");
    } finally {
      setBusy(false);
    }
  };

  const title = isEditing
    ? `Editar ${kind === "respuesta" ? "respuesta" : "capciosa"} (${key || suggestedKey})`
    : `Hacer parte del catálogo de ${kind === "respuesta" ? "respuestas" : "capciosas"}`;

  return (
    <Modal
      title={title}
      description={
        kind === "respuesta"
          ? `Esta respuesta se guardará en el catálogo oficial de ${own ? SPACE_COPY[space].screen : "Planeación"}. Pilo la responderá de forma prioritaria, sin IA, cada vez que alguien pregunte algo similar.`
          : "Microexpresión rápida que Pilo dirá de inmediato cuando la pregunta traiga los disparadores indicados."
      }
      onClose={onClose}
      size="wide"
    >
      <form onSubmit={handleSubmit} className="pis-modal-form">
        {!isEditing && (
          <div className="pis-modal-field">
            <label>Tipo de entrada en el catálogo</label>
            <div className="pis-seg" role="radiogroup" aria-label="Tipo de entrada">
              <button
                type="button"
                role="radio"
                aria-checked={kind === "respuesta"}
                onClick={() => {
                  setKind("respuesta");
                  setMood("emocionado");
                }}
              >
                Respuesta oficial
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={kind === "capciosa"}
                onClick={() => {
                  setKind("capciosa");
                  setMood("atrevido");
                }}
              >
                Capciosa / Microexpresión
              </button>
            </div>
          </div>
        )}

        <div className="pis-modal-row">
          <div className="pis-modal-field">
            <label htmlFor="cat-key">
              Clave única <small>(corta, en mayúsculas)</small>
            </label>
            <input
              id="cat-key"
              type="text"
              required
              maxLength={40}
              value={key}
              placeholder={suggestedKey}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
            />
          </div>

          <div className="pis-modal-field">
            <label htmlFor="cat-mood">Emoción con la que habla Pilo</label>
            <select id="cat-mood" value={mood} onChange={(e) => setMood(e.target.value as CatalogMood)}>
              {MOODS.map((m) => (
                <option key={m} value={m}>
                  {m.charAt(0).toUpperCase() + m.slice(1)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pis-modal-field">
          <label htmlFor="cat-question">
            {kind === "respuesta" ? "Pregunta oficial" : "Tema de la capciosa"}
          </label>
          <input
            id="cat-question"
            type="text"
            required
            maxLength={500}
            value={question}
            placeholder={
              kind === "respuesta" ? "¿Qué es el PDI?" : "Salarios de directivos"
            }
            onChange={(e) => {
              setQuestion(e.target.value);
              // Sugiere palabras clave automáticamente si el campo disparadores está vacío
              if (kind === "respuesta" && !triggersText) {
                const words = extractKeywords(e.target.value);
                if (words.length) setTriggersText(words.join(", "));
              }
            }}
          />
          <small>
            {kind === "respuesta"
              ? "La pregunta formulada tal como la haría el público o la comunidad."
              : "Para organizarse en la intranet: de qué trata la pregunta (salarios, vida de Pilo, etc.)."}
          </small>
        </div>

        {kind === "respuesta" && (
          <div className="pis-modal-field">
            <label htmlFor="cat-variants">
              Variantes de la pregunta <small>(opcional)</small>
            </label>
            <textarea
              id="cat-variants"
              rows={2}
              value={variantsText}
              placeholder={"¿Qué significa PDI?\n¿Para qué sirve el Plan de Desarrollo?"}
              onChange={(e) => setVariantsText(e.target.value)}
            />
            <small>Otras formas en las que la gente pregunta lo mismo (una por línea o separadas por |).</small>
          </div>
        )}

        <div className="pis-modal-field">
          <label htmlFor="cat-triggers">
            {kind === "capciosa" ? "Disparadores (obligatorio)" : "Palabras clave / Disparadores (opcional)"}
          </label>
          <input
            id="cat-triggers"
            type="text"
            required={kind === "capciosa"}
            value={triggersText}
            placeholder={
              kind === "capciosa"
                ? "salario, sueldo, cuanto gana"
                : "pdi, plan de desarrollo, plan institucional"
            }
            onChange={(e) => setTriggersText(e.target.value)}
          />
          <small>
            Palabras que activan esta respuesta aunque la pregunta cambie de redacción (separadas por comas).
          </small>
        </div>

        <div className="pis-modal-field">
          <label htmlFor="cat-answer">Respuesta oficial de Pilo</label>
          <textarea
            id="cat-answer"
            required
            rows={4}
            maxLength={2000}
            value={answer}
            placeholder="Escriba aquí la respuesta clara, directa y en usted que dará Pilo..."
            onChange={(e) => setAnswer(e.target.value)}
          />
          <small>{answer.length} / 2.000 caracteres. Sin cifras de dinero ni datos de personas.</small>
        </div>

        {kind === "respuesta" && (
          <div className="pis-modal-row">
            <div className="pis-modal-field">
              <label htmlFor="cat-src-title">Fuente <small>(opcional)</small></label>
              <input
                id="cat-src-title"
                type="text"
                maxLength={300}
                value={sourceTitle}
                placeholder="Portal PDI · UDES"
                onChange={(e) => setSourceTitle(e.target.value)}
              />
            </div>

            <div className="pis-modal-field">
              <label htmlFor="cat-src-path">Ruta / enlace <small>(opcional)</small></label>
              <input
                id="cat-src-path"
                type="text"
                maxLength={300}
                value={sourcePath}
                placeholder="/pdi o https://..."
                onChange={(e) => setSourcePath(e.target.value)}
              />
            </div>
          </div>
        )}

        {kind === "respuesta" && (
          <div className="pis-modal-row">
            <div className="pis-modal-field">
              <label htmlFor="cat-cut">Corte <small>(opcional)</small></label>
              <input
                id="cat-cut"
                type="text"
                maxLength={60}
                value={cut}
                placeholder="2025-1"
                onChange={(e) => setCut(e.target.value)}
              />
            </div>

            <div className="pis-modal-field">
              <label htmlFor="cat-office">Oficina que reporta <small>(opcional)</small></label>
              <input
                id="cat-office"
                type="text"
                maxLength={200}
                value={office}
                placeholder="Oficina de Planeación Institucional"
                onChange={(e) => setOffice(e.target.value)}
              />
            </div>
          </div>
        )}

        {own && (
          <div className="pis-modal-field">
            <label htmlFor="cat-rol">Para quién</label>
            <select id="cat-rol" value={rol} onChange={(e) => setRol(e.target.value as CatalogRol)}>
              {CATALOG_ROLES.map((r) => (
                <option key={r || "todos"} value={r}>
                  {ROL_LABEL[r]}
                </option>
              ))}
            </select>
            <small>«Todos» sirve a cualquiera. Con un rol, Pilo solo la usa cuando quien pregunta eligió ese rol.</small>
          </div>
        )}

        {/* La premisa de la capciosa (0130): solo en una que ya existe, porque se guarda por su clave. */}
        {isEditing && kind === "capciosa" && initialEntry?.key && <PremiseEditor entryKey={initialEntry.key} />}

        <div className="pis-modal-field">
          <label>Estado en el catálogo</label>
          <Switch
            on={active}
            onChange={(v) => setActive(v)}
            label={active ? "Activa: Pilo la usará de inmediato" : "Inactiva: guardada pero desactivada"}
          />
        </div>

        {error && (
          <p className="pis-error" role="alert">
            {error}
          </p>
        )}

        <div className="modal-actions">
          <button type="button" className="button-ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="submit" className="button-primary" disabled={busy}>
            {busy ? "Guardando en el catálogo…" : isEditing ? "Actualizar en el catálogo" : "Guardar en el catálogo de respuestas"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
