/* =============================================================================
   Consultas a Supabase.

   Un único lugar donde se declara qué columnas pide cada pantalla. Las claves
   de caché viven aquí también (`keys`), para que las mutaciones sepan qué
   invalidar sin adivinar cadenas de texto.

   Nota sobre RLS: estas consultas no filtran por estado de publicación. No hace
   falta: la base de datos ya devuelve solo lo que quien pregunta puede ver. El
   público recibe los pilares publicados; la intranet, todos.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import type {
  AccessRole,
  AccessRoleReport,
  ActionLineWithArea,
  Activity,
  Campus,
  CampusFact,
  CampusIndicator,
  CampusLineCoverage,
  CampusPillarCell,
  CampusReportBatch,
  CampusSummary,
  ActivityWithTargets,
  AreaProgress,
  ChangeLogWithTarget,
  Faculty,
  FacultyAction,
  FacultyActionAdminRow,
  FacultyPillarCell,
  FacultySummary,
  GlossaryTerm,
  StructureDuplicate,
  StructureOrphan,
  IndicatorWithLabels,
  Parameter,
  ParameterCategory,
  PdiDocument,
  PdiSummary,
  Pillar,
  PillarObservation,
  PillarOwner,
  PillarProgress,
  Profile,
  PillarBudget,
  Project,
  ProjectAdminRow,
  ProjectBudget,
  ProjectBudgetReport,
  ProjectProgress,
  ProjectWithLinks,
  ReportPeriod,
  StrategicArea,
  WebProject,
  YearProgress,
} from "../types/database";
import { emptyProgress, emptySummary } from "./pdi";
import { describeDatabaseError } from "./errors";
import type { DatabaseError } from "./errors";

/** Árbol de claves de caché. Invalidar `keys.pillars()` alcanza a sus hijas. */
export const keys = {
  all: ["pdi"] as const,
  pillars: () => [...keys.all, "pillars"] as const,
  pillar: (slug: string) => [...keys.pillars(), slug] as const,
  progress: () => [...keys.all, "progress"] as const,
  summary: () => [...keys.all, "summary"] as const,
  period: () => [...keys.all, "period"] as const,
  activities: () => [...keys.all, "activities"] as const,
  featured: () => [...keys.activities(), "featured"] as const,
  documents: (scope: string) => [...keys.all, "documents", scope] as const,
  parameters: () => [...keys.all, "parameters"] as const,
  profiles: () => [...keys.all, "profiles"] as const,
  owners: () => [...keys.all, "owners"] as const,
  accessRoles: () => [...keys.all, "access-roles"] as const,
  webProjects: () => [...keys.all, "web-projects"] as const,
  observations: (pillarId: string) => [...keys.all, "observations", pillarId] as const,
  pillarYears: () => [...keys.all, "pillar-years"] as const,
  projects: () => [...keys.all, "projects"] as const,
  adminProjects: () => [...keys.all, "admin-projects"] as const,
  budget: () => [...keys.all, "budget"] as const,
  structure: () => [...keys.all, "structure"] as const,
  structureAudit: () => [...keys.all, "structure-audit"] as const,
  faculties: () => [...keys.all, "faculties"] as const,
  faculty: (slug: string) => [...keys.faculties(), slug] as const,
  facultyMatrix: () => [...keys.faculties(), "matrix"] as const,
  facultyActions: () => [...keys.faculties(), "actions"] as const,
  adminFacultyActions: () => [...keys.facultyActions(), "admin"] as const,
  campuses: () => [...keys.all, "campuses"] as const,
  campusSummary: () => [...keys.campuses(), "summary"] as const,
  campusPillar: () => [...keys.campuses(), "pillar"] as const,
  campusCoverage: () => [...keys.campuses(), "coverage"] as const,
  campusFacts: (slug: string) => [...keys.campuses(), "facts", slug] as const,
  campusIndicators: (slug: string) => [...keys.campuses(), "indicators", slug] as const,
  campusBatches: () => [...keys.campuses(), "batches"] as const,
};

