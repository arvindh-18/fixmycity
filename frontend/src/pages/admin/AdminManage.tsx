import { Fragment, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, Lock, Pencil, Plus } from "lucide-react";
import { api } from "@/services/api";
import { useAuth } from "@/contexts/AuthContext";
import { useMeta } from "@/hooks/queries";
import type { Commitment, Expenditure, User } from "@/types";
import { Badge, Button, DemoBadge, EmptyState, ErrorNote, Field, Input, Modal, Panel, Segmented, Select, Skeleton, Textarea } from "@/components/ui";
import { ago, cn, fmtDate, fmtDateTime, money } from "@/utils/format";

function useInvalidate() { const qc = useQueryClient(); return (...keys: string[][]) => keys.forEach((k) => qc.invalidateQueries({ queryKey: k })); }

// ================================================================== Workers
type Worker = User & { employee_code: string | null; skills: string | null; active_tasks: number; completed_tasks: number };

export function AdminWorkers() {
  const { user } = useAuth();
  const { data: meta } = useMeta();
  const inv = useInvalidate();
  const workers = useQuery({ queryKey: ["admin", "workers", "all"], queryFn: () => api.get<Worker[]>("/api/admin/workers") });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ full_name: "", email: "", phone: "", password: "", department_id: user?.department?.id ?? "", employee_code: "", skills: "" });
  const create = useMutation({
    mutationFn: () => api.post("/api/admin/workers", { ...f, phone: f.phone || null, skills: f.skills || null }),
    onSuccess: () => { toast.success("Worker account created"); setOpen(false); inv(["admin", "workers"]); },
  });
  const toggle = useMutation({ mutationFn: (w: Worker) => api.post(`/api/admin/workers/${w.id}/active?active=${!w.is_active}`), onSuccess: () => inv(["admin", "workers"]) });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="t-h1">Field workers</h1><p className="text-sm text-slate">Workload is shown for planning, not as a performance ranking.</p></div>
        <Button icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>Add worker</Button>
      </div>
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-paper/60"><tr className="border-b border-line text-left text-xs text-slate">
            <th className="px-4 py-2.5 font-medium">Name</th><th className="px-3 font-medium">Department</th><th className="px-3 font-medium">Code</th>
            <th className="px-3 text-right font-medium">Active tasks</th><th className="px-3 text-right font-medium">Completed</th><th className="px-4 text-right font-medium">Account</th></tr></thead>
          <tbody>
            {workers.isLoading && <tr><td colSpan={6} className="p-4"><Skeleton className="h-24" /></td></tr>}
            {workers.data?.map((w) => (
              <tr key={w.id} className={cn("border-b border-line last:border-0", !w.is_active && "opacity-60")}>
                <td className="px-4 py-2.5"><p className="font-medium">{w.full_name}</p><p className="text-xs text-slate">{w.email}</p></td>
                <td className="px-3">{w.department?.name}</td><td className="num px-3 text-slate">{w.employee_code}</td>
                <td className="num px-3 text-right">{w.active_tasks}</td><td className="num px-3 text-right">{w.completed_tasks}</td>
                <td className="px-4 text-right"><Button size="sm" variant={w.is_active ? "ghost" : "secondary"} onClick={() => toggle.mutate(w)}>{w.is_active ? "Deactivate" : "Reactivate"}</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Modal open={open} onOpenChange={setOpen} title="Add a field worker" description="They'll sign in with this email and password. Ask them to keep it private."
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button loading={create.isPending} onClick={() => create.mutate()}>Create account</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name"><Input value={f.full_name} onChange={set("full_name")} /></Field>
          <Field label="Employee code"><Input value={f.employee_code} onChange={set("employee_code")} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone" optional><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Department"><Select value={f.department_id} onChange={set("department_id")} disabled={!!user?.department}><option value="">Choose</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Temporary password"><Input type="text" value={f.password} onChange={set("password")} /></Field>
          <div className="sm:col-span-2"><Field label="Skills" optional><Input value={f.skills} onChange={set("skills")} placeholder="e.g. Asphalt patching, drainage" /></Field></div>
          <div className="sm:col-span-2"><ErrorNote error={create.error} /></div>
        </div>
      </Modal>
    </div>
  );
}

// ================================================================== Departments, categories, SLA
interface Dept { id: string; name: string; code: string; description: string | null; contact_email: string | null; workers: number }
interface Cat { id: string; name: string; slug: string; icon: string; description: string | null; keywords: string[]; is_active: boolean; default_department_id: string | null }
interface Sla { id: string; category_id: string | null; category: string; priority: string; response_hours: number; resolution_hours: number; warning_threshold: number; is_active: boolean }

export function AdminSetup() {
  const { user } = useAuth();
  const cityAdmin = !user?.department;
  const [tab, setTab] = useState<"sla" | "categories" | "departments">("sla");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="t-h1">Departments &amp; SLAs</h1><p className="text-sm text-slate">Every change here is written to the audit log.</p></div>
        <Segmented value={tab} onChange={setTab} options={[{ value: "sla", label: "Service levels" }, { value: "categories", label: "Categories" }, { value: "departments", label: "Departments" }]} />
      </div>
      {!cityAdmin && <p className="flex items-center gap-2 rounded-md bg-paper-2 px-3 py-2 text-sm text-slate"><Lock className="size-4" />Only city-wide administrators can change these settings.</p>}
      {tab === "sla" && <SlaEditor readOnly={!cityAdmin} />}
      {tab === "categories" && <Categories readOnly={!cityAdmin} />}
      {tab === "departments" && <Departments readOnly={!cityAdmin} />}
    </div>
  );
}

