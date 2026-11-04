import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockApi, renderWithApp } from "@/test/utils";
import ReportPage from "./ReportPage";

// MapLibre needs WebGL, which jsdom doesn't have. Replace the maps with simple stand-ins.
vi.mock("@/components/map/LocationPicker", () => ({
  LocationPicker: ({ onChange }: { onChange: (v: { lat: number; lng: number }) => void }) => (
    <button type="button" onClick={() => onChange({ lat: 12.97, lng: 77.6 })}>Drop pin</button>
  ),
}));
vi.mock("@/components/map/IssueMap", () => ({ IssueMap: () => <div data-testid="map" /> }));

const META = {
  city: { name: "Testpur", lat: 12.97, lng: 77.6 },
  categories: [
    { id: "c-road", name: "Roads and potholes", slug: "roads-potholes", icon: "construction", description: null, default_department_id: null },
    { id: "c-water", name: "Water supply and leakage", slug: "water-supply", icon: "droplets", description: null, default_department_id: null },
  ],
  departments: [], localities: [], statuses: [], transitions: [], ai: { mode: "rules", provider: "rules" },
};

function setup(extra: Record<string, unknown> = {}) {
  const submitted: FormData[] = [];
  const fetchSpy = mockApi({
    "/api/meta": META,
    "POST /api/ai/classify": { category_id: "c-road", category_name: "Roads and potholes", confidence: 0.8, summary: "", detected_problem: "", mode: "rules", safety_flags: [] },
    "POST /api/issues/check-duplicates": [],
    "POST /api/issues": (_u: string, init?: RequestInit) => {
      submitted.push(init!.body as FormData);
      return { tracking_id: "CM-2026-ABC234", id: "i1", anonymous_token: "secret-token-123", issue: {} };
    },
    ...extra,
  });
  renderWithApp(<ReportPage />, { route: "/report" });
  return { submitted, fetchSpy };
}

describe("Report an issue", () => {
  it("won't continue until the description step is valid", async () => {
    setup();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getByText(/at least 5 characters/)).toBeInTheDocument();
    expect(screen.getByText(/at least 15 characters/)).toBeInTheDocument();
    expect(screen.getByText(/Choose the category/)).toBeInTheDocument();
  });

  it("offers the AI category suggestion, which the citizen can accept", async () => {
    setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Title"), "Deep pothole at bus stop");
    await user.type(screen.getByLabelText("What's the problem?"), "A deep pothole has opened and bikes are falling.");
    const accept = await screen.findByRole("button", { name: "Use this" }, { timeout: 3000 });
    expect(screen.getByText(/rule-based suggestion/)).toBeInTheDocument();
    await user.click(accept);
    expect(screen.getByRole("button", { name: /Roads and potholes/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("walks through all steps, requires location confirmation, and submits an anonymous report", async () => {
    const { submitted } = setup();
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Title"), "Water pipe leaking");
    await user.type(screen.getByLabelText("What's the problem?"), "Clean water has been leaking onto the road for two days.");
    await user.click(screen.getByRole("button", { name: /Water supply and leakage/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));

    await user.click(await screen.findByRole("button", { name: "Drop pin" }));
    await user.type(screen.getByLabelText(/Street or landmark/), "Temple Street");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Continue" })); // photos are optional

    await user.click(await screen.findByRole("button", { name: "Submit report" }));
    expect(await screen.findByText(/Confirm the location is correct\./)).toBeInTheDocument();
    expect(submitted).toHaveLength(0);

    await user.click(await screen.findByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit report" }));
    await waitFor(() => expect(submitted).toHaveLength(1));
    const fd = submitted[0];
    expect(fd.get("category_id")).toBe("c-water");
    expect(fd.get("lat")).toBe("12.97");
    expect(fd.get("address")).toBe("Temple Street");

    expect(await screen.findByText("CM-2026-ABC234")).toBeInTheDocument();
    expect(screen.getByText("secret-token-123")).toBeInTheDocument(); // anonymous reporter gets a private code
  });

  it("shows similar nearby reports before submitting", async () => {
    setup({
      "POST /api/issues/check-duplicates": [{ issue_id: "x", tracking_id: "CM-2026-DUP111", title: "Leaking pipe near temple", status: "in_progress",
        category: "Water supply and leakage", distance_m: 40, score: 0.82, signals: { distance: 0.9, same_category: true, text_similarity: 0.6 } }],
    });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Title"), "Water pipe leaking");
    await user.type(screen.getByLabelText("What's the problem?"), "Clean water has been leaking onto the road for two days.");
    await user.click(screen.getByRole("button", { name: /Water supply and leakage/ }));
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Drop pin" }));
    expect(await screen.findByText("Similar reports nearby")).toBeInTheDocument();
    expect(screen.getByText("Leaking pipe near temple")).toBeInTheDocument();
    expect(screen.getByText(/40 m away/)).toBeInTheDocument();
  });
});
