import {
  CircleEllipsis, Construction, Droplets, Footprints, Lightbulb, LoaderCircle, TrafficCone, Trash,
  TreeDeciduous, WavesHorizontal, type LucideIcon,
} from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Severity, Status } from "../lib/types";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  pothole: Construction,
  garbage: Trash,
  streetlight: Lightbulb,
  water: Droplets,
  drainage: WavesHorizontal,
  traffic: TrafficCone,
  tree: TreeDeciduous,
  footpath: Footprints,
  other: CircleEllipsis,
};

export function CategoryIcon({ category, size = 18, className }: { category: string; size?: number; className?: string }) {
  const Icon = CATEGORY_ICONS[category] ?? CircleEllipsis;
  return <Icon size={size} strokeWidth={1.9} className={className} aria-hidden />;
}

export const STATUS: Record<Status, { label: string; color: string; soft: string }> = {
  open: { label: "Reported", color: "var(--color-st-open)", soft: "var(--color-st-open-soft)" },
  in_progress: { label: "Being fixed", color: "var(--color-st-progress)", soft: "var(--color-st-progress-soft)" },
  rechecking: { label: "Rechecking", color: "var(--color-st-rechecking)", soft: "var(--color-st-rechecking-soft)" },
  resolved: { label: "Fixed", color: "var(--color-st-fixed)", soft: "var(--color-st-fixed-soft)" },
  rejected: { label: "Closed", color: "var(--color-st-closed)", soft: "var(--color-st-closed-soft)" },
};

export function StatusPill({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[13px] font-semibold"
      style={{ background: s.soft, color: s.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

const SEV: Record<Severity, string> = { low: "Low urgency", medium: "Needs fixing soon", high: "Urgent — safety risk" };
export function SeverityText({ severity }: { severity: Severity }) {
  return (
    <span className={severity === "high" ? "text-danger font-semibold" : "text-ink-2"}>{SEV[severity]}</span>
  );
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function Spinner({ size = 18 }: { size?: number }) {
  return <LoaderCircle size={size} className="animate-spin" aria-hidden />;
}

export function areaLabel(locality: string, pincode: string) {
  return [locality, pincode].filter(Boolean).join(", ") || "Unknown area";
}

/* ---- Toasts --------------------------------------------------------------- */
type Toast = { id: number; text: string; tone: "ok" | "err" };
const ToastCtx = createContext<(text: string, tone?: "ok" | "err") => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, tone: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 inset-x-4 sm:inset-x-auto sm:right-6 z-[2000] flex flex-col gap-2 items-center sm:items-end" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`rounded-xl px-4 py-3 text-sm font-medium shadow-[var(--shadow-lift)] max-w-sm ${
              t.tone === "ok" ? "bg-ink text-white" : "bg-danger text-white"
            }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);
