import type { CommonsIcon } from "@/design-system/Commons";

/**
 * Brand illustration after the Commons cover: staggered square frames with flat accent fills,
 * short ink caption rules, and one line icon in an ink frame. Decorative only.
 */
export function FramesArt({ icon = "megaphone", className }: { icon?: CommonsIcon; className?: string }) {
  return (
    <svg viewBox="0 0 320 300" className={className ?? "h-auto w-full max-w-[320px]"} aria-hidden="true">
      <rect x="20" y="40" width="120" height="150" fill="var(--green-600)" />
      <rect x="150" y="10" width="110" height="90" fill="var(--yellow-400)" />
      <rect x="120" y="120" width="150" height="150" fill="var(--paper-raised)" stroke="var(--ink)" strokeWidth="1.5" />
      <rect x="268" y="96" width="36" height="36" fill="var(--rose-500)" />
      <image href={`/icons/${icon}.svg`} x="147" y="147" width="96" height="96" className="cv-ico" />
      <line x1="20" y1="206" x2="84" y2="206" stroke="var(--ink)" strokeWidth="1.5" />
      <line x1="20" y1="214" x2="52" y2="214" stroke="var(--ink)" strokeWidth="1.5" />
      <line x1="120" y1="284" x2="184" y2="284" stroke="var(--ink)" strokeWidth="1.5" />
      <line x1="120" y1="292" x2="152" y2="292" stroke="var(--ink)" strokeWidth="1.5" />
    </svg>
  );
}
