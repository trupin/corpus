# [SERVER-091] A commit window belongs to a party, not to a document

## Domain

server

## Status

todo

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

- [ ] The fold key is the **actor alone**. Two saves to two documents by the same
      party inside the idle window land as **one commit** carrying both changes
      and one `Corpus-Doc` trailer per document
- [ ] The other party writing **closes** the open window: their change never
      folds into it, and `git log --author` still names exactly one party per
      commit. Prove it with a user save, an agent save, and a user save — three
      commits, in that authorship order
- [ ] A window accumulates **every** document id it has held, and its commit
      message carries one `Corpus-Doc` trailer per document. `buildTrailers`
      already emits per-id lines; the accumulation is what is missing
- [ ] `amendTarget`'s HEAD-trailer verification still proves the server made the
      commit it is about to rewrite. The single-`Corpus-Doc`-equals-`docId` check
      cannot survive as written — replace it with a set comparison against the
      window's accumulated ids, do not delete it
- [ ] A window **ages out**: once it has been open longer than a bounded maximum
      it closes regardless of continuing activity, and the next save opens a
      fresh one. The interval is a named exported constant beside
      `SQUASH_IDLE_MS`, not a literal, and **no number reaches SPEC.md**
- [ ] `closeWindow(reason)` exists on `AutoCommitter` and is what every other
      issue in this chain calls. Where no act named the window, closing rewrites
      the commit's subject to say it is an editing session and how many documents
      it holds; where an act named it, the subject stands
- [ ] `endSquashSession(sha)` keeps working for its existing caller
      (`edit/sessions.ts`) — it may become a thin wrapper over `closeWindow`, but
      the published-sha guarantee it exists for must not regress
- [ ] `docIds` still means "commits alone, folds neither direction". Unchanged
- [ ] The subject-rewrite amend is refused in exactly the states an ordinary
      amend is refused, and refusing it is harmless: the commit keeps the last
      save's subject and the window closes anyway
- [ ] `SQUASH_IDLE_MS` behaviour is otherwise untouched, and no existing test in
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

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (cross-cutting write path — qualifies)
- [ ] Committed with `[ISSUE-ID]` prefix