function SlaEditor({ readOnly }: { readOnly: boolean }) {
  const { data: meta } = useMeta();
  const inv = useInvalidate();
  const rules = useQuery({ queryKey: ["admin", "sla"], queryFn: () => api.get<Sla[]>("/api/admin/sla") });
  const [edit, setEdit] = useState<Partial<Sla> | null>(null);
  const save = useMutation({
    mutationFn: () => api.post("/api/admin/sla", { category_id: edit!.category_id || null, priority: edit!.priority, response_hours: Number(edit!.response_hours), resolution_hours: Number(edit!.resolution_hours), warning_threshold: Number(edit!.warning_threshold ?? 0.75), is_active: edit!.is_active ?? true }),
    onSuccess: () => { toast.success("Rule saved. It applies to issues verified from now on."); setEdit(null); inv(["admin", "sla"]); },
  });
  return (
    <Panel className="p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p className="max-w-2xl text-sm text-slate">The most specific rule wins: category + priority, then all categories + priority. Issues without a matching rule never show as overdue. Admins are warned when the set share of the window has passed.</p>
        {!readOnly && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ priority: "medium", response_hours: 24, resolution_hours: 168, warning_threshold: 0.75, category_id: null })}>Add rule</Button>}
      </div>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-line text-left text-xs text-slate"><th className="py-2 font-medium">Applies to</th><th className="font-medium">Priority</th><th className="text-right font-medium">Respond within</th><th className="text-right font-medium">Resolve within</th><th className="text-right font-medium">Warn at</th><th /></tr></thead>
        <tbody>{rules.data?.map((r) => (
          <tr key={r.id} className="border-b border-line last:border-0">
            <td className="py-2.5">{r.category}</td><td className="capitalize">{r.priority}</td>
            <td className="num text-right">{r.response_hours} h</td><td className="num text-right">{r.resolution_hours} h <span className="text-mute">({(r.resolution_hours / 24).toFixed(1)} d)</span></td>
            <td className="num text-right">{Math.round(r.warning_threshold * 100)}%</td>
            <td className="text-right">{!readOnly && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(r)}>Edit</Button>}</td>
          </tr>))}</tbody>
      </table>
      <Modal open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? "Edit SLA rule" : "New SLA rule"}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save rule</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Category"><Select value={edit.category_id ?? ""} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, category_id: e.target.value || null })}><option value="">All categories</option>{meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field>
          <Field label="Priority"><Select value={edit.priority} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, priority: e.target.value })}>{["critical", "high", "medium", "low"].map((p) => <option key={p}>{p}</option>)}</Select></Field>
          <Field label="Respond within (hours)"><Input type="number" min={1} value={edit.response_hours} onChange={(e) => setEdit({ ...edit, response_hours: +e.target.value })} /></Field>
          <Field label="Resolve within (hours)"><Input type="number" min={1} value={edit.resolution_hours} onChange={(e) => setEdit({ ...edit, resolution_hours: +e.target.value })} /></Field>
          <Field label="Warn when this share has passed"><Select value={String(edit.warning_threshold)} onChange={(e) => setEdit({ ...edit, warning_threshold: +e.target.value })}>{[0.5, 0.6, 0.75, 0.9].map((v) => <option key={v} value={v}>{v * 100}%</option>)}</Select></Field>
          <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
        </div>}
      </Modal>
    </Panel>
  );
}

