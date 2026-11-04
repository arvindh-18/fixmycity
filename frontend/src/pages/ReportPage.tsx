import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { Check, Copy, KeyRound, Sparkles, ThumbsUp, Trash2 } from "lucide-react";
import { FramesArt } from "@/components/Art";
import { api } from "@/services/api";
import { useMeta } from "@/hooks/queries";
import { useAuth } from "@/contexts/AuthContext";
import type { DuplicateCandidate, IssueDetail } from "@/types";
import { Badge, Button, ErrorNote, Field, Input, Panel, Textarea } from "@/components/ui";
import { CategoryIcon, StatusChip } from "@/components/issue/bits";
import { Checkbox, Icon } from "@/design-system/Commons";
import { LocationPicker } from "@/components/map/LocationPicker";
import { IssueMap } from "@/components/map/IssueMap";
import { cn, metres } from "@/utils/format";

const STEPS = ["Describe", "Locate", "Photos", "Review"];

interface Classification { category_id: string | null; category_name: string | null; confidence: number; summary: string; detected_problem: string; mode: string; safety_flags: string[] }

export default function ReportPage() {
  const { data: meta } = useMeta();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [address, setAddress] = useState("");
  const [extra, setExtra] = useState("");
  const [photos, setPhotos] = useState<File[]>([]);
  const [confirmedLoc, setConfirmedLoc] = useState(false);
  const [result, setResult] = useState<{ tracking_id: string; anonymous_token: string | null; issue: IssueDetail } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // AI category suggestion (debounced) — the citizen always makes the final choice.
  const [debounced, setDebounced] = useState("");
  useEffect(() => { const t = setTimeout(() => setDebounced(`${title}\n${description}`), 600); return () => clearTimeout(t); }, [title, description]);
  const suggestion = useQuery({
    queryKey: ["classify", debounced], enabled: description.trim().length >= 15,
    queryFn: () => api.post<Classification>("/api/ai/classify", { title, description }),
  });

  // With a vision-capable AI provider, check what the first photo shows. Skipped in demonstration mode.
  const photoCheck = useQuery({
    queryKey: ["photo-check", photos[0]?.name, photos[0]?.size], enabled: meta?.ai.mode === "llm" && photos.length > 0 && description.trim().length >= 5,
    queryFn: () => { const fd = new FormData(); fd.append("title", title); fd.append("description", description); fd.append("photo", photos[0]);
      return api.post<Classification & { image_analysis: { status: string; observation?: string; matches_description?: boolean } }>("/api/ai/classify-photo", fd); },
    staleTime: Infinity, retry: false,
  });

  const dupQuery = useQuery({
    queryKey: ["dups", loc?.lat.toFixed(4), loc?.lng.toFixed(4), categoryId, debounced], enabled: !!loc && step >= 1,
    queryFn: () => api.post<DuplicateCandidate[]>("/api/issues/check-duplicates", { title, description, category_id: categoryId || null, lat: loc!.lat, lng: loc!.lng }),
  });

  const previews = useMemo(() => photos.map((f) => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach(URL.revokeObjectURL), [previews]);

  const submit = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append("title", title.trim());
      fd.append("description", description.trim());
      fd.append("category_id", categoryId);
      fd.append("lat", String(loc!.lat));
      fd.append("lng", String(loc!.lng));
      if (address) fd.append("address", address);
      if (extra) fd.append("additional_info", extra);
      photos.forEach((p) => fd.append("photos", p));
      return api.post<{ tracking_id: string; anonymous_token: string | null; issue: IssueDetail }>("/api/issues", fd);
    },
    onSuccess: setResult,
  });

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (title.trim().length < 5) e.title = "Give a short title of at least 5 characters.";
      if (description.trim().length < 15) e.description = "Describe the problem in at least 15 characters.";
      if (!categoryId) e.category = "Choose the category that fits best.";
    }
    if (s === 1 && !loc) e.loc = "Place the pin where the problem is.";
    if (s === 3 && !confirmedLoc) e.confirm = "Confirm the location is correct.";
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const next = () => validate(step) && setStep(step + 1);

  const addPhotos = (files: FileList | null) => {
    if (!files) return;
    const ok = Array.from(files).filter((f) => {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { toast.error(`${f.name}: use JPEG, PNG or WebP`); return false; }
      if (f.size > 8 * 1024 * 1024) { toast.error(`${f.name}: photos must be under 8 MB`); return false; }
      return true;
    });
    setPhotos((p) => [...p, ...ok].slice(0, 4));
  };

  if (result) return <Submitted result={result} />;
  const sel = meta?.categories.find((c) => c.id === categoryId);

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="t-h1">Report an issue</h1>
      <p className="t-body mt-2 text-slate">Tell us what you saw and where. We'll send it to the right department. {user ? `You're reporting as ${user.full_name}, so we'll keep you posted.` : <>You're reporting without an account. <Link to="/login" className="text-ink underline underline-offset-4 hover:text-teal">Sign in</Link> to get updates and confirm the fix.</>}</p>

      <ol className="mt-8 flex items-center gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className="flex flex-1 items-center gap-2">
            <span aria-current={i === step ? "step" : undefined} className={cn("t-label grid size-[22px] shrink-0 place-items-center rounded-full border-[1.5px]",
              i < step ? "border-ink bg-sage-200 text-ink" : i === step ? "border-ink bg-yellow-200 text-ink" : "border-line-2 bg-raised text-slate")}>
              {i < step ? "✓" : i + 1}
            </span>
            <span className={cn("t-label hidden sm:block", i === step ? "text-ink" : "text-slate")}>{s}</span>
            {i < STEPS.length - 1 && <span className={cn("h-0 flex-1 border-t-[1.5px]", i < step ? "border-ink" : "border-dashed border-line-2")} />}
          </li>
        ))}
      </ol>

      <Panel className="mt-6 p-6 sm:p-8">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15, ease: "easeOut" }} className="space-y-6">
            {step === 0 && (<>
              <Field label="Title" htmlFor="t" error={errors.title} hint="For example: Deep pothole outside the bus stop">
                <Input id="t" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={140} />
              </Field>
              <Field label="What's the problem?" htmlFor="d" error={errors.description} hint="What you see, how long it's been there, who it affects.">
                <Textarea id="d" value={description} onChange={(e) => setDescription(e.target.value)} rows={5} maxLength={5000} />
              </Field>
              {suggestion.data?.category_id && suggestion.data.category_id !== categoryId && (
                <div className="flex flex-wrap items-center gap-3 border-l-2 border-ink py-1 pl-4">
                  <Sparkles className="size-4 text-ink" />
                  <p className="t-body-sm flex-1 text-ink">
                    Looks like <strong>{suggestion.data.category_name}</strong>
                    <span className="text-slate"> · {Math.round(suggestion.data.confidence * 100)}% confidence{suggestion.data.mode === "rules" ? " (rule-based suggestion)" : ""}</span>
                  </p>
                  <Button size="sm" variant="secondary" onClick={() => setCategoryId(suggestion.data!.category_id!)}>Use this</Button>
                </div>
              )}
              <Field label="Category" error={errors.category}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {meta?.categories.map((c) => (
                    <button key={c.id} type="button" onClick={() => setCategoryId(c.id)} aria-pressed={categoryId === c.id}
                      className={cn("t-body-sm flex items-center gap-2 rounded-sm border px-3 py-2.5 text-left transition-colors duration-150",
                        categoryId === c.id ? "border-ink bg-ink text-paper" : "border-line-2 bg-raised hover:border-ink")}>
                      <CategoryIcon icon={c.icon} className="shrink-0" />{c.name}
                    </button>
                  ))}
                </div>
              </Field>
              {suggestion.data && suggestion.data.safety_flags.length > 0 && (
                <p className="t-body-sm border-l-2 border-ink pl-3 text-ink">⚠ If anyone is in danger right now, call 112 first. Commons isn't an emergency service.</p>
              )}
            </>)}

            {step === 1 && meta && (<>
              <Field label="Where is it?" error={errors.loc} hint="Drag the pin, tap the map, use your location or search.">
                <LocationPicker value={loc} center={meta.city} onChange={(v) => { setLoc({ lat: v.lat, lng: v.lng }); if (v.label && !address) setAddress(v.label.split(",").slice(0, 2).join(",")); }} />
              </Field>
              <Field label="Street or landmark" htmlFor="a" optional hint="Helps the field team find it quickly.">
                <Input id="a" value={address} onChange={(e) => setAddress(e.target.value)} maxLength={255} placeholder="e.g. 5th Main, opposite the post office" />
              </Field>
              <Duplicates items={dupQuery.data} onSupported={() => navigate("/me")} />
            </>)}

            {step === 2 && (<>
              <Field label="Photos" optional hint="Up to 4 photos (JPEG, PNG or WebP, 8 MB each). Location data inside photos is removed when uploaded.">
                <label className="flex cursor-pointer flex-col items-center justify-center gap-3 border-[1.5px] border-dashed border-ink bg-raised px-6 py-10 text-center transition-colors duration-150 hover:bg-sage-100"
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); addPhotos(e.dataTransfer.files); }}>
                  <Icon name="camera" size={64} />
                  <span className="t-label text-ink">Add a photo</span>
                  <span className="t-body-sm text-slate">Drop files here, or tap to take or choose one</span>
                  <input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" className="sr-only" onChange={(e) => addPhotos(e.target.files)} />
                </label>
              </Field>
              {previews.length > 0 && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {previews.map((src, i) => (
                    <div key={src} className="group relative overflow-hidden border-[1.5px] border-ink">
                      <img src={src} alt={`Photo ${i + 1}`} className="aspect-square w-full object-cover" />
                      <button onClick={() => setPhotos(photos.filter((_, j) => j !== i))} aria-label="Remove photo"
                        className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-sm border border-ink bg-paper text-ink hover:bg-paper-2"><Trash2 className="size-3.5" /></button>
                    </div>
                  ))}
                </div>
              )}
              {photoCheck.data?.image_analysis.status === "analysed" && (
                <div className="t-body-sm flex items-start gap-3 border-l-2 border-ink py-1 pl-4">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-ink" />
                  <p><span className="font-medium">Photo check:</span> {photoCheck.data.image_analysis.observation}
                    {!photoCheck.data.image_analysis.matches_description && <span className="block">⚠ The photo may not match your description. Check it before you send.</span>}</p>
                </div>
              )}
              {photoCheck.isFetching && <p className="text-xs text-slate">Checking the photo…</p>}
              <Field label="Anything else?" optional htmlFor="x">
                <Textarea id="x" value={extra} onChange={(e) => setExtra(e.target.value)} rows={3} maxLength={2000} placeholder="Best time to inspect, access notes, how many households are affected…" />
              </Field>
            </>)}

            {step === 3 && meta && loc && (<>
              <div>
                <h2 className="t-h2">{title}</h2>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-slate"><CategoryIcon icon={sel?.icon} />{sel?.name}</p>
                <p className="mt-3 t-body leading-relaxed whitespace-pre-line">{description}</p>
              </div>
              <div className="overflow-hidden border-[1.5px] border-ink">
                <IssueMap interactive={false} center={[loc.lng, loc.lat]} zoom={16.5} className="h-56 w-full"
                  issues={{ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Point", coordinates: [loc.lng, loc.lat] }, properties: { status: "submitted", priority: "high", support: 0 } }] }} />
                <div className="t-body-sm flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-3">
                  <span>{address || "No street given"} <span className="num text-mute">({loc.lat.toFixed(5)}, {loc.lng.toFixed(5)})</span></span>
                  <Button variant="link" onClick={() => setStep(1)}>Change</Button>
                </div>
              </div>
              <div>
                <Checkbox checked={confirmedLoc} onChange={(e) => setConfirmedLoc(e.target.checked)} label="The pin marks where the problem is" className="!t-body-sm !text-ink" />
                {errors.confirm && <p className="t-body-sm mt-1 text-danger" role="alert">⚠ {errors.confirm}</p>}
              </div>
              {photos.length > 0 && <p className="text-sm text-slate">{photos.length} photo{photos.length > 1 ? "s" : ""} attached.</p>}
              {!user && <p className="t-body-sm border-l-2 border-line pl-3 text-slate">We won't store your name or contact details. You'll get a private code to track this report, so keep it somewhere safe.</p>}
              <ErrorNote error={submit.error} />
            </>)}
          </motion.div>
        </AnimatePresence>

        <div className="mt-8 flex items-center justify-between border-t border-line pt-5">
          <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={step === 0}>Back</Button>
          {step < 3 ? <Button variant="primary" onClick={next}>Continue</Button> :
            <Button variant="primary" loading={submit.isPending} onClick={() => validate(3) && submit.mutate()}>Submit report</Button>}
        </div>
      </Panel>
    </div>
  );
}

