/* =============================================================================
   Datos Abiertos · rankings universitarios.

   Lo común a la ficha, la intranet y el Boletín: los sistemas de ranking que
   sigue Planeación, las posiciones (número o banda), las categorías de
   estrellas QS y los 17 ODS con su color oficial.

   Una posición se guarda como texto porque los rankings publican bandas:
   "145", "=145", "801-1000", "1001+". Para comparar y dibujar se usa un número:
   el puesto, o el punto medio de la banda ("1001+" cuenta como 1001).
   ========================================================================== */

export type RankingSystem = "qs_world" | "qs_latam" | "qs_subject" | "qs_sustainability" | "the_latam" | "the_impact" | "otro";
export type RankingView = "medallas" | "tabla" | "evolucion" | "ods";
/** Ámbito de una posición. */
export type RankScope = "global" | "regional" | "national";

export const RANKING_SYSTEMS: Record<RankingSystem, { label: string; short: string; publisher: "QS" | "THE" | "" }> = {
  qs_world: { label: "QS World University Rankings", short: "QS World", publisher: "QS" },
  qs_latam: { label: "QS Latin America & The Caribbean", short: "QS Latinoamérica", publisher: "QS" },
  qs_subject: { label: "QS World University Rankings by Subject", short: "QS Subject", publisher: "QS" },
  qs_sustainability: { label: "QS Sustainability Ranking", short: "QS Sostenibilidad", publisher: "QS" },
  the_latam: { label: "THE Latin America University Rankings", short: "THE Latinoamérica", publisher: "THE" },
  the_impact: { label: "THE Impact Rankings (ODS)", short: "THE Impact", publisher: "THE" },
  otro: { label: "Otro ranking", short: "Ranking", publisher: "" },
};

export const RANKING_VIEWS: Record<RankingView, string> = {
  medallas: "Medallas",
  tabla: "Tabla comparativa",
  evolucion: "Evolución",
  ods: "Rueda de ODS",
};

export const SCOPE_LABEL: Record<RankScope, string> = {
  global: "Mundial",
  regional: "Latinoamérica",
  national: "Colombia",
};

/**
 * Orden al elegir un solo ámbito, de lo cercano a lo lejano. Una gráfica de
 * papel no tiene selector y tiene que decidir: para una universidad colombiana,
 * el puesto en Colombia es el que primero se busca.
 *
 * No cambia el orden en que se muestran los tres juntos (mundial, Latinoamérica,
 * Colombia), que sigue al de las columnas de la tabla comparativa.
 */
/** Nombre con el que se rotula un ranking donde no cabe su título entero. */
export const rankingShortLabel = (ranking: { system: RankingSystem; title: string }) =>
  RANKING_SYSTEMS[ranking.system].short === "Ranking" ? ranking.title : RANKING_SYSTEMS[ranking.system].short;

export const SCOPE_PREFERENCE: RankScope[] = ["national", "regional", "global"];

/** El ámbito preferido entre los que alguna de estas ediciones reporta. */
export const preferredScope = (has: (scope: RankScope) => boolean): RankScope | null =>
  SCOPE_PREFERENCE.find(has) ?? null;

/** Los tres ámbitos en el orden de las columnas de la tabla comparativa. */
export const SCOPES: RankScope[] = ["global", "regional", "national"];

/**
 * Cómo se distingue cada ámbito cuando los tres van en la misma gráfica. El
 * color ya es del ranking, así que el ámbito lo dicen el trazo y la forma del
 * punto (y su rótulo): continuo y círculo el mundial, rayas y rombo
 * Latinoamérica, puntos y triángulo Colombia. Se lee también en blanco y negro.
 *
 * El trazo va en múltiplos del grueso de la línea: sirve igual en píxeles que
 * en milímetros.
 */
export const SCOPE_MARK: Record<RankScope, { dash: number[]; shape: "circle" | "diamond" | "triangle" }> = {
  global: { dash: [], shape: "circle" },
  regional: { dash: [3, 1.8], shape: "diamond" },
  national: { dash: [0.05, 1.7], shape: "triangle" },
};

/** "mundial, en Latinoamérica y en Colombia": los ámbitos dichos en una frase. */
export function scopesPhrase(scopes: RankScope[]): string {
  const words = scopes.map((sc) => (sc === "global" ? "mundial" : `en ${SCOPE_LABEL[sc]}`));
  return words.length > 1 ? `${words.slice(0, -1).join(", ")} y ${words[words.length - 1]}` : (words[0] ?? "");
}

