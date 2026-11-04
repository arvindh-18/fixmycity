import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import { AuthProvider } from "@/contexts/AuthContext";
import { RealtimeProvider } from "@/contexts/RealtimeContext";
import App from "./App";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 20_000, retry: (n, err: any) => n < 2 && !(err?.status >= 400 && err?.status < 500), refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <RealtimeProvider>
            <App />
            <Toaster position="top-center" toastOptions={{ style: { fontFamily: "var(--font-sans)", borderRadius: 10 } }} />
          </RealtimeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