/** Convierte el error de PostgREST en algo que se pueda mostrar y accionar. */
function unwrap<T>({ data, error }: { data: T | null; error: DatabaseError | null }): T {
  if (error) throw describeDatabaseError(error);
  return data as T;
}

/**
 * Un indicador de resultado no se entiende sin su unidad ni sin su serie de
 * años: se piden embebidos para que la tabla del reporte salga de una sola
 * petición en vez de una por indicador.
 */
const ACTIVITY_SELECT = "*, unit:parameters(label), targets:activity_targets(*)";

/** Los años llegan en el orden que quiera Postgres; la tabla los quiere en el suyo. */
function sortTargets(rows: ActivityWithTargets[]): ActivityWithTargets[] {
  return rows.map((row) => ({
    ...row,
    targets: [...(row.targets ?? [])].sort((a, b) => a.year - b.year),
  }));
}

/* =============================================================================
   Portada y tablero
   ========================================================================== */

export interface PillarWithProgress extends Pillar {
  progress: PillarProgress;
}

/** Pilares con su avance. Son dos peticiones porque el avance es una vista y
 *  PostgREST no puede unir vistas y tablas sin clave foránea; a seis filas por
 *  lado, unirlas aquí sale más barato que crear una vista materializada. */
export function usePillars() {
  return useQuery({
    queryKey: keys.pillars(),
    queryFn: async (): Promise<PillarWithProgress[]> => {
      const [pillars, progress] = await Promise.all([
        supabase.from("pillars").select("*").order("position").then(unwrap<Pillar[]>),
        supabase.from("v_pillar_progress").select("*").then(unwrap<PillarProgress[]>),
      ]);

      const byId = new Map(progress.map((row) => [row.pillar_id, row]));
      return pillars.map((pillar) => ({
        ...pillar,
        progress: byId.get(pillar.id) ?? { ...emptyProgress, pillar_id: pillar.id, slug: pillar.slug },
      }));
    },
  });
}

/**
 * Avance por año de todos los pilares. La barra de años del tablero y de
 * implementación necesita los cinco cortes de los seis pilares a la vez, y
 * `v_year_progress` ya los tiene apilados: basta con quedarse con el nivel de
 * pilar. El avance del plan —la ponderación hasta 2028— se calcula sobre estas
 * mismas filas en el cliente, así que no hace falta pedirlo aparte.
 */
export function usePillarYears() {
  return useQuery({
    queryKey: keys.pillarYears(),
    queryFn: async (): Promise<YearProgress[]> =>
      supabase
        .from("v_year_progress")
        .select("*")
        .eq("scope", "pillar")
        .order("year")
        .then(unwrap<YearProgress[]>),
  });
}

export function useSummary() {
  return useQuery({
    queryKey: keys.summary(),
    queryFn: async (): Promise<PdiSummary> => {
      const { data, error } = await supabase.from("v_pdi_summary").select("*").maybeSingle();
      if (error) throw describeDatabaseError(error);
      return data ?? emptySummary;
    },
  });
}

export function useCurrentPeriod() {
  return useQuery({
    queryKey: keys.period(),
    queryFn: async (): Promise<ReportPeriod | null> => {
      const { data, error } = await supabase.from("v_current_period").select("*").maybeSingle();
      if (error) throw describeDatabaseError(error);
      return data as ReportPeriod | null;
    },
    // El corte cambia una vez al mes: no tiene sentido revalidarlo al volver
    // a la pestaña.
    staleTime: 30 * 60 * 1000,
  });
}

export interface FeaturedActivity extends Activity {
  pillar: { slug: string; name: string; accent_slot: number } | null;
}

export function useFeaturedActivities() {
  return useQuery({
    queryKey: keys.featured(),
    queryFn: async (): Promise<FeaturedActivity[]> =>
      supabase
        .from("activities")
        .select("*, pillar:pillars(slug, name, accent_slot)")
        .eq("is_featured", true)
        .order("position")
        .then(unwrap<FeaturedActivity[]>),
  });
}

/* =============================================================================
   Repositorio
   ========================================================================== */

