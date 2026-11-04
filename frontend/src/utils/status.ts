import type { Priority, Status } from "@/types";
import type { ReportStatus } from "@/design-system/Commons";

/**
 * How the app's 11 lifecycle states appear in Commons.
 * - `badge`: which Commons StatusBadge tint to use (reported / reviewing / in-progress / resolved / closed).
 *   `urgent` is never derived from status: it's only for hazards to people (critical priority, see isUrgent).
 * - `glyph`: every status carries a word and a glyph so colour is never the only signal.
 * - `marker`: map marker fill, from the illustration accents (small flat fills with an ink outline).
 */
export const STATUS: Record<Status, { label: string; short: string; group: "pending" | "active" | "review" | "done" | "closed"; badge: ReportStatus; glyph: string; marker: string; fg: string; bg: string }> = {
  submitted:             { label: "Reported",             short: "Reported",       group: "pending", badge: "reported",    glyph: "○", marker: "#f2c94c", fg: "text-ink", bg: "bg-yellow-200" },
  pending_verification:  { label: "Under review",         short: "Under review",   group: "pending", badge: "reviewing",   glyph: "…", marker: "#f2c94c", fg: "text-ink", bg: "bg-stone-200" },
  reopened:              { label: "Reopened",             short: "Reopened",       group: "pending", badge: "reported",    glyph: "↺", marker: "#f2c94c", fg: "text-ink", bg: "bg-yellow-200" },
  verified:              { label: "Verified, waiting for a crew", short: "Verified", group: "active", badge: "in-progress", glyph: "→", marker: "#5b9bd5", fg: "text-ink", bg: "bg-blue-200" },
  assigned:              { label: "Crew assigned",        short: "Crew assigned",  group: "active",  badge: "in-progress", glyph: "→", marker: "#5b9bd5", fg: "text-ink", bg: "bg-blue-200" },
  in_progress:           { label: "In progress",          short: "In progress",    group: "active",  badge: "in-progress", glyph: "→", marker: "#5b9bd5", fg: "text-ink", bg: "bg-blue-200" },
  on_hold:               { label: "On hold",              short: "On hold",        group: "active",  badge: "reviewing",   glyph: "‖", marker: "#5b9bd5", fg: "text-ink", bg: "bg-stone-200" },
  escalated:             { label: "Escalated",            short: "Escalated",      group: "active",  badge: "in-progress", glyph: "↑", marker: "#5b9bd5", fg: "text-ink", bg: "bg-blue-200" },
  awaiting_verification: { label: "Fixed, waiting for your check", short: "Awaiting check", group: "review", badge: "reviewing", glyph: "?", marker: "#a7ccb0", fg: "text-ink", bg: "bg-stone-200" },
  resolved:              { label: "Resolved",             short: "Resolved",       group: "done",    badge: "resolved",    glyph: "✓", marker: "#2f6b41", fg: "text-ink", bg: "bg-sage-200" },
  rejected:              { label: "Closed",               short: "Closed",         group: "closed",  badge: "closed",      glyph: "–", marker: "#b9b8b1", fg: "text-mute", bg: "bg-stone-200" },
};

export const STATUS_GROUPS = [
  { key: "pending", label: "Reported", statuses: ["submitted", "pending_verification", "reopened"] as Status[], color: "#f2c94c" },
  { key: "active", label: "In progress", statuses: ["verified", "assigned", "in_progress", "on_hold", "escalated"] as Status[], color: "#5b9bd5" },
  { key: "review", label: "Waiting for a check", statuses: ["awaiting_verification"] as Status[], color: "#a7ccb0" },
  { key: "done", label: "Resolved", statuses: ["resolved"] as Status[], color: "#2f6b41" },
  { key: "closed", label: "Closed", statuses: ["rejected"] as Status[], color: "#b9b8b1" },
];

export const PRIORITY: Record<Priority, { label: string; fg: string; dot: string; weight: number }> = {
  critical: { label: "Critical", fg: "text-ink", dot: "bg-rose-500", weight: 4 },
  high: { label: "High", fg: "text-ink", dot: "bg-yellow-400", weight: 3 },
  medium: { label: "Medium", fg: "text-ink", dot: "bg-blue-500", weight: 2 },
  low: { label: "Low", fg: "text-slate", dot: "bg-sage-300", weight: 1 },
};

/** Commons reserves "urgent" for danger to people: open issues an official has marked critical. */
export const isUrgent = (status: Status, priority: Priority | null) =>
  priority === "critical" && !["resolved", "rejected"].includes(status);

export const ACTION_LABEL: Partial<Record<Status, string>> = {
  pending_verification: "Start review",
  on_hold: "Put on hold",
  escalated: "Escalate",
  in_progress: "Send back to crew",
  resolved: "Mark resolved",
  reopened: "Reopen",
};
