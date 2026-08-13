# [CONTRACT-032] The diff-truncation contract forces a 401-character answer

## Domain
contract

## Status
todo — the blocker cleared: SHARED-013 was signed 2026-08-05 and its amendment
is in SPEC.md §9.2, so this is ordinary unstarted work rather than held.
Recommendation stands: candidate 2. (Unblocked 2026-08-13, INFRA-027.)

## Priority
P2

## Model
opus

## Dependencies
- Depends on: CONTRACT-028, SERVER-058, SHARED-013 (sign-off)
- Blocks: —

## Spec References
- SPEC.md §9.2 `GET /api/docs/:id/diff` — "truncated at a hunk boundary … never
  refused"; `DocDiffSchema.truncated`

## Summary
Escalated from SERVER-058, which **waived** the remaining case on the record
because closing it inside the published contract is not possible.

`DocDiffSchema.truncated` promises *whole hunks are dropped from the end*, with
one exception: a hunk **larger than the whole bound** may be cut at a line
boundary. That exception is too narrow. A hunk that is smaller than the bound but
whose end sits past the cap is still dropped whole, so the route answers with
whatever preceded it — in the reported shape, the `updated:` frontmatter hunk and
nothing else.

Measured on the real route: `totalChars 16044 → 401 of 16000 returned` — the same
401 SERVER-058 was filed with. And it is broader than that issue assumed: with a
third hunk, a 21 001-character diff still answers 231. The true condition is the
**straddling hunk's size ∈ (max − cut, max]**, not a narrow band just above the
cap.

**Why the server cannot fix it alone.** The obvious widening — allow the line cut
whenever the hunk is larger than the *remaining* budget rather than the whole
bound — is exactly the `max(hunkCut, lineCut)` rule SERVER-058 round one rejected
with a disproof: every hunk boundary is a line boundary, so it collapses to
"always cut at a line" and abolishes hunk alignment, contradicting the sentence
above. Any real fix changes what the contract promises.

**Why waiving is tolerable meanwhile:** waste and likelihood are the same number.
A 401-character answer requires a body hunk landing within 401 characters of the
cap; the closer the near-miss, the rarer it is.

## The decision this issue has to make
What should `truncated` promise? Candidates, none chosen:

1. **Whole hunks, then a line cut in the straddling hunk whenever dropping it
   would waste more than some share of the budget.** Keeps alignment in the
   common case, bounds the waste. Needs a stated share and a reason for it.
2. **Whole hunks, then always a line cut in the straddling hunk.** Simplest to
   state and to implement; gives up alignment at the tail, which the current
   sentence exists to protect.
3. **Leave it, and say so precisely.** The contract would state the near-miss
   case plainly so a reader is not surprised — the honest version of today.

Whichever is chosen, `stats` on the event already tells the agent the true size,
and the CLI prints `showing N of M`, so a caller is never misled about *how much*
it got — only about which part.

## Acceptance Criteria
- [ ] `DocDiffSchema.truncated`'s description matches what the route does
- [ ] A near-miss hunk no longer produces a frontmatter-only answer, or the
      contract says plainly that it can and why
- [ ] SPEC.md §9.2's sentence is updated to match — **held for user sign-off,
      drafted in this issue, never applied by the contract package**
- [ ] `openapi.json` and the typed client regenerated
- [ ] SERVER-058's criterion 4 can be re-checked and ticked, or is retired with
      the reason

## Technical Design
### Files to Create/Modify
- `packages/contract/src/schemas/` + regenerated artifacts; SPEC.md §9.2 by the
  orchestrator; `apps/server/src/edit/diff.ts` follows

## Testing Strategy
Fixture-driven at the notch: the straddling hunk just under and just over the
cap, with two and three hunks.

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
