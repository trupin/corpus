# [SERVER-077] Apply a bulk action as one act, and one commit

## Domain

server

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: CONTRACT-037 (declares `POST /api/docs/bulk`)
- Blocks: UI-083
- Related: SHARED-017 (signed, applied), SPEC.md §4's "One action, one commit"

## Spec References

- SPEC.md **§4**, "One action, one commit" _(rider signed 2026-08-05)_ — an
  action on several documents at once "lands as a **single** auto-commit",
  containing "exactly the documents the action **changed**"; it never folds into
  a preceding editing session's squashed commit and no later save folds into it;
  its message names the action and the documents it changed
- SPEC.md **§11** — the board's multi-select and the list of acts
- SPEC.md **§9.2** — deletion is user-only

## Summary

CONTRACT-037 declared the route and the shapes; **nothing implements it.** Until
this lands, `POST /api/docs/bulk` is a declared route with no handler, and
UI-083 has nothing to call.

The reason a bulk route exists at all is a fact CONTRACT-037 checked against the
code rather than assuming: every document-mutation route takes exactly one `id`,
and the auto-committer's fold decision keys on the same document and actor — so
twenty archives of twenty documents are **twenty commits by construction**. A
server that satisfies this route by looping the single-document write path has
not implemented it; it has renamed the defect. That is the one failure mode this
issue exists to prevent, and it will look like it works.

## Acceptance Criteria

- [x] All eight acts apply: `archive`, `unarchive`, `resolve`, `reopen`,
      `move`, `tag` (delta only — add and remove, never set), `review`, `delete`
- [x] **One commit**, containing exactly the documents the action changed. A
      document that was refused, or was already in the requested state, leaves
      nothing in it — `git log` must never record an effect the caller was told
      did not happen
- [x] `changed` and `git show --name-only <commit>` are the **same set**. Assert
      it against real git output, not against the server's own bookkeeping
- [x] The commit stands alone in both directions: it does not fold into a
      preceding editing session's squashed commit, and no later save folds into
      it. §4's squashing is about repeated saves of **one** document
- [x] The message names the action and the documents it changed (§4)
- [x] `commit` is `null` when nothing changed, and no empty commit is made
- [x] Per-document outcomes are per-document: a locked document, an unknown id
      and a not-applicable act each land in `refused` with their reason, and the
      rest of the batch still applies. A lock is **not** a `423` for the request
- [x] An agent actor requesting `delete` is refused for the **whole request**
      with `403` (§9.2, deletion is user-only) — before anything is written
- [x] Deleting threads reports `orphanedThreadIds`, and deletion cascades follow
      §6 exactly as the single-document path does
- [x] The projection and SSE see one act: the invalidate carries the affected
      keys once, not once per document
- [x] Partial failure mid-write leaves no half-commit — decide and document what
      atomicity the git layer actually gives here rather than assuming it

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/` (the bulk apply path) and the auto-commit layer.

### Notes

- Read `packages/contract/src/routes/bulk.ts` and `schemas/bulk.ts` first — the
  route description states the §4 commit rule in both directions deliberately, so
  the server issue cannot miss it, and the response shape's `commit: string |
  null` is "one sha, never a list" for the same reason.
- The interesting work is in the **commit boundary**, not the mutations. Find
  where the auto-committer decides to fold, and give it a way to be told "these
  writes are one act" rather than inferring it from document + actor.
- `tag` is a delta by contract — `set`/`replace` are inexpressible. Do not add a
  spelling for them here.

## Testing Strategy

Twenty documents, three of them locked: one commit, seventeen files, `changed`
equal to `git show --name-only`, three refusals with `locked`. Plus: an act that
changes nothing produces `commit: null` and no commit object; a bulk act
immediately after an editing session on one of the same documents does not fold
into that session's squashed commit; an agent `delete` is `403` and writes
nothing.

## E2E Verification Log

**Model: Opus 5 (1M context).** Real `corpus init` workspace at `/tmp/corpus-s077`,
real server on scratch port **8766** (`corpus server start`, pid 89422), real git,
real SSE. Every claim below is quoted from the running system.

### Reproduction (the suite was red before any code)

```
FAIL apps/server/src/json-body.test.ts > … > a bare comma is 400 …
AssertionError: expected [ 'POST /api/docs/bulk', 404 ] to deeply equal [ 'POST /api/docs/bulk', 400 ]
```
Four failures, one per body shape. Green after the mount; the test was not touched.

### 1. Twenty documents, three locked — one commit, seventeen files

20 notes created (21 commits in the repo), three locked by `agent` over
`POST /api/locks/{id}`, then one `archive` as `user`:

```
status 200  changed 17  alreadyInState []  commit 585ab840c1908a67cb7941c76d24827304c3a2ab
refused: doc_kcy47cp4 / doc_pcy3ythg / doc_xllb7s5j — reason "locked",
         lock {holder: "agent", acquired: "2026-08-09T05:08:26Z", ttl: 300}
commits before/after  21 22          ← one commit, not seventeen
```

`git show --name-only --no-renames --format='%H%n%an <%ae>%n%s%n%b' 585ab84`:

```
585ab840c1908a67cb7941c76d24827304c3a2ab
user <user@corpus.local>
bulk archive: 17 documents by user
Corpus-Doc: doc_2ft6jidu
Corpus-Doc: doc_5qcpv7p2
… (17 lines) …
Corpus-Actor: user

