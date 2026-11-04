/**
 * Commons design-system components, ported from design/commons-design-system/components/bundle.js
 * to typed React. Markup and class names match the bundle exactly, so `commons.css` styles them
 * and the design-system previews remain the reference. Public API follows `index.d.ts`.
 */
import { forwardRef, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import { Link } from "react-router-dom";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

// ---------------------------------------------------------------- Button
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: "primary" | "secondary" | "quiet"; size?: "md" | "sm" }
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", className, type = "button", ...rest }, ref) {
  return <button ref={ref} type={type} {...rest} className={cx("cv-btn", `cv-btn-${variant}`, size === "sm" && "cv-btn-sm", className)} />;
});

// ---------------------------------------------------------------- TextField
export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; hideLabel?: boolean; hint?: string; error?: string }
export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, hideLabel, hint, error, className, id, ...rest }, ref) {
  const auto = useId();
  const fid = id ?? auto;
  const hintId = `${fid}-hint`;
  const msg = error || hint;
  return (
    <div className={cx("cv-field", error && "is-error", className)}>
      {label && <label htmlFor={fid} className={cx("cv-field-label", hideLabel && "cv-sr")}>{label}</label>}
      <input ref={ref} type="text" {...rest} id={fid} className="cv-input" aria-invalid={error ? true : undefined} aria-describedby={msg ? hintId : undefined} />
      {msg && <p id={hintId} className="cv-field-hint">{error ? `⚠ ${error}` : hint}</p>}
    </div>
  );
});

// ---------------------------------------------------------------- Checkbox
export interface CheckboxProps extends InputHTMLAttributes<HTMLInputElement> { label?: ReactNode }
export function Checkbox({ label, className, id, children, ...rest }: CheckboxProps & { children?: ReactNode }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className={cx("cv-check", className)}>
      <input type="checkbox" {...rest} id={fid} />
      <span className="cv-check-box" aria-hidden />
      <span className="cv-check-label">{label ?? children}</span>
    </label>
  );
}

// ---------------------------------------------------------------- StatusBadge
export type ReportStatus = "reported" | "reviewing" | "in-progress" | "resolved" | "urgent" | "closed";
const BADGE: Record<ReportStatus, [string, string]> = {
  reported: ["Reported", "○"], reviewing: ["Under review", "…"], "in-progress": ["In progress", "→"],
  resolved: ["Resolved", "✓"], urgent: ["Urgent", "!"], closed: ["Closed", "–"],
};
export function StatusBadge({ status = "reported", children, className, glyph }: { status?: ReportStatus; children?: ReactNode; className?: string; glyph?: string }) {
  const d = BADGE[status] ?? BADGE.reported;
  return (
    <span className={cx("cv-badge", `cv-badge-${status}`, className)}>
      <span className="cv-badge-glyph" aria-hidden>{glyph ?? d[1]}</span>{children ?? d[0]}
    </span>
  );
}

// ---------------------------------------------------------------- IssueCard
export interface IssueCardProps { title: ReactNode; media?: ReactNode; status?: ReactNode; location?: string; time?: string; followers?: number; href?: string; className?: string; extra?: ReactNode }
/** `status` accepts a rendered badge so the app's 11 lifecycle states can each name themselves. */
export function IssueCard({ title, media, status, location, time, followers, href, className, extra }: IssueCardProps) {
  const body = (
    <>
      <div className="cv-issue-frame">{media}</div>
      <span className="cv-issue-rules" aria-hidden><i /><i /></span>
      <div className="cv-issue-head">
        <h3 className="cv-issue-title">{title}</h3>
        {status}
      </div>
      {(location || time) && <p className="cv-issue-meta">{[location, time].filter(Boolean).join(" · ")}</p>}
      {followers != null && followers > 0 && <p className="cv-issue-follow">{followers}{followers === 1 ? " neighbour follows this" : " neighbours follow this"}</p>}
      {extra}
    </>
  );
  // Internal links use the router so navigation stays client-side.
  return href ? <Link to={href} className={cx("cv-issue", "is-link", className)}>{body}</Link> : <article className={cx("cv-issue", className)}>{body}</article>;
}

// ---------------------------------------------------------------- FeatureItem
export function FeatureItem({ title, icon, children, className }: { title: ReactNode; icon?: ReactNode; children?: ReactNode; className?: string }) {
  return (
    <div className={cx("cv-feature", className)}>
      {icon && <div className="cv-feature-icon">{icon}</div>}
      <h3 className="cv-feature-title">{title}</h3>
      <p className="cv-feature-body">{children}</p>
    </div>
  );
}

// ---------------------------------------------------------------- CalloutBand
export function CalloutBand({ title, children, action, art, className }: { title: ReactNode; children?: ReactNode; action?: ReactNode; art?: ReactNode; className?: string }) {
  return (
    <section className={cx("cv-band", art ? "has-art" : undefined, className)}>
      <div className="cv-band-copy">
        <h2 className="cv-band-title">{title}</h2>
        {children && <div className="cv-band-body">{children}</div>}
        {action && <div className="cv-band-action">{action}</div>}
      </div>
      {art && <div className="cv-band-art">{art}</div>}
    </section>
  );
}

// ---------------------------------------------------------------- StatusTimeline
export interface TimelineStep { title: string; date?: string; note?: string; state?: "done" | "current" | "upcoming"; extra?: ReactNode }
/** `extra` is an app addition: evidence photos or staff-only labels rendered under a step. */
export function StatusTimeline({ steps, className }: { steps: TimelineStep[]; className?: string }) {
  return (
    <ol className={cx("cv-timeline", className)}>
      {steps.map((s, i) => (
        <li key={i} className={cx("cv-step", `is-${s.state ?? "upcoming"}`)} aria-current={s.state === "current" ? "step" : undefined}>
          <span className="cv-step-dot" aria-hidden>{s.state === "done" ? "✓" : ""}</span>
          <div className="cv-step-text">
            <p className="cv-step-title">{s.title}{s.state === "current" && <span className="cv-sr"> (current)</span>}</p>
            {(s.date || s.note) && <p className="cv-step-note">{[s.date, s.note].filter(Boolean).join(" — ")}</p>}
            {s.extra}
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------- InlineSignup
export function InlineSignup({ label, placeholder, cta, consent, onSubmit, className, disabled, error }: {
  label?: string; placeholder?: string; cta?: string; consent?: ReactNode; onSubmit?: (email: string) => void; className?: string; disabled?: boolean; error?: string;
}) {
  const [v, setV] = useState("");
  return (
    <form className={cx("cv-signup", className)} onSubmit={(e) => { e.preventDefault(); onSubmit?.(v); }}>
      <div className="cv-signup-row">
        <TextField type="email" label={label ?? "Email address"} hideLabel placeholder={placeholder ?? "Enter your email"} value={v} onChange={(e) => setV(e.target.value)} required error={error} />
        <Button type="submit" variant="primary" disabled={disabled}>{cta ?? "Subscribe"}</Button>
      </div>
      {consent && <Checkbox label={consent} required />}
    </form>
  );
}

// ---------------------------------------------------------------- Icons (assets/Icons)
export type CommonsIcon = "pothole" | "streetlight" | "waste" | "water" | "tree" | "graffiti" | "pin" | "camera" | "megaphone";
/** Single-ink line icon. Never below 24px; inverted in dark theme via `.cv-ico`. */
export function Icon({ name, size = 48, alt = "", className }: { name: CommonsIcon; size?: number; alt?: string; className?: string }) {
  return <img src={`/icons/${name}.svg`} width={size} height={size} alt={alt} className={cx("cv-ico", className)} />;
}
