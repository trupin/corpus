# [SERVER-056] Answer the jobs list's origin/status filter in the projection

## Domain
server

## Status
done

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
- [x] A filtered request returns **every** matching job, not the most recent N —
      with a test that proves it by burying the match behind more than
      `DEFAULT_RECENT_JOBS` newer rows
- [x] A deferred job whose `updated` has stopped advancing is still returned by a
      filtered query, however much newer traffic sits above it (the reported case)
- [x] Origin matching agrees with `resolveOrigin` exactly: same key preference,
      same "unknown document ⇒ no origin" rule, proven by a test where a job's
      payload names a deleted document
- [x] The unfiltered console query is byte-for-byte unchanged in behaviour,
      including its ordering and its tie-break
- [x] Status filtering (if CONTRACT-030 defines it) covers the non-terminal set
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
Ran on **opus** (orchestrator, directly — the session's subagent limit was reached).

**The design decision the issue flagged.** Of the three options — project the
origin into a column, match in SQL, or scan in TypeScript — this matches **in
SQL**, and the expression is *generated from `ORIGIN_KEYS`* rather than written
out, so adding a key cannot leave the filter behind.

A `COALESCE` over the three keys would have been the obvious spelling and is
**wrong**: `resolveOrigin` takes the first key whose value names a document the
corpus *still holds*, so a payload whose `threadId` names a deleted thread and
whose `parentId` names a live document resolves to the **parent**, where
`COALESCE` stops at the dead thread. The filter is a `CASE` with an
`IN (SELECT id FROM documents)` guard per key, which is that rule exactly. A test
pins it against `resolveOrigin`'s own answer for that payload.

- `apps/server/src/jobs/project.test.ts`: 7 new cases, including the buried-match
  case built as the issue asked — the wanted job, then `DEFAULT_RECENT_JOBS + 10`
  newer ones — asserting *both* that the console can no longer see it (the bug,
  reproduced) and that the filtered query can.
- The deferred case reproduced end to end: enqueue → `claimAll` → `defer` on the
  document's lock → 55 newer jobs. The filtered query still returns it, still
  `deferred`, still naming what it is blocked on.
- The unfiltered path keeps its `LIMIT ?`, its ordering and its tie-break; a test
  asserts `listJobRows(db, 50)` and `listJobRows(db, 50, {})` agree, with a log
  line moving `updated` so activity-order rather than creation-order is what is
  being checked.
- Route-level coverage in `routes.test.ts`: the buried match over the wire, plus
  400s for an unknown status and a malformed origin.
- `apps/server/src/jobs` **66/66**; contract + jobs together **1855/1855**.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
