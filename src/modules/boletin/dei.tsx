/* =============================================================================
   Boletín · hojas de Diversidad, Equidad e Inclusión.

   Las mismas lecturas del tablero de la ficha (data/dei.ts), dibujadas para
   papel: vectores en milímetros, cifras a tamaño de lectura y cada color con
   su rótulo. Cinco hojas, cada una un conjunto del boletín que se puede
   quitar o reordenar como cualquier otro:
   · dei:panorama  la cifra del corte, su peso en la matrícula (cien casillas),
                   los cinco grupos por campus y la proporción corte a corte;
   · dei:mosaico   pueblos indígenas y comunidades negras en teselas, un color
                   por pueblo, con lo reservado («< 5») nombrado aparte;
   · dei:estratos  el reparto del 1 al 6 corte a corte y los estratos 1 y 2
                   por campus;
   · dei:ines      los doce factores del INES por grupo de interés;
   · dei:origen    el mapa de origen por municipio, cuando tiene cifras.
   ========================================================================== */

import type { CSSProperties, ReactNode } from "react";
import { ALL_YEARS } from "../datos-abiertos/data/terms";
import type { HeatmapData, Indicator, MapDataset, OpenDataCatalog, Report } from "../datos-abiertos/data/types";
import { ALL_CAMPUSES } from "../datos-abiertos/data/types";
import { BD, IND, INES_KEY, cell, cut, familyOf, itemsOf, squarify, sumOf, toneOf } from "../datos-abiertos/data/dei";
import type { Family } from "../datos-abiertos/data/dei";
import { DEPARTMENTS, MAP_HEIGHT, MAP_WIDTH, CAMPUS_POINTS } from "../datos-abiertos/data/colombia-map";
import { MUNICIPIOS } from "../datos-abiertos/data/colombia-municipios";
import { DataTable } from "./figures";
import type { BulletinSettings } from "./model";

const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const count = (n: number | null) => (n === null ? "—" : integer.format(n));
const pct = (n: number | null) => (n === null ? "—" : `${decimal.format(n)} %`);

type Sheet = (props: {
  title: string;
  description?: string;
  source: string;
  notes?: [string, ReactNode][];
  cut?: string;
  wide?: boolean;
  children: ReactNode;
}) => JSX.Element;

export const DEI_VIEWS: { key: string; title: string }[] = [
  { key: "panorama", title: "Panorama de la diversidad" },
  { key: "mosaico", title: "Mosaico de pueblos y comunidades" },
  { key: "estratos", title: "Estrato socioeconómico, corte a corte" },
  { key: "ines", title: "Índice de Inclusión (INES) por grupo de interés" },
  { key: "origen", title: "De dónde vienen los estudiantes" },
];

/** ¿El informe es el de diversidad? Lo decide su dato, no su nombre. */
export const isDeiReport = (report: Report) => report.indicators.some((i) => i.id === IND.grupo);

/** Referencias de boletín del informe DE, en el orden del tablero. */
export function deiRefs(report: Report): { ref: string; title: string }[] {
  if (!isDeiReport(report)) return [];
  return DEI_VIEWS.map((v) => ({ ref: `dei:${v.key}`, title: v.title }));
}

/** Cortes con cifra institucional del grupo especial, en orden. */
function yearsOf(report: Report): number[] {
  const grupo = report.indicators.find((i) => i.id === IND.grupo);
  return (grupo?.years ?? []).filter((y) => cell(grupo, y, ALL_CAMPUSES) !== null).sort((a, b) => a - b);
}

/** El corte de la hoja: el del boletín si tiene cifras; si no, el último. */
function keyYear(report: Report, settings: BulletinSettings): number | undefined {
  const years = yearsOf(report);
  return settings.cut !== ALL_YEARS && years.includes(settings.cut) ? settings.cut : years[years.length - 1];
}

/* --- Unidades ----------------------------------------------------------------------- */

