# Button

Starts or confirms an action. Three variants: **primary** (`green-600` fill, `on-green` text) at most once per view, for the thing the page is for; **secondary** (default: `paper-raised` with a `stroke-frame` `ink` border) for everything else; **quiet** (underlined text) for cancel and tertiary links.

- Consumer provides: `children` (the label), `variant`, `size` (`md` 40px, `sm` 32px for in-card actions), and any native button props (`onClick`, `type`, `disabled`).
- Labels are verb-first, sentence case, two or three words: “Submit report”, “Add a photo”, “Follow”. Never “Click here” or “OK”.
- Corners are `radius-sm`; never round a button into a pill — pills mean status.
- Don't put two primaries side by side; don't use colour to signal a destructive action — say it in the label (“Withdraw report”).