/** `stroke-dasharray` del ámbito para una línea de ese grueso; vacío si es continua. */
export const scopeDash = (scope: RankScope, stroke: number): string | undefined =>
  SCOPE_MARK[scope].dash.length ? SCOPE_MARK[scope].dash.map((d) => +(d * stroke).toFixed(3)).join(" ") : undefined;

/** Contorno del punto del ámbito, centrado en (cx, cy), con radio aproximado `r`. */
export function scopeMarkPath(scope: RankScope, cx: number, cy: number, r: number): string {
  const f = (n: number) => n.toFixed(2);
  const shape = SCOPE_MARK[scope].shape;
  if (shape === "diamond") {
    const d = r * 1.3;
    return `M${f(cx)} ${f(cy - d)}L${f(cx + d)} ${f(cy)}L${f(cx)} ${f(cy + d)}L${f(cx - d)} ${f(cy)}Z`;
  }
  if (shape === "triangle") {
    const d = r * 1.35;
    return `M${f(cx)} ${f(cy - d)}L${f(cx + d * 0.95)} ${f(cy + d * 0.7)}L${f(cx - d * 0.95)} ${f(cy + d * 0.7)}Z`;
  }
  return `M${f(cx - r)} ${f(cy)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;
}

/** Categorías de QS Stars, en el orden en que QS las publica. Se pueden añadir otras. */
export const QS_STAR_CATEGORIES = [
  "Teaching",
  "Employability",
  "Research",
  "Internationalization",
  "Online Learning",
  "Academic Development",
  "Facilities",
  "Social Responsibility",
  "Environmental Impact",
  "Inclusiveness",
  "Program Strength",
];

/** Colores de acento sugeridos: los de las líneas de informe del portal. */
export const ACCENT_PRESETS = ["#1f5fbf", "#0b7481", "#a4471f", "#6b3fa0", "#7f6200", "#ad2f58", "#43536b", "#2e6b2f", "#8a3b8f"];

/** Los 17 Objetivos de Desarrollo Sostenible, con el color oficial de la ONU. */
export const SDGS: { n: number; name: string; color: string }[] = [
  { n: 1, name: "Fin de la pobreza", color: "#E5243B" },
  { n: 2, name: "Hambre cero", color: "#DDA63A" },
  { n: 3, name: "Salud y bienestar", color: "#4C9F38" },
  { n: 4, name: "Educación de calidad", color: "#C5192D" },
  { n: 5, name: "Igualdad de género", color: "#FF3A21" },
  { n: 6, name: "Agua limpia y saneamiento", color: "#26BDE2" },
  { n: 7, name: "Energía asequible y no contaminante", color: "#FCC30B" },
  { n: 8, name: "Trabajo decente y crecimiento económico", color: "#A21942" },
  { n: 9, name: "Industria, innovación e infraestructura", color: "#FD6925" },
  { n: 10, name: "Reducción de las desigualdades", color: "#DD1367" },
  { n: 11, name: "Ciudades y comunidades sostenibles", color: "#FD9D24" },
  { n: 12, name: "Producción y consumo responsables", color: "#BF8B2E" },
  { n: 13, name: "Acción por el clima", color: "#3F7E44" },
  { n: 14, name: "Vida submarina", color: "#0A97D9" },
  { n: 15, name: "Vida de ecosistemas terrestres", color: "#56C02B" },
  { n: 16, name: "Paz, justicia e instituciones sólidas", color: "#00689D" },
  { n: 17, name: "Alianzas para lograr los objetivos", color: "#19486A" },
];

export interface StarRating {
  category: string;
  /** 0 a 5. */
  stars: number;
}

export interface SdgResult {
  sdg: number;
  global_rank: string;
  national_rank: string;
  score?: number | null;
}

export interface SubjectResult {
  subject: string;
  global_rank: string;
  national_rank: string;
}

export interface CustomField {
  label: string;
  value: string;
}

export interface RankingEdition {
  year: number;
  global_rank: string;
  regional_rank: string;
  national_rank: string;
  evaluated: number | null;
  score: number | null;
  stars: StarRating[];
  sdgs: SdgResult[];
  subjects: SubjectResult[];
  custom: CustomField[];
  note: string;
}

export interface RankingData {
  id: string;
  uuid?: string;
  title: string;
  description: string;
  system: RankingSystem;
  accent: string;
  view: RankingView;
  source: string;
  officeId?: string | null;
  /** Ediciones en orden de año. */
  editions: RankingEdition[];
}

/* --- Posiciones ---------------------------------------------------------------- */

export interface ParsedRank {
  /** Como se publicó, normalizado: "145", "=145", "801–1000", "1001+". */
  text: string;
  /** Número para comparar y dibujar: el puesto o el punto medio de la banda. */
  value: number;
  band: boolean;
}

export function parseRank(raw: string | null | undefined): ParsedRank | null {
  const text = (raw ?? "").trim().replace(/\s+/g, "");
  if (!text) return null;
  let match = text.match(/^=?(\d{1,5})=?$/);
  if (match) return { text: text.startsWith("=") || text.endsWith("=") ? `=${Number(match[1])}` : String(Number(match[1])), value: Number(match[1]), band: false };
  match = text.match(/^(\d{1,5})[-–](\d{1,5})$/);
  if (match) {
    const [a, b] = [Number(match[1]), Number(match[2])].sort((x, y) => x - y);
    return { text: `${a}–${b}`, value: (a + b) / 2, band: true };
  }
  match = text.match(/^(\d{1,5})\+$/);
  if (match) return { text: `${Number(match[1])}+`, value: Number(match[1]), band: true };
  return null;
}

/** Extremos de una banda ("801–1000", "1001+") para dibujarla como tramo. */
export function bandEnds(rank: ParsedRank, fallback: number): [number, number] {
  const from = Number(rank.text.split(/[–+]/)[0]) || rank.value;
  const to = Number(rank.text.split("–")[1]);
  return [from, Number.isFinite(to) ? to : fallback];
}

/** Los puestos que ocupa una posición: uno, o los dos extremos de su banda. */
export const rankSpan = (rank: ParsedRank): number[] => (rank.band ? bandEnds(rank, rank.value) : [rank.value]);

/**
 * Escala logarítmica invertida sobre un dominio que sale de los datos, con
 * margen: el puesto 1 arriba. Logarítmica porque un ranking nacional (#16) y
 * uno mundial (#1401) tienen que leerse en el mismo dibujo sin aplastarse.
 *
 * `minRatio` evita las dos maneras de mentir con el eje: si el dominio se
 * ciñera a los datos, moverse un puesto llenaría la gráfica de arriba abajo;
 * si fuera siempre ancho, ningún movimiento se vería. Cuando los datos no
 * alcanzan ese recorrido mínimo, el dominio crece por igual hacia los dos lados.
 *
 * Devuelve `y` en las unidades que reciba: píxeles en la ficha, milímetros en
 * el Boletin.
 */
export function rankScale(
  ranks: number[],
  top: number,
  height: number,
  { pad = 1.5, minRatio = 3, dense = false }: { pad?: number; minRatio?: number; dense?: boolean } = {},
) {
  let low = Math.max(1, Math.min(...ranks) / pad);
  let high = Math.max(...ranks) * pad;
  const grow = Math.sqrt(minRatio / (high / low));
  if (grow > 1) {
    low = Math.max(1, low / grow);
    high *= grow;
  }
  const logLow = Math.log10(low);
  const span = Math.log10(high) - logLow || 1;
  const y = (rank: number) => top + ((Math.log10(Math.max(1, rank)) - logLow) / span) * height;
  // Marcas redondas dentro del dominio. En un lienzo estrecho hacen falta más
  // escalones para que siempre caigan dos o tres.
  const steps = dense ? [1, 1.5, 2, 3, 5, 7] : [1, 2, 5];
  const ticks = [0, 1, 2, 3, 4]
    .flatMap((k) => steps.map((m) => Math.round(m * 10 ** k)))
    .filter((t) => t >= low && t <= high);
  return { y, ticks };
}

/**
 * Coloca rótulos que compiten por la misma columna: los que quedarían a menos
 * de `gap` se empujan hacia abajo y, si el bloque se sale por el pie, sube
 * entero. Devuelve una posición por rótulo, en el orden en que llegaron.
 */
export function stackLabels(wanted: number[], gap: number, top: number, bottom: number): number[] {
  const order = wanted.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y);
  let previous = -Infinity;
  for (const item of order) {
    item.y = Math.max(item.y, previous + gap, top);
    previous = item.y;
  }
  if (order.length && order[order.length - 1].y > bottom) {
    let next = Infinity;
    for (let k = order.length - 1; k >= 0; k -= 1) {
      order[k].y = Math.min(order[k].y, next - gap, bottom - (order.length - 1 - k) * gap);
      next = order[k].y;
    }
  }
  const out = new Array<number>(wanted.length);
  for (const item of order) out[item.i] = item.y;
  return out;
}

/** ¿Es una posición válida o vacía? Mismo criterio que od_rank_is_valid en la base. */
export const isRankText = (raw: string) => raw.trim() === "" || parseRank(raw) !== null;

export const rankOf = (edition: RankingEdition | undefined, scope: RankScope): ParsedRank | null =>
  edition ? parseRank(scope === "global" ? edition.global_rank : scope === "regional" ? edition.regional_rank : edition.national_rank) : null;

/**
 * Variación de puesto frente a la edición anterior. En un ranking, bajar el
 * número es subir: `places` positivo es mejora. Dos bandas iguales no cambian.
 */
export function rankChange(current: ParsedRank | null, previous: ParsedRank | null): { places: number; label: string } | null {
  if (!current || !previous) return null;
  if (current.text === previous.text) return { places: 0, label: current.band ? "misma banda" : "igual" };
  const places = Math.round(previous.value - current.value);
  if (places === 0) return { places: 0, label: "igual" };
  // Con una banda de por medio, la cuenta de puestos sería un punto medio, no
  // un dato: se dice de dónde viene.
  if (current.band || previous.band) return { places, label: `${places > 0 ? "sube" : "baja"} desde ${previous.text}` };
  const shown = new Intl.NumberFormat("es-CO").format(Math.abs(places));
  return { places, label: `${places > 0 ? "sube" : "baja"} ${shown} ${Math.abs(places) === 1 ? "puesto" : "puestos"}` };
}

/** Última edición con alguna posición, estrella u ODS. */
export function latestEdition(ranking: RankingData, year?: number): RankingEdition | undefined {
  const withData = ranking.editions.filter(
    (e) => e.global_rank || e.regional_rank || e.national_rank || e.stars.length || e.sdgs.length || e.subjects.length || e.custom.length || e.score !== null,
  );
  if (year !== undefined) return withData.find((e) => e.year === year) ?? withData.filter((e) => e.year <= year).pop();
  return withData[withData.length - 1];
}

export const previousEdition = (ranking: RankingData, edition: RankingEdition) =>
  ranking.editions.filter((e) => e.year < edition.year).pop();

/** Normaliza lo que llega en jsonb: listas que pueden venir incompletas de una captura vieja. */
export function editionFromRow(row: {
  year: number;
  global_rank?: string | null;
  regional_rank?: string | null;
  national_rank?: string | null;
  evaluated?: number | null;
  score?: number | string | null;
  stars?: unknown;
  sdgs?: unknown;
  subjects?: unknown;
  custom?: unknown;
  note?: string | null;
}): RankingEdition {
  const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
  return {
    year: Number(row.year),
    global_rank: row.global_rank ?? "",
    regional_rank: row.regional_rank ?? "",
    national_rank: row.national_rank ?? "",
    evaluated: row.evaluated ?? null,
    score: row.score === null || row.score === undefined || row.score === "" ? null : Number(row.score),
    stars: list<StarRating>(row.stars).filter((s) => s && s.category).map((s) => ({ category: String(s.category), stars: Math.max(0, Math.min(5, Math.round(Number(s.stars) || 0))) })),
    sdgs: list<SdgResult>(row.sdgs)
      .filter((s) => s && Number(s.sdg) >= 1 && Number(s.sdg) <= 17)
      .map((s) => ({ sdg: Number(s.sdg), global_rank: s.global_rank ?? "", national_rank: s.national_rank ?? "", score: s.score ?? null }))
      .sort((a, b) => a.sdg - b.sdg),
    subjects: list<SubjectResult>(row.subjects).filter((s) => s && s.subject).map((s) => ({ subject: String(s.subject), global_rank: s.global_rank ?? "", national_rank: s.national_rank ?? "" })),
    custom: list<CustomField>(row.custom).filter((c) => c && c.label).map((c) => ({ label: String(c.label), value: String(c.value ?? "") })),
    note: row.note ?? "",
  };
}
