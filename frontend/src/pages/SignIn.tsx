import { useEffect, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { Spinner } from "../components/ui";
import { friendlyAuthError, useAuth } from "../lib/auth";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export default function SignIn() {
  const { config, me, ready, signInGoogle, signInEmail, signInDemo } = useAuth();
  const [params] = useSearchParams();
  const next = params.get("next") || "/report";
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
  }, [mode]);

  if (ready && me) return <Navigate to={next} replace />;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <h1 className="text-[clamp(30px,5vw,40px)] font-extrabold">{mode === "create" ? "Create your account" : "Sign in"}</h1>
      <p className="mt-2 text-ink-2">So you can report problems, +1 your neighbours' reports and follow them until they're fixed.</p>

      {!config ? (
        <div className="py-10 text-ink-3"><Spinner /></div>
      ) : config.auth_mode === "dev" ? (
        <div className="mt-8 space-y-3">
          <p className="rounded-xl bg-st-open-soft px-4 py-3 text-sm">
            Demo mode: Firebase isn't configured on this server yet, so you can sign in with one click.
          </p>
          <button className="btn-ink w-full h-12" disabled={busy} onClick={() => run(() => signInDemo(false))}>Continue as a resident</button>
          <button className="btn-ghost w-full h-12" disabled={busy} onClick={() => run(() => signInDemo(true))}>Continue as city staff</button>
        </div>
      ) : config.auth_mode === "none" ? (
        <p className="mt-8 rounded-xl bg-st-open-soft px-4 py-3 text-sm">Sign-in isn't configured on this server. Set the FIREBASE_* variables.</p>
      ) : (
        <div className="mt-8">
          <button className="btn-ghost w-full h-12 bg-white" disabled={busy} onClick={() => run(signInGoogle)}>
            <GoogleMark /> Continue with Google
          </button>
          <div className="my-6 flex items-center gap-3 text-sm text-ink-3">
            <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => signInEmail(email, password, mode === "create", name));
            }}
          >
            {mode === "create" && (
              <div>
                <label className="label" htmlFor="name">Your name</label>
                <input id="name" className="field" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="field" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
            </div>
            <div>
              <label className="label" htmlFor="pw">Password</label>
              <input id="pw" type="password" className="field" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6}
                autoComplete={mode === "create" ? "new-password" : "current-password"} />
            </div>
            <button type="submit" className="btn-ink w-full h-12" disabled={busy}>
              {busy && <Spinner size={16} />} {mode === "create" ? "Create account" : "Sign in"}
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-ink-2">
            {mode === "create" ? "Already have an account? " : "New here? "}
            <button className="font-semibold text-civic hover:underline" onClick={() => setMode(mode === "create" ? "signin" : "create")}>
              {mode === "create" ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      )}
      {error && <p className="mt-4 text-sm font-medium text-danger" role="alert">{error}</p>}
    </div>
  );
}
