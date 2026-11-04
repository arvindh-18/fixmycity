# IssueCard

One civic report shown the way the brand draws everything: a square `ink` frame (`stroke-frame`), two short caption rules beneath it, then the serif title, status and meta.

- Consumer provides: `title`, `media` (a photo or a category icon from the Icons group), `status`, `location`, `time` (relative: “2 days ago”), `followers`, and `href` to make the whole card a link.
- Titles name the thing and the place: “Streetlight out on Elm Rd”. No ALL CAPS, no exclamation marks.
- Lay cards out in a grid with a `space-8` gutter; stagger alternate columns down by `space-12` on wide screens to echo the hero frames.
- Resident photos never show faces or number plates; blur before display.
