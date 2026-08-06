# [SERVER-063] One unreadable queue file stops the server from booting

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Spec References

- SPEC.md §7 — the queue's promise that an event is "never silently dropped";
  §2.2 — the server's lifecycle

## Summary

Found by accident during SERVER-061's review-fix round, while restarting a server
with a `chmod 000` file left in `.corpus/queue/in-progress/`. **It is
pre-existing, not introduced by that work**, and its blast radius is larger than
the finding that surfaced it.

`QueueService`'s constructor calls `rebuildMirror` → `rebuildQueueMirrorSync` →
`scanQueueSync` → `readEventSync`, and that last one **rethrows `EACCES`** exactly
as its async twin did before it was fixed. The constructor runs during boot, so
the failure is not "the queue is degraded" — it is `corpus server start` printing
*"the server exited during startup"*, with **no server left to ask why**.

One unreadable file costs the whole workspace its server, and the workspace is
the user's data. The recovery is to find the file by hand, which is exactly what
having no running server makes hardest.

**The lone-hold-out detail is what makes this clearly a bug rather than a
policy.** A *different* boot-time reader already skips the same file gracefully —
`"msg":"skipping unreadable queue event"` appears in the same log, immediately
before the crash. So the system already knows how to survive this; the mirror
rebuild is the one path that does not.

## Acceptance Criteria

- [x] A server whose queue holds an unreadable file **boots**, serves, and logs
      the skip at a level a `silent` server still writes
- [x] The skipped event is excluded from the mirror's counts rather than counted
      as something it is not — an event the projection cannot read must not be
      reported as present
