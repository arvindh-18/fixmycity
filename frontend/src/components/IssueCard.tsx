import { ThumbsUp } from "lucide-react";
import { Link } from "react-router-dom";
import { photoSrc } from "../lib/api";
import type { Issue } from "../lib/types";
import { CategoryIcon, StatusPill, timeAgo } from "./ui";

export function IssueCard({
  issue, active, onHover, compact = false,
}: {
  issue: Issue;
  active?: boolean;
  onHover?: (id: number | null) => void;
  compact?: boolean;
}) {
  const src = photoSrc(issue.photo_url);
  return (
    <Link
      to={`/issues/${issue.id}`}
      onMouseEnter={() => onHover?.(issue.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`group flex gap-4 rounded-[var(--radius-card)] border bg-white p-3 transition-colors ${
        active ? "border-civic" : "border-line hover:border-line-2"
      }`}
    >
      <div className={`relative shrink-0 overflow-hidden rounded-[10px] bg-chalk ${compact ? "size-20" : "size-24"}`}>
        {src ? (
          <img src={src} alt="" loading="lazy" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center text-ink-3">
            <CategoryIcon category={issue.category} size={28} />
          </div>
        )}
        {issue.severity === "high" && issue.status !== "resolved" && (
          <span className="absolute left-1.5 top-1.5 rounded-full bg-danger px-1.5 text-[11px] font-bold text-white">Urgent</span>
        )}
      </div>
      <div className="min-w-0 flex-1 py-0.5">
        <div className="flex items-center gap-2 text-[13px] text-ink-3">
          <CategoryIcon category={issue.category} size={14} />
          <span className="truncate">{issue.category_label}</span>
        </div>
        <h3 className="mt-1 font-sans text-[16px] font-semibold leading-snug tracking-normal text-ink line-clamp-2">
          {issue.title}
        </h3>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] text-ink-2">
          <StatusPill status={issue.status} />
          <span className="truncate">{issue.locality || "—"}{issue.pincode && <span className="text-ink-3"> {issue.pincode}</span>}</span>
          <span className="text-ink-3">{timeAgo(issue.created_at)}</span>
          {issue.upvotes > 0 && (
            <span className={`inline-flex items-center gap-1 ${issue.upvoted ? "text-civic font-semibold" : "text-ink-3"}`}>
              <ThumbsUp size={13} /> {issue.upvotes}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
