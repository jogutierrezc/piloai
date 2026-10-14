/* =============================================================================
   Set de íconos del portal.
   Antes cada vista usaba glifos Unicode sueltos (✦ ⌘ ↗ ◈ ♧ ◉): pesos, alturas
   y estilos distintos, con un ⌘ —la tecla Command de macOS— representando el
   pilar de tecnología. Aquí todos comparten rejilla de 24, trazo de 1.75 y
   remates redondos, así que se leen como una sola familia.
   ========================================================================== */

import type { SVGProps } from "react";

export type PillarIconName = "person" | "chip" | "spark" | "columns" | "leaf" | "community";

export type IconName =
  | PillarIconName
  | "arrow-right"
  | "arrow-left"
  | "search"
  | "menu"
  | "close"
  | "sun"
  | "moon"
  | "check"
  | "alert"
  | "clock"
  | "lock"
  | "user"
  | "key"
  | "external"
  | "chevron-down"
  | "document"
  | "settings"
  | "grid"
  | "plus"
  | "code"
  | "table"
  | "chart"
  | "pin"
  | "compass"
  | "download"
  | "sidebar"
  | "upload"
  | "mail"
  | "shield"
  | "eye"
  | "eye-off"
  | "layers"
  | "filter"
  | "spark-chart"
  | "grip";

