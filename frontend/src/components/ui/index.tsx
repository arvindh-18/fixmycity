/**
 * App-level UI primitives, built on the Commons design system (src/design-system).
 * They keep the app's convenient API (loading state, icons, sizes) but render Commons markup:
 * `cv-btn`, `cv-field`, `cv-input`, square frames, status pills only for status.
 */
import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion } from "framer-motion";
import { Loader2, X } from "lucide-react";
import { cn } from "@/utils/format";
import { Icon, type CommonsIcon } from "@/design-system/Commons";

const QUIET = { duration: 0.15, ease: "easeOut" } as const;

// ---------------------------------------------------------------- Button
// Commons has three variants: primary (green-600, once per view), secondary (framed), quiet (underlined).
// Older call sites use accent/primary/ghost/link/danger; they map onto those three. Destructive actions
// are never coloured — the label says what happens ("Reject report").
type Variant = "primary" | "accent" | "secondary" | "ghost" | "quiet" | "danger" | "link";
const VARIANT: Record<Variant, string> = {
  primary: "cv-btn-primary", accent: "cv-btn-primary", secondary: "cv-btn-secondary", danger: "cv-btn-secondary",
  ghost: "cv-btn-quiet", quiet: "cv-btn-quiet", link: "cv-btn-quiet",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined}
      className={cn("cv-btn inline-flex items-center justify-center gap-2 whitespace-nowrap transition-[background,filter,color] duration-150 ease-out",
        VARIANT[variant], size === "sm" && "cv-btn-sm", variant === "link" && "h-auto px-0", className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

// ---------------------------------------------------------------- Form fields (TextField anatomy)
export function Field({ label, hint, error, children, htmlFor, optional }: {
  label: string; hint?: ReactNode; error?: string | null; children: ReactNode; htmlFor?: string; optional?: boolean;
}) {
  return (
    <div className={cn("cv-field", error && "is-error")}>
      <label htmlFor={htmlFor} className="cv-field-label flex items-baseline justify-between gap-2">
        <span>{label}</span>{optional && <span className="t-caption text-mute">Optional</span>}
      </label>
      {children}
      {error ? <p className="cv-field-hint" role="alert">⚠ {error}</p> : hint ? <p className="cv-field-hint">{hint}</p> : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn("cv-input w-full", className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn("cv-input w-full min-h-24 !h-auto py-2", className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn("cv-input w-full appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-9", className)}
      style={{ backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2385857e' stroke-width='2.5'><path d='m6 9 6 6 6-6'/></svg>\")" }} {...p}>
      {children}
    </select>
  );
});

// ---------------------------------------------------------------- Surfaces: square, ruled, no shadow
export function Panel({ className, children, as: As = "section" }: { className?: string; children: ReactNode; as?: any }) {
  return <As className={cn("border border-line bg-paper", className)}>{children}</As>;
}

/** Section heading. `center` follows Commons: centred above content, h1 scale. */
export function SectionTitle({ children, action, sub, className, center }: { children: ReactNode; action?: ReactNode; sub?: ReactNode; className?: string; center?: boolean }) {
  if (center) {
    return (
      <div className={cn("mb-16 text-center", className)}>
        <h2 className="t-h1 mx-auto max-w-[26ch]">{children}</h2>
        {sub && <p className="t-body mx-auto mt-3 max-w-[60ch] text-slate">{sub}</p>}
        {action && <div className="mt-6">{action}</div>}
      </div>
    );
  }
  return (
    <div className={cn("mb-6 flex flex-wrap items-end justify-between gap-3", className)}>
      <div>
        <h2 className="t-h2">{children}</h2>
        {sub && <p className="t-body-sm mt-1 text-slate">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton", className)} aria-hidden />;
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-slate", className)} aria-label="Loading" />;
}

/**
 * Small labels. Tinted pills are reserved for status meaning (resolved, needs attention…);
 * `neutral` is a plain outlined tag for facts like "Sample data" or "Internal".
 */
export function Badge({ children, className, tone = "neutral" }: { children: ReactNode; className?: string; tone?: "neutral" | "teal" | "amber" | "red" | "violet" | "green" | "ink" }) {
  if (tone === "neutral" || tone === "ink") {
    return <span className={cn("t-caption inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border border-line-2 px-1.5 font-medium text-slate", className)}>{children}</span>;
  }
  const tint = { teal: "cv-badge-in-progress", amber: "cv-badge-reported", red: "cv-badge-urgent", violet: "cv-badge-reviewing", green: "cv-badge-resolved" }[tone];
  return <span className={cn("cv-badge", tint, className)}>{children}</span>;
}

export function DemoBadge({ className }: { className?: string }) {
  return <Badge className={className}>Sample data</Badge>;
}

// ---------------------------------------------------------------- Empty states: a framed line icon with one offset accent
const ART: Record<string, { icon: CommonsIcon; fill: string }> = {
  map: { icon: "pin", fill: "var(--sage-300)" },
  inbox: { icon: "megaphone", fill: "var(--yellow-400)" },
  check: { icon: "tree", fill: "var(--sage-300)" },
  chat: { icon: "megaphone", fill: "var(--blue-500)" },
};
export function EmptyState({ title, body, action, art = "map" }: { title: string; body?: ReactNode; action?: ReactNode; art?: "map" | "inbox" | "check" | "chat" }) {
  const a = ART[art];
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="relative">
        <span className="absolute top-2 left-3 size-16" style={{ background: a.fill }} aria-hidden />
        <div className="relative grid size-20 place-items-center border-[1.5px] border-ink bg-raised"><Icon name={a.icon} size={48} /></div>
        <span className="cv-rules mt-2" aria-hidden><i /><i /></span>
      </div>
      <h3 className="t-h3 mt-4">{title}</h3>
      {body && <p className="t-body-sm mt-1.5 max-w-sm text-slate">{body}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- Slide-over sheet & modal: framed, quiet motion
export function Sheet({ open, onOpenChange, title, description, children, width = "max-w-xl", footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; width?: string; footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-ink/20" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={QUIET} />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div className={cn("fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l-[1.5px] border-ink bg-paper", width)}
                initial={{ x: 32, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 32, opacity: 0 }} transition={{ duration: 0.2, ease: "easeOut" }}>
                <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
                  <div>
                    <Dialog.Title className="t-h2">{title}</Dialog.Title>
                    {description ? <Dialog.Description className="t-body-sm mt-0.5 text-slate">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Details</Dialog.Description>}
                  </div>
                  <Dialog.Close className="rounded-sm p-1.5 text-ink hover:bg-paper-2" aria-label="Close"><X className="size-5" /></Dialog.Close>
                </div>
                <div className="scrollbar-thin flex-1 overflow-y-auto px-6 py-6">{children}</div>
                {footer && <div className="border-t border-line px-6 py-4">{footer}</div>}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

export function Modal({ open, onOpenChange, title, description, children, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; footer?: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <Dialog.Portal forceMount>
            <Dialog.Overlay asChild>
              <motion.div className="fixed inset-0 z-40 bg-ink/25" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={QUIET} />
            </Dialog.Overlay>
            <Dialog.Content asChild>
              <motion.div className="cv-float fixed left-1/2 top-1/2 z-50 max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={QUIET}>
                <div className="px-6 pt-6">
                  <Dialog.Title className="t-h2">{title}</Dialog.Title>
                  {description ? <Dialog.Description className="t-body-sm mt-1 text-slate">{description}</Dialog.Description> : <Dialog.Description className="sr-only">Dialog</Dialog.Description>}
                </div>
                <div className="px-6 py-5">{children}</div>
                {footer && <div className="flex justify-end gap-2 border-t border-line px-6 py-4">{footer}</div>}
              </motion.div>
            </Dialog.Content>
          </Dialog.Portal>
        )}
      </AnimatePresence>
    </Dialog.Root>
  );
}

// ---------------------------------------------------------------- Segmented control (tabs)
export function Segmented<T extends string>({ value, onChange, options, className }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; count?: number }[]; className?: string;
}) {
  return (
    <div role="tablist" className={cn("inline-flex border-b border-line", className)}>
      {options.map((o) => (
        <button key={o.value} role="tab" type="button" aria-selected={value === o.value} onClick={() => onChange(o.value)}
          className={cn("t-label -mb-px flex items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 transition-colors duration-150",
            value === o.value ? "border-ink text-ink" : "border-transparent text-slate hover:text-ink")}>
          {o.label}{o.count !== undefined && <span className="num text-mute">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** Errors use danger text plus a written fix — never colour alone. */
export function ErrorNote({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null;
  return <p role="alert" className={cn("t-body-sm border-l-2 border-danger pl-3 text-danger", className)}>⚠ {error instanceof Error ? error.message : String(error)}</p>;
}
