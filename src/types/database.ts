/* =============================================================================
   Tipos de la base de datos.
   Escritos a mano para que coincidan con supabase/migrations. Cuando el
   esquema cambie, se pueden regenerar en vez de editarlos:

     supabase gen types typescript --project-id <ref> --schema public \
       > src/types/database.ts

   Mientras tanto, este archivo es el contrato: si una consulta pide una
   columna que no está aquí, TypeScript lo detiene antes de llegar al navegador.
   ========================================================================== */

export type AppRole = "consulta" | "responsable" | "planeacion" | "admin";
export type ActivityStatus = "cumplida" | "curso" | "pendiente" | "riesgo";
export type PublicationStatus = "borrador" | "revision" | "publicado" | "archivado";
export type ParameterCategory = "estado_proyecto" | "nivel_gestion" | "unidad" | "periodicidad";
export type ChangeType = "creacion" | "modificacion" | "reforma" | "eliminacion";
export type PillarIcon = "person" | "chip" | "spark" | "columns" | "leaf" | "community";
export type RepoKind = "github" | "udes";
/** Ciclo de vida de una propuesta de facultad. No dice si se publica: eso es
 *  `PublicationStatus`, y son dos preguntas distintas. */
export type ProposalStage = "formulada" | "avalada" | "ejecucion" | "cerrada";

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  unit: string | null;
  role: AppRole;
  /** Rol de acceso: manda sobre `role`, que la base sincroniza con su capacidad. */
  access_role_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** Pantallas de la intranet que un rol de acceso puede abrir. */
export type AdminScreen =
  | "office"
  | "documents"
  | "pillars"
  | "projects"
  | "faculties"
  | "campus"
  | "budget"
  | "repository"
  | "cifras"
  | "observatorio"
  | "tableros"
  | "impacto"
  | "structure"
  | "parameters"
  | "development"
  | "users"
  | "transfer"
  | "institution"
  | "pilo"
  | "pilo_ensenanza"
  | "reportes"
  | "correos"
  | "rutas"
  | "rankings"
  | "internacionalizacion";

/** Un rol de acceso: qué puede hacer, qué pantallas ve y sobre qué informes escribe. */
export interface AccessRole {
  id: string;
  key: string;
  name: string;
  description: string;
  base_role: AppRole;
  screens: AdminScreen[];
  all_screens: boolean;
  all_reports: boolean;
  is_system: boolean;
  position: number;
  created_at?: string;
  updated_at?: string;
}

export interface AccessRoleReport {
  access_role_id: string;
  report_slug: string;
}

export interface Parameter {
  id: string;
  category: ParameterCategory;
  label: string;
  description: string | null;
  position: number;
  is_active: boolean;
}

export interface ReportPeriod {
  id: string;
  label: string;
  cutoff_date: string;
  is_current: boolean;
  published_at: string | null;
}

export interface Pillar {
  id: string;
  slug: string;
  numeral: string;
  name: string;
  description: string;
  focus: string;
  insight: string | null;
  icon: PillarIcon;
  accent_slot: number;
  impulsor: string;
  contributes: string;
  management_owner: string;
  calculation_owner: string;
  status: PublicationStatus;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PillarProgress {
  pillar_id: string;
  slug: string;
  /** Conteo de indicadores por estado. */
  done: number;
  active: number;
  pending: number;
  risk: number;
  total: number;
  /** Avance en cascada desde las áreas del pilar. */
  progress: number;
  /** Proporción de indicadores cumplidos. Responde a otra pregunta. */
  completion_rate: number;
  area_count: number;
  line_count: number;
  project_count: number;
}

export interface PdiSummary {
  done: number;
  active: number;
  pending: number;
  risk: number;
  total: number;
  /** Promedio del avance de los pilares. */
  progress: number;
  on_track: number;
  need_attention: number;
  pillar_count: number;
  /** Proporción de indicadores cumplidos sobre el total. */
  completion_rate: number;
}

export interface StrategicArea extends TargetFields {
  id: string;
  pillar_id: string;
  code: string | null;
  name: string;
  description: string;
  position: number;
}

export interface ActionLine extends TargetFields {
  id: string;
  area_id: string;
  code: string | null;
  name: string;
  progress: number;
  position: number;
}

/** Vista v_action_lines: la línea con su área y su pilar ya resueltos.
 *  `progress` viene en cascada desde sus piezas —sus proyectos y los
 *  indicadores que cuelgan de ella sin proyecto—; `reported_progress` es el
 *  número escrito a mano, que solo se usa mientras no tenga ninguna. */
export interface ActionLineWithArea extends Omit<ActionLine, "area_id">, TargetFields {
  area_id: string;
  area_name: string;
  area_code: string | null;
  pillar_id: string;
  reported_progress: number;
  project_count: number;
  activity_count: number;
  activity_done: number;
  /** Cuántas piezas promedia: proyectos + indicadores sueltos. */
  source_count: number;
  /** Indicadores que entran en el promedio por su cuenta, sin proyecto. */
  loose_activity_count: number;
  is_derived: boolean;
}

/** Los cinco niveles de la cascada, para leer el avance por año. */
export type ProgressScope = "pillar" | "area" | "line" | "project" | "activity";

/** Vista v_year_progress: una fila por entidad y año con algo reportado.
 *  Los años sin dato no existen: un cero por falta de reporte engaña. */
export interface YearProgress {
  scope: ProgressScope;
  entity_id: string;
  pillar_id: string;
  year: number;
  progress: number;
}

/** Meta y avance en valor absoluto. Nulos mientras no se capturen. */
export interface TargetFields {
  target_value: number | null;
  achieved_value: number | null;
  measure_unit: string | null;
}

/** Vista v_area_progress. */
export interface AreaProgress extends TargetFields {
  area_id: string;
  pillar_id: string;
  area_code: string | null;
  area_name: string;
  progress: number;
  line_count: number;
  project_count: number;
  activity_count: number;
  activity_done: number;
}

/** Vista v_project_progress. */
export interface ProjectProgress extends TargetFields {
  project_id: string;
  /** El pilar dueño: desde el que se administra el proyecto. */
  pillar_id: string;
  /** Todos los pilares en los que el proyecto entra. Un proyecto compartido
   *  trae sus cifras a cada uno de ellos, no solo al dueño. */
  pillar_ids: string[];
  action_line_id: string | null;
  name: string;
  reported_progress: number;
  progress: number;
  activity_count: number;
  activity_done: number;
  is_derived: boolean;
}

export interface Indicator {
  id: string;
  pillar_id: string;
  code: string;
  name: string;
  status_label: string;
  level_id: string | null;
  unit_id: string | null;
  periodicity_id: string | null;
  considerations: string;
  /* --- Campos que ya no se publican ---------------------------------------
     Las tres cifras de recursos y tiempo del indicador se escribían a mano y
     nadie las mantenía: el presupuesto no se conciliaba con nada, el plazo
     ("18 meses") envejecía solo y las tareas críticas no tenían detrás ningún
     dato que las alimentara.

     Ahora el presupuesto lo suman los proyectos (`projects.total_value`), el
     tiempo lo calcula `planElapsed()` contra el horizonte del plan y las
     tareas críticas se retiraron de la interfaz. Las columnas siguen en la
     base —borrarlas perdería lo capturado y no lo pide nadie— pero ninguna
     pantalla las lee. No las uses en código nuevo.
     -------------------------------------------------------------------- */
  /** @deprecated Sin uso en la interfaz. Ver `estimatedBudget()`. */
  budget_amount: number | null;
  /** @deprecated Sin uso en la interfaz. */
  budget_progress: number;
  /** @deprecated Sin uso en la interfaz. Ver `planElapsed()`. */
  elapsed_label: string | null;
  /** @deprecated Sin uso en la interfaz. Ver `planElapsed()`. */
  elapsed_progress: number;
  /** @deprecated Retirado de los tableros de implementación. */
  critical_tasks: number;
  is_primary: boolean;
  position: number;
}

/** Vista v_indicators: añade las etiquetas de los catálogos. */
export interface IndicatorWithLabels extends Indicator {
  level_label: string | null;
  unit_label: string | null;
  periodicity_label: string | null;
}

/** Un impacto declarado del proyecto. Viaja como JSON dentro de la fila. */
export interface ProjectImpact {
  /** Tipo de impacto: académico, social, ambiental… */
  kind: string;
  /** Plazo en el que se espera: corto, mediano, largo. */
  term: string;
  justification: string;
}

/** A qué pilar, área y línea apunta un proyecto. Puede haber varios. */
export interface ProjectLink {
  id: string;
  project_id: string;
  pillar_id: string;
  area_id: string | null;
  action_line_id: string | null;
  /** El vínculo que manda en `projects.pillar_id`: desde ahí se administra. */
  is_primary: boolean;
  position: number;
}

export interface Project extends TargetFields {
  id: string;
  /** Pilar dueño: el del vínculo principal. Decide quién puede editarlo. */
  pillar_id: string;
  action_line_id: string | null;
  indicator_id: string | null;
  name: string;
  owner: string;
  description: string;
  detail: string;
  due_date: string | null;
  progress: number;
  status: ActivityStatus;
  state_id: string | null;
  document_id: string | null;
  position: number;

