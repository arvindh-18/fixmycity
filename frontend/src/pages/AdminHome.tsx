import { Trash, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { IssueCard } from "../components/IssueCard";
import { Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Issue, StaffMember, Stats } from "../lib/types";

/** Admin landing page. Kept simple; the full dashboard (assignments, merges, charts) builds on this. */
export default function AdminHome() {
  const { me } = useAuth();
  const toast = useToast();
  const [stats, setStats] = useState<Stats | null>(null);
  const [latest, setLatest] = useState<Issue[] | null>(null);
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"worker" | "admin">("worker");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
    api<Issue[]>("/api/issues", { query: { status: "open", limit: 6 } }).then(setLatest).catch(() => setLatest([]));
    api<StaffMember[]>("/api/staff").then(setStaff).catch((e) => toast((e as Error).message, "err"));
  }, [toast]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      setStaff(await api<StaffMember[]>("/api/staff", { body: { email, role } }));
      setEmail("");
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
          { label: "Waiting for action", v: stats?.open },
          { label: "Being fixed", v: stats?.in_progress },
          { label: "Fixed", v: stats?.resolved },
          { label: "New this week", v: stats?.this_week },
        ].map((t) => (
          <div key={t.label} className="bg-white p-5">
            <dt className="text-sm text-ink-2">{t.label}</dt>
            <dd className="mt-1 font-display text-3xl font-extrabold tabular-nums">{t.v ?? "—"}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-10 grid gap-10 lg:grid-cols-[1fr_380px]">
        <section>
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold">Newest reports needing action</h2>
            <Link to="/issues?status=open" className="text-sm font-semibold text-civic hover:underline">See all</Link>
          </div>
          <div className="mt-4 space-y-3">
            {!latest ? <Spinner /> : latest.length === 0 ? <p className="text-ink-3">Nothing waiting. 🎉</p> :
              latest.map((i) => <IssueCard key={i.id} issue={i} compact />)}
          </div>
        </section>

        <section>
          <h2 className="text-xl font-bold">Team</h2>
          <p className="mt-1 text-sm text-ink-2">Add a worker's email here. They then sign in on the “Field worker” tab.</p>
          <form onSubmit={add} className="mt-4 space-y-2">
            <input type="email" required className="field" placeholder="worker@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <div className="flex gap-2">
              <select className="field" value={role} onChange={(e) => setRole(e.target.value as "worker" | "admin")}>
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
                    <div className="truncate text-[15px] font-medium">{m.email}</div>
                    <div className="text-xs text-ink-3">{m.role === "admin" ? "City admin" : "Field worker"}{m.source === "env" && " · set on server"}</div>
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
