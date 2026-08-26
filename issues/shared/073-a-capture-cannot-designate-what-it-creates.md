# [SHARED-073] A capture cannot designate what it creates

## Domain

shared

## Status

done

## Priority

P1

## Model

fable

## Dependencies

- Depends on: SHARED-072
- Blocks: —

## Spec References

- SPEC.md §7 — _"Only standalone threads may designate, because a thread on a
  document is _about_ that document, and a resident owns a conversation rather
  than a passage."_
- SPEC.md §10 — rider B, signed 2026-08-25

## Summary

**A rider I drafted has a false premise, and the user signed it.** Found while
implementing SERVER-154, and recorded rather than quietly worked around.

Rider B says Ask and Capture both offer a new resident, and gives this reason:

> Capture offers designation although it carries no recipient, because the
> reason it carries none — that a capture is in no scope by construction — is a
> statement about routing and not about ownership.

The reasoning is sound. **The premise was never checked.** The thread a capture
creates is not standalone: `capture.ts` writes it with `parent: docId`, because
it is the inbox document's **filing thread**. §7 allows a designation only on a
standalone thread.

So rider B cannot be implemented for Capture without changing what a capture is.

## What shipped instead

Ask carries the designation, in all three states. **Capture carries no
`resident` field at all** — removed from `CaptureRequestSchema` before
v0.23.0 — rather than declaring one that always refuses. A wire field that can
never succeed is worse than none: it tells every reader of the contract that
something is possible.

The reason is written into the schema's docblock and pinned by a test, so the
absence reads as a decision rather than an oversight.

## Decided 2026-08-26 — option 1, the rider is amended

The user chose to correct §10's rider rather than change what a capture is.
**Applied to SPEC.md**, with the correction dated and its cause named:

> **Capture does not**: the thread a capture creates is its document's filing
> thread and has a parent, and §7 allows a designation only on a standalone
> thread — a resident owns a conversation rather than a passage. A captured note
> is therefore the ordinary agent's until somebody designates its thread, which
> the control on the thread already does.
> _(Rider signed 2026-08-25; its Capture half corrected 2026-08-26, having been
> drafted on a premise about the filing thread that was never checked.)_

**The cost, accepted rather than hidden**: a captured note starts as the
ordinary agent's. Giving it an owner is a second act, on the thread, with a
control that already exists.

**Rejected: making the filing thread standalone.** It would deliver what the
rider promised, and it changes what a capture *is* — the thread would stop being
*about* its document and become a conversation that produced it, taking §10's
description, the board's drawing of a capture, and everything assuming the
parentage with it. A real arc, for a convenience.

**Rejected: letting a whole-document thread designate.** It reverses §7's rule
outright, so every comment thread on every document could hold its own lane. The
reason §7 gives against it is not obviously wrong, and Capture is not a reason to
test it.

## What was decided (kept for the record)

Three ways out, and the choice is the user's because two of them change signed
text.

1. **Amend rider B** to say Ask offers a designation and Capture does not, with
   §7's reason. Cheapest, and it leaves a capture unable to start a conversation
   with an agent of its own.
2. **Make the filing thread standalone**, with the document reaching it by
   `origin` rather than by `parent`. It gives Capture the designation and
   changes what a capture *is* — the thread stops being anchored to the document
   and becomes a conversation that produced it. That is a real change to §10 and
   to how the board draws a capture.
3. **Let a whole-document thread designate**, which reverses §7's rule outright.
   Named for completeness. It is the largest of the three and the reason §7
   gives against it — a resident owns a conversation rather than a passage — is
   not obviously wrong.

**Recommendation: 1**, unless the user wants a captured note to start a
conversation that owns itself, which is a real thing to want and is option 2.

## Acceptance Criteria

- [x] The user chooses, with the three options and their costs stated
- [x] SPEC.md is amended to match whatever ships, so §7 and §10 agree
- [x] If option 1: the contract's absence is confirmed as final, and the
      schema's docblock cites the amended rider rather than this issue
- [x] If option 2 or 3: the work is decomposed, and the UI half of UI-173 gains
      the Capture control it does not have

## Technical Design

Deferred until the decision. Option 1 is a spec edit and a comment. Option 2
touches `capture.ts`, the projection's thread parentage, §10's description of a
capture, and any surface that assumes a capture's thread is anchored.

## Testing Strategy

Per option.

## E2E Verification Plan

Per option.

## E2E Verification Log

Spec-only. The contract already matches the amended text — CONTRACT-088 removed
`resident` from `CaptureRequest` during SERVER-154, before this was decided, and
that removal is now what the spec describes rather than a gap it tolerates.

### The correction is dated in the rider itself

Not silently rewritten. A reader who finds this text later can see that a half of
it was drafted wrongly and when it was repaired — which is the same rule the
2026-08-15 correction in §7 follows, and it exists because a rider that quietly
changes its meaning is worse than one that never held.

### Checks

```
prettier --write SPEC.md   clean
issues:check               663 rows and 663 files agree
```
