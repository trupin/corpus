# [SERVER-091] A commit window belongs to a party, not to a document

## Domain

server

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SHARED-040 (signed 2026-08-10, applied to SPEC.md §4)
- Blocks: SERVER-092, SERVER-093, SERVER-094
- Related: SERVER-090 (out-of-band edits; independent defect, same file's
  authorship), CONTRACT-037/SERVER-077 (`docIds`, the "commits alone" signal)

## Spec References

- SPEC.md **§4** — "Commit windows — a commit per act, not per save" (the whole
  rider). This issue implements the mechanism; SERVER-092/093/094 implement its
  call sites.
- SPEC.md **§4** — "One action, one commit" (rider signed 2026-08-05). Unchanged,
  and this issue must not weaken it.
- SPEC.md **§14** — a mutation stands even when its commit does not.

## Summary

Today `apps/server/src/git/commit.ts` folds repeated saves into one commit along
**two** axes: same document *and* same actor, inside `SQUASH_IDLE_MS`. §4 now
scopes that window to the **party alone**. The agent working one queue event
updates three documents, appends a changelog to a fourth and posts a turn; under
the document-scoped key that is five commits for one act, which is the
fragmentation the rider replaces.

This issue changes the fold key and nothing else about *when* windows close —
the act-driven closers are SERVER-092, the read-back flush is SERVER-093, the
durability paths are SERVER-094. What it does add is the two capabilities those
three all need: a window that **knows every document it holds**, and a window
that can be **closed by name** with an honest subject.

## The one adjudication the implementer must not re-litigate

**Keep the eager-commit-then-amend mechanism. Do not build a deferred commit
buffer.**

The rider's costs paragraph says "a window holds work outside git for as long as
it stays open". Read literally that suggests accumulating changes in memory and
committing at close. **Do not.** Today's mechanism commits the first save
immediately and *amends* it as the window grows, so the window's content is in
git at every instant. That is strictly better than what the spec promises, and
the spec promising a weaker bound is not licence to implement the weaker thing:

- §5 says the file on disk is the truth and §14 says a mutation stands when its
  commit does not. A buffer that loses a crash's worth of commits contradicts
  both harder than the amend model does.
- The rider itself says an unclean stop costs "the boundary and not the work" —
  which is exactly what the amend model costs, and *not* what a buffer costs.
- `amendTarget`'s refusal list (detached HEAD, mid-operation, published, HEAD
  moved, trailer mismatch) is the accumulated correctness of five issues. A
  buffer discards all of it and re-earns the same bugs.

So: **"closing a window" means "stop amending it"**, plus — where the window was
not named by an act — one final amend that rewrites its subject. The only place
genuinely uncommitted work exists is SERVER-094's boot recovery, which recovers
what the *commit path never saw* (failed commits, out-of-band edits, files
written while the server was stopped), not what a window was holding.

`git commit --amend --only -- <paths>` keeps every other path at HEAD's version,
so amending with document B's paths preserves document A's already-committed
change in the same commit. That is what makes a multi-document window work at
all; verify it in a test rather than trusting this paragraph.

## Acceptance Criteria

- [x] The fold key is the **actor alone**. Two saves to two documents by the same
      party inside the idle window land as **one commit** carrying both changes
      and one `Corpus-Doc` trailer per document
- [x] The other party writing **closes** the open window: their change never
      folds into it, and `git log --author` still names exactly one party per
      commit. Prove it with a user save, an agent save, and a user save — three
      commits, in that authorship order
- [x] A window accumulates **every** document id it has held, and its commit
      message carries one `Corpus-Doc` trailer per document. `buildTrailers`
      already emits per-id lines; the accumulation is what is missing
- [x] `amendTarget`'s HEAD-trailer verification still proves the server made the
      commit it is about to rewrite. The single-`Corpus-Doc`-equals-`docId` check
      cannot survive as written — replace it with a set comparison against the
      window's accumulated ids, do not delete it
- [x] A window **ages out**: once it has been open longer than a bounded maximum
      it closes regardless of continuing activity, and the next save opens a
      fresh one. The interval is a named exported constant beside
      `SQUASH_IDLE_MS`, not a literal, and **no number reaches SPEC.md**
- [x] `closeWindow(reason)` exists on `AutoCommitter` and is what every other
      issue in this chain calls. Where no act named the window, closing rewrites
      the commit's subject to say it is an editing session and how many documents
      it holds; where an act named it, the subject stands
