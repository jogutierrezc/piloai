import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Los navegadores que soportan módulos ES soportan todo lo que usa el
    // portal (color-mix, :has, aspect-ratio). Bajar el objetivo solo añadiría
    // transpilación que nadie va a ejecutar.
    target: "es2020",
    rollupOptions: {
      output: {
        // Estas tres dependencias cambian mucho menos que el código del
        // portal. En archivos propios, publicar una versión nueva del sitio no
        // invalida su caché en los navegadores que ya las tienen.
        manualChunks: {
          vendor: ["react", "react-dom", "react-router-dom"],
          supabase: ["@supabase/supabase-js"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});