- [x] Consistent with the two paths that already do this: the async
      `readHeldInProgress` (SERVER-061's fix) and the boot-time reader that
      already logs "skipping unreadable queue event". Three readers, one rule
- [x] Reproduced first against a real workspace, with the boot failure observed
      before the fix

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/project.ts` (`rebuildQueueMirrorSync` / `scanQueueSync`)
  and `apps/server/src/queue/store.ts` (`readEventSync`)

### Notes

- **Do not quarantine on this path.** Boot is a read; SERVER-061 established that
  a read path skips and logs rather than moving files, and moving a file the
  process could not read is not something a boot should attempt.
- The distinction SERVER-061 drew is worth keeping: *malformed content* is
  expected residue that `reap-stale` clears, logged at `debug`; an *unreadable
  file* is a workspace fault only an operator can fix, logged at `error`.
- A related limit, recorded and correct: with `in-progress/` itself unreadable, a
  claim still fails — not from the report, but from the `move` whose destination
  is unusable. That is honest and is **not** in scope here. This issue is about
  reading, not writing.

## Testing Strategy

A queue directory containing an entry that lists but cannot be read (a directory
named `evt_*.json` gives `EISDIR` for every user, unlike `chmod`, which root
bypasses — the trick SERVER-061's tests already use). Assert the service
constructs, the mirror holds the readable events only, and the skip is logged at
`error`. Plus an E2E boot against a real workspace.

## E2E Verification Log

Implemented on **opus** (claude-opus-5, 1M context). Real workspace at
`/tmp/s063`, created with `corpus init --port 8791`, driven through the real
`corpus` bin (`apps/cli/dist/bin/corpus.js`) — port 8765 never touched.

### Before (reproduction, pre-fix)

Real work first, so the mirror had something to lose: one document
(`doc_375wzfss`), two threads, so one event claimed into `in-progress/`
(`evt_hkc7ghnujc6j`) and one left `pending` (`evt_z4xhc25nz7zo`). Then the
unreadable entry, made the way the tests make it — a **directory** named
`evt_*.json`, which `readdir` lists as an event file and every read of fails
with `EISDIR` for every user, unlike a `chmod` root bypasses:

```
$ mkdir .corpus/queue/in-progress/evt_unreadable00.json
$ corpus server stop && corpus server start
corpus: the server exited during startup
  See /private/tmp/s063/.corpus/server.log for the full log.
$ corpus server status
not running
```

`.corpus/server.log`, with the lone-hold-out evidence one line above the crash:

```
{"level":"info","msg":"skipping unreadable queue event","path":"…/in-progress/evt_unreadable00.json","error":"Error: EISDIR: illegal operation on a directory, read"}
{"level":"error","msg":"failed to start","error":"Error: EISDIR: illegal operation on a directory, read","stack":"…
    at QueueStore.readEventSync (apps/server/src/queue/store.ts:285:14)
    at scanQueueSync (apps/server/src/queue/project.ts:57:26)
    at rebuildQueueMirrorSync (apps/server/src/queue/project.ts:72:16)
    at QueueService.rebuildMirror (apps/server/src/queue/service.ts:196:18)
    at new QueueService (apps/server/src/queue/service.ts:169:10)
    at createServer (apps/server/src/app.ts:327:17)"}
```

The projection's own boot pass had already skipped that exact file; the mirror
rebuild was the one path that did not.

### After (same workspace, same unreadable entry, rebuilt server)

```
$ corpus server start
corpus 0.3.0 listening on http://127.0.0.1:8791 (pid 57086)
$ corpus server status
running — pid 57086 on :8791, corpus 0.3.0, up 0s
```

Log — at `error`, the one level a `silent` server still writes, naming the file
and the reason an operator needs:

```
{"level":"error","msg":"skipping unreadable queue event","id":"evt_unreadable00","status":"in-progress","reason":"EISDIR: illegal operation on a directory, read"}
```

Excluded from the mirror, not counted as something it is not — `corpus job list`
(the `events` table) holds the two readable events and nothing else:

```
{"jobs":[{"eventId":"evt_z4xhc25nz7zo","status":"pending",…},{"eventId":"evt_hkc7ghnujc6j","status":"in-progress",…}]}
```

Still serving, and the in-progress report agrees with the boot scan (`total: 1`,
skipping the same entry via SERVER-061's path):

```
$ corpus queue claim-all --from agent --json
{"events":[{"id":"evt_z4xhc25nz7zo",…}],"inProgress":{"events":[{"id":"evt_hkc7ghnujc6j",…}],"total":1,"truncated":false}}
$ corpus queue complete evt_z4xhc25nz7zo --from agent   → processed
```

The recovery loop is now closed, which is the point of the issue: with a server
running, `corpus db doctor` names the fault
(`count_mismatch: .corpus/queue holds 3 evt_*.json file(s) but the projection has
2 event row(s)`), and after `rmdir .corpus/queue/in-progress/evt_unreadable00.json`
a restart is clean (`{"ok":true,"drift":[]}`).

Left where it was: nothing moved to `failed/`, nothing quarantined — verified in
both the E2E and the unit test.

### Checks

- `VITEST_MAX_THREADS=4 npx vitest run apps/server` — 3343 passed, 0 failed
  (exit 0). An earlier run of the same command, made while the machine was busy,
  reported two `STACK_TRACE_ERROR`s with no assertion detail
  (`docs/delete.test.ts`, `queue/service.test.ts`); both pass on their own and in
  the clean full run — load artifacts, not regressions.
- Both new tests fail without the fix (verified by reverting the `try/catch`:
  `Error: EISDIR … at QueueStore.readEventSync … at new QueueService`)
- `npx eslint` / `npx prettier --check` clean on all four touched files

### Out of scope, observed and reported

- **Documents have the same boot-time hold-out, and it is bigger.**
  `projectDocument` (`projection/project-document.ts:493`) rethrows a non-`ENOENT`
  read error, so `populateFromFiles` — whose own docblock says "never fatal: one
  broken document must not take the server down" — kills boot on an unreadable
  document file. Reproduced on the same workspace with `chmod 000` on a real
  `.md`: `EACCES … at projectDocument … at populateFromFiles … at openProjection`,
  `corpus server status` → `not running`. Needs its own issue; not fixed here.
- `availablePending` (`queue/service.ts:567`) and `claimAll`'s post-move read
  (`:306`) still rethrow, so an unreadable file in `pending/` fails `idle`/
  `claim-all`. Request paths, not boot — the sibling of SERVER-061's finding.
- `corpus queue status` counts `in-progress: 2` while the mirror holds one: that
  count is `readdir`-name-based and always has been (a malformed file counts
  there too). It is the directory's depth, and the discrepancy is precisely what
  `db doctor` turns into an actionable finding.
- An unlistable *status directory* is unreachable from this reader:
  `ensureLayoutSync`'s `mkdir` fails on it first (`EEXIST`), which is a write.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
