import { List, LocateFixed, Map as MapIcon, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AreaSearch, type AreaPick } from "../components/AreaSearch";
import { IssueCard } from "../components/IssueCard";
import { IssueMap } from "../components/IssueMap";
import { NearMe } from "../components/NearMe";
import { Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Issue, Stats } from "../lib/types";

const STATUS_TABS = [
  { id: "active", label: "Open" },
  { id: "rechecking", label: "Rechecking" },
  { id: "resolved", label: "Fixed" },
  { id: "", label: "All" },
];

export default function Browse() {
  const { config, me } = useAuth();
  const [params, setParams] = useSearchParams();
  const pincode = params.get("pincode") ?? "";
  const locality = params.get("locality") ?? "";
  const status = params.get("status") ?? "active";
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "new";
  const mine = params.get("mine") === "1";

  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");
  const [hover, setHover] = useState<number | null>(null);
  const [view, setView] = useState<"list" | "map">("list");
  const [nearMe, setNearMe] = useState(params.get("near") === "1");

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    setIssues(null);
    setError("");
    api<Issue[]>("/api/issues", { query: { pincode, locality, status: status === "all" ? "" : status, category, sort, mine } })
      .then(setIssues)
      .catch((e) => (setError(e.message), setIssues([])));
  }, [pincode, locality, status, category, sort, mine, me?.uid]);

  useEffect(() => {
    api<Stats>("/api/stats", { query: { pincode, locality } }).then(setStats).catch(() => setStats(null));
  }, [pincode, locality]);

  const area = [locality, pincode].filter(Boolean).join(" ");
  const heading = mine ? "My reports" : area ? `Reports in ${area}` : `Reports in ${config?.city.name ?? "Chennai"}`;
  const center: [number, number] = [config?.city.lat ?? 13.0827, config?.city.lng ?? 80.2707];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="min-w-0 flex-1">
          <h1 className="text-[clamp(28px,4vw,40px)] font-extrabold">{heading}</h1>
          {stats && !mine && (
            <p className="mt-2 text-ink-2">
              {stats.total} reported · <span className="font-semibold text-ink">{stats.open + stats.in_progress} open</span> ·{" "}
              {stats.resolved} fixed
              {stats.avg_days_to_fix != null && <> · fixed in {stats.avg_days_to_fix} days on average</>}
            </p>
          )}
        </div>
        <div className="w-full md:w-[380px]">
          <AreaSearch
            value={{ pincode, locality }}
            onPick={(a: AreaPick) => set({ pincode: a.pincode ?? "", locality: a.locality ?? "" })}
          />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-full border border-line-2 bg-white p-1" role="tablist" aria-label="Status">
          {STATUS_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={status === t.id}
              onClick={() => set({ status: t.id || "all" })}
              className={`h-8 rounded-full px-4 text-sm font-semibold ${status === t.id || (t.id === "" && status === "all") ? "bg-ink text-white" : "text-ink-2"}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <select
          value={category}
          onChange={(e) => set({ category: e.target.value })}
          className="h-10 rounded-full border border-line-2 bg-white px-4 text-sm font-medium"
          aria-label="Category"
        >
          <option value="">All problems</option>
          {config?.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        <select
          value={sort}
          onChange={(e) => set({ sort: e.target.value })}
          className="h-10 rounded-full border border-line-2 bg-white px-4 text-sm font-medium"
          aria-label="Sort"
        >
          <option value="new">Newest first</option>
          <option value="top">Most +1s</option>
        </select>
        <button className="chip" aria-pressed={nearMe} onClick={() => setNearMe((v) => !v)}>
          <LocateFixed size={15} /> Use my location
        </button>
        {me?.role === "public" && (
          <button className="chip" aria-pressed={mine} onClick={() => set({ mine: mine ? "" : "1" })}>
            Only mine
          </button>
        )}
        <div className="ml-auto inline-flex rounded-full border border-line-2 bg-white p-1 lg:hidden">
          {(["list", "map"] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${view === v ? "bg-ink text-white" : "text-ink-2"}`}
            >
              {v === "list" ? <List size={15} /> : <MapIcon size={15} />} {v === "list" ? "List" : "Map"}
            </button>
          ))}
        </div>
      </div>

      {nearMe && (
        <div className="mt-6">
          <NearMe autoStart onClose={() => setNearMe(false)} />
        </div>
      )}

      <div className={`mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] ${nearMe ? "hidden" : ""}`}>
        <div className={view === "map" ? "hidden lg:block" : ""}>
          {issues === null ? (
            <div className="flex justify-center py-20 text-ink-3"><Spinner size={24} /></div>
          ) : error ? (
            <p className="rounded-xl bg-st-open-soft p-4 text-sm">{error}</p>
          ) : issues.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-10 text-center">
              <p className="font-semibold">Nothing here{status === "active" ? " that's still open" : ""}.</p>
              <p className="mt-1 text-sm text-ink-2">
                {area ? "Seen a problem in this area? Report it and it'll show up here." : "Try another area or filter."}
              </p>
              <Link to="/report" className="btn-paint mt-4"><Plus size={18} /> Report a problem</Link>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-ink-3">{issues.length} {issues.length === 1 ? "report" : "reports"}</p>
              {issues.map((i) => (
                <IssueCard key={i.id} issue={i} active={hover === i.id} onHover={setHover} />
              ))}
            </div>
          )}
        </div>
        <div className={`${view === "list" ? "hidden lg:block" : ""} lg:sticky lg:top-24 lg:self-start`}>
          <div className="h-[70vh] overflow-hidden rounded-[var(--radius-card)] border border-line lg:h-[calc(100vh-8rem)]">
            <IssueMap issues={issues ?? []} center={center} activeId={hover} onHover={setHover} />
          </div>
        </div>
      </div>
    </div>
  );
}
