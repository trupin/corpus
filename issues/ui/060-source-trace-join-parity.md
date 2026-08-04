# [UI-060] The source trace doesn't reproduce the renderer's block joins, so some turn selections decline

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-051
- Blocks: —

## Spec References
- SPEC.md §11 Thread view, "Commenting on a selection" (SHARED-009 Amendment 2)

## Summary
Found by the Fable review of PR #20, fixed there only to the extent of making it
**safe**. This issue is the correctness half.

UI-051 maps a DOM selection in a turn back to markdown offsets through two
projections that must agree: `renderedRange.ts` (what the browser draws) and
`sourceTrace.ts` (what the markdown says). They do not agree about whitespace.
`mdast-util-to-hast` writes a `"\n"` text node where two blocks join and beside
a markdown hard break; `walk` emits nothing for either, because no markdown was
consumed there. Measured:

| markdown | DOM text | `trace.plain` |
|---|---|---|
| `para one\n\npara two` | `para one\npara two` | `para onepara two` |
| `- foo\n- bar` | `\nfoo\nbar\n` | `foobar` |
| `line one  \nline two` (markdown hard break) | `line one\nline two` | `line oneline two` |

Closing the joins up can **manufacture an occurrence**: `the\n\nnext hen` renders
with one `hen` and traces with two, the second straddling the join. The capture
counted occurrences in the DOM and looked the index up in the trace, and returned
an anchor over `he\n\n` for a selection of `hen`.

**Shipped in PR #20:** a guard in `captureTurnAnchor` — if the two projections
disagree about how many times the quote appears, the capture **declines**. The
confidently-wrong anchor is gone; the cost is that a legitimate selection in a
turn where the join manufactures a collision now offers no comment, and the user
falls back to 💬 on the whole turn.

**What is still owed:** make the projections genuinely agree, so those selections
anchor instead of declining.

## The trap, stated plainly
The obvious fix — emit `"\n"` for block joins and `break` nodes in `walk` — is
not obviously safe. A **typed** newline in a user turn (UI-054's `hardBreaks`)
already carries the `"\n"` in *both* projections and resolves correctly today;
that is the common case and the one a naive change is most likely to break.
Whatever is done here must keep it working, and the list case above shows the
renderer also emits leading and trailing newlines inside a `ul`, so this is
reproducing a real algorithm rather than adding one separator.

Consider whether the honest shape is for the trace to *derive* its plain text
from the same hast the renderer builds, rather than from a parallel walk of the
mdast — two walks of the same tree is the drift this whole module exists to
prevent, and it is the reason the bug was possible.

## Acceptance Criteria
- [ ] The three rows of the table above agree between the two projections
- [ ] `the\n\nnext hen` anchors a selection of `hen` to the real `hen`
      (offsets 10–13) — the assertion PR #20 had to weaken to `toBeNull()`
- [ ] A typed newline in a user turn still resolves, with `hardBreaks` on and off
      — this is the regression to fear; test it first
- [ ] Markdown hard breaks (`  \n` and backslash-newline) resolve
- [ ] List items, nested lists and blockquotes resolve
- [ ] The disagreement guard stays as a backstop, and a test proves it still
      fires if the projections are ever made to disagree again
- [ ] `turnAnchors.test.tsx`'s decline test is restored to asserting the anchor,
      and its comment pointing here is removed

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/sourceTrace.ts` (the `walk` / join handling)
- `apps/ui/src/anchors/renderedRange.ts` if the parity is better achieved there
- `apps/ui/src/thread/turnAnchors.ts` (restore the strict path; keep the guard)
- tests in all three

## Testing Strategy
Property-style: for a set of markdown fixtures covering paragraphs, lists,
blockquotes, hard breaks and typed newlines, assert `renderedTextOf(render(md))`
equals `sourceTraceOf(md).plain`. That single assertion is the invariant the
module claims and currently does not hold.

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
