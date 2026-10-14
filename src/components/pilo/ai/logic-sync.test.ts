import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* La función del servidor (supabase/functions/pilo-ia/index.ts) es un solo
   archivo, porque el editor de Supabase solo acepta uno, y lleva dentro una
   copia de esta logic.ts. Esta prueba falla si las dos se separan: al cambiar
   logic.ts, hay que copiarlo también en index.ts. */
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("la función pilo-ia es un solo archivo", () => {
  it("su lógica es la misma de logic.ts", () => {
    const logic = read(resolve(__dirname, "logic.ts"));
    const index = read(resolve(__dirname, "../../../../supabase/functions/pilo-ia/index.ts"));
    const marker = "========================================================================== */";
    const body = logic.slice(logic.indexOf(marker) + marker.length).replace(/^\n+|\n+$/g, "");
    const from = index.indexOf("\n", index.indexOf("también pegándola en el editor")) + 1;
    const inner = index.slice(from, index.indexOf("// --- fin de la lógica"));
    expect(inner.replace(/^\n+|\n+$/g, "")).toBe(body);
    expect(index).not.toMatch(/from "\.\/logic\.ts"/);
  });
});
