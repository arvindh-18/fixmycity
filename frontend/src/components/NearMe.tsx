import { LocateFixed, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { formatDistance, useMyLocation } from "../lib/location";
import type { Issue } from "../lib/types";
import { IssueMap } from "./IssueMap";
import { CategoryIcon, Spinner, StatusPill } from "./ui";

const STATUS_FILTERS = [
  { id: "", label: "All" },
  { id: "open", label: "Reported" },
  { id: "in_progress", label: "Being fixed" },
  { id: "resolved", label: "Fixed" },
];
const RADII = [500, 1000, 2000, 5000];

/** "Use my location": a you-are-here map with every report around you, closest first. */
export function NearMe({ autoStart = false, onClose }: { autoStart?: boolean; onClose?: () => void }) {
  const { config } = useAuth();
  const { loc, locating, error, locate } = useMyLocation();
  const [status, setStatus] = useState("");
  const [radius, setRadius] = useState(2000);
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [active, setActive] = useState<number | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const city = config?.city ?? { lat: 13.0827, lng: 80.2707, name: "Chennai" };
  // Without a location we fall back to the city centre so the panel is still useful.
  const point = loc ?? (error ? { lat: city.lat, lng: city.lng, accuracy: 0 } : null);

  useEffect(() => {
    if (autoStart) locate();
  }, [autoStart, locate]);

  useEffect(() => {
    if (!point) return;
    setIssues(null);
    api<Issue[]>("/api/issues/near", { query: { lat: point.lat, lng: point.lng, radius, status } })
      .then(setIssues)
      .catch(() => setIssues([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [point?.lat, point?.lng, radius, status]);

  function select(id: number) {
    setActive(id);
    listRef.current?.querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  if (!point) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5 sm:flex-row sm:items-center">
        <div className="flex-1">
          <p className="font-semibold">See what's broken around you</p>
          <p className="text-sm text-ink-2">We'll show reports near you on a map, closest first.</p>
        </div>
        <button className="btn-ink h-11" onClick={locate} disabled={locating}>
          {locating ? <Spinner size={16} /> : <LocateFixed size={18} />} {locating ? "Finding you…" : "Use my location"}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto font-semibold">
          {loc ? "Reports near you" : `Reports near ${city.name} centre`}
        </p>
        <button className="btn-ghost btn-sm" onClick={locate} disabled={locating}>
          {locating ? <Spinner size={14} /> : <LocateFixed size={15} />} {loc ? "Refresh" : "Try again"}
        </button>
        {onClose && <button className="btn btn-sm" onClick={onClose} aria-label="Close"><X size={16} /></button>}
      </div>
      {error && <p className="mt-2 rounded-xl bg-st-open-soft px-3 py-2 text-sm">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button key={f.id} className="chip" aria-pressed={status === f.id} onClick={() => setStatus(f.id)}>{f.label}</button>
        ))}
        <select value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Distance"
          className="h-9 rounded-full border border-line-2 bg-white px-3 text-sm font-medium">
          {RADII.map((r) => <option key={r} value={r}>Within {r < 1000 ? `${r} m` : `${r / 1000} km`}</option>)}
        </select>
      </div>
      <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="h-[320px] overflow-hidden rounded-xl border border-line sm:h-[420px]">
          <IssueMap issues={issues ?? []} center={[point.lat, point.lng]} here={loc} activeId={active}
            onHover={(id) => id && setActive(id)} onSelect={select} />
        </div>
        <ul ref={listRef} className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {issues === null ? (
            <li className="flex justify-center py-10 text-ink-3"><Spinner /></li>
          ) : issues.length === 0 ? (
            <li className="rounded-xl border border-dashed border-line-2 p-6 text-center text-sm text-ink-2">
              No reports within {radius < 1000 ? `${radius} m` : `${radius / 1000} km`}. Try a bigger distance.
            </li>
          ) : (
            issues.map((i) => (
              <li key={i.id} data-id={i.id}>
                <Link
                  to={`/issues/${i.id}`}
                  onMouseEnter={() => setActive(i.id)}
                  onFocus={() => setActive(i.id)}
                  className={`flex items-center gap-3 rounded-xl border p-2.5 transition-colors ${active === i.id ? "border-civic bg-civic-soft" : "border-line hover:border-line-2"}`}
                >
                  <CategoryIcon category={i.category} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-semibold">{i.title}</span>
                    <span className="block truncate text-xs text-ink-3">
                      {[i.locality, formatDistance(i.distance_m)].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <StatusPill status={i.status} />
                </Link>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