  /* --- Formulación (módulo de proyectos) --------------------------------- */
  start_date: string | null;
  end_date: string | null;
  /** Programas o unidades académicas responsables. */
  academic_units: string[] | null;
  /** Números de los ODS a los que aporta (1-17). */
  sdg_goals: number[] | null;
  impacts: ProjectImpact[];
  /** Ruta dentro del bucket "proyectos" de Storage; el archivo no está en la base. */
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_size: number | null;
}

/**
 * El proyecto con sus vínculos ya resueltos, como lo piden las fichas.
 *
 * Sin cifras de dinero, a propósito: es lo que devuelve `v_projects`, la vista
 * que leen las páginas públicas. El presupuesto no se publica, y la forma más
 * segura de garantizarlo es que el tipo con el que se dibuja lo público ni
 * siquiera lo tenga —así el compilador avisa antes de que llegue a una
 * pantalla—. Para la intranet está `ProjectAdminRow`.
 */
export interface ProjectWithLinks extends Project {
  links: ProjectLink[];
  /** Los pilares a los que apunta, para filtrar sin recorrer `links`. Lo
   *  calcula `v_projects`; para los proyectos anteriores al módulo de vínculos
   *  la vista devuelve su `pillar_id` de siempre, así que nunca llega vacío. */
  pillar_ids: string[];
}

/**
 * El mismo proyecto tal y como lo ve la intranet: con lo que costó formularlo.
 *
 * Viene de `v_projects_admin`, que la migración 0015 deja fuera del alcance de
 * `anon` y filtra además por rol dentro de la propia vista.
 */
export interface ProjectAdminRow extends ProjectWithLinks {
  /** Valor declarado al formular el proyecto. Es la formulación, no el
   *  presupuesto vigente: eso lo dicen los reportes anuales. */
  total_value: number | null;
}

/* --- Presupuesto -------------------------------------------------------------
   Nada de esto sale a las páginas públicas. Los tipos viven aquí junto al resto
   del esquema, pero solo los consume el módulo de presupuesto de la intranet.
   -------------------------------------------------------------------------- */

/** Un año de presupuesto de un proyecto. Nulo no es cero: es "sin reportar". */
export interface ProjectBudgetReport {
  id: string;
  project_id: string;
  year: number;
  projected: number | null;
  executed: number | null;
  note: string;
}

/** Vista `v_project_budget`: el presupuesto de un proyecto ya sumado. */
export interface ProjectBudget {
  project_id: string;
  pillar_id: string;
  name: string;
  /** `projects.total_value`: lo que costó formularlo. */
  formulated: number | null;
  projected: number;
  executed: number;
  reported_years: number;
  first_year: number | null;
  last_year: number | null;
  /** Ejecutado sobre proyectado. Nulo si no hay nada proyectado todavía. */
  execution_rate: number | null;
}

/** Vista `v_pillar_budget`: el mismo resumen, por pilar. */
export interface PillarBudget {
  pillar_id: string;
  slug: string;
  name: string;
  project_count: number;
  formulated: number;
  projected: number;
  executed: number;
  execution_rate: number | null;
}

/** Indicador de resultado. La tabla se sigue llamando `activities` por
 *  compatibilidad; en la interfaz es "indicador de resultado". */
export interface Activity {
  id: string;
  pillar_id: string;
  project_id: string | null;
  action_line_id: string | null;
  title: string;
  owner: string;
  due_date: string | null;
  /** Cumplimiento del año más reciente cuando hay serie anual; escrito a mano
   *  mientras no la haya. Es la raíz de la cascada del tablero. */
  progress: number;
  status: ActivityStatus;
  is_featured: boolean;
  position: number;
  /** Unidad de medida, del catálogo global (categoría "unidad"). */
  unit_id: string | null;
  /** Año y valor de la línea base: "Base 2023 · 28 convenios". */
  baseline_year: number | null;
  baseline_value: number | null;
}

/** Una fila de la serie anual: lo comprometido, lo logrado y su relación. */
export interface ActivityTarget {
  id: string;
  activity_id: string;
  year: number;
  target_value: number | null;
  result_value: number | null;
  /** Cumplimiento decidido a mano, para indicadores que no se miden dividiendo. */
  compliance_override: number | null;
  /** Columna generada: el override si lo hay, si no resultado / meta. */
  compliance: number | null;
  note: string;
}

/** El indicador con su unidad resuelta y su serie anual, como lo piden las
 *  tablas de resultados. */
export interface ActivityWithTargets extends Activity {
  unit: { label: string } | null;
  targets: ActivityTarget[];
}

/** Lectura cualitativa del avance de los indicadores de un pilar. */
export interface PillarObservation {
  id: string;
  pillar_id: string;
  /** Nulo = observación vigente, sin anclar a un corte anual. */
  year: number | null;
  title: string;
  body: string;
  author: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningItem {
  id: string;
  pillar_id: string;
  text: string;
  position: number;
}

export interface PdiDocument {
  id: string;
  pillar_id: string | null;
  area_id: string | null;
  action_line_id: string | null;
  title: string;
  description: string;
  kind: string;
  url: string;
  size_label: string | null;
  is_public: boolean;
  published_at: string | null;
  position: number;
}

export interface ChangeLogEntry {
  id: string;
  pillar_id: string;
  indicator_id: string | null;
  /** A qué objeto se refiere el cambio. Nulo si se registró a mano sobre el pilar. */
  project_id: string | null;
  activity_id: string | null;
  area_code: string;
  version: string;
  approved_by: string;
  changed_on: string;
  description: string;
  change_type: ChangeType;
  document_id: string | null;
}

/** Vista v_change_log: la entrada con el objeto al que apunta ya resuelto. */
export interface ChangeLogWithTarget extends ChangeLogEntry {
  project_name: string | null;
  activity_title: string | null;
  indicator_code: string | null;
}

export interface GlossaryTerm {
  id: string;
  pillar_id: string | null;
  term: string;
  definition: string;
  description: string;
  source: string | null;
  position: number;
}

/** Autor de un desarrollo. Vive dentro del proyecto, no en su propia tabla. */
export interface WebProjectAuthor {
  full_name: string;
  role?: string;
}

export interface WebProject {
  id: string;
  name: string;
  description: string;
  public_url: string | null;
  repo_kind: RepoKind;
  repo_url: string | null;
  authors: WebProjectAuthor[];
  status: PublicationStatus;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface PillarOwner {
  pillar_id: string;
  profile_id: string;
}

/* --- PDI por facultad ---------------------------------------------------------
   El plan de acción de cada facultad, tal y como lo sirve su aplicación de
   origen. La forma es un calco de la del origen —Facultad › Dimensión › Acción
   › Actividad— y lo único que el portal añade es el enganche: a qué pilar del
   PDI corresponde el texto que la facultad escribió.

   Dos tipos por acción, igual que con los proyectos y por el mismo motivo: lo
   público y lo interno no son la misma fila. `FacultyAction` es lo que sirve
   `v_faculty_actions` y no tiene forma de traer la nota de revisión —el
   compilador avisa antes de que llegue a una pantalla—; para la intranet está
   `FacultyActionAdminRow`.
   -------------------------------------------------------------------------- */

export interface Faculty {
  id: string;
  slug: string;
  /** Código con el que la facultad se identifica en el origen: FCS, FCMS… */
  code: string;
  name: string;
  dean: string;
  description: string;
  status: PublicationStatus;
  position: number;
  /** "fase1" (formulación) o "fase2" (con seguimiento), según el origen. */
  phase: string;
  period: string;
  plan_date: string | null;
  synced_at: string | null;
  source_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Cuántas acciones publicadas aporta una facultad a un pilar. Viaja dentro de
 *  la fila de `v_faculties` para que la tarjeta no recorra la lista entera. */
export interface FacultyPillarCount {
  pillar_id: string;
  numeral: string;
  accent: number;
  count: number;
}

/** Vista `v_faculties`: la facultad con el recuento de lo que tiene publicado. */
export interface FacultySummary {
  faculty_id: string;
  slug: string;
  code: string;
  name: string;
  dean: string;
  description: string;
  phase: string;
  period: string;
  plan_date: string | null;
  position: number;
  action_count: number;
  pillar_count: number;
  dimension_count: number;
  activity_count: number;
  /** Promedio de lo reportado. Nulo mientras no haya ningún corte con avance:
   *  promediar las acciones sin medir como cero diría que van mal. */
  reported_progress: number | null;
  reported_count: number;
  pillar_counts: FacultyPillarCount[];
}

/** Vista `v_faculty_pillar_matrix`: una fila por facultad y pilar, ceros
 *  incluidos. Las casillas vacías son el dato que la página quiere enseñar. */
export interface FacultyPillarCell {
  faculty_id: string;
  faculty_slug: string;
  faculty_code: string;
  faculty_name: string;
  faculty_position: number;
  pillar_id: string;
  pillar_numeral: string;
  pillar_name: string;
  pillar_accent: number;
  pillar_position: number;
  actions: number;
}

/** Lo concreto que la facultad se compromete a hacer dentro de una acción. */
export interface FacultyActivity {
  id: string;
  action_id: string;
  source_id: string;
  description: string;
  owner: string;
  due_date: string | null;
  /** El texto original de la fecha: muchas dicen "Por definir". */
  due_label: string;
  status_label: string;
  evidence_url: string;
  position: number;
}

/** Estado de la acción según la facultad. */
export type FacultyActionStatus = "pendiente" | "proceso" | "completado";

/** Vista `v_faculty_actions`: la acción publicada con su pilar resuelto, sus
 *  actividades y el último corte reportado. */
export interface FacultyAction {
  id: string;
  faculty_id: string;
  /** El identificador que le puso el origen: "d1_2". */
  source_id: string;
  dimension: string;
  dimension_name: string;
  /** El pilar en las palabras de la facultad, antes de resolverlo. */
  declared_pillar: string;
  pillar_id: string | null;
  area_id: string | null;
  action_line_id: string | null;
  title: string;
  owner: string;
  /** La meta, que en el origen trae también el indicador, en el mismo campo. */
  goal: string;
  resources: string;
  deadline: string | null;
  deadline_label: string;
  initial_status: FacultyActionStatus;
  budget_ordinary: boolean;
  budget_improvement: boolean;
  published_at: string | null;
  position: number;

