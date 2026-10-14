/* =============================================================================
   Intranet · Mr. Pilo con IA · Emergencias (0138).

   La conexión de Pilo con Aluna2 (aluna2.udesplanea.com): cuando Aluna declara
   un sismo, un incendio o una emergencia de seguridad, Pilo muestra una capa a
   todos sus usuarios; cuando Aluna la cierra, la capa se retira. Aquí se
   enciende, se conecta por la API REST de Aluna, se prueba y se ensaya.

   Cada cambio se aplica al momento: no espera a «Guardar cambios». Las dos
   claves (la de integración y la del webhook) se guardan en el servidor y no
   vuelven: solo se ve cómo terminan. Sin la migración 0138 la sección lo dice.
   ========================================================================== */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { Icon } from "../../../components/ui/Icon";
import { AlertaVistaPrevia } from "../../../components/alertas/AlertaEmergencia";
import { NOMBRE_KIND, filasDe, COLUMNAS_ALERTA, haceCuanto } from "../../../components/alertas/logic";
import type { KindAlerta } from "../../../components/alertas/logic";
import { Group, StatusMark, Switch } from "./ui";

const KEY = ["pilo-alertas", "ajustes"];
const KEY_SECRETOS = ["pilo-alertas", "claves"];
const KEY_FILAS = ["pilo-alertas", "filas"];

interface Ajustes {
  enabled: boolean;
  api_url: string;
  types: string[];
  webhook_on: boolean;
  poll_on: boolean;
  last_sync_at: string | null;
  last_sync_ok: boolean | null;
  last_sync_detail: string | null;
}

interface EstadoClave {
  has: boolean;
  last4: string;
}
interface Claves {
  api_key: EstadoClave;
  webhook_secret: EstadoClave;
}

const TIPOS: { id: string; label: string; hint: string }[] = [
  { id: "emergencia", label: "Emergencias", hint: "Sismo, incendio, amenaza. Lo que de verdad evacúa." },
  { id: "obligatoria", label: "Avisos obligatorios", hint: "Comunicados que Aluna exige confirmar. Normalmente no son una alerta." },
  { id: "informativo", label: "Informativos", hint: "Avisos generales. No se recomienda: llenarían la capa de ruido." },
];

const SIMULACROS: { id: KindAlerta; label: string }[] = [
  { id: "sismo", label: "Sismo" },
  { id: "incendio", label: "Incendio" },
  { id: "seguridad", label: "Seguridad" },
  { id: "general", label: "Emergencia general" },
];

function useAjustes() {
  return useQuery({
    queryKey: KEY,
    retry: false,
    queryFn: async (): Promise<Ajustes | null> => {
      const { data, error } = await supabase.from("pilo_alert_settings").select("*").maybeSingle();
      // Sin la migración 0138 la tabla no existe.
      return error ? null : (data as Ajustes | null);
    },
  });
}

function useClaves() {
  return useQuery({
    queryKey: KEY_SECRETOS,
    retry: false,
    queryFn: async (): Promise<Claves | null> => {
      const { data, error } = await supabase.rpc("pilo_alert_secret_status");
      return error ? null : (data as Claves);
    },
  });
}

function useFilas() {
  return useQuery({
    queryKey: KEY_FILAS,
    retry: false,
    refetchInterval: 15000,
    queryFn: async () => {
      const { data, error } = await supabase.from("pilo_alerts").select(COLUMNAS_ALERTA).order("emitted_at", { ascending: false }).limit(8);
      return error ? [] : filasDe(data);
    },
  });
}

function useGuardar() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Pick<Ajustes, "enabled" | "api_url" | "types" | "webhook_on" | "poll_on">>) => {
      const { error } = await supabase.from("pilo_alert_settings").update(patch).eq("id", true);
      if (error) throw new Error(error.message);
    },
    onSettled: () => void client.invalidateQueries({ queryKey: KEY }),
  });
}

/** Llama a la función `pilo-alertas` con la sesión de la administración. */
async function llamar(action: "probar" | "sync"): Promise<{ ok: boolean; mensaje: string }> {
  const { data, error } = await supabase.functions.invoke<{ ok?: boolean; message?: string; error?: string }>("pilo-alertas", { body: { action } });
  if (!error) return { ok: data?.ok === true, mensaje: data?.message ?? data?.error ?? "La función no respondió lo esperado." };
  const response = (error as { context?: Response }).context;
  if (response?.status === 404) return { ok: false, mensaje: "La función «pilo-alertas» todavía no está desplegada en el servidor." };
  try {
    const leido = (await response?.json()) as { error?: unknown };
    if (typeof leido?.error === "string") return { ok: false, mensaje: leido.error };
  } catch {
    // Respondió algo que no es JSON: vale el mensaje genérico.
  }
  return { ok: false, mensaje: "No se pudo hablar con la función «pilo-alertas». Revise que esté desplegada." };
}

