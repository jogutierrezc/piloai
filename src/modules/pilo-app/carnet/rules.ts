/* =============================================================================
   Mr. Pilo · carnet · los datos del perfil, por perfil de la cuenta.

   Espejo de lo que valida la base (0141, pilo_user_perfil): qué datos pide cada
   perfil, cuáles son obligatorios, cómo se valida cada uno y cuándo está listo
   el carnet. La pantalla valida con esto para avisar pronto; quien decide de
   verdad es la base.

   Los datos sensibles y opcionales (código, RH) llevan «Mostrarlo en el carnet»:
   sin ese permiso no salen en la tarjeta. Nunca viajan en el código QR, en
   Google Wallet ni en la verificación para terceros.

   Puro: se prueba en node.
   ========================================================================== */

import type { PiloRol } from "../account/rules";
import { perfilLine } from "./servidor-logica";

export type PerfilKey = "programa" | "semestre" | "jornada" | "facultad" | "vinculacion" | "dependencia" | "cargo" | "codigo" | "rh" | "contacto";
export type ShowKey = "show_codigo" | "show_rh";

export interface PerfilField {
  key: PerfilKey;
  label: string;
  kind: "text" | "pick" | "seg";
  options?: { id: string; label: string }[];
  example?: string;
  required: boolean;
  /** «Mostrarlo en el carnet». */
  show?: ShowKey;
}

const SEMESTRES = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), label: String(i + 1) }));
export const RH_OPTIONS = ["O+", "O-", "A+", "A-", "B+", "B-", "AB+", "AB-"].map((id) => ({ id, label: id.replace("-", "−") }));

export const PERFIL_FIELDS: Record<PiloRol, PerfilField[]> = {
  estudiante: [
    { key: "programa", label: "Programa académico", kind: "text", example: "Ingeniería de Software", required: true },
    { key: "semestre", label: "Semestre", kind: "pick", options: SEMESTRES, required: true },
    { key: "jornada", label: "Jornada", kind: "seg", options: [{ id: "diurna", label: "Diurna" }, { id: "nocturna", label: "Nocturna" }], required: true },
    { key: "codigo", label: "Código de estudiante", kind: "text", example: "2260000", required: false, show: "show_codigo" },
  ],
  profesor: [
    { key: "facultad", label: "Facultad", kind: "text", example: "Ingenierías", required: true },
    { key: "vinculacion", label: "Vinculación", kind: "seg", options: [{ id: "planta", label: "Planta" }, { id: "ocasional", label: "Ocasional" }, { id: "catedra", label: "Cátedra" }], required: true },
    { key: "codigo", label: "Código de docente", kind: "text", example: "10020", required: false, show: "show_codigo" },
  ],
  administrativo: [
    { key: "dependencia", label: "Dependencia", kind: "text", example: "Planeación Institucional", required: true },
    { key: "cargo", label: "Cargo", kind: "text", example: "Profesional", required: true },
    { key: "codigo", label: "Código de funcionario", kind: "text", example: "3040", required: false, show: "show_codigo" },
  ],
};

export const COMMON_FIELDS: PerfilField[] = [
  { key: "rh", label: "Tipo de sangre (RH)", kind: "pick", options: RH_OPTIONS, required: false, show: "show_rh" },
  { key: "contacto", label: "Contacto de emergencia", kind: "text", example: "Nombre y teléfono", required: false },
];

export const PERFIL_KEYS: PerfilKey[] = ["programa", "semestre", "jornada", "facultad", "vinculacion", "dependencia", "cargo", "codigo", "rh", "contacto"];

export const fieldsOf = (rol: PiloRol): PerfilField[] => [...PERFIL_FIELDS[rol], ...COMMON_FIELDS];

/** Lo que la persona escribe: todo texto, y los dos permisos de «mostrar». */
export type PerfilForm = Record<PerfilKey, string> & Record<ShowKey, boolean>;

export const emptyPerfil = (): PerfilForm => ({
  programa: "",
  semestre: "",
  jornada: "",
  facultad: "",
  vinculacion: "",
  dependencia: "",
  cargo: "",
  codigo: "",
  rh: "",
  contacto: "",
  show_codigo: false,
  show_rh: false,
});

