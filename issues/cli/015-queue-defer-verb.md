# [CLI-015] `corpus queue defer` verb

## Domain
cli

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-004, CONTRACT-021, SERVER-030
- Blocks: AGENT-007

## Spec References
- SPEC.md §7 — locks bullet (as amended 2026-07-30): a deferred edit re-enters the queue automatically when the lock clears

## Summary
SERVER-030's escalation (2026-07-30): `POST /api/queue/{id}/defer` is live but no CLI
verb reaches it, so the product agent cannot actually defer — AGENT-007 (orchestrate
skill uses defer instead of the interim fail-with-`deferred:`-prefix protocol) is
blocked on this. Thin client per the queue-verb conventions (CLI-004):
`corpus queue defer <id> --blocked-on <docId> [--reason <text>]`, surfacing the
server's 409 (only in-progress events defer) and 404 per the CLI's error conventions;
`--json` passes the event through. Regenerate docs/cli.md.

## Acceptance Criteria
- [x] Verb wired per the registry conventions; required `--blocked-on` validated locally (usage error, no request), reason optional
- [x] 409/404 surface as exit 5 with the server's message; success prints the deferred event (human) / envelope (`--json`)
- [x] docs/cli.md regenerated; hygiene inventories updated
- [x] E2E: real server — claim an event, defer it, see `deferred` in `corpus queue status`, release the lock, watch it re-enter

## Technical Design
### Files to Create/Modify
- `apps/cli/src/commands/queue/defer.ts` (+ test), queue index wiring, docs/cli.md

## Testing Strategy
apps/cli scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real server + scratch workspace (subshell-cd init, ports 9180-9199, never 8765): full defer → auto-re-enter cycle through CLI verbs only.

## E2E Verification Log

**implemented on: opus** (2026-07-30, cli-dev). Real built CLI
(`apps/cli/dist/bin/corpus.js`, after `npm run build`) against a real server. Scratch workspace
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/cli015-e2e`, created with the subshell-`cd` form
and an explicit `--port 9198` (9195–9199 all confirmed free first). `8765` was never bound —
`lsof -nP -iTCP:8765 -sTCP:LISTEN` empty before and after. No git command was run in the dev repo.

### Setup

```
$ corpus init . --port 9198
Initialized Corpus workspace at …/cli015-e2e
  port 9198, token in .corpus/config.json (mode 600)
$ corpus server start
corpus 0.0.0 listening on http://127.0.0.1:9198 (pid 67685)
$ corpus doc create --type note --title "Mortgage options" --folder finance -m "30-year fixed at 6.1%." --json
… "id": "doc_ok2qhkoz", "path": "data/docs/finance/mortgage-options.md"
```

The enqueue itself is the **user's** action, so it goes through the API the UI uses
(`POST /api/threads`, `requestsAgent: true`) — there is no CLI verb that opens a thread, by design.
Everything the agent does below is CLI-only.

```
→ {"thread":{"id":"th_lgmjjibo","agent":"requested",…},"eventId":"evt_on4qkl3ljhvf"}
```

### The two refusals, before the happy path

```
$ corpus queue defer evt_on4qkl3ljhvf --blocked-on doc_ok2qhkoz --from agent   # still pending
corpus: 409 conflict: queue event evt_on4qkl3ljhvf is pending; only in-progress work can be deferred
exit=5

$ corpus queue defer evt_nosuchevent --blocked-on doc_ok2qhkoz --from agent --json
{"error":{"code":"not_found","message":"404 not_found: no queue event evt_nosuchevent"}}
exit=5

$ corpus queue defer evt_on4qkl3ljhvf --from agent                             # no --blocked-on
corpus: `corpus queue defer` requires --blocked-on <doc-id>.
  Name the document whose edit lock the work is waiting for — that lock clearing is what returns
  the event to pending. Nothing was sent to the server. `corpus lock list` shows what is held.
exit=2
```

Both server refusals surface verbatim at exit 5; the missing flag is exit 2 and the event stayed in
`in-progress/` (nothing was sent — pinned in `defer.test.ts` against a stub whose `requests` stays
empty).

### The real block, then the deferral

```
$ corpus lock acquire doc_ok2qhkoz --from user
locked doc_ok2qhkoz for user, lease 300s.
$ corpus queue claim-all --from agent
{"events":[{"id":"evt_on4qkl3ljhvf","type":"comment.created",…}]}
$ corpus doc edit doc_ok2qhkoz --from agent -m "15-year fixed at 5.4%."
corpus: 423 locked: doc_ok2qhkoz is being edited by user; the lock was acquired at …
  The write was not applied. … defer and come back to it, rather than retrying in a loop.
exit=5
```

The `423` is the real guard refusing the real write, and its hint already names this verb.

```
$ corpus queue defer evt_on4qkl3ljhvf --blocked-on doc_ok2qhkoz \
      --reason "the user is editing this document" --from agent
event evt_on4qkl3ljhvf is deferred on doc_ok2qhkoz.
exit=0

$ corpus queue status
queue running — pending 0, in-progress 0, deferred 1, processed 0, failed 0, abandoned 0

$ ls .corpus/queue/deferred .corpus/queue/in-progress
deferred: evt_on4qkl3ljhvf.json      in-progress: (empty)

