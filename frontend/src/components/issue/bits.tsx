import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  CircleHelp, Construction, Droplets, Lamp, Landmark, MapPin, SprayCan, TrafficCone, Trash2, Trees, Users, Waves,
} from "lucide-react";
import type { IssueCard as IssueCardT, Priority, SLAState, Status } from "@/types";
import { PRIORITY, STATUS, isUrgent } from "@/utils/status";
import { ago, cn, countdown, fmtDateTime, metres } from "@/utils/format";
import { DemoBadge } from "@/components/ui";
import { Icon, IssueCard, StatusBadge, type CommonsIcon } from "@/design-system/Commons";

// Small inline icons (in meta lines and buttons) — line icons at 2px, never filled.
const ICONS: Record<string, any> = {
  construction: Construction, "trash-2": Trash2, waves: Waves, droplets: Droplets, lamp: Lamp, landmark: Landmark,
  "traffic-cone": TrafficCone, "spray-can": SprayCan, trees: Trees, "circle-help": CircleHelp,
};
export function CategoryIcon({ icon, className }: { icon?: string; className?: string }) {
  const I = ICONS[icon ?? ""] ?? CircleHelp;
  return <I className={cn("size-4", className)} strokeWidth={2} aria-hidden />;
}

// Large category art uses the Commons Icons group where one exists for the category.
const CATEGORY_ART: Record<string, CommonsIcon> = {
  "roads-potholes": "pothole", streetlights: "streetlight", "garbage-waste": "waste", "drainage-sewage": "water",
  "water-supply": "water", parks: "tree", sanitation: "waste",
};
export function CategoryArt({ slug, icon, size = 88 }: { slug?: string; icon?: string; size?: number }) {
  const art = CATEGORY_ART[slug ?? ""];
  if (art) return <Icon name={art} size={size} />;
  const I = ICONS[icon ?? ""] ?? CircleHelp;
  return <I style={{ width: size * 0.6, height: size * 0.6 }} strokeWidth={1.25} className="text-ink" aria-hidden />;
}

/** Commons StatusBadge, naming the app's specific state in words with a glyph. */
export function StatusChip({ status, size = "md" }: { status: Status; size?: "sm" | "md" }) {
  const s = STATUS[status];
  return <StatusBadge status={s.badge} glyph={s.glyph}>{size === "sm" ? s.short : s.label}</StatusBadge>;
}

/** Shown in addition to the status when an open issue is a hazard to people. */
export function UrgentBadge({ status, priority }: { status: Status; priority: Priority | null }) {
  return isUrgent(status, priority) ? <StatusBadge status="urgent" /> : null;
}

export function PriorityTag({ priority }: { priority: Priority | null }) {
  if (!priority) return <span className="t-body-sm text-slate">Priority not set</span>;
  const p = PRIORITY[priority];
  return (
    <span className="t-body-sm inline-flex items-center gap-1.5 text-ink">
      <span className="flex gap-[2px]" aria-hidden>
        {[1, 2, 3, 4].map((i) => <span key={i} className={cn("h-2.5 w-[3px]", i <= p.weight ? "bg-ink" : "bg-line")} />)}
      </span>
      {p.label} priority
    </span>
  );
}

