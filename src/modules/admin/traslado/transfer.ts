/* =============================================================================
   Traslado de datos entre servidores.

   Importar tabla por tabla desde el panel de Supabase falla con «violates
   foreign key»: las tablas dependen unas de otras, el destino trae su propia
   semilla con otros ids y los perfiles apuntan a cuentas que allí no existen.
   Aquí el traslado se hace completo y en el orden que lo resuelve, apoyado en
   las funciones de la migración 0062:

     1. Leer el origen: cada tabla por páginas y, si se quiere, los archivos
        de Storage. El resultado es un respaldo que se puede descargar como
        .zip o cargar directamente en este servidor.
     2. Emparejar los perfiles del origen con las cuentas del destino por
        correo. Quien no tenga cuenta aquí queda en el informe.
     3. Vaciar y llenar cada tabla con las llaves foráneas apagadas.
     4. Revisar cada llave foránea: ids de usuario traducidos, y lo que siga
        apuntando a nada se anula o se retira.
     5. Poner al día las secuencias y subir los archivos.

   Cada paso es una llamada corta: el rol authenticated corta a los 8 s.
   ========================================================================== */

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Zippable } from "fflate";
import { supabase } from "../../../lib/supabase";
import { describeDatabaseError } from "../../../data/errors";
import type { DatabaseError } from "../../../data/errors";

export const BACKUP_FORMAT = "pdi-respaldo";
const PAGE_ROWS = 2000;
/** Tope de cada envío. Cabe holgado en el cuerpo que acepta la API. */
const CHUNK_BYTES = 900_000;
const CHUNK_ROWS = 1000;
const FILE_CONCURRENCY = 4;
const REPAIR_PASSES = 6;

type Row = Record<string, unknown>;

export interface TableInfo {
  table: string;
  rows: number;
  columns: string[];
}

export interface BackupFile {
  bucket: string;
  path: string;
  size: number;
  mimetype: string | null;
  bytes: Uint8Array;
}

export interface Backup {
  source: string;
  createdAt: string;
  tables: Record<string, Row[]>;
  columns: Record<string, string[]>;
  files: BackupFile[];
  /** Archivos que no se pudieron leer del origen. */
  fileErrors: string[];
}

export interface Progress {
  step: string;
  done: number;
  total: number;
}

export type OnProgress = (progress: Progress) => void;

async function rpc<T>(client: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await client.rpc(fn, args);
  if (error) {
    const friendly = describeDatabaseError(error as DatabaseError);
    // Sin 0062 la función no existe: dicho así se entiende qué falta.
    if (error.code === "PGRST202" || /could not find the function/i.test(error.message)) {
      throw new Error("El servidor no tiene las funciones de traslado. Aplica la migración 0062_traslado_de_datos.sql en él.");
    }
    throw new Error(`${friendly.message}${friendly.advice ? ` ${friendly.advice}` : ""}`);
  }
  return data as T;
}

/* --- Origen: otro servidor ---------------------------------------------------- */

/**
 * Un cliente aparte, sin guardar sesión, para no pisar la de este servidor:
 * las dos conviven en la misma pestaña.
 */
export async function connectSource(url: string, anonKey: string, email: string, password: string) {
  const client = createClient(url.trim().replace(/\/+$/, ""), anonKey.trim(), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "pdi-traslado-origen" },
  });
  const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(`No se pudo entrar al servidor de origen: ${error.message}`);
  return client;
}

/* --- Leer ------------------------------------------------------------------- */

export function inventory(client: SupabaseClient = supabase) {
  return rpc<TableInfo[]>(client, "data_transfer_inventory");
}

export async function readBackup(
  client: SupabaseClient,
  options: { source: string; includeFiles: boolean },
  onProgress: OnProgress,
): Promise<Backup> {
  const tables = await inventory(client);
  const totalRows = tables.reduce((sum, t) => sum + t.rows, 0);
  const backup: Backup = {
    source: options.source,
    createdAt: new Date().toISOString(),
    tables: {},
    columns: {},
    files: [],
    fileErrors: [],
  };

  let read = 0;
  for (const info of tables) {
    const rows: Row[] = [];
    for (let offset = 0; ; offset += PAGE_ROWS) {
      onProgress({ step: `Leyendo ${info.table}`, done: read, total: totalRows });
      const page = await rpc<Row[]>(client, "data_transfer_export", {
        p_table: info.table,
        p_offset: offset,
        p_limit: PAGE_ROWS,
      });
      rows.push(...page);
      read += page.length;
      if (page.length < PAGE_ROWS) break;
    }
    backup.tables[info.table] = rows;
    backup.columns[info.table] = info.columns;
  }

  if (options.includeFiles) {
    const listed = await rpc<Omit<BackupFile, "bytes">[]>(client, "data_transfer_files");
    let done = 0;
    await eachLimited(listed, FILE_CONCURRENCY, async (file) => {
      onProgress({ step: "Descargando archivos", done, total: listed.length });
      const { data, error } = await client.storage.from(file.bucket).download(file.path);
      if (error || !data) backup.fileErrors.push(`${file.bucket}/${file.path}`);
      else backup.files.push({ ...file, bytes: new Uint8Array(await data.arrayBuffer()) });
      done += 1;
    });
  }

  return backup;
}

