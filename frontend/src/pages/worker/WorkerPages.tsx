import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  ArrowLeft, Camera, CheckCircle2, Hand, MessageSquare, Navigation, PackageOpen, Pause, Play, Send, Star, TriangleAlert, Wrench,
} from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMeta } from "@/hooks/queries";
import type { Assignment, Evidence, IssueCard, IssueDetail } from "@/types";
import { Badge, Button, EmptyState, ErrorNote, Field, Modal, Panel, Segmented, Skeleton, Textarea } from "@/components/ui";
import { CategoryIcon, PriorityTag, SLAMeter, StatusChip } from "@/components/issue/bits";
import { EvidenceCompare } from "@/components/issue/EvidenceCompare";
import { IssueMap } from "@/components/map/IssueMap";
import { ago, cn, fmtDate, fmtDateTime } from "@/utils/format";
import { PRIORITY } from "@/utils/status";

type Task = { assignment: Assignment; issue: IssueCard };
interface WStats { new: number; in_progress: number; on_hold: number; awaiting_verification: number; overdue: number; completed: number; resolved: number; by_priority: Record<string, number>; feedback_avg: number | null; feedback_count: number }

const useTasks = () => useQuery({ queryKey: ["tasks"], queryFn: () => api.get<Task[]>("/api/worker/tasks"), refetchInterval: 60_000 });

export function WorkerHome() {
  const { user } = useAuth();
  const tasks = useTasks();
  const stats = useQuery({ queryKey: ["tasks", "stats"], queryFn: () => api.get<WStats>("/api/worker/stats") });
  const [tab, setTab] = useState<"todo" | "waiting">("todo");
  const active = (tasks.data ?? []).filter((t) => t.assignment.is_active);
  const todo = active.filter((t) => t.issue.status !== "awaiting_verification")
    .sort((a, b) => (PRIORITY[b.issue.priority ?? "low"].weight - PRIORITY[a.issue.priority ?? "low"].weight) || (new Date(a.assignment.due_at ?? 0).getTime() - new Date(b.assignment.due_at ?? 0).getTime()));
  const waiting = active.filter((t) => t.issue.status === "awaiting_verification");
  const s = stats.data;
  return (
    <div className="px-4 py-5">
      <p className="text-sm text-slate">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</p>
      <h1 className="t-h1">Hi {user?.full_name.split(" ")[0]}</h1>
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Tile n={s?.new} label="New" tone="teal" />
        <Tile n={s?.in_progress} label="On site" tone="orange" />
        <Tile n={s?.on_hold} label="On hold" tone="amber" />
        <Tile n={s?.overdue} label="Overdue" tone="red" />
      </div>
      {s && Object.keys(s.by_priority).length > 0 && (
        <div className="mt-3 flex h-2 border border-line bg-raised" aria-label="Priority mix">
          {(["critical", "high", "medium", "low"] as const).map((p) => s.by_priority[p] ? <div key={p} className={PRIORITY[p].dot} style={{ flex: s.by_priority[p] }} title={`${PRIORITY[p].label}: ${s.by_priority[p]}`} /> : null)}
        </div>
      )}
      <div className="mt-6"><Segmented value={tab} onChange={setTab} className="w-full [&>button]:flex-1" options={[{ value: "todo", label: "To do", count: todo.length }, { value: "waiting", label: "Waiting for check", count: waiting.length }]} /></div>
      <div className="mt-3 space-y-3">
        {tasks.isLoading && [1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)}
        {(tab === "todo" ? todo : waiting).map((t, i) => <TaskCard key={t.assignment.id} t={t} i={i} />)}
        {!tasks.isLoading && (tab === "todo" ? todo : waiting).length === 0 && (
          <EmptyState art="check" title={tab === "todo" ? "No open tasks" : "Nothing waiting"} body={tab === "todo" ? "New assignments will appear here and you'll get a notification." : "Completed work waiting for citizen or admin verification shows here."} />
        )}
      </div>
    </div>
  );
}

