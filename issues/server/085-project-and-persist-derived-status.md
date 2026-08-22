# [SERVER-085] The board, queries and the file all agree on a derived status

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-036 (rider must be signed first), PLUGINS-016
- Blocks: UI-092

## Spec References

- SPEC.md §12 — as amended by SHARED-036, including "the file never disagrees
  with what is shown"
- SPEC.md §9.1 — `documents` projection row carries `status`
- SPEC.md §11 — validation and `db doctor`

## Summary

PLUGINS-016 makes a derived status computable. This issue makes it the answer
everywhere the system reports a status: the projection row, `GET
/api/docs?status=`, every saved view and column built on a status filter, and
the document's own frontmatter on disk.

The last one is the point of the rider's closing sentence. Without it a todo
document's file says `status: open` while the board says `resolved` — so `git
grep`, `corpus doc` output and the UI disagree, and the disagreement is
invisible until someone reads the file.

## Acceptance Criteria

- [x] `readDocumentFields` (`apps/server/src/projection/project-document.ts:143`)
      stores the derived status for types that declare one, and the stored value
      for every type that does not
- [x] `GET /api/docs?status=resolved` returns a todo document whose items are
      all checked, and does not return one with an open item
- [x] `status=archived` still returns an archived todo document regardless of
      its items; unarchiving returns it to whichever of `open`/`resolved` its
      items say
- [x] Whenever the server writes a todo document — through the core body write
      path (a UI checkbox toggle) **and** through the plugin's item routes (the
      CLI and agent path) — the derived value is written into the file's
      frontmatter in the **same** write and therefore the same commit. Never a
      second commit, never a second `updated` bump.
- [x] `corpus db rebuild && corpus db doctor` is clean on a workspace holding
      completed, incomplete, empty and archived todo documents
- [x] `corpus doc check` does not report a document whose stored status differs
      from its derived one as invalid — the write path converges it; the
      validator does not police it
- [x] The projection is correct after an **out-of-band** edit: `printf >>` a
      `- [x]` line into a todo file, and the SSE invalidation reprojects with the
      new derived status

## Technical Design

### Files to Create/Modify

- `apps/server/src/projection/project-document.ts` — `readDocumentFields`
  currently does `root.status ?? (status.success ? status.data : "open")`. The
  `root.status` override is the existing precedent for a status the file does not
  own; derived status is a second such source and should read as one rather than
  as a special case bolted beside it.
- `apps/server/src/plugins/discover.ts` / `context.ts` — expose the declaration
  to the projection
- the core document write path — where the derived value is written back
- `apps/server/src/projection/doctor.ts` — confirm doctor's file-vs-row check
  compares against the derived value, or it will report drift on every todo
  document

### Key Implementation Details

**Write-back and reprojection must not fight.** The write path converges the
frontmatter; the projection derives from the body. If both run they must reach
the same answer, and the write must not trigger a second write. Derive once per
write, use the value for both.

**The out-of-band path has no write to hang the convergence on.** A file edited
outside the server reprojects with the derived status, but its frontmatter stays
stale until the next server write. That is acceptable and matches how the rest of
the system treats out-of-band edits (files are the source of truth; the server
converges when it next writes) — but say so in the code, because it is exactly
the case a later reader will mistake for a bug.

### Edge Cases

- A todo document written while the plugin is **absent** (the §12 M6 subtractive
  check) — no declaration, so no derivation and no write-back. The stored value
  stands and nothing errors.
- An archived todo document that gets an item checked — stays `archived`; the
  write-back must not overwrite `archived` with `resolved`.
- A document whose items are unreadable — no derivation, no write-back.
- A type declaring derived status whose derivation throws — contained, logged,
  falls back to the stored value. A plugin must not be able to break projection.

## Testing Strategy

Vitest against a real temp workspace: project a todo document in each state and
assert the row's status; write through both paths and assert the file's
frontmatter converged in one commit (`git log --oneline` length unchanged by the
convergence); rebuild + doctor clean; an out-of-band append reprojects.

## E2E Verification Plan

### Reproduction Steps (bugs only)

1. `corpus server start` on a real workspace
2. Create a todo document with one item; check it in the UI
3. `curl "…/api/docs?status=resolved"` — expect it absent
4. `cat` the file — expect `status: open`
5. Both confirm the bug

### Verification Steps

1. Restart the server
2. Check the last item in the **UI**; confirm `GET /api/docs?status=resolved`
   returns the document, the file's frontmatter reads `resolved`, and `git log`
   shows **one** new commit
3. Uncheck it; confirm all three revert
4. Repeat via `corpus todos check` and confirm identical results through the CLI
   path
5. Archive the completed document; confirm it reads `archived` and that checking
   or unchecking items does not disturb that
6. `printf -- '- [x] extra\n' >> <file>` out of band; confirm SSE invalidation
   and that the projection reports the new derived status
7. `corpus db rebuild && corpus db doctor` — clean

## The out-of-band question, answered

The issue named this its own open problem: the write path converges the
frontmatter, the projection derives from the body, and an out-of-band edit has no
server write to hang the convergence on.

### The decision

**The derived value is authoritative at every surface that *reports* a status —
the `documents` row, `GET /api/docs/{id}`, `?status=`, every saved view and
column built on one. The frontmatter `status:` is a shadow of that derivation,
converged by every server write of the document and by no write opened for the
convergence alone.**

Three things follow, and they are the whole rule:

1. Every write already going to disk carries the derived value, because the
   convergence sits in `applyOperations` — the one point a create, a body save,
   the plugin's item routes, an unarchive, a bulk field edit and every verb
   after them all pass through. Same write, same commit, one `updated` stamp.
2. The **watcher's own rewrite** carries it too. When anchor reconciliation has
   already decided to rewrite the file (SPEC.md §6), the convergence rides that
   write and lands in the commit SERVER-090 gives the out-of-band edit. It never
   makes that pass write when it would not have.
3. Everything else waits. Between an out-of-band edit and the next server write,
   the file's `status:` line can disagree with the row. Nothing a person sees is
   wrong — the reader, the board and every query read the derived value — and the
   first write of any kind converges it, including the reader's own autosave,
   because the reader is shown the derived value and saves what it was shown.

**What it costs.** For that window, `cat` and `git grep` are the two surfaces
that can be wrong about a todo document's status, which are exactly the surfaces
the person editing the file by hand is already looking at. Verified live: after
`printf -- '- [ ] bread\n' >> groceries.md` the file read `status: resolved`
while `GET /api/docs/{id}`, `?status=open` and the board all read `open`; a later
`PUT` carrying only a tag converged the file in that write, in the same commit.

### Rejected: the watcher converges by opening its own write

This is the version that would close the window entirely, and it buys the two
surfaces above at a price §6 pays only because it must. `writeAtomically` renames
bytes the watcher read a moment ago, so a save landing between the read and the
rename is **overwritten** — a real loss of the person's newest keystrokes. The
anchor pass accepts that risk because §6's catch-all "may not become
best-effort" (SERVER-022 finding 10); a shadow field does not earn it. It would
also turn every external edit of every todo document into a server write of a
file someone has open in another program, which editors answer with a reload
prompt or by clobbering it back on their next save.

### Rejected: `doctor` reports the drift

`doctor` compares a file's **bytes** against the hash recorded for them, never a
row's fields against frontmatter, so a stale shadow is invisible to it today —
and that is right, not an oversight. `db rebuild` is doctor's own repair and it
writes no files, so a finding of this kind could never be cleared by the thing
the report tells you to run. `rebuild && doctor` would go from a standing
invariant to a check that reports a healthy workspace as unclean, which teaches
an operator to ignore it. Confirmed clean on a workspace holding a completed, an
incomplete, an empty and an archived todo document — one of them with a
deliberately stale shadow.

### Rejected: the file is the answer and the projection follows it

That is the auto-flipped stored field SHARED-036 turned down on 2026-08-08 — a
value something else keeps in sync is a value that can drift. Not re-opened.

### Why "derive once per write" is two calls on purpose

The issue asked that the write path and the reprojection cannot reach different
answers. They cannot, and the guarantee is stronger than threading one value
through would be: `convergeDocumentText` derives from the exact bytes it is about
to write, and `projectDocument` derives from the file those bytes became, through
**the same function** — `resolveDocumentStatus`, which lives in the projection
and which the write path calls. Threading the value from the write into the
projection would make the row a report of what the writer decided rather than a
reading of what is on disk, and the two would then agree by assertion instead of
by construction. No second write is possible either way: the projection writes
nothing, and the convergence only edits the content of a write already planned.

### Why no `SCHEMA_VERSION` bump

An existing `cache.db` holds stored statuses for todo documents. It is corrected
without a bump because `openProjection` repopulates from files on **every** boot
(`populate !== false`), which is also why plugin discovery had to move ahead of
it — verified by deleting `cache.db` and cold-booting, and pinned by a lifecycle
test.

## E2E Verification Log

**Model: Opus 5 (1M context), as recommended.** Real workspace, real server on
port 8971 (never 8765, the user's), real `git`, real todos plugin. Output
verbatim, 2026-08-21.

### Boot: the seam is discovered, with no warnings

```
$ corpus init …/s085-ws --port 8971 && corpus server start --workspace …/s085-ws
corpus 0.16.0 listening on http://127.0.0.1:8971 (pid 28298)
$ grep -o '"plugin":"todos"[^}]*' .corpus/server.log
"plugin":"todos","routes":true,"types":["todo"],"derives":["todo"]
$ grep -c warning .corpus/server.log
0
```

### The CLI/agent path: `corpus todos check`, file and query together

```
$ curl -X POST …/api/docs -d '{"type":"todo","title":"Errands","folder":"inbox",
    "body":"- [ ] renew the passport\n- [ ] file the taxes\n"}'
