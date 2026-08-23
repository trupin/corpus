# [UI-165] A column's thread margin cannot be reached by any gesture

## Domain
ui

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: UI-163
- Blocks: —

## Spec References
- SPEC.md Section 10 — Document view: _"in focus mode and wide layouts, threads
  sit Docs-style in the right margin, aligned to their anchors with connectors;
  in narrow columns they sit as chips at the anchor"_
- SPEC.md Section 10 — the fills-its-reader rider (signed 2026-08-23): _"Where a
  reader gives its body less than its full width — anchored threads in the margin
  are the case that exists"_

## Summary

**Found by UI-163's implementer while proving the rider's margin clause, and
escalated rather than guessed at.**

Two numbers make the column's margin mode dead code:

- `MARGIN_MIN_WIDTH` is **1100**, measured on `.doc-main`
- `MAX_COLUMN_WIDTH` is **960**, which is about **916** of content

A column cannot be dragged wide enough to earn a margin. So the "wide layouts"
half of §10's adaptive placement is reachable only in focus mode, and a column
always falls to the chips-at-the-anchor form however wide the user makes it.

This is not a regression from UI-163. Both constants predate it. UI-163 surfaced
it because the signed rider names the margin as *the* case where a reader gives
its body less than its full width, and proving that clause in a column required
applying `.with-margin` to the stylesheet directly — a test reaching past a
gesture no user can make. That is stated loudly in the spec file and in UI-163's
log rather than left implicit.

## The decision this issue needs

Three answers, and this is a product call rather than an implementation one:

1. **Lower `MARGIN_MIN_WIDTH`** so a wide column earns its margin. The margin
   card is 300px plus a 30px gap, so a 916px column would leave ~586px of body —
   narrower than the reading measure focus mode defaults to, but not absurd.
2. **Raise `MAX_COLUMN_WIDTH`** so a column can reach 1100. That makes one column
   most of a screen, which is what focus mode is for.
3. **Say the margin is focus mode's**, and amend §10 so "wide layouts" names the
   surface rather than a width. Honest, costs nothing, and makes the two
   constants agree with the spec instead of contradicting it.

**3 is the cheapest and 1 is the most faithful to the sentence as written.** Both
are defensible. Choosing needs the user, because §10's current wording promises
a behaviour the product does not deliver at any width, and either the wording or
the width has to move.

## Acceptance Criteria

- [ ] The choice is made and written down, with the two rejected options and why
      each lost.
- [ ] If the answer changes a constant, a column can reach the margin **by
      dragging its edge**, and an e2e test proves it without touching the
      stylesheet.
- [ ] If the answer changes §10, the amendment is drafted, read back to the user,
      and signed before it is applied.
- [ ] UI-163's e2e spec stops reaching past a gesture, or says permanently why it
      must.

## Technical Design

### Files to Create/Modify
- `apps/ui/src/anchors/` and `apps/ui/src/board/columnWidth.ts` — the constants
- `apps/ui/e2e/doc-width.spec.ts` — the margin assertion
- `SPEC.md` §10 — only under option 3, and only after a signature

### Key Implementation Details

Read UI-163's E2E Verification Log first. It records the measurement and the
workaround, and the workaround is the evidence this issue exists.

Whatever moves, the anchored card must stay level with its highlight across a
resize. UI-163 asserts that across a +240px change and it must keep holding.

### Edge Cases
- A column at exactly the threshold.
- The margin appearing and disappearing as a column is dragged across it — the
  body's fill must follow in the same frame, which is the rider's rule.

## Testing Strategy

An e2e test that drags a column's edge to the widest a user can reach and asserts
which placement the threads take. It must be able to fail: move the threshold and
watch the assertion flip.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Open a document with anchored threads in a column
2. Drag the column's edge to its maximum
3. Expected, per §10: threads in the right margin
4. Actual: chips at the anchor, at every reachable width

### Verification Steps
1. Repeat after the change, if a constant moved
2. Confirm the anchored card stays level with its highlight across the resize

## E2E Verification Log

### Reproduction (bugs only)
_[Agent fills]_

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
