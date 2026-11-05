import { useEffect, useState } from "react";
import { IssueCard } from "../components/IssueCard";
import { Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Issue } from "../lib/types";

/** Field worker landing page: the jobs still to do. Open a job to mark it "Being fixed" or "Fixed". */
export default function WorkerHome() {
  const { me } = useAuth();
  const [tab, setTab] = useState<"in_progress" | "open">("in_progress");
  const [issues, setIssues] = useState<Issue[] | null>(null);

  useEffect(() => {
    setIssues(null);
    api<Issue[]>("/api/issues", { query: { status: tab, sort: "top" } }).then(setIssues).catch(() => setIssues([]));
  }, [tab]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="text-sm font-semibold text-civic">Field worker</p>
      <h1 className="text-[clamp(28px,4vw,40px)] font-extrabold">Today's jobs, {me?.name.split(" ")[0]}</h1>
      <p className="mt-2 text-ink-2">Open a job to mark it as being fixed, or as fixed when you're done.</p>
      <div className="mt-6 flex gap-2">
        <button className="chip" aria-pressed={tab === "in_progress"} onClick={() => setTab("in_progress")}>Being fixed</button>
        <button className="chip" aria-pressed={tab === "open"} onClick={() => setTab("open")}>Not started</button>
      </div>
      <div className="mt-5 space-y-3">
        {!issues ? <div className="flex justify-center py-16 text-ink-3"><Spinner size={22} /></div> :
          issues.length === 0 ? <p className="rounded-[var(--radius-card)] border border-dashed border-line-2 p-8 text-center text-ink-2">No jobs here right now.</p> :
          issues.map((i) => <IssueCard key={i.id} issue={i} />)}
      </div>
    </div>
  );
}
