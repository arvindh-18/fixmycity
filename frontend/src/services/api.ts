// Thin fetch wrapper: adds the JWT, turns FastAPI error bodies into readable messages.

const TOKEN_KEY = "commons.token";

export const tokenStore = {
  get: () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set: (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } },
  clear: () => { try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ } },
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function readable(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    // Pydantic validation errors: [{loc: [...], msg: "..."}]
    return detail.map((d: any) => {
      const field = Array.isArray(d.loc) ? d.loc[d.loc.length - 1] : "";
      const msg = String(d.msg ?? "is invalid").replace(/^Value error, /, "");
      return field && typeof field === "string" ? `${field.replace(/_/g, " ")}: ${msg}` : msg;
    }).join("; ");
  }
  return "Request failed.";
}

type Query = Record<string, string | number | boolean | undefined | null | (string | number)[]>;

export function qs(params?: Query): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    if (Array.isArray(v)) v.forEach((x) => sp.append(k, String(x)));
    else sp.append(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/+$/, "");

export function apiUrl(path: string): string {
  if (!API_BASE_URL || /^https?:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `${API_BASE_URL}${path}` : `${API_BASE_URL}/${path}`;
}

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  let res: Response;
  try {
    res = await fetch(`${apiUrl(path)}${qs(query)}`, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, "Can't reach the Commons server. Check your connection and try again.");
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") ?? "";
  const data = ct.includes("application/json") ? await res.json() : await res.text();
  if (!res.ok) {
    if (res.status === 401 && token) window.dispatchEvent(new Event("commons:unauthorized"));
    throw new ApiError(res.status, readable((data as any)?.detail ?? data));
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>("GET", path, undefined, query),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>("POST", path, body, query),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  del: <T>(path: string) => request<T>("DELETE", path),
};

export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^https?:\/\//i.test(url)) return url;
  if (!API_BASE_URL) return url;
  return url.startsWith("/") ? `${API_BASE_URL}${url}` : `${API_BASE_URL}/${url}`;
}
