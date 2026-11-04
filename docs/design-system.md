# Commons design system — how the app uses it

The source of truth is the design system you supplied, vendored unchanged in
`design/commons-design-system/` (tokens, component bundle, previews, icons, README).

## How it's wired in

| Piece | Where | How |
|---|---|---|
| Tokens (colour light + dark, type, space, radius, stroke) | `frontend/src/design-system/tokens.css` | Generated from `tokens.json` by `python design/build_tokens.py`. Never edited by hand. |
| Component styles | `frontend/src/design-system/commons.css` | `components/bundle.css` verbatim, minus the font `@import` (moved to `index.html`) and the demo `body` rule. Loaded in a CSS layer so layout utilities can still position components. |
| Components | `frontend/src/design-system/Commons.tsx` | The 9 components from `bundle.js` ported to typed React with identical markup and class names: Button, TextField, Checkbox, StatusBadge, IssueCard, FeatureItem, CalloutBand, StatusTimeline, InlineSignup, plus `Icon` for the Icons group. |
| Icons | `frontend/public/icons/*.svg` | The 9 line icons; inverted in dark theme via `.cv-ico`. |
| Fonts | `frontend/index.html` | Libre Baskerville + Work Sans from Google Fonts, as the system specifies. |
| Tailwind bridge | `frontend/src/index.css` | Tailwind colour names point at Commons roles (e.g. `teal` → `green-600`, `line` → `rule`), radii follow Commons (square frames, 3px controls), shadows are off. Type-scale classes `t-display`, `t-h1`… `t-caption` match `tokens.json`. |

## Mapping decisions

**Statuses.** Commons has six badge statuses; the app has eleven lifecycle states. Each state uses a Commons
tint plus its own word and glyph (`frontend/src/utils/status.ts`):

| App state | Badge tint | Word · glyph |
|---|---|---|
| submitted, reopened | reported (yellow-200) | Reported ○ · Reopened ↺ |
| pending_verification, on_hold, awaiting_verification | reviewing (stone-200) | Under review … · On hold ‖ · Fixed, waiting for your check ? |
| verified, assigned, in_progress, escalated | in-progress (blue-200) | Verified → · Crew assigned → · In progress → · Escalated ↑ |
| resolved | resolved (sage-200) | Resolved ✓ |
| rejected | closed (stone-200, muted) | Closed – |

`urgent` (rose-200) is never derived from status. Following the system ("danger to people, not old or
popular"), it appears only for open issues an official marked **critical**, as an extra badge.

**Accountability trail → StatusTimeline.** Everything that happened is a done step; the latest is current;
the remaining steps are listed as upcoming, naming the department once routed ("Sent to Roads & Infrastructure"),
so a resident is never left guessing who has it.

**Map markers** use the illustration accents (yellow-400 reported, blue-500 in progress, sage-300 waiting for
a check, green-600 resolved, stone for closed) with an ink outline; the legend always names each status.
This replaces the red/orange/purple scheme from the original brief.

**One primary per view.** The header's "Report an issue" is a secondary button so each page keeps its own
single green action.

**Tints only for status.** Info and warning boxes became ruled notes (a 2px ink rule on the left); errors use
`danger` text with ⚠ and a written fix. The only large tinted surface is the CalloutBand on the landing page.

**InlineSignup** is used under a report ("Get updates on this report") for visitors without an account. It is
backed by a double-opt-in email subscription with one-click unsubscribe.

**Dark theme** follows the device setting, with a toggle in the header (system → dark → light).

## Additions made for the app (not in the supplied system)

- `IssueCard` accepts a rendered status badge (to name the app's states) and an `extra` slot (sample-data and urgent labels).
- `StatusTimeline` steps accept an `extra` slot for evidence photos and staff-only labels.
- `FramesArt` (`components/Art.tsx`): a reusable illustration drawn from the Commons cover (staggered frames,
  accent fills, caption rules, one framed icon).
- A small `.cv-issue-head` wrap rule so badges drop under long titles in narrow grid columns.
- Lucide line icons fill gaps where the Icons group has no category icon (traffic, sanitation, infrastructure);
  they're drawn at a 2px or lighter stroke in `ink`.

If you update the design system, replace `design/commons-design-system/`, run `python design/build_tokens.py`,
and re-copy `components/bundle.css` into `commons.css`.
