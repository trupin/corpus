# [UI-062] A document comment sometimes anchors at the very top instead of at the selection

## Domain
ui

## Priority
P1

## Status
todo

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §6 Anchoring (text-quote selectors, the resolution ladder)
- SPEC.md §11 Document view — "Adaptive thread placement… aligned to their
  anchors with connectors"

## Summary
Live report 2026-08-03, with a screenshot: commenting on a selection in a
document sometimes produces a thread card pinned at the **top** of the document
rather than beside the text that was selected.

**The screenshot carries the strongest clue.** The card's quote reads:

```
Moushmi Verma** on repositioning Fernando under Mesbah
```

Note the `**` in the middle. That is raw markdown, and it means the selection
began **inside** a bold run — the user dragged from `Moushmi` (which sits inside
`**Moushmi Verma**`) through to `Mesbah`, so the file's literal slice from that
start offset carries the closing `**`.

**That part is by design, and is probably not the bug.**
`selectorFromSelection.ts` deliberately quotes the markdown source rather than
the screen: "a selection reading `30-year fixed quote` on screen is
`**30-year fixed** quote` in the file, and the server's resolution ladder matches
literally before it matches anything else." A tidier quote would be a quote of a
document that does not exist.

So the capture is plausibly correct and the failure is in **drawing it back** —
the anchor is a legitimate slice of the file, but one whose range starts partway
through inline markup, and something on the placement path cannot express that.

## Reproduce first — this is a bug, and the cause below is a hypothesis
Do not start from the code. Get it failing in the real app, with the workspace
document, and record the evidence in this log:
1. The document's markdown around the anchor (the actual bytes, including the
   `**`).
2. The selector the UI sent on the wire — `exact`, `prefix`, `suffix`.
3. What the server resolved it to: the `range` and whether it came back
   `orphaned`.
4. Where the card was drawn, and whether a highlight was drawn in the body at
   all.

That sequence distinguishes the two candidate causes without guessing:

- **(a) It resolved, but cannot be placed.** `mdRangeToPm`
  (`apps/ui/src/anchors/offsetMap.ts:101`) returns one segment per textblock and
  an **empty array** when a range touches no content. A range that begins inside
  syntax may yield no usable segment, so no highlight is drawn and the card has
  no anchor position to align to — falling back to the top. If so, the fix is in
  placement, and the question is what an anchor that starts mid-markup should
  align to (the first content it *does* cover, most likely).
- **(b) It did not resolve, and orphan placement is wrong.** SPEC §11 says
  orphaned threads are listed **below the body**, with whole-document comments.
  A card at the top would then be a second defect — orphans going to the wrong
  place — and the anchoring itself would be the first.

They call for different fixes, so establish which before writing code.

## Acceptance Criteria
- [ ] Pre-fix reproduction logged with the four pieces of evidence above
- [ ] A comment on a selection that starts or ends inside inline markup
      (`**bold**`, `*italic*`, `` `code` ``, a `[link](url)`) anchors beside the
      selected text
- [ ] The highlight is drawn over the selected words — and specifically does not
      cover the markup characters the user never saw
- [ ] A genuinely orphaned thread still goes where §11 says: below the body, not
      the top
- [ ] Whatever the placement rule is for a range that begins mid-markup, it is
      stated in the code — this is the second bug in this class (see UI-060) and
      the rule should stop being rediscovered
- [ ] Selections wholly inside one text run keep working exactly as today
- [ ] Regression test at the level the bug lives at: a selection whose markdown
      range straddles a markup boundary, asserted end to end rather than only
      over the offset helpers

## Technical Design
### Files to Create/Modify
- `apps/ui/src/anchors/offsetMap.ts` (`mdRangeToPm`), `useAnchorLayer.ts`
  (placement and the no-segment path), possibly the margin-card layout
- tests alongside

### Notes
- Related but distinct: UI-060 is the same *class* of problem (two projections of
  one text disagreeing) in the **thread** path. This one is the **document**
  path, which maps through ProseMirror positions rather than a rendered DOM
  range. Do not fix one by importing the other's assumptions; do check whether
  the two placement rules should agree.
- Do not "fix" this by trimming the markup out of `exact`. That would change what
  the server matches against and is explicitly rejected in
  `selectorFromSelection.ts`'s docblock.

## Testing Strategy
Component/unit tests over the placement path with markup-straddling ranges, plus
an e2e that comments across a bold boundary in the real editor and asserts the
card is aligned to the line rather than the document top.

## E2E Verification Log
_Filled by the implementing agent; state the model. The reproduction above is
mandatory before any code changes._

## Completion Checklist (domain agent)
- [ ] Pre-fix reproduction logged
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
