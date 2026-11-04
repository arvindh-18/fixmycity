import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";
import { AuthProvider } from "@/contexts/AuthContext";

/** Render with the same providers the app uses (router, react-query, auth). */
export function renderWithApp(ui: ReactElement, { route = "/" } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

type Handler = (url: string, init?: RequestInit) => unknown;

/** Replace window.fetch with a router of path → JSON response. Returns the spy for assertions. */
export function mockApi(routes: Record<string, Handler | unknown>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.url;
    const path = url.split("?")[0];
    const key = `${(init?.method ?? "GET").toUpperCase()} ${path}`;
    const hit = key in routes ? routes[key] : path in routes ? routes[path] : undefined;
    if (hit === undefined) return new Response(JSON.stringify({ detail: `No mock for ${key}` }), { status: 404, headers: { "content-type": "application/json" } });
    const body = typeof hit === "function" ? (hit as Handler)(url, init) : hit;
    if (body instanceof Response) return body;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  });
}