function Categories({ readOnly }: { readOnly: boolean }) {
  const { data: meta } = useMeta();
  const inv = useInvalidate();
  const cats = useQuery({ queryKey: ["admin", "categories"], queryFn: () => api.get<Cat[]>("/api/admin/categories") });
  const [edit, setEdit] = useState<Partial<Cat> & { kw?: string } | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const body = { name: edit!.name, description: edit!.description || null, icon: edit!.icon || "circle-help", keywords: (edit!.kw ?? "").split(",").map((s) => s.trim()).filter(Boolean), default_department_id: edit!.default_department_id || null, is_active: edit!.is_active ?? true };
      return edit!.id ? api.put(`/api/admin/categories/${edit!.id}`, body) : api.post("/api/admin/categories", body);
    },
    onSuccess: () => { toast.success("Category saved"); setEdit(null); inv(["admin", "categories"], ["meta"]); },
  });
  const deptName = (id: string | null) => meta?.departments.find((d) => d.id === id)?.name ?? "—";
  return (
    <Panel className="p-5">
      <div className="mb-3 flex justify-between"><p className="text-sm text-slate">Keywords drive the rule-based category suggestion.</p>{!readOnly && <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({ kw: "", is_active: true })}>Add category</Button>}</div>
      <div className="divide-y divide-line">
        {cats.data?.map((c) => (
          <div key={c.id} className="flex flex-wrap items-start gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">{c.name} {!c.is_active && <Badge>Hidden</Badge>}</p>
              <p className="text-xs text-slate">Routes to {deptName(c.default_department_id)}</p>
              <p className="mt-1 text-xs text-mute">{c.keywords.join(", ")}</p>
            </div>
            {!readOnly && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit({ ...c, kw: c.keywords.join(", ") })}>Edit</Button>}
          </div>
        ))}
      </div>
      <Modal open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? "Edit category" : "New category"}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        {edit && <div className="space-y-3">
          <Field label="Name"><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Default department"><Select value={edit.default_department_id ?? ""} onChange={(e) => setEdit({ ...edit, default_department_id: e.target.value || null })}><option value="">None</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Keywords" hint="Comma-separated."><Textarea value={edit.kw} onChange={(e) => setEdit({ ...edit, kw: e.target.value })} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={edit.is_active ?? true} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} className="accent-[var(--ink)]" />Shown to citizens</label>
          <ErrorNote error={save.error} />
        </div>}
      </Modal>
    </Panel>
  );
}

function Departments({ readOnly }: { readOnly: boolean }) {
  const inv = useInvalidate();
  const depts = useQuery({ queryKey: ["admin", "departments"], queryFn: () => api.get<Dept[]>("/api/admin/departments") });
  const [edit, setEdit] = useState<Partial<Dept> | null>(null);
  const save = useMutation({
    mutationFn: () => { const b = { name: edit!.name, code: edit!.code, description: edit!.description || null, contact_email: edit!.contact_email || null }; return edit!.id ? api.put(`/api/admin/departments/${edit!.id}`, b) : api.post("/api/admin/departments", b); },
    onSuccess: () => { toast.success("Department saved"); setEdit(null); inv(["admin", "departments"], ["meta"]); },
  });
  return (
    <Panel className="p-5">
      {!readOnly && <div className="mb-3 flex justify-end"><Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit({})}>Add department</Button></div>}
      <div className="divide-y divide-line">
        {depts.data?.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="flex-1"><p className="font-medium">{d.name} <span className="text-xs text-slate">{d.code}</span></p><p className="text-xs text-slate">{d.description}</p></div>
            <span className="text-sm text-slate">{d.workers} workers</span>
            {!readOnly && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(d)}>Edit</Button>}
          </div>
        ))}
      </div>
      <Modal open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? "Edit department" : "New department"}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="Code" hint="Capitals, e.g. RDI"><Input value={edit.code ?? ""} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} /></Field>
          <div className="sm:col-span-2"><Field label="Description" optional><Input value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Contact email" optional><Input type="email" value={edit.contact_email ?? ""} onChange={(e) => setEdit({ ...edit, contact_email: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
        </div>}
      </Modal>
    </Panel>
  );
}