export function deiUnits(
  report: Report,
  view: string,
  catalog: OpenDataCatalog,
  settings: BulletinSettings,
  DatasetSheet: Sheet,
): { node: ReactNode; title: string }[] {
  const year = keyYear(report, settings);
  if (year === undefined) return [];
  const title = DEI_VIEWS.find((v) => v.key === view)?.title ?? view;
  const ind = new Map(report.indicators.map((i) => [i.id, i]));
  const bd = new Map(report.breakdowns.map((b) => [b.id, b]));
  const grupo = ind.get(IND.grupo)!;
  const sites = catalog.campuses.filter((c) => c.id !== ALL_CAMPUSES);
  const reserveNote: [string, ReactNode] = ["Reserva", "Con menos de 5 registros la cifra se publica como «< 5»: en un grupo pequeño señalaría a personas concretas."];

  if (view === "panorama") {
    return [{ title, node: <Panorama report={report} grupo={grupo} ind={ind} bd={bd} year={year} sites={sites} campus={settings.campus} DatasetSheet={DatasetSheet} title={title} /> }];
  }

  if (view === "mosaico") {
    const families = [
      familyOf(bd.get(BD.indigena), year, "Pueblos indígenas", "var(--bol-line-4)"),
      familyOf(bd.get(BD.negra), year, "Comunidades negras, afrocolombianas, raizales y palenqueras", "var(--bol-line-3)"),
    ].filter((f): f is Family => Boolean(f && f.total > 0));
    if (!families.length) return [];
    return [
      {
        title,
        node: (
          <DatasetSheet
            title={title}
            description="Estudiantes por pueblo o comunidad declarada. Cada tesela es proporcional a su cifra; cada pueblo conserva su color en todos los cortes."
            source={bd.get(BD.indigena)?.source ?? grupo.source}
            notes={[["Corte", `${cut(year)} · total institucional`], reserveNote]}
            wide
          >
            <Mosaic families={families} />
            <div className="bol-dei__reserve">
              {families.map((f) =>
                f.reserved.length || f.zero ? (
                  <p key={f.key}>
                    <b>{f.name}</b>
                    {f.reserved.length > 0 && <> · con menos de 5: {f.reserved.join(" · ")}</>}
                    {f.zero > 0 && <> · {f.zero} sin estudiantes en este corte</>}
                  </p>
                ) : null,
              )}
            </div>
          </DatasetSheet>
        ),
      },
    ];
  }

  if (view === "estratos") {
    const estrato = bd.get(BD.estrato);
    if (!estrato) return [];
    const years = yearsOf(report).filter((y) => sumOf(itemsOf(estrato, y)) > 0);
    if (!years.length) return [];
    const bajo = ind.get(IND.estratoBajo);
    return [
      {
        title,
        node: (
          <DatasetSheet
            title={title}
            description="Reparto de los estudiantes con estrato registrado, del 1 al 6, en el periodo 2 de cada año. El corchete marca la suma de los estratos 1 y 2."
            source={estrato.source}
            notes={[["Corte", `${cut(years[0])} a ${cut(years[years.length - 1])} · total institucional`]]}
          >
            <Strata estrato={estrato} years={years} year={year} />
            {bajo && sites.length > 0 && (
              <DataTable
                caption="Estratos 1 y 2 por campus · % de los estudiantes con estrato registrado"
                head={["Campus", ...years.map(cut)]}
                highlightCol={years.indexOf(year)}
                rows={[
                  ...sites.map((c) => ({ label: c.name, cells: years.map((y) => pct(cell(bajo, y, c.id))) })),
                  { label: "Total institucional", strong: true, cells: years.map((y) => pct(cell(bajo, y, ALL_CAMPUSES))) },
                ]}
              />
            )}
          </DatasetSheet>
        ),
      },
    ];
  }

  if (view === "ines") {
    const ines = report.heatmaps?.find((h) => h.id === INES_KEY);
    if (!ines || ines.values.flat().every((v) => v === null)) return [];
    return [
      {
        title,
        node: (
          <DatasetSheet title={title} description={ines.description} source={ines.source} notes={[["Unidad", "Puntaje 0-100 por factor"]]} wide>
            <InesPlot data={ines} />
          </DatasetSheet>
        ),
      },
    ];
  }

  if (view === "origen") {
    const map = report.maps?.find((m) => m.mode === "municipio");
    if (!map) return [];
    const scope = settings.campus === ALL_CAMPUSES ? "todos los campus" : `solo ${sites.find((s) => s.id === settings.campus)?.name ?? settings.campus}`;
    const node = <OriginSheet map={map} year={year} campus={settings.campus} scope={scope} sites={sites.map((s) => s.id)} DatasetSheet={DatasetSheet} title={map.title || title} />;
    return node ? [{ title: map.title || title, node }] : [];
  }
  return [];
}

/* --- Panorama ----------------------------------------------------------------------- */

