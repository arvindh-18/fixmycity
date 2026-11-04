import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Search } from "lucide-react";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import type { IssueCard, Paged } from "@/types";
import { Button, EmptyState, Input, Panel, Select, Skeleton } from "@/components/ui";
import { IssueRow } from "@/components/issue/bits";
import { STATUS_GROUPS } from "@/utils/status";

export default function IssuesBrowse() {
  const { data: meta } = useMeta();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const page = Number(sp.get("page") ?? 1);
  const group = sp.get("group") ?? (sp.get("status") === "resolved" ? "done" : "");
  const statuses = group ? STATUS_GROUPS.find((g) => g.key === group)?.statuses : undefined;
  const params = {
    q: sp.get("q") || undefined, status: statuses, category: sp.get("category") || undefined,
    locality: sp.get("locality") || undefined, department: sp.get("department") || undefined,
    sort: sp.get("sort") ?? "newest", page, page_size: 20,
  };
  const { data, isLoading, isFetching } = useQuery({ queryKey: ["issues", params], queryFn: () => api.get<Paged<IssueCard>>("/api/issues", params), placeholderData: keepPreviousData });

  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== "page") n.delete("page"); if (k === "group") n.delete("status"); setSp(n); };
  useEffect(() => { const t = setTimeout(() => q !== (sp.get("q") ?? "") && set("q", q), 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line

  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="t-h1">Public issues</h1>
      <p className="mt-2 text-slate">Every report filed on Commons, with its current status. Open any issue to see its full accountability trail.</p>

      <div className="mt-8 grid gap-3 md:grid-cols-[1fr_repeat(3,minmax(0,170px))]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, address or tracking ID" className="pl-9" aria-label="Search issues" />
        </div>
        <Select value={group} onChange={(e) => set("group", e.target.value)} aria-label="Status">
          <option value="">Any status</option>
          {STATUS_GROUPS.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
        </Select>
        <Select value={sp.get("category") ?? ""} onChange={(e) => set("category", e.target.value)} aria-label="Category">
          <option value="">Any category</option>
          {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={sp.get("locality") ?? ""} onChange={(e) => set("locality", e.target.value)} aria-label="Locality">
          <option value="">Any locality</option>
          {meta?.localities.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-slate">
        <span><span className="num font-medium text-ink">{data?.total ?? "…"}</span> issues{isFetching && !isLoading ? " · updating" : ""}</span>
        <label className="flex items-center gap-2">Sort
          <select value={sp.get("sort") ?? "newest"} onChange={(e) => set("sort", e.target.value)} className="rounded border border-line-2 bg-surface px-2 py-1 text-sm">
            <option value="newest">Newest first</option><option value="updated">Recently updated</option><option value="oldest">Oldest first</option><option value="resolved">Recently resolved</option>
          </select>
        </label>
      </div>

      <Panel className="mt-3 px-2">
        {isLoading ? <div className="space-y-3 py-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-14" />)}</div>
          : data?.items.length ? data.items.map((i) => <IssueRow key={i.id} issue={i} />)
          : <EmptyState title="No issues match" body="Try a different search or clear the filters." action={<Button variant="secondary" onClick={() => { setQ(""); setSp(new URLSearchParams()); }}>Clear filters</Button>} />}
      </Panel>

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-2" aria-label="Pagination">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>Previous</Button>
          <span className="num px-3 text-sm text-slate">Page {page} of {pages}</span>
          <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>Next</Button>
        </nav>
      )}
    </div>
  );
}
