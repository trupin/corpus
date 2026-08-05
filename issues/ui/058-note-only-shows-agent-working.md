# [UI-058] A "note only" turn still shows "agent is working"

## Domain
ui

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §8 (the honest pending indicator)
- SPEC.md §11 Thread view (composer's "ask agent" toggle)

## Summary
Live report 2026-08-03: _"Answering with 'note only' still shows the 'agent is
working' status once sent."_

The composer's tri-state toggle exists so a user can add a turn **without**
summoning the agent (`requestsAgent: false`). Sending one still paints the
`.working` row, so the UI claims a job is outstanding when nothing was asked.
That is precisely the dishonesty SPEC §8's indicator was written to avoid —
`PendingIndicator`'s own docblock says the row reports "while an agent response
is outstanding … and **nothing else**".

**Diagnosed to the line.** `apps/ui/src/thread/ThreadCard.tsx`:

```ts
const awaiting =
  !resolved && agentState !== "none" && lastTurn !== undefined && lastTurn.author !== "agent";
```

`agentState` is the **thread-level** `agent` field (`data?.agent ?? row?.agent`),
not a property of the last turn. So after the agent has answered an earlier ask,
adding a note-only turn makes `lastTurn.author !== "agent"` true while the
thread's `agent` is still non-`none` — and the row appears. Nothing in this
expression can distinguish "the newest turn asked for the agent" from "this
thread asked for the agent at some point in its history".

## Investigation owed first (do not guess the fix)
The right signal is **whether the most recent agent-requesting turn is newer than
the most recent agent turn**. Establish where that can be known:
- Does a turn record, on the wire or on disk, that it requested the agent? Check
  `packages/contract/src/schemas/thread.ts` and the server's turn write path.
- If it does not, the UI genuinely cannot compute this and the fix needs contract
  and server support (a per-turn flag, or a server-maintained "outstanding"
  state) — that is **two more issues and a dependency**, not a CSS change.
  Escalate to the orchestrator with what you found rather than approximating it
  in the UI.
- Also check what the server does to a thread's `agent` field when the agent
  replies, and when a `requestsAgent: false` turn arrives. If `agent` is meant to
  be reset and is not, the bug may be server-side and this issue becomes its
  consumer.

Do not "fix" this by hiding the row more aggressively (e.g. suppressing it for
some seconds after a send). A row that is wrong less often is still wrong.

## Acceptance Criteria
- [x] A `note only` turn shows no pending indicator — asserted end to end, from
      the toggle through to the rendered row
- [x] An `ask agent` turn still shows it, with elapsed measured from the
      requesting turn (the existing reload-does-not-reset property must survive)
- [x] A note-only turn added to a thread that has an *outstanding* agent request
      still shows the indicator — the request is genuinely still outstanding, and
      suppressing it there would be the opposite error
- [x] The elapsed clock counts from the requesting turn, not from the note
- [x] Whatever signal is used is named in the code, with why the thread-level
      `agent` field is insufficient

## Technical Design
### Files to Create/Modify
- `apps/ui/src/thread/outstandingAgentRequest.ts` **(new)** — `useOutstandingAgentJob`
  reads `GET /api/jobs` (the shared kit query the console and the row signals
  already use) for an unfinished job whose `originId` is this thread;
  `agentWaitSince` decides what the clock counts from. The docblock carries why
  `Thread.agent` and the turn stream cannot answer this.
- `apps/ui/src/thread/ThreadCard.tsx` — the `awaiting` expression is replaced by
  that hook; the `!resolved` gate is dropped (resolving does not cancel a queued
  event, and the queue now answers for itself).
- `packages/kit/src/query/{useAppendTurn,useCreateThread,useRespondToForm}.ts` —
  invalidate `JOBS_KEY` when the write reported an `eventId`, so the row appears
  without waiting on the SSE frame (and never for a write that enqueued nothing).
- `apps/ui/src/testing/readerFixture.ts` — `jobs` option, `setJobs`, `jobFixture`.
- No contract or server change was needed: the queue already carries the signal.

## Testing Strategy
Component tests over the four combinations (note/ask × outstanding/settled).
E2E: send a note-only reply in the real app and assert no `.working` row.

## E2E Verification Log
Model: **Opus 5 (1M context)**, ui-dev agent, 2026-08-04.

Real app throughout: `corpus init /tmp/ui058-ws --port 8799`, `corpus server start`
(pid 52186, port 8799), Vite dev server on **5994** with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8799` and `VITE_CORPUS_TOKEN` from the
workspace config, driven by a real Chromium through Playwright. Ports 8765 and
5173 untouched.

### Investigation (before writing code)
- `TurnSchema` is `{author, ts, body}` and the on-disk turn is `## <author> · <ts>`
  plus its body — **no turn records that it requested the agent**, on the wire or
  on disk.
- `participation.ts`'s `nextAgentState` only ever raises `Thread.agent`
  (`none → requested → engaged`). An agent reply, a resolve and a
  `requestsAgent: false` turn all leave it exactly where it was, so the field can
  never answer "is a response outstanding *now*".
- **The signal does exist**: the queue. Every event is published as a job, and a
  `comment.created` / `form.respond` payload names its thread, so
  `GET /api/jobs` carries `originId` + `status`. Confirmed live against the real
  server: `{"eventId":"evt_q56ta3m76snt","status":"processed","started":"2026-08-04T23:51:10Z","originId":"th_2hb3tcdi"}`.
  No escalation was needed — no contract or server change.

### Pre-fix reproduction (red)
Scenario built through the CLI on the real workspace: note `doc_khuwvdzg`, thread
`th_2hb3tcdi` opened with `@agent …` (→ `agent: requested`, `eventId
evt_q56ta3m76snt`), `queue claim-all`, `thread reply --from agent`, `queue
complete` (→ `agent: engaged`, queue drained: `pending 0, inProgress 0`).

In the browser: opened the thread from the board, clicked the composer toggle
`◉ ask agent` → `○ note only`, typed a note, `Reply ⌘↵`.

```
working BEFORE send: 0
toggle used  : ○ note only
working AFTER note-only send: 1
  text: agent is working…
  since: 2026-08-04T23:54:32Z      ← the note's own timestamp
turns now: 3
```
Server at that instant: `{"pending":0,"inProgress":0,"deferred":0,"processed":1}` —
nothing was asked of the agent, and the UI said it was working.

### Post-fix (green), same workspace, same browser
| step (real CLI + real browser) | `.working` | `data-working-since` |
| --- | --- | --- |
| reload on the note-only thread (queue quiet) | **absent** | — |
| composer `◉ ask agent` → send (`evt_kpj26cq5ovih` pending) | present, "agent is working…" | `2026-08-05T00:02:52Z` = the asking turn |
| `○ note only` reply while that request is outstanding | **still present** | `2026-08-05T00:02:52Z` — unchanged, counts from the ask, not the note |
| `queue claim-all` (in-progress) | present | unchanged |
| `thread reply --from agent` + `queue complete` | **absent** | — |
| `@agent …` reply, then `thread resolve` (event still pending) | present | `2026-08-05T00:04:04Z` = the requesting turn |

Every row above was read after a **fresh page load**, so the elapsed clock is
shown to survive a reload rather than restart (SPEC.md §8).

### Checks
- `apps/ui/src/thread` + `packages/kit/src/query` + reader/board/row suites:
  **948 passed**, 0 failed (`VITEST_MAX_THREADS=4`).
- `npx eslint <touched files> --max-warnings 0`: clean. `prettier --check`: clean.
  `tsc --noEmit` in `apps/ui` and `packages/kit`: clean.

---

### PR #21 review follow-up (2026-08-04)
Model: **Opus 5 (1M context)**, ui-dev agent. Two findings from the Fable review
of PR #21, both against `apps/ui/src/thread/outstandingAgentRequest.ts`.

**MAJOR — the lookup reads a truncated window. Escalated, not papered over.**
Investigated the wire before touching anything:

- `JobsQuerySchema` (`packages/contract/src/schemas/job.ts`) has exactly one
  parameter, `recent` (default 50, max 200). There is **no** `originId` filter and
  **no** `status` filter.
- `listJobRows` (`apps/server/src/jobs/project.ts`) is a single statement with no
  `WHERE`, ordered `COALESCE(j.updated, e.created) DESC`.
- `originId` is not even a column: `resolveOrigin` derives it at response time by
  parsing `payload_json` and walking `["threadId","parentId","docId"]`, then
  requiring the id to exist in `documents`.

So the honest fix — asking the question the caller actually has — is a contract
change plus a server change, which is out of this domain. **Escalated**, with the
follow-ups filed: **CONTRACT-030** (the filter) → **SERVER-056** (answer it in the
projection, unwindowed) → **UI-069** (consume it and delete the apology). The two
fixes available above the wire were both rejected on the standard this issue set
for itself: raising `recent` moves the boundary without removing it (and forks
this caller off the shared `["jobs", {}]` key for the privilege), and polling
harder widens nothing. A row that is wrong less often is still wrong.

What landed here instead: the module docblock now **states the guarantee it
actually provides** — the window's extent, its ordering, that the error is a
one-directional false *negative*, that a deferred job (whose `updated` stops
advancing, SPEC.md §7) is the standard way to reach it, and why it is not fixed
in place. `pickOutstandingJob` is split out of the hook so the scan and the window
are separate claims; the scan is exhaustive (proved at 200 rows), and the window
is pinned by a test that reconstructs the reported case and asserts `null`.
UI-069 replaces that test with its opposite.

**MINOR — `agentWaitSince` could step forward. Fixed.** `min(job.started,
latestTurn)` is the minimum of two non-decreasing values, so it is itself
non-decreasing. It now takes the thread's **turns** and returns *the newest turn
that is not newer than `job.started`*, which makes turns posted after the job's
recorded start irrelevant. The answer is still never later than the old one (it
is a turn, and it is ≤ `job.started`), so it cannot over-report a wait either.
The residue — a turn posted in the gap between enqueue and first log — is
CONTRACT-029's and is documented and tested as such.

#### Real-app verification (the exact scenario the reviewer constructed)
`corpus init /tmp/corpus-ui21` (server auto-picked **port 8766**; 8765 and 5173
untouched), `corpus server start` (pid 1579), Vite on **5999** with
`CORPUS_SERVER_ORIGIN=http://127.0.0.1:8766` and `VITE_CORPUS_TOKEN` from
`.corpus/config.json`, driven by a real Chromium.

| step (real CLI against the real server) | observed |
| --- | --- |
| `thread create --parent doc_w45nyyef --requests-agent true` | `th_j6eafjli`, ask turn at **01:32:23Z**, `evt_63nakuxfnvzb` |
| `queue claim-all` | event claimed |
| `job log evt_63nakuxfnvzb "reading the mortgage doc"` | `GET /api/jobs` → `"started":"2026-08-05T01:32:49Z"` — **the field moved off the enqueue instant**, CONTRACT-029 reproduced live |
| `thread reply th_j6eafjli` (note only, no agent) | turn at **01:33:37Z**, `"eventId":null` — no new job |
| open the thread in the browser | `.working` present, `data-working-since` = **`2026-08-05T01:32:23Z`** |

`2026-08-05T01:32:23Z` is the **ask**. The previous implementation would have
reported `min(01:32:49, 01:33:37)` = `01:32:49Z` — the 26 s the request spent
queued erased, the displayed wait jumping down, which is precisely the reset this
row exists to prevent. Left open, the row escalated on its own from "still
working…" to "still working — longer than usual" measured from 01:32:23.

#### Checks
- `apps/ui` unit suite: **2072 passed**, 0 failed (`VITEST_MAX_THREADS=4`).
  `outstandingAgentRequest.test.ts` 21 tests (was 4), `ThreadCard.test.tsx` 33
  (was 31).
- `npx eslint <touched files> --max-warnings 0`: clean. `prettier --check`:
  clean. `tsc --noEmit` in `apps/ui`: clean.
- Torn down: server stopped, Vite killed, `/tmp/corpus-ui21` removed, 5999 and
  8766 verified free, no orphaned vitest/vite/tsx processes.

## Follow-ups surfaced (not fixed here)
- **The jobs window (PR #21 review).** CONTRACT-030 → SERVER-056 → UI-069, above.
  Note `packages/kit/src/row/useRowSignals.ts` reads the same unfiltered
  `useJobs({})` and carries the same bound; UI-069 covers it.
- **`AWAITING_AGENT_SQL` is the same heuristic, server-side.**
  `apps/server/src/docs/needs.ts:58` computes `DocRow.awaitingAgent` as
  `t.agent <> 'none' AND t.status = 'open' AND t.last_author = 'user'`, so a
  note-only turn lights the *row's* pending-agent dot for the same reason the
  card's row used to appear (`packages/kit/src/row/useRowSignals.ts` ORs that
  field with its own job lookup). SERVER + kit, not this issue.
- **`Job.started` is overloaded.** It is the event's `created` instant until the
  job's first log line, after which the server records the log's timestamp
  (`jobs/project.ts` `recordJobLine`). `agentWaitSince` bounds the resulting step
  with the thread's newest turn; exposing the event's `created` on `Job` would
  remove it outright (CONTRACT + SERVER, small).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