function Duplicates({ items, onSupported }: { items?: DuplicateCandidate[]; onSupported: () => void }) {
  const { user } = useAuth();
  const [done, setDone] = useState<string | null>(null);
  const support = useMutation({
    mutationFn: (id: string) => api.post(`/api/issues/${id}/support`),
    onSuccess: (_, id) => { setDone(id); toast.success("Added your support to the existing report"); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (!items?.length) return null;
  return (
    <div className=" border border-ink bg-raised p-4">
      <h3 className="font-medium text-ink">Similar reports nearby</h3>
      <p className="mt-0.5 t-body-sm text-slate">If one of these is the same problem, supporting it is faster than a new report. Nothing is merged automatically.</p>
      <ul className="mt-3 space-y-2">
        {items.map((d) => (
          <li key={d.issue_id} className="flex flex-wrap items-center gap-3 rounded-md bg-surface px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <Link to={`/issues/${d.tracking_id}`} target="_blank" className="block truncate text-sm font-medium text-ink hover:text-ink">{d.title}</Link>
              <p className="text-xs text-slate">{metres(d.distance_m)} away · {d.category} · match {Math.round(d.score * 100)}%</p>
            </div>
            <StatusChip status={d.status} size="sm" />
            {user?.role === "citizen" && (done === d.issue_id ? <Badge tone="green"><Check className="size-3" />Supported</Badge> :
              <Button size="sm" variant="secondary" icon={<ThumbsUp className="size-3.5" />} loading={support.isPending && support.variables === d.issue_id} onClick={() => support.mutate(d.issue_id)}>Support instead</Button>)}
          </li>
        ))}
      </ul>
      {done && <Button variant="link" className="mt-3" onClick={onSupported}>Go to my reports</Button>}
    </div>
  );
}

function Submitted({ result }: { result: { tracking_id: string; anonymous_token: string | null } }) {
  const copy = (t: string) => navigator.clipboard?.writeText(t).then(() => toast.success("Copied"));
  return (
    <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
      <FramesArt icon="megaphone" className="mx-auto w-48" />
      <h1 className="t-h1 mt-10">Thanks. Your report is <em>in</em>.</h1>
      <p className="t-body mt-3 text-slate">It's on the public record now. Next, an official checks it and sends it to the right department.</p>
      <Panel className="mt-10 border-x-0 border-b-0 border-t-[1.5px] border-t-ink p-0 pt-6 text-left">
        <p className="text-sm text-slate">Tracking ID</p>
        <div className="mt-1 flex items-center justify-between gap-3">
          <p className="num t-h1">{result.tracking_id}</p>
          <Button variant="secondary" size="sm" icon={<Copy className="size-4" />} onClick={() => copy(result.tracking_id)}>Copy</Button>
        </div>
        {result.anonymous_token && (
          <div className="mt-6 border-l-2 border-ink pl-4">
            <p className="flex items-center gap-2 text-sm font-medium text-ink"><KeyRound className="size-4 text-ink" />Your private tracking code</p>
            <p className="mt-1 t-body-sm text-slate">This is shown only once. With it you can open your report's private view from any device.</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="t-body-sm flex-1 overflow-x-auto border border-line-2 bg-raised px-3 py-2">{result.anonymous_token}</code>
              <Button variant="secondary" size="sm" onClick={() => copy(result.anonymous_token!)}>Copy</Button>
            </div>
          </div>
        )}
      </Panel>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link to={`/issues/${result.tracking_id}`}><Button variant="primary">Follow your report</Button></Link>
        <Link to="/report" reloadDocument><Button variant="quiet">Report another</Button></Link>
      </div>
    </div>
  );
}

