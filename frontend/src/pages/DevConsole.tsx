import { Database, Play, RotateCcw, Terminal } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Spinner, useToast } from "../components/ui";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { DemoPersona } from "../lib/types";

interface Overview {
  you: { uid: string; name: string; email: string; role: string } | null;
  database: string;
  ai: string;
  tables: Record<string, number>;
  personas: (DemoPersona & { uid: string })[];
  endpoints: { method: string; path: string; what: string }[];
}

/** Developer-level access for the demo build: data, tokens, and a tiny API runner. */
export default function DevConsole() {
  const { config, me, signInToken } = useAuth();
  const toast = useToast();
  const [ov, setOv] = useState<Overview | null>(null);
  const [path, setPath] = useState("/api/stats");
  const [out, setOut] = useState<{ status: string; body: string } | null>(null);
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(() => api<Overview>("/api/dev/overview").then(setOv).catch((e) => toast((e as Error).message, "err")), [toast]);
  useEffect(() => {
    load();
  }, [load, me?.uid]);

  async function run(p = path) {
    setPath(p);
    setRunning(true);
    const t = performance.now();
    try {
      const data = await api<unknown>(p);
      setOut({ status: `200 OK · ${Math.round(performance.now() - t)} ms`, body: JSON.stringify(data, null, 2) });
    } catch (e) {
      setOut({ status: "Error", body: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  async function reset() {
    if (!window.confirm("Wipe all demo data and regenerate it? Takes a few seconds.")) return;
    setResetting(true);
    try {
      const r = await api<Record<string, number>>("/api/dev/reset", { method: "POST" });
      toast(`Fresh demo data: ${r.issues} reports, ${r.photos} photos, ${r.messages} messages.`);
      load();
    } catch (e) {
      toast((e as Error).message, "err");
    } finally {
      setResetting(false);
    }
  }

  if (!config?.demo) {
    return <p className="mx-auto max-w-3xl px-4 py-20 text-center text-ink-2">The developer console is only available in the demo build.</p>;
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-civic"><Terminal size={15} /> Demo build</p>
      <h1 className="text-[clamp(28px,4vw,40px)] font-extrabold">Developer console</h1>
      <p className="mt-2 max-w-[65ch] text-ink-2">
        Everything behind the screens: the data, the role tokens and the API. The real app has none of this; it only exists when
        <code className="mx-1 rounded bg-white px-1.5 py-0.5 text-sm">DEMO_MODE=1</code>.
      </p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        <div className="space-y-6">
          <section className="card p-5">
            <h2 className="flex items-center gap-2 font-sans text-base font-bold tracking-normal"><Database size={16} /> Data</h2>
            {!ov ? <Spinner /> : (
              <>
                <p className="mt-1 text-sm text-ink-3">{ov.database} · AI: {ov.ai}</p>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                  {Object.entries(ov.tables).map(([t, n]) => (
                    <div key={t} className="flex justify-between border-b border-line py-1"><dt className="text-ink-2">{t}</dt><dd className="font-semibold tabular-nums">{n}</dd></div>
                  ))}
                </dl>
              </>
            )}
            <button className="btn-ghost btn-sm mt-4" onClick={reset} disabled={resetting}>
              {resetting ? <Spinner size={14} /> : <RotateCcw size={15} />} Reset demo data
            </button>
          </section>

          <section className="card p-5">
            <h2 className="font-sans text-base font-bold tracking-normal">Who am I</h2>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-chalk p-3 text-xs">{JSON.stringify(ov?.you ?? null, null, 2)}</pre>
            <h3 className="mt-4 text-sm font-semibold">Role tokens</h3>
            <p className="text-xs text-ink-3">Send as <code>Authorization: Bearer &lt;token&gt;</code>. Click one to become that person.</p>
            <ul className="mt-2 space-y-1.5">
              {ov?.personas.map((p) => (
                <li key={p.token}>
                  <button onClick={() => signInToken(p.token).then(() => toast(`Now ${p.name}.`))}
                    className="w-full rounded-lg border border-line px-2.5 py-1.5 text-left font-mono text-xs hover:border-civic">
                    {p.token}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card flex min-w-0 flex-col p-5">
          <h2 className="font-sans text-base font-bold tracking-normal">API runner</h2>
          <p className="text-xs text-ink-3">GET requests run with your current role's token. Full docs at <a className="text-civic underline" href="/docs" target="_blank" rel="noreferrer">/docs</a>.</p>
          <form className="mt-3 flex gap-2" onSubmit={(e) => (e.preventDefault(), run())}>
            <input className="field min-w-0 flex-1 font-mono text-sm" value={path} onChange={(e) => setPath(e.target.value)} aria-label="API path" />
            <button className="btn-ink h-12 shrink-0" disabled={running}>{running ? <Spinner size={15} /> : <Play size={15} />} Run</button>
          </form>
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {ov?.endpoints.map((e) => (
              <li key={e.path}>
                <button title={e.what} onClick={() => run(e.path)} className="rounded-full border border-line px-2.5 py-1 font-mono text-[11px] text-ink-2 hover:border-civic hover:text-ink">
                  {e.path.split("?")[0].replace("/api/", "")}{e.path.includes("?") ? "?…" : ""}
                </button>
              </li>
            ))}
          </ul>
          {out && (
            <div className="mt-4 min-h-0 flex-1">
              <p className={`text-xs font-semibold ${out.status === "Error" ? "text-danger" : "text-st-fixed"}`}>{out.status}</p>
              <pre className="mt-1 max-h-[520px] overflow-auto rounded-xl bg-ink p-3 text-xs leading-relaxed text-[#d8e2dc]">{out.body}</pre>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
