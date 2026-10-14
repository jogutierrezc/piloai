/* =============================================================================
   La capa profunda de Pilo · el motor de la presentación neuronal.

   Emula un cerebro bio-digital de dos hemisferios:
     · Hemisferio Izquierdo (Estratégico · Planeación): PDI (pilares, áreas,
       líneas, proyectos), UDES en Cifras, Observatorio, Boletines, Impacto.
     · Hemisferio Derecho (Curricular · Enseñanza): Innovación pedagógica,
       políticas institucionales, lineamientos globales/ODS, cursos Moodle y
       guías didácticas.
     · Núcleo central / Tronco cerebral: Mr. Pilo, con sus anillos cognitivos
       (Catálogo, Reglas, Guardadas, Puentes y Cortex Gemma 4 31B).
     · Puentes neuronales inter-hemisféricos: sinapsis por reglas (ODS, leyes,
       metas) y temas compartidos, que habilitan la lectura «de visita».
     · Cortex Gemma 4 31B (NVIDIA): red neuronal profunda que procesa y
       sintetiza el razonamiento relacional con verificación de fuentes.

   GSAP anima el estado global (morfología, sinapsis, puentes, activación de
   Gemma 4 31B, halos y partículas) y el lienzo se redibuja en cada cuadro vía
   gsap.ticker. Con movimiento reducido se fijan los estados sin recorrido.
   ========================================================================== */

import gsap from "gsap";

export interface PresentationData {
  pillars: { code: string; name: string }[];
  areas: { code: string; name: string; p: number }[];
  lines: { code: string; name: string; a: number }[];
  projects: { code: string; name: string; to: ["l" | "a", number][] }[];
  reports: { code: string; name: string }[];
  obs: string[];
  teach?: {
    innovacion?: string[];
    politicas?: string[];
    global?: string[];
    moodle?: string[];
    guias?: string[];
  };
  bridges?: {
    a: string;
    b: string;
    kind: "reglas" | "tema" | "visita";
    why: string;
  }[];
}

export type Hemisphere = "planeacion" | "ensenanza";

export type SourceKey =
  | "pdi"
  | "cifras"
  | "obs"
  | "bol"
  | "imp"
  | "innovacion"
  | "politicas"
  | "global"
  | "moodle"
  | "guias";

export const SOURCES: Record<SourceKey, { name: string; color: string; hemi: Hemisphere }> = {
  // Hemisferio Estratégico (Planeación)
  pdi: { name: "Plan de Desarrollo", color: "#b592e6", hemi: "planeacion" },
  cifras: { name: "UDES en Cifras", color: "#6fa4f5", hemi: "planeacion" },
  obs: { name: "Observatorio", color: "#4fc2cf", hemi: "planeacion" },
  bol: { name: "Boletines", color: "#e58a5c", hemi: "planeacion" },
  imp: { name: "Portal de Impacto", color: "#7cc27d", hemi: "planeacion" },
  // Hemisferio Curricular (Enseñanza)
  innovacion: { name: "Innovación Educativa", color: "#38bdf8", hemi: "ensenanza" },
  politicas: { name: "Políticas y Lineamientos", color: "#a78bfa", hemi: "ensenanza" },
  global: { name: "Lineamientos Globales / ODS", color: "#fbbf24", hemi: "ensenanza" },
  moodle: { name: "Cursos Moodle", color: "#f87171", hemi: "ensenanza" },
  guias: { name: "Guías Pedagógicas", color: "#34d399", hemi: "ensenanza" },
};

export const SOURCE_ORDER: SourceKey[] = ["pdi", "cifras", "obs", "bol", "imp"];
export const TEACH_SOURCE_ORDER: SourceKey[] = ["innovacion", "politicas", "global", "moodle", "guias"];
export const ALL_SOURCES: SourceKey[] = [...SOURCE_ORDER, ...TEACH_SOURCE_ORDER];

export interface Node {
  id: string;
  level: number;
  src: SourceKey;
  hemi: Hemisphere;
  code: string;
  name: string;
  type: string;
  pi?: number;
  ghost?: boolean;
  hidden?: boolean;
  ang: number;
  cx: number;
  cy: number;
  phase: number;
}

export interface Edge {
  a: Node;
  b: Node;
  kind: "contiene" | "vincula" | "puente";
}

export interface NeuralBridge {
  id: string;
  a: Node;
  b: Node;
  kind: "reglas" | "tema" | "visita";
  why: string;
  refCode?: string;
}

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

const STOP = new Set([
  "para",
  "desde",
  "sobre",
  "entre",
  "hacia",
  "fortalecimiento",
  "desarrollo",
  "programa",
  "proyecto",
  "institucional",
  "curricular",
  "aprendizaje",
]);

/* --- El modelo: nodos, dos hemisferios y puentes neuronales ------------------------------ */

export interface Model {
  nodes: Node[];
  edges: Edge[];
  bridges: NeuralBridge[];
  counts: {
    nodes: number; // Nodos de Planeación (compatibilidad con tests)
    teachNodes: number; // Nodos de Enseñanza
    totalNodes: number; // Ambos hemisferios combinados
    edges: number;
    bridges: number;
  };
  focus: Node | null;
  focusLines: number;
  focusPillars: Node[];
  matches: Set<Node>;
  activeBridges: Set<NeuralBridge>;
  question: string;
  answer: string;
  gemma: {
    model: string;
    params: string;
    provider: string;
    reasoning: string;
  };
}

