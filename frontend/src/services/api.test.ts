import { describe, expect, it, vi } from "vitest";
import { api, ApiError, apiUrl, mediaUrl, qs, tokenStore } from "./api";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("api client", () => {
  it("builds query strings, repeating array values and skipping empties", () => {
    expect(qs({ status: ["submitted", "verified"], q: "", page: 2, x: undefined })).toBe("?status=submitted&status=verified&page=2");
    expect(qs({})).toBe("");
  });

  it("sends the bearer token", async () => {
    tokenStore.set("abc");
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ ok: true }));
    await api.get("/api/auth/me");
    expect((spy.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer abc" });
  });

  it("turns validation errors into readable messages", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ detail: [{ loc: ["body", "full_name"], msg: "String should have at least 2 characters" }] }, 422));
    await expect(api.post("/api/auth/register", {})).rejects.toThrow("full name: String should have at least 2 characters");
  });

  it("signals an expired session on 401", async () => {
    tokenStore.set("expired");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(json({ detail: "Sign in to continue." }, 401));
    const listener = vi.fn();
    window.addEventListener("commons:unauthorized", listener);
    const err = (await api.get("/api/notifications").catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(401);
    expect(listener).toHaveBeenCalled();
  });

  it("reports network failures plainly", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(api.get("/api/meta")).rejects.toThrow(/Can't reach the Commons server/);
  });

  it("handles mediaUrl for relative and absolute URLs", () => {
    expect(mediaUrl(null)).toBeUndefined();
    expect(mediaUrl(undefined)).toBeUndefined();
    expect(mediaUrl("https://example.supabase.co/storage/v1/object/public/bucket/img.jpg"))
      .toBe("https://example.supabase.co/storage/v1/object/public/bucket/img.jpg");
    expect(mediaUrl("/media/issues/abc.jpg")).toBe("/media/issues/abc.jpg");
  });

  it("prefixes relative paths with apiUrl when base is set or leaves unchanged when unset", () => {
    expect(apiUrl("/api/health")).toBe("/api/health");
  });
});
