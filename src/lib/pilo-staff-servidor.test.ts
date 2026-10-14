import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { spacesFor, STAFF_ROLES } from "./pilo-staff";
import type { PiloSpaceId } from "./pilo-staff";

/* La migración pilo_0146 y la función pilo-staff no se ejecutan aquí: se prueba
   su texto y su estructura, como con 0120 y pilo-cuentas. Lo que se comprueba:
   que la base y el contrato de src/lib/pilo-staff.ts digan lo mismo, y que cada
   función que la migración reabre por espacio sea de verdad la versión vigente
   (la última que la define en supabase/migrations) y traiga la compuerta que se
   va a cambiar. */

const root = process.cwd();
const migrations = resolve(root, "supabase/migrations");
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");
const sql = read(resolve(migrations, "pilo_0146_staff.sql"));
const fn = read(resolve(root, "supabase/functions/pilo-staff/index.ts"));
const SPACES: PiloSpaceId[] = ["planeacion", "ensenanza"];

/** Las migraciones numeradas anteriores, en orden. */
const previous = readdirSync(migrations)
  .filter((f) => /^\d{4}_.*\.sql$/.test(f))
  .sort()
  .map((f) => ({ file: f, text: read(resolve(migrations, f)) }));

/** Los parámetros de una definición (sin tipos por defecto), partiendo solo por comas de primer nivel. */
function splitParams(raw: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote = false;
  let cur = "";
  for (const ch of raw) {
    if (ch === "'") quote = !quote;
    if (!quote && (ch === "(" || ch === "[")) depth++;
    if (!quote && (ch === ")" || ch === "]")) depth--;
    if (!quote && depth === 0 && ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

interface Definition {
  file: string;
  params: string[];
  body: string;
}

/** Todas las definiciones `create or replace function public.<name>(…)` con su cuerpo, de la más vieja a la más nueva. */
function definitions(name: string): Definition[] {
  const found: Definition[] = [];
  for (const { file, text } of previous) {
    const marker = `create or replace function public.${name}(`;
    let from = 0;
    for (;;) {
      const at = text.indexOf(marker, from);
      if (at < 0) break;
      const next = text.indexOf("create or replace function ", at + marker.length);
      const chunk = text.slice(at, next < 0 ? undefined : next);
      const open = marker.length;
      let depth = 1;
      let i = open;
      for (; i < chunk.length && depth > 0; i++) {
        if (chunk[i] === "(") depth++;
        if (chunk[i] === ")") depth--;
      }
      found.push({ file, params: splitParams(chunk.slice(open, i - 1)), body: chunk });
      from = at + marker.length;
    }
  }
  return found;
}

/** La última definición con esa cantidad de parámetros: la que está instalada. */
function installed(name: string, arity: number): Definition | undefined {
  return definitions(name)
    .filter((d) => d.params.length === arity)
    .at(-1);
}

/** Las filas (función, compuerta de hoy, compuerta nueva) del bloque de la migración. */
const patches = [...sql.matchAll(/\(\$q\$(public\.[a-z_]+)\(([^)]*)\)\$q\$,\s*\$q\$(.+?)\$q\$,\s*\$q\$(.+?)\$q\$\)/gs)].map((m) => ({
  name: m[1].replace("public.", ""),
  types: m[2] === "" ? [] : m[2].split(","),
  gate: m[3],
  repl: m[4],
}));

describe("pilo_0146: la tabla y sus funciones", () => {
  it("pilo_staff lleva lo que pide el contrato", () => {
    const table = sql.slice(sql.indexOf("create table if not exists public.pilo_staff"), sql.indexOf("create unique index"));
    for (const col of ["user_id      uuid primary key references auth.users (id) on delete cascade", "email", "full_name", "role", "active", "created_at", "last_seen_at", "created_by"]) {
      expect(table, col).toContain(col);
    }
    // No cuelga de profiles: el personal de Pilo no tiene perfil de PDI.
    expect(table).not.toContain("profiles");
    const roles = [...(table.match(/role in \(([^)]+)\)/)?.[1] ?? "").matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(roles).toEqual([...STAFF_ROLES]);
  });

  it("los cuatro roles de la base son los de src/lib/pilo-staff.ts", () => {
    for (const where of [sql.match(/role in \(([^)]+)\)/g) ?? [], sql.match(/p_role not in \(([^)]+)\)/g) ?? []]) {
      expect(where.length).toBeGreaterThan(0);
      for (const clause of where) expect([...clause.matchAll(/'([a-z]+)'/g)].map((m) => m[1])).toEqual([...STAFF_ROLES]);
    }
  });

  it("pilo_can_space da, rol por rol, los espacios del contrato", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.pilo_can_space"), sql.indexOf("create or replace function public.pilo_is_service()"));
    const rule = (role: string) => body.match(new RegExp(`when '${role}' then ([^\\n]+)`))?.[1].trim() ?? "";
    expect(rule("admin")).toBe("true");
    for (const role of STAFF_ROLES.filter((r) => r !== "admin")) {
      const listed = spacesFor(role);
      const text = rule(role);
      const allowed = SPACES.filter((s) => (text.includes("in (") ? new RegExp(`'${s}'`).test(text) : text === `p_space = '${s}'`));
      expect(allowed, role).toEqual(SPACES.filter((s) => listed.includes(s)));
    }
    expect(spacesFor("admin")).toEqual(SPACES);
    expect(body).toMatch(/else false/);
  });

  it("el rol efectivo es el del contrato: la fila activa manda; si no, el admin de PDI", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.pilo_staff_role"), sql.indexOf("create or replace function public.pilo_is_admin"));
    expect(body).toContain("where s.user_id = auth.uid() and s.active");
    expect(body).toContain("case when public.has_role_at_least('admin') then 'admin' end");
    expect(body.indexOf("pilo_staff s")).toBeLessThan(body.indexOf("has_role_at_least"));
  });

  it("todas son security definer con search_path fijo, sin permiso para public ni anon", () => {
    for (const name of ["pilo_staff_role", "pilo_is_admin", "pilo_can_space", "pilo_staff_list", "pilo_staff_set", "pilo_staff_touch"]) {
      const at = sql.indexOf(`create or replace function public.${name}(`);
      expect(at, name).toBeGreaterThan(-1);
      const head = sql.slice(at, sql.indexOf("$$", at));
      expect(head, name).toContain("security definer");
      expect(head, name).toContain("set search_path = public");
      expect(sql, name).toMatch(new RegExp(`revoke all on function public\\.${name}\\([^)]*\\) from public, anon`));
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated`));
    }
    for (const name of ["pilo_staff_role", "pilo_is_admin", "pilo_can_space"]) {
      expect(sql, name).toMatch(new RegExp(`grant execute on function public\\.${name}\\([^)]*\\) to authenticated, service_role`));
    }
  });

  it("la tabla: cada persona lee la suya; el admin lee y escribe todo", () => {
    expect(sql).toContain("alter table public.pilo_staff enable row level security");
    expect(sql).toMatch(/create policy pilo_staff_own on public\.pilo_staff\s+for select to authenticated\s+using \(user_id = auth\.uid\(\)\)/);
    expect(sql).toMatch(/create policy pilo_staff_admin on public\.pilo_staff\s+for all to authenticated\s+using \(public\.pilo_is_admin\(\)\)\s+with check \(public\.pilo_is_admin\(\)\)/);
    expect(sql).toContain("revoke all on public.pilo_staff from public, anon, authenticated");
  });

  it("el último admin activo no se rebaja ni se desactiva a sí mismo (RPC y escritura directa)", () => {
    const set = sql.slice(sql.indexOf("create or replace function public.pilo_staff_set"), sql.indexOf("create or replace function public.pilo_staff_touch"));
    expect(set).toContain("p_user = auth.uid()");
    expect(set).toContain("pilo_staff_other_admins(p_user) = 0");
    expect(set).toContain("v_role <> 'admin' or not v_active");
    expect(sql).toContain("before update or delete on public.pilo_staff");
    expect(sql).toContain("old.user_id = auth.uid()");
  });

  it("handle_new_user: se parchea la instalada, sin copiarla; sin ancla avisa y no la reemplaza", () => {
    expect(sql).not.toContain("create or replace function public.handle_new_user");
    const block = sql.slice(sql.indexOf("to_regprocedure('public.handle_new_user()')") - 200, sql.indexOf("-- Altas en pilo_staff"));
    expect(block).toContain("pg_get_functiondef(v_oid)");
    expect(block).toContain("raise warning");
    expect(block).toContain("NO se reemplazó");
    expect(block).toContain("v_anchor || ' or coalesce(new.raw_user_meta_data ->> ''pilo_staff'', '''') = ''true'''");
    // El ancla es la condición de 0120.
    expect(read(resolve(migrations, "0120_pilo_usuarios.sql"))).toContain("coalesce(new.raw_user_meta_data ->> 'pilo', '') = 'true'");
  });

  it("M1: el personal de un espacio no comparte entradas con el otro Pilo", () => {
    expect(patches.map((p) => p.name)).not.toContain("pilo_catalog_share");
    const guard = sql.slice(sql.indexOf("create or replace function public.pilo_catalog_scope_guard"), sql.indexOf("create trigger pilo_catalog_scope_guard"));
    expect(guard).toContain("new.shared is distinct from old.shared");
    expect(guard).toContain("new.space is distinct from old.space");
    expect(guard).toContain("if new.shared then");
    expect(guard).toContain("auth.uid() is null or public.pilo_is_admin()");
    expect(sql).toContain("before insert or update on public.pilo_catalog");
  });

  it("M3/B1: altas controladas, cerrojo de admins y quitar por RPC con cerrojo", () => {
    const ins = sql.slice(sql.indexOf("create or replace function public.pilo_staff_check_insert"), sql.indexOf("create trigger pilo_staff_check_insert"));
    expect(ins).toContain("from auth.users a where a.id = new.user_id");
    expect(ins).toContain("from public.pilo_users u where u.id = new.user_id");
    expect(sql).toContain("before insert on public.pilo_staff");
    expect(sql.match(/pg_advisory_xact_lock\(hashtext\('pilo_staff_admins'\)\)/g)?.length).toBe(3);
    expect(sql).toMatch(/revoke all on function public\.pilo_staff_remove_row\(uuid\) from public, anon, authenticated;\s+grant execute on function public\.pilo_staff_remove_row\(uuid\) to service_role;/);
  });

  it("B3: pilo_staff_other_admins no la llama el navegador", () => {
    expect(sql).toMatch(/revoke all on function public\.pilo_staff_other_admins\(uuid\) from public, anon, authenticated;\s+grant execute on function public\.pilo_staff_other_admins\(uuid\) to service_role;/);
  });

  it("las llaves «quién lo hizo» de las tablas pilo_* dejan de exigir un perfil de PDI", () => {
    expect(sql).toContain("c.confrelid = 'public.profiles'::regclass");
    expect(sql).toContain("references auth.users (id) on delete set null");
    // Toda llave de las tablas pilo_* hacia profiles es «on delete set null» y de una sola columna: la migración las cubre todas.
    for (const { file, text } of previous) {
      for (const m of text.matchAll(/^\s*(\w+)\s+uuid\s+references public\.profiles \(id\)(.*)$/gm)) {
        if (/^create table .*\bimp_|\bnews_|\bods_/.test(file)) continue;
        expect(m[2], `${file}: ${m[1]}`).toContain("on delete set null");
      }
    }
  });
});

describe("pilo_0146: las compuertas que cambian", () => {
  it("el bloque trae las funciones de documentos que pide el encargo", () => {
    const names = patches.map((p) => p.name);
    for (const name of ["pilo_doc_save", "pilo_doc_replace", "pilo_doc_update", "pilo_doc_delete", "pilo_map_prune", "pilo_doc_outline", "pilo_catalog_import", "pilo_graph_overview"]) {
      expect(names, name).toContain(name);
    }
    expect(patches.length).toBeGreaterThan(15);
  });

  it("cada una existe, es la versión vigente y trae la compuerta de hoy", () => {
    for (const p of patches) {
      const def = installed(p.name, p.types.length);
      expect(def, `${p.name}(${p.types.join(",")}) no está en las migraciones`).toBeDefined();
      expect(def!.body, `${p.name} (${def!.file}) ya no trae «${p.gate}»`).toContain(p.gate);
    }
  });

  it("la compuerta nueva solo usa parámetros o variables que la función tiene", () => {
    for (const p of patches) {
      const def = installed(p.name, p.types.length)!;
      const names = def.params.map((x) => x.split(/\s+/)[0]);
      for (const used of p.repl.match(/\b[pv]_[a-z]+\b/g) ?? []) {
        const known = names.includes(used) || (used.startsWith("v_") && new RegExp(`\\b${used}\\b\\s+\\w+.*:=`).test(def.body));
        expect(known, `${p.name}: «${used}» en «${p.repl}»`).toBe(true);
      }
    }
  });

  it("las de por documento y por espacio usan el ayudante que corresponde", () => {
    const repl = (name: string) => patches.find((p) => p.name === name)?.repl ?? "";
    for (const name of ["pilo_doc_replace", "pilo_doc_update", "pilo_doc_delete", "pilo_doc_outline"]) expect(repl(name)).toBe("public.pilo_service_or_doc(p_doc)");
    for (const name of ["pilo_doc_save", "pilo_map_prune", "pilo_map_pending", "pilo_map_status", "pilo_map_topics", "pilo_map_save"]) expect(repl(name)).toBe("public.pilo_service_or_space(p_space)");
  });

  it("el bucket pilo-docs decide por el primer segmento de la ruta, en sus cuatro políticas", () => {
    const block = sql.slice(sql.indexOf("-- El bucket pilo-docs"), sql.indexOf("-- Las tablas que el personal lee por espacio"));
    for (const name of ["pilo_docs_lectura", "pilo_docs_escritura", "pilo_docs_cambio", "pilo_docs_borrado"]) expect(block, name).toContain(`create policy ${name} on storage.objects`);
    expect(block.match(/public\.pilo_can_space\(split_part\(name, '\/', 1\)\)/g)?.length).toBe(5);
    expect(block).not.toContain("has_role_at_least");
  });

  it("las tablas por espacio ya no piden admin a secas", () => {
    for (const table of ["pilo_docs_admin", "pilo_memory_admin", "pilo_nodes_admin", "pilo_edges_admin", "pilo_catalog_admin", "pilo_inbox_admin_read", "pilo_inbox_admin_delete", "pilo_readings_admin", "pilo_sources_admin"]) {
      const at = sql.indexOf(`create policy ${table} on`);
      expect(at, table).toBeGreaterThan(-1);
      const policy = sql.slice(at, sql.indexOf(";", at));
      expect(policy, table).toMatch(/pilo_can_space\((space|scope)\)/);
      expect(policy, table).not.toContain("has_role_at_least");
    }
    // La ficha del espacio solo se LEE por espacio; escribirla sigue siendo del admin.
    expect(sql).toMatch(/create policy pilo_spaces_staff on public\.pilo_spaces\s+for select to authenticated\s+using \(public\.pilo_can_space\(id\)\)/);
  });

  it("lo demás de Pilo sigue siendo admin: pasa a pilo_is_admin() y pilo_is_service_or_admin() lo acepta", () => {
    expect(sql).toContain("replace(r.def, 'public.has_role_at_least(''admin'')', 'public.pilo_is_admin()')");
    expect(sql).toMatch(/pilo_is_service_or_admin\(\)[\s\S]*?or public\.pilo_is_admin\(\)/);
    // El bloque general va después del de por espacio: lo que ya se abrió no lo recorre.
    expect(sql.indexOf("pilo_service_or_doc(p_doc)$q$")).toBeLessThan(sql.indexOf("replace(r.def,"));
    // pilo_staff_role es la única que conserva has_role_at_least a propósito.
    expect(sql).toContain("p.proname <> 'pilo_staff_role'");
  });

  it("Moodle, conexión, voz, usuarios y portales no se abren por espacio", () => {
    const opened = patches.map((p) => p.name).join(" ");
    for (const closed of ["moodle", "ai_set_key", "ai_key", "voz", "users", "portal", "bridge", "browser", "alert", "extras"]) expect(opened, closed).not.toContain(closed);
  });

  it("todo UPDATE y DELETE de la migración lleva WHERE (safeupdate, 0095)", () => {
    const code = sql
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    for (const m of code.matchAll(/^\s*(update public\.\w+ set[\s\S]*?;|delete from public\.\w+[\s\S]*?;)/gm)) expect(m[0], m[0]).toMatch(/\bwhere\b/i);
  });

  it("es idempotente: crea con «if not exists» o «or replace» y recrea las políticas", () => {
    for (const m of sql.matchAll(/^create (table|index|unique index|trigger|policy)\b.*$/gm)) {
      const line = m[0];
      if (m[1] === "table" || m[1].includes("index")) expect(line, line).toMatch(/if not exists/);
    }
    for (const m of sql.matchAll(/^create policy (\w+) on ([\w.]+)/gm)) expect(sql, m[1]).toContain(`drop policy if exists ${m[1]} on ${m[2]}`);
    expect(sql).toContain("drop trigger if exists pilo_staff_keep_admin on public.pilo_staff");
  });
});

describe("la función pilo-staff", () => {
  it("es un solo archivo: un solo import, por dirección", () => {
    expect([...fn.matchAll(/^import\b.*$/gm)].map((m) => m[0])).toEqual(['import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";']);
    expect(fn).not.toMatch(/(?:from|import)\s*\(?\s*["']\.{1,2}\//);
  });

  it("los roles son los del contrato", () => {
    const roles = (fn.match(/export const STAFF_ROLES = \[([^\]]+)\]/)?.[1] ?? "").split(",").map((s) => s.trim().replace(/"/g, ""));
    expect(roles).toEqual([...STAFF_ROLES]);
  });

  it("verifica el JWT y el rol por su cuenta, con la misma lógica de la base", () => {
    expect(fn).toContain("caller.auth.getUser()");
    expect(fn).toContain('caller.rpc("pilo_staff_role")');
    expect(fn).toMatch(/roleOf\.data !== "admin"/);
    // La clave de servicio solo se usa después de saber que quien llama es admin.
    expect(fn.indexOf('roleOf.data !== "admin"')).toBeLessThan(fn.indexOf("createClient(url, serviceKey"));
  });

  it("tiene las acciones invite y remove, y ninguna otra", () => {
    expect(fn).toContain('if (action !== "invite" && action !== "remove")');
    expect(fn).toContain('if (action === "invite")');
    expect([...fn.matchAll(/action === "(\w+)"/g)].map((m) => m[1])).toEqual(["invite"]);
  });

  it("el usuario nace con pilo_staff='true' y sin perfil de PDI; la fila se inserta con quien invita", () => {
    expect(fn).toContain('pilo_staff: "true"');
    expect(fn).toContain('from("pilo_staff").insert');
    expect(fn).toContain("created_by: me");
    expect(fn).toContain("resetPasswordForEmail");
  });

  it("remove solo quita a quien es personal, no deja sin admin y no borra cuentas de PDI", () => {
    expect(fn).toContain('"pilo_staff_remove_row"');
    expect(fn).not.toContain('"pilo_staff_other_admins"');
    // La cuenta solo se borra si la creó esta función.
    expect(fn).toContain("if (createdBy)");
    expect(fn).toContain('user_metadata?.pilo_staff === "true"');
    expect(fn).toContain('from("profiles").select("id")');
    expect(fn).toContain('from("pilo_users").select("id")');
    expect(fn).toContain("getUserById(target)");
  });

  it("B7: el destino sale de PILO_SITE_URL, no del Origin; a un admin no se le devuelve el enlace; un solo 409", () => {
    expect(fn).toContain('Deno.env.get("PILO_SITE_URL")');
    expect(fn).not.toContain('headers.get("Origin")');
    expect(fn).toContain('if (role === "admin") return json({ ok: true, user_id: id, sent: false, code: "sin_enlace" })');
    expect(fn.indexOf('if (role === "admin") return')).toBeLessThan(fn.indexOf("generateLink"));
    expect(fn).not.toContain('code: "cuenta"');
    expect(fn.match(/EXISTS_MESSAGE, code: "existe"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(fn).toContain('console.log(JSON.stringify({ fn: "pilo-staff"');
  });

  it("el enlace solo lleva a una ruta interna", () => {
    expect(fn).toContain('path.startsWith("//")');
    expect(fn).toContain("^\\/[A-Za-z0-9/_\\-?=&.%]*$");
  });

  it("está declarada en config.toml con verify_jwt = false y su comentario", () => {
    const toml = read(resolve(root, "supabase/config.toml"));
    const block = toml.slice(toml.indexOf("[functions.pilo-staff]"));
    expect(block).toMatch(/\[functions\.pilo-staff\]\n(#.*\n)+verify_jwt = false/);
  });
});
