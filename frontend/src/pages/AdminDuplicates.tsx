import { ArrowLeft, Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CategoryIcon, Spinner, StatusPill, timeAgo, useToast } from "../components/ui";
import { api, photoSrc } from "../lib/api";
import type { Issue } from "../lib/types";

interface Flag {
  id: number;
  score: number;
  distance_m: number;
  issue: Issue;
  candidate: Issue;
}

function Side({ issue, label, onKeep, busy }: { issue: Issue; label: string; onKeep: () => void; busy: boolean }) {
  const src = photoSrc(issue.photo_url);
  return (
    <div className="flex flex-col rounded-xl border border-line bg-white p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-3">{label}</p>
      <div className="mt-2 aspect-[4/3] overflow-hidden rounded-lg bg-chalk">
        {src ? <img src={src} alt="" className="size-full object-cover" /> :
          <div className="flex size-full items-center justify-center text-ink-3"><CategoryIcon category={issue.category} size={32} /></div>}
      </div>
      <Link to={`/issues/${issue.id}`} target="_blank" className="mt-3 font-semibold leading-snug hover:text-civic">
        #{issue.id} · {issue.title}
      </Link>
      {issue.description && <p className="mt-1 line-clamp-3 text-sm text-ink-2">{issue.description}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-3">
        <StatusPill status={issue.status} /> {issue.reporter_name} · {timeAgo(issue.created_at)} · {issue.upvotes} +1
      </div>
      <button className="btn-ghost btn-sm mt-3 self-start" onClick={onKeep} disabled={busy}>
        <Check size={15} /> Keep this one
      </button>
    </div>
  );
}

export default function AdminDuplicates() {
  const toast = useToast();
  const [flags, setFlags] = useState<Flag[] | null>(null);
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    api<Flag[]>("/api/admin/duplicates").then(setFlags).catch((e) => (toast((e as Error).message, "err"), setFlags([])));
  }, [toast]);

  async function act(f: Flag, keepId: number | null) {
    setBusy(f.id);
    try {
      if (keepId) {
        await api(`/api/admin/duplicates/${f.id}/merge`, { body: { keep_id: keepId } });
        toast(`Merged. #${keepId} now has everyone's +1s and messages.`);
      } else {
        await api(`/api/admin/duplicates/${f.id}/dismiss`, { method: "POST" });
        toast("Marked as not a duplicate.");
      }
      // A merge can settle other suggestions too, so reload.
      setFlags(await api<Flag[]>("/api/admin/duplicates"));
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/admin" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-2 hover:text-ink"><ArrowLeft size={16} /> Admin</Link>
      <h1 className="mt-3 text-[clamp(28px,4vw,40px)] font-extrabold">Possible duplicates</h1>
      <p className="mt-2 text-ink-2">
        These reports are the same type of problem, very close together, and described alike. Keep the better one and the other is
        merged into it. Its +1s and messages move over, and its page points people to the one you kept.
      </p>
      <div className="mt-8 space-y-6">
        {!flags ? <div className="flex justify-center py-16 text-ink-3"><Spinner size={22} /></div> :
          flags.length === 0 ? <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-10 text-center text-ink-2">No possible duplicates right now.</p> :
          flags.map((f) => (
            <section key={f.id} className="rounded-[var(--radius-card)] border border-line bg-chalk p-3 sm:p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-semibold">{f.distance_m} m apart</span>
                <span className="text-ink-3">· {Math.round(f.score * 100)}% match</span>
                <button className="btn btn-sm ml-auto text-ink-2 hover:bg-white" disabled={busy === f.id} onClick={() => act(f, null)}>
                  {busy === f.id ? <Spinner size={14} /> : <X size={15} />} Not a duplicate
                </button>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Side issue={f.candidate} label="Reported first" onKeep={() => act(f, f.candidate.id)} busy={busy === f.id} />
                <Side issue={f.issue} label="New report" onKeep={() => act(f, f.issue.id)} busy={busy === f.id} />
              </div>
            </section>
          ))}
      </div>
    </div>
  );
}
