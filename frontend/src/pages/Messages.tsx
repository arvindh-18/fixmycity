import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCheck, ImagePlus, Send } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useRealtime } from "@/contexts/RealtimeContext";
import type { Conversation, Message } from "@/types";
import { EmptyState, Skeleton } from "@/components/ui";
import { StatusChip } from "@/components/issue/bits";
import { ago, cn, fmtTime } from "@/utils/format";

/** Shared by all roles. `base` is the route prefix (/messages, /admin/messages, /worker/messages). */
export default function Messages({ base = "/messages" }: { base?: string }) {
  const { id } = useParams();
  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => api.get<Conversation[]>("/api/conversations"), refetchInterval: 60_000 });
  return (
    <div className="mx-auto h-[calc(100dvh-4rem)] max-w-6xl px-0 sm:px-6 sm:py-6">
      <div className="grid h-full overflow-hidden border-line bg-surface sm: sm:border sm: md:grid-cols-[320px_1fr]">
        <aside className={cn("flex flex-col border-r border-line", id && "hidden md:flex")}>
          <div className="border-b border-line px-5 py-4">
            <h1 className="t-h2">Messages</h1>
            <p className="text-xs text-slate">Private, issue-linked conversations.</p>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto">
            {convs.isLoading && <div className="space-y-2 p-4">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-14" />)}</div>}
            {convs.data?.length === 0 && <EmptyState art="chat" title="No conversations" body="Conversations start from an issue page." />}
            {convs.data?.map((c) => (
              <Link key={c.id} to={`${base}/${c.id}`} className={cn("block border-b border-line px-5 py-3.5 hover:bg-paper", id === c.id && "bg-paper")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ink">{c.with}</span>
                  <span className="shrink-0 text-[11px] text-mute">{c.last_message ? ago(c.last_message.created_at) : ""}</span>
                </div>
                <p className="truncate text-xs text-ink">{c.issue?.tracking_id} · {c.kind === "admin_worker" ? "Task" : "Resident"}</p>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className="truncate t-body-sm text-slate">{c.last_message?.body || "Photo"}</p>
                  {c.unread > 0 && <span className="num grid h-5 min-w-5 place-items-center rounded-full bg-teal px-1.5 text-[11px] font-semibold text-on-green">{c.unread}</span>}
                </div>
              </Link>
            ))}
          </div>
        </aside>
        <section className={cn("flex min-h-0 flex-col", !id && "hidden md:flex")}>
          {id ? <Thread id={id} base={base} /> : <div className="grid flex-1 place-items-center"><EmptyState art="chat" title="Select a conversation" /></div>}
        </section>
      </div>
    </div>
  );
}

function Thread({ id, base }: { id: string; base: string }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { onMessage } = useRealtime();
  const q = useQuery({ queryKey: ["conversation", id], queryFn: () => api.get<{ conversation: Conversation; messages: Message[] }>(`/api/conversations/${id}/messages`) });
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [body, setBody] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (q.data) setMsgs(q.data.messages); }, [q.data]);
  useEffect(() => {
    api.post(`/api/conversations/${id}/read`).then(() => qc.invalidateQueries({ queryKey: ["conversations"] })).catch(() => {});
    return onMessage((m) => {
      if (m.conversation_id !== id) return;
      setMsgs((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
      api.post(`/api/conversations/${id}/read`).catch(() => {});
    });
  }, [id, onMessage, qc]);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [msgs.length]);

  const send = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append("body", body); if (file) fd.append("image", file); return api.post<Message>(`/api/conversations/${id}/messages`, fd); },
    onSuccess: (m) => { setMsgs((p) => (p.some((x) => x.id === m.id) ? p : [...p, m])); setBody(""); setFile(null); qc.invalidateQueries({ queryKey: ["conversations"] }); },
  });

  const c = q.data?.conversation;
  const others = c?.participants.filter((p) => p.id !== user?.id) ?? [];
  const lastReadByOthers = Math.max(0, ...others.map((p) => (p.last_read_at ? new Date(p.last_read_at).getTime() : 0)));
  const issueHref = c?.issue ? (user?.role === "admin" ? `/admin/issues/${c.issue.tracking_id}` : user?.role === "worker" ? `/worker/tasks/${c.issue.id}` : `/issues/${c.issue.tracking_id}`) : "#";

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <button className="md:hidden" onClick={() => navigate(base)} aria-label="Back"><ArrowLeft className="size-5" /></button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-ink">{c?.with ?? "…"}</p>
          {c?.issue && <Link to={issueHref} className="truncate text-xs text-ink underline underline-offset-4 hover:text-ink">{c.issue.tracking_id} · {c.issue.title}</Link>}
        </div>
        {c?.issue && <StatusChip status={c.issue.status} size="sm" />}
        {others.some((o) => o.online) && <span className="flex items-center gap-1 text-xs text-green"><span className="size-2 bg-sage-300" />Online</span>}
      </header>
      <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto bg-paper/40 px-4 py-5 sm:px-6">
        {msgs.map((m, i) => {
          const mine = m.sender_id === user?.id;
          const showName = !mine && (i === 0 || msgs[i - 1].sender_id !== m.sender_id);
          return (
            <div key={m.id} className={cn("flex flex-col", mine ? "items-end" : "items-start")}>
              {showName && <span className="mb-0.5 ml-1 text-[11px] text-slate">{m.sender_name} · {m.sender_role}</span>}
              <div className={cn("max-w-[78%] rounded-2xl px-3.5 py-2 t-body leading-relaxed", mine ? "rounded-br-sm bg-ink text-paper" : "rounded-bl-sm border border-line bg-surface text-ink")}>
                {m.image_url && <a href={m.image_url} target="_blank" rel="noreferrer"><img src={m.image_url} alt="" className="mb-1.5 max-h-56 " /></a>}
                {m.body && <p className="whitespace-pre-line">{m.body}</p>}
              </div>
              <span className="mt-0.5 flex items-center gap-1 px-1 text-[10.5px] text-mute">
                {fmtTime(m.created_at)}
                {mine && new Date(m.created_at).getTime() <= lastReadByOthers && <CheckCheck className="size-3 text-ink" aria-label="Read" />}
              </span>
            </div>
          );
        })}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (body.trim() || file) send.mutate(); }} className="flex items-end gap-2 border-t border-line p-3">
        <label className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-md text-slate hover:bg-paper-2" title="Attach photo">
          <ImagePlus className={cn("size-5", file && "text-ink")} />
          <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={1} placeholder={file ? `Photo: ${file.name}` : "Write a message"}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (body.trim() || file) send.mutate(); } }}
          className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-line-2 px-3 py-2 t-body focus:border-teal focus:outline-none" aria-label="Message" />
        <button type="submit" disabled={send.isPending || (!body.trim() && !file)} className="grid size-10 shrink-0 place-items-center rounded-md bg-teal text-on-green disabled:opacity-40" aria-label="Send"><Send className="size-4" /></button>
      </form>
    </>
  );
}
