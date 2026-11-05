import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AreaSearch } from "../components/AreaSearch";
import { ProofOfWork } from "../components/ProofOfWork";
import { CategoryIcon, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { Stats as S } from "../lib/types";

/** Ranked list with one thin bar per row. Values are printed, so no hover layer is needed. */
function Bars({ rows }: { rows: { key: string; label: React.ReactNode; count: number; to?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-sm text-ink-3">Nothing open. Good news.</p>;
  return (
    <ul className="space-y-3.5">
      {rows.map((r) => {
        const inner = (
          <>
            <div className="flex items-baseline justify-between gap-3 text-[15px]">
              <span className="flex min-w-0 items-center gap-2 truncate">{r.label}</span>
              <span className="font-semibold tabular-nums">{r.count}</span>
            </div>
            <div className="mt-1.5 h-2 rounded-full bg-chalk">
              <div className="h-2 rounded-full bg-civic" style={{ width: `${(r.count / max) * 100}%` }} />
            </div>
          </>
        );
        return (
          <li key={r.key}>
            {r.to ? <Link to={r.to} className="block hover:[&_span]:text-civic">{inner}</Link> : inner}
          </li>
        );
      })}
    </ul>
  );
}

export default function Stats() {
  const { config } = useAuth();
  const [params, setParams] = useSearchParams();
  const pincode = params.get("pincode") ?? "";
  const locality = params.get("locality") ?? "";
  const [s, setS] = useState<S | null>(null);

  useEffect(() => {
    setS(null);
    api<S>("/api/stats", { query: { pincode, locality } }).then(setS).catch(() => {});
  }, [pincode, locality]);

  const area = [locality, pincode].filter(Boolean).join(" ");
  const areaLink = (loc: string, pin: string) =>
    `/issues?${new URLSearchParams({ ...(pin && { pincode: pin }), ...(loc && loc !== "Unknown area" && { locality: loc }) })}`;

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="flex-1">
          <h1 className="text-[clamp(28px,4vw,40px)] font-extrabold">{area ? `How ${area} is doing` : `How ${config?.city.name ?? "the city"} is doing`}</h1>
          <p className="mt-2 text-ink-2">Live from every report. Pick an area to compare.</p>
        </div>
        <div className="w-full md:w-[380px]">
          <AreaSearch
            value={{ pincode, locality }}
            onPick={(a) => setParams(new URLSearchParams({ ...(a.pincode && { pincode: a.pincode }), ...(a.locality && { locality: a.locality }) }))}
          />
        </div>
      </div>

      {!s ? (
        <div className="flex justify-center py-24 text-ink-3"><Spinner size={24} /></div>
      ) : s.total === 0 ? (
        <div className="mt-10 rounded-[var(--radius-card)] border border-dashed border-line-2 p-10 text-center text-ink-2">
          No reports here yet.
        </div>
      ) : (
        <>
          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line lg:grid-cols-4">
            {[
              { label: "Open now", v: s.open + s.in_progress, sub: `${s.in_progress} being fixed` },
              { label: "Fixed", v: s.resolved, sub: `${s.resolved_pct}% of all reports` },
              { label: "Days to fix, on average", v: s.avg_days_to_fix ?? "—", sub: "from report to fixed" },
              { label: "New in the last 7 days", v: s.this_week, sub: `${s.total} reported in total` },
            ].map((x) => (
              <div key={x.label} className="bg-white p-5 sm:p-6">
                <dt className="text-sm font-semibold text-ink-2">{x.label}</dt>
                <dd className="mt-2 font-display text-[clamp(34px,4.5vw,48px)] font-extrabold leading-none tabular-nums">{x.v}</dd>
                <dd className="mt-2 text-sm text-ink-3">{x.sub}</dd>
              </div>
            ))}
          </dl>

          <div className="mt-6">
            <div className="flex justify-between text-sm text-ink-2">
              <span>Share of reports fixed</span>
              <span className="font-semibold text-ink tabular-nums">{s.resolved_pct}%</span>
            </div>
            <div className="mt-2 h-3 overflow-hidden rounded-full bg-white border border-line">
              <div className="h-full rounded-full bg-st-fixed" style={{ width: `${s.resolved_pct}%` }} />
            </div>
          </div>

          <div className="mt-10">
            <ProofOfWork pincode={pincode} locality={locality} />
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <section className="card p-6">
              <h2 className="font-sans text-lg font-bold tracking-normal">Open problems by type</h2>
              <div className="mt-5">
                <Bars
                  rows={s.by_category.map((c) => ({
                    key: c.category,
                    count: c.count,
                    label: <><CategoryIcon category={c.category} size={16} className="shrink-0 text-ink-3" /> {c.label}</>,
                    to: `${areaLink(locality, pincode)}&category=${c.category}`,
                  }))}
                />
              </div>
            </section>
            {!area && (
              <section className="card p-6">
                <h2 className="font-sans text-lg font-bold tracking-normal">Areas with the most open problems</h2>
                <div className="mt-5">
                  <Bars
                    rows={s.top_areas.map((a) => ({
                      key: a.locality + a.pincode,
                      count: a.count,
                      label: <>{a.locality} <span className="text-ink-3 tabular-nums">{a.pincode}</span></>,
                      to: areaLink(a.locality, a.pincode),
                    }))}
                  />
                </div>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