/* --- El respaldo como archivo --------------------------------------------------- */

interface Manifest {
  format: typeof BACKUP_FORMAT;
  version: 1;
  source: string;
  created_at: string;
  tables: { table: string; rows: number; columns: string[] }[];
  files: { bucket: string; path: string; size: number; mimetype: string | null }[];
}

export function backupToZip(backup: Backup): Blob {
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    version: 1,
    source: backup.source,
    created_at: backup.createdAt,
    tables: Object.entries(backup.tables).map(([table, rows]) => ({
      table,
      rows: rows.length,
      columns: backup.columns[table] ?? [],
    })),
    files: backup.files.map(({ bucket, path, size, mimetype }) => ({ bucket, path, size, mimetype })),
  };

  const zip: Zippable = { "respaldo.json": strToU8(JSON.stringify(manifest, null, 2)) };
  for (const [table, rows] of Object.entries(backup.tables)) {
    zip[`tablas/${table}.json`] = strToU8(JSON.stringify(rows));
  }
  // Imágenes y PDF ya vienen comprimidos: se guardan tal cual.
  for (const file of backup.files) {
    zip[`archivos/${file.bucket}/${file.path}`] = [file.bytes, { level: 0 }];
  }
  const bytes = zipSync(zip, { level: 6 });
  return new Blob([bytes as BlobPart], { type: "application/zip" });
}

export async function zipToBackup(file: File): Promise<Backup> {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(new Uint8Array(await file.arrayBuffer()));
  } catch {
    throw new Error("El archivo no es un .zip válido.");
  }
  const raw = entries["respaldo.json"];
  if (!raw) throw new Error("El .zip no es un respaldo del portal: le falta respaldo.json.");
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  if (manifest.format !== BACKUP_FORMAT) throw new Error("El .zip no es un respaldo del portal.");

  const backup: Backup = {
    source: manifest.source,
    createdAt: manifest.created_at,
    tables: {},
    columns: {},
    files: [],
    fileErrors: [],
  };
  for (const info of manifest.tables) {
    const data = entries[`tablas/${info.table}.json`];
    backup.tables[info.table] = data ? (JSON.parse(strFromU8(data)) as Row[]) : [];
    backup.columns[info.table] = info.columns;
  }
  for (const info of manifest.files) {
    const bytes = entries[`archivos/${info.bucket}/${info.path}`];
    if (bytes) backup.files.push({ ...info, bytes });
    else backup.fileErrors.push(`${info.bucket}/${info.path}`);
  }
  return backup;
}

/* --- Qué pasará antes de tocar nada ----------------------------------------------- */

export interface PlanRow {
  table: string;
  incoming: number;
  current: number;
  /** Columnas del origen que este servidor no tiene: se descartan. */
  droppedColumns: string[];
}

export interface Plan {
  rows: PlanRow[];
  /** Tablas del respaldo que aquí no existen. */
  unknown: string[];
  /** Tablas de aquí que el respaldo no trae: quedan como están. */
  untouched: string[];
}

export function makePlan(backup: Backup, target: TableInfo[]): Plan {
  const byName = new Map(target.map((t) => [t.table, t]));
  const rows: PlanRow[] = [];
  const unknown: string[] = [];
  for (const [table, data] of Object.entries(backup.tables)) {
    const here = byName.get(table);
    if (!here) {
      unknown.push(table);
      continue;
    }
    const columns = new Set(here.columns);
    rows.push({
      table,
      incoming: data.length,
      current: here.rows,
      droppedColumns: (backup.columns[table] ?? []).filter((c) => !columns.has(c)),
    });
  }
  const untouched = target.map((t) => t.table).filter((t) => !(t in backup.tables));
  return { rows, unknown, untouched };
}

/* --- Escribir ----------------------------------------------------------------- */

export interface ImportReport {
  loaded: { table: string; sent: number; inserted: number }[];
  missingUsers: string[];
  repaired: { table: string; name: string; remapped: number; nulled: number; deleted: number }[];
  sequences: number;
  filesUploaded: number;
  fileErrors: string[];
}

interface RepairResult {
  remapped: number;
  nulled: number;
  deleted: number;
}

