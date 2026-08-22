# [SERVER-054] The board row's pending-agent dot uses the heuristic UI-058 just replaced

## Domain
server

## Status
done

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
- [x] A note-only turn does not light the row's pending-agent dot
- [x] A genuinely outstanding request still does — including one that has been
      queued but not started, and one that is `deferred` (§7 makes deferred the
      one non-terminal outcome; UI-058 counts it and this must agree)
- [x] `needs=me` returns the same set the dot implies — **the premise was stale
      and is now asserted rather than assumed**, see "One correction to the
      issue" below
- [x] `Thread.agent` climbing monotonically is **documented as intentional**,
      both where the column is defined (`projection/schema.ts`) and where the
      transitions live (`threads/participation.ts`)
- [~] Kit's `useRowSignals` OR is revisited — **analysed, and it stays**; the
      reasoning is written into `docs/needs.ts`. `packages/kit` was out of scope
      for this agent, and one stale docblock there is handed on below

## One correction to the issue

The issue says the field "is also what `needs=me` filters on, so changing it
changes which documents a view returns". **That is no longer true.**
`NEEDS_REASONS` is `unread-reply | form | due | stale | failed-job` (SPEC.md
§9.2) and `AWAITING_AGENT_SQL` appears in none of them — it is a row column and
nothing else, read once at `query.ts`'s `ROW_COLUMNS`.

That is the right split and the fix keeps it: Attention is what needs **you**,
and a request the agent is already holding needs nobody. So there was never a
filter to keep in step — but adding the reason later would silently change which
documents a view returns, so the separation is now pinned by a test rather than
left to be rediscovered.

## Technical Design
### Files to Create/Modify
- `apps/server/src/docs/needs.ts` — `AWAITING_AGENT_SQL` becomes a queue
  predicate; `OUTSTANDING_EVENT_STATUSES` names §7's three non-terminal states
- `apps/server/src/projection/schema.ts` — the note on `threads.agent`
- `apps/server/src/threads/participation.ts` — the same note at the transitions
- `apps/server/src/docs/corpus-fixture.ts` — `queuedEvent(status, id, payload)`,
  with `failedEvent` delegating to it
- `apps/server/src/docs/query.test.ts`

### The shape of the fix
```sql
(t.id IS NOT NULL AND EXISTS (
  SELECT 1 FROM events e, json_each(e.payload_json) je
   WHERE e.status IN ('pending', 'in-progress', 'deferred') AND je.value = t.id
))
```
Three deliberate choices:

1. **The matching rule is `FAILED_JOB_SQL`'s**, spelled the same way — every
   top-level payload value, never a fixed key list. Two sibling predicates in one
   file may not read a payload two ways, and the reason that rule was chosen
   holds here unchanged: payload shapes belong to whoever defines the event type,
   so a plugin's event lights the row without a server change (§7, §10).
2. **The three non-terminal statuses**, `deferred` included, matching what the
   two UI callers pass as `?status=pending,in-progress,deferred`. A `failed`
   event is terminal here **and** is reported by `needs=failed-job`, which is
   where "this needs you" belongs — a failure is not the agent working.
3. **`t.status` is gone.** Resolving a thread cancels no queued event, so the
   answer follows the event. UI-058 dropped the client's `!resolved` gate for
   exactly this reason and this now agrees with it.

### Why the client's job scan stays, and why that is not two answers
`useAgentActivity` asks a **different question of the same source**: it needs
each job's own `status` and `lastLine` to separate §8's *working* from *waiting*,
which a boolean row column cannot carry, and its answer is bounded by one
response's worth of unfinished jobs. This column answers only "something is
outstanding here", unwindowed — precisely the case the client's window can drop,
which is what its own docblock already says it is there for.

Where the two can differ they differ in one direction only. `Job.originId` names
the **first** of `threadId`, `parentId`, `docId` the corpus still holds, so the
server's set is a **superset**: a parent thread whose child thread has an
unfinished event also reads as waiting — which §8's "a reply in a child thread is
collected, the conversation continues in the parent" makes true rather than
merely harmless. Both map to `waiting`, never to `working`, so nothing can claim
an agent is running that is not. What must not differ, and no longer does, is the
**source**: neither side infers a pending agent from thread state.

### Invalidation needed no change, which was worth checking
`QUEUE_QUERY_KEYS` already carries `DOCS_KEY` on every queue transition —
SERVER-028 put it there because `failed-job` is computed from `events.status`,
and this column now rides the same table. Confirmed on the wire, below.

## Testing Strategy
Server tests over the four corners (note/ask × outstanding/settled) plus a
`needs=me` assertion proving the filter and the dot do not diverge.

## E2E Verification Log
Model: **Opus 5 (1M context)**, server-dev agent, 2026-08-21.

Real workspace on **port 8931** (`corpus init`, `corpus server start`, run from
source via tsx), driven with the real CLI and real HTTP. Port 8765 untouched.