export function usePublicDocuments() {
  return useQuery({
    queryKey: keys.documents("public"),
    queryFn: async (): Promise<PdiDocument[]> =>
      supabase
        .from("documents")
        .select("*")
        .eq("is_public", true)
        .order("position")
        .then(unwrap<PdiDocument[]>),
  });
}

/** Soportes de un pilar (internos y públicos). */
export function usePillarDocuments(pillarId: string | undefined) {
  return useQuery({
    queryKey: keys.documents(pillarId ?? "none"),
    enabled: Boolean(pillarId),
    queryFn: async (): Promise<PdiDocument[]> =>
      supabase
        .from("documents")
        .select("*")
        .eq("pillar_id", pillarId!)
        .order("position")
        .then(unwrap<PdiDocument[]>),
  });
}

/* =============================================================================
   Detalle de un pilar
   ========================================================================== */

export interface AreaWithLines extends StrategicArea {
  action_lines: { id: string; code: string | null; name: string; progress: number; position: number }[];
}

export interface PillarDetail {
  pillar: Pillar;
  progress: PillarProgress;
  areas: AreaWithLines[];
  /** Avance de cada área, en cascada desde sus líneas. */
  areaProgress: AreaProgress[];
  /** Avance de cada proyecto, en cascada desde sus indicadores. */
  projectProgress: ProjectProgress[];
  /** La misma cascada, año a año, para los cinco niveles del plan. */
  yearProgress: YearProgress[];
  lines: ActionLineWithArea[];
  indicators: IndicatorWithLabels[];
  /** Proyectos que tocan el pilar, propios o vinculados desde otro. */
  projects: ProjectWithLinks[];
  /** Indicadores de resultado, con su unidad y su serie anual. */
  activities: ActivityWithTargets[];
  /** Lectura cualitativa del avance, escrita por el responsable del pilar. */
  observations: PillarObservation[];
  changes: ChangeLogWithTarget[];
  glossary: GlossaryTerm[];
  documents: PdiDocument[];
}

/**
 * Todo lo que necesita el visor de un pilar. Se piden en paralelo porque son
 * independientes: siete peticiones simultáneas tardan lo que la más lenta, no
 * lo que la suma.
 */
