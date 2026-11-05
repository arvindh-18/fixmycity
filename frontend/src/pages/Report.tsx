import { ImagePlus, LocateFixed, RefreshCw, Search, Sparkles, ThumbsUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { loadAreas } from "../components/AreaSearch";
import { PinPicker } from "../components/IssueMap";
import { CategoryIcon, Spinner, StatusPill, useToast } from "../components/ui";
import { VOICE_LANGS, VoiceButton } from "../components/VoiceButton";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { shrinkImage } from "../lib/image";
import type { AiDraft, Issue, Severity } from "../lib/types";

type Place = { address: string; locality: string; pincode: string };

const SEVERITIES: { id: Severity; label: string }[] = [
  { id: "low", label: "Can wait" },
  { id: "medium", label: "Fix soon" },
  { id: "high", label: "Dangerous" },
];

export default function Report() {
  const { config } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const fileInput = useRef<HTMLInputElement>(null);

  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [ai, setAi] = useState<"idle" | "reading" | "done" | "error" | "not_civic">("idle");
  const [aiMsg, setAiMsg] = useState("");

  const [category, setCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("medium");
  const [lang, setLang] = useState("en-IN");
  const voiceBase = useRef<string | null>(null);

  const city = config?.city ?? { lat: 13.0827, lng: 80.2707, name: "Chennai" };
  const [pos, setPos] = useState<[number, number]>([city.lat, city.lng]);
  const [pinMoved, setPinMoved] = useState(false);
  const [place, setPlace] = useState<Place>({ address: "", locality: "", pincode: "" });
  const [locating, setLocating] = useState(false);
  const [lookingUp, setLookingUp] = useState(false);
  const [nearby, setNearby] = useState<Issue[]>([]);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ label: string; lat: number; lng: number }[]>([]);
  const [searching, setSearching] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  // Update default coordinates when config loads if the user hasn't moved the pin
  useEffect(() => {
    if (!pinMoved && config?.city) {
      setPos([config.city.lat, config.city.lng]);
    }
  }, [config, pinMoved]);

  // Try the device location once.
  useEffect(() => {
    locate(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function movePin(lat: number, lng: number) {
    setPos([lat, lng]);
    setPinMoved(true);
  }

  function locate(silent = false) {
    if (!navigator.geolocation) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        movePin(p.coords.latitude, p.coords.longitude);
        setLocating(false);
      },
      () => {
        setLocating(false);
        if (!silent) toast("Location is blocked. Drag the pin or search for the place instead.", "err");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  }

  // Pin → locality + pincode (OpenStreetMap), and nearby open reports.
  useEffect(() => {
    if (!pinMoved) return;
    setLookingUp(true);
    const t = setTimeout(() => {
      api<Place>("/api/geo/reverse", { query: { lat: pos[0], lng: pos[1] } })
        .then(setPlace)
        .catch(() => {})
        .finally(() => setLookingUp(false));
    }, 450);
    return () => clearTimeout(t);
  }, [pos, pinMoved]);

  useEffect(() => {
    if (!pinMoved) return;
    const t = setTimeout(() => {
      api<Issue[]>("/api/issues/nearby", { query: { lat: pos[0], lng: pos[1], category } })
        .then(setNearby)
        .catch(() => setNearby([]));
    }, 450);
    return () => clearTimeout(t);
  }, [pos, pinMoved, category]);

  async function readPhoto(blob: Blob, note = description) {
    if (!config?.ai_enabled) return;
    setAi("reading");
    setAiMsg("");
    try {
      const fd = new FormData();
      fd.append("photo", blob, "photo.jpg");
      fd.append("note", note);
      const d = await api<AiDraft>("/api/ai/analyze", { body: fd });
      setCategory(d.category);
      setTitle(d.title);
      setSeverity(d.severity);
      setDescription((cur) => (cur.trim() ? cur : d.description));
      if (!d.is_civic_issue) {
        setAi("not_civic");
      } else setAi("done");
    } catch (e) {
      setAi("error");
      setAiMsg((e as Error).message);
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choose an image file (JPG, PNG or WebP).", "err");
    const small = await shrinkImage(file);
    setPhoto(small);
    setPreview(URL.createObjectURL(small));
    readPhoto(small);
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setSearching(true);
    try {
      const r = await api<typeof results>("/api/geo/search", { query: { q } });
      setResults(r);
      if (!r.length) toast("No place found with that name. Try a landmark or road name.", "err");
    } finally {
      setSearching(false);
    }
  }

  async function upvote(issue: Issue) {
    try {
      const r = await api<{ upvotes: number; upvoted: boolean }>(`/api/issues/${issue.id}/upvote`, { method: "POST" });
      setNearby((n) => n.map((x) => (x.id === issue.id ? { ...x, ...r } : x)));
      if (r.upvoted) toast("Added your +1. That pushes it up the list for city staff.");
    } catch (e) {
      toast((e as Error).message, "err");
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!category) return setError("Pick what kind of problem this is.");
    if (title.trim().length < 3) return setError("Give the report a short title.");
    if (!pinMoved) return setError("Set the location: drag the pin, tap the map, or use your location.");
    setSubmitting(true);
    try {
      const fd = new FormData();
      Object.entries({
        title, category, description, severity, lat: pos[0], lng: pos[1],
        address: place.address, locality: place.locality, pincode: place.pincode,
      }).forEach(([k, v]) => fd.append(k, String(v)));
      if (photo) fd.append("photo", photo, "photo.jpg");
      const issue = await api<Issue>("/api/issues", { body: fd });
      loadAreas(true);
      toast("Report submitted. You can follow it here.");
      navigate(`/issues/${issue.id}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  }

  const reading = ai === "reading";

  return (
    <form onSubmit={submit} className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="text-[clamp(30px,4.5vw,44px)] font-extrabold">Report a problem</h1>
      <p className="mt-2 text-ink-2">
        {config?.ai_enabled
          ? "Start with a photo — Gemini will draft the report for you to check."
          : "Add a photo, say what's wrong and drop a pin."}
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_minmax(0,460px)]">
        {/* ---- Left: photo + details ---- */}
        <div className="space-y-7">
          <section>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              capture="environment"
              className="sr-only"
              onChange={(e) => onFile(e.target.files?.[0])}
              aria-label="Photo of the problem"
            />
            {preview ? (
              <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-white">
                <img src={preview} alt="Your photo" className="max-h-[420px] w-full object-cover" />
                <div className="absolute right-3 top-3 flex gap-2">
                  {config?.ai_enabled && photo && (
                    <button type="button" onClick={() => readPhoto(photo)} disabled={reading} className="btn btn-sm bg-white/90 text-ink backdrop-blur">
                      <RefreshCw size={15} /> Re-read
                    </button>
                  )}
                  <button type="button" onClick={() => fileInput.current?.click()} className="btn btn-sm bg-white/90 text-ink backdrop-blur">
                    Change photo
                  </button>
                </div>
                {reading && (
                  <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-ink/80 px-4 py-3 text-sm font-medium text-white">
                    <Sparkles size={16} className="text-paint" /> Gemini is reading your photo…
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => (e.preventDefault(), onFile(e.dataTransfer.files?.[0]))}
                className="flex w-full flex-col items-center justify-center gap-3 rounded-[var(--radius-card)] border-2 border-dashed border-line-2 bg-white px-6 py-14 text-center transition hover:border-civic"
              >
                <span className="flex size-14 items-center justify-center rounded-full bg-paint text-ink">
                  <ImagePlus size={26} />
                </span>
                <span className="text-lg font-semibold">Take or upload a photo</span>
                <span className="text-sm text-ink-3">JPG, PNG or WebP. A clear, close photo helps the crew find it.</span>
              </button>
            )}
            {ai === "done" && (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-2">
                <Sparkles size={15} className="text-civic" /> Filled in from your photo. Check and edit anything that's off.
              </p>
            )}
            {ai === "not_civic" && (
              <p className="mt-3 rounded-xl bg-st-open-soft px-4 py-3 text-sm text-ink">
                This photo doesn't look like a street or public problem. You can still submit it, or choose a clearer photo.
              </p>
            )}
            {ai === "error" && (
              <p className="mt-3 rounded-xl bg-st-closed-soft px-4 py-3 text-sm text-ink-2">
                Couldn't auto-fill from the photo ({aiMsg}). Fill in the details below.
              </p>
            )}
          </section>

          <section>
            <span className="label">What kind of problem?</span>
            <div className="flex flex-wrap gap-2">
              {config?.categories.map((c) =>
                reading ? (
                  <span key={c.id} className="shimmer h-9 w-28" />
                ) : (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={category === c.id}
                    onClick={() => setCategory(c.id)}
                    className="chip"
                  >
                    <CategoryIcon category={c.id} size={16} />
                    {c.label}
                  </button>
                ),
              )}
            </div>
          </section>

          <section>
            <label htmlFor="title" className="label">Title</label>
            {reading ? (
              <div className="shimmer h-11" />
            ) : (
              <input
                id="title"
                className="field"
                value={title}
                maxLength={140}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Deep pothole in front of the bus stop"
              />
            )}
          </section>

          <section>
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label htmlFor="desc" className="text-sm font-semibold">Description</label>
              <div className="ml-auto flex items-center gap-2">
                <select
                  value={lang}
                  onChange={(e) => setLang(e.target.value)}
                  className="h-9 rounded-full border border-line-2 bg-white px-3 text-sm"
                  aria-label="Voice language"
                >
                  {VOICE_LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                </select>
                <VoiceButton
                  lang={lang}
                  aiEnabled={!!config?.ai_enabled}
                  onText={(text, final) => {
                    if (voiceBase.current === null) voiceBase.current = description.trim() ? description.trimEnd() + " " : "";
                    setDescription(voiceBase.current + text);
                    if (final) voiceBase.current = null;
                  }}
                  onError={(m) => toast(m, "err")}
                />
              </div>
            </div>
            {reading ? (
              <div className="shimmer h-28" />
            ) : (
              <textarea
                id="desc"
                rows={4}
                className="field resize-y"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What's wrong, how big is it, since when? Tap Speak to say it instead."
              />
            )}
          </section>

          <section>
            <span className="label">How urgent?</span>
            <div className="inline-flex rounded-full border border-line-2 bg-white p-1">
              {SEVERITIES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={severity === s.id}
                  onClick={() => setSeverity(s.id)}
                  className={`h-9 rounded-full px-4 text-sm font-semibold transition ${
                    severity === s.id ? (s.id === "high" ? "bg-danger text-white" : "bg-ink text-white") : "text-ink-2"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </section>
        </div>

        {/* ---- Right: location ---- */}
        <aside className="lg:sticky lg:top-24 lg:self-start space-y-4">
          <div className="flex items-center justify-between">
            <span className="label !mb-0">Where is it?</span>
            <button type="button" onClick={() => locate()} className="btn-ghost btn-sm" disabled={locating}>
              {locating ? <Spinner size={15} /> : <LocateFixed size={16} />} Use my location
            </button>
          </div>

          <div className="relative">
            <div className="flex items-center gap-2 rounded-full border border-line-2 bg-white pl-4 pr-1.5 h-11 focus-within:border-civic">
              <Search size={17} className="text-ink-3" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && search(e)}
                placeholder="Search a landmark or road"
                className="min-w-0 flex-1 bg-transparent outline-none text-[15px]"
                aria-label="Search for a place"
              />
              <button type="button" onClick={search} className="btn-ink btn-sm h-8" disabled={searching}>
                {searching ? <Spinner size={14} /> : "Find"}
              </button>
            </div>
            {results.length > 0 && (
              <ul className="absolute z-[1200] mt-2 w-full rounded-2xl border border-line bg-white py-1 shadow-[var(--shadow-lift)]">
                {results.map((r) => (
                  <li key={r.label}>
                    <button
                      type="button"
                      onClick={() => (movePin(r.lat, r.lng), setResults([]), setQ(""))}
                      className="block w-full px-4 py-2.5 text-left text-sm hover:bg-chalk"
                    >
                      {r.label}
                    </button>
                  </li>
                ))}
                <li className="border-t border-line">
                  <button type="button" onClick={() => setResults([])} className="flex w-full items-center gap-1 px-4 py-2 text-sm text-ink-3">
                    <X size={14} /> Close
                  </button>
                </li>
              </ul>
            )}
          </div>

          <div className="h-[320px] overflow-hidden rounded-[var(--radius-card)] border border-line sm:h-[380px]">
            <PinPicker pos={pos} onChange={movePin} nearby={nearby} />
          </div>
          <p className="text-sm text-ink-3">Drag the pin or tap the map to put it exactly on the problem.</p>

          <div className="grid grid-cols-[1fr_120px] gap-3">
            <div>
              <label htmlFor="loc" className="label">Locality</label>
              <input id="loc" className="field" value={place.locality} placeholder={lookingUp ? "Looking up…" : "e.g. Indiranagar"}
                onChange={(e) => setPlace({ ...place, locality: e.target.value })} />
            </div>
            <div>
              <label htmlFor="pin" className="label">Pincode</label>
              <input id="pin" className="field tabular-nums" inputMode="numeric" maxLength={6} value={place.pincode}
                placeholder={lookingUp ? "…" : "560038"} onChange={(e) => setPlace({ ...place, pincode: e.target.value.replace(/\D/g, "") })} />
            </div>
          </div>

          {nearby.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-paint bg-[#FDF7E3] p-4">
              <p className="font-semibold">Already reported here?</p>
              <p className="text-sm text-ink-2">
                {nearby.length === 1 ? "There's an open report" : `There are ${nearby.length} open reports`} within 150 m. If it's
                the same problem, add a +1 instead.
              </p>
              <ul className="mt-3 space-y-2">
                {nearby.map((n) => (
                  <li key={n.id} className="flex items-center gap-3 rounded-xl bg-white p-2.5">
                    <CategoryIcon category={n.category} className="shrink-0 text-ink-3" />
                    <Link to={`/issues/${n.id}`} target="_blank" className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{n.title}</span>
                      <span className="flex items-center gap-2 text-xs text-ink-3">
                        <StatusPill status={n.status} /> {n.distance_m} m away
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => upvote(n)}
                      className={`btn btn-sm shrink-0 ${n.upvoted ? "bg-civic text-white" : "bg-civic-soft text-civic"}`}
                    >
                      <ThumbsUp size={14} /> {n.upvotes}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </aside>
      </div>

      <div className="mt-10 flex flex-col-reverse items-stretch gap-3 border-t border-line pt-6 sm:flex-row sm:items-center">
        {error && <p className="text-sm font-medium text-danger sm:mr-auto" role="alert">{error}</p>}
        <button type="submit" disabled={submitting || reading} className="btn-paint h-12 px-8 text-base sm:ml-auto">
          {submitting ? <Spinner /> : null} Submit report
        </button>
      </div>
    </form>
  );
}
