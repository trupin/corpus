# [UI-166] What full screen does to a turn's leading and measure

## Domain
ui

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: UI-156
- Blocks: —

## Spec References
- SPEC.md Section 10 — "UI — the board", Thread view and Document view

## Summary

**UI-156's own recommendation, filed because that issue's warning was exactly
against doing this inside it.**

UI-156 put the kit's stylesheets ahead of the app's, and a turn's **typeface**
became `var(--sans)` on every surface. Its second acceptance criterion asked for
typeface, size, leading and measure to be identical in a column and in full
screen. Typeface is met. Three differences survive, all measured:

| property | column | full screen |
| --- | --- | --- |
| font-size | 12.5px | 13.5px |
| line-height | 1.5 | 1.7 |
| max-width | `none` | `66ch` |

The size difference is `FocusMode.css`'s `.focus .turn-markdown`, at two classes,
which wins in **either** import order — the cascade change cannot reach it.

The leading and measure reach a turn for a different reason worth knowing:
`Turn.tsx` puts `doc-body` beside `turn-markdown`, so `.focus .doc-body`'s
statements about **document prose** land on a **conversation**.

## Why UI-156 did not do it

Two reasons, both recorded there and both good.

1. `max-width` **does not bind today** — a turn measures 488px inside a ~520px
   card, so `66ch` never applies. Changing it would be a change with no effect,
   which is worse than none: it looks fixed.
2. Tightening a turn's leading is a **visible re-theme of the reading path**,
   inside a P1 whose stated risk was silently re-theming a surface nobody looked
   at.

## The question this issue exists to answer

**Should a turn in full screen read as document prose, or as a conversation that
happens to be full screen?** Both are defensible and the product currently does
neither deliberately — it does whatever `.focus .doc-body` says, because a class
is shared.

- If **a conversation**, the fix is to stop `.focus .doc-body` reaching a turn,
  and the three differences resolve on purpose rather than by cascade accident.
- If **document prose**, then the column should match full screen rather than the
  other way round, and the 12.5px/1.5 column turn is the thing that is wrong.

Either answer is a re-theme of a surface people read. It wants a look before a
change.

## Acceptance Criteria

- [ ] The intent is decided and written down, with the rejected reading and why.
- [ ] Whichever is chosen, a turn's typography is decided by a rule that names
      turns, not inherited from a document-prose selector it shares a class with.
- [ ] `design/index.html` is checked. UI-156 found its `.turn-body` is sans and
      carries no `.doc-body` at all, so the mockup already has an opinion here.
- [ ] Before and after screenshots of both surfaces, at the default widths.
- [ ] If `max-width` still cannot bind, say so and leave it alone rather than
      setting a value with no effect.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/reader/FocusMode.css`
- `apps/ui/src/thread/Turn.tsx` — if the class pairing is what changes
- `apps/ui/e2e/cascade-order.spec.ts` — UI-156's guard, extended

### Key Implementation Details

Read UI-156's E2E log first. It carries the measurements above and the two
sweeps that produced them, and its browser sweep is re-runnable — use it to check
what any change here moves, rather than reasoning about specificity.

### Edge Cases
- A turn in a column that is wide enough for `66ch` to bind, which UI-165 says is
  not reachable today.
- A thread opened as a document, whose body is a conversation — UI-156 found the
  width rail had assumed otherwise.

## Testing Strategy

Extend `cascade-order.spec.ts`. The claim is about computed style on a real
turn on both surfaces, so the test is a measurement, not a class assertion.

**Falsify**: revert the rule and watch the measurement part.

## E2E Verification Plan

### Verification Steps
1. Measure a turn in a column and in full screen, before and after
2. Compare both against `design/index.html`

## E2E Verification Log

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