  faculty_slug: string;
  faculty_code: string;
  faculty_name: string;
  pillar_slug: string | null;
  pillar_numeral: string | null;
  pillar_name: string | null;
  pillar_accent: number | null;
  area_code: string | null;
  area_name: string | null;
  line_code: string | null;
  line_name: string | null;

  activities: FacultyActivity[];
  /** El último corte reportado. Nulos mientras la facultad no reporte. */
  last_cut: string | null;
  last_progress: number | null;
  last_status: string | null;
  last_reported_on: string | null;
}

/** Vista `v_faculty_actions_admin`: lo mismo más la nota de revisión y el
 *  estado de publicación. Fuera del alcance de `anon`. */
export interface FacultyActionAdminRow
  extends Omit<FacultyAction, "activities" | "last_cut" | "last_status" | "last_reported_on"> {
  status: PublicationStatus;
  faculty_status: PublicationStatus;
  note: string;
  activity_count: number;
  created_at: string;
  updated_at: string;
}

/** El avance reportado de una acción en un corte. */
export interface FacultyFollowup {
  id: string;
  action_id: string;
  cut: string;
  reported_on: string | null;
  progress: number | null;
  status_label: string;
  note: string;
  evidence_url: string;
}

/* --- Normalizar la estructura -------------------------------------------------
   La 0017 trajo la estructura real del plan junto a la de ejemplo que ya
   estaba, y quedaron las dos. Estos dos tipos son lo que la intranet necesita
   para resolverlo: qué parece duplicado y qué quedó suelto.
   -------------------------------------------------------------------------- */

/** Una pareja de `v_structure_duplicates`: dos filas que parecen la misma cosa. */
export interface StructureDuplicate {
  kind: "area" | "line";
  pillar_id: string;
  /** La que conviene conservar: la del código de la estructura real. */
  keep_id: string;
  keep_code: string | null;
  keep_name: string;
  drop_id: string;
  drop_code: string | null;
  drop_name: string;
  /** Cuántas filas movería la fusión. */
  moves: number;
  /** Nombres iguales tras normalizar. Falso = emparejada por parecido, y hay
   *  que mirarla dos veces antes de confirmar. */
  is_exact: boolean;
}

/** Una fila de `v_structure_orphans`: sin código real y sin pareja. */
export interface StructureOrphan {
  kind: "area" | "line";
  id: string;
  pillar_id: string;
  pillar_numeral: string;
  pillar_name: string;
  code: string | null;
  name: string;
  dependents: number;
}

/** Lo que devuelve `normalize_structure`: una fila por fusión aplicada. */
export interface NormalizeResult {
  kind: "area" | "line";
  keep_code: string | null;
  drop_code: string | null;
  moved: number;
}

/* --- Inserciones y actualizaciones ---------------------------------------- */

type Writable<T> = Partial<Omit<T, "id" | "created_at" | "updated_at">>;

export type PillarInput = Writable<Pillar>;
export type AreaInput = Writable<StrategicArea>;
export type ActionLineInput = Writable<ActionLine>;
export type IndicatorInput = Writable<Indicator>;
export type ProjectInput = Writable<Project>;
export type ProjectLinkInput = Writable<ProjectLink>;
export type ActivityInput = Writable<Activity>;
export type ActivityTargetInput = Writable<Omit<ActivityTarget, "compliance">>;
export type PillarObservationInput = Writable<PillarObservation>;
export type BudgetReportInput = Writable<ProjectBudgetReport>;
export type DocumentInput = Writable<PdiDocument>;
export type ChangeLogInput = Writable<ChangeLogEntry>;
export type GlossaryInput = Writable<GlossaryTerm>;
export type ParameterInput = Writable<Parameter>;
export type PlanningItemInput = Writable<PlanningItem>;
export type WebProjectInput = Writable<WebProject>;
export type FacultyInput = Writable<Faculty>;

/**
 * Lo que la intranet puede escribir de una acción.
 *
 * Deliberadamente corto: el texto de la acción, su meta y sus fechas los manda
 * el origen y la siguiente sincronización los reescribiría. Desde aquí solo se
 * decide lo que el origen no sabe —a qué línea del plan se ancla, si se
 * publica y qué se anotó al revisarla—, que es justo lo que la sincronización
 * no toca.
 */
export type FacultyActionInput = Partial<
  Pick<
    FacultyActionAdminRow,
    "action_line_id" | "area_id" | "pillar_id" | "status" | "note" | "position"
  >
>;

/* =============================================================================
   PDI por campus (migración 0017)

   Lo que cada sede reportó en una vigencia, traducido a una línea de acción del
   plan. Las cifras monetarias no viajan en las vistas públicas: llegan nulas y
   `is_monetary` dice por qué, para que la pantalla lo explique en vez de pintar
   un hueco.
   ========================================================================== */

export type CampusRecordKind = "meta" | "logro";
export type CampusState = "superada" | "cumplida" | "parcial" | "no_cumplida" | "sin_meta";
export type MappingConfidence = "alta" | "media" | "baja";

export interface Campus {
  id: string;
  slug: string;
  code: string;
  name: string;
  report_kind: string;
  report_structure: string;
  /**
   * Falso cuando el informe de la sede no trae metas programadas. De este campo
   * depende todo el módulo: con `false`, el cumplimiento no es calculable y no
   * puede mostrarse como cero.
   */
  declares_targets: boolean;
  owner: string;
  description: string;
  status: PublicationStatus;
  position: number;
}

export interface CampusReportBatch {
  id: string;
  campus_id: string;
  year: number;
  file_name: string;
  source_document: string;
  note: string;
  fact_count: number;
  indicator_count: number;
  status: PublicationStatus;
  uploaded_at: string;
  uploaded_by: string | null;
}

/** Vista `v_campus_facts`: un hecho publicado con su cadena de alineación. */
export interface CampusFact {
  id: string;
  campus_id: string;
  year: number;
  pillar_id: string | null;
  area_id: string | null;
  action_line_id: string;
  objective: string;
  action: string;
  unit: string;
  /** Nulo si `is_monetary`: las cifras financieras no se publican. */
  target_value: number | null;
  actual_value: number | null;
  compliance: number | null;
  is_monetary: boolean;
  record_kind: CampusRecordKind;
  state: CampusState;
  confidence: MappingConfidence;
  note: string;
  evidence: string;
  source_document: string;
  source_page: number | null;
  reported_pillar: string;
  position: number;
  campus_slug: string;
  campus_code: string;
  campus_name: string;
  pillar_slug: string | null;
  pillar_numeral: string | null;
  pillar_name: string | null;
  pillar_accent: number | null;
  area_code: string | null;
  area_name: string | null;
  line_code: string | null;
  line_name: string | null;
}

/** Vista `v_campus_indicators`: la serie de dos años que reporta la sede. */
export interface CampusIndicator {
  id: string;
  campus_id: string;
  pillar_id: string | null;
  area_id: string | null;
  action_line_id: string;
  name: string;
  unit: string;
  base_year: number;
  base_value: number | null;
  last_year: number;
  last_value: number | null;
  /** Recalculada, no la que trae el informe. Nula si la base es cero. */
  variation: number | null;
  is_monetary: boolean;
  evidence: string;
  source_document: string;
  confidence: MappingConfidence;
  position: number;
  campus_slug: string;
  campus_name: string;
  pillar_slug: string | null;
  pillar_numeral: string | null;
  pillar_name: string | null;
  pillar_accent: number | null;
  line_code: string | null;
  line_name: string | null;
}

/** Vista `v_campus_pillar`: la casilla de la matriz sede × pilar. */
export interface CampusPillarCell {
  campus_id: string;
  campus_slug: string;
  campus_name: string;
  declares_targets: boolean;
  pillar_id: string;
  pillar_slug: string;
  pillar_numeral: string;
  pillar_name: string;
  pillar_accent: number;
  pillar_position: number;
  year: number | null;
  records: number;
  targets: number;
  achievements: number;
  exceeded: number;
  met: number;
  partial: number;
  unmet: number;
  /** Nulo cuando la sede no declara metas. Nunca es cero por esa razón. */
  compliance_avg: number | null;
  lines_covered: number;
  lines_total: number;
}

/** Vista `v_campus_summary`: una fila por sede y vigencia publicada. */
export interface CampusSummary {
  campus_id: string;
  campus_slug: string;
  campus_code: string;
  campus_name: string;
  report_kind: string;
  report_structure: string;
  declares_targets: boolean;
  owner: string;
  position: number;
  year: number | null;
  source_document: string | null;
  records: number;
  targets: number;
  achievements: number;
  exceeded: number;
  met: number;
  partial: number;
  unmet: number;
  /** Cuántas filas llevan un anclaje inferido y no explícito en el informe. */
  inferred: number;
  compliance_avg: number | null;
  pillars_covered: number;
  lines_covered: number;
  lines_total: number;
  indicators: number;
}

/** Vista `v_campus_line_coverage`: las 62 líneas, se reporten o no. */
export interface CampusLineCoverage {
  pillar_id: string;
  pillar_slug: string;
  pillar_numeral: string;
  pillar_name: string;
  pillar_accent: number;
  pillar_position: number;
  area_id: string;
  area_code: string;
  area_name: string;
  area_position: number;
  line_id: string;
  line_code: string;
  line_name: string;
  line_position: number;
  records: number;
  campuses_reporting: number;
  /** { "cucuta": 3, "valledupar": 1 } — solo las sedes que reportaron. */
  by_campus: Record<string, number>;
}

/* =============================================================================
   UDES en Cifras (0019_udes_en_cifras.sql)
   ========================================================================== */

export type OdValueFormat = "entero" | "porcentaje" | "decimal";
export type OdDirection = "sube" | "baja" | "neutro";
export type OdAggregation = "suma" | "reportado";
/** Periodo académico del año. "anual" solo con regla anual "reportado". */
export type OdTerm = "A" | "B" | "anual";
/** Cómo sale la cifra del año a partir de los periodos A y B. */
export type OdAnnualRule = "suma" | "ultimo" | "promedio" | "reportado";
/** Por departamento: "origen" y "cobertura". Mundial (código ISO alfa-3): "entrante", "saliente" y "convenios". */
export type OdMapMode = "origen" | "cobertura" | "entrante" | "saliente" | "convenios" | "municipio";
/** "anual": una cifra por año. "global": una sola cifra sin año (year = 0). */
export type OdMapReporting = "anual" | "global";
export type OdMapLayout = "combinado" | "lado_a_lado";
/** Qué se captura en cada etapa de una tubería. */
export type OdPipelineMeasure = "estudiantes" | "permanencia" | "desercion";
export type OdChartKind = "circular" | "barras" | "lineas" | "composicion";
export type OdBlockKind =
  | "kpis"
  | "evolucion"
  | "mapa"
  | "tuberia"
  | "mapa_calor"
  | "desgloses"
  | "tabla_dinamica"
  | "metodologia"
  | "historico"
  | "tabla"
  /** Título de sección: agrupa los bloques que le siguen hasta el próximo separador. */
  | "separador"
  /** Rankings universitarios del informe, con su selector de vista (0030). */
  | "rankings"
  /** Resultados Saber PRO del informe, por competencia (0031). */
  | "saber_pro"
  /** Conjunto libre: una de sus vistas (settings.view) o todas (0033). */
  | "libre"
  /** Motor Beta: Saber 11 → Saber TyT en rango percentil (0035). */
  | "saber_tyt"
  /** Tablero propio de Diversidad, Equidad e Inclusión (0042). */
  | "diversidad"
  /** Medallero: lo que gana la universidad cuando compite (0056). */
  | "medallero"
  /** Bloque de tablas personalizadas: las que elige (settings.tablas) o las que nadie eligió (0134). */
  | "tablas_personalizadas"
  /** Modelo estadístico del informe (0046). */
  | "modelo"
  /** Grid de fotografías a dos columnas, en la ficha y en el boletín (0053). */
  | "imagenes";
/** Estado de un punto de un informe. */
/** Cómo llega la cifra: por periodo académico (A y B) o una sola cifra por año. */
export type OdReporting = "periodo" | "anual";
export type OdSectionStatus = "completo" | "parcial" | "no_recibido" | "no_oficial" | "abierto";
/** Cómo se presenta una tabla: tabla, ranking, fichas o cifras de un periodo. */
export type OdTableDisplay = "tabla" | "ranking" | "fichas" | "cifras";
export type OdImportKind = "rejilla" | "pegado" | "plantilla";

/** Boletín UDES en Cifras: la plantilla (od_bulletins, 0027). */
export interface OdBulletinRow {
  id: string;
  period_id: string;
  /** Nulo = boletín global. */
  report_id: string | null;
  slug: string;
  title: string;
  /** Plantilla completa (ver src/modules/boletin/model.ts). */
  settings: Record<string, unknown>;
  status: PublicationStatus;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Edición congelada: un PDF emitido en una fecha (od_bulletin_editions, 0027). */
export interface OdBulletinEditionRow {
  id: string;
  bulletin_id: string;
  title: string;
  period_label: string;
  label: string;
  cut_label: string;
  file_path: string;
  file_size: number;
  status: "publicado" | "retirado";
  note: string;
  published_by: string | null;
  published_at: string;
}

export interface OdPeriod {
  id: string;
  label: string;
  start_year: number;
  end_year: number;
  cutoff_date: string;
  illustrative: boolean;
  is_current: boolean;
  status: PublicationStatus;
  note: string;
  created_at: string;
  updated_at: string;
}

export interface OdPeriodCampus {
  period_id: string;
  campus_id: string;
  label: string;
  slug: string;
  position: number;
}

export interface OdOffice {
  id: string;
  name: string;
  contact_email: string;
  position: number;
}

export interface OdReportRow {
  id: string;
  period_id: string;
  slug: string;
  code: string;
  name: string;
  summary: string;
  description: string;
  image_url: string;
  image_alt: string;
  image_credit: string;
  line: number;
  note: string;
  position: number;
  status: PublicationStatus;
  updated_at: string;
}

export interface OdIndicatorRow {
  id: string;
  report_id: string;
  key: string;
  label: string;
  unit: string;
  format: OdValueFormat;
  direction: OdDirection;
  aggregation: OdAggregation;
  /** Por periodo (A y B) o por año. Sin la migración 0022, por periodo. */
  reporting?: OdReporting;
  annual_rule: OdAnnualRule;
  /** Años con dato. null = todos los del periodo. */
  years: number[] | null;
  definition: string;
  office_id: string | null;
  position: number;
  is_kpi: boolean;
  kpi_position: number | null;
  is_headline: boolean;
}

export interface OdValueRow {
  id?: string;
  indicator_id: string;
  year: number;
  term: OdTerm;
  campus_id: string | null;
  value: number | null;
  note?: string;
  updated_at?: string;
}

export interface OdBreakdownRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  unit: string;
  format: OdValueFormat;
  office_id: string | null;
  default_chart: OdChartKind;
  reporting?: OdReporting;
  annual_rule: OdAnnualRule;
  /** Años con dato. null = todos los del periodo. */
  years: number[] | null;
  /** Umbral de reserva estadística. null = el desglose no reserva nada. */
  reserve_threshold?: number | null;
  /** Columna Total en «Ver datos por corte» (0124). Sin la columna, con total. */
  show_total?: boolean;
  position: number;
}

export interface OdBreakdownValueRow {
  id?: string;
  breakdown_id: string;
  year: number;
  term: OdTerm;
  label: string;
  position: number;
  value: number | null;
  /** Celda bajo el umbral de reserva: se publica "< n", nunca su cifra. */
  reserved?: boolean;
}

export interface OdHeatmapRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  row_label: string;
  column_label: string;
  rows: string[];
  columns: string[];
  unit: string;
  format: OdValueFormat;
  office_id: string | null;
  empty_meaning: string;
  position: number;
}

export interface OdHeatmapCellRow {
  heatmap_id: string;
  row_index: number;
  column_index: number;
  value: number | null;
}

export interface OdMapRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  mode: OdMapMode;
  reporting: OdMapReporting;
  unit: string;
  office_id: string | null;
  /** Años con dato. null = todos los del periodo. */
  years: number[] | null;
  position: number;
}

/** Modelo estadístico publicado (0046). La forma de spec está en ModelSpec. */
export interface OdModelRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  note: string;
  spec: Record<string, unknown>;
  office_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface OdMapValueRow {
  map_id: string;
  year: number;
  campus_id: string;
  department_code: string;
  /** null cuando la celda está reservada (0044). */
  value: number | null;
  /** Menos de 5 personas: la cifra no se publica (0044). */
  reserved?: boolean;
}

export interface OdPipelineRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  measure: OdPipelineMeasure;
  stages: string[];
  office_id: string | null;
  position: number;
}

export interface OdPipelineValueRow {
  id?: string;
  pipeline_id: string;
  /** Periodo de ingreso de la cohorte: "2014-A". */
  cohort: string;
  campus_id: string | null;
  stage_index: number;
  /** Estudiantes o porcentaje, según la medida de la tubería. */
  value: number | null;
  main_cause: string;
}

export interface OdHistoryRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  unit: string;
  format: OdValueFormat;
  total_label: string;
  office_id: string | null;
  position: number;
}

