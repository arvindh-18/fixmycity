# StatusBadge

A pill that names where a report is in its life. Six statuses, each with a word and a glyph so colour is never the only signal: `reported` (`yellow-200`), `reviewing` (`stone-200`), `in-progress` (`blue-200`), `resolved` (`sage-200`), `urgent` (`rose-200`), `closed` (`stone-200`, muted text).

- Consumer provides: `status`; `children` only to override the default word.
- `radius-pill` belongs to badges alone. Text is always `ink` on the tint.
- `urgent` is for danger to people, not for “old” or “popular” reports.