function Tile({ n, label, tone }: { n?: number; label: string; tone: "teal" | "orange" | "amber" | "red" }) {
  const c = { teal: "text-ink", orange: "text-orange", amber: "text-amber", red: "text-red" }[tone];
  return <div className=" border border-line bg-surface px-2 py-2.5 text-center"><p className={cn("num t-h2 leading-none", n ? c : "text-mute")}>{n ?? "–"}</p><p className="mt-1 text-[11px] text-slate">{label}</p></div>;
}

function TaskCard({ t, i }: { t: Task; i: number }) {
  const due = t.assignment.due_at ? new Date(t.assignment.due_at) : null;
  const overdue = due && due < new Date();
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
      <Link to={`/worker/tasks/${t.issue.id}`} className="block  border border-line bg-surface p-4  active:scale-[0.99]">
        <div className="flex items-center justify-between gap-2">
          <PriorityTag priority={t.issue.priority} />
          {!t.assignment.acknowledged_at ? <Badge tone="teal">New</Badge> : <StatusChip status={t.issue.status} size="sm" />}
        </div>
        <h3 className="mt-2 t-body font-semibold text-ink">{t.issue.title}</h3>
        <p className="mt-0.5 flex items-center gap-1.5 t-body-sm text-slate"><CategoryIcon icon={t.issue.category?.icon} />{t.issue.address ?? t.issue.locality?.name}</p>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="num text-mute">{t.issue.tracking_id}</span>
          {due && <span className={cn("font-medium", overdue ? "text-red" : "text-slate")}>{overdue ? "Overdue · " : "Due "}{fmtDateTime(t.assignment.due_at)}</span>}
        </div>
      </Link>
    </motion.div>
  );
}

export function WorkerMap() {
  const tasks = useTasks();
  const { data: meta } = useMeta();
  const navigate = useNavigate();
  const fc = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: (tasks.data ?? []).filter((t) => t.assignment.is_active).map((t) => ({
      type: "Feature", geometry: { type: "Point", coordinates: [t.issue.lng, t.issue.lat] },
      properties: { tracking_id: t.issue.tracking_id, title: t.issue.title, status: t.issue.status, priority: t.issue.priority ?? "medium", support: t.issue.support_count, category: t.issue.category?.name ?? "" },
    })),
  }), [tasks.data]);
  const first = fc.features[0]?.geometry.coordinates as [number, number] | undefined;
  if (!meta) return <Skeleton className="h-[70vh]" />;
  return (
    <div className="h-[calc(100dvh-8.5rem)]">
      <IssueMap issues={fc} center={first ?? [meta.city.lng, meta.city.lat]} zoom={12.5} className="h-full w-full" onSelectIssue={(tid) => { const t = tasks.data?.find((x) => x.issue.tracking_id === tid); if (t) navigate(`/worker/tasks/${t.issue.id}`); }} />
    </div>
  );
}

