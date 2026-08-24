# [SERVER-148] The server supplies what the contract now declares

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-029, CONTRACT-035, CONTRACT-036
- Blocks: UI-169

## Spec References

- SPEC.md **§7** — the queue and jobs, and read state
- SPEC.md **§9.2** — `GET /api/jobs`, `GET /api/threads/{id}`

## Summary

The server half of three contract changes that landed in `373b07b7`. **The repo
does not typecheck until this issue closes**, which is the forcing function those
changes were shaped to be: a field the contract declares and no route supplies is
a compile error rather than a silent `undefined`.

Exactly three call sites, all found by `tsc`:

1. **`src/jobs/project.ts`** — `toJob` needs `enqueued` and an **uncoalesced**
   `started`. `SELECT_JOBS` already selects both columns. `updated` must stop
   falling through `started`.
2. **`src/jobs/routes.ts`** — `JobList` needs `total` (a `COUNT(*)` over the same
   `WHERE`, with no `LIMIT`) and `truncated`. `truncated` is false by
   construction when `originId` is given.
3. **`src/threads/read.ts`** — `Thread.unread`, computed with the **existing**
   `isThreadUnread(db, threadId, mark)` from `docs/needs.ts` against the
   `.corpus/seen.json` mark.

## Acceptance Criteria

- [x] `npm run typecheck -w apps/server` passes
- [x] `enqueued` is the instant the job entered the queue; `started` is null
      until the first log line and is never coalesced to `enqueued`
- [x] `total` counts every row matching the query's `WHERE`, not the windowed
      page, and `truncated` is derived from the two rather than guessed
- [x] `unread` uses `isThreadUnread` against the server-side mark. **Not** a
      second comparison written for this route, and **not** derived from the
      `turns` array — a thread past the first page has no row to derive from,
      which is the whole reason CONTRACT-036 exists
- [x] A standalone thread (`parent: null`) reports `unread` correctly, since it
      is the case no list can ever answer

## Testing Strategy

Route-level tests for each field. The falsification for `unread` is direct: mark
a thread seen, add a turn as another author, and assert the route says `true`
without the caller having listed anything.

## E2E Verification Log

**Model: Opus 5 (1M context).** Implemented 2026-08-24.

### What changed

| File | Change |
| --- | --- |
| `apps/server/src/jobs/project.ts` | `toJob` emits `enqueued` (`events.created`) and an uncoalesced `started` (`jobs.started`, nullable). `updated` falls back to `enqueued`. `listJobRows` became `listJobPage`, returning the contract's `JobList`. |
| `apps/server/src/jobs/service.ts` | `list()` returns `JobList` rather than `Job[]`. |
| `apps/server/src/jobs/routes.ts` | The handler returns the verb's answer whole, instead of wrapping rows in an object literal. |
| `apps/server/src/threads/marks.ts` | **New.** `readSeenMarks` and `movesForward` moved here from `seen.ts`, joined by `threadUnread(reader, threadId)`. |
| `apps/server/src/threads/read.ts` | `toWireThread(reader, thread)` sets `unread` from `threadUnread`. |
| `apps/server/src/threads/routes.ts`, `create.ts` | Pass the workspace as the reader. |

### Decisions

**`listJobRows` became `listJobPage` rather than gaining a sibling `countJobRows`.**
CONTRACT-035 requires `total` be *"counted over the same filters the array was
selected with"*. Two exported functions is two places for a filter to be added to
one of them, which is the drift SERVER-056 already paid for once. One function
answers both, and both statements share a named `FROM_JOBS` so a future `WHERE`
cannot reach the page without reaching the count. Cost: ~20 mechanical
`.jobs` additions in `project.test.ts`.

**The count is skipped exactly when it could not differ.** An `originId` query
drops the window (CONTRACT-030), so it selected every row its `WHERE` matches and
`jobs.length` *is* the count — not an estimate of it. Re-running `ORIGIN_ID_SQL`
(a `json_extract` per key against a subquery over `documents`) to be told a number
already in hand would double the most expensive filter's cost. Every windowed
query counts for real. `truncated` is `total > jobs.length` in both cases, never
the guess `jobs.length === recent`, which would call a complete page of exactly
`recent` rows truncated.

**`unread` reads `.corpus/seen.json`, not the `seen` table.** Both are the same
mark and `recordMark` re-projects synchronously, so they agree — but the file is
the source and cannot lag a re-projection. `isThreadUnread` from `docs/needs.ts`
does the comparison, so the thread resource, `DocRow.unread` and
`MarkSeenResult.unread` are one expression and cannot disagree.

