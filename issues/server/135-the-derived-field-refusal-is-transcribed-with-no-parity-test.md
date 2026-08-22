# [SERVER-135] The derived-field refusal is transcribed into the UI with no parity test

## Domain
server

## Status
closed — obsoleted by SHARED-064 (Phase 41): SERVER-136 deleted the refusal this issue asks for a parity test over.

**Closed 2026-08-22 by SHARED-065 (Phase 41), and the ground was verified rather
than assumed.** This issue asks for a parity test over a refusal the server no
longer emits. SERVER-136 (`8835c102`, *"The server forgets plugins existed"*)
deleted the derived-field seam: `assertDerivedFieldsNotSet` is gone from
`apps/server/src/docs/update.ts`, and the repository now names it only inside
`apps/ui/src/testing/serverRefusals.ts`'s own doc comment. The refusal existed
because a plugin declared `status` and `due` derived for `type: todo`, and
SHARED-064 removed that declaration along with the type.

There is nothing to export a factory for, so acceptance criteria 1, 2 and 4 have
no subject. **Decision 3 is not answered, and it is not lost**: whether other
inline refusals (SERVER-039's archive refusal is the named sibling) carry the
same missing-parity gap is a core question that never depended on plugins.
SHARED-065 was told to file no new issues, so it is reported to the orchestrator
instead.

## Priority
P2

## Model
opus

## Dependencies
- Related: UI-092 (which made the copy and flagged it), UI-120 (the rule this breaks), SERVER-085, PLUGINS-018

## Spec References
- SPEC.md **§9** — the server's error shape
- SPEC.md **§14** — refusals

## Summary

Raised by UI-092's implementer against its own work, 2026-08-22, and it is
right to raise it: **UI-120's rule is that every transcription of a server
string gets a parity test**, and this one has none.

`apps/ui/src/testing/serverRefusals.ts` holds `derivedFieldRefusalBody`, a copy
of the refusal `assertDerivedFieldsNotSet` returns when a `PUT` tries to set a
derived `status` or `due`. The client needs it because `dropRefused` reads
`CorpusRequestError.issues` for `path: "body.<field>"` to release a refused
value from its local draft — without that, one refusal wedges every later save,
which is the MAJOR this copy exists to fix.

**Why it could not be closed there.** The server builds that refusal **inline**,
inside `assertDerivedFieldsNotSet`, which is private to
`apps/server/src/docs/update.ts`. `scripts/stub-server-parity.test.ts` can only
run a copy against an **exported factory**. Exporting one is a server change,
and that agent was scoped out of `apps/server`.

It verified the copy by reading a real refusal off a real server and said so in
the doc comment — which is honest and is not a guard.

## Why this matters more than a duplicated string

The client does not merely display this refusal — **it parses it**. `dropRefused`
keys on the `path` field to decide which local value to release. So a change to
the refusal's *shape* silently stops the un-wedging from working, and the
symptom is the original MAJOR returning: a form that cannot save anything after
one refusal, until reload.

A drifted **message** would be cosmetic. A drifted **path** is the defect coming
back with its own test still green.

## What to build

Export the refusal's construction from `apps/server` as a factory the parity
test can call, and pin it in `scripts/stub-server-parity.test.ts` beside the
others — §8's reopen rule and the rest are the precedent, and UI-085's work
already extended that file for exactly this kind of guarantee.

## Decisions to make and record

1. **Export a factory, or assert the shape from a live request?** A factory is
   the established pattern here. A live assertion tests the real path but needs
   a server in a unit test, which this repository deliberately avoids.
2. **What the parity test pins.** The **`path` is load-bearing** and must be
   pinned exactly. The human-readable message is not, and pinning it makes the
   test fail on a wording improvement — say which half is which so the next
   person does not over-pin it.
3. **Whether other inline refusals have the same gap.** `SERVER-039`'s archive
   refusal is the obvious sibling. Check, and report either way.

## Acceptance Criteria
- [ ] The refusal's construction is exported and the UI's copy is pinned against it
- [ ] The test fails when the `path` changes, and does not fail on a reworded message
- [ ] Decision 3 answered in writing
- [ ] No behaviour change — this is a guard

## Testing Strategy
`scripts/stub-server-parity.test.ts`, which exists for this and already carries
several such pins.

## E2E Verification Log
_[Agent fills — state the model]_
