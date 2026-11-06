import { AlertTriangle, ArrowLeft, Check, CheckCircle2, Link2, MapPin, Play, RotateCcw, ThumbsUp, Trash } from "lucide-react";
import { AttributionControl, MapContainer, Marker, TileLayer } from "react-leaflet";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { OSM_ATTR, OSM_TILES, statusIcon } from "../components/IssueMap";
import { FixSheet } from "../components/FixSheet";
import { ReopenSheet } from "../components/ReopenSheet";
import { Messages } from "../components/Messages";
import { CategoryIcon, SeverityText, Spinner, STATUS, StatusPill, timeAgo, useToast } from "../components/ui";
import { api, photoSrc } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Issue, StaffMember, Status } from "../lib/types";

const DAY = 86_400_000;

/** Timeline entries are labelled by status; assignments and merges read better under their own name. */
const stepLabel = (label: string, note: string) =>
  note.startsWith("Assigned to") ? "Assigned" : note.startsWith("Unassigned") ? "Unassigned" : note.startsWith("Merged") ? "Merged" : label;
const daysBetween = (a: string, b?: string | null) =>
  Math.max(0, Math.round(((b ? new Date(b).getTime() : Date.now()) - new Date(a).getTime()) / DAY));

/** Public accountability card: who reported it, who's on it, how long it has taken. Everyone sees this. */
function Accountability({ issue }: { issue: Issue }) {
  const open = issue.status === "open" || issue.status === "in_progress";
  const steps = [
    { done: true, label: "Reported", detail: `by ${issue.is_mine ? "you" : issue.reporter_name}`, when: issue.created_at },
    {
      done: !!issue.assigned_to_name,
      label: issue.assigned_to_name ? `Field worker: ${issue.assigned_to_name}` : "Waiting for a field worker",
      detail: issue.assigned_to_name ? "is responsible for this job" : "A city admin assigns it, or a nearby worker picks it up.",
      when: issue.assigned_at,
    },
    {
      done: issue.status === "resolved",
      label: issue.status === "resolved" ? `Fixed${issue.fixed_by_name ? ` by ${issue.fixed_by_name}` : ""}` : "Fixed, with an after photo",
      detail: issue.status === "resolved" && issue.resolved_at
        ? `${daysBetween(issue.created_at, issue.resolved_at)} days after it was reported${issue.after_photo_url ? " · photo proof above" : ""}`
        : "Workers must upload a photo of the finished work.",
      when: issue.resolved_at,
    },
  ];
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-sans text-base font-bold tracking-normal">Who's responsible</h2>
        {open && <span className="text-sm font-semibold tabular-nums text-st-open">Open {daysBetween(issue.created_at)} days</span>}
      </div>
      <ol className="mt-3 space-y-3">
        {steps.map((s) => (
          <li key={s.label} className="flex gap-3">
            <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full ${s.done ? "bg-st-fixed text-white" : "border-2 border-line-2 bg-white"}`}>
              {s.done && <Check size={12} strokeWidth={3} />}
            </span>
            <div className="min-w-0 text-sm">
              <p className={`font-semibold ${s.done ? "text-ink" : "text-ink-3"}`}>{s.label}</p>
              <p className="text-ink-3">{s.detail}{s.when && s.done ? ` · ${timeAgo(s.when)}` : ""}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-3 border-t border-line pt-3 text-xs text-ink-3">
        Every step is public and timestamped. Anyone can see who did what, and when.
      </p>
    </section>
  );
}

/** +1 by role: residents who didn't report it can vote; the reporter and staff just see the count. */
function Upvote({ issue, onChange }: { issue: Issue; onChange: (i: Issue) => void }) {
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const count = (
    <span className="inline-flex items-center gap-2 text-[15px] text-ink-2">
      <ThumbsUp size={17} /> <span className="font-semibold tabular-nums text-ink">{issue.upvotes}</span>
      {issue.upvotes === 1 ? "neighbour has" : "neighbours have"} seen this too
    </span>
  );
  if (me && me.role !== "public") return count;
  if (me && issue.is_mine) {
    return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">{count}<span className="text-sm text-ink-3">· You reported this, so you're already counted.</span></div>;
  }

  async function vote() {
    if (!me) return navigate(`/signin?next=/issues/${issue.id}`);
    try {
      const r = await api<{ upvotes: number; upvoted: boolean }>(`/api/issues/${issue.id}/upvote`, { method: "POST" });
      onChange({ ...issue, ...r });
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }
  return (
    <button onClick={vote} aria-pressed={issue.upvoted}
      className={`btn h-12 px-6 ${issue.upvoted ? "bg-civic text-white" : "bg-white border border-line-2 text-ink hover:border-civic"}`}>
      <ThumbsUp size={18} /> {issue.upvoted ? "You +1'd this" : "Me too, +1"}
      <span className="tabular-nums opacity-70">{issue.upvotes}</span>
    </button>
  );
}

/** Field worker tools on a job. */
function WorkerPanel({ issue, onChange }: { issue: Issue; onChange: (i: Issue) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [note, setNote] = useState("");
  const someoneElse = !!issue.assigned_to_email && !issue.is_assigned_to_me;
  const active = issue.status === "open" || issue.status === "in_progress";

  async function update(status: Status, msg: string) {
    setBusy(true);
    try {
      onChange(await api<Issue>(`/api/issues/${issue.id}/status`, { body: { status, note: note || msg } }));
      setNote("");
      toast("Update posted. The resident can see it.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border-2 border-paint bg-[#FFFBEB] p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-paint-deep">Field worker</p>
      <h2 className="font-sans text-lg font-bold tracking-normal">
        {someoneElse ? `Assigned to ${issue.assigned_to_name}` : issue.is_assigned_to_me ? "Your job" : "Unassigned job"}
      </h2>
      {someoneElse ? (
        <p className="mt-1 text-sm text-ink-2">Another field worker is handling this one.</p>
      ) : !active ? (
        <p className="mt-1 text-sm text-ink-2">This report is {STATUS[issue.status].label.toLowerCase()}. Nothing to do.</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-2">
            {issue.is_assigned_to_me ? "Keep the resident posted." : "Start work to pick this job up. It will be assigned to you."}
          </p>
          <textarea className="field mt-3 bg-white" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Optional update, e.g. Material arriving tomorrow." />
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button className="btn-ghost h-12 whitespace-nowrap bg-white px-3" disabled={busy}
              onClick={() => update("in_progress", issue.status === "in_progress" ? "Update from the field." : "Work started.")}>
              {busy ? <Spinner size={16} /> : <Play size={17} />} {issue.status === "in_progress" ? "Post update" : "Start work"}
            </button>
            <button className="btn-ink h-12 whitespace-nowrap px-3" onClick={() => setFixing(true)}><CheckCircle2 size={18} /> Mark fixed</button>
          </div>
        </>
      )}
      {fixing && <FixSheet issue={issue} onClose={() => setFixing(false)} onDone={(i) => (setFixing(false), onChange(i))} />}
    </section>
  );
}

/** City admin controls: status, assignment, delete. */
function AdminPanel({ issue, onChange }: { issue: Issue; onChange: (i: Issue) => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>(issue.status);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [workers, setWorkers] = useState<StaffMember[]>([]);

  useEffect(() => {
    api<StaffMember[]>("/api/staff").then((s) => setWorkers(s.filter((m) => m.role === "worker"))).catch(() => {});
  }, []);

  async function post() {
    setBusy(true);
    try {
      onChange(await api<Issue>(`/api/issues/${issue.id}/status`, { body: { status, note } }));
      setNote("");
      toast("Update posted.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function assign(email: string) {
    try {
      onChange(await api<Issue>(`/api/issues/${issue.id}/assign`, { body: { email } }));
      toast(email ? "Assigned. The worker sees it in their jobs." : "Unassigned.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function remove() {
    if (!window.confirm("Delete this report for everyone? Use this for spam only. For duplicates, merge instead.")) return;
    try {
      await api(`/api/issues/${issue.id}`, { method: "DELETE" });
      toast("Report deleted.");
      navigate("/admin");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border-2 border-ink bg-white p-5">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-3">City admin</p>
      <h2 className="font-sans text-lg font-bold tracking-normal">Manage this report</h2>
      <label htmlFor="assign" className="label mt-4">Field worker</label>
      <select id="assign" className="field" value={issue.assigned_to_email} onChange={(e) => assign(e.target.value)}>
        <option value="">Nobody yet</option>
        {workers.map((w) => <option key={w.email} value={w.email}>{w.name || w.email} · {w.open_jobs} open</option>)}
      </select>
      <span className="label mt-4">Status</span>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(STATUS) as Status[]).map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>{STATUS[s].label}</button>
        ))}
      </div>
      <textarea className="field mt-3" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="Public note, e.g. Approved for repair this week." />
      <div className="mt-3 flex items-center gap-2">
        <button onClick={post} disabled={busy} className="btn-ink btn-sm">{busy && <Spinner size={14} />} Post update</button>
        <button onClick={remove} className="btn btn-sm ml-auto text-danger hover:bg-chalk"><Trash size={15} /> Delete</button>
      </div>
      <p className="mt-3 text-xs text-ink-3">Admins don't take part in the resident ↔ worker chat.</p>
    </section>
  );
}

export default function IssueDetail() {
  const { id } = useParams();
  const { me } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [error, setError] = useState("");
  const [reopening, setReopening] = useState(false);

  useEffect(() => {
    api<Issue>(`/api/issues/${id}`).then(setIssue).catch((e) => setError(e.message));
  }, [id, me?.uid]);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title: issue?.title, url });
      else {
        await navigator.clipboard.writeText(url);
        toast("Link copied.");
      }
    } catch {
      /* user cancelled */
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-20 text-center">
        <p className="font-semibold">{error}</p>
        <Link to="/issues" className="btn-ghost mt-4">Back to reports</Link>
      </div>
    );
  }
  if (!issue) return <div className="flex justify-center py-24 text-ink-3"><Spinner size={24} /></div>;

  const src = photoSrc(issue.photo_url);
  // Chat: the reporter, and the field worker on the job (any worker while it's unassigned). Never admins.
  const canChat = !!me && (issue.is_mine && me.role === "public"
    || (me.role === "worker" && (issue.is_assigned_to_me || !issue.assigned_to_email)));
  const areaQuery = new URLSearchParams({ ...(issue.pincode && { pincode: issue.pincode }), ...(issue.locality && { locality: issue.locality }) });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={() => (history.length > 1 ? navigate(-1) : navigate("/issues"))} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft size={16} /> Back
      </button>

      {issue.merged_into && (
        <Link to={`/issues/${issue.merged_into}`} className="mt-4 block rounded-xl border border-paint bg-[#FDF7E3] px-4 py-3 text-[15px]">
          This report was merged into <span className="font-semibold text-civic underline">#{issue.merged_into}</span> because it's the same problem.
          Follow that one for updates.
        </Link>
      )}

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {issue.after_photo_url ? (
            <div className="grid grid-cols-2 gap-2">
              {[{ label: "Before", url: src }, { label: "After", url: photoSrc(issue.after_photo_url) }].map((p) => (
                <figure key={p.label} className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-chalk">
                  {p.url ? <img src={p.url} alt={`${p.label}: ${issue.title}`} className="aspect-[4/3] w-full object-cover" /> :
                    <div className="flex aspect-[4/3] items-center justify-center text-sm text-ink-3">No photo</div>}
                  <figcaption className={`absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-bold text-white ${p.label === "After" ? "bg-st-fixed" : "bg-ink/80"}`}>
                    {p.label}
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : src && (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
              <img src={src} alt={issue.title} className="max-h-[520px] w-full object-cover" />
            </div>
          )}

          {issue.status === "resolved" && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                  <div>
                    <p className="font-semibold text-amber-950">Was this problem actually fixed?</p>
                    <p className="text-sm text-amber-800">
                      If the worker uploaded a fake photo or the work wasn't done, you can reopen this report. It will move to <strong>Rechecking</strong> and prompt the city admin to inspect.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (!me) return navigate(`/signin?next=/issues/${issue.id}`);
                    setReopening(true);
                  }}
                  className="btn-ghost shrink-0 border border-amber-300 bg-white font-semibold text-amber-950 hover:bg-amber-100"
                >
                  <RotateCcw size={15} /> Reopen report
                </button>
              </div>
            </div>
          )}

          {issue.status === "rechecking" && (
            <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-semibold text-amber-950">Under rechecking</p>
                  <p className="text-sm text-amber-800">
                    A resident flagged that this issue was not properly fixed. City administration has been prompted to revisit this problem and reassign field staff if needed.
                  </p>
                </div>
              </div>
            </div>
          )}
          <div>
            <div className="flex flex-wrap items-center gap-3 text-sm text-ink-2">
              <StatusPill status={issue.status} />
              <span className="inline-flex items-center gap-1.5"><CategoryIcon category={issue.category} size={16} /> {issue.category_label}</span>
              <SeverityText severity={issue.severity} />
            </div>
            <h1 className="mt-3 text-[clamp(28px,4vw,42px)] font-extrabold">{issue.title}</h1>
            <p className="mt-2 text-sm text-ink-3">
              Reported by {issue.is_mine ? "you" : issue.reporter_name} {timeAgo(issue.created_at)}
            </p>
            {issue.description && <p className="mt-5 max-w-[65ch] whitespace-pre-line text-[17px] leading-relaxed">{issue.description}</p>}
            {issue.original_text && issue.original_text !== issue.description && (
              <details className="mt-3 max-w-[65ch] text-sm">
                <summary className="cursor-pointer font-medium text-civic">In the reporter's own words</summary>
                <p className="mt-2 whitespace-pre-line text-ink-2">{issue.original_text}</p>
              </details>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Upvote issue={issue} onChange={setIssue} />
            <button onClick={share} className="btn-ghost h-12"><Link2 size={18} /> Share</button>
            {issue.status === "resolved" && (
              <button
                type="button"
                onClick={() => {
                  if (!me) return navigate(`/signin?next=/issues/${issue.id}`);
                  setReopening(true);
                }}
                className="btn-ghost h-12 border border-amber-300 font-semibold text-amber-950 hover:bg-amber-50"
              >
                <RotateCcw size={17} /> Reopen report
              </button>
            )}
          </div>

          {me?.role === "worker" && <WorkerPanel issue={issue} onChange={setIssue} />}
          {me?.role === "admin" && <AdminPanel issue={issue} onChange={setIssue} />}
          {canChat && (
            <Messages
              issueId={issue.id}
              title={me?.role === "worker" ? `Chat with ${issue.reporter_name} (reporter)` : issue.assigned_to_name ? `Chat with ${issue.assigned_to_name} (field worker)` : "Chat with the field worker"}
              hint={me?.role === "worker" ? "Only you and the resident who reported this can see these messages."
                : issue.assigned_to_name ? "Only you and the field worker on this job can see these messages."
                : "No worker assigned yet. The first field worker to reply will see your message."}
            />
          )}
        </div>

        <aside className="space-y-6">
          <Accountability issue={issue} />
          <section className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
            <div className="h-56">
              <MapContainer center={[issue.lat, issue.lng]} zoom={16} scrollWheelZoom={false} attributionControl={false} className="map-soft h-full w-full">
                <AttributionControl prefix={false} />
                <TileLayer url={OSM_TILES} attribution={OSM_ATTR} />
                <Marker position={[issue.lat, issue.lng]} icon={statusIcon(issue.status, true)} />
              </MapContainer>
            </div>
            <div className="p-4">
              <Link to={`/issues?${areaQuery}`} className="inline-flex items-center gap-1.5 font-semibold text-civic hover:underline">
                <MapPin size={16} /> {[issue.locality, issue.pincode].filter(Boolean).join(", ") || "See area"}
              </Link>
              {issue.address && <p className="mt-1 text-sm text-ink-3">{issue.address}</p>}
              <a
                className="mt-2 inline-block text-sm text-ink-2 underline"
                href={`https://www.openstreetmap.org/?mlat=${issue.lat}&mlon=${issue.lng}#map=18/${issue.lat}/${issue.lng}`}
                target="_blank"
                rel="noreferrer"
              >
                Open in OpenStreetMap
              </a>
            </div>
          </section>

          <section>
            <h2 className="font-sans text-base font-bold tracking-normal">Progress</h2>
            <ol className="mt-4">
              {issue.updates?.map((u, idx) => {
                const last = idx === (issue.updates?.length ?? 0) - 1;
                return (
                  <li key={idx} className="relative flex gap-4 pb-6 last:pb-0">
                    {!last && <span className="absolute left-[7px] top-5 bottom-0 w-px bg-line-2" />}
                    <span
                      className="relative mt-1 size-[15px] shrink-0 rounded-full border-[3px] border-white"
                      style={{ background: STATUS[u.status].color, boxShadow: `0 0 0 1.5px ${STATUS[u.status].color}` }}
                    />
                    <div className="min-w-0">
                      <p className="font-semibold">{stepLabel(u.label, u.note)}</p>
                      {u.note && u.note !== "Reported" && <p className="text-ink-2">{u.note}</p>}
                      <p className="text-sm text-ink-3">{u.by_name} · {timeAgo(u.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {issue.status !== "resolved" && issue.status !== "rejected" && (
              <p className="mt-4 rounded-xl bg-white border border-line p-3 text-sm text-ink-2">
                Each +1 from a neighbour moves this up the list for city staff. Share it with people who've seen it too.
              </p>
            )}
          </section>
        </aside>
      </div>

      {reopening && (
        <ReopenSheet
          issue={issue}
          onClose={() => setReopening(false)}
          onDone={(updated) => {
            setIssue(updated);
            setReopening(false);
          }}
        />
      )}
    </div>
  );
}
