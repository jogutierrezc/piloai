/* =============================================================================
   Intranet · Mr. Pilo con IA (solo administración).

   El módulo creció tarjeta por tarjeta; ahora se ordena en siete secciones,
   cada una en su pestaña del riel de la cabecera y enlazable por la dirección
   (?seccion=memoria, y en la malla también ?nodo=…):

     Conexión        el servicio de texto, su clave y la prueba.
     Voz             la voz avanzada o la del navegador, con muestra.
     Dónde aparece   las funciones y la tabla portal por portal.
     Pregúntele…     la página pública y sus respuestas guardadas.
     Memoria         fuentes, «Actualizar la memoria», la malla y la prueba.
     Catálogo        respuestas oficiales y capciosas, en Excel.
     Uso y bitácora  topes, uso de hoy y últimos pedidos.

   Arriba, una franja de estado dice de un vistazo si está encendido, si hay
   conexión, cuánto se usó hoy y qué tan grande y reciente es la memoria; cada
   dato lleva a su sección. Abajo, la barra de guardado de la intranet.

   Nada se guarda hasta «Guardar cambios», salvo las claves, la memoria y el
   catálogo, que se aplican al momento. Cada pestaña marca si tiene cambios
   sin guardar. Las secciones se montan la primera vez que se abren y luego se
   quedan (ocultas): así no se pierde un Excel a medio revisar al cambiar.
   ========================================================================== */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "../../../lib/auth";
import { AdminShell } from "../components/AdminShell";
import { ErrorBlock, LoadingBlock } from "../../../components/ui/QueryState";
import { PiloAvatar } from "../../../components/pilo/PiloAvatar";
import { PROVIDERS, normalizeSettings, probeConnection, useKeyStatus, usePiloSettings, useSavePiloSettings } from "./store";
import type { PiloSettings } from "./store";
import { useMemoryCounts } from "./memory";
import { dirtySections, joinNames, parseSection, sectionsFor } from "./mesh-view";
import type { SectionId } from "./mesh-view";
import { ConnectionSection, PortalsSection, PORTALS, UsageSection, VoiceSection } from "./sections";
import type { EditorApi, TestState } from "./sections";
import { MemorySection, PreguntaSection } from "./PreguntaCard";
import { CatalogSection } from "./CatalogCard";
import { WebSection } from "./web/WebSection";
import { AlertasSection } from "./AlertasSection";
import { UsersSection } from "./UsersSection";
import { StatusMark, Switch, plural, when } from "./ui";
import type { Tone } from "./ui";
import { revealSection } from "./motion";
import "./pilo-settings.css";

const SHELL = {
  section: "pilo" as const,
  kicker: "Sistema",
  title: "Mr. Pilo con IA",
  description: "Voz, resúmenes y síntesis con IA, la página «Pregúntele a Pilo» y su memoria. Usted decide en qué portal aparece y para quién.",
};

const SHELL_STAFF = {
  ...SHELL,
  title: "Pilo Universidad",
  description: "Los documentos, las fuentes y el catálogo de la memoria de Pilo Universidad.",
};

/** La ficha de partida del personal que no administra: ningún aviso de migración y nada que guardar. */
const STAFF_BASE: PiloSettings = (() => {
  const base = normalizeSettings({}) as unknown as Record<string, unknown>;
  for (const k of Object.keys(base)) if (k.startsWith("needs")) base[k] = false;
  return base as unknown as PiloSettings;
})();

/**
 * Quien administra (zona «conexion») edita la ficha completa. El resto de
 * Pilo Universidad solo carga documentos: su ficha no se lee (RLS la niega) ni
 * se guarda, y el espacio de Enseñanza no se mezcla aquí.
 */
export function PiloAiSettings() {
  const { canUse, canWorkInSpace } = useAuth();
  if (!canWorkInSpace("planeacion")) {
    return (
      <AdminShell {...SHELL_STAFF}>
        <p className="pis-warn" role="status">
          Su rol no trabaja en Pilo Universidad.
        </p>
      </AdminShell>
    );
  }
  return canUse("conexion") ? <FullGate /> : <Editor initial={STAFF_BASE} limited />;
}

function FullGate() {
  const settings = usePiloSettings();
  if (settings.data) return <Editor initial={settings.data} />;
  return (
    <AdminShell {...SHELL}>
      {settings.isPending ? (
        <LoadingBlock rows={6} label="Cargando la configuración de Mr. Pilo" />
      ) : settings.isError ? (
        <ErrorBlock error={settings.error} onRetry={() => settings.refetch()} />
      ) : (
        <div className="pis-missing">
          <PiloAvatar mood="cuidado" size={88} />
          <p>Falta aplicar la migración 0089 en la base para configurar a Mr. Pilo con IA.</p>
        </div>
      )}
    </AdminShell>
  );
}

