# [CLI-004] Queue, lock and job verbs — the agent loop surface

## Domain
cli

## Status
todo

## Priority
P0

## Model
opus — semantics are pinned by SPEC.md §7 and Architecture Decision 4 (HTTP long-poll parking); the work is precise client-side loop mechanics, not design.

## Dependencies
- Depends on: CLI-001, SERVER-008, SERVER-009
- Blocks: AGENT-002

## Spec References
- SPEC.md §7 (event queue and agent loop — `queue idle|claim-all|complete|fail|abandon|reap-stale|halt|resume`, document locks and `lock break|reap`, job logs and the console feed)
- SPEC.md §9.2 (HTTP API — queue, jobs, lock endpoints)
- CLAUDE.md — Architecture Decision 4 (`corpus queue idle` long-polls the server instead of `fs.watch`, same zero-token parking semantics, ~8 min rearm)

## Summary
Ship the surface the product agent's orchestrate skill runs on: `corpus queue idle` (HTTP long-poll parking), `claim-all`, `complete|fail|abandon`, `reap-stale`, `halt|resume`, plus `corpus lock break|reap` and `corpus job log`. These commands are not read by humans — they are read by an agent loop, so the **output contract is the feature**: stable JSON shapes, quiet success, exit codes that mean exactly one thing, and an `idle` that costs zero tokens while parked and returns the instant work arrives.

SPEC.md §7 still describes `idle` as blocking on `fs.watch` of `.corpus/queue/pending/`. That is superseded: the CLI holds an HTTP long-poll against the server's idle endpoint. The observable semantics are unchanged — park cheaply, return immediately on a pending event, rearm after ~8 minutes with a clean exit so the skill loop re-invokes.

