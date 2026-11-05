import { Send } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Spinner, timeAgo, useToast } from "./ui";

interface Msg {
  id: number;
  body: string;
  sender_name: string;
  sender_role: "public" | "worker" | "admin";
  is_mine: boolean;
  created_at: string;
}

const ROLE_BADGE: Record<string, string> = { worker: "Worker", admin: "Admin" };

/** Chat between the reporter, field workers and admins. Polls every 5 s while the tab is visible. */
export function Messages({ issueId }: { issueId: number }) {
  const toast = useToast();
  const [msgs, setMsgs] = useState<Msg[] | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const lastId = useRef(0);
  const scroller = useRef<HTMLDivElement>(null);

  const poll = useCallback(async () => {
    try {
      const fresh = await api<Msg[]>(`/api/issues/${issueId}/messages`, { query: { after: lastId.current } });
      if (fresh.length) {
        lastId.current = fresh[fresh.length - 1].id;
        setMsgs((m) => [...(m ?? []), ...fresh.filter((f) => !(m ?? []).some((x) => x.id === f.id))]);
      } else setMsgs((m) => m ?? []);
    } catch {
      setMsgs((m) => m ?? []);
    }
  }, [issueId]);

  useEffect(() => {
    lastId.current = 0;
    setMsgs(null);
    poll();
    const t = setInterval(() => document.visibilityState === "visible" && poll(), 5000);
    const onVis = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", onVis);
    return () => (clearInterval(t), document.removeEventListener("visibilitychange", onVis));
  }, [poll]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [msgs?.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const m = await api<Msg>(`/api/issues/${issueId}/messages`, { body: { body: text } });
      lastId.current = Math.max(lastId.current, m.id);
      setMsgs((cur) => [...(cur ?? []), m]);
      setText("");
    } catch (err) {
      toast((err as Error).message, "err");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-white">
      <div className="border-b border-line px-4 py-3">
        <h2 className="font-sans text-base font-bold tracking-normal">Messages</h2>
        <p className="text-xs text-ink-3">Only the reporter, field workers and city admins can see these.</p>
      </div>
      <div ref={scroller} className="max-h-80 min-h-28 space-y-3 overflow-y-auto px-4 py-3">
        {msgs === null ? (
          <div className="flex justify-center py-6 text-ink-3"><Spinner /></div>
        ) : msgs.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No messages yet. Ask a question or share an update.</p>
        ) : (
          msgs.map((m) => (
            <div key={m.id} className={`flex flex-col ${m.is_mine ? "items-end" : "items-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-3.5 py-2 text-[15px] ${m.is_mine ? "rounded-br-md bg-civic text-white" : "rounded-bl-md bg-chalk"}`}>
                {m.body}
              </div>
              <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-3">
                {!m.is_mine && <span className="font-medium text-ink-2">{m.sender_name}</span>}
                {ROLE_BADGE[m.sender_role] && !m.is_mine && (
                  <span className="rounded-full bg-civic-soft px-1.5 py-px text-[11px] font-semibold text-civic">{ROLE_BADGE[m.sender_role]}</span>
                )}
                {timeAgo(m.created_at)}
              </span>
            </div>
          ))
        )}
      </div>
      <form onSubmit={send} className="flex items-end gap-2 border-t border-line p-3">
        <textarea
          rows={1}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), send(e))}
          placeholder="Write a message…"
          aria-label="Message"
          className="field min-h-11 flex-1 resize-none py-2.5"
        />
        <button className="btn-ink h-11 w-11 shrink-0 !px-0" disabled={sending || !text.trim()} aria-label="Send">
          {sending ? <Spinner size={16} /> : <Send size={17} />}
        </button>
      </form>
    </section>
  );
}