export function buildModel(data: PresentationData): Model {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const bridges: NeuralBridge[] = [];

  const add = (n: Omit<Node, "ang" | "cx" | "cy" | "phase">) => {
    const node = { ...n, ang: 0, cx: 0, cy: 0, phase: 0 } as Node;
    nodes.push(node);
    return node;
  };

  const link = (a: Node, b: Node, kind: Edge["kind"] = "contiene") => edges.push({ a, b, kind });

  // 1. HEMISFERIO IZQUIERDO: Planeación Institucional
  const hubsPlaneacion = {} as Record<SourceKey, Node>;
  for (const k of SOURCE_ORDER) {
    hubsPlaneacion[k] = add({
      id: `fuente:${k}`,
      level: 1,
      src: k,
      hemi: "planeacion",
      code: "",
      name: SOURCES[k].name,
      type: "fuente",
    });
  }

  const P = data.pillars.map((p, i) =>
    add({ id: `p${i}`, level: 2, src: "pdi", hemi: "planeacion", code: p.code, name: p.name, type: "pilar", pi: i }),
  );
  P.forEach((p) => link(hubsPlaneacion.pdi, p));

  const A = data.areas.map((a, i) =>
    add({ id: `a${i}`, level: 3, src: "pdi", hemi: "planeacion", code: a.code, name: a.name, type: "área estratégica", pi: a.p }),
  );
  A.forEach((a, i) => P[data.areas[i].p] && link(P[data.areas[i].p], a));

  const L = data.lines.map((l, i) =>
    add({
      id: `l${i}`,
      level: 4,
      src: "pdi",
      hemi: "planeacion",
      code: l.code,
      name: l.name.replace(/^[a-z]\.\s*/i, ""),
      type: "línea de acción",
      pi: data.areas[l.a]?.p,
    }),
  );
  L.forEach((l, i) => A[data.lines[i].a] && link(A[data.lines[i].a], l));

  const R = data.projects.map((r) =>
    add({ id: `r${nodes.length}`, level: 5, src: "pdi", hemi: "planeacion", code: r.code, name: r.name, type: "proyecto" }),
  );
  R.forEach((r, i) =>
    data.projects[i].to.forEach(([k, j]) => {
      const parent = k === "l" ? L[j] : A[j];
      if (parent) link(parent, r, "vincula");
    }),
  );

  const REP = data.reports.map((r) =>
    add({ id: `i${nodes.length}`, level: 3, src: "cifras", hemi: "planeacion", code: r.code, name: r.name, type: "informe" }),
  );
  REP.forEach((r) => link(hubsPlaneacion.cifras, r));

  const OBS = data.obs.map((t) =>
    add({ id: `o${nodes.length}`, level: 3, src: "obs", hemi: "planeacion", code: "", name: t, type: "tema" }),
  );
  OBS.forEach((t) => link(hubsPlaneacion.obs, t));

  const BOL = ["Boletín en línea", "Edición en PDF", "Edición en PDF"].map((t) =>
    add({ id: `b${nodes.length}`, level: 3, src: "bol", hemi: "planeacion", code: "", name: t, type: "boletín", ghost: true }),
  );
  BOL.forEach((b) => link(hubsPlaneacion.bol, b));

  const IMP = ["Programas", "Facultades", "Indicadores"].map((t) =>
    add({ id: `m${nodes.length}`, level: 3, src: "imp", hemi: "planeacion", code: "", name: t, type: "con sesión", ghost: true }),
  );
  IMP.forEach((m) => link(hubsPlaneacion.imp, m));

  const planNodeCount = nodes.filter((n) => n.hemi === "planeacion" && !n.ghost).length;

  // 2. HEMISFERIO DERECHO: Vicerrectoría de Enseñanza
  const hubsEnsenanza = {} as Record<SourceKey, Node>;
  for (const k of TEACH_SOURCE_ORDER) {
    hubsEnsenanza[k] = add({
      id: `fuente:${k}`,
      level: 1,
      src: k,
      hemi: "ensenanza",
      code: "",
      name: SOURCES[k].name,
      type: "fuente curricular",
    });
  }

  const teachData = {
    innovacion: data.teach?.innovacion ?? [
      "Modelo Pedagógico UDES",
      "Acompañamiento Docente",
      "Tecnologías Emergentes",
      "Aprendizaje Basado en Retos",
      "Aula Invertida y Flexibilidad",
    ],
    politicas: data.teach?.politicas ?? [
      "Lineamientos Curriculares",
      "Reglamento Estudiantil",
      "Resultados de Aprendizaje",
      "Inclusión y Diversidad",
      "Aseguramiento de Calidad",
    ],
    global: data.teach?.global ?? [
      "ODS 4: Educación de Calidad",
      "ODS 9: Innovación",
      "ODS 17: Alianzas",
      "Competencias UNESCO",
      "Acreditación Internacional",
    ],
    moodle: data.teach?.moodle ?? [
      "Campus Virtual UDES",
      "Banco de Recursos Digitales",
      "Cursos Maestros",
      "Foros de Aprendizaje",
      "Evaluación Formativa",
    ],
    guias: data.teach?.guias ?? [
      "Diseño de Sílabos",
      "Rúbricas Analíticas",
      "Trabajo Autónomo",
      "Apoyo Tutorial",
    ],
  };

  const teachNodesMap: Record<string, Node[]> = {};
  for (const [k, list] of Object.entries(teachData) as [SourceKey, string[]][]) {
    teachNodesMap[k] = list.map((title, i) =>
      add({
        id: `t_${k}_${i}`,
        level: 3,
        src: k,
        hemi: "ensenanza",
        code: `E-${k.slice(0, 3).toUpperCase()}${i + 1}`,
        name: title,
        type: k === "global" ? "ods/lineamiento" : k === "moodle" ? "curso/aula" : "directiva",
      }),
    );
    teachNodesMap[k].forEach((n) => link(hubsEnsenanza[k], n));
  }

  // 3. PUENTES NEURONALES (Interconexiones entre ambos hemisferios)
  const addBridge = (a: Node | undefined, b: Node | undefined, kind: NeuralBridge["kind"], why: string, refCode?: string) => {
    if (!a || !b) return;
    const bridge: NeuralBridge = {
      id: `br_${a.id}_${b.id}`,
      a,
      b,
      kind,
      why,
      refCode,
    };
    bridges.push(bridge);
    link(a, b, "puente");
  };

  // Puentes por Reglas (ODS y Normativa), Puentes por Temas y Lectura de Visita
  const pdiPr1 = R.find((r) => r.code === "PR1") ?? R[0];
  const pdiPr4 = R.find((r) => r.code === "PR4") ?? R[1] ?? R[0];
  const pdiP5 = P[4] ?? P[0];
  const pdiLa21 = L.find((l) => fold(l.name).includes("tecnologia en la ensenanza")) ?? L[0];
  const pdiLa23 = L.find((l) => fold(l.name).includes("resultados de aprendizaje")) ?? L[1] ?? L[0];

  addBridge(
    pdiPr1,
    teachNodesMap.politicas?.find((n) => fold(n.name).includes("resultados")) ?? teachNodesMap.politicas?.[2],
    "reglas",
    "El macroproyecto PR1 aterriza directamente en el aula mediante resultados de aprendizaje evaluables.",
    "PR1 ↔ RA",
  );

  addBridge(
    pdiLa21,
    teachNodesMap.global?.find((n) => fold(n.name).includes("ods 4")) ?? teachNodesMap.global?.[0],
    "reglas",
    "La incorporación de tecnologías educativas responde formalmente al ODS 4 (Educación de Calidad).",
    "ODS 4",
  );

  addBridge(
    pdiPr4,
    teachNodesMap.innovacion?.find((n) => fold(n.name).includes("retos")) ?? teachNodesMap.innovacion?.[3],
    "tema",
    "La Universidad Emprendedora se apoya en el modelo pedagógico de aprendizaje basado en retos.",
    "Emprendimiento",
  );

  addBridge(
    pdiLa23,
    teachNodesMap.guias?.find((n) => fold(n.name).includes("silabos")) ?? teachNodesMap.guias?.[0],
    "visita",
    "Lectura de visita: los resultados de aprendizaje del PDI se despliegan en la guía oficial de sílabos.",
    "Sílabos UDES",
  );

  addBridge(
    pdiP5,
    teachNodesMap.politicas?.find((n) => fold(n.name).includes("inclusion")) ?? teachNodesMap.politicas?.[3],
    "tema",
    "La política institucional de sostenibilidad y la de inclusión y diversidad comparten métricas comunes.",
    "Sostenibilidad",
  );

  const parentsOf = (n: Node) => edges.filter((e) => e.b === n && e.kind !== "puente").map((e) => e.a);
  const kidsOf = (n: Node) => edges.filter((e) => e.a === n && e.kind !== "puente").map((e) => e.b);

  // 4. TRAZADO ANATÓMICO CEREBRAL
  // Hemisferio Izquierdo (Planeación): arco de -Math.PI * 0.88 a -Math.PI * 0.12 (lado izquierdo)
  // Hemisferio Derecho (Enseñanza): arco de Math.PI * 0.12 a Math.PI * 0.88 (lado derecho)
  const leftLeaves: Node[] = [];
  for (const p of P) {
    const areasOf = kidsOf(p);
    if (!areasOf.length) leftLeaves.push(p);
    for (const a of areasOf) {
      const own = kidsOf(a).filter((n) => n.level === 4);
      if (own.length) leftLeaves.push(...own);
      else leftLeaves.push(a);
    }
  }

  const s0Left = Math.PI * 0.58;
  const s1Left = Math.PI * 1.42;
  leftLeaves.forEach((n, i) => (n.ang = s0Left + ((i + 0.5) / Math.max(1, leftLeaves.length)) * (s1Left - s0Left)));
  A.forEach((a) => {
    const k = kidsOf(a).filter((n) => n.level === 4);
    if (k.length) a.ang = k.reduce((acc, cur) => acc + cur.ang, 0) / k.length;
  });
  P.forEach((p) => {
    const k = kidsOf(p);
    if (k.length) p.ang = k.reduce((acc, cur) => acc + cur.ang, 0) / k.length;
  });
  hubsPlaneacion.pdi.ang = (s0Left + s1Left) / 2;
  R.forEach((r) => {
    const pr = parentsOf(r);
    r.ang = pr.length ? pr.reduce((acc, cur) => acc + cur.ang, 0) / pr.length : hubsPlaneacion.pdi.ang;
  });

  for (const [k, list] of [
    ["cifras", REP],
    ["obs", OBS],
    ["bol", BOL],
    ["imp", IMP],
  ] as [SourceKey, Node[]][]) {
    const span = Math.PI * 0.28;
    const base = Math.PI * 1.05;
    list.forEach((n, i) => (n.ang = base + ((i + 0.5) / Math.max(1, list.length)) * span));
    hubsPlaneacion[k].ang = base + span / 2;
  }

  // Trazado del Hemisferio Derecho (Enseñanza)
  const s0Right = -Math.PI * 0.42;
  const s1Right = Math.PI * 0.42;
  let tOffset = 0;
  for (const k of TEACH_SOURCE_ORDER) {
    const list = teachNodesMap[k] ?? [];
    const step = (s1Right - s0Right) / TEACH_SOURCE_ORDER.length;
    const a0 = s0Right + tOffset * step;
    const a1 = a0 + step;
    list.forEach((n, i) => (n.ang = a0 + ((i + 0.5) / Math.max(1, list.length)) * (a1 - a0)));
    hubsEnsenanza[k].ang = (a0 + a1) / 2;
    tOffset++;
  }

  // Nube de pasajes y posiciones base aleatorias orgánicas
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  nodes.forEach((n) => {
    const r = 0.22 + Math.sqrt(rnd()) * 0.78;
    const a = rnd() * Math.PI * 2;
    n.cx = Math.cos(a) * r;
    n.cy = Math.sin(a) * r;
    n.phase = rnd() * 6.28;
  });

  // El ejemplo conectado del plan
  const focus = [...R].sort((x, y) => parentsOf(y).length - parentsOf(x).length)[0] ?? null;
  const focusLineNodes = focus ? parentsOf(focus).filter((n) => n.level === 4) : [];
  const pillarOf = (n: Node): Node | undefined =>
    n.level === 2 ? n : parentsOf(n)[0] ? pillarOf(parentsOf(n)[0]) : undefined;
  const focusPillars = focus ? [...new Set(parentsOf(focus).map(pillarOf).filter(Boolean) as Node[])] : [];

  const words = focus
    ? fold(focus.name)
        .split(/[^a-z0-9ñ]+/)
        .filter((w) => w.length >= 5 && !STOP.has(w))
    : [];

  const matches = new Set(nodes.filter((n) => words.some((w) => fold(n.name).includes(w))));
  const activeBridges = new Set(bridges.filter((b) => matches.has(b.a) || (focus && b.a === focus)));

  const question = focus
    ? `¿Cómo se conecta el proyecto «${focus.name}» con la innovación curricular, los ODS y las directivas pedagógicas de la UDES?`
    : "¿Qué pilares y directivas componen el ecosistema de Mr. Pilo?";

  const answer = focus
    ? `«${focus.code} · ${focus.name}» se vincula con ${focusLineNodes.length} ${focusLineNodes.length === 1 ? "línea de acción" : "líneas de acción"} de ${focusPillars.length} ${focusPillars.length === 1 ? "pilar" : "pilares"}: ${focusPillars.map((p) => `${p.code} · ${p.name}`).join(", ")}. Conecta además mediante puentes neuronales con resultados de aprendizaje de Enseñanza y el ODS 4 [Educación de Calidad].`
    : `El Plan de Desarrollo tiene ${P.length} pilares: ${P.map((p) => `${p.code} · ${p.name}`).join(", ")}`;

  return {
    nodes,
    edges,
    bridges,
    counts: {
      nodes: planNodeCount,
      teachNodes: nodes.length - planNodeCount,
      totalNodes: nodes.length,
      edges: edges.length,
      bridges: bridges.length,
    },
    focus,
    focusLines: focusLineNodes.length,
    focusPillars,
    matches,
    activeBridges,
    question,
    answer,
    gemma: {
      model: "google/gemma-4-31b-it",
      params: "31 Mil Millones (31B)",
      provider: "NVIDIA NIM · Integración oficial",
      reasoning: "Síntesis cognitiva multi-hemisférica: conecta Planeación y Enseñanza sin alucinación factual.",
    },
  };
}

