# [CONTRACT-035] `JobList` carries no `total`, so a windowed answer cannot be told from a complete one

## Domain

contract

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-030, CLI-031
- Blocks: —

## Spec References

- SPEC.md §7 (the queue and jobs), §9.2 (`GET /api/jobs`)

## Summary

Found by CLI-031, which was itself closing a PR #25 review finding. The chain is
worth stating because each step was correct and the gap survived all of them.

`packages/contract/src/schemas/queue.ts` tells readers of the capped in-progress
set that *"the complete inventory is one documented route away
(`GET /api/jobs?status=in-progress`), so the cap never puts anything out of
reach"*. CLI-031 made that route reachable from the CLI — the only interface the
agent has — so the **claim cap of 20 no longer bounds anything**.

But the route itself still windows. `recent` defaults to 50 and caps at
`MAX_RECENT_JOBS = 200`, and the server applies a status filter as a `WHERE`
*before* the `LIMIT`. So a status-only query is honest but bounded: reach went
from 20 to 200, not to unbounded — and **`JobList` carries no `total`**, so a
caller cannot tell a windowed answer from a complete one.

Note the asymmetry that makes this worth fixing rather than waiving: the two
other truncating surfaces in this codebase both report their cut. `InProgressSet`
carries `total` and `truncated`; `DocDiff` carries `totalChars` and `truncated`.
`JobList` alone truncates silently, and it is the one the other two point at as
the escape hatch.

**It is not blind today**, which is why this is P2 rather than P1: `queue
claim-all`'s `inProgress.total` gives the true count, so a caller holding both
can compare. But that requires two calls and a documented relationship between
them, which is a worse contract than one honest field.

## Acceptance Criteria

- [ ] A caller can tell, from a single `GET /api/jobs` response, whether it
      received everything that matched
- [ ] The vocabulary matches the two surfaces that already solve this
      (`total` + `truncated`), rather than inventing a third spelling
- [ ] `openapi.json` and the typed client regenerated, not hand-edited
- [ ] The in-progress schema's "never puts anything out of reach" prose is either
      made true or corrected — it is currently the only remaining overclaim

## Technical Design

### Notes — two shapes, decide deliberately

1. **Add `total` (and `truncated`) to `JobList`.** Smallest, matches the
   precedent exactly, and makes every caller of the route better off. The count
   is a second query on the same `WHERE`.
2. **Extend `originId`'s window-dropping to `status`.** CONTRACT-030 already
   drops the `LIMIT` when `originId` is given, on the argument that a predicate
   must be answered completely or not at all. A status-only query arguably has
   the same character. But an unbounded status query over a long-lived corpus
   returns every job that ever reached that state, which is precisely why the
   window exists — so this is the more dangerous option and probably wrong for
   terminal statuses.

Option 1 is recommended. Option 2, if wanted at all, belongs only to the
non-terminal set and needs its own argument.

## Testing Strategy

Contract tests over the new field's presence and its agreement with the returned
array; a server test that a query at exactly the cap reports the cut.

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