const paths: Record<IconName, JSX.Element> = {
  /* --- Pilares ---------------------------------------------------------- */
  person: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </>
  ),
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="2.2" />
      <path d="M10.6 10.6h2.8v2.8h-2.8z" />
      <path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3" />
    </>
  ),
  spark: (
    <>
      <path d="M12 3.5 13.9 9l5.6 1.4-4.2 3.6 1 5.5-4.3-2.9-4.3 2.9 1-5.5L4.5 10.4 10.1 9z" />
    </>
  ),
  columns: (
    <>
      <path d="M3.5 20h17M4.5 9.5h15M12 3.5l8 6h-16z" />
      <path d="M7.5 12.5v5M12 12.5v5M16.5 12.5v5" />
    </>
  ),
  leaf: (
    <>
      <path d="M20 4.5c0 8.3-4.2 12.5-10 12.5-2 0-3.5-.4-4.6-1.2C4 14.6 4 12 5.4 9.8 7.5 6.4 12.6 4.9 20 4.5Z" />
      <path d="M15.5 8.5C11 11 8 14.5 6.5 20" />
    </>
  ),
  community: (
    <>
      <circle cx="9" cy="8.5" r="2.8" />
      <path d="M3.6 19.5a5.4 5.4 0 0 1 10.8 0" />
      <path d="M16 6.2a2.8 2.8 0 0 1 0 5.4" />
      <path d="M17.2 14.4a5.4 5.4 0 0 1 3.2 5.1" />
    </>
  ),

  /* --- Interfaz --------------------------------------------------------- */
  "arrow-right": <path d="M4.5 12h15M13.5 6l6 6-6 6" />,
  "arrow-left": <path d="M19.5 12h-15M10.5 6l-6 6 6 6" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  sun: (
    <>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </>
  ),
  moon: <path d="M20 14.2A8.4 8.4 0 0 1 9.8 4 8.4 8.4 0 1 0 20 14.2Z" />,
  check: <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />,
  alert: (
    <>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4" />
      <circle cx="12" cy="16.8" r=".5" fill="currentColor" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  lock: (
    <>
      <rect x="4.8" y="10.4" width="14.4" height="9.3" rx="2.2" />
      <path d="M8.4 10.4V7.8a3.6 3.6 0 0 1 7.2 0v2.6" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </>
  ),
  key: (
    <>
      <circle cx="8.2" cy="8.2" r="3.7" />
      <path d="m10.9 10.9 8.4 8.4M16.4 16.4l-1.9 1.9M18.6 18.6l-1.6 1.6" />
    </>
  ),
  external: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 14.5v4a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 4 18.5v-10A1.5 1.5 0 0 1 5.5 7h4" />,
  "chevron-down": <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  document: (
    <>
      <path d="M13.5 3.5H7a1.5 1.5 0 0 0-1.5 1.5v14A1.5 1.5 0 0 0 7 20.5h10a1.5 1.5 0 0 0 1.5-1.5V8.5z" />
      <path d="M13.5 3.5v5h5M8.8 13h6.4M8.8 16.4h4.4" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="2.9" />
      <path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3.9a7 7 0 0 0-2.1-1.2L14.2 3H9.8l-.3 2.6a7 7 0 0 0-2.1 1.2l-2.3-.9-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-.9c.6.5 1.3.9 2.1 1.2l.3 2.6h4.4l.3-2.6c.8-.3 1.5-.7 2.1-1.2l2.3.9 2-3.4-2-1.5c.1-.4.1-.8.1-1.2Z" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.4" y="4" width="6.6" height="6.6" rx="1.6" />
      <rect x="4" y="13.4" width="6.6" height="6.6" rx="1.6" />
      <rect x="13.4" y="13.4" width="6.6" height="6.6" rx="1.6" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  code: <path d="m8.5 8-5 4 5 4M15.5 8l5 4-5 4M13.8 4.5l-3.6 15" />,
  /* Tabla y gráfica: las dos lecturas del mismo dato. El conmutador las pone
     una al lado de la otra, así que comparten rejilla y peso de trazo. */
  table: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 9.5h17M9.5 9.5v10M3.5 14.5h17" />
    </>
  ),
  chart: (
    <>
      <path d="M4 4v16h16" />
      <path d="M7.5 16.5h5M7.5 12h9M7.5 7.5h3" />
    </>
  ),
  /* Territorio, ruta y descarga: los tres verbos de la portada. */
  pin: (
    <>
      <path d="M12 21c4.2-4.4 6.3-7.7 6.3-10.3a6.3 6.3 0 1 0-12.6 0C5.7 13.3 7.8 16.6 12 21Z" />
      <circle cx="12" cy="10.5" r="2.4" />
    </>
  ),
  compass: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="m15.2 8.8-1.9 4.5-4.5 1.9 1.9-4.5z" />
    </>
  ),
  download: <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />,
  /* Intranet: menú plegable y el taller del Observatorio. */
  sidebar: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </>
  ),
  upload: <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 19.5h15" />,
  mail: (
    <>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.2" />
      <path d="m4.5 7.5 7.5 6 7.5-6" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.6c0 4.2 2.9 7.6 7 8.9 4.1-1.3 7-4.7 7-8.9V6z" />
      <path d="m9 12 2.2 2.2L15.2 10" />
    </>
  ),
  eye: (
    <>
      <path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  "eye-off": <path d="M4 4l16 16M10.2 6a9.6 9.6 0 0 1 1.8-.2c5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.6 3.3M6.4 7.6A15.6 15.6 0 0 0 2.8 12S6.2 18.2 12 18.2c1.6 0 3-.5 4.2-1.1M10 10a2.8 2.8 0 0 0 4 4" />,
  layers: (
    <>
      <path d="m12 4 8.5 4.5L12 13 3.5 8.5z" />
      <path d="m3.5 12.5 8.5 4.5 8.5-4.5M3.5 16.2 12 20.7l8.5-4.5" />
    </>
  ),
  filter: <path d="M4 5.5h16l-6.2 7.2v5.6l-3.6 1.7v-7.3z" />,
  "spark-chart": <path d="M3.5 17.5 9 11.5l4 3.5 7.5-8.5M15.5 6.5h5v5" />,
  // Seis puntos rellenos: el asa de arrastre de toda la vida. Va con `fill`
  // porque un punto de 1,5 px dibujado a trazo se ve como un anillo.
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </g>
  ),
};

interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  name: IconName;
  size?: number;
  /** Texto accesible. Si se omite, el ícono queda oculto para lectores de pantalla. */
  title?: string;
}

export function Icon({ name, size = 20, title, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      focusable="false"
      {...rest}
    >
      {paths[name]}
    </svg>
  );
}
