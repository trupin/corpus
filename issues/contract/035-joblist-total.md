# [CONTRACT-035] `JobList` carries no `total`, so a windowed answer cannot be told from a complete one

## Domain

contract

## Status

done

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

- [x] A caller can tell, from a single `GET /api/jobs` response, whether it
      received everything that matched
- [x] The vocabulary matches the two surfaces that already solve this
      (`total` + `truncated`), rather than inventing a third spelling
- [x] `openapi.json` and the typed client regenerated, not hand-edited
- [x] The in-progress schema's "never puts anything out of reach" prose is either
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


**Checklist corrected 2026-08-24 (PR #61 review).** The boxes were left unticked while the issue read `done`. The work was finished — the contract half in `373b07b7` and the server half in SERVER-148 — but a record that disagrees with itself is this release's own defect, so it is fixed here rather than after the merge.

## E2E Verification Log

### Implemented on

opus.

### Shape chosen: option 1, `total` + `truncated` on `JobList`

Option 2 — extending CONTRACT-030's window-dropping from `originId` to `status` —
was rejected, and the reason is terminal statuses: `?status=processed` over a
long-lived corpus is every job that ever finished, which is precisely what the
window exists to protect the caller from, and no caller asks that as a predicate.
A field that says "there is more" costs one count and makes every caller of the
route better off, the unfiltered console included.

The binding criterion is met literally: the words are `InProgressSet`'s and
`DocDiff`'s. `Object.keys(JobListSchema.shape)` is `["jobs", "total",
"truncated"]`, and a test asserts `InProgressSet` carries the same pair, so a
third spelling cannot be introduced quietly.

### Semantics published

- `total` — how many jobs matched **this query's filters** before `recent`
  bounded the page. Equal to `jobs.length` whenever `truncated` is false. It
  answers *how much did I not see*, never *how many jobs exist*.
- `truncated` — true when `recent` cut the list. **Always false when `originId`
  is given**, because CONTRACT-030 drops the window for that query and answers it
  completely.

Both **required**: an absent flag is indistinguishable from `false`, which is the
silent-incompleteness failure they exist to prevent. Asserted in
`schemas/job.test.ts`.

### The overclaim, corrected

`MAX_IN_PROGRESS_REPORTED`'s docblock said the complete inventory is one
documented route away *"so the cap never puts anything out of reach"*, and
`InProgressSet.total` said *"the cap bounds this report, never the caller's
reach"*. Both are now accurate: that route **windows too** (`recent`, at most
200), and what the pointer buys is a larger page that reports its own bound
rather than an unbounded one. The route description says the same thing at the
operation level.

### Baseline on a real server

Port **8838**. `GET /api/jobs?recent=2` returned a body whose only top-level key
was `jobs` — no `total`, no `truncated`. That is the silent cut.

### The published document after the change

```
JobList.required = ['jobs','total','truncated']
PASS 035 total      "before `recent` bounded"
PASS 035 truncated  "Always false when `originId` is given"
```

### Handoff — server

`apps/server/src/jobs/routes.ts:29` currently answers
`c.json({ jobs: jobs.list(recent, { originId, status }) }, 200)`. It needs the
count over the **same** `WHERE` the list was selected with — a second
`SELECT COUNT(*)` sharing `ORIGIN_ID_SQL` and the status predicate, with no
`LIMIT` — and `truncated: jobs.length < total`. With `originId` given the window
is not applied, so `total === jobs.length` and `truncated` is false by
construction. A server test should query at exactly the cap and assert the cut is
reported. This is the second of the three intended compile errors in `apps/server`
(`src/jobs/routes.ts(27,40)`).

### Gates

`vitest run packages/contract` — 2972 tests, exit 0, including five new
assertions in `schemas/job.test.ts`. Typecheck, ESLint, Prettier clean.
`openapi.json` and `schema.generated.ts` regenerated.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[ISSUE-ID]` prefix