export interface OdHistoryValueRow {
  id?: string;
  history_id: string;
  /** "2020-A". */
  period_label: string;
  /** "" = total. */
  category: string;
  position: number;
  value: number | null;
}

export interface OdReportBlockRow {
  id: string;
  report_id: string;
  kind: OdBlockKind;
  ref_id: string | null;
  /** Punto del informe al que pertenece el bloque. */
  section_id?: string | null;
  position: number;
  visible: boolean;
  settings: {
    chart?: OdChartKind;
    title?: string;
    indicators?: string[];
    /** Evolución por campus: clave del indicador con que abre. Sin ella, la cifra titular. */
    indicator?: string;
    /** Mapas: clave (no id) del otro mapa que se muestra con este. La clave sobrevive a la copia de periodo. */
    mapWith?: string;
    /** "combinado": entrante y saliente en un solo mapa; "lado_a_lado": dos mapas en una fila. */
    mapLayout?: OdMapLayout;
    /** Mapa con panel denso y encuadre a los países con datos. */
    compact?: boolean;
    /** Separador: una frase bajo su título. */
    description?: string;
    /** Bloque de desgloses: claves de los desgloses que muestra. Sin ellas, los que ningún otro bloque eligió. */
    breakdowns?: string[];
    /** Bloque de rankings: claves de los rankings que muestra. Sin ellas, los que ningún otro bloque eligió. */
    rankings?: string[];
    /** Medalleros que enseña este bloque; vacío, los que no reclamó otro. */
    medalleros?: string[];
    /** Bloque de tablas: claves de las tablas personalizadas (su conjunto libre) que muestra. Sin ellas, las que ningún otro bloque eligió (0134). */
    tablas?: string[];
    /** Bloque Saber PRO: clave del conjunto que muestra (0031). */
    saberPro?: string;
    /** Bloque de conjunto libre: clave de la vista que muestra; sin ella, todas (0033). */
    view?: string;
    /** Bloque del Motor Beta: clave del conjunto Saber TyT (0035). */
    saberTyt?: string;
    /** Distingue varios bloques del mismo tipo sin conjunto (separadores, tableros). Ver 0029. */
    slot?: string;
    /** Grid de imágenes: las fotografías, en su orden (0053). */
    images?: { path: string; alt: string; caption?: string }[];
    /** Grid de imágenes: cuántas por fila. Dos por defecto. */
    columns?: 1 | 2;
  };
}

