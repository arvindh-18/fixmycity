import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { api, loadConfig, setTokenGetter } from "./api";
import type { AppConfig, Me, Role } from "./types";

interface AuthState {
  config: AppConfig | null;
  me: Me | null;
  ready: boolean;
  authError: string;
  recovery: boolean;
  signInGoogle: (role?: Role, next?: string) => Promise<Me | null>;
  signInEmail: (email: string, password: string, create: boolean, name?: string) => Promise<Me | null>;
  signInDemo: (role: Role) => Promise<Me>;
  signOut: () => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);
const DEV_KEY = "fmc_dev_token";

const DEV_TOKENS: Record<Role, string> = {
  public: "dev:resident:Demo Resident:0",
  worker: "dev:worker:Demo Worker:w",
  admin: "dev:admin:FixMyCity Staff:1",
};

let clientInstance: SupabaseClient | null = null;

async function getSupabaseClient(url: string, anonKey: string): Promise<SupabaseClient> {
  if (!clientInstance) {
    const { createClient } = await import("@supabase/supabase-js");
    clientInstance = createClient(url, anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        flowType: "pkce",
      },
    });
  }
  return clientInstance;
}

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
  const [recovery, setRecovery] = useState(false);

  const supabaseRef = useRef<SupabaseClient | null>(null);
  const tokenRef = useRef<string | null>(null);
  const lastLoadedUidRef = useRef<string | null>(null);

  const loadMe = useCallback(async () => {
    try {
      const m = await api<Me>("/api/me");
      setMe(m);
      lastLoadedUidRef.current = m.uid;
      setAuthError("");
      return m;
    } catch (e) {
      setMe(null);
      lastLoadedUidRef.current = null;
      setAuthError((e as Error).message);
      throw e;
    }
  }, []);

  useEffect(() => {
    let unsub = () => {};

    loadConfig()
      .then(async (cfg) => {
        setConfig(cfg);

        if (cfg.auth_mode === "supabase" && cfg.supabase) {
          const supabase = await getSupabaseClient(cfg.supabase.url, cfg.supabase.anonKey);
          supabaseRef.current = supabase;

          setTokenGetter(async () => {
            if (tokenRef.current) return tokenRef.current;
            try {
              const { data } = await supabase.auth.getSession();
              tokenRef.current = data.session?.access_token ?? null;
              return tokenRef.current;
            } catch {
              return null;
            }
          });

          const {
            data: { subscription },
          } = supabase.auth.onAuthStateChange((event, session) => {
            tokenRef.current = session?.access_token ?? null;

            if (event === "PASSWORD_RECOVERY") {
              setRecovery(true);
            }

            if (event === "SIGNED_OUT") {
              tokenRef.current = null;
              lastLoadedUidRef.current = null;
              setMe(null);
              setReady(true);
              return;
            }

            if (event === "TOKEN_REFRESHED") {
              return;
            }

            // Defer loadMe to avoid synchronous calls inside auth state listener
            setTimeout(() => {
              if (session?.user) {
                // Avoid redundant loadMe if same user is already loaded
                if (lastLoadedUidRef.current !== session.user.id) {
                  loadMe()
                    .catch(() => {})
                    .finally(() => setReady(true));
                } else {
                  setReady(true);
                }
              } else {
                setMe(null);
                lastLoadedUidRef.current = null;
                setReady(true);
              }
            }, 0);
          });

          unsub = () => subscription.unsubscribe();
        } else if (cfg.auth_mode === "dev") {
          setTokenGetter(async () => readDev());
          if (readDev()) {
            await loadMe().catch(() => {});
          }
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
      recovery,
      async signInGoogle(role, next) {
        const client = supabaseRef.current;
        if (!client) throw new Error("Sign-in service is not ready. Please try again.");
        const origin = window.location.origin;
        const params = new URLSearchParams();
        if (role) params.set("as", role);
        if (next) params.set("next", next);
        const query = params.toString();
        const redirectTo = `${origin}/signin${query ? `?${query}` : ""}`;

        const { error } = await client.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo },
        });
        if (error) throw error;
        return null;
      },
      async signInEmail(email, password, create, name) {
        const client = supabaseRef.current;
        if (!client) throw new Error("Sign-in service is not ready. Please try again.");

        if (create) {
          const { data, error } = await client.auth.signUp({
            email,
            password,
            options: {
              data: { full_name: name || "" },
            },
          });
          if (error) throw error;
          if (!data.session) {
            // Confirmation required
            return null;
          }
          tokenRef.current = data.session.access_token;
          return loadMe();
        }

        const { data, error } = await client.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        tokenRef.current = data.session.access_token;
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
        if (supabaseRef.current) {
          try {
            await supabaseRef.current.auth.signOut();
          } catch {
            /* ignore */
          }
        }
        try {
          localStorage.removeItem(DEV_KEY);
        } catch {
          /* ignore */
        }
        tokenRef.current = null;
        lastLoadedUidRef.current = null;
        setMe(null);
        setAuthError("");
        setRecovery(false);
      },
      async sendPasswordReset(email) {
        const client = supabaseRef.current;
        if (!client) throw new Error("Sign-in service is not ready. Please try again.");
        const { error } = await client.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/signin?reset=1`,
        });
        if (error) throw error;
      },
      async setNewPassword(password) {
        const client = supabaseRef.current;
        if (!client) throw new Error("Sign-in service is not ready. Please try again.");
        const { error } = await client.auth.updateUser({ password });
        if (error) throw error;
        setRecovery(false);
      },
    }),
    [config, me, ready, authError, recovery, loadMe],
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
  const msg = ((err as Error)?.message || "").toLowerCase();

  const codeMap: Record<string, string> = {
    invalid_credentials: "Email or password is wrong.",
    user_already_exists: "An account with that email exists. Sign in instead.",
    weak_password: "Use at least 6 characters for the password.",
    validation_failed: "That email address doesn't look right.",
    invalid_email: "That email address doesn't look right.",
    email_not_confirmed: "Confirm your email first, then sign in.",
    over_request_rate_limit: "Too many attempts. Wait a minute and try again.",
    over_email_send_rate_limit: "Too many attempts. Wait a minute and try again.",
    network_error: "Couldn't reach the sign-in service. Check your internet connection.",
    provider_disabled: "This sign-in method is off in Supabase.",
  };

  if (code && codeMap[code]) {
    return codeMap[code];
  }

  if (msg.includes("invalid login credentials") || msg.includes("invalid credentials")) {
    return "Email or password is wrong.";
  }
  if (msg.includes("already registered") || msg.includes("user already exists")) {
    return "An account with that email exists. Sign in instead.";
  }
  if (msg.includes("email not confirmed") || msg.includes("confirm your email")) {
    return "Confirm your email first, then sign in.";
  }
  if (msg.includes("password should be at least") || msg.includes("weak password")) {
    return "Use at least 6 characters for the password.";
  }
  if (msg.includes("rate limit") || msg.includes("too many requests")) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (msg.includes("failed to fetch") || msg.includes("network") || msg.includes("unreachable")) {
    return "Couldn't reach the sign-in service. Check your internet connection.";
  }

  return (err as Error)?.message ?? "Sign-in failed.";
}
