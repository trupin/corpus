# [SERVER-137] Reflect on demand and when the dust settles: the event, the clock, the quiet window

## Domain
server

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-076
- Blocks: CLI-060 (`corpus reflect`), UI-153, AGENT-042 (the skill handles the event)

## Spec References
- SPEC.md §7 — rider 9 (reflection), lanes, the queue contract, presence and `idle`
- SPEC.md §4 — `.corpus/` state

## Summary
Implements `workspace.reflect`: the ask route enqueues it at once, a scheduler enqueues it when the corpus has been quiet for the configured window after an unreflected change, the clock moves when the job is processed, and the status route reports clock, pending state and the count of changed documents.

## Acceptance Criteria
- [x] `POST /api/workspace/reflect` enqueues `{ type: "workspace.reflect", payload: { since } }` on the orchestrator's lane; when one is pending or in progress it answers `202` with that event and `pending: true` instead of enqueuing a second.
- [x] **Quiet window**: after any write **by someone other than the agent** that changes a document's `updated`, a timer (re)starts; an agent write never starts or restarts it (§7: the agent's own writes never count as unreflected). When it fires with an unreflected change present (the `changed` count below > 0 — so an archive alone never starts a reflection, for the reason CONTRACT-076 gives), no reflection pending or in progress, and `reflect.quiet > 0`, one event is enqueued. Config key `reflect.quiet` (minutes, default 30, `0` disables) in the workspace config, read on start and on config change.
- [x] **Clock**: `.corpus/reflect.json` `{ reflected: ISO | null }`, written when a `workspace.reflect` job reaches `processed`, to that event's `created`; `failed`, `abandoned` and `deferred` leave it; a retried event keeps its `since`.
- [x] `GET /api/workspace/reflect` returns the shape CONTRACT-076 defines; `changed` is computed from the projection (`updated > reflected AND last_actor <> 'agent'`, not archived — SERVER-138's `last_actor` column); `lastDigest` is the newest `type: thread` whose `origin` names a reflection job.
- [x] SSE announces clock changes (so the UI's marks clear) and pending-state changes (so the control shows "reflecting…").
- [x] A server restart with unreflected changes and a quiet corpus enqueues at most one event, after one full window from start (never at the instant of start).

## Technical Design

### Files to Create/Modify
- `apps/server/src/reflect/{routes,clock,scheduler,status}.ts`, tests
- `apps/server/src/queue/*` — the processed hook that moves the clock
- `apps/server/src/config/*` — `reflect.quiet`
- `apps/server/src/events/*` — SSE kinds

### Key Implementation Details
- The scheduler is one debounced timer, not a poll. The write path already has one place every mutation passes (the commit window of §4); hook there.
- The clock file is tiny state like the pidfile, outside git by design (§4: `.corpus/` is derived and local). The digest thread carries the window in git.
- "Pending or in progress" is a queue query (`type = workspace.reflect AND status IN (pending, in-progress, deferred)`).

### Edge Cases
- Agent writes (changelog entries, the digest thread, any edit the agent makes at any time) bump `updated` but never count: `last_actor = 'agent'` keeps them out of the timer and the count, whether or not a reflection is in progress. A document the agent wrote and a person then edited counts again, because its last actor is the person.
- Two people cannot ask twice: the second ask is answered `202` with the pending event and `pending: true`.

## Testing Strategy
Vitest with fake timers over a real temp workspace and queue: the debounce, the three conditions, the clock on each job outcome, the restart rule, the agent-write exemption.

## E2E Verification Plan
### Verification Steps
1. Real server with `reflect.quiet: 1`; edit a document; wait 70s; `corpus queue list` shows one `workspace.reflect` pending; `corpus reflect` → `409` names it.
2. Process it with the agent (or `corpus job done` in a sandbox); `GET /api/workspace/reflect` shows the new clock and `changed: 0`.

## E2E Verification Log

**server-dev, 2026-08-22, running on opus.** A real workspace (`corpus init`), a
real git repository, the real server started from source
(`tsx apps/server/src/main.ts`, port 8788, `CORPUS_LOG_LEVEL=info`), driven with
`curl`. `reflect.quiet: 1` so a window is a minute. Every timestamp below is read
off the event file or the server clock, not narrated.

### 1. The restart rule — a full window from start, never at the instant of start
Server bound at **03:42:57**. `GET /api/workspace/reflect` at 03:43:25 answered
`{"reflected":null,"pending":null,"changed":8,"lastDigest":null,"quiet":1}` — the
eight template documents `corpus init` wrote, all authored `user`, and the window
read from the file rather than the default. `.corpus/queue/pending/` held nothing
at 03:43:25 and held one file at 03:44:05:

```json
{ "id": "evt_a5ouxh5r5c4x", "type": "workspace.reflect",
  "created": "2026-08-23T03:43:57Z", "source": "reflect-quiet",
  "payload": { "since": null }, "status": "pending", "lane": "orchestrator" }
```

`created` is **exactly 60 s after the bind**. `since: null` (never reflected on),
`lane: orchestrator` (§7: the event falls in no scope).

### 2. An ask while one is pending is answered, not doubled
`POST /api/workspace/reflect` → `HTTP/1.1 202 Accepted`,
`{"eventId":"evt_a5ouxh5r5c4x","since":null,"pending":true}`. `pending/` still
held one file. Never a `409`.

### 3. The digest, and the clock
`POST /api/queue/claim-all`, then `POST /api/threads` with
`{"job":"evt_a5ouxh5r5c4x"}` and no parent → `th_t4xu532w`. `.corpus/reflect.json`
immediately after:

```json
{ "reflected": null, "digest": null,
  "awaitingDigest": { "eventId": "evt_a5ouxh5r5c4x", "threadId": "th_t4xu532w" } }
```

`POST /api/queue/evt_a5ouxh5r5c4x/complete` → 200. The file became
`{"reflected":"2026-08-23T03:43:57Z","digest":"th_t4xu532w","awaitingDigest":null}`
and the route answered
`{"reflected":"2026-08-23T03:43:57Z","pending":null,"changed":0,"lastDigest":"th_t4xu532w","quiet":1}`.
`changed` fell 8 → 0.

### 4. The agent's own writes never count and never start the window
`POST /api/docs` with `x-corpus-author: agent` → 201. `changed` stayed **0**
(the agent's note and the digest thread are both `lastActor: agent`). Seventy-five
seconds of quiet followed and `pending/` stayed empty — an agent write arms
nothing.

### 5. Ten changes are one reflection
Person's write at **03:47:09**, second at **03:47:45**. At 03:48:20 — past the
first write's whole window — `pending/` was still empty. At 03:48:55, one file:

```json
{ "id": "evt_zvppenvlbjaj", "created": "2026-08-23T03:48:45Z",
  "source": "reflect-quiet", "payload": { "since": "2026-08-23T03:43:57Z" } }
```

`created` is 60 s after the **second** write, and `since` is the clock, not
`null`. `changed` read 2 — the two documents the person wrote, not the agent's.
`GET /api/jobs/evt_zvppenvlbjaj/log` carried
`"reflection enqueued after 1 min of quiet"`.

### 6. A failed job leaves the clock; a retry keeps its window
`fail` → 200. `.corpus/reflect.json` unchanged
(`reflected: 2026-08-23T03:43:57Z`), `changed` still 2, `pending: null`.
`POST /api/jobs/evt_zvppenvlbjaj/retry` → 200 and the re-pending file's payload
was still `{"since": "2026-08-23T03:43:57Z"}`.

### 7. An archived document carries no mark
`POST /api/docs/doc_xhabwwtp/archive` as `user` → 200, `changed` 2 → **1**.

### 8. An out-of-band edit restarts the window
Queue and window settled to empty. At **03:53:00** a paragraph was appended to
`data/docs/inbox/mortgage-options.md` with no server involved. `pending/` empty at
03:53:45, one file at 03:54:15. `git log` shows
`user|doc edit: Mortgage options (doc_xhabwwtp) by user` — §4 authors it `user`,
and §7 counts it as a person's change.

### 9. SSE carries `["reflect"]`
`GET /events` held open across a document create:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_madzbgut"],["tree"],["reflect"]]}
```

### 10. `reflect.quiet` is re-read with no restart, and `0` disables
Editing `.corpus/config.json` while the server ran moved `quiet` 1 → **7** → **0**
on successive reads. With `0` set, a person's write at 03:55:33 produced nothing
by 03:57:08 (95 s). Asking still worked:
`{"eventId":"evt_7rjkiotmouv6","since":"2026-08-23T03:43:57Z","pending":false}`.

### 11. The clock makes no commit, and is not in git
`git check-ignore -v .corpus/reflect.json` → `.gitignore:9:.corpus/*`.
`git status --porcelain` clean after a completed reflection.

### 12. Cost of `changed`
800 documents written and `POST /api/db/rebuild` run (813 total).
`GET /api/workspace/reflect` durations from the server log, eleven consecutive
requests on that corpus: `1, 2, 3, 6, 1, 1, 2, 1, 4, 1, 2` ms. On the 12-document
corpus they were 0–2 ms. The whole-table read plus the config re-read cost
single-digit milliseconds at that size.

### Checks
- `npm run build` — clean.
- `tsc --noEmit -p apps/server` — clean.
- `eslint` on `apps/server` — clean. Prettier clean.
- `vitest run apps/server` — **4497 passed, 0 failed** (final run). Two earlier
  full runs each showed one failure in
  `watcher/commit-out-of-band.test.ts > never lets a later mutation carry the
  person's bytes under its own author`; it passes in isolation and passed on the
  third full run. That test races a real chokidar delivery against a
  `selfWrites.record`, so it is load-sensitive rather than a regression — nothing
  in this issue touches the out-of-band committer.

### Falsification
Thirteen deliberate breakages, each reverted, each confirmed to turn its test red
(no test passed with its rule removed):

| # | Rule broken | Result |
| --- | --- | --- |
| 1 | the window's delay collapses to `0` (timer kept) | RED 9 failed |
| 2 | an agent write restarts the window | RED 2 failed |
| 3 | an ask never looks for a pending reflection | RED 3 failed |
| 4 | the clock moves *after* the transition is announced | RED 5 failed |
| 5 | the bus stops applying `["reflect"]` | RED 9 failed |
| 6 | the clock is written backwards as well as forwards | RED 1 failed |
| 7 | the clock moves on any settlement, not only `processed` | RED 2 failed |
| 8 | the unreflected count ignores the clock | RED 1 failed |
| 9 | boot fires at the instant of start | RED 2 failed |
| 10 | a parented thread may be taken for the digest | RED 1 failed |
| 11 | the out-of-band batch reports nothing | RED 2 failed |
| 12 | the write pipeline reports nothing | RED 4 failed |
| 13 | the digest is never promoted | RED 5 failed |

No test was found that cannot fail.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-137]` prefix