export interface OdSectionRequest {
  dato: string;
  responsable: string;
  periodicidad: string;
}

export interface OdSectionRow {
  id: string;
  report_id: string;
  key: string;
  number: number | null;
  title: string;
  status: OdSectionStatus;
  lede: string;
  warning: string;
  source: string;
  requested: OdSectionRequest[];
  position: number;
}

export interface OdTableColumn {
  key: string;
  label: string;
  format: OdValueFormat | "texto" | "enlace";
}

export interface OdTableRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  display: OdTableDisplay;
  columns: OdTableColumn[];
  office_id: string | null;
  position: number;
}

/** Ranking universitario de un informe (0030). */
export interface OdRankingRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  system: "qs_world" | "qs_latam" | "qs_subject" | "qs_sustainability" | "the_latam" | "the_impact" | "otro";
  accent: string;
  view: "medallas" | "tabla" | "evolucion" | "ods";
  office_id: string | null;
  position: number;
}

/** Una edición anual de un ranking: posiciones como texto ("145", "801-1000") y listas en jsonb. */
export interface OdRankingEditionRow {
  id?: string;
  ranking_id: string;
  year: number;
  global_rank: string;
  regional_rank: string;
  national_rank: string;
  evaluated: number | null;
  score: number | null;
  stars: { category: string; stars: number }[];
  sdgs: { sdg: number; global_rank: string; national_rank: string; score?: number | null }[];
  subjects: { subject: string; global_rank: string; national_rank: string }[];
  custom: { label: string; value: string }[];
  note: string;
}

