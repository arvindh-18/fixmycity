import type { Status, TimelineItem } from "@/types";
import { StatusTimeline, type TimelineStep } from "@/design-system/Commons";
import { Badge } from "@/components/ui";

/**
 * The accountability trail as a Commons StatusTimeline.
 * Everything that has happened is a done step (✓, solid line) with when and who; the latest step is
 * "current"; and — so nobody is left guessing — the steps still to come are listed as upcoming
 * (dashed line), naming the department when the report has been routed.
 */
const dateFmt = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });

const PATH = [
  { key: "routed", title: (dept?: string) => (dept ? `Sent to ${dept}` : "Checked and sent to the right department") },
  { key: "assigned", title: () => "A crew is assigned" },
  { key: "work", title: () => "Work under way" },
  { key: "proof", title: () => "Crew sends before-and-after photos" },
  { key: "confirm", title: () => "You confirm it's fixed" },
];
const NEXT_FROM: Partial<Record<Status, number>> = {
  submitted: 0, pending_verification: 0, reopened: 0, verified: 1, assigned: 2,
  in_progress: 3, on_hold: 3, escalated: 3, awaiting_verification: 4,
};

export function Timeline({ items, showInternal, status, department }: { items: TimelineItem[]; showInternal?: boolean; status?: Status; department?: string }) {
  const closed = status === "resolved" || status === "rejected";
  const steps: TimelineStep[] = items.map((item, i) => {
    const isLast = i === items.length - 1;
    const extra = (
      <>
        {(item.body || (showInternal && !item.is_public) || item.review_status || item.summary_status === "pending") && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {showInternal && !item.is_public && <Badge>Internal</Badge>}
            {showInternal && item.summary_status === "pending" && <Badge>Summary awaiting approval</Badge>}
            {item.review_status && item.review_status !== "pending" && (
              <Badge tone={item.review_status === "accepted" ? "green" : "violet"}>
                {item.review_status === "accepted" ? "✓ Accepted" : item.review_status === "disputed" ? "↺ Disputed by reporter" : "– Sent back"}
              </Badge>
            )}
          </div>
        )}
        {item.body && <p className="t-body-sm measure mt-1 text-ink">{item.body}</p>}
        {showInternal && item.public_summary && item.type === "update" && (
          <p className="t-body-sm mt-2 border-l-2 border-line pl-3 text-slate">Public version ({item.summary_source === "llm" ? "AI draft" : "rule-based draft"}): {item.public_summary}</p>
        )}
        {item.work_notes && <p className="t-body-sm mt-1 text-slate">Work notes: {item.work_notes}</p>}
        {item.images && item.images.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3">
            {item.images.map((im) => (
              <a key={im.url} href={im.url} target="_blank" rel="noreferrer" className="block">
                <img src={im.url} alt={`${im.kind} photo`} className="h-20 w-28 border-[1.5px] border-ink object-cover" loading="lazy" />
                <span className="t-caption mt-1 block capitalize text-slate">{im.kind}</span>
              </a>
            ))}
          </div>
        )}
      </>
    );
    return {
      title: item.title,
      date: dateFmt.format(new Date(item.at)),
      note: item.actor ? `by ${/^(An|The) /.test(item.actor) ? item.actor.charAt(0).toLowerCase() + item.actor.slice(1) : item.actor}` : undefined,
      state: isLast && !closed && status ? "current" : "done",
      extra,
    };
  });

  const next = status !== undefined && !closed ? NEXT_FROM[status] : undefined;
  if (next !== undefined) {
    PATH.slice(next).forEach((p, i) => steps.push({
      title: p.title(department),
      note: i === 0 && status === "on_hold" ? "after the hold is lifted" : undefined,
      state: "upcoming",
    }));
  }
  return <StatusTimeline steps={steps} />;
}
