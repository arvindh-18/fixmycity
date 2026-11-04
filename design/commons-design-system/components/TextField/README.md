# TextField

A labelled single-line input. Always pass a `label`; use `hideLabel` only when a visible heading or the placeholder already names the field (the inline email signup), and the label is still read by screen readers.

- Consumer provides: `label`, optional `hint`, `error` (replaces the hint, turns the border `danger` at 2px and adds ⚠), plus native input props (`type`, `value`, `onChange`, `placeholder`, `required`).
- Hints say what helps, not what's required: “Nearest cross street helps crews find it.”
- Errors say how to fix it in one sentence, never just “Invalid”.
- Border is `line-control` (3:1); focus ring is `focus`.
