/* =============================================================================
   Los recorridos guiados de Mr. Pilo.

   Cada recorrido es una lista de paradas. Una parada puede llevar a una ruta
   (si la persona no está ya en ella) y señalar un elemento real de la
   pantalla con un selector CSS; si el elemento no aparece (por ejemplo, un
   selector de sede que solo existe con varias sedes), la parada se muestra en
   el centro. Cada una dice para qué sirve lo señalado y qué pasa al usarlo.

   Intranet: uno por rol (vicerrectoría u oficina, programa, administración).
   Arranca solo la primera vez que la persona entra; después queda el botón
   «Recorrido guiado». Portales públicos: uno por portal, desde el botón de
   Mr. Pilo en la esquina; nunca interrumpe a quien llega de fuera.
   ========================================================================== */

import type { PiloMood } from "../pilo/PiloAvatar";

export interface TourStep {
  /** Ruta donde ocurre la parada; si la persona no está en ella, se lleva allí. */
  route?: string;
  /** Selector CSS del elemento que se señala. Sin él, la parada va al centro. */
  target?: string;
  title: string;
  body: string;
  mood?: PiloMood;
}

export interface Tour {
  id: string;
  title: string;
  /** «intranet» guarda el avance en la base; «publico», en el navegador. */
  scope: "intranet" | "publico";
  /** Ruta desde donde se ofrece (portales públicos). */
  home?: string;
  steps: TourStep[];
}