export function usePillarDetail(slug: string | undefined) {
  return useQuery({
    queryKey: keys.pillar(slug ?? "none"),
    enabled: Boolean(slug),
    queryFn: async (): Promise<PillarDetail | null> => {
      const { data: pillar, error } = await supabase
        .from("pillars")
        .select("*")
        .eq("slug", slug!)
        .maybeSingle();

      if (error) throw describeDatabaseError(error);
      if (!pillar) return null;

      const id = (pillar as Pillar).id;

      const [
        progress,
        areaProgress,
        projectProgress,
        yearProgress,
        areas,
        lines,
        indicators,
        projects,
        activities,
        observations,
        changes,
        glossary,
        documents,
      ] = await Promise.all([
          supabase.from("v_pillar_progress").select("*").eq("pillar_id", id).maybeSingle(),
          supabase.from("v_area_progress").select("*").eq("pillar_id", id).then(unwrap<AreaProgress[]>),
          // `contains`, no `eq`: el avance de un proyecto compartido tiene que
          // llegar a los dos pilares. Con `pillar_id` —el dueño— la ficha del
          // pilar vecino se quedaba con el avance reportado a mano.
          supabase
            .from("v_project_progress")
            .select("*")
            .contains("pillar_ids", [id])
            .then(unwrap<ProjectProgress[]>),
          // Los cinco niveles apilados en una sola vista: una petición en vez
          // de cinco para poder pintar una columna por año.
          supabase
            .from("v_year_progress")
            .select("*")
            .eq("pillar_id", id)
            .order("year")
            .then(unwrap<YearProgress[]>),
          supabase
            .from("strategic_areas")
            .select("*, action_lines(id, code, name, progress, position)")
            .eq("pillar_id", id)
            .order("position")
            .then(unwrap<AreaWithLines[]>),
          supabase
            .from("v_action_lines")
            .select("*")
            .eq("pillar_id", id)
            .order("position")
            .then(unwrap<ActionLineWithArea[]>),
          supabase
            .from("v_indicators")
            .select("*")
            .eq("pillar_id", id)
            .order("position")
            .then(unwrap<IndicatorWithLabels[]>),
          // v_projects, no projects: un proyecto puede apuntar a este pilar
          // desde otro, y la tabla solo conoce a su pilar dueño.
          supabase
            .from("v_projects")
            .select("*")
            .contains("pillar_ids", [id])
            .order("position")
            .then(unwrap<ProjectWithLinks[]>),
          supabase
            .from("activities")
            .select(ACTIVITY_SELECT)
            .eq("pillar_id", id)
            .order("position")
            .then(unwrap<ActivityWithTargets[]>)
            .then(sortTargets),
          supabase
            .from("pillar_observations")
            .select("*")
            .eq("pillar_id", id)
            // Sin año = observación vigente: va primero, y después los cortes
            // del más reciente al más antiguo.
            .order("year", { ascending: false, nullsFirst: true })
            .order("position")
            .then(unwrap<PillarObservation[]>),
          // v_change_log añade el nombre del proyecto, el indicador o el
          // indicador: sin eso, una entrada automática sería un id suelto.
          supabase
            .from("v_change_log")
            .select("*")
            .eq("pillar_id", id)
            .order("changed_on", { ascending: false })
            .order("version", { ascending: false })
            .then(unwrap<ChangeLogWithTarget[]>),
          // Los términos sin pilar son comunes a todo el PDI y salen en el
          // glosario de cualquiera.
          supabase
            .from("glossary_terms")
            .select("*")
            .or(`pillar_id.eq.${id},pillar_id.is.null`)
            .order("position")
            .then(unwrap<GlossaryTerm[]>),
          supabase.from("documents").select("*").eq("pillar_id", id).order("position").then(unwrap<PdiDocument[]>),
        ]);

      return {
        pillar: pillar as Pillar,
        progress:
          (progress.data as PillarProgress) ?? {
            ...emptyProgress,
            pillar_id: id,
            slug: (pillar as Pillar).slug,
          },
        areaProgress,
        projectProgress,
        yearProgress,
        areas,
        lines,
        indicators,
        projects,
        activities,
        observations,
        changes,
        glossary,
        documents,
      };
    },
  });
}

/* =============================================================================
   Intranet
   ========================================================================== */

export function useParameters(category?: ParameterCategory) {
  return useQuery({
    queryKey: [...keys.parameters(), category ?? "all"],
    queryFn: async (): Promise<Parameter[]> => {
      let query = supabase.from("parameters").select("*").order("category").order("position");
      if (category) query = query.eq("category", category);
      return query.then(unwrap<Parameter[]>);
    },
    staleTime: 10 * 60 * 1000,
  });
}

/** Roles de acceso con los informes de UDES en Cifras que alcanza cada uno. */
export function useAccessRoles() {
  return useQuery({
    queryKey: keys.accessRoles(),
    queryFn: async (): Promise<{ roles: AccessRole[]; reports: AccessRoleReport[] }> => {
      const [roles, reports] = await Promise.all([
        supabase.from("access_roles").select("*").order("position").then(unwrap<AccessRole[]>),
        supabase.from("access_role_reports").select("*").then(unwrap<AccessRoleReport[]>),
      ]);
      return { roles, reports };
    },
    staleTime: 5 * 60 * 1000,
  });
}

/** Informes de UDES en Cifras por slug, para asignarlos a un rol de acceso.
 *  Un mismo informe existe en cada periodo: aquí se lista una vez. */