$ cat .corpus/queue/deferred/evt_on4qkl3ljhvf.json
{ …, "status": "deferred", "blockedOn": "doc_ok2qhkoz",
  "deferReason": "the user is editing this document" }

$ corpus job list --json
{"jobs":[{"eventId":"evt_on4qkl3ljhvf","status":"deferred", …,
          "blockedOn":"doc_ok2qhkoz","blockedOnTitle":"Mortgage options"}]}
```

`failed` stayed `0` throughout: a deferral is not a failure on any surface.

### Automatic re-entry, watched from a parked `idle`

```
$ corpus queue claim-all --from agent        # deferred work is not claimable
{"events":[]}

$ corpus queue idle --wait 20 --from agent &          (parked at 08:31:41)
$ corpus lock release doc_ok2qhkoz --from user        (at 08:31:44)
released the user lock on doc_ok2qhkoz.
idle returned at 08:31:45, exit 0:  evt_on4qkl3ljhvf comment.created
```

The parked long-poll unparked ~4s into a 20s window rather than sitting it out — no `job retry`, no
operator. On disk the pending file has **no** `blockedOn`/`deferReason`:

```
$ corpus queue status
queue running — pending 1, in-progress 0, deferred 0, …
$ cat .corpus/queue/pending/evt_on4qkl3ljhvf.json
{ …, "status": "pending", "updated": "2026-07-30T15:31:45Z" }        # both fields gone
```

### The cycle closed

```
$ corpus queue claim-all --from agent      → the event, again
$ corpus doc edit doc_ok2qhkoz --from agent -m "30-year fixed at 6.1%; 15-year fixed at 5.4%."
edited doc_ok2qhkoz                        # the edit that was blocked now applies
$ corpus queue complete evt_on4qkl3ljhvf --from agent
event evt_on4qkl3ljhvf is complete.
$ corpus queue status
queue running — pending 0, in-progress 0, deferred 0, processed 1, failed 0, abandoned 0
$ corpus job list --json
{"jobs":[{"eventId":"evt_on4qkl3ljhvf","status":"processed", …,"blockedOn":null,"blockedOnTitle":null}]}
$ corpus db doctor
projection is clean — 10 documents from 10 files (1ms)
```

### Second round: `--json` and force-break

A second thread on the same document, claimed and deferred under `--json`:

```
$ corpus queue defer evt_gqpjjfkichcj --blocked-on doc_ok2qhkoz --from agent --json
{"id":"evt_gqpjjfkichcj","type":"comment.created","created":…,"source":"thread","payload":{…}}
```

The envelope is the event verbatim, one JSON value, nothing added — `QueueEvent` carries no status,
which is also why the human line states the event's **state** (`is deferred on …`) rather than
claiming this call performed the move, exactly as `complete`/`fail`/`abandon` do.

```
$ corpus queue status --json
{"halted":false,"pending":0,"inProgress":0,"deferred":1,"processed":1,"failed":0,"abandoned":0}
$ corpus lock break doc_ok2qhkoz --from user
broke the user lock on doc_ok2qhkoz.
$ corpus queue status
queue running — pending 1, in-progress 0, deferred 0, processed 1, …     # force-break re-enters too
$ corpus queue claim-all --from agent && corpus queue complete evt_gqpjjfkichcj --from agent
event evt_gqpjjfkichcj is complete.
```

### Help and docs

`corpus queue --help` lists `defer` among the verbs and the topic blurb now names it as the fourth,
non-terminal outcome; `corpus queue defer --help` renders the arguments, both flags and all three
examples from the one registry declaration. `npm run docs:cli -w apps/cli` regenerated
`docs/cli.md` (`### corpus queue defer`, §957–1002); `prettier --check docs/cli.md` is clean, so the
generated-artifact drift check will not fire.

### Checks

`npm run build` first, then `VITEST_MAX_THREADS=4 npm test -w apps/cli` → **65 files, 772 tests, all
pass** (one workspace-scoped run, at the end). `tsc --noEmit` in `apps/cli` exits 0; `eslint
--max-warnings 0` over `apps/cli/src/commands/queue` exits 0; no rule disabled. New coverage:
`queue/defer.test.ts` (10 cases — path/body, reason, blank reason, trimmed id, `--json`, three
missing-`--blocked-on` shapes, 409 and 404), plus `queue/index.test.ts` extended (the verb list,
its contract path, and `QueueStatus.deferred` added to the stub's status body).

### Housekeeping

Server stopped by recorded pid (`corpus server stop` → `stopped (pid 67685)`); `ps -p 67685` gone;
9198 and 8765 both free afterwards. `/Users/theophanerupin/code/corpus/.corpus` absent — no
workspace state anywhere in the dev repo. Edits are exactly: `apps/cli/src/commands/queue/defer.ts`
(new) + `defer.test.ts` (new), `apps/cli/src/commands/queue/index.ts` + `index.test.ts`,
`apps/cli/src/commands/hygiene.test.ts` (module inventory), `docs/cli.md` (generated),
`issues/cli/015-…`, `issues/server/030-…` (AC1 annotation + Follow-up 1).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