// ================================================================== Public content
export function AdminPublish() {
  const [tab, setTab] = useState<"announcements" | "commitments" | "spending">("announcements");
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="t-h1">Public content</h1><p className="text-sm text-slate">Everything published here appears on the transparency dashboard.</p></div>
        <Segmented value={tab} onChange={setTab} options={[{ value: "announcements", label: "Announcements" }, { value: "commitments", label: "Commitments" }, { value: "spending", label: "Expenditure" }]} />
      </div>
      {tab === "announcements" && <Announcements />}
      {tab === "commitments" && <Commitments />}
      {tab === "spending" && <Spending />}
    </div>
  );
}

function Announcements() {
  const { data: meta } = useMeta();
  const inv = useInvalidate();
  const [f, setF] = useState({ title: "", body: "", department_id: "", locality_id: "", is_pinned: false });
  const list = useQuery({ queryKey: ["announcements"], queryFn: () => api.get<any[]>("/api/announcements") });
  const m = useMutation({
    mutationFn: () => api.post("/api/admin/announcements", { ...f, department_id: f.department_id || null, locality_id: f.locality_id || null }),
    onSuccess: () => { toast.success("Published and sent to residents"); setF({ title: "", body: "", department_id: "", locality_id: "", is_pinned: false }); inv(["announcements"]); },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Panel className="space-y-3 p-5">
        <h2 className="font-semibold">New announcement</h2>
        <Field label="Title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={200} /></Field>
        <Field label="Message"><Textarea value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} maxLength={5000} /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Department" optional><Select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">—</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Locality" optional><Select value={f.locality_id} onChange={(e) => setF({ ...f, locality_id: e.target.value })}><option value="">City-wide</option>{meta?.localities.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.is_pinned} onChange={(e) => setF({ ...f, is_pinned: e.target.checked })} className="accent-[var(--ink)]" />Pin to the top</label>
        <ErrorNote error={m.error} />
        <Button disabled={f.title.length < 3 || f.body.length < 3} loading={m.isPending} onClick={() => m.mutate()}>Publish announcement</Button>
      </Panel>
      <Panel className="divide-y divide-line">
        {list.data?.map((a) => <div key={a.id} className="p-4"><p className="font-medium">{a.title}</p><p className="text-xs text-slate">{fmtDate(a.created_at)} {a.is_pinned && "· pinned"}</p><p className="mt-1 line-clamp-2 text-sm text-slate">{a.body}</p></div>)}
      </Panel>
    </div>
  );
}