/* --- El lienzo neuronal ---------------------------------------------------------------------- */

const RING: Record<number, number> = { 1: 0.28, 2: 0.46, 3: 0.65, 4: 0.83, 5: 0.98 };
const SIZE: Record<number, number> = { 1: 7.2, 2: 5.6, 3: 3.8, 4: 2.4, 5: 4.8 };
const PILLAR_TINT = ["#c3a4ee", "#a88be0", "#d0b6f2", "#9b7ad6", "#b99ae8", "#e0cdf7"];

export const LAYERS = [
  { r: 0.1, name: "Catálogo", label: "Catálogo oficial", cost: "0 créditos" },
  { r: 0.138, name: "Reglas", label: "Reglas & Límites", cost: "0 créditos" },
  { r: 0.176, name: "Guardadas", label: "Respuestas guardadas", cost: "0 créditos" },
  { r: 0.214, name: "Puentes", label: "Puentes neuronales", cost: "Malla 0122" },
  { r: 0.255, name: "Gemma 4 31B", label: "Cortex Gemma 4 31B", cost: "NVIDIA Cloud" },
];

const CYAN = "#7fe7f0";
const GOLD = "#fbbf24";

/**
 * El fondo de la escena. La malla nació pintada para la noche de Pilo; sobre
 * blanco, cada color pasa por esta tabla a su versión para fondo claro. Lo
 * cambia la presentación (el botón «Fondo») y vale desde el cuadro siguiente.
 */
