/* =============================================================================
   Boletín · hojas de un modelo estadístico (0046).

   Dos hojas por modelo, con la misma lectura de la ficha (data/model.ts):
   · Factores asociados: razones de probabilidades con su intervalo del
     95 % en escala logarítmica, y la tabla de coeficientes como la publica
     SPSS (B, error, Wald, Sig., Exp(B) e intervalo).
   · Calidad y perfiles: la tabla de clasificación, la bondad de ajuste, tres
     perfiles de ejemplo con su probabilidad y la composición de la muestra.
   En papel no hay simulador: los perfiles lo reemplazan con cifras fijas.
   ========================================================================== */

import type { CSSProperties, ReactNode } from "react";
import {
  classificationOf,
  extremeProfile,
  fmtB,
  fmtOr,
  fmtP,
  fmtPct,
  predict,
  referenceProfile,
  significant,
  termRows,
} from "../datos-abiertos/data/model";
import type { ModelData, Report } from "../datos-abiertos/data/types";
import { DataTable } from "./figures";

type Sheet = (props: {
  title: string;
  description?: string;
  source: string;
  notes?: [string, ReactNode][];
  cut?: string;
  wide?: boolean;
  children: ReactNode;
}) => JSX.Element;

const integer = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });
const three = new Intl.NumberFormat("es-CO", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const count = (n: number) => integer.format(n);

/** Referencias de boletín de los modelos del informe. */
export function modelRefs(report: Report): { ref: string; title: string }[] {
  return (report.models ?? []).map((m) => ({ ref: `modelo:${m.id}`, title: m.title }));
}

export function modelUnits(model: ModelData, DatasetSheet: Sheet): { node: ReactNode; title: string }[] {
  const spec = model.spec;
  const q = classificationOf(spec);
  const notes: [string, ReactNode][] = [
    ["Método", spec.method],
    ["Muestra", `${count(spec.sample.n)} estudiantes · cohortes ${spec.sample.cohorts}`],
    ["Fuente", spec.sample.source],
    ["Respuesta", `${spec.response.label}: ${spec.response.positive} (1) frente a ${spec.response.negative} (0)`],
  ];

  const factors = (
    <DatasetSheet title={`${model.title} · factores asociados`} description={spec.question} source={model.source} notes={notes} wide>
      <Forest model={model} />
    </DatasetSheet>
  );

  // La tabla de coeficientes, como la da SPSS, en su propia hoja: con las
  // filas de referencia y las pruebas conjuntas no cabe bajo el bosque.
  const coefficients = (
    <DatasetSheet
      title={`${model.title} · coeficientes`}
      description="Variables en la ecuación, paso final del modelo, tal como las publica SPSS."
      source={model.source}
      notes={[["Lectura", "Exp(B) mayor que 1 sube las posibilidades de un promedio alto frente a la referencia; menor que 1, las baja."]]}
      wide
    >
      <DataTable
        caption={`Variables en la ecuación · significancia al ${fmtPct(spec.fit.significance * 100).replace(",0", "")} · en negrita, lo significativo · «referencia»: la categoría con la que se comparan las demás de su variable (Exp(B) = 1)`}
        head={["Variable · nivel", "B", "Error", "Wald", "Sig.", "Exp(B)", "IC 95 %"]}
        rows={[
          ...spec.variables.flatMap((v) => [
            // Con varios niveles, la prueba de la variable en conjunto, como la da SPSS.
            ...(v.overall
              ? [{ label: `${v.label} (en conjunto, ${v.overall.df} gl)`, strong: v.overall.sig < spec.fit.significance, cells: ["", "", three.format(v.overall.wald), fmtP(v.overall.sig), "", ""] }]
              : []),
            { label: `${v.label} · ${v.reference}`, strong: false, cells: ["referencia", "", "", "", "1,00", ""] },
            ...v.levels.map((l) => ({
              label: `${v.label} · ${l.label}`,
              strong: significant(l.term, spec.fit.significance),
              cells: [fmtB(l.term.b), three.format(l.term.se), three.format(l.term.wald), fmtP(l.term.sig), fmtOr(l.term.or), `${fmtOr(l.term.lo)} a ${fmtOr(l.term.hi)}`],
            })),
          ]),
          {
            label: "Constante",
            strong: false,
            cells: [fmtB(spec.intercept.b), three.format(spec.intercept.se), three.format(spec.intercept.wald), fmtP(spec.intercept.sig), fmtOr(spec.intercept.or), "—"],
          },
        ]}
      />
    </DatasetSheet>
  );

  const profiles = [
    { label: "Perfil de referencia", profile: referenceProfile(spec) },
    { label: "Perfil más probable", profile: extremeProfile(spec, true) },
    { label: "Perfil menos probable", profile: extremeProfile(spec, false) },
  ].map((p) => ({ ...p, result: predict(spec, p.profile) }));

  const quality = (
    <DatasetSheet
      title={`${model.title} · calidad y perfiles`}
      description="Qué tan bien clasifica el modelo y qué probabilidad le da a tres perfiles de estudiante al ingresar."
      source={model.source}
      notes={[
        ["Punto de corte", `${fmtPct(spec.fit.cutoff * 100).replace(",0", "")}: por encima, el modelo pronostica ${spec.response.positive}.`],
        ["Lectura", model.note],
      ]}
      wide
    >
      <p className="bol-model__howto">
        <b>Cómo leer la tabla.</b> Cada fila es lo que de verdad pasó; cada columna, lo que el modelo pronosticó con lo que se
        sabe al ingresar. De los {count(q.negTotal)} estudiantes que terminaron con {spec.response.negative}, acertó con{" "}
        {count(spec.classification.negative.negative)} ({fmtPct(q.negCorrect)}); de los {count(q.posTotal)} que terminaron con{" "}
        {spec.response.positive}, con {count(spec.classification.positive.positive)} ({fmtPct(q.posCorrect)}). En total acierta en{" "}
        {count(spec.classification.negative.negative + spec.classification.positive.positive)} de {count(q.total)} casos, cerca
        de {Math.round(q.overall / 10)} de cada 10. El R² dice qué parte de lo que hace variar el promedio explican estos
        factores ({fmtPct(spec.fit.nagelkerke * 100)}); la prueba de Hosmer y Lemeshow, con p mayor que 0,05, indica que lo
        que el modelo espera coincide con lo que pasó.
      </p>
      <div className="bol-model__pair">
        <DataTable
          caption="Tabla de clasificación · observado frente a pronosticado"
          head={["Observado", `Pronosticado ${spec.response.negative}`, `Pronosticado ${spec.response.positive}`, "% correcto"]}
          rows={[
            { label: spec.response.negative, cells: [count(spec.classification.negative.negative), count(spec.classification.negative.positive), fmtPct(q.negCorrect)] },
            { label: spec.response.positive, cells: [count(spec.classification.positive.negative), count(spec.classification.positive.positive), fmtPct(q.posCorrect)] },
            { label: "Global", strong: true, cells: ["", "", fmtPct(q.overall)] },
          ]}
        />
        <dl className="bol-model__fit">
          <div>
            <dt>R² de Nagelkerke</dt>
            <dd>
              <b>{three.format(spec.fit.nagelkerke)}</b> · explica el {fmtPct(spec.fit.nagelkerke * 100)} de la variación
            </dd>
          </div>
          <div>
            <dt>Hosmer y Lemeshow</dt>
            <dd>
              <b>p = {fmtP(spec.fit.hosmerLemeshowSig)}</b> · {spec.fit.hosmerLemeshowSig > 0.05 ? "ajuste adecuado" : "ajuste dudoso"}
            </dd>
          </div>
          <div>
            <dt>−2 log de verosimilitud</dt>
            <dd>
              <b>{spec.fit.m2ll.toLocaleString("es-CO")}</b> · R² de Cox y Snell {three.format(spec.fit.coxSnell)}
            </dd>
          </div>
        </dl>
      </div>

      <DataTable
        caption={`Perfiles de ejemplo · probabilidad estimada de ${spec.response.label.toLowerCase()} de ${spec.response.positive}`}
        head={["Perfil", "Características", "Probabilidad"]}
        rows={profiles.map((p) => ({
          label: p.label,
          // "Matemáticas: niveles 3-4": un nivel que se repite entre variables lleva su nombre.
          cells: [p.result.parts.map((part) => (part.variable.label.includes(" · ") ? `${part.variable.label.split(" · ")[1]}: ${part.label.toLowerCase()}` : part.label)).join(" · "), fmtPct(p.result.probability * 100)],
        }))}
      />

      <figure>
        <figcaption>De quiénes sale el modelo · {count(spec.sample.n)} estudiantes</figcaption>
        <div className="bol-model__comp">
          {spec.composition.map((g) => {
            const total = g.items.reduce((s, [, n]) => s + n, 0);
            return (
              <div key={g.label}>
                <span>{g.label}</span>
                <span className="bol-model__comp-bar">
                  {g.items.map(([label, n], k) => (
                    <i key={label} style={{ "--w": `${(n / total) * 100}%`, "--tone": `var(--od-inst-${(k % 6) + 1})` } as CSSProperties} />
                  ))}
                </span>
                <small className="bol-model__legend">
                  {g.items.map(([label, n], k) => (
                    <span key={label} style={{ "--tone": `var(--od-inst-${(k % 6) + 1})` } as CSSProperties}>
                      {label} {fmtPct((n / total) * 100)}
                    </span>
                  ))}
                </small>
              </div>
            );
          })}
        </div>
      </figure>
    </DatasetSheet>
  );

  return [
    { node: factors, title: `${model.title} · factores asociados` },
    { node: coefficients, title: `${model.title} · coeficientes` },
    { node: quality, title: `${model.title} · calidad y perfiles` },
  ];
}

/* --- Bosque en milímetros ----------------------------------------------------------- */

const TICKS = [0.1, 0.25, 0.5, 1, 2, 4, 8];

function Forest({ model }: { model: ModelData }) {
  const spec = model.spec;
  const rows = termRows(spec);
  const W = 178;
  const row = 4;
  const labelW = 64;
  const valueW = 30;
  const top = 7;
  const lo = Math.log(0.05);
  const hi = Math.log(10);
  const plotX = labelW + 3;
  const plotW = W - labelW - valueW - 6;
  const x = (v: number) => plotX + ((Math.log(Math.min(10, Math.max(0.05, v))) - lo) / (hi - lo)) * plotW;
  const H = top + rows.length * row + 7;
  return (
    <figure>
      <figcaption>Razón de probabilidades con su intervalo del 95 % · escala logarítmica · lleno: significativo al 5 %</figcaption>
      <svg className="bol-chart bol-model__forest" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Razones de probabilidades por factor">
        {TICKS.map((t) => (
          <g key={t}>
            <line className={t === 1 ? "bol-model__one" : "bol-dei__tick"} x1={x(t)} x2={x(t)} y1={top - 2} y2={H - 5} />
            <text className="bol-chart__label" x={x(t)} y={H - 1.5} textAnchor="middle">
              {String(t).replace(".", ",")}
            </text>
          </g>
        ))}
        <text className="bol-chart__label" x={x(1) - 1.5} y={top - 3} textAnchor="end">
          ← menos posibilidades
        </text>
        <text className="bol-chart__label" x={x(1) + 1.5} y={top - 3}>
          más posibilidades →
        </text>
        {rows.map((r, k) => {
          const y = top + k * row + row / 2;
          const t = r.term;
          const sig = t ? significant(t, spec.fit.significance) : false;
          return (
            <g key={`${r.v.key}-${r.i}`} data-sig={sig || undefined} data-up={(t?.or ?? 1) >= 1 || undefined} data-ref={!t || undefined} className="bol-model__row">
              <text className="bol-chart__label" x={labelW} y={y} dy="0.9" textAnchor="end">
                {r.v.label} · {r.label}
              </text>
              {t ? (
                <>
                  <line className="bol-model__ci" x1={x(t.lo)} x2={x(t.hi)} y1={y} y2={y} />
                  <rect className="bol-model__mark" x={x(t.or) - 1.3} y={y - 1.3} width={2.6} height={2.6} rx={0.4} />
                </>
              ) : (
                <path className="bol-model__refmark" d={`M${x(1)} ${y - 1.4} l1.4 1.4 l-1.4 1.4 l-1.4 -1.4z`} />
              )}
              <text className="bol-chart__value" x={W} y={y} dy="0.9" textAnchor="end">
                {t ? `${fmtOr(t.or)} (${fmtOr(t.lo)}–${fmtOr(t.hi)})` : "referencia · 1,00"}
              </text>
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
