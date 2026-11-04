import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AlarmClock, ArrowUpRight, Target } from "lucide-react";
import { api } from "@/services/api";
import type { CategoryStat, DeptScore, Hotspot, Overview, TrendPoint } from "@/types";
import { Button, DemoBadge, Panel, Segmented, Skeleton } from "@/components/ui";
import { CategoryBars, PriorityBars, Scorecards, StatusDonut, TrendChart } from "@/components/charts/Charts";
import { useQueues } from "@/layouts/AdminLayout";
import { cn, duration, pct } from "@/utils/format";

interface Dashboard {
  scope: string; overview: Overview; trends: TrendPoint[]; categories: CategoryStat[];
  priorities: { priority: string; total: number }[]; departments: DeptScore[];
  localities: { id: string; name: string; is_approximate: boolean; total: number; resolved: number; open: number }[];
}

const RANGES = [{ v: "all", label: "All time", days: 0 }, { v: "90", label: "90 days", days: 90 }, { v: "30", label: "30 days", days: 30 }, { v: "7", label: "7 days", days: 7 }];

export default function AdminOverview() {
  const [range, setRange] = useState("all");
  const navigate = useNavigate();
  const qc = useQueryClient();
  const date_from = useMemo(() => { const d = RANGES.find((r) => r.v === range)!.days; return d ? new Date(Date.now() - d * 86400_000).toISOString() : undefined; }, [range]);
  const { data: d } = useQuery({ queryKey: ["admin", "dashboard", date_from], queryFn: () => api.get<Dashboard>("/api/admin/dashboard", { date_from }) });
  const { data: q } = useQueues();
  const hot = useQuery({ queryKey: ["hotspots"], queryFn: () => api.get<Hotspot[]>("/api/hotspots") });
  const esc = useMutation({
    mutationFn: () => api.post<{ warned: number; flagged: number; checked: number }>("/api/admin/escalation/run"),
    onSuccess: (r) => { toast.success(`Checked ${r.checked} open issues with deadlines: ${r.warned} warnings, ${r.flagged} newly overdue`); qc.invalidateQueries(); },
  });
  const o = d?.overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="t-h1">Operations overview</h1>
          <p className="text-sm text-slate">{d?.scope ?? "…"} · live figures {o && o.demo_rows > 0 && <span className="ml-1 inline-flex align-middle"><DemoBadge /></span>}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" loading={esc.isPending} onClick={() => esc.mutate()} icon={<AlarmClock className="size-4" />}>Run SLA check now</Button>
          <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.v, label: r.label }))} />
        </div>
      </div>

      {/* Work queues — the things that need a human now */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <QueueTile label="Awaiting verification" n={q?.verification} to="/admin/issues?queue=verification" tone="red" />
        <QueueTile label="Ready to assign" n={q?.assignment} to="/admin/issues?queue=assignment" tone="orange" />
        <QueueTile label="Completion to review" n={q?.review} to="/admin/issues?queue=review" tone="violet" />
        <QueueTile label="Past SLA deadline" n={q?.overdue} to="/admin/issues?overdue=1" tone="red" />
        <QueueTile label="Summaries & reports" n={q ? q.summaries + q.moderation : undefined} to="/admin/moderation" tone="amber" />
      </div>

      <div className="grid gap-px overflow-hidden  border border-line bg-line sm:grid-cols-3 xl:grid-cols-6">
        <Kpi label="Total issues" v={o?.total} />
        <Kpi label="Pending" v={o?.pending} />
        <Kpi label="Verified" v={o?.verified} />
        <Kpi label="In progress" v={o?.in_progress} />
        <Kpi label="Resolved" v={o?.resolved} sub={o ? `${pct(o.resolution_rate)} of valid` : undefined} />
        <Kpi label="Overdue" v={o?.overdue} red />
        <Kpi label="Avg first response" v={o ? duration(o.avg_response_hours) : undefined} sub={o ? `n = ${o.response_sample}` : undefined} />
        <Kpi label="Avg resolution" v={o ? duration(o.avg_resolution_hours) : undefined} sub={o ? `n = ${o.resolved_sample}` : undefined} />
        <Kpi label="Awaiting verification" v={o?.awaiting_verification} />
        <Kpi label="Reopened" v={o?.reopened} />
        <Kpi label="Rejected" v={o?.rejected} />
        <Kpi label="Satisfaction" v={o?.satisfaction_avg ? `${o.satisfaction_avg.toFixed(2)}/5` : "—"} sub={o ? `n = ${o.satisfaction_sample}` : undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel className="p-5">
          <h2 className="font-semibold">Reports and resolutions by month</h2>
          <div className="mt-3">{d ? <TrendChart data={d.trends} height={260} /> : <Skeleton className="h-64" />}</div>
        </Panel>
        <Panel className="p-5">
          <h2 className="mb-4 font-semibold">Status mix</h2>
          {o ? <StatusDonut parts={[
            { label: "Pending", value: o.pending + o.reopened, color: "var(--yellow-400)" }, { label: "In progress", value: o.in_progress + o.verified, color: "var(--blue-500)" },
            { label: "Waiting for a check", value: o.awaiting_verification, color: "var(--sage-300)" }, { label: "Resolved", value: o.resolved, color: "var(--green-600)" },
            { label: "Closed", value: o.rejected, color: "var(--stone-200)" }]} /> : <Skeleton className="h-40" />}
          <h2 className="mt-6 mb-1 font-semibold">Priority distribution</h2>
          {d ? <PriorityBars data={d.priorities} /> : <Skeleton className="h-40" />}
        </Panel>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel className="p-5">
          <h2 className="mb-4 font-semibold">Categories <span className="font-normal text-slate">· select to drill down</span></h2>
          {d ? <CategoryBars data={d.categories} onSelect={(id) => navigate(`/admin/issues?category=${id}`)} /> : <Skeleton className="h-60" />}
        </Panel>
        <Panel className="p-5">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><Target className="size-4 text-red" />Civic hotspots</h2>
          <p className="mb-3 text-xs text-slate">{hot.data?.[0]?.method ?? "DBSCAN clustering"} over the last 180 days.</p>
          <div className="space-y-2">
            {hot.data?.slice(0, 5).map((h) => (
              <div key={h.cluster_id} className={cn("rounded-md border px-3 py-2.5 t-body-sm", h.recurring ? "border-ink bg-raised" : "border-line")}>
                {h.insight}
                {h.recurring && <span className="ml-1 font-medium text-red">Recurring {h.top_category.toLowerCase()}.</span>}
              </div>
            ))}
            {hot.data?.length === 0 && <p className="text-sm text-slate">No clusters found.</p>}
          </div>
          <h2 className="mt-6 mb-2 font-semibold">By locality</h2>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate"><th className="py-1 font-medium">Locality</th><th className="text-right font-medium">Open</th><th className="text-right font-medium">Resolved</th><th className="text-right font-medium">Total</th></tr></thead>
            <tbody>{d?.localities.filter((l) => l.total).sort((a, b) => b.open - a.open).map((l) => (
              <tr key={l.id} className="border-t border-line"><td className="py-1.5"><Link to={`/admin/issues?locality=${l.id}`} className="hover:text-ink">{l.name}</Link></td>
                <td className="num text-right font-medium">{l.open}</td><td className="num text-right">{l.resolved}</td><td className="num text-right text-slate">{l.total}</td></tr>
            ))}</tbody>
          </table>
        </Panel>
      </div>

      <Panel className="p-5">
        <h2 className="font-semibold">Department performance</h2>
        <p className="mb-3 text-xs text-slate">Sample sizes shown. Rates hidden under five reports. Not a ranking.</p>
        {d ? <Scorecards data={d.departments} /> : <Skeleton className="h-60" />}
      </Panel>
    </div>
  );
}

function QueueTile({ label, n, to, tone }: { label: string; n?: number; to: string; tone: "red" | "orange" | "violet" | "amber" }) {
  const late = tone === "red" && label.startsWith("Past");
  return (
    <Link to={to} className="group border border-line p-4 transition-colors duration-150 hover:border-ink">
      <div className="flex items-start justify-between"><p className="t-body-sm text-slate">{label}</p><ArrowUpRight className="size-4 text-mute group-hover:text-ink" /></div>
      <p className={cn("num t-h1 mt-1", !n ? "text-mute" : late ? "text-danger" : "text-ink")}>{late && n ? "⚠ " : ""}{n ?? "–"}</p>
    </Link>
  );
}

function Kpi({ label, v, sub, red }: { label: string; v?: React.ReactNode; sub?: string; red?: boolean }) {
  return (
    <div className="bg-surface px-4 py-3">
      <p className="text-xs text-slate">{label}</p>
      <p className={cn("num t-h2 mt-0.5", red && v ? "text-danger" : "text-ink")}>{v ?? "…"}</p>
      {sub && <p className="text-[11px] text-mute">{sub}</p>}
    </div>
  );
}
