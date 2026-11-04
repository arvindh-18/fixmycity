import { useState } from "react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ClipboardList, FileClock, Globe, HardHat, Menu, MessageSquare, Megaphone, Settings2, ShieldAlert, X } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMeta } from "@/hooks/queries";
import { Logo, MessagesLink, NotificationBell, ThemeToggle, UserMenu } from "@/components/shell";
import { Badge } from "@/components/ui";
import { cn } from "@/utils/format";

export interface Queues { verification: number; assignment: number; review: number; overdue: number; summaries: number; moderation: number }

export function useQueues() {
  return useQuery({ queryKey: ["admin", "queues"], queryFn: () => api.get<Queues>("/api/admin/queues"), refetchInterval: 30_000 });
}

export function AdminLayout() {
  const { user } = useAuth();
  const { data: meta } = useMeta();
  const { data: q } = useQueues();
  const [open, setOpen] = useState(false);
  const nav = [
    { to: "/admin", label: "Overview", icon: BarChart3, end: true },
    { to: "/admin/issues", label: "Issue queue", icon: ClipboardList, count: q ? q.verification + q.assignment + q.review : undefined },
    { to: "/admin/messages", label: "Messages", icon: MessageSquare },
    { to: "/admin/moderation", label: "Review & moderation", icon: ShieldAlert, count: q ? q.summaries + q.moderation : undefined },
    { to: "/admin/workers", label: "Field workers", icon: HardHat },
    { to: "/admin/publish", label: "Public content", icon: Megaphone },
    { to: "/admin/setup", label: "Departments & SLAs", icon: Settings2 },
    { to: "/admin/audit", label: "Audit log", icon: FileClock },
  ];
  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5"><Link to="/admin"><Logo /></Link></div>
      <div className="px-5 pb-4">
        <p className="t-caption text-slate">Officials</p>
        <p className="text-sm font-medium text-ink">{user?.department?.name ?? "City-wide"}</p>
      </div>
      <nav className="flex-1 space-y-0.5 px-3" aria-label="Admin">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.end} onClick={() => setOpen(false)}
            className={({ isActive }) => cn("t-label flex items-center gap-3 px-3 py-2.5 transition-colors duration-150", isActive ? "bg-paper-2 text-ink border-l-2 border-ink" : "border-l-2 border-transparent text-ink/80 hover:bg-paper-2")}>
            <n.icon className="size-4" /><span className="flex-1">{n.label}</span>
            {!!n.count && <span className="num rounded-full border border-ink bg-yellow-200 px-1.5 text-[11px] font-medium text-ink">{n.count}</span>}
          </NavLink>
        ))}
      </nav>
      <div className="space-y-3 border-t border-line p-4">
        <Link to="/" className="flex items-center gap-2 text-sm text-slate hover:text-ink"><Globe className="size-4" />View public site</Link>
        {meta && <Badge>{meta.ai.mode === "llm" ? `AI: ${meta.ai.provider}` : "AI: demonstration mode"}</Badge>}
      </div>
    </div>
  );
  return (
    <div className="min-h-dvh bg-paper">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-line bg-paper lg:block">{sidebar}</aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/30" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 bg-surface ">{sidebar}</aside>
        </div>
      )}
      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-paper px-4 lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open navigation">{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <MessagesLink to="/admin/messages" />
            <NotificationBell />
            <UserMenu />
          </div>
        </header>
        <main className="px-4 py-6 lg:px-8"><Outlet /></main>
      </div>
    </div>
  );
}
