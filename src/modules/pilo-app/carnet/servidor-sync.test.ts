import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/* La función del servidor (supabase/functions/pilo-carnet/index.ts) es un solo
   archivo, porque el editor de Supabase solo acepta uno, y lleva dentro una
   copia de servidor-logica.ts. Esta prueba falla si las dos se separan: al
   cambiar servidor-logica.ts, hay que copiarlo también en index.ts.
   También vigila que los contadores del límite sigan siendo los de pilo-ia. */
const read = (path: string) => readFileSync(path, "utf8").replace(/\r\n/g, "\n");

describe("la función pilo-carnet es un solo archivo", () => {
  const logic = read(resolve(__dirname, "servidor-logica.ts"));
  const index = read(resolve(__dirname, "../../../../supabase/functions/pilo-carnet/index.ts"));

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
    const local = /(?:from|import)\s*\(?\s*["']\.{1,2}\//;
    expect(index).not.toMatch(local);
    expect(logic).not.toMatch(/^\s*import\b/m);
    expect([...index.matchAll(/^import\b.*$/gm)].map((m) => m[0])).toEqual(['import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";']);
  });

  it("ningún secreto va escrito en la función", () => {
    expect(index).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----[A-Za-z0-9+/=\s]{40,}/);
    expect(index).not.toMatch(/PILO_CARNET_SECRET\s*=\s*["'`]/);
  });

  it("los contadores del límite son los de pilo-ia (misma ventana y misma huella)", () => {
    const ia = read(resolve(__dirname, "../../../../supabase/functions/pilo-ia/index.ts"));
    const squash = (s: string) => s.replace(/\s+/g, " ").trim();
    // rateWindow: el cuerpo idéntico.
    const windowBody = (src: string) => src.match(/export function rateWindow\([^)]*\)[^{]*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(squash(windowBody(logic))).not.toBe("");
    expect(squash(windowBody(logic))).toBe(squash(windowBody(ia)));
    // visitorSeed: las dos plantillas de la huella.
    expect(ia).toContain("space === DEFAULT_SPACE ? `${salt}|${day}|${scope}|${key}` : `${salt}|${day}|${scope}|${space}|${key}`");
    expect(logic).toContain('space === "planeacion" ? `${salt}|${day}|${scope}|${key}` : `${salt}|${day}|${scope}|${space}|${key}`');
    expect(ia).toMatch(/const DEFAULT_SPACE[^=]*=\s*"planeacion"/);
    // La clave por cuenta de Pilo y el recorte de la huella.
    expect(ia).toContain("`m:${memberId}`");
    expect(ia).toContain("(await sha256(visitorSeed(salt, day, scope, key, space))).slice(0, 40)");
  });
});
