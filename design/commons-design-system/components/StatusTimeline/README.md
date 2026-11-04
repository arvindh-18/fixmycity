# StatusTimeline

The history of one report as a vertical line of steps: solid `ink` line through what's done, dashed `line-control` line to what's next.

- Consumer provides: `steps`, each `{title, date?, note?, state: 'done' | 'current' | 'upcoming'}`.
- Done dots are `sage-200` with a ✓, the current one `yellow-200`, upcoming ones empty. The current step is announced as “(current)”.
- Name the department a report was routed to (“Sent to Public Works”) and give expected dates when known; never leave a resident guessing who has it.