const GROUPS: { key: string; label: string }[] = [
  { key: IND.etnico, label: "Pertenencia étnica" },
  { key: IND.victima, label: "Afectados por el conflicto armado" },
  { key: IND.rural, label: "Zona rural" },
  { key: IND.discapacidad, label: "Con discapacidad declarada" },
  { key: IND.estratoBajo, label: "Estratos 1 y 2 (%)" },
];

function Panorama({
  report,
  grupo,
  ind,
  bd,
  year,
  sites,
  campus,
  DatasetSheet,
  title,
}: {
  report: Report;
  grupo: Indicator;
  ind: Map<string, Indicator>;
  bd: Map<string, NonNullable<Report["breakdowns"][number]>>;
  year: number;
  sites: { id: string; name: string }[];
  campus: string;
  DatasetSheet: Sheet;
  title: string;
}) {
  const years = yearsOf(report);
  const base = (y: number) => sumOf(itemsOf(bd.get(BD.genero), y)) || null;
  const total = cell(grupo, year, ALL_CAMPUSES);
  const focus = cell(grupo, year, campus);
  const b = base(year);
  const share = total !== null && b ? (total / b) * 100 : null;
  const previous = years[years.indexOf(year) - 1];
  const fmt = (i: Indicator, v: number | null) => (i.format === "porcentaje" ? pct(v) : count(v));

  return (
    <DatasetSheet
      title={title}
      description="Estudiantes de grupos de protección constitucional en el periodo 2 de cada año: pertenencia étnica, discapacidad, conflicto armado, zona rural y estratos bajos."
      source={grupo.source}
      notes={[
        ["Corte", `${cut(year)}${campus !== ALL_CAMPUSES ? ` · ${sites.find((s) => s.id === campus)?.name ?? campus}` : " · todos los campus"}`],
        ["Base de la proporción", "Estudiantes con género registrado en el corte (registro académico)."],
      ]}
    >
      <div className="bol-dei__lead">
        <div>
          <strong className="bol-dei__figure">{count(focus)}</strong>
          <p>estudiantes de grupos de protección constitucional</p>
          {share !== null && campus === ALL_CAMPUSES && (
            <p className="bol-dei__share">
              <b>{decimal.format(share)} %</b> de los {count(b)} estudiantes del corte
            </p>
          )}
        </div>
        {share !== null && campus === ALL_CAMPUSES && <Waffle share={share} />}
      </div>

      <DataTable
        caption={`Grupos por campus · ${cut(year)}${previous ? ` · variación frente a ${cut(previous)}` : ""}`}
        head={["Grupo", ...sites.map((s) => s.name), "Total", ...(previous ? ["Variación"] : [])]}
        highlightCol={sites.length}
        rows={GROUPS.filter((g) => ind.has(g.key)).map((g) => {
          const i = ind.get(g.key)!;
          const now = cell(i, year, ALL_CAMPUSES);
          const before = previous ? cell(i, previous, ALL_CAMPUSES) : null;
          const diff = now !== null && before !== null ? now - before : null;
          return {
            label: g.label,
            cells: [
              ...sites.map((s) => fmt(i, cell(i, year, s.id))),
              fmt(i, now),
              ...(previous
                ? [diff === null ? "—" : `${diff > 0 ? "+" : diff < 0 ? "−" : ""}${i.format === "porcentaje" ? `${decimal.format(Math.abs(diff))} p. p.` : integer.format(Math.abs(diff))}`]
                : []),
            ],
          };
        })}
      />

      <figure>
        <figcaption>Proporción sobre la matrícula del corte · periodo 2 de cada año</figcaption>
        <ShareColumns points={years.map((y) => ({ label: cut(y), n: cell(grupo, y, ALL_CAMPUSES), base: base(y), on: y === year }))} />
      </figure>
    </DatasetSheet>
  );
}

function Waffle({ share }: { share: number }) {
  const lit = Math.max(0, Math.min(100, Math.round(share)));
  const s = 3.1;
  return (
    <svg className="bol-dei__waffle" viewBox={`0 0 ${s * 10} ${s * 10}`} role="img" aria-label={`${lit} de cada 100`}>
      {Array.from({ length: 100 }, (_, k) => (
        <rect key={k} x={(k % 10) * s + 0.25} y={Math.floor(k / 10) * s + 0.25} width={s - 0.5} height={s - 0.5} rx={0.4} data-on={k < lit || undefined} />
      ))}
    </svg>
  );
}

