import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth, homeFor } from "@/contexts/AuthContext";
import { Button, ErrorNote, Field, Input, Segmented } from "@/components/ui";
import { FramesArt } from "@/components/Art";

const DEMO = {
  citizen: { email: "priya@commons.demo", note: "Report issues, follow them and verify fixes." },
  admin: { email: "admin@commons.demo", note: "Verify, route, assign and monitor. (Department admin: roads.admin@commons.demo)" },
  worker: { email: "ravi@commons.demo", note: "See assigned tasks, post progress and submit evidence." },
};

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [sp] = useSearchParams();
  const [as, setAs] = useState<"citizen" | "admin" | "worker">((sp.get("as") as any) ?? "citizen");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      navigate(sp.get("next") ?? homeFor(u.role), { replace: true });
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  return (
    <AuthFrame title="Sign in" sub="One sign-in for residents, officials and field crews. We open the right workspace for you.">
      <Segmented value={as} onChange={setAs} className="w-full [&>button]:flex-1" options={[
        { value: "citizen", label: "Resident" }, { value: "admin", label: "Official" }, { value: "worker", label: "Field crew" }]} />
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email"><Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Password" htmlFor="pw"><Input id="pw" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Sign in</Button>
      </form>
      <div className="t-body-sm mt-8 border-t border-line pt-4">
        <p className="font-medium text-ink">Demo account</p>
        <p className="mt-0.5 text-slate">{DEMO[as].note}</p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-slate"><span className="text-ink">{DEMO[as].email}</span> · Demo@1234</span>
          <Button size="sm" variant="secondary" onClick={() => { setEmail(DEMO[as].email); setPassword("Demo@1234"); }}>Fill in</Button>
        </div>
      </div>
      {as === "citizen" && <p className="mt-6 text-center text-sm text-slate">New here? <Link to="/register" className="text-ink underline underline-offset-4 hover:text-ink">Create an account</Link></p>}
      {as !== "citizen" && <p className="mt-6 text-center text-sm text-slate">Staff accounts are created by an administrator.</p>}
    </AuthFrame>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState({ full_name: "", email: "", phone: "", password: "" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try { await register({ ...f, phone: f.phone || undefined }); navigate("/me", { replace: true }); }
    catch (err) { setError(err); } finally { setBusy(false); }
  };
  return (
    <AuthFrame title="Create your account" sub="Report issues under your name, get notified as they progress, and confirm when they're fixed.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Full name" htmlFor="n" hint="Shown publicly as first name and initial, e.g. Priya S."><Input id="n" required minLength={2} value={f.full_name} onChange={set("full_name")} autoComplete="name" /></Field>
        <Field label="Email" htmlFor="e"><Input id="e" type="email" required value={f.email} onChange={set("email")} autoComplete="email" /></Field>
        <Field label="Phone" htmlFor="p" optional hint="Never shown publicly."><Input id="p" type="tel" value={f.phone} onChange={set("phone")} autoComplete="tel" /></Field>
        <Field label="Password" htmlFor="pw" hint="At least 8 characters, with letters and numbers."><Input id="pw" type="password" required minLength={8} maxLength={72} value={f.password} onChange={set("password")} autoComplete="new-password" /></Field>
        <ErrorNote error={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate">Already registered? <Link to="/login" className="text-ink underline underline-offset-4 hover:text-ink">Sign in</Link></p>
    </AuthFrame>
  );
}

function AuthFrame({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="mx-auto grid min-h-[calc(100dvh-4rem)] max-w-[1120px] items-center gap-16 px-4 py-16 sm:px-6 lg:grid-cols-2">
      <div className="hidden lg:block">
        <FramesArt icon="pin" className="w-full max-w-[360px]" />
        <blockquote className="mt-12 max-w-md">
          <p className="t-h1">A report should never <em>disappear</em> into an office.</p>
          <p className="t-body-sm mt-4 text-slate">Every step is written down where you can read it: who has it, what they did, and what happens next.</p>
        </blockquote>
      </div>
      <div className="mx-auto w-full max-w-md border-t-[1.5px] border-ink pt-8">
        <h1 className="t-h1">{title}</h1>
        <p className="t-body-sm mt-2 mb-8 text-slate">{sub}</p>
        {children}
      </div>
    </div>
  );
}