## Acceptance Criteria
- [ ] `corpus queue idle [--timeout <seconds>]` long-polls the server's idle endpoint and returns **the instant** a pending event lands, printing a minimal event summary (id, type) — or the full event with `--json`. Measured latency from enqueue to return is well under a second on localhost.
- [ ] The rearm window defaults to ~8 minutes (`--timeout` overrides). When it elapses with no event, `idle` exits **0** with no event payload (`{"idle":true,"reason":"timeout"}` under `--json`) so the orchestrate skill's loop re-invokes it. A timeout is not an error.
- [ ] The window is implemented as successive long-poll requests (per-request wait capped at the server's maximum, e.g. 60–90 s) until the total window elapses — so intermediate timeouts are invisible to the caller.
- [ ] While the queue is **halted** (`.corpus/HALT`), `idle` parks for its full window and returns as a timeout — it never returns events; `claim-all` returns an empty batch.
- [ ] `corpus queue claim-all` prints exactly **one JSON batch** on stdout (`{"events":[…]}`) with or without `--json`, and exits 0 — including when the batch is empty (`{"events":[]}`). It never prints prose to stdout.
- [ ] `corpus queue complete <id>`, `corpus queue fail <id> [--reason <text>]`, `corpus queue abandon <id>` transition the event server-side; unknown id → server error, exit 5; already-in-that-state → reported, exit 0.
- [ ] `corpus queue reap-stale [--older-than <duration>]` recovers stuck `in-progress` events and prints (or `--json` lists) what was reaped; zero reaped is a silent exit 0.
- [ ] `corpus queue halt` and `corpus queue resume` toggle the kill switch and are idempotent; `corpus queue status` (or `halt --status`) reports the current halt state — pick one and document it in the registry.
- [ ] `corpus lock break <docId>` force-releases a document lock (the CLI-side twin of the UI's force-unlock button) and `corpus lock reap` clears expired locks; both report what changed and are idempotent.
- [ ] `corpus job log <eventId> "<line>"` appends a progress line to that job's log stream (also accepts the line from stdin when the positional is omitted); success is silent, exit 0. It must be cheap enough to call many times per job.
- [ ] `idle` interrupted by SIGINT exits **0** cleanly (in-flight request aborted, no stack trace, no partial JSON) — Ctrl-C during parking is normal operator behaviour.
- [ ] A server restart mid-poll is retried **once** (short backoff, resume the remaining window); a second consecutive transport failure exits 4 loudly with the "run `corpus server start`" guidance.
- [ ] All JSON shapes emitted by these commands are documented in the registry examples and therefore in the generated `docs/cli.md`; changing a shape without regenerating fails the drift check.
- [ ] Vitest coverage for the long-poll loop (event, timeout, halt, restart-retry, SIGINT), the claim-all empty batch, and exit-code mapping.

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/queue/{idle,claim-all,complete,fail,abandon,reap-stale,halt,resume}.ts`
- `apps/cli/src/commands/queue/poll.ts` — the long-poll window loop (abortable, retry-once, halt-aware)
- `apps/cli/src/commands/lock/{break,reap}.ts`
- `apps/cli/src/commands/job/log.ts`
- `apps/cli/src/registry/index.ts` — register the `queue`, `lock`, `job` topics
- `apps/cli/src/signals.ts` — SIGINT/SIGTERM handling that resolves in-flight aborts into clean exits
- `docs/cli.md` — regenerated
- colocated `*.test.ts`

### Key Implementation Details
**Poll loop.** `pollWindow({ client, totalMs, signal })`: compute a deadline, then loop issuing `GET /api/queue/idle?wait=<segmentSeconds>` with an `AbortController` whose timeout is the segment cap plus a margin. Server responses are one of: `{ event }` → return it immediately; `{ idle: true }` (segment expired, or halted) → continue if time remains; transport failure → retry once after ~500 ms, then fail. The remaining window shrinks monotonically; never extend past the deadline. The default `totalMs` is 8 minutes; the segment cap comes from the server's advertised maximum (SERVER-008) with a client-side fallback.

**Zero-token parking.** The command must produce **no output at all** while parked — no heartbeat lines, no dots. The whole point is that the agent's context grows by one line per 8-minute window.

**Halt handling.** Halted is a server-side state; the client does not read `.corpus/HALT` (it may not even be on the same machine later). The server's idle response distinguishes "halted" from "no events"; `idle` treats both as park-and-continue, but `--json` output preserves the distinction in the final timeout object (`reason: "halted" | "timeout"`) so the skill can log why it woke.

**Signals.** Install handlers for SIGINT/SIGTERM at command start: abort the controller, skip any further retries, flush nothing, `process.exit(0)`. Remove the handlers when the command completes so tests don't leak listeners.

**claim-all output contract.** Always a single-line JSON object on stdout, nothing else, even in human mode — this command exists for machine consumption and the batch is the payload. Document that explicitly in the registry description so nobody "improves" it with a summary line.

**`job log` cost.** One `POST` with a tiny body; no workspace re-resolution beyond the standard dispatcher path; no `--json` output on success. Accept the line from stdin when the positional argument is absent so hooks can pipe into it.

**Idempotence everywhere.** `complete` on an already-completed event, `halt` when halted, `lock break` on an unlocked document, `reap-stale` with nothing stale: all exit 0 with a stated no-op. The agent loop must never crash on a duplicated call after a retry.

### Edge Cases
- `idle` returns an event, but the agent crashes before `claim-all` → the event stays `pending`; the next `idle` returns it again. `idle` must therefore be **non-destructive** (it observes, it does not claim).
- Multiple `idle` clients on the same workspace (two agent processes) → both may wake; `claim-all` is the atomic step, so a wake with an empty subsequent batch is normal and must exit 0 silently.
- `claim-all` returning a very large batch → single JSON line may be long; do not paginate, do not pretty-print (one line keeps the agent's parsing trivial).
- Server restarts between `idle` and `claim-all` → normal HTTP error path (exit 4/5); the skill re-enters the loop.
- SIGINT arriving in the retry backoff window → exit 0 immediately, do not complete the backoff.
- Clock skew / long GC pause pushing past the deadline mid-request → finish the in-flight request; return its result if it carries an event, otherwise time out.
- `--timeout 0` → single non-blocking check (useful for tests and for a "is there anything queued?" probe); document it.
- `job log` with a line containing newlines → the server owns JSONL framing; the CLI sends the raw string and must not split it itself.

## Testing Strategy
Vitest in `apps/cli`, colocated, against a **real** `node:http` stub server on an ephemeral port that can be scripted per-test (hold a request open, respond late, close the socket mid-request, restart on the same port):
- `queue/poll.test.ts` — event arrives mid-segment → returns immediately with the event; all segments expire → single timeout result within the window, exit 0; halted responses → `reason: "halted"`; socket closed mid-poll once → retries and succeeds; closed twice → exit 4.
- `queue/idle.test.ts` — no stdout output while parked (capture and assert empty until resolution); `--timeout 0` performs exactly one request; SIGINT (dispatched to the handler under test) resolves to exit 0 with no output.
- `queue/claim-all.test.ts` — empty batch prints `{"events":[]}` and nothing else; non-empty batch is a single parseable line in both modes.
- `queue/transitions.test.ts` — complete/fail/abandon/reap-stale/halt/resume request shapes and idempotent no-op output.
- `lock/*.test.ts`, `job/log.test.ts` — request shape, silent success, stdin-sourced line.
- Timing assertions use fake timers where possible; the "returns immediately" assertion uses a real elapsed-time bound (< 1 s) against the stub.

## E2E Verification Plan

### Verification Steps
1. Real workspace + real server (`corpus init`, `corpus server start`), installed binary for every command.
2. Parking: in terminal A run `time corpus queue idle --json`. In terminal B, enqueue a real event by posting an `@agent` comment through the API (`POST /api/threads` / `POST /api/threads/:id/turns` with the agent flag). Terminal A returns within a second with the event JSON; `time` confirms it, and nothing was printed while parked.
3. Rearm: run `corpus queue idle --timeout 20` with an empty queue → exits 0 after ~20 s printing the timeout object; `echo $?` → 0.
4. Non-destructive `idle`: after step 2, run `corpus queue claim-all` → the same event id appears in the batch (proving `idle` did not consume it), and `.corpus/queue/in-progress/` now holds it.
5. `corpus queue claim-all` again → `{"events":[]}`, exit 0.
6. `corpus queue complete <id>` → the file moves to `processed/`; run it again → no-op message, exit 0. Repeat the flow with `fail --reason "…"` → `failed/`, and `abandon` → `abandoned/`.
7. Halt: `corpus queue halt`, enqueue another event, run `corpus queue idle --timeout 15` → parks and times out with `reason: "halted"`; `corpus queue claim-all` → empty batch. `corpus queue resume` → the next `idle` returns the pending event.
8. SIGINT: start `corpus queue idle`, Ctrl-C after a few seconds → clean exit, `echo $?` → 0, no stack trace.
9. Server restart mid-poll: start `corpus queue idle`, `corpus server stop && corpus server start` → observe the single retry recovering the window; then `corpus server stop` alone → the command exits 4 with the "run `corpus server start`" message.
10. Stale recovery: claim an event and kill the consumer, then `corpus queue reap-stale --older-than 1s` → the event returns to `pending`; confirm on disk.
11. Locks: acquire a document lock through the server (agent edit in flight, or `POST` the lock endpoint), confirm the UI/API shows it, then `corpus lock break <docId>` → lock cleared, break recorded in the audit trail. Create an expired lock and run `corpus lock reap` → cleared.
12. Job logs: `corpus job log <eventId> "step 1: reading thread"` twice → both lines appear in `.corpus/jobs/<eventId>.jsonl` and stream into `GET /api/jobs/:id/log`; the UI console row (if running) shows the latest line live.
13. Pipe every JSON-emitting command through `jq .` → all parse.

## E2E Verification Log
_[Agent fills]_

### Reproduction (bugs only)
_N/A — feature issue._

### Post-Implementation Verification
_[Agent fills: application restarted, exact commands, observed output, confirmation feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain — the agent loop's contract with the server)
- [ ] `/evaluate` passes
- [ ] Committed with `[CLI-004]` prefix
