/* =============================================================================
   Personal administrativo de Pilo: el contrato de roles.

   Pilo comparte base con PDI, pero su personal es aparte: vive en `pilo_staff`
   (migración pilo_0146), no en `profiles`. Este archivo es lo único que sabe
   qué puede hacer cada rol; la interfaz (menú, guardas, dashboard) y las
   pruebas lo leen de aquí. La autorización real está en las políticas RLS: lo
   que se decide aquí solo muestra u oculta interfaz.

   Roles:
     docencia       carga documental del espacio «ensenanza» (Pilo Enseñanza)
     institucional  carga documental del espacio «planeacion» (Pilo Universidad)
     ambos          los dos anteriores
     admin          todo: conexión, voz, usuarios, personal y los dos espacios

   Quien ya es admin en PDI (`profiles.role = 'admin'`) entra como `admin` de
   Pilo sin fila en pilo_staff: ver `effectiveStaffRole`.
   ========================================================================== */

export type PiloStaffRole = "docencia" | "institucional" | "ambos" | "admin";

/** Los dos Pilos. Coincide con `pilo_spaces.id` y con el CHECK de `space`. */
export type PiloSpaceId = "planeacion" | "ensenanza";

/** Cada zona de la administración; el menú y las guardas preguntan por zona. */
export type StaffArea =
  | "inicio"        // el dashboard
  | "documentos"    // subir y gestionar documentos de la memoria
  | "catalogo"      // respuestas oficiales
  | "memoria"       // fuentes, malla, actualizar la memoria
  | "conexion"      // proveedor de IA, claves, voz, uso
  | "portales"      // dónde aparece Pilo
  | "usuarios"      // cuentas de Pilo (estudiantes, profesores…)
  | "emergencias"   // alertas de Aluna
  | "personal";     // este mismo personal y sus roles

export const STAFF_ROLES: readonly PiloStaffRole[] = ["docencia", "institucional", "ambos", "admin"];

export const staffRoleLabels: Record<PiloStaffRole, string> = {
  docencia: "Docencia",
  institucional: "Institucional",
  ambos: "Docencia e Institucional",
  admin: "Administrador",
};

export const staffRoleDescriptions: Record<PiloStaffRole, string> = {
  docencia: "Carga y gestiona los documentos de Pilo Enseñanza.",
  institucional: "Carga y gestiona los documentos de Pilo Universidad.",
  ambos: "Carga y gestiona los documentos de los dos Pilos.",
  admin: "Todo lo anterior, más conexión, voz, usuarios y personal.",
};

const SPACES_BY_ROLE: Record<PiloStaffRole, readonly PiloSpaceId[]> = {
  docencia: ["ensenanza"],
  institucional: ["planeacion"],
  ambos: ["planeacion", "ensenanza"],
  admin: ["planeacion", "ensenanza"],
};

/** Zonas que abre cada rol, además de las del espacio. */
const AREAS_BY_ROLE: Record<PiloStaffRole, readonly StaffArea[]> = {
  docencia: ["inicio", "documentos", "catalogo", "memoria"],
  institucional: ["inicio", "documentos", "catalogo", "memoria"],
  ambos: ["inicio", "documentos", "catalogo", "memoria"],
  admin: ["inicio", "documentos", "catalogo", "memoria", "conexion", "portales", "usuarios", "emergencias", "personal"],
};

export function isStaffRole(value: unknown): value is PiloStaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Los espacios en los que este rol puede cargar documentos. */
export function spacesFor(role: PiloStaffRole | null): readonly PiloSpaceId[] {
  return role ? SPACES_BY_ROLE[role] : [];
}

export function canWorkInSpace(role: PiloStaffRole | null, space: PiloSpaceId): boolean {
  return spacesFor(role).includes(space);
}

export function canUseArea(role: PiloStaffRole | null, area: StaffArea): boolean {
  return role ? AREAS_BY_ROLE[role].includes(area) : false;
}

/**
 * El rol con el que se trabaja. Una fila activa de pilo_staff manda; sin ella,
 * un admin de PDI (`profiles.role = 'admin'` y activo) entra como admin de Pilo.
 * Cualquier otra cosa: sin acceso (null).
 */
export function effectiveStaffRole(input: {
  staff: { role: PiloStaffRole; active: boolean } | null;
  pdiAdmin: boolean;
}): PiloStaffRole | null {
  if (input.staff?.active) return input.staff.role;
  return input.pdiAdmin ? "admin" : null;
}

/** Fila de `pilo_staff` tal como la devuelve la base. */
export interface PiloStaffRow {
  user_id: string;
  email: string;
  full_name: string;
  role: PiloStaffRole;
  active: boolean;
  created_at: string;
  last_seen_at: string | null;
}