/* --- Las pestañas ------------------------------------------------------------------------------ */

function SectionTabs({
  sections,
  current,
  dirty,
  onPick,
}: {
  sections: ReturnType<typeof sectionsFor>;
  current: SectionId;
  dirty: SectionId[];
  onPick: (id: SectionId, via: "pointer" | "keyboard") => void;
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const at = sections.findIndex((s) => s.id === current);
    const to =
      e.key === "ArrowRight" ? (at + 1) % sections.length
      : e.key === "ArrowLeft" ? (at - 1 + sections.length) % sections.length
      : e.key === "Home" ? 0
      : e.key === "End" ? sections.length - 1
      : -1;
    if (to < 0) return;
    e.preventDefault();
    onPick(sections[to].id, "keyboard");
    refs.current[sections[to].id]?.focus();
  };
  return (
    <div className="admin-rail pis-tabs" role="tablist" aria-label="Secciones de Mr. Pilo con IA" onKeyDown={onKey}>
      {sections.map((s) => {
        const on = s.id === current;
        const changed = dirty.includes(s.id);
        return (
          <button
            key={s.id}
            ref={(el) => (refs.current[s.id] = el)}
            type="button"
            role="tab"
            id={`pis-tab-${s.id}`}
            aria-selected={on}
            aria-controls={`pis-panel-${s.id}`}
            aria-current={on ? "page" : undefined}
            tabIndex={on ? 0 : -1}
            className="admin-rail__tab"
            onClick={() => onPick(s.id, "pointer")}
          >
            {s.label}
            {changed && (
              <span className="pis-tabs__dot" title="Cambios sin guardar">
                <span className="sr-only">(cambios sin guardar)</span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* --- La franja de estado ------------------------------------------------------------------------ */

function Fact({ label, tone, value, detail, onClick }: { label: string; tone: Tone; value: ReactNode; detail?: ReactNode; onClick: () => void }) {
  return (
    <li>
      <button type="button" className="pis-fact" onClick={onClick}>
        <span className="pis-fact__label">{label}</span>
        <StatusMark tone={tone}>{value}</StatusMark>
        {detail && <small>{detail}</small>}
      </button>
    </li>
  );
}

/* --- El editor ------------------------------------------------------------------------------------ */

function Editor({ initial, limited = false }: { initial: PiloSettings; limited?: boolean }) {
  const { canUse, canWorkInSpace } = useAuth();
  const sections = useMemo(() => sectionsFor(canUse), [canUse]);
  const [s, setS] = useState<PiloSettings>(initial);
  const [saved, setSaved] = useState(initial);
  const save = useSavePiloSettings();
  const keys = useKeyStatus(!limited);
  const counts = useMemoryCounts();
  const [test, setTest] = useState<TestState>({ state: "idle", text: "" });
  const [indexedAt, setIndexedAt] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const section = parseSection(params.get("seccion"), sections.map((x) => x.id));
  const [visited, setVisited] = useState<Set<SectionId>>(() => new Set([section]));
  const via = useRef<"pointer" | "keyboard" | null>(null);
  const panels = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    setS(initial);
    setSaved(initial);
  }, [initial]);

  useEffect(() => {
    setVisited((prev) => (prev.has(section) ? prev : new Set([...prev, section])));
  }, [section]);

  // Cambiar de sección con el puntero se ve; con el teclado, no.
  useLayoutEffect(() => {
    if (via.current === "pointer") revealSection(panels.current[section]);
    via.current = null;
  }, [section]);

  const go = (id: SectionId, how: "pointer" | "keyboard" = "pointer") => {
    if (id === section) return;
    via.current = how;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("seccion", id);
        if (id !== "memoria") next.delete("nodo");
        return next;
      },
      { replace: true },
    );
  };

  const dirty = useMemo(() => JSON.stringify(s) !== JSON.stringify(saved), [s, saved]);
  const changed = useMemo(() => dirtySections(s, saved), [s, saved]);
  const set = <K extends keyof PiloSettings>(key: K, value: PiloSettings[K]) => setS((prev) => ({ ...prev, [key]: value }));
  const setPortal: EditorApi["setPortal"] = (id, patch) =>
    setS((prev) => ({ ...prev, portals: { ...prev.portals, [id]: { ...prev.portals[id], ...patch } } }));
  const ed: EditorApi = {
    s,
    saved,
    setS,
    set,
    setPortal,
    dirty,
    keys: keys.data,
    saveNow: () => save.mutate(s),
    isSaving: save.isPending,
    saveError: save.isError ? (save.error as Error).message : null,
  };
  // «Qué lee cada portal» se aplica al momento en la base, y la base mueve el interruptor de «Fuentes»
  // (su espejo). Aquí se pone al día lo editado y lo guardado a la vez: no queda como cambio sin
  // guardar, y un «Guardar cambios» posterior no devuelve la celda a como estaba.
  const sourceApplied = (source: string, on: boolean) => {
    const patch = (prev: PiloSettings): PiloSettings => ({ ...prev, memory_sources: { ...prev.memory_sources, [source]: on } });
    setS(patch);
    setSaved(patch);
  };

  const runTest = async () => {
    if (dirty) {
      setTest({ state: "fail", text: "Guarde los cambios antes de probar." });
      return;
    }
    setTest({ state: "busy", text: "Probando…" });
    try {
      const r = await probeConnection();
      setTest(r.ok ? { state: "ok", text: `Respondió en ${r.ms} ms`, probe: r } : { state: "fail", text: r.error ?? "No respondió.", probe: r });
    } catch (e) {
      setTest({ state: "fail", text: (e as Error).message });
    }
  };

  // Lo que dice la franja de estado.
  const active = PORTALS.filter((p) => s.portals[p.id]?.on).length;
  const connected = Boolean(keys.data?.has_key && s.base_url);
  const keyInfo = keys.data?.keys?.[s.provider] ?? (keys.data?.has_key ? { has: true, last4: keys.data.last4 } : null);
  const today = keys.data?.today ?? 0;
  const share = Math.min(100, (today / Math.max(1, s.daily_limit)) * 100);
  const passages = counts.data ? Object.values(counts.data).reduce((a, b) => a + b, 0) : null;
  const lastRead = indexedAt ?? s.memory_indexed_at ?? null;
  const stale = lastRead ? Date.now() - new Date(lastRead).getTime() > 1000 * 60 * 60 * 24 * 30 : !limited;
  const askOpen = Boolean(s.portals.pregunta?.on);
  const status = !s.enabled ? "Apagado en toda la intranet" : !connected ? "Encendido, pero falta la conexión" : `Encendido en ${plural(active, "portal", "portales")}`;
  const dirtyNames = [...(s.enabled !== saved.enabled ? ["el estado general"] : []), ...changed.map((id) => sections.find((x) => x.id === id)?.label ?? id)];

  const footer = limited ? undefined : (
    <div className="pis-save" role="region" aria-label="Guardar">
      <span className="pis-save__msg" role="status">
        {save.isError ? (
          <StatusMark tone="fail">No se guardó: {(save.error as Error).message}</StatusMark>
        ) : dirty ? (
          <StatusMark tone="warn">
            Cambios sin guardar{dirtyNames.length ? ` en ${joinNames(dirtyNames)}` : ""}. Al guardar, Mr. Pilo queda {s.enabled ? `activo en ${plural(active, "portal", "portales")}` : "apagado"}.
          </StatusMark>
        ) : (
          <StatusMark tone={s.enabled ? "ok" : "off"}>Todo guardado. Mr. Pilo está {s.enabled ? `activo en ${plural(active, "portal", "portales")}` : "apagado"}.</StatusMark>
        )}
      </span>
      <span className="pis-save__actions">
        <button type="button" className="button-secondary" disabled={!dirty || save.isPending} onClick={() => setS(saved)}>
          Descartar
        </button>
        <button type="button" className="button-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate(s, { onSuccess: () => setSaved(s) })}>
          {save.isPending ? "Guardando…" : "Guardar cambios"}
        </button>
      </span>
    </div>
  );

  const body: Record<SectionId, () => ReactNode> = {
    conexion: () => <ConnectionSection ed={ed} test={test} onTest={runTest} />,
    voz: () => <VoiceSection ed={ed} />,
    portales: () => <PortalsSection ed={ed} />,
    pregunta: () => <PreguntaSection ed={ed} />,
    memoria: () => <MemorySection ed={ed} indexedAt={indexedAt} onIndexed={setIndexedAt} onSourceApplied={sourceApplied} readOnly={limited} />,
    web: () => <WebSection />,
    catalogo: () => <CatalogSection />,
    usuarios: () => <UsersSection />,
    emergencias: () => <AlertasSection />,
    uso: () => <UsageSection ed={ed} />,
  };

  return (
    <AdminShell {...(limited ? SHELL_STAFF : SHELL)} rail={<SectionTabs sections={sections} current={section} dirty={changed} onPick={go} />} footer={footer}>
      <div className="pis">
        {s.needs0090 && (
          <p className="pis-warn" role="status">
            Falta aplicar la migración 0090 en la base. Mientras tanto se puede configurar lo básico, pero Mistral y la conexión de voz aparte no se guardan.
          </p>
        )}

        {limited ? (
          <section className="pis-status" aria-label="Estado de la memoria">
            <div className="pis-status__main">
              <PiloAvatar mood="feliz" size={56} />
              <p>
                <strong>Pilo Universidad</strong>
                <span>Aquí carga los documentos y las fuentes de su memoria.</span>
              </p>
              {canWorkInSpace("ensenanza") && (
                <Link className="button-secondary" to="/admin/mr-pilo-ensenanza">
                  Cambiar a Pilo Enseñanza
                </Link>
              )}
            </div>
            <ul className="pis-facts">
              <Fact
                label="Memoria"
                tone={passages === null ? "off" : passages === 0 ? "warn" : stale ? "warn" : "ok"}
                value={passages === null ? "Sin contar" : plural(passages, "pasaje", "pasajes")}
                detail={`Actualizada ${when(lastRead)}${stale && lastRead ? " · hace más de un mes" : ""}`}
                onClick={() => go("memoria")}
              />
            </ul>
          </section>
        ) : (
          <section className="pis-status" aria-label="Estado de Mr. Pilo">
            <div className="pis-status__main">
              <PiloAvatar mood={s.enabled ? (connected ? "feliz" : "cuidado") : "duda"} size={56} />
              <p>
                <strong>{status}</strong>
                <span>
                  Resume con {PROVIDERS[s.provider].label} y lee con {s.voice_engine === "proveedor" ? "la voz de Free.ai" : "la voz del navegador"}.
                </span>
              </p>
              <label className="pis-status__switch">
                <span>{s.enabled ? "Encendido" : "Apagado"}</span>
                <Switch big on={s.enabled} onChange={(v) => set("enabled", v)} label="Mr. Pilo con IA encendido" />
              </label>
            </div>
            <ul className="pis-facts">
              <Fact
                label="Conexión"
                tone={!keyInfo?.has ? "fail" : test.state === "fail" ? "fail" : test.state === "ok" ? "ok" : connected ? "ok" : "warn"}
                value={!keyInfo?.has ? "Falta la clave" : test.state === "ok" ? "Respondió" : test.state === "fail" ? "No respondió" : "Clave guardada"}
                detail={`${PROVIDERS[s.provider].label}${keyInfo?.has ? ` · ••••${keyInfo.last4}` : ""}${test.state === "ok" ? ` · ${test.text.replace("Respondió en ", "")}` : ""}`}
                onClick={() => go("conexion")}
              />
              <Fact
                label="Dónde aparece"
                tone={!s.enabled ? "off" : active ? "ok" : "warn"}
                value={`${active} de ${PORTALS.length} portales`}
                detail={askOpen ? `Pregúntele a Pilo abierta · ${s.portals.pregunta.aud === "publico" ? "público" : s.portals.pregunta.aud === "sesion" ? "con sesión" : "solo administración"}` : "Pregúntele a Pilo cerrada"}
                onClick={() => go(askOpen ? "pregunta" : "portales")}
              />
              <Fact
                label="Uso de hoy"
                tone={share >= 90 ? "warn" : "ok"}
                value={`${today.toLocaleString("es-CO")} de ${s.daily_limit.toLocaleString("es-CO")}`}
                detail={
                  <i className="pis-fact__meter" aria-hidden="true">
                    <span style={{ transform: `scaleX(${share / 100})` }} />
                  </i>
                }
                onClick={() => go("uso")}
              />
              <Fact
                label="Memoria"
                tone={passages === null ? "off" : passages === 0 ? "warn" : stale ? "warn" : "ok"}
                value={passages === null ? "Sin contar" : plural(passages, "pasaje", "pasajes")}
                detail={`Actualizada ${when(lastRead)}${stale && lastRead ? " · hace más de un mes" : ""}`}
                onClick={() => go("memoria")}
              />
            </ul>
          </section>
        )}

        {sections.map((sec) =>
          visited.has(sec.id) || sec.id === section ? (
            <div
              key={sec.id}
              id={`pis-panel-${sec.id}`}
              role="tabpanel"
              aria-labelledby={`pis-tab-${sec.id}`}
              hidden={sec.id !== section}
              className="pis-panel"
              ref={(el) => (panels.current[sec.id] = el)}
            >
              <header className="pis-panel__head">
                <h2>{sec.title}</h2>
                <p>{sec.lead}</p>
              </header>
              <div className="pis-sheet">{body[sec.id]()}</div>
            </div>
          ) : null,
        )}
      </div>
    </AdminShell>
  );
}
