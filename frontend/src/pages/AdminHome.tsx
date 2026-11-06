import { AlertTriangle, Copy, Trash, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { IssueCard } from "../components/IssueCard";
import { ProofOfWork } from "../components/ProofOfWork";
import { Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Issue, StaffMember, Stats } from "../lib/types";

const DAY = 86_400_000;

/** Open reports ranked by +1s, rechecking flags, and how long they've waited. */
function priority(i: Issue) {
  return (
    (i.status === "rechecking" ? 25 : 0) +
    i.upvotes * 2 +
    (Date.now() - new Date(i.created_at).getTime()) / DAY +
    (i.severity === "high" ? 5 : 0)
  );
}

function AssignRow({ issue, workers, onChange }: { issue: Issue; workers: StaffMember[]; onChange: (i: Issue) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function assign(email: string) {
    setBusy(true);
    try {
      onChange(await api<Issue>(`/api/issues/${issue.id}/assign`, { body: { email } }));
      toast(email ? `Assigned to ${email}.` : "Unassigned.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-2 flex items-center gap-2 px-1">
      <label htmlFor={`as-${issue.id}`} className="shrink-0 text-sm text-ink-2">Assign to</label>
      <select id={`as-${issue.id}`} value={issue.assigned_to_email} disabled={busy} onChange={(e) => assign(e.target.value)}
        className="h-9 min-w-0 flex-1 rounded-full border border-line-2 bg-white px-3 text-sm">
        <option value="">Nobody yet</option>
        {workers.map((w) => <option key={w.email} value={w.email}>{w.name || w.email} ({w.open_jobs} open)</option>)}
      </select>
      {busy && <Spinner size={14} />}
    </div>
  );
}

/** Admin landing page. */
export default function AdminHome() {
  const { me } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [open, setOpen] = useState<Issue[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [dupes, setDupes] = useState<number | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<"worker" | "admin">("worker");
  const [busy, setBusy] = useState(false);

  const loadStaff = () => api<StaffMember[]>("/api/staff").then(setStaff).catch((e) => toast((e as Error).message, "err"));

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
    api<Issue[]>("/api/issues", { query: { status: "active", limit: 200 } }).then(setOpen).catch(() => setOpen([]));
    api<unknown[]>("/api/admin/duplicates").then((d) => setDupes(d.length)).catch(() => setDupes(0));
    loadStaff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attention = useMemo(() => (open ?? []).slice().sort((a, b) => priority(b) - priority(a)).slice(0, 8), [open]);
  const rechecking = useMemo(() => (open ?? []).filter((i) => i.status === "rechecking"), [open]);
  const workers = useMemo(() => (staff ?? []).filter((m) => m.role === "worker"), [staff]);

  function updateIssue(i: Issue) {
    setOpen((list) => list && list.map((x) => (x.id === i.id ? { ...x, ...i } : x)));
    loadStaff(); // refresh open-job counts
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setStaff(await api<StaffMember[]>("/api/staff", { body: { email, role, name } }));
      setEmail("");
      setName("");
      toast(`${email} can now sign in as a ${role === "admin" ? "city admin" : "field worker"}.`);
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove(m: StaffMember) {
    if (!window.confirm(`Remove ${m.email} from the team? They'll become a regular resident.`)) return;
    try {
      setStaff(await api<StaffMember[]>(`/api/staff/${encodeURIComponent(m.email)}`, { method: "DELETE" }));
    } catch (err) {
      toast((err as Error).message, "err");
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-sm font-semibold text-civic">City admin</p>
      <h1 className="text-[clamp(28px,4vw,40px)] font-extrabold">Hello, {me?.name.split(" ")[0]}</h1>

      <dl className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-4">
        {[
          { label: "Waiting for action", v: stats?.open, sub: "reported, not started" },
          { label: "Being fixed", v: stats?.in_progress, sub: "work in progress" },
          { label: "Fixed in the last 7 days", v: stats?.fixed_this_week, sub: `${stats?.this_week ?? "—"} new in the last 7 days` },
          { label: "Days to fix, on average", v: stats?.avg_days_to_fix ?? "—", sub: "from report to fixed" },
        ].map((t) => (
          <div key={t.label} className="bg-white p-5">
            <dt className="text-sm font-semibold text-ink-2">{t.label}</dt>
            <dd className="mt-1 font-display text-[clamp(30px,4vw,42px)] font-extrabold leading-none tabular-nums">{t.v ?? "—"}</dd>
            <dd className="mt-1.5 text-sm text-ink-3">{t.sub}</dd>
          </div>
        ))}
      </dl>

      {rechecking.length > 0 && (
        <Link
          to="/issues?status=rechecking"
          className="mt-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-amber-300 bg-amber-50 px-4 py-3 hover:border-amber-400"
        >
          <AlertTriangle size={18} className="shrink-0 text-amber-600" />
          <span className="flex-1 text-amber-950">
            <span className="font-semibold">{rechecking.length} report{rechecking.length === 1 ? "" : "s"} reopened for rechecking</span> — resident flagged fix as fake or incomplete
          </span>
          <span className="text-sm font-semibold text-amber-800">Inspect</span>
        </Link>
      )}

      {!!dupes && (
        <Link to="/admin/duplicates" className="mt-4 flex items-center gap-3 rounded-[var(--radius-card)] border border-paint bg-[#FDF7E3] px-4 py-3 hover:border-paint-deep">
          <Copy size={18} className="shrink-0" />
          <span className="flex-1"><span className="font-semibold">{dupes} possible duplicate{dupes === 1 ? "" : "s"}</span> to review</span>
          <span className="text-sm font-semibold text-civic">Review</span>
        </Link>
      )}

      <div className="mt-6">
        <ProofOfWork />
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]">
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">Needs attention</h2>
            <Link to="/issues?status=active&sort=top" className="text-sm font-semibold text-civic hover:underline">All open reports</Link>
          </div>
          <p className="mt-1 text-sm text-ink-2">Most +1s, urgent, and waiting longest come first.</p>
          <div className="mt-4 space-y-5">
            {!open ? <Spinner /> : attention.length === 0 ? <p className="text-ink-3">Nothing waiting. 🎉</p> :
              attention.map((i) => (
                <div key={i.id}>
                  <IssueCard issue={i} compact />
                  <AssignRow issue={i} workers={workers} onChange={updateIssue} />
                </div>
              ))}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold">Team</h2>
          <p className="mt-1 text-sm text-ink-2">Add a worker here. They sign in on the “Field worker” tab. Residents see their name, never their email.</p>
          <form onSubmit={add} className="mt-4 space-y-2">
            <input className="field" placeholder="Name residents will see, e.g. Ravi K" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" maxLength={120} />
            <input type="email" required className="field" placeholder="worker@example.com" value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Email" />
            <div className="flex gap-2">
              <select className="field" value={role} onChange={(e) => setRole(e.target.value as "worker" | "admin")} aria-label="Role">
                <option value="worker">Field worker</option>
                <option value="admin">City admin</option>
              </select>
              <button className="btn-ink btn-sm h-12 shrink-0" disabled={busy}>{busy ? <Spinner size={14} /> : <UserPlus size={16} />} Add</button>
            </div>
          </form>
          <ul className="mt-5 divide-y divide-line rounded-[var(--radius-card)] border border-line bg-white">
            {!staff ? <li className="p-4"><Spinner /></li> : staff.length === 0 ? <li className="p-4 text-sm text-ink-3">No team members yet.</li> :
              staff.map((m) => (
                <li key={m.email} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-medium">{m.name || m.email}</div>
                    {m.name && <div className="truncate text-xs text-ink-3">{m.email}</div>}
                    <div className="text-xs text-ink-3">
                      {m.role === "admin" ? "City admin" : "Field worker"}
                      {m.role === "worker" && ` · ${m.open_jobs} open job${m.open_jobs === 1 ? "" : "s"}`}
                      {m.source === "env" && " · set on server"}
                    </div>
                  </div>
                  {m.source === "app" && (
                    <button onClick={() => remove(m)} className="btn btn-sm text-danger hover:bg-chalk" aria-label={`Remove ${m.email}`}><Trash size={15} /></button>
                  )}
                </li>
              ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
