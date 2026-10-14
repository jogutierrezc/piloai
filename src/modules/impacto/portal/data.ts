/* =============================================================================
   Portal de Impacto · la foto de la base (0088).

   Una sola lectura, imp_portal_snapshot(), trae lo que el portal necesita:
   fichas publicadas, dimensiones, vínculos, estructura, adopciones y cifras.
   Cualquier sesión activa la puede pedir; la base no deja salir borradores,
   notas ni evidencias.
   ========================================================================== */

import { useQuery } from "@tanstack/react-query";
import { supabase } from "../../../lib/supabase";
import { describeDatabaseError } from "../../../data/errors";
import type { DatabaseError } from "../../../data/errors";
import type { Direction, Measure, Stage, SubstantiveFunction } from "../model";

/** Lo que explica la ficha metodológica (0093). Vacío si la base aún no lo trae. */
export interface SheetFields {
  numerator: string;
  denominator: string;
  source: string;
  responsible: string;
  projectsText: string;
  /** objetivo, metodoCalculo, interpretacion, periodicidad, notas… (de la herramienta anterior). */
  sheet: Record<string, unknown>;
  baselineYear: number;
  target2028: string;
  target2028Num: number | null;
}

export interface PortalIndicator extends SheetFields {
  id: string;
  code: string;
  fn: SubstantiveFunction;
  stage: Stage;
  suggested: boolean;
  dimensionId: string | null;
  name: string;
  description: string;
  unitLabel: string;
  measure: Measure;
  direction: Direction;
  baselineNum: number | null;
  baselineText: string;
  target2026: string;
  target2026Num: number | null;
  mandatory: boolean;
}

/** Un indicador propio de un programa en una sede: va aparte de las fichas. */
export interface ProgramIndicator extends PortalIndicator {
  programId: string;
  campusId: string | null;
  parentId: string | null;
}

export interface PortalUnit {
  id: string;
  parentId: string | null;
  kind: string;
  code: string;
  name: string;
  slug: string;
}

export interface PortalValue {
  indicatorId: string;
  year: number;
  programId: string | null;
  campusId: string | null;
  valueNum: number | null;
  notApplicable: boolean;
  hasText: boolean;
}

export interface PortalData {
  indicators: PortalIndicator[];
  programIndicators: ProgramIndicator[];
  dimensions: { id: string; fn: SubstantiveFunction; name: string; position: number }[];
  refs: { indicatorId: string; dimensionId: string; stage: Stage; note: string }[];
  alignments: { indicatorId: string; target: "pilar" | "ods"; pillarId: string | null; sdg: number | null }[];
  pillars: { id: string; numeral: string; name: string }[];
  units: PortalUnit[];
  unitFunctions: { unitId: string; fn: SubstantiveFunction }[];
  campuses: { id: string; slug: string; name: string }[];
  offer: { programId: string; campusId: string }[];
  adoptions: {
    indicatorId: string;
    programId: string;
    campusId: string;
    target2026Num: number | null;
    baselineText: string;
    target2026: string;
    target2028: string;
    target2028Num: number | null;
  }[];
  values: PortalValue[];
}

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v));
const str = (v: unknown) => (typeof v === "string" ? v : "");
const list = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);

function toIndicator(r: Raw): PortalIndicator {
  const sheet = r.sheet && typeof r.sheet === "object" && !Array.isArray(r.sheet) ? (r.sheet as Record<string, unknown>) : {};
  return {
    id: str(r.id),
    code: str(r.code),
    fn: r.fn as SubstantiveFunction,
    stage: r.stage as Stage,
    suggested: Boolean(r.suggested),
    dimensionId: (r.dimension_id as string | null) ?? null,
    name: str(r.name),
    description: str(r.description),
    unitLabel: str(r.unit_label),
    measure: (r.measure as Measure) ?? "numero",
    direction: (r.direction as Direction) ?? "sube",
    baselineNum: num(r.baseline_num),
    baselineText: str(r.baseline_text),
    target2026: str(r.target_2026),
    target2026Num: num(r.target_2026_num),
    mandatory: Boolean(r.mandatory),
    numerator: str(r.numerator),
    denominator: str(r.denominator),
    source: str(r.source),
    responsible: str(r.responsible),
    projectsText: str(r.projects_text),
    sheet,
    baselineYear: Number(r.baseline_year ?? 2023) || 2023,
    target2028: str(r.target_2028),
    target2028Num: num(r.target_2028_num),
  };
}

