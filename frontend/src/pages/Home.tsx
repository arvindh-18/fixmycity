import { animate, motion, useInView, useReducedMotion, useScroll, useTransform } from "motion/react";
import { Camera, MapPin, Plus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { AreaSearch, loadAreas } from "../components/AreaSearch";
import { IssueCard } from "../components/IssueCard";
import { StreetScene } from "../components/StreetScene";
import { api } from "../lib/api";
import type { Area, Issue, Stats } from "../lib/types";

function CountUp({ value, decimals = 0 }: { value: number; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!inView || !ref.current) return;
    if (reduce) return void (ref.current.textContent = value.toFixed(decimals));
    const c = animate(0, value, {
      duration: 1.1,
      ease: "easeOut",
      onUpdate: (v) => ref.current && (ref.current.textContent = v.toFixed(decimals)),
    });
    return () => c.stop();
  }, [inView, value, decimals, reduce]);
  return <span ref={ref}>0</span>;
}

const STEPS = [
  { title: "Take a photo", body: "Snap the pothole, garbage pile or dead streetlight — or pick a photo from your gallery." },
  { title: "Check the draft", body: "Gemini fills in the category, title and description. Tap the mic to add details in your own language." },
  { title: "Follow it until it's fixed", body: "Neighbours add a +1, city staff post updates, and you see every step on the report page." },
];

export default function Home() {
  const hero = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: hero, offset: ["start start", "end start"] });
  const reduce = useReducedMotion();
  const textY = useTransform(scrollYProgress, [0, 1], [0, reduce ? 0 : 120]);
  const textFade = useTransform(scrollYProgress, [0, 0.6], [1, reduce ? 1 : 0]);
  const navigate = useNavigate();

  const [stats, setStats] = useState<Stats | null>(null);
  const [latest, setLatest] = useState<Issue[]>([]);
  const [areas, setAreas] = useState<Area[]>([]);
  useEffect(() => {
    api<Stats>("/api/stats").then(setStats).catch(() => {});
    api<Issue[]>("/api/issues", { query: { limit: 4 } }).then(setLatest).catch(() => {});
    loadAreas(true).then((a) => setAreas(a.slice(0, 6)));
  }, []);

  const goArea = (a: { locality?: string; pincode?: string }) => {
    const q = new URLSearchParams();
    if (a.pincode) q.set("pincode", a.pincode);
    if (a.locality) q.set("locality", a.locality);
    navigate(`/issues?${q}`);
  };

  return (
    <>
      {/* ---- Hero ---------------------------------------------------------- */}
      <section
        ref={hero}
        className="relative h-[min(100svh,820px)] min-h-[640px] overflow-hidden"
        style={{ background: "linear-gradient(180deg, #E3EAEC 0%, #EEF2F1 55%, #F6F7F4 100%)" }}
      >
        <StreetScene progress={scrollYProgress} />
        <motion.div style={{ y: textY, opacity: textFade }} className="relative mx-auto max-w-6xl px-4 pt-28 sm:px-6 sm:pt-32">
          <h1 className="max-w-[15ch] text-[clamp(40px,6.2vw,80px)] font-extrabold">
            Spotted something broken on your street?
          </h1>
          <p className="mt-5 max-w-[46ch] text-[17px] text-ink-2 sm:text-lg">
            Take a photo. FixMyCity writes the report, pins it to your locality and pincode, and shows everyone when it
            gets fixed.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/report" className="btn-paint h-12 px-6 text-base">
              <Camera size={19} /> Report a problem
            </Link>
            <Link to="/issues" className="btn-ghost h-12 bg-white/70 px-6 text-base">
              <MapPin size={18} /> See reports near you
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ---- Area lookup --------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="text-[clamp(28px,4vw,40px)] font-bold">What's broken around you?</h2>
          <p className="mt-2 text-ink-2">Search your pincode or locality to see every report there and what's been fixed.</p>
          <div className="mt-6">
            <AreaSearch value={{}} onPick={goArea} size="lg" placeholder="Pincode or locality, e.g. 560038 or Indiranagar" />
          </div>
          {areas.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {areas.map((a) => (
                <button key={a.locality + a.pincode} className="chip" onClick={() => goArea(a)}>
                  {a.locality || a.pincode}
                  <span className="text-ink-3 tabular-nums">{a.pincode}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- How it works -------------------------------------------------- */}
      <section className="bg-ink text-white">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <h2 className="text-[clamp(28px,4vw,40px)] font-bold">A report in under a minute</h2>
          <ol className="mt-10 grid gap-10 sm:grid-cols-3 sm:gap-8">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-paint font-display text-lg font-extrabold text-ink">
                    {i + 1}
                  </span>
                  {i < STEPS.length - 1 && <span className="hidden h-px flex-1 bg-white/20 sm:block" />}
                </div>
                <h3 className="mt-4 text-xl font-bold">{s.title}</h3>
                <p className="mt-2 max-w-[34ch] text-white/70">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---- City numbers -------------------------------------------------- */}
      {stats && stats.total > 0 && (
        <section className="mx-auto max-w-6xl px-4 pt-16 sm:px-6 sm:pt-20">
          <div className="flex items-end justify-between gap-4">
            <h2 className="text-[clamp(28px,4vw,40px)] font-bold">Across the city</h2>
            <Link to="/stats" className="text-[15px] font-semibold text-civic hover:underline">All insights</Link>
          </div>
          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-4">
            {[
              { label: "Problems reported", v: stats.total },
              { label: "Being fixed now", v: stats.in_progress },
              { label: "Fixed", v: stats.resolved },
              { label: "Days to fix, on average", v: stats.avg_days_to_fix ?? 0, d: 1 },
            ].map((s) => (
              <div key={s.label} className="bg-white p-5 sm:p-6">
                <dd className="font-display text-[clamp(34px,4.5vw,52px)] font-extrabold tabular-nums leading-none">
                  <CountUp value={s.v} decimals={s.d} />
                </dd>
                <dt className="mt-2 text-sm text-ink-2">{s.label}</dt>
              </div>
            ))}
          </dl>
        </section>
      )}

      {/* ---- Latest -------------------------------------------------------- */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="flex items-end justify-between gap-4">
          <h2 className="text-[clamp(28px,4vw,40px)] font-bold">Just reported</h2>
          <Link to="/issues" className="text-[15px] font-semibold text-civic hover:underline">All reports</Link>
        </div>
        {latest.length ? (
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            {latest.map((i) => <IssueCard key={i.id} issue={i} />)}
          </div>
        ) : (
          <div className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line-2 p-10 text-center">
            <p className="text-ink-2">No reports yet. Be the first on your street.</p>
            <Link to="/report" className="btn-paint mt-4"><Plus size={18} /> Report a problem</Link>
          </div>
        )}
      </section>
    </>
  );
}
