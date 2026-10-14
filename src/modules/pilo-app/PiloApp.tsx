/* =============================================================================
   Mr. Pilo · la app (/app), en el teléfono y en el computador.

   Una app instalable para las dos versiones de Mr. Pilo: el de la Universidad
   (el espacio «planeacion», el de /pregunta) y Pilo en Enseñanza (el espacio
   «ensenanza», el de /pilo-ensenanza). No es otro Pilo: usa los mismos
   perfiles (space.ts), el mismo pedido y la misma voz (client.ts), las mismas
   conversaciones guardadas (store.ts) y los mismos permisos de cada espacio.

     /app              la bienvenida la primera vez; después, la última conversación
     /app/universidad  Pilo de la Universidad
     /app/ensenanza    Pilo en Enseñanza
     /app/cuenta       crear la cuenta de Pilo, entrar, o seguir sin cuenta (0120)
     /app/perfil       los datos de la cuenta y cómo le habla Pilo
     /app/guardadas    las respuestas guardadas en la cuenta
     /app/clases       Mis clases (beta): Moodle con la cuenta de la persona, solo lectura (clases/)
     /app/notas        Mis notas (beta): Génesis con la cuenta del estudiante, solo lectura (notas/)

   Antes de conversar se acepta la política de uso (terms/): una vez por
   dispositivo y por versión, después de la bienvenida.

   Aquí se decide qué se ve: la bienvenida, cuál Pilo, con qué tema, quién usa
   la app y si hay conexión. La conversación es AppShell; la bienvenida,
   AppWelcome; la cuenta, lo de account/.

   Un usuario de Pilo tiene sesión pero no perfil de intranet: aquí cuenta
   como sesión («miembro»); en la intranet no abre nada.
   ========================================================================== */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { usePiloAiConfig } from "../../components/pilo/ai/config";
import type { Role } from "../../components/pilo/ai/logic";
import { preloadPiloFace } from "../../components/pilo/PiloFace";
import { markWelcome, readRol, readStored, seenWelcome, storageKey, writeRol, writeStored } from "../pregunta/store";
import { ASK_SPACES, asksRol } from "../pregunta/space";
import type { Rol, SpaceId } from "../pregunta/space";
import { spaceDoor } from "./access";
import { APP_ACCOUNT, APP_BASE, APP_LOGIN, APP_PATHS, readAppPath, startTarget } from "./routes";
import { AppTabs } from "./AppTabs";
import { UPane } from "./u/UPane";
import { CarnetPane } from "./carnet/CarnetPane";
import { desktopGate, isDesktopApp } from "./desktop";
import { isNative } from "./native";
import { AppPage, AppSide, useWide } from "./AppSide";
import type { Person } from "./AppSide";
import { loadSaved, readLast, removeSaved, savedEntries } from "./saved";
import type { SavedEntry } from "./saved";
import { usePiloAccount } from "./account/useAccount";
import { useSavedAnswers } from "./account/answers";
import { memberAskRol, personCard } from "./account/rules";
import { AccountGate } from "./account/AccountGate";
import { ProfilePane } from "./account/ProfilePane";
import { SavedPane } from "./account/SavedPane";
import { ClasesPane } from "./clases/ClasesPane";
import { canUseClases, clearLink } from "./clases/logic";
import { NotasPane } from "./notas/NotasPane";
import { canUseNotas, clearLink as clearNotasLink } from "./notas/logic";
import { clearGoals as clearNotasGoals } from "./notas/guia";
import { APP_PREFIX, readTheme, writeTheme } from "./themes";
import type { AppTheme } from "./themes";
import { welcomeVoice } from "./welcome-script";
import { registerAppWorker, useInstall, useKeyboardViewport, useOnline } from "./pwa";
import { AppShell } from "./AppShell";
import { AppWelcome } from "./AppWelcome";
import { TermsGate } from "./terms/TermsGate";
import { readAcceptanceState } from "./terms/acceptance";
import "../pregunta/ask-pilo.css";
import "./pilo-app-themes.css";
import "./pilo-app.css";
import "./account/account.css";
import { tr, useLang, localizeDeep } from "../../components/pilo/i18n";

const KEY_VOICE = storageKey(APP_PREFIX, "voz");
const KEY_INSTALL = storageKey(APP_PREFIX, "instalar");
const ENSENANZA = ASK_SPACES.ensenanza;

