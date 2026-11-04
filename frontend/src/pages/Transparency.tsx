import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CalendarClock, FileText, Info, Megaphone, Pin } from "lucide-react";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import type { Announcement, CategoryStat, Commitment, DeptScore, Expenditure, Overview, TrendPoint } from "@/types";
import { Badge, DemoBadge, EmptyState, Panel, Segmented, Select, Skeleton } from "@/components/ui";
import { CategoryBars, Scorecards, StatusDonut, TrendChart } from "@/components/charts/Charts";
import { cn, duration, fmtDate, fmtDateTime, money, pct } from "@/utils/format";

const RANGES = [{ v: "all", label: "All time", days: 0 }, { v: "90", label: "90 days", days: 90 }, { v: "30", label: "30 days", days: 30 }];

export default function Transparency() {
  const { data: meta } = useMeta();
  const navigate = useNavigate();
  const [range, setRange] = useState("all");
  const [dept, setDept] = useState("");
  const date_from = useMemo(() => { const d = RANGES.find((r) => r.v === range)!.days; return d ? new Date(Date.now() - d * 86400_000).toISOString() : undefined; }, [range]);
  const f = { date_from, department: dept || undefined };
  const ov = useQuery({ queryKey: ["stats", "overview", f], queryFn: () => api.get<Overview>("/api/stats/overview", f) });
  const trends = useQuery({ queryKey: ["stats", "trends", dept], queryFn: () => api.get<TrendPoint[]>("/api/stats/trends", { department: dept || undefined }) });
  const cats = useQuery({ queryKey: ["stats", "categories", f], queryFn: () => api.get<CategoryStat[]>("/api/stats/categories", f) });
  const depts = useQuery({ queryKey: ["stats", "departments", date_from], queryFn: () => api.get<DeptScore[]>("/api/stats/departments", { date_from }) });
  const commitments = useQuery({ queryKey: ["commitments"], queryFn: () => api.get<Commitment[]>("/api/commitments") });
  const spend = useQuery({ queryKey: ["expenditures"], queryFn: () => api.get<Expenditure[]>("/api/expenditures") });
  const news = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<Announcement[]>("/api/announcements") });
  const o = ov.data;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <h1 className="t-h1">How we're <em>doing</em></h1>
          <p className="mt-2 max-w-2xl text-slate">How civic issues are being handled, computed live from every record on the platform. Sample sizes are shown next to averages so small numbers aren't over-read.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={dept} onChange={(e) => setDept(e.target.value)} className="w-56" aria-label="Department">
            <option value="">All departments</option>
            {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.v, label: r.label }))} />
        </div>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2  border border-line bg-surface px-4 py-3 t-body-sm text-slate">
        <span className="flex items-center gap-1.5"><span className="size-2 bg-sage-300" />Live data, generated {o ? fmtDateTime(o.generated_at) : "…"}</span>
        {o?.date_range.from && <span>Covers reports from {fmtDate(o.date_range.from)} to {fmtDate(o.date_range.to)}</span>}
        {o && o.demo_rows > 0 && <span className="flex items-center gap-1.5"><DemoBadge />{o.demo_rows} of {o.total} records are sample data seeded for demonstration</span>}
      </div>

      {/* headline numbers */}
      <section className="mt-6 grid gap-px overflow-hidden  border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        <Big label="Total reports" value={o?.total} sub={o ? `${o.rejected} rejected with recorded reasons` : ""} />
        <Big label="Resolution rate" value={o ? pct(o.resolution_rate) : undefined} sub={o ? `${o.resolved} resolved of ${o.total - o.rejected} valid reports` : ""} />
        <Big label="Average time to resolve" value={o ? duration(o.avg_resolution_hours) : undefined} sub={o ? `Across ${o.resolved_sample} resolved issues` : ""} />
        <Big label="Overdue right now" value={o?.overdue} tone={o && o.overdue > 0 ? "red" : undefined} sub="Open issues past their SLA deadline" />
        <Big label="Pending review" value={o?.pending} sub="Submitted, not yet verified" />
        <Big label="In progress" value={o ? o.in_progress + o.verified : undefined} sub="Verified, assigned or on site" />
        <Big label="First response" value={o ? duration(o.avg_response_hours) : undefined} sub={o ? `Average over ${o.response_sample} issues` : ""} />
        <Big label="Citizen satisfaction" value={o?.satisfaction_avg ? `${o.satisfaction_avg.toFixed(1)}/5` : "—"} sub={o ? `${o.satisfaction_sample} ratings · ${o.confirmed_fixed} said it was fixed` : ""} />
      </section>

      <section className="mt-10 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <Panel className="p-6">
          <h2 className="t-h2">Monthly trend</h2>
          <p className="mb-4 text-sm text-slate">Reports received and resolved each month.</p>
          {trends.data ? <TrendChart data={trends.data} /> : <Skeleton className="h-72" />}
        </Panel>
        <Panel className="p-6">
          <h2 className="t-h2">Where things stand</h2>
          <p className="mb-6 text-sm text-slate">Current status of every report in range.</p>
          {o ? <StatusDonut parts={[
            { label: "Pending review", value: o.pending + o.reopened, color: "var(--yellow-400)" },
            { label: "In progress", value: o.in_progress + o.verified, color: "var(--blue-500)" },
            { label: "Waiting for a check", value: o.awaiting_verification, color: "var(--sage-300)" },
            { label: "Resolved", value: o.resolved, color: "var(--green-600)" },
            { label: "Closed", value: o.rejected, color: "var(--stone-200)" },
          ]} /> : <Skeleton className="h-40" />}
        </Panel>
      </section>

      <section className="mt-6">
        <Panel className="p-6">
          <h2 className="t-h2">By category</h2>
          <p className="mb-5 text-sm text-slate">Grey is every report; green is the share that's been fixed. Choose a category to see its reports.</p>
          {cats.data ? <div className="grid gap-x-10 md:grid-cols-2"><CategoryBars data={cats.data.slice(0, Math.ceil(cats.data.length / 2))} onSelect={(id) => navigate(`/issues?category=${id}`)} /><CategoryBars data={cats.data.slice(Math.ceil(cats.data.length / 2))} onSelect={(id) => navigate(`/issues?category=${id}`)} /></div> : <Skeleton className="h-48" />}
        </Panel>
      </section>

      <section id="departments" className="mt-6 scroll-mt-24">
        <Panel className="p-6">
          <h2 className="t-h2">Department accountability</h2>
          <p className="mb-4 flex items-start gap-1.5 text-sm text-slate"><Info className="mt-0.5 size-4 shrink-0" />Listed alphabetically, not ranked. Departments handle different kinds of work, so resolution times aren't directly comparable. Rates are hidden below five reports.</p>
          {depts.data ? <Scorecards data={depts.data} /> : <Skeleton className="h-64" />}
        </Panel>
      </section>

      <section id="promises" className="mt-14 scroll-mt-24">
        <h2 className="t-h1">Public commitments</h2>
        <p className="mt-1 mb-5 text-slate">Projects and repairs the city has publicly promised, with progress as reported by the responsible department.</p>
        {commitments.data?.length === 0 && <Panel><EmptyState title="No commitments published yet" /></Panel>}
        <div className="grid gap-4 md:grid-cols-2">
          {commitments.data?.map((c) => {
            const late = c.status !== "completed" && new Date(c.expected_completion) < new Date();
            return (
              <Panel key={c.id} className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={c.status === "completed" ? "green" : c.status === "delayed" || late ? "amber" : c.status === "in_progress" ? "teal" : "neutral"}>
                    {c.status === "in_progress" ? "→ In progress" : c.status === "delayed" || late ? "! Behind schedule" : c.status === "completed" ? "✓ Done" : "○ Planned"}
                  </Badge>
                  {c.is_demo && <DemoBadge />}
                </div>
                <h3 className="t-h3 mt-3">{c.title}</h3>
                <p className="mt-1 text-sm text-slate">{c.description}</p>
                <div className="mt-4 flex items-center gap-3">
                  <div className="h-2.5 flex-1 border border-ink bg-raised"><div className="h-full bg-sage-300" style={{ width: `${c.progress_percent}%` }} /></div>
                  <span className="num w-10 text-right text-sm font-semibold">{c.progress_percent}%</span>
                </div>
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate">
                  <span>{c.department.name}{c.locality ? `, ${c.locality.name}` : ""}</span>
                  <span className={cn("inline-flex items-center gap-1", late && "text-red")}><CalendarClock className="size-3.5" />Due {fmtDate(c.expected_completion)}</span>
                  <span>Updated {fmtDate(c.updated_at)}</span>
                  {c.evidence_url && <a href={c.evidence_url} target="_blank" rel="noreferrer" className="text-ink underline underline-offset-4 hover:text-ink">Evidence</a>}
                </p>
              </Panel>
            );
          })}
        </div>
      </section>

      <section id="spending" className="mt-14 scroll-mt-24">
        <h2 className="t-h1">Spending on repairs</h2>
        <p className="mt-1 mb-5 max-w-3xl text-slate">Figures appear only when a department has recorded them. Unverified figures are labelled; a figure is marked verified only when it links to a source document.</p>
        <Panel className="overflow-x-auto">
          {spend.data?.length === 0 ? <EmptyState art="inbox" title="No expenditure published yet" body="No department has recorded spending data. Nothing is estimated or inferred in its place." /> : (
            <table className="w-full min-w-[720px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-slate">
                <th className="px-5 py-3 font-medium">Work</th><th className="px-3 py-3 font-medium">Department</th>
                <th className="px-3 py-3 text-right font-medium">Estimated</th><th className="px-3 py-3 text-right font-medium">Actual</th>
                <th className="px-3 py-3 font-medium">Status</th><th className="px-5 py-3 font-medium">Updated</th>
              </tr></thead>
              <tbody>
                {spend.data?.map((e) => (
                  <tr key={e.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3"><p className="text-ink">{e.work_description}</p>{e.issue && <p className="text-xs text-ink">{e.issue.tracking_id}</p>}</td>
                    <td className="px-3">{e.department.name}</td>
                    <td className="num px-3 text-right">{money(e.estimated_cost)}</td>
                    <td className="num px-3 text-right">{e.actual_cost === null ? <span className="text-mute">Not recorded</span> : money(e.actual_cost)}</td>
                    <td className="px-3">
                      <div className="flex flex-wrap gap-1">
                        {e.verification_status === "verified" ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Unverified</Badge>}
                        {e.is_demo && <DemoBadge />}
                        {e.source_document_url && <a href={e.source_document_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-ink"><FileText className="size-3" />Source</a>}
                      </div>
                    </td>
                    <td className="px-5 text-xs text-slate">{fmtDate(e.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </section>

      <section id="announcements" className="mt-14 scroll-mt-24">
        <h2 className="t-h1">Announcements</h2>
        <div className="mt-5 space-y-3">
          {news.data?.map((a) => (
            <Panel key={a.id} className="flex gap-4 p-5">
              <span className="grid size-10 shrink-0 place-items-center border-[1.5px] border-ink bg-raised text-ink">{a.is_pinned ? <Pin className="size-4" /> : <Megaphone className="size-4" />}</span>
              <div>
                <h3 className="font-semibold text-ink">{a.title}</h3>
                <p className="mt-1 t-body text-ink/85">{a.body}</p>
                <p className="mt-2 text-xs text-slate">{[a.department, a.locality, fmtDate(a.created_at)].filter(Boolean).join(" · ")}</p>
              </div>
            </Panel>
          ))}
          {news.data?.length === 0 && <Panel><EmptyState art="inbox" title="No announcements" /></Panel>}
        </div>
      </section>
    </div>
  );
}

function Big({ label, value, sub, tone }: { label: string; value?: React.ReactNode; sub?: string; tone?: "red" }) {
  return (
    <div className="bg-surface p-5">
      <p className="text-sm text-slate">{label}</p>
      {value === undefined ? <Skeleton className="mt-2 h-9 w-24" /> : <p className={cn("num mt-1 t-h1 leading-none", tone === "red" ? "text-red" : "text-ink")}>{value}</p>}
      {sub && <p className="mt-2 text-xs text-slate">{sub}</p>}
    </div>
  );
}
