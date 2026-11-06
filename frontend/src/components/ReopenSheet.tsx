import { AlertTriangle, RotateCcw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { Issue } from "../lib/types";
import { Spinner, useToast } from "./ui";

/** "Reopen report": allows residents to flag a fake/inadequate fix so it moves into rechecking state. */
export function ReopenSheet({
  issue,
  onClose,
  onDone,
}: {
  issue: Issue;
  onClose: () => void;
  onDone: (updated: Issue) => void;
}) {
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const updated = await api<Issue>(`/api/issues/${issue.id}/reopen`, {
        method: "POST",
        body: { note: note.trim() },
      });
      toast("Report reopened for rechecking. City admin has been notified.");
      onDone(updated);
    } catch (err) {
      toast((err as Error).message, "err");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink/50 sm:items-center"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reopen report"
        className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-[var(--shadow-lift)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-sans text-lg font-bold tracking-normal text-amber-950">
              Reopen report for rechecking
            </h2>
            <p className="truncate text-sm text-ink-2">
              #{issue.id} · {issue.title}
            </p>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-950">
          <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />
          <p>
            This ticket will be moved into <strong>Rechecking</strong> state (not resolved, not completed) and surfaced to city administration to review the worker's work.
          </p>
        </div>

        <form onSubmit={submit} className="mt-4 space-y-4">
          <div>
            <label className="label" htmlFor="reopen-reason">
              Reason / explanation (optional)
            </label>
            <textarea
              id="reopen-reason"
              className="field"
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Worker uploaded a photo of a different street, or the pothole is only half-filled."
            />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-ghost flex-1 h-12"
              onClick={onClose}
              disabled={busy}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-ink flex-1 h-12 !border-0 bg-amber-600 text-white hover:bg-amber-700"
              disabled={busy}
            >
              {busy ? <Spinner size={16} /> : <RotateCcw size={17} />} Reopen report
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