function ClaveAluna({ which, label, hint, estado }: { which: "api_key" | "webhook_secret"; label: string; hint: string; estado: EstadoClave | undefined }) {
  const client = useQueryClient();
  const [valor, setValor] = useState("");
  const [editando, setEditando] = useState(false);
  const guardar = useMutation({
    mutationFn: async (v: string) => {
      const { error } = await supabase.rpc("pilo_alert_secret_set", { p_which: which, p_value: v });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setValor("");
      setEditando(false);
      void client.invalidateQueries({ queryKey: KEY_SECRETOS });
    },
  });
  const hay = estado?.has === true;
  return (
    <div className="pis-key">
      <span className="pis-key__label">
        {label}
        <small>{hint}</small>
      </span>
      {hay && !editando ? (
        <div className="pis-key__saved">
          <Icon name="lock" size={17} />
          <span>
            Guardada en el servidor{estado?.last4 ? <> · termina en <b>••••{estado.last4}</b></> : null}
          </span>
          <button type="button" className="button-secondary" onClick={() => setEditando(true)}>
            Cambiar
          </button>
        </div>
      ) : (
        <form
          className="pis-key__form"
          onSubmit={(e) => {
            e.preventDefault();
            if (valor.trim()) guardar.mutate(valor);
          }}
        >
          <input type="password" autoComplete="off" spellCheck={false} value={valor} placeholder="Pegue aquí la clave" aria-label={label} onChange={(e) => setValor(e.target.value)} />
          <button type="submit" className="button-primary" disabled={!valor.trim() || guardar.isPending}>
            {guardar.isPending ? "Guardando…" : "Guardar clave"}
          </button>
          {hay && (
            <button type="button" className="button-secondary" onClick={() => setEditando(false)}>
              Cancelar
            </button>
          )}
        </form>
      )}
      {guardar.isError && (
        <p className="pis-error" role="alert">
          No se guardó: {(guardar.error as Error).message}
        </p>
      )}
    </div>
  );
}

