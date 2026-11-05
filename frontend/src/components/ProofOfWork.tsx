import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, photoSrc } from "../lib/api";
import type { Issue } from "../lib/types";
import { CategoryIcon, Spinner } from "./ui";

interface Week {
  week_start: string;
  reported: number;
  fixed: number;
}

// Validated pair (lightness band, chroma, CVD + normal-vision separation, 3:1 vs surface).
const C_REPORTED = "#5B7FBF";
const C_FIXED = "#2F8F5B";

const fmtWeek = (iso: string, last: boolean) =>
  last ? "This week" : new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short" });

/** "Reported vs fixed, last 8 weeks": grouped bars with values printed, plus a table view. */
function WeeklyBars({ weeks }: { weeks: Week[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...weeks.flatMap((w) => [w.reported, w.fixed]));
  const reported = weeks.reduce((a, w) => a + w.reported, 0);
  const fixed = weeks.reduce((a, w) => a + w.fixed, 0);
  const summary = `In the last ${weeks.length} weeks, ${reported} problem${reported === 1 ? " was" : "s were"} reported and ${fixed} ${fixed === 1 ? "was" : "were"} fixed.`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-2">
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px]" style={{ background: C_REPORTED }} /> Reported</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded-[3px]" style={{ background: C_FIXED }} /> Fixed</span>
      </div>
      <div role="img" aria-label={`${summary} ${weeks.map((w, i) => `${fmtWeek(w.week_start, i === weeks.length - 1)}: ${w.reported} reported, ${w.fixed} fixed`).join("; ")}.`}
        className="relative mt-4">
        <div className="flex h-48 items-end gap-1 border-b border-line-2 sm:gap-3">
          {weeks.map((w, i) => (
            <div
              key={w.week_start}
              className={`relative flex h-full flex-1 items-end justify-center gap-[2px] rounded-t-md transition-colors ${hover === i ? "bg-chalk" : ""}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${fmtWeek(w.week_start, i === weeks.length - 1)}: ${w.reported} reported, ${w.fixed} fixed`}
            >
              {[{ v: w.reported, c: C_REPORTED }, { v: w.fixed, c: C_FIXED }].map((b, j) => (
                <div key={j} className="flex h-full w-full max-w-6 flex-col items-center justify-end">
                  <span className="mb-0.5 text-[11px] font-semibold tabular-nums text-ink-2">{b.v || ""}</span>
                  <div className="w-full rounded-t-[4px]" style={{ height: `${(b.v / max) * 82}%`, minHeight: b.v ? 3 : 0, background: b.c }} />
                </div>
              ))}
              {hover === i && (
                <div className={`pointer-events-none absolute bottom-full z-10 mb-1 w-max rounded-lg border border-line bg-white px-3 py-2 text-xs shadow-[var(--shadow-lift)] ${i > weeks.length / 2 ? "right-0" : "left-0"}`}>
                  <p className="font-semibold text-ink">{fmtWeek(w.week_start, i === weeks.length - 1)}</p>
                  <p className="mt-1 flex items-center gap-2"><span className="h-0.5 w-3" style={{ background: C_REPORTED }} /><b className="tabular-nums">{w.reported}</b> <span className="text-ink-3">reported</span></p>
                  <p className="flex items-center gap-2"><span className="h-0.5 w-3" style={{ background: C_FIXED }} /><b className="tabular-nums">{w.fixed}</b> <span className="text-ink-3">fixed</span></p>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="mt-1.5 flex gap-1 sm:gap-3">
          {weeks.map((w, i) => (
            <span key={w.week_start} className={`flex-1 text-center text-[11px] text-ink-3 ${i % 2 && i !== weeks.length - 1 ? "max-sm:invisible" : ""}`}>
              {fmtWeek(w.week_start, i === weeks.length - 1)}
            </span>
          ))}
        </div>
      </div>
      <p className="mt-4 text-[15px] font-medium">{summary}</p>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-civic">See as a table</summary>
        <table className="mt-2 w-full text-left tabular-nums">
          <thead className="text-ink-3"><tr><th className="py-1 font-medium">Week</th><th className="font-medium">Reported</th><th className="font-medium">Fixed</th></tr></thead>
          <tbody>
            {weeks.map((w, i) => (
              <tr key={w.week_start} className="border-t border-line"><td className="py-1">{fmtWeek(w.week_start, i === weeks.length - 1)}</td><td>{w.reported}</td><td>{w.fixed}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

function daysToFix(i: Issue) {
  if (!i.resolved_at) return "";
  const d = Math.max(0, Math.round((new Date(i.resolved_at).getTime() - new Date(i.created_at).getTime()) / 86_400_000));
  return d === 0 ? "Fixed the same day" : `Fixed in ${d} day${d === 1 ? "" : "s"}`;
}

function Thumb({ url, label, category }: { url: string | null; label: string; category: string }) {
  return (
    <div className="relative aspect-square overflow-hidden bg-chalk">
      {url ? <img src={url} alt={label} loading="lazy" className="size-full object-cover" /> :
        <div className="flex size-full items-center justify-center text-ink-3"><CategoryIcon category={category} size={24} /></div>}
      <span className={`absolute left-1 top-1 rounded-full px-1.5 text-[10px] font-bold text-white ${label === "After" ? "bg-st-fixed" : "bg-ink/80"}`}>{label}</span>
    </div>
  );
}

/** Proof of work for ordinary residents: two simple views, no jargon. */
export function ProofOfWork({ pincode = "", locality = "" }: { pincode?: string; locality?: string }) {
  const [weeks, setWeeks] = useState<Week[] | null>(null);
  const [fixes, setFixes] = useState<Issue[]>([]);

  useEffect(() => {
    api<Week[]>("/api/stats/weekly", { query: { weeks: 8, pincode, locality } }).then(setWeeks).catch(() => setWeeks([]));
    api<Issue[]>("/api/stats/recent-fixes", { query: { limit: 10 } }).then(setFixes).catch(() => {});
  }, [pincode, locality]);

  return (
    <section className="card p-5 sm:p-6">
      <h2 className="font-sans text-lg font-bold tracking-normal">Proof of work</h2>
      <p className="text-sm text-ink-2">Reported vs fixed, last 8 weeks</p>
      <div className="mt-4">{weeks === null ? <Spinner /> : <WeeklyBars weeks={weeks} />}</div>

      {fixes.length > 0 && (
        <div className="mt-8">
          <h3 className="font-sans text-base font-bold tracking-normal">Recently fixed</h3>
          <ul className="-mx-1 mt-3 flex snap-x gap-3 overflow-x-auto px-1 pb-2">
            {fixes.map((i) => (
              <li key={i.id} className="w-44 shrink-0 snap-start">
                <Link to={`/issues/${i.id}`} className="block overflow-hidden rounded-xl border border-line bg-white hover:border-civic">
                  <div className="grid grid-cols-2 gap-[2px] bg-white">
                    <Thumb url={photoSrc(i.photo_url)} label="Before" category={i.category} />
                    <Thumb url={photoSrc(i.after_photo_url)} label="After" category={i.category} />
                  </div>
                  <div className="p-2">
                    <p className="truncate text-sm font-semibold">{i.title}</p>
                    <p className="truncate text-xs text-ink-3">{i.locality || "—"}</p>
                    <p className="text-xs font-medium text-st-fixed">{daysToFix(i)}</p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
