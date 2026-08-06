# [CONTRACT-030] `GET /api/jobs` cannot be asked "is anything outstanding for *this* document?"

## Domain
contract

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: SERVER-056

## Spec References
- SPEC.md §7 (queue and jobs), §8 (the honest pending indicator), §11 (the board)

## Summary
Found by the Fable review of PR #21 (2026-08-04) against UI-058's work.

`JobsQuerySchema` carries exactly one parameter — `recent`, defaulting to
`DEFAULT_RECENT_JOBS = 50`, capped at `MAX_RECENT_JOBS = 200`. The route is a
**console list**: "the N most recently-touched jobs". That is the right shape for
the console, and it is the only shape there is.

Two callers do not want a list, they want a **predicate about one document**:

- `apps/ui/src/thread/outstandingAgentRequest.ts` — "does the agent still owe
  *this thread* an answer?" (SPEC.md §8's pending row).
- `packages/kit/src/row/useRowSignals.ts` — the board row's pending-agent dot.

Both answer it by fetching the console list and scanning it client-side, so both
answer it **inside a 50-row window**. The failure is one-directional and it is a
false negative:

> A `comment.created` job is deferred on a document the user is editing. SPEC.md
> §7 makes a deferral wait indefinitely (`corpus job retry` is the manual
> override for a lock that never clears), so its `updated` stops advancing while
> the rest of the queue keeps moving. After 50 further transitions the job falls
> out of the window ordered `COALESCE(j.updated, e.created) DESC`, the lookup
> returns nothing, and the thread's "working…" row silently disappears **while
> the reply is genuinely still coming**.

A `pending` job behind a long backlog reaches the same place. This is the same
dishonesty UI-058 was filed to remove, pointing the other way, and it cannot be
fixed above the wire: raising `recent` moves the boundary without removing it,
and a row that is wrong less often is still wrong.

## Acceptance Criteria
- [x] `GET /api/jobs` accepts a filter that answers the predicate directly.
      `originId` is the obvious one (it is already a response field and already
      the id both callers match on); a `status` filter is the natural companion,
      since both callers want only the non-terminal set
      (`pending`, `in-progress`, `deferred`)
- [x] The filtered query's answer is **complete**, not windowed — or, if `recent`
      still applies, the contract says in the parameter's own description what
      the guarantee is and why it is enough. A filter that silently keeps the
      truncation has not fixed anything
- [x] The existing unfiltered call keeps its current meaning and default; the
      console is not asked to change
- [x] `openapi.json` and the typed client are regenerated, not hand-edited
- [x] The parameter descriptions say what the filter is *for* — a predicate about
      one document, not a narrowing of the console list — so the next reader does
      not re-derive the reasoning above

## Technical Design
### Files to Create/Modify
- `packages/contract/src/schemas/job.ts` (`JobsQuerySchema`)
- `packages/contract/src/routes/jobs.ts` (`listJobs` description)
- regenerated `openapi.json` + typed client

### Notes
- Decide deliberately whether `status` takes one value or a set. Both known
  callers want the same three-value set, which argues for a named
  `outstanding`/`unsettled` value over three repeated parameters — but that puts
  a UI concept in the contract, so it needs an answer, not a default.
- The kit's query key is `["jobs", <filter>]`, so a filtered call is a *different*
  cache entry from the console's. That is correct, and it costs one extra request
  per distinct filter; SSE invalidation already fans out to both.

## Testing Strategy
Contract tests over the new parameter's parse/reject cases and its default when
absent; an OpenAPI drift check as usual.

## E2E Verification Log
Ran on **opus** (orchestrator, directly — the session's subagent limit was reached).

**The open question, answered.** The issue asked whether `status` should be one
value, a set, or a named `outstanding` shorthand. It is a **comma-separated set**
of `QueueEventStatus` values — the spelling `GET /api/docs` already uses for its
multi-valued `type` filter, so the wire gains no new grammar. A named
`outstanding` was rejected on the issue's own grounds: which statuses count as
unsettled is a *reading* of §7's state machine, and baking one caller's reading
into the wire makes every later caller live with it.

**The completeness question, answered the strict way.** `recent` bounds the
console list and is **ignored once `originId` is given**. The looser option the
criteria allowed — keep the window but apply it after the filter — was rejected:
a windowed predicate is wrong less often and still wrong, and its failure is the
silent direction, since a job pushed out of the window is indistinguishable from
no job.

- `packages/contract/src/schemas/job.test.ts`: 12 new cases — defaults absent,
  origin round-trip, id validation, set splitting, whitespace, single value, and
  four rejection cases. A typo like `in_progress` is a 400 whose message names
  the legal values, because a filter that silently matched nothing would return
  `[]`, which reads exactly like "no work outstanding".
- Full contract suite **1786/1786**, then **1855/1855** with the server's jobs
  suites alongside.
- `openapi.json` and `schema.generated.ts` regenerated by `npm run generate`;
  neither hand-edited.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
