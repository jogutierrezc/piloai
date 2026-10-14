/* =============================================================================
   Intranet · Mr. Pilo con IA · Páginas web · Navegador (0132).

   El control mínimo para conectar el servicio de navegador: su dirección, su
   clave y su interruptor. Cada cosa se guarda al momento, aparte de «Guardar
   cambios». La clave se escribe una vez y no vuelve a mostrarse. Apagado (o
   sin configurar), Pilo lee las páginas como siempre, sin ejecutar JavaScript.
   ========================================================================== */

import { useEffect, useState } from "react";
import { Icon } from "../../../../components/ui/Icon";
import { Group, Switch } from "../ui";
import { checkBrowserKey, checkBrowserUrl, saveBrowser, saveBrowserKey, useBrowser, useRefreshBrowser } from "./browser";

type Busy = "url" | "key" | "on" | null;

export function BrowserService({ enabled = true }: { enabled?: boolean }) {
  const setup = useBrowser(enabled);
  const refresh = useRefreshBrowser();
  const data = setup.data ?? null;
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [editKey, setEditKey] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");

  // La dirección guardada llega después de montar.
  useEffect(() => {
    if (data) setUrl(data.url);
  }, [data?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: Exclude<Busy, null>, lead: string, work: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(what);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(`${lead}: ${e instanceof Error ? e.message : "algo falló."}`);
    } finally {
      setBusy(null);
      refresh();
    }
  };

  const saveUrl = () => {
    const checked = checkBrowserUrl(url);
    if (!checked.ok) return setError(checked.why);
    void act("url", "No se guardó la dirección", () => saveBrowser({ url: checked.url }));
  };

  const saveKey = () => {
    const checked = checkBrowserKey(key);
    if (!checked.ok) return setError(checked.why);
    void act("key", "No se guardó la clave", async () => {
      await saveBrowserKey(checked.key);
      setKey("");
      setEditKey(false);
    });
  };

  const canTurnOn = Boolean(data?.url && data.key.has);

  return (
    <Group title="Navegador" aside={<small>{data?.ready ? "Encendido" : data?.missing ? "" : "Apagado"}</small>}>
      <p className="pis-small">
        Para páginas que arman su contenido con JavaScript o lo guardan en pestañas y botones «ver más». Es un servicio aparte (carpeta <code>navegador/</code> del
        repositorio) que la Universidad aloja; sin él, Pilo lee las páginas sin ejecutar JavaScript.
      </p>
      {setup.isPending && enabled ? (
        <p className="pis-small">Leyendo la conexión con el navegador…</p>
      ) : setup.isError ? (
        <p className="pis-error" role="alert">
          No se pudo leer la conexión con el navegador.
        </p>
      ) : !data || data.missing ? (
        <p className="pis-note" role="note">
          Falta aplicar la migración 0132 en la base para conectar el navegador.
        </p>
      ) : (
        <>
          <form
            className="pwb-form"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              saveUrl();
            }}
          >
            <label className="pwb-field">
              <span>Dirección del servicio</span>
              <input
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={url}
                placeholder="https://navegador.…"
                onChange={(e) => {
                  setUrl(e.target.value);
                  setError("");
                }}
              />
            </label>
            <div className="pis-actions">
              <button type="submit" className="button-secondary" disabled={Boolean(busy) || !url.trim() || url.trim() === data.url}>
                {busy === "url" ? "Guardando…" : "Guardar dirección"}
              </button>
            </div>
          </form>

          <div className="pis-key">
            <span className="pis-key__label">
              Clave del servicio
              <small>La misma de NAVEGADOR_CLAVE. Se escribe una vez y no vuelve a mostrarse.</small>
            </span>
            {editKey || !data.key.has ? (
              <form
                className="pis-key__form"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveKey();
                }}
              >
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={key}
                  placeholder="Pegue aquí la clave"
                  aria-label="Clave del servicio de navegador"
                  onChange={(e) => {
                    setKey(e.target.value);
                    setError("");
                  }}
                />
                <button type="submit" className="button-primary" disabled={!key.trim() || Boolean(busy)}>
                  {busy === "key" ? "Guardando…" : "Guardar clave"}
                </button>
                {data.key.has && (
                  <button type="button" className="button-secondary" onClick={() => (setEditKey(false), setKey(""))}>
                    Cancelar
                  </button>
                )}
              </form>
            ) : (
              <div className="pis-key__saved">
                <Icon name="lock" size={17} />
                <span>
                  Guardada en el servidor · termina en <b>••••{data.key.last4}</b>
                </span>
                <button type="button" className="button-secondary" onClick={() => setEditKey(true)}>
                  Cambiar clave
                </button>
                <button type="button" className="pis-link pis-link--danger" disabled={Boolean(busy)} onClick={() => void act("key", "No se quitó la clave", () => saveBrowserKey(""))}>
                  Quitar
                </button>
              </div>
            )}
          </div>

          <div className="pis-row">
            <span className="pis-fn__text">
              <strong>Usar el navegador</strong>
              <small>{canTurnOn ? "Encendido, al leer una página aparece la casilla «Abrir con navegador»." : "Guarde la dirección y la clave para poder encenderlo."}</small>
            </span>
            <Switch on={data.enabled} disabled={Boolean(busy) || (!data.enabled && !canTurnOn)} onChange={(on) => void act("on", "No se cambió el navegador", () => saveBrowser({ enabled: on }))} label="Usar el navegador para leer páginas" />
          </div>
          {error && (
            <p className="pis-error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </Group>
  );
}
