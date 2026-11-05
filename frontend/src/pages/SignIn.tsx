import { HardHat, ShieldCheck, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Spinner } from "../components/ui";
import { friendlyAuthError, homeFor, useAuth } from "../lib/auth";
import type { Me, Role } from "../lib/types";

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path
        fill="#FFC107"
        d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"
      />
      <path
        fill="#FF3D00"
        d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"
      />
    </svg>
  );
}

const ROLES: { id: Role; label: string; icon: typeof User; title: string; blurb: string }[] = [
  {
    id: "public",
    label: "Resident",
    icon: User,
    title: "Sign in",
    blurb: "So you can report problems, +1 your neighbours' reports and follow them until they're fixed.",
  },
  {
    id: "worker",
    label: "Field worker",
    icon: HardHat,
    title: "Worker sign in",
    blurb: "See the jobs near you, mark them as being fixed and upload proof when they're done.",
  },
  {
    id: "admin",
    label: "City admin",
    icon: ShieldCheck,
    title: "Admin sign in",
    blurb: "Review reports, assign workers, merge duplicates and track how fast problems get fixed.",
  },
];

const ROLE_NAME: Record<Role, string> = { public: "resident", worker: "field worker", admin: "city admin" };

export default function SignIn() {
  const {
    config,
    me,
    ready,
    authError,
    recovery,
    signInGoogle,
    signInEmail,
    signInDemo,
    signOut,
    sendPasswordReset,
    setNewPassword,
  } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const nextParam = params.get("next");
  const [role, setRole] = useState<Role>((params.get("as") as Role) || "public");
  const [mode, setMode] = useState<"signin" | "create" | "forgot" | "reset">(() => {
    return params.get("reset") === "1" ? "reset" : "signin";
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [infoNote, setInfoNote] = useState("");
  const current = ROLES.find((r) => r.id === role) ?? ROLES[0];

  useEffect(() => {
    if (recovery || params.get("reset") === "1") {
      setMode("reset");
    }
  }, [recovery, params]);

  useEffect(() => {
    setError("");
    setInfoNote("");
  }, [mode, role]);

  // Handle post-redirect / auto-navigation (with role verification for ?as= across redirects)
  useEffect(() => {
    if (!ready || !me || busy || recovery || mode === "reset") return;

    const asRole = params.get("as") as Role | null;
    if (asRole && asRole !== "public" && me.role !== asRole && me.role !== "admin") {
      signOut().then(() => {
        setError(
          `${me.email} isn't registered as a ${ROLE_NAME[asRole]}. Ask a city admin to add this email under Admin → Team.`,
        );
      });
      return;
    }

    navigate(nextParam || homeFor(me.role), { replace: true });
  }, [ready, me, busy, recovery, mode, params, nextParam, navigate, signOut]);

  async function run(fn: () => Promise<Me | null>) {
    setBusy(true);
    setError("");
    setInfoNote("");
    try {
      const signedIn = await fn();
      if (!signedIn) {
        // null means no immediate session / navigation (e.g. email confirmation required or OAuth redirect initiated)
        if (mode === "create") {
          setInfoNote("We sent you a link. Open it to confirm your email, then sign in.");
        }
        return;
      }
      // Worker/admin tabs only let in accounts that actually have that role.
      if (role !== "public" && signedIn.role !== role && signedIn.role !== "admin") {
        await signOut();
        setError(
          `${signedIn.email} isn't registered as a ${ROLE_NAME[role]}. Ask a city admin to add this email under Admin → Team.`,
        );
        return;
      }
      navigate(nextParam || homeFor(signedIn.role), { replace: true });
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleForgot(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfoNote("");
    try {
      await sendPasswordReset(email.trim());
      setInfoNote("We sent you a password reset link. Check your email.");
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInfoNote("");
    try {
      await setNewPassword(password);
      setInfoNote("Your password has been updated. You can now sign in.");
      setMode("signin");
      setPassword("");
    } catch (e) {
      setError(friendlyAuthError(e));
    } finally {
      setBusy(false);
    }
  }

  const shownError = error || (ready && !me ? authError : "");

  return (
    <div className="mx-auto max-w-md px-4 py-12 sm:py-16">
      <div
        role="tablist"
        aria-label="Sign in as"
        className="mb-8 grid grid-cols-3 gap-1 rounded-2xl border border-line bg-white p-1"
      >
        {ROLES.map((r) => (
          <button
            key={r.id}
            role="tab"
            aria-selected={role === r.id}
            onClick={() => setRole(r.id)}
            className={`flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-[13px] font-semibold transition-colors ${
              role === r.id ? "bg-ink text-white" : "text-ink-2 hover:bg-chalk"
            }`}
          >
            <r.icon size={18} aria-hidden /> {r.label}
          </button>
        ))}
      </div>

      <h1 className="text-[clamp(30px,5vw,40px)] font-extrabold">
        {mode === "create"
          ? "Create your account"
          : mode === "forgot"
            ? "Reset your password"
            : mode === "reset"
              ? "Set new password"
              : current.title}
      </h1>
      <p className="mt-2 text-ink-2">
        {mode === "forgot"
          ? "Enter your email and we'll send you a link to reset your password."
          : mode === "reset"
            ? "Choose a new password with at least 6 characters."
            : current.blurb}
      </p>

      {!config ? (
        <div className="py-10 text-ink-3">
          <Spinner />
        </div>
      ) : config.auth_mode === "dev" ? (
        <div className="mt-8 space-y-3">
          <p className="rounded-xl bg-st-open-soft px-4 py-3 text-sm">
            Demo mode: Supabase isn't configured on this server yet, so you can sign in with one click.
          </p>
          <button className="btn-ink h-12 w-full" disabled={busy} onClick={() => run(() => signInDemo(role))}>
            {busy && <Spinner size={16} />} Continue as a demo {ROLE_NAME[role]}
          </button>
        </div>
      ) : config.auth_mode === "none" ? (
        <p className="mt-8 rounded-xl bg-st-open-soft px-4 py-3 text-sm">
          Sign-in isn't configured on this server. Set SUPABASE_URL and SUPABASE_ANON_KEY.
        </p>
      ) : mode === "forgot" ? (
        <div className="mt-8">
          <form className="space-y-4" onSubmit={handleForgot}>
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <button type="submit" className="btn-ink h-12 w-full" disabled={busy}>
              {busy && <Spinner size={16} />} Send reset link
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-ink-2">
            <button className="font-semibold text-civic hover:underline" onClick={() => setMode("signin")}>
              Back to sign in
            </button>
          </p>
        </div>
      ) : mode === "reset" ? (
        <div className="mt-8">
          <form className="space-y-4" onSubmit={handleReset}>
            <div>
              <label className="label" htmlFor="new-pw">
                New password
              </label>
              <input
                id="new-pw"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete="new-password"
              />
            </div>
            <button type="submit" className="btn-ink h-12 w-full" disabled={busy}>
              {busy && <Spinner size={16} />} Update password
            </button>
          </form>
        </div>
      ) : (
        <div className="mt-8">
          <button
            className="btn-ghost h-12 w-full bg-white"
            disabled={busy}
            onClick={() => run(() => signInGoogle(role, nextParam || undefined))}
          >
            <GoogleMark /> Continue with Google
          </button>
          <div className="my-6 flex items-center gap-3 text-sm text-ink-3">
            <span className="h-px flex-1 bg-line" /> or with email <span className="h-px flex-1 bg-line" />
          </div>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              run(() => signInEmail(email.trim(), password, mode === "create", name));
            }}
          >
            {mode === "create" && (
              <div>
                <label className="label" htmlFor="name">
                  Your name
                </label>
                <input
                  id="name"
                  className="field"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label" htmlFor="pw">
                  Password
                </label>
                {mode === "signin" && (
                  <button
                    type="button"
                    className="text-xs font-semibold text-civic hover:underline"
                    onClick={() => setMode("forgot")}
                  >
                    Forgot password?
                  </button>
                )}
              </div>
              <input
                id="pw"
                type="password"
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === "create" ? "new-password" : "current-password"}
              />
            </div>
            <button type="submit" className="btn-ink h-12 w-full" disabled={busy}>
              {busy && <Spinner size={16} />} {mode === "create" ? "Create account" : "Sign in"}
            </button>
          </form>
          <p className="mt-5 text-center text-sm text-ink-2">
            {mode === "create"
              ? "Already have an account? "
              : role === "public"
                ? "New here? "
                : "First time? Your admin must add your email, then "}
            <button
              className="font-semibold text-civic hover:underline"
              onClick={() => setMode(mode === "create" ? "signin" : "create")}
            >
              {mode === "create" ? "Sign in" : "Create an account"}
            </button>
          </p>
        </div>
      )}
      {infoNote && (
        <p className="mt-4 rounded-xl bg-st-open-soft px-4 py-3 text-sm text-ink" role="status">
          {infoNote}
        </p>
      )}
      {shownError && (
        <p className="mt-4 text-sm font-medium text-danger" role="alert">
          {shownError}
        </p>
      )}
    </div>
  );
}
