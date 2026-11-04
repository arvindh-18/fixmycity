import { useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Menu, X } from "lucide-react";
import { useAuth, homeFor } from "@/contexts/AuthContext";
import { Logo, MessagesLink, NotificationBell, ThemeToggle, UserMenu } from "@/components/shell";
import { Button } from "@/components/ui";
import { AssistantLauncher } from "@/features/assistant/Assistant";
import { cn } from "@/utils/format";

const NAV = [
  { to: "/map", label: "Map" },
  { to: "/issues", label: "Reports" },
  { to: "/transparency", label: "How we're doing" },
  { to: "/track", label: "Track a report" },
];

const navClass = ({ isActive }: { isActive: boolean }) =>
  cn("t-label px-3 py-2 underline-offset-[6px] decoration-1 transition-colors duration-150", isActive ? "text-ink underline" : "text-slate hover:text-ink");

export function PublicLayout() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const fullBleed = loc.pathname.startsWith("/map");
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-paper">
        <div className="mx-auto flex h-16 max-w-[1120px] items-center gap-6 px-4 sm:px-6">
          <Link to="/" aria-label="Commons home"><Logo /></Link>
          <nav className="hidden items-center md:flex" aria-label="Main">
            {NAV.map((n) => <NavLink key={n.to} to={n.to} className={navClass}>{n.label}</NavLink>)}
            {user?.role === "citizen" && <NavLink to="/me" className={navClass}>My reports</NavLink>}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {/* Secondary here so each page keeps a single primary action of its own. */}
            {(!user || user.role === "citizen") && loc.pathname !== "/report" && (
              <Link to="/report" className="mr-1 hidden sm:block"><Button size="sm">Report an issue</Button></Link>
            )}
            <ThemeToggle />
            {user ? (<>
              {user.role !== "citizen" && <Link to={homeFor(user.role)} className="hidden sm:block"><Button size="sm" variant="quiet">Open workspace</Button></Link>}
              <MessagesLink to={user.role === "admin" ? "/admin/messages" : user.role === "worker" ? "/worker/messages" : "/messages"} />
              <NotificationBell />
              <UserMenu />
            </>) : (
              <Link to="/login"><Button size="sm" variant="quiet">Sign in</Button></Link>
            )}
            <button className="grid size-9 place-items-center md:hidden" onClick={() => setOpen(!open)} aria-label="Menu" aria-expanded={open}>
              {open ? <X className="size-5" /> : <Menu className="size-5" />}
            </button>
          </div>
        </div>
        <AnimatePresence>
          {open && (
            <motion.nav initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} transition={{ duration: 0.15, ease: "easeOut" }}
              className="overflow-hidden border-t border-line md:hidden" aria-label="Mobile">
              <div className="flex flex-col p-3">
                {[...NAV, ...(user?.role === "citizen" ? [{ to: "/me", label: "My reports" }] : []), { to: "/report", label: "Report an issue" }].map((n) => (
                  <Link key={n.to} to={n.to} onClick={() => setOpen(false)} className="t-body border-b border-line px-1 py-3 last:border-0">{n.label}</Link>
                ))}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
      </header>
      <main className="flex-1"><Outlet /></main>
      {!fullBleed && <Footer />}
      {!fullBleed && <AssistantLauncher />}
    </div>
  );
}

function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <div className="mx-auto grid max-w-[1120px] gap-10 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="t-body-sm mt-4 max-w-xs text-slate">See it, report it, follow it through. Every report keeps its full history, and anyone can read it.</p>
        </div>
        <FooterCol title="Look around" links={[["/map", "Map of reports"], ["/issues", "All reports"], ["/transparency", "How we're doing"], ["/transparency#promises", "What the council has promised"]]} />
        <FooterCol title="Take part" links={[["/report", "Report an issue"], ["/track", "Track an anonymous report"], ["/register", "Create an account"]]} />
        <FooterCol title="Staff sign-in" links={[["/login?as=admin", "Officials"], ["/login?as=worker", "Field crews"], ["/login?as=citizen", "Residents"]]} />
      </div>
      <div className="border-t border-line">
        <p className="t-caption mx-auto max-w-[1120px] px-4 py-4 text-slate sm:px-6">Map data © OpenStreetMap contributors. Every figure on Commons is counted live from the reports themselves.</p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <h3 className="t-h3">{title}</h3>
      <span className="cv-rules mt-2" aria-hidden><i /><i /></span>
      <ul className="mt-4 space-y-2">
        {links.map(([to, label]) => <li key={to}><Link to={to} className="t-body-sm text-slate underline-offset-4 hover:text-ink hover:underline">{label}</Link></li>)}
      </ul>
    </div>
  );
}
