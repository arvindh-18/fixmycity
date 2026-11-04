import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Flame, List, Map as MapIcon, MapPinned, Search, SlidersHorizontal, Target, X } from "lucide-react";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import type { CategoryStat, DeptScore, Hotspot, IssueDetail, Overview, Priority, TimelineItem } from "@/types";
import { IssueMap, type FC } from "@/components/map/IssueMap";
import { Badge, Button, DemoBadge, EmptyState, Segmented, Sheet, Skeleton } from "@/components/ui";
import { CategoryIcon, PriorityTag, SLAMeter, StatusChip } from "@/components/issue/bits";
import { Timeline } from "@/components/issue/Timeline";
import { PRIORITY, STATUS, STATUS_GROUPS } from "@/utils/status";
import { ago, cn, duration, pct } from "@/utils/format";
import type { Status } from "@/types";

const RANGES = [{ v: "all", label: "All time", days: 0 }, { v: "7", label: "7 days", days: 7 }, { v: "30", label: "30 days", days: 30 }, { v: "90", label: "90 days", days: 90 }];

export default function MapPage() {
  const { data: meta } = useMeta();
  const [view, setView] = useState<"map" | "heat" | "list">("map");
  const [groups, setGroups] = useState<string[]>(["pending", "active", "review", "done"]);
  const [cats, setCats] = useState<string[]>([]);
  const [prios, setPrios] = useState<Priority[]>([]);
  const [dept, setDept] = useState("");
  const [range, setRange] = useState("all");
  const [showLoc, setShowLoc] = useState(false);
  const [showHot, setShowHot] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [locality, setLocality] = useState<string | null>(null);
  const [flyTo, setFlyTo] = useState<{ lat: number; lng: number; zoom?: number } | null>(null);
  const [q, setQ] = useState("");

  const statuses = useMemo(() => STATUS_GROUPS.filter((g) => groups.includes(g.key)).flatMap((g) => g.statuses), [groups]);
  const dateFrom = useMemo(() => {
    const d = RANGES.find((r) => r.v === range)?.days;
    return d ? new Date(Date.now() - d * 86400_000).toISOString() : undefined;
  }, [range]);
  const params = { status: statuses, category: cats, priority: prios, department: dept || undefined, date_from: dateFrom };
  const issues = useQuery({ queryKey: ["map", params], queryFn: () => api.get<FC>("/api/map/issues", params), enabled: statuses.length > 0 });
  const localities = useQuery({ queryKey: ["map", "localities"], queryFn: () => api.get<FC>("/api/map/localities") });
  const hotspots = useQuery({ queryKey: ["hotspots"], queryFn: () => api.get<Hotspot[]>("/api/hotspots"), enabled: showHot });

  const data: FC = statuses.length ? issues.data ?? { type: "FeatureCollection", features: [] } : { type: "FeatureCollection", features: [] };
  const filtered = useMemo(() => {
    if (!q.trim()) return data;
    const s = q.toLowerCase();
    return { ...data, features: data.features.filter((f) => `${f.properties.title} ${f.properties.tracking_id} ${f.properties.category}`.toLowerCase().includes(s)) };
  }, [data, q]);

  const searchPlace = async (e: React.FormEvent) => {
    e.preventDefault();
    const term = q.trim().toLowerCase();
    if (!term || !meta) return;
    const loc = localities.data?.features.find((f) => f.properties.name.toLowerCase().includes(term));
    if (loc) {
      const [lng, lat] = loc.properties.center as [number, number];
      setFlyTo({ lat, lng, zoom: 14 }); setQ(""); return;
    }
    if (filtered.features.length) return; // text matched issues — leave the filter in place
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}&viewbox=${meta.city.lng - 0.4},${meta.city.lat + 0.4},${meta.city.lng + 0.4},${meta.city.lat - 0.4}&bounded=1`);
      const [hit] = await r.json();
      if (hit) { setFlyTo({ lat: +hit.lat, lng: +hit.lon, zoom: 15.5 }); setQ(""); }
    } catch { /* offline search unavailable */ }
  };

  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    (issues.data?.features ?? []).forEach((f) => { const g = STATUS[f.properties.status as Status].group; c[g] = (c[g] ?? 0) + 1; });
    return c;
  }, [issues.data]);

  const filters = (
    <div className="space-y-6">
      <FilterGroup title="Status">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_GROUPS.map((g) => (
            <Chip key={g.key} active={groups.includes(g.key)} onClick={() => setGroups(toggle(groups, g.key))}>
              <span className="size-2 rounded-full" style={{ background: g.color }} />{g.label}<span className="num text-mute">{counts[g.key] ?? ""}</span>
            </Chip>
          ))}
        </div>
      </FilterGroup>
      <FilterGroup title="Category">
        <div className="flex flex-wrap gap-1.5">
          {meta?.categories.map((c) => (
            <Chip key={c.id} active={cats.includes(c.id)} onClick={() => setCats(toggle(cats, c.id))}><CategoryIcon icon={c.icon} className="size-3.5" />{c.name}</Chip>
          ))}
        </div>
      </FilterGroup>
      <FilterGroup title="Priority">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(PRIORITY) as Priority[]).map((p) => <Chip key={p} active={prios.includes(p)} onClick={() => setPrios(toggle(prios, p))}>{PRIORITY[p].label}</Chip>)}
        </div>
      </FilterGroup>
      <FilterGroup title="Department">
        <select value={dept} onChange={(e) => setDept(e.target.value)} className="h-9 w-full rounded-md border border-line-2 bg-surface px-2 text-sm">
          <option value="">All departments</option>
          {meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </FilterGroup>
      <FilterGroup title="Reported in the last">
        <Segmented value={range} onChange={setRange} options={RANGES.map((r) => ({ value: r.v, label: r.label }))} />
      </FilterGroup>
      <FilterGroup title="Layers">
        <div className="space-y-2">
          <Toggle checked={showLoc} onChange={setShowLoc} label="Locality boundaries" hint="Click an area for its statistics" />
          <Toggle checked={showHot} onChange={setShowHot} label="Recurring hotspots" hint="Clusters of 3+ reports within 250 m" />
        </div>
      </FilterGroup>
      {(cats.length > 0 || prios.length > 0 || dept || range !== "all") && (
        <Button variant="link" onClick={() => { setCats([]); setPrios([]); setDept(""); setRange("all"); setGroups(["pending", "active", "review", "done"]); }}>Clear filters</Button>
      )}
    </div>
  );

  return (
    <div className="relative h-[calc(100dvh-4rem)] overflow-hidden">
      {/* Left panel */}
      <aside className={cn("absolute inset-y-0 left-0 z-20 w-[340px] max-w-[88vw] border-r border-line bg-surface/97 backdrop-blur transition-transform md:translate-x-0",
        filtersOpen ? "translate-x-0 " : "-translate-x-full")}>
        <div className="flex h-full flex-col">
          <div className="border-b border-line p-4">
            <div className="flex items-center justify-between">
              <h1 className="t-h2">Issue map</h1>
              <button className="rounded p-1 md:hidden" onClick={() => setFiltersOpen(false)} aria-label="Close filters"><X className="size-5" /></button>
            </div>
            <form onSubmit={searchPlace} className="relative mt-3">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-mute" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search issues, localities or places"
                className="h-10 w-full rounded-md border border-line-2 bg-surface pr-3 pl-9 text-sm focus:border-teal focus:outline-none" aria-label="Search the map" />
            </form>
            <p className="mt-2 text-xs text-slate"><span className="num font-medium text-ink">{filtered.features.length}</span> issues match</p>
          </div>
          <div className="scrollbar-thin flex-1 overflow-y-auto p-4">{filters}</div>
          <Legend />
        </div>
      </aside>

      {/* View switch */}
      <div className="absolute top-3 right-3 z-10 flex items-center gap-2 md:left-[356px] md:right-auto">
        <button onClick={() => setFiltersOpen(true)} className="flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium  md:hidden">
          <SlidersHorizontal className="size-4" />Filters
        </button>
        <div className="rounded-md bg-surface ">
          <Segmented value={view} onChange={setView} options={[
            { value: "map", label: <><MapIcon className="size-3.5" />Markers</> },
            { value: "heat", label: <><Flame className="size-3.5" />Density</> },
            { value: "list", label: <><List className="size-3.5" />List</> },
          ]} />
        </div>
      </div>

      {/* MapLibre sets position:relative on its container, so the absolute box is a wrapper */}
      {meta && (
        <div className="absolute inset-0 md:left-[340px]">
        <IssueMap issues={filtered} localities={localities.data} showLocalities={showLoc} mode={view === "heat" ? "heatmap" : "markers"}
          hotspots={showHot ? hotspots.data : undefined} center={[meta.city.lng, meta.city.lat]} flyTo={flyTo}
          onSelectIssue={setSelected} onSelectLocality={setLocality} className="h-full w-full" />
        </div>
      )}

      {showHot && hotspots.data && view !== "list" && (
        <div className="absolute right-3 bottom-24 z-10 w-80 max-w-[calc(100vw-1.5rem)] md:bottom-auto md:top-16">
          <div className="max-h-[50vh] overflow-y-auto  border border-line bg-surface  scrollbar-thin">
            <div className="flex items-center gap-2 border-b border-line px-4 py-2.5"><Target className="size-4 text-red" /><span className="text-sm font-semibold">Hotspots</span></div>
            {hotspots.data.length === 0 ? <p className="p-4 text-sm text-slate">No clusters of 3 or more reports found.</p> :
              hotspots.data.map((h) => (
                <button key={h.cluster_id} onClick={() => setFlyTo({ lat: h.lat, lng: h.lng, zoom: 15.5 })} className="block w-full border-b border-line px-4 py-3 text-left last:border-0 hover:bg-paper">
                  <p className="t-body-sm text-ink">{h.insight}</p>
                  {h.recurring && <Badge tone="red" className="mt-1.5">Recurring {h.top_category.toLowerCase()}</Badge>}
                </button>
              ))}
            <p className="border-t border-line px-4 py-2 text-[11px] text-mute">Method: {hotspots.data[0]?.method ?? "DBSCAN clustering"}</p>
          </div>
        </div>
      )}

      {view === "list" && (
        <div className="absolute inset-0 z-[5] overflow-y-auto bg-paper md:left-[340px]">
          <div className="mx-auto max-w-3xl px-4 pt-16 pb-8">
            {filtered.features.length === 0 ? <EmptyState title="No issues match these filters" body="Try widening the date range or status." /> :
              filtered.features.slice(0, 300).map((f) => (
                <button key={f.properties.id} onClick={() => setSelected(f.properties.tracking_id)} className="flex w-full items-center gap-4 border-b border-line px-2 py-3 text-left hover:bg-surface">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: STATUS[f.properties.status as Status].marker }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-ink">{f.properties.title}</span>
                    <span className="t-body-sm text-slate">{f.properties.category} · {f.properties.tracking_id} · {ago(f.properties.created_at)}</span>
                  </span>
                  <StatusChip status={f.properties.status} size="sm" />
                </button>
              ))}
          </div>
        </div>
      )}

      <IssueSheet trackingId={selected} onClose={() => setSelected(null)} />
      <LocalitySheet id={locality} onClose={() => setLocality(null)} />
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return <fieldset><legend className="mb-2 t-body-sm font-semibold text-ink">{title}</legend>{children}</fieldset>;
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} aria-pressed={active}
      className={cn("inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 t-body-sm transition",
        active ? "border-ink bg-ink text-paper" : "border-line-2 bg-surface text-ink hover:border-ink/40")}>{children}</button>
  );
}

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn("mt-0.5 h-5 w-9 shrink-0 rounded-full p-0.5 transition", checked ? "bg-teal" : "bg-line-2")}>
        <span className={cn("block size-4 rounded-full bg-white shadow transition", checked && "translate-x-4")} />
      </button>
      <span><span className="block text-sm text-ink">{label}</span>{hint && <span className="text-xs text-slate">{hint}</span>}</span>
    </label>
  );
}

function Legend() {
  return (
    <div className="border-t border-line px-4 py-3 text-xs text-slate">
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {STATUS_GROUPS.map((g) => <span key={g.key} className="flex items-center gap-1.5"><span className="size-2.5 rounded-full" style={{ background: g.color }} />{g.label}</span>)}
      </div>
      <p className="mt-1.5">Larger markers: higher priority or more supporters.</p>
    </div>
  );
}

function IssueSheet({ trackingId, onClose }: { trackingId: string | null; onClose: () => void }) {
  const issue = useQuery({ queryKey: ["issue", trackingId], queryFn: () => api.get<IssueDetail>(`/api/issues/${trackingId}`), enabled: !!trackingId });
  const tl = useQuery({ queryKey: ["timeline", trackingId], queryFn: () => api.get<TimelineItem[]>(`/api/issues/${trackingId}/timeline`), enabled: !!trackingId });
  const d = issue.data;
  return (
    <Sheet open={!!trackingId} onOpenChange={(o) => !o && onClose()} title={d?.title ?? "Loading"} description={d ? `${d.tracking_id} · ${d.category?.name}` : undefined}
      footer={d && <Link to={`/issues/${d.tracking_id}`}><Button className="w-full">Open full issue page</Button></Link>}>
      {!d ? <Skeleton className="h-64" /> : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2"><StatusChip status={d.status} /><PriorityTag priority={d.priority} />{d.is_demo && <DemoBadge />}</div>
          {d.images[0] && <img src={d.images[0].url} alt="" className="aspect-video w-full  object-cover" />}
          <p className="t-body leading-relaxed text-ink">{d.description}</p>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-slate">Department</dt><dd className="font-medium">{d.department?.name ?? "Not routed yet"}</dd></div>
            <div><dt className="text-slate">Supporters</dt><dd className="num font-medium">{d.support_count}</dd></div>
            <div className="col-span-2"><dt className="text-slate">Location</dt><dd className="font-medium">{d.address ?? "—"}{d.locality ? `, ${d.locality.name}` : ""}</dd></div>
          </dl>
          <SLAMeter sla={d.sla} />
          <div>
            <h3 className="mb-3 t-h3">Accountability trail</h3>
            {tl.data && <Timeline items={tl.data} status={d.status} department={d.department?.name} />}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function LocalitySheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const q = useQuery({
    queryKey: ["locality", id], enabled: !!id,
    queryFn: () => api.get<{ locality: { name: string; is_approximate: boolean; boundary_source: string | null; population: number | null; population_source: string | null };
      overview: Overview; top_categories: CategoryStat[]; departments: DeptScore[]; recurring_hotspots: Hotspot[] }>(`/api/localities/${id}/stats`),
  });
  const d = q.data;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()} title={d?.locality.name ?? "Locality"} description="Statistics computed from reports inside this area">
      {!d ? <Skeleton className="h-64" /> : (
        <div className="space-y-7">
          {d.locality.is_approximate
            ? <p className="flex items-start gap-2 rounded-md bg-raised px-3 py-2 t-body-sm text-amber"><MapPinned className="mt-0.5 size-4 shrink-0" />Boundary is an approximate grouping, not an official ward map.</p>
            : d.locality.boundary_source && <p className="flex items-start gap-2 text-[12px] text-slate"><MapPinned className="mt-0.5 size-3.5 shrink-0" />Boundary source: {d.locality.boundary_source}</p>}
          {d.overview.total === 0 ? <EmptyState title="No reports here yet" /> : (<>
            <div className="grid grid-cols-2 gap-4">
              <Mini label="Reported" value={d.overview.total} />
              <Mini label="Resolved" value={pct(d.overview.resolution_rate)} sub={`${d.overview.resolved} issues`} />
              <Mini label="Pending" value={d.overview.pending + d.overview.verified + d.overview.in_progress} sub="Not yet fixed" />
              <Mini label="Average time to resolve" value={duration(d.overview.avg_resolution_hours)} sub={`From ${d.overview.resolved_sample} resolved`} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Most reported</h3>
              {d.top_categories.map((c) => (
                <div key={c.id} className="flex items-center gap-3 py-1.5">
                  <CategoryIcon icon={c.icon} className="text-slate" /><span className="flex-1 text-sm">{c.name}</span>
                  <div className="h-1.5 w-24 border border-line bg-raised"><div className="h-full bg-sage-300" style={{ width: `${(c.total / d.top_categories[0].total) * 100}%` }} /></div>
                  <span className="num w-6 text-right text-sm">{c.total}</span>
                </div>
              ))}
            </div>
            {d.recurring_hotspots.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">Recurring problems</h3>
                {d.recurring_hotspots.map((h) => <p key={h.cluster_id} className="mb-2 rounded-md bg-red-soft px-3 py-2 t-body-sm text-red">{h.insight}</p>)}
              </div>
            )}
            <div>
              <h3 className="mb-2 text-sm font-semibold">Departments working here</h3>
              {d.departments.map((x) => (
                <div key={x.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                  <span>{x.name}</span><span className="num text-slate">{x.resolved}/{x.assigned} resolved</span>
                </div>
              ))}
            </div>
            {d.locality.population && <p className="text-xs text-slate">Population {d.locality.population.toLocaleString()} (source: {d.locality.population_source})</p>}
            {d.overview.demo_rows > 0 && <p className="flex items-center gap-2 text-xs text-slate"><DemoBadge />Includes {d.overview.demo_rows} sample records.</p>}
          </>)}
        </div>
      )}
    </Sheet>
  );
}

function Mini({ label, value, sub }: { label: string; value: React.ReactNode; sub?: string }) {
  return (
    <div className=" border border-line p-3">
      <p className="text-xs text-slate">{label}</p>
      <p className="num mt-1 t-h2">{value}</p>
      {sub && <p className="text-xs text-mute">{sub}</p>}
    </div>
  );
}

