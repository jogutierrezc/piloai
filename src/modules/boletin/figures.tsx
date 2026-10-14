/* =============================================================================
   Boletín · figuras para papel.

   Las gráficas del portal animan, se miden contra la pantalla y esperan a
   entrar en vista; en una hoja A4 nada de eso existe. Estas son estáticas y
   se dibujan en milímetros: el viewBox de cada SVG está en mm y el texto
   también, así una etiqueta de 2,5 mm mide 2,5 mm impresa (unos 7 pt).

   Colores por variable CSS del boletín (--bol-*), que salen del tema de la
   plantilla. Ningún dato va solo en color: las series llevan leyenda, las
   barras su cifra y las tablas su número.
   ========================================================================== */

import type { CSSProperties, ReactNode } from "react";
import { formatCount, formatValue } from "../datos-abiertos/data/open-data";
import { SCOPE_LABEL, rankScale, rankSpan, scopeDash, scopeMarkPath, stackLabels } from "../datos-abiertos/data/rankings";
import type { ParsedRank, RankScope } from "../datos-abiertos/data/rankings";
import type { ValueFormat } from "../datos-abiertos/data/types";
import { DEPARTMENTS } from "../datos-abiertos/data/colombia-map";
import { COUNTRIES, WORLD_CAMPUS_POINTS, WORLD_HEIGHT, WORLD_WIDTH } from "../datos-abiertos/data/world-map";
import { CAMPUS_POINTS, MAP_HEIGHT, MAP_WIDTH } from "../datos-abiertos/data/colombia-map";

export const SERIES_COLORS = ["var(--bol-s1)", "var(--bol-s2)", "var(--bol-s3)", "var(--bol-s4)", "var(--bol-s5)"];

/** Periodo 1 y periodo 2 apilados en su año: el mismo tono, claro y oscuro. */
export const TERM_COLORS = ["var(--bol-term-1)", "var(--bol-term-2)"];

const compact = new Intl.NumberFormat("es-CO", { notation: "compact", maximumFractionDigits: 1 });

/** Cifra corta para ejes: "1,2 mil", "35 %". */
function tick(value: number, format: ValueFormat): string {
  if (format === "porcentaje") return `${formatValue(value, Number.isInteger(value) ? "entero" : "decimal")}`;
  return Math.abs(value) >= 10000 ? compact.format(value) : formatValue(value, Number.isInteger(value) ? "entero" : "decimal");
}

/**
 * Escala "bonita" con unas 4 divisiones. Arranca en 0, salvo en las tasas que
 * viven lejos de cero (una retención entre 78 y 87 %): ahí empezar en 0 aplasta
 * la variación que la gráfica existe para mostrar. Es una línea, no una barra,
 * así que el eje recortado no exagera ninguna longitud.
 */
function niceScale(min: number, max: number, format: ValueFormat): number[] {
  if (max <= 0) return [0, 1];
  const zoom = format === "porcentaje" && min > 0 && min / max > 0.5;
  const low = zoom ? min : 0;
  const raw = (max - low) / 4 || max / 4;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? raw;
  const start = zoom ? Math.max(0, Math.floor(low / step) * step - step) : 0;
  return Array.from({ length: Math.ceil((max - start) / step) + 1 }, (_, i) => Math.round((start + i * step) * 1000) / 1000);
}

export const figure = (value: number | null, format: ValueFormat) => (value === null ? "—" : formatValue(value, format));

/** Franja de resaltado recortada al área del gráfico. */
function Band({ from, to, left, right, top, height }: { from: number; to: number; left: number; right: number; top: number; height: number }) {
  const x0 = Math.max(left, from);
  const x1 = Math.min(right, to);
  return x1 > x0 ? <rect className="bol-chart__highlight" x={x0} y={top} width={x1 - x0} height={height} /> : null;
}

/* --- Evolución por año ------------------------------------------------------ */

export interface Series {
  label: string;
  color: string;
  values: (number | null)[];
  dashed?: boolean;
}

/**
 * Líneas por categoría del eje x: años, periodos o etapas de una tubería.
 *
 * Con `periodAxis`, el eje son periodos "2024-1", "2024-2": bajo cada punto va
 * el número del periodo y bajo cada par, su año. Así caben doce periodos en el
 * ancho de una columna sin acortar ningún rótulo.
 */
