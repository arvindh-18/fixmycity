import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2 } from "lucide-react";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import type { Announcement, DeptScore, IssueCard, Overview, Paged, Status } from "@/types";
import { Button, DemoBadge, Skeleton } from "@/components/ui";
import { ReportCard, StatusChip } from "@/components/issue/bits";
import { IssueMap, type FC } from "@/components/map/IssueMap";
import { CalloutBand, FeatureItem, Icon } from "@/design-system/Commons";
import { FramesArt } from "@/components/Art";
import { ago, cn, duration, fmtDate, pct } from "@/utils/format";

interface Activity { id: string; at: string; tracking_id: string; title: string; status: Status; status_label: string; reason: string | null; actor: string; is_demo: boolean; icon: string }

const OPEN = ["submitted", "pending_verification", "verified", "assigned", "in_progress", "reopened", "on_hold", "escalated"];

/** Cards pinned to a board: a space-8 gutter, alternate columns dropped by space-12 on wide screens. */
function Board({ items, loading }: { items?: IssueCard[]; loading: boolean }) {
  return (
    <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
      {loading && Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className={cn("aspect-[3/4]", i % 2 && "lg:mt-12")} />)}
      {items?.map((i, idx) => <ReportCard key={i.id} issue={i} className={cn("max-w-none", idx % 2 === 1 && "lg:mt-12")} />)}
    </div>
  );
}

