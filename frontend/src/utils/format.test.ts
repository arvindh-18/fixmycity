import { describe, expect, it, vi } from "vitest";
import { ago, countdown, duration, metres, money, pct } from "./format";

describe("format helpers", () => {
  it("formats durations from hours", () => {
    expect(duration(null)).toBe("—");
    expect(duration(0.5)).toBe("30 min");
    expect(duration(30)).toBe("30 h");
    expect(duration(72)).toBe("3.0 days");
    expect(duration(24 * 15)).toBe("15 days");
  });
  it("formats SLA countdowns", () => {
    expect(countdown(90 * 60)).toBe("1h 30m");
    expect(countdown(2 * 86400 + 3600)).toBe("2d 1h");
    expect(countdown(-600)).toBe("10m");
  });
  it("formats percentages, money and distance honestly", () => {
    expect(pct(null)).toBe("—");
    expect(pct(0.756)).toBe("76%");
    expect(money(null)).toBe("Not recorded");
    expect(money(18000)).toMatch(/18,000/);
    expect(metres(850)).toBe("850 m");
    expect(metres(1500)).toBe("1.5 km");
  });
  it("describes relative time", () => {
    vi.useFakeTimers().setSystemTime(new Date("2026-11-04T12:00:00Z"));
    expect(ago("2026-11-04T11:59:50Z")).toBe("just now");
    expect(ago("2026-11-04T09:00:00Z")).toBe("3 h ago");
    expect(ago("2026-11-02T12:00:00Z")).toBe("2 days ago");
    vi.useRealTimers();
  });
});