doc_6hdrqxeq … "status": "open"
$ corpus todos check doc_6hdrqxeq 1 && corpus todos check doc_6hdrqxeq 2
checked item 1 of Errands [doc_6hdrqxeq] — renew the passport
checked item 2 of Errands [doc_6hdrqxeq] — file the taxes
$ sed -n '8p;15,16p' data/docs/inbox/errands.md
status: resolved
- [x] renew the passport
- [x] file the taxes
$ curl …/api/docs?status=resolved&type=todo   →  [('doc_6hdrqxeq', 'resolved')]
$ curl …/api/docs?status=open&type=todo       →  []
$ git log --oneline
ef3fa7a doc edit: Errands (doc_6hdrqxeq) by user
52c5fe9 workspace: initialize corpus workspace by user
$ git show HEAD:data/docs/inbox/errands.md | grep -n status:
8:status: resolved
```

**One commit**, holding the converged status — the create and both checks folded
into §4's open window, and the convergence added nothing of its own.

Unchecking reverts all three:

```
$ corpus todos check doc_6hdrqxeq 2 --uncheck
unchecked item 2 of Errands [doc_6hdrqxeq] — file the taxes
$ grep -n status: …/errands.md   →  8:status: open
$ curl …/api/docs/doc_6hdrqxeq   →  wire status: open
```

### The core body path, and `archived`

```
$ curl -X POST …/api/docs/doc_6hdrqxeq/archive    →  archived
$ grep -n status: …/errands.md                    →  8:status: archived
$ curl -X PUT …/api/docs/doc_6hdrqxeq -d '{"key":"…","body":"- [x] renew the
    passport\n- [x] file the taxes\n"}'           →  wire status: archived
