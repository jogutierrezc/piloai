import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* La función del servidor (supabase/functions/pilo-genesis/index.ts) es un solo
   archivo, porque el editor de Supabase solo acepta uno, y lleva dentro una
   copia de servidor-logica.ts. Esta prueba falla si las dos se separan: al
   cambiar servidor-logica.ts, hay que copiarlo también en index.ts. */
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("la función pilo-genesis es un solo archivo", () => {
  const logic = read(resolve(__dirname, "servidor-logica.ts"));
  const index = read(resolve(__dirname, "../../../../supabase/functions/pilo-genesis/index.ts"));

  it("su lógica es la misma de servidor-logica.ts", () => {
    const marker = "========================================================================== */";
    const body = logic.slice(logic.indexOf(marker) + marker.length).replace(/^\n+|\n+$/g, "");
    const open = index.indexOf("también pegándola en el editor del panel de Supabase.\n\n");
    const close = index.indexOf("// --- fin de la lógica");
    expect(open).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(open);
    const inner = index.slice(index.indexOf("\n", open) + 1, close);
    expect(body.length).toBeGreaterThan(1000);
    expect(inner.replace(/^\n+|\n+$/g, "")).toBe(body);
  });

  it("no importa nada local: ni la función ni su lógica", () => {
    // Solo por dirección (https://…): el editor de Supabase no tiene más archivos.
    const local = /(?:from|import)\s*\(?\s*["']\.{1,2}\//;
    expect(index).not.toMatch(local);
    expect(logic).not.toMatch(/^\s*import\b/m);
    expect([...index.matchAll(/^import\b.*$/gm)].map((m) => m[0])).toEqual(['import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";']);
  });
});