export function WorkerHistory() {
  const tasks = useTasks();
  const stats = useQuery({ queryKey: ["tasks", "stats"], queryFn: () => api.get<WStats>("/api/worker/stats") });
  const done = (tasks.data ?? []).filter((t) => t.assignment.completed_at || !t.assignment.is_active);
  return (
    <div className="px-4 py-5">
      <h1 className="t-h1">Work history</h1>
      {stats.data && (
        <Panel className="mt-4 grid grid-cols-3 divide-x divide-line">
          <div className="p-3 text-center"><p className="num text-xl font-semibold">{stats.data.completed}</p><p className="text-[11px] text-slate">Completed</p></div>
          <div className="p-3 text-center"><p className="num text-xl font-semibold">{stats.data.resolved}</p><p className="text-[11px] text-slate">Confirmed fixed</p></div>
          <div className="p-3 text-center"><p className="num flex items-center justify-center gap-1 text-xl font-semibold">{stats.data.feedback_avg?.toFixed(1) ?? "—"}<Star className="size-4 fill-amber text-amber" /></p><p className="text-[11px] text-slate">{stats.data.feedback_count} citizen ratings</p></div>
        </Panel>
      )}
      <p className="mt-2 text-xs text-slate">Personal record only. Jobs differ in size, so there is no leaderboard.</p>
      <div className="mt-4 space-y-2">
        {done.map((t) => (
          <Link key={t.assignment.id} to={`/worker/tasks/${t.issue.id}`} className="flex items-center gap-3  border border-line bg-surface p-3">
            <CategoryIcon icon={t.issue.category?.icon} className="text-slate" />
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{t.issue.title}</p><p className="text-xs text-slate">{t.assignment.completed_at ? `Completed ${fmtDate(t.assignment.completed_at)}` : "Reassigned"}</p></div>
            <StatusChip status={t.issue.status} size="sm" />
          </Link>
        ))}
        {done.length === 0 && !tasks.isLoading && <EmptyState art="inbox" title="No completed work yet" />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ task detail
type TaskDetail = IssueDetail & { assignment: Assignment; allowed_transitions: string[]; evidence: Evidence[];
  updates: { id: string; kind: string; body: string; summary_status: string; public_summary: string | null; created_at: string }[] };

const UPDATE_KINDS = [
  { v: "progress", label: "Progress", icon: Wrench },
  { v: "obstacle", label: "Obstacle", icon: TriangleAlert },
  { v: "resource_request", label: "Need materials", icon: PackageOpen },
  { v: "assistance_request", label: "Need help", icon: Hand },
] as const;

export function WorkerTask() {
  const { issueId = "" } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const key = ["task", issueId];
  const q = useQuery({ queryKey: key, queryFn: () => api.get<TaskDetail>(`/api/worker/tasks/${issueId}`) });
  const [dialog, setDialog] = useState<null | "pause" | "update" | "complete">(null);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<(typeof UPDATE_KINDS)[number]["v"]>("progress");
  const [photo, setPhoto] = useState<File | null>(null);
  const [before, setBefore] = useState<File[]>([]);
  const [after, setAfter] = useState<File[]>([]);
  const [notes, setNotes] = useState("");

  const done = (data: TaskDetail | unknown, msg: string) => {
    if (data && (data as TaskDetail).id) qc.setQueryData(key, data);
    else qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["tasks"] });
    setDialog(null); setText(""); setPhoto(null); setBefore([]); setAfter([]); setNotes("");
    toast.success(msg);
  };
  const act = useMutation({
    mutationFn: async (which: "ack" | "start" | "pause" | "update" | "complete") => {
      const base = `/api/worker/tasks/${issueId}`;
      if (which === "ack") return [await api.post(`${base}/acknowledge`), "Acknowledged — the admin and reporter can see it"] as const;
      if (which === "start") return [await api.post(`${base}/start`), "Status: in progress"] as const;
      if (which === "pause") return [await api.post(`${base}/pause`, { reason: text }), "Paused — reason recorded"] as const;
      if (which === "update") {
        const fd = new FormData(); fd.append("kind", kind); fd.append("body", text); if (photo) fd.append("photo", photo);
        return [await api.post(`${base}/updates`, fd), "Update sent to the admin"] as const;
      }
      const fd = new FormData(); fd.append("description", text); if (notes) fd.append("work_notes", notes);
      before.forEach((f) => fd.append("before", f)); after.forEach((f) => fd.append("after", f));
      return [await api.post(`${base}/complete`, fd), "Evidence submitted. Waiting for verification."] as const;
    },
    onSuccess: ([data, msg]) => done(data, msg),
  });
  const chat = useMutation({
    mutationFn: () => api.post<{ id: string }>("/api/conversations", { issue_id: issueId, kind: "admin_worker", first_message: `Question about ${d?.tracking_id}` }),
    onSuccess: (c) => navigate(`/worker/messages/${c.id}`), onError: (e: Error) => toast.error(e.message),
  });

  const d = q.data;
  if (q.isError) return <div className="p-4"><ErrorNote error={q.error} /></div>;
  if (!d) return <div className="space-y-3 p-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-60" /></div>;
  const a = d.assignment;
  const can = (s: string) => d.allowed_transitions.includes(s);
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${d.lat},${d.lng}`;

  return (
    <div className="pb-6">
      <div className="px-4 pt-4">
        <Link to="/worker" className="inline-flex items-center gap-1 text-sm text-slate"><ArrowLeft className="size-4" />Tasks</Link>
        <div className="mt-3 flex flex-wrap items-center gap-2"><StatusChip status={d.status} /><PriorityTag priority={d.priority} /></div>
        <h1 className="mt-2 t-h1">{d.title}</h1>
        <p className="num mt-1 text-xs text-slate">{d.tracking_id} · assigned {ago(a.created_at)}</p>
      </div>

      {/* Primary action — one big, obvious button for the current step */}
      {a.is_active && (
        <div className="sticky top-14 z-10 mt-4 border-y border-line bg-paper/95 px-4 py-3 backdrop-blur">
          {!a.acknowledged_at ? <Button size="lg" variant="accent" className="w-full" loading={act.isPending} icon={<CheckCircle2 className="size-5" />} onClick={() => act.mutate("ack")}>Acknowledge assignment</Button>
            : can("in_progress") ? <Button size="lg" variant="accent" className="w-full" loading={act.isPending} icon={<Play className="size-5" />} onClick={() => act.mutate("start")}>{d.status === "assigned" ? "Start work" : "Resume work"}</Button>
            : d.status === "in_progress" ? <Button size="lg" variant="accent" className="w-full" icon={<Camera className="size-5" />} onClick={() => setDialog("complete")}>Submit completion evidence</Button>
            : d.status === "awaiting_verification" ? <p className="text-center text-sm text-violet">Evidence submitted. Waiting for the reporter or an admin to verify.</p>
            : <p className="text-center text-sm text-slate">No action needed right now.</p>}
          {d.status === "in_progress" && (
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button variant="secondary" icon={<Send className="size-4" />} onClick={() => setDialog("update")}>Post update</Button>
              <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => setDialog("pause")}>Pause</Button>
            </div>
          )}
          {(d.status === "assigned" || d.status === "on_hold") && a.acknowledged_at && <Button variant="ghost" className="mt-2 w-full" icon={<Send className="size-4" />} onClick={() => setDialog("update")}>Report obstacle or request materials</Button>}
        </div>
      )}
      {!a.is_active && <p className="mx-4 mt-4 rounded-md bg-paper-2 px-3 py-2 text-sm text-slate">This task is no longer assigned to you. Shown for your records.</p>}

      <div className="space-y-4 px-4 pt-4">
        <Panel className="p-4">
          <SLAMeter sla={d.sla} />
          {a.due_at && <p className="mt-2 text-xs text-slate">Your target: {fmtDateTime(a.due_at)}</p>}
        </Panel>
        {a.instructions && <Panel className="border-ink bg-raised p-4"><p className="text-xs font-semibold text-ink">Instructions from admin</p><p className="mt-1 t-body">{a.instructions}</p></Panel>}
        <Panel className="p-4">
          <p className="t-body leading-relaxed">{d.description}</p>
          {d.images.length > 0 && <div className="mt-3 flex gap-2 overflow-x-auto">{d.images.map((im) => <a key={im.id} href={im.url} target="_blank" rel="noreferrer"><img src={im.url} alt="Citizen photo" className="h-24 w-32 shrink-0 rounded-md object-cover" /></a>)}</div>}
        </Panel>
        <Panel className="overflow-hidden">
          <IssueMap interactive={false} center={[d.lng, d.lat]} zoom={16} className="h-44 w-full"
            issues={{ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [d.lng, d.lat] }, properties: { status: d.status, priority: d.priority ?? "medium", support: 0 } }] }} />
          <div className="flex items-center justify-between gap-2 p-3">
            <p className="text-sm">{d.address ?? "Pinned location"}</p>
            <a href={navUrl} target="_blank" rel="noreferrer"><Button size="sm" icon={<Navigation className="size-4" />}>Navigate</Button></a>
          </div>
        </Panel>
        <Button variant="secondary" className="w-full" icon={<MessageSquare className="size-4" />} loading={chat.isPending} onClick={() => chat.mutate()}>Message the admin</Button>

        {d.updates.length > 0 && (
          <Panel className="p-4">
            <h2 className="mb-2 text-sm font-semibold">Your updates</h2>
            <ul className="space-y-3">{d.updates.map((u) => (
              <li key={u.id} className="text-sm">
                <p className="text-xs text-slate">{u.kind.replace("_", " ")} · {ago(u.created_at)} · {u.summary_status === "approved" ? <span className="text-green">public summary published</span> : u.summary_status === "pending" ? "summary awaiting admin" : "internal"}</p>
                <p>{u.body}</p>
              </li>))}</ul>
          </Panel>
        )}
        {d.evidence.map((e) => <Panel key={e.id} className="p-4"><EvidenceCompare evidence={e} /></Panel>)}
      </div>

      <Modal open={dialog === "pause"} onOpenChange={(o) => !o && setDialog(null)} title="Pause work" description="The reason is recorded on the issue's trail."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={text.trim().length < 3} loading={act.isPending} onClick={() => act.mutate("pause")}>Pause</Button></>}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Waiting for materials, heavy rain, access blocked" />
        <ErrorNote error={act.error} className="mt-2" />
      </Modal>

      <Modal open={dialog === "update"} onOpenChange={(o) => !o && setDialog(null)} title="Post an update" description="Goes to the admin. A plain-language summary is drafted and published only after admin approval."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button disabled={text.trim().length < 3} loading={act.isPending} onClick={() => act.mutate("update")}>Send update</Button></>}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {UPDATE_KINDS.map((k) => (
              <button key={k.v} type="button" onClick={() => setKind(k.v)} className={cn("flex items-center gap-2 rounded-md border px-3 py-2.5 text-sm", kind === k.v ? "border-ink bg-ink text-paper" : "border-line-2")}>
                <k.icon className="size-4" />{k.label}
              </button>
            ))}
          </div>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="What's happening on site?" />
          <PhotoInput label="Add a photo" files={photo ? [photo] : []} onChange={(f) => setPhoto(f[0] ?? null)} />
          <ErrorNote error={act.error} />
        </div>
      </Modal>

      <Modal open={dialog === "complete"} onOpenChange={(o) => !o && setDialog(null)} title="Submit completion evidence"
        description="The issue moves to 'awaiting verification'. It closes only when the reporter or an admin confirms."
        footer={<><Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button><Button variant="accent" disabled={text.trim().length < 10 || after.length === 0} loading={act.isPending} onClick={() => act.mutate("complete")}>Submit evidence</Button></>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <PhotoInput label="Before" files={before} multiple onChange={setBefore} />
            <PhotoInput label="After (required)" files={after} multiple onChange={setAfter} />
          </div>
          <Field label="What was done?" hint="At least 10 characters. Shown publicly."><Textarea value={text} onChange={(e) => setText(e.target.value)} /></Field>
          <Field label="Work notes" optional hint="Internal: materials, measurements."><Textarea className="min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <ErrorNote error={act.error} />
        </div>
      </Modal>
    </div>
  );
}

function PhotoInput({ label, files, onChange, multiple }: { label: string; files: File[]; onChange: (f: File[]) => void; multiple?: boolean }) {
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files]);
  return (
    <label className="block cursor-pointer">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      <div className="grid min-h-24 place-items-center overflow-hidden rounded-md border-2 border-dashed border-line-2 bg-paper/50">
        {urls.length ? <div className="flex flex-wrap gap-1 p-1">{urls.map((u) => <img key={u} src={u} alt="" className="size-16 rounded object-cover" />)}</div>
          : <span className="flex flex-col items-center gap-1 text-xs text-slate"><Camera className="size-5" />Take or choose</span>}
      </div>
      <input type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple={multiple} className="sr-only"
        onChange={(e) => onChange(Array.from(e.target.files ?? []).slice(0, 4))} />
    </label>
  );
}