export function PiloApp() {
  useLang();
  const location = useLocation();
  const navigate = useNavigate();
  const place = readAppPath(location.pathname);
  const config = usePiloAiConfig();
  const { profile, loading, session } = useAuth();
  const role = (profile?.is_active ? profile.role : null) as Role | null;
  // La cuenta de Pilo de esta sesión (0120): activa, cuenta como sesión en los dos Pilos.
  const cuenta = usePiloAccount();
  const { account, member } = cuenta;
  // La app instalada en un computador (desktop.ts): ahí Pilo pide cuenta siempre.
  const [desktop] = useState(isDesktopApp);
  // La app de Android (native.ts): igual que en el computador, aquí Pilo pide cuenta siempre.
  const [native] = useState(isNative);
  // El Pilo que se eligió en la bienvenida (antes de entrar con la cuenta).
  const chosen = useRef<SpaceId | null>(null);
  // Lo que se eligió al final de la bienvenida de escritorio: crear la cuenta o entrar.
  const accountWay = useRef<"registro" | "ingreso" | null>(null);
  const wide = useWide();
  const online = useOnline();
  const install = useInstall();
  const root = useRef<HTMLDivElement>(null);
  const faceSlot = useRef<HTMLDivElement>(null);
  useKeyboardViewport(root);

  const [theme, setTheme] = useState<AppTheme>(readTheme);
  // La voz: encendida mientras no se apague. Vale para la bienvenida y para leer las respuestas.
  const [voiceOn, setVoiceOn] = useState(() => readStored(KEY_VOICE) !== "0");
  const [installDismissed, setInstallDismissed] = useState(() => readStored(KEY_INSTALL) === "0");
  // Quién pregunta en Enseñanza: lo mismo que recuerda su página.
  const [storedRol, setRol] = useState<Rol | null>(() => readRol(ENSENANZA.storagePrefix));
  // Con cuenta, el rol es el de la cuenta: no se pregunta ni se cambia aquí.
  const rol: Rol | null = member && account ? memberAskRol(account) : storedRol;
  const [welcoming, setWelcoming] = useState(() => place.kind === "inicio" && !seenWelcome(APP_PREFIX));
  // El Pilo que queda debajo de la bienvenida mientras se elige.
  const [home] = useState<SpaceId>(() => startTarget({ seen: true, last: readLast().space }) as SpaceId);
  // La política de uso (terms/): sin aceptarla en este dispositivo no se conversa. Se vuelve a mirar al
  // cambiar de pantalla, porque crear la cuenta también la acepta.
  const [acceptedNow, setAcceptedNow] = useState(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const terms = useMemo(() => (acceptedNow ? "vigente" : readAcceptanceState()), [acceptedNow, location.pathname]);
  // En el escritorio, sin cuenta no hay conversación: la bienvenida y las pantallas de la cuenta, nada más.
  // Vale la cuenta de Pilo o la sesión de la intranet.
  const desk = desktopGate({ desktop: desktop || native, pending: loading || cuenta.pending, signedIn: member || Boolean(role) });
  // La política se acepta al crear la cuenta o, ya dentro, antes de conversar: sin cuenta en el escritorio no se pide aún.
  const gating = desk === "libre" && terms !== "vigente" && (place.kind === "pilo" || place.kind === "inicio");
  // Con la aceptación pendiente, la bienvenida no vuela a la cabecera (queda tapada): se funde sobre ella.
  const noSlot = useRef<HTMLDivElement>(null);
  // Ya dentro, la elección de la bienvenida se olvida: si después sale de la cuenta, vuelve al ingreso.
  useEffect(() => {
    if (desk === "libre") accountWay.current = null;
  }, [desk]);

  useEffect(() => {
    registerAppWorker();
    preloadPiloFace();
    // Las poses también, y sobre todo «en obra»: sin conexión ya no se podría descargar.
    for (const pose of ["obra", "pensar", "graduado"]) new Image().src = `/pilo-face/${pose}.png`;
  }, []);

  /* El nombre de la pestaña y el color de la barra del teléfono son los de la app mientras está abierta. */
  useEffect(() => {
    const before = document.title;
    document.title = "Mr. Pilo";
    return () => {
      document.title = before;
    };
  }, []);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const color = getComputedStyle(el).getPropertyValue(welcoming || gating ? "--s2" : "--c-bar").trim();
    const metas = Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'));
    const before = metas.map((m) => m.content);
    if (color) metas.forEach((m) => (m.content = color));
    return () => metas.forEach((m, i) => (m.content = before[i]));
    // También al cambiar de ruta: en /app a secas aún no hay pantalla que medir.
  }, [theme, welcoming, gating, location.pathname]);

  /* Al aceptar la política, el foco pasa a la conversación: a la caja de escribir en el escritorio; en el
     teléfono a los mensajes, para no abrir el teclado sin que se pida. */
  const wasGating = useRef(gating);
  useEffect(() => {
    if (wasGating.current && !gating) {
      const el = root.current?.querySelector<HTMLElement>(wide ? ".pa-compose textarea" : ".pa-msgs");
      if (el && !wide && !el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
      el?.focus({ preventScroll: true });
    }
    wasGating.current = gating;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gating]);

  const rules = config.data ?? null;
  // También mientras se lee la cuenta: así un Pilo «con sesión» no parpadea como cerrado.
  const waking = online && (config.isPending || loading || cuenta.pending);
  const doors = useMemo(() => ({ planeacion: spaceDoor(rules, ASK_SPACES.planeacion, role, member), ensenanza: spaceDoor(rules, ENSENANZA, role, member) }), [rules, role, member]);
  const person: Person = useMemo(
    () => ({ card: account ? personCard(account) : null, intranet: role ? profile?.full_name || profile?.email || tr("Su cuenta") : null, saved: null, clases: canUseClases(account), notas: canUseNotas(account) }),
    [account, role, profile?.full_name, profile?.email],
  );
  const greeting = useMemo(() => (online ? welcomeVoice(doors) : null), [doors, online]);

  // Al salir de la cuenta, el permiso de Moodle de Mis clases, el de Génesis de Mis notas y las metas se borran de este dispositivo.
  useEffect(() => {
    if (!loading && !session) {
      clearLink();
      clearNotasLink();
      clearNotasGoals();
    }
  }, [loading, session]);

  const pickTheme = (next: AppTheme) => {
    setTheme(next);
    writeTheme(next);
  };
  const pickVoice = (on: boolean) => {
    setVoiceOn(on);
    writeStored(KEY_VOICE, on ? "1" : "0");
  };
  const pickRol = (chosen: Rol) => {
    writeRol(ENSENANZA.storagePrefix, chosen);
    setRol(chosen);
  };
  /** ¿Ese Pilo va a preguntar quién habla? Solo Enseñanza, si su ficha no lo apagó y aún no se sabe. */
  const willAskRol = useCallback((space: SpaceId) => space === "ensenanza" && rol === null && asksRol(ENSENANZA, doors.ensenanza.cfg), [rol, doors.ensenanza.cfg]);

  if (place.kind === "otra") return <Navigate to={APP_BASE} replace />;
  // Pantallas angostas: la barra de pestañas (Pilo, Pilo U, Carnet, Yo). En el computador manda la barra lateral.
  const tabsOn = !wide;
  // /app, ya vista la bienvenida: al Pilo de la última conversación.
  if (place.kind === "inicio" && !welcoming && desk === "libre") return <Navigate to={APP_PATHS[home]} replace />;

  /* --- La app de escritorio pide cuenta ------------------------------------------------------- */

  if (desk !== "libre" && place.kind !== "cuenta" && !welcoming) {
    if (desk === "espera") {
      return (
        <div className="pa" ref={root} data-tema={theme} aria-busy="true">
          <p className="pa-wait" role="status">
            {tr("Abriendo a Pilo…")}
          </p>
        </div>
      );
    }
    // Lo que eligió en la bienvenida; si no viene de ella, quien ya la vio vuelve a entrar y quien no, se registra.
    const way = accountWay.current ?? (seenWelcome(APP_PREFIX) ? "ingreso" : "registro");
    return <Navigate to={way === "ingreso" ? APP_LOGIN : APP_ACCOUNT} replace />;
  }

  /* --- La cuenta: registro e ingreso, perfil y guardadas ------------------------------------- */

  if (place.kind === "cuenta") {
    return (
      <div className="pa" ref={root} data-tema={theme}>
        <AccountGate
          voice={greeting}
          voiceOn={voiceOn}
          onVoice={pickVoice}
          theme={theme}
          onTheme={pickTheme}
          account={account}
          pending={cuenta.pending}
          hasSession={Boolean(session)}
          intranetName={person.intranet}
          home={APP_PATHS[chosen.current ?? home]}
          required={desktop || native}
        />
      </div>
    );
  }

  /** Desde una página que no es la conversación: Pilo se presenta otra vez, sobre ella. */
  const welcomeAgain = () => {
    setWelcoming(true);
    navigate(APP_PATHS[home]);
  };

  if (place.kind === "perfil" || place.kind === "guardadas") {
    const profilePage = place.kind === "perfil";
    return (
      <div className="pa" ref={root} data-tema={theme} data-tabs={tabsOn || undefined}>
        <AppPage
          title={profilePage ? (account ? tr("Mi perfil") : tr("Mis preferencias")) : tr("Respuestas guardadas")}
          lead={
            profilePage
              ? account
                ? tr("Sus datos y la manera en que Pilo le habla y le responde.")
                : tr("Cómo le habla Pilo y con qué tema se ve la app.")
              : tr("Lo que guarda queda en su cuenta y lo encuentra en cualquier dispositivo.")
          }
          home={APP_PATHS[home]}
          side={wide ? <PageSide home={home} active={profilePage ? "perfil" : "guardadas"} person={person} userId={session?.user.id} member={member} theme={theme} onTheme={pickTheme} onWelcome={welcomeAgain} /> : null}
        >
          {profilePage ? (
            <ProfilePane
              state={cuenta}
              theme={theme}
              onTheme={pickTheme}
              intranetName={person.intranet}
              onWelcome={welcomeAgain}
            />
          ) : (
            <SavedPane userId={session?.user.id} member={member} pending={cuenta.pending} />
          )}
        </AppPage>
        {tabsOn && <AppTabs active="yo" home={APP_PATHS[home]} />}
      </div>
    );
  }

  /* --- Mis clases (beta): solo estudiantes y profesores con cuenta ----------------------------- */

  if (place.kind === "clases") {
    return (
      <div className="pa" ref={root} data-tema={theme}>
        <AppPage
          title={tr("Mis clases")}
          tag={tr("Beta")}
          lead={tr("Pilo entra a Moodle con su cuenta para ver sus cursos y ayudarle con ellos: qué hay para esta semana, qué pide una actividad y cuándo se entrega.")}
          home={APP_PATHS[home]}
          side={wide ? <PageSide home={home} active="clases" person={person} userId={session?.user.id} member={member} theme={theme} onTheme={pickTheme} onWelcome={welcomeAgain} /> : null}
        >
          <ClasesPane state={cuenta} online={online} />
        </AppPage>
      </div>
    );
  }

  /* --- Mis notas (beta): solo estudiantes con cuenta -------------------------------------------- */

  if (place.kind === "notas") {
    return (
      <div className="pa" ref={root} data-tema={theme}>
        <AppPage
          title={tr("Mis notas")}
          tag={tr("Beta")}
          lead={tr("Pilo lo guía para leer sus notas de Génesis, las compara con sus metas y le recomienda cómo mejorar.")}
          home={APP_PATHS[home]}
          side={wide ? <PageSide home={home} active="notas" person={person} userId={session?.user.id} member={member} theme={theme} onTheme={pickTheme} onWelcome={welcomeAgain} /> : null}
        >
          {/* La voz de la guía es la de la bienvenida, con el mismo interruptor de sonido de la app. */}
          <NotasPane state={cuenta} online={online} voice={greeting} voiceOn={voiceOn} onVoice={pickVoice} />
        </AppPage>
      </div>
    );
  }

  /* --- Pilo U y el carnet: las pestañas nuevas ----------------------------------------------- */

  if (place.kind === "u" || place.kind === "carnet") {
    const isU = place.kind === "u";
    const pane = isU ? (
      <UPane vista={place.vista} state={cuenta} online={online} person={person} wide={wide} voice={greeting} voiceOn={voiceOn} onVoice={pickVoice} />
    ) : (
      <CarnetPane state={cuenta} online={online} person={person} wide={wide} />
    );
    return (
      <div className="pa" ref={root} data-tema={theme} data-tabs={tabsOn || undefined}>
        {wide ? (
          <AppPage
            title={isU ? "Pilo U" : tr("Carnet digital")}
            lead={isU ? tr("Sus clases, sus notas y su calendario, con Pilo.") : tr("Su identificación de la universidad, en el teléfono.")}
            home={APP_PATHS[home]}
            side={<PageSide home={home} active={isU ? "u" : "carnet"} person={person} userId={session?.user.id} member={member} theme={theme} onTheme={pickTheme} onWelcome={welcomeAgain} />}
          >
            {pane}
          </AppPage>
        ) : (
          <div className="pa-frame pa-frame--tab">{pane}</div>
        )}
        {tabsOn && <AppTabs active={isU ? "u" : "carnet"} home={APP_PATHS[home]} />}
      </div>
    );
  }

  const spaceId: SpaceId = place.kind === "pilo" ? place.space : home;
  const space = localizeDeep(ASK_SPACES[spaceId]);
  const door = doors[spaceId];

  return (
    <div className="pa" ref={root} data-tema={theme} data-tabs={tabsOn && !welcoming && !gating ? true : undefined}>
      {/* Mientras la bienvenida o la aceptación están encima, lo de debajo no se enfoca ni se lee. */}
      <ShellFrame inert={welcoming || gating}>
        <AppShell
          account={cuenta}
          // Cada Pilo monta su propia conversación: nada de uno queda en la memoria del otro.
          key={space.id}
          space={space}
          door={door}
          waking={waking}
          online={online}
          person={person}
          member={member}
          wide={wide}
          theme={theme}
          onTheme={pickTheme}
          voiceOn={voiceOn}
          onVoice={pickVoice}
          rol={rol}
          onRol={pickRol}
          faceSlot={faceSlot}
          welcoming={welcoming}
          gating={gating}
          onWelcome={() => setWelcoming(true)}
          onSwitch={(next, open) => navigate(APP_PATHS[next], { replace: true, state: open ? { open } : null })}
          install={{
            way: install.way,
            dismissed: installDismissed,
            run: () => void install.install(),
            dismiss: () => {
              setInstallDismissed(true);
              writeStored(KEY_INSTALL, "0");
            },
          }}
        />
      </ShellFrame>
      {tabsOn && !welcoming && !gating && <AppTabs active="pilo" home={APP_PATHS[home]} />}

      {/* «Antes de empezar»: debajo de la bienvenida mientras dura, y activa cuando esta termina. */}
      {gating && <TermsGate active={!welcoming} changed={terms === "cambio"} onAccept={() => setAcceptedNow(true)} />}

      {welcoming && (
        <AppWelcome
          target={gating ? noSlot : faceSlot}
          voice={greeting}
          voiceOn={voiceOn}
          onVoice={pickVoice}
          asksRol={willAskRol}
          fallback={spaceId}
          onChoose={(next) => {
            // Con la cuenta obligatoria, el Pilo elegido aquí es al que se vuelve tras crearla o entrar.
            chosen.current = next;
            if (place.kind !== "pilo" || place.space !== next) navigate(APP_PATHS[next], { replace: true });
          }}
          onRol={pickRol}
          onDone={() => {
            markWelcome(true, APP_PREFIX);
            setWelcoming(false);
          }}
          desktop={desktop}
          native={native}
          needsAccount={desk !== "libre"}
          onAccount={(way) => (accountWay.current = way)}
        />
      )}
    </div>
  );
}

