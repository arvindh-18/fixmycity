Commons is a civic reporting platform: residents report what's broken on their street, follow it to the department that owns it, and see it fixed. The look is a calm, editorial weekly — warm paper, a serif voice, hand-drawn line work in square frames, and one sage-green band — so that reporting a problem feels like joining a neighbourhood, not filing a complaint.

## Voice and content

- Speak as a helpful neighbour: plain, warm, specific. Use “you” for the resident and “we” for Commons. Never blame the resident or the council.
- Sentence case everywhere: headings, buttons, badges. No ALL CAPS, no exclamation marks, no emoji in product copy.
- Name the thing and the place: “Streetlight out on Elm Rd”, not “Lighting issue #4821”.
- Say who has it and what happens next: “Sent to Public Works · crew expected 6 Nov”.
- Headlines get one italic phrase for emphasis, in `display-em` or `<em>`: “Be the *first-in* on your neighbourhood”. One per heading, never a whole line.
- Numbers are proof, used sparingly and only when true: “3,251 reports fixed this year”.

## Colour

- Pages sit on `paper`; inputs and media wells on `paper-raised`. Set all text in `ink`; secondary copy in `ink-muted`.
- `green-600` is the single action colour: the primary Button, with `on-green` text. One per view.
- `sage-100` is reserved for the CalloutBand — one tinted band per page. Everything else stays paper.
- Status tints carry meaning only inside a StatusBadge or StatusTimeline: `yellow-200` reported, `stone-200` reviewing or closed, `blue-200` in progress, `sage-200` resolved, `rose-200` urgent. Every status also carries a word and a glyph; never colour alone.
- `sage-300`, `yellow-400`, `blue-500`, `rose-500` are illustration accents: small flat fills behind line art (a highlighter swipe, a sky). Never text, never a whole background.
- Errors use `danger` text plus a written fix. Focus is a 2px solid `focus` ring offset 2px on every interactive element, at least 3:1 on every surface in both themes.
- Dark theme mirrors the same roles; tints go deep and `green-600` lightens, so text on it switches to `on-green`.

## Type

- Two families: `serif` (Libre Baskerville) for every heading and card title, `sans` (Work Sans) for body, labels and UI. Both load from Google Fonts.
- `display` once per page, centred, with an italic accent. Section headings `h1`, centred above their content. Card and feature titles `h3` (serif bold).
- Body copy `body`; descriptions and meta `body-sm` in `ink-muted`; labels, buttons and badges `label`; consent and legal `caption` — nothing smaller.
- Keep measure short: headlines wrap at about 26 characters, body at about 60.

## Space and layout

- Generous air is the brand: `space-24` between sections, `space-16` between a section heading and its content.
- Centre the hero, section headings and signup; content grids are left-aligned beneath them, max 960px wide.
- Grids of frames use a `space-8` gutter and are allowed to stagger vertically (offset alternate items by `space-12`), like snapshots pinned to a board.

## Lines, frames and corners

- Separate with lines, not shadows: there are no drop shadows. `stroke-frame` `ink` frames hold pictures; `stroke-hairline` `rule` lines divide sections and sit under frames as short caption rules.
- Frames, cards and bands are square (`radius-none`). Buttons, fields and checkboxes take `radius-sm`. `radius-pill` belongs only to status badges.

## Illustration and imagery

- Illustrations are single-weight black line drawings (`ink`), loose and friendly, with one or two flat accent fills that sit slightly off the line, like a highlighter. People are drawn, never photographed, in marketing.
- Put an illustration inside a square frame or let it break out of the CalloutBand; never on a coloured circle or blob.
- Resident photos on reports are shown inside the IssueCard frame; blur faces and number plates before display.

## Iconography

- Use the Icons asset group: 48×48 line icons, `ink` at a 2px round stroke, one per report category (pothole, streetlight, waste, water, tree, graffiti) plus pin, camera and megaphone for how-it-works.
- Show them at 64px in a FeatureItem and 88px in an IssueCard media well; never below 24px.
- They are single-ink SVGs drawn in `ink` light (#1d1d1b); in dark theme, invert them (`filter: invert(.94)`) or place them on a `paper-raised` light chip.
- No emoji and no filled icon sets.

## Motion

- Little and quiet: 150ms ease-out on hover colour, no bounces, no parallax. Respect `prefers-reduced-motion`.
