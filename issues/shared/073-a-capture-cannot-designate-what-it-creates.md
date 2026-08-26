# [SHARED-073] A capture cannot designate what it creates

## Domain

shared

## Status

todo

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

## What has to be decided

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

- [ ] The user chooses, with the three options and their costs stated
- [ ] SPEC.md is amended to match whatever ships, so §7 and §10 agree
- [ ] If option 1: the contract's absence is confirmed as final, and the
      schema's docblock cites the amended rider rather than this issue
- [ ] If option 2 or 3: the work is decomposed, and the UI half of UI-173 gains
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

<!-- filled by the implementing agent -->

## Completion Checklist (orchestrator)

- [ ] Decision recorded with its rejected alternatives
- [ ] SPEC.md amended
- [ ] Committed with `[SHARED-073]` prefix
