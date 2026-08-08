# [SERVER-064] One unreadable document stops the server from booting — and the docblock says it must not

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Sibling of: SERVER-063 (the same hold-out in the queue's mirror rebuild)

## Spec References

- SPEC.md §2.2 — the server's lifecycle; §5 — the document model

## Summary

Found by SERVER-063 while fixing the same class of fault one directory over.
**This one is wider**: it is any document in the corpus, not a queue file.

`apps/server/src/projection/project-document.ts:493` rethrows any non-`ENOENT`
read error. That runs under `populateFromFiles`, **whose own docblock says**:

> never fatal: one broken document must not take the server down

The code does exactly what the comment forbids. Reproduced on a real workspace:
`chmod 000` on one ordinary `.md` gives

```
EACCES … at projectDocument (project-document.ts:493)
        … at populateFromFiles (populate.ts:82)
        … at openProjection (db.ts:258)
```

and `corpus server status` reports `not running`.

So one unreadable file in `data/` costs the whole workspace its server, with the
same user-visible shape SERVER-063 fixed for the queue: `corpus server start`
prints *"the server exited during startup"* and there is no server left to ask
why. The blast radius is larger because a corpus holds far more documents than
queue events, and because documents are the thing the user actually owns.

## Acceptance Criteria

- [x] A server whose corpus holds an unreadable document **boots** and serves
- [x] `populateFromFiles`'s docblock becomes true, rather than the code being
      changed to match a weaker claim
- [x] The skipped document is excluded from the projection rather than recorded
      as something it is not, and the skip is logged at a level a `silent` server
      still writes (`error`), naming the path and the reason — the operator has
      to find the file by hand
- [x] Nothing is moved, quarantined or written on this path: boot is a read
- [x] `corpus db doctor` surfaces the resulting drift as an actionable finding,
      the way it already does for SERVER-063's queue case
      (`count_mismatch: … file(s) but the projection has … row(s)`)
- [x] Reproduced first, with the boot failure observed before the fix

## Technical Design

### Files to Create/Modify

- `apps/server/src/projection/project-document.ts` (`projectDocument`) and
  `apps/server/src/projection/populate.ts` (`populateFromFiles`)

### Notes

- **Follow SERVER-063's shape**, which followed SERVER-061's: the *store* stays
  honest and keeps throwing; the *reader* decides the policy and skips. That
  keeps one place to change if the policy ever changes.
- Distinguish the two faults as the queue now does: **malformed content** is
  expected residue (`debug`), an **unreadable file** is a workspace fault only an
  operator can fix (`error`).
- **The test needs a different trick.** SERVER-063 used a directory named
  `evt_*.json`, which `readdir` lists and every read of fails with `EISDIR`. That
  does **not** work here — the document enumerator lists files only, so a
  directory named `*.md` is never offered to the reader. `chmod` is unreliable in
  CI because root bypasses it, which would let the test pass without proving
  anything. Find a trick that holds for every user and say what it is.

### Related, out of scope

`availablePending` (`queue/service.ts:567`) and `claimAll`'s post-move read
(`:306`) still rethrow, so an unreadable file in `pending/` fails `idle` and
`claim-all`. Those are **request** paths rather than boot — the same class, a
smaller blast radius, and they deserve their own issue rather than being
smuggled into this one.

## Testing Strategy

A workspace containing one unreadable document and several readable ones: the
server constructs, the projection holds only the readable documents, the skip is
logged at `error` with path and reason, and nothing is moved. Plus an E2E boot
against a real workspace, before and after.

## E2E Verification Log

Implemented on **opus** (claude-opus-5, 1M context). Real workspace at
`/tmp/s064`, created with `corpus init --port 8823`, driven through the real
`corpus` bin (`apps/cli/dist/bin/corpus.js`). Ports 8765 and 5173 never touched.

### Before (reproduction, pre-fix)

A workspace with real content first, so the boot had something to lose: three
documents created through the API (`doc_zmsuqzwy`, `doc_qjrql7va`,
`doc_wpwibknz`), a clean `db doctor`
(`{"ok":true,"drift":[],"stats":{"files":12,"documents":12,…}}`). Then one
ordinary `.md` made unreadable the way a real workspace does it:

```
$ chmod 000 data/docs/inbox/beta-note.md
$ corpus server stop && corpus server start
corpus: the server exited during startup
  See /private/tmp/s064/.corpus/server.log for the full log.
$ corpus server status
not running
corpus: the workspace server is not running
```

`.corpus/server.log`, the crash exactly where the issue said it was — note the
frame at `populate.ts:82`, i.e. inside the function whose docblock forbids this:

```
{"level":"error","msg":"failed to start","error":"Error: EACCES: permission denied, open '/private/tmp/s064/data/docs/inbox/beta-note.md'","stack":"…
    at readFileSync (node:fs:439:35)
    at projectDocument (apps/server/src/projection/project-document.ts:493:15)
    at <anonymous> (apps/server/src/projection/populate.ts:62:23)
    at sqliteTransaction (better-sqlite3/lib/methods/transaction.js:65:24)
    at populateFromFiles (apps/server/src/projection/populate.ts:82:4)
    at openProjection (apps/server/src/projection/db.ts:258:35)
    at openWorkspaceProjection (apps/server/src/projection/attach.ts:23:10)
    at runServerProcess (apps/server/src/lifecycle.ts:182:47)"}
```

And the recovery loop closed on itself, which is the whole complaint: with no
server there is nothing to ask.

```
$ corpus db doctor
corpus: server not running for this workspace — run `corpus server start`
```

### After (same workspace, same unreadable file)

```
$ corpus server start
corpus 0.4.0 listening on http://127.0.0.1:8823 (pid 76562)
$ corpus server status
running — pid 76562 on :8823, corpus 0.4.0, up 0s
```

Named, with its reason, at `error`. Proved to be the level a `silent` server
still writes by running one at it — this is the log file in its **entirety**:

```
$ CORPUS_LOG_LEVEL=silent corpus server start
--- corpus server start 2026-08-07T18:12:04.627Z pid=77495 port=8823 ---
{"level":"error","msg":"skipping unreadable document","path":"data/docs/inbox/beta-note.md","reason":"EACCES: permission denied, open '/private/tmp/s064/data/docs/inbox/beta-note.md'"}
```

Excluded, not recorded as something it is not — the file's siblings are all
there and it is not:

```
$ corpus doc list --json    → data/docs/inbox/alpha-note.md, data/docs/inbox/gamma-note.md, data/docs/views/inbox.md
```

Serving, on the write path as well as the read one, with the bad file present:

```
$ corpus doc create --title "Delta note" --from user   → created doc_utuwu76g
$ corpus thread create --parent doc_zmsuqzwy --quote "Context" --message "…" --from user
                                                       → created th_t74jcvlt — anchored at anc_92da6304
$ git log --oneline   (workspace repo)
92b42ff comment: new thread on doc_zmsuqzwy (th_t74jcvlt) by user
8a24bc5 doc create: Delta note (doc_utuwu76g) by user
```

Nothing moved, nothing quarantined, nothing written: mode, size and mtime
unchanged (`---------- 230 1786125579 data/docs/inbox/beta-note.md`), the
document tree still holds exactly `alpha/beta/gamma/delta`, and no new directory
appeared anywhere under `data/` or `.corpus/`.

### The recovery loop, which did **not** fall out

Checked rather than assumed, and it was broken: `doctor`'s `classifyUnprojected`
caught *every* read failure and returned "vanished between enumeration and read
— not drift". So post-fix-but-pre-`doctor`-fix the workspace was quietly one
document short and the check whose whole job is to notice reported `ok: true`
(pinned: with only that half reverted, the new `doctor` test fails with
`expected true to be false`). Now:

```
$ corpus db doctor
unparseable data/docs/inbox/beta-note.md: data/docs/inbox/beta-note.md is a document under a root but could not be read: EACCES: permission denied, open '/private/tmp/s064/data/docs/inbox/beta-note.md'
corpus: the projection has drifted from the files — 1 finding.
$ echo $?
6
```

`corpus db rebuild` says the same thing in its own words, so a rebuild cannot be
mistaken for a repair: `rebuilt the projection in 14ms — 12 documents … —
skipped 1 file (data/docs/inbox/beta-note.md)`.

**`unparseable` rather than `missing_row`, deliberately.** The kind is what the
boot catch-up keys on (`watcher/catch-up.ts`), and no number of repopulates will
make this file readable — calling it repairable would buy every boot of this
workspace a full re-scan plus a coarse invalidate, forever, for no repair, which
is exactly the cost SERVER-025 excluded `unparseable`/`duplicate_id` to avoid,
for exactly this reason: it is a state of the *workspace*, and it survives every
rebuild.

### Healing

`chmod 644` with the server running — the watcher picked it up with no restart:

```
$ chmod 644 data/docs/inbox/beta-note.md && sleep 2 && corpus db doctor
projection is clean — 14 documents from 14 files (2ms)   (exit 0)
$ corpus doc list --json   → beta-note.md back among its siblings
```

### The test trick, and why it holds for root

`chmod 000` alone is not a proof — **root bypasses file permissions**, so under
uid 0 the file reads fine and the test passes having exercised nothing.
SERVER-063's trick does not transfer either: `enumerateDocuments` requires
`isFile()` (stat-resolved, so a symlink-to-directory and a FIFO are refused too),
so a directory named `*.md` is never offered to the reader at all.

So `projection/unreadable-fixture.ts` **does not assume it worked**: it chmods,
then *checks by reading*, and only if the read succeeded — i.e. only for a
caller whose privilege carried through the permission bit — escalates to a
mechanism no privilege can bypass. A file larger than `kIoMaxLength` (2 GiB) is
refused by `readFileSync` in Node's own JavaScript, decided by the file's size
and nothing else: no bit to override, no capability that helps, nothing
platform- or filesystem-specific. `truncate` extends it sparsely, so it costs
~1 ms and 4 KB on disk. Either way the fixture asserts its own postcondition
before returning — regular file, and reading it throws — so a test built on it
can never quietly become a test of nothing.

The size trick is the *fallback* rather than the default because reading such a
file is what costs: Node's utf8 fast path skips the size check and reads the
whole file before failing to make a string of it (measured: **2.3 GB peak RSS,
0.75 s**), which is a poor thing to put in a suite that has a free alternative
for every non-root user. The code under test branches on *whether the read
threw*, never on which errno, and the E2E above covers the `EACCES` spelling end
to end.

### Checks

- `VITEST_MAX_THREADS=4 npx vitest run apps/server` — **3467 passed, 0 failed**
- All five new tests fail without the fix, with the pre-fix error verbatim
  (`Error: EACCES … at Object.openSync`); the `doctor` half fails independently
  with the fix's other half in place (`expected true to be false`)
- `npx eslint` and `npx prettier --check` clean on all seven touched files;
  `npm run typecheck -w apps/server` clean

### Observed, not fixed (each needs its own issue)

- **The `db doctor` remedy line is wrong for this finding.** The CLI prints
  "Re-derive it from the files with `corpus db rebuild`" under every drift, and a
  rebuild cannot fix a file the process cannot read (it reports the same skip).
  The `detail` is actionable; the suggestion below it is not. `apps/cli`.
- `availablePending` (`queue/service.ts:567`) and `claimAll`'s post-move read
  (`:306`) still rethrow — untouched here, as the issue directs.
- The **watcher** path is already safe and needed nothing: `flush()` catches per
  entry and logs `watcher failed to process a change` at `error`
  (`watcher.ts:418`), so touching an unreadable file degrades that one file
  rather than the process.
- `doctor`'s *second* read (hashing a file that already has a row,
  `doctor.ts:169`) still swallows every failure. Deliberately left: that row is
  not wrong — it describes the bytes last projected — and reporting
  `content_mismatch` there would be both false and a boot-catch-up trigger.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
