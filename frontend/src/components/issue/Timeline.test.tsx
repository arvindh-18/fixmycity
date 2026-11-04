import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { Timeline } from "./Timeline";
import type { TimelineItem } from "@/types";

const items: TimelineItem[] = [
  { id: "1", type: "status", status: "submitted", at: "2026-10-01T09:00:00Z", title: "Reported", body: "Report submitted", actor: "The reporter", is_public: true },
  { id: "2", type: "status", status: "verified", at: "2026-10-01T12:00:00Z", title: "Verified", body: "Priority high", actor: "An official", is_public: true },
  { id: "3", type: "update", kind: "progress", at: "2026-10-02T08:00:00Z", title: "Progress update", body: "BT mix ordered", actor: "Ravi Kumar", is_public: false, summary_status: "pending", public_summary: "Work update: tar ordered.", summary_source: "rules" },
  { id: "4", type: "evidence", at: "2026-10-03T08:00:00Z", title: "Completion evidence submitted", body: "Filled", actor: "Field team", is_public: true, review_status: "disputed", images: [{ url: "/media/a.jpg", kind: "after" }] },
];

describe("Timeline (Commons StatusTimeline)", () => {
  it("lists what happened, with who did it, as done steps", () => {
    render(<Timeline items={items.slice(0, 2)} status="resolved" />);
    const steps = screen.getAllByRole("listitem");
    expect(steps).toHaveLength(2);
    steps.forEach((s) => expect(s).toHaveClass("is-done"));
    expect(screen.getByText(/by an official/)).toBeInTheDocument();
  });

  it("marks the latest step as current and names what happens next, including the department", () => {
    render(<Timeline items={items.slice(0, 2)} status="verified" department="Roads & Infrastructure" />);
    const current = screen.getByRole("listitem", { current: "step" });
    expect(within(current).getByText("Verified")).toBeInTheDocument();
    expect(within(current).getByText("(current)")).toBeInTheDocument();
    expect(screen.getByText("A crew is assigned").closest("li")).toHaveClass("is-upcoming");
    expect(screen.getByText("You confirm it's fixed")).toBeInTheDocument();
  });

  it("names the department while a report is still being routed", () => {
    render(<Timeline items={items.slice(0, 1)} status="submitted" department="Water Supply" />);
    expect(screen.getByText("Sent to Water Supply")).toBeInTheDocument();
  });

  it("shows evidence photos and dispute state, and internal entries only to staff", () => {
    const { rerender } = render(<Timeline items={items} status="reopened" />);
    expect(screen.getByAltText("after photo")).toHaveAttribute("src", "/media/a.jpg");
    expect(screen.getByText(/Disputed by reporter/)).toBeInTheDocument();
    expect(screen.queryByText("Internal")).not.toBeInTheDocument();
    rerender(<Timeline items={items} status="reopened" showInternal />);
    expect(screen.getByText("Internal")).toBeInTheDocument();
    expect(screen.getByText("Summary awaiting approval")).toBeInTheDocument();
    expect(screen.getByText(/by Ravi Kumar/)).toBeInTheDocument(); // names keep their capitals
  });
});
