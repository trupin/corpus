# [SERVER-054] The board row's pending-agent dot uses the heuristic UI-058 just replaced

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: UI-058
- Blocks: —

## Spec References
- SPEC.md §8 (the honest pending indicator)

## Summary
Found by UI-058 (2026-08-04) while fixing the same lie one level up.

The thread card's "agent is working" row used to be computed from
`Thread.agent !== "none" && lastTurn.author !== "agent"`, which cannot tell "the
newest turn asked for the agent" from "this thread asked at some point". UI-058
replaced it with the queue — the server already tracks outstanding work as jobs,
and `GET /api/jobs` carries `originId` + `status`, so "is there an unfinished job
for this thread" is a real answer instead of an inference.

**The same inference still lives server-side**, in
`apps/server/src/docs/needs.ts:58`:

```sql
t.agent <> 'none' AND t.status = 'open' AND t.last_author = 'user'
```

That feeds `DocRow`'s awaiting-agent field, which
`packages/kit/src/row/useRowSignals.ts` ORs with its own job lookup. So a
**note-only** turn still lights the pending-agent dot on the board row, which is
exactly the user's original report ("answering with 'note only' still shows the
agent is working") surviving in a second place.

Worth knowing why the field cannot simply be deleted: it is also what
`needs=me` filters on, so changing it changes which documents a view returns, not
only what a dot looks like. That makes this a server issue rather than a UI one.

## Acceptance Criteria
- [ ] A note-only turn does not light the row's pending-agent dot
- [ ] A genuinely outstanding request still does — including one that has been
      queued but not started, and one that is `deferred` (§7 makes deferred the
      one non-terminal outcome; UI-058 counts it and this must agree)
- [ ] `needs=me` returns the same set the dot implies — the two must not diverge,
      which is the whole reason this is one change rather than two
- [ ] `Thread.agent` climbing monotonically (`none → requested → engaged`, never
      lowered by a reply, a resolve, or a `requestsAgent: false` turn) is either
      fixed or documented as intentional. UI-058 found nothing lowers it; if that
      is by design, say so where the column is defined, because it reads like a
      bug to every future reader
- [ ] Kit's `useRowSignals` OR is revisited: if the server's answer becomes
      honest, the client-side job lookup may be redundant

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/needs.ts` (the SQL), its tests
- `packages/kit/src/row/useRowSignals.ts` if the OR is no longer needed
- possibly the projection, if answering honestly needs queue state joined in

### Notes
- UI-058's approach is the reference: outstanding work is a queue question, not a
  thread-state question. Read `apps/ui/src/thread/outstandingAgentRequest.ts`
  before designing this — its docblock explains why the turn stream cannot
  answer it (a turn is `{author, ts, body}`; `requestsAgent` is a request-time
  instruction persisted nowhere).

## Testing Strategy
Server tests over the four corners (note/ask × outstanding/settled) plus a
`needs=me` assertion proving the filter and the dot agree.

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
