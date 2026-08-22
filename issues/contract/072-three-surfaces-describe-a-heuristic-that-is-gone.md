# [CONTRACT-072] Three surfaces still describe the heuristic SERVER-054 deleted

## Domain
contract

## Status
in_progress — surface 1 (the published contract) is **done** in PR #55; surfaces
2 (`packages/kit`) and 3 (`apps/ui/e2e`) remain

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
- [ ] Surface 2 (`packages/kit/src/row/useRowSignals.ts` docblock)
- [ ] Surface 3 (`apps/ui/e2e/stubCorpus.ts:979` comment)
- [x] `openapi.json` and `src/client/schema.generated.ts` regenerate; regeneration
      is a no-op over the new source
- [x] The deliberate omission of `t.status` is stated, not left to be inferred
- [x] No behaviour changes — this is prose

## Testing Strategy
The generated-artifact drift check covers the regeneration. There is no test for
prose being true; the guard is review.

## E2E Verification Log

### 2026-08-22 — contract surface only (contract-dev, model: Opus 5)

Carved out of the PR #55 review as a MAJOR finding: interface documentation must
move with the behaviour in the same PR, so the contract half landed there rather
than waiting for this issue. The kit docblock and the e2e stub comment stay here.

**Read first, not trusted:** `apps/server/src/docs/needs.ts` —
`AWAITING_AGENT_SQL`, `OUTSTANDING_EVENT_STATUSES` and `FAILED_JOB_SQL`. The new
description is written from that fragment: an event whose status is one of
`pending`, `in-progress`, `deferred` and whose payload carries the thread's id as
a top-level value, matched by value (`json_each`) exactly as `FAILED_JOB_SQL`
matches one, because two sibling predicates in one file may not read a payload
two ways.

**Changed** (`packages/contract/src/schemas/query.ts`, `threadRowShape`):

1. `awaitingAgent` — rewritten. It now states the queue predicate, names the
   three non-terminal statuses and why `deferred` is among them, states the
   payload-matching rule and the plugin-event-type consequence, states
   **explicitly** that it reads no thread state (`agent`, `status`, `lastAuthor`)
   and that resolving a thread does not clear it because resolving cancels no
   queued event — the same call UI-058 made when it dropped the client's
   `!resolved` gate — and records that the kit's `GET /api/jobs` scan asks a
   different question of the same source (per-job `status` + `lastLine` to
   separate §8's *working* from *waiting*, and windowed where this column is
   not), so a reader does not try to collapse the two.
2. `agent` — **one line beyond the reported finding**, same drift, same field
   group. Its description claimed the column was "backing the pending-agent
   indicator", which SERVER-054 made false in this PR. It now names the column as
   the `agent=` filter's, and says it only ever climbs, so it reports thread
   history and never what the queue holds now.

**Evidence:**

- `npm run build` → exit 0. `npm run generate -w packages/contract` → exit 0,
  wrote `openapi.json` + `src/client/schema.generated.ts`.
- **Regeneration is a no-op over the new source** (the drift check's own first
  test): generated twice, `shasum -a 256` identical across the second run —
  `c522d0cb…` (`openapi.json`), `cfe0eefd…` (`schema.generated.ts`).
- `tsx scripts/check-generated-artifacts.ts` → the API-contract group reports the
  4 changed lines per artifact against `HEAD` and nothing else. That branch is
  the `diffAgainstHead` half firing on an **uncommitted** change (it prints the
  diff summary, which the hash branch does not), so it clears once the
  orchestrator commits. `CLI reference is up to date`.
- Published prose verified by reading it back out of the generated document at
  `#/components/schemas/DocRow/properties/awaitingAgent`, and out of the
  generated client's JSDoc at `schema.generated.ts:4292`.
- `VITEST_MAX_THREADS=4 vitest run packages/contract scripts` → 84 files, 3591
  tests, all passing. `eslint` + `prettier --check` on the three touched files →
  clean. `tsc --noEmit -p packages/contract` → clean.
- No shape change: `awaitingAgent` is still `boolean | null`, `agent` still
  `ThreadAgent | null`. Only `description`/`@description` lines moved.
