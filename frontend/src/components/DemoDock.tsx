import { Code2, Compass, FlaskConical, HardHat, LocateFixed, ShieldCheck, User, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { homeFor, useAuth } from "../lib/auth";
import { setDemoRealGps } from "../lib/location";
import type { DemoPersona, Role } from "../lib/types";
import { Spinner, useToast } from "./ui";

const OPEN_KEY = "fmc_demo_dock";
const ROLE_ICON: Record<Role, typeof User> = { public: User, worker: HardHat, admin: ShieldCheck };
const ROLE_TAG: Record<Role, string> = { public: "Resident", worker: "Field worker", admin: "City admin" };
const ROLE_TONE: Record<Role, string> = {
  public: "bg-civic-soft text-civic",
  worker: "bg-paint/40 text-ink",
  admin: "bg-ink text-white",
};

/** Guided steps. Each one switches to the right persona (if needed) and opens the right screen. */
const TOUR: { title: string; body: string; as?: string; to: string }[] = [
  { title: "1 · See problems near the college", body: "You-are-here map around Saveetha Engineering College, closest first.", to: "/issues?near=1" },
  { title: "2 · Report in your own language", body: "Type or speak in தமிழ் / हिन्दी. AI fills the form.", as: "priya", to: "/report" },
  { title: "3 · Follow your report", body: "Priya's reports: timeline, who's responsible, chat with the worker.", as: "priya", to: "/issues?mine=1" },
  { title: "4 · Fix it as a field worker", body: "Ravi's jobs: start work, then mark fixed with an after photo.", as: "ravi", to: "/worker" },
  { title: "5 · Run the ward as admin", body: "Assign jobs, see what's waiting longest.", as: "meena", to: "/admin" },
  { title: "6 · Merge duplicates", body: "Same problem reported twice? Keep one, merge the other.", as: "meena", to: "/admin/duplicates" },
  { title: "7 · Proof of work, in public", body: "Reported vs fixed by week, and before/after photos.", to: "/stats" },
];

function usePersona() {
  const { signInToken, config } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState("");
  async function become(p: DemoPersona, to?: string) {
    setBusy(p.token);
    try {
      const me = await signInToken(p.token);
      navigate(to ?? homeFor(me.role));
      toast(`You're now ${p.name} (${ROLE_TAG[p.role]}).`);
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setBusy("");
    }
  }
  const byUid = (uid: string) => config?.demo?.personas.find((p) => p.token.split(":")[1] === uid);
  return { become, busy, byUid };
}

/** Top strip on every page of the demo build. */
export function DemoBanner() {
  const { config } = useAuth();
  if (!config?.demo) return null;
  return (
    <div className="bg-[repeating-linear-gradient(135deg,#1E272C_0_12px,#26323a_12px_24px)] text-[13px] font-medium text-white">
      <div className="mx-auto flex min-h-8 max-w-6xl flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-1 sm:px-6">
        <span className="rounded bg-paint px-1.5 text-[11px] font-extrabold tracking-wide text-ink">DEMO</span>
        <span className="truncate">Mock data around {config.demo.location.label}. Nothing here is real.</span>
        <Link to="/dev" className="ml-auto underline decoration-white/40 underline-offset-2 hover:decoration-white">Developer console</Link>
      </div>
    </div>
  );
}

/** Floating demo box: switch persona, follow the tour, jump to developer tools. */
export function DemoDock() {
  const { config, me, signOut } = useAuth();
  const navigate = useNavigate();
  const { become, busy, byUid } = usePersona();
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [tab, setTab] = useState<"roles" | "tour" | "dev">("roles");
  useEffect(() => {
    try {
      localStorage.setItem(OPEN_KEY, open ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [open]);

  if (!config?.demo) return null;
  const personas = config.demo.personas;

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="fixed bottom-4 left-4 z-[1800] flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-sm font-bold text-white shadow-[var(--shadow-lift)]">
        <FlaskConical size={17} className="text-paint" /> Demo box
      </button>
    );
  }

  return (
    <aside aria-label="Demo box"
      className="fixed inset-x-3 bottom-3 z-[1800] max-h-[70vh] overflow-hidden rounded-3xl border border-line bg-white shadow-[var(--shadow-lift)] sm:inset-x-auto sm:left-4 sm:w-[360px]">
      <div className="flex items-center gap-2 bg-ink px-4 py-3 text-white">
        <FlaskConical size={17} className="text-paint" />
        <p className="font-bold">Demo box</p>
        <span className="ml-1 truncate text-xs text-white/70">{me ? `as ${me.name}` : "signed out"}</span>
        <button className="ml-auto rounded-full p-1 hover:bg-white/10" onClick={() => setOpen(false)} aria-label="Minimise demo box"><X size={17} /></button>
      </div>
      <div className="grid grid-cols-3 gap-1 border-b border-line p-1.5" role="tablist">
        {([["roles", "Switch role", User], ["tour", "Guided tour", Compass], ["dev", "Developer", Code2]] as const).map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={`flex items-center justify-center gap-1.5 rounded-xl py-2 text-[13px] font-semibold ${tab === id ? "bg-chalk text-ink" : "text-ink-3 hover:text-ink"}`}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>
      <div className="max-h-[calc(70vh-104px)] overflow-y-auto p-3">
        {tab === "roles" && (
          <ul className="space-y-2">
            {personas.map((p) => {
              const Icon = ROLE_ICON[p.role];
              const active = me?.name === p.name;
              return (
                <li key={p.token}>
                  <button onClick={() => become(p)} disabled={!!busy}
                    className={`flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors ${active ? "border-civic bg-civic-soft" : "border-line hover:border-line-2"}`}>
                    <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${ROLE_TONE[p.role]}`}>
                      {busy === p.token ? <Spinner size={15} /> : <Icon size={17} />}
                    </span>
                    <span className="min-w-0">
                      <span className="flex items-center gap-2 text-[15px] font-semibold">{p.name}
                        <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{ROLE_TAG[p.role]}</span>
                      </span>
                      <span className="block text-xs text-ink-2">{p.blurb}</span>
                    </span>
                  </button>
                </li>
              );
            })}
            <li>
              <button onClick={() => (signOut(), navigate("/"))} className="w-full rounded-2xl border border-dashed border-line-2 p-2.5 text-sm text-ink-2 hover:border-ink-3">
                Sign out (see it as a visitor)
              </button>
            </li>
          </ul>
        )}
        {tab === "tour" && (
          <ol className="space-y-2">
            {TOUR.map((s) => {
              const persona = s.as ? byUid(s.as) : undefined;
              return (
                <li key={s.title}>
                  <button onClick={() => (persona ? become(persona, s.to) : navigate(s.to))} disabled={!!busy}
                    className="w-full rounded-2xl border border-line p-3 text-left hover:border-civic">
                    <span className="block text-[15px] font-semibold">{s.title}</span>
                    <span className="block text-xs text-ink-2">{s.body}{persona ? ` · as ${persona.name}` : ""}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {tab === "dev" && (
          <div className="space-y-2 text-sm">
            <Link to="/dev" className="block rounded-2xl border border-line p-3 hover:border-civic">
              <span className="block font-semibold">Developer console</span>
              <span className="block text-xs text-ink-2">Tables, tokens, live API calls, reset data.</span>
            </Link>
            <a href="/docs" target="_blank" rel="noreferrer" className="block rounded-2xl border border-line p-3 hover:border-civic">
              <span className="block font-semibold">API docs (Swagger)</span>
              <span className="block text-xs text-ink-2">Every endpoint, try it in the browser.</span>
            </a>
            <div className="rounded-2xl border border-line p-3">
              <span className="flex items-center gap-1.5 font-semibold"><LocateFixed size={15} /> Location</span>
              <span className="block text-xs text-ink-2">“Use my location” pretends you're at {config.demo.location.label}.</span>
              <div className="mt-2 flex gap-2">
                <button className="btn-ghost btn-sm" onClick={() => (setDemoRealGps(false), location.reload())}>Demo spot</button>
                <button className="btn-ghost btn-sm" onClick={() => (setDemoRealGps(true), location.reload())}>Real GPS</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
