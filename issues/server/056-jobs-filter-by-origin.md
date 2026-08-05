# [SERVER-056] Answer the jobs list's origin/status filter in the projection

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-030
- Blocks: UI-069

## Spec References
- SPEC.md §7 (queue and jobs), §8 (the honest pending indicator)

## Summary
The consumer half of CONTRACT-030. `listJobRows` (`apps/server/src/jobs/project.ts`)
is a single statement with no `WHERE`:

```sql
… FROM events e LEFT JOIN jobs j ON j.event_id = e.id
ORDER BY COALESCE(j.updated, e.created) DESC, e.id DESC LIMIT ?
```

so every caller gets the console's window and filters client-side. Once
CONTRACT-030 defines the filter, the projection has to answer it — and answer it
**without the window**, or the truncation the filter exists to remove survives
the change.

The subtlety worth designing for: `originId` is not a column. It is derived at
response time by `resolveOrigin`, which parses `payload_json` and walks
`ORIGIN_KEYS = ["threadId", "parentId", "docId"]` in preference order, then
requires the id to exist in `documents`. A filter cannot be a `WHERE` over a
column that does not exist, so this is a real decision: project the resolved
origin into a column (kept in step with the events mirror), or match inside SQL
with `json_extract` over the same key preference, or filter in TypeScript after a
scan. Whichever is chosen, the preference order and the "id the corpus no longer
holds reads as no origin" rule must stay identical to `resolveOrigin`'s — two
answers to "what did this job come from" is exactly the drift this issue is
meant to avoid.

## Acceptance Criteria
- [ ] A filtered request returns **every** matching job, not the most recent N —
      with a test that proves it by burying the match behind more than
      `DEFAULT_RECENT_JOBS` newer rows
- [ ] A deferred job whose `updated` has stopped advancing is still returned by a
      filtered query, however much newer traffic sits above it (the reported case)
- [ ] Origin matching agrees with `resolveOrigin` exactly: same key preference,
      same "unknown document ⇒ no origin" rule, proven by a test where a job's
      payload names a deleted document
- [ ] The unfiltered console query is byte-for-byte unchanged in behaviour,
      including its ordering and its tie-break
- [ ] Status filtering (if CONTRACT-030 defines it) covers the non-terminal set
      and is driven by the same `QueueEventStatus` vocabulary, not a restated list

## Technical Design
### Files to Create/Modify
- `apps/server/src/jobs/project.ts` (`listJobRows`, `SELECT_JOBS`)
- the route handler that reads the query
- the projection schema, if the resolved origin becomes a column

## Testing Strategy
Projection tests over: the buried-match case above, a deferred job under a long
backlog, mixed origins, deleted origin documents, and the unfiltered path's
unchanged ordering.

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