- [x] `endSquashSession(sha)` keeps working for its existing caller
      (`edit/sessions.ts`) — it may become a thin wrapper over `closeWindow`, but
      the published-sha guarantee it exists for must not regress
- [x] `docIds` still means "commits alone, folds neither direction". Unchanged
- [x] The subject-rewrite amend is refused in exactly the states an ordinary
      amend is refused, and refusing it is harmless: the commit keeps the last
      save's subject and the window closes anyway
- [x] `SQUASH_IDLE_MS` behaviour is otherwise untouched, and no existing test in
      `commit.test.ts` is deleted or weakened to make room. Tests that encoded
      the *document* half of the key are the ones that legitimately change —
      change them by rewriting the expectation, and say so in the log

## Technical Design

### Files to Create/Modify

- `apps/server/src/git/commit.ts` — the whole of the change
- `apps/server/src/git/commit.test.ts` — the fold-key tests
- `apps/server/src/locks/git-fixture.ts` — the `AutoCommitter` test double gains
  `closeWindow`

### Key Implementation Details

`SessionRecord` becomes the window:

```ts
type WindowRecord = {
  readonly actor: Actor;                 // the party it belongs to — the whole fold key
  readonly docIds: ReadonlySet<string>;  // every document it has held, in insertion order
  readonly sha: string;
  readonly at: number;                   // last save — the idle window runs from here
  readonly openedAt: number;             // first save — the age-out runs from here
  readonly namedByAct: boolean;          // did an act set the subject? (SERVER-092 sets it)
  readonly remapped: ReadonlySet<string>;
  readonly orphaned: ReadonlySet<string>;
};
```

Insertion order matters: the `Corpus-Doc` trailers should read in the order the
documents were touched, and a `Set` gives that for free.

In `amendTarget`:

- `record.docId !== request.docId` — **delete**. This is the change.
- `record.actor !== request.actor` — **keep**. This is the party-change flush,
  and it already does the right thing by returning `null` (fresh commit). It
  additionally has to *close* the outgoing window rather than merely bypass it,
  so the outgoing party's subject rewrite happens before the new commit lands.
- `now() - record.at >= squashIdleMs` — keep.
- `now() - record.openedAt >= windowMaxMs` — **add**.
- `record.sha !== head` — keep, unchanged and still load-bearing.
- the trailer checks — `TRAILER_ACTOR` keep as is; `TRAILER_DOC` becomes "the set
  of `Corpus-Doc` values on HEAD equals `record.docIds`". `trailerValue` returns
  the first match only; you need a `trailerValues` that returns all of them.

`amendWouldEmptyHead` needs **no change** and the reasoning is worth stating so
nobody "fixes" it: it asks whether everything HEAD contributes is inside the
paths this save touches. With a neighbour document in the same window that is
simply false, so it answers `false` and the amend proceeds — correct, because a
commit holding a neighbour's change cannot be emptied by this one.

`closeWindow`:

```ts
closeWindow(reason: WindowCloseReason): Promise<void>
```

Asynchronous, unlike `endSquashSession`, because the subject rewrite is a git
call. It must therefore run **inside `withGitLock`** — and `endSquashSession`'s
existing caller is a timer that explicitly must not queue behind an autosave, so
keep a synchronous forget-only path for it or make the tracker await. Whichever
you choose, say which in the log; getting this wrong deadlocks the autosave path.

The editing-session subject: name the count, not the documents — a window can
hold many. Something in the shape of the existing subjects (`doc save: …`), not
prose. The rider requires only that a reader can tell it is an editing session
and how many documents it holds.

### Edge Cases

- **A window whose only save later fails to amend.** Fresh commit, window
  reopens on it. Already how the code behaves.
- **Closing a window whose commit is no longer HEAD** (a hook, the operator, a
  concurrent path committed after us). The `record.sha !== head` check already
  catches it; the subject rewrite must make the same check and skip silently.
- **Closing a window that does not exist.** No-op, no error, no log line. Every
  caller in SERVER-092/093 will call it unconditionally.
- **`allowEmpty` commits** (the force-break audit entry) already pass
  `squash: false`; they must not open a window either. Verify.
- **A party-change flush where the second party's write then fails validation.**
  The flush already happened; one extra commit, never a wrong one. Accepted by
  the rider — do not try to make the flush conditional on the write succeeding.

## Testing Strategy