/** Resultados Saber PRO de un informe (0031). */
export interface OdSaberProRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  note: string;
  office_id: string | null;
  position: number;
}

/** Motor Beta: el conjunto Saber TyT de un informe (0035). */
export interface OdSaberTytRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  note: string;
  /** Curva de percentiles por competencia: ver saber-tyt.ts. */
  benchmarks: import("../modules/datos-abiertos/data/saber-tyt").TytBenchmarks;
  /** Motor Alpha: coeficientes y promedios nacionales (0037). */
  alpha?: import("../modules/datos-abiertos/data/saber-alpha").AlphaData;
  office_id: string | null;
  position: number;
}

/** Una fila del Motor Beta: año × nivel × programa × competencia, en percentiles. */
export interface OdSaberTytResultRow {
  id?: string;
  tyt_id: string;
  year: number;
  level: "tecnologico" | "tecnico_profesional" | "universitario";
  program: string;
  competency: "global" | "lc" | "rc" | "cc" | "ce" | "ing" | "cn";
  evaluated: number | null;
  mean_exit: number | string | null;
  paired: number | null;
  mean_entry: number | string | null;
  mean_delta: number | string | null;
  improved: number | null;
  raw_entry: number | string | null;
  raw_exit: number | string | null;
  transitions: Record<string, Record<string, number>>;
  histogram: Record<string, number>;
  scatter: Record<string, number>;
  /** Motor Alpha (0037). */
  alpha_n?: number | null;
  alpha_expected?: number | string | null;
  alpha_actual?: number | string | null;
  alpha_va?: number | string | null;
  alpha_positive?: number | null;
  plane?: Record<string, number>;
  quadrants?: Record<string, number>;
  quad_plane?: Record<string, number>;
}

