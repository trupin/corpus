# [CONTRACT-073] Non-terminal queue status is one reading of §7, written twice

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Related: SERVER-054 (which escalated it), CONTRACT-072

## Spec References
- SPEC.md **§7** — the queue and its event statuses

## Summary

Escalated by SERVER-054's implementer, 2026-08-21, as a contract change rather
than one it should make itself.

Two lists say which queue statuses mean "still outstanding":

- `OUTSTANDING_EVENT_STATUSES` in `apps/server`
- `OUTSTANDING_JOB_STATUSES` in `packages/kit`

They are one reading of §7 written twice, in two packages that cannot import each
other. **This is the shape that produced PR #48's CRITICAL** — a client holding
its own copy of a rule the server had changed, with both suites green because
each asserted its own copy. Here it is a list of three strings rather than a walk
over a graph, so the blast radius is small; the mechanism is identical.

## The constraint that makes this a real question

**The wire deliberately publishes no `outstanding` shorthand**, and that is a
decision worth keeping: a derived grouping on the wire is a second vocabulary
beside the statuses themselves, and clients then disagree about which one is
authoritative.

So the fix is **not** a new wire field. It is a non-wire export beside
`QUEUE_EVENT_STATUSES` — the enumeration both sides already share — from which
each side derives its own list. One source, no new published concept.

## Decisions to make and record

1. **The name.** `NON_TERMINAL_QUEUE_EVENT_STATUSES` is the implementer's
   suggestion and it is accurate rather than pretty. "Outstanding" is the word
   both current lists use and the word §7's prose uses; check which reads better
   at both call sites before settling.
2. **Whether it is derived or enumerated.** Deriving it as the complement of the
   terminal statuses means adding a status automatically classifies it — and
   automatically classifying a new status as non-terminal is a guess. Enumerating
   it means a new status is a compile error somewhere, which is the safer failure.
   Say which you chose and why.
3. **Whether the server's and the kit's uses are genuinely the same set.**
   SERVER-054 records that the two ask different questions of the same source.
   Check the *sets* agree even though the questions differ; if they do not, this
   issue is wrong and should say so rather than forcing them together.

## Acceptance Criteria
- [ ] One exported list in `packages/contract`, non-wire
- [ ] Both consumers derive from it and neither keeps a literal
- [ ] `openapi.json` is unchanged — nothing new is published
- [ ] Decision 3 answered in writing before the merge

## Testing Strategy
A test asserting the derived lists equal what each side used to hold, so the
change is provably behaviour-preserving.

## E2E Verification Log
_[Agent fills — state the model]_