export interface PerfilLoaded {
  form: PerfilForm;
  /** El carnet fue suspendido por pérdida (lo escribe el servidor). */
  suspendido: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");

/** La fila de la base (o nada) hecha formulario. */
export function parsePerfil(row: unknown): PerfilLoaded {
  const r = (row && typeof row === "object" ? row : {}) as Record<string, unknown>;
  const form = emptyPerfil();
  for (const key of Object.keys(form) as (keyof PerfilForm)[]) {
    if (key === "show_codigo" || key === "show_rh") form[key] = r[key] === true;
    else form[key] = str(r[key]);
  }
  return { form, suspendido: typeof r.suspendido_en === "string" && r.suspendido_en.length > 0 };
}

const clean = (v: string) => v.replace(/\s+/g, " ").trim();

/** Lo que se envía a la base: solo las columnas que la persona puede escribir; lo vacío, null. */
export function perfilRow(userId: string, rol: PiloRol, form: PerfilForm): Record<string, unknown> {
  const own = new Set<string>(fieldsOf(rol).map((f) => f.key));
  const row: Record<string, unknown> = { user_id: userId };
  for (const key of PERFIL_KEYS) {
    const value = own.has(key) ? clean(form[key]) : "";
    row[key] = value === "" ? null : key === "semestre" ? Number(value) : value;
  }
  row.show_codigo = form.show_codigo && clean(form.codigo) !== "";
  row.show_rh = form.show_rh && clean(form.rh) !== "";
  return row;
}

/** Cuántos datos obligatorios hay y cuántos están. */
export function progress(rol: PiloRol, form: PerfilForm): { ok: number; total: number; full: boolean } {
  const required = PERFIL_FIELDS[rol].filter((f) => f.required);
  const ok = required.filter((f) => clean(form[f.key]) !== "").length;
  return { ok, total: required.length, full: ok === required.length };
}

const CODE = /^[0-9A-Za-z-]{3,20}$/;

/** Qué le falta a un dato, o "" si sirve. */
export function problemOf(field: PerfilField, raw: string): string {
  const value = clean(raw);
  if (!value) return field.required ? "Falta este dato." : "";
  if (field.key === "codigo") return CODE.test(value) ? "" : "El código lleva de 3 a 20 letras, números o guiones.";
  if (field.kind === "text") {
    if (value.length < (field.key === "contacto" ? 3 : 2)) return "Escríbalo completo.";
    if (value.length > 120) return "Es demasiado largo: hasta 120 caracteres.";
  }
  return "";
}

export function problems(rol: PiloRol, form: PerfilForm): Partial<Record<PerfilKey, string>> {
  const out: Partial<Record<PerfilKey, string>> = {};
  for (const f of fieldsOf(rol)) {
    const p = problemOf(f, form[f.key]);
    if (p) out[f.key] = p;
  }
  return out;
}

/** «Ingeniería de Software · 5.º semestre»; "" si aún no hay datos. */
export function detailLine(rol: PiloRol, form: PerfilForm): string {
  return perfilLine(rol, {
    programa: clean(form.programa) || null,
    semestre: form.semestre ? Number(form.semestre) : null,
    facultad: clean(form.facultad) || null,
    vinculacion: form.vinculacion || null,
    dependencia: clean(form.dependencia) || null,
    cargo: clean(form.cargo) || null,
  });
}

/** Los cuatro últimos del código, para la tarjeta. */
export const codeTail = (codigo: string): string => `···· ${clean(codigo).slice(-4)}`;

export const rhLabel = (rh: string): string => rh.replace("-", "−");

/** ¿Hay algo sin guardar? */
export function sameForm(a: PerfilForm, b: PerfilForm): boolean {
  return (Object.keys(a) as (keyof PerfilForm)[]).every((k) => (typeof a[k] === "string" ? clean(a[k] as string) === clean(b[k] as string) : a[k] === b[k]));
}