/** Conjunto libre de un informe (0033). Columnas y vistas en jsonb: ver free-sets.ts. */
export interface OdFreeSetRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  temporality: "sin_tiempo" | "anual" | "periodo";
  period_label: string;
  columns: import("../modules/datos-abiertos/data/free-sets").FreeColumn[];
  views: import("../modules/datos-abiertos/data/free-sets").FreeView[];
  office_id: string | null;
  position: number;
}

/** Una fila de un conjunto libre: dato, título de grupo o total (0034). */
export interface OdFreeSetRecordRow {
  id?: string;
  set_id: string;
  position: number;
  year: number | null;
  kind?: "dato" | "grupo" | "total";
  label?: string;
  cells: Record<string, string | number | null>;
}

/** Resultado Saber PRO agregado: año × ámbito × competencia. Sin datos personales. */
export interface OdSaberProResultRow {
  id?: string;
  saber_id: string;
  year: number;
  scope: "programa" | "institucion" | "nacional";
  campus: string;
  faculty: string;
  program: string;
  competency: "global" | "lc" | "rc" | "cc" | "ce" | "ing";
  evaluated: number | null;
  mean: number | string | null;
  levels: Record<string, number>;
  histogram: Record<string, number>;
}

export interface OdTableRecordRow {
  id?: string;
  table_id: string;
  position: number;
  cells: Record<string, string | number | null>;
}

export interface OdImportRow {
  id: string;
  period_id: string;
  report_id: string | null;
  kind: OdImportKind;
  file_name: string;
  cells_changed: number;
  summary: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
}

export interface OdPublicationRow {
  id: string;
  period_id: string;
  report_id: string | null;
  action: "publicado" | "retirado";
  note: string;
  published_by: string | null;
  published_at: string;
}

/* --- Medallero (0056) --------------------------------------------------------- */

/** Un medallero de un informe: sus categorías de medalla y cómo se ordena. */
export interface OdMedalBoardRow {
  id: string;
  report_id: string;
  key: string;
  title: string;
  description: string;
  /** Cabecera de la columna de filas: «Competencia», «Campus»… la escribe la oficina. */
  row_label: string;
  reporting: "anual" | "periodo";
  scope: "acumulado" | "por_ano";
  fixed_year: number | null;
  sort: "medallero" | "manual";
  /** [{key,label,position}]; la posición 1 es la categoría más alta. */
  tiers: { key: string; label: string; position: number }[];
  office_id: string | null;
  note: string;
  position: number;
}

/** Una fila de un medallero en un corte: su rótulo y sus medallas por categoría. */
export interface OdMedalEntryRow {
  id?: string;
  board_id: string;
  year: number;
  term: "A" | "B" | null;
  label: string;
  /** Solo lo capturado: lo que falta es «no compitió», que no es un cero. */
  counts: Record<string, number | null>;
  note: string;
  position: number;
}

/* ---------- Reporte por oficinas del ranking THE (0149) ------------------- */

/** Un ciclo de reporte por ranking y año de edición (`ranking_cycles`). */
export interface RankingCycleRow {
  id: string;
  ranking: string;
  anio: number;
  anio_datos: number;
  ods_priorizados: number[];
  fecha_limite: string | null;
  estado: "preparacion" | "abierto" | "cerrado";
}

/** Una fila del catálogo del ciclo (`ranking_indicators`). */
export interface RankingIndicatorRow {
  ciclo: string;
  id: string;
  ods: number;
  nivel: "metric" | "indicator" | "option";
  padre: string | null;
  tipo: "ev" | "doc" | "dato" | "inv" | null;
  texto_en: string;
  texto_es: string;
  peso: number | null;
  prioridad: "alta" | "media" | "baja" | null;
  tipo_requerimiento: string;
  orden: number;
}

/** Indicador asignado a una oficina (`ranking_assignments`). */
export interface RankingAssignmentRow {
  ciclo: string;
  indicador: string;
  unidad: string;
  rol: "principal" | "apoyo";
}

/** La respuesta de una oficina a un indicador (`ranking_responses`). */
export interface RankingResponseRow {
  id: string;
  ciclo: string;
  indicador: string;
  unidad: string;
  valores: Record<string, number | null>;
  si_no: boolean | null;
  estado: "none" | "draft" | "sent" | "back" | "ok";
  comentario_es: string;
  comentario_en: string;
  nota_revision: string;
  /** La que va a THE por este indicador (0150). Una por indicador; solo Planeación, sobre una aprobada. */
  oficial: boolean;
  updated_by: string | null;
  updated_at: string;
}

/** Un aporte a un indicador, de cualquier oficina, sin su contenido (RPC `ranking_aportes`, 0150). */
export interface RankingAporteRow {
  indicador: string;
  unidad: string;
  unidad_nombre: string;
  estado: RankingResponseRow["estado"];
  oficial: boolean;
  updated_at: string;
}