export function useOdReportOptions() {
  return useQuery({
    queryKey: [...keys.accessRoles(), "informes"],
    queryFn: async (): Promise<{ slug: string; name: string }[]> => {
      const rows = await supabase
        .from("od_reports")
        .select("slug,name,position")
        .order("position")
        .then(unwrap<{ slug: string; name: string; position: number }[]>);
      const unique = new Map<string, string>();
      for (const row of rows) if (!unique.has(row.slug)) unique.set(row.slug, row.name);
      return [...unique].map(([slug, name]) => ({ slug, name }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useProfiles() {
  return useQuery({
    queryKey: keys.profiles(),
    queryFn: async (): Promise<Profile[]> =>
      supabase.from("profiles").select("*").order("full_name").then(unwrap<Profile[]>),
  });
}

/**
 * Desarrollos web de la oficina. La misma consulta sirve al portal público y a
 * la intranet: RLS decide si devuelve solo los publicados o todos.
 */
export function useWebProjects() {
  return useQuery({
    queryKey: keys.webProjects(),
    queryFn: async (): Promise<WebProject[]> =>
      supabase.from("web_projects").select("*").order("position").then(unwrap<WebProject[]>),
  });
}

/**
 * Todos los proyectos del plan, con sus vínculos. Es la consulta del módulo de
 * proyectos, que es transversal: se administra fuera de la configuración de un
 * pilar concreto porque un proyecto puede tocar varios.
 */
/**
 * La estructura completa del plan —áreas y líneas de todos los pilares— para el
 * selector de vínculos del módulo de proyectos. Un proyecto puede apuntar a
 * cualquier pilar, así que no sirve la estructura de uno solo.
 *
 * Se piden las áreas con sus líneas embebidas y no `v_action_lines` porque un
 * área todavía sin líneas también debe poder vincularse.
 */
export function useStructure() {
  return useQuery({
    queryKey: keys.structure(),
    queryFn: async (): Promise<AreaWithLines[]> =>
      supabase
        .from("strategic_areas")
        .select("*, action_lines(id, code, name, progress, position)")
        .order("position")
        .then(unwrap<AreaWithLines[]>),
    staleTime: 10 * 60 * 1000,
  });
}

export function useProjects() {
  return useQuery({
    queryKey: keys.projects(),
    queryFn: async (): Promise<ProjectWithLinks[]> =>
      supabase
        .from("v_projects")
        .select("*")
        .order("position")
        .then(unwrap<ProjectWithLinks[]>),
  });
}

/* =============================================================================
   Presupuesto · solo intranet

   Ninguna de estas consultas puede resolverse sin sesión: la migración 0015 deja
   `v_projects_admin`, `v_project_budget`, `v_pillar_budget` y la tabla de
   reportes fuera del alcance de `anon`, y las vistas filtran además por rol.
   Si alguna apareciera por error en una pantalla pública devolvería vacío en
   vez de filtrarse: el fallo es visible, no silencioso.
   ========================================================================== */

/**
 * Los proyectos con su valor de formulación. Es la misma lista que
 * `useProjects()`, pero desde la vista interna; la pública no trae dinero.
 */
export function useAdminProjects() {
  return useQuery({
    queryKey: keys.adminProjects(),
    queryFn: async (): Promise<ProjectAdminRow[]> =>
      supabase
        .from("v_projects_admin")
        .select("*")
        .order("position")
        .then(unwrap<ProjectAdminRow[]>),
  });
}

export interface BudgetOverview {
  pillars: PillarBudget[];
  projects: ProjectBudget[];
  /** El reporte año a año de cada proyecto. */
  reports: ProjectBudgetReport[];
  /**
   * Los indicadores de resultado que cuelgan de un proyecto: las acciones que
   * ejecutan el presupuesto. Se piden de una vez y no por proyecto para que la
   * pantalla se arme con una sola tanda de peticiones.
   */
  actions: Activity[];
}

export function useBudget() {
  return useQuery({
    queryKey: keys.budget(),
    queryFn: async (): Promise<BudgetOverview> => {
      const [pillars, projects, reports, actions] = await Promise.all([
        supabase.from("v_pillar_budget").select("*").then(unwrap<PillarBudget[]>),
        supabase.from("v_project_budget").select("*").then(unwrap<ProjectBudget[]>),
        supabase
          .from("project_budget_reports")
          .select("*")
          .order("year")
          .then(unwrap<ProjectBudgetReport[]>),
        // Solo las que cuelgan de un proyecto: un indicador suelto en una línea
        // de acción no ejecuta el presupuesto de ningún proyecto.
        supabase
          .from("activities")
          .select("*")
          .not("project_id", "is", null)
          .order("position")
          .then(unwrap<Activity[]>),
      ]);

      return { pillars, projects, reports, actions };
    },
  });
}

export function usePillarOwners() {
  return useQuery({
    queryKey: keys.owners(),
    queryFn: async (): Promise<PillarOwner[]> =>
      supabase.from("pillar_owners").select("*").then(unwrap<PillarOwner[]>),
  });
}

/* =============================================================================
   PDI por facultad

   Lo público sale de tres vistas que ya filtran por publicación: no hace falta
   —ni sería fiable— volver a filtrar aquí. La vista de administración vive al
   final y devuelve vacío sin sesión, que es un fallo visible en vez de un dato
   filtrado.
   ========================================================================== */

export function useFaculties() {
  return useQuery({
    queryKey: keys.faculties(),
    queryFn: async (): Promise<FacultySummary[]> =>
      supabase.from("v_faculties").select("*").order("position").then(unwrap<FacultySummary[]>),
  });
}

/** La matriz facultad × pilar, con sus casillas en cero. */
export function useFacultyMatrix() {
  return useQuery({
    queryKey: keys.facultyMatrix(),
    queryFn: async (): Promise<FacultyPillarCell[]> =>
      supabase
        .from("v_faculty_pillar_matrix")
        .select("*")
        .order("faculty_position")
        .order("pillar_position")
        .then(unwrap<FacultyPillarCell[]>),
  });
}

export interface FacultyDetail {
  faculty: FacultySummary;
  actions: FacultyAction[];
}

/**
 * Una facultad y sus acciones publicadas.
 *
 * Dos peticiones en paralelo y no una anidada: el resumen ya trae los recuentos
 * calculados en la base, y pedirlo embebido obligaría a recontar en el cliente
 * lo que la vista acaba de contar bien. Las actividades sí vienen dentro de
 * cada acción —la vista las trae como JSON—, porque la ficha las necesita todas
 * y pedirlas aparte serían dos viajes para pintar una sola lista.
 */
export function useFacultyDetail(slug: string | undefined) {
  return useQuery({
    queryKey: keys.faculty(slug ?? ""),
    enabled: Boolean(slug),
    queryFn: async (): Promise<FacultyDetail | null> => {
      const [faculty, actions] = await Promise.all([
        supabase.from("v_faculties").select("*").eq("slug", slug).maybeSingle(),
        supabase
          .from("v_faculty_actions")
          .select("*")
          .eq("faculty_slug", slug)
          .order("position")
          .then(unwrap<FacultyAction[]>),
      ]);

      if (faculty.error) throw describeDatabaseError(faculty.error);
      if (!faculty.data) return null;

      return { faculty: faculty.data as FacultySummary, actions };
    },
  });
}

/* --- Solo intranet --------------------------------------------------------- */

/** Todas las acciones, publicadas o no, con la nota de revisión. */
export function useAdminFacultyActions() {
  return useQuery({
    queryKey: keys.adminFacultyActions(),
    queryFn: async (): Promise<FacultyActionAdminRow[]> =>
      supabase
        .from("v_faculty_actions_admin")
        .select("*")
        .order("faculty_code")
        .order("position")
        .then(unwrap<FacultyActionAdminRow[]>),
  });
}

/** El catálogo completo de facultades, incluidas las que aún no se publican. */
export function useAdminFaculties() {
  return useQuery({
    queryKey: [...keys.faculties(), "admin"],
    queryFn: async (): Promise<Faculty[]> =>
      supabase.from("faculties").select("*").order("position").then(unwrap<Faculty[]>),
    staleTime: 10 * 60 * 1000,
  });
}

/* =============================================================================
   PDI por campus

   Las tablas de campus no se consultan nunca directamente: la 0017 no se las
   concede a `anon` porque llevan cifras financieras, y el enmascarado vive en
   las vistas. Aquí solo hay vistas.
   ========================================================================== */

export function useCampuses() {
  return useQuery({
    queryKey: keys.campuses(),
    queryFn: async (): Promise<Campus[]> =>
      supabase.from("campuses").select("*").order("position").then(unwrap<Campus[]>),
    // Las sedes cambian de década en década, no de minuto en minuto.
    staleTime: 30 * 60 * 1000,
  });
}

/** Una fila por sede y vigencia publicada. Es lo que alimenta el selector. */
export function useCampusSummary() {
  return useQuery({
    queryKey: keys.campusSummary(),
    queryFn: async (): Promise<CampusSummary[]> =>
      supabase
        .from("v_campus_summary")
        .select("*")
        .order("position")
        .then(unwrap<CampusSummary[]>),
  });
}

/** La matriz sede × pilar, con sus ceros: un pilar sin reporte también es dato. */
export function useCampusPillar() {
  return useQuery({
    queryKey: keys.campusPillar(),
    queryFn: async (): Promise<CampusPillarCell[]> =>
      supabase
        .from("v_campus_pillar")
        .select("*")
        .order("pillar_position")
        .then(unwrap<CampusPillarCell[]>),
  });
}

/**
 * Los hechos de una sede. Se piden por sede y no todos de golpe porque son 126
 * filas con texto largo: traerlas las tres a la vez para mostrar una sería
 * descargar el triple de lo que se mira.
 */
export function useCampusFacts(slug: string | undefined, year: number | undefined) {
  return useQuery({
    queryKey: [...keys.campusFacts(slug ?? "none"), year ?? "all"],
    enabled: Boolean(slug),
    queryFn: async (): Promise<CampusFact[]> => {
      let q = supabase.from("v_campus_facts").select("*").eq("campus_slug", slug!);
      if (year) q = q.eq("year", year);
      return q.order("position").then(unwrap<CampusFact[]>);
    },
  });
}

export function useCampusIndicators(slug: string | undefined) {
  return useQuery({
    queryKey: keys.campusIndicators(slug ?? "none"),
    enabled: Boolean(slug),
    queryFn: async (): Promise<CampusIndicator[]> =>
      supabase
        .from("v_campus_indicators")
        .select("*")
        .eq("campus_slug", slug!)
        .order("position")
        .then(unwrap<CampusIndicator[]>),
  });
}

/**
 * Las 62 líneas del plan con lo que aporta cada sede. Se pide entera —no por
 * pilar— porque la pregunta que responde es "qué parte del plan no reporta
 * nadie", y esa no se puede contestar mirando un pilar a la vez.
 */
export function useCampusCoverage() {
  return useQuery({
    queryKey: keys.campusCoverage(),
    queryFn: async (): Promise<CampusLineCoverage[]> =>
      supabase
        .from("v_campus_line_coverage")
        .select("*")
        .order("pillar_position")
        .order("area_position")
        .order("line_position")
        .then(unwrap<CampusLineCoverage[]>),
  });
}

/** Los lotes cargados. Solo intranet: la tabla no se concede a `anon`. */
export function useCampusBatches() {
  return useQuery({
    queryKey: keys.campusBatches(),
    queryFn: async (): Promise<CampusReportBatch[]> =>
      supabase
        .from("campus_report_batches")
        .select("*")
        .order("year", { ascending: false })
        .then(unwrap<CampusReportBatch[]>),
  });
}

/* =============================================================================
   Normalizar la estructura · solo intranet

   Las dos vistas están fuera del alcance de `anon`: hablan de la salud interna
   del esquema, no del plan. Sin sesión devuelven vacío, que es un fallo visible
   en vez de un dato filtrado.
   ========================================================================== */

export interface StructureAudit {
  duplicates: StructureDuplicate[];
  orphans: StructureOrphan[];
}

export function useStructureAudit() {
  return useQuery({
    queryKey: keys.structureAudit(),
    queryFn: async (): Promise<StructureAudit> => {
      const [duplicates, orphans] = await Promise.all([
        supabase
          .from("v_structure_duplicates")
          .select("*")
          .order("kind")
          .then(unwrap<StructureDuplicate[]>),
        supabase
          .from("v_structure_orphans")
          .select("*")
          .order("kind")
          .order("code")
          .then(unwrap<StructureOrphan[]>),
      ]);

      return { duplicates, orphans };
    },
  });
}
