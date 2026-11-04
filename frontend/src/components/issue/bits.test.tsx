import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriorityTag, SLAMeter, StatusChip, UrgentBadge } from "./bits";
import type { SLAState } from "@/types";

const hrs = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe("StatusChip (Commons StatusBadge)", () => {
  it("names the state in words with a glyph, on the right tint", () => {
    const { container } = render(<StatusChip status="awaiting_verification" />);
    expect(screen.getByText("Fixed, waiting for your check")).toBeInTheDocument();
    expect(container.querySelector(".cv-badge-reviewing")).not.toBeNull();
    expect(container.querySelector(".cv-badge-glyph")).toHaveTextContent("?");
  });
  it("uses the resolved tint and a tick for resolved reports", () => {
    const { container } = render(<StatusChip status="resolved" size="sm" />);
    expect(container.querySelector(".cv-badge-resolved")).toHaveTextContent("✓Resolved");
  });
});

describe("UrgentBadge", () => {
  it("appears only for open critical issues (danger to people)", () => {
    const { rerender, container } = render(<UrgentBadge status="in_progress" priority="critical" />);
    expect(container.querySelector(".cv-badge-urgent")).not.toBeNull();
    rerender(<UrgentBadge status="resolved" priority="critical" />);
    expect(container.querySelector(".cv-badge-urgent")).toBeNull();
    rerender(<UrgentBadge status="in_progress" priority="high" />);
    expect(container.querySelector(".cv-badge-urgent")).toBeNull();
  });
});

describe("PriorityTag", () => {
  it("says when no priority is set yet", () => {
    render(<PriorityTag priority={null} />);
    expect(screen.getByText("Priority not set")).toBeInTheDocument();
  });
});

describe("SLAMeter", () => {
  it("never claims an issue is overdue without a deadline", () => {
    const sla: SLAState = { state: "none", due_at: null, seconds_remaining: null, elapsed_seconds: null };
    render(<SLAMeter sla={sla} />);
    expect(screen.getByText(/No deadline yet/)).toBeInTheDocument();
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });
  it("counts down to the deadline", () => {
    render(<SLAMeter sla={{ state: "on_track", due_at: hrs(5), seconds_remaining: 5 * 3600, elapsed_seconds: 3600 }} />);
    expect(screen.getByText(/\d+h \d+m left/)).toBeInTheDocument();
  });
  it("shows how late an overdue issue is, with a warning glyph not just colour", () => {
    render(<SLAMeter sla={{ state: "overdue", due_at: hrs(-3), seconds_remaining: -3 * 3600, elapsed_seconds: 30 * 3600 }} compact />);
    expect(screen.getByText(/⚠ Overdue by 3h/)).toBeInTheDocument();
  });
});