export const TOURS: Tour[] = [
  {
    id: "intranet-vicerrectoria",
    title: "Recorrido de la vicerrectoría",
    scope: "intranet",
    steps: [
      {
        route: "/admin",
        target: "[data-tour='launcher-modules']",
        title: "Su lanzador",
        body: "Desde aquí entra a cada módulo. Solo aparecen los suyos: si le falta alguno, la administración de la intranet lo habilita.",
        mood: "feliz",
      },
      {
        route: "/admin/impacto/catalogo",
        target: ".admin-rail",
        title: "Las secciones de Impacto",
        body: "Mi vicerrectoría (el catálogo), Captura, Pilares y ODS, De los programas e Importar. Le muestro cada una.",
        mood: "bien",
      },
      {
        route: "/admin/impacto/catalogo",
        target: ".imp-table-wrap",
        title: "Mi vicerrectoría",
        body: "El catálogo de su función, ordenado por eslabón de la cadena de valor. Al tocar una ficha se abre su detalle a la derecha para editarla.",
        mood: "piensa",
      },
      {
        route: "/admin/impacto/catalogo",
        target: "[data-tour='imp-new']",
        title: "Nuevo indicador",
        body: "Abre la ficha a pantalla completa y le pido lo necesario en cinco pasos: qué mide, cómo se mide, metas, pilares y ODS, y revisar. Queda en borrador hasta que la publique; publicada, los programas la pueden elegir.",
        mood: "idea",
      },
      {
        route: "/admin/impacto/captura",
        target: ".imp-picker--wide",
        title: "Captura de cifras",
        body: "Primero elija el alcance: la UDES, la UDES en una sede o un programa en su sede. La hoja muestra los años; escriba o pegue desde Excel y guarde.",
        mood: "piensa",
      },
      {
        route: "/admin/impacto/importar",
        target: ".imp-import__steps",
        title: "Importar desde Excel",
        body: "Descargue la plantilla de su función, llénela (global, por sede o por programa) y cárguela. Antes de guardar le muestro qué entra y qué cambia; si una fila tiene un problema, no se carga nada.",
        mood: "idea",
      },
      {
        route: "/admin/impacto/pilares",
        target: ".imp-pillars__main .imp-toolbar",
        title: "Pilares del PDI y ODS",
        body: "A qué pilar y a qué ODS apunta cada ficha. El motor sugiere por las palabras de la ficha y usted confirma o descarta.",
        mood: "bien",
      },
      {
        route: "/admin/impacto/programas",
        title: "De los programas",
        body: "Los indicadores que crearon los programas en su función, con sus cifras. Puede relacionar cada uno con una ficha de su catálogo.",
        mood: "piensa2",
      },
      {
        route: "/admin/impacto/catalogo",
        target: ".pilo-btn",
        title: "Mr. Pilo revisa su catálogo",
        body: "Aquí estoy yo: le aviso qué fichas de condiciones CNA casi nadie reporta, cuáles no se usan y qué ideas repiten los programas, cada cosa con su acción a un clic.",
        mood: "excelente",
      },
    ],
  },
  {
    id: "intranet-programa",
    title: "Recorrido del programa",
    scope: "intranet",
    steps: [
      {
        route: "/admin",
        target: "[data-tour='launcher-modules']",
        title: "Su lanzador",
        body: "Sus módulos y lo pendiente del programa. Solo ve lo que puede usar.",
        mood: "feliz",
      },
      {
        route: "/admin/impacto/mi-catalogo",
        target: ".imp-picker",
        title: "Programa y sede",
        body: "Si dirige el programa en varias sedes, aquí elige cuál está trabajando. Todo lo que haga queda en esa sede.",
        mood: "bien",
      },
      {
        route: "/admin/impacto/mi-catalogo",
        target: ".pilo-btn",
        title: "Arme sus indicadores conmigo",
        body: "Elige los impactos que quiere demostrar, uno por función como mínimo, y le propongo una cadena completa: insumos, procesos, productos e impacto real, con el porqué de cada uno.",
        mood: "idea",
      },
      {
        route: "/admin/impacto/elegir",
        target: ".imp-select__main",
        title: "Elegir a mano",
        body: "Marcar una ficha la sigue; desmarcarla deja de seguirla sin borrar lo que ya reportó. A la derecha ve si su cadena quedó completa.",
        mood: "piensa",
      },
      {
        route: "/admin/impacto/mi-catalogo",
        target: ".imp-mine__main",
        title: "Mi catálogo",
        body: "Las fichas institucionales que sigue y, aparte, los indicadores propios del programa, ordenados por función.",
        mood: "bien",
      },
      {
        route: "/admin/impacto/mi-catalogo",
        target: ".imp-toolbar__new",
        title: "Indicadores del programa",
        body: "Para medir algo propio. Puede relacionarlo con una ficha de la vicerrectoría o dejarlo solo; la vicerrectoría lo verá.",
        mood: "idea",
      },
      {
        route: "/admin/impacto/programa",
        target: ".imp-queue",
        title: "Captura",
        body: "Un indicador a la vez: línea base, metas y la cifra de cada año con su evidencia. La marca de cada uno le dice si ya está completo.",
        mood: "piensa",
      },
      {
        route: "/admin/impacto/programa",
        target: ".imp-program .imp-seg",
        title: "Frente a la UDES",
        body: "Compare su cifra con la de la universidad y con su meta, todos los indicadores en una sola vista.",
        mood: "excelente",
      },
    ],
  },
  {
    id: "intranet-admin",
    title: "Recorrido de la administración",
    scope: "intranet",
    steps: [
      {
        route: "/admin",
        target: "[data-tour='launcher-search']",
        title: "Ir directo",
        body: "Escriba lo que quiere hacer —«usuarios», «cargar cifras»— y vaya directo a esa pantalla.",
        mood: "feliz",
      },
      {
        route: "/admin",
        target: "[data-tour='launcher-modules']",
        title: "Un cartel por módulo",
        body: "Los que tienen varias pantallas se abren como portal. Cada persona ve solo sus módulos: lo que usted habilite en Usuarios y roles, y en Impacto, según su unidad.",
        mood: "bien",
      },
      {
        route: "/admin/impacto/pilo",
        title: "Los ajustes de Mr. Pilo",
        body: "Los pesos con que le propongo indicadores a los programas y la carga de los reportes P1P2P3 (solo agregados, nunca datos de estudiantes).",
        mood: "idea",
      },
      {
        route: "/admin/impacto/sincronizacion",
        title: "La hoja anterior",
        body: "Trae lo capturado en la herramienta de Apps Script, con una revisión antes de aplicar.",
        mood: "piensa",
      },
      {
        route: "/admin",
        target: "[data-tour='launcher-tour']",
        title: "Los recorridos",
        body: "Desde aquí puede ver el recorrido de cada rol, para acompañar a las vicerrectorías y a los programas.",
        mood: "excelente",
      },
    ],
  },
  {
    // Se pide desde «Llamar a Pilo» en el taller de UDES en Cifras; no arranca solo.
    id: "intranet-taller-cifras",
    title: "Recorrido del taller de UDES en Cifras",
    scope: "intranet",
    steps: [
      {
        target: "[data-tour='odt-vista']",
        title: "Taller y vista clásica",
        body: "Con este interruptor pasa del taller a la vista clásica, la de las seis estaciones. Las dos conviven y guardan lo mismo; el navegador recuerda cuál eligió.",
        mood: "feliz",
      },
      {
        target: ".oda-rail",
        title: "Sus informes",
        body: "Aquí están los informes del periodo, con su código de dos letras y su estado. Toque uno para abrir su ficha.",
        mood: "bien",
      },
      {
        target: "[data-tour='odt-publico']",
        title: "Así lo ve el público",
        body: "Estos controles solo cambian lo que usted está mirando, como en el portal. No limitan lo que puede llenar: al editar siempre tiene todos los años del periodo.",
        mood: "piensa",
      },
      {
        target: "[data-tour='odt-bloque']",
        title: "La ficha, bloque por bloque",
        body: "Esta es la ficha tal como la verá el público. Toque un bloque para elegirlo y pulse «Editar»: se abre su editor ahí mismo, uno a la vez. En el tablero de indicadores llena todos los años de una vez, escribiendo o pegando desde Excel. «Subir», «Bajar», «Ocultar» y «Quitar» ordenan la ficha; quitar no borra cifras y se puede deshacer.",
        mood: "idea",
      },
      {
        target: "[data-tour='odt-anadir']",
        title: "Añadir algo a la ficha",
        body: "Aquí están los veinte tipos de bloque, cada uno con su explicación. Elija uno y créelo aquí mismo: un desglose, un mapa, una tabla, un separador. Queda al final de la ficha, listo para llenar.",
        mood: "bien",
      },
      {
        target: "[data-tour='odt-guardado']",
        title: "Guardado",
        body: "Si el informe no está publicado, lo que escribe se guarda solo. Si ya está publicado, los cambios quedan pendientes en este equipo hasta que usted pulse «Publicar cambios». Y si me necesita, estoy abajo, en «Llamar a Pilo».",
        mood: "excelente",
      },
    ],
  },
  {
    id: "portal-planeacion",
    title: "Conozca el portal de Planeación",
    scope: "publico",
    home: "/",
    steps: [
      { target: ".sh", title: "Todos los portales, arriba", body: "Desde esta barra pasa al Plan de Desarrollo, a UDES en Cifras y al Observatorio.", mood: "feliz" },
      { target: ".pl-search", title: "Busque una cifra", body: "Escriba lo que busca —«graduados», «presupuesto»— y le muestro la cifra y dónde está, en todos los portales a la vez.", mood: "idea" },
      { target: ".pl-mosaic", title: "Los portales", body: "Cada tarjeta es un portal: el PDI con su avance, UDES en Cifras con sus informes, los boletines y el Observatorio.", mood: "bien" },
      { target: ".pl-recent", title: "Lo más reciente", body: "Lo último que publicó la oficina: informes, boletines y novedades.", mood: "excelente" },
    ],
  },
  {
    id: "portal-pdi",
    title: "Conozca el Plan de Desarrollo",
    scope: "publico",
    home: "/pdi",
    steps: [
      { target: ".home-hero__actions", title: "Por dónde empezar", body: "La implementación muestra pilares, proyectos y evidencias; el tablero, el avance con cifras.", mood: "feliz" },
      { target: ".home-pulse", title: "El avance de un vistazo", body: "El avance global del plan y sus cifras principales, con su corte.", mood: "bien" },
      { target: "#pilares", title: "Los pilares", body: "Los ejes del plan. Cada tarjeta lleva a su detalle: áreas, proyectos y avance.", mood: "idea" },
      { target: "#tu-ruta", title: "Su ruta", body: "Diga quién es —estudiante, profesor, empresa— y le muestro lo del plan que más le toca.", mood: "excelente" },
    ],
  },
  {
    id: "portal-cifras",
    title: "Conozca UDES en Cifras",
    scope: "publico",
    home: "/datos-abiertos",
    steps: [
      { target: ".od-hero", title: "UDES en Cifras", body: "Las cifras oficiales de la universidad, con su corte y quién las reporta.", mood: "feliz" },
      { target: "#informes", title: "Los informes", body: "Once informes, uno por tema. Cada uno se puede compartir con su propio enlace.", mood: "idea" },
      { target: ".od-atlas", title: "Por sede", body: "Las cifras de cada sede, en el mapa.", mood: "bien" },
      { target: "#lectura", title: "Cómo leer las cifras", body: "Qué significa cada corte, qué es una reserva estadística y por qué un vacío no es un cero.", mood: "excelente" },
    ],
  },
  {
    id: "portal-impacto",
    title: "Conozca el Portal de Impacto",
    scope: "intranet",
    home: "/impacto",
    steps: [
      { route: "/impacto", target: "[data-tour='ipo-river']", title: "El río de la cadena de valor", body: "Tres cauces, uno por función, cruzan los cuatro eslabones: insumos, procesos, productos e impacto real. El ancho es cuántos indicadores hay; el hilo intenso, cuántos ya tienen cifra.", mood: "feliz" },
      { route: "/impacto", target: "[data-tour='ipo-views']", title: "Cuatro miradas", body: "La universidad entera, cada vicerrectoría, cada facultad y cada programa, por sede o por facultad.", mood: "bien" },
      { route: "/impacto", target: "[data-tour='ipo-links']", title: "Los lazos entre funciones", body: "El grosor del lazo dice cuántos pilares y ODS comparten Investigación, Enseñanza y Extensión. El más delgado es donde hay más por hacer juntos.", mood: "idea" },
      { route: "/impacto", target: "[data-tour='ipo-matrix']", title: "La matriz", body: "Cada dimensión y sus cuatro eslabones. Si falta uno, la cadena está rota y se ve en rojo punteado.", mood: "cuidado" },
      { route: "/impacto", target: "[data-tour='ipo-results']", title: "Los resultados", body: "Cuántos indicadores hay por eslabón y cómo van las metas 2026 con las cifras registradas en la intranet.", mood: "idea" },
      { route: "/impacto/vicerrectoria/investigacion", target: "[data-tour='ipo-fn-standing']", title: "Una vicerrectoría", body: "Cómo van sus indicadores sumando todas las facultades y todos los programas. Más abajo, su cauce, sus lazos y la cadena de cada dimensión.", mood: "bien" },
      { route: "/impacto/programas", target: "[data-tour='ipo-prog-filters']", title: "Programas por sede y facultad", body: "Filtre por sede y por facultad y abra un programa: verá cómo va cada indicador frente a su meta, por función y por sede.", mood: "idea" },
      { route: "/impacto/programas", target: "[data-tour='ipo-tour']", title: "Aquí estaré", body: "Cada gráfica tiene mi carita: tóquela y se la explico con sus propios datos. Este recorrido se repite desde aquí.", mood: "excelente" },
    ],
  },
];

export const tourById = (id: string) => TOURS.find((t) => t.id === id);

/** El recorrido público de una ruta, si lo hay. */
export const publicTourFor = (pathname: string) =>
  TOURS.find((t) => t.scope === "publico" && t.home === (pathname.replace(/\/+$/, "") || "/"));

/** El recorrido de la intranet que le toca a una persona. */
export function intranetTourFor(options: { admin: boolean; impactoSide: "programa" | "funcion" | "ambos" | null }): string | null {
  if (options.impactoSide === "funcion" || options.impactoSide === "ambos") return "intranet-vicerrectoria";
  if (options.impactoSide === "programa") return "intranet-programa";
  return options.admin ? "intranet-admin" : null;
}
