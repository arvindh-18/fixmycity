import { CheckCircle2, LocateFixed, Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { FixSheet } from "../components/FixSheet";
import { IssueCard } from "../components/IssueCard";
import { Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDistance, useMyLocation } from "../lib/location";
import type { Issue } from "../lib/types";

type Tab = "mine" | "nearby" | "done";
const TABS: { id: Tab; label: string }[] = [
  { id: "mine", label: "My jobs" },
  { id: "nearby", label: "Nearby" },
  { id: "done", label: "Done" },
];

const DAY = 86_400_000;

function JobCard({ issue, onChange }: { issue: Issue; onChange: (i: Issue) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);

  async function start() {
    setBusy(true);
    try {
      onChange(await api<Issue>(`/api/issues/${issue.id}/status`, { body: { status: "in_progress", note: "Work started." } }));
      toast("Marked as being fixed.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  const active = issue.status === "open" || issue.status === "in_progress";
  return (
    <div>
      <IssueCard issue={issue} />
      {issue.distance_m != null && <p className="mt-1 px-1 text-xs text-ink-3">{formatDistance(issue.distance_m)}</p>}
      {active && (
        <div className="mt-2 grid grid-cols-2 gap-2">
          <button className="btn-ghost h-12" onClick={start} disabled={busy || issue.status === "in_progress"}>
            {busy ? <Spinner size={16} /> : <Play size={17} />} {issue.status === "in_progress" ? "Started" : "Start work"}
          </button>
          <button className="btn-ink h-12" onClick={() => setFixing(true)}>
            <CheckCircle2 size={18} /> Mark fixed
          </button>
        </div>
      )}
      {fixing && <FixSheet issue={issue} onClose={() => setFixing(false)} onDone={(i) => (setFixing(false), onChange(i))} />}
    </div>
  );
}

/** Field worker landing page. */
export default function WorkerHome() {
  const { me } = useAuth();
  const { loc, locating, error, locate } = useMyLocation();
  const [tab, setTab] = useState<Tab>("mine");
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [done, setDone] = useState<Issue[]>([]);

  // Done jobs also feed the "My week" summary, so load them once up front.
  useEffect(() => {
    api<Issue[]>("/api/issues", { query: { worker: "me", status: "resolved", sort: "fixed", limit: 200 } }).then(setDone).catch(() => {});
  }, []);

  useEffect(() => {
    if (tab === "done") return;
    if (tab === "nearby" && !loc) return setIssues(null);
    setIssues(null);
    const req = tab === "mine"
      ? api<Issue[]>("/api/issues", { query: { worker: "me", status: "active", sort: "top" } })
      : api<Issue[]>("/api/issues/near", { query: { lat: loc!.lat, lng: loc!.lng, radius: 3000, status: "open", unassigned: true } });
    req.then(setIssues).catch(() => setIssues([]));
  }, [tab, loc]);

  useEffect(() => {
    if (tab === "nearby" && !loc && !locating && !error) locate();
  }, [tab, loc, locating, error, locate]);

  function update(i: Issue) {
    setIssues((list) => list && (i.status === "resolved" ? list.filter((x) => x.id !== i.id) : list.map((x) => (x.id === i.id ? { ...x, ...i } : x))));
    if (i.status === "resolved") setDone((d) => [i, ...d.filter((x) => x.id !== i.id)]);
  }

  const shown = tab === "done" ? done : issues;

  const week = useMemo(() => {
    const recent = done.filter((i) => i.resolved_at && Date.now() - new Date(i.resolved_at).getTime() < 7 * DAY);
    const spans = recent.map((i) => (new Date(i.resolved_at!).getTime() - new Date(i.created_at).getTime()) / DAY);
    return { count: recent.length, avg: spans.length ? (spans.reduce((a, b) => a + b, 0) / spans.length).toFixed(1) : null };
  }, [done]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-sm font-semibold text-civic">Field worker</p>
      <h1 className="text-[clamp(28px,4vw,40px)] font-extrabold">Today's jobs, {me?.name.split(" ")[0]}</h1>

      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line">
        <div className="bg-white p-4">
          <dt className="text-sm text-ink-2">Fixed this week</dt>
          <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums">{week.count}</dd>
        </div>
        <div className="bg-white p-4">
          <dt className="text-sm text-ink-2">Days to fix, on average</dt>
          <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums">{week.avg ?? "—"}</dd>
        </div>
      </dl>

      <div className="mt-6 inline-flex rounded-full border border-line-2 bg-white p-1" role="tablist" aria-label="Jobs">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={`h-9 rounded-full px-4 text-sm font-semibold ${tab === t.id ? "bg-ink text-white" : "text-ink-2"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "nearby" && (
        <p className="mt-3 text-sm text-ink-2">Unassigned problems within 3 km of you. Pick one up and start work.</p>
      )}
      {tab === "nearby" && error && (
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-st-open-soft px-4 py-3 text-sm">
          <span className="flex-1">{error}</span>
          <button className="btn-ghost btn-sm" onClick={locate}><LocateFixed size={15} /> Try again</button>
        </div>
      )}

      <div className="mt-5 space-y-5">
        {shown === null ? (
          tab === "nearby" && error ? null : <div className="flex justify-center py-16 text-ink-3"><Spinner size={22} /></div>
        ) : shown.length === 0 ? (
          <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-8 text-center text-ink-2">
            {tab === "mine" ? "No jobs assigned to you right now. Check Nearby for open problems." : tab === "nearby" ? "Nothing open near you. 🎉" : "Nothing fixed yet."}
          </p>
        ) : (
          shown.map((i) => <JobCard key={i.id} issue={i} onChange={update} />)
        )}
      </div>
    </div>
  );
}