export const stageTheme = { light: true };

const LIGHT: Record<string, string> = {
  "#7fe7f0": "#0a7d8c", "#fbbf24": "#a56f00", "#b9c9e6": "#5b6d86", "#8196ba": "#62748c", "#7a52c7": "#6b3fa0",
  "#38bdf8": "#0b6aa8", "#9f84db": "#6b3fa0", "#6366f1": "#3d4bb8", "#ffffff": "#0a2d63", "#040d1f": "#ffffff",
  "#eef4ff": "#0d1c31", "#b592e6": "#6b3fa0", "#6fa4f5": "#1f5fbf", "#4fc2cf": "#0b7481", "#e58a5c": "#a4471f",
  "#7cc27d": "#2e6b2f", "#a78bfa": "#8a3b8f", "#f87171": "#ad2f58", "#34d399": "#1a6b5a", "#c3a4ee": "#7a4fb5",
  "#a88be0": "#5f3a99", "#d0b6f2": "#8d63c4", "#9b7ad6": "#553090", "#b99ae8": "#6f45ab", "#e0cdf7": "#9a74cc",
};

function rgba(hex: string, a: number) {
  if (stageTheme.light) {
    hex = LIGHT[hex.toLowerCase()] ?? hex;
    // Sobre blanco, los trazos tenues necesitan más peso que sobre la noche.
    if (a < 0.5) a = Math.min(0.5, a * 1.7);
  }
  const v = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${Math.max(0, Math.min(1, a))})`;
}

export type Face = "feliz" | "piensa" | "idea" | "bien";

export interface StageHandle {
  step: (i: number) => void;
  setFace?: (f: Face) => void;
  toggleSource: (k: SourceKey, on: boolean) => void;
  toggleBridges: (on: boolean) => void;
  setExplore: (on: boolean) => void;
  destroy: () => void;
}

export function createStage(
  canvas: HTMLCanvasElement,
  host: HTMLElement,
  tip: HTMLElement,
  model: Model,
  reduce: boolean,
): StageHandle {
  const ctx = canvas.getContext("2d")!;
  const S = {
    morph: 0,
    edges: 0,
    nodes: 1,
    dim: 0,
    rings: 0,
    ringHot: -1,
    match: 0,
    chain: 0,
    bridges: 0,
    gemma: 0,
    leftHemi: 1,
    rightHemi: 1,
    labels: 0,
    pulse: 0,
    face: "feliz" as Face,
  };

  const { nodes, edges, bridges } = model;
  const parentsOf = (n: Node) => edges.filter((e) => e.b === n && e.kind !== "puente").map((e) => e.a);
  const kidsOf = (n: Node) => edges.filter((e) => e.a === n && e.kind !== "puente").map((e) => e.b);

  const chainOf = (n: Node): [Set<Node>, Set<Edge>, Set<NeuralBridge>] => {
    const ns = new Set<Node>([n]);
    const es = new Set<Edge>();
    const bs = new Set<NeuralBridge>();

    const up = (x: Node) =>
      parentsOf(x).forEach((p) => {
        const e = edges.find((y) => y.a === p && y.b === x);
        if (e) es.add(e);
        if (!ns.has(p)) {
          ns.add(p);
          up(p);
        }
      });
    up(n);

    kidsOf(n).forEach((k) => {
      ns.add(k);
      const e = edges.find((y) => y.a === n && y.b === k);
      if (e) es.add(e);
    });

    bridges.forEach((b) => {
      if (ns.has(b.a) || ns.has(b.b)) {
        bs.add(b);
        ns.add(b.a);
        ns.add(b.b);
      }
    });

    return [ns, es, bs];
  };

  const [focusNodes, focusEdges, focusBridges] = model.focus ? chainOf(model.focus) : [new Set<Node>(), new Set<Edge>(), new Set<NeuralBridge>()];

  let hover: Node | null = null;
  let pinned: Node | null = null;
  let explore = false;
  let showBridges = true;
  let W = 0;
  let H = 0;
  let CX = 0;
  let CY = 0;
  let RAD = 0;
  let time = 0;

  // Carga de microexpresiones de Pilo
  const faces = {} as Record<Face, HTMLImageElement>;
  for (const f of ["feliz", "piensa", "idea", "bien"] as Face[]) {
    const im = new Image();
    im.src = `/pilo-moods/${f}-320.webp`;
    faces[f] = im;
  }

  const resize = () => {
    const r = host.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    W = r.width;
    H = r.height;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = W / 2;
    CY = H / 2;
    RAD = Math.min(W, H) * 0.38;
  };

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Posición de los dos hemisferios del cerebro
  const pos = (n: Node): [number, number] => {
    const t = S.morph;
    const ease = t * t * (3 - 2 * t);
    const rr = (RING[n.level] ?? 0.6) * RAD;

    // Desplazamiento inter-hemisférico cerebral:
    // Izquierda = Planeación, Derecha = Enseñanza
    const hemiShift = (n.hemi === "planeacion" ? -RAD * 0.36 : RAD * 0.36) * ease;
    const originX = CX + hemiShift;
    const originY = CY;

    const tx = originX + Math.cos(n.ang) * rr * (n.hemi === "planeacion" ? 0.95 : 0.92);
    const ty = originY + Math.sin(n.ang) * rr * 0.9;
    const bx = CX + n.cx * RAD * 1.05;
    const by = CY + n.cy * RAD * 1.05;

    const k = Math.min(1, Math.max(0, ease * 1.15 - (n.level - 1) * 0.04));
    return [bx + (tx - bx) * k, by + (ty - by) * k];
  };

  const colorOf = (n: Node) =>
    n.src === "pdi" && n.level >= 2 ? PILLAR_TINT[(n.pi ?? 0) % PILLAR_TINT.length] : SOURCES[n.src]?.color ?? CYAN;

  // Bucle de renderizado del lienzo (GSAP Ticker)
  const draw = () => {
    time += 1 / 60;
    ctx.clearRect(0, 0, W, H);

    const active = explore ? pinned || hover : null;
    const [actN, actE, actB] = active ? chainOf(active) : [null, null, null];
    const chainN = actN ?? (S.chain > 0 ? focusNodes : null);
    const chainE = actE ?? (S.chain > 0 ? focusEdges : null);
    const chainB = actB ?? (S.chain > 0 ? focusBridges : null);
    const dimAmount = actN ? 1 : S.dim;

    // 1. Silueta sutil de la corteza de los dos hemisferios cerebrales
    if (S.morph > 0.3) {
      const hemiEase = S.morph;
      const leftCenterX = CX - RAD * 0.36 * hemiEase;
      const rightCenterX = CX + RAD * 0.36 * hemiEase;

      ctx.save();
      // Hemisferio Izquierdo (Planeación)
      ctx.beginPath();
      ctx.ellipse(leftCenterX, CY, RAD * 0.62 * S.leftHemi, RAD * 0.76 * S.leftHemi, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba("#7a52c7", 0.07 * hemiEase);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Hemisferio Derecho (Enseñanza)
      ctx.beginPath();
      ctx.ellipse(rightCenterX, CY, RAD * 0.62 * S.rightHemi, RAD * 0.76 * S.rightHemi, 0, 0, Math.PI * 2);
      ctx.strokeStyle = rgba("#38bdf8", 0.07 * hemiEase);
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Rótulos sutiles de cada hemisferio
      if (S.labels > 0.2) {
        ctx.font = "800 10.5px 'Open Sans', sans-serif";
        ctx.fillStyle = rgba("#9f84db", 0.45 * S.labels * S.leftHemi);
        ctx.textAlign = "center";
        ctx.fillText("HEMISFERIO ESTRATÉGICO · PLANEACIÓN", leftCenterX, CY - RAD * 0.79);

        ctx.fillStyle = rgba("#38bdf8", 0.45 * S.labels * S.rightHemi);
        ctx.fillText("HEMISFERIO CURRICULAR · ENSEÑANZA", rightCenterX, CY - RAD * 0.79);
      }
      ctx.restore();
    }

    // 2. Anillos cognitivos concéntricos de Mr. Pilo
    if (S.rings > 0.01) {
      LAYERS.forEach((g, i) => {
        const hot = S.ringHot === i;
        const r = g.r * RAD * 2.15;
        const ringColor = i === 4 ? GOLD : CYAN;

        ctx.beginPath();
        ctx.arc(CX, CY, r, 0, Math.PI * 2);
        ctx.strokeStyle = hot ? rgba(ringColor, 0.9 * S.rings) : rgba("#b9c9e6", 0.12 * S.rings);
        ctx.lineWidth = hot ? 2.4 : 1;
        ctx.setLineDash(i >= 3 ? [4, 5] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = hot ? rgba(ringColor, S.rings) : rgba("#8196ba", 0.75 * S.rings);
        ctx.font = `700 ${hot ? 11 : 9.5}px 'Open Sans', sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillText(`${g.name.toUpperCase()} · ${g.cost}`, CX, CY - r - 6);
      });
    }

    // 3. Cortex Gemma 4 31B: Red neuronal profunda iluminada
    if (S.gemma > 0.05) {
      ctx.save();
      const gemmaAlpha = S.gemma;
      const gemmaRadius = RAD * 0.58;

      // Halo electromagnético pulsante de Gemma 4 31B
      const glowGrad = ctx.createRadialGradient(CX, CY, RAD * 0.14, CX, CY, gemmaRadius);
      glowGrad.addColorStop(0, rgba(CYAN, 0.15 * gemmaAlpha));
      glowGrad.addColorStop(0.6, rgba("#6366f1", 0.08 * gemmaAlpha));
      glowGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glowGrad;
      ctx.beginPath();
      ctx.arc(CX, CY, gemmaRadius, 0, Math.PI * 2);
      ctx.fill();

      // Filamentos sinápticos cuánticos entre ambos hemisferios
      const samplePlan = nodes.filter((n) => n.hemi === "planeacion" && n.level <= 4).slice(0, 14);
      const sampleTeach = nodes.filter((n) => n.hemi === "ensenanza" && n.level <= 3).slice(0, 14);

      for (let i = 0; i < samplePlan.length; i++) {
        const p1 = pos(samplePlan[i]);
        const p2 = pos(sampleTeach[i % sampleTeach.length]);
        const wave = reduce ? 0.5 : (Math.sin(time * 2.2 + i) + 1) / 2;

        ctx.beginPath();
        ctx.moveTo(p1[0], p1[1]);
        ctx.bezierCurveTo(CX - 20, CY - 40 + i * 6, CX + 20, CY + 40 - i * 6, p2[0], p2[1]);
        ctx.strokeStyle = rgba(i % 2 === 0 ? CYAN : GOLD, 0.22 * gemmaAlpha * (0.6 + wave * 0.4));
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Paquete de potencial de acción neuronal (partícula en tránsito)
        if (!reduce) {
          const pt = (time * 0.8 + i * 0.14) % 1;
          const px = (1 - pt) * (1 - pt) * p1[0] + 2 * (1 - pt) * pt * CX + pt * pt * p2[0];
          const py = (1 - pt) * (1 - pt) * p1[1] + 2 * (1 - pt) * pt * CY + pt * pt * p2[1];
          ctx.beginPath();
          ctx.arc(px, py, 2.2, 0, Math.PI * 2);
          ctx.fillStyle = rgba("#ffffff", 0.85 * gemmaAlpha);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 4. Conexiones intra-hemisferio
    if (S.edges > 0.01) {
      for (const e of edges) {
        if (e.kind === "puente" || e.a.hidden || e.b.hidden) continue;
        const [x1, y1] = pos(e.a);
        const [x2, y2] = pos(e.b);
        const lit = Boolean(chainE?.has(e));
        let a = (e.kind === "vincula" ? 0.22 : 0.16) * S.edges;
        if (!lit) a *= 1 - 0.85 * dimAmount;
        else a = Math.max(a, 0.92 * (actE ? 1 : S.chain));
        if (a < 0.01) continue;

        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;
        const pull = e.kind === "vincula" ? 1.12 : 0.9;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(CX + (mx - CX) * pull, CY + (my - CY) * pull, x2, y2);
        ctx.strokeStyle = lit ? rgba(CYAN, a) : rgba(colorOf(e.b), a);
        ctx.lineWidth = lit ? 1.8 : e.kind === "vincula" ? 1 : 0.75;
        ctx.stroke();
      }
    }

    // 5. Puentes Neuronales Inter-hemisféricos (Planeación ↔ Enseñanza)
    if (showBridges && (S.bridges > 0.01 || S.chain > 0.01)) {
      for (const br of bridges) {
        if (br.a.hidden || br.b.hidden) continue;
        const [x1, y1] = pos(br.a);
        const [x2, y2] = pos(br.b);
        const lit = Boolean(chainB?.has(br)) || S.bridges > 0.5;
        let a = (lit ? 0.9 : 0.25) * Math.max(S.bridges, S.chain);
        if (!lit) a *= 1 - 0.75 * dimAmount;
        if (a < 0.01) continue;

        // Curva sináptica transversal entre los dos hemisferios
        const curveOffset = (x1 > x2 ? -1 : 1) * 35;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.bezierCurveTo(x1 + curveOffset, y1 - 32, x2 - curveOffset, y2 - 32, x2, y2);
        ctx.strokeStyle = lit ? rgba(GOLD, a) : rgba(CYAN, a * 0.6);
        ctx.lineWidth = lit ? 2.4 : 1;
        ctx.setLineDash(br.kind === "visita" ? [3, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);

        // Impulso eléctrico bio-digital cruzando el puente inter-hemisférico
        if (!reduce && (lit || S.bridges > 0.4)) {
          const pt = (time * 0.95 + (br.id.charCodeAt(3) || 1) * 0.17) % 1;
          const cp1x = x1 + curveOffset;
          const cp1y = y1 - 32;
          const cp2x = x2 - curveOffset;
          const cp2y = y2 - 32;
          const u = 1 - pt;
          const px = u * u * u * x1 + 3 * u * u * pt * cp1x + 3 * u * pt * pt * cp2x + pt * pt * pt * x2;
          const py = u * u * u * y1 + 3 * u * u * pt * cp1y + 3 * u * pt * pt * cp2y + pt * pt * pt * y2;

          ctx.beginPath();
          ctx.arc(px, py, 2.6, 0, Math.PI * 2);
          ctx.fillStyle = rgba("#ffffff", Math.min(1, a * 1.2));
          ctx.shadowColor = GOLD;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Rótulo del puente cuando está encendido
        if (lit && S.labels > 0.3 && br.refCode) {
          const midX = (x1 + x2) / 2;
          const midY = (y1 + y2) / 2 - 28;
          ctx.font = "800 10px 'Open Sans', sans-serif";
          ctx.fillStyle = rgba(GOLD, a);
          ctx.textAlign = "center";
          ctx.fillText(`⚡ ${br.refCode}`, midX, midY);
        }
      }
    }

    // 5.b. Monitor de Telemetría Científica e Inferencia Neuronal (HUD)
    if (W > 500) {
      ctx.save();
      const hudY = H - 24;
      const attentionPct = Math.round(S.gemma * 94.6 + (reduce ? 0 : Math.sin(time * 3) * 2.2));
      const entropyVal = (0.08 * (1 - S.chain * 0.7) + (reduce ? 0 : Math.sin(time * 2) * 0.015)).toFixed(3);

      // Onda sinusoidal / Oscilograma de actividad sináptica
      ctx.beginPath();
      const waveWidth = Math.min(220, W * 0.28);
      const startX = W - waveWidth - 28;
      for (let wx = 0; wx < waveWidth; wx += 4) {
        const freq = S.gemma > 0.3 ? 0.12 : 0.05;
        const amp = S.gemma > 0.3 ? 5.5 : S.chain > 0.3 ? 3.5 : 1.8;
        const wy = hudY + (reduce ? 0 : Math.sin(wx * freq + time * 5) * amp);
        if (wx === 0) ctx.moveTo(startX + wx, wy);
        else ctx.lineTo(startX + wx, wy);
      }
      ctx.strokeStyle = rgba(S.gemma > 0.3 ? GOLD : CYAN, 0.45);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Indicadores científicos en tipografía monoespaciada
      ctx.font = "700 9.5px 'Fira Code', ui-monospace, SFMono-Regular, monospace";
      ctx.fillStyle = rgba("#8196ba", 0.7);
      ctx.textAlign = "left";
      ctx.fillText(`SYNAPSE FLUX · ${S.gemma > 0.3 ? "31B TENSORS ACTIVE" : "DUAL-STREAM DENSE"}`, startX, hudY - 10);

      const statusBadge = S.gemma > 0.4
        ? `GEMMA 4 31B: ATTENTION ${attentionPct}% · H(X): ${entropyVal}`
        : S.bridges > 0.3
        ? "ONTOLOGY BRIDGES: SYNCHRONIZED · CROSS-DOMAIN"
        : "COGNITIVE MESH: DUAL-STREAM AIED STANDBY";

      ctx.fillStyle = rgba(S.gemma > 0.4 ? GOLD : S.bridges > 0.3 ? CYAN : "#b9c9e6", 0.85);
      ctx.fillText(statusBadge, 28, hudY);
      ctx.restore();
    }

    // 6. Nodos somáticos (Neuronas y pasajes)
    for (const n of nodes) {
      if (n.hidden) continue;
      const [x, y] = pos(n);
      const breathe = reduce ? 0 : Math.sin(time * 1.4 + n.phase) * 0.35;
      let r = ((SIZE[n.level] ?? 3.5) + breathe) * (0.75 + S.morph * 0.25);
      let a = n.ghost ? 0.4 : 0.9;
      const lit = Boolean(chainN?.has(n));
      if (!lit) a *= 1 - 0.82 * dimAmount;

      const matched = model.matches.has(n) && S.match > 0;
      if (matched) {
        r += 2.8 * S.match;
        a = Math.max(a, S.match);
      }

      ctx.beginPath();
      ctx.arc(x, y, Math.max(0.8, r), 0, Math.PI * 2);
      if (n.ghost) {
        ctx.strokeStyle = rgba(colorOf(n), a);
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = lit || matched ? rgba(CYAN, a) : rgba(colorOf(n), a * S.nodes);
        ctx.fill();
      }

      // Anillo palpitante de activación de búsqueda
      if (matched && !reduce) {
        ctx.beginPath();
        ctx.arc(x, y, r + 5 + Math.sin(time * 4) * 2, 0, Math.PI * 2);
        ctx.strokeStyle = rgba(CYAN, 0.35 * S.match);
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }

    // 7. Rótulos inteligentes sin colisión
    const labelled = new Set<Node>();
    if (S.labels > 0.01) {
      for (const n of nodes) if (n.level <= 2) labelled.add(n);
    }
    if (chainN && (actN || S.chain > 0.5)) {
      chainN.forEach((n) => labelled.add(n));
    }

    const focusNode = active ?? (S.chain > 0.5 ? model.focus : null);
    const prio = (n: Node) =>
      n === focusNode ? 0 : n.level === 1 ? 1 : n.level === 2 ? 2 : n.level === 5 ? 3 : n.level === 3 ? 4 : 5;

    const placed: { x: number; y: number; w: number; h: number }[] = [];
    const fits = (x: number, y: number, w: number, h: number) =>
      x > 4 &&
      x + w < W - 4 &&
      y - h / 2 > 4 &&
      y + h / 2 < H - 4 &&
      !placed.some((q) => x < q.x + q.w && x + w > q.x && y - h / 2 < q.y + q.h / 2 && y + h / 2 > q.y - q.h / 2);

    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    for (const n of [...labelled].sort((m, k) => prio(m) - prio(k))) {
      if (n.hidden) continue;
      const [x, y] = pos(n);
      const isChain = Boolean(chainN?.has(n) && (actN || S.chain > 0.5));
      const a = isChain ? 1 : S.labels * (actN || S.dim > 0.5 ? 0.35 : 0.9);
      if (a < 0.02) continue;

      ctx.font = `${n.level <= 2 || n === focusNode ? 800 : 700} ${n.level === 1 ? 12 : 10.5}px 'Open Sans', sans-serif`;
      const full = n.code ? `${n.code} · ${n.name}` : n.name;
      const options = [full.length > 36 ? `${full.slice(0, 35)}…` : full];
      if (n.code && n !== focusNode) options.push(n.code);

      let done = false;
      for (const t of options) {
        const w = ctx.measureText(t).width;
        const prefer = Math.cos(n.ang) >= 0;
        for (const right of [prefer, !prefer]) {
          const lx = right ? x + 9 : x - 9 - w;
          if (!fits(lx, y, w, 15)) continue;
          placed.push({ x: lx - 3, y, w: w + 6, h: 15 });
          ctx.lineWidth = 4;
          ctx.strokeStyle = rgba("#040d1f", 0.9 * a);
          ctx.strokeText(t, lx, y);
          ctx.fillStyle = isChain
            ? rgba(n === focusNode ? CYAN : "#eef4ff", a)
            : rgba(n.level === 1 ? colorOf(n) : "#b9c9e6", a);
          ctx.fillText(t, lx, y);
          done = true;
          break;
        }
        if (done) break;
      }
    }

    // 8. Núcleo central de Mr. Pilo (Tronco consciente)
    const face = faces[S.face];
    const fr = Math.max(26, RAD * 0.11);
    ctx.beginPath();
    ctx.arc(CX, CY, fr + 6, 0, Math.PI * 2);
    ctx.fillStyle = rgba(CYAN, 0.08 + (reduce ? 0 : Math.sin(time * 1.2) * 0.03));
    ctx.fill();

    if (face?.complete && face.naturalWidth) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, fr, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(face, CX - fr, CY - fr, fr * 2, fr * 2);
      ctx.restore();
    }
  };

  gsap.ticker.add(draw);

  // Inspector y exploración interactiva
  const nearest = (mx: number, my: number) => {
    let best: Node | null = null;
    let bd = 16 * 16;
    for (const n of nodes) {
      if (n.hidden) continue;
      const [x, y] = pos(n);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  };

  const showTip = (n: Node | null, mx = 0, my = 0) => {
    if (!n) {
      tip.removeAttribute("data-on");
      return;
    }

    const route: string[] = [];
    const seen = new Set<Node>();
    let c: Node | undefined = n;
    while (c && !seen.has(c)) {
      seen.add(c);
      route.unshift(c.code || c.name);
      c = parentsOf(c)[0];
    }

    const k = kidsOf(n).length;
    const pr = parentsOf(n).length;
    const nodeBridges = bridges.filter((b) => b.a === n || b.b === n);

    tip.replaceChildren();
    const title = document.createElement("b");
    title.textContent = n.code ? `${n.code} · ${n.name}` : n.name;

    const metaRow = document.createElement("div");
    metaRow.className = "cpp-tip-meta";
    metaRow.innerHTML = `<span class="cpp-tip-chip">${n.hemi === "planeacion" ? "ESTRATÉGICO · PLANEACIÓN" : "CURRICULAR · ENSEÑANZA"}</span><span class="cpp-tip-chip">k=${(k + pr) || 1}</span>`;

    const kind = document.createElement("span");
    kind.textContent = `Ontología: ${n.type} · Fuente: ${SOURCES[n.src]?.name ?? n.src}`;

    const path = document.createElement("span");
    path.textContent = `Jerarquía ontológica: ${route.join(" › ")}`;

    tip.append(title, metaRow, kind, path);
    if (k) tip.append(Object.assign(document.createElement("span"), { textContent: `Sub-arborescencia: ${k} nodos descendentes` }));
    if (pr > 1) tip.append(Object.assign(document.createElement("span"), { textContent: `Co-dependencias: ${pr} nodos ascendentes` }));

    if (nodeBridges.length) {
      const brSpan = document.createElement("span");
      brSpan.style.color = "var(--cpp-amber)";
      brSpan.style.fontWeight = "700";
      brSpan.textContent = `⚡ Puente Ontológico Inter-dominio: ${nodeBridges[0].why}`;
      tip.append(brSpan);
    }

    tip.style.left = `${Math.min(W - 320, mx + 14)}px`;
    tip.style.top = `${Math.min(H - 160, my + 14)}px`;
    tip.dataset.on = "";
  };

  const onMove = (e: PointerEvent) => {
    if (!explore) return;
    const r = canvas.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    hover = nearest(mx, my);
    canvas.style.cursor = hover ? "pointer" : "default";
    showTip(hover, mx, my);
  };

  const onLeave = () => {
    hover = null;
    showTip(null);
  };

  const onClick = (e: MouseEvent) => {
    if (!explore) return;
    const r = canvas.getBoundingClientRect();
    const n = nearest(e.clientX - r.left, e.clientY - r.top);
    pinned = n && n !== pinned ? n : null;
  };

  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerleave", onLeave);
  canvas.addEventListener("click", onClick);

  // Timelines de los 9 pasos de la presentación
  let tl: gsap.core.Timeline | null = null;

  const STEPS: ((t: gsap.core.Timeline) => void)[] = [
    // 0. El cerebro dual de Pilo (dos memorias)
    (t) =>
      t
        .to(S, {
          morph: 1,
          edges: 0.9,
          nodes: 1,
          bridges: 0.35,
          dim: 0,
          rings: 0,
          match: 0,
          chain: 0,
          gemma: 0,
          labels: 0.8,
          duration: 1.2,
          ease: "power3.inOut",
        })
        .set(S, { face: "feliz" }, 0),

    // 1. Nuevas capacidades y acciones (Archivos, código, roles)
    (t) =>
      t
        .to(S, {
          morph: 1,
          edges: 0.65,
          bridges: 0.4,
          dim: 0.35,
          rings: 0.6,
          ringHot: -1,
          labels: 0.4,
          match: 0,
          chain: 0,
          gemma: 0,
          duration: 0.8,
          ease: "power3.out",
        })
        .set(S, { face: "bien" }, 0),

    // 2. Llega una pregunta (El impulso sensorial)
    (t) =>
      t
        .to(S, {
          morph: 1,
          edges: 0.5,
          dim: 0.65,
          rings: 0.9,
          ringHot: -1,
          labels: 0.3,
          match: 0,
          chain: 0,
          gemma: 0,
          duration: 0.7,
          ease: "power3.out",
        })
        .set(S, { face: "piensa" }, 0),

    // 3. Catálogo y reglas (Filtros de coste 0)
    (t) =>
      t
        .to(S, { morph: 1, edges: 0.4, dim: 0.7, rings: 1, labels: 0.3, duration: 0.3 })
        .set(S, { ringHot: 0 })
        .to({}, { duration: 0.55 })
        .set(S, { ringHot: 1 })
        .to({}, { duration: 0.55 })
        .set(S, { ringHot: -1 }),

    // 4. Respuestas guardadas y activación de pasajes
    (t) =>
      t
        .to(S, { edges: 0, labels: 0, dim: 0, rings: 0.35, chain: 0, duration: 0.5, ease: "power2.out" })
        .to(S, { morph: 0.2, duration: 1.2, ease: "power3.inOut" }, 0.1)
        .to(S, { match: 1, duration: 0.6, ease: "power2.out" }, 1.0)
        .set(S, { ringHot: 2, face: "piensa" }, 0),

    // 5. Los puentes neuronales (Interconexión inter-hemisférica)
    (t) =>
      t
        .to(S, { morph: 1, rings: 0.5, duration: 1.4, ease: "power3.inOut" })
        .to(S, { edges: 0.8, labels: 0.7, duration: 0.8, ease: "power2.out" }, 0.8)
        .to(S, { match: 0, dim: 0.75, duration: 0.5 }, 1.2)
        .to(S, { bridges: 1, chain: 0.85, duration: 0.7, ease: "power2.out" }, 1.3)
        .set(S, { ringHot: 3, face: "idea" }, 1.3),

    // 6. Cortex Gemma 4 31B (Red neuronal profunda de 31B parámetros)
    (t) =>
      t
        .to(S, {
          morph: 1,
          edges: 0.9,
          labels: 0.8,
          dim: 0.82,
          chain: 1,
          bridges: 1,
          rings: 0.9,
          gemma: 1,
          duration: 0.9,
          ease: "power3.out",
        })
        .set(S, { ringHot: 4, face: "idea" }, 0),

    // 7. La respuesta fundamentada (Síntesis multi-hemisferio verificada)
    (t) =>
      t
        .to(S, {
          morph: 1,
          edges: 0.85,
          labels: 0.9,
          dim: 0.8,
          chain: 1,
          bridges: 1,
          gemma: 0.65,
          rings: 0.45,
          match: 0,
          duration: 0.7,
        })
        .set(S, { ringHot: -1, face: "bien" }),

    // 8. Explorar el cerebro de Mr. Pilo
    (t) =>
      t
        .to(S, {
          morph: 1,
          edges: 1,
          labels: 1,
          dim: 0,
          chain: 0,
          bridges: 1,
          gemma: 0.3,
          rings: 0,
          match: 0,
          duration: 0.8,
          ease: "power3.out",
        })
        .set(S, { face: "feliz" }, 0),
  ];

  return {
    step(i) {
      tl?.progress(1).kill();
      pinned = null;
      hover = null;
      showTip(null);
      tl = gsap.timeline();
      STEPS[Math.max(0, Math.min(STEPS.length - 1, i))](tl);
      if (reduce) tl.progress(1);
    },
    setFace(f) {
      S.face = f;
    },
    toggleSource(k, on) {
      nodes.forEach((n) => {
        if (n.src === k) n.hidden = !on;
      });
    },
    toggleBridges(on) {
      showBridges = on;
    },
    setExplore(on) {
      explore = on;
      if (!on) {
        pinned = null;
        hover = null;
        showTip(null);
      }
    },
    destroy() {
      tl?.kill();
      gsap.ticker.remove(draw);
      ro.disconnect();
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("click", onClick);
    },
  };
}

export const STEP_COUNT = 9;