function Commitments() {
  const { data: meta } = useMeta();
  const inv = useInvalidate();
  const list = useQuery({ queryKey: ["commitments"], queryFn: () => api.get<Commitment[]>("/api/commitments") });
  const blank = { title: "", description: "", department_id: "", locality_id: "", expected_completion: "", progress_percent: 0, status: "planned", evidence_url: "", progress_note: "" };
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null);
  const save = useMutation({
    mutationFn: () => {
      const b = { ...edit!, locality_id: edit!.locality_id || null, evidence_url: edit!.evidence_url || null, progress_note: edit!.progress_note || null, progress_percent: Number(edit!.progress_percent) };
      delete (b as any).id;
      return edit!.id ? api.put(`/api/admin/commitments/${edit!.id}`, b) : api.post("/api/admin/commitments", b);
    },
    onSuccess: () => { toast.success("Commitment saved"); setEdit(null); inv(["commitments"]); },
  });
  return (
    <Panel className="p-5">
      <div className="mb-3 flex justify-end"><Button size="sm" icon={<Plus className="size-4" />} onClick={() => setEdit(blank)}>Publish commitment</Button></div>
      <div className="divide-y divide-line">
        {list.data?.map((c) => (
          <div key={c.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1"><p className="font-medium">{c.title} {c.is_demo && <DemoBadge />}</p><p className="text-xs text-slate">{c.department.name} · due {fmtDate(c.expected_completion)} · {c.status.replace("_", " ")}</p></div>
            <span className="num w-12 text-right text-sm font-semibold">{c.progress_percent}%</span>
            <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit({ id: c.id, title: c.title, description: c.description, department_id: c.department.id, locality_id: c.locality?.id ?? "", expected_completion: c.expected_completion, progress_percent: c.progress_percent, status: c.status, evidence_url: c.evidence_url ?? "", progress_note: c.progress_note ?? "" })}>Update</Button>
          </div>
        ))}
      </div>
      <Modal open={!!edit} onOpenChange={(o) => !o && setEdit(null)} title={edit?.id ? "Update commitment" : "New public commitment"}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field label="Title"><Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Description"><Textarea value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></Field></div>
          <Field label="Department"><Select value={edit.department_id} onChange={(e) => setEdit({ ...edit, department_id: e.target.value })}><option value="">Choose</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Locality" optional><Select value={edit.locality_id} onChange={(e) => setEdit({ ...edit, locality_id: e.target.value })}><option value="">City-wide</option>{meta?.localities.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Expected completion"><Input type="date" value={edit.expected_completion} onChange={(e) => setEdit({ ...edit, expected_completion: e.target.value })} /></Field>
          <Field label="Status"><Select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{["planned", "in_progress", "completed", "delayed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</Select></Field>
          <Field label={`Progress: ${edit.progress_percent}%`}><input type="range" min={0} max={100} step={5} value={edit.progress_percent} onChange={(e) => setEdit({ ...edit, progress_percent: +e.target.value })} className="w-full accent-[var(--ink)]" /></Field>
          <Field label="Evidence link" optional><Input value={edit.evidence_url} onChange={(e) => setEdit({ ...edit, evidence_url: e.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label="Progress note" optional><Input value={edit.progress_note} onChange={(e) => setEdit({ ...edit, progress_note: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
        </div>}
      </Modal>
    </Panel>
  );
}

function Spending() {
  const { data: meta } = useMeta();
  const inv = useInvalidate();
  const list = useQuery({ queryKey: ["expenditures"], queryFn: () => api.get<Expenditure[]>("/api/expenditures") });
  const [f, setF] = useState({ department_id: "", work_description: "", estimated_cost: "", actual_cost: "", verification_status: "unverified", source_document_url: "" });
  const m = useMutation({
    mutationFn: () => api.post("/api/admin/expenditures", { ...f, estimated_cost: Number(f.estimated_cost), actual_cost: f.actual_cost ? Number(f.actual_cost) : null, source_document_url: f.source_document_url || null }),
    onSuccess: () => { toast.success("Expenditure recorded"); setF({ ...f, work_description: "", estimated_cost: "", actual_cost: "", source_document_url: "" }); inv(["expenditures"]); },
  });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
      <Panel className="space-y-3 p-5">
        <h2 className="font-semibold">Record expenditure</h2>
        <p className="text-xs text-slate">Only enter figures from official records. "Verified" requires a link to the source document.</p>
        <Field label="Department"><Select value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })}><option value="">Choose</option>{meta?.departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
        <Field label="Work description"><Input value={f.work_description} onChange={(e) => setF({ ...f, work_description: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Estimated (₹)"><Input type="number" min={0} value={f.estimated_cost} onChange={(e) => setF({ ...f, estimated_cost: e.target.value })} /></Field>
          <Field label="Actual (₹)" optional><Input type="number" min={0} value={f.actual_cost} onChange={(e) => setF({ ...f, actual_cost: e.target.value })} /></Field>
        </div>
        <Field label="Verification"><Select value={f.verification_status} onChange={(e) => setF({ ...f, verification_status: e.target.value })}><option value="unverified">Unverified</option><option value="verified">Verified (source required)</option></Select></Field>
        <Field label="Source document link" optional={f.verification_status !== "verified"}><Input value={f.source_document_url} onChange={(e) => setF({ ...f, source_document_url: e.target.value })} /></Field>
        <ErrorNote error={m.error} />
        <Button loading={m.isPending} disabled={!f.department_id || !f.work_description || !f.estimated_cost} onClick={() => m.mutate()}>Record</Button>
      </Panel>
      <Panel className="divide-y divide-line">
        {list.data?.length === 0 && <EmptyState art="inbox" title="Nothing recorded" />}
        {list.data?.map((e) => (
          <div key={e.id} className="flex items-start justify-between gap-3 p-4 text-sm">
            <div><p className="font-medium">{e.work_description}</p><p className="text-xs text-slate">{e.department.name}</p></div>
            <div className="text-right"><p className="num">{money(e.estimated_cost)}</p><div className="mt-1 flex justify-end gap-1">{e.verification_status === "verified" ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">Unverified</Badge>}{e.is_demo && <DemoBadge />}</div></div>
          </div>
        ))}
      </Panel>
    </div>
  );
}

// ================================================================== Review & moderation
interface PendingSummary { id: string; kind: string; body: string; public_summary: string | null; summary_source: string | null; author: string | null; created_at: string; issue: { tracking_id: string; title: string } }
interface Flagged { id: string; body: string; author: string; reports: number; reasons: string[]; is_hidden: boolean; reviewed: boolean; created_at: string; issue: { tracking_id: string; title: string } }

export function AdminModeration() {
  const inv = useInvalidate();
  const summaries = useQuery({ queryKey: ["admin", "summaries"], queryFn: () => api.get<PendingSummary[]>("/api/admin/summaries") });
  const flagged = useQuery({ queryKey: ["admin", "moderation"], queryFn: () => api.get<Flagged[]>("/api/admin/moderation") });
  const [edits, setEdits] = useState<Record<string, string>>({});
  const decide = useMutation({
    mutationFn: ({ id, approve }: { id: string; approve: boolean }) => api.post(`/api/admin/updates/${id}/summary`, { approve, edited_summary: edits[id] ?? null }),
    onSuccess: (_, v) => { toast.success(v.approve ? "Published to the public trail" : "Kept internal"); inv(["admin"]); },
  });
  const moderate = useMutation({
    mutationFn: ({ id, hide }: { id: string; hide: boolean }) => api.post(`/api/admin/comments/${id}/moderate`, { hide, reason: hide ? "Removed by a moderator for breaking discussion rules" : null }),
    onSuccess: () => inv(["admin"]),
  });
  return (
    <div className="space-y-8">
      <section>
        <h1 className="t-h1">Review &amp; moderation</h1>
        <h2 className="mt-6 font-semibold">Worker updates waiting for a public summary</h2>
        <p className="text-sm text-slate">Worker notes stay internal. Approve (or edit) the plain-language version before it appears on the public trail.</p>
        <div className="mt-3 space-y-3">
          {summaries.data?.length === 0 && <Panel><EmptyState art="check" title="All caught up" /></Panel>}
          {summaries.data?.map((s) => (
            <Panel key={s.id} className="p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm"><Link className="font-medium hover:text-ink" to={`/admin/issues/${s.issue.tracking_id}`}>{s.issue.tracking_id}</Link><span className="text-slate">{s.issue.title}</span><span className="ml-auto text-xs text-mute">{s.author} · {ago(s.created_at)}</span></div>
              <p className="mt-2 rounded bg-paper px-3 py-2 text-sm"><span className="text-xs text-slate">Worker note ({s.kind.replace("_", " ")}): </span>{s.body}</p>
              <Field label={`Public summary (${s.summary_source === "llm" ? "AI draft" : "rule-based draft"})`}>
                <Textarea className="min-h-16" value={edits[s.id] ?? s.public_summary ?? ""} onChange={(e) => setEdits({ ...edits, [s.id]: e.target.value })} />
              </Field>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="accent" onClick={() => decide.mutate({ id: s.id, approve: true })}>Approve &amp; publish</Button>
                <Button size="sm" variant="ghost" onClick={() => decide.mutate({ id: s.id, approve: false })}>Keep internal</Button>
              </div>
            </Panel>
          ))}
        </div>
      </section>
      <section>
        <h2 className="font-semibold">Reported comments</h2>
        <Panel className="mt-3 divide-y divide-line">
          {flagged.data?.length === 0 && <EmptyState art="check" title="No reported comments" />}
          {flagged.data?.map((c) => (
            <div key={c.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm">{c.body}</p>
                <p className="mt-1 text-xs text-slate">{c.author} on {c.issue.tracking_id} · {c.reports} report{c.reports > 1 ? "s" : ""}: {c.reasons.join("; ")}</p>
              </div>
              {c.is_hidden ? <Badge tone="red">Hidden{c.reviewed ? "" : " (auto)"}</Badge> : <Badge>Visible</Badge>}
              <Button size="sm" variant={c.is_hidden ? "secondary" : "danger"} onClick={() => moderate.mutate({ id: c.id, hide: !c.is_hidden })}>{c.is_hidden ? "Restore" : "Hide"}</Button>
            </div>
          ))}
        </Panel>
      </section>
    </div>
  );
}

// ================================================================== Audit log
interface AuditRow { id: number; at: string; actor: string; actor_role: string; action: string; entity_type: string; entity_id: string | null; tracking_id: string | null; old: any; new: any; reason: string | null; ip: string | null }

export function AdminAudit() {
  const [issue, setIssue] = useState("");
  const [action, setAction] = useState("");
  const [page, setPage] = useState(1);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const q = useQuery({ queryKey: ["admin", "audit", issue, action, page], queryFn: () => api.get<{ total: number; items: AuditRow[] }>("/api/admin/audit", { issue: issue || undefined, action: action || undefined, page, page_size: 50 }) });
  return (
    <div className="space-y-4">
      <div>
        <h1 className="t-h1">Audit log</h1>
        <p className="flex items-center gap-1.5 text-sm text-slate"><Lock className="size-4" />Append-only. The database rejects any edit or deletion of these records — including by administrators.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Input className="h-9 w-56" placeholder="Tracking ID" value={issue} onChange={(e) => { setIssue(e.target.value.toUpperCase()); setPage(1); }} />
        <Select className="h-9 w-60" value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
          <option value="">All actions</option>
          {["issue.", "issue.status_changed", "issue.assigned", "evidence.", "sla.", "ai.", "comment.", "worker.", "user.", "category.", "department.", "expenditure.", "commitment.", "summary."].map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
      </div>
      <ErrorNote error={q.error} />
      <Panel className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-paper/60"><tr className="border-b border-line text-left text-xs text-slate">
            <th className="w-6" /><th className="px-3 py-2.5 font-medium">#</th><th className="px-3 font-medium">When</th><th className="px-3 font-medium">Who</th><th className="px-3 font-medium">Action</th><th className="px-3 font-medium">Issue</th><th className="px-3 font-medium">Change</th></tr></thead>
          <tbody>
            {q.data?.items.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer border-b border-line hover:bg-paper/60" onClick={() => setOpenRow(openRow === r.id ? null : r.id)}>
                  <td className="pl-3 text-mute">{openRow === r.id ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</td>
                  <td className="num px-3 py-2 text-xs text-mute">{r.id}</td>
                  <td className="px-3 text-xs whitespace-nowrap">{fmtDateTime(r.at)}</td>
                  <td className="px-3"><span className="font-medium">{r.actor}</span> <span className="text-xs text-slate">{r.actor_role}</span></td>
                  <td className="px-3"><code className="rounded bg-paper-2 px-1.5 py-0.5 text-xs">{r.action}</code></td>
                  <td className="px-3">{r.tracking_id ? <Link onClick={(e) => e.stopPropagation()} to={`/admin/issues/${r.tracking_id}`} className="num text-ink underline underline-offset-4 hover:text-ink">{r.tracking_id}</Link> : <span className="text-mute">—</span>}</td>
                  <td className="max-w-xs truncate px-3 text-xs text-slate">{r.old?.status && r.new?.status ? `${r.old.status} → ${r.new.status}` : r.reason ?? ""}</td>
                </tr>
                {openRow === r.id && (
                  <tr className="border-b border-line bg-paper/40"><td colSpan={7} className="px-10 py-3">
                    <div className="grid gap-3 text-xs md:grid-cols-3">
                      <div><p className="mb-1 font-semibold">Previous value</p><pre className="overflow-x-auto rounded bg-surface p-2">{r.old ? JSON.stringify(r.old, null, 2) : "—"}</pre></div>
                      <div><p className="mb-1 font-semibold">New value</p><pre className="overflow-x-auto rounded bg-surface p-2">{r.new ? JSON.stringify(r.new, null, 2) : "—"}</pre></div>
                      <div><p className="mb-1 font-semibold">Context</p><p>Reason: {r.reason ?? "—"}</p><p>Entity: {r.entity_type} {r.entity_id}</p><p>IP: {r.ip ?? "—"}</p></div>
                    </div>
                  </td></tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="flex items-center justify-between text-sm text-slate">
        <span className="num">{q.data?.total ?? 0} entries</span>
        <div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Newer</Button><Button size="sm" variant="secondary" disabled={!q.data || page * 50 >= q.data.total} onClick={() => setPage(page + 1)}>Older</Button></div>
      </div>
    </div>
  );
}