$ grep -n status: …/errands.md                    →  8:status: archived
$ tail -2 …/errands.md
- [x] renew the passport
- [x] file the taxes
$ curl -X POST …/api/docs/doc_6hdrqxeq/unarchive  →  wire status: resolved
$ grep -n status: …/errands.md                    →  8:status: resolved
```

Checking every item on an archived list left it `archived`, in the file and on
the wire, and unarchiving returned it to what the items say **at that moment** —
`resolved` here, and `open` on the earlier run when one item was still unchecked.

### The acceptance criterion: an out-of-band `printf >>`

An empty todo document (`Still empty` → derived `open`), an SSE stream open, and
one appended line:

```
$ printf -- '- [x] extra\n' >> data/docs/inbox/empty-list.md
$ cat sse2.log
:connected
:hb
event: invalidate
data: {"keys":[["docs"],["docs","doc_m5zz6ycp"]]}
event: invalidate
data: {"keys":[["index"]]}
$ curl …/api/docs/doc_m5zz6ycp            →  wire status: resolved
$ curl …/api/docs?status=resolved&type=todo → ['doc_m5zz6ycp', 'doc_6hdrqxeq']
$ grep -n status: …/empty-list.md         →  8:status: open      ← the shadow lags
```

And the shadow heals on the next server write, folded into the open window:

```
$ curl -X PUT …/api/docs/doc_m5zz6ycp -d '{"addTags":["errands"]}'
$ grep -n status: …/empty-list.md   →  9:status: resolved
commits before=7 after=7
```

### Breaking the fix, against the same running server

`resolveDocumentStatus` reduced to `return stored;`, server restarted:

```
before: open
after the out-of-band append, WITH THE FIX BROKEN: open
```

Restored and restarted: `with the fix restored: resolved`.

### The packaged tarball would not have shipped the derive module

Found while checking the seam's *installed* path, and fixed:
`scripts/package-staging.ts`'s `pluginEntryPoints` named `server/routes.js` and
`cli/commands/*.js` and nothing else, and `stagePlugins` stages **only** entry
points — so `dist/server/derive.js` would have been absent from the tarball,
discovery would have contained the miss as a warning, and every todo document
would have fallen back to the status its file states **in installed builds
only**. That is the same quiet failure INFRA-008 escalation 3(b) found once for
the routes module. `server/derive.js` is now an entry point of its own, bundled
like the others, with the fabricated-plugin tests extended in all three places
they name entry points. Verified against the **compiled** module too: with
`plugins/todos/dist/server/derive.js` built, discovery preferred it
(`"plugin":"todos","routes":true,"types":["todo"],"derives":["todo"]`), an
out-of-band append still reprojected, and `rebuild && doctor` stayed clean.
`scripts/` is infra-dev's tree — flagged to the orchestrator rather than assumed.

### `rebuild && doctor`, on all four states

The workspace held `Errands` (completed), `Groceries` (incomplete — and carrying
a **deliberately stale** shadow from the earlier out-of-band edit), `Still empty`
(empty), `Empty list` (completed out of band) and `Archived list` (archived).

```
$ corpus db rebuild
rebuilt the projection in 28ms — 17 documents, 0 threads, 0 turns, 0 anchors, …
$ corpus db doctor
projection is clean — 17 documents from 17 files (3ms)
$ curl …/api/docs?type=todo
[('Still empty','open'), ('Empty list','resolved'), ('Groceries','open'), ('Errands','resolved')]
$ curl …/api/docs?type=todo&status=archived
[('Archived list','archived')]
$ grep -m1 ^status: …/groceries.md  →  status: resolved
$ curl …/api/docs/doc_kitok4do      →  wire status: open
```

A stale shadow is not drift, and `doctor` says nothing about it.

### `corpus doc check` does not police the shadow

```
$ corpus doc check                 →  checked 17 documents — no findings.
$ corpus doc check doc_kitok4do    →  checked 1 document — no findings.
```

(`doc_kitok4do` is the document whose stored status differs from its derived one.)

### Cold boot: the scan derives, because discovery now runs first

```
$ corpus server stop && rm .corpus/cache.db* && corpus server start
$ curl …/api/docs?type=todo
after a cold boot: [('Still empty','open'), ('Empty list','resolved'),
                    ('Groceries','open'), ('Errands','resolved')]
```

### Unit gate and falsification

`VITEST_MAX_THREADS=4 vitest run apps/server` → **196 files, 4376 tests passed**.
`tsc --noEmit`, `eslint apps/server/src`, `prettier --check apps/server/src` all
clean.

Four deliberate breaks, each restored and re-verified green:

| Break | What failed |
| --- | --- |
| `resolveDocumentStatus` returns the stored value | 12 tests across the projection, the write path and lifecycle |
| `applyOperations` skips the convergence | 4 write-path tests (body edit, stale-field, unarchive, create) |
| the projection opens before plugin discovery | the lifecycle ordering test (`expected 'open' to be 'resolved'`) |
| the watcher converges even when reconciliation would not write | `opens no write of its own …` (`expected 'reconciled' to be 'unchanged'`) |

Server stopped, port 8971 verified free, SSE listeners killed. Port 8765 — the
user's live server — never touched.

## Files changed

- `apps/server/src/plugins/derived-status.ts` (new, + `derived-status.test.ts`) —
  the registry: which types derive, the one composed rule, and containment of a
  throw or an out-of-range answer with one warning per plugin per fault
- `apps/server/src/plugins/discover.ts` (+ `discover.test.ts`) — `derivedStatus:
  true` in `types.yaml`, `resolveDeriveModule`, the `server/derive` import under
  the routes module's containment
- `apps/server/src/plugins/index.ts` — exports
- `apps/server/src/projection/project-document.ts` — the status ladder
  (`resolveDocumentStatus`, `resolveDocumentType`), both exported for the write
  path; `documentTitle` deduped into `core/title.ts` per SERVER-100's note
- `apps/server/src/projection/derived-status.test.ts` (new)
- `apps/server/src/projection/db.ts`, `attach.ts`, `rebuild.ts`, `routes.ts`,
  `index.ts` — the registry on the handle, and into the rebuild's throwaway one
- `apps/server/src/docs/derived-status.ts` (new, + `derived-status.test.ts`) —
  the convergence, over a parsed document and over a write's text
- `apps/server/src/docs/write.ts` — `convergeDerivedStatus` in `applyOperations`,
  before `registerSelfWrites`
- `apps/server/src/docs/archive.ts` — comment only: unarchive needs no branch
- `apps/server/src/docs/write-fixture.ts` — a `derivedStatus` fixture option
- `apps/server/src/watcher/reconcile-out-of-band.ts` (+ its test),
  `watcher/watcher.ts` — the convergence rides the reconciliation's own rewrite
- `apps/server/src/lifecycle.ts` (+ `lifecycle.test.ts`) — discovery before the
  projection, and the test that pins it
- `scripts/package-staging.ts` (+ `package-staging.test.ts`) — **outside this
  domain, flagged**: `server/derive.js` staged as a plugin entry point, without
  which the seam works in dev and silently does not in an installed build

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Pre-fix reproduction logged (not a bug — a fix-the-fix falsification is logged instead, against the same running server)
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-domain, touches the write path and projection)
- [ ] `/evaluate` passes
- [ ] Committed with `[SERVER-085]` prefix
