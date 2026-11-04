import { useState } from "react";
import type { Evidence } from "@/types";
import { Badge } from "@/components/ui";
import { fmtDateTime } from "@/utils/format";

/** Drag-to-compare before/after photos. Falls back to a single "after" image when no "before" exists. */
export function EvidenceCompare({ evidence }: { evidence: Evidence }) {
  const [pos, setPos] = useState(50);
  const before = evidence.before[0];
  const after = evidence.after[0];
  const tone = evidence.review_status === "accepted" ? "green" : "violet";
  const label = { accepted: "✓ Confirmed fixed", pending: "? Waiting for a check", disputed: "↺ Disputed by the reporter", rejected: "– Sent back for rework" }[evidence.review_status];
  return (
    <figure>
      {before && after ? (
        <div className="relative aspect-[16/10] select-none overflow-hidden border-[1.5px] border-ink bg-raised">
          <img src={after} alt="After the work" className="absolute inset-0 size-full object-cover" />
          <div className="absolute inset-0 overflow-hidden" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
            <img src={before} alt="Before the work" className="absolute inset-0 size-full object-cover" />
          </div>
          <div className="pointer-events-none absolute inset-y-0" style={{ left: `${pos}%` }}>
            <div className="h-full w-0.5 -translate-x-1/2 bg-paper" />
            <div className="absolute top-1/2 left-0 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-sm border-[1.5px] border-ink bg-paper text-ink">⇆</div>
          </div>
          <span className="absolute top-2 left-2 t-label border border-ink bg-paper px-2 py-0.5 text-ink">Before</span>
          <span className="absolute top-2 right-2 t-label border border-ink bg-paper px-2 py-0.5 text-ink">After</span>
          <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(+e.target.value)}
            aria-label="Compare before and after" className="absolute inset-0 size-full cursor-ew-resize opacity-0" />
        </div>
      ) : after ? (
        <img src={after} alt="After the work" className="aspect-[16/10] w-full border-[1.5px] border-ink object-cover" />
      ) : null}
      <figcaption className="mt-2 space-y-2"><span className="cv-rules mb-3" aria-hidden><i /><i /></span>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={tone as any}>{label}</Badge>
          <span className="t-body-sm text-slate">Sent {fmtDateTime(evidence.submitted_at)} by {evidence.submitted_by}</span>
        </div>
        <p className="t-body text-ink">{evidence.description}</p>
        {evidence.work_notes && <p className="t-body-sm text-slate">Work notes: {evidence.work_notes}</p>}
      </figcaption>
    </figure>
  );
}
