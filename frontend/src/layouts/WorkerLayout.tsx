import { Link, NavLink, Outlet } from "react-router-dom";
import { History, ListTodo, Map as MapIcon, MessageSquare } from "lucide-react";
import { Logo, NotificationBell, ThemeToggle, UserMenu } from "@/components/shell";
import { useUnreadMessages } from "@/hooks/queries";
import { cn } from "@/utils/format";

/** Mobile-first shell: compact top bar, thumb-reachable bottom tabs. */
export function WorkerLayout() {
  const { data: unread } = useUnreadMessages();
  const tabs = [
    { to: "/worker", label: "Tasks", icon: ListTodo, end: true },
    { to: "/worker/map", label: "Map", icon: MapIcon },
    { to: "/worker/history", label: "History", icon: History },
    { to: "/worker/messages", label: "Messages", icon: MessageSquare, badge: unread?.unread },
  ];
  return (
    <div className="min-h-dvh bg-paper pb-20">
      <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-line bg-paper px-4">
        <Link to="/worker"><Logo className="origin-left scale-90" /></Link>
        <div className="flex items-center gap-1"><ThemeToggle /><NotificationBell /><UserMenu /></div>
      </header>
      <main className="mx-auto max-w-2xl"><Outlet /></main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)]" aria-label="Worker">
        <div className="mx-auto grid max-w-2xl grid-cols-4">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => cn("t-caption relative flex flex-col items-center gap-0.5 border-t-2 py-2.5 font-medium", isActive ? "border-ink text-ink" : "border-transparent text-slate")}>
              <t.icon className="size-5" />{t.label}
              {!!t.badge && <span className="num absolute top-1.5 left-1/2 ml-2 grid h-4 min-w-4 place-items-center rounded-full border border-paper bg-ink px-1 text-[10px] text-paper">{t.badge}</span>}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