/** Una evidencia de una respuesta: archivo del bucket o URL https (`ranking_evidence`). */
export interface RankingEvidenceRow {
  id: string;
  response_id: string;
  kind: "file" | "url";
  url: string | null;
  storage_path: string | null;
  nombre: string;
  mime: string | null;
  tamano: number | null;
  publica: boolean;
  analisis: { nivel: "ok" | "warn" | "risk"; texto: string }[];
  optimizada: boolean;
  created_at: string;
}

/* --- Internacionalización (migración 0151) ----------------------------------------- */

/** Papel en el módulo de Internacionalización. */
export type IntRol = "director" | "coordinador" | "gestor";
/** Tipo de una columna o de un concepto. */
export type IntTipo = "texto" | "numero" | "fecha" | "lista" | "calculado";
/** Estado de (hoja, periodo, campus). Sin fila en int_envios = borrador. */
export type IntEstado = "borrador" | "enviado" | "validado" | "aprobado";

/** Quién trabaja en el módulo (`int_miembros`). El director no lleva campus. */
export interface IntMiembroRow {
  id: string;
  user_id: string;
  rol: IntRol;
  campus_id: string | null;
  created_at: string;
}

/** Un concepto del catálogo compartido (`int_conceptos`). */
export interface IntConceptoRow {
  id: string;
  nombre: string;
  tipo: IntTipo;
  opciones: string[];
  sinonimos: string[];
  descripcion: string;
  /** periodo y campus: van en la fila, no en una columna. */
  implicito: boolean;
  /** Dato personal: la pantalla lo enmascara. */
  personal: boolean;
  orden: number;
}

/** Un libro de tablas (`int_libros`). captura «oficina»: solo el Director escribe filas. */
export interface IntLibroRow {
  id: string;
  nombre: string;
  descripcion: string;
  captura: "campus" | "oficina";
  orden: number;
  created_at: string;
}

/** Una hoja de un libro (`int_hojas`). clase y sentido alimentan las cifras. */
export interface IntHojaRow {
  id: string;
  libro_id: string;
  nombre: string;
  clase: "movilidad" | "convenio" | "general";
  sentido: "saliente" | "entrante" | null;
  orden: number;
}

/** Cálculo de una columna calculada. */
export interface IntCalculo {
  tipo: "dias_entre";
  desde: string;
  hasta: string;
}

/** Una columna (`int_columnas`). Con concepto, clave = concepto_id; sin él, «propio_…». */
export interface IntColumnaRow {
  id: string;
  hoja_id: string;
  clave: string;
  etiqueta: string;
  tipo: IntTipo;
  concepto_id: string | null;
  obligatorio: boolean;
  opciones: string[];
  calculo: IntCalculo | null;
  orden: number;
}

export interface IntPeriodoRow {
  id: string;
  /** «2026-2». */
  codigo: string;
  nombre: string;
  abre: string | null;
  cierra: string | null;
  estado: "abierto" | "cerrado";
}

/** Ventana de captura de una hoja en un periodo; campus_id nulo = todos. */
export interface IntVentanaRow {
  id: string;
  periodo_id: string;
  hoja_id: string;
  campus_id: string | null;
  abre: string;
  cierra: string;
}

/** Valor guardado en una celda: texto, número, fecha «AAAA-MM-DD» o nulo. */
export type IntValor = string | number | null;

export interface IntFilaRow {
  id: string;
  hoja_id: string;
  periodo_id: string;
  campus_id: string;
  datos: Record<string, IntValor>;
  orden: number;
  origen: "manual" | "excel";
  created_by: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface IntEnvioRow {
  periodo_id: string;
  hoja_id: string;
  campus_id: string;
  estado: IntEstado;
  nota: string;
  enviado_en: string | null;
  validado_en: string | null;
  aprobado_en: string | null;
  updated_by: string | null;
  updated_at: string;
}

export interface IntEnvioHistorialRow {
  id: number;
  periodo_id: string;
  hoja_id: string;
  campus_id: string;
  de: IntEstado;
  a: IntEstado;
  nota: string;
  actor: string | null;
  actor_rol: IntRol | null;
  en: string;
}

export interface IntReaperturaRow {
  id: number;
  tipo: "envio" | "ventana" | "periodo";
  periodo_id: string;
  hoja_id: string | null;
  campus_id: string | null;
  motivo: string;
  detalle: Record<string, unknown>;
  actor: string | null;
  en: string;
}

/** Plantilla CNA / ranking / otra que carga el Director (`int_plantillas`). */
export interface IntPlantillaRow {
  id: string;
  nombre: string;
  tipo: "cna" | "ranking" | "otra";
  descripcion: string;
  created_at: string;
}

export interface IntPlantillaColumnaRow {
  id: string;
  plantilla_id: string;
  orden: number;
  etiqueta: string;
  concepto_id: string | null;
  modo: "directo" | "derivado" | "falta";
  nota: string;
}

/** Un envío del puente a Reportes Institucionales (`int_envios_snies`). */
export interface IntEnvioSniesRow {
  id: string;
  periodo_id: string;
  plantilla: string;
  ri_periodo: string;
  entrega_id: string | null;
  insertadas: number;
  omitidas: number;
  actor: string | null;
  en: string;
}

/* --- Biblioteca de evidencias del ranking THE (migración 0152) ---------------------- */

/** Una propuesta de Pilo para un archivo de la biblioteca. */
export interface RankingPropuestaBiblioteca {
  indicador: string;
  ods: number;
  puntaje: number;
  razones: string[];
}

/** Un archivo de la biblioteca (`ranking_biblioteca`). */
export interface RankingBibliotecaRow {
  id: string;
  ciclo: string | null;
  zip_nombre: string;
  ruta_zip: string;
  nombre: string;
  carpeta: string;
  ext: string;
  tamano: number;
  mime: string | null;
  sha256: string;
  storage_path: string;
  anio_detectado: number | null;
  texto: string;
  estado_texto: "ok" | "sin_texto" | "no_aplica" | "error";
  nota_texto: string | null;
  ods_propuestos: number[];
  propuestas: RankingPropuestaBiblioteca[];
  estado: "sin_clasificar" | "propuesta" | "aceptada" | "descartada";
  indicador_aceptado: string | null;
  respuesta_aceptada: string | null;
  evidencia: string | null;
  subido_por: string | null;
  created_at: string;
  updated_at: string;
}

/** Evidencia con lo que agrega 0152: la clase «nota» y el archivo de la biblioteca. */
export type RankingEvidenceExt = Omit<RankingEvidenceRow, "kind"> & {
  kind: "file" | "url" | "nota";
  biblioteca: string | null;
};