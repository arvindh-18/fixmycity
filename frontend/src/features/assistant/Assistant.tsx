import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "react-router-dom";
import { LocateFixed, MessageCircleQuestion, Send, X } from "lucide-react";
import { api } from "@/services/api";
import { Spinner } from "@/components/ui";
import { cn } from "@/utils/format";

interface Answer { answer: string; intent: string; links: { label: string; href: string }[]; mode: "llm" | "rules" }
type Turn = { role: "me" | "bot"; text: string; links?: Answer["links"]; mode?: string };

const SUGGESTIONS = [
  "What problems are reported near me?",
  "Why is my complaint still pending?",
  "Which department handles water leakage?",
  "How many complaints were resolved this month?",
];

/** Civic assistant: answers from live platform data only (see backend/app/integrations/ai/assistant.py). */
export function AssistantPanel({ onClose, className }: { onClose?: () => void; className?: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locMsg, setLocMsg] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ behavior: "smooth" }), [turns, busy]);

  const ask = async (question: string) => {
    if (!question.trim() || busy) return;
    setTurns((t) => [...t, { role: "me", text: question }]);
    setQ("");
    setBusy(true);
    try {
      const r = await api.post<Answer>("/api/ai/assistant", { question, lat: loc?.lat, lng: loc?.lng });
      setTurns((t) => [...t, { role: "bot", text: r.answer, links: r.links, mode: r.mode }]);
    } catch (e: any) {
      setTurns((t) => [...t, { role: "bot", text: e.message }]);
    } finally { setBusy(false); }
  };

  const shareLocation = () => navigator.geolocation?.getCurrentPosition(
    (p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setLocMsg("Location shared for this conversation."); },
    () => setLocMsg("Location permission denied."),
  );

  return (
    <div className={cn("cv-float flex flex-col overflow-hidden", className)}>
      <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <p className="t-h2">Ask about your street</p>
          <p className="t-caption text-slate">We answer only from Commons' own records.</p>
        </div>
        {onClose && <button onClick={onClose} aria-label="Close assistant" className="rounded-sm p-1 hover:bg-paper-2"><X className="size-4" /></button>}
      </div>
      <div className="scrollbar-thin flex-1 space-y-3 overflow-y-auto p-4">
        {turns.length === 0 && (
          <div className="space-y-2">
            <p className="text-sm text-slate">Try one of these:</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => ask(s)} className="t-body-sm block w-full border-b border-line py-2.5 text-left text-ink underline-offset-4 hover:underline">{s}</button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <motion.div key={i} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className={cn("max-w-[88%]", t.role === "me" ? "ml-auto" : "")}>
            <div className={cn("t-body-sm whitespace-pre-line px-3 py-2 text-[14px] leading-relaxed", t.role === "me" ? "border border-ink bg-sage-100 text-ink" : "border border-line bg-raised text-ink")}>{t.text}</div>
            {t.links && t.links.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">{t.links.map((l) => <Link key={l.href} to={l.href} className="t-caption rounded-sm border border-line-2 px-2 py-0.5 text-ink hover:bg-paper-2">{l.label}</Link>)}</div>
            )}
            {t.mode && <p className="mt-1 text-[11px] text-mute">{t.mode === "llm" ? "AI-phrased from platform data" : "Demonstration mode: a rule-based answer from Commons records"}</p>}
          </motion.div>
        ))}
        {busy && <Spinner className="size-4" />}
        <div ref={end} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="border-t border-line p-2">
        {locMsg && <p className="px-1 pb-1 text-xs text-slate">{locMsg}</p>}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={shareLocation} title="Share my location" aria-label="Share my location"
            className={cn("grid size-9 shrink-0 place-items-center rounded-sm hover:bg-paper-2", loc ? "text-ink" : "text-slate")}><LocateFixed className="size-4" /></button>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask a question" maxLength={500} aria-label="Your question"
            className="cv-input h-9 flex-1" />
          <button type="submit" disabled={!q.trim() || busy} aria-label="Send" className="cv-btn cv-btn-primary grid size-9 shrink-0 place-items-center !p-0"><Send className="size-4" /></button>
        </div>
      </form>
    </div>
  );
}

export function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  return (
    <div className="fixed right-4 bottom-4 z-30 sm:right-6 sm:bottom-6">
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12 }}
            className="absolute right-0 bottom-16 h-[min(560px,calc(100dvh-7rem))] w-[min(380px,calc(100vw-2rem))]">
            <AssistantPanel onClose={() => setOpen(false)} className="h-full" />
          </motion.div>
        )}
      </AnimatePresence>
      <button onClick={() => setOpen(!open)} aria-expanded={open}
        className="cv-btn cv-btn-secondary inline-flex items-center gap-2">
        <MessageCircleQuestion className="size-4" />Ask Commons
      </button>
    </div>
  );
}

