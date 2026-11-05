import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./index.css";
import { Layout } from "./components/Layout";
import { Spinner, ToastProvider } from "./components/ui";
import { AuthProvider, useAuth } from "./lib/auth";
import Browse from "./pages/Browse";
import Home from "./pages/Home";
import IssueDetail from "./pages/IssueDetail";
import Report from "./pages/Report";
import SignIn from "./pages/SignIn";
import Stats from "./pages/Stats";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { me, ready } = useAuth();
  const loc = useLocation();
  if (!ready) return <div className="flex justify-center py-24 text-ink-3"><Spinner size={24} /></div>;
  if (!me) return <Navigate to={`/signin?next=${encodeURIComponent(loc.pathname)}`} replace />;
  return <>{children}</>;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route element={<Layout />}>
              <Route index element={<Home />} />
              <Route path="issues" element={<Browse />} />
              <Route path="issues/:id" element={<IssueDetail />} />
              <Route path="stats" element={<Stats />} />
              <Route path="signin" element={<SignIn />} />
              <Route path="report" element={<RequireAuth><Report /></RequireAuth>} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