export function EvolutionChart({
  years,
  series,
  format,
  highlight,
  periodAxis = false,
  width = 70,
  height = 46,
  label = "Evolución por año",
}: {
  years: (number | string)[];
  series: Series[];
  format: ValueFormat;
  /** Con `periodAxis`, un año resalta sus dos periodos. */
  highlight?: number | string;
  periodAxis?: boolean;
  width?: number;
  height?: number;
  label?: string;
}) {
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  const ticks = niceScale(Math.min(...all, Infinity), Math.max(0, ...all), format);
  const bottom = ticks[0];
  const top = ticks[ticks.length - 1] || 1;
  const m = { left: 10, right: 3, top: 3, bottom: periodAxis ? 8.6 : 6 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const x = (i: number) => m.left + (years.length === 1 ? innerW / 2 : (i / (years.length - 1)) * innerW);
  const y = (v: number) => m.top + innerH - ((v - bottom) / (top - bottom || 1)) * innerH;
  const slot = years.length > 1 ? innerW / (years.length - 1) : innerW;
  const hi = highlight === undefined || periodAxis ? -1 : years.indexOf(highlight);
  // Periodos: pares de puntos por año, con el año centrado bajo el par.
  const yearOf = (label: number | string) => String(label).split("-")[0];
  const termOf = (label: number | string) => String(label).split("-")[1] ?? "";
  const pairs = periodAxis
    ? Array.from(new Set(years.map(yearOf))).map((yr) => {
        const idx = years.map((l, i) => (yearOf(l) === yr ? i : -1)).filter((i) => i >= 0);
        return { year: yr, first: idx[0], last: idx[idx.length - 1] };
      })
    : [];
  // Rótulos largos (etapas): se acortan y, si no caben, se alternan.
  const maxChars = Math.max(4, Math.floor(slot / 1.35));
  const short = (text: string) => (text.length > maxChars ? `${text.slice(0, maxChars - 1)}…` : text);

  return (
    <svg className="bol-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {hi >= 0 && <Band from={x(hi) - Math.min(5, slot / 2)} to={x(hi) + Math.min(5, slot / 2)} left={m.left} right={width - m.right} top={m.top} height={innerH} />}
      {pairs
        .filter((pair) => highlight !== undefined && pair.year === String(highlight))
        .map((pair) => (
          <Band
            key={`hi-${pair.year}`}
            from={x(pair.first) - Math.min(3, slot / 2)}
            to={x(pair.last) + Math.min(3, slot / 2)}
            left={m.left}
            right={width - m.right}
            top={m.top}
            height={innerH}
          />
        ))}
      {ticks.map((t) => (
        <g key={t}>
          <line className="bol-chart__grid" x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
          <text className="bol-chart__tick" x={m.left - 1.5} y={y(t)} dy="0.9" textAnchor="end">
            {tick(t, format)}
          </text>
        </g>
      ))}
      {periodAxis
        ? [
            ...years.map((period, i) => (
              <text key={`t-${period}-${i}`} className="bol-chart__term" x={x(i)} y={height - 4.6} textAnchor="middle">
                {termOf(period)}
              </text>
            )),
            ...pairs.map((pair) => (
              <text
                key={`y-${pair.year}`}
                className="bol-chart__year"
                data-highlight={highlight !== undefined && pair.year === String(highlight) ? true : undefined}
                x={(x(pair.first) + x(pair.last)) / 2}
                y={height - 0.9}
                textAnchor="middle"
              >
                {pair.year}
              </text>
            )),
          ]
        : years.map((year, i) => (
            <text key={`${year}-${i}`} className="bol-chart__year" data-highlight={i === hi || undefined} x={x(i)} y={height - 1.6} textAnchor={i === 0 && typeof year === "string" ? "start" : i === years.length - 1 && typeof year === "string" ? "end" : "middle"}>
              {short(String(year))}
            </text>
          ))}
      {series.map((s) => {
        // Un año sin reportar corta la línea: no se inventa el tramo.
        const segments: string[] = [];
        let current = "";
        s.values.forEach((v, i) => {
          if (v === null) {
            if (current) segments.push(current);
            current = "";
          } else current += `${current ? "L" : "M"}${x(i).toFixed(2)} ${y(v).toFixed(2)}`;
        });
        if (current) segments.push(current);
        return (
          <g key={s.label} style={{ "--c": s.color } as CSSProperties}>
            {segments.map((d) => (
              <path key={d} className="bol-chart__line" data-dashed={s.dashed || undefined} d={d} />
            ))}
            {s.values.map((v, i) => (v === null ? null : <circle key={i} className="bol-chart__dot" cx={x(i)} cy={y(v)} r={0.75} />))}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * Tendencia de la ficha ejecutiva: la serie del total, con su primer y último
 * año y su último punto marcado. Acompaña a la cifra; no la reemplaza.
 */
export function Trend({
  years,
  values,
  format,
  height = 17,
}: {
  /** Años o periodos ("2024-1"). */
  years: (number | string)[];
  values: (number | null)[];
  format: ValueFormat;
  height?: number;
}) {
  const points = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
  if (points.length < 2) return <p className="bol-trend__empty">Sin serie para comparar</p>;
  const width = 40;
  const m = { top: 2, bottom: 5, side: 1.5 };
  const min = Math.min(...points.map((p) => p.v));
  const max = Math.max(...points.map((p) => p.v));
  const span = max - min || Math.abs(max) || 1;
  const x = (i: number) => m.side + (i / Math.max(1, years.length - 1)) * (width - m.side * 2);
  const y = (v: number) => m.top + (1 - (v - min) / span) * (height - m.top - m.bottom);
  const d = points.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(2)} ${y(p.v).toFixed(2)}`).join("");
  const last = points[points.length - 1];
  const first = points[0];
  return (
    <svg className="bol-chart bol-trend" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`De ${figure(first.v, format)} en ${years[first.i]} a ${figure(last.v, format)} en ${years[last.i]}`}>
      <path className="bol-trend__line" d={d} />
      <circle className="bol-trend__dot" cx={x(last.i)} cy={y(last.v)} r={0.9} />
      <text className="bol-chart__year" x={x(first.i)} y={height - 0.6} textAnchor="start">{years[first.i]}</text>
      <text className="bol-chart__year" x={x(last.i)} y={height - 0.6} textAnchor="end">{years[last.i]}</text>
    </svg>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <ul className="bol-legend">
      {series.map((s) => (
        <li key={s.label}>
          <svg viewBox="0 0 8 3" aria-hidden="true">
            <line x1="0" x2="8" y1="1.5" y2="1.5" style={{ stroke: s.color }} strokeDasharray={s.dashed ? "1.6 1" : undefined} />
          </svg>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/* --- Barras horizontales ---------------------------------------------------- */

export function HBars({
  items,
  format,
  share = false,
  width = 56,
  reservedThreshold = 5,
}: {
  /** reserved: la celda existe pero tiene tan pocos registros que se publica «< n». */
  items: { label: string; value: number | null; strong?: boolean; reserved?: boolean }[];
  format: ValueFormat;
  share?: boolean;
  width?: number;
  reservedThreshold?: number;
}) {
  // Con muchas categorías las barras van más juntas: la hoja cabe sin achicarse.
  const row = items.length > 10 ? 4.8 : 6.2;
  // El ancho de los nombres sale del más largo (≈1,25 por carácter a 2,4 de
  // cuerpo), entre un mínimo legible y el 42 % del ancho: así un nombre largo
  // no se sale del lienzo ni pisa la columna de notas.
  const longest = Math.max(4, ...items.map((i) => i.label.length));
  const labelW = Math.max(Math.min(18, width * 0.3), Math.min(width * 0.42, longest * 1.25 + 2));
  const maxChars = Math.floor((labelW - 2) / 1.25);
  const valueW = share ? 17 : 11;
  const barW = width - labelW - valueW - 2;
  const max = Math.max(0, ...items.map((i) => i.value ?? 0)) || 1;
  const total = items.reduce((s, i) => s + (i.value ?? 0), 0);
  const height = items.length * row + 1;
  return (
    <svg
      className="bol-chart"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={items.map((i) => `${i.label}: ${i.reserved ? `menos de ${reservedThreshold}` : figure(i.value, format)}`).join(", ")}
    >
      {items.map((item, index) => {
        const top = index * row + 0.5;
        const w = item.value === null ? 0 : Math.max(0.4, (item.value / max) * barW);
        return (
          <g key={item.label} data-strong={item.strong || undefined}>
            <text className="bol-chart__label" x={labelW - 1.5} y={top + row / 2} dy="0.9" textAnchor="end">
              {item.label.length > maxChars ? `${item.label.slice(0, maxChars - 1)}…` : item.label}
            </text>
            <rect className="bol-chart__track" x={labelW} y={top + 1.2} width={barW} height={row - 2.4} />
            {item.reserved ? (
              <rect className="bol-chart__reserved" x={labelW} y={top + 1.2} width={3.2} height={row - 2.4} />
            ) : item.value === null ? (
              <text className="bol-chart__empty" x={labelW + 1} y={top + row / 2} dy="0.9">sin reportar</text>
            ) : (
              <rect className="bol-chart__bar" x={labelW} y={top + 1.2} width={w} height={row - 2.4} />
            )}
            <text className="bol-chart__value" x={width} y={top + row / 2} dy="0.9" textAnchor="end">
              {item.reserved ? `< ${reservedThreshold}` : item.value === null ? "—" : figure(item.value, format)}
              {share && item.value !== null && total > 0 ? ` · ${formatValue((item.value / total) * 100, "decimal")} %` : ""}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* --- Columnas apiladas ------------------------------------------------------- */

export function StackedColumns({
  periods,
  categories,
  values,
  format,
  totals: shownTotals,
  colors = SERIES_COLORS,
  highlight,
  periodAxis = false,
  width = 128,
  height = 44,
}: {
  periods: string[];
  categories: string[];
  /** values[categoría][periodo] */
  values: Record<string, Record<string, number | null>>;
  format: ValueFormat;
  /**
   * Cifra que se rotula sobre cada columna. Sin ella, la suma de lo apilado.
   * Con ella (la cifra del año según su regla), un año al que le falta un
   * periodo dibuja lo reportado pero no rotula un total que no existe.
   */
  totals?: (number | null)[];
  colors?: string[];
  /** Columna resaltada (su rótulo). */
  highlight?: string;
  /** Periodos "2024-1": bajo cada columna el número del periodo y bajo cada par, el año. */
  periodAxis?: boolean;
  width?: number;
  height?: number;
}) {
  const totals = periods.map((p) => categories.reduce((sum, c) => sum + (values[c]?.[p] ?? 0), 0));
  const reported = periods.map((p) => categories.some((c) => values[c]?.[p] !== null && values[c]?.[p] !== undefined));
  const labels = shownTotals ?? totals.map((t, i) => (reported[i] ? t : null));
  const ticks = niceScale(0, Math.max(0, ...totals), "entero");
  const top = ticks[ticks.length - 1] || 1;
  const m = { left: 10, right: 2, top: 4, bottom: periodAxis ? 8.6 : 6 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const slot = innerW / Math.max(1, periods.length);
  const barW = Math.min(14, slot * 0.62);
  const y = (v: number) => m.top + innerH - (v / top) * innerH;
  // Rótulo de cifra solo si cabe sobre la columna.
  const valueFits = slot >= 9;
  const cx = (i: number) => m.left + slot * i + slot / 2;
  const pairs = periodAxis
    ? Array.from(new Set(periods.map((p) => p.split("-")[0]))).map((yr) => {
        const idx = periods.map((p, i) => (p.split("-")[0] === yr ? i : -1)).filter((i) => i >= 0);
        return { year: yr, first: idx[0], last: idx[idx.length - 1] };
      })
    : [];
  return (
    <svg className="bol-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={periods.map((p, i) => `${p}: ${figure(totals[i], format)}`).join(", ")}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="bol-chart__grid" x1={m.left} x2={width - m.right} y1={y(t)} y2={y(t)} />
          <text className="bol-chart__tick" x={m.left - 1.5} y={y(t)} dy="0.9" textAnchor="end">{tick(t, format)}</text>
        </g>
      ))}
      {periods.map((period, i) => {
        const x0 = cx(i);
        let acc = 0;
        return (
          <g key={period}>
            {period === highlight && <rect className="bol-chart__highlight" x={x0 - slot / 2 + 0.4} y={m.top} width={slot - 0.8} height={innerH} />}
            {categories.map((c, ci) => {
              const v = values[c]?.[period];
              if (v === null || v === undefined || v <= 0) return null;
              const y0 = y(acc + v);
              const h = y(acc) - y0;
              acc += v;
              return <rect key={c} x={x0 - barW / 2} y={y0} width={barW} height={Math.max(0.2, h)} style={{ fill: colors[ci % colors.length] }} />;
            })}
            {valueFits && labels[i] !== null && (
              <text className="bol-chart__value" x={x0} y={y(totals[i]) - 1} textAnchor="middle">{figure(labels[i], format)}</text>
            )}
            {periodAxis ? (
              <text className="bol-chart__term" x={x0} y={height - 4.6} textAnchor="middle">{period.split("-")[1] ?? ""}</text>
            ) : (
              <text className="bol-chart__year" data-highlight={period === highlight || undefined} x={x0} y={height - 1.6} textAnchor="middle">{period}</text>
            )}
          </g>
        );
      })}
      {pairs.map((pair) => (
        <text key={`y-${pair.year}`} className="bol-chart__year" x={(cx(pair.first) + cx(pair.last)) / 2} y={height - 0.9} textAnchor="middle">
          {pair.year}
        </text>
      ))}
    </svg>
  );
}

export function SwatchLegend({ labels, colors = SERIES_COLORS }: { labels: string[]; colors?: string[] }) {
  return (
    <ul className="bol-legend">
      {labels.map((label, i) => (
        <li key={label}>
          <i className="bol-legend__swatch" style={{ background: colors[i % colors.length] }} />
          {label}
        </li>
      ))}
    </ul>
  );
}

/* --- Tablas ----------------------------------------------------------------- */

/* --- Evolución de un ranking ------------------------------------------------
   El puesto 1 arriba y escala logarítmica, como en la ficha. Una banda
   ("801–1000") no es un punto: ocupa su tramo en vertical, y su texto se
   imprime tal como lo publica el ranking.
   -------------------------------------------------------------------------- */

export interface RankLine {
  /** Nombre corto del ranking, el que se rotula. */
  label: string;
  color: string;
  points: { year: number; rank: ParsedRank }[];
  /**
   * Ámbito de la posición. Cuando las líneas de una gráfica traen ámbitos
   * distintos, cada uno lleva su trazo y su forma de punto (SCOPE_MARK) y la
   * gráfica, su leyenda de ámbitos.
   */
  scope?: RankScope;
}

/** Trazo y punto de cada ámbito, en tinta: el color es del ranking. */
export function ScopeLegend({ scopes }: { scopes: RankScope[] }) {
  return (
    <ul className="bol-legend bol-legend--scopes">
      {scopes.map((scope) => (
        <li key={scope}>
          <svg viewBox="0 0 12 4" aria-hidden="true">
            <line x1="0.6" x2="11.4" y1="2" y2="2" strokeDasharray={scopeDash(scope, 0.6)} />
            <path d={scopeMarkPath(scope, 6, 2, 0.95)} />
          </svg>
          {SCOPE_LABEL[scope]}
        </li>
      ))}
    </ul>
  );
}

const rankText = (rank: ParsedRank) => (rank.band ? rank.text : `#${rank.text.replace("=", "")}`);

/**
 * Una tira por ranking: su propia escala, para que un puesto nacional de dos
 * cifras y uno mundial de cuatro se lean con el mismo detalle.
 */
export function RankTrace({
  line,
  width = 86,
  height = 30,
  label,
}: {
  line: RankLine;
  width?: number;
  height?: number;
  label: string;
}) {
  const { points } = line;
  if (!points.length) return null;
  const m = { left: 11, right: 16, top: 3, bottom: 5.4 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const first = points[0].year;
  const last = points[points.length - 1].year;
  const { y, ticks } = rankScale(points.flatMap((pt) => rankSpan(pt.rank)), m.top, innerH, { pad: 1.15, minRatio: 2.2, dense: true });
  const x = (year: number) => m.left + (last === first ? innerW / 2 : ((year - first) / (last - first)) * innerW);
  const shown = ticks.length > 3 ? ticks.filter((_, i) => i % Math.ceil(ticks.length / 3) === 0) : ticks;
  const end = points[points.length - 1];

  return (
    <svg className="bol-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} style={{ "--c": line.color } as CSSProperties}>
      {shown.map((t) => (
        <g key={t}>
          <line className="bol-chart__grid" x1={m.left} x2={m.left + innerW} y1={y(t)} y2={y(t)} />
          <text className="bol-chart__tick" x={m.left - 1.2} y={y(t)} dy="0.8" textAnchor="end">
            #{t}
          </text>
        </g>
      ))}
      {points.length > 1 && (
        <path className="bol-chart__line" d={points.map((pt, i) => `${i ? "L" : "M"}${x(pt.year).toFixed(2)} ${y(pt.rank.value).toFixed(2)}`).join("")} />
      )}
      {points.map((pt) => {
        const [from, to] = rankSpan(pt.rank).length === 2 ? (rankSpan(pt.rank) as [number, number]) : [pt.rank.value, pt.rank.value];
        return (
          <g key={pt.year}>
            {pt.rank.band && <line className="bol-chart__rank-band" x1={x(pt.year)} x2={x(pt.year)} y1={y(from)} y2={y(to)} />}
            <circle className="bol-chart__dot" cx={x(pt.year)} cy={y(pt.rank.value)} r={0.75} />
            <text className="bol-chart__year" x={x(pt.year)} y={height - 1.4} textAnchor="middle">
              {pt.year}
            </text>
          </g>
        );
      })}
      <text className="bol-chart__rank" x={Math.min(x(end.year) + 1.6, width - 0.4)} y={y(end.rank.value)} dy="0.85" textAnchor={x(end.year) + 1.6 > width - 0.4 ? "end" : "start"}>
        {rankText(end.rank)}
      </text>
    </svg>
  );
}

/**
 * Todos los rankings en un lienzo. Los rótulos van a una columna a la derecha
 * —no al lado de su último punto— y se empujan entre sí cuando chocan, así que
 * ninguno cae encima de otra línea; cada uno llega a su punto por un hilo,
 * aunque ese ranking deje de reportar antes del último año.
 */
export function RankEvolutionChart({
  lines,
  width = 178,
  height: minHeight = 58,
  label,
}: {
  lines: RankLine[];
  width?: number;
  /** Alto mínimo; crece con el número de líneas. */
  height?: number;
  label: string;
}) {
  const drawn = lines.filter((line) => line.points.length > 0);
  if (!drawn.length) return null;
  // Con más de un ámbito en el lienzo, cada línea lleva el trazo y el punto del suyo.
  const scopes = (["global", "regional", "national"] as RankScope[]).filter((sc) => drawn.some((line) => line.scope === sc));
  const marked = scopes.length > 1;
  const years = Array.from(new Set(drawn.flatMap((line) => line.points.map((pt) => pt.year)))).sort((a, b) => a - b);
  const longest = Math.max(...drawn.map((line) => line.label.length));
  // La columna crece con el nombre más largo: un nombre cortado por el borde es
  // justo lo que esta gráfica viene a evitar.
  const gutter = Math.min(54, Math.max(26, 5 + longest * 1.42));
  const height = Math.max(minHeight, 24 + drawn.length * 9.5);
  const m = { left: 13, right: gutter, top: 4, bottom: 6.6 };
  const innerW = width - m.left - m.right;
  const innerH = height - m.top - m.bottom;
  const { y, ticks } = rankScale(drawn.flatMap((line) => line.points.flatMap((pt) => rankSpan(pt.rank))), m.top, innerH, { pad: 1.25 });
  const x = (year: number) => m.left + (years.length === 1 ? innerW / 2 : ((year - years[0]) / (years[years.length - 1] - years[0])) * innerW);
  const labelX = m.left + innerW + 3;
  const placed = stackLabels(drawn.map((line) => y(line.points[line.points.length - 1].rank.value)), 6.2, m.top + 2.4, m.top + innerH - 2);

  const chart = (
    <svg className="bol-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      {ticks.map((t) => (
        <g key={t}>
          <line className="bol-chart__grid" x1={m.left} x2={m.left + innerW} y1={y(t)} y2={y(t)} />
          <text className="bol-chart__tick" x={m.left - 1.2} y={y(t)} dy="0.8" textAnchor="end">
            #{t}
          </text>
        </g>
      ))}
      {years.map((year) => (
        <text key={year} className="bol-chart__year" x={x(year)} y={height - 1.6} textAnchor="middle">
          {year}
        </text>
      ))}
      {drawn.map((line, index) => {
        const end = line.points[line.points.length - 1];
        const endX = x(end.year);
        const endY = y(end.rank.value);
        const labelY = placed[index];
        return (
          <g key={`${line.label}-${line.scope ?? ""}`} style={{ "--c": line.color } as CSSProperties}>
            {line.points.length > 1 && (
              <path
                className="bol-chart__line"
                d={line.points.map((pt, i) => `${i ? "L" : "M"}${x(pt.year).toFixed(2)} ${y(pt.rank.value).toFixed(2)}`).join("")}
                strokeDasharray={marked && line.scope ? scopeDash(line.scope, 0.6) : undefined}
              />
            )}
            {line.points.map((pt) => {
              const span = rankSpan(pt.rank);
              return (
                <g key={pt.year}>
                  {pt.rank.band && <line className="bol-chart__rank-band" x1={x(pt.year)} x2={x(pt.year)} y1={y(span[0])} y2={y(span[1])} />}
                  <path className="bol-chart__dot" d={scopeMarkPath(marked && line.scope ? line.scope : "global", x(pt.year), y(pt.rank.value), marked ? 0.9 : 0.8)} />
                </g>
              );
            })}
            <path
              className="bol-chart__leader"
              d={`M${(endX + 1.2).toFixed(2)} ${endY.toFixed(2)}H${(labelX - 4).toFixed(2)}L${(labelX - 1.4).toFixed(2)} ${labelY.toFixed(2)}H${labelX.toFixed(2)}`}
            />
            <text className="bol-chart__rank" x={labelX} y={labelY} dy="-0.2">
              {rankText(end.rank)}
            </text>
            <text className="bol-chart__series" x={labelX} y={labelY} dy="2.9">
              {line.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
  return marked ? (
    <>
      <ScopeLegend scopes={scopes} />
      {chart}
    </>
  ) : (
    chart
  );
}

export function DataTable({
  head,
  rows,
  highlightCol,
  yearCols,
  caption,
}: {
  head: ReactNode[];
  rows: { label: ReactNode; cells: ReactNode[]; strong?: boolean; shade?: (number | null)[] }[];
  highlightCol?: number;
  /** Columnas (índice de celda) con la cifra del año, junto a sus periodos. */
  yearCols?: number[];
  caption?: ReactNode;
}) {
  const columns = head.length;
  // Una celda con letras es texto (nombre, facultad, acuerdo): parte línea y va
  // a la izquierda. Las cifras se quedan en una línea, a la derecha.
  const isText = (cell: ReactNode) => typeof cell === "string" && cell !== "—" && /[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(cell);
  const textCols = head.map((_, c) => c > 0 && rows.some((row) => isText(row.cells[c - 1])));
  return (
    <div className="bol-table-fit">
    <table className="bol-table" data-density={columns > 11 ? "max" : columns > 7 ? "alta" : undefined} data-rows={rows.length > 10 ? "muchas" : undefined}>
      {caption && <caption>{caption}</caption>}
      <thead>
        <tr>
          {head.map((h, i) => (
            <th key={i} scope="col" data-highlight={i - 1 === highlightCol || undefined} data-year={yearCols?.includes(i - 1) || undefined} data-text={textCols[i] || undefined}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, r) => (
          <tr key={r} data-strong={row.strong || undefined}>
            <th scope="row">{row.label}</th>
            {row.cells.map((cell, c) => (
              <td
                key={c}
                data-highlight={c === highlightCol || undefined}
                data-year={yearCols?.includes(c) || undefined}
                data-empty={cell === "—" || undefined}
                data-text={textCols[c + 1] || undefined}
                style={row.shade?.[c] != null ? ({ "--shade": row.shade[c] } as CSSProperties) : undefined}
                data-shade={row.shade?.[c] != null || undefined}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

/**
 * Ajusta al margen las tablas que aun con letra densa no caben: las reduce con
 * zoom hasta el ancho del cuerpo. Se llama sobre el DOM ya pintado (medida y
 * páginas), antes de medir alturas, así la paginación cuenta la tabla reducida.
 */
export function fitTables(root: ParentNode | null) {
  if (!root) return;
  // Dibujos de ancho fijo (la tubería de la web): se escalan al ancho del cuerpo.
  root.querySelectorAll<HTMLElement>(".bol-fit[data-natural]").forEach((wrap) => {
    const drawing = wrap.firstElementChild as HTMLElement | null;
    const natural = Number(wrap.dataset.natural);
    if (!drawing || !natural || wrap.clientWidth <= 0) return;
    drawing.style.zoom = String(Math.min(1, wrap.clientWidth / natural));
  });
  root.querySelectorAll<HTMLElement>(".bol-table-fit").forEach((wrap) => {
    const table = wrap.firstElementChild as HTMLElement | null;
    if (!table) return;
    table.style.zoom = "";
    const available = wrap.clientWidth;
    const natural = table.scrollWidth;
    if (available > 0 && natural > available + 1) table.style.zoom = String(Math.max(0.55, available / natural));
  });
}

/* --- Mapas ------------------------------------------------------------------ */

const BINS = 6;

function binner(values: number[]) {
  const max = Math.max(0, ...values);
  if (max <= 0) return () => 0;
  const log = max > 30;
  return (v: number | undefined) => {
    if (!v) return 0;
    const t = log ? Math.log10(v) / Math.log10(max) : v / max;
    return Math.max(1, Math.min(BINS, Math.ceil(t * BINS)));
  };
}

export function ChoroplethMap({
  kind,
  totals,
  routes,
  sites,
}: {
  kind: "colombia" | "mundo";
  totals: Record<string, number>;
  /** Rutas de movilidad: país → campus o campus → país. */
  routes?: { code: string; incoming: boolean; strength: number }[];
  sites?: string[];
}) {
  const bin = binner(Object.values(totals));
  if (kind === "colombia") {
    return (
      <svg className="bol-map" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`} role="img" aria-label="Mapa de Colombia por departamento">
        {DEPARTMENTS.map((d) => (
          <path key={d.code} d={d.d} className="bol-map__area" data-bin={bin(totals[d.code])} />
        ))}
        {(sites ?? []).filter((s) => CAMPUS_POINTS[s]).map((s) => (
          <circle key={s} className="bol-map__site" cx={CAMPUS_POINTS[s][0]} cy={CAMPUS_POINTS[s][1]} r={7} />
        ))}
      </svg>
    );
  }
  const points = (sites ?? []).map((s) => WORLD_CAMPUS_POINTS[s]).filter(Boolean);
  const hub: [number, number] = points.length
    ? [points.reduce((a, p) => a + p[0], 0) / points.length, points.reduce((a, p) => a + p[1], 0) / points.length]
    : [297.6, 225];
  const byCode = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));
  return (
    <svg className="bol-map" viewBox={`0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`} role="img" aria-label="Mapa del mundo por país">
      {COUNTRIES.filter((c) => c.d).map((c) => (
        <path key={c.code} d={c.d} className="bol-map__area" data-home={c.code === "COL" || undefined} data-bin={bin(totals[c.code])} />
      ))}
      {Object.keys(totals)
        .filter((code) => byCode[code] && !byCode[code].d)
        .map((code) => (
          <circle key={code} className="bol-map__area" data-bin={Math.max(3, bin(totals[code]))} cx={byCode[code].c[0]} cy={byCode[code].c[1]} r={4} />
        ))}
      {(routes ?? []).filter((r) => byCode[r.code]).map((r) => {
        const place = byCode[r.code].c;
        const [a, b] = r.incoming ? [place, hub] : [hub, place];
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const chord = Math.hypot(dx, dy) || 1;
        let nx = -dy / chord;
        let ny = dx / chord;
        if (ny > 0) {
          nx = -nx;
          ny = -ny;
        }
        const lift = Math.min(150, chord * 0.26);
        const cx = (a[0] + b[0]) / 2 + nx * lift;
        const cy = (a[1] + b[1]) / 2 + ny * lift;
        return (
          <path
            key={`${r.code}-${r.incoming}`}
            className="bol-map__route"
            data-dir={r.incoming ? "entrante" : "saliente"}
            d={`M${a[0]} ${a[1]}Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b[0]} ${b[1]}`}
            style={{ strokeWidth: 0.9 + r.strength * 2.4 }}
          />
        );
      })}
      {points.length > 0 && <circle className="bol-map__site" cx={hub[0]} cy={hub[1]} r={4} />}
    </svg>
  );
}

export function MapLegend({ values, unit }: { values: number[]; unit: string }) {
  const max = Math.max(0, ...values);
  return (
    <div className="bol-map-legend">
      <span>{unit}</span>
      <i aria-hidden="true">
        {Array.from({ length: BINS }, (_, i) => (
          <b key={i} data-bin={i + 1} />
        ))}
      </i>
      <span>1 – {formatCount(max)}</span>
    </div>
  );
}
