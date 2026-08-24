# [CONTRACT-073] Non-terminal queue status is one reading of §7, written twice

## Domain
contract

## Status
done

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

### Implemented on

opus.

### Decision 1 — the name is `NON_TERMINAL_QUEUE_EVENT_STATUSES`

"Outstanding" is the word both call sites use, and both keep it: the server's
export stays `OUTSTANDING_EVENT_STATUSES` and the kit's stays
`OUTSTANDING_JOB_STATUSES`, each now an alias. What moves into the contract is
the narrower fact. Terminality is a property of §7's state machine;
*outstanding* is what a caller concludes from it — which is the same distinction
`JobsQuerySchema.status` draws when it refuses to publish an `outstanding`
shorthand on the wire. Exporting the conclusion under the wire's own vocabulary
would have half-published the thing that field deliberately does not publish.

### Decision 2 — enumerated, not derived

Both lists come from a `Record<QueueEventStatus, "terminal" | "non-terminal">`
keyed by the union. A seventh status is therefore a **compile error** in that
record until somebody classifies it, rather than being silently classified
non-terminal by a complement. That is the safer failure, and it is the wrong
direction to guess in: a caller polling a non-terminal set waits forever on a
state that never leaves it. `TERMINAL_QUEUE_EVENT_STATUSES` falls out of the same
record, and a runtime test asserts the two partition `QUEUE_EVENT_STATUSES`
exactly.

### Decision 3 — the two uses are the same *set*, and the answer is yes

Asked before the lists were merged. The two ask different **questions**: the
server's is a SQL `IN` list inside `AWAITING_AGENT_SQL` (does an unsettled event
name this thread?), the kit's is a `?status=` filter plus a client-side predicate
over the answer. The **set** is identical — `["pending", "in-progress",
"deferred"]` in both, with the same reading of `deferred` (claimed work parked
while a person edits, returning to `pending` by itself, so the reply is still
coming). Work is owed exactly while the event has not settled, whichever surface
asks. Merging them is therefore right, and the test pins the exact three strings
each side used to hold so the move is provably behaviour-preserving.

### A third copy, found while doing it

`JobsQuerySchema.status`'s description wrote the same three strings out by hand
(*"the two callers … pass `pending,in-progress,deferred`"*). It is now
`NON_TERMINAL_QUEUE_EVENT_STATUSES.join(",")`. The published bytes are unchanged
— verified below — so this is a de-duplication, not a wire change.

### `openapi.json` is unchanged in substance

Nothing new is published. Verified against the generated document:

```
JSON.stringify(buildOpenApiDocument()) does not contain "NON_TERMINAL"
JSON.stringify(buildOpenApiDocument()) does not contain "nonTerminal"
```

and, fetched from the **running** server on port 8838, the `status` parameter's
description still reads `` `pending,in-progress,deferred` `` verbatim — PASS.

### Consumers

- `apps/server/src/docs/needs.ts`: `export const OUTSTANDING_EVENT_STATUSES =
  NON_TERMINAL_QUEUE_EVENT_STATUSES;`
- `packages/kit/src/query/useOutstandingJobs.ts`: `export const
  OUTSTANDING_JOB_STATUSES: readonly QueueEventStatus[] =
  NON_TERMINAL_QUEUE_EVENT_STATUSES;`

Neither keeps a literal. Both docblocks record why the name stayed local.

### Gates

`vitest run packages/contract` — 2972 tests, exit 0, including the four new
assertions in `schemas/queue.test.ts`. `npm run typecheck -w packages/kit` —
exit 0. `apps/server` typecheck reports no error from this change (its three
errors are CONTRACT-029/035/036's forcing functions). ESLint and Prettier clean.

