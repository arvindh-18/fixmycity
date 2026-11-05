import { HardHat, LogOut, Plus, ShieldCheck } from "lucide-react";
import type { Role } from "../lib/types";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { homeFor, useAuth } from "../lib/auth";
import { DemoBanner, DemoDock } from "./DemoDock";

export function Logo({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2 font-display text-[21px] font-extrabold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#1E272C" />
        <path d="M16 5c-4.4 0-8 3.4-8 7.8C8 18.6 16 27 16 27s8-8.4 8-14.2C24 8.4 20.4 5 16 5z" fill="#F2C230" />
        <circle cx="16" cy="12.8" r="3.2" fill="#1E272C" />
      </svg>
      FixMyCity
    </Link>
  );
}

const ROLE_LABEL: Record<Role, string> = { public: "Resident", worker: "Field worker", admin: "City admin" };
const AVATAR: Record<Role, string> = { public: "bg-civic text-white", worker: "bg-paint text-ink", admin: "bg-ink text-white" };
const MENU: Record<Role, { to: string; label: string }[]> = {
  public: [{ to: "/issues?mine=1", label: "My reports" }, { to: "/report", label: "Report a problem" }],
  worker: [{ to: "/worker", label: "My jobs" }],
  admin: [{ to: "/admin", label: "Admin dashboard" }, { to: "/admin/duplicates", label: "Possible duplicates" }],
};
// What each role sees in the top bar. Residents report and follow; workers fix; admins run the show.
const NAV: Record<Role | "guest", { to: string; label: string }[]> = {
  guest: [{ to: "/issues", label: "Reports" }, { to: "/stats", label: "Insights" }],
  public: [{ to: "/issues", label: "Reports" }, { to: "/stats", label: "Insights" }],
  worker: [{ to: "/worker", label: "My jobs" }, { to: "/issues", label: "All reports" }, { to: "/stats", label: "Insights" }],
  admin: [{ to: "/admin", label: "Dashboard" }, { to: "/admin/duplicates", label: "Duplicates" }, { to: "/issues", label: "Reports" }, { to: "/stats", label: "Insights" }],
};

/** A coloured strip so staff always know which mode they're in. */
function RoleRibbon({ role }: { role: Role }) {
  if (role === "public") return null;
  const worker = role === "worker";
  return (
    <div className={`${worker ? "bg-paint text-ink" : "bg-ink text-white"} text-[13px] font-semibold`}>
      <div className="mx-auto flex h-8 max-w-6xl items-center gap-2 px-4 sm:px-6">
        {worker ? <HardHat size={15} /> : <ShieldCheck size={15} />}
        <span className="truncate">
          {worker ? "Field worker mode · pick up jobs, post updates, upload proof photos" : "City admin console · assign workers, merge duplicates, track results"}
        </span>
      </div>
    </div>
  );
}

function UserMenu() {
  const { me, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  if (!me) return null;
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`flex size-10 items-center justify-center rounded-full font-semibold ${AVATAR[me.role]}`}
        aria-label={`Account: ${me.name}`}
        aria-expanded={open}
      >
        {me.name.slice(0, 1).toUpperCase()}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 rounded-2xl border border-line bg-white p-2 shadow-[var(--shadow-lift)] z-[1500]">
          <div className="px-3 py-2">
            <div className="font-semibold truncate">{me.name}</div>
            <div className="text-sm text-ink-3 truncate">{me.email}</div>
            <div className="mt-1 text-xs font-semibold text-civic">{ROLE_LABEL[me.role]}</div>
          </div>
          {MENU[me.role].map((m) => (
            <Link key={m.to} to={m.to} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-chalk">
              {m.label}
            </Link>
          ))}
          <button
            onClick={() => (setOpen(false), signOut())}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-chalk"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { me, ready, config } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const home = pathname === "/";
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-full text-[15px] font-medium transition-colors ${isActive ? "text-ink bg-white" : "text-ink-2 hover:text-ink"}`;

  const nav = NAV[me?.role ?? "guest"].map((n) => (
    <NavLink key={n.to} to={n.to} end className={link}>{n.label}</NavLink>
  ));
  const staff = me && me.role !== "public";

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${home && !staff && !config?.demo ? "absolute" : "sticky bg-chalk/90 backdrop-blur border-b border-line"} top-0 inset-x-0 z-[1100]`}>
        <DemoBanner />
        {me && <RoleRibbon role={me.role} />}
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Logo to={homeFor(me?.role)} />
          <nav className="ml-4 hidden md:flex items-center gap-1">{nav}</nav>
          <div className="ml-auto flex items-center gap-2">
            {!staff && (
              <Link to="/report" className="btn-paint btn-sm sm:h-10 sm:px-5">
                <Plus size={18} strokeWidth={2.5} /> <span className="hidden min-[400px]:inline">Report a problem</span><span className="min-[400px]:hidden">Report</span>
              </Link>
            )}
            {ready && (me ? <UserMenu /> : <Link to="/signin" className="btn-ghost btn-sm whitespace-nowrap sm:h-10">Sign in</Link>)}
          </div>
        </div>
        <nav className="md:hidden flex gap-1 overflow-x-auto px-3 pb-2">{nav}</nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <DemoDock />
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-8 text-sm text-ink-3 sm:flex-row sm:items-center sm:px-6">
          <span>FixMyCity — report it, see it fixed.</span>
          <span className="sm:ml-auto">
            Maps © <a className="underline" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors · Photo reading by Gemini
          </span>
        </div>
      </footer>
    </div>
  );
}