/** SLA countdown. Shows nothing alarming when no SLA rule applies. */
export function SLAMeter({ sla, compact }: { sla: SLAState; compact?: boolean }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 60_000); return () => clearInterval(t); }, []);
  if (sla.state === "none") return compact ? null : <p className="t-body-sm text-slate">No deadline yet. It's set when the report is checked and routed.</p>;
  const due = sla.due_at ? new Date(sla.due_at).getTime() : 0;
  const remaining = (due - Date.now()) / 1000;
  const total = sla.elapsed_seconds !== null && sla.seconds_remaining !== null ? sla.elapsed_seconds + sla.seconds_remaining : null;
  const frac = total ? Math.min(1, Math.max(0, 1 - remaining / total)) : 0;
  const late = sla.state === "overdue" || sla.state === "missed" || (remaining < 0 && sla.state !== "met");
  const label = sla.state === "met" ? "Fixed within the deadline" : sla.state === "missed" ? "Fixed after the deadline"
    : remaining < 0 ? `Overdue by ${countdown(remaining)}` : `${countdown(remaining)} left`;
  if (compact) return <span className={cn("num t-body-sm", late ? "text-danger" : "text-slate")}>{late && "⚠ "}{label}</span>;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <span className={cn("num t-label", late ? "text-danger" : "text-ink")}>{late && "⚠ "}{label}</span>
        <span className="t-caption text-slate">Due {fmtDateTime(sla.due_at)}</span>
      </div>
      {sla.state !== "met" && sla.state !== "missed" && (
        <div className="mt-2 h-1.5 border border-line-2 bg-raised">
          <div className={cn("h-full transition-[width] duration-300 ease-out", late ? "bg-danger" : sla.state === "at_risk" ? "bg-yellow-400" : "bg-sage-300")} style={{ width: `${frac * 100}%` }} />
        </div>
      )}
      {sla.elapsed_seconds !== null && <p className="t-caption mt-1.5 text-slate">{countdown(sla.elapsed_seconds)} since it was checked</p>}
    </div>
  );
}

/** A report as a Commons IssueCard: framed photo or category art, caption rules, serif title, status, meta. */
export function ReportCard({ issue, to, className }: { issue: IssueCardT; to?: string; className?: string }) {
  return (
    <IssueCard
      href={to ?? `/issues/${issue.tracking_id}`}
      className={className}
      media={issue.thumbnail ? <img src={issue.thumbnail} alt="" className="size-full object-cover" style={{ maxWidth: "none", maxHeight: "none" }} loading="lazy" />
        : <CategoryArt slug={issue.category?.slug} icon={issue.category?.icon} />}
      title={issue.title}
      status={<StatusChip status={issue.status} size="sm" />}
      location={[issue.address?.split(",")[0], issue.locality?.name].filter(Boolean).join(", ") || undefined}
      time={ago(issue.created_at)}
      followers={issue.support_count}
      extra={(issue.is_demo || isUrgent(issue.status, issue.priority)) && (
        <div className="mt-2 flex flex-wrap gap-1.5"><UrgentBadge status={issue.status} priority={issue.priority} />{issue.is_demo && <DemoBadge />}</div>
      )}
    />
  );
}

/** Dense list row (search results, queues): ruled, not boxed. */
export function IssueRow({ issue, to, showDistance }: { issue: IssueCardT; to?: string; showDistance?: boolean }) {
  return (
    <Link to={to ?? `/issues/${issue.tracking_id}`}
      className="group grid grid-cols-[auto_1fr_auto] items-start gap-4 border-b border-line py-4 transition-colors duration-150 last:border-b-0">
      <div className="grid size-12 place-items-center overflow-hidden border-[1.5px] border-ink bg-raised">
        {issue.thumbnail ? <img src={issue.thumbnail} alt="" className="size-full object-cover" loading="lazy" /> : <CategoryArt slug={issue.category?.slug} icon={issue.category?.icon} size={36} />}
      </div>
      <div className="min-w-0">
        <h3 className="t-h3 truncate group-hover:underline">{issue.title}</h3>
        <p className="t-body-sm mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate">
          {issue.locality && <span className="inline-flex items-center gap-1"><MapPin className="size-3" />{issue.locality.name}</span>}
          <span>{issue.category?.name}</span>
          {showDistance && issue.distance_m !== undefined && <span>{metres(issue.distance_m)} away</span>}
          <span>{ago(issue.created_at)}</span>
          <span className="num">{issue.tracking_id}</span>
          {issue.is_demo && <DemoBadge />}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1.5">
        <div className="flex flex-wrap justify-end gap-1"><UrgentBadge status={issue.status} priority={issue.priority} /><StatusChip status={issue.status} size="sm" /></div>
        <span className="flex items-center gap-3">
          {issue.support_count > 0 && <span className="num t-body-sm inline-flex items-center gap-1 text-slate"><Users className="size-3" />{issue.support_count}</span>}
          <SLAMeter sla={issue.sla} compact />
        </span>
      </div>
    </Link>
  );
}
