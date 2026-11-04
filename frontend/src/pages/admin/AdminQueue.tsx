import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Search, TriangleAlert } from "lucide-react";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import type { IssueCard, Paged } from "@/types";
import { Button, DemoBadge, EmptyState, Input, Panel, Segmented, Select, Skeleton } from "@/components/ui";
import { CategoryIcon, PriorityTag, SLAMeter, StatusChip } from "@/components/issue/bits";
import { useQueues } from "@/layouts/AdminLayout";
import { ago } from "@/utils/format";

export default function AdminQueue() {
  const { data: meta } = useMeta();
  const { data: qs } = useQueues();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const queue = sp.get("overdue") ? "overdue" : sp.get("queue") ?? "all";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const page = Number(sp.get("page") ?? 1);
  const params = {
    queue: ["verification", "assignment", "review"].includes(queue) ? queue : undefined, overdue: queue === "overdue" ? true : undefined,
    q: sp.get("q") || undefined, category: sp.get("category") || undefined, department: sp.get("department") || undefined,
    locality: sp.get("locality") || undefined, priority: sp.get("priority") || undefined,
    sort: sp.get("sort") ?? (queue === "all" ? "updated" : "oldest"), page, page_size: 25,
  };
  const { data, isLoading } = useQuery({ queryKey: ["admin", "issues", params], queryFn: () => api.get<Paged<IssueCard>>("/api/admin/issues", params), placeholderData: keepPreviousData });
  const set = (k: string, v?: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== "page") n.delete("page"); setSp(n); };
  const setQueue = (v: string) => { const n = new URLSearchParams(sp); n.delete("queue"); n.delete("overdue"); n.delete("page"); if (v === "overdue") n.set("overdue", "1"); else if (v !== "all") n.set("queue", v); setSp(n); };
  useEffect(() => { const t = setTimeout(() => q !== (sp.get("q") ?? "") && set("q", q), 300); return () => clearTimeout(t); }, [q]); // eslint-disable-line
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="t-h1">Issue queue</h1>
        <Segmented value={queue} onChange={setQueue} options={[
          { value: "verification", label: "To verify", count: qs?.verification }, { value: "assignment", label: "To assign", count: qs?.assignment },
          { value: "review", label: "To review", count: qs?.review }, { value: "overdue", label: "Overdue", count: qs?.overdue }, { value: "all", label: "All" }]} />
      </div>
      <div className="grid gap-2 md:grid-cols-[1fr_repeat(4,minmax(0,160px))]">
        <div className="relative"><Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, address, tracking ID" className="h-9 pl-9" aria-label="Search" /></div>
        <Select className="h-9" value={sp.get("category") ?? ""} onChange={(e) => set("category", e.target.value)} aria-label="Category"><option value="">All categories</option>{meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select className="h-9" value={sp.get("department") ?? ""} onChange={(e) => set("department", e.target.value)} aria-label="Department"><option value="">All departments</option>{meta?.departments.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select className="h-9" value={sp.get("locality") ?? ""} onChange={(e) => set("locality", e.target.value)} aria-label="Locality"><option value="">All localities</option>{meta?.localities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>
        <Select className="h-9" value={sp.get("priority") ?? ""} onChange={(e) => set("priority", e.target.value)} aria-label="Priority"><option value="">Any priority</option>{["critical", "high", "medium", "low"].map((p) => <option key={p} value={p}>{p[0].toUpperCase() + p.slice(1)}</option>)}</Select>
      </div>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[920px] text-sm">
          <thead className="bg-paper/60">
            <tr className="border-b border-line text-left text-xs text-slate">
              <th className="px-4 py-2.5 font-medium">Issue</th><th className="px-3 py-2.5 font-medium">Locality</th><th className="px-3 py-2.5 font-medium">Priority</th>
              <th className="px-3 py-2.5 font-medium">Status</th><th className="px-3 py-2.5 font-medium">Deadline</th><th className="px-3 py-2.5 text-right font-medium">Support</th><th className="px-4 py-2.5 text-right font-medium">Reported</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && Array.from({ length: 8 }).map((_, i) => <tr key={i}><td colSpan={7} className="px-4 py-2"><Skeleton className="h-8" /></td></tr>)}
            {data?.items.map((i) => (
              <tr key={i.id} onClick={() => navigate(`/admin/issues/${i.tracking_id}`)} className="cursor-pointer border-b border-line last:border-0 hover:bg-paper/70">
                <td className="max-w-[380px] px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <CategoryIcon icon={i.category?.icon} className="shrink-0 text-slate" />
                    <span className="truncate font-medium text-ink">{i.title}</span>
                    {i.escalation_level >= 2 && i.status !== "resolved" && <TriangleAlert className="size-3.5 shrink-0 text-red" aria-label="Overdue" />}
                  </div>
                  <p className="num mt-0.5 flex items-center gap-2 pl-6 text-xs text-slate">{i.tracking_id}{i.department && <span>· {i.department.name}</span>}{i.is_demo && <DemoBadge className="scale-90" />}</p>
                </td>
                <td className="px-3 text-slate">{i.locality?.name ?? "—"}</td>
                <td className="px-3"><PriorityTag priority={i.priority} /></td>
                <td className="px-3"><StatusChip status={i.status} size="sm" /></td>
                <td className="px-3"><SLAMeter sla={i.sla} compact />{i.sla.state === "none" && <span className="text-xs text-mute">—</span>}</td>
                <td className="num px-3 text-right">{i.support_count || ""}</td>
                <td className="px-4 text-right text-xs text-slate">{ago(i.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data?.items.length === 0 && <EmptyState art="check" title="Queue is clear" body="Nothing here needs action right now." />}
      </Panel>
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate">
          <span><span className="num">{data?.total}</span> issues</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button>
            <span className="num">Page {page} of {pages}</span>
            <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</Button>
          </div>
        </div>
      )}
    </div>
  );
}
