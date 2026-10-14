/* =============================================================================
   Boletín · Saber TyT: de Saber 11 a la prueba de salida.

   Tres hojas por competencia, porque en una sola no cabe: el cuerpo de una
   página A4 mide 243,5 mm y cada dibujo pide su espacio.

     1. Motor Beta: entrada, salida, valor agregado por programa y tránsito.
     2. Motor Alpha: el plano, las cifras y los pesos del modelo.
     3. La tabla por programa con los dos motores, que continúa si no cabe.

   Todo se mide en milímetros y usa la paleta fija del papel: azul cuando la
   posición sube, terracota cuando baja.
   ========================================================================== */

import type { ReactNode } from "react";
import { ALL_YEARS } from "../datos-abiertos/data/terms";
import {
  QUARTER_LABEL,
  TYT_COMPETENCIES,
  isPaired,
  transitionShares,
  tytFigure,
  tytInfo,
  tytPrograms,
  tytYears,
} from "../datos-abiertos/data/saber-tyt";
import type { SaberTytData, TytCompetency, TytFigure } from "../datos-abiertos/data/saber-tyt";
import type { Report } from "../datos-abiertos/data/types";
import { ALPHA_CITATION, ALPHA_FIT_LABEL, ALPHA_PREDICTORS, fitPredictors, planePoints } from "../datos-abiertos/data/saber-alpha";
import type { AlphaFit, AlphaModel } from "../datos-abiertos/data/saber-alpha";
import { DataTable } from "./figures";

