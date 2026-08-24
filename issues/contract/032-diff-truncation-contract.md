# [CONTRACT-032] The diff-truncation contract forces a 401-character answer

## Domain
contract

## Status
done

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

### Implemented on

opus.

### The decision was already made, and signed

The issue offers three candidates and recommends candidate 2. **SPEC.md §9.2
already says candidate 2**, and has since SHARED-013's rider was signed
2026-08-05:

> Truncation drops whole hunks while it can and then cuts the straddling hunk at
> a **line boundary**, so the bound is spent on content rather than on alignment
> — a diff that would otherwise answer with a frontmatter hunk and nothing else
> returns the change the caller asked about. The cut is never mid-line, and never
> mid hunk-header: a truncated diff is always something a reader can read.

So there was **no rider to draft and nothing to hold for sign-off** — criterion 3
was already satisfied, and the contract and the server were the two sides out of
step with a signed spec. `DocDiffSchema.truncated` published something narrower
(whole hunks, one exception for a hunk larger than the *whole* bound), and
`truncateDiff` implemented that narrower rule.

### Why the server was changed here too

Landing the contract alone would have published a promise the route does not
keep — the exact defect this release exists to remove — so `truncateDiff` moved
with it. Under §9.2's rule the function collapses to *"the last line boundary at
or before the bound"*, because every hunk boundary is also a line boundary. The
hunk scan, the first-boundary rule and the `dropped <= max` test are all gone;
the whole function is now six lines. The `@@`-as-content hazard disappears with
the scan, and its test is kept as a regression pin.

### The cost, published rather than glossed

The last hunk of a truncated diff may be a prefix of itself, so its header's line
counts describe more lines than follow. `truncated: true` is what says so, and
the description now says *"Read it, do not apply it"*. Nothing in this repository
applies a diff — the CLI prints it, the agent reads it.

### Measured on the real route

Port **8838**, real workspace, `corpus doc edit` then
`GET /api/docs/{id}/diff`:

```
totalChars 16741, returned 15997, truncated true
answer hunk offsets: [169, 361]      # frontmatter hunk, then the body hunk
first hunk header: @@ -3,7 +3,7 @@ id: doc_lhuiuu72
contains +updated:      True
contains the body change True
ends on a line boundary True
```

15 997 of an allowed 16 000. The frontmatter-only answer is not reachable: the
body hunk is always present, because the cut is past its header by construction.
A second shape (`totalChars 25196`) returned 15 958. The exact near-miss window
is only 361 characters wide on this document — which is the issue's own point
that the waste and its likelihood are the same number — so the discriminating
case is pinned as a unit test rather than chased with `curl` arithmetic.

### Falsification

The old `truncateDiff` body was restored and the server's diff tests run:

```
$ vitest run apps/server/src/edit/diff.test.ts ; echo $?
× keeps whole hunks while they fit, then cuts inside the one that straddles the bound
× closes the notch: a body hunk just under the bound is no longer dropped whole
× spends the budget on a trailing hunk of exactly the bound, rather than dropping it
Tests  3 failed | 12 passed (15)
1
```

New body restored: **15 passed, exit 0**. The notch test carries SERVER-058's own
fixture — a preamble plus a body hunk sized inside the bound but past the budget
left for it — and asserts the answer is now within one line of the cap instead of
being the preamble.

### Acceptance criteria

- `truncated`'s description matches what the route does — yes, and both now match
  SPEC.md §9.2.
- A near-miss hunk no longer produces a frontmatter-only answer — yes, closed
  rather than documented.
- SPEC.md §9.2 updated — **already correct; nothing applied, nothing drafted.**
- `openapi.json` and the typed client regenerated.
- **SERVER-058's criterion 4 can be ticked**: the waiver it recorded is spent.
  The `max(hunk, line)` disproof it round-one rejected was a disproof against the
  *contract's* narrow sentence, not against the behaviour, and the sentence was
  never the signed one.

### Tests added

`packages/contract/src/openapi.test.ts` — four assertions on the generated
`DocDiff.truncated`, including that the narrow exception is **absent**.
`apps/server/src/edit/diff.test.ts` — three rewritten cases and one renamed, at
the notch on both sides.

### Gates

`vitest run packages/contract` — 2972 tests, exit 0.
`vitest run apps/server/src/edit/diff.test.ts` — 15 tests, exit 0.
Typecheck, ESLint, Prettier clean.

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
