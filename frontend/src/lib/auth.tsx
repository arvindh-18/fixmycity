import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Auth } from "firebase/auth";
import { api, loadConfig, setTokenGetter } from "./api";
import type { AppConfig, Me } from "./types";

interface AuthState {
  config: AppConfig | null;
  me: Me | null;
  ready: boolean;
  signInGoogle: () => Promise<void>;
  signInEmail: (email: string, password: string, create: boolean, name?: string) => Promise<void>;
  signInDemo: (admin: boolean) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEV_KEY = "fmc_dev_token";

function readDev(): string | null {
  try {
    return localStorage.getItem(DEV_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const authRef = useRef<Auth | null>(null);

  const refreshMe = useCallback(async () => {
    try {
      setMe(await api<Me>("/api/me"));
    } catch {
      setMe(null);
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
            if (u) await refreshMe();
            else setMe(null);
            setReady(true);
          });
        } else if (cfg.auth_mode === "dev") {
          setTokenGetter(async () => readDev());
          if (readDev()) await refreshMe();
          setReady(true);
        } else {
          setReady(true);
        }
      })
      .catch(() => setReady(true));
    return () => unsub();
  }, [refreshMe]);

  const value = useMemo<AuthState>(
    () => ({
      config,
      me,
      ready,
      async signInGoogle() {
        const fa = await import("firebase/auth");
        await fa.signInWithPopup(authRef.current!, new fa.GoogleAuthProvider());
      },
      async signInEmail(email, password, create, name) {
        const fa = await import("firebase/auth");
        const auth = authRef.current!;
        if (create) {
          const cred = await fa.createUserWithEmailAndPassword(auth, email, password);
          if (name) {
            await fa.updateProfile(cred.user, { displayName: name });
            await cred.user.getIdToken(true);
          }
          await refreshMe();
        } else {
          await fa.signInWithEmailAndPassword(auth, email, password);
        }
      },
      async signInDemo(admin) {
        try {
          localStorage.setItem(DEV_KEY, admin ? "dev:admin:Ward Office:1" : "dev:resident:Demo Resident:0");
        } catch {
          /* private mode: token lives only for this page */
        }
        const token = admin ? "dev:admin:Ward Office:1" : "dev:resident:Demo Resident:0";
        setTokenGetter(async () => readDev() ?? token);
        await refreshMe();
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
      },
    }),
    [config, me, ready, refreshMe],
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
    "auth/popup-closed-by-user": "The Google window was closed before signing in.",
    "auth/unauthorized-domain": "This domain isn't allowed yet. Add it under Firebase → Authentication → Settings → Authorized domains.",
    "auth/operation-not-allowed": "This sign-in method is off. Enable it in Firebase → Authentication → Sign-in method.",
  };
  return map[code] ?? (err as Error)?.message ?? "Sign-in failed.";
}