/** Convierte la respuesta de la base en el modelo del portal. Exportada para las pruebas. */
export function toPortalData(raw: Raw): PortalData {
  return {
    indicators: list(raw.indicators).map(toIndicator),
    programIndicators: list(raw.program_indicators).map((r) => ({
      ...toIndicator(r),
      programId: str(r.program_id),
      campusId: (r.campus_id as string | null) ?? null,
      parentId: (r.parent_id as string | null) ?? null,
    })),
    dimensions: list(raw.dimensions).map((r) => ({
      id: str(r.id),
      fn: r.fn as SubstantiveFunction,
      name: str(r.name),
      position: Number(r.position ?? 0),
    })),
    refs: list(raw.refs).map((r) => ({
      indicatorId: str(r.indicator_id),
      dimensionId: str(r.dimension_id),
      stage: r.stage as Stage,
      note: str(r.note),
    })),
    alignments: list(raw.alignments).map((r) => ({
      indicatorId: str(r.indicator_id),
      target: r.target as "pilar" | "ods",
      pillarId: (r.pillar_id as string | null) ?? null,
      sdg: num(r.sdg),
    })),
    pillars: list(raw.pillars).map((r) => ({ id: str(r.id), numeral: str(r.numeral), name: str(r.name) })),
    units: list(raw.units).map((r) => ({
      id: str(r.id),
      parentId: (r.parent_id as string | null) ?? null,
      kind: str(r.kind),
      code: str(r.code),
      name: str(r.name),
      slug: str(r.slug),
    })),
    unitFunctions: list(raw.unit_functions).map((r) => ({ unitId: str(r.unit_id), fn: r.fn as SubstantiveFunction })),
    campuses: list(raw.campuses).map((r) => ({ id: str(r.id), slug: str(r.slug), name: str(r.name) })),
    offer: list(raw.offer).map((r) => ({ programId: str(r.program_id), campusId: str(r.campus_id) })),
    adoptions: list(raw.adoptions).map((r) => ({
      indicatorId: str(r.indicator_id),
      programId: str(r.program_id),
      campusId: str(r.campus_id),
      target2026Num: num(r.target_2026_num),
      baselineText: str(r.baseline_text),
      target2026: str(r.target_2026),
      target2028: str(r.target_2028),
      target2028Num: num(r.target_2028_num),
    })),
    values: list(raw.values).map((r) => ({
      indicatorId: str(r.indicator_id),
      year: Number(r.year),
      programId: (r.program_id as string | null) ?? null,
      campusId: (r.campus_id as string | null) ?? null,
      valueNum: num(r.value_num),
      notApplicable: Boolean(r.not_applicable),
      hasText: Boolean(r.has_text),
    })),
  };
}

/** Sin la migración 0088 la función no existe: el portal lo dice en vez de fallar. */
export class PortalMissingError extends Error {
  constructor() {
    super("El portal de Impacto necesita la migración 0088 en la base.");
  }
}

export function usePortalData() {
  return useQuery({
    queryKey: ["impacto", "portal"],
    staleTime: 5 * 60_000,
    // Sin la migración no hay nada que reintentar.
    retry: (count, error) => !(error instanceof PortalMissingError) && count < 2,
    queryFn: async (): Promise<PortalData> => {
      const { data, error } = (await supabase.rpc("imp_portal_snapshot")) as { data: Raw | null; error: DatabaseError | null };
      if (error) {
        if (["PGRST202", "42883"].includes(error.code ?? "")) throw new PortalMissingError();
        throw describeDatabaseError(error);
      }
      return toPortalData(data ?? {});
    },
  });
}
