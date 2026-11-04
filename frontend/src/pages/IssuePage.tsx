import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "sonner";
import { Bell, BellOff, CheckCircle2, Download, MapPin, MessageSquare, RotateCcw, Star, ThumbsUp, TriangleAlert, UserRound } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMeta } from "@/hooks/queries";
import type { Evidence, IssueDetail, TimelineItem } from "@/types";
import { Badge, Button, DemoBadge, EmptyState, ErrorNote, Field, Modal, Panel, Skeleton, Textarea } from "@/components/ui";
import { CategoryIcon, PriorityTag, SLAMeter, StatusChip } from "@/components/issue/bits";
import { Timeline } from "@/components/issue/Timeline";
import { EvidenceCompare } from "@/components/issue/EvidenceCompare";
import { Comments } from "@/components/issue/Comments";
import { InlineSignup } from "@/design-system/Commons";
import { IssueMap } from "@/components/map/IssueMap";
import { cn, fmtDate, fmtDateTime } from "@/utils/format";

export default function IssuePage() {
  const { trackingId = "" } = useParams();
  const { user } = useAuth();
  const { data: meta } = useMeta();
  const issue = useQuery({ queryKey: ["issue", trackingId], queryFn: () => api.get<IssueDetail>(`/api/issues/${trackingId}`) });
  const tl = useQuery({ queryKey: ["timeline", trackingId], queryFn: () => api.get<TimelineItem[]>(`/api/issues/${trackingId}/timeline`) });
  const ev = useQuery({ queryKey: ["evidence", trackingId], queryFn: () => api.get<Evidence[]>(`/api/issues/${trackingId}/evidence`) });
  const d = issue.data;

  if (issue.isError) return <div className="mx-auto max-w-3xl px-4 py-20"><EmptyState title="Issue not found" body="Check the tracking ID and try again." action={<Link to="/issues"><Button variant="secondary">Browse issues</Button></Link>} /></div>;
  if (!d) return <div className="mx-auto max-w-6xl space-y-4 px-4 py-12 sm:px-6"><Skeleton className="h-12 w-2/3" /><Skeleton className="h-6 w-1/3" /><Skeleton className="h-80" /></div>;

  const staffView = user && (user.role === "admin" || user.role === "worker");
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <nav className="mb-6 text-sm text-slate" aria-label="Breadcrumb"><Link to="/issues" className="hover:text-ink">Issues</Link> <span className="text-mute">/</span> <span className="num">{d.tracking_id}</span></nav>
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={d.status} />
            <span className="inline-flex items-center gap-1.5 text-sm text-slate"><CategoryIcon icon={d.category?.icon} />{d.category?.name}</span>
            {d.is_demo && <DemoBadge />}
            {d.escalation_level >= 2 && d.status !== "resolved" && <Badge tone="red"><TriangleAlert className="size-3" />Past deadline</Badge>}
          </div>
          <h1 className="mt-3 t-h1">{d.title}</h1>
          <p className="mt-3 text-sm text-slate">
            Reported {fmtDate(d.created_at)} by {d.reporter_name ?? "an anonymous resident"}
            {d.locality && <> in <Link to={`/issues?locality=${d.locality.id}`} className="text-ink hover:text-ink">{d.locality.name}</Link></>}
          </p>
          {d.duplicate_of && (
            <p className="mt-4 rounded-md bg-paper-2 px-4 py-3 text-sm">This report was merged into <Link className="font-medium text-ink" to={`/issues/${d.duplicate_of.tracking_id}`}>{d.duplicate_of.tracking_id}</Link> — follow that issue for progress.</p>
          )}
          <p className="measure mt-6 text-[17px] leading-[1.7] whitespace-pre-line text-ink/90">{d.description}</p>
          {d.additional_info && <p className="measure mt-3 t-body text-slate">{d.additional_info}</p>}

          {d.images.length > 0 && (
            <div className={cn("mt-6 grid gap-2", d.images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
              {d.images.map((im) => (
                <a key={im.id} href={im.url} target="_blank" rel="noreferrer" className="block overflow-hidden  border border-line">
                  <img src={im.url} alt={im.caption ?? "Reported photo"} className="aspect-[4/3] w-full object-cover" />
                </a>
              ))}
            </div>
          )}

          <ReporterActions issue={d} evidence={ev.data?.[0]} />

          {ev.data && ev.data.length > 0 && (
            <section className="mt-12">
              <h2 className="t-h2">Proof of work</h2>
              <p className="mt-1 text-sm text-slate">Photos submitted by the field team. Drag across the image to compare.</p>
              <div className="mt-5 space-y-10">{ev.data.map((e) => <EvidenceCompare key={e.id} evidence={e} />)}</div>
            </section>
          )}

          <section className="mt-12">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="t-h2">Accountability trail</h2>
                <p className="mt-1 text-sm text-slate">{staffView ? "Staff view: internal notes are marked." : "Every public action on this issue, permanently recorded."}</p>
              </div>
              <a href={`/api/issues/${d.tracking_id}/export.pdf`}><Button variant="secondary" size="sm" icon={<Download className="size-4" />}>Download history (PDF)</Button></a>
            </div>
            <div className="mt-6">{tl.data ? <Timeline items={tl.data} showInternal={!!staffView} status={d.status} department={d.department?.name} /> : <Skeleton className="h-60" />}</div>
            <p className="mt-2 text-xs text-mute">The PDF is a record you can attach to your own enquiries (for example an RTI request). It is not itself an official RTI application or legal document.</p>
          </section>

          <div className="mt-12"><Comments issueId={d.id} /></div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Panel className="p-5">
            <h2 className="text-sm font-semibold text-ink">Deadline</h2>
            <div className="mt-2"><SLAMeter sla={d.sla} /></div>
            <dl className="mt-5 space-y-3 border-t border-line pt-4 text-sm">
              <Row label="Priority"><PriorityTag priority={d.priority} /></Row>
              <Row label="Department">{d.department?.name ?? <span className="text-mute">Not routed yet</span>}</Row>
              <Row label="Field worker">{d.assigned_worker ? <span className="inline-flex items-center gap-1.5"><UserRound className="size-3.5 text-slate" />{d.assigned_worker.name}</span> : <span className="text-mute">Not assigned</span>}</Row>
              {d.assigned_worker?.acknowledged_at && <Row label="Acknowledged">{fmtDateTime(d.assigned_worker.acknowledged_at)}</Row>}
              {d.resolved_at && <Row label="Resolved">{fmtDateTime(d.resolved_at)}</Row>}
              <Row label="Tracking ID"><span className="num font-medium">{d.tracking_id}</span></Row>
            </dl>
          </Panel>
          <CommunityActions issue={d} />
          {!user && <EmailUpdates issue={d} />}
          {meta && (
            <Panel className="overflow-hidden">
              <IssueMap interactive={false} center={[d.lng, d.lat]} zoom={15.2} className="h-48 w-full"
                issues={{ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [d.lng, d.lat] }, properties: { status: d.status, priority: d.priority ?? "medium", support: d.support_count, title: d.title, tracking_id: d.tracking_id, category: d.category?.name } }] }} />
              <div className="flex items-start gap-2 p-4 text-sm">
                <MapPin className="mt-0.5 size-4 shrink-0 text-slate" />
                <div>
                  <p className="text-ink">{d.address ?? "Pinned location"}</p>
                  <a className="text-xs text-ink underline underline-offset-4 hover:text-ink" target="_blank" rel="noreferrer" href={`https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lng}#map=18/${d.lat}/${d.lng}`}>Open in OpenStreetMap</a>
                </div>
              </div>
            </Panel>
          )}
        </aside>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center justify-between gap-3"><dt className="text-slate">{label}</dt><dd className="text-right text-ink">{children}</dd></div>;
}