const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const decimal = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const signed = (n: number) => {
  const r = Math.round(n * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${decimal.format(Math.abs(r))}`;
};
const pct = (n: number) => `${integer.format(Math.round(n))} %`;

/** Con menos pareados que esto, el promedio de un programa no se compara. */
const FEW = 10;
/** Programas que caben en la hoja de barras sin desbordar el cuerpo de la página. */
const BAR_ROWS = 14;
/** Filas de la tabla en su hoja y en cada continuación. */
const TABLE_FIRST = 22;
const TABLE_NEXT = 40;
/** El ajuste con el que se calcularon las cifras por programa. */
const STORED_FIT: AlphaFit = "ampliado";

type SheetComponent = (props: {
  title: string;
  description?: string;
  source: string;
  notes?: [string, ReactNode][];
  cut?: string;
  wide?: boolean;
  children: ReactNode;
}) => ReactNode;
type ContinuationComponent = (props: { title: string; from: number; to: number; total: number; children: ReactNode }) => ReactNode;

export const tytRef = (data: SaberTytData, competency: TytCompetency) => `tyt:${data.id}:${competency}`;

/** Las competencias publicables del conjunto: las que tienen las dos pruebas. */
export function tytRefs(report: Report): { ref: string; title: string }[] {
  return (report.saberTyt ?? []).flatMap((data) =>
    data.results.length
      ? TYT_COMPETENCIES.filter((c) => isPaired(c.key) && tytFigure(data, c.key, null)).map((c) => ({
          ref: tytRef(data, c.key),
          title: `Saber TyT · ${c.label}`,
        }))
      : [],
  );
}

export function parseTytKey(report: Report, key: string): { data: SaberTytData; competency: TytCompetency } | null {
  const at = key.lastIndexOf(":");
  if (at < 0) return null;
  const data = report.saberTyt?.find((t) => t.id === key.slice(0, at));
  const competency = key.slice(at + 1) as TytCompetency;
  return data && TYT_COMPETENCIES.some((c) => c.key === competency) ? { data, competency } : null;
}

const pairedOf = (figure: TytFigure) =>
  Object.values(figure.transitions).reduce((sum, row) => sum + Object.values(row).reduce((a, b) => a + b, 0), 0);

const alphaModel = (data: SaberTytData, competency: TytCompetency, fit: AlphaFit = STORED_FIT): AlphaModel | undefined =>
  data.alpha?.modelos?.[competency]?.[fit];

/* --- Dibujos en milímetros --------------------------------------------------------- */

/** Valor agregado por programa: barras a lado y lado de la línea del cero. */
function ValueBars({ rows, unit, width = 178 }: { rows: { name: string; delta: number; pairs: number }[]; unit: string; width?: number }) {
  const L = 62;
  const R = 18;
  const plot = width - L - R;
  const max = Math.max(10, ...rows.map((r) => Math.abs(r.delta)));
  const ROW = 5.2;
  const height = rows.length * ROW + 7;
  const zero = L + plot / 2;
  const scale = (value: number) => (Math.abs(value) / max) * (plot / 2);

  return (
    <svg className="bol-chart bol-tyt-value" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Valor agregado por programa, en ${unit}`}>
      <text className="bol-chart__tick" x={zero} y={2.6} textAnchor="middle">
        0
      </text>
      <line className="bol-chart__grid" x1={zero} x2={zero} y1={3.4} y2={rows.length * ROW + 4} />
      {rows.map((row, i) => {
        const y = 4 + i * ROW;
        const w = scale(row.delta);
        return (
          <g key={row.name} opacity={row.pairs < FEW ? 0.55 : undefined}>
            <text className="bol-chart__series" x={0} y={y + ROW - 1.8}>
              {row.name.length > 36 ? `${row.name.slice(0, 35)}…` : row.name}
            </text>
            <rect
              x={row.delta >= 0 ? zero : zero - w}
              y={y + 0.7}
              width={Math.max(0.3, w)}
              height={ROW - 2.3}
              rx={0.5}
              style={{ fill: row.delta >= 0 ? "var(--bol-div-pos-2)" : "var(--bol-div-neg-2)" }}
            />
            <text className="bol-chart__value" x={width} y={y + ROW - 1.8} textAnchor="end">
              {signed(row.delta)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Tránsito: una barra al 100 % por cuarto de entrada. */
function TransitBars({ figure, width = 178 }: { figure: TytFigure; width?: number }) {
  const rows = transitionShares(figure).filter((r) => r.total > 0);
  const L = 34;
  const R = 22;
  const plot = width - L - R;
  const ROW = 7.4;
  const height = rows.length * ROW + 4;
  const tone = ["var(--bol-seq-1)", "var(--bol-seq-2)", "var(--bol-seq-3)", "var(--bol-seq-4)"];
  const ink = ["#ffffff", "#ffffff", "#16243a", "#16243a"];

  return (
    <svg className="bol-chart bol-tyt-transit" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Tránsito entre cuartos de entrada y de salida">
      {rows.map((row, i) => {
        const y = 2 + i * ROW;
        let x = L;
        return (
          <g key={row.from}>
            <text className="bol-chart__series" x={0} y={y + 4.2}>
              {QUARTER_LABEL[row.from].replace("Cuarto ", "")}
            </text>
            {row.to.map((part, j) => {
              const w = ((part.share ?? 0) / 100) * plot;
              const at = x;
              x += w;
              if (w <= 0.2) return null;
              return (
                <g key={part.to}>
                  <rect x={at} y={y} width={Math.max(0.2, w - 0.3)} height={ROW - 2.4} style={{ fill: tone[j] }} />
                  {w > 11 && (
                    <text x={at + w / 2} y={y + 3.7} textAnchor="middle" className="bol-tyt-transit__pct" style={{ fill: ink[j] }}>
                      {pct(part.share ?? 0)}
                    </text>
                  )}
                </g>
              );
            })}
            <text className="bol-chart__tick" x={width} y={y + 4} textAnchor="end">
              {integer.format(row.total)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** El plano del Motor Alpha: esperado en el eje horizontal, real en el vertical. */
function PlaneChart({ figure, size = 96 }: { figure: TytFigure; size?: number }) {
  const points = planePoints(figure.alpha.plane);
  if (!points.length) return null;
  const spread = points
    .flatMap((p) => [
      { v: p.expected, n: p.count },
      { v: p.actual, n: p.count },
    ])
    .sort((a, b) => a.v - b.v);
  const total = spread.reduce((sum, d) => sum + d.n, 0);
  const at = (share: number) => {
    let seen = 0;
    for (const d of spread) {
      seen += d.n;
      if (seen >= total * share) return d.v;
    }
    return spread[spread.length - 1].v;
  };
  const lo = Math.floor((at(0.005) - 5) / 10) * 10;
  const hi = Math.ceil((at(0.995) + 10) / 10) * 10;
  const inside = points.filter((p) => p.expected >= lo && p.expected <= hi && p.actual >= lo && p.actual <= hi);
  const shown = inside.reduce((sum, p) => sum + p.count, 0);
  const M = { top: 3, right: 4, bottom: 9, left: 11 };
  const plot = size - M.left - M.right;
  const x = (v: number) => M.left + ((v - lo) / (hi - lo)) * plot;
  const y = (v: number) => M.top + plot - ((v - lo) / (hi - lo)) * plot;
  const height = M.top + plot + M.bottom;
  const peak = Math.max(...inside.map((p) => p.count));
  const ticks = [lo, lo + (hi - lo) / 2, hi];

  return (
    <svg className="bol-chart bol-tyt-plane" viewBox={`0 0 ${size} ${height}`} role="img" aria-label={`Plano de valor agregado: puntaje esperado frente al real; el cuadro recoge ${integer.format(shown)} de ${integer.format(total)} lecturas`}>
      {ticks.map((v) => (
        <g key={v}>
          <line className="bol-chart__grid" x1={x(v)} x2={x(v)} y1={M.top} y2={M.top + plot} />
          <line className="bol-chart__grid" x1={M.left} x2={M.left + plot} y1={y(v)} y2={y(v)} />
          <text className="bol-chart__tick" x={x(v)} y={height - 5} textAnchor="middle">
            {integer.format(Math.round(v))}
          </text>
          <text className="bol-chart__tick" x={M.left - 1.2} y={y(v) + 0.8} textAnchor="end">
            {integer.format(Math.round(v))}
          </text>
        </g>
      ))}
      <line className="bol-tyt-plane__diagonal" x1={x(lo)} y1={y(lo)} x2={x(hi)} y2={y(hi)} />
      {inside.map((p) => (
        <circle
          key={`${p.expected}-${p.actual}`}
          cx={x(p.expected + 2.5)}
          cy={y(p.actual + 2.5)}
          r={0.45 + (p.count / peak) * 1.9}
          className="bol-tyt-plane__dot"
          style={{ fill: p.above ? "var(--bol-div-pos-2)" : "var(--bol-div-neg-2)" }}
        />
      ))}
      <text className="bol-chart__tick" x={M.left + plot / 2} y={height - 0.8} textAnchor="middle">
        esperado
      </text>
      <text className="bol-chart__tick" x={2.6} y={M.top + plot / 2} textAnchor="middle" transform={`rotate(-90 2.6 ${M.top + plot / 2})`}>
        real
      </text>
    </svg>
  );
}

/** Los pesos de un ajuste, en barras a lado y lado del cero. */
function CoefBars({ model, fit, width = 84 }: { model: AlphaModel; fit: AlphaFit; width?: number }) {
  const keys = ALPHA_PREDICTORS.filter((p) => fitPredictors(fit).includes(p.key));
  const max = Math.max(0.2, ...keys.map((p) => Math.abs(model.coef[p.key] ?? 0)));
  const L = 34;
  const R = 12;
  const plot = width - L - R;
  const ROW = 5;
  const zero = L + plot / 2;
  const height = keys.length * ROW + 3;

  return (
    <svg className="bol-chart bol-tyt-coef" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Pesos del ajuste ${ALPHA_FIT_LABEL[fit]}`}>
      <line className="bol-chart__grid" x1={zero} x2={zero} y1={1} y2={keys.length * ROW + 1} />
      {keys.map((p, i) => {
        const beta = model.coef[p.key] ?? 0;
        const w = (Math.abs(beta) / max) * (plot / 2);
        const y = 1 + i * ROW;
        return (
          <g key={p.key}>
            <text className="bol-chart__series" x={0} y={y + ROW - 1.6}>
              {p.label}
            </text>
            <rect
              x={beta >= 0 ? zero : zero - w}
              y={y + 0.6}
              width={Math.max(0.3, w)}
              height={ROW - 2.2}
              rx={0.4}
              style={{ fill: beta >= 0 ? "var(--bol-div-pos-2)" : "var(--bol-div-neg-2)" }}
            />
            <text className="bol-chart__value" x={width} y={y + ROW - 1.6} textAnchor="end">
              {signed(beta)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* --- Las hojas ------------------------------------------------------------------------- */

interface ProgramRow {
  name: string;
  delta: number | null;
  pairs: number;
  entry: number | null;
  exit: number | null;
  expected: number | null;
  actual: number | null;
  va: number | null;
  alphaN: number;
}

function programRows(data: SaberTytData, competency: TytCompetency, year: number | null): ProgramRow[] {
  return tytPrograms(data)
    .map((p) => {
      const at = tytFigure(data, competency, year, { program: p.name });
      if (!at) return null;
      const pairs = pairedOf(at);
      if (!pairs && !at.alpha.alphaN) return null;
      return {
        name: p.name,
        delta: at.meanDelta,
        pairs,
        entry: at.meanEntry,
        exit: at.meanExit,
        expected: at.alpha.alphaExpected,
        actual: at.alpha.alphaActual,
        va: at.alpha.alphaVa,
        alphaN: at.alpha.alphaN ?? 0,
      };
    })
    .filter((r): r is ProgramRow => r !== null);
}

export function tytUnits(
  data: SaberTytData,
  competency: TytCompetency,
  cut: number,
  Sheet: SheetComponent,
  Continuation: ContinuationComponent,
): { node: ReactNode; title: string; tight?: boolean }[] {
  const years = tytYears(data).filter((y) => cut === ALL_YEARS || y <= cut);
  if (!years.length) return [];
  const info = tytInfo(competency);
  const figure = tytFigure(data, competency, null);
  if (!figure || figure.meanEntry === null || figure.meanExit === null) return [];
  const paired = pairedOf(figure);
  const span = `${years[0]}–${years[years.length - 1]}`;
  const cutNote = cut === ALL_YEARS ? `Todos los años reportados (${span})` : `Hasta ${cut}`;
  const title = `Saber TyT · ${info.label}`;
  const rows = programRows(data, competency, null);
  const units: { node: ReactNode; title: string; tight?: boolean }[] = [];

  /* Hoja 1: el Motor Beta. */
  const betaRows = rows.filter((r) => r.delta !== null && r.pairs > 0).sort((a, b) => (b.delta ?? 0) - (a.delta ?? 0));
  const shownBars = betaRows.length > BAR_ROWS ? [...betaRows.slice(0, BAR_ROWS - 4), ...betaRows.slice(-4)] : betaRows;
  const low = transitionShares(figure).find((r) => r.from === "1");
  const lift = low && low.total ? ((low.to[2].count + low.to[3].count) / low.total) * 10 : null;

  units.push({
    title,
    node: (
      <Sheet
        title={`${title} · posición de entrada y de salida`}
        description={`Con qué percentil entraron los estudiantes de tecnología en ${info.entry.toLowerCase()} del Saber 11, con cuál salieron en ${info.exit.toLowerCase()} del Saber TyT y cuánto ganó o perdió cada programa.`}
        source={data.source}
        notes={[
          ["Cómo se lee", "Cada puntaje es su percentil dentro de la cohorte histórica de la UDES en esa prueba: las escalas de las dos pruebas no se comparan en puntos."],
          ["Cuidado", "La referencia es la propia cohorte, así que el promedio institucional queda siempre en la mitad: lo que se compara son los programas entre sí."],
          ["Pocos evaluados", `En tinta tenue, los programas con menos de ${FEW} evaluados con las dos pruebas.`],
          ["Corte", cutNote],
        ]}
        wide
      >
        <dl className="bol-saber-keys bol-tyt-keys">
          <div>
            <dt>Entrada · {info.entry}</dt>
            <dd>
              <b>{decimal.format(figure.meanEntry)}</b>
              <span>percentil · {figure.rawEntry !== null ? `${decimal.format(figure.rawEntry)} puntos` : "sin puntaje"}</span>
            </dd>
          </div>
          <div>
            <dt>Salida · {info.exit}</dt>
            <dd>
              <b>{decimal.format(figure.meanExit)}</b>
              <span>percentil · {figure.rawExit !== null ? `${decimal.format(figure.rawExit)} puntos` : "sin puntaje"}</span>
            </dd>
          </div>
          <div>
            <dt>Valor agregado</dt>
            <dd>
              <b>{figure.meanDelta === null ? "—" : signed(figure.meanDelta)}</b>
              <span>{figure.improvedShare === null ? "sin pareja de pruebas" : `${pct(figure.improvedShare)} de ${integer.format(paired)} evaluados subió`}</span>
            </dd>
          </div>
        </dl>

        {shownBars.length > 0 && (
          <figure className="bol-tyt-figure">
            <figcaption>
              Valor agregado por programa, en puntos de percentil
              {betaRows.length > shownBars.length ? ` · los ${BAR_ROWS - 4} primeros y los 4 últimos de ${betaRows.length}; el resto, en la tabla` : ""}
            </figcaption>
            <ValueBars rows={shownBars.map((r) => ({ name: r.name, delta: r.delta ?? 0, pairs: r.pairs }))} unit="puntos de percentil" />
          </figure>
        )}

        <figure className="bol-tyt-figure">
          <figcaption>
            De qué cuarto de la distribución de entrada salieron: cada barra suma 100 %
            {lift !== null ? `. De cada diez que entraron en el cuarto más bajo, ${decimal.format(lift)} salieron en los dos altos` : ""}
          </figcaption>
          <TransitBars figure={figure} />
        </figure>
      </Sheet>
    ),
  });

  /* Hoja 2: el Motor Alpha. */
  const model = alphaModel(data, competency);
  const full = alphaModel(data, competency, "completo");
  if (model && figure.alpha.alphaVa !== null && figure.alpha.alphaN) {
    units.push({
      title: `${title} · Motor Alpha`,
      node: (
        <Sheet
          title={`${title} · lo que se esperaba y lo que ocurrió`}
          description="Una regresión lineal múltiple estima, con las competencias del Saber 11 de cada estudiante, el puntaje que cabía esperar en la prueba de salida. El valor agregado es la distancia con el resultado real."
          source={data.source}
          notes={[
            ["El modelo", `${ALPHA_CITATION.authors} · ${ALPHA_CITATION.journal} · ${ALPHA_CITATION.license} · ${ALPHA_CITATION.doi}`],
            ["Cómo se lee", "En el plano, cada burbuja reúne a los evaluados de una celda de 5 puntos. Sobre la diagonal, el resultado superó lo previsto; bajo ella, quedó corto."],
            ["Cuánto creerle", `El ajuste explica el ${pct(model.r2 * 100)} de la variación con ${integer.format(model.n)} estudiantes y se equivoca en promedio ${decimal.format(model.rmse)} puntos.`],
            ["Corte", cutNote],
          ]}
          wide
        >
          <div className="bol-tyt-alpha">
            <figure className="bol-tyt-figure">
              <figcaption>Plano de valor agregado: esperado frente a real, en puntos de la prueba</figcaption>
              <PlaneChart figure={figure} />
              <p className="bol-tyt-figure__foot">Cada burbuja es una celda de 5 × 5 puntos; su tamaño, cuántos evaluados caen en ella.</p>
            </figure>
            <div className="bol-tyt-alpha__side">
              <dl className="bol-saber-keys bol-tyt-keys">
                <div>
                  <dt>Esperado</dt>
                  <dd>
                    <b>{decimal.format(figure.alpha.alphaExpected ?? 0)}</b>
                    <span>puntos, según su Saber 11</span>
                  </dd>
                </div>
                <div>
                  <dt>Real</dt>
                  <dd>
                    <b>{decimal.format(figure.alpha.alphaActual ?? 0)}</b>
                    <span>puntos obtenidos</span>
                  </dd>
                </div>
                <div>
                  <dt>Valor agregado</dt>
                  <dd>
                    <b>{signed(figure.alpha.alphaVa)}</b>
                    <span>
                      {figure.alpha.alphaPositive !== null && figure.alpha.alphaN
                        ? `${pct((figure.alpha.alphaPositive / figure.alpha.alphaN) * 100)} por encima de lo esperado · ${integer.format(figure.alpha.alphaN)} evaluados`
                        : ""}
                    </span>
                  </dd>
                </div>
              </dl>
              <figure className="bol-tyt-figure">
                <figcaption>Qué pesa cada competencia del Saber 11 · {ALPHA_FIT_LABEL[STORED_FIT].toLowerCase()}</figcaption>
                <CoefBars model={model} fit={STORED_FIT} />
              </figure>
              {full && (
                <p className="bol-tyt-alpha__note">
                  El ajuste del artículo, con las cinco competencias, explica el {pct(full.r2 * 100)} con {integer.format(full.n)} estudiantes; las cifras por programa usan el
                  ampliado, que cubre a más.
                </p>
              )}
            </div>
          </div>
        </Sheet>
      ),
    });
  }

  /* Hoja 3 y continuaciones: la tabla por programa, con los dos motores. */
  const tableRows = rows
    .filter((r) => r.pairs > 0 || r.alphaN > 0)
    .sort((a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity))
    .map((r) => ({
      label: r.name,
      cells: [
        r.entry === null ? "—" : decimal.format(r.entry),
        r.exit === null ? "—" : decimal.format(r.exit),
        r.delta === null ? "—" : signed(r.delta),
        integer.format(r.pairs),
        r.expected === null ? "—" : decimal.format(r.expected),
        r.actual === null ? "—" : decimal.format(r.actual),
        r.va === null ? "—" : signed(r.va),
        integer.format(r.alphaN),
      ],
    }));
  if (tableRows.length) {
    const head = ["Programa", "Entrada", "Salida", "VA percentil", "Con Saber 11", "Esperado", "Real", "VA puntos", "Con modelo"];
    const tableTitle = `${title} · por programa`;
    const chunks: { from: number; list: typeof tableRows }[] = [{ from: 0, list: tableRows.slice(0, TABLE_FIRST) }];
    for (let i = TABLE_FIRST; i < tableRows.length; i += TABLE_NEXT) chunks.push({ from: i, list: tableRows.slice(i, i + TABLE_NEXT) });
    chunks.forEach((chunk, index) => {
      units.push(
        index === 0
          ? {
              title: tableTitle,
              node: (
                <Sheet
                  title={tableTitle}
                  description="Las cuatro primeras columnas de cifras son el Motor Beta, en percentiles; las cuatro últimas, el Motor Alpha, en puntos de la prueba de salida."
                  source={data.source}
                  notes={[
                    ["Motor Beta", "Percentil medio de entrada y de salida dentro de la cohorte de la UDES, y su diferencia. «Con Saber 11» son los evaluados que tienen las dos pruebas; «con modelo», los que además traen las competencias que pide la regresión."],
                    ["Motor Alpha", "Puntaje esperado por la regresión, puntaje real y su diferencia."],
                    ...(chunks.length > 1 ? ([["Filas", `1 a ${chunk.list.length} de ${tableRows.length} · continúa`]] as [string, ReactNode][]) : []),
                    ["Corte", cutNote],
                  ]}
                  wide
                >
                  <DataTable head={head} rows={chunk.list} />
                </Sheet>
              ),
            }
          : {
              title: tableTitle,
              tight: true,
              node: (
                <Continuation title={tableTitle} from={chunk.from + 1} to={chunk.from + chunk.list.length} total={tableRows.length}>
                  <DataTable head={head} rows={chunk.list} />
                </Continuation>
              ),
            },
      );
    });
  }

  return units;
}

/** La cifra del Motor Beta para la ficha ejecutiva. */
export function tytHighlight(data: SaberTytData, competency: TytCompetency, cut: number) {
  const years = tytYears(data).filter((y) => cut === ALL_YEARS || y <= cut);
  if (!years.length) return null;
  const figure = tytFigure(data, competency, null);
  if (!figure || figure.meanDelta === null) return null;
  const info = tytInfo(competency);
  return {
    title: `Saber TyT · ${info.label}`,
    value: signed(figure.meanDelta),
    unit: "puntos de percentil",
    note: `${years[0]}–${years[years.length - 1]}${figure.improvedShare === null ? "" : ` · ${pct(figure.improvedShare)} subió de percentil`}`,
  };
}
