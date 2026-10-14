/* =============================================================================
   Intranet · Mr. Pilo con IA · Funciones ampliadas (0119).

   Quién puede adjuntar un archivo para que Pilo lo analice y quién puede
   pedirle código, por cada Pilo, y los topes de las dos funciones. El archivo
   se lee en el dispositivo de la persona y no se guarda: aquí solo viven el
   permiso y los topes (tabla pilo_extras).

   Cada cambio se aplica al momento: no espera a «Guardar cambios». Sin la
   migración 0119 el grupo lo dice y queda apagado.

   Con las cuentas de Pilo (0120) hay dos topes más por cada Pilo: por cuánto
   se multiplica el cupo de quien tiene cuenta y hasta dónde pueden extenderse
   sus respuestas. Sin la migración 0120 esos dos quedan apagados.
   ========================================================================== */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { extraSettings } from "../../../components/pilo/ai/logic";
import type { ExtraAudience, ExtraSettings } from "../../../components/pilo/ai/logic";
import { Group, StatusMark } from "./ui";

const SPACES: { id: "planeacion" | "ensenanza"; name: string }[] = [
  { id: "planeacion", name: "Pilo de la Universidad" },
  { id: "ensenanza", name: "Pilo en Enseñanza" },
];

const AUDIENCES: { id: ExtraAudience; label: string }[] = [
  { id: "nadie", label: "Nadie" },
  { id: "admin", label: "Solo administración" },
  { id: "sesion", label: "Con sesión" },
  { id: "publico", label: "Todos" },
];

const KEY = ["pilo-ia", "extras-admin"];

type Rows = Record<string, ExtraSettings>;
type Patch = Partial<{ files_aud: ExtraAudience; code_aud: ExtraAudience; file_max_mb: number; file_daily: number; code_max_tokens: number; member_factor: number; member_max_tokens: number }>;
type LimitField = "file_max_mb" | "file_daily" | "code_max_tokens" | "member_factor" | "member_max_tokens";

/** Las filas, y si la tabla ya tiene los topes de las cuentas de Pilo (0120). */
interface Extras {
  rows: Rows;
  members: boolean;
}

function useExtrasAdmin() {
  return useQuery({
    queryKey: KEY,
    retry: false,
    queryFn: async (): Promise<Extras | null> => {
      const { data, error } = await supabase.from("pilo_extras").select("*");
      // Sin la migración 0119 la tabla no existe.
      if (error) return null;
      const list = (data ?? []) as { space: string; member_factor?: unknown }[];
      // Sin la migración 0120 las filas no traen los topes de las cuentas.
      return { rows: Object.fromEntries(list.map((row) => [row.space, extraSettings(row)])), members: list.length > 0 && list.every((row) => row.member_factor !== undefined) };
    },
  });
}

function useSaveExtras() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ space, patch }: { space: string; patch: Patch }) => {
      const { error } = await supabase.from("pilo_extras").update({ ...patch, updated_at: new Date().toISOString() }).eq("space", space);
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: KEY });
      void client.invalidateQueries({ queryKey: ["pilo-ia", "extras"] });
    },
  });
}