export default function Landing() {
  const { data: meta } = useMeta();
  const navigate = useNavigate();
  const activity = useQuery({ queryKey: ["activity"], queryFn: () => api.get<Activity[]>("/api/activity", { limit: 6 }), refetchInterval: 60_000 });
  const overview = useQuery({ queryKey: ["stats", "overview"], queryFn: () => api.get<Overview>("/api/stats/overview") });
  const recent = useQuery({ queryKey: ["issues", "recent"], queryFn: () => api.get<Paged<IssueCard>>("/api/issues", { page_size: 4, sort: "newest", status: OPEN }) });
  const resolved = useQuery({ queryKey: ["issues", "resolved"], queryFn: () => api.get<Paged<IssueCard>>("/api/issues", { page_size: 4, sort: "resolved", status: "resolved" }) });
  const depts = useQuery({ queryKey: ["stats", "departments"], queryFn: () => api.get<DeptScore[]>("/api/stats/departments") });
  const mapData = useQuery({ queryKey: ["map", "all"], queryFn: () => api.get<FC>("/api/map/issues") });
  const news = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<Announcement[]>("/api/announcements") });
  const ov = overview.data;
  const city = meta?.city.name ?? "your city";

  return (
    <div className="mx-auto max-w-[1120px] px-4 sm:px-6">
      {/* ---------------------------------------------------------------- hero: centred display, one italic phrase, one primary */}
      <section className="pt-16 pb-24 text-center sm:pt-24">
        <h1 className="t-display mx-auto max-w-[26ch]">Your city. Your voice. Every issue <em>accounted for</em>.</h1>
        <p className="t-body mx-auto mt-6 max-w-[52ch] text-slate">
          Tell us what's broken on your street. We send it to the department that owns it, and you can follow every step until it's fixed.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/report"><Button variant="primary">Report an issue</Button></Link>
          <Link to="/map"><Button variant="quiet">Explore the map</Button></Link>
        </div>
        {ov && ov.resolved > 0 && (
          <p className="t-body-sm mt-6 text-slate">
            <span className="num text-ink">{ov.resolved.toLocaleString("en-IN")}</span> reports fixed so far in {city}
            {ov.demo_rows > 0 && <> <DemoBadge className="ml-1 align-middle" /></>}
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- recent reports pinned to a board */}
      <section className="mx-auto max-w-[960px]">
        <div className="mb-16 text-center">
          <h2 className="t-h1">Reported <em>this week</em></h2>
          <p className="t-body mt-3 text-slate">Seen one of these too? Open it and add your voice instead of filing a new report.</p>
        </div>
        <Board items={recent.data?.items} loading={recent.isLoading} />
        <div className="mt-12 text-center lg:mt-20"><Link to="/issues"><Button>See all reports</Button></Link></div>
      </section>

      {/* ---------------------------------------------------------------- how it works */}
      <section className="mx-auto mt-24 max-w-[960px]">
        <div className="mb-16 text-center">
          <h2 className="t-h1">How a report becomes a <em>repair</em></h2>
          <p className="t-body mx-auto mt-3 max-w-[60ch] text-slate">Each step is recorded with who did it, when and why. Nobody, including officials, can quietly change that history.</p>
        </div>
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <FeatureItem title="Snap and send" icon={<Icon name="camera" size={64} />}>A photo, a pin and a few words. You get a tracking number straight away.</FeatureItem>
          <FeatureItem title="Sent to the right team" icon={<Icon name="megaphone" size={64} />}>An official checks it, sets how urgent it is and routes it, or writes down why not.</FeatureItem>
          <FeatureItem title="Followed on the map" icon={<Icon name="pin" size={64} />}>The crew posts progress. You see the deadline and who has it at every step.</FeatureItem>
          <FeatureItem title="Fixed, with proof" icon={<CheckCircle2 className="h-16 w-16 text-ink" strokeWidth={1.5} aria-hidden />}>Before-and-after photos come back to you. If it isn't really fixed, you reopen it.</FeatureItem>
        </div>
      </section>

      {/* ---------------------------------------------------------------- map, framed */}
      <section className="mx-auto mt-24 max-w-[960px]">
        <div className="mb-16 text-center">
          <h2 className="t-h1">What's happening in <em>{city}</em></h2>
          <p className="t-body mx-auto mt-3 max-w-[60ch] text-slate">Yellow is newly reported, blue is with a crew, pale green is waiting for a check, dark green is fixed.</p>
        </div>
        <div className="border-[1.5px] border-ink">
          {meta && mapData.data ? (
            <IssueMap issues={mapData.data} center={[meta.city.lng, meta.city.lat]} zoom={11.3} className="h-[420px] w-full"
              onSelectIssue={(tid) => navigate(`/issues/${tid}`)} />
          ) : <Skeleton className="h-[420px]" />}
        </div>
        <span className="cv-rules mt-2" aria-hidden><i /><i /></span>
        <div className="mt-6 text-center"><Link to="/map"><Button>Open the full map</Button></Link></div>
      </section>

      {/* ---------------------------------------------------------------- the public register */}
      <section className="mx-auto mt-24 max-w-[960px]">
        <div className="mb-16 text-center">
          <h2 className="t-h1">The <em>public</em> register</h2>
          <p className="t-body mt-3 text-slate">The latest recorded step on reports across the city, as it happens.</p>
        </div>
        <ol className="border-t border-line">
          {activity.isLoading && Array.from({ length: 5 }).map((_, i) => <li key={i} className="border-b border-line py-4"><Skeleton className="h-10" /></li>)}
          {activity.data?.map((a) => (
            <li key={a.id}>
              <Link to={`/issues/${a.tracking_id}`} className="group grid grid-cols-1 gap-2 border-b border-line py-4 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
                <div className="min-w-0">
                  <h3 className="t-h3 group-hover:underline">{a.title}</h3>
                  <p className="t-body-sm mt-1 truncate text-slate">{a.actor}{a.reason ? ` — ${a.reason}` : ""} · {ago(a.at)}</p>
                </div>
                <StatusChip status={a.status} size="sm" />
              </Link>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------------- recently fixed */}
      <section className="mx-auto mt-24 max-w-[960px]">
        <div className="mb-16 text-center">
          <h2 className="t-h1">Recently <em>fixed</em></h2>
          <p className="t-body mt-3 text-slate">Each one confirmed by the resident who reported it, or checked by an official.</p>
        </div>
        <Board items={resolved.data?.items} loading={resolved.isLoading} />
      </section>

      {/* ---------------------------------------------------------------- departments: numbers as proof, with their sample sizes */}
      <section className="mx-auto mt-24 max-w-[960px]">
        <div className="mb-16 text-center">
          <h2 className="t-h1">How each department <em>is doing</em></h2>
          <p className="t-body mx-auto mt-3 max-w-[60ch] text-slate">Share of valid reports fixed, and how many reports that's based on. We don't compare departments with fewer than five.</p>
        </div>
        <div className="border-t border-line">
          {depts.isLoading && <Skeleton className="mt-4 h-40" />}
          {depts.data?.filter((d) => d.assigned > 0).sort((a, b) => a.name.localeCompare(b.name)).map((d) => (
            <div key={d.id} className="grid grid-cols-[1fr_auto] items-center gap-x-6 gap-y-2 border-b border-line py-4 md:grid-cols-[260px_1fr_140px_140px]">
              <div>
                <h3 className="t-h3">{d.name}</h3>
                <p className="t-body-sm text-slate">{d.sample_size} reports</p>
              </div>
              <div className="col-span-2 flex items-center gap-3 md:col-span-1">
                <div className="h-2.5 flex-1 border border-ink bg-raised"><div className="h-full bg-sage-300" style={{ width: `${(d.resolution_rate ?? 0) * 100}%` }} /></div>
                <span className="num t-label w-12 text-right">{d.enough_data ? pct(d.resolution_rate) : "—"}</span>
              </div>
              <p className="t-body-sm text-slate"><span className="num text-ink">{duration(d.avg_resolution_hours)}</span> to fix</p>
              <p className="t-body-sm text-slate">{d.satisfaction_avg ? <><span className="num text-ink">{d.satisfaction_avg.toFixed(1)}</span> of 5 from {d.satisfaction_sample}</> : "No ratings yet"}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 text-center"><Link to="/transparency"><Button>See every figure</Button></Link></div>
      </section>

      {/* ---------------------------------------------------------------- the one tinted band on the page */}
      <section className="mt-40 mb-16">
        <CalloutBand
          title={<>Seen it too? <em>Add your voice</em> instead of a new report</>}
          action={<Link to="/register"><Button variant="primary">Create a free account</Button></Link>}
          art={<FramesArt icon="megaphone" />}
        >
          <p>Before you file a report, Commons checks for similar ones nearby. Supporting an existing report raises its priority, and you'll hear about every step.</p>
        </CalloutBand>
      </section>

      {/* ---------------------------------------------------------------- council notices */}
      {news.data && news.data.length > 0 && (
        <section className="mx-auto mt-24 max-w-[960px]">
          <div className="mb-16 text-center"><h2 className="t-h1">Notices from <em>the council</em></h2></div>
          <div className="grid gap-8 md:grid-cols-2">
            {news.data.slice(0, 4).map((a) => (
              <article key={a.id} className="border-t-[1.5px] border-ink pt-4">
                <p className="t-caption text-slate">{[a.department ?? "City", a.locality, fmtDate(a.created_at)].filter(Boolean).join(" · ")}</p>
                <h3 className="t-h3 mt-1">{a.title}</h3>
                <p className="t-body-sm mt-2 text-slate">{a.body}</p>
              </article>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

