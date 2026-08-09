# [SHARED-013] Diff truncation is line-aligned, not hunk-aligned — DRAFT, awaiting sign-off

## Domain

shared (orchestrator-owned)

## Status

**done — signed 2026-08-05 and applied.** The amendment below is in SPEC.md §9.2
verbatim today, carrying its own `_(Rider signed 2026-08-05.)_` marker.

**This file said "awaiting sign-off" until 2026-08-09**, and the plan row said
`blocked`, four days after the text had landed. CONTRACT-032 and CLI-028 were
recorded as blocked on it for the whole of that time and were not — CLI-028 in
particular is a notice that says "hunk boundary" when the cut may be a line
boundary, i.e. a user-visible message contradicting the spec, held behind a gate
that had already opened. Caught while surveying the user on riders to sign.

The lesson is bookkeeping-shaped: applying a rider to SPEC.md and closing its
issue are two acts, and doing only the first leaves a chain of issues parked
against a decision that has been made.

## Priority

P2

## Model

fable

## Dependencies

- Depends on: SERVER-058 (which waived the case on the record)
- Blocks: CONTRACT-032, CLI-028

## Spec References

- SPEC.md §9.2 `GET /api/docs/:id/diff` — "truncated at a hunk boundary … never
  refused"

## The problem, measured

`GET /api/docs/:id/diff` promises whole hunks are dropped from the end, with one
exception: a hunk **larger than the whole bound** may be cut at a line boundary.
That exception is too narrow. A hunk smaller than the bound whose *end* sits past
the cap is still dropped whole, so the route answers with whatever preceded it.

On the real route, in the reported shape: **`totalChars 16044 → 401 of 16000
returned`** — the `updated:` frontmatter hunk and nothing else. With a third
hunk, a 21 001-character diff answers 231. The true condition is the straddling
hunk's size falling in `(max − cut, max]`, not a narrow band just above the cap.

The server cannot fix this alone. The obvious widening — allow the line cut
whenever the hunk exceeds the *remaining* budget — is the `max(hunkCut, lineCut)`
rule SERVER-058 round one **disproved**: every hunk boundary is also a line
boundary, so it collapses to "always cut at a line" and abolishes hunk alignment,
contradicting the sentence above. Any real fix changes what the contract
promises. Hence this rider.

## Recommendation — candidate 2, stated plainly

Of CONTRACT-032's three candidates I recommend **2: whole hunks, then always a
line cut in the straddling hunk.**

- **Candidate 1** (line-cut only when dropping would waste more than some share
  of the budget) needs a magic constant and a story for why it is that number.
  It buys tail alignment in some cases and leaves the reader unable to predict
  which.
- **Candidate 3** (leave it, document it) keeps a route that can answer 401
  characters out of 16 000 and call it a diff. The waste is worst exactly when
  the diff is largest.
- **Candidate 2** wastes nothing and is one sentence to state.

What candidate 2 gives up is the promise that the tail lands on a hunk boundary.
That promise was protecting a reader from mistaking a partial hunk for a whole
one — and two other signals already do that job better than alignment does:
`truncated: true` is on the response, and the CLI prints `showing N of M`. A
consumer is told it has part of the diff either way; alignment only decided
*which* part, and the current rule frequently decides "almost none of it".

## Proposed SPEC.md §9.2 amendment — verbatim, for sign-off

REPLACE the truncation sentence for `GET /api/docs/:id/diff`:

> The response is bounded and **never refused**: a diff past the bound is
> truncated from the end and flagged `truncated: true`, with `totalChars` naming
> the full size so a caller always knows how much it did not get. Truncation
> drops whole hunks while it can and then cuts the straddling hunk at a **line
> boundary**, so the bound is spent on content rather than on alignment — a diff
> that would otherwise answer with a frontmatter hunk and nothing else returns
> the change the caller asked about. The cut is never mid-line, and never mid
> hunk-header: a truncated diff is always something a reader can read.

## Acceptance Criteria

- [ ] User signs off (or picks candidate 1 or 3 instead)
- [ ] Applied to SPEC.md §9.2 verbatim at kickoff, by the orchestrator
- [ ] CONTRACT-032 then matches `DocDiffSchema.truncated`'s description to it
- [ ] SERVER-058's criterion 4 is re-checked and ticked, or retired with a reason
- [ ] CLI-028's "hunk boundary" notice wording follows the same text

## Testing Strategy

None — spec text. CONTRACT-032 and SERVER-058's follow-up carry the fixtures, at
the notch: the straddling hunk just under and just over the cap, with two and
three hunks.

## E2E Verification Log

_N/A — spec draft._

## Completion Checklist (orchestrator)

- [ ] Sign-off recorded
- [ ] SPEC.md updated
- [ ] Committed with `[SHARED-013]` prefix
