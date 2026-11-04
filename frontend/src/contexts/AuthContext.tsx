import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, tokenStore } from "@/services/api";
import type { Role, User } from "@/types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  register: (data: { email: string; password: string; full_name: string; phone?: string }) => Promise<User>;
  logout: () => void;
  setUser: (u: User) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(!!tokenStore.get());
  const qc = useQueryClient();

  useEffect(() => {
    if (!tokenStore.get()) return;
    api.get<User>("/api/auth/me").then(setUser).catch(() => tokenStore.clear()).finally(() => setLoading(false));
  }, []);

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    qc.clear();
  }, [qc]);

  useEffect(() => {
    const onUnauthorized = () => logout();
    window.addEventListener("commons:unauthorized", onUnauthorized);
    return () => window.removeEventListener("commons:unauthorized", onUnauthorized);
  }, [logout]);

  const value = useMemo<AuthState>(() => ({
    user, loading, logout, setUser,
    async login(email, password) {
      const r = await api.post<{ access_token: string; user: User }>("/api/auth/login", { email, password });
      tokenStore.set(r.access_token);
      qc.clear();
      setUser(r.user);
      return r.user;
    },
    async register(data) {
      const r = await api.post<{ access_token: string; user: User }>("/api/auth/register", data);
      tokenStore.set(r.access_token);
      setUser(r.user);
      return r.user;
    },
  }), [user, loading, logout, qc]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth outside AuthProvider");
  return v;
}

export const homeFor = (role: Role) => (role === "admin" ? "/admin" : role === "worker" ? "/worker" : "/me");
