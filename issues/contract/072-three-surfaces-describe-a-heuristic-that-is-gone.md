# [CONTRACT-072] Three surfaces still describe the heuristic SERVER-054 deleted

## Domain
contract

## Status
done — surface 1 (the published contract) landed in PR #55; surfaces 2
(`packages/kit`) and 3 (`apps/ui/e2e`) landed 2026-08-26 in Phase 50, which
touched the same files.

**Amended 2026-08-22 by SHARED-065 (Phase 41). Not closed, and not rewritten
blind.** Surfaces 2 and 3 survive Phase 41 whole: `packages/kit` is kept (SHARED-067
amendment 3 rewords it as *"the shared UI kit"*) and `apps/ui/e2e/stubCorpus.ts`
is core test infrastructure. So the remaining work stands exactly as filed.

**One correction to the copy this issue tells the next agent to make.** The
landed surface-1 prose named a *plugin-event-type consequence* — the E2E log below
records that verbatim, and it was true when written. CONTRACT-077 (`06afcb61`,
*"The published contract forgets plugins existed"*) has since removed that clause;
`packages/contract/src/schemas/query.ts` now greps to zero for `plugin`, verified
2026-08-22. **So surfaces 2 and 3 must be written from the contract's text as it
stands today, not from the E2E log's account of it.** The log is left unedited as
the record of what PR #55 shipped.

Nothing else moves: the predicate itself never mentioned plugins, and
`AWAITING_AGENT_SQL` is unchanged by Phase 41.

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
- [x] Surface 1 (`packages/contract`, published in `openapi.json`) matches the
      implemented predicate — done in PR #55, 2026-08-22
- [x] Surface 2 (`packages/kit/src/row/useRowSignals.ts` docblock)
- [x] Surface 3 (`apps/ui/e2e/stubCorpus.ts` comment — it had moved to line 1248)
- [x] `openapi.json` and `src/client/schema.generated.ts` regenerate; regeneration
      is a no-op over the new source
- [x] The deliberate omission of `t.status` is stated, not left to be inferred
- [x] No behaviour changes — this is prose

## Testing Strategy
The generated-artifact drift check covers the regeneration. There is no test for
prose being true; the guard is review.

## E2E Verification Log

**Implemented on: opus.** Prose only — no behaviour changes, so there is nothing
to exercise. The evidence is that all three surfaces now say the same thing the
predicate does:

- `packages/contract` — corrected in PR #55, published in `openapi.json`.
- `packages/kit/src/row/useRowSignals.ts` — the docblock said the agent "was
  drawn into an open thread and the last turn is not yet its reply". It now says
  the queue owes the thread something, and records that the shape not changing
  is exactly why the sentence survived a release after it went false.
- `apps/ui/e2e/stubCorpus.ts` — the comment restated the deleted SQL as the
  server's rule. It now says the stub runs no queue, which is the real reason
  the dot is missing there, and names the old rule as the old rule. It had moved
  from line 979 to 1248 since the issue was filed.

