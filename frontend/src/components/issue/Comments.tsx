import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, ImagePlus, Reply, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Comment } from "@/types";
import { Button, EmptyState, Modal, Textarea, Input } from "@/components/ui";
import { ago, cn } from "@/utils/format";

export function Comments({ issueId }: { issueId: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["comments", issueId], queryFn: () => api.get<Comment[]>(`/api/issues/${issueId}/comments`) });
  const [reportFor, setReportFor] = useState<Comment | null>(null);
  const [reason, setReason] = useState("");
  const report = useMutation({
    mutationFn: () => api.post(`/api/comments/${reportFor!.id}/report`, { reason }),
    onSuccess: () => { toast.success("Reported to moderators"); setReportFor(null); setReason(""); qc.invalidateQueries({ queryKey: ["comments", issueId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const total = (data ?? []).reduce((n, c) => n + 1 + (c.replies?.length ?? 0), 0);

  return (
    <section>
      <h2 className="t-h2">Discussion <span className="num text-lg text-mute">{total || ""}</span></h2>
      <p className="mt-1 text-sm text-slate">Public. Share extra details or evidence. Keep it about the issue — personal attacks are removed.</p>
      <div className="mt-5">
        {user ? <Composer issueId={issueId} /> : (
          <p className="rounded-md border border-dashed border-line-2 px-4 py-3 text-sm text-slate"><Link to="/login" className="text-ink underline underline-offset-4 hover:text-ink">Sign in</Link> to join the discussion.</p>
        )}
      </div>
      <div className="mt-6 space-y-5">
        {data?.length === 0 && <EmptyState art="chat" title="No comments yet" body="Seen this problem too? Say so — it helps officials gauge impact." />}
        {data?.map((c) => (
          <div key={c.id}>
            <CommentItem c={c} onReport={setReportFor} issueId={issueId} canReply={!!user} />
            {c.replies && c.replies.length > 0 && (
              <div className="mt-3 ml-5 space-y-3 border-l-2 border-line pl-5">
                {c.replies.map((r) => <CommentItem key={r.id} c={r} onReport={setReportFor} issueId={issueId} />)}
              </div>
            )}
          </div>
        ))}
      </div>
      <Modal open={!!reportFor} onOpenChange={(o) => !o && setReportFor(null)} title="Report this comment" description="Moderators review reported comments. Three reports hide a comment until reviewed."
        footer={<><Button variant="ghost" onClick={() => setReportFor(null)}>Cancel</Button><Button variant="danger" loading={report.isPending} disabled={reason.length < 3} onClick={() => report.mutate()}>Report comment</Button></>}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? For example: spam, abusive, off-topic" maxLength={255} />
      </Modal>
    </section>
  );
}

function CommentItem({ c, onReport, issueId, canReply }: { c: Comment; onReport: (c: Comment) => void; issueId: string; canReply?: boolean }) {
  const { user } = useAuth();
  const [replying, setReplying] = useState(false);
  return (
    <article>
      <div className="flex items-center gap-2 text-sm">
        <span className={cn("grid size-7 place-items-center rounded-full text-[11px] font-semibold", c.is_official ? "bg-ink text-paper" : "bg-paper-2 text-ink")}>{c.author.slice(0, 1)}</span>
        <span className="font-medium text-ink">{c.author}</span>
        {c.is_official && <span className="inline-flex items-center gap-1 text-xs text-ink"><ShieldCheck className="size-3.5" />Official</span>}
        {c.author_role === "worker" && <span className="text-xs text-slate">Field team</span>}
        <span className="text-xs text-mute">{ago(c.created_at)}</span>
      </div>
      {c.is_hidden ? (
        <p className="mt-1.5 ml-9 text-sm text-mute italic">{c.hidden_reason ?? "Removed by a moderator."}</p>
      ) : (
        <div className="mt-1.5 ml-9">
          <p className="t-body leading-relaxed whitespace-pre-line text-ink">{c.body}</p>
          {c.image_url && <a href={c.image_url} target="_blank" rel="noreferrer"><img src={c.image_url} alt="Attached" className="mt-2 max-h-48 rounded-md border border-line" /></a>}
          <div className="mt-1.5 flex gap-4 text-xs">
            {canReply && <button onClick={() => setReplying(!replying)} className="inline-flex items-center gap-1 text-slate hover:text-ink"><Reply className="size-3.5" />Reply</button>}
            {user && !c.is_mine && <button onClick={() => onReport(c)} className="inline-flex items-center gap-1 text-slate hover:text-red"><Flag className="size-3.5" />Report</button>}
            {c.reports ? <span className="text-red">{c.reports} reports</span> : null}
          </div>
          {replying && <div className="mt-3"><Composer issueId={issueId} parentId={c.id} onDone={() => setReplying(false)} /></div>}
        </div>
      )}
    </article>
  );
}

function Composer({ issueId, parentId, onDone }: { issueId: string; parentId?: string; onDone?: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const m = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("body", body);
      if (parentId) fd.append("parent_id", parentId);
      if (file) fd.append("image", file);
      return api.post(`/api/issues/${issueId}/comments`, fd);
    },
    onSuccess: () => { setBody(""); setFile(null); onDone?.(); qc.invalidateQueries({ queryKey: ["comments", issueId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (body.trim()) m.mutate(); }} className=" border border-line-2 bg-surface focus-within:border-teal">
      <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder={parentId ? "Write a reply" : "Add to the discussion"} maxLength={2000}
        className="min-h-20 border-0 focus:ring-0" aria-label="Comment" />
      <div className="flex items-center justify-between border-t border-line px-2 py-1.5">
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 text-xs text-slate hover:bg-paper-2">
          <ImagePlus className="size-4" />{file ? file.name.slice(0, 24) : "Attach photo"}
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <Button size="sm" type="submit" loading={m.isPending} disabled={!body.trim()}>{parentId ? "Reply" : "Post comment"}</Button>
      </div>
    </form>
  );
}