### Pre-fix reproduction (red)
Built the exact reported state through the real CLI: `th_lxia3pjs` on
`doc_notitle02`, opened with `@agent what do you make of this?` (→
`agent: requested`, `evt_7efupp5c5vz6`), `queue claim-all`, `thread reply --from
agent` (→ `agent: engaged`), `queue complete`, and every other event drained:

```
$ corpus queue status --json
{"pending":0,"inProgress":0,"deferred":0,"processed":3,"failed":0,"abandoned":0}
```

Then one **note-only** turn — the composer's `○ note only`, which no CLI verb
exposes, so posted as the UI posts it:

```
$ curl -X POST .../api/threads/th_lxia3pjs/turns \
       -d '{"body":"Noting this for later; no need to reply.","requestsAgent":false}'
  → "eventId": null                       ← nothing was enqueued

$ curl .../api/docs?type=thread
  th_lxia3pjs agent=engaged lastTurnAuthor=user awaitingAgent=true
```

Queue empty, nothing asked, dot lit.

### Post-fix (green), same workspace, server restarted
| step (real CLI + real HTTP) | queue | `awaitingAgent` | `attention` |
| --- | --- | --- | --- |
| the note-only state above, unchanged | all zero | **false** | `[]` |
| `@agent actually, can you look again?` → `evt_esa4deu7wkud` | `pending 1` | **true** | `[]` |
| `queue claim-all` | `inProgress 1` | **true** | `[]` |
| a **note-only** turn while that request is outstanding (`eventId: null`) | `inProgress 1` | **true** — unchanged, the request really is outstanding | `[]` |
| `POST /api/queue/evt_…/defer` (§7's non-terminal outcome) | `deferred 1` | **true** | `[]` |
| claim + `complete` | `processed 4` | **false** | `[]` |
| a fresh `@agent` request, claimed then **failed** | `failed 1` | **false** | `["failed-job"]` |

The last row is the split the design turns on: a failed job stops claiming the
agent is on it and starts asking the person to look, in one transition.

### SSE — the board actually repaints
Live stream on `/events` while the two transitions above ran:

```
event: invalidate
data: {"keys":[["docs"],["docs","th_lxia3pjs"],["threads","th_lxia3pjs"],["docs","doc_notitle02"]]}
event: invalidate
data: {"keys":[["queue"],["jobs"],["docs"]]}          ← the enqueue
event: invalidate
data: {"keys":[["queue"],["jobs"],["docs"],["agents"]]} ← the claim
```

Every queue frame carries `["docs"]`, so the row refetches on each transition.

### Falsification — the tests fail without the fix
`AWAITING_AGENT_SQL` reverted to the old heuristic, every test left in place:

```
FAILED: awaits the agent exactly when an unsettled queue event names the thread
FAILED: keeps `awaitingAgent` null on documents and derived from the queue on threads
FAILED: stays dark for a note-only turn, which enqueued nothing
FAILED: stays dark for a processed event — the three terminal states
FAILED: stays dark for a failed event — the three terminal states
FAILED: stays dark for a abandoned event — the three terminal states
FAILED: says nothing about a failed job, which has its own Attention reason
FAILED: lights a thread named by a plugin's own payload key
```
8 failed, 121 passed — and the three *lit* cases (pending / in-progress /
deferred) stay green under both implementations, which is the point: they are
where the two rules agree, so they could never have caught this on their own.

### Checks
- `apps/server/src/docs` + `threads` + `projection`: **1413 passed**, 0 failed.
- Whole `apps/server` suite: **4338 passed**, 0 failed, 973 suites.
- `docs/performance.test.ts` (the query-plan assertions) passes unchanged.
- `tsc --noEmit -p apps/server`: clean. `eslint --max-warnings 0` on the touched
  files: clean. `prettier --write`: clean.

## Handed on (not fixed here — outside `apps/server`)
1. **`packages/contract`** — `DocRowSchema.awaitingAgent`'s description still
   says "the agent has been drawn into an open thread and the last turn is not
   yet its reply", which is the heuristic this issue deleted. The **shape is
   unchanged** (`boolean | null`, null on non-threads), so nothing breaks; the
   published prose is now wrong and `openapi.json` carries it. Needs a
   contract-dev issue.
2. **`packages/kit`** — `useRowSignals.ts`'s docblock describes `awaitingAgent`
   the same stale way. The **code is correct as written** and needs no change
   (see "Why the client's job scan stays" above); only the sentence describing
   the field does.
3. **`apps/ui/e2e/stubCorpus.ts:979`** — a comment restating the old server rule.
4. **A shared "non-terminal statuses" constant.** `OUTSTANDING_EVENT_STATUSES`
   (server) and `OUTSTANDING_JOB_STATUSES` (kit) are the same reading of §7
   written twice. The wire deliberately publishes no `outstanding` shorthand
   (`JobsQuerySchema`), but a non-wire `NON_TERMINAL_QUEUE_EVENT_STATUSES` export
   beside `QUEUE_EVENT_STATUSES` would let both derive from one list. Contract
   change, so escalated rather than made.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
