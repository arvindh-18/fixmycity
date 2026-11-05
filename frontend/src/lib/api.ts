import type { AppConfig } from "./types";

const BASE = import.meta.env.VITE_API_BASE_URL ?? "";

let tokenGetter: () => Promise<string | null> = async () => null;
export function setTokenGetter(fn: () => Promise<string | null>) {
  tokenGetter = fn;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

export async function api<T>(
  path: string,
  opts: { method?: string; body?: unknown; query?: Record<string, string | number | boolean | undefined> } = {},
): Promise<T> {
  const url = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== "" && v !== false) url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  const token = await tokenGetter();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.body instanceof FormData) body = opts.body;
  else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers["Content-Type"] = "application/json";
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0);
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data?.detail;
    const msg = Array.isArray(detail)
      ? detail.map((d: { loc?: string[]; msg: string }) => `${d.loc?.at(-1) ?? "field"}: ${d.msg}`).join("; ")
      : detail || `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

let configPromise: Promise<AppConfig> | null = null;
export const loadConfig = () => (configPromise ??= api<AppConfig>("/api/config"));

export const photoSrc = (url: string | null) => (url ? BASE + url : null);
