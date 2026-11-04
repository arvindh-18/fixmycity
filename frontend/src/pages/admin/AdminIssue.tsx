import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy, ExternalLink, Megaphone, MessageSquare, RefreshCw, Sparkles, UserPlus, X } from "lucide-react";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import type { AdminIssueDetail, Evidence, Priority, Status, TimelineItem, User } from "@/types";
import { Badge, Button, DemoBadge, ErrorNote, Field, Modal, Panel, Select, Skeleton, Textarea, Input } from "@/components/ui";
import { CategoryIcon, PriorityTag, SLAMeter, StatusChip } from "@/components/issue/bits";
import { Timeline } from "@/components/issue/Timeline";
import { EvidenceCompare } from "@/components/issue/EvidenceCompare";
import { IssueMap } from "@/components/map/IssueMap";
import { ACTION_LABEL, STATUS } from "@/utils/status";
import { cn, fmtDateTime, metres } from "@/utils/format";

type Worker = User & { employee_code: string; active_tasks: number; completed_tasks: number };

export default function AdminIssue() {
  const { trackingId = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: meta } = useMeta();
  const key = ["admin-issue", trackingId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<AdminIssueDetail>(`/api/admin/issues/${trackingId}`) });
  const tl = useQuery({ queryKey: ["timeline", trackingId], queryFn: () => api.get<TimelineItem[]>(`/api/issues/${trackingId}/timeline`) });
  const ev = useQuery({ queryKey: ["evidence", trackingId], queryFn: () => api.get<Evidence[]>(`/api/issues/${trackingId}/evidence`) });
  const d = q.data;

  const refresh = (data?: AdminIssueDetail) => {
    if (data) qc.setQueryData(key, data);
    qc.invalidateQueries({ queryKey: ["timeline", trackingId] });
    qc.invalidateQueries({ queryKey: ["evidence", trackingId] });
    qc.invalidateQueries({ queryKey: ["admin"] });
  };

  if (q.isError) return <ErrorNote error={q.error} />;
  if (!d) return <div className="space-y-3"><Skeleton className="h-10 w-1/2" /><Skeleton className="h-96" /></div>;

  return (
    <div>
      <button onClick={() => navigate(-1)} className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate hover:text-ink"><ArrowLeft className="size-4" />Back to queue</button>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusChip status={d.status} /><PriorityTag priority={d.priority} />
            <span className="num text-sm text-slate">{d.tracking_id}</span>{d.is_demo && <DemoBadge />}
          </div>
          <h1 className="mt-2 t-h1">{d.title}</h1>
          <p className="mt-1 flex items-center gap-1.5 text-sm text-slate"><CategoryIcon icon={d.category?.icon} />{d.category?.name} · {d.address ?? "No address"}{d.locality ? `, ${d.locality.name}` : ""}</p>
        </div>
        <Link to={`/issues/${d.tracking_id}`} target="_blank"><Button variant="secondary" size="sm" icon={<ExternalLink className="size-4" />}>Public page</Button></Link>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_400px]">
        <div className="min-w-0 space-y-6">
          <Panel className="p-5">
            <p className="t-body leading-relaxed whitespace-pre-line">{d.description}</p>
            {d.additional_info && <p className="mt-2 text-sm text-slate">{d.additional_info}</p>}
            {d.images.length > 0 && <div className="mt-4 flex flex-wrap gap-2">{d.images.map((im) => <a key={im.id} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt="" className="h-28 w-40 rounded-md border border-line object-cover" /></a>)}</div>}
            <dl className="mt-5 grid gap-4 border-t border-line pt-4 text-sm sm:grid-cols-3">
              <div><dt className="text-slate">Reporter</dt><dd className="font-medium">{d.reporter ? d.reporter.name : "Anonymous"}</dd>{d.reporter && <dd className="text-xs text-slate">{d.reporter.email}{d.reporter.phone ? ` · ${d.reporter.phone}` : ""}</dd>}</div>
              <div><dt className="text-slate">Supporters</dt><dd className="num font-medium">{d.support_count}</dd></div>
              <div><dt className="text-slate">Reported</dt><dd className="font-medium">{fmtDateTime(d.created_at)}</dd></div>
            </dl>
          </Panel>

          <AIPanel d={d} onChange={refresh} />

          {ev.data && ev.data.length > 0 && (
            <Panel className="p-5">
              <h2 className="mb-4 font-semibold">Completion evidence</h2>
              <div className="space-y-8">{ev.data.map((e) => <EvidenceCompare key={e.id} evidence={e} />)}</div>
            </Panel>
          )}

          <Panel className="p-5">
            <h2 className="mb-5 font-semibold">Full history <span className="font-normal text-slate">· internal entries marked</span></h2>
            {tl.data ? <Timeline items={tl.data} showInternal status={d.status} department={d.department?.name} /> : <Skeleton className="h-60" />}
          </Panel>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Panel className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Deadline</h2>
            <SLAMeter sla={d.sla} />
            {d.sla_rule && <p className="mt-2 text-xs text-slate">Rule: {d.sla_rule.category}, {d.sla_rule.priority} — respond {d.sla_rule.response_hours} h, resolve {d.sla_rule.resolution_hours} h</p>}
          </Panel>
          <Actions d={d} onDone={refresh} />
          <AssignmentCard d={d} onDone={refresh} />
          <OfficialUpdate d={d} onDone={refresh} />
          {meta && (
            <Panel className="overflow-hidden">
              <IssueMap interactive={false} center={[d.lng, d.lat]} zoom={15} className="h-40 w-full"
                issues={{ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [d.lng, d.lat] }, properties: { status: d.status, priority: d.priority ?? "medium", support: 0 } }] }} />
            </Panel>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ workflow actions