export async function importBackup(backup: Backup, plan: Plan, onProgress: OnProgress): Promise<ImportReport> {
  const report: ImportReport = {
    loaded: [],
    missingUsers: [],
    repaired: [],
    sequences: 0,
    filesUploaded: 0,
    fileErrors: [...backup.fileErrors],
  };
  const tables = plan.rows.map((r) => r.table);
  const dataTables = tables.filter((t) => t !== "profiles");
  const totalRows = plan.rows.reduce((sum, r) => sum + r.incoming, 0);

  onProgress({ step: "Preparando", done: 0, total: 1 });
  await rpc(supabase, "data_transfer_start");

  // 1. Perfiles: se emparejan, no se borran.
  const profiles = tables.includes("profiles") ? backup.tables.profiles ?? [] : [];
  if (profiles.length > 0) {
    let mapped = 0;
    for (const chunk of chunks(profiles)) {
      onProgress({ step: "Emparejando usuarios", done: mapped, total: profiles.length });
      const result = await rpc<{ mapped: number; missing: string[] }>(supabase, "data_transfer_profiles", {
        p_rows: chunk,
      });
      mapped += result.mapped;
      report.missingUsers.push(...result.missing);
    }
    report.loaded.push({ table: "profiles", sent: profiles.length, inserted: mapped });
  }

  // 2. Vaciar.
  for (const [index, table] of dataTables.entries()) {
    onProgress({ step: `Vaciando ${table}`, done: index, total: dataTables.length });
    await rpc(supabase, "data_transfer_wipe", { p_table: table });
  }

  // 3. Llenar.
  let written = 0;
  for (const table of dataTables) {
    const rows = backup.tables[table] ?? [];
    let inserted = 0;
    for (const chunk of chunks(rows)) {
      onProgress({ step: `Cargando ${table}`, done: written, total: totalRows });
      inserted += await rpc<number>(supabase, "data_transfer_load", { p_table: table, p_rows: chunk });
      written += chunk.length;
    }
    report.loaded.push({ table, sent: rows.length, inserted });
  }

  // 4. Reparar referencias. Retirar una fila puede dejar huérfanas a otras, así
  //    que se repite hasta que una vuelta no retire nada.
  const links = await rpc<{ table: string; name: string }[]>(supabase, "data_transfer_links");
  const totals = new Map<string, ImportReport["repaired"][number]>();
  for (let pass = 0; pass < REPAIR_PASSES; pass++) {
    let deleted = 0;
    for (const [index, link] of links.entries()) {
      onProgress({ step: `Revisando referencias (vuelta ${pass + 1})`, done: index, total: links.length });
      const result = await rpc<RepairResult>(supabase, "data_transfer_repair", {
        p_table: link.table,
        p_constraint: link.name,
        p_remap: pass === 0,
      });
      deleted += result.deleted;
      if (result.remapped || result.nulled || result.deleted) {
        const key = `${link.table}.${link.name}`;
        const entry = totals.get(key) ?? { ...link, remapped: 0, nulled: 0, deleted: 0 };
        entry.remapped += result.remapped;
        entry.nulled += result.nulled;
        entry.deleted += result.deleted;
        totals.set(key, entry);
      }
    }
    if (deleted === 0) break;
  }
  report.repaired = [...totals.values()];

  onProgress({ step: "Ajustando secuencias", done: 0, total: 1 });
  const finish = await rpc<{ sequences: number }>(supabase, "data_transfer_finish");
  report.sequences = finish.sequences;

  // 5. Archivos: se suben encima de lo que haya con la misma ruta.
  let done = 0;
  await eachLimited(backup.files, FILE_CONCURRENCY, async (file) => {
    onProgress({ step: "Subiendo archivos", done, total: backup.files.length });
    const { error } = await supabase.storage.from(file.bucket).upload(file.path, file.bytes, {
      upsert: true,
      contentType: file.mimetype ?? undefined,
    });
    if (error) report.fileErrors.push(`${file.bucket}/${file.path}: ${error.message}`);
    else report.filesUploaded += 1;
    done += 1;
  });

  return report;
}

/* --- Utilidades -------------------------------------------------------------------- */

function* chunks(rows: Row[]): Generator<Row[]> {
  let current: Row[] = [];
  let bytes = 0;
  for (const row of rows) {
    const size = JSON.stringify(row).length;
    if (current.length > 0 && (bytes + size > CHUNK_BYTES || current.length >= CHUNK_ROWS)) {
      yield current;
      current = [];
      bytes = 0;
    }
    current.push(row);
    bytes += size;
  }
  if (current.length > 0) yield current;
}

async function eachLimited<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await work(item);
    }
  });
  await Promise.all(workers);
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function backupName(source: string) {
  const host = source.replace(/^https?:\/\//, "").split(".")[0] || "servidor";
  return `respaldo-${host}-${new Date().toISOString().slice(0, 10)}.zip`;
}