**`marks.ts` is a new module rather than a helper in `seen.ts`.** `seen.ts` reads
threads through `read.ts`, so `read.ts` importing the mark reader back out of
`seen.ts` would have made the two import each other. The three mark functions
moved out together, with `seen.test.ts`'s two describes for them.

**Rejected: deriving `unread` from the `turns` array in hand.** It is available
for free in `toWireThread` and it is wrong — the turns say when the conversation
happened and nothing about what was read. See the falsification below.

### Checks

```
$ npm run typecheck -w apps/server            # tsc --noEmit, exit 0
$ ./node_modules/.bin/eslint apps/server/src/jobs apps/server/src/threads   # exit 0
$ ./node_modules/.bin/prettier --check apps/server/src/jobs apps/server/src/threads   # clean
$ VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run --reporter=verbose apps/server
  Test Files  205 passed (205)
       Tests  4671 passed (4671)      EXIT=0
```

### Falsification of `unread`

`apps/server/src/threads/marks.test.ts` was run against three deliberately broken
implementations of `threadUnread`. The tests never list anything between the mark
and the read, so nothing that answers from a list or from the turns can pass.

| Broken implementation | Result |
| --- | --- |
| `return false` | **5 failed** / 11 passed |
| `return true` | **4 failed** / 12 passed |
| `SELECT last_author FROM threads` → `=== "agent"` (the turns-derived guess) | **5 failed** / 11 passed |
| the shipped implementation | 16 passed, exit 0 |

### E2E — real server, real HTTP

A workspace was built by hand at `scratchpad/ws-e2e` (git repo, `.corpus/config.json`
on port **8899**, never 8765) and the server started from source with `tsx
apps/server/src/main.ts --workspace …`. Every call below is `curl` against the
live listener.

**`unread` on a standalone thread, with the caller listing nothing:**

```
THREAD=th_nihhcj6z
GET  /api/threads/th_nihhcj6z  → {'parent': None, 'unread': True,  'turns': 1}
POST /api/threads/th_nihhcj6z/seen {}
     → {"threadId":"th_nihhcj6z","lastSeenTs":"2026-08-24T18:04:15Z","unread":false}
GET  /api/threads/th_nihhcj6z  → {'parent': None, 'unread': False}
POST /api/threads/th_nihhcj6z/turns  (x-corpus-author: agent) → 201
GET  /api/threads/th_nihhcj6z  → {'parent': None, 'unread': True,  'turns': 2}
```

`parent: null` throughout — this thread appears in no `?parent=` listing, which is
the case CONTRACT-036 exists for. `.corpus/seen.json` on disk afterwards:
`{"th_nihhcj6z": "2026-08-24T18:04:15Z"}`.

**`enqueued` and `started` are two instants:**

```
GET /api/jobs → 5 rows; the newest:
{ "eventId": "evt_vlfp7q4zio3b", "type": "comment.created", "status": "pending",
  "enqueued": "2026-08-24T18:04:22Z", "started": null,
  "updated": "2026-08-24T18:04:22Z", "lastLine": null, ... }

POST /api/jobs/evt_vlfp7q4zio3b/log {"line":"working on it"} → 201
GET /api/jobs?recent=1 →
{ "enqueued": "2026-08-24T18:04:22Z", "started": "2026-08-24T18:04:34Z",
  "updated": "2026-08-24T18:04:34Z", "lastLine": "working on it" }
```

`enqueued` did not move when the job began talking. Under the old rule `started`
read `18:04:22` while pending and `18:04:34` afterwards — the reset CONTRACT-029
was filed about — and there was no field left holding `18:04:22`.

**`total` and `truncated`, four shapes:**

```
GET /api/jobs                          → n=5, total=5, truncated=False
GET /api/jobs?recent=2                 → n=2, total=5, truncated=True
GET /api/jobs?recent=5                 → n=5, total=5, truncated=False   (exact fit is complete)
GET /api/jobs?status=processed         → n=0, total=0, truncated=False
GET /api/jobs?recent=1&originId=th_…   → n=1, total=1, truncated=False   (window dropped)
```

**Git log of the live workspace**, showing the writes were real and committed
under the acting party:

```
6a5da9a comment: new standalone thread (th_uvmyhi5x) by user
7f1b166 comment: turn on th_nihhcj6z by agent
3f57d8f editing session: 1 document by user
58b06ef init
```

The server was stopped and port 8899 confirmed free.

### For another domain

**UI-169 is unblocked.** All three fields are on the wire and populated:
`Thread.unread`, `Job.enqueued`, `Job.started` (now nullable), `JobList.total`,
`JobList.truncated`. The two `apps/ui` readers of `Job.started` must handle
`null` — it is null for every job that has not written a log line, which includes
every `pending` one.
