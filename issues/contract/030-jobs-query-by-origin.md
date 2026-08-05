# [CONTRACT-030] `GET /api/jobs` cannot be asked "is anything outstanding for *this* document?"

## Domain
contract

## Status
todo

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
- [ ] `GET /api/jobs` accepts a filter that answers the predicate directly.
      `originId` is the obvious one (it is already a response field and already
      the id both callers match on); a `status` filter is the natural companion,
      since both callers want only the non-terminal set
      (`pending`, `in-progress`, `deferred`)
- [ ] The filtered query's answer is **complete**, not windowed — or, if `recent`
      still applies, the contract says in the parameter's own description what
      the guarantee is and why it is enough. A filter that silently keeps the
      truncation has not fixed anything
- [ ] The existing unfiltered call keeps its current meaning and default; the
      console is not asked to change
- [ ] `openapi.json` and the typed client are regenerated, not hand-edited
- [ ] The parameter descriptions say what the filter is *for* — a predicate about
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
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