function Actions({ d, onDone }: { d: AdminIssueDetail; onDone: (x?: AdminIssueDetail) => void }) {
  const { data: meta } = useMeta();
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [target, setTarget] = useState<Status | null>(null);
  const [reason, setReason] = useState("");
  const [priority, setPriority] = useState<Priority>((d.ai.priority?.output?.priority as Priority) ?? d.priority ?? "medium");
  const [categoryId, setCategoryId] = useState(d.category?.id ?? "");
  const [deptId, setDeptId] = useState(d.department?.id ?? "");
  const [isPublic, setIsPublic] = useState(true);

  const run = useMutation({
    mutationFn: (fn: () => Promise<AdminIssueDetail>) => fn(),
    onSuccess: (r) => { onDone(r); setVerifyOpen(false); setRejectOpen(false); setTarget(null); setReason(""); toast.success(`Status: ${STATUS[r.status].label}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const canVerify = d.allowed_transitions.includes("verified");
  const canReject = d.allowed_transitions.includes("rejected");
  const others = d.allowed_transitions.filter((s) => !["verified", "rejected", "assigned"].includes(s));
  const prioRec = d.ai.priority?.output;

  return (
    <Panel className="p-5">
      <h2 className="text-sm font-semibold">Next step</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {canVerify && <Button variant="accent" icon={<Check className="size-4" />} onClick={() => setVerifyOpen(true)}>Verify &amp; route</Button>}
        {canReject && <Button variant="danger" icon={<X className="size-4" />} onClick={() => setRejectOpen(true)}>Reject</Button>}
        {others.map((s) => (
          <Button key={s} variant={s === "resolved" ? "accent" : "secondary"} size="md" onClick={() => setTarget(s)}>{ACTION_LABEL[s] ?? STATUS[s].label}</Button>
        ))}
        {d.allowed_transitions.length === 0 && <p className="text-sm text-slate">No administrator action available in this state.</p>}
      </div>
      {d.status === "awaiting_verification" && <p className="mt-3 text-xs text-slate">The reporter can confirm this themselves. Resolve here only after you've checked the evidence.</p>}

      <Modal open={verifyOpen} onOpenChange={setVerifyOpen} title="Verify and route" description="Sets priority, starts the SLA clock and routes to a department."
        footer={<><Button variant="ghost" onClick={() => setVerifyOpen(false)}>Cancel</Button>
          <Button variant="accent" loading={run.isPending} onClick={() => run.mutate(() => api.post(`/api/admin/issues/${d.id}/verify`, { priority, category_id: categoryId || null, department_id: deptId || null, note: reason || null }))}>Verify issue</Button></>}>
        <div className="space-y-4">
          <Field label="Priority" hint={prioRec ? <>Recommended: <strong>{prioRec.priority}</strong> ({prioRec.score} points, {d.ai.priority.mode === "rules" ? "rule-based" : "AI"})</> : undefined}>
            <div className="grid grid-cols-4 gap-1.5">
              {(["low", "medium", "high", "critical"] as Priority[]).map((p) => (
                <button key={p} type="button" onClick={() => setPriority(p)} aria-pressed={priority === p}
                  className={cn("rounded-md border py-2 text-sm capitalize", priority === p ? "border-ink bg-ink text-paper" : "border-line-2 hover:border-ink/40")}>{p}</button>
              ))}
            </div>
          </Field>
          <Field label="Category"><Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>{meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Department" hint="Leave as default to use the category's department.">
            <Select value={deptId} onChange={(e) => setDeptId(e.target.value)}><option value="">Category default</option>{meta?.departments.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select>
          </Field>
          <Field label="Note for the public trail" optional><Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} /></Field>
          <ErrorNote error={run.error} />
        </div>
      </Modal>

      <Modal open={rejectOpen} onOpenChange={setRejectOpen} title="Reject this report" description="The reason is published on the issue's public trail and sent to the reporter."
        footer={<><Button variant="ghost" onClick={() => setRejectOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={reason.trim().length < 5} loading={run.isPending} onClick={() => run.mutate(() => api.post(`/api/admin/issues/${d.id}/reject`, { reason }))}>Reject report</Button></>}>
        <Field label="Reason" hint="Be specific — for example, private property, outside city limits, insufficient detail."><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
      </Modal>

      <Modal open={!!target} onOpenChange={(o) => !o && setTarget(null)} title={target ? (ACTION_LABEL[target] ?? STATUS[target].label) : ""}
        description={target === "in_progress" ? "The worker will be asked to redo or complete the work. Their evidence is marked as sent back." : undefined}
        footer={<><Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
          <Button loading={run.isPending} onClick={() => run.mutate(() => api.post(`/api/admin/issues/${d.id}/transition`, { to_status: target, reason: reason || null, is_public: isPublic }))}>Confirm</Button></>}>
        <div className="space-y-3">
          <Field label="Reason" optional={!["on_hold", "escalated", "reopened", "in_progress"].includes(target ?? "")}><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} className="accent-[var(--ink)]" />Show this step on the public trail</label>
          <ErrorNote error={run.error} />
        </div>
      </Modal>
    </Panel>
  );
}

function AssignmentCard({ d, onDone }: { d: AdminIssueDetail; onDone: (x?: AdminIssueDetail) => void }) {
  const navigate = useNavigate();
  const active = d.assignments.find((a) => a.is_active);
  const canAssign = ["verified", "reopened", "escalated", "on_hold", "assigned", "in_progress"].includes(d.status);
  const [open, setOpen] = useState(false);
  const [workerId, setWorkerId] = useState("");
  const [instructions, setInstructions] = useState("");
  const workers = useQuery({ queryKey: ["admin", "workers", d.department?.id], queryFn: () => api.get<Worker[]>("/api/admin/workers", { department: d.department?.id }), enabled: open });
  const assign = useMutation({
    mutationFn: () => api.post<AdminIssueDetail>(`/api/admin/issues/${d.id}/assign`, { worker_id: workerId, instructions: instructions || null }),
    onSuccess: (r) => { onDone(r); setOpen(false); toast.success("Worker assigned and notified"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const chat = useMutation({
    mutationFn: (msg: string) => api.post<{ id: string }>("/api/conversations", { issue_id: d.id, kind: "admin_worker", first_message: msg }),
    onSuccess: (c) => navigate(`/admin/messages/${c.id}`), onError: (e: Error) => toast.error(e.message),
  });
  const chatReporter = useMutation({
    mutationFn: (msg: string) => api.post<{ id: string }>("/api/conversations", { issue_id: d.id, kind: "citizen_admin", first_message: msg }),
    onSuccess: (c) => navigate(`/admin/messages/${c.id}`), onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel className="p-5">
      <h2 className="text-sm font-semibold">Assignment</h2>
      {active ? (
        <div className="mt-2 text-sm">
          <p className="font-medium">{active.worker_name}</p>
          <p className="text-xs text-slate">Assigned {fmtDateTime(active.created_at)}{active.due_at ? ` · due ${fmtDateTime(active.due_at)}` : ""}</p>
          <ul className="mt-2 space-y-1 text-xs">
            <Step ok={!!active.acknowledged_at} label="Acknowledged" at={active.acknowledged_at} />
            <Step ok={!!active.started_at} label="Work started" at={active.started_at} />
            <Step ok={!!active.completed_at} label="Evidence submitted" at={active.completed_at} />
          </ul>
          {active.instructions && <p className="mt-2 rounded bg-paper px-2 py-1.5 text-xs text-slate">{active.instructions}</p>}
        </div>
      ) : <p className="mt-1 text-sm text-slate">No field worker assigned.</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {canAssign && <Button size="sm" variant={active ? "secondary" : "primary"} icon={<UserPlus className="size-4" />} onClick={() => setOpen(true)}>{active ? "Reassign" : "Assign worker"}</Button>}
        {active && <Button size="sm" variant="ghost" icon={<MessageSquare className="size-4" />} loading={chat.isPending} onClick={() => chat.mutate(`About ${d.tracking_id}: please send an update.`)}>Message worker</Button>}
        {d.reporter && <Button size="sm" variant="ghost" icon={<MessageSquare className="size-4" />} loading={chatReporter.isPending} onClick={() => chatReporter.mutate(`Hello, this is about your report ${d.tracking_id}.`)}>Message reporter</Button>}
      </div>
      {d.assignments.filter((a) => !a.is_active).length > 0 && <p className="mt-3 text-xs text-mute">Previous: {d.assignments.filter((a) => !a.is_active).map((a) => a.worker_name).join(", ")}</p>}
      <Modal open={open} onOpenChange={setOpen} title="Assign a field worker" description={d.department ? `Showing ${d.department.name} workers.` : undefined}
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!workerId} loading={assign.isPending} onClick={() => assign.mutate()}>Assign</Button></>}>
        <div className="space-y-4">
          <div className="max-h-64 space-y-1.5 overflow-y-auto scrollbar-thin">
            {workers.data?.filter((w) => w.is_active).map((w) => (
              <button key={w.id} type="button" onClick={() => setWorkerId(w.id)}
                className={cn("flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm", workerId === w.id ? "border-teal bg-raised" : "border-line hover:border-ink/30")}>
                <span><span className="font-medium">{w.full_name}</span> <span className="text-xs text-slate">{w.employee_code}</span></span>
                <span className="text-xs text-slate">{w.active_tasks} active</span>
              </button>
            ))}
            {workers.data?.length === 0 && <p className="text-sm text-slate">No workers in this department. Add one under Field workers.</p>}
          </div>
          <Field label="Instructions" optional><Textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} maxLength={2000} placeholder="Safety notes, access, materials" /></Field>
          <ErrorNote error={assign.error} />
        </div>
      </Modal>
    </Panel>
  );
}

function Step({ ok, label, at }: { ok: boolean; label: string; at: string | null }) {
  return <li className={cn("flex items-center gap-1.5", ok ? "text-green" : "text-mute")}>{ok ? <Check className="size-3.5" /> : <span className="size-3.5 rounded-full border border-current" />}{label}{at && <span className="text-slate">· {fmtDateTime(at)}</span>}</li>;
}

function OfficialUpdate({ d, onDone }: { d: AdminIssueDetail; onDone: () => void }) {
  const [body, setBody] = useState("");
  const m = useMutation({
    mutationFn: () => api.post(`/api/admin/issues/${d.id}/official-update`, { body }),
    onSuccess: () => { setBody(""); onDone(); toast.success("Published to the public trail"); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <Panel className="p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Megaphone className="size-4 text-ink" />Official public update</h2>
      <p className="mt-0.5 text-xs text-slate">Appears on the public trail and notifies the reporter and followers. For private questions, use messages.</p>
      <Textarea className="mt-3 min-h-20" value={body} onChange={(e) => setBody(e.target.value)} maxLength={2000} placeholder="e.g. Materials ordered; work scheduled for Thursday." />
      <Button className="mt-2" size="sm" disabled={body.trim().length < 3} loading={m.isPending} onClick={() => m.mutate()}>Publish update</Button>
    </Panel>
  );
}

// ------------------------------------------------------------------ AI recommendations (always reviewable)
function AIPanel({ d, onChange }: { d: AdminIssueDetail; onChange: (x?: AdminIssueDetail) => void }) {
  const cls = d.ai.classification;
  const pr = d.ai.priority;
  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: string }) => api.post(`/api/admin/ai/${id}/decision`, { decision }),
    onSuccess: () => { onChange(); toast.success("Decision recorded in the audit log"); },
  });
  const rerun = useMutation({ mutationFn: () => api.post<AdminIssueDetail>(`/api/admin/issues/${d.id}/ai/refresh`), onSuccess: (r) => onChange(r) });
  const dup = useMutation({
    mutationFn: (tid: string) => api.post<AdminIssueDetail>(`/api/admin/issues/${d.id}/mark-duplicate`, undefined, { of: tid }),
    onSuccess: (r) => { onChange(r); toast.success("Marked as duplicate; reporter now follows the original"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [confirmDup, setConfirmDup] = useState<string | null>(null);
  const mode = pr?.mode ?? cls?.mode;
  return (
    <Panel className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 text-ink" />Assistant suggestions</h2>
        <div className="flex items-center gap-2">
          <Badge>{mode === "llm" ? "AI model" : "Demonstration mode: rules"}</Badge>
          <Button size="sm" variant="ghost" icon={<RefreshCw className="size-3.5" />} loading={rerun.isPending} onClick={() => rerun.mutate()}>Recalculate</Button>
        </div>
      </div>
      <p className="mt-0.5 text-xs text-slate">Suggestions only. They never change the issue by themselves; your decision is what's recorded.</p>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        {cls && (
          <div className=" border border-line p-4">
            <p className="text-xs text-slate">Category</p>
            <p className="mt-0.5 font-medium">{cls.output.category_slug} <span className="num text-sm text-slate">· {Math.round((cls.confidence ?? 0) * 100)}%</span></p>
            <p className="mt-1 t-body-sm text-slate">{cls.output.detected_problem}</p>
            {cls.output.summary && <p className="mt-2 t-body-sm italic text-ink/80">"{cls.output.summary}"</p>}
            {cls.output.safety_flags?.length > 0 && <p className="mt-2 text-xs text-red">Safety words: {cls.output.safety_flags.join(", ")}</p>}
            {cls.output.image_analysis?.status === "analysed" && (
              <p className={cn("mt-2 rounded px-2 py-1.5 text-xs", cls.output.image_analysis.matches_description ? "bg-raised text-ink" : "bg-raised text-amber")}>
                Photo: {cls.output.image_analysis.observation}{cls.output.image_analysis.matches_description ? "" : " (may not match the description)"}
              </p>
            )}
            {cls.output.image_analysis?.status === "unavailable" && <p className="mt-2 text-xs text-mute">Photo not analysed: {cls.output.image_analysis.reason}</p>}
            <Decision rec={cls} onDecide={(decision) => decide.mutate({ id: cls.id, decision })} />
          </div>
        )}
        {pr && (
          <div className=" border border-line p-4">
            <p className="text-xs text-slate">Priority</p>
            <p className="mt-0.5 font-medium capitalize">{pr.output.priority} <span className="num text-sm text-slate normal-case">· {pr.output.score} points</span></p>
            <ul className="mt-2 space-y-1 t-body-sm">
              {pr.output.reasons.map((r: any) => (
                <li key={r.factor} className={cn("flex gap-2", !r.points && "text-mute")}><span className="num w-7 shrink-0 text-right font-medium">+{r.points}</span><span>{r.factor}: {r.detail}</span></li>
              ))}
            </ul>
            <Decision rec={pr} onDecide={(decision) => decide.mutate({ id: pr.id, decision })} />
          </div>
        )}
      </div>

      <div className="mt-4">
        <h3 className="text-sm font-semibold">Possible duplicates nearby</h3>
        {d.duplicates.length === 0 ? <p className="mt-1 text-sm text-slate">None within 400 m with a similar description.</p> : (
          <ul className="mt-2 divide-y divide-line  border border-line">
            {d.duplicates.map((x) => (
              <li key={x.issue_id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/issues/${x.tracking_id}`} className="font-medium hover:text-ink">{x.title}</Link>
                  <p className="text-xs text-slate">{x.tracking_id} · {metres(x.distance_m)} · text {Math.round(x.signals.text_similarity * 100)}% · {x.signals.same_category ? "same category" : "different category"} · score {Math.round(x.score * 100)}</p>
                </div>
                <StatusChip status={x.status} size="sm" />
                {d.allowed_transitions.includes("rejected") && <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => setConfirmDup(x.tracking_id)}>Mark as duplicate</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Modal open={!!confirmDup} onOpenChange={(o) => !o && setConfirmDup(null)} title={`Duplicate of ${confirmDup}?`}
        description="This report will be closed with a public note pointing to the original, and the reporter will follow the original."
        footer={<><Button variant="ghost" onClick={() => setConfirmDup(null)}>Cancel</Button><Button loading={dup.isPending} onClick={() => { dup.mutate(confirmDup!); setConfirmDup(null); }}>Mark duplicate</Button></>}>
        <p className="text-sm text-slate">Only do this if you're confident both describe the same problem.</p>
      </Modal>
    </Panel>
  );
}

function Decision({ rec, onDecide }: { rec: { decision: string | null }; onDecide: (d: "accepted" | "overridden") => void }) {
  if (rec.decision) return <p className="mt-3 text-xs text-slate">Marked as {rec.decision}.</p>;
  return (
    <div className="mt-3 flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => onDecide("accepted")}>Agree</Button>
      <Button size="sm" variant="ghost" onClick={() => onDecide("overridden")}>Disagree</Button>
    </div>
  );
}