data/docs/inbox/bulk-note-10.md
data/docs/inbox/bulk-note-11.md
… (17 paths) …
data/docs/inbox/bulk-note-9.md
```

Compared against git rather than against the server's bookkeeping:

```
git show --name-only == changed's paths: True 17 17
doc_kcy47cp4 path in commit: False status: open
doc_pcy3ythg path in commit: False status: open
doc_xllb7s5j path in commit: False status: open
```

### 2. Nothing changed ⇒ no commit object

Re-archiving the same 17: `changed [] alreadyInState 17 commit None`,
`HEAD unmoved: True`, `git rev-list --count HEAD` 22 → 22,
`git status --porcelain` shows only my two scratch files — nothing staged, no
empty commit.

### 3. §4 in both directions, on one document inside one squash window

```
edit commit: 48fef0555d doc edit: Session doc (doc_pnipahyt) by user
bulk commit: a91cdc7035 count 24 was 23
parent of bulk commit is the session commit: True
session commit still says: doc edit: Session doc (doc_pnipahyt) by user

save status 200 count 25 was 24
bulk commit is now HEAD^: True
bulk commit tree unchanged: True

f282978 doc edit: Session doc (doc_pnipahyt) by user
a91cdc7 bulk tag: 1 document by user
48fef05 doc edit: Session doc (doc_pnipahyt) by user
```

Same document, same actor, no clock movement: the act neither folded into the
edit before it nor absorbed the edit after it, and its tree is byte-identical
afterwards. Ordinary two-save squashing still works (unit test, and `count 24
was 23` shows each save landing its own commit only around the act).

### 4. Agent `delete` — 403, before anything

```
status 403 {'code': 'forbidden', 'message': 'deletion is user-only; the agent archives, never deletes'}
HEAD unmoved: True
doc_2ft6jidu still readable: True
doc_5qcpv7p2 still readable: True
```

### 5. All eight acts, on the running server

- **archive / unarchive** — above; unarchive of 5 → `commit 557013c2`, one commit.
- **move** — 5 documents to `finance`: `commits + 1`, `git show == old+new paths: True`,
  subject `bulk move: 5 documents by user`, ids unchanged.
- **resolve / reopen** — 2 threads plus a note in the set:
  `changed ['th_dx3lo7bb','th_mnbx6vd3']`,
  `refused [('doc_zxsostuk','not-applicable','doc_zxsostuk is a note, not a thread; only threads are resolved (SPEC.md §6)')]`,
  `git show: ['data/threads/th_dx3lo7bb.md','data/threads/th_mnbx6vd3.md']` — the
  note left nothing in the commit. Reopen flipped both back.
- **tag** — delta only: `add [q3, board]` then `add [extra] remove [q3]` leaves
  `[['board','extra'],['board','extra']]`; re-adding `extra` gives
  `changed [] alreadyInState [both] commit None`.
- **review** — `reviewed: 2026-08-09T05:10:16Z` against `updated: 2026-08-09T05:09:49Z`:
  §5's clock is not reset.
- **delete** — two *anchored* threads of one parent in one act:
  `changed ['th_dx3lo7bb','th_mnbx6vd3']`, one commit, and
  `git show: ['data/docs/inbox/anchored-parent.md','data/threads/th_dx3lo7bb.md','data/threads/th_mnbx6vd3.md']`
  with `parent anchors after: {}` — §6's cascade ran twice against **one** rewrite
  of the parent (the second plan read the file the first wrote), and the parent
  appears once. Deleting the parent afterwards reported
  `orphanedThreadIds ['th_7sxtuh5r']`, and that standalone thread survives.
- Unknown id: `status 200 changed ['doc_wizxj3e3'] refused [('doc_deadbeef','not-found','no document with id doc_deadbeef')]`.

### 6. One SSE frame for the act

`curl -sN /events` while unarchiving five documents:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_25ycyuhs"],["docs","doc_2ft6jidu"],["docs","doc_3pb6sgf3"],["docs","doc_5qcpv7p2"],["docs","doc_5tc6pm4h"],["tree"]]}
```

One frame, each key once, `["tree"]` once — measured, not pushed.

### 7. Projection

`corpus db doctor` → `projection is clean — 32 documents from 32 files (3ms)`.
Server log carries no error or warning line for the whole session.

### Atomicity — decided, not assumed

Each document's file operations are **one all-or-nothing group** (`applyOperations`),
so a mid-group failure restores that document and reports it as `write-failed`
while the act continues; proved in `bulk.test.ts` by making a destination
directory unwritable — the failing document stays byte-identical and leaves
nothing in the commit. **Across** documents the guarantee is *no half-commit*,
not *no half-write*: the writes precede the single `git commit`, so a process
killed between them leaves changed files on disk uncommitted — the state §14
already defines for a hook-rejected commit ("the file is the source of truth").
Git offers nothing stronger without writing the tree by hand; what it does give
is that the commit is one object containing exactly what landed.

### Deviation worth naming

For a `delete` whose §6 cascade rewrites a surviving parent, the commit carries
one file — the parent's — that names no `changed` document. The parent must not
enter `changed`: the act did not delete it, and the contract requires the three
parts to partition the *requested* ids, which the parent need not be among. This
is what `DELETE /api/docs/{id}` already does; the invariant holds over documents
the act acted on. Documented at the head of `bulk.ts` and pinned by a test.

### Checks

`npm run build`, `tsc --noEmit` (server) clean, `eslint apps/server/src` clean,
`prettier --check` clean, `vitest run apps/server` → **176 files, 3613 tests,
all passing**, `json-body.test.ts` green.

Workspace and server torn down; port 8766 free. Ports 8765 and 5173 never bound.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