const clamp = (value: string, min: number, max: number, fallback: number) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export function ExtrasGroup() {
  const rows = useExtrasAdmin();
  const save = useSaveExtras();
  const missing = rows.data === null;
  const noMembers = !missing && !rows.isPending && rows.data?.members === false;
  const of = (space: string) => rows.data?.rows[space] ?? extraSettings(null);
  const change = (space: string, patch: Patch) => save.mutate({ space, patch });

  const audience = (space: (typeof SPACES)[number], field: "files_aud" | "code_aud", what: string) => {
    const now = of(space.id)[field === "files_aud" ? "filesAud" : "codeAud"];
    return (
      <select value={now} disabled={missing || rows.isPending} aria-label={`${what} en ${space.name}`} onChange={(e) => change(space.id, { [field]: e.target.value as ExtraAudience })}>
        {AUDIENCES.map((a) => (
          <option key={a.id} value={a.id}>
            {a.label}
          </option>
        ))}
      </select>
    );
  };

  const limit = (space: (typeof SPACES)[number], field: LimitField, label: string, min: number, max: number, off = false) => {
    const current = of(space.id);
    const value = { file_max_mb: current.fileMaxMb, file_daily: current.fileDaily, code_max_tokens: current.codeMaxTokens, member_factor: current.memberFactor, member_max_tokens: current.memberMaxTokens }[field];
    return (
      <label>
        {label}
        {/* Se guarda al salir del campo: escribir un número no dispara un guardado por cada tecla. */}
        <input key={`${space.id}-${field}-${value}`} type="number" min={min} max={max} defaultValue={value} disabled={missing || rows.isPending || off} onBlur={(e) => {
          const next = clamp(e.target.value, min, max, value);
          e.target.value = String(next);
          if (next !== value) change(space.id, { [field]: next });
        }} />
      </label>
    );
  };

  return (
    <Group
      title="Funciones ampliadas"
      aside={
        <small role="status">
          {missing ? <StatusMark tone="warn">Falta la migración 0119</StatusMark> : save.isPending ? "Guardando…" : save.isError ? <StatusMark tone="fail">No se guardó</StatusMark> : "Cada cambio se aplica al momento"}
        </small>
      }
    >
      <p className="pis-lead">
        Decida, por cada Pilo, quién puede adjuntar un archivo para que Pilo lo analice y quién puede pedirle código. El archivo se lee en el dispositivo de la persona y no se
        guarda en el servidor ni entra a la memoria de Pilo: solo viajan a la IA los pasajes que la pregunta necesita, sin correos, teléfonos ni documentos.
      </p>
      {missing && <p className="pis-warn">Falta aplicar la migración 0119 en la base: hasta entonces las dos funciones están apagadas para todos.</p>}

      <div className="pis-extras" role="table" aria-label="Quién puede usar cada función">
        <div role="row" className="pis-extras__head">
          <span role="columnheader">Función</span>
          {SPACES.map((s) => (
            <span key={s.id} role="columnheader">
              {s.name}
            </span>
          ))}
        </div>
        <div role="row">
          <span role="rowheader">
            <strong>Analizar archivos</strong>
            <small>Word, Excel, CSV y PDF con texto</small>
          </span>
          {SPACES.map((s) => (
            <span key={s.id} role="cell">
              {audience(s, "files_aud", "Analizar archivos")}
            </span>
          ))}
        </div>
        <div role="row">
          <span role="rowheader">
            <strong>Generar código</strong>
            <small>Bloques de código y respuestas más extensas</small>
          </span>
          {SPACES.map((s) => (
            <span key={s.id} role="cell">
              {audience(s, "code_aud", "Generar código")}
            </span>
          ))}
        </div>
      </div>

      {SPACES.map((s) => (
        <div key={s.id} className="pis-grid pis-grid--3" role="group" aria-label={`Topes de ${s.name}`}>
          {limit(s, "file_max_mb", `${s.name}: tamaño máximo del archivo (MB)`, 1, 25)}
          {limit(s, "file_daily", "Análisis por persona al día (0 = sin tope)", 0, 200)}
          {limit(s, "code_max_tokens", "Extensión de una respuesta con código o análisis", 400, 4000)}
        </div>
      ))}

      <p className="pis-small">
        «Con sesión» incluye al personal con cuenta en la intranet y a quien tiene una cuenta de Pilo activa. A quien no tiene permiso el clip no le aparece; si pide código, Pilo se
        lo explica en palabras. La administración no tiene tope diario.
      </p>

      <header className="pis-group__head">
        <h3>Quien tiene cuenta de Pilo</h3>
        {noMembers && (
          <small role="status">
            <StatusMark tone="warn">Falta la migración 0120</StatusMark>
          </small>
        )}
      </header>
      <p className="pis-lead">
        Quien se registra en Pilo puede preguntar más seguido que un visitante y recibir respuestas más extensas. El cupo de un visitante se fija en «Pregúntele a Pilo»; aquí, por
        cuánto se multiplica para quien tiene cuenta.
      </p>
      {noMembers && <p className="pis-warn">Falta aplicar la migración 0120 en la base: hasta entonces estos dos topes no se pueden cambiar.</p>}
      {SPACES.map((s) => (
        <div key={s.id} className="pis-grid pis-grid--3" role="group" aria-label={`Cuentas de Pilo en ${s.name}`}>
          {limit(s, "member_factor", `${s.name}: cupo de quien tiene cuenta (× el de un visitante)`, 1, 20, noMembers)}
          {limit(s, "member_max_tokens", "Extensión de sus respuestas", 400, 4000, noMembers)}
        </div>
      ))}
      {save.isError && (
        <p className="pis-error" role="alert">
          No se guardó: {(save.error as Error).message}
        </p>
      )}
    </Group>
  );
}
