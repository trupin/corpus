# [UI-156] The kit's stylesheets load after the app's, so a turn changes typeface in full screen

## Domain
ui

## Priority
P1

## Status
todo

## Model
opus

## Dependencies
- Depends on: UI-145 (which found it)
- Related: SHARED-061 (the size rule UI-145 was fixing when this surfaced)

## Spec References
- SPEC.md §10 — "UI — the board" (the reader and the thread view)
- `design/index.html:329` — turn bodies are sans

## Summary

Found by UI-145's implementer while sweeping for other cascade ties, and
**measured in a browser rather than read off a stylesheet**. Not folded into
UI-145: that issue is a menu height, and this one changes typography on the
reading path.

`apps/ui/src/main.tsx` imports `./app/App` **above** its kit stylesheets, so
every rule in `packages/kit` is injected after every rule in `apps/ui`. Any
one-class app selector that ties a one-class kit selector therefore loses.

UI-145's own tie (`.ctx-menu` losing to `.ac-menu`) is fixed. Two more are live:

- `.turn-markdown` loses to `.doc-body` on `font-family`, `font-size`,
  `line-height` and `max-width`.
- `.thread-conversation` loses to `.doc-body` on `font-family` and `font-size`.

A real turn in a column reader measures
`{"fontFamily": "Iowan Old Style", "fontSize": "15px", "maxWidth": "517px"}`
where `Reader.css` asks for `var(--sans)`, `12.5px` and `max-width: none`.

**The visible symptom**: `FocusMode.css`'s `.focus .turn-markdown` carries two
classes and wins, so **the same turn changes typeface when it enters full
screen**. A reader who opens a conversation full screen sees the type change
under them.

## Why it is filed rather than fixed

The root cause is one line, and flipping it repaints the reading path — every
turn, in both the column reader and full screen. That is a look-and-feel change
that wants a before/after review against `design/index.html`, not a side effect
of a menu-height fix landing in a release named for navigation.

Three other candidate pairs were checked at the call site and are false
positives: `.cp-item`/`.ac-item` (a ternary, never both) and `.chip`/`.r-chip`
(`chipClass` is only ever `r-reply`, `r-form`, `r-stale` or empty).

## Acceptance Criteria
- [ ] `main.tsx` imports the kit stylesheets before `./app/App`, or the app's
      rules are made to win by a mechanism that does not depend on import order
- [ ] A turn's typeface, size, line height and measure are identical in a column
      reader and in full screen, measured in a browser
- [ ] The measured values match what `Reader.css` declares and what
      `design/index.html` draws
- [ ] A test fails if the import order is flipped back — a cascade tie is
      invisible to any test that does not measure a computed style
- [ ] The reading path is reviewed against `design/index.html` before and after,
      and the review is recorded here

## Testing Strategy
Vitest cannot see this: it is a cascade outcome in a real browser. Playwright,
reading `getComputedStyle` on a painted turn in both surfaces.

## E2E Verification Plan
### Verification Steps
1. Open a thread in a column reader, measure the turn body.
2. Open the same thread in full screen, measure the same turn body.
3. Both must agree, and both must match `Reader.css`.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[UI-156]` prefix