export function AlertasSection() {
  const client = useQueryClient();
  const ajustes = useAjustes();
  const claves = useClaves();
  const filas = useFilas();
  const guardar = useGuardar();
  const [prueba, setPrueba] = useState<{ estado: "idle" | "busy" | "ok" | "fail"; texto: string }>({ estado: "idle", texto: "" });
  const [previa, setPrevia] = useState<{ kind: KindAlerta; simulacro: boolean } | null>(null);
  const [kind, setKind] = useState<KindAlerta>("sismo");
  const [confirma, setConfirma] = useState(false);
  const [urlEscrita, setUrlEscrita] = useState<string | null>(null);

  const falta = ajustes.data === null;
  const s = ajustes.data ?? null;
  const urlWebhook = `${(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/pilo-alertas`;
  const simulacroActivo = (filas.data ?? []).some((f) => f.source === "simulacro" && f.state === "activa");
  const activas = (filas.data ?? []).filter((f) => f.state === "activa");

  const correr = async (accion: "probar" | "sync") => {
    setPrueba({ estado: "busy", texto: accion === "probar" ? "Probando la conexión…" : "Consultando a Aluna…" });
    const r = await llamar(accion);
    setPrueba({ estado: r.ok ? "ok" : "fail", texto: r.mensaje });
    void client.invalidateQueries({ queryKey: KEY });
    void client.invalidateQueries({ queryKey: KEY_FILAS });
  };

  const simulacro = useMutation({
    mutationFn: async (accion: "iniciar" | "terminar") => {
      const { error } = accion === "iniciar" ? await supabase.rpc("pilo_alert_drill_start", { p_kind: kind }) : await supabase.rpc("pilo_alert_drill_end");
      if (error) throw new Error(error.message);
    },
    onSettled: () => {
      setConfirma(false);
      void client.invalidateQueries({ queryKey: KEY_FILAS });
    },
  });

  const toggleTipo = (id: string) => {
    if (!s) return;
    const next = s.types.includes(id) ? s.types.filter((t) => t !== id) : [...s.types, id];
    if (next.length) guardar.mutate({ types: next });
  };

  const tono = !s ? "off" : !s.enabled ? "off" : activas.length ? "fail" : s.last_sync_ok === false ? "warn" : "ok";
  const resumen = !s ? "Sin conexión con la base" : !s.enabled ? "Apagada: Pilo no muestra alertas" : activas.length ? `${activas.length} emergencia(s) activa(s) ahora` : "Encendida y a la espera de Aluna";

  return (
    <>
      <Group
        title="Alerta de emergencias"
        aside={
          <small role="status">
            {falta ? <StatusMark tone="warn">Falta la migración 0138</StatusMark> : guardar.isPending ? "Guardando…" : guardar.isError ? <StatusMark tone="fail">No se guardó</StatusMark> : <StatusMark tone={tono}>{resumen}</StatusMark>}
          </small>
        }
      >
        <p className="pis-lead">
          Aluna2 declara los sismos, incendios y emergencias de seguridad del campus. Con esta capa encendida, Mr. Pilo cubre cualquier página con la alerta, para todos sus usuarios y
          con o sin sesión, mientras la emergencia esté activa; cuando Aluna la cierra, la capa se retira sola. Sin emergencia no se ve nada ni se hacen consultas.
        </p>
        {falta && <p className="pis-warn">Falta aplicar la migración 0138 en la base y desplegar la función «pilo-alertas». Hasta entonces la capa está dormida.</p>}
        <div className="pis-row">
          <span className="pis-fn__text">
            <strong>Recibir las alertas de Aluna</strong>
            <small>Apagada, Pilo ignora todo lo que llegue de Aluna. Las alertas ya abiertas siguen visibles hasta que se cierren.</small>
          </span>
          <Switch big on={s?.enabled === true} disabled={!s} label="Recibir las alertas de Aluna" onChange={(v) => guardar.mutate({ enabled: v })} />
        </div>
      </Group>

      <Group title="Conexión con Aluna">
        <p className="pis-lead">
          Pilo usa la API REST de Aluna. En el panel de Aluna (Integraciones) cree una integración para Pilo: Aluna entrega su <b>clave</b> una sola vez, y péguela aquí. Para que el aviso llegue
          en segundos, cree también un <b>webhook</b> con la dirección de abajo y pegue aquí el secreto que Aluna le muestre.
        </p>
        <div className="pis-grid" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
          <label>
            Dirección de la API de Aluna
            <input
              type="url"
              inputMode="url"
              spellCheck={false}
              disabled={!s}
              value={urlEscrita ?? s?.api_url ?? ""}
              onChange={(e) => setUrlEscrita(e.target.value)}
              onBlur={() => {
                if (urlEscrita !== null && urlEscrita.trim() !== s?.api_url) guardar.mutate({ api_url: urlEscrita.trim() });
                setUrlEscrita(null);
              }}
            />
          </label>
        </div>
        <p className="pis-small">
          Es la función <code>api-alertas</code> del servidor de Aluna (termina en <code>/functions/v1/api-alertas</code>). Debe ser https. Se guarda al salir del campo.
          {guardar.isError && (
            <>
              {" "}
              <StatusMark tone="fail">{(guardar.error as Error).message.includes("api_url") ? "Esa dirección no es válida." : "No se guardó."}</StatusMark>
            </>
          )}
        </p>
        <ClaveAluna which="api_key" label="Clave de integración de Aluna" hint="Va en el encabezado Authorization: Bearer. Se guarda al momento." estado={claves.data?.api_key} />
        <ClaveAluna which="webhook_secret" label="Secreto del webhook de Aluna" hint="Con él Pilo comprueba que el aviso viene de Aluna. Se guarda al momento." estado={claves.data?.webhook_secret} />

        <div className="pis-key">
          <span className="pis-key__label">
            Dirección del webhook, para pegar en Aluna
            <small>Aluna manda aquí cada aviso emitido, firmado con x-aluna-firma.</small>
          </span>
          <div className="pis-key__saved">
            <code style={{ overflowWrap: "anywhere" }}>{urlWebhook}</code>
            <button type="button" className="button-secondary" onClick={() => void navigator.clipboard?.writeText(urlWebhook)}>
              Copiar
            </button>
          </div>
        </div>

        <div className="pis-row">
          <span className="pis-fn__text">
            <strong>Recibir por webhook</strong>
            <small>Aluna avisa en segundos. Hace falta el secreto del webhook.</small>
          </span>
          <Switch on={s?.webhook_on === true} disabled={!s} label="Recibir por webhook" onChange={(v) => guardar.mutate({ webhook_on: v })} />
        </div>
        <div className="pis-row">
          <span className="pis-fn__text">
            <strong>Consultar a Aluna cada minuto</strong>
            <small>Respaldo del webhook y la única forma de saber que una emergencia se cerró. Hace falta la clave y el cron (migración 0138, al final).</small>
          </span>
          <Switch on={s?.poll_on === true} disabled={!s} label="Consultar a Aluna cada minuto" onChange={(v) => guardar.mutate({ poll_on: v })} />
        </div>

        <div className="pis-row">
          <span className="pis-note" role="status" aria-live="polite">
            {prueba.estado === "idle" ? (
              s?.last_sync_at ? (
                <StatusMark tone={s.last_sync_ok ? "ok" : "fail"}>
                  Última consulta {haceCuanto(s.last_sync_at, Date.now())}: {s.last_sync_detail ?? (s.last_sync_ok ? "bien" : "falló")}
                </StatusMark>
              ) : (
                <StatusMark tone="off">Aún no se ha consultado a Aluna</StatusMark>
              )
            ) : (
              <StatusMark tone={prueba.estado === "ok" ? "ok" : prueba.estado === "fail" ? "fail" : "warn"}>{prueba.texto}</StatusMark>
            )}
          </span>
          <span className="pis-save__actions">
            <button type="button" className="button-secondary" disabled={falta || prueba.estado === "busy"} onClick={() => void correr("probar")}>
              Probar conexión
            </button>
            <button type="button" className="button-secondary" disabled={falta || !s?.enabled || prueba.estado === "busy"} onClick={() => void correr("sync")}>
              Consultar ahora
            </button>
          </span>
        </div>
      </Group>

      <Group title="Qué avisos levantan la capa">
        <p className="pis-lead">Aluna tiene tres clases de aviso. Por partida, solo las emergencias levantan la capa.</p>
        <div className="pis-extras" role="group" aria-label="Clases de aviso que levantan la capa">
          {TIPOS.map((t) => (
            <div key={t.id} className="pis-row">
              <span className="pis-fn__text">
                <strong>{t.label}</strong>
                <small>{t.hint}</small>
              </span>
              <Switch on={s?.types.includes(t.id) === true} disabled={!s || (s.types.length === 1 && s.types.includes(t.id))} label={t.label} onChange={() => toggleTipo(t.id)} />
            </div>
          ))}
        </div>
        <p className="pis-small">Siempre debe quedar al menos una clase encendida.</p>
      </Group>

      <Group title="Ensayar la alerta">
        <p className="pis-lead">
          La <b>vista previa</b> muestra la capa solo en esta pantalla, con la voz de Mr. Pilo. El <b>simulacro</b> la muestra a todos los usuarios de Pilo, marcada como simulacro, hasta que se termine: úselo con
          aviso previo.
        </p>
        <div className="pis-row">
          <label className="pis-fn__text">
            <strong>Tipo de emergencia</strong>
            <select value={kind} onChange={(e) => setKind(e.target.value as KindAlerta)}>
              {SIMULACROS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
          </label>
          <span className="pis-save__actions">
            <button type="button" className="button-secondary" onClick={() => setPrevia({ kind, simulacro: false })}>
              Ver como emergencia
            </button>
            <button type="button" className="button-secondary" onClick={() => setPrevia({ kind, simulacro: true })}>
              Ver como simulacro
            </button>
            {simulacroActivo ? (
              <button type="button" className="button-primary" disabled={simulacro.isPending} onClick={() => simulacro.mutate("terminar")}>
                Terminar el simulacro
              </button>
            ) : confirma ? (
              <>
                <button type="button" className="button-secondary" onClick={() => setConfirma(false)}>
                  No lanzarlo
                </button>
                <button type="button" className="button-primary pis-danger" disabled={simulacro.isPending || falta} onClick={() => simulacro.mutate("iniciar")}>
                  Sí, mostrarlo a todos
                </button>
              </>
            ) : (
              <button type="button" className="button-primary" disabled={falta} onClick={() => setConfirma(true)}>
                Lanzar simulacro para todos
              </button>
            )}
          </span>
        </div>
        {simulacro.isError && (
          <p className="pis-error" role="alert">
            No se pudo: {(simulacro.error as Error).message}
          </p>
        )}
      </Group>

      <Group title="Últimas alertas" aside={<small>Se actualiza sola</small>}>
        {(filas.data ?? []).length === 0 ? (
          <p className="pis-small">Todavía no ha llegado ninguna alerta.</p>
        ) : (
          <ul className="pis-list" style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
            {(filas.data ?? []).map((f) => (
              <li key={f.id} className="pis-row">
                <span className="pis-fn__text">
                  <strong>
                    {f.source === "simulacro" ? "Simulacro · " : ""}
                    {NOMBRE_KIND[f.kind]} · {f.title}
                  </strong>
                  <small>
                    {haceCuanto(f.emitted_at, Date.now())}
                    {f.state === "cerrada" && f.closed_at ? ` · cerrada ${haceCuanto(f.closed_at, Date.now())}` : ""}
                  </small>
                </span>
                <StatusMark tone={f.state === "activa" ? "fail" : "off"}>{f.state === "activa" ? "Activa" : "Cerrada"}</StatusMark>
              </li>
            ))}
          </ul>
        )}
      </Group>

      {previa && <AlertaVistaPrevia kind={previa.kind} simulacro={previa.simulacro} onClose={() => setPrevia(null)} />}
    </>
  );
}