/** La barra lateral del escritorio en las pantallas que no son la conversación: lleva a ella. */
function PageSide({
  home,
  active,
  person,
  userId,
  member,
  theme,
  onTheme,
  onWelcome,
}: {
  home: SpaceId;
  active: "perfil" | "guardadas" | "clases" | "notas" | "u" | "carnet";
  person: Person;
  userId: string | undefined;
  member: boolean;
  theme: AppTheme;
  onTheme: (theme: AppTheme) => void;
  onWelcome: () => void;
}) {
  const navigate = useNavigate();
  const [convs, setConvs] = useState(() => ({ planeacion: loadSaved("planeacion"), ensenanza: loadSaved("ensenanza") }));
  const entries = useMemo(() => savedEntries(convs), [convs]);
  const kept = useSavedAnswers(userId, member);
  return (
    <AppSide
      space={home}
      saved={entries}
      currentId={null}
      active={active}
      person={{ ...person, saved: member ? (kept.data?.length ?? null) : null }}
      onOpen={(entry: SavedEntry) => navigate(APP_PATHS[entry.space], { state: { open: entry.id } })}
      onDelete={(entry: SavedEntry) => setConvs((c) => ({ ...c, [entry.space]: removeSaved(entry.space, entry.id) }))}
      onNew={() => navigate(APP_PATHS[home], { state: { nueva: true } })}
      onSwitch={(space) => navigate(APP_PATHS[space])}
      theme={theme}
      onTheme={onTheme}
      onWelcome={onWelcome}
    />
  );
}

/** La conversación, que ocupa las tres filas de la app; inerte mientras la bienvenida la tapa. */
function ShellFrame({ inert, children }: { inert: boolean; children: React.ReactNode }) {
  const frame = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    if (inert) el.setAttribute("inert", "");
    else el.removeAttribute("inert");
  }, [inert]);
  return (
    <div className="pa-frame" ref={frame} aria-hidden={inert || undefined}>
      {children}
    </div>
  );
}
