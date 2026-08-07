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
- ~~An unlistable *status directory* is unreachable from this reader:
  `ensureLayoutSync`'s `mkdir` fails on it first (`EEXIST`), which is a write.~~
  **Wrong — see the review-fix round below.** `mkdirSync(dir, { recursive: true })`
  succeeds on an existing directory whatever its mode, so the listing was reached
  and threw.

## E2E Verification Log — review-fix round (PR #25 re-review)

Ran on **opus** (claude-opus-5, 1M context). Real workspace at `/tmp/s063b`,
`corpus init --port 8793`, driven through the real `corpus` bin
(`apps/cli/dist/bin/corpus.js`) — port 8765 never touched.

### The finding

`apps/server/src/queue/project.ts:96-98` shipped a docblock claiming an
unlistable status directory "is not handled here and does not need to be:
`ensureLayoutSync` runs first and fails on it, from the `mkdir`". It does not
fail: `ensureLayoutSync` is `mkdirSync(dir, { recursive: true })`
(`store.ts:233-237`), which succeeds on an **existing** directory regardless of
its mode. `listIdsSync` then threw uncaught out of `scanQueueSync` →
`rebuildMirror` → the `QueueService` constructor — verbatim the failure this
issue was filed to remove. The async sibling already handled it and said so
(`held.ts:120-128`, "an unlistable directory offers no per-file granularity to be
narrow with"), so the two readers did **not** agree the way the docblock claimed.

### Before (reproduction, pre-fix)

Real work first, so there was something to lose: one document (`doc_3q5qxsfp`),
two threads → two `comment.created` events, both claimed, one completed —
`in-progress/evt_qfplspytl4v5.json` and `processed/evt_apekvmieewiz.json`.

```
$ chmod 000 .corpus/queue/pending
$ corpus server stop && corpus server start
corpus: the server exited during startup
  See /private/tmp/s063b/.corpus/server.log for the full log.
$ corpus server status
corpus: the workspace server is not running
```

`.corpus/server.log` — the `mkdir` did **not** fail; the listing did:

```
{"level":"error","msg":"failed to start","error":"Error: EACCES: permission denied, scandir '/private/tmp/s063b/.corpus/queue/pending'","stack":"…
    at readdirSync (node:fs:1545:26)
    at QueueStore.listIdsSync (apps/server/src/queue/store.ts:256:15)
    at scanQueueSync (apps/server/src/queue/project.ts:105:28)
    at rebuildQueueMirrorSync (apps/server/src/queue/project.ts:127:16)
    at QueueService.rebuildMirror (apps/server/src/queue/service.ts:202:18)
    at new QueueService (apps/server/src/queue/service.ts:169:10)
    at createServer (apps/server/src/app.ts:327:17)"}
```

### The fix

Same shape as SERVER-061 → SERVER-063: the **store** stays honest and throws
what the filesystem threw; the **reader** decides the policy. `scanQueueSync`
wraps `listIdsSync` per status, reports the refusal as a new
`QueueScanResult.unlistable` entry (`{ status, reason }` — no id, because there
is none), and carries on with the remaining status directories. Nothing is moved
or quarantined: boot is a read. The events inside a skipped directory are simply
absent from the array the mirror replaces the `events` table with — excluded, not
counted as something they are not. `rebuildMirror` logs one line per skipped
directory at `error`, the level a `silent` server still writes, and the message
carries the consequence an operator needs, not just the errno. The docblock now
states what is actually true about `ensureLayoutSync`: its `mkdir` refuses a
status *path that is not a directory at all* (a layout fault, and a write), and
lets an unreadable directory through to this reader.

### After (same workspace, same `chmod 000`, restarted)

```
$ corpus server start
corpus 0.3.0 listening on http://127.0.0.1:8793 (pid 16476)
$ corpus server status
running — pid 16476 on :8793, corpus 0.3.0, up 0s, http://127.0.0.1:8793
```

```
{"level":"error","msg":"cannot list queue status directory; its events are missing from the projection","status":"pending","reason":"EACCES: permission denied, scandir '/private/tmp/s063b/.corpus/queue/pending'"}
```

Excluded from the counts, not miscounted — `chmod 000 .corpus/queue/processed`
as well and restarting, `corpus job list` drops that event and keeps the rest,
rather than reporting it as present or as something else:

```
$ corpus job list --json
{"jobs":[{"eventId":"evt_qfplspytl4v5","status":"in-progress",…}]}
```

Recovery closes the loop, with a running server to do it from:

```
$ chmod 755 .corpus/queue/pending .corpus/queue/processed && corpus server stop && corpus server start
corpus 0.3.0 listening on http://127.0.0.1:8793 (pid 16790)
$ corpus job list --json   → [('evt_qfplspytl4v5','in-progress'), ('evt_apekvmieewiz','processed')]
$ corpus queue status --json
{"halted":false,"pending":0,"inProgress":1,"deferred":0,"processed":1,"failed":0,"abandoned":0}
$ corpus db doctor --json
{"ok":true,"drift":[],"warnings":[],…}
```

### The test trick, and its honest limit

**There is no filesystem trick that makes an existing directory unlistable for
every user, root included.** The privilege-free faults all change *what the path
is* rather than who may read it, and each is refused by `ensureLayoutSync`'s
`mkdir` before the scan runs — measured, all five:

| status path                | `mkdirSync(recursive)` | `readdirSync` |
| -------------------------- | ---------------------- | ------------- |
| regular file               | `EEXIST`               | `ENOTDIR`     |
| symlink → file             | `EEXIST`               | `ENOTDIR`     |
| symlink → missing          | `ENOENT`               | `ENOENT`      |
| symlink loop               | `ELOOP`                | `ELOOP`       |
| `chmod 000` directory      | **ok**                 | `EACCES`      |

Only the last row reaches the reader, and `chmod` is exactly what root bypasses.
So the coverage is split, and both halves are real:

1. **A real, privilege-free unlistable directory, through the real store** — a
   status path replaced by a **regular file**, which `readdirSync` refuses with
   `ENOTDIR` for every user including root. This is the directory-level twin of
   SERVER-063's `evt_*.json`-as-a-directory `EISDIR` trick. It reaches the scan
   through `QueueService.attachMirror` — itself a boot call (`attachProjection`
   runs it after `createServer`), and the call `ensureLayoutSync` does not
   precede. Two tests: `queue/project.test.ts` on the scan, and
   `queue/service.test.ts` end to end through the service (survives, logs at
   `error`, mirrors the surviving statuses only, then serves a full
   enqueue → claim round trip).
2. **The reported `EACCES` shape, at the seam it arrives through** — a
   `RefusingStore extends QueueStore` whose `listIdsSync` throws the same error
   `readdirSync` throws for a `chmod 000` directory. Injected at the store rather
   than produced on disk precisely because a `chmod`-based test would silently
   prove nothing when the suite runs as root. This is the same seam-testing
   precedent as the watcher's `readHead` budget test.

All three new tests fail without the fix, with the real error escaping
(`ENOTDIR … at readdirSync`, `EACCES … at RefusingStore.listIdsSync`,
`ENOTDIR … at readdirSync`) — verified by reverting the `try`/`catch`.

### Sibling boot-time readers, swept

- **`plugins/discover.ts:158` has the same defect, one for one.** Its docblock
  says "Never throws"; it guards with `existsSync(pluginsRoot)` and then calls
  `readdirSync(pluginsRoot, { withFileTypes: true })` unguarded. `existsSync` on
  a `chmod 000` directory returns **true** (measured) and the `readdir` then
  throws `EACCES`, out of `lifecycle.ts:186`, during boot — no server, no
  explanation. Lower blast radius than the queue's (the plugins root is inside
  the installed tool, not the user's workspace, so an operator is less likely to
  break it), but it is the same hold-out with the same wrong docblock. **Needs
  its own issue; not fixed here** — sibling of SERVER-064.
