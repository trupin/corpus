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

## Follow-ups surfaced (not fixed here)
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
