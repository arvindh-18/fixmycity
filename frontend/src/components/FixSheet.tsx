import { Camera, CheckCircle2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { shrinkImage } from "../lib/image";
import type { Issue } from "../lib/types";
import { Spinner, useToast } from "./ui";

/** "Mark fixed": the worker must add an after photo as proof. */
export function FixSheet({ issue, onClose, onDone }: { issue: Issue; onClose: () => void; onDone: (i: Issue) => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  async function pick(file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return toast("Choose a photo (JPG, PNG or WebP).", "err");
    const small = await shrinkImage(file);
    setPhoto(small);
    setPreview(URL.createObjectURL(small));
  }

  async function submit() {
    if (!photo) return toast("Add a photo of the finished work first.", "err");
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("photo", photo, "after.jpg");
      fd.append("note", note);
      const updated = await api<Issue>(`/api/issues/${issue.id}/fix`, { body: fd });
      toast("Marked as fixed. Thank you!");
      onDone(updated);
    } catch (e) {
      toast((e as Error).message, "err");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[2000] flex items-end justify-center bg-ink/50 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mark as fixed"
        className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-[var(--shadow-lift)] sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-sans text-lg font-bold tracking-normal">Mark as fixed</h2>
            <p className="truncate text-sm text-ink-2">#{issue.id} · {issue.title}</p>
          </div>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])} aria-label="After photo" />
        <button type="button" onClick={() => input.current?.click()}
          className="mt-4 flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-2xl border-2 border-dashed border-line-2 bg-chalk">
          {preview ? <img src={preview} alt="After photo" className="size-full object-cover" /> : (
            <span className="flex flex-col items-center gap-2 text-ink-2">
              <span className="flex size-14 items-center justify-center rounded-full bg-paint text-ink"><Camera size={26} /></span>
              <span className="font-semibold">Take an “after” photo</span>
              <span className="text-xs text-ink-3">Required. It shows residents the work is done.</span>
            </span>
          )}
        </button>
        <textarea className="field mt-3" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="What did you do? (optional) e.g. Filled and levelled the pothole." />
        <button className="btn-ink mt-4 h-12 w-full text-base" onClick={submit} disabled={busy || !photo}>
          {busy ? <Spinner /> : <CheckCircle2 size={19} />} Mark fixed
        </button>
      </div>
    </div>
  );
}