- Clean: `projection/roots.ts:178` (`enumerateDocuments`),
  `projection/project-runtime.ts:47` (`listFiles`, the events/locks/jobs/seen
  pass) and `projection/unindexable.ts:186` all swallow a failed `readdir` and
  treat the directory as empty. They do not take boot down. Worth noting that
  they are silent about it — no log at any level — which is the opposite failure
  mode from this one and is out of scope here.
- `locks/store.ts:180` (`listAll`) rethrows a non-`ENOENT` `readdir` failure, but
  it is a request path (`GET /api/locks`, reaping), not boot — the projection's
  locks pass goes through `project-runtime.ts`'s swallowing `listFiles`.

### Also observed, out of scope

- **Request paths still rethrow on an unlistable directory**, extending the note
  already recorded above: with `pending/` at `chmod 000`, `corpus queue status`
  answers `500 internal_error` (`service.ts:542` counts via `listIds`), as do
  `idle` and `claim-all`. Requests, not boot; a `500` leaves a server standing to
  ask why.
- **`db doctor` cannot see into an unlistable directory either.** Its
  `listQueueEventFiles` swallows the failed `readdir`, so files and rows agree by
  construction and it reports `{"ok":true}` while an event is invisible — which
  is precisely why the `error` log line has to name the directory.
- **The boot log carries each skip twice.** `rebuildMirror` runs from the
  constructor and again from `attachMirror`, so both the unreadable-file line
  (shipped) and the new unlistable-directory line appear once per rebuild.
  Pre-existing and harmless; not introduced by this round.
- **`ensureLayoutSync` itself still fails boot** when a status path is a file, a
  symlink to one, or a loop (the `EEXIST`/`ELOOP` rows above). That is a write
  refusing an unusable layout — the queue genuinely cannot function for that
  status — and it stays out of scope by the same reading/writing split this issue
  drew from the start. The docblock now says so instead of claiming the `mkdir`
  covers the read.

### Checks (review-fix round)

- `VITEST_MAX_THREADS=4 npx vitest run apps/server` — **3346 passed, 0 failed**,
  785 suites (exit 0); was 3343 before the three new tests
- `npx tsc --noEmit` in `apps/server` — clean
- `npx eslint` / `npx prettier --check` clean on all four touched files

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