function ShareColumns({ points }: { points: { label: string; n: number | null; base: number | null; on: boolean }[] }) {
  const w = 130;
  const h = 34;
  const top = 5;
  const bottom = 7;
  const shares = points.map((p) => (p.n !== null && p.base ? (p.n / p.base) * 100 : null));
  const max = Math.max(5, ...shares.map((v) => v ?? 0));
  const ceil = Math.ceil(max / 5) * 5;
  const col = w / points.length;
  return (
    <svg className="bol-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={points.map((p, i) => `${p.label}: ${pct(shares[i])}`).join(", ")}>
      {points.map((p, i) => {
        const v = shares[i];
        const bh = v === null ? 0 : ((h - top - bottom) * v) / ceil;
        const x = i * col + col * 0.18;
        const bw = col * 0.64;
        return (
          <g key={p.label} data-strong={p.on || undefined}>
            <rect className="bol-chart__track" x={x} y={top} width={bw} height={h - top - bottom} />
            <rect className={p.on ? "bol-dei__col-on" : "bol-chart__bar"} x={x} y={h - bottom - bh} width={bw} height={bh} />
            <text className="bol-chart__value" x={x + bw / 2} y={h - bottom - bh - 1} textAnchor="middle">
              {pct(v)}
            </text>
            <text className="bol-chart__label" x={x + bw / 2} y={h - 2.4} textAnchor="middle">
              {p.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* --- Mosaico ------------------------------------------------------------------------ */

function Mosaic({ families }: { families: Family[] }) {
  const W = 178;
  const H = 94;
  const gap = 3;
  const head = 6;
  const sum = families.reduce((s, f) => s + f.total, 0);
  const shares = families.map((f) => Math.max(f.total / sum, families.length > 1 ? 0.3 : 1));
  const norm = shares.reduce((s, v) => s + v, 0);
  let x = 0;
  return (
    <svg className="bol-dei__mosaic" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={families.map((f) => `${f.name}: ${f.items.map((i) => `${i.label} ${count(i.value)}`).join(", ")}`).join("; ")}>
      {families.map((f, k) => {
        const w = (W - gap * (families.length - 1)) * (shares[k] / norm);
        const region = { x, y: head, w, h: H - head };
        x += w + gap;
        const tiles = squarify(f.items.map((i) => i.value as number), region);
        return (
          <g key={f.key}>
            <text className="bol-dei__family" x={region.x} y={3.8}>
              {f.name.length > w / 1.6 ? `${f.name.slice(0, Math.floor(w / 1.6) - 1)}…` : f.name} · {count(f.total)}
            </text>
            {tiles.map((t, i) => {
              const item = f.items[i];
              const roomy = t.w > 18 && t.h > 9;
              const small = t.w > 6 && t.h > 4.5;
              return (
                <g key={item.label}>
                  <rect x={t.x + 0.3} y={t.y + 0.3} width={Math.max(0, t.w - 0.6)} height={Math.max(0, t.h - 0.6)} rx={0.6} style={{ fill: toneOf(item.label) } as CSSProperties} />
                  {roomy && (
                    <text className="bol-dei__tile-label" x={t.x + 1.6} y={t.y + 3.6}>
                      {item.label.length > t.w / 1.5 ? `${item.label.slice(0, Math.floor(t.w / 1.5) - 1)}…` : item.label}
                    </text>
                  )}
                  {small && (
                    <text className="bol-dei__tile-value" x={t.x + 1.6} y={t.y + t.h - 1.6}>
                      {count(item.value)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

/* --- Estratos ----------------------------------------------------------------------- */

const LEVELS = ["Estrato 1", "Estrato 2", "Estrato 3", "Estrato 4", "Estrato 5", "Estrato 6"];

function Strata({ estrato, years, year }: { estrato: NonNullable<Report["breakdowns"][number]>; years: number[]; year: number }) {
  const w = 130;
  const row = 7.2;
  const label = 12;
  const right = 20;
  const barW = w - label - right;
  const h = years.length * row + 8;
  return (
    <figure>
      <figcaption>Del estrato 1 (oscuro) al 6 (claro)</figcaption>
      <svg className="bol-chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Estratos por corte, ${years.map(cut).join(", ")}`}>
        {years.map((y, r) => {
          const items = itemsOf(estrato, y);
          const total = sumOf(items);
          const parts = LEVELS.map((l) => items.find((i) => i.label === l)?.value ?? 0);
          const low = total ? ((parts[0] + parts[1]) / total) * 100 : 0;
          const top = r * row + 3;
          let x = label;
          return (
            <g key={y} data-strong={y === year || undefined}>
              <text className="bol-chart__label" x={label - 1.5} y={top + row / 2} dy="0.9" textAnchor="end">
                {cut(y)}
              </text>
              <rect className="bol-dei__bracket" x={label} y={top} width={(barW * low) / 100} height={0.8} data-on={y === year || undefined} />
              {parts.map((p, k) => {
                const pw = total ? (barW * p) / total : 0;
                const share = total ? (p / total) * 100 : 0;
                const node = (
                  <g key={k}>
                    <rect x={x} y={top + 1.4} width={pw} height={row - 2.6} style={{ fill: `var(--bol-seq-${k + 1})` } as CSSProperties} />
                    {share >= 8 && (
                      <text className="bol-dei__seg" x={x + pw / 2} y={top + row / 2 + 0.2} dy="0.9" textAnchor="middle" data-deep={k < 3 || undefined}>
                        {integer.format(Math.round(share))} %
                      </text>
                    )}
                  </g>
                );
                x += pw;
                return node;
              })}
              <text className="bol-chart__value" x={w} y={top + row / 2} dy="0.9" textAnchor="end">
                {decimal.format(low)} % en 1 y 2
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}

/* --- INES --------------------------------------------------------------------------- */

const MARKS = ["circle", "square", "diamond"] as const;

function Mark({ shape, x, y, r = 1.3 }: { shape: (typeof MARKS)[number]; x: number; y: number; r?: number }) {
  if (shape === "circle") return <circle cx={x} cy={y} r={r} />;
  if (shape === "square") return <rect x={x - r * 0.9} y={y - r * 0.9} width={r * 1.8} height={r * 1.8} />;
  return <path d={`M${x} ${y - r * 1.2} L${x + r * 1.2} ${y} L${x} ${y + r * 1.2} L${x - r * 1.2} ${y}Z`} />;
}

function InesPlot({ data }: { data: HeatmapData }) {
  const W = 178;
  const row = 7;
  const labelW = 58;
  const valuesW = 36;
  const top = 8;
  const plotW = W - labelW - valuesW - 6;
  const all = data.values.flat().filter((v): v is number => v !== null);
  const lo = Math.max(0, Math.floor((Math.min(...all) - 1) / 5) * 5);
  const x = (v: number) => labelW + 3 + ((v - lo) / (100 - lo)) * plotW;
  const H = top + data.rows.length * row + 4;
  const ticks = Array.from({ length: Math.floor((100 - lo) / 5) + 1 }, (_, k) => lo + k * 5);
  return (
    <>
      <p className="bol-dei__legend">
        {data.columns.map((c, k) => (
          <span key={c} style={{ "--tone": `var(--bol-s${k + 1})` } as CSSProperties}>
            <svg viewBox="-2 -2 4 4" aria-hidden="true">
              <Mark shape={MARKS[k % 3]} x={0} y={0} r={1.4} />
            </svg>
            {c}
          </span>
        ))}
        <em>La escala empieza en {lo}.</em>
      </p>
      <svg className="bol-chart bol-dei__ines" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`INES por factor y grupo de interés`}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="bol-dei__tick" x1={x(t)} x2={x(t)} y1={top - 2} y2={H - 2} />
            <text className="bol-chart__label" x={x(t)} y={top - 3} textAnchor="middle">
              {t}
            </text>
          </g>
        ))}
        <text className="bol-chart__label" x={W} y={top - 3} textAnchor="end">
          {data.columns.map((c) => c.slice(0, 4)).join(" · ")}
        </text>
        {data.rows.map((label, r) => {
          const y = top + r * row + row / 2;
          const values = data.columns.map((_, c) => data.values[r]?.[c] ?? null);
          const known = values.filter((v): v is number => v !== null);
          return (
            <g key={label}>
              <text className="bol-chart__label" x={labelW} y={y} dy="0.9" textAnchor="end">
                {label}
              </text>
              {known.length > 1 && <line className="bol-dei__range" x1={x(Math.min(...known))} x2={x(Math.max(...known))} y1={y} y2={y} />}
              {values.map((v, c) =>
                v === null ? null : (
                  <g key={c} style={{ fill: `var(--bol-s${c + 1})` } as CSSProperties} className="bol-dei__mark">
                    <Mark shape={MARKS[c % 3]} x={x(v)} y={y} />
                  </g>
                ),
              )}
              <text className="bol-chart__value" x={W} y={y} dy="0.9" textAnchor="end">
                {values.map((v) => (v === null ? "—" : decimal.format(v))).join("  ")}
              </text>
            </g>
          );
        })}
      </svg>
    </>
  );
}

/* --- Origen ------------------------------------------------------------------------- */

const MUNI = new Map(MUNICIPIOS.map(([code, name, x, y]) => [code, { name, x, y }]));
const DEPT_NAME = Object.fromEntries(DEPARTMENTS.map((d) => [d.code, d.name]));

function OriginSheet({
  map,
  year,
  campus,
  scope,
  sites,
  DatasetSheet,
  title,
}: {
  map: MapDataset;
  year: number;
  campus: string;
  /** "todos los campus" o "solo Bucaramanga": el PDF dice de quién son las cifras. */
  scope: string;
  sites: string[];
  DatasetSheet: Sheet;
  title: string;
}) {
  const available = Object.keys(map.values).map(Number).filter((y) => y !== ALL_YEARS).sort();
  const shown = available.includes(year) ? year : available[available.length - 1];
  if (shown === undefined) return null;
  const active = campus === ALL_CAMPUSES ? sites : [campus];
  const byYear = map.values[shown] ?? {};
  const depts: Record<string, number> = {};
  const munis: Record<string, number> = {};
  for (const s of active) {
    for (const [code, v] of Object.entries(byYear[s] ?? {})) {
      if (code.length === 2) depts[code] = (depts[code] ?? 0) + v;
      else if (code.length === 5) munis[code] = (munis[code] ?? 0) + v;
    }
  }
  if (!Object.keys(depts).length) for (const [code, v] of Object.entries(munis)) depts[code.slice(0, 2)] = (depts[code.slice(0, 2)] ?? 0) + v;
  // Un municipio con alguna sede reservada («< 5») suma solo lo publicado: se dice «o más».
  const partial = new Set(active.flatMap((s) => (map.reserved?.[shown]?.[s] ?? []).filter((code) => munis[code] !== undefined)));
  const ranking = Object.entries(munis).sort((a, b) => b[1] - a[1]);
  if (!ranking.length) return null;
  const maxDept = Math.max(1, ...Object.values(depts));
  const maxMuni = ranking[0][1];
  const bin = (v: number | undefined) => (v ? Math.max(1, Math.min(7, Math.ceil((Math.log10(v + 1) / Math.log10(maxDept + 1)) * 7))) : 0);
  const grand = Object.values(depts).reduce((a, b) => a + b, 0);

  return (
    <DatasetSheet
      title={title}
      description={map.description || "Calor por departamento de origen y un punto por municipio, del tamaño de su cifra."}
      source={map.source}
      notes={[
        ["Corte", `${shown} · ${scope}`],
        ["Reserva", "Un municipio con menos de 5 personas en un campus no se dibuja con su cifra."],
      ]}
      wide
    >
      <div className="bol-dei__origin">
        <svg className="bol-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Mapa de origen por departamento y municipio">
          {DEPARTMENTS.map((d) => (
            <path key={d.code} d={d.d} className="bol-map__area" data-bin={bin(depts[d.code])} />
          ))}
          {ranking
            .slice()
            .reverse()
            .map(([code, v]) => {
              const m = MUNI.get(code);
              return m ? <circle key={code} className="bol-dei__dot" cx={m.x} cy={m.y} r={2.5 + Math.sqrt(v / maxMuni) * 14} /> : null;
            })}
          {sites
            .filter((s) => CAMPUS_POINTS[s])
            .map((s) => (
              <path key={s} className="bol-dei__site" d={`M${CAMPUS_POINTS[s][0]} ${CAMPUS_POINTS[s][1] - 8} l8 8 l-8 8 l-8 -8z`} />
            ))}
        </svg>
        <div>
          <p className="bol-dei__origin-total">
            <b>{count(grand)}</b> con municipio de origen registrado · {scope}
          </p>
          <DataTable
            caption="Municipios que más aportan"
            head={["Municipio", "Departamento", "Personas"]}
            rows={ranking.slice(0, 18).map(([code, v]) => ({ label: MUNI.get(code)?.name ?? code, cells: [DEPT_NAME[code.slice(0, 2)] ?? "", partial.has(code) ? `${count(v)} o más` : count(v)] }))}
          />
        </div>
      </div>
    </DatasetSheet>
  );
}
