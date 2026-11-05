import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Auth } from "firebase/auth";
import { api, loadConfig, setTokenGetter } from "./api";
import type { AppConfig, Me, Role } from "./types";

interface AuthState {
  config: AppConfig | null;
  me: Me | null;
  ready: boolean;
  /** Set when Firebase signed in but our server rejected the token (otherwise sign-in would fail silently). */
  authError: string;
  signInGoogle: () => Promise<Me>;
  signInEmail: (email: string, password: string, create: boolean, name?: string) => Promise<Me>;
  signInDemo: (role: Role) => Promise<Me>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEV_KEY = "fmc_dev_token";

const DEV_TOKENS: Record<Role, string> = {
  public: "dev:resident:Demo Resident:0",
  worker: "dev:worker:Demo Worker:w",
  admin: "dev:admin:FixMyCity Staff:1",
};

function readDev(): string | null {
  try {
    return localStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

/** Where each role lands after signing in. */
export function homeFor(role: Role | undefined): string {
  return role === "admin" ? "/admin" : role === "worker" ? "/worker" : "/";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [authError, setAuthError] = useState("");
  const authRef = useRef<Auth | null>(null);

  // Throws on failure so callers can show the reason instead of silently doing nothing.
  const loadMe = useCallback(async () => {
    try {
      const m = await api<Me>("/api/me");
      setMe(m);
      setAuthError("");
      return m;
    } catch (e) {
      setMe(null);
      setAuthError((e as Error).message);
      throw e;
    }
  }, []);

  useEffect(() => {
    let unsub = () => {};
    loadConfig()
      .then(async (cfg) => {
        setConfig(cfg);
        if (cfg.auth_mode === "firebase" && cfg.firebase) {
          // Firebase is only loaded when the server is configured for it.
          const { initializeApp } = await import("firebase/app");
          const fa = await import("firebase/auth");
          const auth = fa.getAuth(initializeApp(cfg.firebase));
          authRef.current = auth;
          setTokenGetter(async () => (auth.currentUser ? auth.currentUser.getIdToken() : null));
          unsub = fa.onAuthStateChanged(auth, async (u) => {
            if (u) await loadMe().catch(() => {});
            else setMe(null);
            setReady(true);
          });
        } else if (cfg.auth_mode === "dev") {
          setTokenGetter(async () => readDev());
          if (readDev()) await loadMe().catch(() => {});
          setReady(true);
        } else {
          setReady(true);
        }
      })
      .catch((e) => {
        setAuthError((e as Error).message);
        setReady(true);
      });
    return () => unsub();
  }, [loadMe]);

  const value = useMemo<AuthState>(
    () => ({
      config,
      me,
      ready,
      authError,
      async signInGoogle() {
        const fa = await import("firebase/auth");
        await fa.signInWithPopup(authRef.current!, new fa.GoogleAuthProvider());
        return loadMe();
      },
      async signInEmail(email, password, create, name) {
        const fa = await import("firebase/auth");
        const auth = authRef.current;
        if (!auth) throw new Error("Sign-in is still loading. Try again in a moment.");
        if (create) {
          const cred = await fa.createUserWithEmailAndPassword(auth, email, password);
          if (name) {
            await fa.updateProfile(cred.user, { displayName: name });
            await cred.user.getIdToken(true);
          }
        } else {
          await fa.signInWithEmailAndPassword(auth, email, password);
        }
        // Firebase accepted the password; now make sure our server accepts the token too.
        return loadMe();
      },
      async signInDemo(role) {
        const token = DEV_TOKENS[role];
        try {
          localStorage.setItem(DEV_KEY, token);
        } catch {
          /* private mode: token lives only for this page */
        }
        setTokenGetter(async () => readDev() ?? token);
        return loadMe();
      },
      async signOut() {
        if (authRef.current) {
          const fa = await import("firebase/auth");
          await fa.signOut(authRef.current);
        }
        try {
          localStorage.removeItem(DEV_KEY);
        } catch {
          /* ignore */
        }
        setMe(null);
        setAuthError("");
      },
    }),
    [config, me, ready, authError, loadMe],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function friendlyAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code ?? "";
  const map: Record<string, string> = {
    "auth/invalid-credential": "Email or password is wrong.",
    "auth/wrong-password": "Email or password is wrong.",
    "auth/user-not-found": "No account with that email. Create one instead.",
    "auth/email-already-in-use": "An account with that email exists. Sign in instead.",
    "auth/weak-password": "Use at least 6 characters for the password.",
    "auth/invalid-email": "That email address doesn't look right.",
    "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
    "auth/network-request-failed": "Couldn't reach Firebase. Check your internet connection.",
    "auth/popup-closed-by-user": "The Google window was closed before signing in.",
    "auth/unauthorized-domain": "This domain isn't allowed yet. Add it under Firebase → Authentication → Settings → Authorized domains.",
    "auth/operation-not-allowed": "This sign-in method is off. Enable it in Firebase → Authentication → Sign-in method.",
    "auth/invalid-api-key": "The Firebase API key on the server is wrong. Check FIREBASE_API_KEY.",
  };
  return map[code] ?? (err as Error)?.message ?? "Sign-in failed.";
}
