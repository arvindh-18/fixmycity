import { LogOut, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { homeFor, useAuth } from "../lib/auth";

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-display text-[21px] font-extrabold tracking-tight">
      <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#1E272C" />
        <path d="M16 5c-4.4 0-8 3.4-8 7.8C8 18.6 16 27 16 27s8-8.4 8-14.2C24 8.4 20.4 5 16 5z" fill="#F2C230" />
        <circle cx="16" cy="12.8" r="3.2" fill="#1E272C" />
      </svg>
      FixMyCity
    </Link>
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
        className="flex size-10 items-center justify-center rounded-full bg-civic text-white font-semibold"
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
            {me.role !== "public" && (
              <div className="mt-1 text-xs font-semibold text-civic">{me.is_admin ? "City admin" : "Field worker"}</div>
            )}
          </div>
          {me.role !== "public" && (
            <Link to={homeFor(me.role)} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-chalk">
              {me.is_admin ? "Admin dashboard" : "My jobs"}
            </Link>
          )}
          <Link to="/issues?mine=1" onClick={() => setOpen(false)} className="block rounded-lg px-3 py-2 hover:bg-chalk">
            My reports
          </Link>
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
  const { me, ready } = useAuth();
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  const home = pathname === "/";
  const link = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 rounded-full text-[15px] font-medium transition-colors ${isActive ? "text-ink bg-white" : "text-ink-2 hover:text-ink"}`;

  const staffLink = me && me.role !== "public" && (
    <NavLink to={homeFor(me.role)} className={link}>{me.is_admin ? "Admin" : "My jobs"}</NavLink>
  );

  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${home ? "absolute" : "sticky bg-chalk/90 backdrop-blur border-b border-line"} top-0 inset-x-0 z-[1100]`}>
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Logo />
          <nav className="ml-4 hidden sm:flex items-center gap-1">
            <NavLink to="/issues" className={link}>Reports</NavLink>
            <NavLink to="/stats" className={link}>Insights</NavLink>
            {staffLink}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/report" className="btn-paint btn-sm sm:h-10 sm:px-5">
              <Plus size={18} strokeWidth={2.5} /> <span className="hidden min-[400px]:inline">Report a problem</span><span className="min-[400px]:hidden">Report</span>
            </Link>
            {ready && (me ? <UserMenu /> : <Link to="/signin" className="btn-ghost btn-sm sm:h-10">Sign in</Link>)}
          </div>
        </div>
        <nav className="sm:hidden flex gap-1 px-3 pb-2">
          <NavLink to="/issues" className={link}>Reports</NavLink>
          <NavLink to="/stats" className={link}>Insights</NavLink>
          {staffLink}
        </nav>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
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
