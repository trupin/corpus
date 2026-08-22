# [SERVER-077] Apply a bulk action as one act, and one commit

## Domain

server

## Status

done — verified 2026-08-13 (INFRA-027) against commit `99ea942c`, which carries this
id. The work landed; this file was never ticked.

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
- SPEC.md **§10** — the board's multi-select and the list of acts
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
- [x] **Every document `changed` names has a file in that commit**, and
      `git show --name-only` lists it; a document that was refused or was already
      in the target state wrote nothing **of its own** — though its files may
      still be carried there by another document's act (SERVER-078). Assert it
      against real git output, not against the server's own bookkeeping.
      _Corrected twice on review, both times on the record: first from set
      equality to one-directional containment, then to drop "appears nowhere in
      it", which the nested-skill case falsifies whenever both skills are
      requested._
      _Corrected on review (PR #37, finding 2), not silently reworded._ This
      criterion originally read "`changed` and `git show --name-only <commit>`
      are the **same set**", which is false as written: the invariant is
      **containment in one direction only**, because the result's three parts
      partition the **requested** ids and nothing else, so the commit may also
      carry files for documents the act did not name. Two things do that today,
      both spec-required and both shared with the single-document routes — §6's
      anchor cascade rewriting a deleted thread's surviving parent, and §7's
      skill folder move carrying every file under the folder, including the
      `SKILL.md` of a **nested** skill, which the move disables without the act
      ever naming it. Both are pinned by tests in `bulk.test.ts`
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
killed between them leaves changed files on disk uncommitted — the state §11
already defines for a hook-rejected commit ("the file is the source of truth").
Git offers nothing stronger without writing the tree by hand; what it does give
is that the commit is one object containing exactly what landed.

### Deviation worth naming

> **Superseded by "Round 2" below (PR #37 review, finding 2):** the "one file"
> claim in this section is wrong. There are **two** classes of such file, and the
> invariant is containment rather than equality-with-an-exception.

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

### Round 2 — PR #37 pr-reviewer findings 1–5

**Model: Opus 5 (1M context).** Fresh `corpus init` workspace at
`/tmp/corpus-s077r2`, real server on scratch port **8767** (pid 31845), real git,
real projection. Ports 8765 and 5173 never bound; workspace and server torn down,
port free. Every block below is verbatim from the running system.

#### Finding 1 (MAJOR) — a bulk delete reported a thread it had just deleted as a surviving orphan

`planDelete` answers `orphanedThreadIds` from the projection, and the projection
does not move until `finishMutation` runs **after** the whole loop — so a plan
made for a parent still saw the row of a thread an earlier plan in the same act
had already unlinked. The reviewer's shape, re-run post-fix:

```
parent doc_xw63oz4k   anchored thread th_n5gzurmn   standalone thread th_xzypfvyu
POST /api/docs/bulk {ids: [th_n5gzurmn, doc_xw63oz4k], action: {action: "delete"}}
status            200
changed           ['th_n5gzurmn', 'doc_xw63oz4k']
orphanedThreadIds ['th_xzypfvyu']
changed n orphaned: []                 ← was ['th_n5gzurmn'] before the fix
standalone survives: True
commit 32bd74c5  bulk delete: 2 documents by user
  data/docs/inbox/bulk-parent-two.md
  data/threads/th_n5gzurmn.md
```

Filtered after the loop (order-independent) rather than inside `planDelete`,
which is shared with `DELETE /api/docs/{id}` where the projection is never
behind. A thread whose *own* deletion was refused is absent from
`deletedThreadIds` and stays reported — it did survive; pinned by a second test.
The existing `bulk.test.ts` case was strengthened from `toContain(standalone.id)`
to `toEqual([standalone.id])`; reverting the filter makes it fail with
`expected [ 'th_gxt2meia', 'th_x5f6ptmz' ] to deeply equal [ 'th_gxt2meia' ]`.

#### Finding 2 (MAJOR) — the "sole exception" claim was wrong; the fix is the claim

A skill folder that nests another skill is supported (`skillDocumentsUnder`), and
archiving the outer skill relocates — and therefore **disables** — the nested one
without the act ever naming it:

```
POST /api/docs/bulk {ids: ["doc_skillfb157be1"], action: {action: "archive"}}
changed         ['doc_skillfb157be1']
alreadyInState  []
refused         []
commit files (bulk archive: 1 document by user):
  .claude/skills-archived/demo/SKILL.md
  .claude/skills-archived/demo/nested/SKILL.md      ← named in no part
  .claude/skills-archived/demo/reference.md
  .claude/skills/demo/SKILL.md
  .claude/skills/demo/nested/SKILL.md               ← named in no part
  .claude/skills/demo/reference.md

GET /api/docs?type=skill&status=archived
  doc_skillfb157be1  .claude/skills-archived/demo/SKILL.md         archived
  doc_skill6060ce0d  .claude/skills-archived/demo/nested/SKILL.md  archived
```

The behaviour matches `POST /api/docs/{id}/archive`, so the code stands and the
**claim** was corrected: `bulk.ts`'s header now states **containment in one
direction** (every id in `changed` has a file in the commit; the commit may carry
files for documents the act did not name) with both exceptions — §6's cascade
parent and §7's skill folder move — instead of "the one file". The acceptance
criterion above was corrected in place, marked as corrected rather than reworded.
`bulk.test.ts`'s header lost "are the same set" for the same reason. A test now
pins the nested case, so the exception is documented by something that fails when
it changes. Wording agreed with contract-dev, which owns the same claim in
`packages/contract`.

Worth recording: the nested skill's id **changes** across the move
(`doc_skill78aafb0e` → `doc_skill6060ce0d`) because a synthesized id is a hash of
the path and only the *requested* skill gets its id stamped into its file. That is
pre-existing single-document-route behaviour, not this route's; the test asserts
the act names it under neither id rather than asserting either is stable.

#### Finding 3 (MAJOR) — nothing tested a bulk archive of a skill

Added, on both sides of the round trip:

```
bulk archive   → changed ['doc_skillfb157be1'], .claude/skills-archived/demo/SKILL.md True,
                 .claude/skills/demo gone True
bulk unarchive → changed ['doc_skillfb157be1'], back under skills/ True,
                 archived side gone True
```

Replacing `planFor`'s archive branch with `planFrontmatter(...)` — the
simplification `archive.ts:103-114` warns about — makes both new skill tests fail
(`expected false to be true` on the moved folder). Before this, that edit passed
every test in the repo.

#### Finding 4 (MINOR) — a filename collision is not `not-applicable`

`planMove`'s and `planSetArchived`'s destination checks now raise
`DestinationOccupiedError` (a typed `HttpError` subclass; the single-document
`400` body is byte-identical), which the bulk act reports as `write-failed` —
the one published reason both of whose clauses are true, where `not-applicable`
means "refresh the board" and `invalid` claims a §11 failure that did not happen.
The path, which lives in `issues` and has nowhere to go in a refusal row, is
folded into the message:

```
bulk move [doc_aoohzptd (inbox/budget.md), doc_hpdtvi2x (plans/budget.md)] → finance
changed  ['doc_aoohzptd']
refused  [{ id: doc_hpdtvi2x, reason: "write-failed", lock: null,
            message: "the destination is already occupied: data/docs/finance/budget.md already exists" }]
commit   data/docs/finance/budget.md, data/docs/inbox/budget.md
B untouched on disk: True

bulk archive [doc_skillfb157be1] with .claude/skills-archived/demo already present
changed  []   commit None   HEAD unmoved True   skill still enabled True
refused  [{ id: doc_skillfb157be1, reason: "write-failed", lock: null,
            message: "the archive destination already exists: .claude/skills-archived/demo already exists; move or remove it first" }]
```

#### Finding 5 (MINOR) — a locked cascade parent, under an honest row

The row stays filed under the thread's id (the three parts partition the
*requested* ids, and the parent need not be among them), and `lock.docId` was
already the parent's — but the message left a reader to notice that the id in the
sentence was not the id in the row. It now names both and says which lock to
clear:

```
lock on parent: 201 {docId: doc_chyz2rb4, holder: agent, ttl: 300}
POST /api/docs/bulk {ids: [th_l66nhy5t], action: {action: "delete"}}
changed [] commit None   thread survives: True
refused [{
  id: "th_l66nhy5t", reason: "locked",
  message: "deleting th_l66nhy5t rewrites its parent doc_chyz2rb4's anchors in the same
            commit (SPEC.md §6), and doc_chyz2rb4 is being edited by agent; the lock to
            clear is doc_chyz2rb4's, not th_l66nhy5t's",
  lock: { docId: "doc_chyz2rb4", holder: "agent", acquired: "…", ttl: 300 }
}]
```

Pre-fix the message read `doc_chyz2rb4 is being edited by agent; the lock was
acquired at …` — it did name the parent, but said nothing about *why* a request
naming only `th_l66nhy5t` was refused or which of the two locks to clear.

#### Checks

`npm run build` clean; `tsc --noEmit` (apps/server) clean; `eslint` clean on
every touched file; `prettier --check` clean. `vitest run apps/server` →
**176 files, 3619 tests, all passing**. `corpus db doctor` →
`projection is clean — 20 documents from 20 files (3ms)`; no `error`/`warn` line
in the server log for the whole session. Each new assertion was verified to fail
with its fix reverted (transcripts above).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
