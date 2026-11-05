import { ArrowLeft, Link2, MapPin, ThumbsUp, Trash } from "lucide-react";
import { AttributionControl, MapContainer, Marker, TileLayer } from "react-leaflet";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { OSM_ATTR, OSM_TILES, statusIcon } from "../components/IssueMap";
import { Messages } from "../components/Messages";
import { CategoryIcon, SeverityText, Spinner, STATUS, StatusPill, timeAgo, useToast } from "../components/ui";
import { api, photoSrc } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Issue, Status } from "../lib/types";

const WORKER_STATUSES: Status[] = ["in_progress", "resolved"];

function StaffPanel({ issue, onChange, admin }: { issue: Issue; onChange: (i: Issue) => void; admin: boolean }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>(admin || WORKER_STATUSES.includes(issue.status) ? issue.status : "in_progress");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  async function post() {
    setBusy(true);
    try {
      const updated = await api<Issue>(`/api/issues/${issue.id}/status`, { body: { status, note } });
      onChange(updated);
      setNote("");
      toast("Update posted.");
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm("Delete this report for everyone? Use this for spam or duplicates.")) return;
    try {
      await api(`/api/issues/${issue.id}`, { method: "DELETE" });
      toast("Report deleted.");
      navigate("/issues");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-civic/40 bg-civic-soft p-5">
      <h2 className="font-sans text-base font-bold tracking-normal">Post an update</h2>
      <p className="text-sm text-ink-2">
        You're signed in as {admin ? "a city admin" : "a field worker"}. The reporter and the public see this.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {(admin ? (Object.keys(STATUS) as Status[]) : WORKER_STATUSES).map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={status === s} onClick={() => setStatus(s)}>
            {STATUS[s].label}
          </button>
        ))}
      </div>
      <textarea
        className="field mt-3"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Crew scheduled for Thursday morning."
      />
      <div className="mt-3 flex items-center gap-2">
        <button onClick={post} disabled={busy} className="btn-ink btn-sm">{busy && <Spinner size={14} />} Post update</button>
        {admin && <button onClick={remove} className="btn btn-sm ml-auto text-danger hover:bg-white"><Trash size={15} /> Delete</button>}
      </div>
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

  useEffect(() => {
    api<Issue>(`/api/issues/${id}`).then(setIssue).catch((e) => setError(e.message));
  }, [id, me?.uid]);

  async function upvote() {
    if (!me) return navigate(`/signin?next=/issues/${id}`);
    try {
      const r = await api<{ upvotes: number; upvoted: boolean }>(`/api/issues/${id}/upvote`, { method: "POST" });
      setIssue((i) => (i ? { ...i, ...r } : i));
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

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
  const areaQuery = new URLSearchParams({ ...(issue.pincode && { pincode: issue.pincode }), ...(issue.locality && { locality: issue.locality }) });

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <button onClick={() => (history.length > 1 ? navigate(-1) : navigate("/issues"))} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink">
        <ArrowLeft size={16} /> Back
      </button>

      <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {src && (
            <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
              <img src={src} alt={issue.title} className="max-h-[520px] w-full object-cover" />
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

          <div className="flex flex-wrap gap-3">
            <button
              onClick={upvote}
              aria-pressed={issue.upvoted}
              className={`btn h-12 px-6 ${issue.upvoted ? "bg-civic text-white" : "bg-white border border-line-2 text-ink hover:border-civic"}`}
            >
              <ThumbsUp size={18} /> {issue.upvoted ? "You +1'd this" : "Me too, +1"}
              <span className="tabular-nums opacity-70">{issue.upvotes}</span>
            </button>
            <button onClick={share} className="btn-ghost h-12"><Link2 size={18} /> Share</button>
          </div>

          {me && me.role !== "public" && <StaffPanel issue={issue} onChange={setIssue} admin={me.is_admin} />}
          {me && (me.role !== "public" || issue.is_mine) && <Messages issueId={issue.id} />}
        </div>

        <aside className="space-y-6">
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
                      <p className="font-semibold">{u.label}</p>
                      {u.note && u.note !== "Reported" && <p className="text-ink-2">{u.note}</p>}
                      <p className="text-sm text-ink-3">{u.by_name} · {timeAgo(u.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ol>
            {issue.status !== "resolved" && issue.status !== "rejected" && (
              <p className="mt-4 rounded-xl bg-white border border-line p-3 text-sm text-ink-2">
                Each +1 moves this up the list for city staff. Share it with neighbours who've seen it too.
              </p>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
