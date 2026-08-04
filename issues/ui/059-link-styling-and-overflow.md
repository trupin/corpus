# [UI-059] Links in rendered bodies are unstyled, and long URLs overflow the measure

## Domain
ui

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- `design/index.html` is authoritative for look and feel
- SPEC.md §11 Thread view / Document view

## Summary
Live report 2026-08-03, with a screenshot: a pasted Google Docs URL in a thread
turn renders as a browser-default blue underlined link that **runs past the right
edge of the card** and breaks mid-token across two lines, with the second line
clipped.

**Cause, verified:** `packages/kit/src/markdown/markdown.css` has **no rule for
links in rendered bodies at all** — no `.doc-body a`. So:

1. **Styling** is the user-agent default (blue `#0000EE`, plain underline), which
   is not the app's link treatment. Note the file *does* style other inline
   things deliberately (`text-decoration: none` for refs at :251, strikethrough
   for done task items at :268), so links were simply missed rather than left
   default on purpose.
2. **Overflow** — a URL has no spaces to break at, and nothing sets
   `overflow-wrap` for body text. UI-050 has just added `overflow-wrap: anywhere`
   to `.doc-body pre` for exactly this reason inside fences; the same
   consideration was never applied to prose. The reading measure is `62ch`
   (`.doc-body`), so any URL longer than that overflows its container.

The fence half of this problem is already solved in the same file; this is the
prose half.

## Acceptance Criteria
- [ ] Links in rendered bodies use the app's link treatment, taken from
      `design/index.html` rather than invented here — state what the mockup says
- [ ] A URL longer than the measure wraps inside its container; nothing is
      clipped or painted outside the card, at any column width
- [ ] Wrapping breaks the URL only where it would otherwise overflow — ordinary
      prose and ordinary short links break between words as before
- [ ] Applies in every rendered surface — reader, thread turns, focus mode,
      plugin bodies — since all render through `MarkdownView`
- [ ] `[[ref]]` links keep their existing distinct treatment (`text-decoration:
      none` at markdown.css:251) and are not swept into the new rule
- [ ] The editor's rendering of links stays consistent with the read view — check
      both, since the document body renders through TipTap, not `MarkdownView`
- [ ] Visited/hover/focus states are deliberate, and focus is visible for
      keyboard users
- [ ] A test pins the overflow behavior with a long URL fixture

## Technical Design
### Files to Create/Modify
- `packages/kit/src/markdown/markdown.css` (the link rule)
- possibly `apps/ui/src/editor/editor.css` for parity in the editor
- tests

### Notes
- UI-050 landed `white-space: pre-wrap; overflow-wrap: anywhere` on `.doc-body
  pre` in this same file, with a docblock explaining the reasoning for fences.
  Read it first — the prose rule should be consistent with it and should not
  restate the argument.

## Testing Strategy
Component test with a long-URL fixture asserting the rendered box does not exceed
its container. Visual check against `design/index.html`.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