`commit.test.ts` already has the harness. New cases, all unit:

1. Two documents, one actor, inside the idle window → one commit, two
   `Corpus-Doc` trailers, both files' content present.
2. Same, then a third save to the first document again → still one commit; the
   trailer set does not grow a duplicate.
3. user save → agent save → user save → three commits, authors `user`, `agent`,
   `user`; the first commit's subject was rewritten to the editing-session form.
4. Age-out: with an injected clock, saves every 1 ms past `windowMaxMs` → the
   window closes and a second commit opens, despite no idle gap.
5. `closeWindow` with no window → no git invocation at all (assert on the fake
   git's call log).
6. `closeWindow` when HEAD moved under us → no amend attempted, no throw.
7. `--amend --only` preservation: commit doc A, amend with doc B's paths, assert
   doc A's change is still in the resulting tree. This is the mechanism the whole
   issue rests on — assert it directly against real git, not against the fake.
8. `docIds` present → still commits alone, still opens no window, now under the
   party key too.

## E2E Verification Plan

Against a real workspace and a real running server (never bind 8765 or 5173 —
the user's live server and an ssh tunnel hold them).

### Verification Steps

1. `corpus init` a scratch workspace; start the server on a free port.
2. `corpus doc create` two documents, then edit both within 30 s as `user`.
   `git log --format='%an %s'` shows **one** commit; `git log -1 --format=%B`
   shows two `Corpus-Doc` trailers; `git show --name-only` shows both files.
3. Make an agent-authored mutation. `git log` shows the user's commit closed with
   an editing-session subject, then the agent's commit under `agent`.
4. Edit continuously for longer than the age-out interval. Two commits, both
   editing-session subjects.
5. `git log --author=user` and `--author=agent` each name only that party's
   commits — the property the party-scoped key exists to preserve.

## E2E Verification Log

**Model: opus** (Claude Opus 5, 1M context). Implemented 2026-08-10.

### 0. The mechanism the whole issue rests on, checked against real git first

Before writing any code, against `git 2.37.3` (Homebrew, first on PATH) **and**
`git 2.50.1` (Apple), in throwaway repositories under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/probe{1,2,3}`:

- `git commit --amend --only -- <B's paths>` after a commit of `A` →
  `git ls-tree -r --name-only HEAD` = `d/a.md d/b.md seed.txt`,
  `git show HEAD:d/a.md` = `A one`. **A's change survives the amend.** Both git
  versions.
- `git commit --amend --only` with **no pathspec** is a message-only rewrite: it
  is accepted (git only refuses `--only` without paths when *not* amending),
  leaves the operator's staged `op.txt` staged, and leaves a staged *and*
  working-tree modification of `d/a.md` out of the commit
  (`git show HEAD:d/a.md` still `A one`). Both git versions. One difference
  worth recording: 2.50.1 resets the index entry for paths inside the commit to
  HEAD, 2.37.3 leaves it staged — the working tree is untouched either way, and
  the fresh commit that follows takes working-tree content via `--only`, so
  neither behaviour reaches an outcome.
- Same on a **root commit** (unborn branch, no parent).

`commit.test.ts` → "preserves a neighbour's committed change when the amend
names only one document's paths" pins both forms against real git, so a future
git that changed this fails there rather than silently dropping documents.

### 1. Unit

`npx vitest run apps/server/src/git/commit.test.ts` → **41 passed**. Whole
workspace: `vitest run apps/server` → **179 files, 3712 tests, all passing**.
`npm run build`, `npm run typecheck`, `npm run lint`, `prettier --check` all
clean.

### 2. Real workspace, real server

`corpus init` + `corpus server start` on **port 8871** (never 8765 or 5173) in
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/e2e`, driven through the real
CLI (`apps/cli/dist/bin/corpus.js`).

**Two documents, four writes, one party, inside 30 s → one commit:**

```
$ corpus doc create --type note --title Alpha -m "alpha one"   # doc_g4uno66r
$ corpus doc create --type note --title Beta  -m "beta one"    # doc_pkuobdnc
$ corpus doc edit doc_g4uno66r -m "alpha two"
$ corpus doc edit doc_pkuobdnc -m "beta two"

$ git log --format='%h|%an|%s' | head -2
b5c5782|user|doc edit: Beta (doc_pkuobdnc) by user
30052d5|user|workspace: initialize corpus workspace by user

$ git log -1 --format=%B
doc edit: Beta (doc_pkuobdnc) by user

Corpus-Doc: doc_g4uno66r
Corpus-Doc: doc_pkuobdnc
Corpus-Actor: user

$ git show --name-only --format= HEAD
data/docs/inbox/alpha.md
data/docs/inbox/beta.md
```

One commit for four writes; **one `Corpus-Doc` per document and no duplicate**
though each document was written twice; both files in the commit. (Criteria 1
and 3.)

**The other party writing closes it, with an honest subject:**

```
$ corpus --from agent doc edit doc_g4uno66r -m "alpha three, by the agent"
$ git log --format='%h|%an|%s' | head -3
011b3b1|agent|doc edit: Alpha (doc_g4uno66r) by agent
827af53|user|editing session: 2 documents by user
30052d5|user|workspace: initialize corpus workspace by user

$ git log -1 --format=%B HEAD~1
editing session: 2 documents by user

Corpus-Doc: doc_g4uno66r
Corpus-Doc: doc_pkuobdnc
Corpus-Actor: user

$ git show --name-only --format= HEAD~1     # relabelling touched no content
data/docs/inbox/alpha.md
data/docs/inbox/beta.md

$ corpus doc edit doc_pkuobdnc -m "beta three, back to the user"
$ git log --format='%h|%an|%s' | head -4
a3c6129|user|doc edit: Beta (doc_pkuobdnc) by user
644a6ed|agent|editing session: 1 document by agent
827af53|user|editing session: 2 documents by user
30052d5|user|workspace: initialize corpus workspace by user

$ git log --author=user  --format='%h %s'
a3c6129 doc edit: Beta (doc_pkuobdnc) by user
827af53 editing session: 2 documents by user
30052d5 workspace: initialize corpus workspace by user
$ git log --author=agent --format='%h %s'
644a6ed editing session: 1 document by agent
```

Three commits, `user` → `agent` → `user`, and `git log --author` names exactly
one party per commit. (Criteria 2 and 6.)

**Ageing out under continuing activity** — 19 saves to one document, one every
20 s (never an idle gap; `SQUASH_IDLE_MS` is 30 s), over 6½ minutes of wall
clock against `WINDOW_MAX_MS = 300_000`:

```
 1 08:22:59 02bbf34 1 commits      11 08:26:23 97147c1 1 commits
 …                                 12 08:26:43 066ec59 1 commits
 9 08:25:42 3d497f0 1 commits      13 08:27:03 5013d72 1 commits
10 08:26:02 af1f2a8 1 commits      14 08:27:24 a21bf23 1 commits
                                   15 08:27:44 64b45b7 2 commits   ← aged out
                                   19 08:29:06 c63dbcb 2 commits

$ git log --format='%h|%an|%aI|%s' | head -2
c63dbcb|user|2026-08-10T08:27:44-07:00|doc edit: Alpha (doc_g4uno66r) by user
43cacb4|user|2026-08-10T08:22:39-07:00|editing session: 2 documents by user

$ git log -1 --format='%aI %cI' HEAD~1
2026-08-10T08:22:39-07:00 2026-08-10T08:27:44-07:00       # 305 s of amending

$ git log -1 --format=%B HEAD~1
editing session: 2 documents by user

Corpus-Doc: doc_pkuobdnc
Corpus-Doc: doc_g4uno66r
Corpus-Actor: user
```

Fourteen consecutive saves amended one commit; the fifteenth, 305 s after that
window opened, made a fresh one — with no idle gap anywhere. The aged-out
commit carries the editing-session subject (no act named it) and its two
`Corpus-Doc` trailers are in the order the documents were first touched. The
new window is still open, so it still carries its last verb. (Criterion 5.)

### 3. Notes for the record

- `closeWindow` itself has **no production caller yet, by design** — SERVER-092
  (acts), SERVER-093 (read-back) and SERVER-094 (stop/boot) wire it. Its
  behaviour is proven by unit tests; what the E2E above exercises is the same
  `closeWindowLocked` reached from inside `commit()` when a save cannot fold.
- Tests whose expectations changed, and why (all of them encoded the *document*
  half of the old fold key):
  - `commit.test.ts` — the `document` scenario left the "starts a fresh commit"
    loop (it is now the *folding* case, asserted positively in the new
    "a commit window belongs to a party" block); the concurrency test now
    asserts one commit holding both documents' content rather than two commits
    of one document each (what the git lock has to prove under a party-scoped
    window is that neither change is lost, not that they are separate); the two
    `amendWouldEmptyHead` regressions and `act-no-fold-in` assert content and
    subject rather than a sha the close's relabelling amend moves.
  - `threads/{create,seen,cascade}.test.ts`, `edit/routes.test.ts` — setup and
    the action under test now share a window, so each advances past the idle
    window between them (the idiom those files already had).
  - `docs/update.test.ts`, `docs/bulk.test.ts`, `skills/rollback.test.ts`,
    `edit/acknowledgment.test.ts` — assert the editing-session subject, and
    identify a relabelled commit by tree or position rather than by a sha
    captured while its window was still open.
- **Fixed while verifying the issue's `allowEmpty` edge case:** `squash: false`
  refused to fold *into* a window but still **opened** one, so the next save by
  that party amended the audit entry — replacing `lock: force-break …` with the
  save's subject and dropping the `Corpus-Lock-Holder` trailer, which no other
  trailer expresses. `squash: false` now opens no window, and
  `commit.test.ts` → "takes no later save into an audit entry either" pins it.

## Escalated to the orchestrator — two decisions and one consequence

1. **`endSquashSession` stays synchronous and forget-only; it is *not* a wrapper
   over `closeWindow`.** Both of the constraints could not be met at once, so
   this is the choice and the reason: closing needs the git lock for its
   subject-rewriting amend, and `edit/sessions.ts` calls `endSquashSession` from
   a timer that must not queue behind an autosave. More decisively, a rewrite is
   exactly what must *not* happen there — the sha it is given has been published
   in a queue event, and amending it even only to relabel it would dangle the
   range that named it (SERVER-052 review, PR #22). Forgetting is the whole
   obligation and is safe from any point; the window is closed in the sense that
   matters, and its commit keeps its own subject. `commit.test.ts` →
   "never amends a commit the edit acknowledgment has named" still passes
   unchanged, which is the proof the guarantee did not regress.

2. **`git commit --amend --only -- <paths>` does preserve the other paths**, on
   git 2.37.3 and 2.50.1 — measured before any code was written (see §0 of the
   log) and pinned by a test against real git. No fallback design was needed.

3. **CONSEQUENCE, needs a ruling before SERVER-092/093 land.** The
   subject-rewriting amend gives the closed commit a new sha, and anything that
   recorded the old one does not learn about it. The one live case is the edit
   acknowledgment: `edit/sessions.ts` records `lastSha` per save and observes
   amends through the commit outcome, but a *close* is not a commit it observes.
   So when the agent writes mid-session and closes the user's window, the
   `doc.edited` event's `to` names a commit that is no longer reachable from the
   branch. The event's content is unaffected (the rewrite changed only the
   message, so `git diff from..to` is byte-identical) and the object still
   resolves, but "never publish a sha no branch holds" is the rule PR #22
   established, and this reaches it by a different door.
   `edit/acknowledgment.test.ts` documents it at the assertion rather than
   hiding it. Three ways out, for the orchestrator to pick:
   - **(a)** SERVER-093 gives the tracker a way to follow the rewrite —
     `closeWindow` reports `{before, after}`, `app.ts` forwards it, the tracker
     rebases its recorded shas. Keeps this issue's mechanism exactly as
     specified. ~25 lines across three files.
   - **(b)** Write the editing-session subject **eagerly** — from the window's
     first save, refreshed on every fold, with `act: true` overriding it — so
     closing rewrites nothing, changes no sha, and costs no git call. Nothing
     can dangle, and the sync/async question in (1) disappears entirely. Cost: a
     window's commit shows the generic subject while it is still open instead of
     its last verb, and between this issue and SERVER-092 *every* commit would
     read `editing session: …` because no call site passes `act: true` yet.
   - **(c)** Accept it: the range's content is right and the object resolves.
   I implemented the issue as written (rewrite at close) rather than picking (b)
   unilaterally; flipping to (b) is ~20 lines, all inside `commit.ts`.

## Completion Checklist (domain agent)

- [x] Tests written and passing — `commit.test.ts` 41 passing (8 new cases for
      the window, 1 for the `squash: false` fix); `apps/server` 3713 passing
- [x] `/lint` passes — eslint, prettier and `tsc --noEmit` all clean
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-cutting write path — qualifies)
- [ ] Committed with `[ISSUE-ID]` prefix