function CommunityActions({ issue }: { issue: IssueDetail }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ["issue", issue.tracking_id] });
  const support = useMutation({
    mutationFn: () => issue.viewer.has_supported ? api.del(`/api/issues/${issue.id}/support`) : api.post(`/api/issues/${issue.id}/support`),
    onSuccess: refresh, onError: (e: Error) => toast.error(e.message),
  });
  const follow = useMutation({
    mutationFn: () => issue.viewer.is_following ? api.del(`/api/issues/${issue.id}/follow`) : api.post(`/api/issues/${issue.id}/follow`),
    onSuccess: () => { refresh(); toast.success(issue.viewer.is_following ? "Unfollowed" : "Following — you'll be notified of updates"); },
  });
  const [msgOpen, setMsgOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const startChat = useMutation({
    mutationFn: () => api.post<{ id: string }>("/api/conversations", { issue_id: issue.id, kind: "citizen_admin", first_message: msg }),
    onSuccess: (c) => navigate(`/messages/${c.id}`), onError: (e: Error) => toast.error(e.message),
  });

  const isCitizen = user?.role === "citizen";
  return (
    <Panel className="p-5">
      <div className="flex items-baseline justify-between">
        <p className="num t-h1">{issue.support_count}</p>
        <p className="text-sm text-slate">{issue.support_count === 1 ? "resident supports" : "residents support"} this report</p>
      </div>
      <div className="mt-4 grid gap-2">
        {!user && <Link to="/login"><Button className="w-full" icon={<ThumbsUp className="size-4" />}>Sign in to support</Button></Link>}
        {isCitizen && !issue.viewer.is_reporter && issue.status !== "rejected" && (
          <motion.div whileTap={{ scale: 0.98 }}>
            <Button variant={issue.viewer.has_supported ? "secondary" : "accent"} className="w-full" loading={support.isPending} onClick={() => support.mutate()}
              icon={<ThumbsUp className={cn("size-4", issue.viewer.has_supported && "fill-current")} />}>
              {issue.viewer.has_supported ? "You support this" : "I'm affected too"}
            </Button>
          </motion.div>
        )}
        {user && (
          <Button variant="secondary" className="w-full" loading={follow.isPending} onClick={() => follow.mutate()}
            icon={issue.viewer.is_following ? <BellOff className="size-4" /> : <Bell className="size-4" />}>
            {issue.viewer.is_following ? "Stop following" : "Follow updates"}
          </Button>
        )}
        {isCitizen && issue.viewer.is_reporter && (
          <Button variant="ghost" className="w-full" icon={<MessageSquare className="size-4" />} onClick={() => setMsgOpen(true)}>Message officials privately</Button>
        )}
      </div>
      <Modal open={msgOpen} onOpenChange={setMsgOpen} title="Message officials" description="Only you and administrators can see this conversation. Official updates still appear on the public trail."
        footer={<><Button variant="ghost" onClick={() => setMsgOpen(false)}>Cancel</Button><Button loading={startChat.isPending} disabled={!msg.trim()} onClick={() => startChat.mutate()}>Send message</Button></>}>
        <Textarea value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Add details or ask a question" maxLength={4000} />
      </Modal>
    </Panel>
  );
}

