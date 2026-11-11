import "@fontsource-variable/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
import { ReplayProvider } from "./lib/replay";
import { SiteProvider } from "./lib/site";
import { ToastProvider } from "./lib/toast";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => count < 2 && (err as { status?: number }).status !== 404,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <SiteProvider>
          <ReplayProvider>
            <ToastProvider>
              <App />
            </ToastProvider>
          </ReplayProvider>
        </SiteProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
