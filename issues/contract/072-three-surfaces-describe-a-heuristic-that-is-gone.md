# [CONTRACT-072] Three surfaces still describe the heuristic SERVER-054 deleted

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Related: SERVER-054 (which deleted the heuristic and reported these), UI-058

## Spec References
- SPEC.md **§9.3** — the contract is the published shape, and its prose is published with it

## Summary

Reported by SERVER-054's implementer against its own change, 2026-08-21.

`awaitingAgent` is now a queue predicate — an outstanding event naming the
thread — and no longer the heuristic UI-058 replaced. **The shape did not
change, so nothing breaks.** Three descriptions of it did not move:

1. `DocRowSchema.awaitingAgent`'s description in `packages/contract`, which is
   **published in `openapi.json`**. This is the one that matters: a generated
   client's users read it, and it now describes a rule the server does not run.
2. `packages/kit/src/row/useRowSignals.ts` — a docblock describing the field the
   same stale way. The code needs no change.
3. `apps/ui/e2e/stubCorpus.ts:979` — a comment restating the old server rule.

## Why it is worth an issue rather than a sweep-when-convenient

Interface documentation drift is a **checked dimension** in this repository's PR
review, and `openapi.json` is a generated artifact that CI drift-checks. A
description that has gone false is not caught by that check — it regenerates
faithfully from the wrong prose.

Three copies of one explanation is also the shape that keeps producing real
defects here when the thing being copied is a *rule*. It is only prose this
time, which is why it is P2 and not higher.

## What to build

Correct all three to describe what the predicate now does: an event in a
non-terminal queue status naming this thread. Say what it deliberately does
**not** consider — SERVER-054 removed `t.status` because resolving cancels no
queued event, which is the call UI-058 made when it dropped the client's
`!resolved` gate — because that absence is the part a reader will otherwise
assume is a bug.

Note in the contract description that the kit's job scan asks a **different
question of the same source** (it needs each job's `status` and `lastLine` to
separate §8's *working* from *waiting*, and it is windowed), so the two are not
redundant and a reader should not try to collapse them.

## Acceptance Criteria
- [ ] All three descriptions match the implemented predicate
- [ ] `openapi.json` regenerates and the drift check passes
- [ ] The deliberate omission of `t.status` is stated, not left to be inferred
- [ ] No behaviour changes — this is prose

## Testing Strategy
The generated-artifact drift check covers the regeneration. There is no test for
prose being true; the guard is review.

## E2E Verification Log
_[Agent fills — state the model]_
