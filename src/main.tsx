import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { ThemeProvider } from "./lib/theme";
import { AuthProvider } from "./lib/auth";
import { isRetryable } from "./data/errors";
import { reloadOnceOnStalePreload } from "./lib/stale-chunk";
import { enterAppIfNative, startNative } from "./modules/pilo-app/native";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/app.css";

// Dentro de la app de Android, «/» abre Pilo (/app).
enterAppIfNative();

// Una pestaña que quedó abierta antes de publicar pide archivos que ya no existen: se recarga una vez.
reloadOnceOnStalePreload();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => isRetryable(error) && failureCount < 2,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ThemeProvider>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);

void startNative();