/** Reporter verifies the outcome (confirm / dispute / reopen); supporters can rate. */
function ReporterActions({ issue, evidence }: { issue: IssueDetail; evidence?: Evidence }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [mode, setMode] = useState<"confirm" | "dispute" | "reopen" | "rate" | null>(null);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");
  const [fixed, setFixed] = useState(true);
  const done = () => {
    setMode(null); setText(""); setRating(0);
    ["issue", "timeline", "evidence"].forEach((k) => qc.invalidateQueries({ queryKey: [k, issue.tracking_id] }));
  };
  const act = useMutation({
    mutationFn: () => {
      if (mode === "confirm") return api.post(`/api/issues/${issue.id}/confirm`, { rating, comment: text || null });
      if (mode === "dispute") return api.post(`/api/issues/${issue.id}/dispute`, { reason: text, rating: rating || null });
      if (mode === "reopen") return api.post(`/api/issues/${issue.id}/reopen`, { to_status: "reopened", reason: text });
      return api.post(`/api/issues/${issue.id}/feedback`, { rating, was_fixed: fixed, comment: text || null });
    },
    onSuccess: () => { toast.success(mode === "confirm" ? "Thanks — marked as resolved" : mode === "rate" ? "Feedback recorded" : "Reopened — officials have been notified"); done(); },
  });

  if (user?.role !== "citizen") return null;
  const reporter = issue.viewer.is_reporter;
  const canRate = !reporter && issue.viewer.has_supported && ["resolved", "awaiting_verification"].includes(issue.status);

  let banner: React.ReactNode = null;
  if (reporter && issue.status === "awaiting_verification") {
    banner = (
      <div className="mt-8  border-2 border-ink bg-raised p-5">
        <h2 className="t-h2">The field team says this is fixed. Is it?</h2>
        <p className="mt-1 text-sm text-slate">{evidence ? "Check the before-and-after photos below, or visit the spot." : "Visit the spot if you can."} Your answer decides whether the issue closes.</p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="accent" icon={<CheckCircle2 className="size-4" />} onClick={() => setMode("confirm")}>Yes, it's fixed</Button>
          <Button variant="danger" icon={<RotateCcw className="size-4" />} onClick={() => setMode("dispute")}>No, not properly fixed</Button>
        </div>
      </div>
    );
  } else if (reporter && issue.status === "resolved") {
    banner = (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3  border border-line bg-surface p-4">
        <p className="text-sm text-slate">Problem came back or wasn't really fixed?</p>
        <Button variant="secondary" size="sm" icon={<RotateCcw className="size-4" />} onClick={() => setMode("reopen")}>Reopen this issue</Button>
      </div>
    );
  } else if (canRate) {
    banner = (
      <div className="mt-8 flex flex-wrap items-center justify-between gap-3  border border-line bg-surface p-4">
        <p className="text-sm text-slate">You supported this report. How did the fix turn out?</p>
        <Button variant="secondary" size="sm" icon={<Star className="size-4" />} onClick={() => setMode("rate")}>Rate the outcome</Button>
      </div>
    );
  }

  const titles = { confirm: "Confirm it's fixed", dispute: "Tell us what's still wrong", reopen: "Reopen this issue", rate: "Rate the outcome" };
  const needsText = mode === "dispute" || mode === "reopen";
  const needsRating = mode === "confirm" || mode === "rate";
  return (
    <>
      {banner}
      <Modal open={!!mode} onOpenChange={(o) => !o && setMode(null)} title={mode ? titles[mode] : ""}
        description={mode === "dispute" ? "The issue will be reopened and officials notified. Your reason is shown on the public trail." : undefined}
        footer={<><Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
          <Button loading={act.isPending} variant={mode === "confirm" || mode === "rate" ? "accent" : "danger"}
            disabled={(needsRating && !rating) || (needsText && text.trim().length < 10)} onClick={() => act.mutate()}>
            {mode === "confirm" ? "Confirm resolved" : mode === "rate" ? "Submit rating" : "Reopen issue"}
          </Button></>}>
        <div className="space-y-4">
          {mode === "rate" && (
            <Field label="Was the problem actually fixed?">
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={fixed ? "primary" : "secondary"} onClick={() => setFixed(true)}>Yes</Button>
                <Button type="button" size="sm" variant={!fixed ? "primary" : "secondary"} onClick={() => setFixed(false)}>No</Button>
              </div>
            </Field>
          )}
          {(needsRating || mode === "dispute") && (
            <Field label={mode === "dispute" ? "How would you rate the response so far?" : "How satisfied are you?"} optional={mode === "dispute"}>
              <div className="flex gap-1" role="radiogroup">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button key={n} type="button" role="radio" aria-checked={rating === n} aria-label={`${n} of 5`} onClick={() => setRating(n)} className="p-1">
                    <Star className={cn("size-7 transition", n <= rating ? "fill-amber text-amber" : "text-line-2")} />
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label={needsText ? "What's wrong?" : "Comments"} optional={!needsText} hint={needsText ? "At least 10 characters." : undefined}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={1000} />
          </Field>
          <ErrorNote error={act.error} />
        </div>
      </Modal>
    </>
  );
}


/** Commons InlineSignup under a report, for visitors without an account. Double opt-in. */
function EmailUpdates({ issue }: { issue: IssueDetail }) {
  const sub = useMutation({ mutationFn: (email: string) => api.post<{ message: string }>(`/api/issues/${issue.id}/subscribe`, { email, consent: true }) });
  return (
    <Panel className="p-5">
      <h2 className="t-h3">Get updates on this report</h2>
      <p className="t-body-sm mt-1 mb-4 text-slate">No account needed. We'll email you when its status changes.</p>
      {sub.isSuccess ? (
        <p className="t-body-sm border-l-2 border-ink pl-3" role="status">{sub.data.message} Nothing else is sent until you do.</p>
      ) : (
        <InlineSignup cta="Get updates" placeholder="you@example.com" disabled={sub.isPending}
          error={sub.error ? (sub.error as Error).message : undefined}
          consent={<>Email me about this report only. Every email has a link to stop them.</>}
          onSubmit={(email) => sub.mutate(email)} />
      )}
    </Panel>
  );
}
