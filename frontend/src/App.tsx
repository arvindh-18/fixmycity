import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { useAuth } from "@/contexts/AuthContext";
import type { Role } from "@/types";
import { PublicLayout } from "@/layouts/PublicLayout";
import { AdminLayout } from "@/layouts/AdminLayout";
import { WorkerLayout } from "@/layouts/WorkerLayout";
import { Spinner, EmptyState, Button } from "@/components/ui";
import { Link } from "react-router-dom";

// Route-level code splitting keeps the first load small (the map and charts load on demand).
const Landing = lazy(() => import("@/pages/Landing"));
const MapPage = lazy(() => import("@/pages/MapPage"));
const IssuesBrowse = lazy(() => import("@/pages/IssuesBrowse"));
const IssuePage = lazy(() => import("@/pages/IssuePage"));
const ReportPage = lazy(() => import("@/pages/ReportPage"));
const TrackPage = lazy(() => import("@/pages/TrackPage"));
const Transparency = lazy(() => import("@/pages/Transparency"));
const UpdatesPage = lazy(() => import("@/pages/UpdatesPage"));
const Messages = lazy(() => import("@/pages/Messages"));
const CitizenHome = lazy(() => import("@/pages/citizen/CitizenHome"));
const AdminOverview = lazy(() => import("@/pages/admin/AdminOverview"));
const AdminQueue = lazy(() => import("@/pages/admin/AdminQueue"));
const AdminIssue = lazy(() => import("@/pages/admin/AdminIssue"));
const AdminWorkers = lazy(() => import("@/pages/admin/AdminManage").then((m) => ({ default: m.AdminWorkers })));
const AdminSetup = lazy(() => import("@/pages/admin/AdminManage").then((m) => ({ default: m.AdminSetup })));
const AdminPublish = lazy(() => import("@/pages/admin/AdminManage").then((m) => ({ default: m.AdminPublish })));
const AdminModeration = lazy(() => import("@/pages/admin/AdminManage").then((m) => ({ default: m.AdminModeration })));
const AdminAudit = lazy(() => import("@/pages/admin/AdminManage").then((m) => ({ default: m.AdminAudit })));
const WorkerHome = lazy(() => import("@/pages/worker/WorkerPages").then((m) => ({ default: m.WorkerHome })));
const WorkerTask = lazy(() => import("@/pages/worker/WorkerPages").then((m) => ({ default: m.WorkerTask })));
const WorkerMap = lazy(() => import("@/pages/worker/WorkerPages").then((m) => ({ default: m.WorkerMap })));
const WorkerHistory = lazy(() => import("@/pages/worker/WorkerPages").then((m) => ({ default: m.WorkerHistory })));
const LoginPage = lazy(() => import("@/pages/AuthPages").then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import("@/pages/AuthPages").then((m) => ({ default: m.RegisterPage })));

/** Frontend guard for navigation only — the backend enforces every permission independently. */
function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <PageLoader />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}&as=${roles[0]}`} replace />;
  if (!roles.includes(user.role)) return <div className="py-20"><EmptyState title="This area isn't for your account" body="Your role doesn't have access to this page." action={<Link to="/"><Button variant="secondary">Go home</Button></Link>} /></div>;
  return <>{children}</>;
}

function PageLoader() {
  return <div className="grid min-h-[50vh] place-items-center"><Spinner className="size-6" /></div>;
}

function Page({ children }: { children: ReactNode }) {
  // One page transition: a short fade so route changes feel connected, never slow.
  return <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: "easeOut" }}>{children}</motion.div>;
}

export default function App() {
  const location = useLocation();
  const section = location.pathname.split("/")[1];
  return (
    <Suspense fallback={<PageLoader />}>
      <AnimatePresence mode="wait" initial={false}>
        <Routes location={location} key={section === "admin" || section === "worker" ? section : location.pathname}>
          <Route element={<PublicLayout />}>
            <Route index element={<Page><Landing /></Page>} />
            <Route path="map" element={<MapPage />} />
            <Route path="issues" element={<Page><IssuesBrowse /></Page>} />
            <Route path="issues/:trackingId" element={<Page><IssuePage /></Page>} />
            <Route path="report" element={<Page><ReportPage /></Page>} />
            <Route path="track" element={<Page><TrackPage /></Page>} />
            <Route path="transparency" element={<Page><Transparency /></Page>} />
            <Route path="updates/:action/:token" element={<Page><UpdatesPage /></Page>} />
            <Route path="login" element={<Page><LoginPage /></Page>} />
            <Route path="register" element={<Page><RegisterPage /></Page>} />
            <Route path="me" element={<RequireRole roles={["citizen"]}><Page><CitizenHome /></Page></RequireRole>} />
            <Route path="messages" element={<RequireRole roles={["citizen"]}><Messages /></RequireRole>} />
            <Route path="messages/:id" element={<RequireRole roles={["citizen"]}><Messages /></RequireRole>} />
          </Route>
          <Route path="admin" element={<RequireRole roles={["admin"]}><AdminLayout /></RequireRole>}>
            <Route index element={<AdminOverview />} />
            <Route path="issues" element={<AdminQueue />} />
            <Route path="issues/:trackingId" element={<AdminIssue />} />
            <Route path="workers" element={<AdminWorkers />} />
            <Route path="setup" element={<AdminSetup />} />
            <Route path="publish" element={<AdminPublish />} />
            <Route path="moderation" element={<AdminModeration />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="messages" element={<Messages base="/admin/messages" />} />
            <Route path="messages/:id" element={<Messages base="/admin/messages" />} />
          </Route>
          <Route path="worker" element={<RequireRole roles={["worker"]}><WorkerLayout /></RequireRole>}>
            <Route index element={<WorkerHome />} />
            <Route path="tasks/:issueId" element={<WorkerTask />} />
            <Route path="map" element={<WorkerMap />} />
            <Route path="history" element={<WorkerHistory />} />
            <Route path="messages" element={<Messages base="/worker/messages" />} />
            <Route path="messages/:id" element={<Messages base="/worker/messages" />} />
          </Route>
          <Route path="*" element={<PublicLayout />}>
            <Route path="*" element={<div className="py-24"><EmptyState title="Page not found" action={<Link to="/"><Button variant="secondary">Go home</Button></Link>} /></div>} />
          </Route>
        </Routes>
      </AnimatePresence>
    </Suspense>
  );
}
