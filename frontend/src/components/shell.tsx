import * as Popover from "@radix-ui/react-popover";
import * as Dropdown from "@radix-ui/react-dropdown-menu";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Bell, LogOut, Mail, MessageSquare, Moon, Sun, SunMoon, UserRound } from "lucide-react";
import { toast } from "sonner";
import type { User } from "@/types";
import { Link, useNavigate } from "react-router-dom";
import { api } from "@/services/api";
import { useAuth, homeFor } from "@/contexts/AuthContext";
import { useNotifications, useUnreadMessages } from "@/hooks/queries";
import { ago, cn } from "@/utils/format";
import { EmptyState } from "@/components/ui";

/** Commons wordmark: the serif name beside a small mark drawn from the cover's staggered frames. */
export function Logo({ className }: { className?: string; tone?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden>
        <rect x="1" y="1" width="12" height="15" fill="var(--green-600)" />
        <rect x="9" y="8" width="15" height="15" fill="none" stroke="var(--ink)" strokeWidth="1.5" />
        <path d="M1 20h8M1 23.5h4.5" stroke="var(--ink)" strokeWidth="1.5" />
      </svg>
      <span className="font-serif text-[22px] leading-none tracking-[-0.01em] text-ink">Commons</span>
    </span>
  );
}

/** Light / dark / system. Saved per browser; the system setting is used until someone chooses. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<string>(() => document.documentElement.dataset.theme ?? "system");
  const next = theme === "system" ? "dark" : theme === "dark" ? "light" : "system";
  const apply = () => {
    if (next === "system") { delete document.documentElement.dataset.theme; try { localStorage.removeItem("commons.theme"); } catch { /* ignore */ } }
    else { document.documentElement.dataset.theme = next; try { localStorage.setItem("commons.theme", next); } catch { /* ignore */ } }
    setTheme(next);
  };
  const I = theme === "dark" ? Moon : theme === "light" ? Sun : SunMoon;
  const label = theme === "system" ? "Theme: follows your device" : `Theme: ${theme}`;
  return (
    <button onClick={apply} title={`${label}. Switch to ${next}.`} aria-label={`${label}. Switch to ${next}.`}
      className="grid size-9 place-items-center rounded-sm text-ink transition-colors duration-150 hover:bg-paper-2">
      <I className="size-[18px]" />
    </button>
  );
}

export function NotificationBell(_: { tone?: "light" | "dark" } = {}) {
  const { data } = useNotifications();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const readAll = useMutation({ mutationFn: () => api.post("/api/notifications/read-all"), onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }) });
  const open = async (n: { id: string; link: string | null }) => {
    await api.post(`/api/notifications/${n.id}/read`).catch(() => {});
    qc.invalidateQueries({ queryKey: ["notifications"] });
    if (n.link) navigate(n.link);
  };
  const unread = data?.unread ?? 0;
  return (
    <Popover.Root>
      <Popover.Trigger className={cn("relative grid size-9 place-items-center rounded-sm text-ink transition-colors duration-150 hover:bg-paper-2")}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="size-[18px]" />
        {unread > 0 && <span className="num absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full border border-paper bg-ink px-1 text-[10px] font-medium text-paper">{unread > 99 ? "99+" : unread}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="cv-float z-50 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="t-h2">Notifications</span>
            {unread > 0 && <button className="t-label underline underline-offset-4 hover:text-teal" onClick={() => readAll.mutate()}>Mark all read</button>}
          </div>
          <div className="scrollbar-thin max-h-[60vh] overflow-y-auto">
            {!data?.items.length ? <EmptyState art="inbox" title="Nothing yet" body="Updates on issues you report or follow will appear here." /> :
              data.items.map((n) => (
                <Popover.Close asChild key={n.id}>
                  <button onClick={() => open(n)} className={cn("block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-paper", !n.read_at && "bg-raised")}>
                    <div className="flex items-start gap-2">
                      {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-ink" aria-label="Unread" />}
                      <div className="min-w-0">
                        <p className="text-[14px] font-medium text-ink">{n.title}</p>
                        {n.body && <p className="mt-0.5 line-clamp-2 text-[13px] text-slate">{n.body}</p>}
                        <p className="mt-1 text-xs text-mute">{ago(n.created_at)}</p>
                      </div>
                    </div>
                  </button>
                </Popover.Close>
              ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function MessagesLink({ to = "/messages" }: { tone?: "light" | "dark"; to?: string }) {
  const { data } = useUnreadMessages();
  return (
    <Link to={to} aria-label="Messages" className={cn("relative grid size-9 place-items-center rounded-sm text-ink transition-colors duration-150 hover:bg-paper-2")}>
      <MessageSquare className="size-[18px]" />
      {!!data?.unread && <span className="num absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full border border-paper bg-ink px-1 text-[10px] font-medium text-paper">{data.unread}</span>}
    </Link>
  );
}

export function UserMenu(_: { tone?: "light" | "dark" } = {}) {
  const { user, logout, setUser } = useAuth();
  const navigate = useNavigate();
  const toggleEmail = useMutation({
    mutationFn: (on: boolean) => api.patch<User>("/api/auth/me/preferences", { email_notifications: on }),
    onSuccess: (u) => { setUser({ ...user!, ...u }); toast.success(u.email_notifications ? "Email updates on" : "Email updates off"); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!user) return null;
  const initials = user.full_name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return (
    <Dropdown.Root>
      <Dropdown.Trigger className={cn("flex items-center gap-2 rounded-sm py-1 pr-2 pl-1 transition-colors duration-150 hover:bg-paper-2")}>
        <span className="t-label grid size-8 place-items-center rounded-full border-[1.5px] border-ink bg-sage-200 text-ink">{initials}</span>
        <span className={"t-label hidden text-ink sm:block"}>{user.full_name.split(" ")[0]}</span>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={8} className="cv-float z-50 min-w-60 p-1">
          <div className="px-3 py-2">
            <p className="text-sm font-medium">{user.full_name}</p>
            <p className="text-xs text-slate">{user.email}</p>
            <p className="t-caption mt-1 capitalize text-slate">{user.role}{user.department ? ` · ${user.department.name}` : ""}</p>
          </div>
          <Dropdown.Separator className="my-1 h-px bg-line" />
          <Dropdown.CheckboxItem checked={user.email_notifications} onSelect={(e) => e.preventDefault()}
            onCheckedChange={(c) => toggleEmail.mutate(c === true)}
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-paper">
            <Mail className="size-4" /><span className="flex-1">Email me updates</span>
            <span className={cn("h-4 w-7 rounded-full border border-ink p-px transition-colors duration-150", user.email_notifications ? "bg-teal" : "bg-raised")}>
              <span className={cn("block size-3 rounded-full border border-ink bg-paper transition-transform duration-150", user.email_notifications && "translate-x-3")} />
            </span>
          </Dropdown.CheckboxItem>
          <Dropdown.Item onSelect={() => navigate(homeFor(user.role))} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-paper">
            <UserRound className="size-4" />My workspace
          </Dropdown.Item>
          <Dropdown.Item onSelect={() => { logout(); navigate("/"); }} className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-red outline-none data-[highlighted]:bg-red-soft">
            <LogOut className="size-4" />Sign out
          </Dropdown.Item>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  );
}
