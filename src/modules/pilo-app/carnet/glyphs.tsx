/* Mr. Pilo · carnet · los iconos que la barra de la app aún no tiene. Un solo trazo, en la tinta de quien los lleva. */

import type { ReactNode } from "react";

const Svg = ({ children }: { children: ReactNode }) => (
  <svg className="pa-i" viewBox="0 0 20 20" aria-hidden="true">
    {children}
  </svg>
);

export const Glyph = {
  lock: (
    <Svg>
      <rect x="4.5" y="9" width="11" height="7.5" rx="2" />
      <path d="M7 9V6.5a3 3 0 016 0V9M10 12v1.5" />
    </Svg>
  ),
  shield: (
    <Svg>
      <path d="M10 2.5l6 2.2v4.6c0 3.6-2.4 6.2-6 8.2-3.6-2-6-4.6-6-8.2V4.7l6-2.2z" />
      <path d="M7.5 10l1.8 1.8L12.8 8" />
    </Svg>
  ),
  share: (
    <Svg>
      <path d="M10 12.5V3.5M6.5 7L10 3.5 13.5 7M4.5 10.5v4a1.5 1.5 0 001.5 1.5h8a1.5 1.5 0 001.5-1.5v-4" />
    </Svg>
  ),
  wallet: (
    <Svg>
      <path d="M3.5 6.5a2 2 0 012-2h8.5v2.5M3.5 6.5v7a2 2 0 002 2h9a1.5 1.5 0 001.5-1.5V8.5A1.5 1.5 0 0014.5 7h-9a2 2 0 01-2-.5z" />
      <circle cx="13" cy="11" r=".9" />
    </Svg>
  ),
  nfc: (
    <Svg>
      <path d="M6 7.5a4 4 0 010 5M9 5.5a7 7 0 010 9M12 3.5a10 10 0 010 13" />
    </Svg>
  ),
  image: (
    <Svg>
      <rect x="3" y="4" width="14" height="12" rx="2" />
      <circle cx="7.5" cy="8.5" r="1.3" />
      <path d="M3.5 14l4-3.5 3 2.5 2.5-2 3.5 3" />
    </Svg>
  ),
  screen: (
    <Svg>
      <path d="M3.5 7V4.5a1 1 0 011-1H7M13 3.5h2.5a1 1 0 011 1V7M16.5 13v2.5a1 1 0 01-1 1H13M7 16.5H4.5a1 1 0 01-1-1V13" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
    </Svg>
  ),
  flip: (
    <Svg>
      <path d="M4 8.5a6 6 0 0110.2-3M16 11.5a6 6 0 01-10.2 3M14.5 2.5v3h-3M5.5 17.5v-3h3" />
    </Svg>
  ),
  gauge: (
    <Svg>
      <path d="M3.5 14a6.5 6.5 0 1113 0M10 14l3-4.5" />
    </Svg>
  ),
  info: (
    <Svg>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9v4.5M10 6.6v.1" />
    </Svg>
  ),
  right: (
    <Svg>
      <path d="M7.5 4.5L13 10l-5.5 5.5" />
    </Svg>
  ),
  camera: (
    <Svg>
      <path d="M3.5 7a1.5 1.5 0 011.5-1.5h1.6l1-1.5h4.8l1 1.5H15A1.5 1.5 0 0116.5 7v7a1.5 1.5 0 01-1.5 1.5H5A1.5 1.5 0 013.5 14V7z" />
      <circle cx="10" cy="10.5" r="2.6" />
    </Svg>
  ),
  alert: (
    <Svg>
      <path d="M10 3.5l7 12.5H3L10 3.5zM10 8.5v3.5M10 14.2v.1" />
    </Svg>
  ),
};
